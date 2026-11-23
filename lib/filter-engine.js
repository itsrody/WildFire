/* WildFire - minimal Adblock-ish filter parser and matcher.
 *
 * Supported:
 *   ||example.com^            domain-anchored network filter
 *   |http://example.com/path| start/end anchored filter
 *   example.com*ad.js         wildcard filter
 *   /regex/flags              safe regular-expression filter
 *   @@||example.com^          exception (un-block)
 *   $script,image,third-party resource type / party options
 *   $domain=example.com|~foo.com  document domain options
 *   $document, $popup         navigation / popup filters
 *   $redirect=alias           serve a WildFire data-URI resource
 *   $rewrite=alias            replace a response with a WildFire-owned body
 *   $csp=alias                add a curated WildFire CSP response header
 *   example.com##.ad          element hiding (cosmetic)
 *   example.com##.ad:has-text("x")  procedural cosmetic rule
 *   example.com##.ad:contains("x")  subtree text procedural rule
 *   example.com##.ad:nth-ancestor(2) hide an ancestor of a match
 *   example.com#@#.ad         cosmetic exception
 *   example.com##+js(alias,arg)  curated WildFire scriptlet alias
 *
 * Deliberately not supported: $rewrite-rule, and filter-supplied header, script,
 * or response-body values.
 */
(function (global) {
  'use strict';

  const TOKEN_LENGTH = 4;
  const MAX_REGEX_LENGTH = 512;
  const MAX_REGEX_QUANTIFIERS = 16;
  const MAX_REGEX_GROUPS = 16;
  const MAX_REGEX_URL_LENGTH = 8192;
  const PROCEDURAL_OPS = ['has-text(', 'contains(', 'matches-path(', 'has(', 'nth-ancestor('];
  const MAX_PROCEDURAL_DEPTH = 8;
  const MAX_NTH_ANCESTOR = 8;
  const WORST_TOKEN_USAGE = 0x7fffffff;
  const BAD_TOKEN_USAGE = 0x3fffffff;
  const COMPILED_VERSION = 2;
  const WORST_TOKENS = new Set(['https', 'http', 'www', 'com']);

  // Capability flags: compact compile-time summary for listener gating and
  // diagnostics. A flag is set when any active rule requires the capability.
  const CAP = {
    NETWORK: 1 << 0,
    EXCEPTION: 1 << 1,
    IMPORTANT: 1 << 2,
    REDIRECT: 1 << 3,
    REWRITE: 1 << 4,
    CSP: 1 << 5,
    POPUP: 1 << 6,
    DOCUMENT: 1 << 7,
    THIRD_PARTY: 1 << 8,
    DOMAIN: 1 << 9,
    REGEX: 1 << 10,
    COSMETIC: 1 << 11,
    PROCEDURAL: 1 << 12,
    SCRIPTLET: 1 << 13,
    GENERICHIDE: 1 << 14,
    ELEMHIDE: 1 << 15,
    SPECIFICHIDE: 1 << 16,
    BADFILTER: 1 << 17,
    REMOVEPARAM: 1 << 18,
    REMOVEHEADER: 1 << 19
  };

  function fnv1a32(text) {
    let h = 2166136261;
    const str = String(text || '');
    Array.from(str).forEach(ch => {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    });
    return (h >>> 0).toString(16);
  }

  function detectSourceKind(line, syntax) {
    if (syntax === 'adguard') return 'adguard';
    const text = String(line || '');
    if (text.indexOf('#%#') !== -1 || text.indexOf('#@%#') !== -1) return 'adguard';
    if (text.indexOf('##+js(') !== -1 || text.indexOf('#@#+js(') !== -1) return 'ubo';
    if (text.indexOf('#?#') !== -1) return 'abp';
    if (/\$(~?rewrite)=/i.test(text)) return 'abp';
    return 'wildfire';
  }
  const BAD_TOKENS = new Set([
    'uk', 'net', 'org', 'io', 'de', 'fr', 'es', 'it', 'nl', 'se', 'ru', 'pl', 'co',
    'js', 'css', 'img', 'jpg', 'html', 'png', 'cdn', 'static', 'images', 'api', 'wp',
    'ad', 'ads', 'content', 'doubleclick', 'analytics', 'assets', 'id', 'min',
    'amazon', 'google', 'googlesyndication', 'googleapis'
  ]);

  const RESOURCE_TYPES = new Set([
    'document', 'subdocument', 'script', 'image', 'imageset', 'stylesheet',
    'object', 'xmlhttprequest', 'font', 'media', 'websocket',
    'ping', 'csp', 'manifest', 'other'
  ]);

  const TYPE_ALIASES = {
    main_frame: 'document',
    document: 'document',
    doc: 'document',
    sub_frame: 'subdocument',
    subdocument: 'subdocument',
    frame: 'subdocument',
    script: 'script',
    image: 'image',
    imageset: 'imageset',
    stylesheet: 'stylesheet',
    css: 'stylesheet',
    object: 'object',
    object_subrequest: 'object',
    xmlhttprequest: 'xmlhttprequest',
    xhr: 'xmlhttprequest',
    font: 'font',
    media: 'media',
    websocket: 'websocket',
    ws: 'websocket',
    wss: 'websocket',
    ping: 'ping',
    csp: 'csp',
    csp_report: 'csp',
    manifest: 'manifest',
    web_manifest: 'manifest',
    other: 'other',
    eventsource: 'other',
    speculative: 'other'
  };

  function normalizeType(value) {
    return TYPE_ALIASES[String(value || '').toLowerCase()] || null;
  }

  function escapeChar(ch) {
    return /[\\^$.*+?()[\]{}|]/.test(ch) ? '\\' + ch : ch;
  }

  function hostnameOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase().replace(/\.$/, '');
    } catch (error) {
      return '';
    }
  }

  function parentHosts(host) {
    if (!host) return [];
    return String(host).toLowerCase().split('.').filter(Boolean)
      .map((_, index, parts) => parts.slice(index).join('.'));
  }

  function tokenUsage(token) {
    if (WORST_TOKENS.has(token)) return WORST_TOKEN_USAGE;
    if (BAD_TOKENS.has(token)) return BAD_TOKEN_USAGE;
    return 0;
  }

  function urlTokens(url) {
    const text = String(url || '').toLowerCase();
    if (text.length < TOKEN_LENGTH) return [];
    // Tokenize alnum/% runs with a native regex. All 4-char tokens inside runs
    // are probed; this is correct for one-token-per-rule indexing and cheaper
    // than sliding over the full URL because separators are skipped.
    const tokens = new Set();
    Array.from(text.matchAll(/[a-z0-9%]{4,}/g)).forEach(match => {
      const run = match[0];
      const last = run.length - TOKEN_LENGTH;
      Array.from({ length: last + 1 }, (_, index) => run.slice(index, index + TOKEN_LENGTH))
        .forEach(token => tokens.add(token));
    });
    return Array.from(tokens);
  }

  function domainMatches(host, domain) {
    if (!host || !domain) return false;
    const key = String(domain).toLowerCase().replace(/^\./, '');
    return host === key || host.endsWith('.' + key);
  }

  function fallbackRegistrable(host) {
    const parts = String(host || '').split('.').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  }

  function splitLiteralPattern(pattern) {
    const body = pattern.trim();
    if (!body.startsWith('/')) return { pattern: body };
    const match = body.match(/^\/([\s\S]*)\/([imsu]*)$/);
    if (!match) return { pattern: body };
    return { pattern: match[1], flags: match[2], isRegex: true };
  }

  function compilePattern(pattern, matchCase, flagText) {
    const split = splitLiteralPattern(pattern);
    if (split.isRegex) {
      const flags = Array.from(new Set((matchCase
        ? String(flagText || split.flags || '').replace(/i/g, '')
        : String(flagText || split.flags || '') + 'i').split(''))).join('');
      if (/[^imsu]/.test(flags)) return { error: 'unsupported regex flag' };
      const safety = regexSafetyError(split.pattern);
      if (safety) return { error: safety };
      try {
        return { regex: new RegExp(split.pattern, flags), isRegex: true };
      } catch (error) {
        return { error: 'invalid regex: ' + error.message };
      }
    }

    let body = split.pattern;
    let hostAnchor = false;
    let startAnchor = false;
    let endAnchor = false;

    if (body.startsWith('||')) {
      hostAnchor = true;
      body = body.slice(2);
    }
    if (body.startsWith('|')) {
      startAnchor = true;
      body = body.slice(1);
    }
    if (body.endsWith('|')) {
      endAnchor = true;
      body = body.slice(0, -1);
    }

    const hasWildcard = body.indexOf('*') !== -1 || body.indexOf('^') !== -1;
    if (!hasWildcard) {
      return {
        isPlain: true,
        hostAnchor, startAnchor, endAnchor,
        needle: matchCase ? body : body.toLowerCase(),
        matchCase: Boolean(matchCase)
      };
    }

    // Common adblock-rust/uBO case: ||host^ is host-anchored only; trailing
    // separator is implied by host boundary. Compile as plain matcher.
    if (hostAnchor && !startAnchor && !endAnchor &&
      body.indexOf('*') === -1 && body.endsWith('^') &&
      body.indexOf('^') === body.length - 1) {
      const hostNeedle = body.slice(0, -1);
      if (hostNeedle && !/[\/?#]/.test(hostNeedle)) {
        return {
          isPlain: true,
          hostAnchor: true, startAnchor: false, endAnchor: false,
          needle: matchCase ? hostNeedle : hostNeedle.toLowerCase(),
          matchCase: Boolean(matchCase)
        };
      }
    }

    // Wildcard/separator bytecode-lite: compile * and ^ into literal segments
    // for native indexOf-based matching. Falls back to regex for patterns with
    // no literal anchor or ambiguous host-anchor splits.
    const segments = [];
    let literal = '';
    Array.from(body).forEach(ch => {
      if (ch === '*' || ch === '^') {
        if (literal) {
          segments.push({ type: 'lit', v: matchCase ? literal : literal.toLowerCase() });
          literal = '';
        }
        const op = ch === '*';
        const prev = segments[segments.length - 1];
        if (!(op && prev && prev.type === 'wild')) segments.push({ type: op ? 'wild' : 'sep' });
      } else {
        literal += ch;
      }
    });
    if (literal) segments.push({ type: 'lit', v: matchCase ? literal : literal.toLowerCase() });

    const hasLiteral = segments.some(seg => seg.type === 'lit');
    const hostAnchorSafe = !hostAnchor || (
      segments[0] && segments[0].type === 'lit' &&
      (/[\/?#]/.test(segments[0].v) ||
        !segments.slice(1).some(seg => seg.type === 'lit' && !/[\/?#]/.test(seg.v)))
    );

    if (hasLiteral && hostAnchorSafe) {
      return {
        isSegments: true,
        hostAnchor, startAnchor, endAnchor,
        matchCase: Boolean(matchCase),
        segments
      };
    }

    const source = Array.from(body, ch => {
      if (ch === '*') return '[\\s\\S]*';
      if (ch === '^') return '(?:[^a-zA-Z0-9._-]|$)';
      return escapeChar(ch);
    }).join('');

    let prefix = '';
    if (hostAnchor) prefix = '(?:^|[a-z]+:\\/\\/)(?:[^\\/?#:]+\\.)?';
    else if (startAnchor) prefix = '^';

    const suffix = endAnchor ? '$' : '';
    return { regex: new RegExp(prefix + source + suffix, matchCase ? '' : 'i') };
  }

  function hostKeyFromPattern(pattern) {
    if (!pattern.startsWith('||')) return null;
    const match = pattern.slice(2).match(/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]/);
    if (!match) return null;
    const host = match[0].toLowerCase();
    return host.indexOf('.') === -1 && host !== 'localhost' ? null : host;
  }

  function regexEndIndex(text) {
    let escaped = false;
    let inClass = false;
    return Array.from(text).reduce((found, ch, index) => {
      if (found !== -1 || index === 0) return found;
      if (escaped) {
        escaped = false;
        return found;
      }
      if (ch === '\\') {
        escaped = true;
        return found;
      }
      // A slash inside a character class is data, not the closing delimiter.
      if (inClass) {
        if (ch === ']') inClass = false;
        return found;
      }
      if (ch === '[') {
        inClass = true;
        return found;
      }
      return ch === '/' ? index : found;
    }, -1);
  }

  function splitPattern(text) {
    if (!text.startsWith('/')) {
      const dollar = text.lastIndexOf('$');
      return dollar > 0
        ? { pattern: text.slice(0, dollar), optionText: text.slice(dollar + 1) }
        : { pattern: text, optionText: '' };
    }
    const end = regexEndIndex(text);
    if (end === -1) return { pattern: text, optionText: '' };
    const rest = text.slice(end + 1);
    const dollar = rest.indexOf('$');
    return {
      pattern: text.slice(0, end + 1),
      optionText: dollar === -1 ? '' : rest.slice(dollar + 1),
      flags: dollar === -1 ? rest : rest.slice(0, dollar)
    };
  }

  // Reject shapes that can backtrack exponentially before they reach the
  // hot path. The check is deliberately conservative: a false positive only
  // drops one filter, while a false negative would stall request blocking.
  function regexSafetyError(source) {
    if (source.length > MAX_REGEX_LENGTH) return 'regex pattern too long';

    const state = Array.from(source).reduce((current, ch) => {
      if (current.error) return current;
      const top = () => current.stack[current.stack.length - 1];

      if (current.escaped) {
        if (/[1-9]/.test(ch)) current.error = 'backreferences are not allowed';
        current.escaped = false;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (ch === '\\') {
        current.escaped = true;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (current.inClass) {
        if (ch === ']') current.inClass = false;
        return current;
      }
      if (ch === '[') {
        current.inClass = true;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (ch === '(') {
        current.groups++;
        if (current.groups > MAX_REGEX_GROUPS) current.error = 'too many groups';
        else current.stack.push({ risky: false });
        current.pending = null;
        current.afterOpen = true;
        return current;
      }
      if (ch === '?' && current.afterOpen) {
        current.afterOpen = false;
        return current;
      }
      current.afterOpen = false;

      if (ch === '|') {
        const group = top();
        if (group) group.risky = true;
        current.pending = null;
        return current;
      }
      if (ch === ')') {
        const group = current.stack.pop();
        if (group) {
          current.pending = group;
          const parent = top();
          if (parent && group.risky) parent.risky = true;
        }
        return current;
      }
      if (ch === '+' || ch === '*' || ch === '?' || ch === '{') {
        current.quantifiers++;
        if (current.quantifiers > MAX_REGEX_QUANTIFIERS) {
          current.error = 'too many quantifiers';
        } else if (current.pending && current.pending.risky) {
          current.error = 'nested or alternated quantifier';
        } else {
          const group = top();
          if (group) group.risky = true;
          if (current.pending) {
            const parent = top();
            if (parent) parent.risky = true;
            current.pending = null;
          }
        }
        return current;
      }
      current.pending = null;
      return current;
    }, {
      escaped: false, inClass: false, stack: [], pending: null,
      afterOpen: false, quantifiers: 0, groups: 0, error: ''
    });

    return state.error;
  }

  // Regex flags are restricted to i/m/s/u, so exec() is deterministic and safe
  // to call again after a match to obtain capture groups for $redirect-rule.
  function captureGroups(rule, url) {
    if (!rule.isRegex || !rule.regex || url.length > MAX_REGEX_URL_LENGTH) return [];
    const match = rule.regex.exec(url);
    return match ? match.slice(1) : [];
  }

  function splitHost(url, lower, haystack) {
    const scheme = lower.indexOf('://');
    if (scheme === -1) return null;
    const hostStart = scheme + 3;
    const hostStop = ['/', '?', '#', ':'].reduce((stop, ch) => {
      const pos = lower.indexOf(ch, hostStart);
      return pos !== -1 && pos < stop ? pos : stop;
    }, lower.length);
    return { host: lower.slice(hostStart, hostStop), afterHost: haystack.slice(hostStop) };
  }

  function plainPatternMatches(rule, url) {
    const haystack = rule.matchCase ? url : url.toLowerCase();
    const needle = rule.needle;

    if (rule.hostAnchor) {
      const lower = rule.matchCase ? url.toLowerCase() : haystack;
      const parts = splitHost(url, lower, haystack);
      if (!parts) return false;
      const host = parts.host;
      const afterHost = parts.afterHost;

      const needleLower = rule.matchCase ? needle.toLowerCase() : needle;
      const sep = needleLower.search(/[\/?#]/);
      const hostNeedle = sep === -1 ? needleLower : needleLower.slice(0, sep);
      const restNeedle = sep === -1 ? '' : needle.slice(sep);
      if (!(host === hostNeedle || host.endsWith('.' + hostNeedle))) return false;

      if (!restNeedle) {
        if (rule.endAnchor) return afterHost === '';
        return true;
      }
      if (rule.startAnchor && rule.endAnchor) return afterHost === restNeedle;
      if (rule.endAnchor) return afterHost.endsWith(restNeedle);
      if (rule.startAnchor) return afterHost.startsWith(restNeedle);
      return afterHost.indexOf(restNeedle) !== -1;
    }

    if (rule.startAnchor && rule.endAnchor) return haystack === needle;
    if (rule.startAnchor) return haystack.startsWith(needle);
    if (rule.endAnchor) return haystack.endsWith(needle);
    return haystack.indexOf(needle) !== -1;
  }

  function isSeparatorChar(ch) {
    return !ch || !/[a-zA-Z0-9._-]/.test(ch);
  }

  function matchSegments(segs, haystack, pos, endAnchor) {
    if (!segs.length) return !endAnchor || pos === haystack.length;
    const seg = segs[0];
    const rest = segs.slice(1);

    if (seg.type === 'lit') {
      const at = haystack.indexOf(seg.v, pos);
      if (at === -1) return false;
      if (matchSegments(rest, haystack, at + seg.v.length, endAnchor)) return true;
      return matchSegments(segs, haystack, at + 1, endAnchor);
    }

    if (seg.type === 'sep') {
      if (pos >= haystack.length) return matchSegments(rest, haystack, pos, endAnchor);
      if (!isSeparatorChar(haystack[pos])) return false;
      return matchSegments(rest, haystack, pos + 1, endAnchor);
    }

    // wild
    if (!rest.length) return !endAnchor;
    if (rest[0].type === 'lit') {
      const lit = rest[0].v;
      const after = rest.slice(1);
      const tryFrom = p => {
        const at = haystack.indexOf(lit, p);
        if (at === -1) return false;
        if (matchSegments(after, haystack, at + lit.length, endAnchor)) return true;
        return tryFrom(at + 1);
      };
      return tryFrom(pos);
    }
    const tryPos = p => {
      if (p > haystack.length) return false;
      if (matchSegments(rest, haystack, p, endAnchor)) return true;
      return tryPos(p + 1);
    };
    return tryPos(pos);
  }

  function segmentsPatternMatches(rule, url) {
    const haystack = rule.matchCase ? url : url.toLowerCase();
    const segments = rule.segments;

    if (rule.hostAnchor) {
      const lower = rule.matchCase ? url.toLowerCase() : haystack;
      const parts = splitHost(url, lower, haystack);
      if (!parts) return false;
      const host = parts.host;
      const afterHost = parts.afterHost;

      const first = segments[0];
      if (!first || first.type !== 'lit') return false;
      const needleLower = rule.matchCase ? first.v.toLowerCase() : first.v;
      const sep = needleLower.search(/[\/?#]/);
      const hostNeedle = sep === -1 ? needleLower : needleLower.slice(0, sep);
      if (!(host === hostNeedle || host.endsWith('.' + hostNeedle))) return false;

      let restSegs;
      if (sep === -1) {
        restSegs = segments.slice(1);
      } else {
        const restLit = first.v.slice(sep);
        restSegs = [{ type: 'lit', v: restLit }, ...segments.slice(1)];
      }

      if (!restSegs.length) return !rule.endAnchor || afterHost === '';
      if (rule.startAnchor) return matchSegments(restSegs, afterHost, 0, rule.endAnchor);
      // not start-anchored after host: try from each position
      return Array.from({ length: afterHost.length + 1 }, (_, i) => i)
        .some(pos => matchSegments(restSegs, afterHost, pos, rule.endAnchor));
    }

    if (rule.startAnchor) return matchSegments(segments, haystack, 0, rule.endAnchor);
    return Array.from({ length: haystack.length + 1 }, (_, i) => i)
      .some(pos => matchSegments(segments, haystack, pos, rule.endAnchor));
  }

  function parseNetwork(line) {
    let text = line.trim();
    let isException = false;
    if (text.startsWith('@@')) {
      isException = true;
      text = text.slice(2).trim();
    }

    const split = splitPattern(text);
    const pattern = split.pattern;
    const optionText = split.optionText;
    if (!pattern) return null;

    const options = {
      types: null,
      excludedTypes: null,
      thirdParty: null,
      includeDomains: null,
      excludeDomains: null,
      matchCase: false,
      popup: false,
      important: false,
      badfilter: false,
      removeparam: null,
      removeheader: null,
      redirect: '',
      redirectRule: '',
      rewrite: '',
      csp: '',
      generichide: false,
      elemhide: false,
      specifichide: false
    };

    if (optionText) {
      optionText.split(',').forEach(raw => {
        const option = raw.trim().toLowerCase();
        if (!option) return;

        if (option === 'popup') {
          options.popup = true;
          if (!options.types) options.types = new Set();
          options.types.add('document');
        } else if (option === 'match-case') {
          options.matchCase = true;
        } else if (option === 'important') {
          options.important = true;
        } else if (option === 'badfilter') {
          options.badfilter = true;
        } else if (option === 'removeparam' || option.startsWith('removeparam=')) {
          const value = option === 'removeparam' ? '' : option.slice('removeparam='.length).trim();
          options.removeparam = value;
        } else if (option.startsWith('removeheader=')) {
          const value = option.slice('removeheader='.length).trim().toLowerCase();
          options.removeheader = value;
        } else if (option === 'third-party' || option === '3p') {
          options.thirdParty = true;
        } else if (option === '~third-party' || option === '~3p') {
          options.thirdParty = false;
        } else if (option === 'first-party' || option === '1p') {
          options.thirdParty = false;
        } else if (option === '~first-party' || option === '~1p') {
          options.thirdParty = true;
        } else if (option === 'generichide' || option === 'ghide') {
          options.generichide = true;
        } else if (option === 'elemhide' || option === 'ehide') {
          options.elemhide = true;
        } else if (option === 'specifichide' || option === 'shide') {
          options.specifichide = true;
        } else if (option === 'all') {
          options.types = null;
          options.excludedTypes = null;
        } else if (option.startsWith('redirect-rule=')) {
          options.redirectRule = option.slice('redirect-rule='.length).trim().toLowerCase();
        } else if (option.startsWith('redirect=')) {
          options.redirect = option.slice('redirect='.length).trim().toLowerCase();
        } else if (option.startsWith('rewrite=')) {
          options.rewrite = option.slice('rewrite='.length).trim().toLowerCase();
        } else if (option.startsWith('csp=')) {
          options.csp = option.slice('csp='.length).trim().toLowerCase();
        } else if (option.startsWith('domain=') || option.startsWith('from=')) {
          const value = option.slice(option.indexOf('=') + 1);
          value.split('|').forEach(entry => {
            const excluded = entry.startsWith('~');
            const domain = entry.replace(/^~/, '').trim().toLowerCase();
            if (!domain) return;
            const list = excluded ? 'excludeDomains' : 'includeDomains';
            if (!options[list]) options[list] = [];
            options[list].push(domain);
          });
        } else if (option.startsWith('~')) {
          const type = normalizeType(option.slice(1));
          if (type) {
            if (!options.excludedTypes) options.excludedTypes = new Set();
            options.excludedTypes.add(type);
          }
        } else {
          const type = normalizeType(option);
          if (type) {
            if (!options.types) options.types = new Set();
            options.types.add(type);
          }
        }
      });
    }

    const compiled = compilePattern(pattern, options.matchCase, split.flags);
    if (compiled.error) return { error: compiled.error };

    // Phase 1C: parse/validate removeparam/removeheader in IR only. Runtime
    // mutation is intentionally not wired yet; capabilities gate future work.
    if (options.removeparam !== null) {
      const v = String(options.removeparam || '');
      if (v.length > 256 || /[\r\n\0]/.test(v)) return { error: 'invalid removeparam value' };
      if (v.startsWith('/') && v.endsWith('/') && v.length > 2) {
        const re = compilePattern(v, false);
        if (re.error) return { error: 'invalid removeparam regex' };
        options.removeparamRegex = re.regex;
      }
    }
    if (options.removeheader !== null) {
      const v = String(options.removeheader || '');
      if (!/^(?:request:|response:)?[a-z0-9-]{1,64}$/.test(v)) return { error: 'invalid removeheader value' };
    }

    return Object.assign({
      pattern,
      regex: compiled.regex || null,
      isRegex: Boolean(compiled.isRegex),
      isPlain: Boolean(compiled.isPlain),
      isSegments: Boolean(compiled.isSegments),
      segments: compiled.segments || null,
      hostAnchor: Boolean(compiled.hostAnchor),
      startAnchor: Boolean(compiled.startAnchor),
      endAnchor: Boolean(compiled.endAnchor),
      needle: compiled.needle || '',
      hostKey: compiled.isRegex ? null : hostKeyFromPattern(pattern),
      isException,
      important: Boolean(options.important)
    }, options);
  }

  // Locate the first WildFire procedural token outside quotes and parentheses.
  // Native CSS pseudo-classes such as :not() are left to the CSS path.
  function proceduralStart(selector) {
    let quote = '';
    let escaped = false;
    let depth = 0;
    return selector.split('').reduce((found, ch, index) => {
      if (found !== -1) return found;
      if (escaped) {
        escaped = false;
        return found;
      }
      if (ch === '\\') {
        escaped = true;
        return found;
      }
      if (quote) {
        if (ch === quote) quote = '';
        return found;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        return found;
      }
      if (ch === '(') {
        depth++;
        return found;
      }
      if (ch === ')') {
        depth = Math.max(0, depth - 1);
        return found;
      }
      if (ch !== ':' || depth !== 0) return found;
      const tail = selector.slice(index + 1);
      return PROCEDURAL_OPS.some(op => tail.startsWith(op)) ? index : found;
    }, -1);
  }

  function matchingParen(text, openIndex) {
    let quote = '';
    let escaped = false;
    let depth = 0;
    return text.split('').reduce((found, ch, index) => {
      if (found !== -1 || index < openIndex) return found;
      if (escaped) {
        escaped = false;
        return found;
      }
      if (ch === '\\') {
        escaped = true;
        return found;
      }
      if (quote) {
        if (ch === quote) quote = '';
        return found;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        return found;
      }
      if (ch === '(') {
        depth++;
        return found;
      }
      if (ch === ')') {
        depth--;
        return depth === 0 ? index : found;
      }
      return found;
    }, -1);
  }

  function unquote(value) {
    const text = value.trim();
    const quote = text.charAt(0);
    if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
      return text.slice(1, -1).replace(/\\(["'\\])/g, '$1');
    }
    return text;
  }

  function selectorRegexMatcher(source) {
    const match = source.match(/^\/([\s\S]*)\/([imsu]*)$/);
    if (!match) return null;
    const compiled = compilePattern('/' + match[1] + '/', false, match[2]);
    if (compiled.error) return null;
    return { type: 'regex', source: compiled.regex.source, flags: compiled.regex.flags };
  }

  function parseStepList(text, depth) {
    if (!text) return { steps: [] };
    if (depth > MAX_PROCEDURAL_DEPTH) return { error: 'procedural selector too deep' };
    if (proceduralStart(text) !== 0) return { error: 'invalid procedural selector' };

    const body = text.slice(1);
    const open = body.indexOf('(');
    if (open === -1) return { error: 'unclosed procedural selector' };
    const op = body.slice(0, open).trim();
    const close = matchingParen(body, open);
    if (close === -1) return { error: 'unbalanced procedural selector' };
    const arg = body.slice(open + 1, close).trim();
    const tail = body.slice(close + 1).trim();

    let step;
    if (op === 'has-text' || op === 'contains') {
      if (!arg) return { error: 'empty :' + op + ' argument' };
      if (arg.startsWith('/')) {
        const matcher = selectorRegexMatcher(arg);
        if (!matcher) return { error: 'invalid :' + op + ' regex' };
        step = { op, matcher };
      } else {
        const value = unquote(arg);
        if (!value) return { error: 'empty :' + op + ' argument' };
        step = { op, matcher: { type: 'text', value } };
      }
    } else if (op === 'matches-path') {
      const matcher = selectorRegexMatcher(arg);
      if (!matcher) return { error: 'invalid :matches-path regex' };
      step = { op: 'matches-path', matcher };
    } else if (op === 'has') {
      if (!arg) return { error: 'empty :has argument' };
      const inner = parseSelectorTree(arg, depth + 1);
      if (inner.error) return { error: inner.error };
      step = { op: 'has', inner };
    } else if (op === 'nth-ancestor') {
      const count = Number(arg);
      if (!Number.isInteger(count) || count < 1 || count > MAX_NTH_ANCESTOR) {
        return { error: 'invalid :nth-ancestor argument' };
      }
      step = { op: 'nth-ancestor', count };
    } else {
      return { error: 'unknown procedural selector' };
    }

    const next = tail ? parseStepList(tail, depth + 1) : { steps: [] };
    if (next.error) return next;
    return { steps: [step].concat(next.steps) };
  }

  function parseSelectorTree(text, depth) {
    const start = proceduralStart(text);
    if (start === -1) return { plain: text.trim() };
    if (depth > MAX_PROCEDURAL_DEPTH) return { error: 'procedural selector too deep' };
    const base = text.slice(0, start).trim() || '*';
    const parsed = parseStepList(text.slice(start), depth);
    if (parsed.error) return parsed;
    return { base, steps: parsed.steps, source: text };
  }

  // Split scriptlet arguments without splitting commas inside quoted strings
  // or regex literals. Everything remains plain text; the registry validates
  // each argument before any implementation sees it.
  function splitScriptletArgs(text) {
    const state = Array.from(text).reduce((current, ch) => {
      if (current.error) return current;
      if (current.escaped) {
        current.current += ch;
        current.escaped = false;
        return current;
      }
      if (current.quote) {
        if (ch === current.quote) current.quote = '';
        else if (ch === '\\') current.escaped = true;
        current.current += ch;
        return current;
      }
      if (current.regex) {
        if (ch === '\\') {
          current.escaped = true;
        } else if (ch === '/') {
          current.regex = false;
        }
        current.current += ch;
        return current;
      }
      if (ch === ',') {
        current.parts.push(current.current.trim());
        current.current = '';
        return current;
      }
      if ((ch === '"' || ch === "'") && !current.current.trim()) {
        current.quote = ch;
        current.current += ch;
        return current;
      }
      if (ch === '/' && !current.current.trim()) {
        current.regex = true;
        current.current += ch;
        return current;
      }
      if (ch === '(' || ch === ')') {
        current.error = 'nested +js arguments';
        return current;
      }
      current.current += ch;
      return current;
    }, { parts: [], current: '', quote: '', regex: false, escaped: false, error: '' });

    if (state.error) return { error: state.error };
    if (state.quote || state.regex) return { error: 'unterminated +js argument' };
    const parts = state.parts.concat(state.current.trim());
    const args = parts.map(part => {
      if (part.length > 1 && (part[0] === '"' || part[0] === "'") &&
        part[part.length - 1] === part[0]) {
        return part.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      return part;
    });
    return { args };
  }

  // Scriptlet rules carry an alias and plain data only. The injected registry
  // decides whether the alias and its arguments are allowed. A leading `~` is
  // preserved so the registry can apply negated domain scopes per host.
  function parseScriptlet(line) {
    const text = line.trim();
    const exceptAt = text.indexOf('#@#+js(');
    const hideAt = text.indexOf('##+js(');
    let index;
    let isException;
    let open;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
      open = exceptAt + '#@#+js('.length - 1;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
      open = hideAt + '##+js('.length - 1;
    } else {
      return null;
    }

    const body = text.slice(open + 1).trim();
    if (!body.endsWith(')')) return { error: 'unterminated +js rule' };
    const parsedArgs = splitScriptletArgs(body.slice(0, -1));
    if (parsedArgs.error) return { error: parsedArgs.error };
    const parts = parsedArgs.args;
    const alias = (parts.shift() || '').toLowerCase();
    if (!alias) return { error: 'empty scriptlet alias' };

    const domains = text.slice(0, index)
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    return { domains, alias, args: parts, isException, syntax: 'ubo' };
  }

  // AdGuard scriptlets use single-quoted string arguments. Parse them as
  // plain data; the content-side registry validates every value again.
  function splitAdguardArgs(text) {
    const state = Array.from(text).reduce((current, ch) => {
      if (current.error) return current;
      if (current.escaped) {
        current.current += (ch === current.quote || ch === '\\') ? ch : '\\' + ch;
        current.escaped = false;
        return current;
      }
      if (current.quote) {
        if (ch === current.quote) current.quote = '';
        else if (ch === '\\') {
          current.escaped = true;
          return current;
        }
        current.current += ch;
        return current;
      }
      if (ch === ',' && !current.current.trim()) {
        return current;
      }
      if (ch === ',' && current.current.trim()) {
        current.parts.push(current.current.trim());
        current.current = '';
        return current;
      }
      if ((ch === '"' || ch === "'") && !current.current.trim()) {
        current.quote = ch;
        current.current += ch;
        return current;
      }
      current.current += ch;
      return current;
    }, { parts: [], current: '', quote: '', escaped: false, error: '' });

    if (state.error) return { error: state.error };
    if (state.quote) return { error: 'unterminated AdGuard scriptlet argument' };
    const parts = state.parts.concat(state.current.trim()).filter(Boolean);
    const args = parts.map(part => {
      if (part.length > 1 && (part[0] === '"' || part[0] === "'") &&
        part[part.length - 1] === part[0]) {
        return part.slice(1, -1);
      }
      return part;
    });
    return { args };
  }

  function parseAdguardScriptlet(line) {
    const text = line.trim();
    const exceptAt = text.indexOf('#@%#//scriptlet(');
    const hideAt = text.indexOf('#%#//scriptlet(');
    let index;
    let isException;
    let open;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
      open = exceptAt + '#@%#//scriptlet('.length - 1;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
      open = hideAt + '#%#//scriptlet('.length - 1;
    } else {
      return null;
    }

    const body = text.slice(open + 1).trim();
    if (!body.endsWith(')')) return { error: 'unterminated AdGuard scriptlet rule' };
    const parsed = splitAdguardArgs(body.slice(0, -1));
    if (parsed.error) return { error: parsed.error };
    const parts = parsed.args;
    const alias = (parts.shift() || '').toLowerCase();
    if (!alias) return { error: 'empty AdGuard scriptlet alias' };

    const domains = text.slice(0, index)
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    return { domains, alias, args: parts, isException, syntax: 'adguard' };
  }

  function parseCosmetic(line) {
    const text = line.trim();
    const hideAt = text.indexOf('##');
    const exceptAt = text.indexOf('#@#');
    let index;
    let isException;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
    } else {
      return null;
    }

    const selector = text.slice(index + (isException ? 3 : 2)).trim();
    if (!selector) return null;

    const tree = parseSelectorTree(selector, 0);
    if (tree.error) return { error: tree.error };

    const domains = text.slice(0, index)
      .split(',')
      .map(part => part.trim().replace(/^~/, '').toLowerCase())
      .filter(Boolean);

    return { domains, selector, isException, procedural: tree.plain ? null : tree };
  }

  class FilterEngine {
    constructor(getDomain, resolveCsp, scriptlets, hasRewrite) {
      this.getDomain = typeof getDomain === 'function' ? getDomain : null;
      // Injected so this library stays browser-free and unit-testable. Without
      // a resolver, $csp rules are rejected instead of weakening a response.
      this.resolveCsp = typeof resolveCsp === 'function' ? resolveCsp : null;
      // WildFireScriptlets owns the alias list and argument validation; the
      // engine never interprets filter-supplied code.
      this.scriptlets = scriptlets && typeof scriptlets.validate === 'function'
        ? scriptlets
        : null;
      // RewriteResources owns the fixed alias-to-body mapping. A rule with an
      // alias the registry does not know is rejected, never turned into a
      // plain network blocker.
      this.hasRewrite = typeof hasRewrite === 'function' ? hasRewrite : null;
      this.reset();
    }

    _cspDirective(alias) {
      if (!this.resolveCsp) return '';
      try {
        return this.resolveCsp(alias) || '';
      } catch (error) {
        return '';
      }
    }

    _rewriteAvailable(alias) {
      if (!this.hasRewrite) return false;
      try {
        return Boolean(this.hasRewrite(alias));
      } catch (error) {
        return false;
      }
    }

    _registrable(host) {
      if (!this.getDomain) return fallbackRegistrable(host);
      try {
        return this.getDomain(host) || fallbackRegistrable(host);
      } catch (error) {
        return fallbackRegistrable(host);
      }
    }

    reset() {
      this.hostRules = new Map();
      this.tokenRules = new Map();
      this.unindexedRules = [];
      this.rejectedRegex = [];
      this.rejectedCsp = [];
      this.rejectedRewrite = [];
      this.rejectedScriptlets = [];
      this.cosmeticByDomain = new Map();
      this.cosmeticExceptionsByDomain = new Map();
      this.genericCosmetic = [];
      this.genericCosmeticExceptions = [];
      this.proceduralByDomain = new Map();
      this.proceduralExceptionsByDomain = new Map();
      this.genericProcedural = new Map();
      this.genericProceduralExceptions = new Set();
      this.rejectedCosmetic = [];
      this.scriptletRules = [];
      this._seen = [];
      this._seenGen = 0;
      this._tokenUsage = new Map();
      this.counts = {
        network: 0, exceptions: 0, cosmetic: 0, csp: 0, scriptlets: 0, rewrite: 0
      };
      this.diagnostics = [];
      this.capabilities = 0;
    }

    _ruleTokens(rule) {
      const runs = String(rule.pattern || '')
        .toLowerCase()
        .match(/[a-z0-9%]{4,}/g) || [];
      if (!runs.length) return null;
      const tokens = new Set();
      runs.forEach(run => {
        const last = run.length - TOKEN_LENGTH;
        [0, Math.floor(last / 2), last]
          .map(index => run.slice(index, index + TOKEN_LENGTH))
          .forEach(token => tokens.add(token));
      });
      return Array.from(tokens);
    }

    // Generic rules are indexed by one token selected by expected bucket cost.
    // Inspired by adblock-rust's token selector: avoid very common tokens and
    // prefer least-used buckets, keeping match-time candidate sets small.
    _indexRule(rule) {
      const tokens = this._ruleTokens(rule);
      if (!tokens) return false;
      const selected = tokens.reduce((best, token) => {
        const usage = this._tokenUsage.get(token) || tokenUsage(token);
        if (!best || usage < best.usage) return { token, usage };
        return best;
      }, null);
      if (!selected) return false;
      const token = selected.token;
      if (!this.tokenRules.has(token)) this.tokenRules.set(token, []);
      this.tokenRules.get(token).push(rule);
      // Cap effective usage to keep Map values stable and avoid unbounded growth
      // influence; selection remains deterministic and favors less-hot buckets.
      const prev = this._tokenUsage.get(token) || tokenUsage(token);
      this._tokenUsage.set(token, prev < BAD_TOKEN_USAGE ? prev + 1 : prev);
      return true;
    }

    _addNetworkRule(rule) {
      if (rule.csp) {
        if (!this._cspDirective(rule.csp)) {
          this.rejectedCsp.push({ line: rule.pattern, reason: 'unknown CSP alias: ' + rule.csp });
          this.diagnostics.push({
            type: 'rejected', category: 'csp', reason: 'unknown CSP alias: ' + rule.csp,
            sourceKind: rule.sourceKind || 'wildfire', hash: rule.hash || ''
          });
          return;
        }
        this.counts.csp++;
      }
      if (rule.rewrite) {
        if (!this._rewriteAvailable(rule.rewrite)) {
          this.rejectedRewrite.push({
            line: rule.pattern, reason: 'unknown rewrite alias: ' + rule.rewrite
          });
          this.diagnostics.push({
            type: 'rejected', category: 'rewrite', reason: 'unknown rewrite alias: ' + rule.rewrite,
            sourceKind: rule.sourceKind || 'wildfire', hash: rule.hash || ''
          });
          return;
        }
        this.counts.rewrite++;
      }
      rule.order = this.counts.network++;
      if (rule.isException) this.counts.exceptions++;

      let cap = CAP.NETWORK;
      if (rule.isException) cap |= CAP.EXCEPTION;
      if (rule.important) cap |= CAP.IMPORTANT;
      if (rule.redirect || rule.redirectRule) cap |= CAP.REDIRECT;
      if (rule.rewrite) cap |= CAP.REWRITE;
      if (rule.csp) cap |= CAP.CSP;
      if (rule.popup) cap |= CAP.POPUP;
      if (rule.types && rule.types.has('document')) cap |= CAP.DOCUMENT;
      if (rule.thirdParty !== null) cap |= CAP.THIRD_PARTY;
      if (rule.includeDomains || rule.excludeDomains) cap |= CAP.DOMAIN;
      if (rule.isRegex) cap |= CAP.REGEX;
      if (rule.generichide) cap |= CAP.GENERICHIDE;
      if (rule.elemhide) cap |= CAP.ELEMHIDE;
      if (rule.specifichide) cap |= CAP.SPECIFICHIDE;
      if (rule.removeparam !== null && rule.removeparam !== undefined) cap |= CAP.REMOVEPARAM;
      if (rule.removeheader) cap |= CAP.REMOVEHEADER;
      rule.cap = cap;
      this.capabilities |= cap;

      if (rule.hostKey) {
        if (!this.hostRules.has(rule.hostKey)) this.hostRules.set(rule.hostKey, []);
        this.hostRules.get(rule.hostKey).push(rule);
      } else if (rule.isRegex || !this._indexRule(rule)) {
        this.unindexedRules.push(rule);
      }
    }

    _networkRuleKey(rule) {
      const types = rule.types ? Array.from(rule.types).sort().join(',') : '';
      const xtypes = rule.excludedTypes ? Array.from(rule.excludedTypes).sort().join(',') : '';
      const id = rule.includeDomains ? rule.includeDomains.slice().sort().join(',') : '';
      const xd = rule.excludeDomains ? rule.excludeDomains.slice().sort().join(',') : '';
      return [
        rule.isException ? '1' : '0',
        rule.pattern,
        rule.isRegex ? 'r' : rule.isPlain ? 'p' : rule.isSegments ? 's' : 'g',
        rule.matchCase ? '1' : '0',
        rule.popup ? '1' : '0',
        rule.important ? '1' : '0',
        rule.thirdParty === null ? '0' : rule.thirdParty ? '1' : '-1',
        rule.redirect || '',
        rule.redirectRule || '',
        rule.rewrite || '',
        rule.csp || '',
        rule.generichide ? '1' : '0',
        rule.elemhide ? '1' : '0',
        rule.specifichide ? '1' : '0',
        rule.removeparam === null || rule.removeparam === undefined ? '' : 'rp=' + rule.removeparam,
        rule.removeheader || '',
        types, xtypes, id, xd
      ].join('|');
    }

    load(text, options) {
      const append = Boolean(options && options.append);
      if (!append) this.reset();
      const lines = String(text == null ? '' : text).split(/\r?\n/);
      const pendingNetwork = [];

      lines.forEach(raw => {
        const line = raw.trim();
        if (!line || line.startsWith('!')) return;
        if (line.startsWith('#') && line.indexOf('##') === -1 && line.indexOf('#@#') === -1 &&
          line.indexOf('#%#') === -1 && line.indexOf('#@%#') === -1) return;

        const scriptlet = parseScriptlet(line) || parseAdguardScriptlet(line);
        if (scriptlet) {
          scriptlet.sourceKind = detectSourceKind(line, scriptlet.syntax);
          scriptlet.hash = fnv1a32(line);
          const error = scriptlet.error || (this.scriptlets
            ? this.scriptlets.validate(scriptlet.alias, scriptlet.args, scriptlet.syntax)
            : 'scriptlet registry unavailable');
          if (error) {
            this.rejectedScriptlets.push({ line, reason: error });
            this.diagnostics.push({
              type: 'rejected', category: 'scriptlet', reason: error,
              sourceKind: scriptlet.sourceKind, hash: scriptlet.hash
            });
            return;
          }
          this.counts.scriptlets++;
          this.capabilities |= CAP.SCRIPTLET;
          this.scriptletRules.push(scriptlet);
          return;
        }

        if (line.indexOf('##') !== -1 || line.indexOf('#@#') !== -1) {
          const cosmetic = parseCosmetic(line);
          if (!cosmetic) return;
          cosmetic.sourceKind = detectSourceKind(line);
          cosmetic.hash = fnv1a32(line);
          if (cosmetic.error) {
            this.rejectedCosmetic.push({ line, reason: cosmetic.error });
            this.diagnostics.push({
              type: 'rejected', category: 'cosmetic', reason: cosmetic.error,
              sourceKind: cosmetic.sourceKind, hash: cosmetic.hash
            });
            return;
          }
          this.counts.cosmetic++;
          this.capabilities |= cosmetic.procedural ? (CAP.COSMETIC | CAP.PROCEDURAL) : CAP.COSMETIC;
          if (cosmetic.procedural) this._addProcedural(cosmetic);
          else this._addCosmetic(cosmetic);
          return;
        }

        const rule = parseNetwork(line);
        if (!rule) return;
        rule.sourceKind = detectSourceKind(line);
        rule.hash = fnv1a32(line);
        if (rule.error) {
          this.rejectedRegex.push({ line, reason: rule.error });
          this.diagnostics.push({
            type: 'rejected', category: 'network', reason: rule.error,
            sourceKind: rule.sourceKind, hash: rule.hash
          });
          return;
        }
        pendingNetwork.push(rule);
      });

      // Compile-time $badfilter: remove the matching base rule(s) and the
      // badfilter rule itself. No per-request badfilter checks.
      const tombstones = new Map();
      pendingNetwork.forEach(rule => {
        if (!rule.badfilter) return;
        this.capabilities |= CAP.BADFILTER;
        tombstones.set(this._networkRuleKey(rule), (tombstones.get(this._networkRuleKey(rule)) || 0) + 1);
      });
      pendingNetwork.forEach(rule => {
        if (rule.badfilter) return;
        const key = this._networkRuleKey(rule);
        const n = tombstones.get(key) || 0;
        if (n > 0) {
          tombstones.set(key, n - 1);
          this.diagnostics.push({
            type: 'neutralized', category: 'network', reason: 'badfilter removed rule',
            sourceKind: rule.sourceKind, hash: rule.hash
          });
          return;
        }
        this._addNetworkRule(rule);
      });
      tombstones.forEach((remaining, key) => {
        if (remaining <= 0) return;
        this.diagnostics.push({
          type: 'orphan', category: 'network', reason: 'badfilter had no matching rule: ' + key,
          sourceKind: 'wildfire', hash: ''
        });
      });
    }

    static get COMPILED_VERSION() { return COMPILED_VERSION; }
    static get CAP() { return CAP; }

    getCapabilities() { return this.capabilities; }
    hasCapability(flag) { return (this.capabilities & flag) === flag; }
    getDiagnostics() { return this.diagnostics.slice(); }

    toCompiled() {
      const network = [];
      const collect = rule => { network[rule.order] = rule; };
      this.unindexedRules.forEach(collect);
      this.hostRules.forEach(bucket => bucket.forEach(collect));
      this.tokenRules.forEach(bucket => bucket.forEach(collect));
      const seen = new Set();
      const rules = network.filter(rule => rule && !seen.has(rule.order) && seen.add(rule.order));

      const serializeRule = rule => {
        const out = {
          p: rule.pattern,
          x: rule.isException ? 1 : 0,
          im: rule.important ? 1 : 0,
          mc: rule.matchCase ? 1 : 0,
          pu: rule.popup ? 1 : 0,
          ha: rule.hostAnchor ? 1 : 0,
          sa: rule.startAnchor ? 1 : 0,
          ea: rule.endAnchor ? 1 : 0,
          hk: rule.hostKey || '',
          ne: rule.needle || '',
          re: rule.redirect || '',
          rr: rule.redirectRule || '',
          rw: rule.rewrite || '',
          cs: rule.csp || '',
          tp: rule.thirdParty === null ? 0 : rule.thirdParty ? 1 : -1
        };
        if (rule.isRegex && rule.regex) out.rx = { s: rule.regex.source, f: rule.regex.flags };
        if (rule.isPlain) out.pl = 1;
        if (rule.isSegments) out.sg = rule.segments;
        if (rule.types) out.ty = Array.from(rule.types);
        if (rule.excludedTypes) out.xt = Array.from(rule.excludedTypes);
        if (rule.includeDomains) out.id = rule.includeDomains;
        if (rule.excludeDomains) out.xd = rule.excludeDomains;
        if (rule.sourceKind && rule.sourceKind !== 'wildfire') out.sk = rule.sourceKind;
        if (rule.hash) out.h = rule.hash;
        if (rule.generichide) out.gh = 1;
        if (rule.elemhide) out.eh = 1;
        if (rule.specifichide) out.sh = 1;
        if (rule.removeparam !== null && rule.removeparam !== undefined) out.rp = rule.removeparam;
        if (rule.removeheader) out.rh = rule.removeheader;
        return out;
      };

      const cosmeticByDomain = [];
      this.cosmeticByDomain.forEach((selectors, domain) => cosmeticByDomain.push([domain, selectors]));
      const cosmeticExceptionsByDomain = [];
      this.cosmeticExceptionsByDomain.forEach((selectors, domain) => cosmeticExceptionsByDomain.push([domain, selectors]));
      const proceduralByDomain = [];
      this.proceduralByDomain.forEach((map, domain) => proceduralByDomain.push([domain, Array.from(map.entries())]));
      const proceduralExceptionsByDomain = [];
      this.proceduralExceptionsByDomain.forEach((set, domain) => proceduralExceptionsByDomain.push([domain, Array.from(set)]));

      return {
        v: COMPILED_VERSION,
        cap: this.capabilities,
        n: rules.map(serializeRule),
        c: {
          g: this.genericCosmetic,
          ge: this.genericCosmeticExceptions,
          d: cosmeticByDomain,
          de: cosmeticExceptionsByDomain
        },
        p: {
          g: Array.from(this.genericProcedural.entries()),
          ge: Array.from(this.genericProceduralExceptions),
          d: proceduralByDomain,
          de: proceduralExceptionsByDomain
        },
        s: this.scriptletRules,
        d: this.diagnostics
      };
    }

    loadCompiled(compiled, options) {
      if (!compiled || compiled.v !== COMPILED_VERSION || !Array.isArray(compiled.n)) return false;
      const append = Boolean(options && options.append);
      if (!append) this.reset();
      try {
        compiled.n.forEach(item => {
          if (!item || typeof item.p !== 'string') return;
          const rule = {
            pattern: item.p,
            regex: item.rx ? new RegExp(item.rx.s, item.rx.f) : null,
            isRegex: Boolean(item.rx),
            isPlain: Boolean(item.pl),
            isSegments: Boolean(item.sg),
            segments: item.sg || null,
            hostAnchor: Boolean(item.ha),
            startAnchor: Boolean(item.sa),
            endAnchor: Boolean(item.ea),
            needle: item.ne || '',
            hostKey: item.hk || null,
            isException: Boolean(item.x),
            important: Boolean(item.im),
            types: item.ty ? new Set(item.ty) : null,
            excludedTypes: item.xt ? new Set(item.xt) : null,
            thirdParty: item.tp === 1 ? true : item.tp === -1 ? false : null,
            includeDomains: item.id || null,
            excludeDomains: item.xd || null,
            matchCase: Boolean(item.mc),
            popup: Boolean(item.pu),
            redirect: item.re || '',
            redirectRule: item.rr || '',
            rewrite: item.rw || '',
            csp: item.cs || '',
            generichide: Boolean(item.gh),
            elemhide: Boolean(item.eh),
            specifichide: Boolean(item.sh),
            removeparam: Object.prototype.hasOwnProperty.call(item, 'rp') ? item.rp : null,
            removeheader: item.rh || null,
            sourceKind: item.sk || 'wildfire',
            hash: item.h || ''
          };
          if (rule.removeparam !== null && typeof rule.removeparam === 'string' && rule.removeparam.startsWith('/') && rule.removeparam.endsWith('/') && rule.removeparam.length > 2) {
            try { rule.removeparamRegex = new RegExp(rule.removeparam.slice(1, -1)); } catch (error) { rule.removeparamRegex = null; }
          }
          this._addNetworkRule(rule);
        });

        const c = compiled.c || {};
        (c.g || []).forEach(sel => { if (!this.genericCosmetic.includes(sel)) this.genericCosmetic.push(sel); });
        (c.ge || []).forEach(sel => { if (!this.genericCosmeticExceptions.includes(sel)) this.genericCosmeticExceptions.push(sel); });
        (c.d || []).forEach(([domain, selectors]) => {
          if (!this.cosmeticByDomain.has(domain)) this.cosmeticByDomain.set(domain, []);
          const list = this.cosmeticByDomain.get(domain);
          (selectors || []).forEach(sel => { if (!list.includes(sel)) list.push(sel); });
        });
        (c.de || []).forEach(([domain, selectors]) => {
          if (!this.cosmeticExceptionsByDomain.has(domain)) this.cosmeticExceptionsByDomain.set(domain, []);
          const list = this.cosmeticExceptionsByDomain.get(domain);
          (selectors || []).forEach(sel => { if (!list.includes(sel)) list.push(sel); });
        });
        this.counts.cosmetic = this.genericCosmetic.length + this.genericCosmeticExceptions.length +
          Array.from(this.cosmeticByDomain.values()).reduce((n, a) => n + a.length, 0) +
          Array.from(this.cosmeticExceptionsByDomain.values()).reduce((n, a) => n + a.length, 0);
        if (this.counts.cosmetic > 0) this.capabilities |= CAP.COSMETIC;

        const p = compiled.p || {};
        (p.g || []).forEach(([sel, tree]) => this.genericProcedural.set(sel, tree));
        (p.ge || []).forEach(sel => this.genericProceduralExceptions.add(sel));
        (p.d || []).forEach(([domain, entries]) => {
          if (!this.proceduralByDomain.has(domain)) this.proceduralByDomain.set(domain, new Map());
          const map = this.proceduralByDomain.get(domain);
          (entries || []).forEach(([sel, tree]) => map.set(sel, tree));
        });
        (p.de || []).forEach(([domain, sels]) => {
          if (!this.proceduralExceptionsByDomain.has(domain)) this.proceduralExceptionsByDomain.set(domain, new Set());
          const set = this.proceduralExceptionsByDomain.get(domain);
          (sels || []).forEach(sel => set.add(sel));
        });
        if (this.genericProcedural.size > 0 || this.proceduralByDomain.size > 0) this.capabilities |= CAP.COSMETIC | CAP.PROCEDURAL;

        const scriptlets = Array.isArray(compiled.s) ? compiled.s : [];
        if (append) this.scriptletRules.push(...scriptlets);
        else this.scriptletRules = scriptlets.slice();
        this.counts.scriptlets = this.scriptletRules.length;
        if (this.counts.scriptlets > 0) this.capabilities |= CAP.SCRIPTLET;

        if (Array.isArray(compiled.d)) {
          this.diagnostics = this.diagnostics.concat(compiled.d);
        }
        // Restore compile-time/global capabilities that may have no surviving rules.
        if (typeof compiled.cap === 'number') this.capabilities |= compiled.cap;
        return true;
      } catch (error) {
        this.reset();
        return false;
      }
    }

    _addCosmetic(parsed) {
      const map = parsed.isException ? this.cosmeticExceptionsByDomain : this.cosmeticByDomain;
      const generic = parsed.isException ? this.genericCosmeticExceptions : this.genericCosmetic;

      if (!parsed.domains.length) {
        if (!generic.includes(parsed.selector)) generic.push(parsed.selector);
        return;
      }
      parsed.domains.forEach(domain => {
        if (!map.has(domain)) map.set(domain, []);
        const list = map.get(domain);
        if (!list.includes(parsed.selector)) list.push(parsed.selector);
      });
    }

    _addProcedural(parsed) {
      const map = parsed.isException ? this.proceduralExceptionsByDomain : this.proceduralByDomain;

      if (!parsed.domains.length) {
        if (parsed.isException) this.genericProceduralExceptions.add(parsed.selector);
        else this.genericProcedural.set(parsed.selector, parsed.procedural);
        return;
      }
      parsed.domains.forEach(domain => {
        if (parsed.isException) {
          if (!map.has(domain)) map.set(domain, new Set());
          map.get(domain).add(parsed.selector);
        } else {
          if (!map.has(domain)) map.set(domain, new Map());
          map.get(domain).set(parsed.selector, parsed.procedural);
        }
      });
    }

    _ruleApplies(rule, url, type, docHost, targetHost, allowDocument) {
      // Request filtering needs an explicit $document rule for navigations;
      // response-header filtering has no navigation to cancel, so it applies
      // to the main document as well.
      if (type === 'document' && !allowDocument &&
        !(rule.types && rule.types.has('document'))) return false;
      if (rule.popup && type !== 'document') return false;
      if (rule.types && !rule.types.has(type)) return false;
      if (rule.excludedTypes && rule.excludedTypes.has(type)) return false;

      if (rule.thirdParty !== null) {
        const thirdParty = Boolean(docHost && targetHost &&
          this._registrable(docHost) !== this._registrable(targetHost));
        if (thirdParty !== rule.thirdParty) return false;
      }

      if (rule.includeDomains || rule.excludeDomains) {
        if (!docHost) return false;
        if (rule.includeDomains && !rule.includeDomains.some(domain => domainMatches(docHost, domain))) return false;
        if (rule.excludeDomains && rule.excludeDomains.some(domain => domainMatches(docHost, domain))) return false;
      }

      if (rule.isPlain) return plainPatternMatches(rule, url);
      if (rule.isSegments) return segmentsPatternMatches(rule, url);
      if (rule.isRegex && url.length > MAX_REGEX_URL_LENGTH) return false;
      return rule.regex ? rule.regex.test(url) : false;
    }

    _candidates(url, targetHost, skip) {
      const gen = ++this._seenGen;
      if (gen > 0x7ffffffe) {
        this._seen = [];
        this._seenGen = 1;
      }
      const seen = this._seen;
      const candidates = [];
      let needsSort = false;
      let lastOrder = -1;

      const addRule = rule => {
        const order = rule.order;
        if (seen[order] === gen) return;
        seen[order] = gen;
        if (skip && skip(rule)) return;
        if (order < lastOrder) needsSort = true;
        lastOrder = order;
        candidates.push(rule);
      };

      this.unindexedRules.forEach(addRule);
      parentHosts(targetHost).forEach(host => {
        const bucket = this.hostRules.get(host);
        if (bucket) bucket.forEach(addRule);
      });
      urlTokens(url).forEach(token => {
        const bucket = this.tokenRules.get(token);
        if (bucket) bucket.forEach(addRule);
      });

      if (needsSort) candidates.sort((a, b) => a.order - b.order);
      return candidates;
    }

    _matchFrom(candidates, url, type, docHost, targetHost) {
      const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost);
      let blocker = null;
      let important = null;
      let exception = null;
      // Exception normally wins over blockers, but an $important blocker overrides
      // exceptions (uBO/adblock-rust semantics). Scan all candidates in load order.
      candidates.some(rule => {
        if (!applies(rule)) return false;
        if (rule.isException) {
          if (!exception) exception = rule;
          return false;
        }
        if (rule.important && !important) important = rule;
        if (!blocker) blocker = rule;
        return Boolean(important && exception);
      });
      if (important) {
        const rewrite = important.rewrite ? { alias: important.rewrite } : null;
        const alias = !rewrite && (important.redirectRule || important.redirect);
        const redirect = alias
          ? { alias, captures: captureGroups(important, url) }
          : null;
        return { blocked: true, rule: important, exception: null, redirect, rewrite, important: true };
      }
      if (exception) return { blocked: false, exception, redirect: null, rewrite: null, important: false };

      const rewrite = blocker && blocker.rewrite ? { alias: blocker.rewrite } : null;
      const alias = !rewrite && blocker && (blocker.redirectRule || blocker.redirect);
      const redirect = alias
        ? { alias, captures: captureGroups(blocker, url) }
        : null;
      return { blocked: Boolean(blocker), rule: blocker, exception: null, redirect, rewrite, important: false };
    }

    matchRequest(url, type, documentUrl) {
      const targetHost = hostnameOf(url);
      const docHost = hostnameOf(documentUrl);
      // Navigations are never rewritten, so rewrite rules are not blockers
      // for documents - otherwise a $document rewrite would cancel the page.
      // $popup rules are handled by matchPopup(), where the source document is
      // known; evaluating them here would misapply $domain scoping.
      const skip = rule => rule.csp || rule.popup || (type === 'document' && rule.rewrite);
      const candidates = this._candidates(url, targetHost, skip);
      return this._matchFrom(candidates, url, type, docHost, targetHost);
    }

    matchPopup(url, sourceUrl) {
      const targetHost = hostnameOf(url);
      const sourceHost = hostnameOf(sourceUrl);
      const skip = rule => !rule.popup || rule.csp || rule.rewrite || rule.redirect;
      const candidates = this._candidates(url, targetHost, skip);
      return this._matchFrom(candidates, url, 'document', sourceHost, targetHost);
    }

    // Used by webRequest.onHeadersReceived. Any applicable exception wins, and
    // every remaining curated directive is added to the response. CSP rules
    // never cancel a request, so they are excluded from matchRequest().
    matchCsp(url, type, documentUrl) {
      const targetHost = hostnameOf(url);
      const docHost = hostnameOf(documentUrl);
      const candidates = this._candidates(url, targetHost);
      const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost, true);
      if (candidates.some(rule => rule.isException && applies(rule))) {
        return { directives: [], exception: true };
      }

      const directives = candidates
        .filter(rule => !rule.isException && rule.csp && applies(rule))
        .map(rule => this._cspDirective(rule.csp))
        .filter((directive, index, all) => directive && all.indexOf(directive) === index);
      return { directives, exception: false };
    }

    // Plain data for the content-side registry. Host scoping and exceptions
    // are resolved there against location.hostname, so a single document_start
    // registration can serve every page.
    getScriptletPayload() {
      return this.scriptletRules.map(rule => ({
        alias: rule.alias,
        args: rule.args.slice(),
        domains: rule.domains.slice(),
        isException: rule.isException,
        syntax: rule.syntax || 'ubo'
      }));
    }

    getCosmetic(host) {
      const hosts = parentHosts(host);
      const selectors = new Set(this.genericCosmetic);
      const exceptions = new Set(this.genericCosmeticExceptions);

      hosts.forEach(name => {
        const found = this.cosmeticByDomain.get(name);
        if (found) found.forEach(selector => selectors.add(selector));
        const excepted = this.cosmeticExceptionsByDomain.get(name);
        if (excepted) excepted.forEach(selector => exceptions.add(selector));
      });
      exceptions.forEach(selector => selectors.delete(selector));
      return Array.from(selectors);
    }

    getProcedural(host) {
      const selected = new Map(this.genericProcedural);
      const exceptions = new Set(this.genericProceduralExceptions);
      parentHosts(host).forEach(name => {
        const found = this.proceduralByDomain.get(name);
        if (found) found.forEach((tree, source) => selected.set(source, tree));
        const excepted = this.proceduralExceptionsByDomain.get(name);
        if (excepted) excepted.forEach(source => exceptions.add(source));
      });
      exceptions.forEach(source => selected.delete(source));
      return Array.from(selected.values());
    }
  }

  global.FilterEngine = FilterEngine;
  global.mapResourceType = function mapResourceType(type) {
    return normalizeType(type) || 'other';
  };
})(this);

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
 *   $csp=alias                add a curated WildFire CSP response header
 *   example.com##.ad          element hiding (cosmetic)
 *   example.com##.ad:has-text("x")  procedural cosmetic rule
 *   example.com##.ad:contains("x")  subtree text procedural rule
 *   example.com##.ad:nth-ancestor(2) hide an ancestor of a match
 *   example.com#@#.ad         cosmetic exception
 *
 * Deliberately not supported: $rewrite, and filter-supplied header values.
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

  const RESOURCE_TYPES = new Set([
    'document', 'subdocument', 'script', 'image', 'imageset', 'stylesheet',
    'object', 'xmlhttprequest', 'font', 'media', 'websocket',
    'ping', 'csp', 'manifest', 'other'
  ]);

  const TYPE_ALIASES = {
    main_frame: 'document',
    document: 'document',
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

  function urlTokens(url) {
    const text = String(url || '').toLowerCase();
    if (text.length < TOKEN_LENGTH) return [];
    return Array.from(new Set(
      Array.from({ length: text.length - TOKEN_LENGTH + 1 },
        (_, index) => text.slice(index, index + TOKEN_LENGTH))
    ));
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

  function patternToRegex(pattern, matchCase) {
    let body = pattern.trim();
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

    const source = Array.from(body, ch => {
      if (ch === '*') return '[\\s\\S]*';
      if (ch === '^') return '(?:[^a-zA-Z0-9._-]|$)';
      return escapeChar(ch);
    }).join('');

    let prefix = '';
    if (hostAnchor) prefix = '(?:^|[a-z]+:\\/\\/)(?:[^\\/?#:]+\\.)?';
    else if (startAnchor) prefix = '^';

    const suffix = endAnchor ? '$' : '';
    return new RegExp(prefix + source + suffix, matchCase ? '' : 'i');
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
    if (!rule.isRegex || url.length > MAX_REGEX_URL_LENGTH) return [];
    const match = rule.regex.exec(url);
    return match ? match.slice(1) : [];
  }

  function compilePattern(pattern, matchCase, flagText) {
    if (!pattern.startsWith('/')) {
      return { regex: patternToRegex(pattern, matchCase) };
    }
    const match = pattern.match(/^\/([\s\S]*)\/$/);
    if (!match) return { error: 'malformed regex filter' };

    const flags = Array.from(new Set((matchCase
      ? String(flagText || '').replace(/i/g, '')
      : String(flagText || '') + 'i').split(''))).join('');
    if (/[^imsu]/.test(flags)) return { error: 'unsupported regex flag' };

    const safety = regexSafetyError(match[1]);
    if (safety) return { error: safety };

    try {
      return { regex: new RegExp(match[1], flags), isRegex: true };
    } catch (error) {
      return { error: 'invalid regex: ' + error.message };
    }
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
      redirect: '',
      redirectRule: '',
      csp: ''
    };

    if (optionText) {
      optionText.split(',').forEach(raw => {
        const option = raw.trim();
        if (!option) return;

        if (option === 'popup') {
          options.popup = true;
          if (!options.types) options.types = new Set();
          options.types.add('document');
        } else if (option === 'match-case') {
          options.matchCase = true;
        } else if (option === 'third-party') {
          options.thirdParty = true;
        } else if (option === '~third-party') {
          options.thirdParty = false;
        } else if (option.startsWith('redirect-rule=')) {
          options.redirectRule = option.slice('redirect-rule='.length).trim().toLowerCase();
        } else if (option.startsWith('redirect=')) {
          options.redirect = option.slice('redirect='.length).trim().toLowerCase();
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

    return Object.assign({
      pattern,
      regex: compiled.regex,
      isRegex: Boolean(compiled.isRegex),
      hostKey: compiled.isRegex ? null : hostKeyFromPattern(pattern),
      isException
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
    constructor(getDomain, resolveCsp) {
      this.getDomain = typeof getDomain === 'function' ? getDomain : null;
      // Injected so this library stays browser-free and unit-testable. Without
      // a resolver, $csp rules are rejected instead of weakening a response.
      this.resolveCsp = typeof resolveCsp === 'function' ? resolveCsp : null;
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
      this.cosmeticByDomain = new Map();
      this.cosmeticExceptionsByDomain = new Map();
      this.genericCosmetic = [];
      this.genericCosmeticExceptions = [];
      this.proceduralByDomain = new Map();
      this.proceduralExceptionsByDomain = new Map();
      this.genericProcedural = new Map();
      this.genericProceduralExceptions = new Set();
      this.rejectedCosmetic = [];
      this.counts = { network: 0, exceptions: 0, cosmetic: 0, csp: 0 };
    }

    // Generic rules are indexed by a few 4-character tokens from every literal
    // chunk. Any matching URL contains those chunks, so at least one token is
    // found; exact regexes still decide the final match.
    _indexRule(rule) {
      const chunks = rule.pattern
        .replace(/[|\\]/g, '')
        .split(/[*\^]/)
        .map(chunk => chunk.trim().toLowerCase())
        .filter(chunk => chunk.length >= TOKEN_LENGTH);
      if (!chunks.length) return false;

      chunks.forEach(chunk => {
        const last = chunk.length - TOKEN_LENGTH;
        Array.from(new Set([0, Math.floor(last / 2), last]
          .map(index => chunk.slice(index, index + TOKEN_LENGTH))))
          .forEach(token => {
            if (!this.tokenRules.has(token)) this.tokenRules.set(token, []);
            this.tokenRules.get(token).push(rule);
          });
      });
      return true;
    }

    load(text) {
      this.reset();
      const lines = String(text == null ? '' : text).split(/\r?\n/);

      lines.forEach(raw => {
        const line = raw.trim();
        if (!line || line.startsWith('!')) return;
        if (line.startsWith('#') && line.indexOf('##') === -1 && line.indexOf('#@#') === -1) return;

        if (line.indexOf('##') !== -1 || line.indexOf('#@#') !== -1) {
          const cosmetic = parseCosmetic(line);
          if (!cosmetic) return;
          if (cosmetic.error) {
            this.rejectedCosmetic.push({ line, reason: cosmetic.error });
            return;
          }
          this.counts.cosmetic++;
          if (cosmetic.procedural) this._addProcedural(cosmetic);
          else this._addCosmetic(cosmetic);
          return;
        }

        const rule = parseNetwork(line);
        if (!rule) return;
        if (rule.error) {
          this.rejectedRegex.push({ line, reason: rule.error });
          return;
        }
        // A bad alias must not silently become a request-blocking rule.
        if (rule.csp) {
          if (!this._cspDirective(rule.csp)) {
            this.rejectedCsp.push({ line, reason: 'unknown CSP alias: ' + rule.csp });
            return;
          }
          this.counts.csp++;
        }
        rule.order = this.counts.network++;
        if (rule.isException) this.counts.exceptions++;

        if (rule.hostKey) {
          if (!this.hostRules.has(rule.hostKey)) this.hostRules.set(rule.hostKey, []);
          this.hostRules.get(rule.hostKey).push(rule);
        } else if (rule.isRegex || !this._indexRule(rule)) {
          this.unindexedRules.push(rule);
        }
      });
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

      if (rule.isRegex && url.length > MAX_REGEX_URL_LENGTH) return false;
      return rule.regex.test(url);
    }

    _candidates(url, targetHost) {
      const candidates = new Set(this.unindexedRules);
      parentHosts(targetHost).forEach(host =>
        (this.hostRules.get(host) || []).forEach(rule => candidates.add(rule)));
      urlTokens(url).forEach(token =>
        (this.tokenRules.get(token) || []).forEach(rule => candidates.add(rule)));
      return Array.from(candidates).sort((a, b) => a.order - b.order);
    }

    _matchFrom(candidates, url, type, docHost, targetHost) {
      const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost);
      const exception = candidates.find(rule => rule.isException && applies(rule));
      if (exception) return { blocked: false, exception, redirect: null };

      const blocker = candidates.find(rule => !rule.isException && applies(rule)) || null;
      const alias = blocker && (blocker.redirectRule || blocker.redirect);
      const redirect = alias
        ? { alias, captures: captureGroups(blocker, url) }
        : null;
      return { blocked: Boolean(blocker), rule: blocker, exception: null, redirect };
    }

    matchRequest(url, type, documentUrl) {
      const targetHost = hostnameOf(url);
      const docHost = hostnameOf(documentUrl);
      const candidates = this._candidates(url, targetHost).filter(rule => !rule.csp);
      return this._matchFrom(candidates, url, type, docHost, targetHost);
    }

    matchPopup(url, sourceUrl) {
      const targetHost = hostnameOf(url);
      const sourceHost = hostnameOf(sourceUrl);
      const candidates = this._candidates(url, targetHost)
        .filter(rule => rule.popup && !rule.csp);
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

/* WildFire filter engine: network pattern compilation and plain/segment/regex matching.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { MAX_REGEX_LENGTH, MAX_REGEX_GROUPS, MAX_REGEX_QUANTIFIERS, MAX_REGEX_URL_LENGTH, NETWORK_OPTION_NAMES, splitLiteralPattern, escapeChar } = NS;

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

  // Option values may contain commas inside a `/regex/`; keep those tokens
  // intact so parsing and delimiter detection see the same option boundaries.
  // The scanner mutates one small state object instead of concatenating a
  // growing string for every character.
  function scanOptionState(state, ch) {
    if (state.token !== null && state.token !== undefined) return state;
    if (state.escaped) {
      state.part += ch;
      state.escaped = false;
      state.prev = ch;
      return state;
    }
    if (ch === '\\') {
      state.part += ch;
      state.escaped = true;
      state.prev = ch;
      return state;
    }
    if (state.inRegex) {
      state.part += ch;
      if (state.inClass) {
        if (ch === ']') state.inClass = false;
      } else if (ch === '[') {
        state.inClass = true;
      } else if (ch === '/') {
        state.inRegex = false;
      }
      state.prev = ch;
      return state;
    }
    if (ch === ',') {
      if (state.part !== '') {
        if (state.parts) state.parts.push(state.part);
        else state.token = state.part;
      }
      state.part = '';
      state.prev = ch;
      return state;
    }
    state.part += ch;
    if (ch === '/' && state.prev === '=') state.inRegex = true;
    state.prev = ch;
    return state;
  }

  function newOptionState(withParts) {
    return {
      part: '', parts: withParts ? [] : null, token: null,
      escaped: false, inRegex: false, inClass: false, prev: ''
    };
  }

  function splitOptionList(text) {
    const state = Array.prototype.reduce.call(String(text || ''), scanOptionState, newOptionState(true));
    state.parts.push(state.part);
    return state.parts.filter(part => part !== '');
  }

  function firstOptionToken(text, start) {
    const state = Array.prototype.reduce.call(
      String(text || '').slice(start + 1), scanOptionState, newOptionState(false));
    return state.token === null ? state.part : state.token;
  }

  function knownOptionPrefix(token) {
    const match = /^~?([a-z0-9][a-z0-9-]*)(?:=|,|$)/i.exec(String(token || '').trim());
    return Boolean(match && NETWORK_OPTION_NAMES.has(match[1].toLowerCase()));
  }

  // Find the first `$` that starts a real option list. Escaped `\$` is data,
  // and a `$` followed by non-option data stays in the URL pattern. Segment
  // boundaries avoid rebuilding the whole output string per character.
  function plainPatternSplit(text) {
    const source = String(text || '');
    const scan = Array.prototype.reduce.call(source, (state, ch, index) => {
      if (ch === '\\') {
        state.slashes += 1;
        state.outLength += 1;
        return state;
      }
      if (ch === '$') {
        const escaped = state.slashes % 2 === 1;
        state.parts.push(source.slice(state.segmentStart, escaped ? index - 1 : index));
        state.parts.push('$');
        state.segmentStart = index + 1;
        if (escaped) {
          // The backslash was counted tentatively but the pair emits one
          // literal `$`, so the output length is unchanged at this point.
          state.outLength -= 1;
        } else {
          state.outLength += 1;
          state.candidates.push({ raw: index, normalized: state.outLength - 1 });
        }
        state.slashes = 0;
        return state;
      }
      state.slashes = 0;
      state.outLength += 1;
      return state;
    }, { parts: [], candidates: [], slashes: 0, outLength: 0, segmentStart: 0 });
    scan.parts.push(source.slice(scan.segmentStart));
    const out = scan.parts.join('');

    const chosen = scan.candidates.find(candidate =>
      knownOptionPrefix(firstOptionToken(source, candidate.raw)));
    if (chosen) {
      return { pattern: out.slice(0, chosen.normalized), optionText: source.slice(chosen.raw + 1) };
    }
    const fallback = scan.candidates.filter(candidate => {
      const first = firstOptionToken(source, candidate.raw);
      return Boolean(first) && /^~?[a-z][a-z0-9-]*(?:=|$)/i.test(first.trim());
    }).pop();
    return fallback
      ? { pattern: out.slice(0, fallback.normalized), optionText: source.slice(fallback.raw + 1) }
      : { pattern: out, optionText: '' };
  }

  // Data regexes such as $removeparam keep their authored flags and are case
  // sensitive by default; network regexes get the separate `i` default.
  function compileRemoveparamRegex(value) {
    const split = splitLiteralPattern(String(value || ''));
    if (!split.isRegex) return null;
    const flags = String(split.flags || '');
    if (/[^imsu]/.test(flags)) return { error: 'unsupported regex flag' };
    const safety = regexSafetyError(split.pattern);
    if (safety) return { error: safety };
    try {
      return { regex: new RegExp(split.pattern, flags), flags };
    } catch (error) {
      return { error: 'invalid regex: ' + error.message };
    }
  }

  function splitPattern(text) {
    if (!text.startsWith('/')) return plainPatternSplit(text);
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

  function hostAnchorMatches(hosts, hostNeedle, fallback) {
    const candidates = Array.isArray(hosts) && hosts.length ? hosts : [fallback];
    return candidates.some(host => host === hostNeedle || host.endsWith('.' + hostNeedle));
  }

  function plainPatternMatches(rule, url, hosts) {
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
      if (!hostAnchorMatches(hosts, hostNeedle, host)) return false;

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

  function segmentsPatternMatches(rule, url, hosts) {
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
      if (!hostAnchorMatches(hosts, hostNeedle, host)) return false;

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

  Object.assign(NS, { compilePattern, hostKeyFromPattern, regexEndIndex, splitPattern, splitOptionList, compileRemoveparamRegex, regexSafetyError, captureGroups, splitHost, plainPatternMatches, isSeparatorChar, matchSegments, segmentsPatternMatches });
})(this);

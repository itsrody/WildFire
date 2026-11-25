/* WildFire filter engine: hashing, URL/host helpers, tokenization, type normalization.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { TYPE_ALIASES, WORST_TOKENS, BAD_TOKENS, WORST_TOKEN_USAGE, BAD_TOKEN_USAGE, TOKEN_LENGTH } = NS;

  // FNV over string code units without allocating a character array.
  function fnv1a32(text) {
    const h = Array.prototype.reduce.call(String(text || ''), (hash, ch) =>
      Math.imul(hash ^ ch.charCodeAt(0), 16777619), 2166136261);
    return (h >>> 0).toString(16);
  }

  function detectSourceKind(line, syntax) {
    if (syntax === 'adguard') return 'adguard';
    const text = String(line || '');
    if (text.indexOf('#%#') !== -1 || text.indexOf('#@%#') !== -1) return 'adguard';
    if (text.indexOf('##+js(') !== -1 || text.indexOf('#@#+js(') !== -1) return 'ubo';
    if (text.indexOf('#?#') !== -1) return 'abp';
    if (/\$(~?rewrite(?:-rule)?)=/i.test(text)) return 'abp';
    return 'wildfire';
  }

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

  function domainLabels(value) {
    return String(value || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '')
      .split('.').filter(Boolean);
  }

  function validBareHost(value) {
    const key = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!key || key.length > 253 || /[\s*^|/?#\\]/.test(key)) return null;
    const labels = key.split('.');
    if (!labels.length || labels.length > 127) return null;
    const valid = labels.every(label => label.length > 0 && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
    return valid ? key : null;
  }

  function validDomainPattern(value) {
    const key = String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    if (!key) return false;
    if (key === '*') return true;
    const leading = key.startsWith('*.');
    const trailing = key.endsWith('.*');
    if (!key.includes('*')) {
      return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(key);
    }
    if (!leading && !trailing) return false;
    const core = key.slice(leading ? 2 : 0, trailing ? -2 : undefined);
    return Boolean(core) && !core.includes('*') &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(core);
  }

  function domainMatchesPlain(host, domain) {
    const key = String(domain || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    const labels = domainLabels(host);
    if (!labels.length || !validDomainPattern(key)) return false;
    if (key === '*') return true;
    if (!key.includes('*')) return labels.join('.') === key || labels.join('.').endsWith('.' + key);

    const leading = key.startsWith('*.');
    const trailing = key.endsWith('.*');
    const parts = domainLabels(key.slice(leading ? 2 : 0, trailing ? -2 : undefined));
    if (!parts.length) return false;
    const partAt = (index, offset) => labels[index + offset] === parts[offset];
    if (leading && trailing) {
      return labels.some((_, index) =>
        index > 0 && index + parts.length < labels.length &&
        parts.every((part, offset) => partAt(index, offset)));
    }
    if (trailing) {
      return labels.some((_, index) =>
        index + parts.length < labels.length &&
        parts.every((part, offset) => partAt(index, offset)));
    }
    const start = labels.length - parts.length;
    return start > 0 && parts.every((part, offset) => partAt(start, offset));
  }

  function domainMatches(host, domain) {
    const parse = NS.parseHostSelector;
    if (!parse) return domainMatchesPlain(host, domain);
    const selector = parse(domain);
    if (!selector) return false;
    const normalized = String(host || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    if (!normalized) return false;
    const matched = selector.kind === 'regex'
      ? selector.regex.test(normalized)
      : domainMatchesPlain(normalized, selector.value);
    return selector.negated ? !matched : matched;
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

  Object.assign(NS, { fnv1a32, detectSourceKind, normalizeType, escapeChar, hostnameOf, parentHosts, tokenUsage, urlTokens, domainLabels, validBareHost, validDomainPattern, domainMatchesPlain, domainMatches, fallbackRegistrable, splitLiteralPattern });
})(this);

/* WildFire filter engine: hashing, URL/host helpers, tokenization, type normalization.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { TYPE_ALIASES, WORST_TOKENS, BAD_TOKENS, WORST_TOKEN_USAGE, BAD_TOKEN_USAGE, TOKEN_LENGTH } = NS;

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

  Object.assign(NS, { fnv1a32, detectSourceKind, normalizeType, escapeChar, hostnameOf, parentHosts, tokenUsage, urlTokens, domainMatches, fallbackRegistrable, splitLiteralPattern });
})(this);

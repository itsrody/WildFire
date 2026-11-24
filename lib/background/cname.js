/* WildFire - bounded canonical-host cache backed by Firefox DNS. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const DEFAULT_TTL_MS = 60000;
  const NEGATIVE_TTL_MS = 30000;
  const CACHE_LIMIT = 512;

  function normalizeHost(value) {
    const text = String(value || '').trim().toLowerCase();
    const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
    return bare.replace(/^\.+|\.+$/g, '');
  }

  function isIpAddress(host) {
    return /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(host) || host.indexOf(':') !== -1;
  }

  core.createCnameResolver = function createCnameResolver(ctx) {
    const entries = new Map();
    const inFlight = new Map();
    const ttlMs = Math.max(1, Number(ctx.cnameTtlMs) || DEFAULT_TTL_MS);
    const negativeTtlMs = Math.max(1, Number(ctx.cnameNegativeTtlMs) || NEGATIVE_TTL_MS);
    const stats = { lookups: 0, hits: 0, misses: 0, aliases: 0, negatives: 0, errors: 0 };

    function now() {
      return typeof ctx.now === 'function' ? ctx.now() : Date.now();
    }

    function active() {
      return Boolean(ctx.wapiDns && ctx.wapiDns.supported) &&
        Boolean(ctx.state && ctx.state.cnameUncloak !== false);
    }

    function prune() {
      const current = now();
      Array.from(entries.entries())
        .filter(entry => entry[1].expires <= current)
        .forEach(entry => entries.delete(entry[0]));
    }

    function logAlias(alias, canonical) {
      if (!ctx.recordDecision) return;
      try {
        ctx.recordDecision({
          phase: 'cname',
          decision: 'resolved',
          source: 'cname',
          detail: alias + ' -> ' + canonical,
          reason: 'canonical name',
          url: 'https://' + alias + '/',
          host: alias,
          ms: 0
        });
      } catch (error) {
        /* Inspection is best-effort and never changes filtering. */
      }
    }

    function remember(key, canonical, failed) {
      const current = now();
      const ttl = canonical ? ttlMs : negativeTtlMs;
      entries.set(key, { canonical, expires: current + ttl });
      if (canonical) entries.set(canonical, { canonical: '', expires: current + ttl });
      const excess = entries.size - CACHE_LIMIT;
      if (excess > 0) {
        Array.from(entries.keys()).slice(0, excess).forEach(oldest => entries.delete(oldest));
      }
      if (failed) stats.errors += 1;
      else if (canonical) stats.aliases += 1;
      else stats.negatives += 1;
      if (canonical) logAlias(key, canonical);
    }

    function canonicalFor(host) {
      const key = normalizeHost(host);
      if (!key || isIpAddress(key) || !active()) return '';
      const cached = entries.get(key);
      if (cached && cached.expires > now()) {
        stats.hits += 1;
        return cached.canonical || '';
      }
      if (cached) entries.delete(key);
      stats.misses += 1;
      if (!inFlight.has(key)) {
        stats.lookups += 1;
        const task = Promise.resolve()
          .then(() => ctx.wapiDns.resolve(key))
          .then(record => remember(key, normalizeHost(record && record.canonical), Boolean(record && record.error)),
            () => remember(key, '', true));
        inFlight.set(key, task);
        task.then(() => inFlight.delete(key));
      }
      return '';
    }

    function hostsFor(host) {
      const key = normalizeHost(host);
      if (!key) return [];
      const canonical = canonicalFor(key);
      return canonical && canonical !== key ? [key, canonical] : [key];
    }

    function resetStats() {
      Object.keys(stats).forEach(key => { stats[key] = 0; });
      return snapshot();
    }

    function clear() {
      entries.clear();
      inFlight.clear();
      return snapshot();
    }

    function snapshot() {
      prune();
      return {
        supported: Boolean(ctx.wapiDns && ctx.wapiDns.supported),
        enabled: active(),
        entries: entries.size,
        pending: inFlight.size,
        lookups: stats.lookups,
        hits: stats.hits,
        misses: stats.misses,
        aliases: stats.aliases,
        negatives: stats.negatives,
        errors: stats.errors
      };
    }

    prune();
    return { canonicalFor, hostsFor, resetStats, clear, snapshot };
  };
})(this);

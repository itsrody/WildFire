/* WildFire - bounded, local-only request decision logger. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const LOG_LIMIT = 256;
  const URL_LIMIT = 512;
  const DETAIL_LIMIT = 256;

  core.createLogger = function createLogger(ctx) {
    let entries = [];
    let nextId = 1;

    function enabled() {
      return ctx.loggerEnabled === true;
    }

    function describeRule(rule) {
      if (!rule) return null;
      return {
        text: String(rule.raw || rule.pattern || '').slice(0, URL_LIMIT),
        source: String(rule.sourceKind || 'wildfire'),
        hash: String(rule.hash || '')
      };
    }

    function record(entry) {
      if (!enabled() || !entry) return null;
      const source = entry || {};
      const at = typeof ctx.now === 'function' ? ctx.now() : Date.now();
      const url = String(source.url || '').slice(0, URL_LIMIT);
      const host = typeof ctx.safeHost === 'function' ? ctx.safeHost(url) : '';
      const topHost = String(source.topHost || '').slice(0, URL_LIMIT);
      const ms = Number(source.ms);
      const item = {
        id: nextId++,
        at,
        phase: String(source.phase || 'request'),
        decision: String(source.decision || 'allowed'),
        source: String(source.source || 'static').slice(0, DETAIL_LIMIT),
        url,
        host,
        site: host && typeof ctx.siteKey === 'function' ? ctx.siteKey(host) : '',
        topHost,
        topSite: topHost && typeof ctx.siteKey === 'function' ? ctx.siteKey(topHost) : '',
        documentUrl: String(source.documentUrl || '').slice(0, URL_LIMIT),
        type: String(source.type || ''),
        tabId: Number.isFinite(source.tabId) ? source.tabId : null,
        requestId: String(source.requestId || ''),
        rule: describeRule(source.rule),
        detail: String(source.detail || '').slice(0, DETAIL_LIMIT),
        reason: String(source.reason || '').slice(0, DETAIL_LIMIT),
        ms: Number.isFinite(ms) ? Number(Math.max(0, ms).toFixed(3)) : 0
      };
      entries = entries.concat(item);
      if (entries.length > LOG_LIMIT) {
        entries = entries.slice(entries.length - LOG_LIMIT);
      }
      return item;
    }

    function snapshot() {
      return {
        enabled: enabled(),
        limit: LOG_LIMIT,
        entries: entries.slice()
      };
    }

    function clear() {
      entries = [];
      return snapshot();
    }

    function setEnabled(value) {
      ctx.loggerEnabled = Boolean(value);
      return snapshot();
    }

    const logger = {
      get enabled() { return enabled(); },
      get limit() { return LOG_LIMIT; },
      record,
      snapshot,
      clear,
      setEnabled
    };

    return { logger, recordDecision: record };
  };
})(this);

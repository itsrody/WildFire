/* WildFire - local-only request decision inspector. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const INSPECTOR_LIMIT = 256;
  const URL_LIMIT = 512;
  const DETAIL_LIMIT = 256;

  core.createInspector = function createInspector(ctx) {
    let entries = [];
    let nextId = 1;

    function enabled() {
      return ctx.inspectorEnabled === true;
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
      const ms = Number(source.ms);
      const item = {
        id: nextId++,
        at,
        phase: String(source.phase || 'request'),
        decision: String(source.decision || 'allowed'),
        url,
        host,
        site: host && typeof ctx.siteKey === 'function' ? ctx.siteKey(host) : '',
        type: String(source.type || ''),
        tabId: Number.isFinite(source.tabId) ? source.tabId : null,
        rule: describeRule(source.rule),
        detail: String(source.detail || '').slice(0, DETAIL_LIMIT),
        ms: Number.isFinite(ms) ? Number(Math.max(0, ms).toFixed(3)) : 0
      };
      entries = entries.concat(item);
      if (entries.length > INSPECTOR_LIMIT) {
        entries = entries.slice(entries.length - INSPECTOR_LIMIT);
      }
      return item;
    }

    function snapshot() {
      return {
        enabled: enabled(),
        limit: INSPECTOR_LIMIT,
        entries: entries.slice()
      };
    }

    function clear() {
      entries = [];
      return snapshot();
    }

    function setEnabled(value) {
      ctx.inspectorEnabled = Boolean(value);
      return snapshot();
    }

    const inspector = {
      get enabled() { return enabled(); },
      get limit() { return INSPECTOR_LIMIT; },
      record,
      snapshot,
      clear,
      setEnabled
    };

    return { inspector, recordInspection: record };
  };
})(this);

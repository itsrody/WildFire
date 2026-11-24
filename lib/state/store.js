/* WildFire - state persistence wrapper around wapi.storage.local. */
(function (global) {
  'use strict';

  const KEY = 'wildfire.state.v1';

  const SITE_RULE_TYPES = new Set([
    'subdocument', 'script', 'image', 'stylesheet', 'font', 'media',
    'xmlhttprequest', 'websocket', 'ping', 'object', 'other'
  ]);
  const SITE_RULE_ACTIONS = new Set(['allow', 'block']);

  const DEFAULTS = Object.freeze({
    enabled: true,
    blocked: 0,
    blockedBySite: {},
    customFilters: '',
    disabledSites: [],
    siteRules: {},
    blockCspReports: true,
    cspReportAllow: [],
    cnameUncloak: true
  });

  function normalizeSiteCounts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value).reduce((counts, entry) => {
      const site = String(entry[0] || '').trim().toLowerCase();
      const count = Math.floor(Number(entry[1]));
      if (site && Number.isFinite(count) && count > 0) {
        Object.defineProperty(counts, site, {
          value: count, enumerable: true, writable: true, configurable: true
        });
      }
      return counts;
    }, {});
  }

  function normalizeHostList(value) {
    if (!Array.isArray(value)) return [];
    const hosts = value
      .map(host => String(host || '').trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(hosts));
  }

  function normalizeSiteRules(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.keys(value).reduce((rules, rawSite) => {
      const site = String(rawSite || '').trim().toLowerCase();
      const entry = value[rawSite];
      if (!site || !entry || typeof entry !== 'object' || Array.isArray(entry)) return rules;
      const actions = Object.keys(entry).reduce((copy, rawType) => {
        const type = String(rawType || '').trim().toLowerCase();
        const action = String(entry[rawType] || '').trim().toLowerCase();
        if (!SITE_RULE_TYPES.has(type) || !SITE_RULE_ACTIONS.has(action)) return copy;
        Object.defineProperty(copy, type, {
          value: action, enumerable: true, writable: true, configurable: true
        });
        return copy;
      }, {});
      if (!Object.keys(actions).length) return rules;
      Object.defineProperty(rules, site, {
        value: actions, enumerable: true, writable: true, configurable: true
      });
      return rules;
    }, {});
  }

  let storageAdapter = null;
  function wapiLocalStorage() {
    if (storageAdapter) return storageAdapter;
    const wapi = global.WildFireWapi || global.wapi;
    if (!wapi || typeof wapi.create !== 'function') {
      throw new Error('Missing required WildFire API: wapi.storage.local');
    }
    storageAdapter = wapi.create().storage.local;
    return storageAdapter;
  }

  function normalizeState(value) {
    const merged = Object.assign({}, DEFAULTS,
      value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const total = Math.floor(Number(merged.blocked));
    merged.blocked = Number.isFinite(total) && total > 0 ? total : 0;
    merged.blockedBySite = normalizeSiteCounts(merged.blockedBySite);
    merged.siteRules = normalizeSiteRules(merged.siteRules);
    merged.blockCspReports = merged.blockCspReports !== false;
    merged.cspReportAllow = normalizeHostList(merged.cspReportAllow);
    merged.cnameUncloak = merged.cnameUncloak !== false;
    return merged;
  }

  const Store = {
    defaults: DEFAULTS,
    siteRuleTypes: Array.from(SITE_RULE_TYPES),
    siteRuleActions: Array.from(SITE_RULE_ACTIONS),

    async get() {
      const stored = await wapiLocalStorage().get(KEY);
      return normalizeState(stored && stored[KEY]);
    },

    // Write a complete snapshot. Callers mutate their in-memory copy first,
    // then pass it here so parallel writes cannot clobber unrelated fields.
    async save(next) {
      const snapshot = normalizeState(next);
      await wapiLocalStorage().set({ [KEY]: snapshot });
      return snapshot;
    }
  };

  global.WildFireStore = Store;
})(this);

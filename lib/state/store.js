/* WildFire - state persistence wrapper around wapi.storage.local. */
(function (global) {
  'use strict';

  const KEY = 'wildfire.state.v1';
  const DYNAMIC_VERSION = 1;

  const SITE_RULE_TYPES = new Set([
    'subdocument', 'script', 'image', 'stylesheet', 'font', 'media',
    'xmlhttprequest', 'websocket', 'ping', 'object', 'other'
  ]);
  const SITE_RULE_ACTIONS = new Set(['allow', 'block']);
  const DYNAMIC_ACTIONS = new Set(['block', 'noop', 'allow']);
  const DYNAMIC_TYPE_ALIASES = Object.freeze({
    main_frame: 'document',
    sub_frame: 'subdocument',
    frame: 'subdocument',
    css: 'stylesheet',
    xhr: 'xmlhttprequest',
    ws: 'websocket',
    wss: 'websocket',
    object_subrequest: 'object'
  });
  const DYNAMIC_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

  const DEFAULTS = Object.freeze({
    enabled: true,
    blocked: 0,
    blockedBySite: {},
    customFilters: '',
    disabledSites: [],
    siteRules: {},
    dynamic: Object.freeze({ version: DYNAMIC_VERSION, migrated: true, rules: Object.freeze([]) }),
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

  function normalizeDynamicScope(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (raw === '*') return '*';
    return DYNAMIC_HOST.test(raw) ? raw : '';
  }

  function normalizeDynamicType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === '*') return '*';
    const mapped = DYNAMIC_TYPE_ALIASES[raw] || raw;
    return SITE_RULE_TYPES.has(mapped) ? mapped : '';
  }

  function formatDynamicRule(rule) {
    const source = normalizeDynamicScope(rule && rule.source);
    const destination = normalizeDynamicScope(rule && rule.destination);
    const type = normalizeDynamicType(rule && rule.type);
    const action = String(rule && rule.action || '').trim().toLowerCase();
    if (!source || !destination || !type || !DYNAMIC_ACTIONS.has(action)) return '';
    return source + ' ' + destination + ' ' + type + ' ' + action;
  }

  function normalizeDynamicRule(value) {
    const source = normalizeDynamicScope(value && value.source);
    const destination = normalizeDynamicScope(value && value.destination);
    const type = normalizeDynamicType(value && value.type);
    const action = String(value && value.action || '').trim().toLowerCase();
    if (!source || !destination || !type || !DYNAMIC_ACTIONS.has(action)) return null;
    return { source, destination, type, action };
  }

  // Rules are ordered; scope and type identify a decision slot, so a later
  // action replaces an earlier rule without leaving a stale decision.
  function dynamicRuleKey(rule) {
    const formatted = formatDynamicRule(rule);
    return formatted ? formatted.split(' ').slice(0, 3).join(' ') : '';
  }

  function dedupeDynamicRules(rules) {
    const seen = new Set();
    return rules.slice().reverse().filter(rule => {
      const key = dynamicRuleKey(rule);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).reverse();
  }

  function normalizeDynamicRules(value) {
    if (!Array.isArray(value)) return [];
    return dedupeDynamicRules(value
      .map(rule => normalizeDynamicRule(rule))
      .filter(Boolean));
  }

  function siteRulesToDynamicRules(value) {
    const legacy = normalizeSiteRules(value);
    return Object.keys(legacy).reduce((rules, site) => {
      SITE_RULE_TYPES.forEach(type => {
        const action = legacy[site][type];
        if (!action) return;
        rules.push({ source: site, destination: '*', type, action });
      });
      return rules;
    }, []);
  }

  function normalizeDynamic(value, siteRules) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rules = normalizeDynamicRules(source.rules);
    const migrated = source.migrated === true;
    return {
      version: DYNAMIC_VERSION,
      migrated: true,
      rules: migrated ? rules : dedupeDynamicRules(
        siteRulesToDynamicRules(siteRules).concat(rules))
    };
  }

  function parseDynamicRules(text) {
    const rules = [];
    const errors = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((raw, index) => {
      const line = String(raw || '').trim();
      if (!line || line.charAt(0) === '#') return;
      const parts = line.split(/\s+/);
      if (parts.length !== 4) {
        errors.push({ line: index + 1, text: line.slice(0, 256),
          message: 'Expected source destination type action.' });
        return;
      }
      const rule = normalizeDynamicRule({
        source: parts[0], destination: parts[1], type: parts[2], action: parts[3]
      });
      if (!rule) {
        errors.push({ line: index + 1, text: line.slice(0, 256),
          message: 'Invalid source, destination, type, or action.' });
        return;
      }
      rules.push(rule);
    });
    return { rules: dedupeDynamicRules(rules), errors };
  }

  function formatDynamicRules(rules) {
    return normalizeDynamicRules(rules)
      .map(rule => formatDynamicRule(rule))
      .join('\n');
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
    const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const merged = Object.assign({}, DEFAULTS, stored);
    if (!Object.prototype.hasOwnProperty.call(stored, 'dynamic')) {
      merged.dynamic = Object.assign({}, DEFAULTS.dynamic, { migrated: false, rules: [] });
    }
    const total = Math.floor(Number(merged.blocked));
    merged.blocked = Number.isFinite(total) && total > 0 ? total : 0;
    merged.blockedBySite = normalizeSiteCounts(merged.blockedBySite);
    merged.siteRules = normalizeSiteRules(merged.siteRules);
    merged.dynamic = normalizeDynamic(merged.dynamic, merged.siteRules);
    merged.blockCspReports = merged.blockCspReports !== false;
    merged.cspReportAllow = normalizeHostList(merged.cspReportAllow);
    merged.cnameUncloak = merged.cnameUncloak !== false;
    return merged;
  }

  const Store = {
    defaults: DEFAULTS,
    siteRuleTypes: Array.from(SITE_RULE_TYPES),
    siteRuleActions: Array.from(SITE_RULE_ACTIONS),
    dynamicVersion: DYNAMIC_VERSION,
    dynamicActions: Array.from(DYNAMIC_ACTIONS),
    normalizeState,
    normalizeDynamicRules,
    siteRulesToDynamicRules,
    parseDynamicRules,
    formatDynamicRule,
    formatDynamicRules,

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

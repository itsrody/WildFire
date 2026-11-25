/* WildFire - shared helpers for the Firefox-native background controller. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});

  core.SITE_RULE_TYPES = Object.freeze([
    'subdocument', 'script', 'image', 'stylesheet', 'font', 'media',
    'xmlhttprequest', 'websocket', 'ping', 'object', 'other'
  ]);
  core.DYNAMIC_IGNORED_TYPES = new Set(['document', 'popup']);

  const DIAGNOSTIC_PHASES = [
    'request', 'dynamic', 'csp', 'removeparam',
    'removeheader-request', 'removeheader-response'
  ];

  // ETP block reasons are internal error strings. They are observed locally for
  // diagnostics only: never folded into WildFire's blocked counters or state.
  const ETP_BLOCK_ERRORS = new Set([
    'NS_ERROR_MALWARE_URI',
    'NS_ERROR_PHISHING_URI',
    'NS_ERROR_TRACKING_URI',
    'NS_ERROR_UNWANTED_URI',
    'NS_ERROR_BLOCKED_URI',
    'NS_ERROR_HARMFUL_URI',
    'NS_ERROR_FINGERPRINTING',
    'NS_ERROR_CRYPTOMINING_URI',
    'NS_ERROR_SOCIALTRACKING_URI'
  ]);
  const ETP_CLASSIFICATION_FLAGS = new Set([
    'fingerprinting', 'fingerprinting_content',
    'cryptomining', 'cryptomining_content',
    'tracking', 'tracking_ad', 'tracking_analytics', 'tracking_social',
    'tracking_content', 'emailtracking', 'emailtracking_content',
    'any_basic_tracking', 'any_strict_tracking', 'any_social_tracking'
  ]);
  const DIAGNOSTIC_SAMPLE_LIMIT = 64;

  function emptyPhaseStats() {
    return DIAGNOSTIC_PHASES.reduce((stats, phase) => {
      stats[phase] = {
        calls: 0, totalMs: 0, maxMs: 0, candidates: 0, regexEvaluations: 0, cacheHits: 0
      };
      return stats;
    }, {});
  }

  core.createHelpers = function createHelpers(ctx) {
    function safeHost(url) {
      try {
        return new URL(String(url)).hostname.toLowerCase();
      } catch (error) {
        return '';
      }
    }

    function siteDisabled(host) {
      if (!host) return false;
      const list = Array.isArray(ctx.state.disabledSites) ? ctx.state.disabledSites : [];
      return list.some(site => host === site || host.endsWith('.' + site));
    }

    function parseHostList(value) {
      const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
      return Array.from(new Set(raw.map(entry => String(entry || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0])
        .filter(Boolean)));
    }

    function hostMatchesList(host, list) {
      if (!host) return false;
      const hosts = Array.isArray(list) ? list : [];
      return hosts.some(entry => host === entry || host.endsWith('.' + entry));
    }

    // "Site" means registrable domain, so subdomains share one counter. Firefox
    // resolves the public suffix once here; the engine uses the same resolver.
    function siteKey(host) {
      const alias = String(host || '').trim().toLowerCase().replace(/\.$/, '');
      const clean = ctx.cname ? ctx.cname.canonicalFor(alias) || alias : alias;
      return clean ? ctx.registrableDomain(clean) || clean : '';
    }

    function countForSite(site) {
      const key = siteKey(site) || String(site || '').toLowerCase();
      const counts = ctx.state.blockedBySite && typeof ctx.state.blockedBySite === 'object'
        ? ctx.state.blockedBySite : {};
      const count = Number(counts[key]);
      return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    }

    // Count against the tab's top-level site, not an embedded frame's document.
    function countHostFor(details, host) {
      return safeHost(ctx.pageStore.topUrlForTab(details.tabId)) ||
        ctx.pageStore.topHostForTab(details.tabId) || host;
    }

    function siteRulesFor(site) {
      const key = siteKey(site) || String(site || '').trim().toLowerCase();
      const rules = ctx.state.siteRules && typeof ctx.state.siteRules === 'object'
        ? ctx.state.siteRules[key] : null;
      if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return {};
      return core.SITE_RULE_TYPES.reduce((copy, type) => {
        const action = rules[type];
        if (action === 'allow' || action === 'block') copy[type] = action;
        return copy;
      }, {});
    }

    function storeApi() {
      return ctx.globals.WildFireStore;
    }

    function dynamicState() {
      const value = ctx.state.dynamic;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return {
          version: 1,
          migrated: value.migrated === true,
          rules: value.rules || []
        };
      }
      return {
        version: 1,
        migrated: false,
        rules: storeApi()
          ? storeApi().siteRulesToDynamicRules(ctx.state.siteRules) : []
      };
    }

    function copyDynamicRule(rule) {
      if (!rule) return null;
      return {
        source: String(rule.source || '').toLowerCase(),
        destination: String(rule.destination || '').toLowerCase(),
        type: String(rule.type || '').toLowerCase(),
        action: String(rule.action || '').toLowerCase(),
        temporary: rule.temporary === true
      };
    }

    function normalizedDynamicRules(rules) {
      if (!storeApi || !storeApi()) return [];
      return storeApi().normalizeDynamicRules(rules).map(copyDynamicRule);
    }

    function dynamicTemporaryRules() {
      return Array.isArray(ctx.dynamicTemporary) ? ctx.dynamicTemporary : [];
    }

    // Persisted rules are versioned state; temporary rules stay in memory and
    // disappear on restart unless explicitly promoted.
    function dynamicRules() {
      const persisted = dynamicState().rules;
      return normalizedDynamicRules(persisted.concat(dynamicTemporaryRules()
        .map(rule => Object.assign({}, rule, { temporary: true }))));
    }

    function dynamicRulesFor(site) {
      const key = siteKey(site) || String(site || '').trim().toLowerCase();
      return dynamicRules()
        .filter(rule => rule.source === key || rule.source === '*')
        .map(copyDynamicRule);
    }

    function dynamicScopeMatches(scope, hosts) {
      if (scope === '*') return true;
      return hosts.some(host => Boolean(host) &&
        (host === scope || host.endsWith('.' + scope)));
    }

    function dynamicScore(rule) {
      return (rule.source === '*' ? 0 : 4) +
        (rule.destination === '*' ? 0 : 2) +
        (rule.type === '*' ? 0 : 1);
    }

    function dynamicDecision(sourceHost, destinationHosts, type) {
      const source = siteKey(sourceHost) || String(sourceHost || '').trim().toLowerCase();
      const normalizedType = String(type || '').toLowerCase();
      if (!source || core.DYNAMIC_IGNORED_TYPES.has(normalizedType)) return null;
      const sourceHosts = [String(sourceHost || '').trim().toLowerCase(), source];
      const hosts = Array.from(new Set(
        (Array.isArray(destinationHosts) ? destinationHosts : [destinationHosts])
          .map(host => String(host || '').trim().toLowerCase())
          .filter(Boolean)));
      return ctx.measuredDynamic(() => dynamicRules().reduce((best, rule, index) => {
        if (rule.action !== 'block' && rule.action !== 'noop' && rule.action !== 'allow') {
          return best;
        }
        if (rule.type !== '*' && rule.type !== normalizedType) return best;
        if (!dynamicScopeMatches(rule.source, sourceHosts)) return best;
        if (!dynamicScopeMatches(rule.destination, hosts)) return best;
        const score = dynamicScore(rule);
        if (!best || score >= best.score) {
          return Object.assign({}, rule, { score, order: index });
        }
        return best;
      }, null));
    }

    function dynamicSnapshot() {
      const state = dynamicState();
      const persisted = normalizedDynamicRules(state.rules);
      const temporary = normalizedDynamicRules(dynamicTemporaryRules()
        .map(rule => Object.assign({}, rule, { temporary: true })));
      return {
        version: state.version,
        persisted,
        temporary,
        rules: persisted.concat(temporary),
        text: storeApi() ? storeApi().formatDynamicRules(persisted) : ''
      };
    }

    async function setDynamicRules(rules) {
      const next = Object.assign({}, dynamicState(), {
        version: 1,
        migrated: true,
        rules: normalizedDynamicRules(rules)
      });
      return ctx.persist({ dynamic: next });
    }

    async function addDynamicRule(rule, persist) {
      const normalized = normalizedDynamicRules([rule])[0];
      if (!normalized) return null;
      if (persist === true) {
        const next = dynamicState().rules.concat([normalized]);
        await setDynamicRules(next);
        return copyDynamicRule(normalized);
      }
      const next = dynamicTemporaryRules().concat([normalized]);
      ctx.dynamicTemporary = normalizedDynamicRules(next);
      await broadcastState();
      return copyDynamicRule(normalized);
    }

    function dynamicRuleKey(rule) {
      const source = String(rule && rule.source || '').trim().toLowerCase();
      const destination = String(rule && rule.destination || '').trim().toLowerCase();
      const type = String(rule && rule.type || '').trim().toLowerCase();
      const action = String(rule && rule.action || '').trim().toLowerCase();
      return source + '|' + destination + '|' + type + '|' + action;
    }

    async function clearDynamicRules(scope, site) {
      const key = site ? siteKey(site) || String(site).trim().toLowerCase() : '';
      const keep = rule => {
        if (key && rule.source !== key) return true;
        if (scope === 'temporary') return rule.temporary !== true;
        if (scope === 'persisted') return rule.temporary === true;
        return false;
      };
      const persisted = dynamicState().rules.filter(keep);
      const temporary = dynamicTemporaryRules().filter(keep);
      const changed = persisted.length !== dynamicState().rules.length ||
        temporary.length !== dynamicTemporaryRules().length;
      ctx.dynamicTemporary = temporary;
      if (!changed) return dynamicSnapshot();
      await setDynamicRules(persisted);
      return dynamicSnapshot();
    }

    async function persistDynamicRules() {
      const persisted = dynamicState().rules.concat(dynamicTemporaryRules());
      const next = normalizedDynamicRules(persisted);
      ctx.dynamicTemporary = [];
      await setDynamicRules(next);
      return dynamicSnapshot();
    }

    async function setMyRules(text) {
      const parsed = storeApi()
        ? storeApi().parseDynamicRules(text) : { rules: [], errors: [] };
      if (parsed.errors.length) return { ok: false, errors: parsed.errors };
      await setDynamicRules(parsed.rules);
      return { ok: true, errors: [], dynamic: dynamicSnapshot() };
    }

    function formatCount(value) {
      if (value < 1000) return String(value);
      if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 'k';
      return (value / 1000000).toFixed(1) + 'm';
    }

    function setBadgeText(options) {
      ctx.wapiAction.setBadgeText(options);
    }

    function setBadgeForTab(tabId, site) {
      const key = site || ctx.pageStore.siteForTab(tabId) || '';
      setBadgeText({
        text: ctx.state.enabled && key ? formatCount(countForSite(key)) : '',
        tabId
      });
    }

    async function refreshActiveBadge() {
      const tabs = await ctx.wapi.tabs.query({ active: true, currentWindow: true });
      const tab = Array.isArray(tabs) ? tabs[0] : null;
      if (!tab) {
        setBadgeText({ text: '' });
        return;
      }
      const url = tab.pendingUrl || tab.url || '';
      const site = ctx.pageStore.observeTab(tab.id, url);
      setBadgeForTab(tab.id, site);
    }

    function updateBadge(tabId) {
      ctx.wapiAction.setBadgeBackgroundColor({
        color: ctx.state.enabled ? '#e2511d' : '#777777'
      });
      if (tabId !== undefined && tabId !== null) {
        setBadgeForTab(tabId);
        return;
      }
      ctx.pageStore.siteEntries().forEach(([knownTabId, site]) => setBadgeForTab(knownTabId, site));
      refreshActiveBadge().catch(error =>
        console.warn('WildFire: active badge refresh failed', error));
    }

    async function broadcastState() {
      if (!ctx.wapiChannels || typeof ctx.wapiChannels.broadcast !== 'function') return null;
      if (!ctx.wapiChannels.size || !ctx.wapiChannels.size('state')) return null;
      const payload = Object.assign(
        { type: ctx.wapi.prefix + 'state', ok: true },
        snapshot()
      );
      try {
        const tabs = await ctx.wapi.tabs.query({ active: true, currentWindow: true });
        const tab = Array.isArray(tabs) ? tabs[0] : null;
        const url = tab && (tab.pendingUrl || tab.url) || '';
        const host = ctx.safeHost(url);
        const site = ctx.siteKey(host);
        payload.site = {
          url,
          host,
          site,
          blocked: site ? ctx.countForSite(site) : 0,
          disabled: ctx.siteDisabled(host),
          rules: site ? ctx.siteRulesFor(site) : {},
          dynamicRules: site ? ctx.dynamicRulesFor(site) : []
        };
      } catch (error) {
        /* A state push without site info still refreshes the lifetime counter. */
      }
      ctx.wapiChannels.broadcast('state', payload);
      return payload;
    }

    function mergeSavedState(saved, current) {
      const savedCounts = saved && typeof saved.blockedBySite === 'object' &&
        !Array.isArray(saved.blockedBySite) ? saved.blockedBySite : {};
      const currentCounts = current && typeof current.blockedBySite === 'object' &&
        !Array.isArray(current.blockedBySite) ? current.blockedBySite : {};
      return Object.assign({}, saved, current, {
        blocked: current ? current.blocked : saved.blocked,
        blockedBySite: Object.assign({}, savedCounts, currentCounts)
      });
    }

    async function persist(patch) {
      const revision = Number(ctx.stateRevision) || 0;
      ctx.state = Object.assign({}, ctx.state, patch);
      ctx.stateRevision = revision + 1;
      const saved = await ctx.store.save(ctx.state);
      // recordBlock() can run while storage.local.set() is in flight. Keep the
      // patch authoritative but never discard counters recorded in that window.
      ctx.state = ctx.stateRevision === revision + 1
        ? saved
        : mergeSavedState(saved, ctx.state);
      updateBadge();
      await broadcastState();
      return snapshot();
    }

    function scheduleFlush() {
      if (ctx.flushTimer) return;
      ctx.flushTimer = setTimeout(() => {
        ctx.flushTimer = null;
        ctx.store.save(ctx.state).catch(error =>
          console.warn('WildFire: stats save failed', error));
        broadcastState().catch(() => {});
      }, 1500);
    }

    function recordBlock(tabId, host) {
      const value = String(host || '').trim();
      const cleanHost = safeHost(value) || value.toLowerCase();
      const site = ctx.pageStore.observeTopHost(tabId, cleanHost);
      ctx.pageStore.recordBlocked(tabId);
      const current = Number(ctx.state.blocked);
      ctx.state.blocked = (Number.isFinite(current) && current > 0 ? Math.floor(current) : 0) + 1;
      ctx.stateRevision = (Number(ctx.stateRevision) || 0) + 1;
      if (site) {
        const counts = Object.assign({}, ctx.state.blockedBySite && typeof ctx.state.blockedBySite === 'object'
          ? ctx.state.blockedBySite : {});
        counts[site] = countForSite(site) + 1;
        ctx.state.blockedBySite = counts;
      }
      updateBadge(tabId);
      scheduleFlush();
      return site;
    }

    function snapshot() {
      return {
        state: {
          enabled: ctx.state.enabled,
          blocked: ctx.state.blocked,
          blockedBySite: Object.assign({}, ctx.state.blockedBySite && typeof ctx.state.blockedBySite === 'object'
            ? ctx.state.blockedBySite : {}),
          customFilters: ctx.state.customFilters,
          disabledSites: ctx.state.disabledSites,
          siteRules: ctx.state.siteRules && typeof ctx.state.siteRules === 'object' &&
            !Array.isArray(ctx.state.siteRules)
            ? Object.keys(ctx.state.siteRules).reduce((copy, site) => {
              copy[site] = Object.assign({}, ctx.state.siteRules[site]);
              return copy;
            }, {})
            : {},
          dynamic: dynamicSnapshot(),
          blockCspReports: ctx.state.blockCspReports,
          cspReportAllow: Array.isArray(ctx.state.cspReportAllow)
            ? ctx.state.cspReportAllow.slice() : [],
          cnameUncloak: ctx.state.cnameUncloak !== false
        },
        counts: Object.assign({}, ctx.engine.counts),
        compiler: Object.assign({}, ctx.compilerStatus)
      };
    }

    function copyCounts(source) {
      return Object.keys(source || {}).reduce((copy, key) => {
        copy[key] = source[key];
        return copy;
      }, {});
    }

    function diagnosticsSnapshot() {
      const phases = Object.keys(ctx.diagnostics.phases).reduce((copy, phase) => {
        const stat = ctx.diagnostics.phases[phase];
        copy[phase] = {
          calls: stat.calls,
          totalMs: Number(stat.totalMs.toFixed(3)),
          avgMs: stat.calls ? Number((stat.totalMs / stat.calls).toFixed(3)) : 0,
          maxMs: Number(stat.maxMs.toFixed(3)),
          candidates: stat.candidates,
          regexEvaluations: stat.regexEvaluations,
          cacheHits: stat.cacheHits || 0
        };
        return copy;
      }, {});
      return {
        enabled: ctx.diagnostics.enabled,
        phases,
        samples: ctx.diagnostics.samples.slice(),
        etp: {
          blocked: ctx.etpObserved.blocked,
          byError: copyCounts(ctx.etpObserved.byError),
          classified: ctx.etpObserved.classified,
          byFlag: copyCounts(ctx.etpObserved.byFlag)
        },
        cspReports: Object.assign({}, ctx.cspReportsObserved),
        cname: ctx.cname ? ctx.cname.snapshot() : { supported: false, enabled: false },
        startup: Object.assign({}, ctx.startup || { ok: null, error: '', counts: {} })
      };
    }

    function monotonicMs() {
      const performanceApi = ctx.performance;
      return performanceApi && typeof performanceApi.now === 'function'
        ? performanceApi.now()
        : Date.now();
    }

    function recordDiagnostic(phase, started, stats) {
      if (!ctx.diagnostics.enabled) return;
      const elapsed = Math.max(0, monotonicMs() - started);
      const stat = ctx.diagnostics.phases[phase];
      if (!stat) return;
      const match = stats || (ctx.engine.getLastMatchStats
        ? ctx.engine.getLastMatchStats() : null);
      const candidates = match ? match.candidates : 0;
      const regexEvaluations = match ? match.regexEvaluations : 0;
      const cacheHits = match ? match.cacheHits : 0;
      stat.calls += 1;
      stat.totalMs += elapsed;
      stat.maxMs = Math.max(stat.maxMs, elapsed);
      stat.candidates += candidates;
      stat.regexEvaluations += regexEvaluations;
      stat.cacheHits += cacheHits;
      if (ctx.diagnostics.samples.length >= DIAGNOSTIC_SAMPLE_LIMIT) ctx.diagnostics.samples.shift();
      ctx.diagnostics.samples.push({
        phase,
        ms: Number(elapsed.toFixed(3)),
        candidates,
        regexEvaluations,
        cacheHits
      });
    }

    function measuredMatch(phase, match) {
      if (!ctx.diagnostics.enabled) return match();
      const started = monotonicMs();
      const result = match();
      recordDiagnostic(phase, started);
      return result;
    }

    function measuredDynamic(match) {
      if (!ctx.diagnostics.enabled) return match();
      const started = monotonicMs();
      const result = match();
      recordDiagnostic('dynamic', started, {
        candidates: 0, regexEvaluations: 0, cacheHits: 0
      });
      return result;
    }

    function observeEtp(details) {
      if (!ctx.diagnostics.enabled || !details) return;
      const error = String(details.error || '');
      if (ETP_BLOCK_ERRORS.has(error)) {
        ctx.etpObserved.blocked += 1;
        ctx.etpObserved.byError[error] = (ctx.etpObserved.byError[error] || 0) + 1;
      }
      const classification = details.urlClassification;
      if (!classification) return;
      const flags = []
        .concat(Array.isArray(classification.firstParty) ? classification.firstParty : [])
        .concat(Array.isArray(classification.thirdParty) ? classification.thirdParty : []);
      let sawKnownFlag = false;
      flags.forEach(value => {
        const flag = String(value || '');
        if (!ETP_CLASSIFICATION_FLAGS.has(flag)) return;
        sawKnownFlag = true;
        ctx.etpObserved.byFlag[flag] = (ctx.etpObserved.byFlag[flag] || 0) + 1;
      });
      if (sawKnownFlag) ctx.etpObserved.classified += 1;
    }

    function resetObservations() {
      ctx.etpObserved.blocked = 0;
      ctx.etpObserved.byError = {};
      ctx.etpObserved.classified = 0;
      ctx.etpObserved.byFlag = {};
      ctx.cspReportsObserved.headersStripped = 0;
      ctx.cspReportsObserved.requestsCancelled = 0;
    }

    function hashText(text) {
      const cache = ctx.globals.WildFireCompileCache;
      if (cache && typeof cache.hashText === 'function') return cache.hashText(text);
      const str = String(text || '');
      const h = Array.prototype.reduce.call(str, (hash, ch) =>
        Math.imul(hash ^ ch.charCodeAt(0), 16777619), 2166136261);
      return (h >>> 0).toString(16) + ':' + str.length;
    }

    return {
      emptyPhaseStats,
      safeHost,
      siteDisabled,
      parseHostList,
      hostMatchesList,
      siteKey,
      countForSite,
      countHostFor,
      siteRulesFor,
      dynamicState,
      dynamicRules,
      dynamicRulesFor,
      dynamicDecision,
      dynamicSnapshot,
      setDynamicRules,
      addDynamicRule,
      clearDynamicRules,
      persistDynamicRules,
      setMyRules,
      formatCount,
      setBadgeText,
      setBadgeForTab,
      refreshActiveBadge,
      updateBadge,
      broadcastState,
      persist,
      scheduleFlush,
      recordBlock,
      snapshot,
      copyCounts,
      diagnosticsSnapshot,
      monotonicMs,
      recordDiagnostic,
      measuredMatch,
      measuredDynamic,
      observeEtp,
      resetObservations,
      hashText
    };
  };
})(this);

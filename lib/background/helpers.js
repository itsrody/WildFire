/* WildFire - shared helpers for the Firefox-native background controller. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});

  const DIAGNOSTIC_PHASES = [
    'request', 'csp', 'removeparam',
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
        calls: 0, totalMs: 0, maxMs: 0, candidates: 0, regexEvaluations: 0
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
      const clean = String(host || '').toLowerCase();
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

    function formatCount(value) {
      if (value < 1000) return String(value);
      if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 'k';
      return (value / 1000000).toFixed(1) + 'm';
    }

    function setBadgeText(options) {
      const result = ctx.browserApi.browserAction.setBadgeText(options);
      if (result && typeof result.catch === 'function') result.catch(() => {});
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
      ctx.browserApi.browserAction.setBadgeBackgroundColor({
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

    function broadcastState() {
      if (!ctx.wapiChannels || typeof ctx.wapiChannels.broadcast !== 'function') return;
      const payload = Object.assign(
        { type: ctx.wapi.prefix + 'state', ok: true },
        snapshot()
      );
      ctx.wapiChannels.broadcast('state', payload);
    }

    async function persist(patch) {
      ctx.state = await ctx.store.save(Object.assign({}, ctx.state, patch));
      updateBadge();
      broadcastState();
      return snapshot();
    }

    function scheduleFlush() {
      if (ctx.flushTimer) return;
      ctx.flushTimer = setTimeout(() => {
        ctx.flushTimer = null;
        ctx.store.save(ctx.state).catch(error =>
          console.warn('WildFire: stats save failed', error));
        broadcastState();
      }, 1500);
    }

    function recordBlock(tabId, host) {
      const site = ctx.pageStore.observeTopHost(tabId, host);
      ctx.pageStore.recordBlocked(tabId);
      const current = Number(ctx.state.blocked);
      ctx.state.blocked = (Number.isFinite(current) && current > 0 ? Math.floor(current) : 0) + 1;
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
          blockCspReports: ctx.state.blockCspReports,
          cspReportAllow: Array.isArray(ctx.state.cspReportAllow)
            ? ctx.state.cspReportAllow.slice() : []
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
          regexEvaluations: stat.regexEvaluations
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
        startup: Object.assign({}, ctx.startup || { ok: null, error: '', counts: {} })
      };
    }

    function monotonicMs() {
      const performanceApi = ctx.performance;
      return performanceApi && typeof performanceApi.now === 'function'
        ? performanceApi.now()
        : Date.now();
    }

    function recordDiagnostic(phase, started) {
      if (!ctx.diagnostics.enabled) return;
      const elapsed = Math.max(0, monotonicMs() - started);
      const stat = ctx.diagnostics.phases[phase];
      if (!stat) return;
      const match = ctx.engine.getLastMatchStats ? ctx.engine.getLastMatchStats() : null;
      const candidates = match ? match.candidates : 0;
      const regexEvaluations = match ? match.regexEvaluations : 0;
      stat.calls += 1;
      stat.totalMs += elapsed;
      stat.maxMs = Math.max(stat.maxMs, elapsed);
      stat.candidates += candidates;
      stat.regexEvaluations += regexEvaluations;
      if (ctx.diagnostics.samples.length >= DIAGNOSTIC_SAMPLE_LIMIT) ctx.diagnostics.samples.shift();
      ctx.diagnostics.samples.push({
        phase,
        ms: Number(elapsed.toFixed(3)),
        candidates,
        regexEvaluations
      });
    }

    function measuredMatch(phase, match) {
      if (!ctx.diagnostics.enabled) return match();
      const started = monotonicMs();
      const result = match();
      recordDiagnostic(phase, started);
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
      let h = 2166136261;
      Array.from(str).forEach(ch => { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); });
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
      recordDiagnostic,
      measuredMatch,
      observeEtp,
      resetObservations,
      hashText
    };
  };
})(this);

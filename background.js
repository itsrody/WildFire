/* WildFire - background engine: request blocking, cosmetic injection, messaging. */
(function () {
  'use strict';

  // Firefox 153 resolves registrable domains from its built-in Public Suffix
  // List. The options keep IP addresses, plain suffixes and private/local
  // domains resolvable instead of returning null. FilterEngine falls back to
  // a last-two-label scope if a lookup fails.
  const DOMAIN_OPTIONS = {
    allowIPAddress: true,
    allowPlainSuffix: true,
    allowUnknownSuffix: true
  };

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
  const CSP_REPORT_DIRECTIVES = new Set(['report-uri', 'report-to']);
  const CSP_HEADER_NAMES = new Set([
    'content-security-policy', 'content-security-policy-report-only'
  ]);

  function registrableDomain(host) {
    try {
      return browser.publicSuffix.getDomain(host, DOMAIN_OPTIONS) || '';
    } catch (error) {
      return '';
    }
  }

  const engine = new FilterEngine(
    registrableDomain,
    alias => typeof CspResources !== 'undefined' ? CspResources.resolve(alias) : '',
    typeof WildFireScriptlets !== 'undefined' ? WildFireScriptlets : null,
    alias => typeof RewriteResources !== 'undefined' ? RewriteResources.hasAlias(alias) : false
  );
  const pageStore = new WildFirePageStore({
    siteForHost: siteKey,
    isDisabledHost: siteDisabled
  });
  const remoteLists = RemoteLists.create({
    storage: browser.storage.local,
    fetchImpl: (url, options) => fetch(url, options),
    now: () => Date.now()
  });
  const compiler = (typeof WildFireCompiler !== 'undefined' && WildFireCompiler.create)
    ? WildFireCompiler.create({ browserApi: browser, timeoutMs: 15000 })
    : null;
  const compileCache = (typeof WildFireCompileCache !== 'undefined' && WildFireCompileCache.create)
    ? WildFireCompileCache.create({ browserApi: browser, version: FilterEngine.COMPILED_VERSION })
    : null;
  // In-flight dedup: concurrent compiles of identical text share one promise so
  // a reload racing a filter edit never compiles the same source twice.
  const compileFlight = new Map();
  let filterLoad = Promise.resolve();
  let lastCustomHash = '';
  let lastRemoteSignature = '';
  let remoteUpdate = Promise.resolve();
  const remoteUpdating = new Set();
  let filterGeneration = 0;
  let activeFilterGeneration = 0;
  const compilerStatus = {
    lastMode: 'init',
    lastError: '',
    restarts: 0,
    lastEvent: '',
    lastAt: 0,
    capabilities: 0
  };
  if (compiler && typeof compiler.on === 'function') {
    compiler.on(event => {
      compilerStatus.lastEvent = event && event.type || 'unknown';
      compilerStatus.lastAt = Date.now();
      if (event && event.type === 'restart') compilerStatus.restarts += 1;
      if (event && event.error) compilerStatus.lastError = String(event.error.message || event.error);
      if (event && (event.type === 'compiled' || event.type === 'fallback' || event.type === 'worker-error' || event.type === 'restart')) {
        console.debug('WildFire: compiler', event.type, event);
      }
    });
  }

  const DIAGNOSTIC_SAMPLE_LIMIT = 64;
  const DIAGNOSTIC_PHASES = [
    'request', 'csp', 'removeparam',
    'removeheader-request', 'removeheader-response'
  ];
  function emptyPhaseStats() {
    return DIAGNOSTIC_PHASES.reduce((stats, phase) => {
      stats[phase] = {
        calls: 0, totalMs: 0, maxMs: 0, candidates: 0, regexEvaluations: 0
      };
      return stats;
    }, {});
  }
  // In-memory only. Diagnostics are opt-in per session and never persisted or
  // reported off-device, so data_collection_permissions stays ["none"].
  const diagnostics = {
    enabled: false,
    phases: emptyPhaseStats(),
    samples: []
  };
  const etpObserved = {
    blocked: 0,
    byError: {},
    classified: 0,
    byFlag: {}
  };
  const cspReportsObserved = {
    headersStripped: 0,
    requestsCancelled: 0
  };

  function monotonicMs() {
    return typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function copyCounts(source) {
    return Object.keys(source || {}).reduce((copy, key) => {
      copy[key] = source[key];
      return copy;
    }, {});
  }

  function diagnosticsSnapshot() {
    const phases = Object.keys(diagnostics.phases).reduce((copy, phase) => {
      const stat = diagnostics.phases[phase];
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
      enabled: diagnostics.enabled,
      phases,
      samples: diagnostics.samples.slice(),
      etp: {
        blocked: etpObserved.blocked,
        byError: copyCounts(etpObserved.byError),
        classified: etpObserved.classified,
        byFlag: copyCounts(etpObserved.byFlag)
      },
      cspReports: Object.assign({}, cspReportsObserved)
    };
  }

  function recordDiagnostic(phase, started) {
    if (!diagnostics.enabled) return;
    const elapsed = Math.max(0, monotonicMs() - started);
    const stat = diagnostics.phases[phase];
    if (!stat) return;
    const match = engine.getLastMatchStats ? engine.getLastMatchStats() : null;
    const candidates = match ? match.candidates : 0;
    const regexEvaluations = match ? match.regexEvaluations : 0;
    stat.calls += 1;
    stat.totalMs += elapsed;
    stat.maxMs = Math.max(stat.maxMs, elapsed);
    stat.candidates += candidates;
    stat.regexEvaluations += regexEvaluations;
    if (diagnostics.samples.length >= DIAGNOSTIC_SAMPLE_LIMIT) diagnostics.samples.shift();
    diagnostics.samples.push({
      phase,
      ms: Number(elapsed.toFixed(3)),
      candidates,
      regexEvaluations
    });
  }

  function measuredMatch(phase, match) {
    if (!diagnostics.enabled) return match();
    const started = monotonicMs();
    const result = match();
    recordDiagnostic(phase, started);
    return result;
  }

  function observeEtp(details) {
    if (!diagnostics.enabled || !details) return;
    const error = String(details.error || '');
    if (ETP_BLOCK_ERRORS.has(error)) {
      etpObserved.blocked += 1;
      etpObserved.byError[error] = (etpObserved.byError[error] || 0) + 1;
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
      etpObserved.byFlag[flag] = (etpObserved.byFlag[flag] || 0) + 1;
    });
    if (sawKnownFlag) etpObserved.classified += 1;
  }

  function resetObservations() {
    etpObserved.blocked = 0;
    etpObserved.byError = {};
    etpObserved.classified = 0;
    etpObserved.byFlag = {};
    cspReportsObserved.headersStripped = 0;
    cspReportsObserved.requestsCancelled = 0;
  }

  // requestId -> MIME type, so onHeadersReceived can normalize the headers of
  // responses whose body WildFire is replacing.
  const rewrites = new Map();
  let state = Object.assign({}, WildFireStore.defaults);
  let flushTimer = null;
  let ready = false;
  let scriptletRegistration = null;
  let scriptletGeneration = 0;
  const REALM_BIRTH_ALIASES = new Set(['set-constant']);

  function safeHost(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function siteDisabled(host) {
    if (!host) return false;
    const list = Array.isArray(state.disabledSites) ? state.disabledSites : [];
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
    return clean ? registrableDomain(clean) || clean : '';
  }

  function countForSite(site) {
    const key = siteKey(site) || String(site || '').toLowerCase();
    const counts = state.blockedBySite && typeof state.blockedBySite === 'object'
      ? state.blockedBySite : {};
    const count = Number(counts[key]);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  // Count against the tab's top-level site, not an embedded frame's document.
  function countHostFor(details, host) {
    return safeHost(pageStore.topUrlForTab(details.tabId)) ||
      pageStore.topHostForTab(details.tabId) || host;
  }

  function formatCount(value) {
    if (value < 1000) return String(value);
    if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 'k';
    return (value / 1000000).toFixed(1) + 'm';
  }

  function setBadgeText(options) {
    const result = browser.browserAction.setBadgeText(options);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  }

  function setBadgeForTab(tabId, site) {
    const key = site || pageStore.siteForTab(tabId) || '';
    setBadgeText({
      text: state.enabled && key ? formatCount(countForSite(key)) : '',
      tabId
    });
  }

  async function refreshActiveBadge() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = Array.isArray(tabs) ? tabs[0] : null;
    if (!tab) {
      setBadgeText({ text: '' });
      return;
    }
    const url = tab.pendingUrl || tab.url || '';
    const site = pageStore.observeTab(tab.id, url);
    setBadgeForTab(tab.id, site);
  }

  function updateBadge(tabId) {
    browser.browserAction.setBadgeBackgroundColor({
      color: state.enabled ? '#e2511d' : '#777777'
    });
    if (tabId !== undefined && tabId !== null) {
      setBadgeForTab(tabId);
      return;
    }
    pageStore.siteEntries().forEach(([knownTabId, site]) => setBadgeForTab(knownTabId, site));
    refreshActiveBadge().catch(error =>
      console.warn('WildFire: active badge refresh failed', error));
  }

  async function persist(patch) {
    state = await WildFireStore.save(Object.assign({}, state, patch));
    updateBadge();
    return snapshot();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      WildFireStore.save(state).catch(error => console.warn('WildFire: stats save failed', error));
    }, 1500);
  }

  function recordBlock(tabId, host) {
    const site = pageStore.observeTopHost(tabId, host);
    pageStore.recordBlocked(tabId);
    const current = Number(state.blocked);
    state.blocked = (Number.isFinite(current) && current > 0 ? Math.floor(current) : 0) + 1;
    if (site) {
      const counts = Object.assign({}, state.blockedBySite && typeof state.blockedBySite === 'object'
        ? state.blockedBySite : {});
      counts[site] = countForSite(site) + 1;
      state.blockedBySite = counts;
    }
    updateBadge(tabId);
    scheduleFlush();
    return site;
  }

  function snapshot() {
    return {
      state: {
        enabled: state.enabled,
        blocked: state.blocked,
        blockedBySite: Object.assign({}, state.blockedBySite && typeof state.blockedBySite === 'object'
          ? state.blockedBySite : {}),
        customFilters: state.customFilters,
        disabledSites: state.disabledSites,
        blockCspReports: state.blockCspReports,
        cspReportAllow: Array.isArray(state.cspReportAllow) ? state.cspReportAllow.slice() : []
      },
      counts: Object.assign({}, engine.counts),
      compiler: Object.assign({}, compilerStatus)
    };
  }

  function scriptletHash(rules) {
    return String(rules.length) + ':' + rules.map(rule => [
      rule.alias,
      rule.syntax || 'ubo',
      rule.isException ? '1' : '0',
      (rule.domains || []).join(','),
      (rule.args || []).join('\u001f')
    ].join('\u001e')).join('\u001d');
  }

  function normalizeScriptletRule(rule) {
    const syntax = rule.syntax === 'adguard' ? 'adguard' : 'ubo';
    const alias = WildFireScriptlets.canonical(rule.alias, syntax);
    return {
      alias,
      syntax,
      args: Array.isArray(rule.args) ? rule.args.slice() : [],
      domains: Array.isArray(rule.domains) ? rule.domains.slice() : [],
      isException: !!rule.isException
    };
  }

  function splitScriptletPayload(rules) {
    const payload = { realmBirth: [], documentStart: [] };
    rules.forEach(rule => {
      const normalized = normalizeScriptletRule(rule);
      if (!normalized.isException && REALM_BIRTH_ALIASES.has(normalized.alias)) payload.realmBirth.push(normalized);
      else payload.documentStart.push(normalized);
    });
    return payload;
  }

  function nativeBridge() {
    const api = browser.wildfireNative;
    if (!api || typeof api.setPayload !== 'function') return null;
    return api;
  }

  async function syncNativeScriptlets(payload) {
    const bridge = nativeBridge();
    if (!bridge) return false;
    try {
      if (!payload.realmBirth.length && !payload.documentStart.length) {
        if (typeof bridge.clearPayload === 'function') await bridge.clearPayload();
        return true;
      }
      await bridge.setPayload({
        version: 1,
        generation: ++scriptletGeneration,
        hash: scriptletHash(payload.realmBirth.concat(payload.documentStart)),
        phases: payload
      });
      return true;
    } catch (error) {
      console.warn('WildFire: native scriptlet bridge failed', error);
      return false;
    }
  }

  function compileSyncSafe(text) {
    try {
      const compiled = WildFireCompiler.compileSync(String(text || '')).compiled;
      compilerStatus.lastMode = 'sync';
      compilerStatus.lastError = '';
      return compiled;
    } catch (error) {
      compilerStatus.lastMode = 'sync-error';
      compilerStatus.lastError = String(error && error.message || error);
      console.warn('WildFire: sync compile failed', error);
      return null;
    }
  }

  function compileText(text, meta, generation, forceSync) {
    const source = String(text || '');
    if (!source.trim()) return Promise.resolve(null);
    const flightKey = (compileCache && compileCache.keyFor)
      ? compileCache.keyFor(source)
      : FilterEngine.COMPILED_VERSION + ':' + hashText(source);
    const existing = compileFlight.get(flightKey);
    if (existing) return existing;
    const task = compileTextOnce(source, meta, generation, forceSync);
    compileFlight.set(flightKey, task);
    task.then(() => compileFlight.delete(flightKey), () => compileFlight.delete(flightKey));
    return task;
  }

  async function compileTextOnce(source, meta, generation, forceSync) {
    if (compileCache) {
      try {
        const cached = await compileCache.get(source);
        if (cached && cached.v === FilterEngine.COMPILED_VERSION) {
          compilerStatus.lastMode = 'cache';
          compilerStatus.lastError = '';
          return cached;
        }
      } catch (error) {
        console.warn('WildFire: compile cache read failed', error);
      }
    }

    const isCurrent = generation === undefined || generation === activeFilterGeneration;
    if (!forceSync && compiler && typeof compiler.compile === 'function' && isCurrent) {
      if (compiler.pendingCount && compiler.pendingCount() > 0 && compiler.restart) {
        console.warn('WildFire: stale compile pending, restarting compiler worker');
        compiler.restart('stale filter generation');
        compilerStatus.lastMode = 'stale-sync-fallback';
        return compileSyncSafe(source);
      }
      try {
        const result = await compiler.compile(source);
        if (generation !== undefined && generation !== activeFilterGeneration) {
          compilerStatus.lastMode = 'stale-sync-fallback';
          return compileSyncSafe(source);
        }
        if (result && result.compiled) {
          compilerStatus.lastMode = 'worker';
          compilerStatus.lastError = '';
          if (typeof result.capabilities === 'number') compilerStatus.capabilities = result.capabilities;
          if (compileCache && result.compiled.v === FilterEngine.COMPILED_VERSION) {
            compileCache.set(source, result.compiled, meta).catch(error =>
              console.warn('WildFire: compile cache write failed', error));
          }
          return result.compiled;
        }
      } catch (error) {
        compilerStatus.lastMode = 'worker-fallback';
        compilerStatus.lastError = String(error && error.message || error);
        console.warn('WildFire: worker compile failed, using sync fallback', error);
      }
    }

    if (forceSync) compilerStatus.lastMode = 'forced-sync-fallback';
    const compiled = compileSyncSafe(source);
    if (compileCache && compiled && compiled.v === FilterEngine.COMPILED_VERSION) {
      compileCache.set(source, compiled, meta).catch(error =>
        console.warn('WildFire: compile cache write failed', error));
    }
    return compiled;
  }

  async function loadCompiledOrText(text, meta, append, generation, forceSync) {
    const source = String(text || '');
    if (!source.trim()) return false;
    const compiled = await compileText(source, meta, generation, forceSync);
    if (compiled && engine.loadCompiled(compiled, { append: Boolean(append) })) return true;
    if (append) engine.load(source, { append: true });
    else engine.load(source);
    return false;
  }

  async function warmRemoteCompile(result) {
    if (!result || !result.ok || !result.changed || !result.list || !result.list.text) return;
    try {
      await compileText(result.list.text, { source: 'remote', url: result.list.url, hash: result.list.hash || hashText(result.list.text) }, activeFilterGeneration);
    } catch (error) {
      console.warn('WildFire: remote compile warm failed', error);
    }
  }

  function hashText(text) {
    if (typeof WildFireCompileCache !== 'undefined' && typeof WildFireCompileCache.hashText === 'function') {
      return WildFireCompileCache.hashText(text);
    }
    const str = String(text || '');
    let h = 2166136261;
    Array.from(str).forEach(ch => { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); });
    return (h >>> 0).toString(16) + ':' + str.length;
  }

  async function remoteSignature() {
    const snapshot = await remoteLists.get();
    return snapshot.lists
      .filter(entry => entry.enabled && entry.text)
      .map(entry => entry.url + '\u001f' + (entry.hash || hashText(entry.text)))
      .sort()
      .join('\u001e');
  }

  async function loadFilters(force) {
    const generation = ++filterGeneration;
    activeFilterGeneration = generation;
    if (compiler && compiler.pendingCount && compiler.pendingCount() > 0 && compiler.restart) {
      console.warn('WildFire: restarting compiler for new filter generation');
      compiler.restart('new filter generation');
    } else if (compiler && compiler.cancelAll) {
      compiler.cancelAll('new filter generation');
    }
    const run = filterLoad.then(async () => {
      if (generation !== activeFilterGeneration) return;

      const custom = String(state.customFilters || '').trim();
      const customHash = custom ? hashText(custom) : '';
      let remoteSig = '';
      let remoteEntries = [];
      try {
        remoteSig = await remoteSignature();
        if (remoteSig) {
          const snapshot = await remoteLists.get();
          remoteEntries = snapshot.lists.filter(entry => entry.enabled && entry.text);
        }
      } catch (error) {
        console.warn('WildFire: remote list state unavailable', error);
      }

      const customChanged = customHash !== lastCustomHash;
      const remoteChanged = remoteSig !== lastRemoteSignature;
      if (!force && !customChanged && !remoteChanged && ready) return;

      engine.reset();
      let bundledLoaded = false;
      try {
        const response = await fetch(browser.runtime.getURL('filters/default.compiled.json'));
        if (response.ok) {
          const compiled = await response.json();
          bundledLoaded = engine.loadCompiled(compiled);
        }
      } catch (error) {
        bundledLoaded = false;
      }
      if (!bundledLoaded) {
        try {
          const response = await fetch(browser.runtime.getURL('filters/default.txt'));
          if (response.ok) {
            const bundled = await response.text();
            const compiled = await compileText(bundled, { source: 'bundled' }, generation);
            if (!compiled || !engine.loadCompiled(compiled)) engine.load(bundled);
          }
        } catch (error) {
          console.warn('WildFire: bundled filter list unavailable', error);
        }
      }

      const forceSync = compiler && compiler.pendingCount && compiler.pendingCount() > 0;

      // Compile only when custom rules changed, or on forced rebuild; unchanged uses cache.
      if (custom) {
        const shouldCompile = customChanged || force || !ready;
        const compiled = shouldCompile
          ? await compileText(custom, { source: 'custom', hash: customHash }, generation, forceSync)
          : (compileCache ? await compileCache.get(custom) : null);
        if (compiled && compiled.v === FilterEngine.COMPILED_VERSION) {
          engine.loadCompiled(compiled, { append: true });
        } else if (shouldCompile) {
          const fresh = compiled || await compileText(custom, { source: 'custom', hash: customHash }, generation, forceSync);
          if (!fresh || !engine.loadCompiled(fresh, { append: true })) engine.load(custom, { append: true });
        } else {
          engine.load(custom, { append: true });
        }
      }

      // Per-list incremental remote compile/load. Only changed/missing lists are compiled.
      await remoteEntries.reduce((chain, entry) => chain.then(async () => {
        const text = '! wildfire remote: ' + entry.url + '\n' + entry.text;
        await loadCompiledOrText(text, { source: 'remote', url: entry.url, hash: entry.hash || hashText(entry.text) }, true, generation, forceSync);
      }), Promise.resolve());

      if (generation !== activeFilterGeneration) return;
      lastCustomHash = customHash;
      lastRemoteSignature = remoteSig;
      compilerStatus.capabilities = engine.capabilities || 0;
      if (engine.setMatchStatsEnabled) engine.setMatchStatsEnabled(diagnostics.enabled);
      ensureHeadersListener();
      ensureRemoveHeaderListener();
      await refreshAllCosmetic();
      await syncScriptlets();
    });
    filterLoad = run.catch(() => undefined);
    return run;
  }

  // Firefox registers this content script at document_start so countermeasure
  // code runs before page scripts. Only validated alias data is injected; the
  // implementation always comes from WildFire's own file.
  async function syncScriptlets() {
    const rules = engine.getScriptletPayload();
    const payload = splitScriptletPayload(rules);
    const nativeReady = await syncNativeScriptlets(payload);

    if (!browser.contentScripts || typeof browser.contentScripts.register !== 'function') return;
    if (scriptletRegistration) {
      try {
        await scriptletRegistration.unregister();
      } catch (error) {
        console.warn('WildFire: scriptlet unregister failed', error);
      }
      scriptletRegistration = null;
    }

    const fallbackRules = nativeReady ? payload.documentStart : rules;
    if (!fallbackRules.length) return;
    try {
      scriptletRegistration = await browser.contentScripts.register({
        matches: ['<all_urls>'],
        js: [
          { file: 'lib/resources/scriptlets/core.js' },
          { file: 'lib/resources/scriptlets/runtime.js' },
          { file: 'lib/resources/scriptlets/transforms.js' },
          { file: 'lib/resources/scriptlets/adguard-helpers.js' },
          { file: 'lib/resources/scriptlets/definitions.js' },
          { file: 'lib/resources/scriptlets/adguard-definitions.js' },
          { file: 'lib/resources/scriptlets/api.js' },
          { code: '(() => { const api = window.WildFireScriptlets; try { delete window.WildFireScriptlets; } catch (e) {} if (api && typeof api.apply === "function") api.apply(' + JSON.stringify(fallbackRules) + '); })();' }
        ],
        runAt: 'document_start',
        allFrames: true
      });
    } catch (error) {
      console.warn('WildFire: scriptlet registration failed', error);
    }
  }

  async function syncRemoteAlarm() {
    if (!browser.alarms) return;
    const lists = (await remoteLists.get()).lists;
    const needed = lists.some(entry => entry.autoUpdate && entry.enabled && entry.text);
    if (!needed) {
      await browser.alarms.clear('wildfire-remote-update');
      return;
    }
    const existing = await browser.alarms.get('wildfire-remote-update');
    if (!existing) {
      await browser.alarms.create('wildfire-remote-update', { periodInMinutes: 1440 });
    }
  }

  function remoteRulesChanged(result) {
    if (!result || !result.ok) return false;
    const action = result.action || '';
    if (action === 'update') return Boolean(result.changed);
    if (action === 'set-enabled' || action === 'remove') return true;
    return false;
  }

  async function applyRemoteResult(result) {
    if (!result.ok) {
      return Object.assign(snapshot(), {
        ok: false,
        error: result.error,
        lists: (result.snapshot && result.snapshot.lists) || (await remoteLists.get()).lists
      });
    }
    if (remoteRulesChanged(result)) {
      warmRemoteCompile(result);
      await loadFilters();
    }
    try {
      await syncRemoteAlarm();
    } catch (error) {
      console.warn('WildFire: remote update schedule failed', error);
    }
    return Object.assign(snapshot(), { ok: true, lists: result.snapshot.lists });
  }

  async function runRemoteUpdates(options) {
    const opts = options || {};
    const run = remoteUpdate.then(async () => {
      const result = await remoteLists.updateDue({
        force: Boolean(opts.force)
      });
      if (result.changed) {
        await Promise.all((result.results || [])
          .filter(entry => entry && entry.ok && entry.changed)
          .map(entry => warmRemoteCompile(entry)));
        await loadFilters();
      }
      try {
        await syncRemoteAlarm();
      } catch (error) {
        console.warn('WildFire: remote update schedule failed', error);
      }
      return result;
    });
    remoteUpdate = run.catch(() => undefined);
    return run;
  }

  async function sendCosmetic(tabId, url, frameId) {
    const host = safeHost(url);
    if (!host) return;
    const hidePolicy = engine.getHidePolicy ? engine.getHidePolicy(url, 'document', url) : {};
    const payload = {
      type: 'wildfire:apply',
      selectors: engine.getCosmetic(host, hidePolicy),
      procedural: engine.getProcedural(host, hidePolicy),
      hidePolicy
    };
    if (frameId !== undefined) pageStore.setCosmetic(tabId, { url, frameId, payload });
    try {
      const options = typeof frameId === 'number' ? { frameId } : undefined;
      await browser.tabs.sendMessage(tabId, payload, options);
    } catch (error) {
      /* No content script in that tab/frame - safe to ignore. */
    }
  }

  async function refreshCosmeticForPage(tabId) {
    const frames = pageStore.framesForTab(tabId);
    if (!frames.length) {
      const url = pageStore.topUrlForTab(tabId);
      if (url) await sendCosmetic(tabId, url, 0);
      return;
    }
    await Promise.all(frames.map(frame => sendCosmetic(tabId, frame.url, frame.frameId)));
  }

  async function refreshAllCosmetic() {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(tab => refreshCosmeticForPage(tab.id)));
  }

  // Firefox streams the response through StreamFilter. Everything is set up
  // synchronously here; incoming chunks are discarded and the curated WildFire
  // body is written when the stream stops. The listener stays synchronous.
  function startRewrite(requestId, resource) {
    if (!browser.webRequest || typeof browser.webRequest.filterResponseData !== 'function') {
      return false;
    }
    let filter;
    try {
      filter = browser.webRequest.filterResponseData(requestId);
    } catch (error) {
      console.warn('WildFire: rewrite filter failed', error);
      return false;
    }

    rewrites.set(requestId, resource.type);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      rewrites.delete(requestId);
    };

    filter.ondata = () => { /* the original body is intentionally dropped */ };
    filter.onstop = () => {
      try {
        filter.write(resource.bytes);
        filter.close();
      } catch (error) {
        console.warn('WildFire: rewrite write failed', error);
        try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
      }
      finish();
    };
    filter.onerror = () => {
      try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
      finish();
    };
    return true;
  }

  function popupSource(details) {
    return pageStore.popupSourceFor(details.tabId) ||
      (details.openerTabId && pageStore.topUrlForTab(details.openerTabId)) ||
      pageStore.documentUrlFor(details) ||
      '';
  }

  function countPopupBlock(tabId, host) {
    if (!pageStore.consumePopupBlock(tabId)) return false;
    recordBlock(tabId, host);
    return true;
  }

  function onBeforeRequest(details) {
    if (details.type === 'csp_report') return undefined;
    pageStore.observeRequest(details);
    if (!state.enabled || pageStore.isPopupBlocked(details.tabId)) return undefined;

    const context = pageStore.contextFor(details);
    const documentUrl = context.documentUrl;
    const host = context.host;
    if (context.disabled) return undefined;

    const type = mapResourceType(details.type);
    if (type === 'document' && pageStore.hasPopup(details.tabId)) {
      const sourceUrl = popupSource(details);
      if (!siteDisabled(safeHost(sourceUrl))) {
        const popup = measuredMatch('request', () => engine.matchPopup(details.url, sourceUrl));
        if (popup.blocked) {
          pageStore.markPopupBlocked(details.tabId);
          if (countPopupBlock(details.tabId, sourceUrl || documentUrl)) return { cancel: true };
        }
      }
      pageStore.clearPopup(details.tabId);
    }

    const result = measuredMatch('request', () => engine.matchRequest(details.url, type, documentUrl));
    if (result.blocked) {
      if (type === 'document') {
        pageStore.markPopupBlocked(details.tabId);
        if (countPopupBlock(details.tabId, documentUrl || details.url)) return { cancel: true };
        return undefined;
      }

      const rewrite = result.rewrite && typeof RewriteResources !== 'undefined'
        ? RewriteResources.resolve(result.rewrite.alias)
        : null;

      // Only WildFire-owned data-URI resources can be served, and never for
      // navigations. An unknown alias falls back to a plain cancel.
      const redirectUrl = !rewrite && result.redirect && typeof RedirectResources !== 'undefined'
        ? RedirectResources.resolve(result.redirect.alias, result.redirect.captures)
        : '';

      recordBlock(details.tabId, countHostFor(details, host));
      if (rewrite) {
        return startRewrite(details.requestId, rewrite) ? undefined : { cancel: true };
      }
      return redirectUrl ? { redirectUrl } : { cancel: true };
    }

    // Capability-gated removeparam: only when request is not blocked/redirected.
    if (engine.capabilities & FilterEngine.CAP.REMOVEPARAM) {
      const rp = measuredMatch('removeparam', () => engine.matchRemoveparam(details.url, type, documentUrl));
      if (rp.params && rp.params.length) {
        const cleanUrl = applyRemoveparam(details.url, rp.params);
        if (cleanUrl && cleanUrl !== details.url) {
          recordBlock(details.tabId, countHostFor(details, host));
          return { redirectUrl: cleanUrl };
        }
      }
    }
    return undefined;
  }

  // Firefox applies every CSP header independently, so adding a curated
  // WildFire header tightens a response without rewriting the site's headers.
  // This listener is synchronous, like onBeforeRequest.
  function applyRemoveparam(url, rules) {
    if (!rules || !rules.length) return url;
    try {
      const u = new URL(url);
      let changed = false;
      rules.forEach(rule => {
        const value = String(rule.value || '');
        if (!value) {
          if (u.search) { u.search = ''; changed = true; }
          return;
        }
        if (rule.regex) {
          Array.from(u.searchParams.keys()).forEach(key => {
            if (rule.regex.test(key)) { u.searchParams.delete(key); changed = true; }
          });
          return;
        }
        if (u.searchParams.has(value)) { u.searchParams.delete(value); changed = true; }
      });
      return changed ? u.toString() : url;
    } catch (error) {
      return url;
    }
  }

  function removeHeaders(headers, names, kind) {
    if (!Array.isArray(headers) || !names || !names.length) return headers;
    const set = new Set(names.map(n => {
      const v = String(n || '').toLowerCase();
      if (v.startsWith('request:') || v.startsWith('response:')) return v;
      return kind + ':' + v;
    }));
    const filtered = headers.filter(h => {
      const name = String(h.name || '').toLowerCase();
      return !(set.has(kind + ':' + name) || set.has(name));
    });
    return filtered.length === headers.length ? headers : filtered;
  }

  function onBeforeSendHeaders(details) {
    if (!state.enabled) return;
    if (!(engine.capabilities & FilterEngine.CAP.REMOVEHEADER)) return;
    pageStore.observeRequest(details);
    const type = mapResourceType(details.type);
    const documentUrl = type === 'document' ? details.url : pageStore.documentUrlFor(details);
    if (siteDisabled(safeHost(documentUrl))) return;
    const result = measuredMatch('removeheader-request', () => engine.matchRemoveheader(details.url, type, documentUrl));
    if (!result.headers.length) return;
    const reqHeaders = details.requestHeaders || [];
    const requestHeaders = removeHeaders(reqHeaders, result.headers, 'request');
    return requestHeaders === reqHeaders ? undefined : { requestHeaders };
  }

  function reportEndpointHost(value, baseUrl) {
    try {
      return new URL(String(value || ''), baseUrl).hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function reportingEndpoints(headers) {
    return headers.reduce((endpoints, header) => {
      if (String(header && header.name || '').toLowerCase() !== 'reporting-endpoints') return endpoints;
      const matches = String(header && header.value || '')
        .matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/g);
      Array.from(matches).forEach(match => { endpoints[match[1]] = match[2]; });
      return endpoints;
    }, Object.create(null));
  }

  function parseCspDirectives(value) {
    return String(value || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(raw => {
        const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
        return match
          ? { raw, name: match[1].toLowerCase(), value: match[2] || '' }
          : null;
      })
      .filter(Boolean);
  }

  function reportDirectiveAllowed(directive, endpoints, baseUrl) {
    const allowed = Array.isArray(state.cspReportAllow) ? state.cspReportAllow : [];
    if (!allowed.length) return false;
    const values = directive.value.split(/\s+/).filter(Boolean);
    if (!values.length) return false;
    if (directive.name === 'report-uri') {
      return values.every(value => hostMatchesList(reportEndpointHost(value, baseUrl), allowed));
    }
    return values.every(name => {
      const endpoint = endpoints[name];
      return Boolean(endpoint) && hostMatchesList(reportEndpointHost(endpoint, baseUrl), allowed);
    });
  }

  function stripCspReportDirectives(headers, baseUrl) {
    if (!Array.isArray(headers) || !state.blockCspReports) return headers;
    const endpoints = reportingEndpoints(headers);
    let stripped = 0;
    const next = headers.map(header => {
      const name = String(header && header.name || '').toLowerCase();
      if (!CSP_HEADER_NAMES.has(name)) return header;
      const directives = parseCspDirectives(header.value);
      const kept = directives
        .filter(directive => !CSP_REPORT_DIRECTIVES.has(directive.name) ||
          reportDirectiveAllowed(directive, endpoints, baseUrl))
        .map(directive => directive.raw);
      if (kept.length === directives.length) return header;
      stripped += 1;
      return Object.assign({}, header, { value: kept.join('; ') });
    });
    if (stripped && diagnostics.enabled) cspReportsObserved.headersStripped += stripped;
    return stripped ? next : headers;
  }

  function onCspReportRequest(details) {
    if (!state.enabled || !state.blockCspReports) return undefined;
    pageStore.observeRequest(details);
    const endpointHost = safeHost(details.url);
    if (!endpointHost || hostMatchesList(endpointHost, state.cspReportAllow)) return undefined;
    const context = pageStore.contextFor(details);
    if (context.disabled) return undefined;
    if (diagnostics.enabled) cspReportsObserved.requestsCancelled += 1;
    return { cancel: true };
  }

  function onHeadersReceived(details) {
    if (details.type === 'csp_report') return undefined;
    // A rewrite stream may already exist even if the user just paused the
    // extension; its headers still need normalizing so the body stays valid.
    const rewriteType = rewrites.get(details.requestId);
    if (!state.enabled && !rewriteType) return undefined;

    pageStore.observeRequest(details);
    const type = mapResourceType(details.type);
    // For a main document the response itself is the scope; for subresources
    // the embedding page is.
    const documentUrl = type === 'document' ? details.url : pageStore.documentUrlFor(details);
    const disabled = siteDisabled(safeHost(documentUrl));
    if (disabled && !rewriteType) return undefined;

    let headers = details.responseHeaders || [];
    let changed = false;
    if (rewriteType && typeof RewriteResources !== 'undefined') {
      headers = RewriteResources.withHeaders(headers, rewriteType);
      changed = true;
    }

    if (state.enabled && !disabled) {
      if (state.blockCspReports) {
        const stripped = stripCspReportDirectives(headers, details.url);
        if (stripped !== headers) { headers = stripped; changed = true; }
      }
      if (engine.capabilities & FilterEngine.CAP.REMOVEHEADER) {
        const rh = measuredMatch('removeheader-response', () => engine.matchRemoveheader(details.url, type, documentUrl));
        if (rh.headers.length) {
          const next = removeHeaders(headers, rh.headers, 'response');
          if (next !== headers) { headers = next; changed = true; }
        }
      }
      const result = measuredMatch('csp', () => engine.matchCsp(details.url, type, documentUrl));
      if (result.directives.length) {
        headers = CspResources.withDirective(headers, result.directives);
        changed = true;
      }
    }
    return changed ? { responseHeaders: headers } : undefined;
  }

  function onPopupNavigation(details) {
    if (!state.enabled) return;
    const sourceUrl = pageStore.urlForFrame(details.sourceTabId, details.sourceFrameId) ||
      pageStore.urlForFrame(details.sourceTabId, 0) ||
      '';
    if (sourceUrl) pageStore.markPopup(details.tabId, sourceUrl);
    if (!sourceUrl || siteDisabled(safeHost(sourceUrl))) return;

    const result = engine.matchPopup(details.url, sourceUrl);
    if (!result.blocked) return;

    pageStore.markPopupBlocked(details.tabId);
    if (!countPopupBlock(details.tabId, sourceUrl)) return;
    browser.tabs.remove(details.tabId).catch(error =>
      console.warn('WildFire: popup close failed', error));
  }

  async function onMessage(message, sender) {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('wildfire:')) {
      return undefined;
    }
    if (!ready) await readyPromise;

    const action = message.type.slice('wildfire:'.length);
    const payload = snapshot();

    switch (action) {
      case 'state': {
        const url = message.url || (sender.tab && sender.tab.url) || '';
        const host = safeHost(url);
        const site = siteKey(host);
        payload.site = {
          url,
          host,
          site,
          blocked: site ? countForSite(site) : 0,
          disabled: siteDisabled(host)
        };
        return payload;
      }

      case 'toggle':
        return persist({ enabled: !state.enabled });

      case 'toggle-site': {
        const host = safeHost(message.host || message.url || '');
        if (!host) return payload;
        const list = Array.isArray(state.disabledSites) ? state.disabledSites.slice() : [];
        const index = list.indexOf(host);
        if (index === -1) list.push(host);
        else list.splice(index, 1);
        return persist({ disabledSites: list });
      }

      case 'set-filters':
        await persist({ customFilters: String(message.value || '') });
        await loadFilters();
        return snapshot();

      case 'set-csp-report-blocking': {
        const result = await persist({ blockCspReports: Boolean(message.value) });
        ensureHeadersListener();
        return result;
      }

      case 'set-csp-report-allow':
        return persist({ cspReportAllow: parseHostList(message.value) });

      case 'reset-stats':
        pageStore.resetBlocked();
        return persist({ blocked: 0, blockedBySite: {} });

      case 'reload':
        await loadFilters();
        return snapshot();

      case 'suggested-lists':
        return { suggested: WildFireSuggestedLists.all() };

      case 'list-state':
        payload.lists = (await remoteLists.get()).lists;
        return payload;

      case 'add-list':
        return applyRemoteResult(await remoteLists.add(message.url));

      case 'remove-list':
        return applyRemoteResult(await remoteLists.remove(message.url));

      case 'update-list': {
        const url = String(message.url || '');
        if (remoteUpdating.has(url)) {
          return Object.assign(snapshot(), {
            ok: false,
            error: 'Update already in progress.',
            lists: (await remoteLists.get()).lists
          });
        }
        remoteUpdating.add(url);
        try {
          return await applyRemoteResult(await remoteLists.update(message.url));
        } finally {
          remoteUpdating.delete(url);
        }
      }

      case 'set-list-enabled':
        return applyRemoteResult(await remoteLists.setEnabled(message.url, Boolean(message.value)));

      case 'set-list-auto':
        return applyRemoteResult(await remoteLists.setAutoUpdate(message.url, Boolean(message.value)));

      case 'cosmetic': {
        const tabId = sender.tab && sender.tab.id;
        const frame = pageStore.frameFor(tabId, sender.frameId);
        const url = message.url || (frame && frame.url) ||
          (sender.tab && sender.tab.url) || '';
        const host = safeHost(url);
        const hidePolicy = engine.getHidePolicy ? engine.getHidePolicy(url, 'document', url) : {};
        return {
          ok: true,
          selectors: engine.getCosmetic(host, hidePolicy),
          procedural: engine.getProcedural(host, hidePolicy),
          hidePolicy
        };
      }

      case 'diagnostics':
        if (message.reset === true) {
          diagnostics.phases = emptyPhaseStats();
          diagnostics.samples = [];
          resetObservations();
        }
        if (typeof message.value === 'boolean') {
          diagnostics.enabled = message.value;
          if (engine.setMatchStatsEnabled) engine.setMatchStatsEnabled(diagnostics.enabled);
        }
        return { ok: true, diagnostics: diagnosticsSnapshot() };

      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
  }

  let headersListenerRegistered = false;

  function ensureHeadersListener() {
    const cap = engine.getCapabilities ? engine.getCapabilities() : (engine.capabilities || 0);
    const needed = Boolean(state.blockCspReports) ||
      Boolean(cap & (FilterEngine.CAP.CSP |
        FilterEngine.CAP.REWRITE | FilterEngine.CAP.REMOVEHEADER)) || rewrites.size > 0;
    if (needed && !headersListenerRegistered) {
      browser.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        { urls: ['<all_urls>'] },
        ['blocking', 'responseHeaders']
      );
      headersListenerRegistered = true;
      return;
    }
    if (!needed && headersListenerRegistered) {
      if (typeof browser.webRequest.onHeadersReceived.removeListener === 'function') {
        browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
      }
      headersListenerRegistered = false;
    }
  }

  let removeHeaderListenerRegistered = false;

  function ensureRemoveHeaderListener() {
    if (removeHeaderListenerRegistered) return;
    if (!(engine.capabilities & FilterEngine.CAP.REMOVEHEADER)) return;
    browser.webRequest.onBeforeSendHeaders.addListener(
      onBeforeSendHeaders,
      { urls: ['<all_urls>'] },
      ['blocking', 'requestHeaders']
    );
    removeHeaderListenerRegistered = true;
  }

  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });

  async function init() {
    try {
      state = await WildFireStore.get();
      await loadFilters();
      try {
        await syncRemoteAlarm();
      } catch (error) {
        console.warn('WildFire: remote update schedule failed', error);
      }

      // Blocking stays always-on; header listeners are registered only when
      // loaded capabilities actually need them. loadFilters() keeps them in
      // sync as custom/remote rules change.
      compilerStatus.capabilities = engine.getCapabilities ? engine.getCapabilities() : 0;

      browser.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        { urls: ['<all_urls>'] },
        ['blocking']
      );
      browser.webRequest.onBeforeRequest.addListener(
        onCspReportRequest,
        { urls: ['<all_urls>'], types: ['csp_report'] },
        ['blocking']
      );

      ensureHeadersListener();
      ensureRemoveHeaderListener();

      browser.webRequest.onCompleted.addListener(details => {
        rewrites.delete(details.requestId);
        observeEtp(details);
      }, { urls: ['<all_urls>'] });
      browser.webRequest.onErrorOccurred.addListener(details => {
        rewrites.delete(details.requestId);
        observeEtp(details);
      }, { urls: ['<all_urls>'] });
      browser.webRequest.onBeforeRedirect.addListener(
        details => rewrites.delete(details.requestId),
        { urls: ['<all_urls>'] }
      );

      browser.runtime.onMessage.addListener(onMessage);

      if (browser.alarms && browser.alarms.onAlarm) {
        browser.alarms.onAlarm.addListener(alarm => {
          if (alarm.name !== 'wildfire-remote-update') return;
          runRemoteUpdates().catch(error =>
            console.warn('WildFire: remote update alarm failed', error));
        });
      }

      browser.webNavigation.onCreatedNavigationTarget.addListener(onPopupNavigation);
      const rememberNavigation = details => {
        pageStore.observeNavigation(details);
        if (details.frameId === 0) updateBadge(details.tabId);
      };
      browser.webNavigation.onCommitted.addListener(rememberNavigation);
      [browser.webNavigation.onReferenceFragmentUpdated,
        browser.webNavigation.onHistoryStateUpdated]
        .forEach(event => event.addListener(rememberNavigation));

      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const url = changeInfo.url || (changeInfo.status === 'complete' && tab && tab.url) || '';
        if (url) {
          pageStore.observeTab(tabId, url);
          updateBadge(tabId);
        }
        if (changeInfo.status === 'complete' && tab.url) {
          pageStore.observeTab(tabId, tab.url);
          refreshCosmeticForPage(tabId).catch(error =>
            console.warn('WildFire: cosmetic refresh failed', error));
        }
      });
      if (browser.tabs.onActivated && browser.tabs.onActivated.addListener) {
        browser.tabs.onActivated.addListener(activeInfo => {
          const tabId = activeInfo && activeInfo.tabId;
          if (tabId === undefined || tabId === null) return;
          const applyTab = tab => {
            const url = tab && (tab.pendingUrl || tab.url) || '';
            pageStore.observeTab(tabId, url);
            updateBadge(tabId);
          };
          if (typeof browser.tabs.get === 'function') {
            browser.tabs.get(tabId).then(applyTab).catch(() => updateBadge(tabId));
          } else {
            updateBadge(tabId);
          }
        });
      }
      browser.tabs.onRemoved.addListener(tabId => pageStore.forgetTab(tabId));

      updateBadge();
      ready = true;
      resolveReady();
    } catch (error) {
      console.error('WildFire: initialization failed', error);
    }
  }

  init();
})();

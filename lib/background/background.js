/* WildFire - Firefox-native background controller and lifecycle owner. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const DOMAIN_OPTIONS = {
    allowIPAddress: true,
    allowPlainSuffix: true,
    allowUnknownSuffix: true
  };

  function create(options) {
    const config = options || {};
    const browserApi = config.browserApi || global.browser;
    const globals = config.globals || {
      FilterEngine: global.FilterEngine,
      mapResourceType: global.mapResourceType,
      WildFireStore: global.WildFireStore,
      WildFirePageStore: global.WildFirePageStore,
      RemoteLists: global.RemoteLists,
      WildFireSuggestedLists: global.WildFireSuggestedLists,
      CspResources: global.CspResources,
      WildFireScriptlets: global.WildFireScriptlets,
      RedirectResources: global.RedirectResources,
      RewriteResources: global.RewriteResources,
      WildFireCompiler: global.WildFireCompiler,
      WildFireCompileCache: global.WildFireCompileCache
    };

    const ctx = {
      browserApi,
      globals,
      store: config.store || globals.WildFireStore,
      performance: global.performance,
      state: Object.assign({}, globals.WildFireStore.defaults),
      diagnostics: {
        enabled: false,
        phases: null,
        samples: []
      },
      etpObserved: {
        blocked: 0,
        byError: {},
        classified: 0,
        byFlag: {}
      },
      cspReportsObserved: {
        headersStripped: 0,
        requestsCancelled: 0
      },
      rewrites: new Map(),
      compileFlight: new Map(),
      remoteUpdating: new Set(),
      filterLoad: Promise.resolve(),
      remoteUpdate: Promise.resolve(),
      lastCustomHash: '',
      lastRemoteSignature: '',
      filterGeneration: 0,
      activeFilterGeneration: 0,
      compilerStatus: {
        lastMode: 'init',
        lastError: '',
        restarts: 0,
        lastEvent: '',
        lastAt: 0,
        capabilities: 0
      },
      startup: { ok: null, error: '', counts: {} },
      startupError: '',
      ready: false,
      flushTimer: null,
      scriptletRegistration: null,
      scriptletGeneration: 0,
      headersListenerRegistered: false,
      removeHeaderListenerRegistered: false,
      listeners: []
    };

    ctx.registrableDomain = host => {
      try {
        return browserApi.publicSuffix.getDomain(host, DOMAIN_OPTIONS) || '';
      } catch (error) {
        return '';
      }
    };

    ctx.engine = new globals.FilterEngine(
      ctx.registrableDomain,
      alias => globals.CspResources ? globals.CspResources.resolve(alias) : '',
      globals.WildFireScriptlets || null,
      alias => globals.RewriteResources ? globals.RewriteResources.hasAlias(alias) : false
    );
    ctx.pageStore = new globals.WildFirePageStore({
      siteForHost: host => ctx.siteKey(host),
      isDisabledHost: host => ctx.siteDisabled(host)
    });
    ctx.remoteLists = globals.RemoteLists.create({
      storage: browserApi.storage.local,
      fetchImpl: (url, options) => fetch(url, options),
      now: () => Date.now()
    });
    ctx.compiler = globals.WildFireCompiler && globals.WildFireCompiler.create
      ? globals.WildFireCompiler.create({ browserApi, timeoutMs: 15000 })
      : null;
    ctx.compileCache = globals.WildFireCompileCache && globals.WildFireCompileCache.create
      ? globals.WildFireCompileCache.create({
        browserApi,
        version: globals.FilterEngine.COMPILED_VERSION
      })
      : null;

    if (ctx.compiler && typeof ctx.compiler.on === 'function') {
      ctx.compiler.on(event => {
        ctx.compilerStatus.lastEvent = event && event.type || 'unknown';
        ctx.compilerStatus.lastAt = Date.now();
        if (event && event.type === 'restart') ctx.compilerStatus.restarts += 1;
        if (event && event.error) {
          ctx.compilerStatus.lastError = String(event.error.message || event.error);
        }
        if (event && ['compiled', 'fallback', 'worker-error', 'restart'].includes(event.type)) {
          console.debug('WildFire: compiler', event.type, event);
        }
      });
    }

    let resolveReady;
    ctx.readyPromise = new Promise(resolve => { resolveReady = resolve; });

    function addListener(event, listener, filter, extra) {
      if (!event || typeof event.addListener !== 'function') return false;
      if (filter === undefined) event.addListener(listener);
      else if (extra === undefined) event.addListener(listener, filter);
      else event.addListener(listener, filter, extra);
      ctx.listeners.push({ event, listener });
      return true;
    }

    function removeListener(event, listener) {
      if (event && typeof event.removeListener === 'function') event.removeListener(listener);
      ctx.listeners = ctx.listeners.filter(entry =>
        !(entry.event === event && entry.listener === listener));
    }

    function ensureHeadersListener() {
      const cap = ctx.engine.getCapabilities
        ? ctx.engine.getCapabilities() : (ctx.engine.capabilities || 0);
      const needed = Boolean(ctx.state.blockCspReports) ||
        Boolean(cap & (globals.FilterEngine.CAP.CSP |
          globals.FilterEngine.CAP.REWRITE | globals.FilterEngine.CAP.REMOVEHEADER)) ||
        ctx.rewrites.size > 0;
      const event = browserApi.webRequest && browserApi.webRequest.onHeadersReceived;
      if (needed && !ctx.headersListenerRegistered) {
        addListener(event, ctx.onHeadersReceived,
          { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);
        ctx.headersListenerRegistered = true;
        return;
      }
      if (!needed && ctx.headersListenerRegistered) {
        removeListener(event, ctx.onHeadersReceived);
        ctx.headersListenerRegistered = false;
      }
    }

    function ensureRemoveHeaderListener() {
      if (ctx.removeHeaderListenerRegistered) return;
      if (!(ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEHEADER)) return;
      addListener(browserApi.webRequest && browserApi.webRequest.onBeforeSendHeaders,
        ctx.onBeforeSendHeaders, { urls: ['<all_urls>'] }, ['blocking', 'requestHeaders']);
      ctx.removeHeaderListenerRegistered = true;
    }

    Object.assign(ctx, core.createHelpers(ctx));
    ctx.ensureHeadersListener = ensureHeadersListener;
    ctx.ensureRemoveHeaderListener = ensureRemoveHeaderListener;
    Object.assign(ctx, core.createEngineHost(ctx));
    Object.assign(ctx, core.createRequests(ctx));
    ctx.onMessage = core.createMessages(ctx);
    ctx.diagnostics.phases = ctx.emptyPhaseStats();

    let started = false;

    function registerStaticListeners() {
      const wr = browserApi.webRequest;
      const wn = browserApi.webNavigation;
      const tabs = browserApi.tabs;
      const required = [
        ['webRequest.onBeforeRequest', wr && wr.onBeforeRequest],
        ['webRequest.onCompleted', wr && wr.onCompleted],
        ['webRequest.onErrorOccurred', wr && wr.onErrorOccurred],
        ['webRequest.onBeforeRedirect', wr && wr.onBeforeRedirect],
        ['runtime.onMessage', browserApi.runtime && browserApi.runtime.onMessage],
        ['webNavigation.onCreatedNavigationTarget', wn && wn.onCreatedNavigationTarget],
        ['webNavigation.onCommitted', wn && wn.onCommitted],
        ['webNavigation.onReferenceFragmentUpdated', wn && wn.onReferenceFragmentUpdated],
        ['webNavigation.onHistoryStateUpdated', wn && wn.onHistoryStateUpdated],
        ['tabs.onUpdated', tabs && tabs.onUpdated],
        ['tabs.onRemoved', tabs && tabs.onRemoved]
      ];
      if (browserApi.alarms) {
        required.push(['alarms.onAlarm', browserApi.alarms.onAlarm]);
      }
      required.forEach(([name, event]) => {
        if (!event || typeof event.addListener !== 'function') {
          throw new Error('Missing required browser API: ' + name);
        }
      });

      addListener(wr && wr.onBeforeRequest, ctx.onBeforeRequest,
        { urls: ['<all_urls>'] }, ['blocking']);
      addListener(wr && wr.onBeforeRequest, ctx.onCspReportRequest,
        { urls: ['<all_urls>'], types: ['csp_report'] }, ['blocking']);
      ensureHeadersListener();
      ensureRemoveHeaderListener();

      addListener(wr && wr.onCompleted, details => {
        ctx.rewrites.delete(details.requestId);
        ctx.observeEtp(details);
      }, { urls: ['<all_urls>'] });
      addListener(wr && wr.onErrorOccurred, details => {
        ctx.rewrites.delete(details.requestId);
        ctx.observeEtp(details);
      }, { urls: ['<all_urls>'] });
      addListener(wr && wr.onBeforeRedirect,
        details => ctx.rewrites.delete(details.requestId), { urls: ['<all_urls>'] });

      addListener(browserApi.runtime && browserApi.runtime.onMessage, ctx.onMessage);

      if (browserApi.alarms && browserApi.alarms.onAlarm) {
        addListener(browserApi.alarms.onAlarm, alarm => {
          if (alarm.name !== 'wildfire-remote-update') return;
          ctx.runRemoteUpdates().catch(error =>
            console.warn('WildFire: remote update alarm failed', error));
        });
      }

      addListener(browserApi.webNavigation && browserApi.webNavigation.onCreatedNavigationTarget,
        ctx.onPopupNavigation);
      const rememberNavigation = details => {
        ctx.pageStore.observeNavigation(details);
        if (details.frameId === 0) ctx.updateBadge(details.tabId);
      };
      addListener(browserApi.webNavigation && browserApi.webNavigation.onCommitted,
        rememberNavigation);
      [browserApi.webNavigation && browserApi.webNavigation.onReferenceFragmentUpdated,
        browserApi.webNavigation && browserApi.webNavigation.onHistoryStateUpdated]
        .forEach(event => addListener(event, rememberNavigation));

      addListener(browserApi.tabs && browserApi.tabs.onUpdated,
        (tabId, changeInfo, tab) => {
          const url = changeInfo.url ||
            (changeInfo.status === 'complete' && tab && tab.url) || '';
          if (url) {
            ctx.pageStore.observeTab(tabId, url);
            ctx.updateBadge(tabId);
          }
          if (changeInfo.status === 'complete' && tab.url) {
            ctx.pageStore.observeTab(tabId, tab.url);
            ctx.refreshCosmeticForPage(tabId).catch(error =>
              console.warn('WildFire: cosmetic refresh failed', error));
          }
        });

      if (browserApi.tabs && browserApi.tabs.onActivated &&
          browserApi.tabs.onActivated.addListener) {
        addListener(browserApi.tabs.onActivated, activeInfo => {
          const tabId = activeInfo && activeInfo.tabId;
          if (tabId === undefined || tabId === null) return;
          const applyTab = tab => {
            const url = tab && (tab.pendingUrl || tab.url) || '';
            ctx.pageStore.observeTab(tabId, url);
            ctx.updateBadge(tabId);
          };
          if (typeof browserApi.tabs.get === 'function') {
            browserApi.tabs.get(tabId).then(applyTab).catch(() => ctx.updateBadge(tabId));
          } else {
            ctx.updateBadge(tabId);
          }
        });
      }

      addListener(browserApi.tabs && browserApi.tabs.onRemoved,
        tabId => ctx.pageStore.forgetTab(tabId));
    }

    async function start() {
      if (started) return ctx.readyPromise;
      started = true;
      try {
        // Register the message and blocking listeners before any async work so a
        // storage or filter failure still leaves a responsive, safe extension.
        registerStaticListeners();
        ctx.state = await ctx.store.get();
        await ctx.loadFilters();
        try {
          await ctx.syncRemoteAlarm();
        } catch (error) {
          console.warn('WildFire: remote update schedule failed', error);
        }
        const health = ctx.engineHealth();
        ctx.startup = {
          ok: health.ok,
          error: health.ok ? '' : 'No filters loaded',
          total: health.total,
          counts: health.counts,
          capabilities: health.capabilities
        };
        ensureHeadersListener();
        ctx.updateBadge();
        ctx.ready = true;
      } catch (error) {
        const health = ctx.engineHealth();
        ctx.startupError = String(error && error.message || error);
        ctx.startup = {
          ok: false,
          error: ctx.startupError,
          total: health.total,
          counts: health.counts,
          capabilities: health.capabilities
        };
        console.error('WildFire: initialization failed', error);
      } finally {
        resolveReady();
      }
      return ctx.readyPromise;
    }

    function debug() {
      return {
        start,
        engine: ctx.engine,
        pageStore: ctx.pageStore,
        remoteLists: ctx.remoteLists,
        compiler: ctx.compiler,
        compileCache: ctx.compileCache,
        compileText: ctx.compileText,
        loadFilters: ctx.loadFilters,
        getState: () => ctx.state,
        setState: patch => { ctx.state = Object.assign({}, ctx.state, patch); },
        getStartup: () => Object.assign({}, ctx.startup),
        getListenerCount: () => ctx.listeners.length,
        onMessage: ctx.onMessage
      };
    }

    return { start, debug, context: ctx };
  }

  global.WildFireBackground = { create };

  // Exposed for focused module tests without importing a module graph.
  core.create = create;
})(this);

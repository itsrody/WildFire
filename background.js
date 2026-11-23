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
  const documentScope = new DocumentScope();
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
  const blockedPopups = new Set();
  // tabId -> source document URL for popups created by another browsing context.
  // onCreatedNavigationTarget gives us the source; onBeforeRequest gives us a
  // synchronous blocking point for the popup's main-frame request.
  const popupSources = new Map();
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

  function formatCount(value) {
    if (value < 1000) return String(value);
    if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 'k';
    return (value / 1000000).toFixed(1) + 'm';
  }

  function updateBadge() {
    browser.browserAction.setBadgeBackgroundColor({ color: state.enabled ? '#e2511d' : '#777777' });
    browser.browserAction.setBadgeText({ text: state.enabled ? formatCount(state.blocked || 0) : '' });
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

  function snapshot() {
    return {
      state: {
        enabled: state.enabled,
        blocked: state.blocked,
        customFilters: state.customFilters,
        disabledSites: state.disabledSites
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

  async function compileText(text, meta, generation, forceSync) {
    const source = String(text || '');
    if (!source.trim()) return null;

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
          { file: 'lib/scriptlets.js' },
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

  async function sendCosmetic(tabId, url) {
    const host = safeHost(url);
    if (!host) return;
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'wildfire:apply',
        selectors: engine.getCosmetic(host),
        procedural: engine.getProcedural(host)
      });
    } catch (error) {
      /* No content script in that tab/frame - safe to ignore. */
    }
  }

  async function refreshAllCosmetic() {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(tab => tab.url ? sendCosmetic(tab.id, tab.url) : Promise.resolve()));
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
    return popupSources.get(details.tabId) ||
      details.openerTabId && documentScope.urlForFrame(details.openerTabId, 0) ||
      documentScope.documentUrl(details) ||
      '';
  }

  function countPopupBlock(tabId) {
    if (blockedPopups.has(tabId)) return false;
    blockedPopups.add(tabId);
    popupSources.delete(tabId);
    state.blocked = (state.blocked || 0) + 1;
    updateBadge();
    scheduleFlush();
    return true;
  }

  function onBeforeRequest(details) {
    documentScope.rememberFromRequest(details);
    if (!state.enabled || blockedPopups.has(details.tabId)) return undefined;

    const documentUrl = documentScope.documentUrl(details);

    const host = safeHost(documentUrl);
    if (siteDisabled(host)) return undefined;

    const type = mapResourceType(details.type);
    if (type === 'document' && popupSources.has(details.tabId)) {
      const sourceUrl = popupSource(details);
      if (!siteDisabled(safeHost(sourceUrl))) {
        const popup = engine.matchPopup(details.url, sourceUrl);
        if (popup.blocked) {
          countPopupBlock(details.tabId);
          return { cancel: true };
        }
      }
      popupSources.delete(details.tabId);
    }

    const result = engine.matchRequest(details.url, type, documentUrl);
    if (!result.blocked) return undefined;

    const rewrite = result.rewrite && type !== 'document' &&
      typeof RewriteResources !== 'undefined'
      ? RewriteResources.resolve(result.rewrite.alias)
      : null;

    // Only WildFire-owned data-URI resources can be served, and never for
    // navigations. An unknown alias falls back to a plain cancel.
    const redirectUrl = type !== 'document' && result.redirect &&
      typeof RedirectResources !== 'undefined'
      ? RedirectResources.resolve(result.redirect.alias, result.redirect.captures)
      : '';

    state.blocked = (state.blocked || 0) + 1;
    updateBadge();
    scheduleFlush();
    if (rewrite) {
      return startRewrite(details.requestId, rewrite) ? undefined : { cancel: true };
    }
    return redirectUrl ? { redirectUrl } : { cancel: true };
  }

  // Firefox applies every CSP header independently, so adding a curated
  // WildFire header tightens a response without rewriting the site's headers.
  // This listener is synchronous, like onBeforeRequest.
  function onHeadersReceived(details) {
    if (details.type === 'csp_report') return undefined;
    // A rewrite stream may already exist even if the user just paused the
    // extension; its headers still need normalizing so the body stays valid.
    const rewriteType = rewrites.get(details.requestId);
    if (!state.enabled && !rewriteType) return undefined;

    const type = mapResourceType(details.type);
    // For a main document the response itself is the scope; for subresources
    // the embedding page is.
    const documentUrl = type === 'document' ? details.url : documentScope.documentUrl(details);
    const disabled = siteDisabled(safeHost(documentUrl));
    if (disabled && !rewriteType) return undefined;

    const result = state.enabled && !disabled
      ? engine.matchCsp(details.url, type, documentUrl)
      : { directives: [] };
    let headers = details.responseHeaders || [];
    let changed = false;
    if (rewriteType && typeof RewriteResources !== 'undefined') {
      headers = RewriteResources.withHeaders(headers, rewriteType);
      changed = true;
    }
    if (result.directives.length) {
      headers = CspResources.withDirective(headers, result.directives);
      changed = true;
    }
    return changed ? { responseHeaders: headers } : undefined;
  }

  function onPopupNavigation(details) {
    if (!state.enabled) return;
    const sourceUrl = documentScope.urlForFrame(details.sourceTabId, details.sourceFrameId) ||
      documentScope.urlForFrame(details.sourceTabId, 0) ||
      '';
    if (sourceUrl) popupSources.set(details.tabId, sourceUrl);
    if (!sourceUrl || siteDisabled(safeHost(sourceUrl))) return;

    const result = engine.matchPopup(details.url, sourceUrl);
    if (!result.blocked) return;

    if (!countPopupBlock(details.tabId)) return;
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
      case 'state':
        payload.site = {
          url: message.url || (sender.tab && sender.tab.url) || '',
          host: safeHost(message.url || (sender.tab && sender.tab.url) || ''),
          disabled: siteDisabled(safeHost(message.url || (sender.tab && sender.tab.url) || ''))
        };
        return payload;

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

      case 'reset-stats':
        return persist({ blocked: 0 });

      case 'reload':
        await loadFilters();
        return snapshot();

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
        const host = safeHost(message.url || (sender.tab && sender.tab.url) || '');
        return {
          ok: true,
          selectors: engine.getCosmetic(host),
          procedural: engine.getProcedural(host)
        };
      }

      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
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

      // Capability-gated listener registration (Phase 0 foundation).
      // Core blocking/CSP listeners remain always-on for current supported features;
      // future removeparam/removeheader listeners should be registered only when
      // engine capabilities require them.
      const cap = engine.getCapabilities ? engine.getCapabilities() : 0;
      compilerStatus.capabilities = cap;

      browser.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        { urls: ['<all_urls>'] },
        ['blocking']
      );

      const needsHeaders = true || (cap & (FilterEngine.CAP.CSP | FilterEngine.CAP.REWRITE));
      if (needsHeaders) {
        browser.webRequest.onHeadersReceived.addListener(
          onHeadersReceived,
          { urls: ['<all_urls>'] },
          ['blocking', 'responseHeaders']
        );
      }

      [browser.webRequest.onCompleted,
        browser.webRequest.onErrorOccurred,
        browser.webRequest.onBeforeRedirect]
        .forEach(event => event.addListener(
          details => rewrites.delete(details.requestId),
          { urls: ['<all_urls>'] }
        ));

      browser.runtime.onMessage.addListener(onMessage);

      if (browser.alarms && browser.alarms.onAlarm) {
        browser.alarms.onAlarm.addListener(alarm => {
          if (alarm.name !== 'wildfire-remote-update') return;
          runRemoteUpdates().catch(error =>
            console.warn('WildFire: remote update alarm failed', error));
        });
      }

      browser.webNavigation.onCreatedNavigationTarget.addListener(onPopupNavigation);
      browser.webNavigation.onCommitted.addListener(details => documentScope.remember(details));
      [browser.webNavigation.onReferenceFragmentUpdated,
        browser.webNavigation.onHistoryStateUpdated]
        .forEach(event => event.addListener(details => documentScope.remember(details)));

      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.url) documentScope.remember({ tabId, frameId: 0, url: changeInfo.url });
        if (changeInfo.status === 'complete' && tab.url) sendCosmetic(tabId, tab.url);
      });
      browser.tabs.onRemoved.addListener(tabId => {
        documentScope.forgetTab(tabId);
        blockedPopups.delete(tabId);
        popupSources.delete(tabId);
      });

      updateBadge();
      ready = true;
      resolveReady();
    } catch (error) {
      console.error('WildFire: initialization failed', error);
    }
  }

  init();
})();

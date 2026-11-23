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
  const blockedPopups = new Set();
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
      counts: Object.assign({}, engine.counts)
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

  function splitScriptletPayload(rules) {
    const payload = { realmBirth: [], documentStart: [] };
    rules.forEach(rule => {
      const name = WildFireScriptlets.canonical(rule.alias, rule.syntax);
      if (!rule.isException && REALM_BIRTH_ALIASES.has(name)) payload.realmBirth.push(rule);
      else payload.documentStart.push(rule);
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

  async function loadFilters() {
    let bundled = '';
    try {
      const response = await fetch(browser.runtime.getURL('filters/default.txt'));
      if (response.ok) bundled = await response.text();
    } catch (error) {
      console.warn('WildFire: bundled filter list unavailable', error);
    }
    // Bundled rules first, then the user's own rules, then opted-in remote
    // lists. Exceptions still win regardless of where they were loaded.
    let remote = '';
    try {
      remote = await remoteLists.enabledText();
    } catch (error) {
      console.warn('WildFire: remote list store unavailable', error);
    }
    engine.load(bundled + '\n' + (state.customFilters || '') + '\n' + remote);
    await refreshAllCosmetic();
    await syncScriptlets();
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

  async function applyRemoteResult(result) {
    if (!result.ok) {
      return { ok: false, error: result.error, lists: result.snapshot.lists };
    }
    await loadFilters();
    try {
      await syncRemoteAlarm();
    } catch (error) {
      console.warn('WildFire: remote update schedule failed', error);
    }
    return Object.assign(snapshot(), { ok: true, lists: result.snapshot.lists });
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

  function onBeforeRequest(details) {
    documentScope.rememberFromRequest(details);
    if (!state.enabled || blockedPopups.has(details.tabId)) return undefined;

    const documentUrl = documentScope.documentUrl(details);

    const host = safeHost(documentUrl);
    if (siteDisabled(host)) return undefined;

    const type = mapResourceType(details.type);
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
    const sourceUrl = documentScope.urlForFrame(details.sourceTabId, details.sourceFrameId);
    if (siteDisabled(safeHost(sourceUrl))) return;

    const result = engine.matchPopup(details.url, sourceUrl);
    if (!result.blocked) return;

    blockedPopups.add(details.tabId);
    state.blocked = (state.blocked || 0) + 1;
    updateBadge();
    scheduleFlush();
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

      case 'update-list':
        return applyRemoteResult(await remoteLists.update(message.url));

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

      browser.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        { urls: ['<all_urls>'] },
        ['blocking']
      );

      browser.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        { urls: ['<all_urls>'] },
        ['blocking', 'responseHeaders']
      );

      [browser.webRequest.onCompleted,
        browser.webRequest.onErrorOccurred,
        browser.webRequest.onBeforeRedirect]
        .forEach(event => event.addListener(
          details => rewrites.delete(details.requestId),
          { urls: ['<all_urls>'] }
        ));

      browser.runtime.onMessage.addListener(onMessage);

      if (browser.alarms && browser.alarms.onAlarm) {
        browser.alarms.onAlarm.addListener(async alarm => {
          if (alarm.name !== 'wildfire-remote-update') return;
          const due = (await remoteLists.get()).lists
            .filter(entry => entry.autoUpdate && entry.enabled && entry.text);
          const results = await Promise.all(due.map(entry => remoteLists.update(entry.url)));
          if (results.some(entry => entry.ok)) await loadFilters();
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

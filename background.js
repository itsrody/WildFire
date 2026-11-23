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

  const engine = new FilterEngine(registrableDomain);
  const documentScope = new DocumentScope();
  let state = Object.assign({}, WildFireStore.defaults);
  let flushTimer = null;
  let ready = false;

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

  async function loadFilters() {
    let bundled = '';
    try {
      const response = await fetch(browser.runtime.getURL('filters/default.txt'));
      if (response.ok) bundled = await response.text();
    } catch (error) {
      console.warn('WildFire: bundled filter list unavailable', error);
    }
    engine.load(bundled + '\n' + (state.customFilters || ''));
    await refreshAllCosmetic();
  }

  async function sendCosmetic(tabId, url) {
    const host = safeHost(url);
    if (!host) return;
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'wildfire:apply',
        selectors: engine.getCosmetic(host)
      });
    } catch (error) {
      /* No content script in that tab/frame - safe to ignore. */
    }
  }

  async function refreshAllCosmetic() {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(tab => tab.url ? sendCosmetic(tab.id, tab.url) : Promise.resolve()));
  }

  function onBeforeRequest(details) {
    documentScope.rememberFromRequest(details);
    if (!state.enabled || details.type === 'main_frame') return undefined;

    const documentUrl = documentScope.documentUrl(details);

    const host = safeHost(documentUrl);
    if (siteDisabled(host)) return undefined;

    const result = engine.matchRequest(details.url, mapResourceType(details.type), documentUrl);
    if (!result.blocked) return undefined;

    state.blocked = (state.blocked || 0) + 1;
    updateBadge();
    scheduleFlush();
    return { cancel: true };
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

      case 'cosmetic':
        return {
          ok: true,
          selectors: engine.getCosmetic(safeHost(message.url || (sender.tab && sender.tab.url) || ''))
        };

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

      browser.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        { urls: ['<all_urls>'] },
        ['blocking']
      );

      browser.runtime.onMessage.addListener(onMessage);

      browser.webNavigation.onCommitted.addListener(details => documentScope.remember(details));
      [browser.webNavigation.onReferenceFragmentUpdated,
        browser.webNavigation.onHistoryStateUpdated]
        .forEach(event => event.addListener(details => documentScope.remember(details)));

      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.url) documentScope.remember({ tabId, frameId: 0, url: changeInfo.url });
        if (changeInfo.status === 'complete' && tab.url) sendCosmetic(tabId, tab.url);
      });
      browser.tabs.onRemoved.addListener(tabId => documentScope.forgetTab(tabId));

      updateBadge();
      ready = true;
      resolveReady();
    } catch (error) {
      console.error('WildFire: initialization failed', error);
    }
  }

  init();
})();

/* WildFire - Firefox-native tab and navigation adapter built on the wapi. */
(function (global) {
  'use strict';

  const REQUIRED_EVENTS = [
    ['webNavigation.onCreatedNavigationTarget', 'onCreatedNavigationTarget'],
    ['webNavigation.onCommitted', 'onCommitted'],
    ['webNavigation.onReferenceFragmentUpdated', 'onReferenceFragmentUpdated'],
    ['webNavigation.onHistoryStateUpdated', 'onHistoryStateUpdated'],
    ['tabs.onUpdated', 'onUpdated'],
    ['tabs.onRemoved', 'onRemoved']
  ];
  const ALL_EVENTS = REQUIRED_EVENTS
    .map(entry => entry[0])
    .concat('tabs.onActivated');

  const api = global.WildFireWapiTabs = global.WildFireWapiTabs || {};
  try { global.wapiTabs = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const pageStore = config.pageStore;
    const hooks = config.hooks || {};
    const browserApi = config.browserApi || (wapi && wapi.browser);
    const webNavigation = browserApi && browserApi.webNavigation;
    const tabs = browserApi && browserApi.tabs;
    let registered = false;

    function eventFor(name) {
      const parts = name.split('.');
      const owner = parts[0] === 'webNavigation' ? webNavigation : tabs;
      return owner && owner[parts[1]];
    }

    function urlOf(tab) {
      return tab && (tab.pendingUrl || tab.url) || '';
    }

    function observeNavigation(details) {
      if (pageStore && typeof pageStore.observeNavigation === 'function') {
        pageStore.observeNavigation(details);
      }
      if (details && details.frameId === 0 &&
          typeof hooks.onTopLevelNavigation === 'function') {
        hooks.onTopLevelNavigation(details.tabId);
      }
    }

    function observeTab(tabId, url, notify) {
      if (pageStore && typeof pageStore.observeTab === 'function') {
        pageStore.observeTab(tabId, url);
      }
      if (notify !== false && typeof hooks.onTabUrl === 'function') {
        hooks.onTabUrl(tabId, url);
      }
    }

    function onUpdated(tabId, changeInfo, tab) {
      const info = changeInfo || {};
      const url = info.url || (info.status === 'complete' && tab && tab.url) || '';
      if (url) observeTab(tabId, url);
      if (info.status === 'complete' && tab && tab.url) {
        observeTab(tabId, tab.url, false);
        if (typeof hooks.onTabComplete === 'function') hooks.onTabComplete(tabId, tab.url);
      }
    }

    function onActivated(activeInfo) {
      const tabId = activeInfo && activeInfo.tabId;
      if (tabId === undefined || tabId === null) return;
      wapi.tabs.get(tabId).then(tab => {
        observeTab(tabId, urlOf(tab));
      }).catch(() => {
        if (typeof hooks.onTabActivated === 'function') hooks.onTabActivated(tabId);
      });
    }

    function onRemoved(tabId) {
      if (pageStore && typeof pageStore.forgetTab === 'function') {
        pageStore.forgetTab(tabId);
      }
      if (typeof hooks.onTabRemoved === 'function') hooks.onTabRemoved(tabId);
    }

    function validate() {
      REQUIRED_EVENTS.forEach(entry => wapi.events.require(entry[0], eventFor(entry[0])));
      return true;
    }

    function register() {
      if (registered) return false;
      validate();
      wapi.events.add('webNavigation.onCreatedNavigationTarget',
        eventFor('webNavigation.onCreatedNavigationTarget'), details => {
          if (typeof hooks.onPopupNavigation === 'function') hooks.onPopupNavigation(details);
        }, { required: true });
      wapi.events.add('webNavigation.onCommitted',
        eventFor('webNavigation.onCommitted'), observeNavigation, { required: true });
      ['webNavigation.onReferenceFragmentUpdated', 'webNavigation.onHistoryStateUpdated']
        .forEach(name => wapi.events.add(name, eventFor(name), observeNavigation,
          { required: true }));
      wapi.events.add('tabs.onUpdated', eventFor('tabs.onUpdated'), onUpdated,
        { required: true });
      wapi.events.add('tabs.onRemoved', eventFor('tabs.onRemoved'), onRemoved,
        { required: true });
      const activated = eventFor('tabs.onActivated');
      if (activated && typeof activated.addListener === 'function') {
        wapi.events.add('tabs.onActivated', activated, onActivated);
      }
      registered = true;
      return true;
    }

    function unregister() {
      ALL_EVENTS.forEach(name => wapi.events.remove(name));
      registered = false;
      return true;
    }

    return {
      validate,
      register,
      unregister,
      observeNavigation,
      observeTab,
      urlOf,
      names: () => ALL_EVENTS.slice(),
      get registered() { return registered; }
    };
  }

  api.create = create;
})(this);

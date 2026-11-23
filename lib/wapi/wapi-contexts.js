/* WildFire - content script context registry built on the Firefox-native wapi. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiContexts = global.WildFireWapiContexts || {};
  try { global.wapiContexts = api; } catch (error) { /* the canonical global still works */ }

  function key(tabId, frameId) {
    return String(tabId) + ':' + String(frameId);
  }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const contexts = new Map();

    function observe(message, sender) {
      if (!sender || !sender.tab || sender.tab.id === undefined || sender.tab.id === null) {
        return null;
      }
      const tabId = sender.tab.id;
      const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
      const id = key(tabId, frameId);
      const url = String((message && message.url) || sender.tab.url || sender.url || '');
      const previous = contexts.get(id);
      const context = {
        tabId,
        frameId,
        url,
        messages: (previous ? previous.messages : 0) + 1,
        seenAt: Date.now()
      };
      contexts.set(id, context);
      return Object.assign({}, context);
    }

    function find(tabId, frameId) {
      const context = contexts.get(key(tabId, typeof frameId === 'number' ? frameId : 0));
      return context ? Object.assign({}, context) : null;
    }

    function framesForTab(tabId) {
      return Array.from(contexts.values())
        .filter(context => context.tabId === tabId)
        .map(context => ({ frameId: context.frameId, url: context.url }));
    }

    function forgetFrame(tabId, frameId) {
      return contexts.delete(key(tabId, typeof frameId === 'number' ? frameId : 0));
    }

    function forgetTab(tabId) {
      const prefix = String(tabId) + ':';
      Array.from(contexts.keys())
        .filter(id => id.startsWith(prefix))
        .forEach(id => contexts.delete(id));
    }

    function send(tabId, frameId, payload) {
      const options = typeof frameId === 'number' ? { frameId } : undefined;
      return wapi.tabs.send(tabId, payload, options);
    }

    function sendContext(context, payload) {
      return context ? send(context.tabId, context.frameId, payload) : Promise.resolve();
    }

    function broadcast(payload) {
      return Promise.all(Array.from(contexts.values()).map(context =>
        sendContext(context, payload)));
    }

    function snapshot() {
      return Array.from(contexts.values()).map(context => Object.assign({}, context));
    }

    return {
      observe,
      find,
      framesForTab,
      forgetFrame,
      forgetTab,
      send,
      sendContext,
      broadcast,
      snapshot,
      size: () => contexts.size
    };
  }

  api.create = create;
})(this);

/* WildFire - client-side message backbone for extension pages and content scripts.
 * Classic-script module. Uses Firefox's promise-based runtime messaging only. */
(function (global) {
  'use strict';

  const DEFAULT_PREFIX = 'wildfire:';
  const api = global.WildFireWapiClient = global.WildFireWapiClient || {};
  try { global.wapiClient = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const browserApi = config.browserApi || global.browser;
    const runtime = browserApi && browserApi.runtime;
    const prefix = config.prefix || DEFAULT_PREFIX;
    const handlers = new Map();
    const listeners = new Set();
    let router = null;

    function fullType(action) {
      const name = action === undefined || action === null ? '' : String(action);
      if (!name) throw new Error('WildFire client: missing message action');
      return name.startsWith(prefix) ? name : prefix + name;
    }

    function send(action, payload) {
      const message = Object.assign({}, payload || {}, { type: fullType(action) });
      if (!runtime || typeof runtime.sendMessage !== 'function') {
        return Promise.reject(new Error('Missing required browser API: runtime.sendMessage'));
      }
      return Promise.resolve(runtime.sendMessage(message));
    }

    function openOptions() {
      if (!runtime || typeof runtime.openOptionsPage !== 'function') {
        return Promise.reject(new Error('Missing required browser API: runtime.openOptionsPage'));
      }
      return Promise.resolve(runtime.openOptionsPage());
    }

    function ensureRouter() {
      if (router) return;
      const event = runtime && runtime.onMessage;
      if (!event || typeof event.addListener !== 'function') {
        throw new Error('Missing required browser API: runtime.onMessage');
      }
      router = (message, sender) => {
        if (!message || typeof message.type !== 'string' || !message.type.startsWith(prefix)) {
          return undefined;
        }
        const action = message.type.slice(prefix.length);
        const results = [];
        const specific = handlers.get(action);
        if (specific) results.push(...Array.from(specific).map(handler => handler(message, sender)));
        if (listeners.size) {
          results.push(...Array.from(listeners).map(listener => listener(message, sender)));
        }
        return results.find(value => value !== undefined);
      };
      event.addListener(router);
    }

    function on(action, handler) {
      if (typeof action !== 'string' || !action || typeof handler !== 'function') {
        throw new Error('WildFire client: on() requires an action and handler');
      }
      ensureRouter();
      if (!handlers.has(action)) handlers.set(action, new Set());
      handlers.get(action).add(handler);
      return () => off(action, handler);
    }

    function listen(handler) {
      if (typeof handler !== 'function') {
        throw new Error('WildFire client: listen() requires a handler');
      }
      ensureRouter();
      listeners.add(handler);
      return () => { listeners.delete(handler); };
    }

    function off(action, handler) {
      const specific = handlers.get(action);
      if (!specific) return false;
      const removed = specific.delete(handler);
      if (!specific.size) handlers.delete(action);
      return removed;
    }

    function close() {
      const event = runtime && runtime.onMessage;
      if (router && event && typeof event.removeListener === 'function') {
        event.removeListener(router);
      }
      router = null;
      handlers.clear();
      listeners.clear();
    }

    return {
      browser: browserApi,
      prefix,
      send,
      on,
      off,
      listen,
      close,
      openOptions
    };
  }

  api.create = create;
})(this);

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
    const ports = new Set();
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

    function connect(channel, handler) {
      const name = fullType(channel);
      if (typeof handler !== 'function') {
        throw new Error('WildFire client: connect() requires a handler');
      }
      if (!runtime || typeof runtime.connect !== 'function') {
        return { channel: name, connected: false, send() {}, close() {} };
      }
      const port = runtime.connect({ name });
      let closed = false;

      function deliver(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (typeof payload.type === 'string' && payload.type !== name) return;
        handler(payload);
      }

      const handle = {
        channel: name,
        port,
        connected: Boolean(port),
        send(payload) {
          if (!closed && port && typeof port.postMessage === 'function') {
            port.postMessage(payload);
          }
        },
        close() {
          if (closed) return;
          closed = true;
          handle.connected = false;
          if (port && port.onMessage && typeof port.onMessage.removeListener === 'function') {
            port.onMessage.removeListener(deliver);
          }
          if (port && typeof port.disconnect === 'function') port.disconnect();
          ports.delete(handle);
        }
      };
      ports.add(handle);
      if (port && port.onMessage && typeof port.onMessage.addListener === 'function') {
        port.onMessage.addListener(deliver);
      }
      if (port && port.onDisconnect && typeof port.onDisconnect.addListener === 'function') {
        port.onDisconnect.addListener(() => {
          closed = true;
          handle.connected = false;
          ports.delete(handle);
        });
      }
      return handle;
    }

    function close() {
      const event = runtime && runtime.onMessage;
      if (router && event && typeof event.removeListener === 'function') {
        event.removeListener(router);
      }
      Array.from(ports).forEach(handle => handle.close());
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
      connect,
      close,
      openOptions
    };
  }

  api.create = create;
})(this);

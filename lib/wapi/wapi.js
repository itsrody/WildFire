/* WildFire - Firefox-native API backbone.
 * Classic-script module. The browser object is Firefox's promise-based API;
 * there is no Chromium shim, callback bridge or cross-browser abstraction. */
(function (global) {
  'use strict';

  const DEFAULT_PREFIX = 'wildfire:';
  const api = global.WildFireWapi = global.WildFireWapi || {};
  try { global.wapi = api; } catch (error) { /* the canonical global still works */ }

  function asPromise(result) {
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  function withoutRejection(result) {
    return asPromise(result).catch(() => {});
  }

  function create(options) {
    const config = options || {};
    const browserApi = config.browserApi || global.browser;
    const prefix = config.prefix || DEFAULT_PREFIX;
    const listeners = new Map();
    let messageHandler = null;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });

    function eventAt(path) {
      return path.split('.').reduce((object, key) => object && object[key], browserApi);
    }

    function requireEvent(name, event) {
      const target = event || eventAt(name);
      if (!target || typeof target.addListener !== 'function') {
        throw new Error('Missing required browser API: ' + name);
      }
      return target;
    }

    function add(name, event, listener, options) {
      const opts = options || {};
      const target = opts.required ? requireEvent(name, event) : (event || eventAt(name));
      if (!target || typeof target.addListener !== 'function' || listeners.has(name)) return false;
      if (opts.filter === undefined) target.addListener(listener);
      else if (opts.extra === undefined) target.addListener(listener, opts.filter);
      else target.addListener(listener, opts.filter, opts.extra);
      listeners.set(name, { event: target, listener });
      return true;
    }

    function remove(name) {
      const entry = listeners.get(name);
      if (!entry) return false;
      if (typeof entry.event.removeListener === 'function') {
        entry.event.removeListener(entry.listener);
      }
      listeners.delete(name);
      return true;
    }

    function messages(handler) {
      if (typeof handler !== 'function' || messageHandler) return false;
      messageHandler = handler;
      const listener = (message, sender) => {
        if (!message || typeof message.type !== 'string' || !message.type.startsWith(prefix)) {
          return undefined;
        }
        return handler(message, sender);
      };
      return add('runtime.onMessage', eventAt('runtime.onMessage'), listener, { required: true });
    }

    function settle() {
      resolveReady();
      return ready;
    }

    function getURL(path) {
      return browserApi.runtime && typeof browserApi.runtime.getURL === 'function'
        ? browserApi.runtime.getURL(path) : String(path || '');
    }

    function filterResponseData(requestId) {
      return browserApi.webRequest && typeof browserApi.webRequest.filterResponseData === 'function'
        ? browserApi.webRequest.filterResponseData(requestId) : null;
    }

    function sendMessage(tabId, message, options) {
      const tabs = browserApi.tabs;
      if (!tabs || typeof tabs.sendMessage !== 'function') return Promise.resolve();
      return withoutRejection(options === undefined
        ? tabs.sendMessage(tabId, message)
        : tabs.sendMessage(tabId, message, options));
    }

    function removeTab(tabId) {
      const tabs = browserApi.tabs;
      return tabs && typeof tabs.remove === 'function'
        ? asPromise(tabs.remove(tabId)) : Promise.resolve();
    }

    function queryTabs(info) {
      const tabs = browserApi.tabs;
      return tabs && typeof tabs.query === 'function'
        ? asPromise(tabs.query(info || {})) : Promise.resolve([]);
    }

    function getTab(tabId) {
      const tabs = browserApi.tabs;
      return tabs && typeof tabs.get === 'function'
        ? asPromise(tabs.get(tabId)) : Promise.resolve(null);
    }

    function webRequestOn(eventPath, name, listener, filter, extra, required) {
      return add(name, eventAt(eventPath), listener, { filter, extra, required });
    }

    const alarms = browserApi.alarms;

    const instance = {
      browser: browserApi,
      prefix,
      ready,
      settle,
      getURL,
      events: {
        add,
        remove,
        require: requireEvent,
        count: () => listeners.size,
        has: name => listeners.has(name)
      },
      messages,
      runtime: { getURL },
      tabs: {
        query: queryTabs,
        get: getTab,
        send: sendMessage,
        remove: removeTab
      },
      alarms: {
        supported: Boolean(alarms && typeof alarms.clear === 'function' &&
          typeof alarms.get === 'function' && typeof alarms.create === 'function'),
        on(name, handler) {
          return add('alarms.onAlarm', alarms && alarms.onAlarm, alarm => {
            if (alarm && alarm.name === name) handler(alarm);
          });
        },
        clear(name) {
          return alarms && typeof alarms.clear === 'function'
            ? asPromise(alarms.clear(name)) : Promise.resolve();
        },
        get(name) {
          return alarms && typeof alarms.get === 'function'
            ? asPromise(alarms.get(name)) : Promise.resolve(null);
        },
        create(name, info) {
          return alarms && typeof alarms.create === 'function'
            ? asPromise(alarms.create(name, info)) : Promise.resolve();
        }
      },
      contentScripts: {
        supported: Boolean(browserApi.contentScripts &&
          typeof browserApi.contentScripts.register === 'function'),
        async register(options) {
          return browserApi.contentScripts && typeof browserApi.contentScripts.register === 'function'
            ? browserApi.contentScripts.register(options) : null;
        },
        async unregister(registration) {
          if (registration && typeof registration.unregister === 'function') {
            await registration.unregister();
          }
        }
      },
      webRequest: {
        filterResponseData,
        onBeforeRequest: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onBeforeRequest', name, listener, filter, extra, required),
        onBeforeSendHeaders: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onBeforeSendHeaders', name, listener, filter, extra, required),
        onHeadersReceived: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onHeadersReceived', name, listener, filter, extra, required),
        onCompleted: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onCompleted', name, listener, filter, extra, required),
        onErrorOccurred: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onErrorOccurred', name, listener, filter, extra, required),
        onBeforeRedirect: (name, listener, filter, extra, required) =>
          webRequestOn('webRequest.onBeforeRedirect', name, listener, filter, extra, required)
      }
    };
    return instance;
  }

  api.create = create;
  api.asPromise = asPromise;
})(this);

/* WildFire - Firefox capability and readiness surface built on the wapi. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiCapabilities = global.WildFireWapiCapabilities || {};
  try { global.wapiCapabilities = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const browserApi = config.browserApi || (wapi && wapi.browser) || global.browser;
    const publicSuffix = browserApi && browserApi.publicSuffix;
    const alarms = browserApi && browserApi.alarms;
    const contentScripts = browserApi && browserApi.contentScripts;
    const webRequest = browserApi && browserApi.webRequest;
    const runtime = browserApi && browserApi.runtime;
    const storage = browserApi && browserApi.storage && browserApi.storage.local;

    const CAPABILITIES = {
      runtime: Boolean(runtime && typeof runtime.getURL === 'function' && runtime.onMessage),
      publicSuffix: Boolean(publicSuffix && typeof publicSuffix.getDomain === 'function'),
      alarms: Boolean(alarms && typeof alarms.clear === 'function' &&
        typeof alarms.get === 'function' && typeof alarms.create === 'function'),
      contentScripts: Boolean(contentScripts && typeof contentScripts.register === 'function'),
      filterResponseData: Boolean(webRequest &&
        typeof webRequest.filterResponseData === 'function'),
      storage: Boolean(storage && typeof storage.get === 'function' &&
        typeof storage.set === 'function'),
      nativeBridge: Boolean(browserApi && browserApi.wildfireNative &&
        typeof browserApi.wildfireNative.setPayload === 'function')
    };

    function has(name) {
      return Boolean(CAPABILITIES[name]);
    }

    function snapshot() {
      return Object.assign({}, CAPABILITIES);
    }

    function validate(names) {
      const missing = (Array.isArray(names) ? names : []).filter(name => !has(name));
      if (missing.length) {
        throw new Error('Missing required WildFire capability: ' + missing.join(', '));
      }
      return true;
    }

    function domain(host, domainOptions) {
      if (!CAPABILITIES.publicSuffix) return '';
      try {
        return publicSuffix.getDomain(host, domainOptions) || '';
      } catch (error) {
        return '';
      }
    }

    function nativeBridge() {
      const bridge = browserApi && browserApi.wildfireNative;
      return bridge && typeof bridge.setPayload === 'function' ? bridge : null;
    }

    function settle() {
      return wapi && typeof wapi.settle === 'function' ? wapi.settle() : undefined;
    }

    return {
      browser: browserApi,
      prefix: wapi && wapi.prefix,
      ready: wapi && wapi.ready,
      settle,
      has,
      snapshot,
      validate,
      domain,
      nativeBridge,
      publicSuffix: { supported: CAPABILITIES.publicSuffix, getDomain: domain },
      alarms: {
        present: Boolean(alarms),
        supported: CAPABILITIES.alarms,
        event: alarms && alarms.onAlarm
      },
      contentScripts: { supported: CAPABILITIES.contentScripts },
      storage: { supported: CAPABILITIES.storage, local: storage },
      webRequest: { filterResponseDataSupported: CAPABILITIES.filterResponseData },
      runtime: {
        supported: CAPABILITIES.runtime,
        event: runtime && runtime.onMessage,
        getURL: runtime && typeof runtime.getURL === 'function'
          ? path => runtime.getURL(path) : null
      },
      native: { supported: CAPABILITIES.nativeBridge, get: nativeBridge }
    };
  }

  api.create = create;
})(this);

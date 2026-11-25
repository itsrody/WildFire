/* WildFire - Firefox-native webRequest plumbing built on the wapi. */
(function (global) {
  'use strict';

  const STATIC_EVENTS = [
    ['webRequest.onBeforeRequest', 'onBeforeRequest'],
    ['webRequest.onCompleted', 'onCompleted'],
    ['webRequest.onErrorOccurred', 'onErrorOccurred'],
    ['webRequest.onBeforeRedirect', 'onBeforeRedirect']
  ];
  const STATIC_NAMES = [
    'webRequest.beforeRequest',
    'webRequest.cspReport',
    'webRequest.completed',
    'webRequest.error',
    'webRequest.redirect'
  ];
  const DYNAMIC_NAMES = [
    'webRequest.onHeadersReceived',
    'webRequest.onBeforeSendHeaders'
  ];

  const api = global.WildFireWapiWebRequest = global.WildFireWapiWebRequest || {};
  try { global.wapiWebRequest = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const handlers = config.handlers || {};
    let registered = false;

    function validate() {
      STATIC_EVENTS.forEach(entry => wapi.events.require(entry[0], wapi.browser &&
        wapi.browser.webRequest && wapi.browser.webRequest[entry[1]]));
      return true;
    }

    function register(overrides) {
      if (registered) return false;
      validate();
      const h = Object.assign({}, handlers, overrides || {});
      wapi.webRequest.onBeforeRequest('webRequest.beforeRequest', h.beforeRequest,
        { urls: ['<all_urls>'] }, ['blocking'], true);
      wapi.webRequest.onBeforeRequest('webRequest.cspReport', h.cspReport,
        { urls: ['<all_urls>'], types: ['csp_report'] }, ['blocking'], true);
      wapi.webRequest.onCompleted('webRequest.completed', h.completed,
        { urls: ['<all_urls>'] }, undefined, true);
      wapi.webRequest.onErrorOccurred('webRequest.error', h.error,
        { urls: ['<all_urls>'] }, undefined, true);
      wapi.webRequest.onBeforeRedirect('webRequest.redirect', h.redirect,
        { urls: ['<all_urls>'] }, undefined, true);
      registered = true;
      return true;
    }

    function headers(enabled, handler) {
      if (enabled) {
        return wapi.webRequest.onHeadersReceived('webRequest.onHeadersReceived', handler,
          { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders'], true);
      }
      return wapi.events.remove('webRequest.onHeadersReceived');
    }

    function sendHeaders(enabled, handler) {
      if (enabled) {
        return wapi.webRequest.onBeforeSendHeaders('webRequest.onBeforeSendHeaders', handler,
          { urls: ['<all_urls>'] }, ['blocking', 'requestHeaders'], true);
      }
      return wapi.events.remove('webRequest.onBeforeSendHeaders');
    }

    function rewrite(requestId, resource, hooks) {
      const options = hooks || {};
      let filter;
      try {
        filter = wapi.webRequest.filterResponseData(requestId);
      } catch (error) {
        if (typeof options.onFilterError === 'function') options.onFilterError(error);
        return false;
      }
      if (!filter) return false;
      if (typeof options.onStart === 'function') options.onStart(requestId);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (typeof options.onFinish === 'function') options.onFinish(requestId);
      };

      filter.ondata = () => { /* the original body is intentionally dropped */ };
      filter.onstop = () => {
        try {
          filter.write(resource.bytes);
          filter.close();
        } catch (error) {
          if (typeof options.onWriteError === 'function') options.onWriteError(error);
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

    // HTML filtering needs to buffer a bounded document body, transform it as
    // data, and write the result back. The filter is still created
    // synchronously from onBeforeRequest; all decoding/transforming happens in
    // the background policy layer through onTransform.
    function stream(requestId, options, hooks) {
      const config = options || {};
      const handlers = hooks || {};
      const limit = Number(config.maxBytes) || 0;
      let filter;
      try {
        filter = wapi.webRequest.filterResponseData(requestId);
      } catch (error) {
        if (typeof handlers.onError === 'function') handlers.onError(error);
        return { active: false, cancel: () => {} };
      }
      if (!filter) return { active: false, cancel: () => {} };

      let chunks = [];
      let total = 0;
      let finished = false;
      const finish = result => {
        if (finished) return;
        finished = true;
        if (typeof handlers.onFinish === 'function') handlers.onFinish(result);
      };
      const fail = (error, reason) => {
        if (finished) return;
        finished = true;
        try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
        if (typeof handlers.onError === 'function') handlers.onError(error, reason);
      };
      const cancel = () => {
        if (finished) return false;
        finished = true;
        try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
        if (typeof handlers.onCancel === 'function') handlers.onCancel();
        return true;
      };

      filter.ondata = event => {
        if (finished) return;
        const chunk = event && event.data
          ? new Uint8Array(event.data)
          : new Uint8Array(0);
        if (limit > 0 && total + chunk.byteLength > limit) {
          fail(new Error('response body exceeds the WildFire stream limit'), 'too-large');
          return;
        }
        chunks = chunks.concat(Uint8Array.from(chunk));
        total += chunk.byteLength;
      };
      filter.onstop = () => {
        if (finished) return;
        const bytes = new Uint8Array(total);
        let offset = 0;
        chunks.forEach(chunk => {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        });
        chunks = [];
        try {
          const result = typeof handlers.onTransform === 'function'
            ? handlers.onTransform(bytes) : { bytes, changed: false };
          const body = result && result.bytes ? result.bytes : bytes;
          filter.write(body);
          filter.close();
          finish(result || { bytes, changed: false });
        } catch (error) {
          fail(error, 'transform');
        }
      };
      filter.onerror = event => fail(event, 'stream');
      return {
        get active() { return !finished; },
        cancel
      };
    }

    function unregister() {
      STATIC_NAMES.concat(DYNAMIC_NAMES).forEach(name => wapi.events.remove(name));
      registered = false;
      return true;
    }

    return {
      validate,
      register,
      headers,
      sendHeaders,
      rewrite,
      stream,
      unregister,
      names: () => STATIC_NAMES.concat(DYNAMIC_NAMES),
      get registered() { return registered; }
    };
  }

  api.create = create;
})(this);

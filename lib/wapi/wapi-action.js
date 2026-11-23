/* WildFire - Firefox-native browserAction plumbing built on the wapi. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiAction = global.WildFireWapiAction || {};
  try { global.wapiAction = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const browserApi = config.browserApi || (wapi && wapi.browser);
    const browserAction = browserApi && browserApi.browserAction;

    function invoke(name, optionsOrValue) {
      if (!browserAction || typeof browserAction[name] !== 'function') return false;
      try {
        const result = browserAction[name](optionsOrValue);
        if (result && typeof result.catch === 'function') result.catch(() => {});
        return true;
      } catch (error) {
        /* Badge updates are advisory; a failed native call must not break a block. */
        return false;
      }
    }

    function setBadgeText(value) {
      return invoke('setBadgeText', value);
    }

    function setBadgeBackgroundColor(value) {
      return invoke('setBadgeBackgroundColor', value);
    }

    return {
      supported: Boolean(browserAction && typeof browserAction.setBadgeText === 'function' &&
        typeof browserAction.setBadgeBackgroundColor === 'function'),
      setBadgeText,
      setBadgeBackgroundColor,
      invoke
    };
  }

  api.create = create;
})(this);

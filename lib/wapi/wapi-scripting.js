/* WildFire - Firefox-native dynamic content-script registration. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiScripting = global.WildFireWapiScripting || {};
  try { global.wapiScripting = api; } catch (error) { /* the canonical global still works */ }

  function keyOf(key) {
    return String(key || 'default');
  }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const registrations = new Map();

    function report(error) {
      if (typeof config.onError === 'function') config.onError(error);
    }

    function supported() {
      return Boolean(wapi && wapi.contentScripts && wapi.contentScripts.supported);
    }

    function validate(details) {
      if (!details || !Array.isArray(details.matches) || !details.matches.length) {
        throw new Error('WildFire scripting: matches are required');
      }
      if (!Array.isArray(details.js) || !details.js.length) {
        throw new Error('WildFire scripting: js steps are required');
      }
      return details;
    }

    function normalize(details) {
      return Object.assign({}, details, {
        matches: details.matches.slice(),
        js: details.js.map(step => step && typeof step === 'object'
          ? Object.assign({}, step) : step)
      });
    }

    // A failed registration keeps the previous working registration in place.
    // Unregister failures are reported but do not discard the replacement.
    async function replace(key, details) {
      if (!supported()) return false;
      const id = keyOf(key);
      let next = null;
      if (details) {
        try {
          next = await wapi.contentScripts.register(normalize(validate(details)));
        } catch (error) {
          report(error);
          return false;
        }
      }
      const previous = registrations.get(id) || null;
      registrations.set(id, next);
      if (previous) {
        try {
          await wapi.contentScripts.unregister(previous);
        } catch (error) {
          report(error);
        }
      }
      return true;
    }

    async function register(key, details) {
      const id = keyOf(key);
      const ok = await replace(id, details);
      return ok ? registrations.get(id) || null : null;
    }

    async function clear(key) {
      const id = keyOf(key);
      const previous = registrations.get(id) || null;
      if (!previous) {
        registrations.delete(id);
        return false;
      }
      registrations.delete(id);
      try {
        await wapi.contentScripts.unregister(previous);
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    }

    async function clearAll() {
      const results = await Promise.all(keys().map(key => clear(key)));
      return results.some(Boolean);
    }

    function get(key) {
      return registrations.get(keyOf(key)) || null;
    }

    function has(key) {
      return registrations.has(keyOf(key));
    }

    function keys() {
      return Array.from(registrations.keys());
    }

    return {
      get supported() { return supported(); },
      register,
      replace,
      clear,
      clearAll,
      destroy: clear,
      get,
      has,
      keys,
      size: () => registrations.size
    };
  }

  api.create = create;
})(this);

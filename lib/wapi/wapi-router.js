/* WildFire - named action router built on the Firefox-native wapi prefix. */
(function (global) {
  'use strict';

  const DEFAULT_PREFIX = 'wildfire:';
  const api = global.WildFireWapiRouter = global.WildFireWapiRouter || {};
  try { global.wapiRouter = api; } catch (error) { /* the canonical global still works */ }

  function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const prefix = config.prefix || (wapi && wapi.prefix) || DEFAULT_PREFIX;
    const handlers = new Map();

    function isPrefixed(message) {
      return Boolean(message && typeof message.type === 'string' &&
        message.type.startsWith(prefix));
    }

    function actionOf(message) {
      return isPrefixed(message) ? message.type.slice(prefix.length) : '';
    }

    function accepts(message) {
      return isPrefixed(message);
    }

    function register(action, handler) {
      if (typeof action !== 'string' || !action || typeof handler !== 'function') {
        throw new Error('WildFire router: register() requires an action and handler');
      }
      handlers.set(action, handler);
      return true;
    }

    function registerAll(map) {
      Object.keys(map || {}).forEach(action => register(action, map[action]));
      return handlers.size;
    }

    function unregister(action) {
      return handlers.delete(action);
    }

    async function dispatch(message, sender) {
      if (!isPrefixed(message)) return undefined;
      const action = actionOf(message);
      const handler = handlers.get(action);
      if (!handler) return { ok: false, error: 'Unknown action: ' + action };
      return handler(message, sender);
    }

    function actions() {
      return Array.from(handlers.keys());
    }

    function clear() {
      handlers.clear();
    }

    return {
      prefix,
      accepts,
      actionOf,
      register,
      registerAll,
      unregister,
      dispatch,
      actions,
      clear,
      size: () => handlers.size
    };
  }

  api.create = create;
})(this);

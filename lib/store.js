/* WildFire - state persistence wrapper around browser.storage.local. */
(function (global) {
  'use strict';

  const KEY = 'wildfire.state.v1';

  const DEFAULTS = Object.freeze({
    enabled: true,
    blocked: 0,
    customFilters: '',
    disabledSites: []
  });

  const Store = {
    defaults: DEFAULTS,

    async get() {
      const stored = await browser.storage.local.get(KEY);
      const value = stored && stored[KEY];
      return Object.assign({}, DEFAULTS, value && typeof value === 'object' ? value : {});
    },

    // Write a complete snapshot. Callers mutate their in-memory copy first,
    // then pass it here so parallel writes cannot clobber unrelated fields.
    async save(next) {
      const snapshot = Object.assign({}, DEFAULTS, next);
      await browser.storage.local.set({ [KEY]: snapshot });
      return snapshot;
    }
  };

  global.WildFireStore = Store;
})(this);

/* WildFire - state persistence wrapper around browser.storage.local. */
(function (global) {
  'use strict';

  const KEY = 'wildfire.state.v1';

  const DEFAULTS = Object.freeze({
    enabled: true,
    blocked: 0,
    blockedBySite: {},
    customFilters: '',
    disabledSites: []
  });

  function normalizeSiteCounts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value).reduce((counts, entry) => {
      const site = String(entry[0] || '').trim().toLowerCase();
      const count = Math.floor(Number(entry[1]));
      if (site && Number.isFinite(count) && count > 0) {
        Object.defineProperty(counts, site, {
          value: count, enumerable: true, writable: true, configurable: true
        });
      }
      return counts;
    }, {});
  }

  function normalizeState(value) {
    const merged = Object.assign({}, DEFAULTS,
      value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const total = Math.floor(Number(merged.blocked));
    merged.blocked = Number.isFinite(total) && total > 0 ? total : 0;
    merged.blockedBySite = normalizeSiteCounts(merged.blockedBySite);
    return merged;
  }

  const Store = {
    defaults: DEFAULTS,

    async get() {
      const stored = await browser.storage.local.get(KEY);
      return normalizeState(stored && stored[KEY]);
    },

    // Write a complete snapshot. Callers mutate their in-memory copy first,
    // then pass it here so parallel writes cannot clobber unrelated fields.
    async save(next) {
      const snapshot = normalizeState(next);
      await browser.storage.local.set({ [KEY]: snapshot });
      return snapshot;
    }
  };

  global.WildFireStore = Store;
})(this);

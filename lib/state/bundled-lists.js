/* WildFire - catalog of the preshipped default filter list.
 *
 * The entry is remote-list shaped so it shares storage, metadata and engine
 * composition with external lists. It ships with exact text, starts enabled,
 * and only fetches when the user explicitly chooses Update. It never
 * auto-updates, and the legacy sentinel is recognized for storage migration.
 */
(function (global) {
  'use strict';

  const DEFAULT_URL = 'https://raw.githubusercontent.com/itsrody/WildFire/main/filters/default.txt';
  const LEGACY_URL = 'wildfire:bundled/default.txt';
  const CATALOG = Object.freeze([
    Object.freeze({
      id: 'wildfire-default',
      url: DEFAULT_URL,
      name: 'WildFire default filters',
      description: 'Preshipped starter rules with an opt-in update source.',
      builtin: true
    })
  ]);

  function isBundledUrl(value) {
    const text = String(value || '').trim();
    return text === DEFAULT_URL || text === LEGACY_URL;
  }

  function find(value) {
    const entry = CATALOG.find(item => item.url === String(value || '').trim());
    return entry ? Object.assign({}, entry) : null;
  }

  global.WildFireBundledLists = Object.freeze({
    DEFAULT_URL,
    LEGACY_URL,
    all: () => CATALOG.map(entry => Object.assign({}, entry)),
    find,
    isBundledUrl
  });
})(this);

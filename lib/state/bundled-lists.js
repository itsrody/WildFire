/* WildFire - catalog of preshipped, local-only filter lists.
 *
 * These entries are remote-list shaped so they share storage, metadata and
 * engine composition, but they are never fetched or auto-updated. Real network
 * updates require an explicitly added http(s) list.
 */
(function (global) {
  'use strict';

  const DEFAULT_URL = 'wildfire:bundled/default.txt';
  const CATALOG = Object.freeze([
    Object.freeze({
      id: 'wildfire-default',
      url: DEFAULT_URL,
      name: 'WildFire default filters',
      description: 'Preshipped starter rules bundled with the extension.',
      builtin: true
    })
  ]);

  function isBundledUrl(value) {
    return String(value || '').trim() === DEFAULT_URL;
  }

  function find(value) {
    const entry = CATALOG.find(item => item.url === String(value || '').trim());
    return entry ? Object.assign({}, entry) : null;
  }

  global.WildFireBundledLists = Object.freeze({
    DEFAULT_URL,
    all: () => CATALOG.map(entry => Object.assign({}, entry)),
    find,
    isBundledUrl
  });
})(this);

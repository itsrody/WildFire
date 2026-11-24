/* WildFire - catalog of the preshipped default filter list.
 *
 * The entry is remote-list shaped so it shares storage, metadata and engine
 * composition with external lists. It points at the uAssets CDN, starts
 * enabled, and auto-fetches once before revalidating at its !Expires interval.
 * Upstream filter text is never vendored into this repository. The WildFire
 * starter URL and the old bundled sentinel are recognized for storage
 * migration; filters/default.txt remains only an offline engine fallback.
 */
(function (global) {
  'use strict';

  const DEFAULT_URL = 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt';
  const LEGACY_URL = 'wildfire:bundled/default.txt';
  const STARTER_URL = 'https://raw.githubusercontent.com/itsrody/WildFire/main/filters/default.txt';
  const LEGACY_URLS = Object.freeze([LEGACY_URL, STARTER_URL]);
  const CATALOG = Object.freeze([
    Object.freeze({
      id: 'wildfire-default',
      url: DEFAULT_URL,
      name: 'WildFire default filters',
      description: 'uAssets CDN rules, fetched directly and never vendored.',
      builtin: true
    })
  ]);

  function isBundledUrl(value) {
    const text = String(value || '').trim();
    return text === DEFAULT_URL || LEGACY_URLS.includes(text);
  }

  function find(value) {
    const entry = CATALOG.find(item => item.url === String(value || '').trim());
    return entry ? Object.assign({}, entry) : null;
  }

  global.WildFireBundledLists = Object.freeze({
    DEFAULT_URL,
    LEGACY_URL,
    STARTER_URL,
    LEGACY_URLS,
    all: () => CATALOG.map(entry => Object.assign({}, entry)),
    find,
    isBundledUrl
  });
})(this);

/* WildFire - inert catalog of suggested remote filter lists.
 *
 * These entries are grouped data only. They are never added, enabled, or
 * updated automatically. Options shows them as shortcuts organized by purpose;
 * adding one uses the normal add-list path, which fetches the URL once and
 * leaves the entry disabled until the user enables it. No list text is shipped.
 */
(function (global) {
  'use strict';

  const GROUPS = Object.freeze([
    Object.freeze({
      id: 'ads',
      name: 'Ads',
      description: 'Advertising and popup rules.'
    }),
    Object.freeze({
      id: 'privacy',
      name: 'Privacy',
      description: 'Tracker and analytics rules.'
    }),
    Object.freeze({
      id: 'malicious',
      name: 'Malicious sites',
      description: 'Known malicious host rules.'
    }),
    Object.freeze({
      id: 'social',
      name: 'Social widgets',
      description: 'Embedded social button rules.'
    }),
    Object.freeze({
      id: 'regional',
      name: 'Regional',
      description: 'Language and region specific rules.'
    })
  ]);

  const CATALOG = Object.freeze([
    Object.freeze({
      id: 'wildfire-ads-general',
      group: 'ads',
      name: 'General ad filters',
      description: 'Broad advertising and popup rules.',
      url: 'https://easylist.to/easylist/easylist.txt'
    }),
    Object.freeze({
      id: 'wildfire-privacy-trackers',
      group: 'privacy',
      name: 'Tracker filters',
      description: 'Analytics, pixels, and tracker rules.',
      url: 'https://easylist.to/easylist/easyprivacy.txt'
    }),
    Object.freeze({
      id: 'wildfire-privacy-core',
      group: 'privacy',
      name: 'Privacy essentials',
      description: 'Focused privacy rules fetched as text.',
      url: 'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt'
    }),
    Object.freeze({
      id: 'wildfire-malicious-hosts',
      group: 'malicious',
      name: 'Malicious host filters',
      description: 'Known malicious and abuse hosts.',
      url: 'https://raw.githubusercontent.com/Spam404/lists/master/main-blacklist.txt'
    }),
    Object.freeze({
      id: 'wildfire-social-widgets',
      group: 'social',
      name: 'Social widget filters',
      description: 'Embedded social buttons and sharing widgets.',
      url: 'https://filters.adtidy.org/extension/firefox/filters/4.txt'
    }),
    Object.freeze({
      id: 'wildfire-regional-de',
      group: 'regional',
      name: 'German regional filters',
      description: 'German-language regional rules.',
      url: 'https://easylist.to/easylistgermany/easylistgermany.txt'
    })
  ]);

  function copy(entry) {
    return entry ? Object.assign({}, entry) : null;
  }

  function find(value) {
    const url = String(value || '').trim();
    return copy(CATALOG.find(entry => entry.url === url || entry.id === url));
  }

  global.WildFireSuggestedLists = Object.freeze({
    groups: () => GROUPS.map(entry => Object.assign({}, entry)),
    all: () => CATALOG.map(entry => Object.assign({}, entry)),
    find
  });
})(this);

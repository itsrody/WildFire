/* WildFire - inert catalog of suggested remote filter lists.
 *
 * These URLs are never added, fetched, enabled, or updated automatically.
 * Options shows them as shortcuts; adding one uses the normal add-list path,
 * which registers a disabled, unfetched entry and performs no network request.
 */
(function (global) {
  'use strict';

  const CATALOG = Object.freeze([
    Object.freeze({
      name: 'EasyList',
      description: 'General ad filtering (community list).',
      url: 'https://easylist.to/easylist/easylist.txt'
    }),
    Object.freeze({
      name: 'EasyPrivacy',
      description: 'Tracker and analytics filtering (community list).',
      url: 'https://easylist.to/easylist/easyprivacy.txt'
    })
  ]);

  global.WildFireSuggestedLists = Object.freeze({
    all: () => CATALOG.map(entry => Object.assign({}, entry))
  });
})(this);

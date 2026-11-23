/* WildFire - local URL skip policy before engine matching.
 *
 * webRequest's <all_urls> filter can surface schemes that a URL pattern engine
 * cannot meaningfully scope (extension pages, internal about/resource pages,
 * data/blob URLs). Skipping them here keeps the blocking listener cheap and
 * gives the Inspector a local reason without changing counters or decisions.
 */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const FILTERABLE_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

  core.createUrlSkip = function createUrlSkip() {
    function urlSkipReason(value) {
      const text = String(value || '').trim();
      if (!text) return 'empty URL';
      const match = /^([a-z][a-z0-9+.-]*):/i.exec(text);
      if (!match) return 'URL has no scheme';
      const scheme = match[1].toLowerCase() + ':';
      return FILTERABLE_SCHEMES.has(scheme) ? '' : 'unsupported URL scheme ' + match[1].toLowerCase();
    }

    function isSkippedUrl(value) {
      return Boolean(urlSkipReason(value));
    }

    return { FILTERABLE_SCHEMES, urlSkipReason, isSkippedUrl };
  };
})(this);

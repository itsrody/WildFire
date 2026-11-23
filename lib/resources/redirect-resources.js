/* WildFire - original data-URI resources for $redirect / $redirect-rule filters.
 *
 * Filter text may only choose one of the aliases below. It can never supply a
 * URL of its own, so a rule cannot redirect a request to an arbitrary site.
 */
(function (global) {
  'use strict';

  // Every body here is authored for WildFire. Images are 1x1 and transparent.
  // {{1}}..{{9}} placeholders are filled from regex captures by resolve().
  const RESOURCES = Object.freeze({
    noopjs: 'data:application/javascript;charset=utf-8,',
    noopcss: 'data:text/css;charset=utf-8,',
    nooptext: 'data:text/plain;charset=utf-8,',
    noopjson: 'data:application/json;charset=utf-8,%7B%7D',
    noophtml: 'data:text/html;charset=utf-8,',
    '1x1.gif': 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIDBEABADs=',
    '1x1.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
    'tagged.svg': 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3Ctitle%3E{{1}}%3C%2Ftitle%3E%3C%2Fsvg%3E'
  });

  const MAX_CAPTURE = 1024;

  function normalizeAlias(value) {
    return String(value || '').trim().toLowerCase();
  }

  function hasAlias(value) {
    return Object.prototype.hasOwnProperty.call(RESOURCES, normalizeAlias(value));
  }

  // Captures are percent-encoded before insertion. A URL can therefore never
  // inject markup, script, or a second data: URI into a redirect resource.
  function resolve(value, captures) {
    const alias = normalizeAlias(value);
    const template = RESOURCES[alias];
    if (!template) return '';
    const parts = Array.isArray(captures) ? captures : [];
    return template.replace(/\{\{(\d)\}\}/g, (_, index) => {
      const capture = parts[Number(index) - 1];
      return capture == null ? '' : encodeURIComponent(String(capture).slice(0, MAX_CAPTURE));
    });
  }

  global.RedirectResources = {
    aliases: Object.keys(RESOURCES),
    hasAlias,
    resolve
  };
})(this);

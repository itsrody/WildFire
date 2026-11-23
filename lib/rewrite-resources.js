/* WildFire - original response bodies for $rewrite filters.
 *
 * A filter can only name one of the aliases below. It can never supply a
 * response body, URL, or header value, so remote filter text cannot inject
 * content into a page through this path.
 */
(function (global) {
  'use strict';

  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIDBEABADs=';

  function fromBase64(value) {
    const clean = String(value).replace(/[^A-Za-z0-9+/]/g, '');
    const values = Array.from(clean, char => BASE64.indexOf(char)).filter(index => index >= 0);
    const bytes = Array.from({ length: Math.ceil(values.length / 4) }, (_, group) => group * 4)
      .flatMap(start => {
        const a = values[start] || 0;
        const b = values[start + 1] || 0;
        const c = values[start + 2];
        const d = values[start + 3];
        const output = [((a << 2) | (b >> 4)) & 255];
        if (c !== undefined) output.push((((b & 15) << 4) | (c >> 2)) & 255);
        if (d !== undefined) output.push((((c & 3) << 6) | d) & 255);
        return output;
      });
    return Uint8Array.from(bytes);
  }

  function fromText(value) {
    return Uint8Array.from(Array.from(String(value), char => char.charCodeAt(0) & 255));
  }

  // Every body is authored for WildFire. Images are 1x1 and transparent.
  const RESOURCES = Object.freeze({
    'blank-js': { type: 'application/javascript; charset=utf-8', bytes: fromText('') },
    'blank-css': { type: 'text/css; charset=utf-8', bytes: fromText('') },
    'blank-text': { type: 'text/plain; charset=utf-8', bytes: fromText('') },
    'blank-json': { type: 'application/json; charset=utf-8', bytes: fromText('{}') },
    'blank-html': { type: 'text/html; charset=utf-8', bytes: fromText('') },
    'blank-image': { type: 'image/gif', bytes: fromBase64(GIF) }
  });

  // A synthesized body has a different length and encoding from the original,
  // so those headers must go. The site's other headers are left untouched.
  const DROP_HEADERS = new Set([
    'content-length', 'content-encoding', 'transfer-encoding', 'content-md5'
  ]);

  function normalizeAlias(value) {
    return String(value || '').trim().toLowerCase();
  }

  function hasAlias(value) {
    return Object.prototype.hasOwnProperty.call(RESOURCES, normalizeAlias(value));
  }

  function resolve(value) {
    const resource = RESOURCES[normalizeAlias(value)];
    return resource ? { type: resource.type, bytes: resource.bytes.slice() } : null;
  }

  function withHeaders(headers, type) {
    const kept = (Array.isArray(headers) ? headers : [])
      .filter(header => {
        const name = String((header && header.name) || '').toLowerCase();
        return Boolean(header) && !DROP_HEADERS.has(name) && name !== 'content-type';
      })
      .map(header => Object.assign({}, header));
    return kept.concat([{ name: 'Content-Type', value: type }]);
  }

  global.RewriteResources = {
    aliases: Object.keys(RESOURCES),
    hasAlias,
    resolve,
    withHeaders
  };
})(this);

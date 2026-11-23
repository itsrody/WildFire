/* WildFire - curated CSP directives for $csp filters.
 *
 * Filter text may only name one of the aliases below. It can never supply a
 * header value, so a rule cannot weaken a page's policy or inject arbitrary
 * CSP syntax.
 */
(function (global) {
  'use strict';

  const HEADER = 'Content-Security-Policy';

  // Each value is an additional enforcing policy. Browsers enforce every CSP
  // header independently, so appending one can only tighten a response.
  const DIRECTIVES = Object.freeze({
    'no-script': "script-src 'none'",
    'no-inline-script': 'script-src http: https:',
    'no-frame': "frame-src 'none'",
    'no-worker': "worker-src 'none'",
    'no-object': "object-src 'none'",
    'no-font': "font-src 'none'",
    'no-media': "media-src 'none'",
    'no-connect': "connect-src 'none'"
  });

  function normalizeAlias(value) {
    return String(value || '').trim().toLowerCase();
  }

  function hasAlias(value) {
    return Object.prototype.hasOwnProperty.call(DIRECTIVES, normalizeAlias(value));
  }

  function resolve(value) {
    return DIRECTIVES[normalizeAlias(value)] || '';
  }

  // Keep the page's own headers untouched and add WildFire's policy as a
  // separate header. Firefox enforces every CSP header independently, so
  // appending a header can only tighten the response's effective policy.
  function withDirective(responseHeaders, directives) {
    const headers = Array.isArray(responseHeaders) ? responseHeaders.slice() : [];
    const values = Array.isArray(directives) ? directives : [directives];
    return values.filter(Boolean).reduce(
      (result, value) => result.concat([{ name: HEADER, value }]),
      headers
    );
  }

  global.CspResources = {
    header: HEADER,
    aliases: Object.keys(DIRECTIVES),
    hasAlias,
    resolve,
    withDirective
  };
})(this);

/* WildFire - Firefox-native DNS boundary for CNAME uncloaking. */
(function (global) {
  'use strict';

  const api = global.WildFireWapiDns = global.WildFireWapiDns || {};
  try { global.wapiDns = api; } catch (error) { /* the canonical global still works */ }

  function normalizeHost(value) {
    const text = String(value || '').trim().toLowerCase();
    const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
    return bare.replace(/^\.+|\.+$/g, '');
  }

  function isIpAddress(host) {
    return /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(host) || host.indexOf(':') !== -1;
  }

  api.create = function create(options) {
    const config = options || {};
    const wapi = config.wapi;
    const browserApi = config.browserApi || (wapi && wapi.browser) || global.browser;
    const dns = browserApi && browserApi.dns;
    const supported = Boolean(dns && typeof dns.resolve === 'function');

    async function resolve(host) {
      const name = normalizeHost(host);
      if (!supported || !name || isIpAddress(name)) {
        return { host: name, canonical: '' };
      }
      try {
        const record = await dns.resolve(name, ['canonical_name']);
        const candidate = record && (record.canonicalName || record.canonical_name || record.host || '');
        const canonical = normalizeHost(candidate);
        return {
          host: name,
          canonical: canonical && canonical !== name ? canonical : ''
        };
      } catch (error) {
        return {
          host: name,
          canonical: '',
          error: String(error && error.message || error)
        };
      }
    }

    return {
      supported,
      flags: ['canonical_name'],
      normalizeHost,
      resolve
    };
  };
})(this);

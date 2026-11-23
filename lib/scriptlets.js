/* WildFire - curated scriptlet implementations.
 *
 * Filter text can only name an alias and pass validated data. It can never
 * supply code: there is no eval, no Function constructor, and no dynamic
 * source execution anywhere in this file.
 */
(function (global) {
  'use strict';

  const MAX_PROPERTY_LENGTH = 120;
  const PROPERTY_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
  const VALUES = Object.freeze({ true: true, false: false, null: null, 0: 0, 1: 1, '': '' });
  const ARITY = Object.freeze({
    'abort-on-property-read': 1,
    'abort-on-property-write': 1,
    'set-constant': 2
  });
  const ALIASES = Object.keys(ARITY);
  const BLOCKED_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function propertyError(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_PROPERTY_LENGTH) {
      return 'invalid scriptlet property';
    }
    if (!PROPERTY_PATH.test(value)) return 'invalid scriptlet property';
    return value.split('.').some(part => BLOCKED_PARTS.has(part))
      ? 'invalid scriptlet property'
      : '';
  }

  // The engine calls this at load time; the content side calls it again before
  // acting, so a bad payload can never reach the page.
  function validate(alias, args) {
    const name = String(alias || '').trim().toLowerCase();
    const list = Array.isArray(args) ? args : [];
    if (!owns(ARITY, name)) return 'unknown scriptlet alias: ' + name;
    if (list.length !== ARITY[name]) return 'wrong argument count for ' + name;
    const error = propertyError(list[0]);
    if (error) return error;
    if (name === 'set-constant' && !owns(VALUES, list[1])) return 'unsupported constant value';
    return '';
  }

  function resolvePath(path, create) {
    const parts = String(path).split('.');
    const key = parts.pop();
    const target = parts.reduce((current, part) => {
      if (!current || typeof current !== 'object') return null;
      if (!owns(current, part)) {
        if (!create) return null;
        try {
          Object.defineProperty(current, part, {
            value: {}, writable: true, configurable: true
          });
        } catch (error) {
          return null;
        }
      }
      const next = current[part];
      return next && typeof next === 'object' ? next : null;
    }, global);
    return target ? { target, key } : null;
  }

  function define(target, key, descriptor) {
    try {
      Object.defineProperty(target, key, Object.assign({ configurable: false }, descriptor));
    } catch (error) {
      /* The page already froze this property; do not throw into its scripts. */
    }
  }

  function run(entry) {
    if (validate(entry.alias, entry.args)) return;
    const ref = resolvePath(entry.args[0], true);
    if (!ref) return;
    const name = String(entry.alias).toLowerCase();

    if (name === 'set-constant') {
      define(ref.target, ref.key, {
        value: VALUES[entry.args[1]], writable: false, enumerable: true
      });
    } else if (name === 'abort-on-property-read') {
      define(ref.target, ref.key, {
        get: () => { throw new Error('WildFire blocked read of ' + entry.args[0]); },
        enumerable: true
      });
    } else if (name === 'abort-on-property-write') {
      let existing;
      try {
        existing = ref.target[ref.key];
      } catch (error) {
        existing = undefined;
      }
      define(ref.target, ref.key, {
        get: () => existing,
        set: () => { throw new Error('WildFire blocked write to ' + entry.args[0]); },
        enumerable: true
      });
    }
  }

  function domainMatches(host, domain) {
    const key = String(domain || '').toLowerCase().replace(/^\./, '');
    return Boolean(host && key) && (host === key || host.endsWith('.' + key));
  }

  function appliesTo(entry, host) {
    if (!entry || typeof entry !== 'object') return false;
    const domains = Array.isArray(entry.domains) ? entry.domains : [];
    return !domains.length || domains.some(domain => domainMatches(host, domain));
  }

  function sameRule(left, right) {
    const leftArgs = Array.isArray(left.args) ? left.args : [];
    const rightArgs = Array.isArray(right.args) ? right.args : [];
    return left.alias === right.alias && leftArgs.length === rightArgs.length &&
      leftArgs.every((arg, index) => String(arg) === String(rightArgs[index]));
  }

  function apply(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const location = global.location || {};
    const host = String(location.hostname || '').toLowerCase();
    const applicable = list.filter(entry => appliesTo(entry, host));
    const exceptions = applicable.filter(entry => entry.isException);
    const active = applicable.filter(entry => !entry.isException &&
      !exceptions.some(exception => sameRule(exception, entry)));
    active.forEach(run);
  }

  global.WildFireScriptlets = { aliases: ALIASES, validate, apply, domainMatches };
})(this);

/* WildFire scriptlets: validators, needle safety, path/property primitives.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  const MAX_PROPERTY_LENGTH = 120;
  const PROPERTY_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
  const BLOCKED_PARTS = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_NEEDLE_LENGTH = 512;
  const MAX_REGEX_LENGTH = 512;
  const MAX_REGEX_QUANTIFIERS = 16;
  const MAX_REGEX_GROUPS = 16;
  const SAFE_FLAGS = /^[imsu]*$/;

  // Base tokens are mapped to factories so each page gets a fresh value.
  // Shim modules register additional tokens before the public API is built.
  const CONSTANTS = Object.assign(Object.create(null), {
    true: () => true,
    false: () => false,
    null: () => null,
    undefined: () => undefined,
    0: () => 0,
    1: () => 1,
    emptyObj: () => ({}),
    emptyArr: () => [],
    emptyStr: () => ''
  });

  function registerConstant(token, factory) {
    if (typeof token !== 'string' || typeof factory !== 'function') return false;
    if (token === '__proto__' || token === 'constructor' || token === 'prototype') return false;
    CONSTANTS[token] = factory;
    return true;
  }

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function arityError(args, min, max) {
    const count = Array.isArray(args) ? args.length : 0;
    return count < min || count > max ? 'wrong argument count' : '';
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

  function lengthError(value, max) {
    return typeof value === 'string' && value.length <= (max || 512)
      ? '' : 'scriptlet argument too long';
  }

  function optionalLengthError(value, max) {
    return value === undefined ? '' : lengthError(value, max);
  }

  function prunePathsError(value) {
    return lengthError(value, 512) ||
      (/^[A-Za-z0-9_.\[\]*\-{},:\s]*$/.test(value) ? '' : 'invalid prune path');
  }

  const DOM_TOKEN_NAMES = ['asap', 'complete', 'stay'];

  function parseDomTokens(value, allowed) {
    const names = Array.isArray(allowed) && allowed.length ? allowed : DOM_TOKEN_NAMES;
    const tokens = String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean);
    const unknown = tokens.find(token => !names.includes(token));
    if (unknown) return { error: 'invalid DOM applying flag' };
    return {
      asap: tokens.includes('asap'),
      complete: tokens.includes('complete'),
      stay: tokens.includes('stay'),
      error: ''
    };
  }

  function domTokensError(value, allowed) {
    return parseDomTokens(value, allowed).error;
  }

  // Conservative regex check, matching the network engine's policy. A false
  // positive only drops a rule; a false negative could stall a page.
  function needleSafetyError(source) {
    if (source.length > MAX_REGEX_LENGTH) return 'scriptlet regex too long';
    const state = Array.from(source).reduce((current, ch) => {
      if (current.error) return current;
      const top = () => current.stack[current.stack.length - 1];

      if (current.escaped) {
        if (/[1-9]/.test(ch)) current.error = 'regex backreferences are not allowed';
        current.escaped = false;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (ch === '\\') {
        current.escaped = true;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (current.inClass) {
        if (ch === ']') current.inClass = false;
        return current;
      }
      if (ch === '[') {
        current.inClass = true;
        current.pending = null;
        current.afterOpen = false;
        return current;
      }
      if (ch === '(') {
        current.groups++;
        if (current.groups > MAX_REGEX_GROUPS) current.error = 'too many regex groups';
        else current.stack.push({ risky: false });
        current.pending = null;
        current.afterOpen = true;
        return current;
      }
      if (ch === '?' && current.afterOpen) {
        current.afterOpen = false;
        return current;
      }
      current.afterOpen = false;
      if (ch === '|') {
        const group = top();
        if (group) group.risky = true;
        current.pending = null;
        return current;
      }
      if (ch === ')') {
        const group = current.stack.pop();
        if (group) {
          current.pending = group;
          const parent = top();
          if (parent && group.risky) parent.risky = true;
        }
        return current;
      }
      if ('+*?{'.includes(ch)) {
        current.quantifiers++;
        if (current.quantifiers > MAX_REGEX_QUANTIFIERS) {
          current.error = 'too many regex quantifiers';
        } else if (current.pending && current.pending.risky) {
          current.error = 'nested or alternated regex quantifier';
        } else {
          const group = top();
          if (group) group.risky = true;
          if (current.pending) {
            const parent = top();
            if (parent) parent.risky = true;
            current.pending = null;
          }
        }
        return current;
      }
      current.pending = null;
      return current;
    }, {
      escaped: false, inClass: false, stack: [], pending: null,
      afterOpen: false, quantifiers: 0, groups: 0, error: ''
    });
    return state.error;
  }

  // A needle is either a case-insensitive literal or a /regex/ with only the
  // safe flags. No needle is ever compiled from anything but validated data.
  function compileNeedle(value) {
    const raw = String(value == null ? '' : value);
    if (!raw) return { matcher: () => true };
    if (raw.length > MAX_NEEDLE_LENGTH) return { error: 'scriptlet needle too long' };
    const lastSlash = raw.lastIndexOf('/');
    if (raw.startsWith('/') && lastSlash > 0) {
      const source = raw.slice(1, lastSlash);
      const flags = raw.slice(lastSlash + 1);
      if (!SAFE_FLAGS.test(flags)) return { error: 'unsupported scriptlet regex flag' };
      const safety = needleSafetyError(source);
      if (safety) return { error: safety };
      try {
        const regex = new RegExp(source, flags);
        return { matcher: text => regex.test(String(text == null ? '' : text)) };
      } catch (error) {
        return { error: 'invalid scriptlet regex' };
      }
    }
    const lower = raw.toLowerCase();
    return {
      matcher: text => String(text == null ? '' : text).toLowerCase().includes(lower)
    };
  }

  function needleError(value) {
    return compileNeedle(value).error || '';
  }

  function resolvePath(path, create) {
    const parts = String(path).split('.');
    const key = parts.pop();
    const target = parts.reduce((current, part) => {
      if (!current || (typeof current !== 'object' && typeof current !== 'function')) return null;
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
      return next && (typeof next === 'object' || typeof next === 'function')
        ? next : null;
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

  function setConstant(path, value) {
    const ref = resolvePath(path, true);
    if (ref) define(ref.target, ref.key, {
      value, writable: false, enumerable: true
    });
  }

  function trapRead(path, guard) {
    const ref = resolvePath(path, true);
    if (!ref) return;
    let value;
    try { value = ref.target[ref.key]; } catch (error) { value = undefined; }
    define(ref.target, ref.key, {
      get: () => { guard(); return value; },
      enumerable: true
    });
  }

  function trapWrite(path) {
    const ref = resolvePath(path, true);
    if (!ref) return;
    let value;
    try { value = ref.target[ref.key]; } catch (error) { value = undefined; }
    define(ref.target, ref.key, {
      get: () => value,
      set: () => { throw new Error('WildFire blocked write to ' + path); },
      enumerable: true
    });
  }

  function safeText(value) {
    try {
      if (typeof value === 'function') {
        return String(value.name || '') + ' ' + String(value);
      }
      return String(value == null ? '' : value);
    } catch (error) {
      return '';
    }
  }

  function redefine(target, key, descriptor) {
    try {
      Object.defineProperty(target, key, Object.assign({ configurable: true }, descriptor));
    } catch (error) {
      /* Native APIs can be non-configurable; leave them untouched. */
    }
  }

  Object.assign(NS, { MAX_PROPERTY_LENGTH, PROPERTY_PATH, BLOCKED_PARTS, MAX_NEEDLE_LENGTH, MAX_REGEX_LENGTH, MAX_REGEX_QUANTIFIERS, MAX_REGEX_GROUPS, SAFE_FLAGS, CONSTANTS, DOM_TOKEN_NAMES, owns, arityError, propertyError, lengthError, optionalLengthError, prunePathsError, parseDomTokens, domTokensError, needleSafetyError, compileNeedle, needleError, registerConstant, resolvePath, define, setConstant, trapRead, trapWrite, safeText, redefine });
})(this);

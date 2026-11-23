/* WildFire - curated scriptlet implementations.
 *
 * Filter text can only name an alias and pass validated data. It can never
 * supply code: there is no eval, no Function constructor, and no dynamic
 * source execution anywhere in this file. Every implementation here is
 * original WildFire code written from public filter-syntax documentation.
 */
(function (global) {
  'use strict';

  const MAX_PROPERTY_LENGTH = 120;
  const PROPERTY_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
  const BLOCKED_PARTS = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_NEEDLE_LENGTH = 512;
  const MAX_REGEX_LENGTH = 512;
  const MAX_REGEX_QUANTIFIERS = 16;
  const MAX_REGEX_GROUPS = 16;
  const SAFE_FLAGS = /^[imsu]*$/;

  // Tokens are mapped to factories so each page gets a fresh value.
  const CONSTANTS = Object.freeze({
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

  function prunePathsError(value) {
    return lengthError(value, 512) ||
      (/^[A-Za-z0-9_.\[\]*\-{},:\s]*$/.test(value) ? '' : 'invalid prune path');
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

  function currentScriptInfo() {
    const script = global.document && global.document.currentScript;
    return {
      text: script ? String(script.textContent || '') : '',
      src: script && script.getAttribute ? String(script.getAttribute('src') || '') : ''
    };
  }

  function scriptStack() {
    try {
      return String(new Error('WildFire script context').stack || '')
        .split('\n')
        .filter(line => !line.includes('WildFire script context'))
        .join('\n');
    } catch (error) {
      return '';
    }
  }

  function abortCurrentScript(args) {
    const textNeedle = compileNeedle(args[1]).matcher;
    const srcNeedle = compileNeedle(args[2]).matcher;
    trapRead(args[0], () => {
      const script = currentScriptInfo();
      const stack = scriptStack();
      if (textNeedle(script.text) || srcNeedle(script.src) ||
        textNeedle(stack) || srcNeedle(stack)) {
        throw new Error('WildFire blocked current script');
      }
    });
  }

  function blockEval() {
    const blocked = () => undefined;
    define(global, 'eval', { value: blocked, writable: false, enumerable: false });
    if (global.eval !== blocked) {
      try { global.eval = blocked; } catch (error) { /* already locked down */ }
    }
  }

  function conditionalEval(needle) {
    const matcher = compileNeedle(needle).matcher;
    const original = global.eval;
    define(global, 'eval', {
      value: function (source) {
        if (matcher(source)) return undefined;
        return typeof original === 'function' ? original.apply(global, arguments) : undefined;
      },
      writable: true,
      enumerable: false
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

  function wrapTimer(name, needle) {
    const original = global[name];
    if (typeof original !== 'function') return;
    const matcher = compileNeedle(needle).matcher;
    define(global, name, {
      value: function () {
        const subject = Array.from(arguments).map(safeText).join(' ');
        if (matcher(subject)) return 0;
        return original.apply(global, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function defuseEvents(typeNeedle, handlerNeedle) {
    const proto = global.EventTarget && global.EventTarget.prototype;
    if (!proto || typeof proto.addEventListener !== 'function') return;
    const original = proto.addEventListener;
    const matchesType = compileNeedle(typeNeedle).matcher;
    const matchesHandler = compileNeedle(handlerNeedle).matcher;
    define(proto, 'addEventListener', {
      value: function (type, listener) {
        const text = typeof listener === 'function'
          ? String(listener.name || '') + ' ' + String(listener)
          : String(listener && listener.handleEvent ? listener.handleEvent : listener);
        if (matchesType(type) && matchesHandler(text)) return undefined;
        return original.apply(this, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function defuseWindowName() {
    define(global, 'name', { get: () => '', set: () => {}, enumerable: true });
  }

  function defuseWindowOpen(needle) {
    const original = global.open;
    if (typeof original !== 'function') return;
    const matcher = compileNeedle(needle).matcher;
    define(global, 'open', {
      value: function (url) {
        if (matcher(String(url))) return null;
        return original.apply(global, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function safeSelector(selector) {
    if (typeof selector !== 'string' || !selector || selector.length > 500) return false;
    if (global.CSS && typeof global.CSS.supports === 'function') {
      return global.CSS.supports('selector', selector);
    }
    if (!global.document || typeof global.document.querySelector !== 'function') return false;
    try {
      global.document.querySelector(selector);
      return true;
    } catch (error) {
      return false;
    }
  }

  function queryAll(selector) {
    if (!safeSelector(selector) || !global.document) return [];
    try {
      return Array.from(global.document.querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function watchMutations(action) {
    if (!global.document || typeof global.MutationObserver !== 'function') return;
    let queued = false;
    const run = () => {
      queued = false;
      try { action(); } catch (error) { /* never throw into page code */ }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(run);
      else Promise.resolve().then(run);
    };
    const observer = new global.MutationObserver(schedule);
    observer.observe(global.document.documentElement || global.document, {
      childList: true, subtree: true, attributes: true, characterData: true
    });
  }

  function onDom(selector, action) {
    const apply = () => {
      queryAll(selector).forEach(element => {
        try { action(element); } catch (error) { /* ignore one bad element */ }
      });
    };
    if (!global.document) return;
    if (global.document.readyState === 'loading' &&
      typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('DOMContentLoaded', () => {
        apply();
        watchMutations(apply);
      }, { once: true });
    } else {
      apply();
      watchMutations(apply);
    }
  }

  function changeAttribute(selector, attribute, mode, value) {
    if (attribute !== '*' && !/^[A-Za-z_:][-\w.:]*$/.test(attribute)) return;
    onDom(selector, element => {
      if (attribute === '*') {
        Array.from(element.attributes || []).forEach(attr => {
          try { element.removeAttribute(attr.name); } catch (error) { /* locked */ }
        });
        return;
      }
      if (mode === 'remove') element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    });
  }

  function changeClass(selector, className, add) {
    if (!/^[^\s]+$/.test(className)) return;
    onDom(selector, element => {
      if (!element.classList) return;
      if (add) element.classList.add(className);
      else element.classList.remove(className);
    });
  }

  function cookieNames() {
    if (!global.document) return [];
    return String(global.document.cookie || '')
      .split(';')
      .map(part => part.split('=')[0].trim())
      .filter(Boolean);
  }

  function writeCookie(name, value, days) {
    if (!global.document) return;
    const attributes = ['path=/'];
    if (days) {
      const date = new global.Date(Date.now() + days * 86400000);
      attributes.push('expires=' + date.toUTCString());
    }
    const host = global.location && global.location.hostname || '';
    if (host) attributes.push('domain=' + host);
    try {
      global.document.cookie = name + '=' + value + '; ' + attributes.join('; ');
    } catch (error) { /* cookie disabled */ }
  }

  function removeCookie(needle) {
    const matcher = compileNeedle(needle).matcher;
    cookieNames().filter(matcher).forEach(name => {
      writeCookie(name, '', -1);
      const host = global.location && global.location.hostname || '';
      if (host.startsWith('www.')) {
        try {
          global.document.cookie = name + '=; path=/; domain=' + host.slice(4) +
            '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        } catch (error) { /* ignore */ }
      }
    });
  }

  function storageWrite(area, key, value) {
    try {
      const store = global[area];
      if (store) store.setItem(key, value);
    } catch (error) { /* storage disabled or full */ }
  }

  function safeStorageRead(area, key) {
    try {
      const store = global[area];
      return store && store.getItem(key) ? true : false;
    } catch (error) {
      return false;
    }
  }

  function callNothrow(path) {
    const ref = resolvePath(path, false);
    if (!ref || typeof ref.target[ref.key] !== 'function') return;
    const original = ref.target[ref.key];
    define(ref.target, ref.key, {
      value: function () {
        try { return original.apply(this, arguments); } catch (error) { return undefined; }
      },
      writable: true,
      enumerable: false
    });
  }

  function adjustTimer(name, callbackNeedle, delayText, boostText) {
    const original = global[name];
    if (typeof original !== 'function') return;
    const callbackMatcher = compileNeedle(callbackNeedle).matcher;
    const delayMatcher = delayText && delayText !== '*'
      ? compileNeedle(delayText).matcher
      : () => true;
    const boost = Number(boostText);
    const factor = Number.isFinite(boost) && boost > 0
      ? Math.min(1000, Math.max(0.001, boost))
      : 0.05;
    define(global, name, {
      value: function (handler, delay) {
        const text = typeof handler === 'function' ? String(handler) : String(handler);
        if (callbackMatcher(text) && delayMatcher(String(delay))) {
          return original.call(global, handler, Math.round(Number(delay) * factor));
        }
        return original.apply(global, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function removeNodeText(selector, needle) {
    const matcher = compileNeedle(needle).matcher;
    onDom(selector, element => {
      Array.from(element.childNodes || []).filter(node => node.nodeType === 3)
        .filter(node => matcher(node.nodeValue || ''))
        .forEach(node => {
          try { node.textContent = ''; } catch (error) { /* locked */ }
        });
    });
  }

  function sanitizeHref(selector, source, transform) {
    onDom(selector, element => {
      if (typeof element.getAttribute !== 'function') return;
      let candidate = '';
      if (!source || source === 'text') {
        candidate = String(element.textContent || '').trim();
      } else if (source.startsWith('[') && source.endsWith(']')) {
        candidate = String(element.getAttribute(source.slice(1, -1)) || '');
      } else if (source.startsWith('?')) {
        try {
          const url = new global.URL(String(element.getAttribute('href') || ''),
            global.location && global.location.href || undefined);
          candidate = url.searchParams.get(source.slice(1)) || '';
        } catch (error) { return; }
      }
      if (transform === 'base64decode' || transform === '-base64') {
        try { candidate = global.atob(candidate); } catch (error) { return; }
      }
      if (!/^(?:https?:)?\/\//i.test(candidate) && !candidate.startsWith('/')) return;
      if (transform === 'removeHash') candidate = candidate.split('#')[0];
      if (transform && transform.startsWith('removeParam')) {
        const names = transform.slice('removeParam'.length).replace(/^:/, '').split(',');
        try {
          const url = new global.URL(candidate, global.location.href);
          names.filter(Boolean).forEach(name => url.searchParams.delete(name));
          candidate = url.href;
        } catch (error) { return; }
      }
      try { element.setAttribute('href', candidate); } catch (error) { /* locked */ }
    });
  }

  function injectStyle(rule) {
    if (!global.document || typeof rule !== 'string' || rule.length > 2000) return;
    try {
      const style = global.document.createElement('style');
      style.textContent = rule;
      (global.document.head || global.document.documentElement).appendChild(style);
    } catch (error) { /* ignore */ }
  }

  function pruneAt(parent, key, parts, index) {
    const node = parent && parent[key];
    if (index >= parts.length) {
      if (parent && typeof parent === 'object') {
        try { delete parent[key]; } catch (error) { /* locked */ }
      }
      return;
    }
    const part = parts[index];
    if (part === '*' || part === '[]') {
      if (node && typeof node === 'object') {
        Object.keys(node).forEach(child => pruneAt(node, child, parts, index + 1));
      }
      return;
    }
    if (node && typeof node === 'object') pruneAt(node, part, parts, index + 1);
  }

  function pruneJson(value, paths, obligatory) {
    if (!value || typeof value !== 'object') return value;
    const required = String(obligatory || '').split(/\s+/).filter(Boolean);
    const present = required.every(path => typeof value[path] !== 'undefined');
    if (!present) return value;
    String(paths || '').split(/\s+/).filter(Boolean).forEach(path => {
      const parts = path.split('.').filter(Boolean);
      if (parts.length) pruneAt(value, parts[0], parts, 1);
    });
    return value;
  }

  function conditionMatcher(needleText) {
    const tokens = String(needleText || '').split(/\s+/).filter(Boolean);
    return (url, init) => tokens.every(token => {
      if (token.startsWith('!')) return !compileNeedle(token.slice(1)).matcher(url);
      const colon = token.indexOf(':');
      if (colon > 0) {
        const name = token.slice(0, colon);
        return compileNeedle(token.slice(colon + 1))
          .matcher(safeText(init && init[name]));
      }
      return compileNeedle(token).matcher(url);
    });
  }

  function fakeResponse(body) {
    if (global.Response && typeof global.Response === 'function') {
      try { return new global.Response(body, { status: 200, statusText: 'OK' }); }
      catch (error) { /* fall through to the plain object */ }
    }
    const text = String(body == null ? '' : body);
    return {
      ok: true, status: 200, statusText: 'OK', type: 'basic',
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text)),
      clone: () => fakeResponse(text)
    };
  }

  function responseDirective(directive) {
    if (directive === 'emptyObj') return '{}';
    if (directive === 'emptyArr') return '[]';
    if (directive === 'emptyStr' || !directive) return '';
    if (directive === 'true') {
      return Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    }
    if (directive.startsWith('length:')) {
      const bounds = directive.slice('length:'.length).split('-');
      const min = Math.min(500000, Math.max(0, Number(bounds[0]) || 0));
      const max = Math.min(500000, Math.max(min, Number(bounds[1]) || min));
      const size = min + Math.floor(Math.random() * (max - min + 1));
      return Array.from({ length: size }, () => 'x').join('');
    }
    return '';
  }

  function defuseDetector(names) {
    names.forEach(name => {
      if (typeof name !== 'string' || propertyError(name)) return;
      define(global, name, {
        value: function () { return false; }, writable: false, enumerable: false
      });
      const ref = resolvePath(name, false);
      if (!ref || !ref.target || typeof ref.target !== 'object') return;
      ['isDetected', 'check', 'get'].forEach(method => {
        if (typeof ref.target[method] === 'function') {
          define(ref.target, method, {
            value: () => false, writable: false, enumerable: false
          });
        }
      });
    });
  }

  function stubObject(names, methods) {
    names.forEach(name => {
      if (typeof name !== 'string' || propertyError(name)) return;
      const ref = resolvePath(name, true);
      if (!ref) return;
      const stub = methods.reduce((object, method) => {
        object[method] = () => undefined;
        return object;
      }, {});
      define(ref.target, ref.key, {
        value: stub, writable: false, enumerable: false
      });
    });
  }

  function trapPropertySetter(path, needle) {
    const ref = resolvePath(path, true);
    if (!ref) return;
    const matcher = compileNeedle(needle).matcher;
    const descriptor = Object.getOwnPropertyDescriptor(ref.target, ref.key);
    const originalSet = descriptor && descriptor.set;
    let value = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    define(ref.target, ref.key, {
      get: () => value,
      set: next => {
        if (matcher(safeText(next))) return;
        value = next;
        if (typeof originalSet === 'function') originalSet.call(ref.target, next);
      },
      enumerable: true
    });
  }

  // One canonical name per behavior. Short names are aliases of the canonical
  // key, so exceptions match no matter which spelling a filter used.
  const DEFINITIONS = Object.freeze({
    'abort-on-property-read': {
      aliases: ['aopr'],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => trapRead(args[0],
        () => { throw new Error('WildFire blocked read of ' + args[0]); })
    },
    'abort-on-property-write': {
      aliases: ['aopw'],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => trapWrite(args[0])
    },
    'set-constant': {
      aliases: ['set'],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) ||
        (owns(CONSTANTS, args[1]) ? '' : 'unsupported constant value'),
      run: args => setConstant(args[0], CONSTANTS[args[1]]())
    },
    'abort-current-script': {
      aliases: ['acs', 'abort-current-inline-script', 'acis'],
      validate: args => arityError(args, 1, 3) || propertyError(args[0]) ||
        needleError(args[1]) || needleError(args[2]),
      run: args => abortCurrentScript(args)
    },
    'noeval': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => blockEval()
    },
    'noeval-silent': {
      aliases: ['silent-noeval'],
      validate: args => arityError(args, 0, 0),
      run: () => blockEval()
    },
    'noeval-if': {
      aliases: ['prevent-eval-if'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => conditionalEval(args[0])
    },
    'prevent-settimeout': {
      aliases: ['no-settimeout-if', 'nostif', 'settimeout-defuser'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => wrapTimer('setTimeout', args[0])
    },
    'prevent-setinterval': {
      aliases: ['no-setinterval-if', 'nosiif', 'setinterval-defuser'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => wrapTimer('setInterval', args[0])
    },
    'addeventlistener-defuser': {
      aliases: ['aeld', 'prevent-addeventlistener'],
      validate: args => arityError(args, 0, 2) ||
        needleError(args[0]) || needleError(args[1]),
      run: args => defuseEvents(args[0], args[1])
    },
    'window.name-defuser': {
      aliases: ['windowname-defuser'],
      validate: args => arityError(args, 0, 0),
      run: () => defuseWindowName()
    },
    'prevent-window-open': {
      aliases: ['nowoif', 'no-window-open-if', 'window.open-defuser'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => defuseWindowOpen(args[0])
    },
    'abort-on-stack-trace': {
      aliases: ['aost'],
      validate: args => arityError(args, 1, 2) || propertyError(args[0]) ||
        needleError(args[1]),
      run: args => trapRead(args[0], () => {
        const needle = args[1];
        if (needle === 'inlineScript' || needle === 'injectedScript' ||
          compileNeedle(needle).matcher(scriptStack())) {
          throw new Error('WildFire blocked read of ' + args[0]);
        }
      })
    },
    'remove-attr': {
      aliases: ['ra'],
      validate: args => arityError(args, 2, 2),
      run: args => changeAttribute(args[0], args[1], 'remove', '')
    },
    'remove-class': {
      aliases: ['rc'],
      validate: args => arityError(args, 2, 2) || (/^\S+$/.test(args[1]) ? '' : 'invalid class'),
      run: args => changeClass(args[0], args[1], false)
    },
    'set-attr': {
      aliases: [],
      validate: args => arityError(args, 3, 3) ||
        (/^[A-Za-z_:][-\w.:]*$/.test(args[1]) ? '' : 'invalid attribute'),
      run: args => changeAttribute(args[0], args[1], 'set', args[2])
    },
    'set-cookie': {
      aliases: [],
      validate: args => arityError(args, 2, 3) ||
        (/^[^\s;=]+$/.test(args[0]) ? '' : 'invalid cookie name') ||
        (/^[^\r\n;]*$/.test(args[1]) ? '' : 'invalid cookie value') ||
        (args[2] === undefined || /^\d+$/.test(args[2]) ? '' : 'invalid cookie expiry'),
      run: args => writeCookie(args[0], args[1], Number(args[2]))
    },
    'set-cookie-reload': {
      aliases: [],
      validate: args => arityError(args, 2, 2) ||
        (/^[^\s;=]+$/.test(args[0]) ? '' : 'invalid cookie name') ||
        (/^[^\r\n;]*$/.test(args[1]) ? '' : 'invalid cookie value'),
      run: args => {
        const key = 'wildfire.reloaded.' + args[0];
        const already = safeStorageRead('sessionStorage', key);
        writeCookie(args[0], args[1], 30);
        storageWrite('sessionStorage', key, '1');
        if (!already && global.location && typeof global.location.reload === 'function') {
          try { global.location.reload(); } catch (error) { /* restricted */ }
        }
      }
    },
    'remove-cookie': {
      aliases: ['cookie-remover'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => removeCookie(args[0])
    },
    'set-local-storage-item': {
      aliases: [],
      validate: args => arityError(args, 2, 2),
      run: args => storageWrite('localStorage', args[0], args[1])
    },
    'set-session-storage-item': {
      aliases: [],
      validate: args => arityError(args, 2, 2),
      run: args => storageWrite('sessionStorage', args[0], args[1])
    },
    'disable-newtab-links': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => onDom('a[target]', element => {
        if (element.getAttribute('target') !== '_self') element.setAttribute('target', '_self');
      })
    },
    'close-window': {
      aliases: ['window-close-if'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const path = global.location
          ? String(global.location.pathname || '') + String(global.location.search || '')
          : '';
        if (compileNeedle(args[0]).matcher(path) && typeof global.close === 'function') {
          try { global.close(); } catch (error) { /* restricted */ }
        }
      }
    },
    'href-sanitizer': {
      aliases: [],
      validate: args => arityError(args, 1, 3) ||
        (/^(?:text|\[[^\]]+\]|\?[^ ]*)?$/.test(args[1] || '') ? '' : 'invalid href source') ||
        (/^(?:base64decode|-base64|removeHash|removeParam(?::[\w,]+)?)?$/
          .test(args[2] || '') ? '' : 'invalid href transform'),
      run: args => sanitizeHref(args[0], args[1], args[2])
    },
    'prevent-innerhtml': {
      aliases: ['prevent-innerHTML'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => trapPropertySetter('Element.prototype.innerHTML', args[0])
    },
    'remove-node-text': {
      aliases: ['rmnt'],
      validate: args => arityError(args, 2, 2) || needleError(args[1]),
      run: args => removeNodeText(args[0], args[1])
    },
    'call-nothrow': {
      aliases: [],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => callNothrow(args[0])
    },
    'adjust-settimeout': {
      aliases: ['nano-settimeout-booster', 'nano-stb'],
      validate: args => arityError(args, 0, 3) ||
        needleError(args[0]) ||
        (!args[1] || args[1] === '*' || /^\d+$/.test(args[1]) ? '' : 'invalid delay') ||
        (!args[2] || /^\d+(?:\.\d+)?$/.test(args[2]) ? '' : 'invalid boost'),
      run: args => adjustTimer('setTimeout', args[0], args[1], args[2])
    },
    'adjust-setinterval': {
      aliases: ['nano-setinterval-booster', 'nano-sib'],
      validate: args => arityError(args, 0, 3) ||
        needleError(args[0]) ||
        (!args[1] || args[1] === '*' || /^\d+$/.test(args[1]) ? '' : 'invalid delay') ||
        (!args[2] || /^\d+(?:\.\d+)?$/.test(args[2]) ? '' : 'invalid boost'),
      run: args => adjustTimer('setInterval', args[0], args[1], args[2])
    },
    'prevent-refresh': {
      aliases: ['refresh-defuser'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const matcher = compileNeedle(args[0]).matcher;
        const ref = resolvePath('location.reload', false);
        if (ref && typeof ref.target[ref.key] === 'function') {
          define(ref.target, ref.key, {
            value: function () {
              if (matcher(safeText(arguments[0]))) return undefined;
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        }
      }
    },
    'prevent-requestanimationframe': {
      aliases: ['no-requestanimationframe-if', 'norafif'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const original = global.requestAnimationFrame;
        if (typeof original !== 'function') return;
        const matcher = compileNeedle(args[0]).matcher;
        define(global, 'requestAnimationFrame', {
          value: function (callback) {
            if (matcher(safeText(callback))) return 0;
            return original.apply(global, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'nowebrtc': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => define(global, 'RTCPeerConnection', {
        value: undefined, writable: false, enumerable: false
      })
    },
    'webrtc-if': {
      aliases: [],
      validate: args => arityError(args, 1, 2) || needleError(args[0]),
      run: args => {
        const host = String(global.location && global.location.hostname || '');
        if (compileNeedle(args[0]).matcher(host)) {
          define(global, 'RTCPeerConnection', {
            value: undefined, writable: false, enumerable: false
          });
        }
      }
    },
    'alert-buster': {
      aliases: [],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const matcher = args[0] ? compileNeedle(args[0]).matcher : () => false;
        ['alert', 'confirm', 'prompt'].forEach(name => {
          if (typeof global[name] !== 'function') return;
          define(global, name, {
            value: function (message) {
              if (!matcher(safeText(message))) {
                return name === 'prompt' ? '' : true;
              }
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        });
      }
    },
    'prevent-dialog': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        const proto = global.HTMLDialogElement && global.HTMLDialogElement.prototype;
        if (!proto) return;
        ['show', 'showModal'].forEach(name => {
          if (typeof proto[name] !== 'function') return;
          define(proto, name, {
            value: function () { return undefined; }, writable: true, enumerable: false
          });
        });
      }
    },
    'overlay-buster': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => injectStyle('[style*="position: fixed"],[style*="position:fixed"],' +
        '[style*="z-index: 999"],[style*="z-index:999"]{' +
        'display:none!important;pointer-events:none!important}')
    },
    'spoof-css': {
      aliases: [],
      validate: args => arityError(args, 0, 2),
      run: args => {
        const css = global.CSS;
        if (!css || typeof css.supports !== 'function') return;
        const property = String(args[0] || '').toLowerCase();
        const value = String(args[1] || '').toLowerCase();
        const original = css.supports.bind(css);
        define(css, 'supports', {
          value: function (name, candidate) {
            if (String(name).toLowerCase() === property &&
              String(candidate).toLowerCase() === value) return true;
            return original.apply(css, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-canvas': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        const proto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
        if (!proto || typeof proto.toDataURL !== 'function') return;
        define(proto, 'toDataURL', {
          value: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIDBA==',
          writable: true,
          enumerable: false
        });
      }
    },
    'json-prune': {
      aliases: [],
      validate: args => arityError(args, 0, 3) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2]),
      run: args => {
        const original = global.JSON && global.JSON.parse;
        if (typeof original !== 'function') return;
        define(global.JSON, 'parse', {
          value: function (text) {
            const result = original.apply(global.JSON, arguments);
            return pruneJson(result, args[0], args[1]);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'evaldata-prune': {
      aliases: [],
      validate: args => arityError(args, 0, 3) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2]),
      run: args => {
        const original = global.eval;
        if (typeof original !== 'function') return;
        define(global, 'eval', {
          value: function (source) {
            if (typeof source !== 'string') return original.apply(global, arguments);
            try {
              const parsed = global.JSON.parse(source);
              pruneJson(parsed, args[0], args[1]);
              return parsed;
            } catch (error) {
              return original.apply(global, arguments);
            }
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-fetch': {
      aliases: ['no-fetch-if'],
      validate: args => arityError(args, 0, 3) || lengthError(args[0]) ||
        (/^(?:true|emptyObj|emptyArr|emptyStr|length:\d+(?:-\d+)?|\[[^\]]+\])?$/
          .test(args[1] || '') ? '' : 'invalid fetch directive'),
      run: args => {
        const original = global.fetch;
        if (typeof original !== 'function') return;
        const matches = conditionMatcher(args[0]);
        const directive = args[1];
        define(global, 'fetch', {
          value: function (url, init) {
            if (!matches(safeText(url), init)) return original.apply(global, arguments);
            return Promise.resolve(fakeResponse(responseDirective(directive)));
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-xhr': {
      aliases: ['no-xhr-if'],
      validate: args => arityError(args, 0, 2) || lengthError(args[0]),
      run: args => {
        const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
        if (!proto || typeof proto.open !== 'function') return;
        const originalOpen = proto.open;
        const originalSend = proto.send;
        const matches = conditionMatcher(args[0]);
        const blocked = new WeakSet();
        define(proto, 'open', {
          value: function (method, url) {
            if (matches(safeText(url))) blocked.add(this);
            else blocked.delete(this);
            return originalOpen.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
        if (typeof originalSend === 'function') {
          define(proto, 'send', {
            value: function () {
              if (!blocked.has(this)) return originalSend.apply(this, arguments);
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        }
      }
    },
    'nobab': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['BlockAdblock', 'blockAdBlock', 'blockadblock'])
    },
    'nobab2': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['BlockAdblock', 'blockAdBlock', 'baidustatic'])
    },
    'nofab': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['FuckAdblock', 'fuckAdBlock', 'FAB'])
    },
    'fingerprint2': {
      aliases: ['fingerprintjs2'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['Fingerprint2', 'FingerprintJS2'], ['get', 'getPromise', 'getWithPromiseCallback'])
    },
    'fingerprint3': {
      aliases: ['fingerprintjs3'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['FingerprintJS', 'Fingerprint3'], ['load', 'get'])
    },
    'prebid-ads': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['pbjs', 'pbjsInstance'], ['init', 'requestBids', 'setConfig'])
    },
    'popads': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['PopAds', 'popads'], ['load', 'init'])
    },
    'ampproject-v0': {
      aliases: ['ampproject_v0'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['AMP'], ['registerService', 'push'])
    }
  });

  const CANONICAL = Object.keys(DEFINITIONS).reduce((map, name) => {
    map[name] = name;
    DEFINITIONS[name].aliases.forEach(alias => { map[alias] = name; });
    return map;
  }, Object.create(null));

  function canonical(alias) {
    const name = String(alias || '').trim().toLowerCase();
    return CANONICAL[name] || name;
  }

  function validate(alias, args) {
    const name = String(alias || '').trim().toLowerCase();
    if (name.startsWith('trusted-')) return 'trusted scriptlets require a trusted source';
    const resolved = CANONICAL[name];
    if (!resolved) return 'unknown scriptlet alias: ' + name;
    return DEFINITIONS[resolved].validate(Array.isArray(args) ? args : []);
  }

  function domainMatches(host, domain) {
    const key = String(domain || '').toLowerCase().replace(/^\./, '');
    return Boolean(host && key) && (host === key || host.endsWith('.' + key));
  }

  function appliesTo(entry, host) {
    if (!entry || typeof entry !== 'object') return false;
    const domains = Array.isArray(entry.domains) ? entry.domains : [];
    if (!domains.length) return true;
    const included = domains.filter(domain => !domain.startsWith('~'));
    const excluded = domains
      .filter(domain => domain.startsWith('~'))
      .map(domain => domain.slice(1));
    const isIncluded = !included.length ||
      included.some(domain => domainMatches(host, domain));
    return isIncluded && !excluded.some(domain => domainMatches(host, domain));
  }

  function sameRule(left, right) {
    const leftArgs = Array.isArray(left.args) ? left.args : [];
    const rightArgs = Array.isArray(right.args) ? right.args : [];
    return canonical(left.alias) === canonical(right.alias) &&
      leftArgs.length === rightArgs.length &&
      leftArgs.every((arg, index) => String(arg) === String(rightArgs[index]));
  }

  function run(entry) {
    const name = canonical(entry.alias);
    const definition = DEFINITIONS[name];
    if (!definition || validate(entry.alias, entry.args)) return;
    try {
      definition.run(Array.isArray(entry.args) ? entry.args : []);
    } catch (error) {
      /* A page must never see an exception from a WildFire scriptlet. */
    }
  }

  function apply(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const host = String((global.location && global.location.hostname) || '').toLowerCase();
    const applicable = list.filter(entry => appliesTo(entry, host));
    const exceptions = applicable.filter(entry => entry.isException);
    const active = applicable.filter(entry => !entry.isException &&
      !exceptions.some(exception => sameRule(exception, entry)));
    active.forEach(run);
  }

  global.WildFireScriptlets = {
    aliases: Object.keys(CANONICAL),
    canonical,
    validate,
    apply,
    domainMatches
  };
})(this);

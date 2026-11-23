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

  function optionalLengthError(value, max) {
    return value === undefined ? '' : lengthError(value, max);
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

  function hasPath(value, path) {
    return String(path || '').split('.').filter(Boolean).reduce((current, part) =>
      current && typeof current === 'object' ? current[part] : undefined, value) !== undefined;
  }

  function pruneJson(value, paths, obligatory) {
    if (!value || typeof value !== 'object') return value;
    const required = String(obligatory || '').split(/\s+/).filter(Boolean);
    const present = required.every(path => hasPath(value, path));
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
        if (name === 'url') return compileNeedle(token.slice(colon + 1)).matcher(url);
        return compileNeedle(token.slice(colon + 1))
          .matcher(safeText(init && init[name]));
      }
      return compileNeedle(token).matcher(url);
    });
  }

  // Named token values arrive as `propsToMatch` / `stackToMatch, needle`
  // pairs after the positional arguments. Only data is accepted here.
  function namedArg(args, name) {
    const index = args.findIndex(arg => String(arg).toLowerCase() === name);
    return index === -1 || index === args.length - 1 ? '' : String(args[index + 1]);
  }

  function stackAllows(needle) {
    if (!needle) return true;
    const negate = needle.startsWith('!');
    const matched = compileNeedle(negate ? needle.slice(1) : needle).matcher(scriptStack());
    return negate ? !matched : matched;
  }

  function redefine(target, key, descriptor) {
    try {
      Object.defineProperty(target, key, Object.assign({ configurable: true }, descriptor));
    } catch (error) {
      /* Native APIs can be non-configurable; leave them untouched. */
    }
  }

  // Shared fetch/XHR response hook. `transform(value, text)` returns the new
  // parsed value for mode 'json' or the new text for mode 'text'. It receives
  // only data from the page, never code from the filter.
  function installResponseTransformer(transform, urlNeedle, mode, target) {
    const urls = new WeakMap();
    const urlMatcher = compileNeedle(urlNeedle).matcher;
    const eligible = url => !urlNeedle ||
      urlMatcher(url) || urlMatcher(String(global.location && global.location.href || ''));
    const wantsFetch = target !== 'xhr';
    const wantsXhr = target !== 'fetch';

    if (wantsFetch && typeof global.fetch === 'function') {
      const originalFetch = global.fetch;
      redefine(global, 'fetch', {
        value: function (url) {
          const result = originalFetch.apply(global, arguments);
          if (result && typeof result.then === 'function') {
            Promise.resolve(result).then(response => {
              if (response && typeof response === 'object') {
                try { urls.set(response, safeText(url)); } catch (error) { /* ignore */ }
              }
            }).catch(() => {});
          }
          return result;
        },
        writable: true,
        enumerable: false
      });
    }

    const responseProto = global.Response && global.Response.prototype;
    if (wantsFetch && responseProto) {
      const method = mode === 'json' ? 'json' : 'text';
      const original = responseProto[method];
      if (typeof original === 'function') {
        redefine(responseProto, method, {
          value: function () {
            if (!eligible(urls.get(this) || '')) return original.call(this);
            if (mode === 'json') {
              return original.call(this).then(value => transform(value, ''));
            }
            return original.call(this).then(text => {
              const replacement = transform(null, String(text));
              return typeof replacement === 'string' ? replacement : text;
            });
          },
          writable: true,
          enumerable: false
        });
      }
    }

    const xhrProto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
    if (wantsXhr && xhrProto) {
      const originalOpen = xhrProto.open;
      if (typeof originalOpen === 'function') {
        redefine(xhrProto, 'open', {
          value: function (method, url) {
            try {
              if (eligible(safeText(url))) urls.set(this, safeText(url));
              else urls.delete(this);
            } catch (error) { /* ignore */ }
            return originalOpen.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
      const descriptor = Object.getOwnPropertyDescriptor(xhrProto, 'responseText');
      if (descriptor && typeof descriptor.get === 'function') {
        redefine(xhrProto, 'responseText', {
          get: function () {
            const text = descriptor.get.call(this);
            if (!urls.has(this)) return text;
            if (mode === 'json') {
              try {
                return JSON.stringify(transform(JSON.parse(String(text)), ''));
              } catch (error) {
                return text;
              }
            }
            const replacement = transform(null, String(text));
            return typeof replacement === 'string' ? replacement : text;
          },
          set: descriptor.set,
          enumerable: true
        });
      }
    }
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

  // WildFire accepts the simple, non-trusted subset: removal only. JSONPath
  // expressions are translated into the same path format json-prune uses.
  function jsonPathToPrune(spec) {
    return String(spec || '')
      .replace(/^\$\.?/, '')
      .replace(/\[\*\]/g, '.*')
      .replace(/\['([^']+)'\]/g, '.$1')
      .replace(/\["([^"]+)"\]/g, '.$1')
      .replace(/\[\?\([^\]]*\)\]/g, '.*')
      .replace(/\[(\d+)\]/g, '.$1')
      .replace(/[\[\]]/g, '')
      .replace(/^\.+/, '')
      .replace(/\.+/g, '.');
  }

  function editObject(value, spec) {
    return pruneJson(value, jsonPathToPrune(spec));
  }

  function installRequestTransformer(transform, urlNeedle, target) {
    const urls = new WeakMap();
    const urlMatcher = compileNeedle(urlNeedle).matcher;
    const eligible = url => !urlNeedle ||
      urlMatcher(url) || urlMatcher(String(global.location && global.location.href || ''));
    const editBody = body => {
      if (typeof body !== 'string') return body;
      try {
        return JSON.stringify(transform(JSON.parse(body), ''));
      } catch (error) {
        return body;
      }
    };

    if (target !== 'xhr' && typeof global.fetch === 'function') {
      const originalFetch = global.fetch;
      redefine(global, 'fetch', {
        value: function (url, init) {
          const options = init && typeof init === 'object' ? Object.assign({}, init) : init;
          if (eligible(safeText(url)) && options && 'body' in options) {
            options.body = editBody(options.body);
          }
          return originalFetch.call(global, url, options);
        },
        writable: true,
        enumerable: false
      });
    }

    const xhrProto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
    if (target !== 'fetch' && xhrProto) {
      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;
      if (typeof originalOpen === 'function') {
        redefine(xhrProto, 'open', {
          value: function (method, url) {
            try {
              if (eligible(safeText(url))) urls.set(this, true);
              else urls.delete(this);
            } catch (error) { /* ignore */ }
            return originalOpen.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
      if (typeof originalSend === 'function') {
        redefine(xhrProto, 'send', {
          value: function (body) {
            if (!urls.has(this)) return originalSend.apply(this, arguments);
            return originalSend.call(this, editBody(body));
          },
          writable: true,
          enumerable: false
        });
      }
    }
  }

  function xmlNodes(document, spec) {
    if (!spec) return [];
    if (spec.startsWith('xpath(') && spec.endsWith(')')) {
      if (typeof document.evaluate !== 'function') return [];
      try {
        const expression = document.evaluate(spec.slice(6, -1).trim(), document, null, 7, null);
        return Array.from({ length: expression.snapshotLength },
          (_, index) => expression.snapshotItem(index));
      } catch (error) {
        return [];
      }
    }
    try {
      return Array.from(document.querySelectorAll(spec));
    } catch (error) {
      return [];
    }
  }

  function pruneXmlText(text, selector, required) {
    if (!global.DOMParser || !global.XMLSerializer) return text;
    try {
      const document = new global.DOMParser().parseFromString(String(text), 'application/xml');
      if (required && !xmlNodes(document, required).length) return text;
      xmlNodes(document, selector).forEach(node => {
        if (!node.parentNode) return;
        if (node.nodeType === 2) node.parentNode.removeAttributeNode(node);
        else node.parentNode.removeChild(node);
      });
      return new global.XMLSerializer().serializeToString(document);
    } catch (error) {
      return text;
    }
  }

  function compileReplaceRegex(value) {
    const raw = String(value || '');
    const last = raw.lastIndexOf('/');
    if (!raw.startsWith('/') || last <= 0) return null;
    if (!/^[gimsu]*$/.test(raw.slice(last + 1)) || needleSafetyError(raw.slice(1, last))) {
      return null;
    }
    try {
      return new RegExp(raw.slice(1, last), raw.slice(last + 1));
    } catch (error) {
      return null;
    }
  }

  function pruneM3uText(text, needle) {
    const regex = compileReplaceRegex(needle);
    if (!regex) return text;
    if (regex.multiline) {
      const replaced = String(text).replace(regex, '');
      return replaced;
    }
    const perLine = new RegExp(regex.source, regex.flags.replace('g', ''));
    return String(text).split('\n').map(line => perLine.test(line) ? '' : line).join('\n');
  }

  function installObjectEdit(path, spec, kind, position) {
    const ref = resolvePath(path, false);
    if (!ref || typeof ref.target[ref.key] !== 'function') return;
    const original = ref.target[ref.key];
    redefine(ref.target, ref.key, {
      value: function () {
        const args = Array.from(arguments);
        if (kind === 'outbound') return editObject(original.apply(this, args), spec);
        if (kind === 'inbound') {
          const index = position < 0 ? args.length + position : position;
          if (args[index] && typeof args[index] === 'object') {
            args[index] = editObject(args[index], spec);
          }
          return original.apply(this, args);
        }
        editObject(this, spec);
        return original.apply(this, args);
      },
      writable: true,
      enumerable: false
    });
  }

  function pruneJsonlText(text, spec) {
    return String(text).split('\n').map(line => {
      try {
        return JSON.stringify(editObject(JSON.parse(line), spec));
      } catch (error) {
        return line;
      }
    }).join('\n');
  }

  function jsonPathError(value) {
    return lengthError(value, 512) ||
      (/^[\w$.\[\]'"?*,:\s\-]*$/.test(value) ? '' : 'invalid JSONPath query');
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

  // AdGuard arguments are always strings. Values such as `trueFunc` are mapped
  // to WildFire-owned functions here; no filter text is ever compiled.
  const ADGUARD_RESTRICTED = new Set([
    'debug-current-inline-script', 'debug-on-property-read',
    'debug-on-property-write', 'log-on-stack-trace'
  ]);

  function adguardConstant(value) {
    const token = String(value == null ? '' : value).toLowerCase();
    if (['true', 't', 'yes', 'y', 'ok', 'on', 'all', 'accept', 'accepted',
      'allow', 'allowed', 'enable', 'enabled', 'mandatory', 'necessary',
      'required', 'hide', 'hidden', 'essential', 'checked', 'forever'].includes(token)) {
      return { value: true };
    }
    if (['false', 'f', 'no', 'n', 'off', 'notaccepted', 'reject', 'rejected',
      'declined', 'disallow', 'deny', 'denied', 'disable', 'disabled',
      'nonessential', 'unchecked', 'forbidden'].includes(token)) {
      return { value: false };
    }
    if (token === 'undefined') return { value: undefined };
    if (token === 'null') return { value: null };
    if (token === 'emptyobj') return { value: {} };
    if (token === 'emptyarr') return { value: [] };
    if (token === 'noopfunc' || token === 'noopcallbackfunc') {
      return { value: function () { return undefined; } };
    }
    if (token === 'truefunc') return { value: () => true };
    if (token === 'falsefunc') return { value: () => false };
    if (token === 'throwfunc') {
      return { value: function () { throw new Error('WildFire no-op stub'); } };
    }
    if (token === 'nooppromiseresolve') return { value: () => Promise.resolve() };
    if (token === 'nooppromisereject') return { value: () => Promise.reject() };
    if (token === '') return { value: '' };
    if (/^-?\d+$/.test(token) && Math.abs(Number(token)) <= 32767) {
      return { value: Number(token) };
    }
    return { error: 'unsupported AdGuard constant value' };
  }

  function adguardLog() {
    const logger = global.console;
    if (logger && typeof logger.log === 'function') {
      logger.log.apply(logger, ['[WildFire]'].concat(Array.from(arguments)));
    }
  }

  function adguardSetConstantError(args) {
    const result = adguardConstant(args[1]);
    return arityError(args, 2, 5) || propertyError(args[0]) || result.error ||
      optionalLengthError(args[2], 512) || optionalLengthError(args[3], 64) ||
      optionalLengthError(args[4], 16);
  }

  function adguardSetConstant(args) {
    if (adguardSetConstantError(args)) return;
    if (!stackAllows(args[2])) return;
    const constant = adguardConstant(args[1]).value;
    let value = constant;
    const wrapper = String(args[3] || '').toLowerCase();
    if (wrapper === 'asfunction') value = () => constant;
    else if (wrapper === 'ascallback') value = () => () => constant;
    else if (wrapper === 'asresolved') value = Promise.resolve(constant);
    else if (wrapper === 'asrejected') value = Promise.reject(constant);
    if (String(args[4]) === 'true' && value && typeof value === 'object' && global.Proxy) {
      value = new global.Proxy(value, {
        get: (target, key) => target[key],
        set: (target, key, next) => { target[key] = next; return true; }
      });
    }
    setConstant(args[0], value);
  }

  function adguardCookieError(args) {
    return arityError(args, 2, 4) ||
      (/^[^\s;=]+$/.test(args[0]) ? '' : 'invalid cookie name') ||
      (adguardConstant(args[1]).error || '') ||
      (args[2] === undefined || args[2] === 'none' || /^\/[^\r\n;]*$/.test(args[2])
        ? '' : 'invalid cookie path') ||
      (args[3] === undefined || args[3] === 'none' ||
        /^[A-Za-z0-9.\-]+$/.test(args[3]) ? '' : 'invalid cookie domain');
  }

  function adguardWriteCookie(args) {
    if (adguardCookieError(args)) return;
    const constant = adguardConstant(args[1]).value;
    const value = constant && typeof constant === 'object'
      ? JSON.stringify(constant) : String(constant);
    const attributes = [];
    if (args[2] && args[2] !== 'none') attributes.push('path=' + args[2]);
    const host = String((global.location && global.location.hostname) || '');
    if (args[3] && args[3] !== 'none' && host.endsWith(args[3])) {
      attributes.push('domain=' + args[3]);
    }
    const line = args[0] + '=' + value +
      (attributes.length ? '; ' + attributes.join('; ') : '');
    try {
      if (global.document) global.document.cookie = line;
    } catch (error) { /* cookie disabled */ }
  }

  function adguardStorageError(args) {
    return arityError(args, 2, 2) || lengthError(args[0], 512) ||
      lengthError(args[1], 512);
  }

  function adguardStorageWrite(area, key, value) {
    if (adguardStorageError([key, value])) return;
    let store;
    try { store = global[area]; } catch (error) { return; }
    if (!store) return;
    const regex = key.startsWith('/') ? compileReplaceRegex(key) : null;
    const matches = regex
      ? name => regex.test(String(name))
      : name => String(name) === key;
    try {
      if (value === '$remove$') {
        if (typeof store.removeItem === 'function') {
          if (regex) Object.keys(store).filter(matches).forEach(name => store.removeItem(name));
          else store.removeItem(key);
        }
        return;
      }
      if (regex) Object.keys(store).filter(matches).forEach(name => store.setItem(name, value));
      else store.setItem(key, value);
    } catch (error) { /* storage disabled */ }
  }

  function adguardStorageReload(args) {
    if (adguardCookieError(args.slice(0, 4))) return;
    const key = 'wildfire.adguard.reloaded.' + args[0];
    const already = safeStorageRead('sessionStorage', key);
    adguardWriteCookie(args);
    storageWrite('sessionStorage', key, '1');
    if (!already && global.location && typeof global.location.reload === 'function') {
      try { global.location.reload(); } catch (error) { /* restricted */ }
    }
  }

  function queryInRoot(root, selector) {
    if (!root || !safeSelector(selector) || typeof root.querySelectorAll !== 'function') return [];
    try { return Array.from(root.querySelectorAll(selector)); }
    catch (error) { return []; }
  }

  function adguardShadowHosts(baseSelector) {
    return queryAll(baseSelector || '*').map(host => host.shadowRoot).filter(Boolean);
  }

  function adguardShadowDom(selector, baseSelector, hide) {
    onDom(baseSelector || '*', host => {
      if (!host.shadowRoot) return;
      const nodes = queryInRoot(host.shadowRoot, selector);
      if (hide) {
        nodes.forEach(node => {
          const style = global.document.createElement('style');
          style.textContent = '[data-wildfire-shadow-hide] { display: none !important; }';
          host.shadowRoot.appendChild(style);
          try { node.setAttribute('data-wildfire-shadow-hide', ''); } catch (error) { /* locked */ }
        });
        return;
      }
      nodes.forEach(node => {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    });
  }

  function adguardCssRuleError(rule) {
    if (typeof rule !== 'string' || !rule || rule.length > 2000 ||
      /[<>]|<\/style/i.test(rule)) return 'invalid CSS rule';
    const open = rule.indexOf('{');
    if (open <= 0 || !rule.trim().endsWith('}')) return 'invalid CSS rule';
    const selectors = rule.slice(0, open).split(',').map(part => part.trim());
    return selectors.every(part => part.length > 0 && part.length <= 500 &&
      /^[\w#.\[\]'"=:>+~*(),\s-]+$/.test(part)) ? '' : 'invalid CSS rule';
  }

  function adguardInjectShadowCss(rule, hostSelector, method) {
    if (adguardCssRuleError(rule)) return;
    const style = global.document && global.document.createElement('style');
    if (!style) return;
    style.textContent = rule;
    adguardShadowHosts(hostSelector).forEach(root => {
      if (method === 'styleTag') root.appendChild(style.cloneNode(true));
      else {
        root.appendChild(style.cloneNode(true));
      }
    });
  }

  function adguardConstructor(name, argumentSearch) {
    if (propertyError(name) || needleError(argumentSearch)) return;
    const ref = resolvePath(name, false);
    if (!ref) return;
    const original = ref.target[ref.key];
    if (typeof original !== 'function') return;
    const matcher = compileNeedle(argumentSearch).matcher;
    define(ref.target, ref.key, {
      value: function () {
        const text = Array.from(arguments).map(safeText).join(' ');
        if (argumentSearch && matcher(text)) {
          throw new Error('WildFire blocked constructor ' + name);
        }
        if (global.Reflect && typeof global.Reflect.construct === 'function') {
          return global.Reflect.construct(original, Array.from(arguments));
        }
        return original.apply(this, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function adguardPreventNavigation(pattern) {
    const matcher = compileNeedle(pattern).matcher;
    const location = global.location;
    if (!location) return;
    ['assign', 'replace'].forEach(name => {
      if (typeof location[name] !== 'function') return;
      const original = location[name];
      redefine(location, name, {
        value: function (url) {
          if (pattern && matcher(safeText(url))) {
            adguardLog('prevented navigation', safeText(url));
            return undefined;
          }
          if (!pattern) adguardLog('navigation attempt', safeText(url));
          return original.apply(location, arguments);
        },
        writable: true,
        enumerable: false
      });
    });
    if (typeof location.reload !== 'function') return;
    const originalReload = location.reload;
    redefine(location, 'reload', {
      value: function () {
        if (pattern && matcher('location.href')) {
          adguardLog('prevented reload');
          return undefined;
        }
        if (!pattern) adguardLog('reload attempt');
        return originalReload.apply(location, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function adguardPreventElementSrc(tagName, match) {
    onDom(tagName.toLowerCase(), element => {
      const src = String(element.getAttribute('src') || element.getAttribute('href') || '');
      if (!compileNeedle(match).matcher(src)) return;
      if (element.hasAttribute('src')) element.removeAttribute('src');
      if (element.hasAttribute('href')) element.removeAttribute('href');
    });
  }

  function adguardRemoveQueryParameters(parameters, urlNeedle) {
    const compiled = parameters.startsWith('/') ? compileReplaceRegex(parameters) : null;
    const regex = compiled
      ? new RegExp(compiled.source, compiled.flags.replace('g', '')) : null;
    const names = regex ? [] : parameters.split(',').map(part => part.trim()).filter(Boolean);
    const urlMatcher = compileNeedle(urlNeedle).matcher;
    const eligible = url => !urlNeedle || urlMatcher(safeText(url));
    const strip = url => {
      try {
        const parsed = new global.URL(safeText(url), global.location.href);
        const doomed = [];
        parsed.searchParams.forEach((value, name) => {
          if (regex ? regex.test(name) : names.includes(name)) doomed.push(name);
        });
        doomed.forEach(name => parsed.searchParams.delete(name));
        return parsed.href;
      } catch (error) {
        return url;
      }
    };
    if (typeof global.fetch === 'function') {
      const originalFetch = global.fetch;
      redefine(global, 'fetch', {
        value: function (url, init) {
          return originalFetch.call(global, eligible(url) ? strip(url) : url, init);
        },
        writable: true,
        enumerable: false
      });
    }
    const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
    if (proto && typeof proto.open === 'function') {
      const originalOpen = proto.open;
      redefine(proto, 'open', {
        value: function (method, url) {
          const target = eligible(url) ? strip(url) : url;
          return originalOpen.call(this, method, target);
        },
        writable: true,
        enumerable: false
      });
    }
  }

  function adguardLogMethod(path) {
    if (propertyError(path)) return;
    const ref = resolvePath(path, false);
    if (!ref || typeof ref.target[ref.key] !== 'function') return;
    const original = ref.target[ref.key];
    redefine(ref.target, ref.key, {
      value: function () {
        adguardLog(path, Array.from(arguments).map(safeText));
        return original.apply(this, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  function adguardLogRead(path) {
    if (propertyError(path)) return;
    trapRead(path, () => { adguardLog('read', path); });
  }

  function adguardDirString(times) {
    const logger = global.console;
    if (!logger || typeof logger.dir !== 'function') return;
    const count = Math.min(5, Math.max(1, Number(times) || 1));
    const original = logger.dir;
    redefine(logger, 'dir', {
      value: function (value) {
        let result = value;
        Array.from({ length: count }).forEach(() => {
          if (result && typeof result.toString === 'function') result = result.toString();
        });
        return original.call(logger, result);
      },
      writable: true,
      enumerable: false
    });
  }

  function adguardPreventInnerHtml(selector, pattern, replacement) {
    const proto = global.Element && global.Element.prototype;
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    const originalGet = descriptor && descriptor.get;
    const originalSet = descriptor && descriptor.set;
    const matcher = compileNeedle(pattern || '').matcher;
    const matches = element => !selector || queryAll(selector).includes(element);
    redefine(proto, 'innerHTML', {
      get: function () {
        const value = originalGet ? originalGet.call(this) : '';
        if (matches(this) && matcher(value) && replacement !== undefined) return replacement;
        return value;
      },
      set: function (next) {
        const value = matches(this) && matcher(next) && replacement !== undefined
          ? replacement : next;
        if (originalSet) originalSet.call(this, value);
      },
      enumerable: true
    });
  }

  function adguardXhrResponseDirective(directive) {
    if (!directive || directive === 'emptyStr') return '';
    if (directive === 'emptyObj') return '{}';
    if (directive === 'emptyArr') return '[]';
    if (/^(?:true|false|yes|no)$/i.test(directive)) {
      return String(adguardConstant(directive).value);
    }
    return '';
  }

  function adguardPreventXhr(props, directive) {
    const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
    if (!proto || typeof proto.open !== 'function') return;
    const originalOpen = proto.open;
    const matches = conditionMatcher(props);
    const blocked = new WeakSet();
    redefine(proto, 'open', {
      value: function (method, url) {
        if (matches(safeText(url))) blocked.add(this);
        else blocked.delete(this);
        return originalOpen.apply(this, arguments);
      },
      writable: true,
      enumerable: false
    });
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'responseText');
    const originalGet = descriptor && descriptor.get;
    redefine(proto, 'responseText', {
      get: function () {
        if (blocked.has(this)) return adguardXhrResponseDirective(directive);
        return originalGet ? originalGet.call(this) : '';
      },
      set: descriptor && descriptor.set,
      enumerable: true
    });
  }

  function adguardStubFunctions(names) {
    names.forEach(name => {
      if (propertyError(name)) return;
      const stub = function () { return undefined; };
      stub.push = () => 0;
      stub.l = Date.now();
      define(global, name, { value: stub, writable: false, enumerable: false });
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
    'no-floc': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        if (global.document && typeof global.document === 'object') {
          define(global.document, 'interestCohort', {
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
    },
    'json-prune-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 0, 5) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || optionalLengthError(args[2]) || needleError(args[3]),
      run: args => installResponseTransformer(value => {
        const stack = namedArg(args, 'stackToMatch') || args[3];
        return stackAllows(stack) ? pruneJson(value, args[0], args[1]) : value;
      }, namedArg(args, 'propsToMatch') || args[2], 'json', 'fetch')
    },
    'json-prune-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 0, 5) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || optionalLengthError(args[2]) || needleError(args[3]),
      run: args => installResponseTransformer(value => {
        const stack = namedArg(args, 'stackToMatch') || args[3];
        return stackAllows(stack) ? pruneJson(value, args[0], args[1]) : value;
      }, namedArg(args, 'propsToMatch') || args[2], 'json', 'xhr')
    },
    'xml-prune': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || lengthError(args[0], 500) ||
        (/[<>;{}]/.test(args[0]) ? 'invalid XML selector' : '') ||
        optionalLengthError(args[1], 500) || optionalLengthError(args[2]),
      run: args => installResponseTransformer(
        (value, text) => pruneXmlText(text, args[0], args[1]), args[2], 'text', 'both')
    },
    'm3u-prune': {
      aliases: [],
      validate: args => arityError(args, 1, 2) ||
        (compileReplaceRegex(args[0]) ? '' : 'invalid M3U needle') || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneM3uText(text, args[0]), args[1], 'text', 'both')
    },
    'popads-dummy': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['PopAds', 'popads'], ['load', 'init', 'get'])
    },
    'json-edit': {
      aliases: [],
      validate: args => arityError(args, 1, 1) || jsonPathError(args[0]),
      run: args => {
        const original = global.JSON && global.JSON.parse;
        if (typeof original !== 'function') return;
        redefine(global.JSON, 'parse', {
          value: function (text) {
            return editObject(original.apply(global.JSON, arguments), args[0]);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'json-edit-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'json', 'fetch')
    },
    'json-edit-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'json', 'xhr')
    },
    'json-edit-fetch-request': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installRequestTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'fetch')
    },
    'json-edit-xhr-request': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installRequestTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'xhr')
    },
    'jsonl-edit-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneJsonlText(text, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'text', 'fetch')
    },
    'jsonl-edit-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneJsonlText(text, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'text', 'xhr')
    },
    'edit-outbound-object': {
      aliases: [],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) || jsonPathError(args[1]),
      run: args => installObjectEdit(args[0], args[1], 'outbound', 0)
    },
    'edit-inbound-object': {
      aliases: [],
      validate: args => arityError(args, 3, 3) || propertyError(args[0]) ||
        (/^-?\d+$/.test(args[1]) ? '' : 'invalid argument position') || jsonPathError(args[2]),
      run: args => installObjectEdit(args[0], args[2], 'inbound', Number(args[1]))
    },
    'edit-this-object': {
      aliases: [],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) || jsonPathError(args[1]),
      run: args => installObjectEdit(args[0], args[1], 'this', 0)
    },
    'edit-element-object': {
      aliases: [],
      validate: args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        jsonPathError(args[1]),
      run: args => onDom(args[0], element => editObject(element, args[1]))
    }
  });

  function adguardDelegate(canonicalName, transform, validateArgs) {
    const definition = DEFINITIONS[canonicalName];
    const argsFor = args => transform ? transform(args) : args;
    return {
      canonical: canonicalName,
      validate: args => validateArgs ? validateArgs(args) : definition.validate(argsFor(args)),
      run: args => definition.run(argsFor(args))
    };
  }

  function adguardOwn(canonicalName, validate, run) {
    return { canonical: canonicalName, validate, run };
  }

  const noAdguardArgs = args => arityError(args, 0, 0);
  const restrictedAdguard = () => 'debug scriptlets are not allowed in production filters';

  // AdGuard aliases are validated as strings and then delegated to the same
  // WildFire implementations used by `##+js()`. Aliases without a uBO twin get
  // a small original implementation here; no script text is ever accepted.
  const ADGUARD_DEFINITIONS = Object.freeze({
    'abort-current-inline-script': adguardDelegate('abort-current-script'),
    'abort-on-property-read': adguardDelegate('abort-on-property-read'),
    'abort-on-property-write': adguardDelegate('abort-on-property-write'),
    'abort-on-stack-trace': adguardDelegate('abort-on-stack-trace'),
    'adjust-setinterval': adguardDelegate('adjust-setinterval'),
    'adjust-settimeout': adguardDelegate('adjust-settimeout'),
    'amazon-apstag': adguardOwn('amazon-apstag', noAdguardArgs,
      () => stubObject(['apstag'], ['init', 'fetchBids', 'setDebugEnabled', 'displayAds'])),
    'call-nothrow': adguardDelegate('call-nothrow'),
    'close-window': adguardDelegate('close-window'),
    'debug-current-inline-script': adguardOwn('debug-current-inline-script', restrictedAdguard, () => {}),
    'debug-on-property-read': adguardOwn('debug-on-property-read', restrictedAdguard, () => {}),
    'debug-on-property-write': adguardOwn('debug-on-property-write', restrictedAdguard, () => {}),
    'didomi-loader': adguardOwn('didomi-loader', noAdguardArgs,
      () => stubObject(['Didomi'], ['initialize', 'onReady', 'onConsentChanged', 'setUser'])),
    'dir-string': adguardOwn('dir-string',
      args => arityError(args, 0, 1) || optionalLengthError(args[0], 16),
      args => adguardDirString(args[0])),
    'disable-newtab-links': adguardDelegate('disable-newtab-links'),
    'evaldata-prune': adguardDelegate('evaldata-prune'),
    'fingerprintjs2': adguardDelegate('fingerprint2'),
    'fingerprintjs3': adguardDelegate('fingerprint3'),
    'freewheel-admanager': adguardOwn('freewheel-admanager', noAdguardArgs,
      () => stubObject(['tv', 'freewheel'], ['init', 'addAdUnit', 'load'])),
    'gemius': adguardOwn('gemius', noAdguardArgs,
      () => stubObject(['gemius'], ['hit', 'prepare', 'setConfig'])),
    'google-analytics-ga': adguardOwn('google-analytics-ga', noAdguardArgs,
      () => adguardStubFunctions(['ga', 'GoogleAnalyticsObject'])),
    'google-analytics': adguardOwn('google-analytics', noAdguardArgs,
      () => adguardStubFunctions(['ga', 'gtag', 'dataLayer'])),
    'google-ima3-dai': adguardOwn('google-ima3-dai', noAdguardArgs,
      () => stubObject(['google.ima.dai'], ['TvPlayer', 'init', 'load'])),
    'google-ima3': adguardOwn('google-ima3', noAdguardArgs,
      () => stubObject(['google.ima'], ['AdDisplayContainer', 'AdsLoader', 'AdsManager'])),
    'googlesyndication-adsbygoogle': adguardOwn('googlesyndication-adsbygoogle', noAdguardArgs,
      () => {
        if (!propertyError('adsbygoogle')) define(global, 'adsbygoogle', {
          value: [], writable: false, enumerable: false
        });
      }),
    'googletagservices-gpt': adguardOwn('googletagservices-gpt', noAdguardArgs,
      () => stubObject(['googletag'], ['cmd', 'push', 'defineSlot', 'display', 'enableServices'])),
    'hide-in-shadow-dom': adguardOwn('hide-in-shadow-dom',
      args => arityError(args, 1, 2) || lengthError(args[0], 500) ||
        optionalLengthError(args[1], 500),
      args => adguardShadowDom(args[0], args[1], true)),
    'href-sanitizer': adguardDelegate('href-sanitizer'),
    'inject-css-in-shadow-dom': adguardOwn('inject-css-in-shadow-dom',
      args => arityError(args, 1, 3) || adguardCssRuleError(args[0]) ||
        optionalLengthError(args[1], 500) ||
        (['', 'adoptedstylesheets', 'styletag'].includes(String(args[2] || '').toLowerCase())
          ? '' : 'invalid CSS injection method'),
      args => adguardInjectShadowCss(args[0], args[1], String(args[2] || '').toLowerCase())),
    'json-prune-fetch-response': adguardDelegate('json-prune-fetch-response'),
    'json-prune-xhr-response': adguardDelegate('json-prune-xhr-response'),
    'json-prune': adguardDelegate('json-prune', args => args.slice(0, 3),
      args => arityError(args, 0, 4) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2])),
    'log-addeventlistener': adguardOwn('log-addeventlistener',
      args => arityError(args, 0, 1) || optionalLengthError(args[0], 16),
      args => {
        if (typeof global.addEventListener !== 'function') return;
        const original = global.addEventListener;
        define(global, 'addEventListener', {
          value: function (type, listener) {
            adguardLog('addEventListener', safeText(type), safeText(listener));
            return original.apply(this, arguments);
          },
          writable: String(args[0]) !== 'false',
          enumerable: false
        });
      }),
    'log-eval': adguardOwn('log-eval', noAdguardArgs, () => adguardLogMethod('eval')),
    'log-on-stack-trace': adguardOwn('log-on-stack-trace', restrictedAdguard, () => {}),
    'log': adguardOwn('log',
      args => arityError(args, 0, 20),
      args => adguardLog.apply(null, args)),
    'm3u-prune': adguardDelegate('m3u-prune'),
    'matomo': adguardOwn('matomo', noAdguardArgs,
      () => stubObject(['Matomo', 'Piwik'], ['getTracker', 'initialize', 'trackPageView'])),
    'metrika-yandex-tag': adguardOwn('metrika-yandex-tag', noAdguardArgs,
      () => adguardStubFunctions(['ym', 'yaCounter', 'yandex_metrika_callbacks'])),
    'metrika-yandex-watch': adguardOwn('metrika-yandex-watch', noAdguardArgs,
      () => adguardStubFunctions(['yaCounter', 'yandex_metrika_callbacks'])),
    'naver-wcslog': adguardOwn('naver-wcslog', noAdguardArgs,
      () => adguardStubFunctions(['wcs_log', 'wcs_add'])),
    'no-protected-audience': adguardOwn('no-protected-audience', noAdguardArgs,
      () => {
        [global, global.document].filter(Boolean).forEach(target => {
          ['interestCohort', 'joinAdInterestGroup', 'leaveAdInterestGroup'].forEach(name => {
            define(target, name, { value: undefined, writable: false, enumerable: false });
          });
        });
      }),
    'no-topics': adguardOwn('no-topics', noAdguardArgs,
      () => {
        [global, global.document].filter(Boolean).forEach(target => {
          define(target, 'browsingTopics', {
            value: undefined, writable: false, enumerable: false
          });
        });
      }),
    'noeval': adguardDelegate('noeval'),
    'nowebrtc': adguardDelegate('nowebrtc'),
    'pardot-1.0': adguardOwn('pardot-1.0', noAdguardArgs,
      () => stubObject(['piAId', 'pardot'], ['init', 'track', 'load'])),
    'prebid': adguardDelegate('prebid-ads'),
    'prevent-addeventlistener': adguardOwn('prevent-addeventlistener',
      args => arityError(args, 0, 5) || needleError(args[0]) || needleError(args[1]) ||
        optionalLengthError(args[2], 120) || optionalLengthError(args[3], 512) ||
        optionalLengthError(args[4], 16),
      args => defuseEvents(args[0], args[1])),
    'prevent-adfly': adguardOwn('prevent-adfly', noAdguardArgs,
      () => stubObject(['adfly'], ['init', 'show', 'close'])),
    'prevent-bab': adguardDelegate('nobab'),
    'prevent-canvas': adguardOwn('prevent-canvas',
      args => arityError(args, 0, 1) || needleError(String(args[0] || '').replace(/^!/, '')),
      args => {
        const proto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
        if (!proto || typeof proto.getContext !== 'function') return;
        const original = proto.getContext;
        const raw = String(args[0] || '');
        const negate = raw.startsWith('!');
        const matcher = compileNeedle(negate ? raw.slice(1) : raw).matcher;
        redefine(proto, 'getContext', {
          value: function (type) {
            const blocked = !raw || (negate ? !matcher(type) : matcher(type));
            return blocked ? null : original.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
      }),
    'prevent-constructor': adguardOwn('prevent-constructor',
      args => arityError(args, 1, 2) || propertyError(args[0]) || needleError(args[1]),
      args => adguardConstructor(args[0], args[1])),
    'prevent-element-src-loading': adguardOwn('prevent-element-src-loading',
      args => arityError(args, 2, 2) ||
        (/^(?:script|img|iframe|link)$/i.test(args[0]) ? '' : 'invalid element tag') ||
        needleError(args[1]),
      args => adguardPreventElementSrc(args[0], args[1])),
    'prevent-eval-if': adguardDelegate('noeval-if'),
    'prevent-fab-3.2.0': adguardDelegate('nofab'),
    'prevent-fetch': adguardOwn('prevent-fetch',
      args => arityError(args, 0, 3) || lengthError(args[0]) ||
        optionalLengthError(args[1]) || optionalLengthError(args[2]),
      args => {
        if (typeof global.fetch !== 'function') return;
        const original = global.fetch;
        const matches = conditionMatcher(args[0]);
        const body = String(args[1] || '');
        define(global, 'fetch', {
          value: function (url, init) {
            if (matches(safeText(url), init)) return Promise.resolve(fakeResponse(body));
            return original.apply(global, arguments);
          },
          writable: true,
          enumerable: false
        });
      }),
    'prevent-innerhtml': adguardOwn('prevent-innerhtml',
      args => arityError(args, 0, 3) || optionalLengthError(args[0], 500) ||
        needleError(args[1]) || optionalLengthError(args[2], 2000),
      args => adguardPreventInnerHtml(args[0], args[1], args[2])),
    'prevent-navigation': adguardOwn('prevent-navigation',
      args => arityError(args, 0, 1) || optionalLengthError(args[0]),
      args => adguardPreventNavigation(args[0])),
    'prevent-popads-net': adguardOwn('prevent-popads-net', noAdguardArgs,
      () => trapWrite('popns')),
    'prevent-refresh': adguardDelegate('prevent-refresh'),
    'prevent-requestanimationframe': adguardDelegate('prevent-requestanimationframe'),
    'prevent-setinterval': adguardDelegate('prevent-setinterval',
      args => args.slice(0, 1),
      args => arityError(args, 0, 2) || needleError(args[0]) || optionalLengthError(args[1])),
    'prevent-settimeout': adguardDelegate('prevent-settimeout',
      args => args.slice(0, 1),
      args => arityError(args, 0, 2) || needleError(args[0]) || optionalLengthError(args[1])),
    'prevent-window-open': adguardOwn('prevent-window-open',
      args => arityError(args, 0, 3) || needleError(args[0]) ||
        optionalLengthError(args[1]) || optionalLengthError(args[2]),
      args => defuseWindowOpen(args[0])),
    'prevent-xhr': adguardOwn('prevent-xhr',
      args => arityError(args, 0, 2) || lengthError(args[0]) || optionalLengthError(args[1]),
      args => adguardPreventXhr(args[0], args[1])),
    'remove-attr': adguardOwn('remove-attr',
      args => arityError(args, 1, 3) ||
        (/^[A-Za-z_:][-\w.:]*(?:\|[A-Za-z_:][-\w.:]*)*$/.test(args[0])
          ? '' : 'invalid attribute list') || optionalLengthError(args[1], 500) ||
        (/^(?:asap|complete|stay)(?:\s+(?:asap|complete|stay))*$/.test(args[2] || '')
          ? '' : 'invalid applying flag'),
      args => args[0].split('|').forEach(attribute => {
        changeAttribute(args[1] || '*', attribute, 'remove', '');
      })),
    'remove-class': adguardOwn('remove-class',
      args => arityError(args, 1, 3) ||
        (/^\S+(?:\|\S+)*$/.test(args[0]) ? '' : 'invalid class list') ||
        optionalLengthError(args[1], 500) ||
        (/^(?:asap|complete|stay)(?:\s+(?:asap|complete|stay))*$/.test(args[2] || '')
          ? '' : 'invalid applying flag'),
      args => args[0].split('|').forEach(className => {
        changeClass(args[1] || '*', className, false);
      })),
    'remove-cookie': adguardDelegate('remove-cookie'),
    'remove-in-shadow-dom': adguardOwn('remove-in-shadow-dom',
      args => arityError(args, 1, 2) || lengthError(args[0], 500) ||
        optionalLengthError(args[1], 500),
      args => adguardShadowDom(args[0], args[1], false)),
    'remove-node-text': adguardOwn('remove-node-text',
      args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        needleError(args[1]) || optionalLengthError(args[2], 500),
      args => removeNodeText(args[2] || args[0], args[1])),
    'remove-request-query-parameter': adguardOwn('remove-request-query-parameter',
      args => arityError(args, 1, 2) ||
        (args[0].startsWith('/')
          ? (compileReplaceRegex(args[0]) ? '' : 'invalid parameter pattern')
          : (/^[\w.\-,]+$/.test(args[0]) ? '' : 'invalid parameter list')) ||
        optionalLengthError(args[1]),
      args => adguardRemoveQueryParameters(args[0], args[1])),
    'scorecardresearch-beacon': adguardOwn('scorecardresearch-beacon', noAdguardArgs,
      () => stubObject(['_sf'], ['init', 'set', 'send', 'hit'])),
    'set-attr': adguardOwn('set-attr',
      args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        (/^[A-Za-z_:][-\w.:]*$/.test(args[1]) ? '' : 'invalid attribute') ||
        optionalLengthError(args[2], 2000),
      args => changeAttribute(args[0], args[1], 'set', args[2] || '')),
    'set-constant': adguardOwn('set-constant', adguardSetConstantError, adguardSetConstant),
    'set-cookie-reload': adguardOwn('set-cookie-reload',
      args => arityError(args, 2, 4) || adguardCookieError(args),
      adguardStorageReload),
    'set-cookie': adguardOwn('set-cookie', adguardCookieError, adguardWriteCookie),
    'set-local-storage-item': adguardOwn('set-local-storage-item', adguardStorageError,
      args => adguardStorageWrite('localStorage', args[0], args[1])),
    'set-popads-dummy': adguardDelegate('popads-dummy'),
    'set-session-storage-item': adguardOwn('set-session-storage-item', adguardStorageError,
      args => adguardStorageWrite('sessionStorage', args[0], args[1])),
    'spoof-css': adguardOwn('spoof-css',
      args => arityError(args, 3, 3) || lengthError(args[0], 500) ||
        lengthError(args[1], 120) || lengthError(args[2], 500) ||
        (String(args[1]).toLowerCase() === 'debug'
          ? 'debug CSS spoofing is not allowed in production filters' : ''),
      args => DEFINITIONS['spoof-css'].run([args[1], args[2]])),
    'xml-prune': adguardOwn('xml-prune',
      args => arityError(args, 0, 3) || optionalLengthError(args[0], 512) ||
        optionalLengthError(args[1], 500) || optionalLengthError(args[2], 512),
      args => installResponseTransformer(
        (value, text) => pruneXmlText(text, args[1] || '', args[0]), args[2], 'text', 'both'))
  });

  const CANONICAL = Object.keys(DEFINITIONS).reduce((map, name) => {
    map[name] = name;
    DEFINITIONS[name].aliases.forEach(alias => { map[alias] = name; });
    return map;
  }, Object.create(null));

  const ADGUARD_CANONICAL = Object.keys(ADGUARD_DEFINITIONS).reduce((map, name) => {
    map[name] = ADGUARD_DEFINITIONS[name].canonical;
    return map;
  }, Object.create(null));

  function scriptletSyntax(syntax) {
    return syntax === 'adguard' ? 'adguard' : 'ubo';
  }

  function canonical(alias, syntax) {
    const name = String(alias || '').trim().toLowerCase();
    return scriptletSyntax(syntax) === 'adguard'
      ? (ADGUARD_CANONICAL[name] || name)
      : (CANONICAL[name] || name);
  }

  function validate(alias, args, syntax) {
    const name = String(alias || '').trim().toLowerCase();
    if (name.startsWith('trusted-')) return 'trusted scriptlets require a trusted source';
    const list = Array.isArray(args) ? args : [];
    if (scriptletSyntax(syntax) === 'adguard') {
      if (list.some(arg => typeof arg !== 'string')) {
        return 'AdGuard scriptlet arguments must be strings';
      }
      if (ADGUARD_RESTRICTED.has(name)) return restrictedAdguard();
      const definition = ADGUARD_DEFINITIONS[name];
      if (!definition) return 'unknown AdGuard scriptlet alias: ' + name;
      return definition.validate(list);
    }
    const resolved = CANONICAL[name];
    if (!resolved) return 'unknown scriptlet alias: ' + name;
    return DEFINITIONS[resolved].validate(list);
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
    return canonical(left.alias, left.syntax) === canonical(right.alias, right.syntax) &&
      leftArgs.length === rightArgs.length &&
      leftArgs.every((arg, index) => String(arg) === String(rightArgs[index]));
  }

  function run(entry) {
    const syntax = scriptletSyntax(entry.syntax);
    const name = canonical(entry.alias, syntax);
    const definition = syntax === 'adguard'
      ? ADGUARD_DEFINITIONS[String(entry.alias || '').trim().toLowerCase()]
      : DEFINITIONS[name];
    if (!definition || validate(entry.alias, entry.args, syntax)) return;
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
    adguardAliases: Object.keys(ADGUARD_DEFINITIONS),
    canonical,
    validate,
    apply,
    domainMatches
  };
})(this);

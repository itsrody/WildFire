/* WildFire scriptlets: page defusers, DOM/cookie/storage helpers, detectors.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { propertyError, compileNeedle, resolvePath, define, trapRead, safeText } = NS;

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

  Object.assign(NS, { currentScriptInfo, scriptStack, abortCurrentScript, blockEval, conditionalEval, wrapTimer, defuseEvents, defuseWindowName, defuseWindowOpen, safeSelector, queryAll, watchMutations, onDom, changeAttribute, changeClass, cookieNames, writeCookie, removeCookie, storageWrite, safeStorageRead, callNothrow, adjustTimer, removeNodeText, sanitizeHref, injectStyle, defuseDetector, stubObject, trapPropertySetter });
})(this);

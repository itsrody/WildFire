/* WildFire scriptlets: page defusers, DOM/cookie/storage helpers, detectors.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { propertyError, compileNeedle, parseDomTokens, resolvePath, define, trapRead, safeText } = NS;

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

  function compileTimerNeedle(value) {
    const raw = String(value == null ? '' : value);
    const negated = raw.startsWith('!');
    const compiled = compileNeedle(negated ? raw.slice(1) : raw);
    if (compiled.error) return { error: compiled.error };
    return { negated, matcher: compiled.matcher, error: '' };
  }

  function timerNeedleError(value) {
    if (value === undefined || value === '') return '';
    return compileTimerNeedle(value).error || '';
  }

  function normalizeTimerDelay(value) {
    const delay = Number(value);
    if (!Number.isFinite(delay)) return 0;
    if (delay < 0) return -0;
    return Math.floor(delay);
  }

  function compileDelayMatcher(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return { matcher: () => true, error: '' };
    const negated = raw.startsWith('!');
    const spec = negated ? raw.slice(1) : raw;
    let matcher = null;
    if (spec === '-0') {
      matcher = delay => Object.is(delay, -0);
    } else {
      const range = /^(\d+)-(\d*)$/.exec(spec);
      const maxOnly = /^-(\d+)$/.exec(spec);
      if (range) {
        const min = Number(range[1]);
        const max = range[2] === '' ? Infinity : Number(range[2]);
        if (max < min) return { error: 'invalid timer delay range' };
        matcher = delay => !Object.is(delay, -0) && delay >= min && delay <= max;
      } else if (maxOnly) {
        const max = Number(maxOnly[1]);
        matcher = delay => !Object.is(delay, -0) && delay <= max;
      } else if (/^\d+$/.test(spec)) {
        const exact = Number(spec);
        matcher = delay => !Object.is(delay, -0) && delay === exact;
      }
    }
    if (!matcher) return { error: 'invalid timer delay' };
    return { negated, matcher, error: '' };
  }

  function timerDelayError(value) {
    if (value === undefined || value === '') return '';
    return compileDelayMatcher(value).error || '';
  }

  function wrapTimer(name, needle, delaySpec) {
    const original = global[name];
    if (typeof original !== 'function') return;
    const callback = compileTimerNeedle(needle);
    const delay = compileDelayMatcher(delaySpec);
    if (callback.error || delay.error) return;
    define(global, name, {
      value: function () {
        const subject = Array.from(arguments).map(safeText).join(' ');
        const callbackMatch = callback.negated
          ? !callback.matcher(subject)
          : callback.matcher(subject);
        const delayValue = normalizeTimerDelay(arguments[1]);
        const delayMatch = delay.negated
          ? !delay.matcher(delayValue)
          : delay.matcher(delayValue);
        if (callbackMatch && delayMatch) return 0;
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

  function windowDelayError(value) {
    const raw = value === undefined || value === '' ? '' : String(value);
    if (!raw) return '';
    if (!/^\d+$/.test(raw)) return 'invalid popup decoy delay';
    const seconds = Number(raw);
    return seconds > 0 && seconds <= 86400 ? '' : 'invalid popup decoy delay';
  }

  function windowReplacementError(value) {
    const mode = String(value == null ? '' : value).toLowerCase();
    return ['', 'obj', 'blank'].includes(mode) ? '' : 'invalid popup replacement';
  }

  function createWindowDecoy(mode, seconds) {
    const doc = global.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const useObject = String(mode || '').toLowerCase() === 'obj';
    let element = null;
    try { element = doc.createElement(useObject ? 'object' : 'iframe'); }
    catch (error) { return null; }
    if (!element) return null;
    try {
      if (typeof element.setAttribute === 'function') {
        element.setAttribute('data-wildfire-decoy', '');
        element.setAttribute('aria-hidden', 'true');
        if (useObject) {
          element.setAttribute('type', 'text/html');
          element.setAttribute('data', 'about:blank');
        } else {
          element.setAttribute('src', 'about:blank');
        }
      } else if (useObject) {
        element.type = 'text/html';
        element.data = 'about:blank';
      } else {
        element.src = 'about:blank';
      }
      if (element.style) {
        Object.assign(element.style, {
          position: 'absolute', left: '-9999px', top: '-9999px',
          width: '0', height: '0', border: '0', visibility: 'hidden'
        });
      }
    } catch (error) { /* a locked element still works as a decoy */ }
    const parent = doc.body || doc.documentElement;
    if (parent && typeof parent.appendChild === 'function') {
      try { parent.appendChild(element); } catch (error) { /* keep the decoy in memory */ }
    }
    const actual = useObject
      ? (element.contentWindow ||
        (element.contentDocument && element.contentDocument.defaultView))
      : element.contentWindow;
    let invalid = false;
    const invalidate = () => {
      if (invalid) return;
      invalid = true;
      const holder = element && element.parentNode;
      if (holder && typeof holder.removeChild === 'function') {
        try { holder.removeChild(element); } catch (error) { /* already removed */ }
      }
    };
    let decoy = actual && typeof actual === 'object' ? actual : null;
    if (decoy) {
      try {
        Object.defineProperty(decoy, 'closed', {
          configurable: true,
          get: () => invalid
        });
      } catch (error) { decoy = null; }
    }
    if (!decoy) {
      decoy = {
        get closed() { return invalid; },
        get document() { return invalid || !actual ? null : actual.document; },
        get location() { return invalid || !actual ? null : actual.location; },
        get window() { return decoy; },
        get self() { return decoy; },
        blur: () => {
          if (!invalid && actual && typeof actual.blur === 'function') actual.blur();
        },
        focus: () => {
          if (!invalid && actual && typeof actual.focus === 'function') actual.focus();
        },
        close: invalidate,
        postMessage: (...args) => {
          if (!invalid && actual && typeof actual.postMessage === 'function') {
            actual.postMessage.apply(actual, args);
          }
        }
      };
    }
    const originalClose = typeof decoy.close === 'function' ? decoy.close : null;
    try {
      Object.defineProperty(decoy, 'close', {
        configurable: true,
        value: () => {
          invalidate();
          if (originalClose) {
            try { originalClose.call(decoy); } catch (error) { /* page-side close failed */ }
          }
        }
      });
    } catch (error) { /* the native close method stays usable */ }
    const lifetime = Number(seconds);
    if (lifetime > 0 && typeof global.setTimeout === 'function') {
      global.setTimeout(invalidate, lifetime * 1000);
    }
    return decoy;
  }

  function defuseWindowOpen(needle, seconds, replacement) {
    const original = global.open;
    if (typeof original !== 'function') return;
    const compiled = compileTimerNeedle(needle);
    if (compiled.error || windowDelayError(seconds) || windowReplacementError(replacement)) return;
    const mode = String(replacement == null ? '' : replacement).toLowerCase();
    define(global, 'open', {
      value: function () {
        const target = Array.from(arguments).map(safeText).join(' ');
        const matched = compiled.negated
          ? !compiled.matcher(target)
          : compiled.matcher(target);
        if (!matched) return original.apply(global, arguments);
        if (mode === 'blank' && !seconds) {
          const args = Array.from(arguments);
          args[0] = 'about:blank';
          return original.apply(global, args);
        }
        if (seconds) return createWindowDecoy(mode, Number(seconds));
        return null;
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

  function matchesSelector(element, selector) {
    if (!selector) return true;
    if (!element || typeof element.matches !== 'function') return false;
    try { return element.matches(selector); } catch (error) { return false; }
  }

  function applyWhenReady(action, options) {
    const doc = global.document;
    if (!doc) return;
    const apply = () => {
      try { action(); } catch (error) { /* never throw into page code */ }
      if (options.stay) watchMutations(action);
    };
    const state = String(doc.readyState || '');
    const ready = options.complete ? state === 'complete'
      : options.asap || state !== 'loading';
    if (ready) {
      apply();
      return;
    }
    const target = options.complete && typeof global.addEventListener === 'function'
      ? global : doc;
    if (typeof target.addEventListener === 'function') {
      target.addEventListener(options.complete ? 'load' : 'DOMContentLoaded',
        apply, { once: true });
    } else {
      apply();
    }
  }

  function onDomScheduled(selector, action, tokens) {
    const options = parseDomTokens(tokens);
    if (options.error) return;
    const apply = () => queryAll(selector).forEach(element => {
      try { action(element); } catch (error) { /* ignore one bad element */ }
    });
    applyWhenReady(apply, options);
  }

  function resolvedAttributeValue(value, element) {
    const raw = String(value == null ? '' : value);
    if (raw.length > 2 && raw.startsWith('[') && raw.endsWith(']')) {
      const source = raw.slice(1, -1);
      if (/^[A-Za-z_:][-\w.:]*$/.test(source) &&
        typeof element.getAttribute === 'function') {
        return String(element.getAttribute(source) || '');
      }
    }
    return raw;
  }

  function changeAttribute(attributeSpec, selector, tokens, mode, value) {
    const attributes = String(attributeSpec || '').split('|').filter(Boolean);
    if (!attributes.length) return;
    onDomScheduled(selector || '*', element => attributes.forEach(attribute => {
      if (attribute === '*') {
        Array.from(element.attributes || []).forEach(attr => {
          try { element.removeAttribute(attr.name); } catch (error) { /* locked */ }
        });
        return;
      }
      try {
        if (mode === 'remove') element.removeAttribute(attribute);
        else element.setAttribute(attribute, resolvedAttributeValue(value, element));
      } catch (error) { /* locked element */ }
    }), tokens);
  }

  function changeClass(classSpec, selector, tokens, add) {
    const classes = String(classSpec || '').split('|').filter(Boolean)
      .filter(className => /^[^\s]+$/.test(className));
    if (!classes.length) return;
    onDomScheduled(selector || '*', element => {
      if (!element.classList) return;
      classes.forEach(className => {
        if (add) element.classList.add(className);
        else element.classList.remove(className);
      });
    }, tokens);
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

  const NODE_TEXT_TOKENS = ['includes', 'condition', 'excludes', 'sedcount',
    'stay', 'quitafter', 'log'];

  function parseNodeTextOptions(tokens) {
    const args = Array.isArray(tokens) ? tokens : [];
    const options = { includes: [], excludes: [], sedCount: 0, stay: false, quitAfter: 0 };
    let error = '';

    function parseAt(index) {
      if (error || index >= args.length) return;
      const key = String(args[index]).toLowerCase();
      if (!NODE_TEXT_TOKENS.includes(key)) {
        error = 'invalid remove-node-text token';
        return;
      }
      const value = args[index + 1];
      if (value === undefined) {
        error = 'missing remove-node-text token value';
        return;
      }
      const text = String(value);
      if (key === 'includes' || key === 'condition') {
        const compiled = compileNeedle(text);
        if (compiled.error) error = compiled.error;
        else options.includes.push(compiled.matcher);
      } else if (key === 'excludes') {
        const compiled = compileNeedle(text);
        if (compiled.error) error = compiled.error;
        else options.excludes.push(compiled.matcher);
      } else if (key === 'sedcount') {
        const count = Number(text);
        if (!/^\d+$/.test(text) || count < 1) error = 'invalid sedCount';
        else options.sedCount = count;
      } else if (key === 'stay') {
        if (text !== '1') error = 'invalid stay token';
        else options.stay = true;
      } else if (key === 'quitafter') {
        const delay = Number(text);
        if (!/^\d+$/.test(text) || delay > 3600000) error = 'invalid quitAfter';
        else options.quitAfter = delay;
      } else if (text !== '1') {
        error = 'invalid log token';
      }
      parseAt(index + 2);
    }

    parseAt(0);
    return { options, error };
  }

  function nodeTextOptionsError(tokens) {
    return parseNodeTextOptions(tokens).error;
  }

  function nodeText(node) {
    if (!node) return '';
    return node.nodeType === 3
      ? String(node.nodeValue || '')
      : String(node.textContent || '');
  }

  function collectNodes(root, output) {
    if (!root) return output;
    output.push(root);
    Array.from(root.childNodes || []).forEach(child => collectNodes(child, output));
    return output;
  }

  function removeNodeText(selector, needle, optionArgs) {
    const parsed = parseNodeTextOptions(optionArgs);
    if (parsed.error) return;
    const options = parsed.options;
    const matcher = compileNeedle(needle).matcher;
    const spec = String(selector || '').trim();
    const nodeNameSpec = /^#?[A-Za-z][\w-]*$/.test(spec);
    let stopped = false;
    let observer = null;
    let remaining = options.sedCount;

    function stop() {
      if (stopped) return;
      stopped = true;
      if (observer && typeof observer.disconnect === 'function') {
        try { observer.disconnect(); } catch (error) { /* already gone */ }
      }
      observer = null;
    }

    function candidates() {
      if (!global.document) return [];
      if (nodeNameSpec) return collectNodes(global.document, []);
      return queryAll(spec).flatMap(element => {
        const children = Array.from(element.childNodes || []);
        return children.length ? children : [element];
      });
    }

    function apply() {
      if (stopped) return;
      candidates().forEach(node => {
        if (stopped) return;
        if (nodeNameSpec &&
          String(node.nodeName || '').toLowerCase() !== spec.toLowerCase()) return;
        const text = nodeText(node);
        if (!matcher(text)) return;
        if (options.includes.some(included => !included(text))) return;
        if (options.excludes.some(excluded => excluded(text))) return;
        try {
          if (node.nodeType === 3) node.nodeValue = '';
          else node.textContent = '';
        } catch (error) { /* locked node */ }
        if (remaining > 0) {
          remaining -= 1;
          if (!remaining) stop();
        }
      });
    }

    function startObserver() {
      if (stopped || !global.document || typeof global.MutationObserver !== 'function') return;
      try {
        observer = new global.MutationObserver(apply);
        observer.observe(global.document.documentElement || global.document, {
          childList: true, subtree: true, characterData: true
        });
      } catch (error) { observer = null; }
    }

    if (!global.document) return;
    if (global.document.readyState === 'loading' &&
      typeof global.document.addEventListener === 'function') {
      startObserver();
      global.document.addEventListener('DOMContentLoaded', () => {
        apply();
        if (!options.stay && !options.quitAfter) stop();
      }, { once: true });
    } else {
      apply();
      if (options.stay || options.quitAfter) startObserver();
    }
    if (options.quitAfter > 0 && typeof global.setTimeout === 'function') {
      global.setTimeout(stop, options.quitAfter);
    }
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

  function trapPropertySetter(path, needle, selector) {
    const ref = resolvePath(path, true);
    if (!ref) return;
    const compiled = compileTimerNeedle(needle);
    if (compiled.error) return;
    if (selector && !safeSelector(selector)) return;
    const descriptor = Object.getOwnPropertyDescriptor(ref.target, ref.key);
    const originalGet = descriptor && descriptor.get;
    const originalSet = descriptor && descriptor.set;
    const values = typeof global.WeakMap === 'function' ? new global.WeakMap() : null;
    let fallback = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    define(ref.target, ref.key, {
      get: function () {
        if (typeof originalGet === 'function') return originalGet.call(this);
        if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          return values.get(this);
        }
        return fallback;
      },
      set: function (next) {
        const matched = compiled.negated
          ? !compiled.matcher(safeText(next))
          : compiled.matcher(safeText(next));
        if (matchesSelector(this, selector) && matched) return;
        if (typeof originalSet === 'function') originalSet.call(this, next);
        else if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          values.set(this, next);
        } else {
          fallback = next;
        }
      },
      enumerable: true
    });
  }

  Object.assign(NS, { currentScriptInfo, scriptStack, abortCurrentScript, blockEval, conditionalEval, compileTimerNeedle, timerNeedleError, normalizeTimerDelay, compileDelayMatcher, timerDelayError, wrapTimer, defuseEvents, defuseWindowName, windowDelayError, windowReplacementError, createWindowDecoy, defuseWindowOpen, safeSelector, queryAll, matchesSelector, applyWhenReady, watchMutations, onDom, onDomScheduled, resolvedAttributeValue, changeAttribute, changeClass, cookieNames, writeCookie, removeCookie, storageWrite, safeStorageRead, callNothrow, adjustTimer, NODE_TEXT_TOKENS, parseNodeTextOptions, nodeTextOptionsError, collectNodes, removeNodeText, sanitizeHref, injectStyle, defuseDetector, stubObject, trapPropertySetter });
})(this);

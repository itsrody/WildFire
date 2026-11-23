/* WildFire scriptlets: AdGuard argument mapping and original helpers.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, propertyError, lengthError, optionalLengthError, compileNeedle, needleError, resolvePath, define, setConstant, trapRead, safeText, redefine, safeSelector, queryAll, onDom, storageWrite, safeStorageRead, conditionMatcher, stackAllows, compileReplaceRegex } = NS;

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

  Object.assign(NS, { ADGUARD_RESTRICTED, adguardConstant, adguardLog, adguardSetConstantError, adguardSetConstant, adguardCookieError, adguardWriteCookie, adguardStorageError, adguardStorageWrite, adguardStorageReload, queryInRoot, adguardShadowHosts, adguardShadowDom, adguardCssRuleError, adguardInjectShadowCss, adguardConstructor, adguardPreventNavigation, adguardPreventElementSrc, adguardRemoveQueryParameters, adguardLogMethod, adguardLogRead, adguardDirString, adguardPreventInnerHtml, adguardXhrResponseDirective, adguardPreventXhr, adguardStubFunctions });
})(this);

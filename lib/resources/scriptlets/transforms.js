/* WildFire scriptlets: JSON prune/edit and response/request transforms.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { lengthError, needleSafetyError, compileNeedle, resolvePath, safeText, redefine, scriptStack } = NS;

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
      if (token.startsWith('!')) {
        const excluded = token.slice(1);
        return excluded === '*' ? false : !compileNeedle(excluded).matcher(url);
      }
      if (token === '*') return true;
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

  const FETCH_CONFIG_TYPES = new Set([
    'basic', 'cors', 'default', 'error', 'opaque', 'opaqueredirect'
  ]);
  const FETCH_CONFIG_KEYS = new Set([
    'ok', 'redirected', 'status', 'statusText', 'type'
  ]);
  const FETCH_STATUS_TEXT = new Set(['', 'OK', 'Continue', 'Not Found']);

  function parseFetchConfig(value) {
    if (value === undefined || value === null || value === '') {
      return { config: null, error: '' };
    }
    const raw = String(value);
    const tooLong = lengthError(raw, 512);
    if (tooLong) return { config: null, error: tooLong };
    if (FETCH_CONFIG_TYPES.has(raw)) {
      return { config: { type: raw }, error: '' };
    }
    let parsed = null;
    try { parsed = JSON.parse(raw); }
    catch (error) { return { config: null, error: 'invalid fetch response config' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { config: null, error: 'invalid fetch response config' };
    }
    const keys = Object.keys(parsed);
    const invalidKey = keys.some(key => !FETCH_CONFIG_KEYS.has(key));
    const invalidValue = keys.some(key => {
      const candidate = parsed[key];
      if (key === 'ok' || key === 'redirected') return typeof candidate !== 'boolean';
      if (key === 'status') {
        return !Number.isInteger(candidate) || candidate < 0 || candidate > 599;
      }
      if (key === 'statusText') return !FETCH_STATUS_TEXT.has(candidate);
      return !FETCH_CONFIG_TYPES.has(candidate);
    });
    if (!keys.length || invalidKey || invalidValue) {
      return { config: null, error: 'invalid fetch response config' };
    }
    return {
      config: keys.reduce((config, key) => {
        config[key] = parsed[key];
        return config;
      }, {}),
      error: ''
    };
  }

  function fetchConfigError(value) {
    return parseFetchConfig(value).error;
  }

  function applyFetchConfig(response, config) {
    if (!response || typeof response !== 'object' || !config) return response;
    Object.keys(config).forEach(key => {
      try {
        Object.defineProperty(response, key, {
          configurable: true,
          enumerable: key !== 'type',
          get: () => config[key]
        });
      } catch (error) {
        try { response[key] = config[key]; } catch (locked) { /* keep the native value */ }
      }
    });
    return response;
  }

  function fakeResponse(body, config) {
    const text = String(body == null ? '' : body);
    const settings = config || null;
    const status = settings && Number.isInteger(settings.status)
      ? settings.status : 200;
    const statusText = settings && typeof settings.statusText === 'string'
      ? settings.statusText : 'OK';
    if (global.Response && typeof global.Response === 'function') {
      try {
        const constructorStatus = status >= 200 && status <= 599 ? status : 200;
        const response = new global.Response(text, {
          status: constructorStatus, statusText
        });
        return applyFetchConfig(response, settings);
      } catch (error) { /* fall through to the plain object */ }
    }
    const response = {
      ok: status >= 200 && status < 300,
      redirected: false,
      status,
      statusText,
      type: settings && settings.type || 'basic',
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text)),
      clone: () => fakeResponse(text, settings)
    };
    return applyFetchConfig(response, settings);
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

  function installObjectEditOnSetter(path, spec) {
    const ref = resolvePath(path, false);
    if (!ref) return;
    const descriptor = Object.getOwnPropertyDescriptor(ref.target, ref.key);
    if (!descriptor) return;
    const originalGet = descriptor.get;
    const originalSet = descriptor.set;
    const values = typeof global.WeakMap === 'function' ? new global.WeakMap() : null;
    let fallback = descriptor.value;
    redefine(ref.target, ref.key, {
      get: function () {
        if (typeof originalGet === 'function') return originalGet.call(this);
        if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          return values.get(this);
        }
        return fallback;
      },
      set: function (next) {
        const edited = editObject(next, spec);
        if (typeof originalSet === 'function') {
          originalSet.call(this, edited);
          return;
        }
        if (values && this && (typeof this === 'object' || typeof this === 'function')) {
          values.set(this, edited);
        } else {
          fallback = edited;
        }
      },
      enumerable: descriptor.enumerable !== false,
      configurable: true
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

  Object.assign(NS, { pruneAt, hasPath, pruneJson, conditionMatcher, namedArg, stackAllows, installResponseTransformer, FETCH_CONFIG_TYPES, FETCH_CONFIG_KEYS, FETCH_STATUS_TEXT, parseFetchConfig, fetchConfigError, applyFetchConfig, fakeResponse, responseDirective, jsonPathToPrune, editObject, installRequestTransformer, xmlNodes, pruneXmlText, compileReplaceRegex, pruneM3uText, installObjectEdit, installObjectEditOnSetter, pruneJsonlText, jsonPathError });
})(this);

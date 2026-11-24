/* WildFire scriptlet shim: AdGuard JSONPath prune mode.
 * JSONPath is treated as bounded data and translated to WildFire's safe path
 * primitives; no expression is ever evaluated as script. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, needleError, optionalLengthError, redefine, safeText,
    jsonPathToPrune, pruneJson, pruneAt, hasPath, stackAllows,
    installResponseTransformer, namedArg
  } = NS;

  const MODES = new Set(['legacy', 'jsonpath']);
  const JSONPATH_SHAPE = /^[\[$]/;
  const JSONPATH_SAFE = /^[\[$][A-Za-z0-9_$.*\[\]'"?:@()\/,\s!&|=<>\-]*$/;

  function specError(value) {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > 1024) return 'invalid prune path';
    if (JSONPATH_SHAPE.test(value)) {
      return JSONPATH_SAFE.test(value) ? '' : 'invalid JSONPath query';
    }
    return /^[A-Za-z0-9_.*\[\]'"\/\\:?!=@(),\s|\-]*$/.test(value)
      ? '' : 'invalid prune path';
  }

  function splitMode(args) {
    const last = args.length ? String(args[args.length - 1]).toLowerCase() : '';
    return MODES.has(last)
      ? { values: args.slice(0, -1), mode: last }
      : { values: args, mode: '' };
  }

  function isJsonPath(spec, mode) {
    return mode === 'jsonpath' || (!mode && JSONPATH_SHAPE.test(String(spec || '')));
  }

  function normalize(spec, mode) {
    const raw = String(spec || '');
    if (isJsonPath(raw, mode)) return jsonPathToPrune(raw);
    return raw
      .replace(/\[\?\([^\]]*\)\]/g, '.*')
      .replace(/\[[-=*]?\]/g, '.*')
      .replace(/\[[^\]]+\]/g, '.*')
      .replace(/\/(?:\\.|[^\/])+\/[imsu]*/g, '*')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.{2,}/g, '.');
  }

  function pathValue(value, path) {
    return String(path || '').split('.').filter(Boolean).reduce((current, part) =>
      current && typeof current === 'object' ? current[part] : undefined, value);
  }

  function guardedPlan(spec, mode) {
    if (!isJsonPath(spec, mode)) return null;
    const match = /^(.*?)\[\?\(@\.([\w$.]+)\)\](.*)$/.exec(String(spec));
    if (!match) return null;
    return {
      base: jsonPathToPrune(match[1]),
      guard: String(match[2]).replace(/^\$?\.?/, ''),
      tail: jsonPathToPrune(match[3]).replace(/^\.+|\.+$/g, '')
    };
  }

  function pruneGuarded(value, plan) {
    const root = pathValue(value, plan.base);
    if (!root || typeof root !== 'object') return;
    const parts = plan.tail.split('.').filter(Boolean);
    Object.keys(root).forEach(key => {
      const child = root[key];
      if (!child || typeof child !== 'object' || !hasPath(child, plan.guard)) return;
      if (parts.length) pruneAt(child, parts[0], parts, 1);
    });
  }

  function prune(value, values, mode) {
    const plan = guardedPlan(values[0], mode);
    if (plan) {
      pruneGuarded(value, plan);
      return value;
    }
    return pruneJson(value, normalize(values[0], mode), String(values[1] || ''));
  }

  function pruneError(args) {
    const parsed = splitMode(args);
    return arityError(parsed.values, 0, 3) || specError(parsed.values[0]) ||
      specError(parsed.values[1]) || needleError(parsed.values[2]);
  }

  function responseError(args) {
    const parsed = splitMode(args);
    return arityError(parsed.values, 0, 5) || specError(parsed.values[0]) ||
      specError(parsed.values[1]) || optionalLengthError(parsed.values[2], 512) ||
      needleError(parsed.values[3]);
  }

  function installPrune(args, target) {
    const parsed = splitMode(args);
    const urlNeedle = namedArg(parsed.values, 'propstomatch') || parsed.values[2];
    const stack = namedArg(parsed.values, 'stacktomatch') || parsed.values[3];
    installResponseTransformer(value => stackAllows(stack)
      ? prune(value, parsed.values, parsed.mode) : value, urlNeedle, 'json', target);
  }

  NS.ADGUARD_DEFINITIONS['json-prune'] = NS.adguardOwn('json-prune', pruneError, args => {
    const parsed = splitMode(args);
    if (!parsed.values[0]) return;
    const original = global.JSON && global.JSON.parse;
    if (typeof original !== 'function') return;
    redefine(global.JSON, 'parse', {
      value: function (text) {
        if (!stackAllows(parsed.values[2])) return original.apply(global.JSON, arguments);
        return prune(original.apply(global.JSON, arguments), parsed.values, parsed.mode);
      },
      writable: true,
      enumerable: false
    });
  });

  NS.ADGUARD_DEFINITIONS['evaldata-prune'] = NS.adguardOwn('evaldata-prune', pruneError, args => {
    const parsed = splitMode(args);
    if (!parsed.values[0]) return;
    const original = global.eval;
    if (typeof original !== 'function') return;
    redefine(global, 'eval', {
      value: function (source) {
        if (typeof source !== 'string' || !stackAllows(parsed.values[2])) {
          return original.apply(global, arguments);
        }
        try {
          return prune(global.JSON.parse(source), parsed.values, parsed.mode);
        } catch (error) {
          return original.apply(global, arguments);
        }
      },
      writable: true,
      enumerable: false
    });
  });

  NS.ADGUARD_DEFINITIONS['json-prune-fetch-response'] = NS.adguardOwn(
    'json-prune-fetch-response', responseError, args => installPrune(args, 'fetch'));
  NS.ADGUARD_DEFINITIONS['json-prune-xhr-response'] = NS.adguardOwn(
    'json-prune-xhr-response', responseError, args => installPrune(args, 'xhr'));

  Object.assign(NS, { adguardJsonPathError: specError, adguardJsonPathMode: splitMode });
})(this);

/* WildFire scriptlet shim: AdGuard property anchors and stack needles.
 * Documented prototype paths are allowed through a bounded allowlist; filter
 * text still supplies only property names and safe data needles. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, compileNeedle, needleError, needleSafetyError, redefine,
    safeText, currentScriptInfo, scriptStack
  } = NS;

  const PROTOTYPE_PATHS = new Set([
    'EventTarget.prototype.addEventListener',
    'EventTarget.prototype.removeEventListener',
    'Element.prototype.setAttribute',
    'Element.prototype.removeAttribute',
    'Node.prototype.appendChild',
    'Node.prototype.insertBefore',
    'Document.prototype.createElement',
    'XMLHttpRequest.prototype.open',
    'HTMLCanvasElement.prototype.getContext',
    'CanvasRenderingContext2D.prototype.getImageData'
  ]);

  function propertyPathError(value) {
    if (typeof value !== 'string' || !value || value.length > 120) {
      return 'invalid scriptlet property';
    }
    if (PROTOTYPE_PATHS.has(value)) return '';
    return NS.propertyError(value);
  }

  function propertyRef(path) {
    if (!PROTOTYPE_PATHS.has(path)) return NS.resolvePath(path, true);
    const parts = path.split('.');
    const key = parts.pop();
    const target = parts.reduce((current, part) => {
      if (!current || (typeof current !== 'object' && typeof current !== 'function')) {
        return null;
      }
      return current[part] || null;
    }, global);
    return target ? { target, key } : null;
  }

  function literalMatcher(value) {
    const needle = String(value || '').toLowerCase();
    return text => !needle || String(text == null ? '' : text).toLowerCase().includes(needle);
  }

  function stackMatcher(value) {
    const raw = String(value == null ? '' : value);
    const lastSlash = raw.lastIndexOf('/');
    if (raw.startsWith('/') && lastSlash > 0) {
      const flags = raw.slice(lastSlash + 1);
      const source = raw.slice(1, lastSlash);
      if (/^[imsu]*$/.test(flags) && !needleSafetyError(source)) {
        const compiled = compileNeedle(raw);
        if (!compiled.error) return compiled.matcher;
      }
    }
    return literalMatcher(raw);
  }

  function stackNeedleError(value) {
    return value === undefined || (typeof value === 'string' && value.length <= 512)
      ? '' : 'scriptlet needle too long';
  }

  function trapProperty(path, guard, mode) {
    const ref = propertyRef(path);
    if (!ref) return;
    let value;
    try { value = ref.target[ref.key]; } catch (error) { value = undefined; }
    redefine(ref.target, ref.key, {
      get: () => {
        if (mode !== 'write') guard('read');
        return value;
      },
      set: next => {
        if (mode !== 'read') guard('write');
        value = next;
      },
      enumerable: true
    });
  }

  function abortCurrentScript(args) {
    const matcher = compileNeedle(args[1]).matcher;
    trapProperty(args[0], () => {
      const info = currentScriptInfo();
      if (matcher(info.text) || matcher(info.src) || matcher(scriptStack())) {
        throw new Error('WildFire blocked current script');
      }
    }, 'both');
  }

  function abortRead(path) {
    trapProperty(path, () => {
      throw new Error('WildFire blocked read of ' + path);
    }, 'read');
  }

  function abortWrite(path) {
    trapProperty(path, () => {
      throw new Error('WildFire blocked write to ' + path);
    }, 'write');
  }

  function abortStack(args) {
    const needle = String(args[1] || '');
    const matcher = stackMatcher(needle);
    trapProperty(args[0], () => {
      const stack = scriptStack();
      if (needle === 'inlineScript' || needle === 'injectedScript' || matcher(stack)) {
        throw new Error('WildFire blocked stack access to ' + args[0]);
      }
    }, 'both');
  }

  NS.ADGUARD_DEFINITIONS['abort-current-inline-script'] = NS.adguardOwn(
    'abort-current-script',
    args => arityError(args, 1, 2) || propertyPathError(args[0]) || needleError(args[1]),
    abortCurrentScript);
  NS.ADGUARD_DEFINITIONS['abort-on-property-read'] = NS.adguardOwn(
    'abort-on-property-read',
    args => arityError(args, 1, 1) || propertyPathError(args[0]),
    args => abortRead(args[0]));
  NS.ADGUARD_DEFINITIONS['abort-on-property-write'] = NS.adguardOwn(
    'abort-on-property-write',
    args => arityError(args, 1, 1) || propertyPathError(args[0]),
    args => abortWrite(args[0]));
  NS.ADGUARD_DEFINITIONS['abort-on-stack-trace'] = NS.adguardOwn(
    'abort-on-stack-trace',
    args => arityError(args, 2, 2) || propertyPathError(args[0]) || stackNeedleError(args[1]),
    abortStack);

  Object.assign(NS, { adguardPropertyPathError: propertyPathError, adguardStackMatcher: stackMatcher });
})(this);

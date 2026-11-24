/* WildFire scriptlet shim: AdGuard element-scoped event defusers. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, needleError, optionalLengthError, compileNeedle, redefine,
    safeText, matchesSelector
  } = NS;

  function validate(args) {
    const name = String(args[2] == null ? '' : args[2]).toLowerCase();
    const flag = String(args[4] == null ? '' : args[4]).toLowerCase();
    return arityError(args, 0, 5) || needleError(args[0]) || needleError(args[1]) ||
      (name && name !== 'elements' ? 'invalid additional argument' : '') ||
      (args[3] !== undefined && !name ? 'missing additional argument name' : '') ||
      optionalLengthError(args[3], 500) ||
      (flag && flag !== 'true' ? 'invalid noProtect flag' : '');
  }

  function run(args) {
    const typeMatcher = compileNeedle(args[0]).matcher;
    const listenerMatcher = compileNeedle(args[1]).matcher;
    const elementName = String(args[2] == null ? '' : args[2]).toLowerCase();
    const elementValue = String(args[3] == null ? '' : args[3]);
    const elementMatches = element => {
      if (!elementName) return true;
      if (elementValue === 'window') return element === global;
      if (elementValue === 'document') return element === global.document;
      return matchesSelector(element, elementValue);
    };
    const wrapper = function (type, listener) {
      if (elementMatches(this) && typeMatcher(safeText(type)) &&
        listenerMatcher(safeText(listener))) {
        return undefined;
      }
      return originalAdd.apply(this, arguments);
    };
    const proto = global.EventTarget && global.EventTarget.prototype;
    if (!proto || typeof proto.addEventListener !== 'function') return;
    const originalAdd = proto.addEventListener;
    const descriptor = Object.getOwnPropertyDescriptor(global, 'addEventListener');
    const unprotected = String(args[4]).toLowerCase() === 'true';
    redefine(proto, 'addEventListener', {
      value: wrapper, writable: !unprotected, enumerable: false
    });
    if (descriptor && descriptor.configurable) {
      redefine(global, 'addEventListener', {
        value: wrapper, writable: !unprotected, enumerable: false
      });
    }
  }

  NS.ADGUARD_DEFINITIONS['prevent-addeventlistener'] = NS.adguardOwn(
    'addeventlistener-defuser', validate, run);
})(this);

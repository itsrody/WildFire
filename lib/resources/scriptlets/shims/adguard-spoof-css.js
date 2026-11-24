/* WildFire scriptlet shim: AdGuard getComputedStyle and rect spoofing. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, lengthError, redefine, safeText, matchesSelector } = NS;

  const RECT_PROPERTIES = new Set(['width', 'height', 'top', 'left', 'right', 'bottom']);

  function selectorsError(value) {
    if (lengthError(value, 500)) return 'invalid CSS selector list';
    const parts = String(value).split(',').map(part => part.trim());
    return parts.every(part => part &&
      /^[\w#.\[\]'"=:^>+~*(),\/\s-]+$/.test(part)) ? '' : 'invalid CSS selector list';
  }

  function propertyNameError(value) {
    return typeof value === 'string' && value.length <= 120 &&
      /^-?[_A-Za-z][\w-]*$/.test(value) ? '' : 'invalid CSS property';
  }

  function propertyValueError(value) {
    return typeof value === 'string' && value.length <= 500 &&
      !/[<>]/.test(value) ? '' : 'invalid CSS value';
  }

  function spoofStyle(style, property, value) {
    if (!style || !global.Proxy) return style;
    return new global.Proxy(style, {
      get: (target, key) => {
        if (key === property) return value;
        const result = target[key];
        return typeof result === 'function' ? result.bind(target) : result;
      }
    });
  }

  NS.ADGUARD_DEFINITIONS['spoof-css'] = NS.adguardOwn(
    'spoof-css',
    args => arityError(args, 3, 3) || selectorsError(args[0]) ||
      propertyNameError(args[1]) || propertyValueError(args[2]) ||
      (String(args[1]).toLowerCase() === 'debug'
        ? 'debug CSS spoofing is not allowed in production filters' : ''),
    args => {
      const selectors = String(args[0]).split(',').map(part => part.trim());
      const property = String(args[1]);
      const value = String(args[2]);
      const matched = element => selectors.some(selector => matchesSelector(element, selector));
      const originalStyle = global.getComputedStyle;
      if (typeof originalStyle === 'function') {
        redefine(global, 'getComputedStyle', {
          value: function (element, pseudo) {
            const style = originalStyle.call(global, element, pseudo);
            return matched(element) ? spoofStyle(style, property, value) : style;
          },
          writable: true,
          enumerable: false
        });
      }
      const proto = global.Element && global.Element.prototype;
      const originalRect = proto && proto.getBoundingClientRect;
      const numeric = Number(value);
      if (typeof originalRect === 'function' && RECT_PROPERTIES.has(property) &&
        Number.isFinite(numeric)) {
        redefine(proto, 'getBoundingClientRect', {
          value: function () {
            const rect = originalRect.call(this);
            if (!matched(this) || !rect) return rect;
            const result = Object.assign({}, rect);
            result[property] = numeric;
            return result;
          },
          writable: true,
          enumerable: false
        });
      }
    });

  Object.assign(NS, { adguardSpoofStyle: spoofStyle });
})(this);

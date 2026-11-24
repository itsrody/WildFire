/* WildFire scriptlet shim: AdGuard innerHTML inversion and getter mode. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, compileTimerNeedle, timerNeedleError, optionalLengthError,
    redefine, safeText, safeSelector, matchesSelector
  } = NS;

  function selectorError(value) {
    return !value || safeSelector(value) ? '' : 'invalid CSS selector';
  }

  NS.ADGUARD_DEFINITIONS['prevent-innerhtml'] = NS.adguardOwn(
    'prevent-innerhtml',
    args => arityError(args, 0, 3) || selectorError(args[0]) ||
      timerNeedleError(args[1]) || optionalLengthError(args[2], 2000),
    args => {
      const proto = global.Element && global.Element.prototype;
      if (!proto) return;
      const compiled = compileTimerNeedle(args[1]);
      if (compiled.error) return;
      const replacement = args[2];
      const getterMode = replacement !== undefined;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
      const originalGet = descriptor && descriptor.get;
      const originalSet = descriptor && descriptor.set;
      const matches = element => {
        if (!matchesSelector(element, args[0])) return false;
        return compiled.negated
          ? !compiled.matcher(safeText(element && element.innerHTML))
          : compiled.matcher(safeText(element && element.innerHTML));
      };
      redefine(proto, 'innerHTML', {
        get: function () {
          const value = originalGet ? originalGet.call(this) : '';
          return getterMode && matches(this) ? replacement : value;
        },
        set: function (next) {
          if (compiled.negated
            ? !compiled.matcher(safeText(next))
            : compiled.matcher(safeText(next))) {
            return;
          }
          if (originalSet) originalSet.call(this, next);
        },
        enumerable: true
      });
    });
})(this);

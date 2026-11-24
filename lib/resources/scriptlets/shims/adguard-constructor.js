/* WildFire scriptlet shim: AdGuard positional constructor patterns. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, propertyError, lengthError, compileNeedle, needleError,
    redefine, safeText
  } = NS;

  function patternError(value) {
    if (value === undefined) return '';
    const raw = String(value);
    if (raw.startsWith('[')) {
      let patterns = null;
      try { patterns = JSON.parse(raw); } catch (error) { return 'invalid constructor pattern'; }
      if (!Array.isArray(patterns) || patterns.length > 16 ||
        patterns.some(item => typeof item !== 'string')) {
        return 'invalid constructor pattern';
      }
      return patterns.every(item => item === '*' || !needleError(item))
        ? '' : 'invalid constructor pattern';
    }
    return lengthError(raw, 512) || needleError(raw);
  }

  function compilePattern(value) {
    if (value === undefined) return () => true;
    const raw = String(value);
    const patterns = raw.startsWith('[') ? JSON.parse(raw) : [raw];
    const matchers = patterns.map(item => item === '*'
      ? () => true : compileNeedle(item).matcher);
    return args => matchers.every((matcher, index) => matcher(String(args[index] || '')));
  }

  NS.ADGUARD_DEFINITIONS['prevent-constructor'] = NS.adguardOwn(
    'prevent-constructor',
    args => arityError(args, 1, 2) || propertyError(args[0]) || patternError(args[1]),
    args => {
      const ref = NS.resolvePath(args[0], false);
      if (!ref || typeof ref.target[ref.key] !== 'function') return;
      const original = ref.target[ref.key];
      const matches = compilePattern(args[1]);
      redefine(ref.target, ref.key, {
        value: function () {
          const argsList = Array.from(arguments).map(safeText);
          if (matches(argsList)) throw new Error('WildFire blocked constructor ' + args[0]);
          if (global.Reflect && typeof global.Reflect.construct === 'function') {
            return global.Reflect.construct(original, Array.from(arguments));
          }
          return original.apply(this, arguments);
        },
        writable: true,
        enumerable: false
      });
    });
})(this);

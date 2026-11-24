/* WildFire scriptlet shim: AdGuard delay matching for timer boosters. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, compileNeedle, needleError, redefine, safeText } = NS;

  function adjustError(args) {
    return arityError(args, 0, 3) || needleError(args[0]) ||
      (!args[1] || args[1] === '*' || /^\d+$/.test(args[1]) ? '' : 'invalid timer delay') ||
      (!args[2] || /^\d+(?:\.\d+)?$/.test(args[2]) ? '' : 'invalid timer boost');
  }

  function adjustTimer(name, args) {
    const original = global[name];
    if (typeof original !== 'function') return;
    const callback = compileNeedle(args[0]).matcher;
    const anyDelay = !args[1] || args[1] === '*';
    const delay = anyDelay ? 0 : Number(args[1]);
    const requested = args[2] ? Number(args[2]) : 0.05;
    const boost = Number.isFinite(requested) && requested > 0
      ? Math.min(1000, Math.max(0.001, requested)) : 0.05;
    redefine(global, name, {
      value: function (handler, nextDelay) {
        const current = Number(nextDelay);
        if (callback(safeText(handler)) && (anyDelay || current === delay) &&
          Number.isFinite(current)) {
          const rest = Array.from(arguments).slice(2);
          return original.apply(global,
            [handler, Math.round(current * boost)].concat(rest));
        }
        return original.apply(global, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  NS.ADGUARD_DEFINITIONS['adjust-setinterval'] = NS.adguardOwn(
    'adjust-setinterval', adjustError, args => adjustTimer('setInterval', args));
  NS.ADGUARD_DEFINITIONS['adjust-settimeout'] = NS.adguardOwn(
    'adjust-settimeout', adjustError, args => adjustTimer('setTimeout', args));
})(this);

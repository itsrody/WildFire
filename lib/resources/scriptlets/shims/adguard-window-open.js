/* WildFire scriptlet shim: AdGuard legacy window-open argument forms. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, needleError, timerNeedleError, windowDelayError,
    defuseWindowOpen
  } = NS;

  function isLegacy(args) {
    const first = String(args[0] == null ? '' : args[0]);
    const second = String(args[1] == null ? '' : args[1]);
    return args.length >= 2 && /^(?:0|1)$/.test(first) &&
      (second === '' || !/^\d+$/.test(second));
  }

  function legacyNeedle(args) {
    const search = String(args[1] == null ? '' : args[1]).replace(/^!/, '');
    return String(args[0]) === '0' && search ? '!' + search : search;
  }

  function legacyMode(value) {
    const token = String(value == null ? '' : value).toLowerCase();
    return ['truefunc', 'noopfunc', 'emptyobj', 'obj'].includes(token) ? 'obj' : '';
  }

  function validate(args) {
    if (isLegacy(args)) {
      return arityError(args, 2, 4) || needleError(legacyNeedle(args)) ||
        (!args[2] || /^\d+$/.test(args[2]) ? '' : 'invalid popup decoy delay') ||
        (args[3] === undefined || ['', 'trueFunc', 'noopFunc', 'emptyObj', 'obj']
          .includes(String(args[3])) ? '' : 'invalid popup replacement');
    }
    return arityError(args, 0, 3) || timerNeedleError(args[0]) ||
      windowDelayError(args[1]) ||
      (String(args[2] || '').toLowerCase() === 'log'
        ? 'log window replacement is not allowed in production filters'
        : ['', 'obj', 'blank'].includes(String(args[2] || '').toLowerCase())
          ? '' : 'invalid popup replacement');
  }

  function run(args) {
    if (isLegacy(args)) {
      const delay = args[2] && /^\d+$/.test(args[2]) ? args[2] : undefined;
      defuseWindowOpen(legacyNeedle(args), delay, legacyMode(args[3]));
      return;
    }
    defuseWindowOpen(args[0], args[1], args[2]);
  }

  NS.ADGUARD_DEFINITIONS['prevent-window-open'] = NS.adguardOwn(
    'prevent-window-open', validate, run);
})(this);

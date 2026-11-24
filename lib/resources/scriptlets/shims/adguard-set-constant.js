/* WildFire scriptlet shim: AdGuard constant tokens and value wrappers. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, propertyError, lengthError, optionalLengthError, redefine,
    setConstant, stackAllows
  } = NS;

  function namedFunction(name, result) {
    return { [name]: function () { return result; } }[name];
  }

  function constantFor(value) {
    const token = String(value == null ? '' : value).toLowerCase();
    if (token === 'true') return { value: true };
    if (token === 'false') return { value: false };
    if (token === 'yes') return { value: 'yes' };
    if (token === 'no') return { value: 'no' };
    if (token === 'undefined') return { value: undefined };
    if (token === 'null') return { value: null };
    if (token === 'emptyobj') return { value: {} };
    if (token === 'emptyarr' || token === 'emptyarray') return { value: [] };
    if (token === 'noopfunc') return { value: namedFunction('noopFunc', undefined) };
    if (token === 'noopcallbackfunc') {
      const noop = namedFunction('noopFunc', undefined);
      return { value: namedFunction('noopCallbackFunc', noop) };
    }
    if (token === 'truefunc') return { value: namedFunction('trueFunc', true) };
    if (token === 'falsefunc') return { value: namedFunction('falseFunc', false) };
    if (token === 'throwfunc') {
      return { value: function () { throw new Error('WildFire no-op stub'); } };
    }
    if (token === 'nooppromiseresolve') {
      return { value: function () { return Promise.resolve(''); } };
    }
    if (token === 'nooppromisereject') {
      return { value: function () { return Promise.reject(''); } };
    }
    if (token === '') return { value: '' };
    if (/^-?\d+$/.test(token) && Math.abs(Number(token)) <= 32767) {
      return { value: Number(token) };
    }
    return { error: 'unsupported AdGuard constant value' };
  }

  function propertyPath(args) {
    return String(args[0] == null ? '' : args[0]).trim();
  }

  function setConstantError(args) {
    return arityError(args, 2, 5) || propertyError(propertyPath(args)) ||
      constantFor(args[1]).error || optionalLengthError(args[2], 512) ||
      optionalLengthError(args[3], 64) || optionalLengthError(args[4], 16);
  }

  function applyConstant(args) {
    if (setConstantError(args) || !stackAllows(args[2])) return;
    const constant = constantFor(args[1]).value;
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
    setConstant(propertyPath(args), value);
  }

  NS.ADGUARD_DEFINITIONS['set-constant'] = NS.adguardOwn(
    'set-constant', setConstantError, applyConstant);

  Object.assign(NS, { adguardConstantFor: constantFor, adguardSetConstantError: setConstantError });
})(this);

/* WildFire scriptlet shim: expanded set-constant tokens.
 * Classic-script module; loaded after core and before the public API.
 * Filter text is never compiled: tokens map to WildFire-owned factories. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const ALIASES = Object.freeze({
    emptyobj: 'emptyObj', emptyarr: 'emptyArr', emptystr: 'emptyStr',
    noopfunc: 'noopFunc', truefunc: 'trueFunc', falsefunc: 'falseFunc',
    throwfunc: 'throwFunc'
  });

  function constantFactory(value) {
    const raw = String(value == null ? '' : value);
    const constants = NS.CONSTANTS;
    if (NS.owns(constants, raw)) return constants[raw];
    const token = raw.toLowerCase();
    const alias = NS.owns(ALIASES, token) ? ALIASES[token] : '';
    if (alias) return constants[alias];
    if (/^-?\d{1,5}$/.test(raw) && Math.abs(Number(raw)) <= 32767) {
      const number = Number(raw);
      return () => number;
    }
    return null;
  }

  [
    ['', () => ''],
    ['{}', () => ({})],
    ['[]', () => []],
    ['emptyObj', () => ({})],
    ['emptyArr', () => []],
    ['emptyStr', () => ''],
    ['noopFunc', () => function noopFunc() { return undefined; }],
    ['trueFunc', () => function trueFunc() { return true; }],
    ['falseFunc', () => function falseFunc() { return false; }],
    ['throwFunc', () => function throwFunc() {
      throw new Error('WildFire no-op stub');
    }]
  ].forEach(entry => { NS.registerConstant(entry[0], entry[1]); });

  Object.assign(NS, { constantFactory });
})(this);

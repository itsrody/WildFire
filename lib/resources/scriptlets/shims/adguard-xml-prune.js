/* WildFire scriptlet shim: AdGuard XML prune argument order. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, lengthError, optionalLengthError, pruneXmlText,
    installResponseTransformer } = NS;

  function selectorError(value) {
    return lengthError(value, 500) ||
      (/[<>;{}]/.test(String(value)) ? 'invalid XML selector' : '');
  }

  NS.ADGUARD_DEFINITIONS['xml-prune'] = NS.adguardOwn(
    'xml-prune',
    args => arityError(args, 1, 3) || selectorError(args[0]) ||
      (!args[1] ? '' : selectorError(args[1])) ||
      optionalLengthError(args[2], 512),
    args => installResponseTransformer(
      (value, text) => pruneXmlText(text, args[0], args[1]), args[2], 'text', 'both'));
})(this);

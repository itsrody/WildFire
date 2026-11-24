/* WildFire scriptlet shim: mpegdash-prune for DASH manifests.
 * Classic-script module; loaded after registries and before the public API.
 * Selectors are bounded data; responses are parsed and pruned read-only. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  function mpegDashSelectorError(selector) {
    const value = String(selector == null ? '' : selector);
    return NS.lengthError(value, 500) || (/[<;{}]/.test(value)
      ? 'invalid DASH selector' : '');
  }

  NS.DEFINITIONS['mpegdash-prune'] = {
    aliases: ['mpeg-dash-prune'],
    validate: args => NS.arityError(args, 1, 2) ||
      mpegDashSelectorError(args[0]) || NS.optionalLengthError(args[1], 512),
    run: args => NS.installResponseTransformer(
      (value, text) => NS.pruneXmlText(text, args[0], ''), args[1], 'text', 'both')
  };

  Object.assign(NS, { mpegDashSelectorError });
})(this);

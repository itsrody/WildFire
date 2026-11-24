/* WildFire scriptlet shim: uBO-style prevent-navigation bridge.
 * Classic-script module; loaded after registries and before the public API.
 * Delegates to the existing WildFire navigation defuser with plain data. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  NS.DEFINITIONS['prevent-navigation'] = {
    aliases: [],
    validate: args => NS.arityError(args, 0, 1) || NS.optionalLengthError(args[0]),
    run: args => NS.adguardPreventNavigation(args[0])
  };
})(this);

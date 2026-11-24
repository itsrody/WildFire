/* WildFire scriptlet shim: multiup detector stub.
 * Classic-script module; loaded after registries and before the public API.
 * No filter text supplies code; the stub is WildFire-owned. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  NS.DEFINITIONS.multiup = {
    aliases: [],
    validate: args => NS.arityError(args, 0, 0),
    run: () => NS.stubObject(['MultiUp', 'multiup'], ['init', 'load', 'download'])
  };
})(this);

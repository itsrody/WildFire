/* WildFire scriptlet shim: dotted popads.net alias.
 * Classic-script module; loaded after registries and before the public API.
 * The alias shares the existing WildFire detector stub and exception identity. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const popads = NS.DEFINITIONS.popads;
  if (popads && !popads.aliases.includes('popads.net')) {
    popads.aliases.push('popads.net');
  }
})(this);

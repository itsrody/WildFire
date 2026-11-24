/* WildFire scriptlet shim: AdGuard ubo-acis.js bridge.
 * Delegates to the existing WildFire abort-current-script implementation. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  NS.ADGUARD_DEFINITIONS['ubo-acis.js'] =
    NS.adguardDelegate('abort-current-script');
})(this);

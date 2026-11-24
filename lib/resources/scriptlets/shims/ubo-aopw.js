/* WildFire scriptlet shim: AdGuard ubo-aopw.js bridge.
 * Delegates to the existing WildFire abort-on-property-write implementation. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  NS.ADGUARD_DEFINITIONS['ubo-aopw.js'] =
    NS.adguardDelegate('abort-on-property-write');
})(this);

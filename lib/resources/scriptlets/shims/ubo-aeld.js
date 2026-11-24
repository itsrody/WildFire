/* WildFire scriptlet shim: AdGuard ubo-aeld.js bridge.
 * Delegates to the existing WildFire addEventListener defuser. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  NS.ADGUARD_DEFINITIONS['ubo-aeld.js'] =
    NS.adguardDelegate('addeventlistener-defuser');
})(this);

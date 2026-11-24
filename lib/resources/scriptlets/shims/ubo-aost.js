/* WildFire scriptlet shim: AdGuard ubo-aost bridge.
 * Delegates to the existing WildFire abort-on-stack-trace implementation. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  NS.ADGUARD_DEFINITIONS['ubo-aost'] =
    NS.adguardDelegate('abort-on-stack-trace');
})(this);

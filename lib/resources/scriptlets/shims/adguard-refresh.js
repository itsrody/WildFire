/* WildFire scriptlet shim: AdGuard meta-refresh defusing. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, onDom } = NS;

  NS.ADGUARD_DEFINITIONS['prevent-refresh'] = NS.adguardOwn(
    'prevent-refresh',
    args => arityError(args, 0, 1) ||
      (!args[0] || (/^\d+$/.test(args[0]) && Number(args[0]) <= 86400)
        ? '' : 'invalid meta refresh delay'),
    args => {
      const delay = args[0] ? Number(args[0]) : null;
      onDom('meta[http-equiv]', element => {
        if (String(element.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') {
          return;
        }
        const content = String(element.getAttribute('content') || '');
        const seconds = /^\s*(\d+)/.exec(content);
        if (delay !== null && (!seconds || Number(seconds[1]) !== delay)) return;
        try { element.removeAttribute('http-equiv'); } catch (error) { /* locked node */ }
      });
    });
})(this);

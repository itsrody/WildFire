/* WildFire scriptlet shim: AdGuard prevent-fetch body directives. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, lengthError, redefine, safeText, adguardLog, conditionMatcher,
    fakeResponse, parseFetchConfig, fetchConfigError, responseDirective
  } = NS;

  function directiveError(value) {
    if (value === undefined || value === '') return '';
    const token = String(value);
    if (['emptyObj', 'emptyArr', 'emptyStr', 'true'].includes(token)) return '';
    const length = /^length:(\d+)(?:-(\d+))?$/.exec(token);
    if (!length) return 'invalid fetch directive';
    const min = Number(length[1]);
    const max = length[2] ? Number(length[2]) : min;
    return max >= min && max <= 500000 ? '' : 'invalid fetch directive';
  }

  NS.ADGUARD_DEFINITIONS['prevent-fetch'] = NS.adguardOwn(
    'prevent-fetch',
    args => arityError(args, 0, 3) || lengthError(args[0]) ||
      directiveError(args[1]) || fetchConfigError(args[2]),
    args => {
      const original = global.fetch;
      if (typeof original !== 'function') return;
      const logging = args.length === 0;
      const matches = conditionMatcher(logging ? '' : String(args[0] == null ? '' : args[0]));
      const body = responseDirective(args[1] || 'emptyObj');
      const config = parseFetchConfig(args[2]).config;
      redefine(global, 'fetch', {
        value: function (url, init) {
          if (logging) adguardLog('fetch', safeText(url), safeText(init));
          if (matches(safeText(url), init)) {
            return Promise.resolve(fakeResponse(body, config));
          }
          return original.apply(global, arguments);
        },
        writable: true,
        enumerable: false
      });
    });
})(this);

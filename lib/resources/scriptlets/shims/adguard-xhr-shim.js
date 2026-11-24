/* WildFire scriptlet shim: AdGuard prevent-xhr response directives. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, lengthError, redefine, safeText, adguardLog, conditionMatcher,
    responseDirective
  } = NS;

  function directiveError(value) {
    if (value === undefined || value === '') return '';
    const token = String(value);
    if (['emptyObj', 'emptyArr', 'emptyStr', 'true'].includes(token)) return '';
    const length = /^length:(\d+)(?:-(\d+))?$/.exec(token);
    if (!length) return 'invalid XHR directive';
    const min = Number(length[1]);
    const max = length[2] ? Number(length[2]) : min;
    return max >= min && max <= 500000 ? '' : 'invalid XHR directive';
  }

  function directiveValue(directive) {
    const token = String(directive || '');
    if (token === 'emptyObj') return { text: '{}', value: {} };
    if (token === 'emptyArr') return { text: '[]', value: [] };
    const text = responseDirective(token);
    return { text, value: text };
  }

  NS.ADGUARD_DEFINITIONS['prevent-xhr'] = NS.adguardOwn(
    'prevent-xhr',
    args => arityError(args, 0, 2) || lengthError(args[0]) || directiveError(args[1]),
    args => {
      const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
      if (!proto || typeof proto.open !== 'function') return;
      const originalOpen = proto.open;
      const logging = args.length === 0;
      const matches = conditionMatcher(logging ? '' : String(args[0] == null ? '' : args[0]));
      const replacements = typeof global.WeakMap === 'function'
        ? new global.WeakMap() : null;
      redefine(proto, 'open', {
        value: function (method, url) {
          if (logging) adguardLog('XMLHttpRequest', safeText(url));
          if (matches(safeText(url)) && replacements) {
            replacements.set(this, directiveValue(args[1]));
          } else if (replacements) {
            replacements.delete(this);
          }
          return originalOpen.apply(this, arguments);
        },
        writable: true,
        enumerable: false
      });
      ['responseText', 'response'].forEach(name => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        const originalGet = descriptor && descriptor.get;
        redefine(proto, name, {
          get: function () {
            const replacement = replacements && replacements.get(this);
            if (replacement) {
              return name === 'responseText' ? replacement.text : replacement.value;
            }
            return originalGet ? originalGet.call(this) : '';
          },
          set: descriptor && descriptor.set,
          enumerable: true
        });
      });
    });
})(this);

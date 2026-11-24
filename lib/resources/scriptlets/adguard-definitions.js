/* WildFire scriptlets: AdGuard alias catalog delegated to WildFire implementations.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, propertyError, lengthError, optionalLengthError, prunePathsError, compileNeedle, needleError, timerNeedleError, timerDelayError, define, trapWrite, safeText, redefine, defuseEvents, windowDelayError, windowReplacementError, defuseWindowOpen, changeAttribute, changeClass, nodeTextOptionsError, removeNodeText, replaceNodeText, stubObject, conditionMatcher, installResponseTransformer, fakeResponse, parseFetchConfig, fetchConfigError, pruneXmlText, compileReplaceRegex, adguardLog, adguardSetConstantError, adguardSetConstant, adguardCookieError, adguardWriteCookie, adguardStorageError, adguardStorageWrite, adguardStorageReload, adguardShadowDom, adguardCssRuleError, adguardInjectShadowCss, adguardConstructor, adguardPreventNavigation, adguardPreventElementSrc, adguardRemoveQueryParameters, adguardLogMethod, adguardDirString, adguardPreventInnerHtml, adguardPreventXhr, adguardStubFunctions, DEFINITIONS } = NS;

  function adguardDelegate(canonicalName, transform, validateArgs) {
    const definition = DEFINITIONS[canonicalName];
    const argsFor = args => transform ? transform(args) : args;
    return {
      canonical: canonicalName,
      validate: args => validateArgs ? validateArgs(args) : definition.validate(argsFor(args)),
      run: args => definition.run(argsFor(args))
    };
  }

  function adguardOwn(canonicalName, validate, run) {
    return { canonical: canonicalName, validate, run };
  }

  const noAdguardArgs = args => arityError(args, 0, 0);
  const restrictedAdguard = () => 'debug scriptlets are not allowed in production filters';

  // AdGuard aliases are validated as strings and then delegated to the same
  // WildFire implementations used by `##+js()`. Aliases without a uBO twin get
  // a small original implementation here; no script text is ever accepted.
  const ADGUARD_DEFINITIONS = Object.freeze({
    'abort-current-inline-script': adguardDelegate('abort-current-script'),
    'abort-on-property-read': adguardDelegate('abort-on-property-read'),
    'abort-on-property-write': adguardDelegate('abort-on-property-write'),
    'abort-on-stack-trace': adguardDelegate('abort-on-stack-trace'),
    'adjust-setinterval': adguardDelegate('adjust-setinterval'),
    'adjust-settimeout': adguardDelegate('adjust-settimeout'),
    'amazon-apstag': adguardOwn('amazon-apstag', noAdguardArgs,
      () => stubObject(['apstag'], ['init', 'fetchBids', 'setDebugEnabled', 'displayAds'])),
    'call-nothrow': adguardDelegate('call-nothrow'),
    'close-window': adguardDelegate('close-window'),
    'debug-current-inline-script': adguardOwn('debug-current-inline-script', restrictedAdguard, () => {}),
    'debug-on-property-read': adguardOwn('debug-on-property-read', restrictedAdguard, () => {}),
    'debug-on-property-write': adguardOwn('debug-on-property-write', restrictedAdguard, () => {}),
    'didomi-loader': adguardOwn('didomi-loader', noAdguardArgs,
      () => stubObject(['Didomi'], ['initialize', 'onReady', 'onConsentChanged', 'setUser'])),
    'dir-string': adguardOwn('dir-string',
      args => arityError(args, 0, 1) || optionalLengthError(args[0], 16),
      args => adguardDirString(args[0])),
    'disable-newtab-links': adguardDelegate('disable-newtab-links'),
    'evaldata-prune': adguardDelegate('evaldata-prune'),
    'fingerprintjs2': adguardDelegate('fingerprint2'),
    'fingerprintjs3': adguardDelegate('fingerprint3'),
    'freewheel-admanager': adguardOwn('freewheel-admanager', noAdguardArgs,
      () => stubObject(['tv', 'freewheel'], ['init', 'addAdUnit', 'load'])),
    'gemius': adguardOwn('gemius', noAdguardArgs,
      () => stubObject(['gemius'], ['hit', 'prepare', 'setConfig'])),
    'google-analytics-ga': adguardOwn('google-analytics-ga', noAdguardArgs,
      () => adguardStubFunctions(['ga', 'GoogleAnalyticsObject'])),
    'google-analytics': adguardOwn('google-analytics', noAdguardArgs,
      () => adguardStubFunctions(['ga', 'gtag', 'dataLayer'])),
    'google-ima3-dai': adguardOwn('google-ima3-dai', noAdguardArgs,
      () => stubObject(['google.ima.dai'], ['TvPlayer', 'init', 'load'])),
    'google-ima3': adguardOwn('google-ima3', noAdguardArgs,
      () => stubObject(['google.ima'], ['AdDisplayContainer', 'AdsLoader', 'AdsManager'])),
    'googlesyndication-adsbygoogle': adguardOwn('googlesyndication-adsbygoogle', noAdguardArgs,
      () => {
        if (!propertyError('adsbygoogle')) define(global, 'adsbygoogle', {
          value: [], writable: false, enumerable: false
        });
      }),
    'googletagservices-gpt': adguardOwn('googletagservices-gpt', noAdguardArgs,
      () => stubObject(['googletag'], ['cmd', 'push', 'defineSlot', 'display', 'enableServices'])),
    'hide-in-shadow-dom': adguardOwn('hide-in-shadow-dom',
      args => arityError(args, 1, 2) || lengthError(args[0], 500) ||
        optionalLengthError(args[1], 500),
      args => adguardShadowDom(args[0], args[1], true)),
    'href-sanitizer': adguardDelegate('href-sanitizer'),
    'inject-css-in-shadow-dom': adguardOwn('inject-css-in-shadow-dom',
      args => arityError(args, 1, 3) || adguardCssRuleError(args[0]) ||
        optionalLengthError(args[1], 500) ||
        (['', 'adoptedstylesheets', 'styletag'].includes(String(args[2] || '').toLowerCase())
          ? '' : 'invalid CSS injection method'),
      args => adguardInjectShadowCss(args[0], args[1], String(args[2] || '').toLowerCase())),
    'json-prune-fetch-response': adguardDelegate('json-prune-fetch-response'),
    'json-prune-xhr-response': adguardDelegate('json-prune-xhr-response'),
    'json-prune': adguardDelegate('json-prune', args => args.slice(0, 3),
      args => arityError(args, 0, 4) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2])),
    'log-addeventlistener': adguardOwn('log-addeventlistener',
      args => arityError(args, 0, 1) || optionalLengthError(args[0], 16),
      args => {
        if (typeof global.addEventListener !== 'function') return;
        const original = global.addEventListener;
        define(global, 'addEventListener', {
          value: function (type, listener) {
            adguardLog('addEventListener', safeText(type), safeText(listener));
            return original.apply(this, arguments);
          },
          writable: String(args[0]) !== 'false',
          enumerable: false
        });
      }),
    'log-eval': adguardOwn('log-eval', noAdguardArgs, () => adguardLogMethod('eval')),
    'log-on-stack-trace': adguardOwn('log-on-stack-trace', restrictedAdguard, () => {}),
    'log': adguardOwn('log',
      args => arityError(args, 0, 20),
      args => adguardLog.apply(null, args)),
    'm3u-prune': adguardDelegate('m3u-prune'),
    'matomo': adguardOwn('matomo', noAdguardArgs,
      () => stubObject(['Matomo', 'Piwik'], ['getTracker', 'initialize', 'trackPageView'])),
    'metrika-yandex-tag': adguardOwn('metrika-yandex-tag', noAdguardArgs,
      () => adguardStubFunctions(['ym', 'yaCounter', 'yandex_metrika_callbacks'])),
    'metrika-yandex-watch': adguardOwn('metrika-yandex-watch', noAdguardArgs,
      () => adguardStubFunctions(['yaCounter', 'yandex_metrika_callbacks'])),
    'naver-wcslog': adguardOwn('naver-wcslog', noAdguardArgs,
      () => adguardStubFunctions(['wcs_log', 'wcs_add'])),
    'no-protected-audience': adguardOwn('no-protected-audience', noAdguardArgs,
      () => {
        [global, global.document].filter(Boolean).forEach(target => {
          ['interestCohort', 'joinAdInterestGroup', 'leaveAdInterestGroup'].forEach(name => {
            define(target, name, { value: undefined, writable: false, enumerable: false });
          });
        });
      }),
    'no-topics': adguardOwn('no-topics', noAdguardArgs,
      () => {
        [global, global.document].filter(Boolean).forEach(target => {
          define(target, 'browsingTopics', {
            value: undefined, writable: false, enumerable: false
          });
        });
      }),
    'noeval': adguardDelegate('noeval'),
    'nowebrtc': adguardDelegate('nowebrtc'),
    'pardot-1.0': adguardOwn('pardot-1.0', noAdguardArgs,
      () => stubObject(['piAId', 'pardot'], ['init', 'track', 'load'])),
    'prebid': adguardDelegate('prebid-ads'),
    'prevent-addeventlistener': adguardOwn('prevent-addeventlistener',
      args => arityError(args, 0, 5) || needleError(args[0]) || needleError(args[1]) ||
        optionalLengthError(args[2], 120) || optionalLengthError(args[3], 512) ||
        optionalLengthError(args[4], 16),
      args => defuseEvents(args[0], args[1])),
    'prevent-adfly': adguardOwn('prevent-adfly', noAdguardArgs,
      () => stubObject(['adfly'], ['init', 'show', 'close'])),
    'prevent-bab': adguardDelegate('nobab'),
    'prevent-canvas': adguardOwn('prevent-canvas',
      args => arityError(args, 0, 1) || needleError(String(args[0] || '').replace(/^!/, '')),
      args => {
        const proto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
        if (!proto || typeof proto.getContext !== 'function') return;
        const original = proto.getContext;
        const raw = String(args[0] || '');
        const negate = raw.startsWith('!');
        const matcher = compileNeedle(negate ? raw.slice(1) : raw).matcher;
        redefine(proto, 'getContext', {
          value: function (type) {
            const blocked = !raw || (negate ? !matcher(type) : matcher(type));
            return blocked ? null : original.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
      }),
    'prevent-constructor': adguardOwn('prevent-constructor',
      args => arityError(args, 1, 2) || propertyError(args[0]) || needleError(args[1]),
      args => adguardConstructor(args[0], args[1])),
    'prevent-element-src-loading': adguardOwn('prevent-element-src-loading',
      args => arityError(args, 2, 2) ||
        (/^(?:script|img|iframe|link)$/i.test(args[0]) ? '' : 'invalid element tag') ||
        needleError(args[1]),
      args => adguardPreventElementSrc(args[0], args[1])),
    'prevent-eval-if': adguardDelegate('noeval-if'),
    'prevent-fab-3.2.0': adguardDelegate('nofab'),
    'prevent-fetch': adguardOwn('prevent-fetch',
      args => arityError(args, 0, 3) || lengthError(args[0]) ||
        optionalLengthError(args[1]) || fetchConfigError(args[2]),
      args => {
        if (typeof global.fetch !== 'function') return;
        const original = global.fetch;
        const matches = conditionMatcher(args[0]);
        const body = String(args[1] || '');
        const config = parseFetchConfig(args[2]).config;
        define(global, 'fetch', {
          value: function (url, init) {
            if (matches(safeText(url), init)) {
              return Promise.resolve(fakeResponse(body, config));
            }
            return original.apply(global, arguments);
          },
          writable: true,
          enumerable: false
        });
      }),
    'prevent-innerhtml': adguardOwn('prevent-innerhtml',
      args => arityError(args, 0, 3) || optionalLengthError(args[0], 500) ||
        needleError(args[1]) || optionalLengthError(args[2], 2000),
      args => adguardPreventInnerHtml(args[0], args[1], args[2])),
    'prevent-navigation': adguardOwn('prevent-navigation',
      args => arityError(args, 0, 1) || optionalLengthError(args[0]),
      args => adguardPreventNavigation(args[0])),
    'prevent-popads-net': adguardOwn('prevent-popads-net', noAdguardArgs,
      () => trapWrite('popns')),
    'prevent-refresh': adguardDelegate('prevent-refresh'),
    'prevent-requestanimationframe': adguardDelegate('prevent-requestanimationframe'),
    'prevent-setinterval': adguardDelegate('prevent-setinterval',
      args => args.slice(0, 2),
      args => arityError(args, 0, 2) ||
        timerNeedleError(args[0]) || timerDelayError(args[1])),
    'prevent-settimeout': adguardDelegate('prevent-settimeout',
      args => args.slice(0, 2),
      args => arityError(args, 0, 2) ||
        timerNeedleError(args[0]) || timerDelayError(args[1])),
    'prevent-window-open': adguardOwn('prevent-window-open',
      args => arityError(args, 0, 3) || timerNeedleError(args[0]) ||
        windowDelayError(args[1]) || windowReplacementError(args[2]),
      args => defuseWindowOpen(args[0], args[1], args[2])),
    'prevent-xhr': adguardOwn('prevent-xhr',
      args => arityError(args, 0, 2) || lengthError(args[0]) || optionalLengthError(args[1]),
      args => adguardPreventXhr(args[0], args[1])),
    'remove-attr': adguardOwn('remove-attr',
      args => arityError(args, 1, 3) ||
        (/^[A-Za-z_:][-\w.:]*(?:\|[A-Za-z_:][-\w.:]*)*$/.test(args[0])
          ? '' : 'invalid attribute list') || optionalLengthError(args[1], 500) ||
        (/^(?:asap|complete|stay)(?:\s+(?:asap|complete|stay))*$/.test(args[2] || '')
          ? '' : 'invalid applying flag'),
      args => changeAttribute(args[0], args[1] || '*', args[2], 'remove', '')),
    'remove-class': adguardOwn('remove-class',
      args => arityError(args, 1, 3) ||
        (/^\S+(?:\|\S+)*$/.test(args[0]) ? '' : 'invalid class list') ||
        optionalLengthError(args[1], 500) ||
        (/^(?:asap|complete|stay)(?:\s+(?:asap|complete|stay))*$/.test(args[2] || '')
          ? '' : 'invalid applying flag'),
      args => changeClass(args[0], args[1] || '*', args[2], false)),
    'remove-cookie': adguardDelegate('remove-cookie'),
    'remove-in-shadow-dom': adguardOwn('remove-in-shadow-dom',
      args => arityError(args, 1, 2) || lengthError(args[0], 500) ||
        optionalLengthError(args[1], 500),
      args => adguardShadowDom(args[0], args[1], false)),
    'remove-node-text': adguardOwn('remove-node-text',
      args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        needleError(args[1]) || optionalLengthError(args[2], 500),
      args => removeNodeText(args[2] || args[0], args[1], [])),
    'replace-node-text': adguardOwn('replace-node-text',
      args => arityError(args, 2, 13) || lengthError(args[0], 500) ||
        needleError(args[1]) || optionalLengthError(args[2], 500) ||
        nodeTextOptionsError(args.slice(3)),
      args => replaceNodeText(args[0], args[1], args[2] || '', args.slice(3))),
    'remove-request-query-parameter': adguardOwn('remove-request-query-parameter',
      args => arityError(args, 1, 2) ||
        (args[0].startsWith('/')
          ? (compileReplaceRegex(args[0]) ? '' : 'invalid parameter pattern')
          : (/^[\w.\-,]+$/.test(args[0]) ? '' : 'invalid parameter list')) ||
        optionalLengthError(args[1]),
      args => adguardRemoveQueryParameters(args[0], args[1])),
    'scorecardresearch-beacon': adguardOwn('scorecardresearch-beacon', noAdguardArgs,
      () => stubObject(['_sf'], ['init', 'set', 'send', 'hit'])),
    'set-attr': adguardOwn('set-attr',
      args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        (/^[A-Za-z_:][-\w.:]*$/.test(args[1]) && !/^on/i.test(args[1])
          ? '' : 'invalid attribute') ||
        optionalLengthError(args[2], 2000),
      args => changeAttribute(args[1], args[0], [], 'set', args[2] || '')),
    'set-constant': adguardOwn('set-constant', adguardSetConstantError, adguardSetConstant),
    'set-cookie-reload': adguardOwn('set-cookie-reload',
      args => arityError(args, 2, 4) || adguardCookieError(args),
      adguardStorageReload),
    'set-cookie': adguardOwn('set-cookie', adguardCookieError, adguardWriteCookie),
    'set-local-storage-item': adguardOwn('set-local-storage-item', adguardStorageError,
      args => adguardStorageWrite('localStorage', args[0], args[1])),
    'set-popads-dummy': adguardDelegate('popads-dummy'),
    'set-session-storage-item': adguardOwn('set-session-storage-item', adguardStorageError,
      args => adguardStorageWrite('sessionStorage', args[0], args[1])),
    'ubo-acis.js': adguardDelegate('abort-current-script'),
    'ubo-aeld.js': adguardDelegate('addeventlistener-defuser'),
    'ubo-aopw.js': adguardDelegate('abort-on-property-write'),
    'ubo-aost': adguardDelegate('abort-on-stack-trace'),
    'spoof-css': adguardOwn('spoof-css',
      args => arityError(args, 3, 3) || lengthError(args[0], 500) ||
        lengthError(args[1], 120) || lengthError(args[2], 500) ||
        (String(args[1]).toLowerCase() === 'debug'
          ? 'debug CSS spoofing is not allowed in production filters' : ''),
      args => DEFINITIONS['spoof-css'].run([args[1], args[2]])),
    'xml-prune': adguardOwn('xml-prune',
      args => arityError(args, 0, 3) || optionalLengthError(args[0], 512) ||
        optionalLengthError(args[1], 500) || optionalLengthError(args[2], 512),
      args => installResponseTransformer(
        (value, text) => pruneXmlText(text, args[1] || '', args[0]), args[2], 'text', 'both'))
  });

  Object.assign(NS, { adguardDelegate, adguardOwn, noAdguardArgs, restrictedAdguard, ADGUARD_DEFINITIONS });
})(this);

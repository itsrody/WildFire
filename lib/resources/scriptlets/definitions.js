/* WildFire scriptlets: uBO alias catalog (validators + WildFire implementations).
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { CONSTANTS, owns, arityError, propertyError, lengthError, optionalLengthError, prunePathsError, compileNeedle, needleError, resolvePath, define, setConstant, trapRead, trapWrite, safeText, redefine, scriptStack, abortCurrentScript, blockEval, conditionalEval, timerNeedleError, timerDelayError, wrapTimer, defuseEvents, defuseWindowName, windowDelayError, windowReplacementError, defuseWindowOpen, onDom, changeAttribute, changeClass, writeCookie, removeCookie, storageWrite, safeStorageRead, callNothrow, adjustTimer, removeNodeText, sanitizeHref, injectStyle, defuseDetector, stubObject, trapPropertySetter, pruneJson, conditionMatcher, namedArg, stackAllows, installResponseTransformer, fakeResponse, responseDirective, parseFetchConfig, fetchConfigError, editObject, installRequestTransformer, pruneXmlText, compileReplaceRegex, pruneM3uText, installObjectEdit, pruneJsonlText, jsonPathError } = NS;

  // One canonical name per behavior. Short names are aliases of the canonical
  // key, so exceptions match no matter which spelling a filter used.
  const DEFINITIONS = Object.freeze({
    'abort-on-property-read': {
      aliases: ['aopr'],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => trapRead(args[0],
        () => { throw new Error('WildFire blocked read of ' + args[0]); })
    },
    'abort-on-property-write': {
      aliases: ['aopw'],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => trapWrite(args[0])
    },
    'set-constant': {
      aliases: ['set'],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) ||
        (owns(CONSTANTS, args[1]) ? '' : 'unsupported constant value'),
      run: args => setConstant(args[0], CONSTANTS[args[1]]())
    },
    'abort-current-script': {
      aliases: ['acs', 'abort-current-inline-script', 'acis'],
      validate: args => arityError(args, 1, 3) || propertyError(args[0]) ||
        needleError(args[1]) || needleError(args[2]),
      run: args => abortCurrentScript(args)
    },
    'noeval': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => blockEval()
    },
    'noeval-silent': {
      aliases: ['silent-noeval'],
      validate: args => arityError(args, 0, 0),
      run: () => blockEval()
    },
    'noeval-if': {
      aliases: ['prevent-eval-if'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => conditionalEval(args[0])
    },
    'prevent-settimeout': {
      aliases: ['no-settimeout-if', 'nostif', 'settimeout-defuser'],
      validate: args => arityError(args, 0, 2) ||
        timerNeedleError(args[0]) || timerDelayError(args[1]),
      run: args => wrapTimer('setTimeout', args[0], args[1])
    },
    'prevent-setinterval': {
      aliases: ['no-setinterval-if', 'nosiif', 'setinterval-defuser'],
      validate: args => arityError(args, 0, 2) ||
        timerNeedleError(args[0]) || timerDelayError(args[1]),
      run: args => wrapTimer('setInterval', args[0], args[1])
    },
    'addeventlistener-defuser': {
      aliases: ['aeld', 'prevent-addeventlistener'],
      validate: args => arityError(args, 0, 2) ||
        needleError(args[0]) || needleError(args[1]),
      run: args => defuseEvents(args[0], args[1])
    },
    'window.name-defuser': {
      aliases: ['windowname-defuser'],
      validate: args => arityError(args, 0, 0),
      run: () => defuseWindowName()
    },
    'prevent-window-open': {
      aliases: ['nowoif', 'no-window-open-if', 'window.open-defuser'],
      validate: args => arityError(args, 0, 3) || timerNeedleError(args[0]) ||
        windowDelayError(args[1]) || windowReplacementError(args[2]),
      run: args => defuseWindowOpen(args[0], args[1], args[2])
    },
    'abort-on-stack-trace': {
      aliases: ['aost'],
      validate: args => arityError(args, 1, 2) || propertyError(args[0]) ||
        needleError(args[1]),
      run: args => trapRead(args[0], () => {
        const needle = args[1];
        if (needle === 'inlineScript' || needle === 'injectedScript' ||
          compileNeedle(needle).matcher(scriptStack())) {
          throw new Error('WildFire blocked read of ' + args[0]);
        }
      })
    },
    'remove-attr': {
      aliases: ['ra'],
      validate: args => arityError(args, 2, 2),
      run: args => changeAttribute(args[0], args[1], 'remove', '')
    },
    'remove-class': {
      aliases: ['rc'],
      validate: args => arityError(args, 2, 2) || (/^\S+$/.test(args[1]) ? '' : 'invalid class'),
      run: args => changeClass(args[0], args[1], false)
    },
    'set-attr': {
      aliases: [],
      validate: args => arityError(args, 3, 3) ||
        (/^[A-Za-z_:][-\w.:]*$/.test(args[1]) ? '' : 'invalid attribute'),
      run: args => changeAttribute(args[0], args[1], 'set', args[2])
    },
    'set-cookie': {
      aliases: [],
      validate: args => arityError(args, 2, 3) ||
        (/^[^\s;=]+$/.test(args[0]) ? '' : 'invalid cookie name') ||
        (/^[^\r\n;]*$/.test(args[1]) ? '' : 'invalid cookie value') ||
        (args[2] === undefined || /^\d+$/.test(args[2]) ? '' : 'invalid cookie expiry'),
      run: args => writeCookie(args[0], args[1], Number(args[2]))
    },
    'set-cookie-reload': {
      aliases: [],
      validate: args => arityError(args, 2, 2) ||
        (/^[^\s;=]+$/.test(args[0]) ? '' : 'invalid cookie name') ||
        (/^[^\r\n;]*$/.test(args[1]) ? '' : 'invalid cookie value'),
      run: args => {
        const key = 'wildfire.reloaded.' + args[0];
        const already = safeStorageRead('sessionStorage', key);
        writeCookie(args[0], args[1], 30);
        storageWrite('sessionStorage', key, '1');
        if (!already && global.location && typeof global.location.reload === 'function') {
          try { global.location.reload(); } catch (error) { /* restricted */ }
        }
      }
    },
    'remove-cookie': {
      aliases: ['cookie-remover'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => removeCookie(args[0])
    },
    'set-local-storage-item': {
      aliases: [],
      validate: args => arityError(args, 2, 2),
      run: args => storageWrite('localStorage', args[0], args[1])
    },
    'set-session-storage-item': {
      aliases: [],
      validate: args => arityError(args, 2, 2),
      run: args => storageWrite('sessionStorage', args[0], args[1])
    },
    'disable-newtab-links': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => onDom('a[target]', element => {
        if (element.getAttribute('target') !== '_self') element.setAttribute('target', '_self');
      })
    },
    'close-window': {
      aliases: ['window-close-if'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const path = global.location
          ? String(global.location.pathname || '') + String(global.location.search || '')
          : '';
        if (compileNeedle(args[0]).matcher(path) && typeof global.close === 'function') {
          try { global.close(); } catch (error) { /* restricted */ }
        }
      }
    },
    'href-sanitizer': {
      aliases: [],
      validate: args => arityError(args, 1, 3) ||
        (/^(?:text|\[[^\]]+\]|\?[^ ]*)?$/.test(args[1] || '') ? '' : 'invalid href source') ||
        (/^(?:base64decode|-base64|removeHash|removeParam(?::[\w,]+)?)?$/
          .test(args[2] || '') ? '' : 'invalid href transform'),
      run: args => sanitizeHref(args[0], args[1], args[2])
    },
    'prevent-innerhtml': {
      aliases: ['prevent-innerHTML'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => trapPropertySetter('Element.prototype.innerHTML', args[0])
    },
    'remove-node-text': {
      aliases: ['rmnt'],
      validate: args => arityError(args, 2, 2) || needleError(args[1]),
      run: args => removeNodeText(args[0], args[1])
    },
    'call-nothrow': {
      aliases: [],
      validate: args => arityError(args, 1, 1) || propertyError(args[0]),
      run: args => callNothrow(args[0])
    },
    'adjust-settimeout': {
      aliases: ['nano-settimeout-booster', 'nano-stb'],
      validate: args => arityError(args, 0, 3) ||
        needleError(args[0]) ||
        (!args[1] || args[1] === '*' || /^\d+$/.test(args[1]) ? '' : 'invalid delay') ||
        (!args[2] || /^\d+(?:\.\d+)?$/.test(args[2]) ? '' : 'invalid boost'),
      run: args => adjustTimer('setTimeout', args[0], args[1], args[2])
    },
    'adjust-setinterval': {
      aliases: ['nano-setinterval-booster', 'nano-sib'],
      validate: args => arityError(args, 0, 3) ||
        needleError(args[0]) ||
        (!args[1] || args[1] === '*' || /^\d+$/.test(args[1]) ? '' : 'invalid delay') ||
        (!args[2] || /^\d+(?:\.\d+)?$/.test(args[2]) ? '' : 'invalid boost'),
      run: args => adjustTimer('setInterval', args[0], args[1], args[2])
    },
    'prevent-refresh': {
      aliases: ['refresh-defuser'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const matcher = compileNeedle(args[0]).matcher;
        const ref = resolvePath('location.reload', false);
        if (ref && typeof ref.target[ref.key] === 'function') {
          define(ref.target, ref.key, {
            value: function () {
              if (matcher(safeText(arguments[0]))) return undefined;
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        }
      }
    },
    'prevent-requestanimationframe': {
      aliases: ['no-requestanimationframe-if', 'norafif'],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const original = global.requestAnimationFrame;
        if (typeof original !== 'function') return;
        const matcher = compileNeedle(args[0]).matcher;
        define(global, 'requestAnimationFrame', {
          value: function (callback) {
            if (matcher(safeText(callback))) return 0;
            return original.apply(global, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'nowebrtc': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => define(global, 'RTCPeerConnection', {
        value: undefined, writable: false, enumerable: false
      })
    },
    'webrtc-if': {
      aliases: [],
      validate: args => arityError(args, 1, 2) || needleError(args[0]),
      run: args => {
        const host = String(global.location && global.location.hostname || '');
        if (compileNeedle(args[0]).matcher(host)) {
          define(global, 'RTCPeerConnection', {
            value: undefined, writable: false, enumerable: false
          });
        }
      }
    },
    'no-floc': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        if (global.document && typeof global.document === 'object') {
          define(global.document, 'interestCohort', {
            value: undefined, writable: false, enumerable: false
          });
        }
      }
    },
    'alert-buster': {
      aliases: [],
      validate: args => arityError(args, 0, 1) || needleError(args[0]),
      run: args => {
        const matcher = args[0] ? compileNeedle(args[0]).matcher : () => false;
        ['alert', 'confirm', 'prompt'].forEach(name => {
          if (typeof global[name] !== 'function') return;
          define(global, name, {
            value: function (message) {
              if (!matcher(safeText(message))) {
                return name === 'prompt' ? '' : true;
              }
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        });
      }
    },
    'prevent-dialog': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        const proto = global.HTMLDialogElement && global.HTMLDialogElement.prototype;
        if (!proto) return;
        ['show', 'showModal'].forEach(name => {
          if (typeof proto[name] !== 'function') return;
          define(proto, name, {
            value: function () { return undefined; }, writable: true, enumerable: false
          });
        });
      }
    },
    'overlay-buster': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => injectStyle('[style*="position: fixed"],[style*="position:fixed"],' +
        '[style*="z-index: 999"],[style*="z-index:999"]{' +
        'display:none!important;pointer-events:none!important}')
    },
    'spoof-css': {
      aliases: [],
      validate: args => arityError(args, 0, 2),
      run: args => {
        const css = global.CSS;
        if (!css || typeof css.supports !== 'function') return;
        const property = String(args[0] || '').toLowerCase();
        const value = String(args[1] || '').toLowerCase();
        const original = css.supports.bind(css);
        define(css, 'supports', {
          value: function (name, candidate) {
            if (String(name).toLowerCase() === property &&
              String(candidate).toLowerCase() === value) return true;
            return original.apply(css, arguments);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-canvas': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => {
        const proto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
        if (!proto || typeof proto.toDataURL !== 'function') return;
        define(proto, 'toDataURL', {
          value: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIDBA==',
          writable: true,
          enumerable: false
        });
      }
    },
    'json-prune': {
      aliases: [],
      validate: args => arityError(args, 0, 3) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2]),
      run: args => {
        const original = global.JSON && global.JSON.parse;
        if (typeof original !== 'function') return;
        define(global.JSON, 'parse', {
          value: function (text) {
            const result = original.apply(global.JSON, arguments);
            return pruneJson(result, args[0], args[1]);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'evaldata-prune': {
      aliases: [],
      validate: args => arityError(args, 0, 3) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || needleError(args[2]),
      run: args => {
        const original = global.eval;
        if (typeof original !== 'function') return;
        define(global, 'eval', {
          value: function (source) {
            if (typeof source !== 'string') return original.apply(global, arguments);
            try {
              const parsed = global.JSON.parse(source);
              pruneJson(parsed, args[0], args[1]);
              return parsed;
            } catch (error) {
              return original.apply(global, arguments);
            }
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-fetch': {
      aliases: ['no-fetch-if'],
      validate: args => arityError(args, 0, 3) || lengthError(args[0]) ||
        (/^(?:true|emptyObj|emptyArr|emptyStr|length:\d+(?:-\d+)?|\[[^\]]+\])?$/
          .test(args[1] || '') ? '' : 'invalid fetch directive') ||
        fetchConfigError(args[2]),
      run: args => {
        const original = global.fetch;
        if (typeof original !== 'function') return;
        const matches = conditionMatcher(args[0]);
        const directive = args[1];
        const config = parseFetchConfig(args[2]).config;
        define(global, 'fetch', {
          value: function (url, init) {
            if (!matches(safeText(url), init)) return original.apply(global, arguments);
            return Promise.resolve(fakeResponse(responseDirective(directive), config));
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'prevent-xhr': {
      aliases: ['no-xhr-if'],
      validate: args => arityError(args, 0, 2) || lengthError(args[0]),
      run: args => {
        const proto = global.XMLHttpRequest && global.XMLHttpRequest.prototype;
        if (!proto || typeof proto.open !== 'function') return;
        const originalOpen = proto.open;
        const originalSend = proto.send;
        const matches = conditionMatcher(args[0]);
        const blocked = new WeakSet();
        define(proto, 'open', {
          value: function (method, url) {
            if (matches(safeText(url))) blocked.add(this);
            else blocked.delete(this);
            return originalOpen.apply(this, arguments);
          },
          writable: true,
          enumerable: false
        });
        if (typeof originalSend === 'function') {
          define(proto, 'send', {
            value: function () {
              if (!blocked.has(this)) return originalSend.apply(this, arguments);
              return undefined;
            },
            writable: true,
            enumerable: false
          });
        }
      }
    },
    'nobab': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['BlockAdblock', 'blockAdBlock', 'blockadblock'])
    },
    'nobab2': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['BlockAdblock', 'blockAdBlock', 'baidustatic'])
    },
    'nofab': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => defuseDetector(['FuckAdblock', 'fuckAdBlock', 'FAB'])
    },
    'fingerprint2': {
      aliases: ['fingerprintjs2'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['Fingerprint2', 'FingerprintJS2'], ['get', 'getPromise', 'getWithPromiseCallback'])
    },
    'fingerprint3': {
      aliases: ['fingerprintjs3'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['FingerprintJS', 'Fingerprint3'], ['load', 'get'])
    },
    'prebid-ads': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['pbjs', 'pbjsInstance'], ['init', 'requestBids', 'setConfig'])
    },
    'popads': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['PopAds', 'popads'], ['load', 'init'])
    },
    'ampproject-v0': {
      aliases: ['ampproject_v0'],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['AMP'], ['registerService', 'push'])
    },
    'json-prune-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 0, 5) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || optionalLengthError(args[2]) || needleError(args[3]),
      run: args => installResponseTransformer(value => {
        const stack = namedArg(args, 'stackToMatch') || args[3];
        return stackAllows(stack) ? pruneJson(value, args[0], args[1]) : value;
      }, namedArg(args, 'propsToMatch') || args[2], 'json', 'fetch')
    },
    'json-prune-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 0, 5) || prunePathsError(args[0] || '') ||
        prunePathsError(args[1] || '') || optionalLengthError(args[2]) || needleError(args[3]),
      run: args => installResponseTransformer(value => {
        const stack = namedArg(args, 'stackToMatch') || args[3];
        return stackAllows(stack) ? pruneJson(value, args[0], args[1]) : value;
      }, namedArg(args, 'propsToMatch') || args[2], 'json', 'xhr')
    },
    'xml-prune': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || lengthError(args[0], 500) ||
        (/[<>;{}]/.test(args[0]) ? 'invalid XML selector' : '') ||
        optionalLengthError(args[1], 500) || optionalLengthError(args[2]),
      run: args => installResponseTransformer(
        (value, text) => pruneXmlText(text, args[0], args[1]), args[2], 'text', 'both')
    },
    'm3u-prune': {
      aliases: [],
      validate: args => arityError(args, 1, 2) ||
        (compileReplaceRegex(args[0]) ? '' : 'invalid M3U needle') || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneM3uText(text, args[0]), args[1], 'text', 'both')
    },
    'popads-dummy': {
      aliases: [],
      validate: args => arityError(args, 0, 0),
      run: () => stubObject(['PopAds', 'popads'], ['load', 'init', 'get'])
    },
    'json-edit': {
      aliases: [],
      validate: args => arityError(args, 1, 1) || jsonPathError(args[0]),
      run: args => {
        const original = global.JSON && global.JSON.parse;
        if (typeof original !== 'function') return;
        redefine(global.JSON, 'parse', {
          value: function (text) {
            return editObject(original.apply(global.JSON, arguments), args[0]);
          },
          writable: true,
          enumerable: false
        });
      }
    },
    'json-edit-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'json', 'fetch')
    },
    'json-edit-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'json', 'xhr')
    },
    'json-edit-fetch-request': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installRequestTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'fetch')
    },
    'json-edit-xhr-request': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installRequestTransformer(
        (value, text) => editObject(value, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'xhr')
    },
    'jsonl-edit-fetch-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneJsonlText(text, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'text', 'fetch')
    },
    'jsonl-edit-xhr-response': {
      aliases: [],
      validate: args => arityError(args, 1, 3) || jsonPathError(args[0]) || optionalLengthError(args[1]),
      run: args => installResponseTransformer(
        (value, text) => pruneJsonlText(text, args[0]),
        namedArg(args, 'propsToMatch') || args[1], 'text', 'xhr')
    },
    'edit-outbound-object': {
      aliases: [],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) || jsonPathError(args[1]),
      run: args => installObjectEdit(args[0], args[1], 'outbound', 0)
    },
    'edit-inbound-object': {
      aliases: [],
      validate: args => arityError(args, 3, 3) || propertyError(args[0]) ||
        (/^-?\d+$/.test(args[1]) ? '' : 'invalid argument position') || jsonPathError(args[2]),
      run: args => installObjectEdit(args[0], args[2], 'inbound', Number(args[1]))
    },
    'edit-this-object': {
      aliases: [],
      validate: args => arityError(args, 2, 2) || propertyError(args[0]) || jsonPathError(args[1]),
      run: args => installObjectEdit(args[0], args[1], 'this', 0)
    },
    'edit-element-object': {
      aliases: [],
      validate: args => arityError(args, 2, 3) || lengthError(args[0], 500) ||
        jsonPathError(args[1]),
      run: args => onDom(args[0], element => editObject(element, args[1]))
    }
  });

  Object.assign(NS, { DEFINITIONS });
})(this);

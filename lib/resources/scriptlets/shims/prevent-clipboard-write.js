/* WildFire scriptlet shim: prevent-clipboard-write.
 * Classic-script module; loaded after registries and before the public API.
 * The needle and alert message are bounded data, never script text. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};

  function preventClipboardWrite(needle, alertMessage) {
    const nav = global.navigator;
    const clipboard = nav && nav.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return;
    const compiled = NS.compileNeedle(needle);
    if (compiled.error) return;
    const original = clipboard.writeText;
    NS.redefine(clipboard, 'writeText', {
      value: function (text) {
        if (!needle || compiled.matcher(NS.safeText(text))) {
          if (alertMessage && typeof global.alert === 'function') {
            try { global.alert(String(alertMessage)); } catch (error) { /* ignore */ }
          }
          return global.Promise && typeof global.Promise.resolve === 'function'
            ? global.Promise.resolve() : undefined;
        }
        return original.apply(this, arguments);
      },
      writable: true,
      enumerable: false
    });
  }

  NS.DEFINITIONS['prevent-clipboard-write'] = {
    aliases: [],
    validate: args => NS.arityError(args, 0, 2) ||
      NS.optionalLengthError(args[0], 512) || NS.optionalLengthError(args[1], 200),
    run: args => preventClipboardWrite(args[0], args[1])
  };

  Object.assign(NS, { preventClipboardWrite });
})(this);

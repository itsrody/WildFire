/* WildFire scriptlet shim: replace-node-text for uBO and AdGuard syntax.
 * Classic-script module; loaded after registries and before the public API.
 * Replacement text is literal data and never becomes executable page code. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const TOKENS = ['includes', 'condition', 'excludes', 'sedcount', 'stay',
    'quitafter', 'log'];

  function hasReplacement(args) {
    return args.length > 2 && !TOKENS.includes(String(args[2]).toLowerCase());
  }

  // Needle safety is inherited from compileNeedle. `$` sequences in the
  // replacement are never regex substitution directives.
  function replaceNeedleText(text, needle, replacement) {
    const raw = String(needle == null ? '' : needle);
    const source = String(text == null ? '' : text);
    const value = String(replacement == null ? '' : replacement);
    if (!raw || NS.compileNeedle(raw).error) return source;
    const lastSlash = raw.lastIndexOf('/');
    if (raw.startsWith('/') && lastSlash > 0) {
      const regex = new RegExp(raw.slice(1, lastSlash), raw.slice(lastSlash + 1));
      return source.replace(regex, () => value);
    }
    const lower = raw.toLowerCase();
    const index = source.toLowerCase().indexOf(lower);
    if (index < 0) return source;
    return source.slice(0, index) + value + source.slice(index + raw.length);
  }

  function replaceNodeText(selector, needle, replacement, optionArgs) {
    const parsed = NS.parseNodeTextOptions(optionArgs);
    if (parsed.error) return;
    NS.transformNodeText(selector, needle, parsed.options,
      text => replaceNeedleText(text, needle, replacement));
  }

  NS.DEFINITIONS['replace-node-text'] = {
    aliases: ['rpnt'],
    validate: args => {
      const count = NS.arityError(args, 2, 13);
      if (count) return count;
      const optionsAt = hasReplacement(args) ? 3 : 2;
      return NS.lengthError(String(args[0]), 500) || NS.needleError(args[1]) ||
        (hasReplacement ? NS.lengthError(String(args[2]), 500) : '') ||
        NS.nodeTextOptionsError(args.slice(optionsAt));
    },
    run: args => hasReplacement(args)
      ? replaceNodeText(args[0], args[1], args[2], args.slice(3))
      : replaceNodeText(args[0], args[1], '', args.slice(2))
  };

  NS.ADGUARD_DEFINITIONS['replace-node-text'] = NS.adguardOwn('replace-node-text',
    args => NS.arityError(args, 2, 13) || NS.lengthError(args[0], 500) ||
      NS.needleError(args[1]) || NS.optionalLengthError(args[2], 500) ||
      NS.nodeTextOptionsError(args.slice(3)),
    args => replaceNodeText(args[0], args[1], args[2] || '', args.slice(3)));

  Object.assign(NS, { replaceNeedleText, replaceNodeText });
})(this);

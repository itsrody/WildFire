/* WildFire scriptlet shim: AdGuard literal needles for M3U pruning. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const {
    arityError, compileNeedle, needleError, optionalLengthError,
    installResponseTransformer
  } = NS;

  function pruneM3u(text, needle) {
    const lines = String(text == null ? '' : text).split('\n');
    const matcher = compileNeedle(needle).matcher;
    const removed = new Set();
    lines.forEach((line, index) => {
      if (!matcher(line)) return;
      removed.add(index);
      Array.from({ length: index }, (_, offset) => index - 1 - offset)
        .every(previous => {
          if (!lines[previous].trim().startsWith('#')) return false;
          removed.add(previous);
          return true;
        });
    });
    return lines.filter((line, index) => !removed.has(index)).join('\n');
  }

  NS.ADGUARD_DEFINITIONS['m3u-prune'] = NS.adguardOwn(
    'm3u-prune',
    args => arityError(args, 1, 3) || needleError(args[0]) ||
      optionalLengthError(args[1], 512) ||
      (args[2] === undefined ? '' : 'verbose M3U pruning is not allowed in production filters'),
    args => installResponseTransformer(
      (value, text) => pruneM3u(text, args[0]), args[1], 'text', 'both'));
})(this);

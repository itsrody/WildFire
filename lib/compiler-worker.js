/* WildFire filter compiler worker. Compiles filter text to versioned data. */
'use strict';

self.importScripts('filter-engine.js', 'scriptlets.js');

self.onmessage = event => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    if (msg.type !== 'compile') throw new Error('unknown message');
    const engine = new FilterEngine(
      null,
      alias => '',
      (self.WildFireScriptlets && typeof self.WildFireScriptlets.validate === 'function')
        ? self.WildFireScriptlets
        : null,
      () => false
    );
    engine.load(String(msg.text || ''));
    const compiled = engine.toCompiled();
    self.postMessage({
      id,
      ok: true,
      compiled,
      counts: engine.counts,
      rejected: {
        regex: engine.rejectedRegex.length,
        csp: engine.rejectedCsp.length,
        rewrite: engine.rejectedRewrite.length,
        scriptlets: engine.rejectedScriptlets.length,
        cosmetic: engine.rejectedCosmetic.length
      }
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
};

/* WildFire filter compiler worker. Compiles filter text to versioned data. */
'use strict';

self.importScripts('filter-engine.js', 'scriptlets.js', 'csp-resources.js', 'rewrite-resources.js');

self.onmessage = event => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    if (msg.type !== 'compile') throw new Error('unknown message');
    const csp = self.CspResources;
    const rewrite = self.RewriteResources;
    const scriptlets = self.WildFireScriptlets;
    const engine = new FilterEngine(
      null,
      alias => (csp && typeof csp.resolve === 'function') ? csp.resolve(alias) : '',
      (scriptlets && typeof scriptlets.validate === 'function') ? scriptlets : null,
      alias => (rewrite && typeof rewrite.hasAlias === 'function') ? rewrite.hasAlias(alias) : false
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

/* WildFire filter compiler worker. Event-driven compile responses only. */
'use strict';

self.importScripts('filter-engine.js', 'scriptlets.js', 'csp-resources.js', 'rewrite-resources.js');

function compile(text) {
  const csp = self.CspResources;
  const rewrite = self.RewriteResources;
  const scriptlets = self.WildFireScriptlets;
  const engine = new FilterEngine(
    null,
    alias => (csp && typeof csp.resolve === 'function') ? csp.resolve(alias) : '',
    (scriptlets && typeof scriptlets.validate === 'function') ? scriptlets : null,
    alias => (rewrite && typeof rewrite.hasAlias === 'function') ? rewrite.hasAlias(alias) : false
  );
  engine.load(String(text || ''));
  return {
    compiled: engine.toCompiled(),
    counts: engine.counts,
    rejected: {
      regex: engine.rejectedRegex.length,
      csp: engine.rejectedCsp.length,
      rewrite: engine.rejectedRewrite.length,
      scriptlets: engine.rejectedScriptlets.length,
      cosmetic: engine.rejectedCosmetic.length
    }
  };
}

self.onmessage = event => {
  const msg = event.data || {};
  const id = msg.id;
  if (msg.type !== 'compile') {
    self.postMessage({ id, ok: false, error: 'unknown message' });
    return;
  }
  try {
    const result = compile(msg.text);
    self.postMessage(Object.assign({ id, ok: true }, result));
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
};

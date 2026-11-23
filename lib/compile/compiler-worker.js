/* WildFire filter compiler worker. Event-driven compile responses only. */
'use strict';

self.importScripts(
  '../engine/filter/constants.js',
  '../engine/filter/utils.js',
  '../engine/filter/pattern.js',
  '../engine/filter/parse-network.js',
  '../engine/filter/parse-procedural.js',
  '../engine/filter/parse-scriptlet.js',
  '../engine/filter/parse-cosmetic.js',
  '../engine/filter/engine.js',
  '../engine/filter/engine-compiled.js',
  '../engine/filter/engine-match.js',
  '../engine/filter/engine-cosmetic.js',
  '../resources/scriptlets/core.js',
  '../resources/scriptlets/runtime.js',
  '../resources/scriptlets/transforms.js',
  '../resources/scriptlets/adguard-helpers.js',
  '../resources/scriptlets/definitions.js',
  '../resources/scriptlets/adguard-definitions.js',
  '../resources/scriptlets/api.js',
  '../resources/csp-resources.js',
  '../resources/rewrite-resources.js'
);

function compile(text) {
  const csp = self.CspResources;
  const rewrite = self.RewriteResources;
  const scriptlets = self.WildFireScriptlets;
  const engine = new FilterEngine(
    null,
    alias => (csp && typeof csp.resolve === 'function') ? csp.resolve(alias) : '',
    (scriptlets && typeof scriptlets.validate === 'function') ? scriptlets : null,
    alias => (rewrite && typeof rewrite.hasAlias === 'function') ? rewrite.hasAlias(alias) : false,
    alias => (rewrite && typeof rewrite.hasCaptureAlias === 'function') ? rewrite.hasCaptureAlias(alias) : false
  );
  engine.load(String(text || ''));
  return {
    compiled: engine.toCompiled(),
    counts: engine.counts,
    capabilities: engine.capabilities,
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
  if (msg.type === 'ping') {
    self.postMessage({ id, ok: true, type: 'pong' });
    return;
  }
  if (msg.type !== 'compile') {
    self.postMessage({ id, ok: false, error: 'unknown message' });
    return;
  }
  try {
    const result = compile(msg.text);
    self.postMessage(Object.assign({ id, ok: true, type: 'compiled' }, result));
  } catch (error) {
    self.postMessage({ id, ok: false, type: 'error', error: String(error && error.message || error) });
  }
};

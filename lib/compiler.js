/* WildFire dynamic compile engine: worker-backed with sync fallback. */
(function (global) {
  'use strict';

  function compileSync(text) {
    const csp = global.CspResources;
    const rewrite = global.RewriteResources;
    const scriptlets = global.WildFireScriptlets;
    const engine = new FilterEngine(
      null,
      alias => (csp && typeof csp.resolve === 'function') ? csp.resolve(alias) : '',
      (scriptlets && typeof scriptlets.validate === 'function') ? scriptlets : null,
      alias => (rewrite && typeof rewrite.hasAlias === 'function') ? rewrite.hasAlias(alias) : false
    );
    engine.load(String(text || ''));
    return { compiled: engine.toCompiled(), counts: engine.counts };
  }

  function create(options) {
    const browserApi = options && options.browserApi || global.browser;
    const timeoutMs = (options && options.timeoutMs) || 15000;
    let worker = null;
    let seq = 0;
    const pending = new Map();

    function failPending(error) {
      pending.forEach(entry => entry.reject(error));
      pending.clear();
    }

    function ensureWorker() {
      if (worker || typeof Worker === 'undefined' || !browserApi || !browserApi.runtime) return worker;
      try {
        worker = new Worker(browserApi.runtime.getURL('lib/compiler-worker.js'));
        worker.onmessage = event => {
          const msg = event.data || {};
          const entry = pending.get(msg.id);
          if (!entry) return;
          pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.ok) entry.resolve(msg);
          else entry.reject(new Error(msg.error || 'compile failed'));
        };
        worker.onerror = error => {
          const err = new Error(error && error.message || 'compiler worker error');
          failPending(err);
          try { worker.terminate(); } catch (ignored) {}
          worker = null;
        };
      } catch (error) {
        worker = null;
      }
      return worker;
    }

    async function compile(text) {
      const source = String(text || '');
      if (!source.trim()) {
        return { compiled: { v: FilterEngine.COMPILED_VERSION, n: [], c: { g: [], ge: [], d: [], de: [] }, p: { g: [], ge: [], d: [], de: [] }, s: [] }, counts: null };
      }
      const w = ensureWorker();
      if (!w) return compileSync(source);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          try { w.terminate(); } catch (ignored) {}
          worker = null;
          reject(new Error('compile timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          w.postMessage({ type: 'compile', id, text: source });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      }).catch(() => compileSync(source));
    }

    function destroy() {
      failPending(new Error('compiler destroyed'));
      if (worker) try { worker.terminate(); } catch (ignored) {}
      worker = null;
    }

    return { compile, compileSync, destroy };
  }

  global.WildFireCompiler = { create, compileSync };
})(this);

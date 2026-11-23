/* WildFire dynamic compile engine: event-driven worker with sync fallback. */
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
      alias => (rewrite && typeof rewrite.hasAlias === 'function') ? rewrite.hasAlias(alias) : false,
      alias => (rewrite && typeof rewrite.hasCaptureAlias === 'function') ? rewrite.hasCaptureAlias(alias) : false
    );
    engine.load(String(text || ''));
    return { compiled: engine.toCompiled(), counts: engine.counts, capabilities: engine.capabilities };
  }

  function emptyCompiled() {
    return { v: FilterEngine.COMPILED_VERSION, cap: 0, n: [], c: { g: [], ge: [], d: [], de: [] }, p: { g: [], ge: [], d: [], de: [] }, s: [], d: [] };
  }

  function create(options) {
    const browserApi = options && options.browserApi || global.browser;
    const schedule = options && options.setTimeout || global.setTimeout;
    const unschedule = options && options.clearTimeout || global.clearTimeout;
    const timeoutMs = options && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs) : 0;
    let worker = null;
    let seq = 0;
    let queue = Promise.resolve();
    const pending = new Map();
    const timers = new Map();
    const listeners = new Set();

    function emit(event) {
      listeners.forEach(fn => {
        try { fn(event); } catch (ignored) {}
      });
    }

    function clearTimer(id) {
      const timer = timers.get(id);
      if (timer && typeof unschedule === 'function') unschedule(timer);
      timers.delete(id);
    }

    function armTimeout(id, onTimeout) {
      if (!timeoutMs || typeof schedule !== 'function') return;
      timers.set(id, schedule(() => {
        timers.delete(id);
        onTimeout();
      }, timeoutMs));
    }

    function failPending(error) {
      timers.forEach((timer, id) => clearTimer(id));
      pending.forEach(entry => entry.reject(error));
      pending.clear();
    }

    function disposeWorker(error) {
      if (worker) {
        try { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); } catch (ignored) {}
      }
      worker = null;
      if (error) failPending(error);
    }

    function cancel(id) {
      const entry = pending.get(id);
      if (!entry) return false;
      pending.delete(id);
      clearTimer(id);
      const err = new Error('compile cancelled');
      err.code = 'CANCELLED';
      entry.reject(err);
      emit({ type: 'cancelled', id });
      return true;
    }

    function cancelAll(reason) {
      const err = new Error(reason || 'compile cancelled');
      err.code = 'CANCELLED';
      failPending(err);
    }

    function ensureWorker() {
      const WorkerCtor = (options && options.Worker) || global.Worker;
      if (worker || typeof WorkerCtor === 'undefined' || !browserApi || !browserApi.runtime) return worker;
      try {
        worker = new WorkerCtor(browserApi.runtime.getURL('lib/compile/compiler-worker.js'));
        worker.onmessage = event => {
          const msg = event.data || {};
          const entry = pending.get(msg.id);
          if (!entry) return;
          pending.delete(msg.id);
          clearTimer(msg.id);
          if (msg.ok) {
            entry.resolve(msg);
            emit({ type: msg.type || 'compiled', id: msg.id, counts: msg.counts, rejected: msg.rejected });
          } else {
            const error = new Error(msg.error || 'compile failed');
            entry.reject(error);
            emit({ type: 'error', id: msg.id, error });
          }
        };
        worker.onerror = error => {
          const err = new Error(error && error.message || 'compiler worker error');
          emit({ type: 'worker-error', error: err });
          disposeWorker(err);
        };
        worker.onmessageerror = () => {
          const err = new Error('compiler worker message error');
          emit({ type: 'worker-error', error: err });
          disposeWorker(err);
        };
      } catch (error) {
        worker = null;
        emit({ type: 'worker-unavailable', error });
      }
      return worker;
    }

    function requestCompile(source) {
      const w = ensureWorker();
      if (!w) return Promise.resolve(Object.assign({ id: 0 }, compileSync(source)));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, text: source });
        try {
          w.postMessage({ type: 'compile', id, text: source });
          armTimeout(id, () => {
            if (!pending.has(id)) return;
            pending.delete(id);
            const error = new Error('compile worker timeout');
            error.code = 'TIMEOUT';
            emit({ type: 'worker-timeout', id, error });
            disposeWorker(error);
            reject(error);
          });
        } catch (error) {
          pending.delete(id);
          disposeWorker(error);
          reject(error);
        }
      });
    }

    function compile(text) {
      const source = String(text || '');
      if (!source.trim()) return Promise.resolve({ compiled: emptyCompiled(), counts: null, id: 0 });

      const run = queue.then(async () => {
        if (pending.size > 0) {
          emit({ type: 'stale-restart', pending: pending.size });
          restart('stale pending compile');
        }
        try {
          return await requestCompile(source);
        } catch (error) {
          if (error && error.code === 'CANCELLED' || error && error.code === 'DESTROYED') throw error;
          emit({ type: 'fallback', error });
          return Object.assign({ id: 0 }, compileSync(source));
        }
      });
      // Keep queue alive even after failures/cancellations.
      queue = run.then(() => undefined, () => undefined);
      return run;
    }

    function on(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function ping() {
      const w = ensureWorker();
      if (!w) return Promise.resolve(false);
      const id = ++seq;
      return new Promise(resolve => {
        pending.set(id, {
          resolve: () => resolve(true),
          reject: () => resolve(false),
          text: ''
        });
        try {
          w.postMessage({ type: 'ping', id });
          armTimeout(id, () => {
            if (!pending.has(id)) return;
            pending.delete(id);
            const error = new Error('compiler ping timeout');
            error.code = 'TIMEOUT';
            emit({ type: 'worker-timeout', id, error });
            disposeWorker(error);
            resolve(false);
          });
        } catch (error) {
          pending.delete(id);
          disposeWorker(error);
          resolve(false);
        }
      });
    }

    function restart(reason) {
      const err = new Error(reason || 'compiler worker restarted');
      emit({ type: 'restart', error: err });
      disposeWorker(err);
      return ensureWorker();
    }

    function destroy() {
      listeners.clear();
      const err = new Error('compiler destroyed');
      err.code = 'DESTROYED';
      disposeWorker(err);
      queue = Promise.resolve();
    }

    return { compile, compileSync, on, ping, cancel, cancelAll, restart, destroy, pendingCount: () => pending.size };
  }

  global.WildFireCompiler = { create, compileSync };
})(this);

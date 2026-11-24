/* WildFire - engine lifecycle, compilation and capability helpers. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const SCRIPTLET_FILES = [
    'lib/resources/scriptlets/core.js',
    'lib/resources/scriptlets/runtime.js',
    'lib/resources/scriptlets/transforms.js',
    'lib/resources/scriptlets/adguard-helpers.js',
    'lib/resources/scriptlets/definitions.js',
    'lib/resources/scriptlets/adguard-definitions.js',
    'lib/resources/scriptlets/api.js'
  ];
  const REALM_BIRTH_ALIASES = new Set(['set-constant']);

  // Bounded, generation-keyed cache for per-host cosmetic payloads. Many
  // frames on one host share the same selectors, trees and hide policy, so
  // recomputing them per frame is pure background work.
  function createCosmeticPayloadCache(limit) {
    const max = Math.max(1, Number(limit) || 128);
    let entries = new Map();
    let generation = 0;
    return {
      setGeneration(value) {
        const next = Number(value) || 0;
        if (next === generation) return;
        generation = next;
        entries = new Map();
      },
      clear() {
        entries = new Map();
      },
      get(key) {
        const entry = entries.get(key);
        return entry && entry.generation === generation ? entry.payload : null;
      },
      set(key, payload) {
        entries.delete(key);
        entries.set(key, { generation, payload });
        const excess = entries.size - max;
        if (excess > 0) {
          Array.from(entries.keys()).slice(0, excess)
            .forEach(oldest => entries.delete(oldest));
        }
        return payload;
      }
    };
  }

  core.createCosmeticPayloadCache = createCosmeticPayloadCache;

  core.createEngineHost = function createEngineHost(ctx) {
    const globals = ctx.globals;
    const cosmeticCache = createCosmeticPayloadCache();

    function engineHealth() {
      const counts = ctx.engine.counts || {};
      const total = Object.keys(counts).reduce((sum, key) => {
        const value = Number(counts[key]);
        return sum + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0);
      return {
        ok: total > 0,
        total,
        counts: Object.assign({}, counts),
        capabilities: ctx.engine.capabilities || 0
      };
    }

    function validateFilters(value) {
      const source = String(value == null ? '' : value);
      if (source.length > 1000000) {
        return { ok: false, error: 'Filter text is too large to validate.' };
      }
      const engine = ctx.createFilterEngine();
      engine.load(source);
      const lines = source.split(/\r?\n/);
      const groups = [
        ['network', engine.rejectedRegex],
        ['csp', engine.rejectedCsp],
        ['rewrite', engine.rejectedRewrite],
        ['scriptlet', engine.rejectedScriptlets],
        ['cosmetic', engine.rejectedCosmetic]
      ];
      const issues = groups.flatMap(([category, entries]) =>
        (Array.isArray(entries) ? entries : []).map(entry => {
          const text = String(entry.line || '');
          const lineNumber = Number(entry.lineNumber) || lines.indexOf(text) + 1 || 0;
          return {
            line: lineNumber,
            category,
            text,
            reason: String(entry.reason || 'invalid rule')
          };
        })).sort((left, right) => left.line - right.line);
      return {
        ok: true,
        validation: {
          valid: issues.length === 0,
          counts: Object.assign({}, engine.counts),
          issues
        }
      };
    }

    function normalizeScriptletRule(rule) {
      const syntax = rule.syntax === 'adguard' ? 'adguard' : 'ubo';
      const alias = globals.WildFireScriptlets.canonical(rule.alias, syntax);
      return {
        alias,
        syntax,
        args: Array.isArray(rule.args) ? rule.args.slice() : [],
        domains: Array.isArray(rule.domains) ? rule.domains.slice() : [],
        isException: !!rule.isException
      };
    }

    function splitScriptletPayload(rules) {
      const payload = { realmBirth: [], documentStart: [] };
      rules.forEach(rule => {
        const normalized = normalizeScriptletRule(rule);
        if (!normalized.isException && REALM_BIRTH_ALIASES.has(normalized.alias)) {
          payload.realmBirth.push(normalized);
        } else {
          payload.documentStart.push(normalized);
        }
      });
      return payload;
    }

    function scriptletHash(rules) {
      return String(rules.length) + ':' + rules.map(rule => [
        rule.alias,
        rule.syntax || 'ubo',
        rule.isException ? '1' : '0',
        (rule.domains || []).join(','),
        (rule.args || []).join('\u001f')
      ].join('\u001e')).join('\u001d');
    }
    core.scriptletHash = scriptletHash;

    function normalizeStoredScriptletEntry(entry) {
      if (!entry || typeof entry !== 'object') return null;
      const syntax = entry.syntax === 'adguard' ? 'adguard' : 'ubo';
      const alias = globals.WildFireScriptlets.canonical(entry.alias, syntax);
      const args = Array.isArray(entry.args) ? entry.args.slice(0, 16) : [];
      const domains = Array.isArray(entry.domains) ? entry.domains.slice(0, 128) : [];
      if (args.length !== (Array.isArray(entry.args) ? entry.args.length : -1) ||
          domains.length !== (Array.isArray(entry.domains) ? entry.domains.length : -1)) return null;
      if (!args.every(arg => typeof arg === 'string' && arg.length <= 512)) return null;
      if (!domains.every(domain => typeof domain === 'string' && domain.length <= 253)) return null;
      if (globals.WildFireScriptlets.validate(alias, args, syntax)) return null;
      return { alias, syntax, args, domains, isException: Boolean(entry.isException) };
    }

    function normalizeStoredScriptletPhases(phases) {
      if (!phases || typeof phases !== 'object') return null;
      if (!Array.isArray(phases.realmBirth) || !Array.isArray(phases.documentStart)) return null;
      if (phases.realmBirth.length + phases.documentStart.length > 4096) return null;
      const normalizePhase = phase => phase.map(normalizeStoredScriptletEntry);
      const realmBirth = normalizePhase(phases.realmBirth);
      const documentStart = normalizePhase(phases.documentStart);
      if (realmBirth.some(entry => !entry) || documentStart.some(entry => !entry)) return null;
      return { realmBirth, documentStart };
    }

    function snapshotHash(payload) {
      return scriptletHash(payload.realmBirth.concat(payload.documentStart));
    }

    async function persistScriptletSnapshot(payload, generation) {
      if (!ctx.compileCache || typeof ctx.compileCache.setScriptlets !== 'function') return false;
      const phases = normalizeStoredScriptletPhases(payload);
      if (!phases) return false;
      const snapshot = {
        v: 1,
        engineVersion: globals.FilterEngine.COMPILED_VERSION,
        generation,
        hash: snapshotHash(phases),
        phases,
        at: Date.now()
      };
      try {
        await ctx.compileCache.setScriptlets(snapshot);
        return true;
      } catch (error) {
        console.warn('WildFire: scriptlet snapshot write failed', error);
        return false;
      }
    }

    async function restoreScriptlets() {
      if (!ctx.compileCache || typeof ctx.compileCache.getScriptlets !== 'function') return false;
      let snapshot;
      try {
        snapshot = await ctx.compileCache.getScriptlets();
      } catch (error) {
        console.warn('WildFire: scriptlet snapshot read failed', error);
        return false;
      }
      if (!snapshot || snapshot.engineVersion !== globals.FilterEngine.COMPILED_VERSION) return false;
      const phases = normalizeStoredScriptletPhases(snapshot.phases);
      if (!phases || snapshotHash(phases) !== snapshot.hash) return false;
      const generation = Math.max(ctx.scriptletGeneration, Number(snapshot.generation) || 0) + 1;
      ctx.scriptletGeneration = generation;
      return registerScriptletRegistration(phases, generation);
    }

    function nativeBridge() {
      return ctx.wapiCapabilities.nativeBridge();
    }

    async function syncNativeScriptlets(payload, generation) {
      const bridge = nativeBridge();
      if (!bridge) return false;
      try {
        if (!payload.realmBirth.length && !payload.documentStart.length) {
          if (typeof bridge.clearPayload === 'function') await bridge.clearPayload();
          return true;
        }
        await bridge.setPayload({
          version: 1,
          generation,
          hash: scriptletHash(payload.realmBirth.concat(payload.documentStart)),
          phases: payload
        });
        return true;
      } catch (error) {
        console.warn('WildFire: native scriptlet bridge failed', error);
        return false;
      }
    }

    function compileSyncSafe(text) {
      const compilerApi = globals.WildFireCompiler;
      if (!compilerApi || typeof compilerApi.compileSync !== 'function') return null;
      try {
        const compiled = compilerApi.compileSync(String(text || '')).compiled;
        ctx.compilerStatus.lastMode = 'sync';
        ctx.compilerStatus.lastError = '';
        return compiled;
      } catch (error) {
        ctx.compilerStatus.lastMode = 'sync-error';
        ctx.compilerStatus.lastError = String(error && error.message || error);
        console.warn('WildFire: sync compile failed', error);
        return null;
      }
    }

    function compileHashHint(source, meta) {
      const hash = meta && meta.hash;
      if (typeof hash !== 'string') return '';
      return /^(?:[0-9a-f]+(?::\d+)?)$/i.test(hash) ? hash : '';
    }

    function compileText(text, meta, generation, forceSync) {
      const source = String(text || '');
      if (!source.trim()) return Promise.resolve(null);
      const hashHint = compileHashHint(source, meta);
      const flightKey = ctx.compileCache && ctx.compileCache.keyFor
        ? ctx.compileCache.keyFor(source, hashHint)
        : globals.FilterEngine.COMPILED_VERSION + ':' + (hashHint || ctx.hashText(source));
      const existing = ctx.compileFlight.get(flightKey);
      if (existing) return existing;
      const task = compileTextOnce(source, meta, generation, forceSync, hashHint);
      ctx.compileFlight.set(flightKey, task);
      task.then(() => ctx.compileFlight.delete(flightKey), () => ctx.compileFlight.delete(flightKey));
      return task;
    }

    async function compileTextOnce(source, meta, generation, forceSync, hashHint) {
      if (ctx.compileCache) {
        try {
          const cached = await ctx.compileCache.get(source, hashHint);
          if (cached && cached.v === globals.FilterEngine.COMPILED_VERSION) {
            ctx.compilerStatus.lastMode = 'cache';
            ctx.compilerStatus.lastError = '';
            return cached;
          }
        } catch (error) {
          console.warn('WildFire: compile cache read failed', error);
        }
      }

      const isCurrent = generation === undefined || generation === ctx.activeFilterGeneration;
      if (!forceSync && ctx.compiler && typeof ctx.compiler.compile === 'function' && isCurrent) {
        if (ctx.compiler.pendingCount && ctx.compiler.pendingCount() > 0 && ctx.compiler.restart) {
          console.warn('WildFire: stale compile pending, restarting compiler worker');
          ctx.compiler.restart('stale filter generation');
          ctx.compilerStatus.lastMode = 'stale-sync-fallback';
          return compileSyncSafe(source);
        }
        try {
          const result = await ctx.compiler.compile(source);
          if (generation !== undefined && generation !== ctx.activeFilterGeneration) {
            ctx.compilerStatus.lastMode = 'stale-sync-fallback';
            return compileSyncSafe(source);
          }
          if (result && result.compiled) {
            ctx.compilerStatus.lastMode = 'worker';
            ctx.compilerStatus.lastError = '';
            if (typeof result.capabilities === 'number') {
              ctx.compilerStatus.capabilities = result.capabilities;
            }
            if (ctx.compileCache && result.compiled.v === globals.FilterEngine.COMPILED_VERSION) {
              ctx.compileCache.set(source, result.compiled, meta, hashHint).catch(error =>
                console.warn('WildFire: compile cache write failed', error));
            }
            return result.compiled;
          }
        } catch (error) {
          ctx.compilerStatus.lastMode = 'worker-fallback';
          ctx.compilerStatus.lastError = String(error && error.message || error);
          console.warn('WildFire: worker compile failed, using sync fallback', error);
        }
      }

      if (forceSync) ctx.compilerStatus.lastMode = 'forced-sync-fallback';
      const compiled = compileSyncSafe(source);
      if (ctx.compileCache && compiled && compiled.v === globals.FilterEngine.COMPILED_VERSION) {
        ctx.compileCache.set(source, compiled, meta, hashHint).catch(error =>
          console.warn('WildFire: compile cache write failed', error));
      }
      return compiled;
    }

    async function loadCompiledOrText(text, meta, append, generation, forceSync) {
      const source = String(text || '');
      if (!source.trim()) return false;
      const compiled = await compileText(source, meta, generation, forceSync);
      if (compiled && ctx.engine.loadCompiled(compiled, { append: Boolean(append) })) return true;
      if (append) ctx.engine.load(source, { append: true });
      else ctx.engine.load(source);
      return false;
    }

    async function warmRemoteCompile(result) {
      if (!result || !result.ok || !result.changed || !result.list || !result.list.text) return;
      try {
        await compileText(result.list.text, {
          source: 'remote',
          url: result.list.url,
          hash: result.list.hash || ctx.hashText(result.list.text)
        }, ctx.activeFilterGeneration);
      } catch (error) {
        console.warn('WildFire: remote compile warm failed', error);
      }
    }

    function remoteSignature(lists) {
      return lists.lists
        .filter(entry => entry.enabled && entry.text)
        .map(entry => entry.url + '\u001f' + (entry.hash || ctx.hashText(entry.text)))
        .sort()
        .join('\u001e');
    }

    async function loadBundled(generation, builtin) {
      if (builtin && builtin.enabled === false) return false;
      if (builtin && builtin.text) {
        const compiled = await compileText(builtin.text, {
          source: 'bundled',
          url: builtin.url,
          hash: builtin.hash || ctx.hashText(builtin.text)
        }, generation);
        if (!compiled || !ctx.engine.loadCompiled(compiled)) ctx.engine.load(builtin.text);
        return true;
      }
      let bundledLoaded = false;
      try {
        const response = await fetch(ctx.wapi.getURL('filters/default.compiled.json'));
        if (response.ok) {
          const compiled = await response.json();
          bundledLoaded = ctx.engine.loadCompiled(compiled);
        }
      } catch (error) {
        bundledLoaded = false;
      }
      if (bundledLoaded) return true;

      try {
        const response = await fetch(ctx.wapi.getURL('filters/default.txt'));
        if (response.ok) {
          const bundled = await response.text();
          const compiled = await compileText(bundled, { source: 'bundled' }, generation);
          if (!compiled || !ctx.engine.loadCompiled(compiled)) ctx.engine.load(bundled);
          return true;
        }
      } catch (error) {
        console.warn('WildFire: bundled filter list unavailable', error);
      }
      return false;
    }

    async function loadFilters(force) {
      const generation = ++ctx.filterGeneration;
      ctx.activeFilterGeneration = generation;
      if (ctx.compiler && ctx.compiler.pendingCount && ctx.compiler.pendingCount() > 0 && ctx.compiler.restart) {
        console.warn('WildFire: restarting compiler for new filter generation');
        ctx.compiler.restart('new filter generation');
      } else if (ctx.compiler && ctx.compiler.cancelAll) {
        ctx.compiler.cancelAll('new filter generation');
      }
      const run = ctx.filterLoad.then(async () => {
        if (generation !== ctx.activeFilterGeneration) return;

        const custom = String(ctx.state.customFilters || '').trim();
        const customHash = custom ? ctx.hashText(custom) : '';
        let remoteSig = '';
        let remoteEntries = [];
        let listState = { lists: [] };
        try {
          listState = await ctx.remoteLists.get();
          remoteSig = remoteSignature(listState);
          remoteEntries = listState.lists
            .filter(entry => entry.enabled && entry.text && !entry.builtin);
        } catch (error) {
          console.warn('WildFire: remote list state unavailable', error);
        }

        const customChanged = customHash !== ctx.lastCustomHash;
        const remoteChanged = remoteSig !== ctx.lastRemoteSignature;
        if (!force && !customChanged && !remoteChanged && ctx.ready) return;

        cosmeticCache.setGeneration(generation);
        ctx.engine.reset();
        await loadBundled(generation, listState.lists.find(entry => entry.builtin));

        const forceSync = ctx.compiler && ctx.compiler.pendingCount && ctx.compiler.pendingCount() > 0;

        // Compile only when custom rules changed, or on forced rebuild; unchanged uses cache.
        if (custom) {
          const shouldCompile = customChanged || force || !ctx.ready;
          const compiled = shouldCompile
            ? await compileText(custom, { source: 'custom', hash: customHash }, generation, forceSync)
            : (ctx.compileCache ? await ctx.compileCache.get(custom, customHash) : null);
          if (compiled && compiled.v === globals.FilterEngine.COMPILED_VERSION) {
            ctx.engine.loadCompiled(compiled, { append: true });
          } else if (shouldCompile) {
            const fresh = compiled || await compileText(custom, { source: 'custom', hash: customHash }, generation, forceSync);
            if (!fresh || !ctx.engine.loadCompiled(fresh, { append: true })) {
              ctx.engine.load(custom, { append: true });
            }
          } else {
            ctx.engine.load(custom, { append: true });
          }
        }

        // Per-list incremental remote compile/load. Only changed/missing lists are compiled.
        await remoteEntries.reduce((chain, entry) => chain.then(async () => {
          const text = '! wildfire remote: ' + entry.url + '\n' + entry.text;
          await loadCompiledOrText(text, {
            source: 'remote',
            url: entry.url,
            hash: ctx.hashText(text)
          }, true, generation, forceSync);
        }), Promise.resolve());

        if (generation !== ctx.activeFilterGeneration) return;
        ctx.lastCustomHash = customHash;
        ctx.lastRemoteSignature = remoteSig;
        ctx.compilerStatus.capabilities = ctx.engine.capabilities || 0;
        if (ctx.engine.setMatchStatsEnabled) ctx.engine.setMatchStatsEnabled(ctx.diagnostics.enabled);
        ctx.ensureHeadersListener();
        ctx.ensureRemoveHeaderListener();
        await syncScriptlets();
        await ctx.refreshAllCosmetic();
        await ctx.broadcastState();
      });
      ctx.filterLoad = run.catch(() => undefined);
      return run;
    }

    // Firefox registers this content script at document_start so countermeasure
    // code runs before page scripts. wapi-scripting owns the atomic swap: a failed
    // replacement keeps the previous working registration in place.
    async function registerScriptletRegistration(payload, generation) {
      const nativeReady = await syncNativeScriptlets(payload, generation);
      if (!ctx.wapiCapabilities.contentScripts.supported) return false;

      const rules = payload.realmBirth.concat(payload.documentStart);
      const fallbackRules = nativeReady ? payload.documentStart : rules;
      let details = null;
      if (fallbackRules.length) {
        const js = SCRIPTLET_FILES.map(file => ({ file }));
        const code = '(() => { const generation = ' + generation + '; ' +
          'if ((window.__wildfireScriptletGeneration || 0) >= generation) return; ' +
          'window.__wildfireScriptletGeneration = generation; ' +
          'const api = window.WildFireScriptlets; ' +
          'try { delete window.WildFireScriptlets; } catch (e) {} ' +
          'if (api && typeof api.apply === "function") api.apply(' +
          JSON.stringify(fallbackRules) + '); })();';
        js.push({ code });
        details = {
          matches: ['<all_urls>'],
          js,
          runAt: 'document_start',
          allFrames: true
        };
      }
      await ctx.wapiScripting.replace('scriptlets', details);
      return true;
    }

    async function syncScriptlets() {
      if (ctx.scriptletRestorePromise) await ctx.scriptletRestorePromise;
      const rules = ctx.engine.getScriptletPayload();
      const payload = splitScriptletPayload(rules);
      const generation = ++ctx.scriptletGeneration;
      await persistScriptletSnapshot(payload, generation);
      return registerScriptletRegistration(payload, generation);
    }

    async function syncRemoteAlarm() {
      if (!ctx.wapiCapabilities.alarms.supported) return;
      const lists = await ctx.remoteLists.get();
      const intervals = lists.lists
        .filter(entry => entry.autoUpdate)
        .map(entry => {
          const expiry = Number(entry.metadata && entry.metadata.expiresMs);
          return Number.isFinite(expiry) && expiry >= 60 * 1000
            ? expiry : 24 * 60 * 60 * 1000;
        });
      if (!intervals.length) {
        await ctx.wapi.alarms.clear('wildfire-remote-update');
        return;
      }
      const periodInMinutes = Math.max(1, Math.floor(Math.min(...intervals) / (60 * 1000)));
      const existing = await ctx.wapi.alarms.get('wildfire-remote-update');
      if (!existing || existing.periodInMinutes !== periodInMinutes) {
        await ctx.wapi.alarms.create('wildfire-remote-update', { periodInMinutes });
      }
    }

    function remoteRulesChanged(result) {
      if (!result || !result.ok) return false;
      const action = result.action || '';
      if (action === 'update') return Boolean(result.changed);
      if (action === 'set-enabled' || action === 'remove') return true;
      return false;
    }

    async function applyRemoteResult(result) {
      if (!result.ok) {
        return Object.assign(ctx.snapshot(), {
          ok: false,
          error: result.error,
          lists: (result.snapshot && result.snapshot.lists) || (await ctx.remoteLists.get()).lists
        });
      }
      if (remoteRulesChanged(result)) {
        warmRemoteCompile(result);
        await loadFilters();
      }
      try {
        await syncRemoteAlarm();
      } catch (error) {
        console.warn('WildFire: remote update schedule failed', error);
      }
      return Object.assign(ctx.snapshot(), { ok: true, lists: result.snapshot.lists });
    }

    async function runRemoteUpdates(options) {
      const opts = options || {};
      const run = ctx.remoteUpdate.then(async () => {
        const result = await ctx.remoteLists.updateDue({ force: Boolean(opts.force) });
        if (result.changed) {
          await Promise.all((result.results || [])
            .filter(entry => entry && entry.ok && entry.changed)
            .map(entry => warmRemoteCompile(entry)));
          await loadFilters();
        }
        try {
          await syncRemoteAlarm();
        } catch (error) {
          console.warn('WildFire: remote update schedule failed', error);
        }
        return result;
      });
      ctx.remoteUpdate = run.catch(() => undefined);
      return run;
    }

    async function sendCosmetic(tabId, url, frameId) {
      const host = ctx.safeHost(url);
      if (!host) return;
      const hosts = ctx.cname ? ctx.cname.hostsFor(host) : [];
      const matchHosts = { target: hosts, document: hosts };
      const policyKey = JSON.stringify(['policy', url, hosts]);
      let hidePolicy = cosmeticCache.get(policyKey);
      if (!hidePolicy) {
        hidePolicy = ctx.engine.getHidePolicy
          ? ctx.engine.getHidePolicy(url, 'document', url, matchHosts) : {};
        cosmeticCache.set(policyKey, hidePolicy);
      }
      const cosmeticOptions = Object.assign({}, hidePolicy, { hosts });
      const key = JSON.stringify([
        host, hosts, Boolean(hidePolicy.generichide), Boolean(hidePolicy.elemhide),
        Boolean(hidePolicy.specifichide)
      ]);
      let payload = cosmeticCache.get(key);
      if (!payload) {
        payload = cosmeticCache.set(key, {
          type: 'wildfire:apply',
          selectors: ctx.engine.getCosmetic(host, cosmeticOptions),
          procedural: ctx.engine.getProcedural(host, cosmeticOptions),
          hidePolicy
        });
      }
      if (frameId !== undefined) {
        ctx.pageStore.setCosmetic(tabId, { url, frameId, payload });
      }
      const context = ctx.wapiContexts.find(tabId, frameId);
      if (context) {
        await ctx.wapiContexts.sendContext(context, payload);
        return;
      }
      const options = typeof frameId === 'number' ? { frameId } : undefined;
      await ctx.wapi.tabs.send(tabId, payload, options);
    }

    async function refreshCosmeticForPage(tabId) {
      const known = new Map();
      ctx.pageStore.framesForTab(tabId)
        .forEach(frame => known.set(frame.frameId, frame));
      ctx.wapiContexts.framesForTab(tabId)
        .forEach(frame => { if (!known.has(frame.frameId)) known.set(frame.frameId, frame); });
      const frames = Array.from(known.values());
      if (!frames.length) {
        const url = ctx.pageStore.topUrlForTab(tabId);
        if (url) await sendCosmetic(tabId, url, 0);
        return;
      }
      await Promise.all(frames.map(frame => sendCosmetic(tabId, frame.url, frame.frameId)));
    }

    async function refreshAllCosmetic() {
      const tabs = await ctx.wapi.tabs.query({});
      await Promise.all(tabs.map(tab => refreshCosmeticForPage(tab.id)));
    }

    return {
      engineHealth,
      validateFilters,
      compileSyncSafe,
      compileText,
      compileTextOnce,
      loadCompiledOrText,
      warmRemoteCompile,
      remoteSignature,
      loadFilters,
      splitScriptletPayload,
      scriptletHash,
      normalizeStoredScriptletPhases,
      persistScriptletSnapshot,
      restoreScriptlets,
      syncNativeScriptlets,
      syncScriptlets,
      syncRemoteAlarm,
      remoteRulesChanged,
      applyRemoteResult,
      runRemoteUpdates,
      sendCosmetic,
      refreshCosmeticForPage,
      refreshAllCosmetic
    };
  };
})(this);

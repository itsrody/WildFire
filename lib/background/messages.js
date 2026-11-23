/* WildFire - runtime message router. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});

  core.createMessages = function createMessages(ctx) {
    const globals = ctx.globals;
    const router = ctx.wapiRouter;

    function statePayload(message, sender) {
      const url = message.url || (sender.tab && sender.tab.url) || '';
      const host = ctx.safeHost(url);
      const site = ctx.siteKey(host);
      const payload = ctx.snapshot();
      payload.site = {
        url,
        host,
        site,
        blocked: site ? ctx.countForSite(site) : 0,
        disabled: ctx.siteDisabled(host)
      };
      return payload;
    }

    function cosmeticPayload(message, sender) {
      const tabId = sender.tab && sender.tab.id;
      const frame = ctx.pageStore.frameFor(tabId, sender.frameId);
      const url = message.url || (frame && frame.url) ||
        (sender.tab && sender.tab.url) || '';
      const host = ctx.safeHost(url);
      const hidePolicy = ctx.engine.getHidePolicy
        ? ctx.engine.getHidePolicy(url, 'document', url) : {};
      return {
        ok: true,
        selectors: ctx.engine.getCosmetic(host, hidePolicy),
        procedural: ctx.engine.getProcedural(host, hidePolicy),
        hidePolicy
      };
    }

    async function updateList(message) {
      const url = String(message.url || '');
      if (ctx.remoteUpdating.has(url)) {
        return Object.assign(ctx.snapshot(), {
          ok: false,
          error: 'Update already in progress.',
          lists: (await ctx.remoteLists.get()).lists
        });
      }
      ctx.remoteUpdating.add(url);
      try {
        return await ctx.applyRemoteResult(await ctx.remoteLists.update(message.url));
      } finally {
        ctx.remoteUpdating.delete(url);
      }
    }

    async function diagnosticsPayload(message) {
      if (message.reset === true) {
        ctx.diagnostics.phases = ctx.emptyPhaseStats();
        ctx.diagnostics.samples = [];
        ctx.resetObservations();
      }
      if (typeof message.value === 'boolean') {
        ctx.diagnostics.enabled = message.value;
        if (ctx.engine.setMatchStatsEnabled) {
          ctx.engine.setMatchStatsEnabled(ctx.diagnostics.enabled);
        }
      }
      return { ok: true, diagnostics: ctx.diagnosticsSnapshot() };
    }

    function inspectPayload(message) {
      if (message.reset === true) ctx.inspector.clear();
      if (typeof message.value === 'boolean') ctx.inspector.setEnabled(message.value);
      return { ok: true, inspect: ctx.inspector.snapshot() };
    }

    router.registerAll({
      state: statePayload,
      toggle: () => ctx.persist({ enabled: !ctx.state.enabled }),
      'toggle-site': message => {
        const host = ctx.safeHost(message.host || message.url || '');
        if (!host) return ctx.snapshot();
        const list = Array.isArray(ctx.state.disabledSites)
          ? ctx.state.disabledSites.slice() : [];
        const index = list.indexOf(host);
        if (index === -1) list.push(host);
        else list.splice(index, 1);
        return ctx.persist({ disabledSites: list });
      },
      'set-filters': async message => {
        await ctx.persist({ customFilters: String(message.value || '') });
        await ctx.loadFilters();
        return ctx.snapshot();
      },
      'set-csp-report-blocking': async message => {
        const result = await ctx.persist({ blockCspReports: Boolean(message.value) });
        ctx.ensureHeadersListener();
        return result;
      },
      'set-csp-report-allow': message =>
        ctx.persist({ cspReportAllow: ctx.parseHostList(message.value) }),
      'reset-stats': () => {
        ctx.pageStore.resetBlocked();
        return ctx.persist({ blocked: 0, blockedBySite: {} });
      },
      reload: async () => {
        await ctx.loadFilters();
        return ctx.snapshot();
      },
      'suggested-lists': () => ({ suggested: globals.WildFireSuggestedLists.all() }),
      'list-state': async () => {
        const payload = ctx.snapshot();
        payload.lists = (await ctx.remoteLists.get()).lists;
        return payload;
      },
      'add-list': async message =>
        ctx.applyRemoteResult(await ctx.remoteLists.add(message.url)),
      'remove-list': async message =>
        ctx.applyRemoteResult(await ctx.remoteLists.remove(message.url)),
      'update-list': message => updateList(message),
      'set-list-enabled': async message =>
        ctx.applyRemoteResult(
          await ctx.remoteLists.setEnabled(message.url, Boolean(message.value))),
      'set-list-auto': async message =>
        ctx.applyRemoteResult(
          await ctx.remoteLists.setAutoUpdate(message.url, Boolean(message.value))),
      cosmetic: cosmeticPayload,
      diagnostics: diagnosticsPayload,
      inspect: inspectPayload
    });

    async function onMessage(message, sender) {
      if (!router.accepts(message)) return undefined;
      if (ctx.wapiContexts && sender && sender.tab) {
        ctx.wapiContexts.observe(message, sender);
      }
      if (!ctx.ready) {
        await ctx.readyPromise;
        if (ctx.startupError) {
          return {
            ok: false,
            error: 'WildFire initialization failed: ' + ctx.startupError,
            diagnostics: ctx.diagnosticsSnapshot()
          };
        }
      }
      return router.dispatch(message, sender);
    }

    return onMessage;
  };
})(this);

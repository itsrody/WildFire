/* WildFire - browser.runtime message router. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});

  core.createMessages = function createMessages(ctx) {
    const globals = ctx.globals;

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

    async function onMessage(message, sender) {
      if (!message || typeof message.type !== 'string' || !message.type.startsWith('wildfire:')) {
        return undefined;
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

      const action = message.type.slice('wildfire:'.length);
      const payload = ctx.snapshot();

      switch (action) {
        case 'state':
          return statePayload(message, sender);

        case 'toggle':
          return ctx.persist({ enabled: !ctx.state.enabled });

        case 'toggle-site': {
          const host = ctx.safeHost(message.host || message.url || '');
          if (!host) return payload;
          const list = Array.isArray(ctx.state.disabledSites)
            ? ctx.state.disabledSites.slice() : [];
          const index = list.indexOf(host);
          if (index === -1) list.push(host);
          else list.splice(index, 1);
          return ctx.persist({ disabledSites: list });
        }

        case 'set-filters':
          await ctx.persist({ customFilters: String(message.value || '') });
          await ctx.loadFilters();
          return ctx.snapshot();

        case 'set-csp-report-blocking': {
          const result = await ctx.persist({ blockCspReports: Boolean(message.value) });
          ctx.ensureHeadersListener();
          return result;
        }

        case 'set-csp-report-allow':
          return ctx.persist({ cspReportAllow: ctx.parseHostList(message.value) });

        case 'reset-stats':
          ctx.pageStore.resetBlocked();
          return ctx.persist({ blocked: 0, blockedBySite: {} });

        case 'reload':
          await ctx.loadFilters();
          return ctx.snapshot();

        case 'suggested-lists':
          return { suggested: globals.WildFireSuggestedLists.all() };

        case 'list-state':
          payload.lists = (await ctx.remoteLists.get()).lists;
          return payload;

        case 'add-list':
          return ctx.applyRemoteResult(await ctx.remoteLists.add(message.url));

        case 'remove-list':
          return ctx.applyRemoteResult(await ctx.remoteLists.remove(message.url));

        case 'update-list':
          return updateList(message);

        case 'set-list-enabled':
          return ctx.applyRemoteResult(
            await ctx.remoteLists.setEnabled(message.url, Boolean(message.value)));

        case 'set-list-auto':
          return ctx.applyRemoteResult(
            await ctx.remoteLists.setAutoUpdate(message.url, Boolean(message.value)));

        case 'cosmetic':
          return cosmeticPayload(message, sender);

        case 'diagnostics':
          return diagnosticsPayload(message);

        default:
          return { ok: false, error: 'Unknown action: ' + action };
      }
    }

    return onMessage;
  };
})(this);

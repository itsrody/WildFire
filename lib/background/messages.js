/* WildFire - runtime message router. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});

  core.createMessages = function createMessages(ctx) {
    const globals = ctx.globals;
    const router = ctx.wapiRouter;

    function siteInfo(value) {
      const url = String(value || '');
      const host = ctx.safeHost(url);
      const site = ctx.siteKey(host || url.trim().toLowerCase());
      return {
        url,
        host,
        site,
        blocked: site ? ctx.countForSite(site) : 0,
        disabled: ctx.siteDisabled(host),
        rules: site ? ctx.siteRulesFor(site) : {}
      };
    }

    function statePayload(message, sender) {
      const url = message.url || (sender.tab && sender.tab.url) || '';
      const payload = ctx.snapshot();
      payload.site = siteInfo(url);
      return payload;
    }

    function copySiteRules() {
      const source = ctx.state.siteRules && typeof ctx.state.siteRules === 'object' &&
        !Array.isArray(ctx.state.siteRules) ? ctx.state.siteRules : {};
      return Object.keys(source).reduce((copy, site) => {
        copy[site] = Object.assign({}, source[site]);
        return copy;
      }, {});
    }

    function refreshedSite(info) {
      return Object.assign({}, info, { rules: ctx.siteRulesFor(info.site) });
    }

    function dynamicType(value) {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw || raw === 'popup' || raw === 'main_frame') return '';
      const type = globals.mapResourceType(raw);
      if (!core.SITE_RULE_TYPES.includes(type) || core.DYNAMIC_IGNORED_TYPES.has(type)) return '';
      return type;
    }

    async function setSiteRule(message) {
      const info = siteInfo(message.site || message.url || '');
      if (!info.site) return ctx.snapshot();
      const type = dynamicType(message.resourceType);
      const action = String(message.action || '').trim().toLowerCase();
      if (!type || !['allow', 'block', 'clear'].includes(action)) return ctx.snapshot();

      const next = copySiteRules();
      const rules = Object.assign({}, next[info.site]);
      if (action === 'clear') delete rules[type];
      else rules[type] = action;
      if (Object.keys(rules).length) next[info.site] = rules;
      else delete next[info.site];
      const result = await ctx.persist({ siteRules: next });
      return Object.assign(result, { site: refreshedSite(info) });
    }

    async function clearSiteRules(message) {
      const info = siteInfo(message.site || message.url || '');
      if (!info.site) return ctx.snapshot();
      const next = copySiteRules();
      delete next[info.site];
      const result = await ctx.persist({ siteRules: next });
      return Object.assign(result, { site: refreshedSite(info) });
    }

    function cosmeticPayload(message, sender) {
      const tabId = sender.tab && sender.tab.id;
      const frame = ctx.pageStore.frameFor(tabId, sender.frameId);
      const url = message.url || (frame && frame.url) ||
        (sender.tab && sender.tab.url) || '';
      const host = ctx.safeHost(url);
      const hosts = ctx.cname ? ctx.cname.hostsFor(host) : [];
      const matchHosts = { target: hosts, document: hosts };
      const hidePolicy = ctx.engine.getHidePolicy
        ? ctx.engine.getHidePolicy(url, 'document', url, matchHosts) : {};
      const cosmeticOptions = Object.assign({}, hidePolicy, { hosts });
      return {
        ok: true,
        selectors: ctx.engine.getCosmetic(host, cosmeticOptions),
        procedural: ctx.engine.getProcedural(host, cosmeticOptions),
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

    async function addList(message) {
      const added = await ctx.remoteLists.add(message.url);
      if (!added.ok || !added.list) return ctx.applyRemoteResult(added);
      const stored = (await ctx.remoteLists.get()).lists
        .find(entry => entry.url === added.list.url);
      if (stored && stored.text) return ctx.applyRemoteResult(added);
      return updateList({ url: added.list.url });
    }

    async function setListAuto(message) {
      const enabled = Boolean(message.value);
      const result = await ctx.applyRemoteResult(
        await ctx.remoteLists.setAutoUpdate(message.url, enabled));
      if (!result.ok || !enabled) return result;
      const url = globals.RemoteLists.normalizeUrl(message.url, { allowBuiltin: true });
      const stored = (result.lists || []).find(entry => entry.url === url);
      if (stored && !stored.text) return updateList({ url: stored.url });
      return result;
    }

    async function diagnosticsPayload(message) {
      if (message.reset === true) {
        ctx.diagnostics.phases = ctx.emptyPhaseStats();
        ctx.diagnostics.samples = [];
        ctx.resetObservations();
        if (ctx.cname) ctx.cname.resetStats();
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
      if (message.reset === true) ctx.logger.clear();
      if (typeof message.value === 'boolean') ctx.logger.setEnabled(message.value);
      return { ok: true, inspect: ctx.logger.snapshot() };
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
      'validate-filters': message => ctx.validateFilters(message.value),
      'set-csp-report-blocking': async message => {
        const result = await ctx.persist({ blockCspReports: Boolean(message.value) });
        ctx.ensureHeadersListener();
        return result;
      },
      'set-csp-report-allow': message =>
        ctx.persist({ cspReportAllow: ctx.parseHostList(message.value) }),
      'set-cname-uncloak': message =>
        ctx.persist({ cnameUncloak: Boolean(message.value) }),
      'set-site-rule': message => setSiteRule(message),
      'clear-site-rules': message => clearSiteRules(message),
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
      'add-list': async message => addList(message),
      'remove-list': async message =>
        ctx.applyRemoteResult(await ctx.remoteLists.remove(message.url)),
      'update-list': message => updateList(message),
      'set-list-enabled': async message =>
        ctx.applyRemoteResult(
          await ctx.remoteLists.setEnabled(message.url, Boolean(message.value))),
      'set-list-auto': async message => setListAuto(message),
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

/* WildFire - synchronous Firefox webRequest handlers. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const CSP_REPORT_DIRECTIVES = new Set(['report-uri', 'report-to']);
  const CSP_HEADER_NAMES = new Set([
    'content-security-policy', 'content-security-policy-report-only'
  ]);
  const POPUP_BLOCK_TTL_MS = 10000;

  core.createRequests = function createRequests(ctx) {
    const globals = ctx.globals;

    // Firefox streams the response through StreamFilter. Everything is set up
    // synchronously here; the native stream lifecycle lives in wapi-webrequest.
    function startRewrite(requestId, resource) {
      return ctx.wapiWebRequest.rewrite(requestId, resource, {
        onStart: () => ctx.rewrites.set(requestId, resource.type),
        onFinish: () => ctx.rewrites.delete(requestId),
        onFilterError: error => console.warn('WildFire: rewrite filter failed', error),
        onWriteError: error => console.warn('WildFire: rewrite write failed', error)
      });
    }

    function applyRemoveparam(url, rules) {
      if (!rules || !rules.length) return url;
      try {
        const u = new URL(url);
        let changed = false;
        rules.forEach(rule => {
          const value = String(rule.value || '');
          if (!value) {
            if (u.search) { u.search = ''; changed = true; }
            return;
          }
          if (rule.regex) {
            Array.from(u.searchParams.keys()).forEach(key => {
              if (rule.regex.test(key)) { u.searchParams.delete(key); changed = true; }
            });
            return;
          }
          if (u.searchParams.has(value)) { u.searchParams.delete(value); changed = true; }
        });
        return changed ? u.toString() : url;
      } catch (error) {
        return url;
      }
    }

    function removeHeaders(headers, names, kind) {
      if (!Array.isArray(headers) || !names || !names.length) return headers;
      const set = new Set(names.map(n => {
        const v = String(n || '').toLowerCase();
        if (v.startsWith('request:') || v.startsWith('response:')) return v;
        return kind + ':' + v;
      }));
      const filtered = headers.filter(h => {
        const name = String(h.name || '').toLowerCase();
        return !(set.has(kind + ':' + name) || set.has(name));
      });
      return filtered.length === headers.length ? headers : filtered;
    }

    function popupSource(details) {
      return ctx.pageStore.popupSourceFor(details.tabId) ||
        (details.openerTabId && ctx.pageStore.topUrlForTab(details.openerTabId)) ||
        ctx.pageStore.documentUrlFor(details) ||
        '';
    }

    function dynamicSite(details, host) {
      return ctx.siteKey(ctx.countHostFor(details, host));
    }

    function dynamicDecision(details, host, type) {
      const site = dynamicSite(details, host);
      if (!site || core.DYNAMIC_IGNORED_TYPES.has(type)) return '';
      return ctx.dynamicDecision(site, type);
    }

    function topHostFor(details, scope) {
      return scope.topHost ||
        ctx.safeHost(ctx.pageStore.topUrlForTab(details.tabId)) ||
        ctx.countHostFor(details, scope.host);
    }

    // The block decision may be made in onCreatedNavigationTarget while the
    // popup request arrives later. Count once, then let the request path cancel
    // without counting again even if tabs.remove() loses the race.
    function countPopupBlock(tabId, host) {
      if (!ctx.pageStore.isPopupBlocked(tabId) ||
          ctx.pageStore.isPopupCounted(tabId)) return false;
      ctx.pageStore.markPopupCounted(tabId);
      ctx.recordBlock(tabId, host);
      return true;
    }

    function clearPopupCleanup(tabId) {
      if (!ctx.popupCleanupTimers) return;
      const timer = ctx.popupCleanupTimers.get(tabId);
      if (timer) clearTimeout(timer);
      ctx.popupCleanupTimers.delete(tabId);
    }

    function schedulePopupCleanup(tabId) {
      clearPopupCleanup(tabId);
      if (!ctx.popupCleanupTimers) return;
      const timer = setTimeout(() => {
        ctx.popupCleanupTimers.delete(tabId);
        ctx.pageStore.clearPopup(tabId);
      }, POPUP_BLOCK_TTL_MS);
      ctx.popupCleanupTimers.set(tabId, timer);
    }

    function inspectRequest(details, phase, decision, rule, detail, started, meta) {
      if (!ctx.inspector || !ctx.inspector.enabled) return;
      const ms = started ? ctx.monotonicMs() - started : 0;
      const scope = ctx.pageStore.contextFor(details);
      const info = meta || {};
      ctx.recordInspection({
        phase: info.phase || phase,
        decision,
        rule,
        detail,
        reason: info.reason || '',
        source: info.source || 'static',
        ms,
        url: details.url,
        type: details.type,
        tabId: details.tabId,
        requestId: details.requestId,
        documentUrl: info.documentUrl || scope.documentUrl,
        topHost: info.topHost || scope.topHost,
        topSite: scope.topSite
      });
    }

    function onBeforeRequest(details) {
      if (details.type === 'csp_report') return undefined;
      const started = ctx.inspector && ctx.inspector.enabled ? ctx.monotonicMs() : 0;
      ctx.pageStore.observeRequest(details);

      // A popup already decided by onCreatedNavigationTarget must stay cancelled
      // even if tabs.remove() has not taken effect yet.
      if (details.type === 'main_frame' && ctx.pageStore.isPopupBlocked(details.tabId)) {
        const counted = ctx.pageStore.isPopupCounted(details.tabId);
        ctx.pageStore.consumePopupBlock(details.tabId);
        clearPopupCleanup(details.tabId);
        inspectRequest(details, 'request', 'blocked', null,
          counted ? '$popup already counted' : '$popup already blocked', started,
          { source: 'popup', reason: 'pending popup block' });
        return { cancel: true };
      }

      if (!ctx.state.enabled) {
        inspectRequest(details, 'request', 'skipped', null, 'globally paused', started,
          { source: 'pause', reason: 'global pause' });
        return undefined;
      }
      const skipReason = ctx.urlSkipReason(details.url);
      if (skipReason) {
        inspectRequest(details, 'request', 'skipped', null, 'url skip: ' + skipReason, started,
          { source: 'url-skip', reason: skipReason });
        return undefined;
      }

      const scope = ctx.pageStore.contextFor(details);
      const documentUrl = scope.documentUrl;
      const host = scope.host;
      if (scope.disabled) {
        inspectRequest(details, 'request', 'skipped', null, 'top-level site paused', started,
          { source: 'pause', reason: 'top-level site paused' });
        return undefined;
      }

      const type = globals.mapResourceType(details.type);
      const dynamic = dynamicDecision(details, host, type);
      if (dynamic === 'allow') {
        inspectRequest(details, 'request', 'skipped', null, 'site rule: allow', started,
          { source: 'site-rule', reason: 'allow' });
        return undefined;
      }
      if (dynamic === 'block') {
        ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
        inspectRequest(details, 'request', 'blocked', null, 'site rule: block', started,
          { source: 'site-rule', reason: 'block' });
        return { cancel: true };
      }
      if (type === 'document' && ctx.pageStore.hasPopup(details.tabId)) {
        const sourceUrl = popupSource(details);
        if (!ctx.siteDisabled(ctx.safeHost(sourceUrl))) {
          const popup = ctx.measuredMatch('request', () =>
            ctx.engine.matchPopup(details.url, sourceUrl));
          if (popup.blocked) {
            ctx.pageStore.markPopupBlocked(details.tabId);
            countPopupBlock(details.tabId, ctx.safeHost(sourceUrl) || host);
            ctx.pageStore.consumePopupBlock(details.tabId);
            clearPopupCleanup(details.tabId);
            inspectRequest(details, 'request', 'blocked', popup.rule, '$popup', started,
              { source: 'popup', reason: '$popup' });
            return { cancel: true };
          }
        }
        ctx.pageStore.clearPopup(details.tabId);
      }

      const result = ctx.measuredMatch('request', () =>
        ctx.engine.matchRequest(details.url, type, documentUrl));
      if (result.blocked) {
        if (type === 'document') {
          inspectRequest(details, 'request', 'blocked', result.rule, '$document', started,
            { source: 'document', reason: '$document' });
          ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
          return { cancel: true };
        }

        const rewrite = result.rewrite && globals.RewriteResources
          ? globals.RewriteResources.resolve(result.rewrite.alias, result.rewrite.captures)
          : null;

        // Only WildFire-owned data-URI resources can be served, and never for
        // navigations. An unknown alias falls back to a plain cancel.
        const redirectUrl = !rewrite && result.redirect && globals.RedirectResources
          ? globals.RedirectResources.resolve(result.redirect.alias, result.redirect.captures)
          : '';

        ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
        if (rewrite) {
          const decision = startRewrite(details.requestId, rewrite) ? 'rewritten' : 'blocked';
          inspectRequest(details, 'request', decision, result.rule,
            decision === 'rewritten' ? result.rewrite.alias : 'rewrite unavailable', started,
            { source: 'rewrite', reason: result.rewrite.alias });
          return decision === 'rewritten' ? undefined : { cancel: true };
        }
        if (redirectUrl) {
          inspectRequest(details, 'request', 'redirected', result.rule,
            result.redirect.alias, started,
            { source: 'redirect', reason: result.redirect.alias });
          return { redirectUrl };
        }
        inspectRequest(details, 'request', 'blocked', result.rule, '', started,
          { source: 'static', reason: 'network rule' });
        return { cancel: true };
      }

      inspectRequest(details, 'request', result.exception ? 'exception' : 'allowed',
        result.exception || null, result.exception ? 'exception wins' : '', started,
        { source: result.exception ? 'exception' : 'static',
          reason: result.exception ? 'exception wins' : 'no matching rule' });

      // Capability-gated removeparam: only when request is not blocked/redirected.
      if (ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEPARAM) {
        const rp = ctx.measuredMatch('removeparam', () =>
          ctx.engine.matchRemoveparam(details.url, type, documentUrl));
        if (rp.params && rp.params.length) {
          const cleanUrl = applyRemoveparam(details.url, rp.params);
          if (cleanUrl && cleanUrl !== details.url) {
            ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
            inspectRequest(details, 'request', 'redirected', null, 'removeparam', started,
              { phase: 'removeparam', source: 'removeparam', reason: rp.params.join(', ') });
            return { redirectUrl: cleanUrl };
          }
        }
      }
      return undefined;
    }

    function onBeforeSendHeaders(details) {
      if (!ctx.state.enabled) return;
      if (ctx.urlSkipReason(details.url)) return;
      if (!(ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEHEADER)) return;
      ctx.pageStore.observeRequest(details);
      const type = globals.mapResourceType(details.type);
      const scope = ctx.pageStore.contextFor(details);
      const documentUrl = type === 'document' ? details.url : scope.documentUrl;
      const siteHost = topHostFor(details, scope);
      if (ctx.siteDisabled(siteHost)) return;
      if (dynamicDecision(details, siteHost, type) === 'allow') return;
      const result = ctx.measuredMatch('removeheader-request', () =>
        ctx.engine.matchRemoveheader(details.url, type, documentUrl));
      if (!result.headers.length) return;
      const reqHeaders = details.requestHeaders || [];
      const requestHeaders = removeHeaders(reqHeaders, result.headers, 'request');
      if (requestHeaders !== reqHeaders) {
        inspectRequest(details, 'removeheader', 'modified', null, result.headers.join(', '), 0,
          { source: 'removeheader', reason: 'request headers' });
        return { requestHeaders };
      }
      return undefined;
    }

    function reportEndpointHost(value, baseUrl) {
      try {
        return new URL(String(value || ''), baseUrl).hostname.toLowerCase();
      } catch (error) {
        return '';
      }
    }

    function reportingEndpoints(headers) {
      return headers.reduce((endpoints, header) => {
        if (String(header && header.name || '').toLowerCase() !== 'reporting-endpoints') {
          return endpoints;
        }
        const matches = String(header && header.value || '')
          .matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/g);
        Array.from(matches).forEach(match => { endpoints[match[1]] = match[2]; });
        return endpoints;
      }, Object.create(null));
    }

    function parseCspDirectives(value) {
      return String(value || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(raw => {
          const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
          return match
            ? { raw, name: match[1].toLowerCase(), value: match[2] || '' }
            : null;
        })
        .filter(Boolean);
    }

    function reportDirectiveAllowed(directive, endpoints, baseUrl) {
      const allowed = Array.isArray(ctx.state.cspReportAllow) ? ctx.state.cspReportAllow : [];
      if (!allowed.length) return false;
      const values = directive.value.split(/\s+/).filter(Boolean);
      if (!values.length) return false;
      if (directive.name === 'report-uri') {
        return values.every(value =>
          ctx.hostMatchesList(reportEndpointHost(value, baseUrl), allowed));
      }
      return values.every(name => {
        const endpoint = endpoints[name];
        return Boolean(endpoint) &&
          ctx.hostMatchesList(reportEndpointHost(endpoint, baseUrl), allowed);
      });
    }

    function stripCspReportDirectives(headers, baseUrl) {
      if (!Array.isArray(headers) || !ctx.state.blockCspReports) return headers;
      const endpoints = reportingEndpoints(headers);
      let stripped = 0;
      const next = headers.map(header => {
        const name = String(header && header.name || '').toLowerCase();
        if (!CSP_HEADER_NAMES.has(name)) return header;
        const directives = parseCspDirectives(header.value);
        const kept = directives
          .filter(directive => !CSP_REPORT_DIRECTIVES.has(directive.name) ||
            reportDirectiveAllowed(directive, endpoints, baseUrl))
          .map(directive => directive.raw);
        if (kept.length === directives.length) return header;
        stripped += 1;
        return Object.assign({}, header, { value: kept.join('; ') });
      });
      if (stripped && ctx.diagnostics.enabled) {
        ctx.cspReportsObserved.headersStripped += stripped;
      }
      return stripped ? next : headers;
    }

    function onCspReportRequest(details) {
      if (!ctx.state.enabled || !ctx.state.blockCspReports) return undefined;
      if (ctx.urlSkipReason(details.url)) return undefined;
      ctx.pageStore.observeRequest(details);
      const endpointHost = ctx.safeHost(details.url);
      if (!endpointHost || ctx.hostMatchesList(endpointHost, ctx.state.cspReportAllow)) {
        return undefined;
      }
      const scope = ctx.pageStore.contextFor(details);
      if (scope.disabled) return undefined;
      if (dynamicDecision(details, topHostFor(details, scope), 'other') === 'allow') {
        return undefined;
      }
      if (ctx.diagnostics.enabled) ctx.cspReportsObserved.requestsCancelled += 1;
      inspectRequest(details, 'csp-report', 'blocked', null, 'CSP report', 0,
        { source: 'csp-report', reason: 'report endpoint' });
      return { cancel: true };
    }

    function onHeadersReceived(details) {
      if (details.type === 'csp_report') return undefined;
      const started = ctx.inspector && ctx.inspector.enabled ? ctx.monotonicMs() : 0;
      // A rewrite stream may already exist even if the user just paused the
      // extension; its headers still need normalizing so the body stays valid.
      const rewriteType = ctx.rewrites.get(details.requestId);
      const skipReason = ctx.urlSkipReason(details.url);
      if ((!ctx.state.enabled || skipReason) && !rewriteType) return undefined;

      ctx.pageStore.observeRequest(details);
      const type = globals.mapResourceType(details.type);
      const scope = ctx.pageStore.contextFor(details);
      // For a main document the response itself is the matching scope; pause
      // and dynamic rules always follow the tab's top-level site.
      const documentUrl = type === 'document' ? details.url : scope.documentUrl;
      const siteHost = topHostFor(details, scope);
      const disabled = ctx.siteDisabled(siteHost);
      if (disabled && !rewriteType) return undefined;
      const dynamicAllowed = dynamicDecision(details, siteHost, type) === 'allow';

      let headers = details.responseHeaders || [];
      let changed = false;
      if (rewriteType && globals.RewriteResources) {
        headers = globals.RewriteResources.withHeaders(headers, rewriteType);
        changed = true;
        inspectRequest(details, 'rewrite', 'rewritten', null, 'response headers', started,
          { source: 'rewrite', reason: 'normalize headers' });
      }

      if (ctx.state.enabled && !disabled && !skipReason && !dynamicAllowed) {
        if (ctx.state.blockCspReports) {
          const stripped = stripCspReportDirectives(headers, details.url);
          if (stripped !== headers) {
            headers = stripped;
            changed = true;
            inspectRequest(details, 'report-strip', 'modified', null,
              'CSP report directives removed', started,
              { source: 'csp-report', reason: 'report directives' });
          }
        }
        if (ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEHEADER) {
          const rh = ctx.measuredMatch('removeheader-response', () =>
            ctx.engine.matchRemoveheader(details.url, type, documentUrl));
          if (rh.headers.length) {
            const next = removeHeaders(headers, rh.headers, 'response');
            if (next !== headers) {
              headers = next;
              changed = true;
              inspectRequest(details, 'removeheader', 'modified', null,
                rh.headers.join(', '), started,
                { source: 'removeheader', reason: 'response headers' });
            }
          }
        }
        const result = ctx.measuredMatch('csp', () =>
          ctx.engine.matchCsp(details.url, type, documentUrl));
        if (result.directives.length) {
          headers = globals.CspResources.withDirective(headers, result.directives);
          inspectRequest(details, 'csp', 'csp', null, result.directives.join('; '), started,
            { source: 'csp', reason: 'extra enforcing directives' });
          changed = true;
        } else if (result.exception) {
          inspectRequest(details, 'csp', 'exception', null, 'exception wins', started,
            { source: 'csp', reason: 'exception wins' });
        }
      }
      return changed ? { responseHeaders: headers } : undefined;
    }

    function onPopupNavigation(details) {
      if (!ctx.state.enabled || ctx.urlSkipReason(details.url)) return;
      const sourceUrl = ctx.pageStore.urlForFrame(details.sourceTabId, details.sourceFrameId) ||
        ctx.pageStore.urlForFrame(details.sourceTabId, 0) || '';
      if (sourceUrl) ctx.pageStore.markPopup(details.tabId, sourceUrl);
      if (!sourceUrl || ctx.siteDisabled(ctx.safeHost(sourceUrl))) return;

      const result = ctx.engine.matchPopup(details.url, sourceUrl);
      if (!result.blocked) return;

      ctx.pageStore.markPopupBlocked(details.tabId);
      if (countPopupBlock(details.tabId, ctx.safeHost(sourceUrl))) {
        schedulePopupCleanup(details.tabId);
        ctx.wapi.tabs.remove(details.tabId).catch(error =>
          console.warn('WildFire: popup close failed', error));
      }
    }

    return {
      applyRemoveparam,
      removeHeaders,
      startRewrite,
      popupSource,
      countPopupBlock,
      clearPopupCleanup,
      onBeforeRequest,
      onBeforeSendHeaders,
      reportEndpointHost,
      reportingEndpoints,
      parseCspDirectives,
      reportDirectiveAllowed,
      stripCspReportDirectives,
      onCspReportRequest,
      onHeadersReceived,
      onPopupNavigation
    };
  };
})(this);

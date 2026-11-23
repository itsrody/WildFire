/* WildFire - synchronous Firefox webRequest handlers. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const CSP_REPORT_DIRECTIVES = new Set(['report-uri', 'report-to']);
  const CSP_HEADER_NAMES = new Set([
    'content-security-policy', 'content-security-policy-report-only'
  ]);

  core.createRequests = function createRequests(ctx) {
    const globals = ctx.globals;

    // Firefox streams the response through StreamFilter. Everything is set up
    // synchronously here; incoming chunks are discarded and the curated WildFire
    // body is written when the stream stops.
    function startRewrite(requestId, resource) {
      if (!ctx.browserApi.webRequest ||
          typeof ctx.browserApi.webRequest.filterResponseData !== 'function') {
        return false;
      }
      let filter;
      try {
        filter = ctx.browserApi.webRequest.filterResponseData(requestId);
      } catch (error) {
        console.warn('WildFire: rewrite filter failed', error);
        return false;
      }

      ctx.rewrites.set(requestId, resource.type);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        ctx.rewrites.delete(requestId);
      };

      filter.ondata = () => { /* the original body is intentionally dropped */ };
      filter.onstop = () => {
        try {
          filter.write(resource.bytes);
          filter.close();
        } catch (error) {
          console.warn('WildFire: rewrite write failed', error);
          try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
        }
        finish();
      };
      filter.onerror = () => {
        try { filter.disconnect(); } catch (ignored) { /* stream already gone */ }
        finish();
      };
      return true;
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

    function countPopupBlock(tabId, host) {
      if (!ctx.pageStore.consumePopupBlock(tabId)) return false;
      ctx.recordBlock(tabId, host);
      return true;
    }

    function onBeforeRequest(details) {
      if (details.type === 'csp_report') return undefined;
      ctx.pageStore.observeRequest(details);
      if (!ctx.state.enabled || ctx.pageStore.isPopupBlocked(details.tabId)) return undefined;

      const scope = ctx.pageStore.contextFor(details);
      const documentUrl = scope.documentUrl;
      const host = scope.host;
      if (scope.disabled) return undefined;

      const type = globals.mapResourceType(details.type);
      if (type === 'document' && ctx.pageStore.hasPopup(details.tabId)) {
        const sourceUrl = popupSource(details);
        if (!ctx.siteDisabled(ctx.safeHost(sourceUrl))) {
          const popup = ctx.measuredMatch('request', () =>
            ctx.engine.matchPopup(details.url, sourceUrl));
          if (popup.blocked) {
            ctx.pageStore.markPopupBlocked(details.tabId);
            if (countPopupBlock(details.tabId, sourceUrl || documentUrl)) return { cancel: true };
          }
        }
        ctx.pageStore.clearPopup(details.tabId);
      }

      const result = ctx.measuredMatch('request', () =>
        ctx.engine.matchRequest(details.url, type, documentUrl));
      if (result.blocked) {
        if (type === 'document') {
          ctx.pageStore.markPopupBlocked(details.tabId);
          if (countPopupBlock(details.tabId, documentUrl || details.url)) return { cancel: true };
          return undefined;
        }

        const rewrite = result.rewrite && globals.RewriteResources
          ? globals.RewriteResources.resolve(result.rewrite.alias) : null;

        // Only WildFire-owned data-URI resources can be served, and never for
        // navigations. An unknown alias falls back to a plain cancel.
        const redirectUrl = !rewrite && result.redirect && globals.RedirectResources
          ? globals.RedirectResources.resolve(result.redirect.alias, result.redirect.captures)
          : '';

        ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
        if (rewrite) {
          return startRewrite(details.requestId, rewrite) ? undefined : { cancel: true };
        }
        return redirectUrl ? { redirectUrl } : { cancel: true };
      }

      // Capability-gated removeparam: only when request is not blocked/redirected.
      if (ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEPARAM) {
        const rp = ctx.measuredMatch('removeparam', () =>
          ctx.engine.matchRemoveparam(details.url, type, documentUrl));
        if (rp.params && rp.params.length) {
          const cleanUrl = applyRemoveparam(details.url, rp.params);
          if (cleanUrl && cleanUrl !== details.url) {
            ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
            return { redirectUrl: cleanUrl };
          }
        }
      }
      return undefined;
    }

    function onBeforeSendHeaders(details) {
      if (!ctx.state.enabled) return;
      if (!(ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEHEADER)) return;
      ctx.pageStore.observeRequest(details);
      const type = globals.mapResourceType(details.type);
      const documentUrl = type === 'document' ? details.url : ctx.pageStore.documentUrlFor(details);
      if (ctx.siteDisabled(ctx.safeHost(documentUrl))) return;
      const result = ctx.measuredMatch('removeheader-request', () =>
        ctx.engine.matchRemoveheader(details.url, type, documentUrl));
      if (!result.headers.length) return;
      const reqHeaders = details.requestHeaders || [];
      const requestHeaders = removeHeaders(reqHeaders, result.headers, 'request');
      return requestHeaders === reqHeaders ? undefined : { requestHeaders };
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
      ctx.pageStore.observeRequest(details);
      const endpointHost = ctx.safeHost(details.url);
      if (!endpointHost || ctx.hostMatchesList(endpointHost, ctx.state.cspReportAllow)) {
        return undefined;
      }
      const scope = ctx.pageStore.contextFor(details);
      if (scope.disabled) return undefined;
      if (ctx.diagnostics.enabled) ctx.cspReportsObserved.requestsCancelled += 1;
      return { cancel: true };
    }

    function onHeadersReceived(details) {
      if (details.type === 'csp_report') return undefined;
      // A rewrite stream may already exist even if the user just paused the
      // extension; its headers still need normalizing so the body stays valid.
      const rewriteType = ctx.rewrites.get(details.requestId);
      if (!ctx.state.enabled && !rewriteType) return undefined;

      ctx.pageStore.observeRequest(details);
      const type = globals.mapResourceType(details.type);
      // For a main document the response itself is the scope; for subresources
      // the embedding page is.
      const documentUrl = type === 'document' ? details.url : ctx.pageStore.documentUrlFor(details);
      const disabled = ctx.siteDisabled(ctx.safeHost(documentUrl));
      if (disabled && !rewriteType) return undefined;

      let headers = details.responseHeaders || [];
      let changed = false;
      if (rewriteType && globals.RewriteResources) {
        headers = globals.RewriteResources.withHeaders(headers, rewriteType);
        changed = true;
      }

      if (ctx.state.enabled && !disabled) {
        if (ctx.state.blockCspReports) {
          const stripped = stripCspReportDirectives(headers, details.url);
          if (stripped !== headers) { headers = stripped; changed = true; }
        }
        if (ctx.engine.capabilities & globals.FilterEngine.CAP.REMOVEHEADER) {
          const rh = ctx.measuredMatch('removeheader-response', () =>
            ctx.engine.matchRemoveheader(details.url, type, documentUrl));
          if (rh.headers.length) {
            const next = removeHeaders(headers, rh.headers, 'response');
            if (next !== headers) { headers = next; changed = true; }
          }
        }
        const result = ctx.measuredMatch('csp', () =>
          ctx.engine.matchCsp(details.url, type, documentUrl));
        if (result.directives.length) {
          headers = globals.CspResources.withDirective(headers, result.directives);
          changed = true;
        }
      }
      return changed ? { responseHeaders: headers } : undefined;
    }

    function onPopupNavigation(details) {
      if (!ctx.state.enabled) return;
      const sourceUrl = ctx.pageStore.urlForFrame(details.sourceTabId, details.sourceFrameId) ||
        ctx.pageStore.urlForFrame(details.sourceTabId, 0) || '';
      if (sourceUrl) ctx.pageStore.markPopup(details.tabId, sourceUrl);
      if (!sourceUrl || ctx.siteDisabled(ctx.safeHost(sourceUrl))) return;

      const result = ctx.engine.matchPopup(details.url, sourceUrl);
      if (!result.blocked) return;

      ctx.pageStore.markPopupBlocked(details.tabId);
      if (!countPopupBlock(details.tabId, sourceUrl)) return;
      ctx.browserApi.tabs.remove(details.tabId).catch(error =>
        console.warn('WildFire: popup close failed', error));
    }

    return {
      applyRemoveparam,
      removeHeaders,
      startRewrite,
      popupSource,
      countPopupBlock,
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

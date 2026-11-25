/* WildFire - synchronous Firefox webRequest handlers. */
(function (global) {
  'use strict';

  const core = global.WildFireBackgroundCore || (global.WildFireBackgroundCore = {});
  const CSP_REPORT_DIRECTIVES = new Set(['report-uri', 'report-to']);
  const CSP_HEADER_NAMES = new Set([
    'content-security-policy', 'content-security-policy-report-only'
  ]);
  const POPUP_BLOCK_TTL_MS = 10000;
  const HTML_TOKEN_SPLIT = /(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>)/g;
  const HTML_TAG_ATTRIBUTE = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const HTML_OPEN_TAG = /^<\s*([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/;
  const HTML_CLOSE_TAG = /^<\/\s*([A-Za-z][\w:-]*)\s*>$/;
  const HTML_VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr'
  ]);

  function htmlAttributes(raw) {
    return Array.from(String(raw || '').matchAll(HTML_TAG_ATTRIBUTE))
      .reduce((attributes, match) => {
        const name = match[1].toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(attributes, name)) {
          attributes[name] = match[2] !== undefined ? match[2]
            : match[3] !== undefined ? match[3] : (match[4] || '');
        }
        return attributes;
      }, Object.create(null));
  }

  function htmlSelectorMatches(selector, tag, attributes) {
    if (selector.tag && selector.tag !== tag) return false;
    const ids = Array.isArray(selector.id) ? selector.id : [];
    if (ids.some(id => attributes[id] !== id)) return false;
    const classes = Array.isArray(selector.classes) ? selector.classes : [];
    const classNames = String(attributes.class || '').split(/\s+/);
    if (classes.some(name => !classNames.includes(name))) return false;
    const attr = selector.attr;
    if (attr) {
      if (!Object.prototype.hasOwnProperty.call(attributes, attr.name)) return false;
      if (attr.value && attributes[attr.name] !== attr.value) return false;
    }
    return true;
  }

  // Bounded UTF-8 HTML rewrite. Only the simple selectors accepted by the
  // filter parser are evaluated, and removed content is never executed.
  core.transformHtmlText = function transformHtmlText(text, selectors) {
    const rules = Array.isArray(selectors) ? selectors : [];
    let hidden = [];
    let removed = 0;
    const output = String(text == null ? '' : text)
      .split(HTML_TOKEN_SPLIT)
      .map(part => {
        if (!part) return '';
        if (part[0] !== '<') return hidden.length ? '' : part;
        if (part.startsWith('<!--') || part.startsWith('<!')) {
          return hidden.length ? '' : part;
        }
        const close = HTML_CLOSE_TAG.exec(part);
        if (close) {
          if (!hidden.length) return part;
          const name = close[1].toLowerCase();
          const matches = hidden
            .map((tag, index) => tag === name ? index : -1)
            .filter(index => index >= 0);
          if (!matches.length) return '';
          hidden = hidden.slice(0, matches[matches.length - 1]);
          removed += 1;
          return '';
        }
        const open = HTML_OPEN_TAG.exec(part);
        if (!open) return hidden.length ? '' : part;
        const tag = open[1].toLowerCase();
        const attributes = htmlAttributes(open[2]);
        const selfClosing = Boolean(open[3]) || HTML_VOID_TAGS.has(tag);
        if (hidden.length) {
          if (!selfClosing) hidden = hidden.concat(tag);
          removed += 1;
          return '';
        }
        if (!rules.some(rule => htmlSelectorMatches(rule, tag, attributes))) return part;
        removed += 1;
        if (!selfClosing) hidden = [tag];
        return '';
      })
      .join('');
    return { text: output, changed: removed > 0 };
  };

  core.transformHtmlBody = function transformHtmlBody(bytes, selectors) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const result = core.transformHtmlText(text, selectors);
      return {
        bytes: new TextEncoder().encode(result.text),
        changed: result.changed
      };
    } catch (error) {
      return { bytes, changed: false, error: 'unsupported encoding' };
    }
  };

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

    function startHtmlFilter(details, type, documentUrl, matchHosts, started) {
      const cap = globals.FilterEngine.CAP;
      if (!ctx.engine.hasCapability(cap.HTML) || ctx.rewrites.has(details.requestId)) return;
      const match = ctx.measuredMatch('html', () =>
        ctx.engine.matchHtml(details.url, type, documentUrl, matchHosts));
      if (!match.headers.length && !match.selectors.length) {
        if (match.exception) {
          inspectRequest(details, 'html', 'exception', null, 'exception wins', started,
            { source: 'html', reason: 'html exception' });
        }
        return;
      }
      const actions = {
        headers: match.headers.slice(),
        selectors: match.selectors.map(selector => Object.assign({}, selector)),
        rules: match.rules.slice()
      };
      if (!ctx.htmlActions) ctx.htmlActions = new Map();
      if (!ctx.htmlStreams) ctx.htmlStreams = new Map();
      ctx.htmlActions.set(details.requestId, actions);
      if (actions.selectors.length) {
        ctx.htmlStreams.set(details.requestId,
          startHtmlStream(details, actions, started));
      }
      inspectRequest(details, 'html', 'streamed', null,
        actions.headers.length ? 'HTML response actions' : 'HTML stream', started,
        { source: 'html', reason: 'HTML filter' });
    }

    const HTML_HEADER_NAMES = new Set(['content-length', 'content-encoding']);
    const HTML_UTF8_CHARSETS = new Set(['utf-8', 'utf8', 'us-ascii', 'ascii']);

    function startHtmlStream(details, actions, started) {
      const state = { active: false, changed: false, failed: false, handle: null };
      const maxBytes = (globals.WildFireFilter && globals.WildFireFilter.MAX_HTML_BODY_BYTES) ||
        2 * 1024 * 1024;
      const handle = ctx.wapiWebRequest.stream(details.requestId, {
        maxBytes
      }, {
        onTransform: bytes => {
          if (state.failed) return { bytes, changed: false };
          const result = core.transformHtmlBody(bytes, actions.selectors);
          state.changed = Boolean(result.changed) && !result.error;
          return result;
        },
        onFinish: result => {
          state.active = false;
          if (result && result.changed) {
            inspectRequest(details, 'html', 'modified', null, 'HTML elements removed',
              started, { source: 'html', reason: 'HTML stream' });
          }
        },
        onError: (error, reason) => {
          state.active = false;
          state.failed = true;
          inspectRequest(details, 'html', 'skipped', null,
            reason === 'too-large' ? 'body exceeds stream limit' : String(error || reason),
            started, { source: 'html', reason: reason || 'stream error' });
        },
        onCancel: () => { state.active = false; state.failed = true; }
      });
      state.handle = handle;
      state.active = handle.active;
      return state;
    }

    function declaredHtmlCharset(headers) {
      const header = headers.find(item =>
        String(item && item.name || '').toLowerCase() === 'content-type');
      const match = /charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i
        .exec(String(header && header.value || ''));
      return (match && (match[1] || match[2] || match[3]) || '').toLowerCase();
    }

    function unsafeHtmlResponse(headers) {
      const charset = declaredHtmlCharset(headers);
      if (charset && !HTML_UTF8_CHARSETS.has(charset)) return true;
      const encoding = headers.find(item =>
        String(item && item.name || '').toLowerCase() === 'content-encoding');
      const value = String(encoding && encoding.value || '').trim().toLowerCase();
      return Boolean(value && value !== 'identity');
    }

    function normalizeHtmlHeaders(headers, requestId, details, started) {
      const state = ctx.htmlStreams.get(requestId);
      if (!state) return headers;
      if (unsafeHtmlResponse(headers)) {
        if (state.handle && state.handle.cancel()) {
          inspectRequest(details, 'html', 'skipped', null, 'unsupported response encoding', started,
            { source: 'html', reason: 'encoding' });
        }
        state.failed = true;
        return headers;
      }
      if (!state.active && !state.changed) return headers;
      const next = headers.map(header => {
        const name = String(header && header.name || '').toLowerCase();
        if (name === 'content-type' && !/charset\s*=/i.test(String(header.value || ''))) {
          return Object.assign({}, header, {
            value: String(header.value || '').trim() + '; charset=utf-8'
          });
        }
        return header;
      }).filter(header =>
        !HTML_HEADER_NAMES.has(String(header && header.name || '').toLowerCase()));
      if (next.length !== headers.length ||
        next.some((header, index) => header !== headers[index])) {
        inspectRequest(details, 'html', 'modified', null, 'stream headers normalized', started,
          { source: 'html', reason: 'normalize headers' });
      }
      return next;
    }

    function decodeParamName(raw) {
      const equals = raw.indexOf('=');
      const token = equals === -1 ? raw : raw.slice(0, equals);
      try {
        return decodeURIComponent(token.replace(/\+/g, ' '));
      } catch (error) {
        return token;
      }
    }

    // Regex values match the raw `name=value` pair, while plain values match
    // the decoded name. Removing by name drops that name once even when several
    // pairs share it.
    function removeParamPairs(u, value, regex) {
      const pairs = (u.search ? u.search.slice(1).split('&').filter(Boolean) : [])
        .map(raw => {
          const equals = raw.indexOf('=');
          return {
            raw,
            name: decodeParamName(raw),
            pair: equals === -1 ? raw + '=' : raw
          };
        });
      const removed = new Set();
      pairs.forEach(pair => {
        if (regex) {
          regex.lastIndex = 0;
          if (regex.test(pair.pair)) removed.add(pair.name);
        } else if (pair.name === value) {
          removed.add(pair.name);
        }
      });
      if (!removed.size) return false;
      const next = pairs.filter(pair => !removed.has(pair.name))
        .map(pair => pair.raw)
        .join('&');
      u.search = next ? '?' + next : '';
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
          } else if (removeParamPairs(u, value, rule.regex || null)) {
            changed = true;
          }
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

    function dynamicDecision(details, scope, url, type) {
      const source = topHostFor(details, scope);
      if (!source || core.DYNAMIC_IGNORED_TYPES.has(type)) return null;
      return ctx.dynamicDecision(source, matchHostsFor(url), type);
    }

    function dynamicRuleText(rule) {
      if (!rule) return '';
      if (ctx.globals.WildFireStore && ctx.globals.WildFireStore.formatDynamicRule) {
        return ctx.globals.WildFireStore.formatDynamicRule(rule);
      }
      return rule.source + ' ' + rule.destination + ' ' + rule.type + ' ' + rule.action;
    }

    function dynamicRuleDescriptor(rule) {
      return { raw: dynamicRuleText(rule), sourceKind: 'dynamic', hash: '' };
    }

    function inspectDynamic(details, decision, found, started) {
      if (!found) return;
      inspectRequest(details, 'dynamic', decision, dynamicRuleDescriptor(found),
        dynamicRuleText(found), started,
        { source: 'dynamic', reason: found.action });
    }

    function topHostFor(details, scope) {
      return scope.topHost ||
        ctx.safeHost(ctx.pageStore.topUrlForTab(details.tabId)) ||
        ctx.countHostFor(details, scope.host);
    }

    // DNS resolution is asynchronous; the blocking listener only reads the
    // canonical names already present in the local cache.
    function matchHostsFor(url) {
      const host = ctx.safeHost(url) || String(url || '').trim().toLowerCase();
      return ctx.cname ? ctx.cname.hostsFor(host) : [];
    }

    function matchScope(url, documentUrl, topHost) {
      return {
        target: matchHostsFor(url),
        document: matchHostsFor(documentUrl),
        top: matchHostsFor(topHost)
      };
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
      if (!ctx.logger || !ctx.logger.enabled) return;
      const ms = started ? ctx.monotonicMs() - started : 0;
      const scope = ctx.pageStore.contextFor(details);
      const info = meta || {};
      ctx.recordDecision({
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
      const started = ctx.logger && ctx.logger.enabled ? ctx.monotonicMs() : 0;
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
      const dynamic = dynamicDecision(details, scope, details.url, type);
      if (dynamic && dynamic.action === 'allow') {
        inspectDynamic(details, 'skipped', dynamic, started);
        return undefined;
      }
      if (dynamic && dynamic.action === 'block') {
        ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
        inspectDynamic(details, 'blocked', dynamic, started);
        return { cancel: true };
      }
      inspectDynamic(details, 'noop', dynamic, started);
      if (type === 'document' && ctx.pageStore.hasPopup(details.tabId)) {
        const sourceUrl = popupSource(details);
        if (!ctx.siteDisabled(ctx.safeHost(sourceUrl))) {
          const popup = ctx.measuredMatch('request', () =>
            ctx.engine.matchPopup(details.url, sourceUrl,
              matchScope(details.url, sourceUrl, ctx.safeHost(sourceUrl) || scope.topHost)));
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

      const matchHosts = matchScope(details.url, documentUrl, scope.topHost);
      const result = ctx.measuredMatch('request', () =>
        ctx.engine.matchRequest(details.url, type, documentUrl, matchHosts));
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
          ctx.engine.matchRemoveparam(details.url, type, documentUrl, matchHosts));
        if (rp.params && rp.params.length) {
          const cleanUrl = applyRemoveparam(details.url, rp.params);
          if (cleanUrl && cleanUrl !== details.url) {
            ctx.recordBlock(details.tabId, ctx.countHostFor(details, host));
            inspectRequest(details, 'request', 'redirected', null, 'removeparam', started,
              { phase: 'removeparam', source: 'removeparam',
                reason: rp.params.map(param => param.regex ? String(param.regex) : param.value).join(', ') });
            return { redirectUrl: cleanUrl };
          }
        }
      }
      if (type === 'document' || type === 'subdocument') {
        startHtmlFilter(details, type, documentUrl, matchHosts, started);
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
      const dynamic = dynamicDecision(details, scope, details.url, type);
      if (dynamic && dynamic.action === 'allow') {
        inspectDynamic(details, 'skipped', dynamic, 0);
        return;
      }
      inspectDynamic(details, 'noop', dynamic, 0);
      const result = ctx.measuredMatch('removeheader-request', () =>
        ctx.engine.matchRemoveheader(details.url, type, documentUrl,
          matchScope(details.url, documentUrl, siteHost || scope.topHost)));
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
      const dynamic = dynamicDecision(details, scope, details.url, 'other');
      if (dynamic && dynamic.action === 'allow') {
        inspectDynamic(details, 'skipped', dynamic, 0);
        return undefined;
      }
      inspectDynamic(details, 'noop', dynamic, 0);
      if (ctx.diagnostics.enabled) ctx.cspReportsObserved.requestsCancelled += 1;
      inspectRequest(details, 'csp-report', 'blocked', null, 'CSP report', 0,
        { source: 'csp-report', reason: 'report endpoint' });
      return { cancel: true };
    }

    function onHeadersReceived(details) {
      if (details.type === 'csp_report') return undefined;
      const started = ctx.logger && ctx.logger.enabled ? ctx.monotonicMs() : 0;
      // A rewrite stream may already exist even if the user just paused the
      // extension; its headers still need normalizing so the body stays valid.
      const rewriteType = ctx.rewrites.get(details.requestId);
      const htmlState = ctx.htmlStreams && ctx.htmlStreams.get(details.requestId);
      const htmlActions = ctx.htmlActions && ctx.htmlActions.get(details.requestId);
      const skipReason = ctx.urlSkipReason(details.url);
      if ((!ctx.state.enabled || skipReason) && !rewriteType && !htmlState && !htmlActions) {
        return undefined;
      }

      ctx.pageStore.observeRequest(details);
      const type = globals.mapResourceType(details.type);
      const scope = ctx.pageStore.contextFor(details);
      // For a main document the response itself is the matching scope; pause
      // and dynamic rules always follow the tab's top-level site.
      const documentUrl = type === 'document' ? details.url : scope.documentUrl;
      const siteHost = topHostFor(details, scope);
      const disabled = ctx.siteDisabled(siteHost);
      if (disabled && !rewriteType && !htmlState && !htmlActions) return undefined;
      const dynamic = dynamicDecision(details, scope, details.url, type);
      const dynamicAllowed = Boolean(dynamic && dynamic.action === 'allow');
      if (dynamic) inspectDynamic(details, dynamicAllowed ? 'skipped' : 'noop', dynamic, started);

      let headers = details.responseHeaders || [];
      let changed = false;
      if (htmlState) {
        const normalized = normalizeHtmlHeaders(headers, details.requestId, details, started);
        if (normalized !== headers) {
          headers = normalized;
          changed = true;
        }
      }
      if (rewriteType && globals.RewriteResources) {
        headers = globals.RewriteResources.withHeaders(headers, rewriteType);
        changed = true;
        inspectRequest(details, 'rewrite', 'rewritten', null, 'response headers', started,
          { source: 'rewrite', reason: 'normalize headers' });
      }

      if (htmlActions && htmlActions.headers.length && ctx.state.enabled &&
        !disabled && !skipReason && !dynamicAllowed) {
        const next = removeHeaders(headers, htmlActions.headers, 'response');
        if (next !== headers) {
          headers = next;
          changed = true;
          inspectRequest(details, 'responseheader', 'modified', null,
            htmlActions.headers.join(', '), started,
            { source: 'responseheader', reason: 'HTML response header filter' });
        }
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
          const matchHosts = matchScope(details.url, documentUrl, siteHost || scope.topHost);
          const rh = ctx.measuredMatch('removeheader-response', () =>
            ctx.engine.matchRemoveheader(details.url, type, documentUrl, matchHosts));
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
          ctx.engine.matchCsp(details.url, type, documentUrl,
            matchScope(details.url, documentUrl, siteHost || scope.topHost)));
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

      const result = ctx.engine.matchPopup(details.url, sourceUrl,
        matchScope(details.url, sourceUrl, ctx.safeHost(sourceUrl)));
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
      startHtmlFilter,
      normalizeHtmlHeaders,
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

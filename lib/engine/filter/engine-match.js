/* WildFire filter engine: request matching hot path (candidates, exceptions, redirects).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { MAX_REGEX_URL_LENGTH, domainMatches, plainPatternMatches, segmentsPatternMatches, parentHosts, urlTokens, captureGroups, hostnameOf } = NS;

  const FilterEngine = global.FilterEngine;

  function startMatchStats(engine) {
    if (!engine._matchStatsEnabled) return;
    engine._lastMatchStats = { candidates: 0, regexEvaluations: 0 };
  }

  FilterEngine.prototype._ruleApplies = function _ruleApplies(rule, url, type, docHost, targetHost, allowDocument) {
    // Request filtering needs an explicit $document rule for navigations;
    // response-header filtering has no navigation to cancel, so it applies
    // to the main document as well.
    if (type === 'document' && !allowDocument &&
      !(rule.types && rule.types.has('document'))) return false;
    if (rule.popup && type !== 'document') return false;
    if (rule.types && !rule.types.has(type)) return false;
    if (rule.excludedTypes && rule.excludedTypes.has(type)) return false;

    if (rule.thirdParty !== null) {
      const thirdParty = Boolean(docHost && targetHost &&
        this._registrable(docHost) !== this._registrable(targetHost));
      if (thirdParty !== rule.thirdParty) return false;
    }

    if (rule.includeDomains || rule.excludeDomains) {
      if (!docHost) return false;
      if (rule.includeDomains && !rule.includeDomains.some(domain => domainMatches(docHost, domain))) return false;
      if (rule.excludeDomains && rule.excludeDomains.some(domain => domainMatches(docHost, domain))) return false;
    }

    if (rule.isPlain) return plainPatternMatches(rule, url);
    if (rule.isSegments) return segmentsPatternMatches(rule, url);
    if (rule.isRegex && url.length > MAX_REGEX_URL_LENGTH) return false;
    if (!rule.regex) return false;
    if (this._lastMatchStats) this._lastMatchStats.regexEvaluations += 1;
    return rule.regex.test(url);
  };

  FilterEngine.prototype._candidates = function _candidates(url, targetHost, skip, realm) {
    const gen = ++this._seenGen;
    if (gen > 0x7ffffffe) {
      this._seen = [];
      this._seenGen = 1;
    }
    const seen = this._seen;
    const candidates = [];
    let needsSort = false;
    let lastOrder = -1;

    const addRule = rule => {
      const order = rule.order;
      if (seen[order] === gen) return;
      seen[order] = gen;
      if (skip && skip(rule)) return;
      if (order < lastOrder) needsSort = true;
      lastOrder = order;
      candidates.push(rule);
    };

    const index = this._indexSet(realm);
    index.unindexed.forEach(addRule);
    parentHosts(targetHost).forEach(host => {
      const bucket = index.host.get(host);
      if (bucket) bucket.forEach(addRule);
    });
    urlTokens(url).forEach(token => {
      const bucket = index.token.get(token);
      if (bucket) bucket.forEach(addRule);
    });

    if (needsSort) candidates.sort((a, b) => a.order - b.order);
    if (this._lastMatchStats) this._lastMatchStats.candidates = candidates.length;
    return candidates;
  };

  FilterEngine.prototype._matchFrom = function _matchFrom(candidates, url, type, docHost, targetHost) {
    const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost);
    let blocker = null;
    let important = null;
    let exception = null;
    // Exception normally wins over blockers, but an $important blocker overrides
    // exceptions (uBO/adblock-rust semantics). Scan all candidates in load order.
    candidates.some(rule => {
      if (!applies(rule)) return false;
      if (rule.isException) {
        if (!exception) exception = rule;
        return false;
      }
      if (rule.important && !important) important = rule;
      if (!blocker) blocker = rule;
      return Boolean(important && exception);
    });
    if (important) {
      const rewrite = important.rewrite || important.rewriteRule
        ? {
          alias: important.rewrite || important.rewriteRule,
          captures: important.rewriteRule ? captureGroups(important, url) : []
        }
        : null;
      const alias = !rewrite && (important.redirectRule || important.redirect);
      const redirect = alias
        ? { alias, captures: captureGroups(important, url) }
        : null;
      return { blocked: true, rule: important, exception: null, redirect, rewrite, important: true };
    }
    if (exception) return { blocked: false, exception, redirect: null, rewrite: null, important: false };

    const rewrite = blocker && (blocker.rewrite || blocker.rewriteRule)
      ? {
        alias: blocker.rewrite || blocker.rewriteRule,
        captures: blocker.rewriteRule ? captureGroups(blocker, url) : []
      }
      : null;
    const alias = !rewrite && blocker && (blocker.redirectRule || blocker.redirect);
    const redirect = alias
      ? { alias, captures: captureGroups(blocker, url) }
      : null;
    return { blocked: Boolean(blocker), rule: blocker, exception: null, redirect, rewrite, important: false };
  };

  FilterEngine.prototype.matchRequest = function matchRequest(url, type, documentUrl) {
    startMatchStats(this);
    const targetHost = hostnameOf(url);
    const docHost = hostnameOf(documentUrl);
    // Navigations are never rewritten, so rewrite rules are not blockers for
    // documents. Redirect rules still block; the caller never serves a data URI
    // for a navigation. $popup rules are handled by matchPopup(), where the
    // source document is known; evaluating them here would misapply scoping.
    const skip = rule => rule.csp || rule.cspAll || rule.popup ||
      (type === 'document' && (rule.rewrite || rule.rewriteRule)) ||
      (rule.removeparam !== null && rule.removeparam !== undefined) || Boolean(rule.removeheader);
    const candidates = this._candidates(url, targetHost, skip);
    const result = this._matchFrom(candidates, url, type, docHost, targetHost);
    if (type === 'document') result.redirect = null;
    return result;
  };

  FilterEngine.prototype.matchPopup = function matchPopup(url, sourceUrl) {
    startMatchStats(this);
    const targetHost = hostnameOf(url);
    const sourceHost = hostnameOf(sourceUrl);
    const skip = rule => !rule.popup || rule.csp || rule.cspAll || rule.rewrite || rule.rewriteRule ||
      rule.redirect || rule.redirectRule ||
      (rule.removeparam !== null && rule.removeparam !== undefined) || Boolean(rule.removeheader);
    const candidates = this._candidates(url, targetHost, skip);
    return this._matchFrom(candidates, url, 'document', sourceHost, targetHost);
  };

  // Used by webRequest.onHeadersReceived. CSP lives in its own rule realm: a
  // plain network exception cannot suppress a header action. A bare @@...$csp
  // exception stops all injection; @@...$csp=alias stops only that alias.
  FilterEngine.prototype.matchCsp = function matchCsp(url, type, documentUrl) {
    startMatchStats(this);
    const targetHost = hostnameOf(url);
    const docHost = hostnameOf(documentUrl);
    const candidates = this._candidates(url, targetHost, rule => rule.popup, 'csp');
    const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost, true);
    const exceptionAliases = new Set();
    let exceptionAll = false;
    candidates.forEach(rule => {
      if (!rule.isException || !applies(rule)) return;
      if (rule.cspAll) exceptionAll = true;
      else if (rule.csp) exceptionAliases.add(rule.csp);
    });
    if (exceptionAll) return { directives: [], exception: true };

    const directives = candidates
      .filter(rule => !rule.isException && rule.csp && !exceptionAliases.has(rule.csp) && applies(rule))
      .map(rule => this._cspDirective(rule.csp))
      .filter((directive, index, all) => directive && all.indexOf(directive) === index);
    return {
      directives,
      exception: exceptionAliases.size > 0 && directives.length === 0
    };
  };

  FilterEngine.prototype.matchRemoveparam = function matchRemoveparam(url, type, documentUrl) {
    startMatchStats(this);
    const targetHost = hostnameOf(url);
    const docHost = hostnameOf(documentUrl);
    const candidates = this._candidates(url, targetHost, rule => rule.popup ||
      rule.csp || rule.cspAll ||
      rule.removeparam === null || rule.removeparam === undefined);
    const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost, true);
    let exception = false;
    let importantException = false;
    const params = [];
    candidates.forEach(rule => {
      if (!applies(rule)) return;
      if (rule.isException) {
        exception = true;
        if (rule.important) importantException = true;
        return;
      }
      if (rule.important || !exception) params.push({ value: rule.removeparam, regex: rule.removeparamRegex || null, important: Boolean(rule.important) });
    });
    const active = importantException ? [] : (exception ? params.filter(p => p.important) : params);
    return { params: active, exception: exception && active.length === 0 };
  };

  FilterEngine.prototype.matchRemoveheader = function matchRemoveheader(url, type, documentUrl) {
    startMatchStats(this);
    const targetHost = hostnameOf(url);
    const docHost = hostnameOf(documentUrl);
    const candidates = this._candidates(url, targetHost, rule => rule.popup ||
      rule.csp || rule.cspAll || !rule.removeheader);
    const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost, true);
    let exception = false;
    let importantException = false;
    const headers = [];
    candidates.forEach(rule => {
      if (!applies(rule)) return;
      if (rule.isException) {
        exception = true;
        if (rule.important) importantException = true;
        return;
      }
      if (rule.important || !exception) headers.push({ name: rule.removeheader, important: Boolean(rule.important) });
    });
    const active = importantException ? [] : (exception ? headers.filter(h => h.important) : headers);
    return {
      headers: active.map(h => h.name).filter((name, index, all) => all.indexOf(name) === index),
      exception: exception && active.length === 0
    };
  };
})(this);

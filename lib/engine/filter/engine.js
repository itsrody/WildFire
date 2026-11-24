/* WildFire - minimal Adblock-ish filter parser and matcher.
 *
 * Supported:
 *   ||example.com^            domain-anchored network filter
 *   |http://example.com/path| start/end anchored filter
 *   example.com*ad.js         wildcard filter
 *   /regex/flags              safe regular-expression filter
 *   @@||example.com^          exception (un-block)
 *   $script,image,third-party resource type / party options
 *   $domain=example.com|~foo.com  document domain options
 *   $document, $popup         navigation / popup filters
 *   $redirect=alias           serve a WildFire data-URI resource
 *   $rewrite=alias            replace a response with a WildFire-owned body
 *   /regex/$rewrite-rule=alias  fill a WildFire template from regex captures
 *   $csp=alias                add a curated WildFire CSP response header
 *   example.com##.ad          element hiding (cosmetic)
 *   example.com##.ad:has-text("x")  procedural cosmetic rule
 *   example.com##.ad:contains("x")  subtree text procedural rule
 *   example.com##.ad:nth-ancestor(2) hide an ancestor of a match
 *   example.com#@#.ad         cosmetic exception
 *   example.com##+js(alias,arg)  curated WildFire scriptlet alias
 *
 * Deliberately not supported: filter-supplied header, script, or response-body
 * values. Rewrite templates are WildFire-owned and filled only from safe captures.
 */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter;
  const { CAP, COMPILED_VERSION, TOKEN_LENGTH, BAD_TOKEN_USAGE, tokenUsage, fallbackRegistrable, detectSourceKind, fnv1a32, parseScriptlet, parseAdguardScriptlet, parseCosmetic, parseNetwork, normalizeType } = NS;

  class FilterEngine {
    constructor(getDomain, resolveCsp, scriptlets, hasRewrite, hasRewriteRule) {
      this.getDomain = typeof getDomain === 'function' ? getDomain : null;
      // Injected so this library stays browser-free and unit-testable. Without
      // a resolver, $csp rules are rejected instead of weakening a response.
      this.resolveCsp = typeof resolveCsp === 'function' ? resolveCsp : null;
      // WildFireScriptlets owns the alias list and argument validation; the
      // engine never interprets filter-supplied code.
      this.scriptlets = scriptlets && typeof scriptlets.validate === 'function'
        ? scriptlets
        : null;
      // RewriteResources owns the fixed alias-to-body mapping. A rule with an
      // alias the registry does not know is rejected, never turned into a
      // plain network blocker.
      this.hasRewrite = typeof hasRewrite === 'function' ? hasRewrite : null;
      this.hasRewriteRule = typeof hasRewriteRule === 'function'
        ? hasRewriteRule
        : this.hasRewrite;
      this.reset();
    }

    _cspDirective(alias) {
      if (!this.resolveCsp) return '';
      try {
        return this.resolveCsp(alias) || '';
      } catch (error) {
        return '';
      }
    }

    _rewriteAvailable(alias, forRule) {
      const resolver = forRule ? this.hasRewriteRule : this.hasRewrite;
      if (!resolver) return false;
      try {
        return Boolean(resolver(alias));
      } catch (error) {
        return false;
      }
    }

    _registrable(host) {
      if (!this.getDomain) return fallbackRegistrable(host);
      try {
        return this.getDomain(host) || fallbackRegistrable(host);
      } catch (error) {
        return fallbackRegistrable(host);
      }
    }

    reset() {
      this.hostRules = new Map();
      this.tokenRules = new Map();
      this.unindexedRules = [];
      this.rejectedRegex = [];
      this.rejectedCsp = [];
      this.rejectedRewrite = [];
      this.rejectedScriptlets = [];
      this.cosmeticByDomain = new Map();
      this.cosmeticExceptionsByDomain = new Map();
      this.genericCosmetic = [];
      this.genericCosmeticExceptions = [];
      this.proceduralByDomain = new Map();
      this.proceduralExceptionsByDomain = new Map();
      this.genericProcedural = new Map();
      this.genericProceduralExceptions = new Set();
      this.rejectedCosmetic = [];
      this.scriptletRules = [];
      this._seen = [];
      this._seenGen = 0;
      this._tokenUsage = new Map();
      this.counts = {
        network: 0, exceptions: 0, cosmetic: 0, csp: 0, scriptlets: 0, rewrite: 0
      };
      this.diagnostics = [];
      this.capabilities = 0;
      this._matchStatsEnabled = false;
      this._lastMatchStats = null;
    }

    _ruleTokens(rule) {
      const runs = String(rule.pattern || '')
        .toLowerCase()
        .match(/[a-z0-9%]{4,}/g) || [];
      if (!runs.length) return null;
      const tokens = new Set();
      runs.forEach(run => {
        const last = run.length - TOKEN_LENGTH;
        [0, Math.floor(last / 2), last]
          .map(index => run.slice(index, index + TOKEN_LENGTH))
          .forEach(token => tokens.add(token));
      });
      return Array.from(tokens);
    }

    // Generic rules are indexed by one token selected by expected bucket cost.
    // Inspired by adblock-rust's token selector: avoid very common tokens and
    // prefer least-used buckets, keeping match-time candidate sets small.
    _indexRule(rule) {
      const tokens = this._ruleTokens(rule);
      if (!tokens) return false;
      const selected = tokens.reduce((best, token) => {
        const usage = this._tokenUsage.get(token) || tokenUsage(token);
        if (!best || usage < best.usage) return { token, usage };
        return best;
      }, null);
      if (!selected) return false;
      const token = selected.token;
      rule._tk = [token];
      if (!this.tokenRules.has(token)) this.tokenRules.set(token, []);
      this.tokenRules.get(token).push(rule);
      // Cap effective usage to keep Map values stable and avoid unbounded growth
      // influence; selection remains deterministic and favors less-hot buckets.
      const prev = this._tokenUsage.get(token) || tokenUsage(token);
      this._tokenUsage.set(token, prev < BAD_TOKEN_USAGE ? prev + 1 : prev);
      return true;
    }

    _addNetworkRule(rule) {
      if (rule.csp) {
        if (!this._cspDirective(rule.csp)) {
          this.rejectedCsp.push({
            line: rule.pattern, lineNumber: rule.sourceLine || 0,
            reason: 'unknown CSP alias: ' + rule.csp
          });
          this.diagnostics.push({
            type: 'rejected', category: 'csp', reason: 'unknown CSP alias: ' + rule.csp,
            sourceKind: rule.sourceKind || 'wildfire', hash: rule.hash || '',
            lineNumber: rule.sourceLine || 0
          });
          return;
        }
        this.counts.csp++;
      }
      const rewriteAlias = rule.rewrite || rule.rewriteRule;
      if (rewriteAlias) {
        if (!this._rewriteAvailable(rewriteAlias, Boolean(rule.rewriteRule))) {
          this.rejectedRewrite.push({
            line: rule.pattern, lineNumber: rule.sourceLine || 0,
            reason: 'unknown rewrite alias: ' + rewriteAlias
          });
          this.diagnostics.push({
            type: 'rejected', category: 'rewrite', reason: 'unknown rewrite alias: ' + rewriteAlias,
            sourceKind: rule.sourceKind || 'wildfire', hash: rule.hash || '',
            lineNumber: rule.sourceLine || 0
          });
          return;
        }
        this.counts.rewrite++;
      }
      rule.order = this.counts.network++;
      if (rule.isException) this.counts.exceptions++;

      let cap = CAP.NETWORK;
      if (rule.isException) cap |= CAP.EXCEPTION;
      if (rule.important) cap |= CAP.IMPORTANT;
      if (rule.redirect || rule.redirectRule) cap |= CAP.REDIRECT;
      if (rule.rewrite || rule.rewriteRule) cap |= CAP.REWRITE;
      if (rule.csp) cap |= CAP.CSP;
      if (rule.popup) cap |= CAP.POPUP;
      if (rule.types && rule.types.has('document')) cap |= CAP.DOCUMENT;
      if (rule.thirdParty !== null) cap |= CAP.THIRD_PARTY;
      if (rule.includeDomains || rule.excludeDomains) cap |= CAP.DOMAIN;
      if (rule.isRegex) cap |= CAP.REGEX;
      if (rule.generichide) cap |= CAP.GENERICHIDE;
      if (rule.elemhide) cap |= CAP.ELEMHIDE;
      if (rule.specifichide) cap |= CAP.SPECIFICHIDE;
      if (rule.removeparam !== null && rule.removeparam !== undefined) cap |= CAP.REMOVEPARAM;
      if (rule.removeheader) cap |= CAP.REMOVEHEADER;
      rule.cap = cap;
      this.capabilities |= cap;

      if (rule.hostKey) {
        if (!this.hostRules.has(rule.hostKey)) this.hostRules.set(rule.hostKey, []);
        this.hostRules.get(rule.hostKey).push(rule);
      } else if (Array.isArray(rule._tk) && rule._tk.length && typeof rule._tk[0] === 'string') {
        const token = rule._tk[0];
        if (!this.tokenRules.has(token)) this.tokenRules.set(token, []);
        this.tokenRules.get(token).push(rule);
        const prev = this._tokenUsage.get(token) || tokenUsage(token);
        this._tokenUsage.set(token, prev < BAD_TOKEN_USAGE ? prev + 1 : prev);
      } else if (rule.isRegex || !this._indexRule(rule)) {
        this.unindexedRules.push(rule);
      }
    }

    _networkRuleKey(rule) {
      const types = rule.types ? Array.from(rule.types).sort().join(',') : '';
      const xtypes = rule.excludedTypes ? Array.from(rule.excludedTypes).sort().join(',') : '';
      const id = rule.includeDomains ? rule.includeDomains.slice().sort().join(',') : '';
      const xd = rule.excludeDomains ? rule.excludeDomains.slice().sort().join(',') : '';
      return [
        rule.isException ? '1' : '0',
        rule.pattern,
        rule.isRegex ? 'r' : rule.isPlain ? 'p' : rule.isSegments ? 's' : 'g',
        rule.matchCase ? '1' : '0',
        rule.popup ? '1' : '0',
        rule.important ? '1' : '0',
        rule.thirdParty === null ? '0' : rule.thirdParty ? '1' : '-1',
        rule.redirect || '',
        rule.redirectRule || '',
        rule.rewrite || '',
        rule.rewriteRule || '',
        rule.csp || '',
        rule.generichide ? '1' : '0',
        rule.elemhide ? '1' : '0',
        rule.specifichide ? '1' : '0',
        rule.removeparam === null || rule.removeparam === undefined ? '' : 'rp=' + rule.removeparam,
        rule.removeheader || '',
        types, xtypes, id, xd
      ].join('|');
    }

    load(text, options) {
      const append = Boolean(options && options.append);
      if (!append) this.reset();
      const lines = String(text == null ? '' : text).split(/\r?\n/);
      const pendingNetwork = [];

      lines.forEach((raw, index) => {
        const line = raw.trim();
        const lineNumber = index + 1;
        if (!line || line.startsWith('!')) return;
        if (line.startsWith('#') && line.indexOf('##') === -1 && line.indexOf('#@#') === -1 &&
          line.indexOf('#?#') === -1 && line.indexOf('#@?#') === -1 &&
          line.indexOf('#%#') === -1 && line.indexOf('#@%#') === -1) return;

        const scriptlet = parseScriptlet(line) || parseAdguardScriptlet(line);
        if (scriptlet) {
          scriptlet.sourceKind = detectSourceKind(line, scriptlet.syntax);
          scriptlet.hash = fnv1a32(line);
          const error = scriptlet.error || (this.scriptlets
            ? this.scriptlets.validate(scriptlet.alias, scriptlet.args, scriptlet.syntax)
            : 'scriptlet registry unavailable');
          if (error) {
            this.rejectedScriptlets.push({ line, lineNumber, reason: error });
            this.diagnostics.push({
              type: 'rejected', category: 'scriptlet', reason: error,
              sourceKind: scriptlet.sourceKind, hash: scriptlet.hash, lineNumber
            });
            return;
          }
          this.counts.scriptlets++;
          this.capabilities |= CAP.SCRIPTLET;
          this.scriptletRules.push(scriptlet);
          return;
        }

        if (line.indexOf('##') !== -1 || line.indexOf('#@#') !== -1 || line.indexOf('#?#') !== -1 || line.indexOf('#@?#') !== -1) {
          const cosmetic = parseCosmetic(line);
          if (!cosmetic) return;
          cosmetic.sourceKind = detectSourceKind(line);
          cosmetic.hash = fnv1a32(line);
          if (cosmetic.error) {
            this.rejectedCosmetic.push({ line, lineNumber, reason: cosmetic.error });
            this.diagnostics.push({
              type: 'rejected', category: 'cosmetic', reason: cosmetic.error,
              sourceKind: cosmetic.sourceKind, hash: cosmetic.hash, lineNumber
            });
            return;
          }
          this.counts.cosmetic++;
          this.capabilities |= cosmetic.procedural ? (CAP.COSMETIC | CAP.PROCEDURAL) : CAP.COSMETIC;
          if (cosmetic.procedural) this._addProcedural(cosmetic);
          else this._addCosmetic(cosmetic);
          return;
        }

        const rule = parseNetwork(line);
        if (!rule) return;
        rule.sourceKind = detectSourceKind(line);
        rule.hash = fnv1a32(line);
        if (rule.error) {
          this.rejectedRegex.push({ line, lineNumber, reason: rule.error });
          this.diagnostics.push({
            type: 'rejected', category: 'network', reason: rule.error,
            sourceKind: rule.sourceKind, hash: rule.hash, lineNumber
          });
          return;
        }
        rule.sourceLine = lineNumber;
        pendingNetwork.push(rule);
      });

      // Compile-time $badfilter: remove the matching base rule(s) and the
      // badfilter rule itself. No per-request badfilter checks.
      const tombstones = new Map();
      pendingNetwork.forEach(rule => {
        if (!rule.badfilter) return;
        this.capabilities |= CAP.BADFILTER;
        tombstones.set(this._networkRuleKey(rule), (tombstones.get(this._networkRuleKey(rule)) || 0) + 1);
      });
      pendingNetwork.forEach(rule => {
        if (rule.badfilter) return;
        const key = this._networkRuleKey(rule);
        const n = tombstones.get(key) || 0;
        if (n > 0) {
          tombstones.set(key, n - 1);
          this.diagnostics.push({
            type: 'neutralized', category: 'network', reason: 'badfilter removed rule',
            sourceKind: rule.sourceKind, hash: rule.hash,
            lineNumber: rule.sourceLine || 0
          });
          return;
        }
        this._addNetworkRule(rule);
      });
      tombstones.forEach((remaining, key) => {
        if (remaining <= 0) return;
        this.diagnostics.push({
          type: 'orphan', category: 'network', reason: 'badfilter had no matching rule: ' + key,
          sourceKind: 'wildfire', hash: ''
        });
      });
    }

    static get COMPILED_VERSION() { return COMPILED_VERSION; }
    static get CAP() { return CAP; }

    getCapabilities() { return this.capabilities; }
    hasCapability(flag) { return (this.capabilities & flag) === flag; }
    getDiagnostics() { return this.diagnostics.slice(); }
    setMatchStatsEnabled(enabled) {
      this._matchStatsEnabled = Boolean(enabled);
      this._lastMatchStats = null;
    }
    getLastMatchStats() {
      const stats = this._lastMatchStats;
      return {
        candidates: stats ? stats.candidates : 0,
        regexEvaluations: stats ? stats.regexEvaluations : 0
      };
    }
  }

  NS.FilterEngine = FilterEngine;
  global.FilterEngine = FilterEngine;
  global.mapResourceType = function mapResourceType(type) {
    return normalizeType(type) || 'other';
  };
})(this);

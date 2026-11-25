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
  const { CAP, COMPILED_VERSION, TOKEN_LENGTH, BAD_TOKEN_USAGE, TOKEN_FREQUENCY_WEIGHT, DECISION_CACHE_LIMIT, tokenUsage, fallbackRegistrable, detectSourceKind, fnv1a32, parseScriptlet, parseAdguardScriptlet, parseCosmetic, parseNetwork, isLowCostProcedural, normalizeType } = NS;

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
      // Network, CSP and document-hide rules live in separate realms so a
      // document exception can never suppress a request or a header action.
      this.hostRules = new Map();
      this.hostTrie = { children: new Map(), rules: [] };
      this.tokenRules = new Map();
      this.unindexedRules = [];
      this.cspHostRules = new Map();
      this.cspHostTrie = { children: new Map(), rules: [] };
      this.cspTokenRules = new Map();
      this.cspUnindexedRules = [];
      this.hideHostRules = new Map();
      this.hideHostTrie = { children: new Map(), rules: [] };
      this.hideTokenRules = new Map();
      this.hideUnindexedRules = [];
      this.rejectedRegex = [];
      this.rejectedCsp = [];
      this.rejectedRewrite = [];
      this.rejectedScriptlets = [];
      this.ignoredOptions = [];
      this.cosmeticByDomain = new Map();
      this.cosmeticExceptionsByDomain = new Map();
      this.genericCosmetic = [];
      this.genericCosmeticExceptions = [];
      this.proceduralByDomain = new Map();
      this.proceduralExceptionsByDomain = new Map();
      this.genericProcedural = [];
      this.genericProceduralExceptions = [];
      this.rejectedCosmetic = [];
      this.scriptletRules = [];
      this._seen = [];
      this._seenGen = 0;
      this._tokenUsage = new Map();
      this._tokenFrequency = new Map();
      this._decisionCache = new Map();
      this._decisionGen = 0;
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

    _indexSet(realm) {
      if (realm === 'csp') {
        return {
          host: this.cspHostRules,
          hostTrie: this.cspHostTrie,
          token: this.cspTokenRules,
          unindexed: this.cspUnindexedRules
        };
      }
      if (realm === 'hide') {
        return {
          host: this.hideHostRules,
          hostTrie: this.hideHostTrie,
          token: this.hideTokenRules,
          unindexed: this.hideUnindexedRules
        };
      }
      return {
        host: this.hostRules, hostTrie: this.hostTrie,
        token: this.tokenRules, unindexed: this.unindexedRules
      };
    }

    // Host rules stay in the flat map for diagnostics and compatibility, and
    // also in a reversed-label trie so candidate lookup walks exact suffixes
    // without constructing every parent-host string twice.
    _indexHost(index, hostKey, rule) {
      const host = String(hostKey).toLowerCase().replace(/\.$/, '');
      if (!index.host.has(host)) index.host.set(host, []);
      index.host.get(host).push(rule);
      let node = index.hostTrie;
      host.split('.').reverse().forEach(label => {
        if (!node.children.has(label)) node.children.set(label, { children: new Map(), rules: [] });
        node = node.children.get(label);
      });
      node.rules.push(rule);
    }

    invalidateDecisionCache() {
      this._decisionCache.clear();
      this._decisionGen += 1;
    }

    // Corpus frequency is gathered once per load so a token used by thousands
    // of rules is never chosen when a distinctive token exists in the pattern.
    _countRuleTokens(rule) {
      if (rule.badfilter || rule.hostKey || rule.hostSelector || rule.isRegex) return;
      const tokens = Array.isArray(rule._tokens) ? rule._tokens : this._ruleTokens(rule);
      if (!tokens) return;
      tokens.forEach(token => {
        this._tokenFrequency.set(token, (this._tokenFrequency.get(token) || 0) + 1);
      });
    }

    // Generic rules are indexed by one token selected by expected bucket cost.
    // Avoid very common tokens and prefer least-used, least-frequent buckets.
    _indexRule(rule, realm) {
      const tokens = Array.isArray(rule._tokens) ? rule._tokens : this._ruleTokens(rule);
      if (!tokens) return false;
      rule._tokens = tokens;
      const selected = tokens.reduce((best, token) => {
        const usage = this._tokenUsage.get(token) || tokenUsage(token);
        const frequency = this._tokenFrequency.get(token) || 1;
        const score = usage + (frequency * TOKEN_FREQUENCY_WEIGHT);
        if (!best || score < best.score) return { token, usage, score };
        return best;
      }, null);
      if (!selected) return false;
      const token = selected.token;
      rule._tk = [token];
      const index = this._indexSet(realm);
      if (!index.token.has(token)) index.token.set(token, []);
      index.token.get(token).push(rule);
      // Cap effective usage to keep Map values stable and avoid unbounded growth
      // influence; selection remains deterministic and favors less-hot buckets.
      const prev = this._tokenUsage.get(token) || tokenUsage(token);
      this._tokenUsage.set(token, prev < BAD_TOKEN_USAGE ? prev + 1 : prev);
      return true;
    }

    _addNetworkRule(rule) {
      const realm = rule.realm || (rule.generichide || rule.elemhide || rule.specifichide
        ? 'hide'
        : (rule.csp || rule.cspAll ? 'csp' : 'network'));
      rule.realm = realm;
      if (rule.cspAll && !rule.isException) return;
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

      let cap = realm === 'network' ? CAP.NETWORK : 0;
      if (rule.isException) cap |= CAP.EXCEPTION;
      if (rule.important) cap |= CAP.IMPORTANT;
      if (rule.redirect || rule.redirectRule) cap |= CAP.REDIRECT;
      if (rule.rewrite || rule.rewriteRule) cap |= CAP.REWRITE;
      if (rule.csp || rule.cspAll) cap |= CAP.CSP;
      if (rule.popup || rule.all) cap |= CAP.POPUP;
      if (rule.types && rule.types.has('document')) cap |= CAP.DOCUMENT;
      if (rule.thirdParty !== null || (rule.strictParty !== null && rule.strictParty !== undefined)) cap |= CAP.THIRD_PARTY;
      if (rule.includeDomains || rule.excludeDomains || rule.hostSelector ||
        rule.toInclude || rule.toExclude || rule.denyAllow ||
        rule.topInclude || rule.topExclude) cap |= CAP.DOMAIN;
      if (rule.topAny || rule.topInclude || rule.topExclude) cap |= CAP.DOCUMENT;
      if (rule.isRegex) cap |= CAP.REGEX;
      if (rule.generichide) cap |= CAP.GENERICHIDE;
      if (rule.elemhide) cap |= CAP.ELEMHIDE;
      if (rule.specifichide) cap |= CAP.SPECIFICHIDE;
      if (rule.removeparam !== null && rule.removeparam !== undefined) cap |= CAP.REMOVEPARAM;
      if (rule.removeheader) cap |= CAP.REMOVEHEADER;
      rule.cap = cap;
      this.capabilities |= cap;

      const index = this._indexSet(realm);
      if (rule.hostSelector) {
        index.unindexed.push(rule);
      } else if (rule.hostKey) {
        this._indexHost(index, rule.hostKey, rule);
      } else if (Array.isArray(rule._tk) && rule._tk.length && typeof rule._tk[0] === 'string') {
        const token = rule._tk[0];
        if (!index.token.has(token)) index.token.set(token, []);
        index.token.get(token).push(rule);
        const prev = this._tokenUsage.get(token) || tokenUsage(token);
        this._tokenUsage.set(token, prev < BAD_TOKEN_USAGE ? prev + 1 : prev);
      } else if (rule.isRegex || !this._indexRule(rule, realm)) {
        index.unindexed.push(rule);
      }
    }

    _networkRuleKey(rule) {
      const types = rule.types ? Array.from(rule.types).sort().join(',') : '';
      const xtypes = rule.excludedTypes ? Array.from(rule.excludedTypes).sort().join(',') : '';
      const id = rule.includeDomains ? rule.includeDomains.slice().sort().join(',') : '';
      const xd = rule.excludeDomains ? rule.excludeDomains.slice().sort().join(',') : '';
      const ti = rule.toInclude ? rule.toInclude.slice().sort().join(',') : '';
      const te = rule.toExclude ? rule.toExclude.slice().sort().join(',') : '';
      const da = rule.denyAllow ? rule.denyAllow.slice().sort().join(',') : '';
      const yi = rule.topInclude ? rule.topInclude.slice().sort().join(',') : '';
      const ye = rule.topExclude ? rule.topExclude.slice().sort().join(',') : '';
      return [
        rule.isException ? '1' : '0',
        rule.pattern,
        rule.hostSelector || '',
        rule.isRegex ? 'r' : rule.isPlain ? 'p' : rule.isSegments ? 's' : 'g',
        rule.matchCase ? '1' : '0',
        rule.popup ? '1' : '0',
        rule.all ? '1' : '0',
        rule.important ? '1' : '0',
        rule.thirdParty === null ? '0' : rule.thirdParty ? '1' : '-1',
        rule.topAny ? '1' : '0',
        rule.strictParty === null || rule.strictParty === undefined ? '0' : rule.strictParty ? '1' : '-1',
        rule.redirect || '',
        rule.redirectRule || '',
        rule.rewrite || '',
        rule.rewriteRule || '',
        rule.csp || '',
        rule.cspAll ? '1' : '0',
        rule.generichide ? '1' : '0',
        rule.elemhide ? '1' : '0',
        rule.specifichide ? '1' : '0',
        rule.removeparam === null || rule.removeparam === undefined ? '' : 'rp=' + rule.removeparam,
        rule.removeheader || '',
        types, xtypes, id, xd, ti, te, da, yi, ye
      ].join('|');
    }

    load(text, options) {
      const append = Boolean(options && options.append);
      if (!append) this.reset();
      else this.invalidateDecisionCache();
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
          // Generic JS-evaluated procedural rules would run on every page.
          // Keep only cheap generic path/native rules; domain-scoped dynamic
          // rules and generic exceptions are still allowed.
          if (!cosmetic.error && cosmetic.procedural && !cosmetic.includeDomains.length &&
            !cosmetic.isException && !isLowCostProcedural(cosmetic.procedural)) {
            cosmetic.error = 'generic procedural rules need domain scope';
          }
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
        (rule.ignoredOptions || []).forEach(option => {
          const entry = {
            line, lineNumber, name: option.name, reason: option.reason,
            sourceKind: rule.sourceKind, hash: rule.hash
          };
          Object.assign(option, entry);
          this.ignoredOptions.push(entry);
          this.diagnostics.push({
            type: 'ignored', category: 'network', reason: option.reason,
            sourceKind: rule.sourceKind, hash: rule.hash, lineNumber
          });
        });
        if (!rule.isRegex && !rule.hostKey && !rule.badfilter) {
          rule._tokens = this._ruleTokens(rule);
        }
        pendingNetwork.push(rule);
      });

      pendingNetwork.forEach(rule => this._countRuleTokens(rule));

      // Compile-time $badfilter: remove the matching base rule(s) and the
      // badfilter rule itself. No per-request badfilter checks. Building sort
      // keys for every rule is wasted work when the list has no badfilters.
      const badfilters = pendingNetwork.filter(rule => rule.badfilter);
      if (!badfilters.length) {
        pendingNetwork.forEach(rule => this._addNetworkRule(rule));
      } else {
        this.capabilities |= CAP.BADFILTER;
        const tombstones = new Map();
        badfilters.forEach(rule => {
          const key = this._networkRuleKey(rule);
          tombstones.set(key, (tombstones.get(key) || 0) + 1);
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
        regexEvaluations: stats ? stats.regexEvaluations : 0,
        cacheHits: stats ? stats.cacheHits : 0
      };
    }
  }

  NS.FilterEngine = FilterEngine;
  global.FilterEngine = FilterEngine;
  global.mapResourceType = function mapResourceType(type) {
    return normalizeType(type) || 'other';
  };
})(this);

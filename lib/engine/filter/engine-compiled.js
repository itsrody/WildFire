/* WildFire filter engine: compiled-blob serialization (toCompiled/loadCompiled).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { COMPILED_VERSION, CAP, parseSelectorTree, isLowCostProcedural, compileRemoveparamRegex } = NS;

  const FilterEngine = global.FilterEngine;

  function scopeOf(item) {
    const source = item && typeof item === 'object' ? item : {};
    return {
      include: Array.isArray(source.i) ? source.i.filter(value => typeof value === 'string' && value) : [],
      exclude: Array.isArray(source.e) ? source.e.filter(value => typeof value === 'string' && value) : []
    };
  }

  function readCosmeticEntries(list) {
    return (Array.isArray(list) ? list : []).map(item => {
      const selector = typeof item === 'string' ? item : (item && item.s);
      if (typeof selector !== 'string' || !selector) return null;
      return Object.assign({ selector }, scopeOf(item));
    }).filter(Boolean);
  }

  function readProceduralEntries(list, isException) {
    return (Array.isArray(list) ? list : []).map(item => {
      const source = typeof item === 'string' ? item : (item && item.s);
      if (typeof source !== 'string' || !source) return null;
      // Rebuild the tree from bounded parsed data instead of trusting a cached
      // object graph. This also re-applies the generic cost gate.
      const tree = parseSelectorTree(source, 0);
      if (tree.error || tree.plain) return null;
      const scope = scopeOf(item);
      if (!scope.include.length && !isException && !isLowCostProcedural(tree)) return null;
      return Object.assign({ source, tree }, scope);
    }).filter(Boolean);
  }

  FilterEngine.prototype.toCompiled = function toCompiled() {
    const network = [];
    const collect = rule => { network[rule.order] = rule; };
    const collectIndex = index => {
      if (Array.isArray(index)) index.forEach(collect);
      else index.forEach(bucket => bucket.forEach(collect));
    };
    [
      this.unindexedRules, this.hostRules, this.tokenRules,
      this.cspUnindexedRules, this.cspHostRules, this.cspTokenRules,
      this.hideUnindexedRules, this.hideHostRules, this.hideTokenRules
    ].forEach(collectIndex);
    const seen = new Set();
    const rules = network.filter(rule => rule && !seen.has(rule.order) && seen.add(rule.order));

    const serializeRule = rule => {
      const out = {
        p: rule.pattern,
        x: rule.isException ? 1 : 0,
        im: rule.important ? 1 : 0,
        mc: rule.matchCase ? 1 : 0,
        pu: rule.popup ? 1 : 0,
        al: rule.all ? 1 : 0,
        ha: rule.hostAnchor ? 1 : 0,
        sa: rule.startAnchor ? 1 : 0,
        ea: rule.endAnchor ? 1 : 0,
        hk: rule.hostKey || '',
        hs: rule.hostSelector || '',
        ne: rule.needle || '',
        re: rule.redirect || '',
        rr: rule.redirectRule || '',
        rw: rule.rewrite || '',
        rwr: rule.rewriteRule || '',
        cs: rule.csp || '',
        ca: rule.cspAll ? 1 : 0,
        rl: rule.realm || 'network',
        tp: rule.thirdParty === null ? 0 : rule.thirdParty ? 1 : -1,
        ta: rule.topAny ? 1 : 0,
        sp: rule.strictParty === null || rule.strictParty === undefined ? 0 : rule.strictParty ? 1 : -1
      };
      if (rule.isRegex && rule.regex) out.rx = { s: rule.regex.source, f: rule.regex.flags };
      if (rule.isPlain) out.pl = 1;
      if (rule.isSegments) out.sg = rule.segments;
      if (rule.types) out.ty = Array.from(rule.types);
      if (rule.excludedTypes) out.xt = Array.from(rule.excludedTypes);
      if (rule.includeDomains) out.id = rule.includeDomains;
      if (rule.excludeDomains) out.xd = rule.excludeDomains;
      if (rule.toInclude) out.ti = rule.toInclude;
      if (rule.toExclude) out.te = rule.toExclude;
      if (rule.denyAllow) out.da = rule.denyAllow;
      if (rule.topInclude) out.yi = rule.topInclude;
      if (rule.topExclude) out.ye = rule.topExclude;
      if (rule.sourceKind && rule.sourceKind !== 'wildfire') out.sk = rule.sourceKind;
      if (rule.hash) out.h = rule.hash;
      if (rule._tk && rule._tk.length) out.tk = rule._tk;
      if (rule.generichide) out.gh = 1;
      if (rule.elemhide) out.eh = 1;
      if (rule.specifichide) out.sh = 1;
      if (rule.removeparam !== null && rule.removeparam !== undefined) out.rp = rule.removeparam;
      if (rule.removeheader) out.rh = rule.removeheader;
      if (Array.isArray(rule.ignoredOptions) && rule.ignoredOptions.length) {
        out.io = rule.ignoredOptions.map(option => ({
          n: option.name,
          r: option.reason,
          l: String(option.line || rule.sourceLine || rule.pattern || ''),
          ln: Number(option.lineNumber || rule.sourceLine || 0),
          sk: option.sourceKind || rule.sourceKind || 'wildfire',
          h: option.hash || rule.hash || ''
        }));
      }
      return out;
    };

    const serializeEntry = entry => ({
      s: entry.selector || entry.source,
      i: Array.isArray(entry.include) ? entry.include.slice() : [],
      e: Array.isArray(entry.exclude) ? entry.exclude.slice() : []
    });
    const entriesByDomain = map => Array.from(map.entries())
      .map(([domain, entries]) => [domain, entries.map(serializeEntry)]);
    const cosmeticByDomain = entriesByDomain(this.cosmeticByDomain);
    const cosmeticExceptionsByDomain = entriesByDomain(this.cosmeticExceptionsByDomain);
    const proceduralByDomain = entriesByDomain(this.proceduralByDomain);
    const proceduralExceptionsByDomain = entriesByDomain(this.proceduralExceptionsByDomain);

    return {
      v: COMPILED_VERSION,
      cap: this.capabilities,
      n: rules.map(serializeRule),
      c: {
        g: this.genericCosmetic.map(serializeEntry),
        ge: this.genericCosmeticExceptions.map(serializeEntry),
        d: cosmeticByDomain,
        de: cosmeticExceptionsByDomain
      },
      p: {
        g: this.genericProcedural.map(serializeEntry),
        ge: this.genericProceduralExceptions.map(serializeEntry),
        d: proceduralByDomain,
        de: proceduralExceptionsByDomain
      },
      s: this.scriptletRules,
      d: this.diagnostics
    };
  };

  FilterEngine.prototype.loadCompiled = function loadCompiled(compiled, options) {
    if (!compiled || compiled.v !== COMPILED_VERSION || !Array.isArray(compiled.n)) return false;
    const append = Boolean(options && options.append);
    if (!append) this.reset();
    else this.invalidateDecisionCache();
    try {
      compiled.n.forEach(item => {
        if (!item || typeof item.p !== 'string') return;
        const rule = {
          pattern: item.p,
          regex: item.rx ? new RegExp(item.rx.s, item.rx.f) : null,
          isRegex: Boolean(item.rx),
          isPlain: Boolean(item.pl),
          isSegments: Boolean(item.sg),
          segments: item.sg || null,
          hostAnchor: Boolean(item.ha),
          startAnchor: Boolean(item.sa),
          endAnchor: Boolean(item.ea),
          needle: item.ne || '',
          hostKey: item.hk || null,
          hostSelector: item.hs || '',
          isException: Boolean(item.x),
          important: Boolean(item.im),
          types: item.ty ? new Set(item.ty) : null,
          excludedTypes: item.xt ? new Set(item.xt) : null,
          thirdParty: item.tp === 1 ? true : item.tp === -1 ? false : null,
          topAny: Boolean(item.ta),
          strictParty: item.sp === 1 ? true : item.sp === -1 ? false : null,
          includeDomains: item.id || null,
          excludeDomains: item.xd || null,
          toInclude: item.ti || null,
          toExclude: item.te || null,
          denyAllow: item.da || null,
          topInclude: item.yi || null,
          topExclude: item.ye || null,
          all: Boolean(item.al),
          matchCase: Boolean(item.mc),
          popup: Boolean(item.pu),
          redirect: item.re || '',
          redirectRule: item.rr || '',
          rewrite: item.rw || '',
          rewriteRule: item.rwr || '',
          csp: item.cs || '',
          cspAll: Boolean(item.ca),
          realm: item.rl || (item.gh || item.eh || item.sh
            ? 'hide'
            : (item.cs || item.ca ? 'csp' : 'network')),
          generichide: Boolean(item.gh),
          elemhide: Boolean(item.eh),
          specifichide: Boolean(item.sh),
          removeparam: Object.prototype.hasOwnProperty.call(item, 'rp') ? item.rp : null,
          removeheader: item.rh || null,
          ignoredOptions: Array.isArray(item.io)
            ? item.io.map(option => ({
              name: String(option && option.n || ''),
              reason: String(option && option.r || ''),
              line: String(option && option.l || ''),
              lineNumber: Number(option && option.ln) || 0,
              sourceKind: String(option && option.sk || item.sk || 'wildfire'),
              hash: String(option && option.h || item.h || '')
            }))
            : [],
          sourceKind: item.sk || 'wildfire',
          hash: item.h || ''
        };
        rule.ignoredOptions.forEach(option => {
          this.ignoredOptions.push({
            line: option.line, lineNumber: option.lineNumber,
            name: option.name, reason: option.reason,
            sourceKind: option.sourceKind, hash: option.hash
          });
        });
        if (rule.removeparam !== null && typeof rule.removeparam === 'string') {
          const checked = compileRemoveparamRegex(rule.removeparam);
          if (checked && checked.regex) rule.removeparamRegex = checked.regex;
        }
        if (Array.isArray(item.tk) && item.tk.length) rule._tk = item.tk.slice();
        this._addNetworkRule(rule);
      });

      const c = compiled.c || {};
      this.genericCosmetic.push(...readCosmeticEntries(c.g));
      this.genericCosmeticExceptions.push(...readCosmeticEntries(c.ge));
      const loadCosmeticDomains = (list, map) => {
        (Array.isArray(list) ? list : []).forEach(([domain, entries]) => {
          if (typeof domain !== 'string' || !domain) return;
          if (!map.has(domain)) map.set(domain, []);
          map.get(domain).push(...readCosmeticEntries(entries));
        });
      };
      loadCosmeticDomains(c.d, this.cosmeticByDomain);
      loadCosmeticDomains(c.de, this.cosmeticExceptionsByDomain);
      this.counts.cosmetic = this.genericCosmetic.length + this.genericCosmeticExceptions.length +
        Array.from(this.cosmeticByDomain.values()).reduce((n, a) => n + a.length, 0) +
        Array.from(this.cosmeticExceptionsByDomain.values()).reduce((n, a) => n + a.length, 0);
      if (this.counts.cosmetic > 0) this.capabilities |= CAP.COSMETIC;

      const p = compiled.p || {};
      this.genericProcedural.push(...readProceduralEntries(p.g, false));
      this.genericProceduralExceptions.push(...readProceduralEntries(p.ge, true));
      const loadProceduralDomains = (list, map, isException) => {
        (Array.isArray(list) ? list : []).forEach(([domain, entries]) => {
          if (typeof domain !== 'string' || !domain) return;
          if (!map.has(domain)) map.set(domain, []);
          map.get(domain).push(...readProceduralEntries(entries, isException));
        });
      };
      loadProceduralDomains(p.d, this.proceduralByDomain, false);
      loadProceduralDomains(p.de, this.proceduralExceptionsByDomain, true);
      if (this.genericProcedural.length > 0 || this.proceduralByDomain.size > 0) {
        this.capabilities |= CAP.COSMETIC | CAP.PROCEDURAL;
      }

      const scriptlets = Array.isArray(compiled.s) ? compiled.s : [];
      if (append) this.scriptletRules.push(...scriptlets);
      else this.scriptletRules = scriptlets.slice();
      this.counts.scriptlets = this.scriptletRules.length;
      if (this.counts.scriptlets > 0) this.capabilities |= CAP.SCRIPTLET;

      if (Array.isArray(compiled.d)) {
        this.diagnostics = this.diagnostics.concat(compiled.d);
      }
      // Restore compile-time/global capabilities that may have no surviving rules.
      if (typeof compiled.cap === 'number') this.capabilities |= compiled.cap;
      return true;
    } catch (error) {
      this.reset();
      return false;
    }
  };
})(this);

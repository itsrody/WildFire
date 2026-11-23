/* WildFire filter engine: compiled-blob serialization (toCompiled/loadCompiled).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { COMPILED_VERSION, CAP } = NS;

  const FilterEngine = global.FilterEngine;

  FilterEngine.prototype.toCompiled = function toCompiled() {
    const network = [];
    const collect = rule => { network[rule.order] = rule; };
    this.unindexedRules.forEach(collect);
    this.hostRules.forEach(bucket => bucket.forEach(collect));
    this.tokenRules.forEach(bucket => bucket.forEach(collect));
    const seen = new Set();
    const rules = network.filter(rule => rule && !seen.has(rule.order) && seen.add(rule.order));

    const serializeRule = rule => {
      const out = {
        p: rule.pattern,
        x: rule.isException ? 1 : 0,
        im: rule.important ? 1 : 0,
        mc: rule.matchCase ? 1 : 0,
        pu: rule.popup ? 1 : 0,
        ha: rule.hostAnchor ? 1 : 0,
        sa: rule.startAnchor ? 1 : 0,
        ea: rule.endAnchor ? 1 : 0,
        hk: rule.hostKey || '',
        ne: rule.needle || '',
        re: rule.redirect || '',
        rr: rule.redirectRule || '',
        rw: rule.rewrite || '',
        cs: rule.csp || '',
        tp: rule.thirdParty === null ? 0 : rule.thirdParty ? 1 : -1
      };
      if (rule.isRegex && rule.regex) out.rx = { s: rule.regex.source, f: rule.regex.flags };
      if (rule.isPlain) out.pl = 1;
      if (rule.isSegments) out.sg = rule.segments;
      if (rule.types) out.ty = Array.from(rule.types);
      if (rule.excludedTypes) out.xt = Array.from(rule.excludedTypes);
      if (rule.includeDomains) out.id = rule.includeDomains;
      if (rule.excludeDomains) out.xd = rule.excludeDomains;
      if (rule.sourceKind && rule.sourceKind !== 'wildfire') out.sk = rule.sourceKind;
      if (rule.hash) out.h = rule.hash;
      if (rule._tk && rule._tk.length) out.tk = rule._tk;
      if (rule.generichide) out.gh = 1;
      if (rule.elemhide) out.eh = 1;
      if (rule.specifichide) out.sh = 1;
      if (rule.removeparam !== null && rule.removeparam !== undefined) out.rp = rule.removeparam;
      if (rule.removeheader) out.rh = rule.removeheader;
      return out;
    };

    const cosmeticByDomain = [];
    this.cosmeticByDomain.forEach((selectors, domain) => cosmeticByDomain.push([domain, selectors]));
    const cosmeticExceptionsByDomain = [];
    this.cosmeticExceptionsByDomain.forEach((selectors, domain) => cosmeticExceptionsByDomain.push([domain, selectors]));
    const proceduralByDomain = [];
    this.proceduralByDomain.forEach((map, domain) => proceduralByDomain.push([domain, Array.from(map.entries())]));
    const proceduralExceptionsByDomain = [];
    this.proceduralExceptionsByDomain.forEach((set, domain) => proceduralExceptionsByDomain.push([domain, Array.from(set)]));

    return {
      v: COMPILED_VERSION,
      cap: this.capabilities,
      n: rules.map(serializeRule),
      c: {
        g: this.genericCosmetic,
        ge: this.genericCosmeticExceptions,
        d: cosmeticByDomain,
        de: cosmeticExceptionsByDomain
      },
      p: {
        g: Array.from(this.genericProcedural.entries()),
        ge: Array.from(this.genericProceduralExceptions),
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
          isException: Boolean(item.x),
          important: Boolean(item.im),
          types: item.ty ? new Set(item.ty) : null,
          excludedTypes: item.xt ? new Set(item.xt) : null,
          thirdParty: item.tp === 1 ? true : item.tp === -1 ? false : null,
          includeDomains: item.id || null,
          excludeDomains: item.xd || null,
          matchCase: Boolean(item.mc),
          popup: Boolean(item.pu),
          redirect: item.re || '',
          redirectRule: item.rr || '',
          rewrite: item.rw || '',
          csp: item.cs || '',
          generichide: Boolean(item.gh),
          elemhide: Boolean(item.eh),
          specifichide: Boolean(item.sh),
          removeparam: Object.prototype.hasOwnProperty.call(item, 'rp') ? item.rp : null,
          removeheader: item.rh || null,
          sourceKind: item.sk || 'wildfire',
          hash: item.h || ''
        };
        if (rule.removeparam !== null && typeof rule.removeparam === 'string' && rule.removeparam.startsWith('/') && rule.removeparam.endsWith('/') && rule.removeparam.length > 2) {
          try { rule.removeparamRegex = new RegExp(rule.removeparam.slice(1, -1)); } catch (error) { rule.removeparamRegex = null; }
        }
        if (Array.isArray(item.tk) && item.tk.length) rule._tk = item.tk.slice();
        this._addNetworkRule(rule);
      });

      const c = compiled.c || {};
      (c.g || []).forEach(sel => { if (!this.genericCosmetic.includes(sel)) this.genericCosmetic.push(sel); });
      (c.ge || []).forEach(sel => { if (!this.genericCosmeticExceptions.includes(sel)) this.genericCosmeticExceptions.push(sel); });
      (c.d || []).forEach(([domain, selectors]) => {
        if (!this.cosmeticByDomain.has(domain)) this.cosmeticByDomain.set(domain, []);
        const list = this.cosmeticByDomain.get(domain);
        (selectors || []).forEach(sel => { if (!list.includes(sel)) list.push(sel); });
      });
      (c.de || []).forEach(([domain, selectors]) => {
        if (!this.cosmeticExceptionsByDomain.has(domain)) this.cosmeticExceptionsByDomain.set(domain, []);
        const list = this.cosmeticExceptionsByDomain.get(domain);
        (selectors || []).forEach(sel => { if (!list.includes(sel)) list.push(sel); });
      });
      this.counts.cosmetic = this.genericCosmetic.length + this.genericCosmeticExceptions.length +
        Array.from(this.cosmeticByDomain.values()).reduce((n, a) => n + a.length, 0) +
        Array.from(this.cosmeticExceptionsByDomain.values()).reduce((n, a) => n + a.length, 0);
      if (this.counts.cosmetic > 0) this.capabilities |= CAP.COSMETIC;

      const p = compiled.p || {};
      (p.g || []).forEach(([sel, tree]) => this.genericProcedural.set(sel, tree));
      (p.ge || []).forEach(sel => this.genericProceduralExceptions.add(sel));
      (p.d || []).forEach(([domain, entries]) => {
        if (!this.proceduralByDomain.has(domain)) this.proceduralByDomain.set(domain, new Map());
        const map = this.proceduralByDomain.get(domain);
        (entries || []).forEach(([sel, tree]) => map.set(sel, tree));
      });
      (p.de || []).forEach(([domain, sels]) => {
        if (!this.proceduralExceptionsByDomain.has(domain)) this.proceduralExceptionsByDomain.set(domain, new Set());
        const set = this.proceduralExceptionsByDomain.get(domain);
        (sels || []).forEach(sel => set.add(sel));
      });
      if (this.genericProcedural.size > 0 || this.proceduralByDomain.size > 0) this.capabilities |= CAP.COSMETIC | CAP.PROCEDURAL;

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

/* WildFire filter engine: cosmetic/procedural storage and per-host getters.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { parentHosts, hostnameOf } = NS;

  const FilterEngine = global.FilterEngine;

  FilterEngine.prototype._addCosmetic = function _addCosmetic(parsed) {
    const map = parsed.isException ? this.cosmeticExceptionsByDomain : this.cosmeticByDomain;
    const generic = parsed.isException ? this.genericCosmeticExceptions : this.genericCosmetic;

    if (!parsed.domains.length) {
      if (!generic.includes(parsed.selector)) generic.push(parsed.selector);
      return;
    }
    parsed.domains.forEach(domain => {
      if (!map.has(domain)) map.set(domain, []);
      const list = map.get(domain);
      if (!list.includes(parsed.selector)) list.push(parsed.selector);
    });
  };

  FilterEngine.prototype._addProcedural = function _addProcedural(parsed) {
    const map = parsed.isException ? this.proceduralExceptionsByDomain : this.proceduralByDomain;

    if (!parsed.domains.length) {
      if (parsed.isException) this.genericProceduralExceptions.add(parsed.selector);
      else this.genericProcedural.set(parsed.selector, parsed.procedural);
      return;
    }
    parsed.domains.forEach(domain => {
      if (parsed.isException) {
        if (!map.has(domain)) map.set(domain, new Set());
        map.get(domain).add(parsed.selector);
      } else {
        if (!map.has(domain)) map.set(domain, new Map());
        map.get(domain).set(parsed.selector, parsed.procedural);
      }
    });
  };

  // Plain data for the content-side registry. Host scoping and exceptions
  // are resolved there against location.hostname, so a single document_start
  // registration can serve every page.
  FilterEngine.prototype.getScriptletPayload = function getScriptletPayload() {
    return this.scriptletRules.map(rule => ({
      alias: rule.alias,
      args: rule.args.slice(),
      domains: rule.domains.slice(),
      isException: rule.isException,
      syntax: rule.syntax || 'ubo'
    }));
  };

  FilterEngine.prototype.getHidePolicy = function getHidePolicy(url, type, documentUrl) {
    const targetHost = hostnameOf(url);
    const docHost = hostnameOf(documentUrl || url);
    const candidates = this._candidates(url, targetHost, rule => !(rule.generichide || rule.elemhide || rule.specifichide), 'hide');
    const applies = rule => this._ruleApplies(rule, url, type || 'document', docHost, targetHost, true);
    const policy = { generichide: false, elemhide: false, specifichide: false };
    candidates.forEach(rule => {
      if (!applies(rule)) return;
      // Hide modifiers are document-level exception controls.
      if (!rule.isException) return;
      if (rule.generichide) policy.generichide = true;
      if (rule.elemhide) policy.elemhide = true;
      if (rule.specifichide) policy.specifichide = true;
    });
    if (policy.elemhide) { policy.generichide = true; policy.specifichide = true; }
    return policy;
  };

  FilterEngine.prototype.getCosmetic = function getCosmetic(host, options) {
    const opts = options || {};
    const hideGeneric = Boolean(opts.generichide || opts.elemhide);
    const hideSpecific = Boolean(opts.elemhide || opts.specifichide);
    if (hideGeneric && hideSpecific) return [];

    const hosts = parentHosts(host);
    const selectors = new Set(hideGeneric ? [] : this.genericCosmetic);
    const exceptions = new Set(hideGeneric ? [] : this.genericCosmeticExceptions);

    if (!hideSpecific) {
      hosts.forEach(name => {
        const found = this.cosmeticByDomain.get(name);
        if (found) found.forEach(selector => selectors.add(selector));
        const excepted = this.cosmeticExceptionsByDomain.get(name);
        if (excepted) excepted.forEach(selector => exceptions.add(selector));
      });
    }
    exceptions.forEach(selector => selectors.delete(selector));
    return Array.from(selectors);
  };

  FilterEngine.prototype.getProcedural = function getProcedural(host, options) {
    const opts = options || {};
    const hideGeneric = Boolean(opts.generichide || opts.elemhide);
    const hideSpecific = Boolean(opts.elemhide || opts.specifichide);
    if (hideGeneric && hideSpecific) return [];

    const selected = new Map(hideGeneric ? [] : this.genericProcedural);
    const exceptions = new Set(hideGeneric ? [] : this.genericProceduralExceptions);
    if (!hideSpecific) {
      parentHosts(host).forEach(name => {
        const found = this.proceduralByDomain.get(name);
        if (found) found.forEach((tree, source) => selected.set(source, tree));
        const excepted = this.proceduralExceptionsByDomain.get(name);
        if (excepted) excepted.forEach(source => exceptions.add(source));
      });
    }
    exceptions.forEach(source => selected.delete(source));
    return Array.from(selected.values());
  };
})(this);

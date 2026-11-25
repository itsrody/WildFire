/* WildFire filter engine: cosmetic/procedural storage and per-host getters.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { parentHosts, hostnameOf, domainMatches } = NS;

  const FilterEngine = global.FilterEngine;

  function extraHosts(value) {
    const entries = Array.isArray(value) ? value : [value];
    return Array.from(new Set(entries
      .map(host => String(host || '').trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean)));
  }

  function scopeHosts(scope, url, documentUrl) {
    const supplied = scope && typeof scope === 'object' ? scope : {};
    const documentHost = hostnameOf(documentUrl || url);
    return {
      target: extraHosts(supplied.target || supplied.targetHosts || hostnameOf(url)),
      document: extraHosts(supplied.document || supplied.documentHosts || documentHost),
      top: extraHosts(supplied.top || supplied.topHosts || documentHost)
    };
  }

  // A cosmetic rule may name positive hosts (~ excluded ones) on both sides of
  // ##. Positive hosts use the same parent-domain policy as the domain indexes;
  // negated hosts subtract matching parents. An include-empty rule is generic.
  function matchesScope(entry, hosts) {
    if (!entry) return false;
    const excluded = Array.isArray(entry.exclude) ? entry.exclude : [];
    if (excluded.some(domain => hosts.some(host => domainMatches(host, domain)))) return false;
    const included = Array.isArray(entry.include) ? entry.include : [];
    return !included.length || included.some(domain => hosts.some(host => domainMatches(host, domain)));
  }

  function addSelectors(entries, hosts, target) {
    if (!Array.isArray(entries)) return;
    entries.filter(entry => matchesScope(entry, hosts))
      .forEach(entry => { if (entry.selector) target.add(entry.selector); });
  }

  function addProcedural(entries, hosts, selected) {
    if (!Array.isArray(entries)) return;
    entries.filter(entry => matchesScope(entry, hosts))
      .forEach(entry => { if (entry.source && entry.tree) selected.set(entry.source, entry.tree); });
  }

  function addExceptions(entries, hosts, target) {
    if (!Array.isArray(entries)) return;
    entries.filter(entry => matchesScope(entry, hosts))
      .forEach(entry => { if (entry.selector || entry.source) target.add(entry.selector || entry.source); });
  }

  function hasPatternScope(entry) {
    const scopes = [].concat(
      Array.isArray(entry.include) ? entry.include : [],
      Array.isArray(entry.exclude) ? entry.exclude : []
    );
    return scopes.some(scope => scope === '*' || scope.includes('*') || scope.startsWith('/'));
  }

  function anyMatch(entries, hosts, exceptions) {
    return Array.isArray(entries) && entries.some(entry =>
      !exceptions.has(entry.selector || entry.source) && matchesScope(entry, hosts));
  }

  function anyDomainMatch(map, hosts, exceptions) {
    return hosts.some(host => anyMatch(map.get(host), hosts, exceptions));
  }

  function hasSpecificCosmetic(engine, hosts, exceptions) {
    return anyDomainMatch(engine.cosmeticByDomain, hosts, exceptions) ||
      anyMatch(engine.cosmeticPatternRules, hosts, exceptions);
  }

  function hasSpecificProcedural(engine, hosts, exceptions) {
    return anyDomainMatch(engine.proceduralByDomain, hosts, exceptions) ||
      anyMatch(engine.proceduralPatternRules, hosts, exceptions);
  }

  FilterEngine.prototype._addCosmetic = function _addCosmetic(parsed) {
    const map = parsed.isException ? this.cosmeticExceptionsByDomain : this.cosmeticByDomain;
    const generic = parsed.isException ? this.genericCosmeticExceptions : this.genericCosmetic;
    const surveyor = parsed.isException ? this.specificGenericCosmeticExceptions : this.specificGenericCosmetic;
    const patterns = parsed.isException ? this.cosmeticPatternExceptions : this.cosmeticPatternRules;
    const entry = {
      selector: parsed.selector,
      include: Array.isArray(parsed.includeDomains) ? parsed.includeDomains.slice() : [],
      exclude: Array.isArray(parsed.excludeDomains) ? parsed.excludeDomains.slice() : []
    };

    if (!entry.include.length && !parsed.specificGeneric) {
      generic.push(entry);
      return;
    }
    if (parsed.specificGeneric) {
      surveyor.push(entry);
      return;
    }
    if (hasPatternScope(entry)) {
      patterns.push(entry);
      return;
    }
    entry.include.forEach(domain => {
      if (!map.has(domain)) map.set(domain, []);
      map.get(domain).push(entry);
    });
  };

  FilterEngine.prototype._addProcedural = function _addProcedural(parsed) {
    const map = parsed.isException ? this.proceduralExceptionsByDomain : this.proceduralByDomain;
    const generic = parsed.isException ? this.genericProceduralExceptions : this.genericProcedural;
    const surveyor = parsed.isException ? this.specificGenericProceduralExceptions : this.specificGenericProcedural;
    const patterns = parsed.isException ? this.proceduralPatternExceptions : this.proceduralPatternRules;
    const entry = {
      source: parsed.selector,
      tree: parsed.procedural,
      include: Array.isArray(parsed.includeDomains) ? parsed.includeDomains.slice() : [],
      exclude: Array.isArray(parsed.excludeDomains) ? parsed.excludeDomains.slice() : []
    };

    if (!entry.include.length && !parsed.specificGeneric) {
      generic.push(entry);
      return;
    }
    if (parsed.specificGeneric) {
      surveyor.push(entry);
      return;
    }
    if (hasPatternScope(entry)) {
      patterns.push(entry);
      return;
    }
    entry.include.forEach(domain => {
      if (!map.has(domain)) map.set(domain, []);
      map.get(domain).push(entry);
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
      specificGeneric: Boolean(rule.specificGeneric),
      syntax: rule.syntax || 'ubo'
    }));
  };

  FilterEngine.prototype.getHidePolicy = function getHidePolicy(url, type, documentUrl, hosts) {
    const scope = scopeHosts(hosts, url, documentUrl);
    const candidates = this._candidates(url, scope.target, rule => !(rule.generichide || rule.elemhide || rule.specifichide), 'hide');
    const applies = rule => this._ruleApplies(rule, url, type || 'document',
      scope.document, scope.target, true, scope.top);
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

    const hosts = Array.from(new Set([
      ...parentHosts(host),
      ...extraHosts(opts.hosts).flatMap(parentHosts)
    ]));
    const selectors = new Set();
    const exceptions = new Set();
    const specific = new Set();
    addSelectors(hideGeneric ? [] : this.genericCosmetic, hosts, selectors);
    addExceptions(hideGeneric ? [] : this.genericCosmeticExceptions, hosts, exceptions);

    if (!hideSpecific) {
      hosts.forEach(name => {
        const found = this.cosmeticByDomain.get(name);
        if (found) addSelectors(found, hosts, specific);
        const excepted = this.cosmeticExceptionsByDomain.get(name);
        if (excepted) addExceptions(excepted, hosts, exceptions);
      });
      addSelectors(this.cosmeticPatternRules, hosts, specific);
      addExceptions(this.cosmeticPatternExceptions, hosts, exceptions);
      exceptions.forEach(selector => specific.delete(selector));
      if (!hideGeneric && (specific.size || hasSpecificProcedural(this, hosts, exceptions))) {
        // Bounded surveyor policy: `*##` rules apply only when at least one
        // domain-scoped cosmetic or procedural rule applies to the page.
        addSelectors(this.specificGenericCosmetic, hosts, selectors);
        addExceptions(this.specificGenericCosmeticExceptions, hosts, exceptions);
      }
    }
    specific.forEach(selector => selectors.add(selector));
    exceptions.forEach(selector => selectors.delete(selector));
    return Array.from(selectors);
  };

  FilterEngine.prototype.getProcedural = function getProcedural(host, options) {
    const opts = options || {};
    const hideGeneric = Boolean(opts.generichide || opts.elemhide);
    const hideSpecific = Boolean(opts.elemhide || opts.specifichide);
    if (hideGeneric && hideSpecific) return [];

    const hosts = Array.from(new Set([
      ...parentHosts(host),
      ...extraHosts(opts.hosts).flatMap(parentHosts)
    ]));
    const selected = new Map();
    const exceptions = new Set();
    const specific = new Map();
    addProcedural(hideGeneric ? [] : this.genericProcedural, hosts, selected);
    addExceptions(hideGeneric ? [] : this.genericProceduralExceptions, hosts, exceptions);

    if (!hideSpecific) {
      hosts.forEach(name => {
        const found = this.proceduralByDomain.get(name);
        if (found) addProcedural(found, hosts, specific);
        const excepted = this.proceduralExceptionsByDomain.get(name);
        if (excepted) addExceptions(excepted, hosts, exceptions);
      });
      addProcedural(this.proceduralPatternRules, hosts, specific);
      addExceptions(this.proceduralPatternExceptions, hosts, exceptions);
      exceptions.forEach(source => specific.delete(source));
      if (!hideGeneric && (specific.size || hasSpecificCosmetic(this, hosts, exceptions))) {
        addProcedural(this.specificGenericProcedural, hosts, selected);
        addExceptions(this.specificGenericProceduralExceptions, hosts, exceptions);
      }
    }
    specific.forEach((tree, source) => selected.set(source, tree));
    exceptions.forEach(source => selected.delete(source));
    return Array.from(selected.values());
  };
})(this);

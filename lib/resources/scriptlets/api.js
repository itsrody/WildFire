/* WildFire scriptlets: canonicalization, validation, domain scoping, apply, public API.
 * Classic-script module; load after its dependencies (registration order).
 * Filter text is never compiled: no eval, no Function, no dynamic source. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { ADGUARD_RESTRICTED, DEFINITIONS, restrictedAdguard, ADGUARD_DEFINITIONS } = NS;

  const CANONICAL = Object.keys(DEFINITIONS).reduce((map, name) => {
    map[name] = name;
    DEFINITIONS[name].aliases.forEach(alias => { map[alias] = name; });
    return map;
  }, Object.create(null));

  const ADGUARD_CANONICAL = Object.keys(ADGUARD_DEFINITIONS).reduce((map, name) => {
    map[name] = ADGUARD_DEFINITIONS[name].canonical;
    return map;
  }, Object.create(null));

  function scriptletSyntax(syntax) {
    return syntax === 'adguard' ? 'adguard' : 'ubo';
  }

  function canonical(alias, syntax) {
    const name = String(alias || '').trim().toLowerCase();
    return scriptletSyntax(syntax) === 'adguard'
      ? (ADGUARD_CANONICAL[name] || name)
      : (CANONICAL[name] || name);
  }

  function validate(alias, args, syntax) {
    const name = String(alias || '').trim().toLowerCase();
    if (name.startsWith('trusted-')) return 'trusted scriptlets require a trusted source';
    const list = Array.isArray(args) ? args : [];
    if (scriptletSyntax(syntax) === 'adguard') {
      if (list.some(arg => typeof arg !== 'string')) {
        return 'AdGuard scriptlet arguments must be strings';
      }
      if (ADGUARD_RESTRICTED.has(name)) return restrictedAdguard();
      const definition = ADGUARD_DEFINITIONS[name];
      if (!definition) return 'unknown AdGuard scriptlet alias: ' + name;
      return definition.validate(list);
    }
    const resolved = CANONICAL[name];
    if (!resolved) return 'unknown scriptlet alias: ' + name;
    return DEFINITIONS[resolved].validate(list);
  }

  // Scriptlets run in the page without the filter chain, so this is a small,
  // self-contained mirror of WildFire host-scope matching. Regex literals are
  // compiled only through the core needle validator; filter text never becomes
  // page script.
  function domainMatches(host, domain) {
    const normalizedHost = String(host || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '');
    const key = String(domain || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '').replace(/^~/, '').trim();
    if (!normalizedHost || !key) return false;
    if (key === '*') return true;
    if (key.startsWith('/')) {
      const match = key.match(/^\/([\s\S]*)\/([imsu]*)$/);
      if (!match || typeof NS.compileNeedle !== 'function') return false;
      const flags = Array.from(new Set((match[2] + 'i').split(''))).join('');
      const compiled = NS.compileNeedle('/' + match[1] + '/' + flags);
      return Boolean(compiled && !compiled.error && compiled.matcher(normalizedHost));
    }
    if (!key.includes('*')) {
      return normalizedHost === key || normalizedHost.endsWith('.' + key);
    }
    const labels = normalizedHost.split('.').filter(Boolean);
    const leading = key.startsWith('*.');
    const trailing = key.endsWith('.*');
    const parts = key.slice(leading ? 2 : 0, trailing ? -2 : undefined)
      .split('.').filter(Boolean);
    if (!parts.length) return false;
    const partAt = (index, offset) => labels[index + offset] === parts[offset];
    if (leading && trailing) {
      return labels.some((unused, index) =>
        index > 0 && index + parts.length < labels.length &&
        parts.every((part, offset) => partAt(index, offset)));
    }
    if (trailing) {
      return labels.some((unused, index) =>
        index + parts.length < labels.length &&
        parts.every((part, offset) => partAt(index, offset)));
    }
    const start = labels.length - parts.length;
    return start > 0 && parts.every((part, offset) => partAt(start, offset));
  }

  function appliesTo(entry, host) {
    if (!entry || typeof entry !== 'object') return false;
    const domains = Array.isArray(entry.domains) ? entry.domains : [];
    if (!domains.length) return true;
    const included = domains.filter(domain => !domain.startsWith('~'));
    const excluded = domains
      .filter(domain => domain.startsWith('~'))
      .map(domain => domain.slice(1));
    const isIncluded = !included.length ||
      included.some(domain => domainMatches(host, domain));
    return isIncluded && !excluded.some(domain => domainMatches(host, domain));
  }

  function isSurveyor(entry) {
    return Boolean(entry && entry.specificGeneric);
  }

  function hasScopedDomain(entry) {
    const domains = Array.isArray(entry && entry.domains) ? entry.domains : [];
    return domains.some(domain => typeof domain === 'string' &&
      domain && domain !== '*' && !domain.startsWith('~'));
  }

  function sameRule(left, right) {
    const leftArgs = Array.isArray(left.args) ? left.args : [];
    const rightArgs = Array.isArray(right.args) ? right.args : [];
    return canonical(left.alias, left.syntax) === canonical(right.alias, right.syntax) &&
      leftArgs.length === rightArgs.length &&
      leftArgs.every((arg, index) => String(arg) === String(rightArgs[index]));
  }

  function run(entry) {
    const syntax = scriptletSyntax(entry.syntax);
    const name = canonical(entry.alias, syntax);
    const definition = syntax === 'adguard'
      ? ADGUARD_DEFINITIONS[String(entry.alias || '').trim().toLowerCase()]
      : DEFINITIONS[name];
    if (!definition || validate(entry.alias, entry.args, syntax)) return;
    try {
      definition.run(Array.isArray(entry.args) ? entry.args : []);
    } catch (error) {
      /* A page must never see an exception from a WildFire scriptlet. */
    }
  }

  function apply(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const host = String((global.location && global.location.hostname) || '').toLowerCase();
    const applicable = list.filter(entry => appliesTo(entry, host));
    const exceptions = applicable.filter(entry => entry.isException);
    const unexcepted = applicable.filter(entry => !entry.isException &&
      !exceptions.some(exception => sameRule(exception, entry)));
    // `*##+js()` is surveyor-style: a domain-scoped rule must still be live on
    // this host before the generic scriptlet runs. Exceptions remove scoped
    // rules before that trigger is evaluated.
    const hasScopedRule = unexcepted.some(entry =>
      !isSurveyor(entry) && hasScopedDomain(entry));
    unexcepted.filter(entry => !isSurveyor(entry) || hasScopedRule).forEach(run);
  }

  const api = {
    aliases: Object.keys(CANONICAL),
    adguardAliases: Object.keys(ADGUARD_DEFINITIONS),
    canonical,
    validate,
    apply,
    domainMatches
  };

  try {
    Object.defineProperty(global, 'WildFireScriptlets', {
      value: api,
      writable: true,
      enumerable: false,
      configurable: true
    });
  } catch (error) {
    global.WildFireScriptlets = api;
  }

  Object.assign(NS, { CANONICAL, ADGUARD_CANONICAL, scriptletSyntax, canonical, validate, domainMatches, appliesTo, sameRule, run, apply, api });
})(this);

/* WildFire filter engine: network filter line parser ($options IR).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { splitPattern, splitOptionList, compilePattern, compileRemoveparamRegex, normalizeType, hostKeyFromPattern, validDomainPattern, DEFERRED_NETWORK_OPTIONS } = NS;

  function parseNetwork(line) {
    let text = line.trim();
    let isException = false;
    if (text.startsWith('@@')) {
      isException = true;
      text = text.slice(2).trim();
    }

    const split = splitPattern(text);
    const pattern = split.pattern;
    const optionText = split.optionText;
    if (!pattern) return null;
    let domainError = '';

    const options = {
      types: null,
      excludedTypes: null,
      thirdParty: null,
      includeDomains: null,
      excludeDomains: null,
      matchCase: false,
      popup: false,
      important: false,
      badfilter: false,
      removeparam: null,
      removeheader: null,
      redirect: '',
      redirectRule: '',
      rewrite: '',
      rewriteRule: '',
      csp: '',
      cspAll: false,
      generichide: false,
      elemhide: false,
      specifichide: false,
      ignoredOptions: []
    };

    if (optionText) {
      splitOptionList(optionText).forEach(raw => {
        const separator = raw.indexOf('=');
        const option = (separator === -1 ? raw.trim() : raw.slice(0, separator).trim()).toLowerCase();
        const hasValue = separator !== -1;
        const optionValue = hasValue ? raw.slice(separator + 1).trim() : '';
        if (!option) return;
        const deferredName = option.replace(/^~/, '');
        if (DEFERRED_NETWORK_OPTIONS.has(deferredName)) {
          const reason = 'option not implemented: ' + option;
          if (!options.ignoredOptions.some(entry => entry.reason === reason)) {
            options.ignoredOptions.push({ name: option, reason });
          }
          return;
        }

        if (option === 'popup') {
          options.popup = true;
          if (!options.types) options.types = new Set();
          options.types.add('document');
        } else if (option === 'match-case') {
          options.matchCase = true;
        } else if (option === 'important') {
          options.important = true;
        } else if (option === 'badfilter') {
          options.badfilter = true;
        } else if (option === 'removeparam') {
          options.removeparam = optionValue;
        } else if (option === 'removeheader') {
          options.removeheader = optionValue.toLowerCase();
        } else if (option === 'third-party' || option === '3p') {
          options.thirdParty = true;
        } else if (option === '~third-party' || option === '~3p') {
          options.thirdParty = false;
        } else if (option === 'first-party' || option === '1p') {
          options.thirdParty = false;
        } else if (option === '~first-party' || option === '~1p') {
          options.thirdParty = true;
        } else if (option === 'generichide' || option === 'ghide') {
          options.generichide = true;
        } else if (option === 'elemhide' || option === 'ehide') {
          options.elemhide = true;
        } else if (option === 'specifichide' || option === 'shide') {
          options.specifichide = true;
        } else if (option === 'all') {
          options.types = null;
          options.excludedTypes = null;
        } else if (option === 'redirect-rule') {
          options.redirectRule = optionValue.toLowerCase();
        } else if (option === 'redirect') {
          options.redirect = optionValue.toLowerCase();
        } else if (option === 'rewrite') {
          options.rewrite = optionValue.toLowerCase();
        } else if (option === 'rewrite-rule') {
          options.rewriteRule = optionValue.toLowerCase();
        } else if (option === 'csp' && (!hasValue || !optionValue)) {
          options.cspAll = true;
          options.csp = '';
        } else if (option === 'csp') {
          options.csp = optionValue.toLowerCase();
        } else if (option === 'domain' || option === 'from') {
          optionValue.split('|').forEach(entry => {
            const excluded = entry.startsWith('~');
            const domain = entry.replace(/^~/, '').trim().toLowerCase();
            if (!domain) return;
            if (!validDomainPattern(domain)) {
              domainError = 'invalid domain option: ' + domain;
              return;
            }
            const list = excluded ? 'excludeDomains' : 'includeDomains';
            if (!options[list]) options[list] = [];
            options[list].push(domain);
          });
        } else if (option.startsWith('~')) {
          const type = normalizeType(option.slice(1));
          if (type) {
            if (!options.excludedTypes) options.excludedTypes = new Set();
            options.excludedTypes.add(type);
          }
        } else {
          const type = normalizeType(option);
          if (type) {
            if (!options.types) options.types = new Set();
            options.types.add(type);
          }
        }
      });
    }

    if (domainError) return { error: domainError };
    const hideModifier = options.generichide || options.elemhide || options.specifichide;
    if (hideModifier && !isException) {
      return { error: 'hide modifiers require an exception' };
    }
    if (hideModifier && (options.csp || options.cspAll || options.redirect ||
      options.redirectRule || options.rewrite || options.rewriteRule ||
      options.removeparam !== null || options.removeheader !== null)) {
      return { error: 'hide modifiers cannot be combined with network actions' };
    }
    if (options.cspAll && !isException) {
      return { error: 'bare csp requires an exception' };
    }
    if (options.rewrite && options.rewriteRule) {
      return { error: 'rewrite and rewrite-rule cannot be combined' };
    }

    const compiled = compilePattern(pattern, options.matchCase, split.flags);
    if (compiled.error) return { error: compiled.error };
    if (options.rewriteRule && !compiled.isRegex) {
      return { error: 'rewrite-rule requires a regex filter' };
    }

    // removeparam/removeheader are validated IR data. The background applies
    // them only when compiled capabilities require the native listeners.
    if (options.removeparam !== null) {
      const v = String(options.removeparam || '');
      if (v.length > 256 || /[\r\n\0]/.test(v)) return { error: 'invalid removeparam value' };
      const checked = compileRemoveparamRegex(v);
      if (checked && checked.error) return { error: 'invalid removeparam regex: ' + checked.error };
      if (checked && checked.regex) options.removeparamRegex = checked.regex;
    }
    if (options.removeheader !== null) {
      const v = String(options.removeheader || '');
      if (!/^(?:request:|response:)?[a-z0-9-]{1,64}$/.test(v)) return { error: 'invalid removeheader value' };
    }

    return Object.assign({
      pattern,
      regex: compiled.regex || null,
      isRegex: Boolean(compiled.isRegex),
      isPlain: Boolean(compiled.isPlain),
      isSegments: Boolean(compiled.isSegments),
      segments: compiled.segments || null,
      hostAnchor: Boolean(compiled.hostAnchor),
      startAnchor: Boolean(compiled.startAnchor),
      endAnchor: Boolean(compiled.endAnchor),
      needle: compiled.needle || '',
      hostKey: compiled.isRegex ? null : hostKeyFromPattern(pattern),
      isException,
      important: Boolean(options.important)
    }, options);
  }

  Object.assign(NS, { parseNetwork });
})(this);

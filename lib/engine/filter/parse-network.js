/* WildFire filter engine: network filter line parser ($options IR).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { splitPattern, compilePattern, normalizeType, hostKeyFromPattern } = NS;

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
      csp: '',
      generichide: false,
      elemhide: false,
      specifichide: false
    };

    if (optionText) {
      optionText.split(',').forEach(raw => {
        const option = raw.trim().toLowerCase();
        if (!option) return;

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
        } else if (option === 'removeparam' || option.startsWith('removeparam=')) {
          const value = option === 'removeparam' ? '' : option.slice('removeparam='.length).trim();
          options.removeparam = value;
        } else if (option.startsWith('removeheader=')) {
          const value = option.slice('removeheader='.length).trim().toLowerCase();
          options.removeheader = value;
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
        } else if (option.startsWith('redirect-rule=')) {
          options.redirectRule = option.slice('redirect-rule='.length).trim().toLowerCase();
        } else if (option.startsWith('redirect=')) {
          options.redirect = option.slice('redirect='.length).trim().toLowerCase();
        } else if (option.startsWith('rewrite=')) {
          options.rewrite = option.slice('rewrite='.length).trim().toLowerCase();
        } else if (option.startsWith('csp=')) {
          options.csp = option.slice('csp='.length).trim().toLowerCase();
        } else if (option.startsWith('domain=') || option.startsWith('from=')) {
          const value = option.slice(option.indexOf('=') + 1);
          value.split('|').forEach(entry => {
            const excluded = entry.startsWith('~');
            const domain = entry.replace(/^~/, '').trim().toLowerCase();
            if (!domain) return;
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

    const compiled = compilePattern(pattern, options.matchCase, split.flags);
    if (compiled.error) return { error: compiled.error };

    // Phase 1C: parse/validate removeparam/removeheader in IR only. Runtime
    // mutation is intentionally not wired yet; capabilities gate future work.
    if (options.removeparam !== null) {
      const v = String(options.removeparam || '');
      if (v.length > 256 || /[\r\n\0]/.test(v)) return { error: 'invalid removeparam value' };
      if (v.startsWith('/') && v.endsWith('/') && v.length > 2) {
        const re = compilePattern(v, false);
        if (re.error) return { error: 'invalid removeparam regex' };
        options.removeparamRegex = re.regex;
      }
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

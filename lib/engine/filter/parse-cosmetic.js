/* WildFire filter engine: cosmetic line parser (##, #@#, #?#, #@?# with ABP mapping).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { parseSelectorTree } = NS;

  function parseCosmetic(line) {
    const text = line.trim();
    const markers = [
      { token: '#@?#', isException: true, procedural: true },
      { token: '#?#', isException: false, procedural: true },
      { token: '#@#', isException: true, procedural: false },
      { token: '##', isException: false, procedural: false }
    ];
    const found = markers
      .map(m => Object.assign({ index: text.indexOf(m.token) }, m))
      .filter(m => m.index !== -1)
      .sort((a, b) => a.index - b.index || b.token.length - a.token.length)[0];
    if (!found) return null;

    const selectorRaw = text.slice(found.index + found.token.length).trim();
    if (!selectorRaw) return null;

    // ABP `#?#` procedural syntax: map safely representable `:-abp-*` forms.
    // Unknown/unsafe ABP selectors are rejected (no page execution).
    let selector = selectorRaw;
    if (found.procedural) {
      selector = selector
        .replace(/:-abp-has\(/g, ':has(')
        .replace(/:-abp-contains\(/g, ':has-text(');
      // :remove()/:style() are action operators, not hide selectors. They are
      // intentionally unsupported until a safe, dedicated action model exists.
      if (/:-abp-(?:remove|style)\(/i.test(selector)) {
        return { error: 'unsupported ABP action selector' };
      }
      if (/:-abp-[a-z-]+\(/i.test(selector)) {
        return { error: 'unsupported ABP procedural selector' };
      }
    }

    const tree = parseSelectorTree(selector, 0);
    if (tree.error) return { error: tree.error };
    if (found.procedural && tree.plain) return { error: 'ABP procedural selector missing procedural operator' };

    const parts = text.slice(0, found.index)
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    if (parts.some(part => part === '~')) {
      return { error: 'empty negated cosmetic domain' };
    }
    const includeDomains = parts.filter(part => !part.startsWith('~'));
    const excludeDomains = parts.filter(part => part.startsWith('~'))
      .map(part => part.slice(1)).filter(Boolean);

    return {
      includeDomains, excludeDomains, selector,
      isException: found.isException, procedural: tree.plain ? null : tree
    };
  }

  Object.assign(NS, { parseCosmetic });
})(this);

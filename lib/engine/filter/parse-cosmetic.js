/* WildFire filter engine: cosmetic line parser (##, #@#, #?#, #@?# with ABP mapping).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const {
    parseSelectorTree, parseHostScopeList,
    MAX_HTML_SELECTOR_LENGTH, MAX_HTML_SELECTORS, SAFE_RESPONSE_HEADERS
  } = NS;

  const HTML_SIMPLE_SELECTOR =
    /^([A-Za-z][A-Za-z0-9-]*)?((?:[.#][A-Za-z_][\w-]*)*)(?:\[([A-Za-z_:][\w:.-]*)(?:=("[^"<>]*"|'[^'<>]*'|[A-Za-z0-9_.:@-]+))?\])?$/;
  const HTML_NAME_PART = /([.#])([A-Za-z_][\w-]*)/g;
  const HTML_ATTR_VALUE = /^[A-Za-z0-9_.:@-]+$/;
  const HTML_REJECTED_TAGS = new Set([
    'html', 'head', 'body', 'script', 'style', 'meta', 'link', 'base',
    'title', 'textarea'
  ]);

  function parseHtmlSimpleSelector(raw) {
    if (!raw || raw.length > MAX_HTML_SELECTOR_LENGTH) {
      return { error: 'HTML filter selector too long' };
    }
    const match = HTML_SIMPLE_SELECTOR.exec(raw);
    if (!match) return { error: 'unsafe HTML filter selector' };
    const tag = (match[1] || '').toLowerCase();
    if (tag && HTML_REJECTED_TAGS.has(tag)) {
      return { error: 'unsafe HTML filter selector' };
    }
    const names = Array.from(String(match[2] || '').matchAll(HTML_NAME_PART));
    if (!tag && !names.length && !match[3]) {
      return { error: 'unsafe HTML filter selector' };
    }
    let value = match[4] || '';
    if (value && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    if (value && !HTML_ATTR_VALUE.test(value)) {
      return { error: 'unsafe HTML filter selector' };
    }
    return {
      selector: {
        tag: tag || '',
        id: names.filter(name => name[1] === '#').map(name => name[2]),
        classes: names.filter(name => name[1] === '.').map(name => name[2]),
        attr: match[3] ? { name: match[3].toLowerCase(), value } : null
      }
    };
  }

  function parseHtmlFilter(prefix, raw, isException, line) {
    const text = String(raw || '').trim();
    const scopes = parseHostScopeList(prefix);
    if (scopes.error) return { error: scopes.error };
    if (scopes.specificGeneric) {
      return { error: 'specific-generic HTML filters are unsupported' };
    }
    const common = {
      includeDomains: scopes.include,
      excludeDomains: scopes.exclude,
      isException: Boolean(isException),
      html: true,
      raw: line
    };
    if (!text) return { error: 'empty HTML filter selector' };

    const responseHeader = /^responseheader\(\s*([A-Za-z0-9-]+)\s*\)$/i.exec(text);
    if (/^responseheader\s*\(/i.test(text)) {
      if (!responseHeader) return { error: 'invalid responseheader declaration' };
      const header = responseHeader[1].toLowerCase();
      if (!SAFE_RESPONSE_HEADERS.has(header)) {
        return { error: 'unsupported response header: ' + header };
      }
      if (!scopes.include.length) {
        return { error: 'responseheader filters need domain scope' };
      }
      return Object.assign(common, { kind: 'responseheader', header });
    }

    const parts = text.split(',').map(part => part.trim());
    if (parts.length > MAX_HTML_SELECTORS || parts.some(part => !part)) {
      return { error: 'invalid HTML filter selector' };
    }
    const parsed = parts.map(parseHtmlSimpleSelector);
    const error = parsed.map(part => part.error).find(Boolean);
    if (error) return { error };
    if (!scopes.include.length) return { error: 'HTML filters need domain scope' };
    return Object.assign(common, {
      kind: 'selector',
      selectors: parsed.map(part => part.selector),
      source: text
    });
  }

  function parseCosmetic(line) {
    const text = line.trim();
    const markers = [
      { token: '#@?#', isException: true, procedural: true },
      { token: '#?#', isException: false, procedural: true },
      { token: '#@^', isException: true, html: true },
      { token: '##^', isException: false, html: true },
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

    if (found.html) {
      const html = parseHtmlFilter(text.slice(0, found.index), selectorRaw,
        found.isException, text);
      if (html.error) return { error: html.error, line: text };
      return html;
    }

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

    const scopes = parseHostScopeList(text.slice(0, found.index));
    if (scopes.error) return { error: scopes.error };

    return {
      includeDomains: scopes.include,
      excludeDomains: scopes.exclude,
      specificGeneric: scopes.specificGeneric,
      selector,
      isException: found.isException, procedural: tree.plain ? null : tree
    };
  }

  Object.assign(NS, { parseCosmetic });
})(this);

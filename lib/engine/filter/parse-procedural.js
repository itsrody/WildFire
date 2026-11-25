/* WildFire filter engine: procedural cosmetic selector parser (base + ordered steps).
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const {
    PROCEDURAL_OPS, ACTION_OPS, MAX_PROCEDURAL_DEPTH, MAX_NTH_ANCESTOR,
    MAX_XPATH_LENGTH, MAX_PROCEDURAL_LIST, MAX_PROCEDURAL_PATH,
    MAX_STYLE_DECLARATIONS, MAX_STYLE_VALUE_LENGTH, compilePattern
  } = NS;

  const BLOCKED_PROPERTY_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
  const ATTRIBUTE_NAME = /^[A-Za-z_:][\w:.-]*$/;
  const PROPERTY_PART = /^[A-Za-z_$][\w$]*$/;
  const STYLE_PROPERTY = /^-?[A-Za-z][A-Za-z0-9-]*$/;
  const UNSAFE_STYLE = /(?:url\s*\(|expression\s*\(|var\s*\(|attr\s*\(|image\s*\(|behavior\s*:|-moz-binding|javascript:|data:|@|\/\*|\*\/|\\[0-9a-fA-F]|["'<>{};\\\x00-\x1f])/i;

  function isActionOp(op) {
    return ACTION_OPS.some(token => token === op + '(');
  }

  function parseNameList(arg, pattern, label) {
    if (!arg) return { error: 'empty :' + label + ' argument' };
    const names = arg.split(',').map(name => name.trim());
    if (names.length > MAX_PROCEDURAL_LIST || names.some(name => !name || !pattern.test(name))) {
      return { error: 'invalid :' + label + ' argument' };
    }
    return { names: Array.from(new Set(names)) };
  }

  // Style declarations stay inert data: WildFire applies them one at a time
  // with CSSStyleDeclaration.setProperty(), never by concatenating CSS source.
  function parseStyleDeclarations(arg) {
    if (!arg) return { error: 'empty :style argument' };
    const raw = arg.split(';').map(part => part.trim()).filter(Boolean);
    if (!raw.length || raw.length > MAX_STYLE_DECLARATIONS) {
      return { error: 'invalid :style argument' };
    }
    const declarations = raw.map(part => {
      const match = part.match(/^(-?[A-Za-z][A-Za-z0-9-]*)\s*:\s*([\s\S]+)$/);
      if (!match || !STYLE_PROPERTY.test(match[1])) return { error: 'invalid :style declaration' };
      const value = match[2].trim();
      if (!value || value.length > MAX_STYLE_VALUE_LENGTH || UNSAFE_STYLE.test(value)) {
        return { error: 'unsafe :style value' };
      }
      return { name: match[1].toLowerCase(), value };
    });
    const error = declarations.map(item => item.error).find(Boolean);
    return error ? { error } : { declarations };
  }

  function parsePropertyPath(arg) {
    const match = arg.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s*=\s*([\s\S]+))?$/);
    if (!match) return { error: 'invalid :matches-prop argument' };
    const parts = match[1].split('.');
    if (parts.length > MAX_PROCEDURAL_PATH || parts.some(part => BLOCKED_PROPERTY_PARTS.has(part))) {
      return { error: 'invalid :matches-prop path' };
    }
    if (!match[2]) return { path: parts, matcher: null };
    const raw = match[2].trim();
    const regex = selectorRegexMatcher(raw);
    if (regex) return { path: parts, matcher: regex };
    const value = unquote(raw);
    if (!value || value.length > 256 || /[\r\n\0]/.test(value)) {
      return { error: 'invalid :matches-prop argument' };
    }
    return { path: parts, matcher: { type: 'text', value } };
  }

  // Locate the first WildFire procedural token outside quotes and parentheses.
  // Native CSS pseudo-classes such as :not() are left to the CSS path.
  function proceduralStart(selector) {
    let quote = '';
    let escaped = false;
    let depth = 0;
    return selector.split('').reduce((found, ch, index) => {
      if (found !== -1) return found;
      if (escaped) {
        escaped = false;
        return found;
      }
      if (ch === '\\') {
        escaped = true;
        return found;
      }
      if (quote) {
        if (ch === quote) quote = '';
        return found;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        return found;
      }
      if (ch === '(') {
        depth++;
        return found;
      }
      if (ch === ')') {
        depth = Math.max(0, depth - 1);
        return found;
      }
      if (ch !== ':' || depth !== 0) return found;
      const tail = selector.slice(index + 1);
      if (!PROCEDURAL_OPS.some(op => tail.startsWith(op))) return found;
      // Plain :not(.x) stays in the native CSS base; only :not() with a
      // procedural argument is lifted into a procedural step.
      if (tail.startsWith('not(')) {
        const close = matchingParen(selector, index + 4);
        if (close === -1) return found;
        const arg = selector.slice(index + 5, close);
        return proceduralStart(arg) !== -1 ? index : found;
      }
      return index;
    }, -1);
  }

  function matchingParen(text, openIndex) {
    let quote = '';
    let escaped = false;
    let depth = 0;
    return text.split('').reduce((found, ch, index) => {
      if (found !== -1 || index < openIndex) return found;
      if (escaped) {
        escaped = false;
        return found;
      }
      if (ch === '\\') {
        escaped = true;
        return found;
      }
      if (quote) {
        if (ch === quote) quote = '';
        return found;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        return found;
      }
      if (ch === '(') {
        depth++;
        return found;
      }
      if (ch === ')') {
        depth--;
        return depth === 0 ? index : found;
      }
      return found;
    }, -1);
  }

  function unquote(value) {
    const text = value.trim();
    const quote = text.charAt(0);
    if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
      return text.slice(1, -1).replace(/\\(["'\\])/g, '$1');
    }
    return text;
  }

  function selectorRegexMatcher(source) {
    const match = source.match(/^\/([\s\S]*)\/([imsu]*)$/);
    if (!match) return null;
    const compiled = compilePattern('/' + match[1] + '/', false, match[2]);
    if (compiled.error) return null;
    return { type: 'regex', source: compiled.regex.source, flags: compiled.regex.flags };
  }

  // Coarse structural guard for filter-supplied XPath: paired quotes and
  // non-negative, zero-ending bracket/paren depth. It is not a full XPath
  // parser; anything it passes is still evaluated read-only by Gecko, and a
  // runtime syntax error simply yields no match (never thrown into the page).
  function xpathStructureOk(expr) {
    let quote = '';
    let depth = 0;
    const ok = expr.split('').reduce((valid, ch) => {
      if (!valid) return false;
      if (quote) {
        if (ch === quote) quote = '';
        return true;
      }
      if (ch === '"' || ch === "'") { quote = ch; return true; }
      if (ch === '(' || ch === '[') { depth++; return true; }
      if (ch === ')' || ch === ']') { depth--; return depth >= 0; }
      return true;
    }, true);
    return ok && depth === 0 && quote === '';
  }

  function parseStepList(text, depth, allowAction) {
    if (!text) return { steps: [] };
    if (depth > MAX_PROCEDURAL_DEPTH) return { error: 'procedural selector too deep' };
    if (proceduralStart(text) !== 0) return { error: 'invalid procedural selector' };

    const body = text.slice(1);
    const open = body.indexOf('(');
    if (open === -1) return { error: 'unclosed procedural selector' };
    const op = body.slice(0, open).trim();
    const close = matchingParen(body, open);
    if (close === -1) return { error: 'unbalanced procedural selector' };
    const arg = body.slice(open + 1, close).trim();
    const tail = body.slice(close + 1).trim();

    if (isActionOp(op) && (!allowAction || tail)) {
      return { error: 'action operator must be trailing on the root selector' };
    }

    let step;
    if (op === 'has-text' || op === 'contains') {
      if (!arg) return { error: 'empty :' + op + ' argument' };
      if (arg.startsWith('/')) {
        const matcher = selectorRegexMatcher(arg);
        if (!matcher) return { error: 'invalid :' + op + ' regex' };
        step = { op, matcher };
      } else {
        const value = unquote(arg);
        if (!value) return { error: 'empty :' + op + ' argument' };
        step = { op, matcher: { type: 'text', value } };
      }
    } else if (op === 'matches-path') {
      // uBO accepts plain text as a case-insensitive substring or a /regex/.
      // A /regex/ candidate is never reinterpreted as text when it fails safety.
      let matcher = null;
      if (arg.startsWith('/')) matcher = selectorRegexMatcher(arg);
      else {
        const value = unquote(arg);
        if (value && value.length <= 512 && !/[\r\n\0]/.test(value)) {
          matcher = { type: 'text', value };
        }
      }
      if (!matcher) return { error: 'invalid :matches-path argument' };
      step = { op: 'matches-path', matcher };
    } else if (op === 'has') {
      if (!arg) return { error: 'empty :has argument' };
      const inner = parseSelectorTree(arg, depth + 1, false);
      if (inner.error) return { error: inner.error };
      step = { op: 'has', inner };
    } else if (op === 'nth-ancestor' || op === 'upward') {
      // uBO `:upward(n)` is equivalent to WildFire `:nth-ancestor(n)`.
      if (/^\d+$/.test(arg)) {
        const count = Number(arg);
        if (!Number.isInteger(count) || count < 1 || count > MAX_NTH_ANCESTOR) {
          return { error: 'invalid :' + op + ' argument' };
        }
        step = { op: 'nth-ancestor', count };
      } else if (op === 'upward') {
        const value = arg.trim();
        if (!value) return { error: 'invalid :upward argument' };
        if (!/^[A-Za-z0-9_#.[\]*:()>+~\s="'^$|-]+$/.test(value)) {
          return { error: 'invalid :upward argument' };
        }
        try { if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('selector(' + value + ')')) return { error: 'invalid :upward argument' }; } catch (error) {}
        step = { op: 'upward', selector: value };
      } else {
        return { error: 'invalid :nth-ancestor argument' };
      }
    } else if (op === 'min-text-length') {
      const n = Number(arg.trim());
      if (!Number.isInteger(n) || n < 1 || n > 16384) return { error: 'invalid :min-text-length argument' };
      step = { op: 'min-text-length', length: n };
    } else if (op === 'matches-attr') {
      // :matches-attr(name), :matches-attr(name=/re/), or literal =value/"value".
      const m = arg.match(/^([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(.+))?$/);
      if (!m) return { error: 'invalid :matches-attr argument' };
      const name = m[1];
      if (!m[2]) { step = { op: 'matches-attr', name, matcher: null }; }
      else {
        const raw = m[2].trim();
        const regex = selectorRegexMatcher(raw);
        if (regex) {
          step = { op: 'matches-attr', name, matcher: regex };
        } else {
          const value = unquote(raw);
          if (value.length > 256 || /[\r\n\0]/.test(value)) return { error: 'invalid :matches-attr argument' };
          step = { op: 'matches-attr', name, matcher: { type: 'text', value } };
        }
      }
    } else if (op === 'matches-css' || op === 'matches-css-before' || op === 'matches-css-after') {
      // :matches-css(property: value|/re/) reads computed style only; the
      // -before/-after variants target the matching pseudo-element.
      const m = arg.match(/^(-?[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([\s\S]+)$/);
      if (!m) return { error: 'invalid :' + op + ' argument' };
      const name = m[1].toLowerCase();
      const raw = m[2].trim();
      if (!raw) return { error: 'empty :' + op + ' value' };
      let matcher;
      if (raw.startsWith('/')) {
        matcher = selectorRegexMatcher(raw);
        if (!matcher) return { error: 'invalid :' + op + ' regex' };
      } else {
        const value = unquote(raw);
        if (!value || value.length > 256 || /[\r\n\0]/.test(value)) return { error: 'invalid :' + op + ' argument' };
        matcher = { type: 'text', value };
      }
      const pseudo = op === 'matches-css-before' ? '::before' : op === 'matches-css-after' ? '::after' : '';
      step = { op: 'matches-css', name, matcher, pseudo };
    } else if (op === 'matches-media') {
      // :matches-media(<media-query>) is answered read-only by Gecko's native
      // matchMedia engine. The query is bounded data; Gecko validates its syntax
      // at runtime and an invalid query simply never matches.
      const query = arg.trim();
      if (!query) return { error: 'empty :matches-media argument' };
      if (query.length > 256 || /[\r\n\0]/.test(query)) return { error: 'invalid :matches-media argument' };
      step = { op: 'matches-media', query };
    } else if (op === 'xpath') {
      // :xpath(expr) is evaluated read-only by Gecko's native XPath engine with
      // the base match as context. The expression is bounded data, never code.
      const expr = arg.trim();
      if (!expr) return { error: 'empty :xpath argument' };
      if (expr.length > MAX_XPATH_LENGTH) return { error: ':xpath expression too long' };
      if (/[\r\n\0]/.test(expr)) return { error: 'invalid :xpath argument' };
      if (!xpathStructureOk(expr)) return { error: 'unbalanced :xpath argument' };
      step = { op: 'xpath', expr };
    } else if (op === 'matches-prop') {
      const parsed = parsePropertyPath(arg);
      if (parsed.error) return { error: parsed.error };
      step = { op: 'matches-prop', path: parsed.path, matcher: parsed.matcher };
    } else if (op === 'others') {
      if (arg) return { error: 'unexpected :others argument' };
      step = { op: 'others' };
    } else if (op === 'watch-attr') {
      const parsed = arg ? parseNameList(arg, ATTRIBUTE_NAME, 'watch-attr') : { names: [] };
      if (parsed.error) return { error: parsed.error };
      step = { op: 'watch-attr', names: parsed.names };
    } else if (op === 'remove') {
      if (arg) return { error: 'unexpected :remove argument' };
      step = { op: 'remove' };
    } else if (op === 'style') {
      const parsed = parseStyleDeclarations(arg);
      if (parsed.error) return { error: parsed.error };
      step = { op: 'style', declarations: parsed.declarations };
    } else if (op === 'remove-attr') {
      const parsed = parseNameList(arg, ATTRIBUTE_NAME, 'remove-attr');
      if (parsed.error) return { error: parsed.error };
      step = { op: 'remove-attr', names: parsed.names };
    } else if (op === 'remove-class') {
      const parsed = parseNameList(arg, /^[A-Za-z_][\w-]*$/, 'remove-class');
      if (parsed.error) return { error: parsed.error };
      step = { op: 'remove-class', names: parsed.names };
    } else if (op === 'not') {
      // :not(<procedural>) negates a procedural match on the node itself.
      // Plain :not(.x) never reaches here; it stays in the native CSS base.
      if (!arg) return { error: 'empty :not argument' };
      const inner = parseSelectorTree(arg, depth + 1, false);
      if (inner.error) return { error: inner.error };
      step = { op: 'not', inner };
    } else {
      return { error: 'unknown procedural selector' };
    }


    const next = tail ? parseStepList(tail, depth + 1, allowAction) : { steps: [] };
    if (next.error) return next;
    return { steps: [step].concat(next.steps) };
  }

  function parseSelectorTree(text, depth, allowAction) {
    const start = proceduralStart(text);
    if (start === -1) return { plain: text.trim() };
    if (depth > MAX_PROCEDURAL_DEPTH) return { error: 'procedural selector too deep' };
    const base = text.slice(0, start).trim() || '*';
    const parsed = parseStepList(text.slice(start), depth, allowAction !== false);
    if (parsed.error) return parsed;
    return { base, steps: parsed.steps, source: text };
  }

  // Structural mirror of the content-side native compiler. It lets the
  // background keep only generic procedural rules Gecko can handle natively,
  // without needing CSS.supports (which is unavailable in the background).
  function nativeStepShape(step) {
    if (!step) return false;
    if (step.op === 'matches-attr') {
      if (!/^[A-Za-z_:][\w:.-]*$/.test(String(step.name || ''))) return false;
      return !step.matcher || step.matcher.type === 'text';
    }
    if (step.op === 'has' || step.op === 'not') return nativeTreeShape(step.inner);
    return false;
  }

  function nativeTreeShape(tree) {
    if (!tree) return false;
    if (tree.plain) return true;
    return Array.isArray(tree.steps) && tree.steps.every(nativeStepShape);
  }

  function isLowCostProcedural(tree) {
    if (!tree || !Array.isArray(tree.steps)) return false;
    return tree.steps.every(step =>
      step.op === 'matches-path' || nativeStepShape(step));
  }

  Object.assign(NS, { proceduralStart, matchingParen, unquote, selectorRegexMatcher, xpathStructureOk, parseStepList, parseSelectorTree, isLowCostProcedural });
})(this);

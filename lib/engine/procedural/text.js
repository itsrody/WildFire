/* WildFire procedural evaluator: regex cache and text/path matchers.
 * Classic-script module; load after its dependencies (content-script order). */
(function (global) {
  'use strict';

  const NS = global.WildFireProceduralCore = global.WildFireProceduralCore || {};

  const regexCache = new Map();

  function compile(matcher) {
    if (!matcher || matcher.type !== 'regex') return null;
    const key = matcher.source + '\u0000' + matcher.flags;
    if (regexCache.has(key)) return regexCache.get(key);
    let regex = null;
    try {
      regex = new RegExp(matcher.source, matcher.flags);
    } catch (error) {
      regex = null;
    }
    regexCache.set(key, regex);
    return regex;
  }

  // :has-text() looks only at an element's own text nodes; :contains() also
  // accepts a match anywhere in the subtree. Neither reads innerHTML or runs
  // script from a filter.
  function ownText(node) {
    if (!node) return '';
    if (node.childNodes && typeof node.childNodes.length === 'number') {
      return Array.from(node.childNodes)
        .filter(child => child && child.nodeType === 3)
        .map(child => String(child.textContent || ''))
        .join('');
    }
    return String(node.textContent || '');
  }

  function hasText(node, matcher) {
    const text = ownText(node);
    if (matcher.type === 'regex') {
      const regex = compile(matcher);
      return regex ? regex.test(text) : false;
    }
    const value = String(matcher.value || '').toLowerCase();
    return value ? text.toLowerCase().indexOf(value) !== -1 : false;
  }

  function containsText(node, matcher) {
    if (hasText(node, matcher)) return true;
    if (!node || typeof node.querySelectorAll !== 'function') return false;
    let descendants;
    try {
      descendants = Array.from(node.querySelectorAll('*'));
    } catch (error) {
      return false;
    }
    return descendants.some(descendant => hasText(descendant, matcher));
  }

  function matchesPath(matcher, path) {
    if (!matcher) return false;
    const text = String(path || '');
    if (matcher.type === 'text') {
      const value = String(matcher.value || '').toLowerCase();
      return Boolean(value) && text.toLowerCase().indexOf(value) !== -1;
    }
    const regex = compile(matcher);
    return regex ? regex.test(text) : false;
  }

  Object.assign(NS, { compile, hasText, containsText, matchesPath });
})(this);

/* WildFire - evaluates parsed procedural cosmetic selectors over DOM nodes.
 *
 * This library never touches browser APIs and never injects script into a page.
 * It only reads textContent and runs querySelector(All) on nodes supplied by
 * content/cosmetic.js.
 */
(function (global) {
  'use strict';

  const MAX_DEPTH = 8;
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

  function hasText(node, matcher) {
    const text = String((node && node.textContent) || '');
    if (matcher.type === 'regex') {
      const regex = compile(matcher);
      return regex ? regex.test(text) : false;
    }
    const value = String(matcher.value || '').toLowerCase();
    return value ? text.toLowerCase().indexOf(value) !== -1 : false;
  }

  function matchesPath(matcher, path) {
    const regex = compile(matcher);
    return regex ? regex.test(String(path || '')) : false;
  }

  function stepMatches(node, step, path, depth) {
    if (!node || !step) return false;
    if (step.op === 'has-text') return hasText(node, step.matcher);
    if (step.op === 'matches-path') return matchesPath(step.matcher, path);
    if (step.op === 'has') return treeMatches(node, step.inner, path, depth);
    return false;
  }

  // A plain tree asks whether the node contains a matching descendant; a
  // procedural tree asks whether any descendant matching its base passes all
  // of its steps.
  function treeMatches(node, tree, path, depth) {
    if (!node || !tree || depth > MAX_DEPTH) return false;
    if (tree.plain) {
      try {
        return typeof node.querySelector === 'function' &&
          Boolean(node.querySelector(tree.plain));
      } catch (error) {
        return false;
      }
    }
    if (!Array.isArray(tree.steps) || typeof node.querySelectorAll !== 'function') return false;
    let candidates;
    try {
      candidates = Array.from(node.querySelectorAll(tree.base || '*'));
    } catch (error) {
      return false;
    }
    return candidates.some(candidate =>
      tree.steps.every(step => stepMatches(candidate, step, path, depth + 1)));
  }

  function select(root, rule, path) {
    if (!root || !rule || typeof root.querySelectorAll !== 'function') return [];
    let candidates;
    try {
      candidates = Array.from(root.querySelectorAll(rule.base || '*'));
    } catch (error) {
      return [];
    }
    return candidates.filter(node =>
      rule.steps.every(step => stepMatches(node, step, path, 0)));
  }

  global.WildFireProcedural = { select, matches: treeMatches };
})(this);

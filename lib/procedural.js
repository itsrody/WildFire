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
    const regex = compile(matcher);
    return regex ? regex.test(String(path || '')) : false;
  }

  function ancestor(node, count) {
    return Array.from({ length: count }).reduce(current =>
      current && current.parentElement ? current.parentElement : null, node);
  }

  // Most steps only test a node; :nth-ancestor() changes which node the rule
  // ends up hiding, so evaluation returns the final target rather than a bool.
  function targetOf(node, steps, path, depth) {
    if (!node || !Array.isArray(steps)) return null;
    return steps.reduce((current, step) => {
      if (!current || !step) return null;
      if (step.op === 'nth-ancestor') return ancestor(current, step.count);
      return stepMatches(current, step, path, depth) ? current : null;
    }, node);
  }

  function stepMatches(node, step, path, depth) {
    if (!node || !step) return false;
    if (step.op === 'has-text') return hasText(node, step.matcher);
    if (step.op === 'contains') return containsText(node, step.matcher);
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
      targetOf(candidate, tree.steps, path, depth + 1) !== null);
  }

  function plainHas(step) {
    if (!step || step.op !== 'has' || !step.inner || !step.inner.plain) return '';
    return String(step.inner.plain).trim();
  }

  // Even a procedural :has() inner tree has a plain base that every match must
  // satisfy, so that base is a safe native prefilter for the JS pass.
  function hasBase(step) {
    if (!step || step.op !== 'has' || !step.inner) return '';
    return String(step.inner.plain || step.inner.base || '').trim();
  }

  function cssSafe(selector) {
    if (typeof selector !== 'string' || !selector) return false;
    if (typeof CSS === 'undefined' || !CSS.supports) return false;
    try {
      return Boolean(CSS.supports('selector', selector));
    } catch (error) {
      return false;
    }
  }

  function withHas(base, inners) {
    if (!inners.length) return base;
    // A selector list would bind :has() only to its last item without :is().
    const scoped = base.indexOf(',') === -1 ? base : ':is(' + base + ')';
    return scoped + inners.map(inner => ':has(' + inner + ')').join('');
  }

  // Pick the cheapest way to apply a rule. A :matches-path() step is a page
  // constant, so it is evaluated once here and dropped from the node steps.
  // Plain :has() steps become native CSS when Gecko accepts the selector; when
  // text steps remain they become a native candidate prefilter for the JS pass.
  function classify(rule, path) {
    if (!rule || !Array.isArray(rule.steps)) {
      return { mode: 'js', rule, steps: [], prefilter: '' };
    }
    const steps = [];
    const inners = [];
    const prefilterParts = [];
    let skipped = false;
    rule.steps.forEach(step => {
      if (step.op === 'matches-path') {
        if (!matchesPath(step.matcher, path)) skipped = true;
        return;
      }
      const plain = plainHas(step);
      if (plain) inners.push(plain);
      const basePart = hasBase(step);
      if (basePart) prefilterParts.push(basePart);
      steps.push(step);
    });
    if (skipped) return { mode: 'skip' };

    const base = rule.base || '*';
    if (!steps.length) {
      return cssSafe(base)
        ? { mode: 'css', selector: base }
        : { mode: 'js', rule, steps, prefilter: '' };
    }
    const nativeSelector = withHas(base, inners);
    if (inners.length === steps.length && cssSafe(nativeSelector)) {
      return { mode: 'css', selector: nativeSelector };
    }
    const prefilter = withHas(base, prefilterParts);
    return {
      mode: 'js',
      rule,
      steps,
      prefilter: prefilterParts.length && cssSafe(prefilter) ? prefilter : ''
    };
  }

  // One querySelectorAll pass per unique base feeds every rule using it, so
  // many rules sharing a base do not each walk the whole document.
  function selectAll(root, entries, path) {
    if (!root || typeof root.querySelectorAll !== 'function' || !Array.isArray(entries)) return [];
    const groups = new Map();
    entries.forEach(entry => {
      if (!entry || !entry.rule) return;
      const base = entry.prefilter || entry.rule.base || '*';
      if (!groups.has(base)) groups.set(base, { base, items: [] });
      groups.get(base).items.push({
        steps: entry.steps || entry.rule.steps || []
      });
    });

    const found = [];
    groups.forEach(group => {
      let candidates;
      try {
        candidates = Array.from(root.querySelectorAll(group.base));
      } catch (error) {
        return;
      }
      group.items.forEach(item => {
        candidates.forEach(node => {
          const target = targetOf(node, item.steps, path, 0);
          if (target) found.push(target);
        });
      });
    });
    return found;
  }

  function select(root, rule, path) {
    return selectAll(root, [{ rule }], path);
  }

  global.WildFireProcedural = { select, selectAll, classify, matches: treeMatches };
})(this);

/* WildFire procedural evaluator: step evaluation and target-set traversal.
 * Classic-script module; load after its dependencies (content-script order). */
(function (global) {
  'use strict';

  const NS = global.WildFireProceduralCore = global.WildFireProceduralCore || {};
  const { compile, hasText, containsText, matchesPath } = NS;

  const MAX_DEPTH = 8;
  const MAX_XPATH_RESULTS = 256;

  function ancestor(node, count) {
    return Array.from({ length: count }).reduce(current =>
      current && current.parentElement ? current.parentElement : null, node);
  }

  function upward(node, selector, depth) {
    if (!node || !selector || (depth || 0) > 256) return null;
    const current = node.parentElement;
    if (!current) return null;
    try {
      if (current.matches(selector)) return current;
    } catch (error) {
      return null;
    }
    return upward(current, selector, (depth || 0) + 1);
  }

  // Most steps only test a node; :nth-ancestor()/:upward()/:xpath() change which
  // node(s) the rule ends up hiding. Evaluation therefore threads a SET of
  // current targets through the steps: testing steps filter it, transforming
  // steps map it, and :xpath() expands it to every element result (bounded).
  function targetsOf(node, steps, path, depth) {
    if (!node || !Array.isArray(steps)) return [];
    return steps.reduce((currents, step) => {
      if (!currents.length || !step) return [];
      if (step.op === 'xpath') return currents.flatMap(current => xpathTargets(current, step.expr));
      if (step.op === 'nth-ancestor') return currents.map(current => ancestor(current, step.count)).filter(Boolean);
      if (step.op === 'upward') return currents.map(current => upward(current, step.selector)).filter(Boolean);
      return currents.filter(current => stepMatches(current, step, path, depth));
    }, [node]);
  }

  // :xpath(expr) delegates to Gecko's native XPath engine (document.evaluate),
  // read-only, with the current node as context. ORDERED_NODE_SNAPSHOT_TYPE (7)
  // materializes the whole node-set natively; WildFire reads at most
  // MAX_XPATH_RESULTS of them and keeps only element nodes, so the hide set
  // stays bounded. A syntax/eval error yields no match, never a page throw.
  function xpathTargets(node, expr) {
    if (!node || !expr) return [];
    const doc = node.ownerDocument;
    if (!doc || typeof doc.evaluate !== 'function') return [];
    let result;
    try {
      result = doc.evaluate(expr, node, null, 7, null);
    } catch (error) {
      return [];
    }
    if (!result || typeof result.snapshotLength !== 'number') return [];
    const count = Math.min(result.snapshotLength, MAX_XPATH_RESULTS);
    return Array.from({ length: count }, (unused, index) => result.snapshotItem(index))
      .filter(target => target && target.nodeType === 1);
  }

  function matchesAttr(node, step) {
    if (!node || !step || !step.name) return false;
    if (typeof node.getAttribute !== 'function') return false;
    const value = node.getAttribute(step.name);
    if (value === null) return false;
    if (!step.matcher) return true;
    if (step.matcher.type === 'text') return value === String(step.matcher.value || '');
    const regex = compile(step.matcher);
    return regex ? regex.test(value) : false;
  }

  // :matches-css() reads Gecko's computed style for the node (or its
  // ::before/::after pseudo-element) and compares a single property. It is
  // read-only: no style is written and no filter text becomes script.
  function matchesCss(node, step) {
    if (!node || !step || !step.name) return false;
    const doc = node.ownerDocument;
    const view = doc && doc.defaultView;
    if (!view || typeof view.getComputedStyle !== 'function') return false;
    let style;
    try {
      style = view.getComputedStyle(node, step.pseudo || null);
    } catch (error) {
      return false;
    }
    if (!style || typeof style.getPropertyValue !== 'function') return false;
    const value = String(style.getPropertyValue(step.name) || '').trim();
    if (!value) return false;
    if (step.matcher && step.matcher.type === 'regex') {
      const regex = compile(step.matcher);
      return regex ? regex.test(value) : false;
    }
    const needle = String((step.matcher && step.matcher.value) || '').toLowerCase();
    return needle ? value.toLowerCase().indexOf(needle) !== -1 : false;
  }

  // :matches-media() asks Gecko's native media-query engine (matchMedia) whether
  // the query matches the current viewport. It is read-only; an invalid query
  // throws or reports no match, both of which yield false (never a page throw).
  function matchesMedia(node, query) {
    if (!node || !query) return false;
    const doc = node.ownerDocument;
    const view = doc && doc.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return false;
    try {
      return Boolean(view.matchMedia(query).matches);
    } catch (error) {
      return false;
    }
  }

  function stepMatches(node, step, path, depth) {
    if (!node || !step) return false;
    if (step.op === 'has-text') return hasText(node, step.matcher);
    if (step.op === 'contains') return containsText(node, step.matcher);
    if (step.op === 'matches-path') return matchesPath(step.matcher, path);
    if (step.op === 'min-text-length') return String(node.textContent || '').length >= Number(step.length || 0);
    if (step.op === 'matches-attr') return matchesAttr(node, step);
    if (step.op === 'matches-css') return matchesCss(node, step);
    if (step.op === 'matches-media') return matchesMedia(node, step.query);
    if (step.op === 'has') return treeMatches(node, step.inner, path, depth);
    if (step.op === 'not') return !selfMatchesTree(node, step.inner, path, depth + 1);
    return false;
  }

  // Whether the node itself matches a selector tree (base + steps), used to
  // negate procedural operands inside :not(). Unlike treeMatches (which probes
  // descendants for :has()), this tests the candidate node directly.
  function selfMatchesTree(node, tree, path, depth) {
    if (!node || !tree || depth > MAX_DEPTH) return false;
    if (tree.plain) {
      try {
        return typeof node.matches === 'function' && node.matches(tree.plain);
      } catch (error) {
        return false;
      }
    }
    const base = tree.base || '*';
    if (base !== '*') {
      try {
        if (typeof node.matches !== 'function' || !node.matches(base)) return false;
      } catch (error) {
        return false;
      }
    }
    return targetsOf(node, tree.steps || [], path, depth).length > 0;
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
      targetsOf(candidate, tree.steps, path, depth + 1).length > 0);
  }

  Object.assign(NS, { targetsOf, treeMatches });
})(this);

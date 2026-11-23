/* WildFire - evaluates parsed procedural cosmetic selectors over DOM nodes.
 *
 * This library never touches browser extension APIs and never injects script
 * into a page. It only reads textContent/attributes/computed style and runs
 * querySelector(All) on nodes supplied by content/cosmetic.js.
 */
(function (global) {
  'use strict';

  const MAX_DEPTH = 8;
  const MAX_XPATH_RESULTS = 256;
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

  function cssIdent(name) {
    return /^[A-Za-z_][\w-]*$/.test(String(name || ''));
  }

  function plainHas(step) {
    if (!step || step.op !== 'has' || !step.inner) return '';
    if (step.inner.plain) return String(step.inner.plain).trim();
    if (!Array.isArray(step.inner.steps)) return '';
    const base = String(step.inner.base || '*').trim();
    const parts = [];
    const ok = step.inner.steps.every(innerStep => {
      const frag = nativeStep(innerStep);
      if (!frag) return false;
      if (frag.type === 'has') parts.push(':has(' + frag.value + ')');
      else if (frag.type === 'self') parts.push(frag.value);
      else return false;
      return true;
    });
    if (!ok) return '';
    const scoped = base.indexOf(',') === -1 ? base : ':is(' + base + ')';
    return scoped + parts.join('');
  }

  // Native selector fragment for a step applied to the candidate element.
  // Only safe, Gecko-native selector features are emitted.
  function nativeStep(step) {
    if (!step) return null;
    if (step.op === 'matches-attr') {
      const name = String(step.name || '');
      if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) return null;
      if (!step.matcher) return { type: 'self', value: '[' + name + ']' };
      if (step.matcher.type === 'text') {
        // literal attribute equality - safe CSS
        const v = String(step.matcher.value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return { type: 'self', value: '[' + name + '="' + v + '"]' };
      }
      return null;
    }
    if (step.op === 'has') {
      const inner = plainHas(step);
      return inner ? { type: 'has', value: inner } : null;
    }
    return null;
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
    const scoped = base.indexOf(',') === -1 ? base : ':is(' + base + ')';
    return scoped + inners.map(inner => ':has(' + inner + ')').join('');
  }

  function withNative(base, selfs, inners) {
    const scoped = base.indexOf(',') === -1 ? base : ':is(' + base + ')';
    return scoped + selfs.join('') + inners.map(inner => ':has(' + inner + ')').join('');
  }

  // Pick the cheapest way to apply a rule. A :matches-path() step is a page
  // constant, so it is evaluated once here and dropped from the node steps.
  // Steps are compiled to native Gecko CSS fragments when representable:
  // plain `:has()` becomes `:has(...)`, `:matches-attr(name)` becomes `[name]`,
  // `:matches-attr(name="literal")` becomes `[name="literal"]`.
  // Regex/text-length/ancestor/text steps remain in JS, but native fragments
  // still prefilter candidates so JS only inspects a narrower set.
  function classify(rule, path) {
    if (!rule || !Array.isArray(rule.steps)) {
      return { mode: 'js', rule, steps: [], prefilter: '' };
    }
    const steps = [];
    const nativeSelfs = [];
    const nativeInners = [];
    const prefilterSelfs = [];
    const prefilterInners = [];
    let skipped = false;
    rule.steps.forEach(step => {
      if (step.op === 'matches-path') {
        if (!matchesPath(step.matcher, path)) skipped = true;
        return;
      }
      const frag = nativeStep(step);
      if (frag && frag.type === 'self') {
        nativeSelfs.push(frag.value);
        prefilterSelfs.push(frag.value);
      }
      if (frag && frag.type === 'has') {
        nativeInners.push(frag.value);
        prefilterInners.push(frag.value);
      } else {
        const basePart = hasBase(step);
        if (basePart) prefilterInners.push(basePart);
      }
      steps.push(step);
    });
    if (skipped) return { mode: 'skip' };

    const base = rule.base || '*';
    if (!steps.length) {
      return cssSafe(base)
        ? { mode: 'css', selector: base }
        : { mode: 'js', rule, steps, prefilter: '' };
    }
    const nativeSelector = withNative(base, nativeSelfs, nativeInners);
    const nativeCount = nativeSelfs.length + nativeInners.length;
    if (nativeCount === steps.length && cssSafe(nativeSelector)) {
      return { mode: 'css', selector: nativeSelector };
    }
    const prefilter = withNative(base, prefilterSelfs, prefilterInners);
    const hasPrefilter = prefilterSelfs.length + prefilterInners.length > 0;
    return {
      mode: 'js',
      rule,
      steps,
      prefilter: hasPrefilter && cssSafe(prefilter) ? prefilter : ''
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
          targetsOf(node, item.steps, path, 0).forEach(target => found.push(target));
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

/* WildFire - evaluates parsed procedural cosmetic selectors over DOM nodes.
 *
 * This library never touches browser extension APIs and never injects script
 * into a page. It only reads textContent/attributes/computed style and runs
 * querySelector(All) on nodes supplied by content/cosmetic.js.
 */
(function (global) {
  'use strict';

  const NS = global.WildFireProceduralCore;
  const { matchesPath, targetsOf, treeMatches, others, nativeStep, hasBase, withNative, cssSafe } = NS;

  const ACTION_STEPS = new Set(['remove', 'style', 'remove-attr', 'remove-class']);

  function isActionStep(step) {
    return Boolean(step && ACTION_STEPS.has(step.op));
  }

  function hasActions(entry) {
    return Boolean(entry && Array.isArray(entry.steps) && entry.steps.some(isActionStep));
  }

  function withoutActions(steps) {
    return (Array.isArray(steps) ? steps : []).filter(step => !isActionStep(step));
  }

  // :others() is a set transform, so it must see every candidate before it can
  // compute the sibling complement. Other steps stay node-local.
  function targetsForCandidates(candidates, steps, path) {
    const othersIndex = steps.findIndex(step => step && step.op === 'others');
    if (othersIndex === -1) {
      return candidates.flatMap(node => targetsOf(node, steps, path, 0));
    }
    const prefix = steps.slice(0, othersIndex);
    const suffix = steps.slice(othersIndex + 1);
    const subjects = candidates.filter(node => targetsOf(node, prefix, path, 0).length > 0);
    return others(subjects).flatMap(target => targetsOf(target, suffix, path, 0));
  }

  // Pick the cheapest way to apply a rule. A :matches-path() step is a page
  // constant, so it is evaluated once here and dropped from the node steps.
  // Steps are compiled to native Gecko CSS fragments when representable:
  // plain `:has()` becomes `:has(...)`, `:matches-attr(name)` becomes `[name]`,
  // `:matches-attr(name="literal")` becomes `[name="literal"]`, and a fully
  // native `:not(:has(...))` becomes `:not(:has(...))`.
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
      if (!entry || !entry.rule || hasActions(entry)) return;
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
        found.push(...targetsForCandidates(candidates, item.steps || [], path));
      });
    });
    return found;
  }

  function applyAction(node, action) {
    if (!node || !action) return true;
    if (action.op === 'remove') {
      if (typeof node.remove === 'function') node.remove();
      else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
      return false;
    }
    if (action.op === 'style') {
      if (!node.style || typeof node.style.setProperty !== 'function') return true;
      (Array.isArray(action.declarations) ? action.declarations : []).forEach(declaration => {
        try {
          node.style.setProperty(declaration.name, declaration.value, 'important');
        } catch (error) {
          /* Invalid CSS is ignored; filter data never throws into the page. */
        }
      });
      return true;
    }
    if (action.op === 'remove-attr') {
      if (typeof node.removeAttribute !== 'function') return true;
      (Array.isArray(action.names) ? action.names : []).forEach(name => {
        try { node.removeAttribute(name); } catch (error) {}
      });
      return true;
    }
    if (action.op === 'remove-class') {
      if (!node.classList || typeof node.classList.remove !== 'function') return true;
      (Array.isArray(action.names) ? action.names : []).forEach(name => {
        try { node.classList.remove(name); } catch (error) {}
      });
      return true;
    }
    return true;
  }

  // DOM actions are applied only to nodes that pass the validated procedural
  // selector. Cached/classified entries carry parsed data, never code, and the
  // selector is revalidated with Gecko before any node is touched.
  function applyActions(root, entries, path) {
    if (!root || typeof root.querySelectorAll !== 'function' || !Array.isArray(entries)) return;
    entries.filter(hasActions).forEach(entry => {
      const selector = entry.prefilter || entry.rule.base || '*';
      if (!cssSafe(selector)) return;
      let candidates;
      try {
        candidates = Array.from(root.querySelectorAll(selector));
      } catch (error) {
        return;
      }
      const actions = entry.steps.filter(isActionStep);
      const testing = withoutActions(entry.steps);
      targetsForCandidates(candidates, testing, path).forEach(node => {
        if (!node || node.isConnected === false) return;
        actions.reduce((live, action) => live && applyAction(node, action), true);
      });
    });
  }

  function select(root, rule, path) {
    return selectAll(root, [{ rule }], path);
  }

  global.WildFireProcedural = { select, selectAll, classify, matches: treeMatches, applyActions, hasActions };
})(this);

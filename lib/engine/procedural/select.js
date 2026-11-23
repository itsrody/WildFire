/* WildFire - evaluates parsed procedural cosmetic selectors over DOM nodes.
 *
 * This library never touches browser extension APIs and never injects script
 * into a page. It only reads textContent/attributes/computed style and runs
 * querySelector(All) on nodes supplied by content/cosmetic.js.
 */
(function (global) {
  'use strict';

  const NS = global.WildFireProceduralCore;
  const { matchesPath, targetsOf, treeMatches, nativeStep, hasBase, withNative, cssSafe } = NS;

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

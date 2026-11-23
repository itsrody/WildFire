/* WildFire procedural evaluator: native Gecko CSS compilation for safe steps.
 * Classic-script module; load after its dependencies (content-script order). */
(function (global) {
  'use strict';

  const NS = global.WildFireProceduralCore = global.WildFireProceduralCore || {};

  function plainHas(step) {
    if (!step || step.op !== 'has' || !step.inner) return '';
    return nativeTree(step.inner);
  }

  // Reconstruct a selector tree as native Gecko CSS when every part is
  // native-representable; otherwise return '' so the caller keeps it in JS.
  function nativeTree(tree) {
    if (!tree) return '';
    if (tree.plain) return String(tree.plain).trim();
    if (!Array.isArray(tree.steps)) return '';
    const base = String(tree.base || '*').trim();
    const parts = [];
    const ok = tree.steps.every(innerStep => {
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
    if (step.op === 'not') {
      // :not(<operand>) compiles to native CSS only when the whole operand is
      // native-representable (e.g. :not(:has(.x))); Gecko evaluates :has() inside
      // :not() natively. A procedural operand (text/regex/…) stays in JS.
      const inner = nativeTree(step.inner);
      if (!inner) return null;
      return { type: 'self', value: ':not(' + inner + ')' };
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


  function withNative(base, selfs, inners) {
    const scoped = base.indexOf(',') === -1 ? base : ':is(' + base + ')';
    return scoped + selfs.join('') + inners.map(inner => ':has(' + inner + ')').join('');
  }

  Object.assign(NS, { nativeStep, hasBase, withNative, cssSafe });
})(this);

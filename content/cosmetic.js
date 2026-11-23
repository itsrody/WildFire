/* WildFire - cosmetic filtering. Applies rules supplied by the background. */
(function () {
  'use strict';

  if (window.__wildFireCosmeticReady) return;
  window.__wildFireCosmeticReady = true;

  const client = WildFireWapiClient.create();
  const ATTRIBUTE_HIDE = '[data-wildfire-hidden]{display:none!important;}';

  let styleElement = null;
  let proceduralStyle = null;
  let proceduralRules = [];
  let dynamicEntries = [];
  let hiddenNodes = new Set();
  let observer = null;
  let scheduled = false;
  let resizeBound = false;

  function isSafeSelector(selector) {
    if (typeof selector !== 'string' || !selector.trim()) return false;
    try {
      if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('selector', selector)) return false;
      document.querySelector(selector);
      return true;
    } catch (error) {
      return false;
    }
  }

  function needsText(step) {
    if (!step) return false;
    if (step.op === 'has-text' || step.op === 'contains' || step.op === 'min-text-length') return true;
    if ((step.op === 'has' || step.op === 'not') && step.inner && Array.isArray(step.inner.steps)) {
      return step.inner.steps.some(needsText);
    }
    return false;
  }

  function hasAttrStep(step) {
    if (!step) return false;
    // matches-css reads computed style and xpath may test any attribute, so
    // both need the same all-attributes watch as matches-attr.
    if (step.op === 'matches-attr' || step.op === 'matches-css' || step.op === 'xpath') return true;
    if ((step.op === 'has' || step.op === 'not') && step.inner && Array.isArray(step.inner.steps)) return step.inner.steps.some(hasAttrStep);
    return false;
  }

  function hasMediaStep(step) {
    if (!step) return false;
    if (step.op === 'matches-media') return true;
    if ((step.op === 'has' || step.op === 'not') && step.inner && Array.isArray(step.inner.steps)) return step.inner.steps.some(hasMediaStep);
    return false;
  }

  function observeOptions(textSensitive, attrSensitive) {
    return {
      childList: true,
      subtree: true,
      characterData: textSensitive,
      attributes: true,
      attributeFilter: attrSensitive ? undefined : ['class', 'id']
    };
  }

  function watch(textSensitive, attrSensitive, mediaSensitive) {
    if (observer) {
      observer.disconnect();
      if (dynamicEntries.length) {
        observer.observe(document.documentElement || document, observeOptions(textSensitive, attrSensitive));
      }
    }
    // :matches-media() depends on the viewport, which can resize without any DOM
    // mutation, so re-apply on resize only while a live rule needs it.
    if (mediaSensitive && !resizeBound) {
      window.addEventListener('resize', scheduleReapply);
      resizeBound = true;
    } else if (!mediaSensitive && resizeBound) {
      window.removeEventListener('resize', scheduleReapply);
      resizeBound = false;
    }
  }

  function scheduleReapply() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      applyProcedural(proceduralRules);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else Promise.resolve().then(run);
  }

  // Only WildFire's own evaluator runs here; filter text never becomes script.
  // Tasks Gecko can do natively are injected as CSS and never re-evaluated in JS.
  function applyProcedural(rules) {
    if (observer) observer.disconnect();

    const list = Array.isArray(rules) ? rules : [];
    proceduralRules = list;
    const path = location.pathname + location.search;
    const classify = typeof WildFireProcedural !== 'undefined' && WildFireProcedural.classify
      ? WildFireProcedural.classify
      : rule => ({ mode: 'js', rule, steps: rule.steps || [], prefilter: '' });
    const classified = list.map(rule => classify(rule, path));
    const nativeSelectors = classified
      .filter(item => item.mode === 'css')
      .map(item => item.selector);
    dynamicEntries = classified.filter(item => item.mode === 'js');

    const wanted = new Set();
    if (dynamicEntries.length && typeof WildFireProcedural !== 'undefined') {
      WildFireProcedural.selectAll(document, dynamicEntries, path)
        .forEach(node => wanted.add(node));
    }
    hiddenNodes.forEach(node => {
      if (!wanted.has(node)) node.removeAttribute('data-wildfire-hidden');
    });
    wanted.forEach(node => {
      if (!hiddenNodes.has(node)) node.setAttribute('data-wildfire-hidden', '');
    });
    hiddenNodes = wanted;

    if (nativeSelectors.length || dynamicEntries.length) {
      if (!proceduralStyle) {
        proceduralStyle = document.createElement('style');
        proceduralStyle.id = 'wildfire-cosmetic-procedural';
        proceduralStyle.setAttribute('data-wildfire', '1');
        (document.head || document.documentElement).appendChild(proceduralStyle);
      }
      proceduralStyle.textContent = [ATTRIBUTE_HIDE]
        .concat(nativeSelectors.map(selector => selector + '{display:none!important;}'))
        .join('\n');
    } else if (proceduralStyle) {
      proceduralStyle.textContent = ATTRIBUTE_HIDE;
    }

    watch(dynamicEntries.some(item => item.steps.some(needsText)), dynamicEntries.some(item => item.steps.some(hasAttrStep)), dynamicEntries.some(item => item.steps.some(hasMediaStep)));
  }

  function apply(selectors, procedural) {
    const safe = Array.isArray(selectors) ? selectors.filter(isSafeSelector) : [];
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'wildfire-cosmetic';
      styleElement.setAttribute('data-wildfire', '1');
      (document.head || document.documentElement).appendChild(styleElement);
    }
    styleElement.textContent = safe.map(selector => selector + '{display:none!important;}').join('\n');

    proceduralRules = Array.isArray(procedural) ? procedural : [];
    applyProcedural(proceduralRules);
  }

  if (typeof MutationObserver !== 'undefined') observer = new MutationObserver(scheduleReapply);
  watch(false, false, false);

  client.on('apply', message => apply(message.selectors, message.procedural));

  client.send('cosmetic', { url: location.href })
    .then(response => {
      if (response && response.ok) apply(response.selectors, response.procedural);
    })
    .catch(() => {});
})();

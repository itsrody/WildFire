/* WildFire - cosmetic filtering. Applies rules supplied by the background. */
(function () {
  'use strict';

  if (window.__wildFireCosmeticReady) return;
  window.__wildFireCosmeticReady = true;

  let styleElement = null;
  let proceduralStyle = null;
  let proceduralRules = [];
  let hiddenNodes = new Set();
  let observer = null;
  let scheduled = false;

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

  function observeOptions() {
    return {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'id']
    };
  }

  function watch() {
    if (!observer) return;
    observer.disconnect();
    observer.observe(document.documentElement || document, observeOptions());
  }

  function scheduleReapply() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      applyProcedural(proceduralRules);
    });
  }

  // Only WildFire's own evaluator runs here; filter text never becomes script.
  function applyProcedural(rules) {
    if (observer) observer.disconnect();
    hiddenNodes.forEach(node => node.removeAttribute('data-wildfire-hidden'));
    hiddenNodes = new Set();

    const list = Array.isArray(rules) ? rules : [];
    if (!list.length || typeof WildFireProcedural === 'undefined') {
      watch();
      return;
    }

    if (!proceduralStyle) {
      proceduralStyle = document.createElement('style');
      proceduralStyle.id = 'wildfire-cosmetic-procedural';
      proceduralStyle.setAttribute('data-wildfire', '1');
      proceduralStyle.textContent = '[data-wildfire-hidden]{display:none!important;}';
      (document.head || document.documentElement).appendChild(proceduralStyle);
    }

    const path = location.pathname + location.search;
    list.forEach(rule => {
      WildFireProcedural.select(document, rule, path).forEach(node => {
        node.setAttribute('data-wildfire-hidden', '');
        hiddenNodes.add(node);
      });
    });
    watch();
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
  watch();

  browser.runtime.onMessage.addListener(message => {
    if (message && message.type === 'wildfire:apply') apply(message.selectors, message.procedural);
  });

  browser.runtime.sendMessage({ type: 'wildfire:cosmetic', url: location.href })
    .then(response => {
      if (response && response.ok) apply(response.selectors, response.procedural);
    })
    .catch(() => {});
})();

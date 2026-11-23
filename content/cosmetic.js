/* WildFire - cosmetic filtering. Applies CSS rules supplied by the background. */
(function () {
  'use strict';

  if (window.__wildFireCosmeticReady) return;
  window.__wildFireCosmeticReady = true;

  let styleElement = null;

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

  function apply(selectors) {
    const safe = Array.isArray(selectors) ? selectors.filter(isSafeSelector) : [];
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'wildfire-cosmetic';
      styleElement.setAttribute('data-wildfire', '1');
      (document.head || document.documentElement).appendChild(styleElement);
    }
    styleElement.textContent = safe.map(selector => selector + '{display:none!important;}').join('\n');
  }

  browser.runtime.onMessage.addListener(message => {
    if (message && message.type === 'wildfire:apply') apply(message.selectors);
  });

  browser.runtime.sendMessage({ type: 'wildfire:cosmetic', url: location.href })
    .then(response => {
      if (response && response.ok) apply(response.selectors);
    })
    .catch(() => {});
})();

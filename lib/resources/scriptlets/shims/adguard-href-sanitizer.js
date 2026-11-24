/* WildFire scriptlet shim: AdGuard relative href discovery and transforms. */
(function (global) {
  'use strict';

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
  const { arityError, lengthError, redefine, safeSelector, onDom } = NS;

  function sourceError(value) {
    return /^(?:text|\[[^\]]+\]|\?[^ ]*)?$/.test(String(value || ''))
      ? '' : 'invalid href source';
  }

  function transformError(value) {
    return /^(?:base64decode|-base64|removeHash|removeParam(?::[\w,\-]*)?)?$/
      .test(String(value || '')) ? '' : 'invalid href transform';
  }

  function decode(candidate) {
    if (!/^(?:base64decode|-base64)$/.test(String(arguments[1] || ''))) return candidate;
    const raw = String(candidate || '');
    try {
      return global.atob(raw.startsWith('#') ? raw.slice(1) : raw);
    } catch (error) {
      return '';
    }
  }

  function discover(element, source) {
    const text = String(source || 'text');
    if (text === 'text') {
      const candidate = String(element.textContent || '').trim();
      if (!/^(?:https?:\/\/|\/\/|\/|\.\.?\/|\?[^ ])/i.test(candidate)) return '';
      return candidate;
    }
    if (text.startsWith('[') && text.endsWith(']')) {
      if (typeof element.getAttribute !== 'function') return '';
      return String(element.getAttribute(text.slice(1, -1)) || '').trim();
    }
    if (text.startsWith('?')) {
      try {
        const url = new global.URL(String(element.getAttribute('href') || ''),
          global.location && global.location.href || undefined);
        return url.searchParams.get(text.slice(1)) || '';
      } catch (error) {
        return '';
      }
    }
    return '';
  }

  function sanitize(candidate, transform) {
    let text = decode(candidate, transform);
    if (!text.trim()) return '';
    try {
      const url = new global.URL(text, global.location && global.location.href || undefined);
      if (!/^https?:$/i.test(url.protocol)) return '';
      if (transform === 'removeHash') url.hash = '';
      if (String(transform).startsWith('removeParam')) {
        const names = transform.slice('removeParam'.length).replace(/^:/, '').split(',');
        if (!names.some(Boolean)) Array.from(url.searchParams.keys()).forEach(name =>
          url.searchParams.delete(name));
        else names.filter(Boolean).forEach(name => url.searchParams.delete(name));
      }
      return url.href;
    } catch (error) {
      return '';
    }
  }

  NS.ADGUARD_DEFINITIONS['href-sanitizer'] = NS.adguardOwn(
    'href-sanitizer',
    args => arityError(args, 1, 3) || lengthError(args[0], 500) ||
      sourceError(args[1]) || transformError(args[2]),
    args => {
      if (!safeSelector(args[0])) return;
      onDom(args[0], element => {
        const next = sanitize(discover(element, args[1]), args[2]);
        if (!next) return;
        redefine(element, 'href', {
          value: next, writable: true, enumerable: true, configurable: true
        });
      });
    });
})(this);

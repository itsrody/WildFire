/* WildFire - minimal Adblock-ish filter parser and matcher.
 *
 * Supported:
 *   ||example.com^            domain-anchored network filter
 *   |http://example.com/path| start/end anchored filter
 *   example.com*ad.js         wildcard filter
 *   @@||example.com^          exception (un-block)
 *   $script,image,third-party resource type / party options
 *   $domain=example.com|~foo.com  document domain options
 *   example.com##.ad          element hiding (cosmetic)
 *   example.com#@#.ad         cosmetic exception
 *
 * Deliberately not supported: regular-expression filters (/.../), $csp,
 * $rewrite, :has-text(), procedural cosmetics, and remote list updates.
 */
(function (global) {
  'use strict';

  const RESOURCE_TYPES = new Set([
    'document', 'subdocument', 'script', 'image', 'stylesheet',
    'object', 'xmlhttprequest', 'font', 'media', 'other'
  ]);

  const TYPE_ALIASES = {
    main_frame: 'document',
    document: 'document',
    sub_frame: 'subdocument',
    subdocument: 'subdocument',
    frame: 'subdocument',
    script: 'script',
    image: 'image',
    stylesheet: 'stylesheet',
    css: 'stylesheet',
    object: 'object',
    xmlhttprequest: 'xmlhttprequest',
    xhr: 'xmlhttprequest',
    font: 'font',
    media: 'media',
    other: 'other',
    ping: 'other',
    csp: 'other',
    websocket: 'other',
    web_manifest: 'other',
    speculative: 'other'
  };

  function normalizeType(value) {
    return TYPE_ALIASES[String(value || '').toLowerCase()] || null;
  }

  function escapeChar(ch) {
    return /[\\^$.*+?()[\]{}|]/.test(ch) ? '\\' + ch : ch;
  }

  function hostnameOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase().replace(/\.$/, '');
    } catch (error) {
      return '';
    }
  }

  function parentHosts(host) {
    if (!host) return [];
    return String(host).toLowerCase().split('.').filter(Boolean)
      .map((_, index, parts) => parts.slice(index).join('.'));
  }

  function domainMatches(host, domain) {
    if (!host || !domain) return false;
    const key = String(domain).toLowerCase().replace(/^\./, '');
    return host === key || host.endsWith('.' + key);
  }

  function fallbackRegistrable(host) {
    const parts = String(host || '').split('.').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  }

  function patternToRegex(pattern, matchCase) {
    let body = pattern.trim();
    let hostAnchor = false;
    let startAnchor = false;
    let endAnchor = false;

    if (body.startsWith('||')) {
      hostAnchor = true;
      body = body.slice(2);
    }
    if (body.startsWith('|')) {
      startAnchor = true;
      body = body.slice(1);
    }
    if (body.endsWith('|')) {
      endAnchor = true;
      body = body.slice(0, -1);
    }

    const source = Array.from(body, ch => {
      if (ch === '*') return '[\\s\\S]*';
      if (ch === '^') return '(?:[^a-zA-Z0-9._-]|$)';
      return escapeChar(ch);
    }).join('');

    let prefix = '';
    if (hostAnchor) prefix = '(?:^|[a-z]+:\\/\\/)(?:[^\\/?#:]+\\.)?';
    else if (startAnchor) prefix = '^';

    const suffix = endAnchor ? '$' : '';
    return new RegExp(prefix + source + suffix, matchCase ? '' : 'i');
  }

  function hostKeyFromPattern(pattern) {
    if (!pattern.startsWith('||')) return null;
    const match = pattern.slice(2).match(/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]/);
    if (!match) return null;
    const host = match[0].toLowerCase();
    return host.indexOf('.') === -1 && host !== 'localhost' ? null : host;
  }

  function parseNetwork(line) {
    let text = line.trim();
    let isException = false;
    if (text.startsWith('@@')) {
      isException = true;
      text = text.slice(2).trim();
    }

    let pattern = text;
    let optionText = '';
    const dollar = text.lastIndexOf('$');
    if (dollar > 0) {
      pattern = text.slice(0, dollar);
      optionText = text.slice(dollar + 1);
    }
    if (!pattern) return null;

    const options = {
      types: null,
      excludedTypes: null,
      thirdParty: null,
      includeDomains: null,
      excludeDomains: null,
      matchCase: false
    };

    if (optionText) {
      optionText.split(',').forEach(raw => {
        const option = raw.trim();
        if (!option) return;

        if (option === 'match-case') {
          options.matchCase = true;
        } else if (option === 'third-party') {
          options.thirdParty = true;
        } else if (option === '~third-party') {
          options.thirdParty = false;
        } else if (option.startsWith('domain=') || option.startsWith('from=')) {
          const value = option.slice(option.indexOf('=') + 1);
          value.split('|').forEach(entry => {
            const excluded = entry.startsWith('~');
            const domain = entry.replace(/^~/, '').trim().toLowerCase();
            if (!domain) return;
            const list = excluded ? 'excludeDomains' : 'includeDomains';
            if (!options[list]) options[list] = [];
            options[list].push(domain);
          });
        } else if (option.startsWith('~')) {
          const type = normalizeType(option.slice(1));
          if (type) {
            if (!options.excludedTypes) options.excludedTypes = new Set();
            options.excludedTypes.add(type);
          }
        } else {
          const type = normalizeType(option);
          if (type) {
            if (!options.types) options.types = new Set();
            options.types.add(type);
          }
        }
      });
    }

    return Object.assign({
      pattern,
      regex: patternToRegex(pattern, options.matchCase),
      hostKey: hostKeyFromPattern(pattern),
      isException
    }, options);
  }

  function parseCosmetic(line) {
    const text = line.trim();
    const hideAt = text.indexOf('##');
    const exceptAt = text.indexOf('#@#');
    let index;
    let isException;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
    } else {
      return null;
    }

    const selector = text.slice(index + (isException ? 3 : 2)).trim();
    if (!selector) return null;

    const domains = text.slice(0, index)
      .split(',')
      .map(part => part.trim().replace(/^~/, '').toLowerCase())
      .filter(Boolean);

    return { domains, selector, isException };
  }

  class FilterEngine {
    constructor(getDomain) {
      this.getDomain = typeof getDomain === 'function' ? getDomain : null;
      this.reset();
    }

    _registrable(host) {
      if (!this.getDomain) return fallbackRegistrable(host);
      try {
        return this.getDomain(host) || fallbackRegistrable(host);
      } catch (error) {
        return fallbackRegistrable(host);
      }
    }

    reset() {
      this.hostRules = new Map();
      this.genericRules = [];
      this.cosmeticByDomain = new Map();
      this.cosmeticExceptionsByDomain = new Map();
      this.genericCosmetic = [];
      this.genericCosmeticExceptions = [];
      this.counts = { network: 0, exceptions: 0, cosmetic: 0 };
    }

    load(text) {
      this.reset();
      const lines = String(text == null ? '' : text).split(/\r?\n/);

      lines.forEach(raw => {
        const line = raw.trim();
        if (!line || line.startsWith('!')) return;
        if (line.startsWith('#') && line.indexOf('##') === -1 && line.indexOf('#@#') === -1) return;

        if (line.indexOf('##') !== -1 || line.indexOf('#@#') !== -1) {
          const cosmetic = parseCosmetic(line);
          if (!cosmetic) return;
          this.counts.cosmetic++;
          this._addCosmetic(cosmetic);
          return;
        }

        const rule = parseNetwork(line);
        if (!rule) return;
        this.counts.network++;
        if (rule.isException) this.counts.exceptions++;

        if (rule.hostKey) {
          if (!this.hostRules.has(rule.hostKey)) this.hostRules.set(rule.hostKey, []);
          this.hostRules.get(rule.hostKey).push(rule);
        } else {
          this.genericRules.push(rule);
        }
      });
    }

    _addCosmetic(parsed) {
      const map = parsed.isException ? this.cosmeticExceptionsByDomain : this.cosmeticByDomain;
      const generic = parsed.isException ? this.genericCosmeticExceptions : this.genericCosmetic;

      if (!parsed.domains.length) {
        if (!generic.includes(parsed.selector)) generic.push(parsed.selector);
        return;
      }
      parsed.domains.forEach(domain => {
        if (!map.has(domain)) map.set(domain, []);
        const list = map.get(domain);
        if (!list.includes(parsed.selector)) list.push(parsed.selector);
      });
    }

    _ruleApplies(rule, url, type, docHost, targetHost) {
      if (rule.types && !rule.types.has(type)) return false;
      if (rule.excludedTypes && rule.excludedTypes.has(type)) return false;

      if (rule.thirdParty !== null) {
        const thirdParty = Boolean(docHost && targetHost &&
          this._registrable(docHost) !== this._registrable(targetHost));
        if (thirdParty !== rule.thirdParty) return false;
      }

      if (rule.includeDomains || rule.excludeDomains) {
        if (!docHost) return false;
        if (rule.includeDomains && !rule.includeDomains.some(domain => domainMatches(docHost, domain))) return false;
        if (rule.excludeDomains && rule.excludeDomains.some(domain => domainMatches(docHost, domain))) return false;
      }

      return rule.regex.test(url);
    }

    matchRequest(url, type, documentUrl) {
      const targetHost = hostnameOf(url);
      const docHost = hostnameOf(documentUrl);
      const candidates = parentHosts(targetHost)
        .flatMap(host => this.hostRules.get(host) || []);
      if (this.genericRules.length) candidates.push(...this.genericRules);

      const applies = rule => this._ruleApplies(rule, url, type, docHost, targetHost);
      const exception = candidates.find(rule => rule.isException && applies(rule));
      if (exception) return { blocked: false, exception };

      const blocker = candidates.find(rule => !rule.isException && applies(rule)) || null;
      return { blocked: Boolean(blocker), rule: blocker, exception: null };
    }

    getCosmetic(host) {
      const hosts = parentHosts(host);
      const selectors = new Set(this.genericCosmetic);
      const exceptions = new Set(this.genericCosmeticExceptions);

      hosts.forEach(name => {
        const found = this.cosmeticByDomain.get(name);
        if (found) found.forEach(selector => selectors.add(selector));
        const excepted = this.cosmeticExceptionsByDomain.get(name);
        if (excepted) excepted.forEach(selector => exceptions.add(selector));
      });
      exceptions.forEach(selector => selectors.delete(selector));
      return Array.from(selectors);
    }
  }

  global.FilterEngine = FilterEngine;
  global.mapResourceType = function mapResourceType(type) {
    return normalizeType(type) || 'other';
  };
})(this);

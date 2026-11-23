/* WildFire - opt-in remote filter list store.
 *
 * No list URL is bundled or fetched by default. Storage keeps the exact text
 * that produced the active rules, so an applied list is reproducible.
 */
(function (global) {
  'use strict';

  const KEY = 'wildfire.remote.v1';
  const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
  const DEFAULT_TIMEOUT_MS = 15000;

  function normalizeUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function hashText(text) {
    return String(text).split('').reduce((hash, character) => {
      const mixed = hash ^ character.charCodeAt(0);
      return Math.imul(mixed, 16777619) >>> 0;
    }, 2166136261).toString(16);
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const url = normalizeUrl(entry.url);
    if (!url) return null;
    return {
      url,
      enabled: Boolean(entry.enabled),
      autoUpdate: Boolean(entry.autoUpdate),
      etag: typeof entry.etag === 'string' ? entry.etag : '',
      lastModified: typeof entry.lastModified === 'string' ? entry.lastModified : '',
      text: typeof entry.text === 'string' ? entry.text : '',
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      hash: typeof entry.hash === 'string' ? entry.hash : ''
    };
  }

  function normalizeSnapshot(value) {
    const byUrl = new Map();
    const entries = Array.isArray(value && value.lists) ? value.lists : [];
    entries.forEach(entry => {
      const list = normalizeEntry(entry);
      if (list) byUrl.set(list.url, list);
    });
    return { lists: Array.from(byUrl.values()) };
  }

  function headerValue(headers, name) {
    if (!headers || typeof headers.get !== 'function') return '';
    try {
      return headers.get(name) || '';
    } catch (error) {
      return '';
    }
  }

  function create(options) {
    const settings = options || {};
    const storage = settings.storage;
    const fetchImpl = settings.fetchImpl || (global.fetch && global.fetch.bind(global));
    const now = settings.now || (() => Date.now());
    const timeoutMs = settings.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : settings.timeoutMs;
    const maxTextLength = settings.maxTextLength || MAX_TEXT_LENGTH;

    async function get() {
      if (!storage) return { lists: [] };
      const stored = await storage.get(KEY);
      return normalizeSnapshot(stored && stored[KEY]);
    }

    async function save(snapshot) {
      const normalized = normalizeSnapshot(snapshot);
      if (storage) await storage.set({ [KEY]: normalized });
      return normalized;
    }

    async function change(updater) {
      return save(updater(await get()));
    }

    function result(snapshot, url, error) {
      return {
        ok: !error,
        error: error || '',
        list: snapshot.lists.find(entry => entry.url === url) || null,
        snapshot
      };
    }

    async function fetchList(list) {
      if (typeof fetchImpl !== 'function') throw new Error('Fetching is unavailable');
      const controller = timeoutMs > 0 && typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const headers = {};
        if (list.etag) headers['If-None-Match'] = list.etag;
        if (list.lastModified) headers['If-Modified-Since'] = list.lastModified;
        const response = await fetchImpl(list.url, {
          headers,
          cache: 'no-store',
          signal: controller ? controller.signal : undefined
        });
        if (response.status === 304) {
          return {
            etag: list.etag,
            lastModified: list.lastModified,
            text: list.text,
            hash: list.hash,
            updatedAt: now()
          };
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        if (typeof text !== 'string') throw new Error('Invalid list body');
        if (text.length > maxTextLength) {
          throw new Error('List exceeds ' + Math.round(maxTextLength / 1024) + ' KB');
        }
        return {
          etag: headerValue(response.headers, 'etag'),
          lastModified: headerValue(response.headers, 'last-modified'),
          text,
          hash: hashText(text),
          updatedAt: now()
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function add(value) {
      const url = normalizeUrl(value);
      if (!url) return result(await get(), '', 'Enter an http(s) list URL.');
      const snapshot = await change(current => {
        if (current.lists.some(entry => entry.url === url)) return current;
        const added = normalizeEntry({ url });
        return { lists: current.lists.concat([added]) };
      });
      return result(snapshot, url);
    }

    async function remove(value) {
      const url = normalizeUrl(value);
      if (!url) return result(await get(), '', 'Invalid list URL.');
      const snapshot = await change(current => ({
        lists: current.lists.filter(entry => entry.url !== url)
      }));
      return { ok: true, error: '', list: null, snapshot };
    }

    function updateEntry(current, url, patch) {
      return {
        lists: current.lists.map(entry => entry.url === url
          ? Object.assign({}, entry, patch)
          : entry)
      };
    }

    async function setEnabled(value, enabled) {
      const url = normalizeUrl(value);
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      if (enabled && !existing.text) return result(current, url, 'Fetch the list before enabling it.');
      const snapshot = await change(listState => updateEntry(listState, url, { enabled: Boolean(enabled) }));
      return result(snapshot, url);
    }

    async function setAutoUpdate(value, enabled) {
      const url = normalizeUrl(value);
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      if (enabled && (!existing.enabled || !existing.text)) {
        return result(current, url, 'Enable a fetched list before scheduling updates.');
      }
      const snapshot = await change(listState => updateEntry(listState, url, { autoUpdate: Boolean(enabled) }));
      return result(snapshot, url);
    }

    async function update(value) {
      const url = normalizeUrl(value);
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      let fetched;
      try {
        fetched = await fetchList(existing);
      } catch (error) {
        return result(current, url, error && error.message ? error.message : 'Fetch failed');
      }
      const snapshot = await change(listState => updateEntry(listState, url, fetched));
      return result(snapshot, url);
    }

    async function enabledText() {
      const snapshot = await get();
      return snapshot.lists
        .filter(entry => entry.enabled && entry.text)
        .map(entry => '! wildfire remote: ' + entry.url + '\n' + entry.text)
        .join('\n');
    }

    return { get, save, add, remove, setEnabled, setAutoUpdate, update, enabledText };
  }

  global.RemoteLists = { create, KEY, normalizeUrl, normalizeSnapshot, hashText };
})(this);

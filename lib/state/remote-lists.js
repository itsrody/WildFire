/* WildFire - filter list store with automatic first fetch and expiry updates.
 *
 * Every registered list auto-fetches once, then revalidates on its !Expires
 * interval unless the user turns Auto off. The bundled entry ships with exact
 * text, starts enabled and cannot be removed. External lists are added by the
 * user, start disabled, and must be enabled before their rules apply.
 */
(function (global) {
  'use strict';

  const KEY = 'wildfire.remote.v1';
  const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_LISTS = 64;
  const MAX_META_LINES = 80;
  const MAX_META_VALUE = 240;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BUILTIN_URL = global.WildFireBundledLists
    ? global.WildFireBundledLists.DEFAULT_URL
    : 'wildfire:bundled/default.txt';

  function rawUrl(value) {
    return String(value || '').trim();
  }

  function isBuiltinUrl(value) {
    return global.WildFireBundledLists
      ? global.WildFireBundledLists.isBundledUrl(value)
      : rawUrl(value) === BUILTIN_URL;
  }

  function normalizeUrl(value, options) {
    const text = rawUrl(value);
    if (options && options.allowBuiltin && isBuiltinUrl(text)) return BUILTIN_URL;
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function cleanMetaValue(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, MAX_META_VALUE);
  }

  function metaKey(value) {
    return cleanMetaValue(value)
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDuration(value) {
    const match = /^(\d{1,5})\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ours?)?|d(?:ays?)?|w(?:eeks?)?)$/i
      .exec(String(value || '').trim());
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = match[2].charAt(0).toLowerCase();
    const scale = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: DAY_MS,
      w: 7 * DAY_MS
    }[unit] || 0;
    const duration = amount * scale;
    return duration >= 60 * 1000 && duration <= 30 * DAY_MS ? duration : 0;
  }

  function parseMetadata(text) {
    const metadata = {};
    String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
      .slice(0, MAX_META_LINES)
      .some(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.charAt(0) !== '!') return true;
        const match = /^!\s*([^:]{1,32}):\s*(.+)$/.exec(trimmed);
        if (!match) return false;
        const key = metaKey(match[1]);
        const value = cleanMetaValue(match[2]);
        if (!value) return false;
        if (key === 'title') metadata.title = value;
        else if (key === 'description') metadata.description = value;
        else if (key === 'version') metadata.version = value;
        else if (key === 'homepage') metadata.homepage = value;
        else if (key === 'license') metadata.license = value;
        else if (key === 'expires') metadata.expires = value;
        else if (key === 'checksum') metadata.checksum = value;
        else if (key === 'diff path' || key === 'diffpath') metadata.diffPath = value;
        else if (key === 'last modified' || key === 'lastmodified' ||
                 key === 'time updated' || key === 'timeupdated') {
          metadata.lastModified = value;
        }
        return false;
      });
    if (metadata.expires) metadata.expiresMs = parseDuration(metadata.expires);
    return metadata;
  }

  function normalizeMetadata(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const expiresMs = Number(source.expiresMs);
    return {
      title: cleanMetaValue(source.title),
      description: cleanMetaValue(source.description),
      version: cleanMetaValue(source.version),
      homepage: cleanMetaValue(source.homepage),
      license: cleanMetaValue(source.license),
      expires: cleanMetaValue(source.expires),
      expiresMs: Number.isFinite(expiresMs) && expiresMs >= 60 * 1000 && expiresMs <= 30 * DAY_MS
        ? expiresMs : 0,
      lastModified: cleanMetaValue(source.lastModified),
      checksum: cleanMetaValue(source.checksum),
      diffPath: cleanMetaValue(source.diffPath),
      contentType: cleanMetaValue(source.contentType).slice(0, 80)
    };
  }

  function hashText(text) {
    return String(text).split('').reduce((hash, character) => {
      const mixed = hash ^ character.charCodeAt(0);
      return Math.imul(mixed, 16777619) >>> 0;
    }, 2166136261).toString(16);
  }

  function normalizeEntry(entry, bundled) {
    if (!entry || typeof entry !== 'object') return null;
    const url = normalizeUrl(entry.url, { allowBuiltin: true });
    if (!url) return null;
    const builtin = isBuiltinUrl(url);
    const base = bundled && typeof bundled === 'object' ? bundled : { text: '', metadata: {} };
    const suppliedText = typeof entry.text === 'string' ? entry.text : '';
    const text = builtin && !suppliedText && typeof base.text === 'string'
      ? base.text : suppliedText;
    const metadataSource = entry.metadata || (builtin ? base.metadata : null);
    return {
      url,
      builtin,
      enabled: builtin && entry.enabled === undefined ? true : Boolean(entry.enabled),
      autoUpdateChoice: Boolean(entry.autoUpdateChoice),
      autoUpdate: entry.autoUpdateChoice ? Boolean(entry.autoUpdate) : true,
      etag: typeof entry.etag === 'string' ? entry.etag : '',
      lastModified: typeof entry.lastModified === 'string' ? entry.lastModified : '',
      text,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      checkedAt: Number.isFinite(entry.checkedAt) ? entry.checkedAt : 0,
      hash: text ? hashText(text) : '',
      lastError: typeof entry.lastError === 'string' ? entry.lastError : '',
      metadata: normalizeMetadata(metadataSource)
    };
  }

  function normalizeSnapshot(value, bundled) {
    const byUrl = new Map();
    const entries = Array.isArray(value && value.lists) ? value.lists : [];
    entries.forEach(entry => {
      const list = normalizeEntry(entry, bundled);
      if (list) byUrl.set(list.url, list);
    });
    const storedBuiltin = byUrl.get(BUILTIN_URL);
    const base = bundled && typeof bundled === 'object' ? bundled : null;
    const builtin = storedBuiltin || (base && base.text ? normalizeEntry({ url: BUILTIN_URL }, base) : null);
    const external = Array.from(byUrl.values())
      .filter(entry => !entry.builtin)
      .slice(0, builtin ? MAX_LISTS - 1 : MAX_LISTS);
    return { lists: builtin ? [builtin].concat(external) : external };
  }

  function create(options) {
    const settings = options || {};
    const storage = settings.storage;
    const fetchImpl = settings.fetchImpl || (global.fetch && global.fetch.bind(global));
    const now = settings.now || (() => Date.now());
    const timeoutMs = settings.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : settings.timeoutMs;
    const maxTextLength = settings.maxTextLength || MAX_TEXT_LENGTH;
    const bundledTextLoader = settings.bundledTextLoader;
    const bundledBase = settings.bundled ||
      (global.WildFireBundledLists ? global.WildFireBundledLists.find(BUILTIN_URL) : null);
    const bundled = Object.assign({
      url: BUILTIN_URL,
      text: '',
      metadata: {}
    }, bundledBase || {});

    async function get() {
      if (!storage) return normalizeSnapshot({ lists: [] }, bundled);
      const stored = await storage.get(KEY);
      return normalizeSnapshot(stored && stored[KEY], bundled);
    }

    async function save(snapshot) {
      const normalized = normalizeSnapshot(snapshot, bundled);
      if (storage) await storage.set({ [KEY]: normalized });
      return normalized;
    }

    async function change(updater) {
      return save(updater(await get()));
    }

    function result(snapshot, url, error, meta) {
      return Object.assign({
        ok: !error,
        error: error || '',
        list: snapshot.lists.find(entry => entry.url === url) || null,
        snapshot
      }, meta || {});
    }

    function headerValue(headers, name) {
      if (!headers || typeof headers.get !== 'function') return '';
      try {
        return headers.get(name) || '';
      } catch (error) {
        return '';
      }
    }

    async function seedBundled(explicitText) {
      let text = explicitText;
      if (typeof text !== 'string' && typeof bundledTextLoader === 'function') {
        text = await bundledTextLoader();
      }
      if (typeof text !== 'string' || !text) {
        return result(await get(), BUILTIN_URL, 'Bundled list text is unavailable.');
      }
      const metadata = parseMetadata(text);
      bundled.text = text;
      bundled.metadata = metadata;
      const current = await get();
      const existing = current.lists.find(entry => entry.url === BUILTIN_URL);
      const manuallyUpdated = Boolean(existing && existing.text && existing.updatedAt > 0);
      const finalText = manuallyUpdated ? existing.text : text;
      const existingMetadata = existing && existing.metadata ? existing.metadata : {};
      const finalMetadata = manuallyUpdated && Object.keys(existingMetadata).length
        ? existingMetadata : metadata;
      const finalHash = hashText(finalText);
      const seeded = normalizeEntry(Object.assign({}, existing || { url: BUILTIN_URL }, {
        url: BUILTIN_URL,
        text: finalText,
        hash: finalHash,
        metadata: finalMetadata,
        enabled: existing ? existing.enabled : true,
        autoUpdate: existing && existing.autoUpdateChoice ? existing.autoUpdate : true,
        autoUpdateChoice: existing ? existing.autoUpdateChoice : false,
        etag: manuallyUpdated ? existing.etag : '',
        lastModified: manuallyUpdated ? existing.lastModified : '',
        updatedAt: manuallyUpdated ? existing.updatedAt : 0,
        checkedAt: manuallyUpdated ? existing.checkedAt : 0,
        lastError: manuallyUpdated ? existing.lastError : ''
      }));
      const snapshot = await save({
        lists: [seeded].concat(current.lists.filter(entry => entry.url !== BUILTIN_URL))
      });
      return result(snapshot, BUILTIN_URL, '', {
        action: 'seed',
        changed: !manuallyUpdated && (!existing || existing.hash !== finalHash)
      });
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
        const declaredLength = Number(headerValue(response.headers, 'content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > maxTextLength) {
          throw new Error('List exceeds ' + Math.round(maxTextLength / 1024) + ' KB');
        }
        const finalUrl = response.url ? normalizeUrl(response.url) : list.url;
        if (!finalUrl) throw new Error('List redirected to an unsupported URL');
        const checkedAt = now();
        if (response.status === 304) {
          if (!list.text) throw new Error('Nothing to revalidate');
          return {
            etag: list.etag,
            lastModified: list.lastModified,
            text: list.text,
            hash: list.hash,
            metadata: normalizeMetadata(list.metadata),
            updatedAt: list.updatedAt || checkedAt,
            checkedAt,
            lastError: ''
          };
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        if (typeof text !== 'string') throw new Error('Invalid list body');
        if (text.length > maxTextLength) {
          throw new Error('List exceeds ' + Math.round(maxTextLength / 1024) + ' KB');
        }
        if (!text.trim()) throw new Error('List is empty');
        const contentType = headerValue(response.headers, 'content-type');
        if (/text\/html/i.test(contentType) && /^\s*</.test(text)) {
          throw new Error('List response looks like HTML');
        }
        const metadata = parseMetadata(text);
        metadata.lastModified = metadata.lastModified ||
          headerValue(response.headers, 'last-modified');
        metadata.contentType = contentType;
        const hash = hashText(text);
        return {
          etag: headerValue(response.headers, 'etag'),
          lastModified: headerValue(response.headers, 'last-modified'),
          text,
          hash,
          metadata: normalizeMetadata(metadata),
          updatedAt: hash === list.hash && text === list.text
            ? (list.updatedAt || checkedAt) : checkedAt,
          checkedAt,
          lastError: ''
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function add(value) {
      const url = normalizeUrl(value);
      if (!url) return result(await get(), '', 'Enter an http(s) list URL.');
      const current = await get();
      const externalCount = current.lists.filter(entry => !entry.builtin).length;
      if (!current.lists.some(entry => entry.url === url) && externalCount >= MAX_LISTS - 1) {
        return result(current, url, 'Too many remote lists.');
      }
      const snapshot = await change(listState => {
        if (listState.lists.some(entry => entry.url === url)) return listState;
        const added = normalizeEntry({ url });
        return { lists: listState.lists.concat([added]) };
      });
      return result(snapshot, url, '', { action: 'add', changed: false });
    }

    async function remove(value) {
      if (isBuiltinUrl(rawUrl(value))) {
        return result(await get(), BUILTIN_URL, 'The bundled list cannot be removed.');
      }
      const url = normalizeUrl(value);
      if (!url) return result(await get(), '', 'Invalid list URL.');
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      const snapshot = await change(listState => ({
        lists: listState.lists.filter(entry => entry.url !== url)
      }));
      const changed = Boolean(existing && existing.enabled && existing.text);
      return { ok: true, error: '', list: null, snapshot, action: 'remove', changed };
    }

    function updateEntry(current, url, patch) {
      return {
        lists: current.lists.map(entry => entry.url === url
          ? Object.assign({}, entry, patch)
          : entry)
      };
    }

    async function setEnabled(value, enabled) {
      const url = normalizeUrl(value, { allowBuiltin: true });
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      if (enabled && !existing.text) return result(current, url, 'Fetch the list before enabling it.');
      const nextEnabled = Boolean(enabled);
      const snapshot = await change(listState => updateEntry(listState, url, {
        enabled: nextEnabled,
        lastError: ''
      }));
      const changed = Boolean(existing.text) && existing.enabled !== nextEnabled;
      return result(snapshot, url, '', { action: 'set-enabled', changed });
    }

    async function setAutoUpdate(value, enabled) {
      const url = normalizeUrl(value, { allowBuiltin: true });
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      const snapshot = await change(listState => updateEntry(listState, url, {
        autoUpdate: Boolean(enabled),
        autoUpdateChoice: true,
        lastError: ''
      }));
      return result(snapshot, url, '', { action: 'set-auto', changed: false });
    }

    async function markError(url, error) {
      const message = error && error.message ? error.message : String(error || 'Fetch failed');
      const snapshot = await change(listState => updateEntry(listState, url, {
        checkedAt: now(),
        lastError: message
      }));
      return result(snapshot, url, message, { action: 'update', changed: false });
    }

    async function update(value) {
      const url = normalizeUrl(value, { allowBuiltin: true });
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      let fetched;
      try {
        fetched = await fetchList(existing);
      } catch (error) {
        return markError(url, error);
      }
      const snapshot = await change(listState => updateEntry(listState, url, fetched));
      const changed = Boolean(existing.enabled) &&
        (existing.hash !== fetched.hash || existing.text !== fetched.text);
      return result(snapshot, url, '', { action: 'update', changed });
    }

    async function updateDue(criteria) {
      const opts = criteria || {};
      const force = Boolean(opts.force);
      const current = await get();
      const currentTime = now();
      const due = current.lists.filter(entry => {
        if (!entry.autoUpdate) return false;
        if (force) return true;
        const expiry = Number(entry.metadata && entry.metadata.expiresMs) || DAY_MS;
        const interval = Math.max(60 * 1000, expiry);
        const lastCheck = entry.checkedAt || entry.updatedAt || 0;
        return !lastCheck || currentTime >= lastCheck + interval;
      });
      const results = [];
      await due.reduce((chain, entry) => chain.then(async () => {
        results.push(await update(entry.url));
      }), Promise.resolve());
      const snapshot = await get();
      const changed = results.some(item => item && item.ok && item.changed);
      return { ok: results.every(item => item && item.ok), changed, results, snapshot };
    }

    async function enabledText() {
      const snapshot = await get();
      return snapshot.lists
        .filter(entry => entry.enabled && entry.text)
        .map(entry => (entry.builtin ? '! wildfire bundled: ' : '! wildfire remote: ') +
          entry.url + '\n' + entry.text)
        .join('\n');
    }

    return {
      get, save, seedBundled, add, remove, setEnabled, setAutoUpdate,
      update, updateDue, enabledText
    };
  }

  global.RemoteLists = {
    create,
    KEY,
    BUILTIN_URL,
    LEGACY_URL: global.WildFireBundledLists && global.WildFireBundledLists.LEGACY_URL
      ? global.WildFireBundledLists.LEGACY_URL
      : 'wildfire:bundled/default.txt',
    isBuiltinUrl,
    normalizeUrl,
    normalizeSnapshot,
    hashText,
    parseMetadata,
    parseDuration
  };
})(this);

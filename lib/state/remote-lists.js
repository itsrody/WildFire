/* WildFire - filter list store with automatic first fetch and expiry updates.
 *
 * Every registered list auto-fetches once, then revalidates on its !Expires
 * interval unless the user turns Auto off. The default entry points directly
 * at the uAssets CDN, is fetched into storage on startup, and cannot be
 * removed. Upstream filter text is never vendored. User-added lists start
 * disabled and must be enabled before their rules apply.
 */
(function (global) {
  'use strict';

  const KEY = 'wildfire.remote.v1';
  const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
  const DEFAULT_TIMEOUT_MS = 60000;
  const MAX_LISTS = 64;
  const MAX_META_LINES = 80;
  const MAX_META_VALUE = 240;
  const MAX_HISTORY = 12;
  const MIN_PATCH_CHECKSUM = 10;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const PRESHIPPED_REMOTE_URL = 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt';
  const BUILTIN_URL = global.WildFireBundledLists
    ? global.WildFireBundledLists.DEFAULT_URL
    : PRESHIPPED_REMOTE_URL;

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
        else if (key === 'diff name' || key === 'diffname') metadata.diffName = value;
        else if (key === 'diff path' || key === 'diffpath') metadata.diffPath = value;
        else if (key === 'diff expires' || key === 'diffexpires') metadata.diffExpires = value;
        else if (key === 'last modified' || key === 'lastmodified' ||
                 key === 'time updated' || key === 'timeupdated') {
          metadata.lastModified = value;
        }
        return false;
      });
    if (metadata.expires) metadata.expiresMs = parseDuration(metadata.expires);
    if (metadata.diffExpires) metadata.diffExpiresMs = parseDuration(metadata.diffExpires);
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
      diffName: cleanMetaValue(source.diffName),
      diffPath: cleanMetaValue(source.diffPath),
      diffExpires: cleanMetaValue(source.diffExpires),
      diffExpiresMs: Number.isFinite(Number(source.diffExpiresMs)) &&
        Number(source.diffExpiresMs) >= 60 * 1000 &&
        Number(source.diffExpiresMs) <= 30 * DAY_MS
        ? Number(source.diffExpiresMs) : 0,
      contentType: cleanMetaValue(source.contentType).slice(0, 80)
    };
  }

  function normalizeHistory(value) {
    return (Array.isArray(value) ? value : [])
      .filter(entry => entry && typeof entry === 'object')
      .slice(-MAX_HISTORY)
      .map(entry => ({
        at: Number.isFinite(entry.at) ? entry.at : 0,
        action: cleanMetaValue(entry.action).slice(0, 24),
        ok: Boolean(entry.ok),
        error: cleanMetaValue(entry.error).slice(0, 160),
        changed: Boolean(entry.changed),
        hashBefore: cleanMetaValue(entry.hashBefore).slice(0, 32),
        hashAfter: cleanMetaValue(entry.hashAfter).slice(0, 32)
      }));
  }

  function appendHistory(history, entry) {
    return normalizeHistory((Array.isArray(history) ? history : []).concat([entry]));
  }

  // FNV over string code units without allocating a character array. This
  // preserves the hash of previously persisted list text.
  function hashText(text) {
    const hash = Array.prototype.reduce.call(String(text || ''), (h, ch) =>
      Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);
    return (hash >>> 0).toString(16);
  }

  function normalizeEntry(entry, bundled, trustHash) {
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
      lastPatchAt: Number.isFinite(entry.lastPatchAt) ? entry.lastPatchAt : 0,
      hash: text
        ? (trustHash && typeof entry.hash === 'string' && entry.hash ? entry.hash : hashText(text))
        : '',
      lastError: typeof entry.lastError === 'string' ? entry.lastError : '',
      history: normalizeHistory(entry.history),
      metadata: normalizeMetadata(metadataSource)
    };
  }

  function normalizeSnapshot(value, bundled, options) {
    const byUrl = new Map();
    const trustHash = Boolean(options && options.trustHash);
    const entries = Array.isArray(value && value.lists) ? value.lists : [];
    entries.forEach(entry => {
      const list = normalizeEntry(entry, bundled, trustHash);
      if (!list) return;
      const raw = rawUrl(entry && entry.url);
      if (list.url === BUILTIN_URL && !isBuiltinUrl(raw)) {
        list.text = '';
        list.hash = '';
        list.metadata = normalizeMetadata({});
        list.updatedAt = 0;
        list.checkedAt = 0;
        list.lastPatchAt = 0;
        list.etag = '';
        list.lastModified = '';
        list.lastError = '';
        list.history = [];
      }
      byUrl.set(list.url, list);
    });
    const storedBuiltin = byUrl.get(BUILTIN_URL);
    const base = bundled && typeof bundled === 'object' ? bundled : null;
    const builtin = storedBuiltin ||
      (base && base.text ? normalizeEntry({ url: BUILTIN_URL }, base, trustHash) : null);
    const external = Array.from(byUrl.values())
      .filter(entry => !entry.builtin)
      .slice(0, builtin ? MAX_LISTS - 1 : MAX_LISTS);
    return { lists: builtin ? [builtin].concat(external) : external };
  }

  // WildFire's patch reader accepts the small diff format advertised by list
  // metadata: "diff name:... checksum:... lines:N" followed by RCS-style
  // "a<line> <count>" and "d<line> <count>" operations. It never executes
  // patch data and never accepts a patch block without its checksum.
  function parsePatch(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const parsed = lines.reduce((state, line, index) => {
      if (index < state.next || !line.startsWith('diff ')) return state;
      const block = line.split(/\s+/).reduce((fields, field) => {
        const pos = field.indexOf(':');
        if (pos <= 0) return fields;
        const name = field.slice(0, pos);
        if (name === 'name' || name === 'checksum') fields[name] = field.slice(pos + 1);
        else if (name === 'lines') fields.lines = Number(field.slice(pos + 1));
        return fields;
      }, {});
      if (!block.name || !block.checksum || !Number.isInteger(block.lines) || block.lines <= 0) {
        return state;
      }
      const diffLines = lines.slice(index + 1, index + 1 + block.lines);
      if (diffLines.length < block.lines) return Object.assign(state, { next: lines.length });
      state.blocks[block.name] = {
        name: block.name,
        checksum: block.checksum,
        lines: block.lines,
        diff: diffLines.join('\n')
      };
      state.next = index + 1 + block.lines;
      return state;
    }, { blocks: Object.create(null), next: 0 });
    return Object.keys(parsed.blocks).length ? parsed.blocks : null;
  }

  function applyPatch(text, diff) {
    const operations = String(diff || '').replace(/\r\n/g, '\n').split('\n');
    const result = Array.from({ length: operations.length }).reduce(state => {
      if (state.done || state.index >= operations.length) return state;
      const line = operations[state.index++];
      if (!line) return Object.assign(state, { done: true });
      const match = /^([ad])(\d+)\s+(\d+)$/.exec(line);
      if (!match) return Object.assign(state, { error: 'Malformed patch operation', done: true });
      const op = match[1];
      const at = Number(match[2]) + state.adjust;
      const count = Number(match[3]);
      if (!Number.isFinite(at) || !Number.isFinite(count) || count < 1 || at < 1) {
        return Object.assign(state, { error: 'Malformed patch range', done: true });
      }
      if (op === 'd') {
        if (at > state.lines.length || at - 1 + count > state.lines.length) {
          return Object.assign(state, { error: 'Patch range is outside the list', done: true });
        }
        state.lines = state.lines.slice(0, at - 1).concat(state.lines.slice(at - 1 + count));
        state.adjust -= count;
        return state;
      }
      if (at > state.lines.length + 1) {
        return Object.assign(state, { error: 'Patch range is outside the list', done: true });
      }
      const additions = operations.slice(state.index, state.index + count);
      if (additions.length !== count) {
        return Object.assign(state, { error: 'Patch is truncated', done: true });
      }
      state.lines = state.lines.slice(0, at).concat(additions, state.lines.slice(at));
      state.index += count;
      state.adjust += count;
      return state;
    }, {
      index: 0,
      adjust: 0,
      lines: String(text || '').replace(/\r\n/g, '\n').split('\n'),
      done: false,
      error: ''
    });
    return result.error ? null : result.lines.join('\n');
  }

  function patchInfo(list) {
    const metadata = list && list.metadata ? list.metadata : {};
    if (!list || !list.text || !metadata.diffPath || /^%/.test(metadata.diffPath)) return null;
    try {
      const url = new URL(metadata.diffPath, list.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      const name = url.hash.length > 1
        ? decodeURIComponent(url.hash.slice(1))
        : metadata.diffName;
      url.hash = '';
      return name ? { url: url.href, name } : null;
    } catch (error) {
      return null;
    }
  }

  async function sha1Hex(text, cryptoImpl, encoderImpl) {
    const Encoder = encoderImpl || global.TextEncoder;
    const crypto = cryptoImpl || global.crypto;
    if (!Encoder || !crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
      return '';
    }
    const bytes = new Encoder().encode(String(text || ''));
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  function patchDue(list, currentTime) {
    if (!list || !list.text || !patchInfo(list)) return false;
    const interval = Number(list.metadata && list.metadata.diffExpiresMs) || DAY_MS;
    const last = list.lastPatchAt || list.checkedAt || list.updatedAt || 0;
    return currentTime >= last + Math.max(60 * 1000, interval);
  }

  function create(options) {
    const settings = options || {};
    const storage = settings.storage;
    const fetchImpl = settings.fetchImpl || (global.fetch && global.fetch.bind(global));
    const now = settings.now || (() => Date.now());
    const timeoutMs = settings.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : settings.timeoutMs;
    const maxTextLength = settings.maxTextLength || MAX_TEXT_LENGTH;
    const cryptoImpl = settings.crypto || global.crypto;
    const encoderImpl = settings.textEncoder || global.TextEncoder;
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
      return normalizeSnapshot(stored && stored[KEY], bundled, { trustHash: true });
    }

    async function save(snapshot) {
      const normalized = normalizeSnapshot(snapshot, bundled, { trustHash: true });
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
      const text = typeof explicitText === 'string' ? explicitText : '';
      const metadata = text ? parseMetadata(text) : {};
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
        lastPatchAt: manuallyUpdated ? existing.lastPatchAt : 0,
        lastError: manuallyUpdated ? existing.lastError : '',
        history: manuallyUpdated ? existing.history : []
      }), bundled, true);
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
          lastPatchAt: 0,
          lastError: ''
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function fetchPatchText(url) {
      if (typeof fetchImpl !== 'function') throw new Error('Fetching is unavailable');
      const controller = timeoutMs > 0 && typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetchImpl(url, {
          cache: 'no-store',
          signal: controller ? controller.signal : undefined
        });
        const declaredLength = Number(headerValue(response.headers, 'content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > maxTextLength) {
          throw new Error('Patch exceeds ' + Math.round(maxTextLength / 1024) + ' KB');
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        if (typeof text !== 'string' || !text.trim()) throw new Error('Patch is empty');
        if (text.length > maxTextLength) {
          throw new Error('Patch exceeds ' + Math.round(maxTextLength / 1024) + ' KB');
        }
        const contentType = headerValue(response.headers, 'content-type');
        if (/text\/html/i.test(contentType) && /^\s*</.test(text)) {
          throw new Error('Patch response looks like HTML');
        }
        return { text, checkedAt: now() };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    function historyEntry(action, at, ok, error, changed, before, after) {
      return {
        at,
        action,
        ok,
        error: error || '',
        changed: Boolean(changed),
        hashBefore: before || '',
        hashAfter: after || ''
      };
    }

    async function rememberPatchFailure(list, error) {
      const message = error && error.message ? error.message : String(error || 'Patch failed');
      const snapshot = await change(listState => updateEntry(listState, list.url, {
        lastPatchAt: now(),
        history: appendHistory(list.history,
          historyEntry('patch', now(), false, message, false, list.hash, list.hash))
      }));
      return result(snapshot, list.url, message, { action: 'patch', changed: false });
    }

    async function updateWithPatch(list) {
      const info = patchInfo(list);
      if (!info) return null;
      try {
        const fetched = await fetchPatchText(info.url);
        const blocks = parsePatch(fetched.text);
        const block = blocks && blocks[info.name];
        if (!block || block.checksum.length < MIN_PATCH_CHECKSUM) {
          throw new Error('Patch is unavailable for this list');
        }
        const text = applyPatch(list.text, block.diff);
        if (!text) throw new Error('Patch could not be applied');
        const checksum = await sha1Hex(text, cryptoImpl, encoderImpl);
        if (!checksum || checksum.indexOf(block.checksum.toLowerCase()) !== 0) {
          throw new Error('Patch checksum mismatch');
        }
        const metadata = parseMetadata(text);
        metadata.lastModified = metadata.lastModified ||
          (list.metadata && list.metadata.lastModified) || '';
        metadata.contentType = (list.metadata && list.metadata.contentType) || '';
        const hash = hashText(text);
        const changed = list.hash !== hash || list.text !== text;
        const patch = {
          text,
          hash,
          metadata: normalizeMetadata(metadata),
          updatedAt: changed ? fetched.checkedAt : (list.updatedAt || fetched.checkedAt),
          checkedAt: fetched.checkedAt,
          lastPatchAt: fetched.checkedAt,
          lastError: '',
          history: appendHistory(list.history,
            historyEntry('patch', fetched.checkedAt, true, '', changed, list.hash, hash))
        };
        const snapshot = await change(listState => updateEntry(listState, list.url, patch));
        return result(snapshot, list.url, '', { action: 'patch', changed });
      } catch (error) {
        await rememberPatchFailure(list, error);
        return null;
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
      const current = await get();
      const existing = current.lists.find(entry => entry.url === url);
      const at = now();
      const snapshot = await change(listState => updateEntry(listState, url, {
        checkedAt: at,
        lastError: message,
        history: appendHistory(existing && existing.history,
          historyEntry('update', at, false, message, false,
            existing && existing.hash, existing && existing.hash))
      }));
      return result(snapshot, url, message, { action: 'update', changed: false });
    }

    async function update(value, options) {
      const opts = options || {};
      const url = normalizeUrl(value, { allowBuiltin: true });
      let current = await get();
      let existing = current.lists.find(entry => entry.url === url);
      if (!existing) return result(current, url, 'List is not registered.');
      if (!opts.full && patchDue(existing, now())) {
        const patched = await updateWithPatch(existing);
        if (patched) return patched;
        // A failed patch records its own history entry and then falls back to
        // a full fetch. Re-read so that entry is not overwritten below.
        current = await get();
        existing = current.lists.find(entry => entry.url === url) || existing;
      }
      let fetched;
      try {
        fetched = await fetchList(existing);
      } catch (error) {
        return markError(url, error);
      }
      const changed = Boolean(existing.enabled) &&
        (existing.hash !== fetched.hash || existing.text !== fetched.text);
      const updated = Object.assign({}, fetched, {
        history: appendHistory(existing.history,
          historyEntry('update', fetched.checkedAt, true, '', changed,
            existing.hash, fetched.hash))
      });
      const snapshot = await change(listState => updateEntry(listState, url, updated));
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
        const diff = patchDue(entry, currentTime)
          ? Number(entry.metadata && entry.metadata.diffExpiresMs) || expiry
          : expiry;
        const interval = Math.max(60 * 1000, Math.min(expiry, diff));
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
    PRESHIPPED_REMOTE_URL,
    BUILTIN_URL,
    LEGACY_URL: global.WildFireBundledLists && global.WildFireBundledLists.LEGACY_URL
      ? global.WildFireBundledLists.LEGACY_URL
      : 'wildfire:bundled/default.txt',
    isBuiltinUrl,
    normalizeUrl,
    normalizeSnapshot,
    hashText,
    parseMetadata,
    parseDuration,
    parsePatch,
    applyPatch,
    patchInfo,
    patchDue,
    sha1Hex
  };
})(this);

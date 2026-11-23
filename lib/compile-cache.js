/* WildFire compiled-filter cache. IndexedDB preferred, storage.local fallback. */
(function (global) {
  'use strict';

  const DB_NAME = 'wildfire-compiled';
  const DB_VERSION = 1;
  const STORE = 'compiled';
  const STORAGE_KEY = 'wildfire.compiled.cache.v1';
  const MAX_ENTRIES = 64;

  function hashText(text) {
    const str = String(text || '');
    let h = 2166136261;
    Array.from(str).forEach(ch => {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    });
    return (h >>> 0).toString(16) + ':' + str.length;
  }

  function keyFor(text, version) {
    return String(version) + ':' + hashText(text);
  }

  function openDb() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise(resolve => {
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  function idbGet(db, key) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function idbSet(db, key, value) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  // Evict least-recently-used entries (by `at`), not insertion order, so a
  // frequently reloaded list survives while stale one-off compiles are dropped.
  function idbPrune(db) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const keysReq = store.getAllKeys();
        const valsReq = store.getAll();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        keysReq.onsuccess = () => {
          const keys = keysReq.result || [];
          if (keys.length <= MAX_ENTRIES) return;
          valsReq.onsuccess = () => {
            const vals = valsReq.result || [];
            keys
              .map((k, i) => ({ k, at: (vals[i] && vals[i].at) || 0 }))
              .sort((a, b) => a.at - b.at)
              .slice(0, keys.length - MAX_ENTRIES)
              .forEach(item => store.delete(item.k));
          };
        };
        keysReq.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  async function storageGet(browserApi) {
    if (!browserApi || !browserApi.storage || !browserApi.storage.local) return {};
    try {
      const data = await browserApi.storage.local.get(STORAGE_KEY);
      return data[STORAGE_KEY] || {};
    } catch (e) { return {}; }
  }

  async function storageSet(browserApi, obj) {
    if (!browserApi || !browserApi.storage || !browserApi.storage.local) return;
    try { await browserApi.storage.local.set({ [STORAGE_KEY]: obj }); } catch (e) {}
  }

  function validCompiled(compiled, version) {
    return Boolean(compiled && typeof compiled === 'object' && compiled.v === version && Array.isArray(compiled.n) &&
      (compiled.c === undefined || typeof compiled.c === 'object') &&
      (compiled.p === undefined || typeof compiled.p === 'object') &&
      (compiled.s === undefined || Array.isArray(compiled.s)) &&
      (compiled.cap === undefined || typeof compiled.cap === 'number'));
  }

  async function idbDelete(db, key) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  function create(options) {
    const browserApi = options && options.browserApi || global.browser;
    const version = (options && options.version) || 1;
    let dbPromise = null;

    // Bounded in-memory LRU tier. A cache hit here is synchronous and avoids an
    // IndexedDB/storage.local round-trip for sources already compiled this
    // session (unchanged custom/remote lists on reload). `set` populates it
    // before its first await, so a fire-and-forget write is visible immediately.
    const memory = new Map();
    function memGet(key) {
      const entry = memory.get(key);
      if (!entry) return null;
      memory.delete(key);
      memory.set(key, entry);
      return entry.compiled;
    }
    function memSet(key, compiled) {
      if (memory.has(key)) memory.delete(key);
      memory.set(key, { compiled, at: Date.now() });
      if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
    }

    function db() {
      if (!dbPromise) dbPromise = openDb();
      return dbPromise;
    }

    async function get(text) {
      const key = keyFor(text, version);
      const mem = memGet(key);
      if (validCompiled(mem, version)) return mem;
      const database = await db();
      if (database) {
        const value = await idbGet(database, key);
        if (validCompiled(value && value.compiled, version)) { memSet(key, value.compiled); return value.compiled; }
        if (value) await idbDelete(database, key);
        return null;
      }
      const all = await storageGet(browserApi);
      const entry = all[key];
      if (validCompiled(entry && entry.compiled, version)) { memSet(key, entry.compiled); return entry.compiled; }
      if (entry) {
        delete all[key];
        await storageSet(browserApi, all);
      }
      return null;
    }

    async function set(text, compiled, meta) {
      if (!validCompiled(compiled, version)) return;
      const key = keyFor(text, version);
      memSet(key, compiled);
      const value = Object.assign({ v: version, compiled, at: Date.now() }, meta || {});
      const database = await db();
      if (database) {
        await idbSet(database, key, value);
        await idbPrune(database);
        return;
      }
      const all = await storageGet(browserApi);
      all[key] = value;
      const keys = Object.keys(all);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach(k => { delete all[k]; });
      }
      await storageSet(browserApi, all);
    }

    return { get, set, keyFor: text => keyFor(text, version) };
  }

  global.WildFireCompileCache = { create, hashText, keyFor };
})(this);

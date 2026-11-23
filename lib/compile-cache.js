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

  function idbPrune(db) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.getAllKeys();
        req.onsuccess = () => {
          const keys = req.result || [];
          if (keys.length <= MAX_ENTRIES) { resolve(true); return; }
          keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => store.delete(k));
          tx.oncomplete = () => resolve(true);
        };
        req.onerror = () => resolve(false);
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
    return Boolean(compiled && typeof compiled === 'object' && compiled.v === version && Array.isArray(compiled.n));
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

    function db() {
      if (!dbPromise) dbPromise = openDb();
      return dbPromise;
    }

    async function get(text) {
      const key = keyFor(text, version);
      const database = await db();
      if (database) {
        const value = await idbGet(database, key);
        if (validCompiled(value && value.compiled, version)) return value.compiled;
        if (value) await idbDelete(database, key);
        return null;
      }
      const all = await storageGet(browserApi);
      const entry = all[key];
      if (validCompiled(entry && entry.compiled, version)) return entry.compiled;
      if (entry) {
        delete all[key];
        await storageSet(browserApi, all);
      }
      return null;
    }

    async function set(text, compiled, meta) {
      if (!validCompiled(compiled, version)) return;
      const key = keyFor(text, version);
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

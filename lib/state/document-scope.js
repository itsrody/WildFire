/* WildFire - maps Firefox documentIds to document URLs for request scope. */
(function (global) {
  'use strict';

  function frameKey(tabId, frameId) {
    return tabId + ':' + frameId;
  }

  class DocumentScope {
    constructor() {
      this.docUrls = new Map();
      this.frameDocs = new Map();
      this.tabUrls = new Map();
    }

    // Seed from webNavigation events, where documentId and url arrive together.
    remember(details) {
      if (!details) return;
      const tabId = details.tabId;
      const frameId = details.frameId || 0;
      const knownTab = typeof tabId === 'number' && tabId >= 0;

      if (details.documentId && knownTab) {
        const key = frameKey(tabId, frameId);
        const previous = this.frameDocs.get(key);
        if (previous && previous !== details.documentId) this.docUrls.delete(previous);
        this.frameDocs.set(key, details.documentId);
      }
      if (details.url) {
        if (details.documentId) this.docUrls.set(details.documentId, details.url);
        if (frameId === 0 && knownTab) this.tabUrls.set(tabId, details.url);
      }
    }

    // webRequest details often carry both; cache them for later fallback use.
    // Ignore documents already replaced in the same frame so a late request
    // cannot resurrect a stale URL, and track the id for later cleanup.
    rememberFromRequest(details) {
      if (!details || !details.documentId || !details.documentUrl) return;
      const tabId = details.tabId;
      const frameId = details.frameId || 0;
      if (typeof tabId === 'number' && tabId >= 0) {
        const key = frameKey(tabId, frameId);
        const current = this.frameDocs.get(key);
        if (current && current !== details.documentId) return;
        this.frameDocs.set(key, details.documentId);
      }
      this.docUrls.set(details.documentId, details.documentUrl);
    }

    urlForFrame(tabId, frameId) {
      const docId = this.frameDocs.get(frameKey(tabId, frameId || 0));
      return (docId && this.docUrls.get(docId)) ||
        (frameId === 0 ? this.tabUrls.get(tabId) : '') || '';
    }

    forgetTab(tabId) {
      const prefix = tabId + ':';
      Array.from(this.frameDocs.entries())
        .filter(([key]) => key.startsWith(prefix))
        .forEach(([key, docId]) => {
          this.docUrls.delete(docId);
          this.frameDocs.delete(key);
        });
      this.tabUrls.delete(tabId);
    }

    // Synchronous lookup for the blocking listener; documentId outranks tabId.
    documentUrl(details) {
      if (!details) return '';
      return details.documentUrl || details.originUrl ||
        (details.documentId ? this.docUrls.get(details.documentId) : '') ||
        (details.tabId >= 0 ? this.tabUrls.get(details.tabId) : '') ||
        (details.frameAncestors && details.frameAncestors.length
          ? details.frameAncestors[details.frameAncestors.length - 1].url
          : '') || '';
    }
  }

  global.DocumentScope = DocumentScope;
})(this);

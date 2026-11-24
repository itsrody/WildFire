/* WildFire - in-memory per-tab and per-frame page state for Firefox events. */
(function (global) {
  'use strict';

  function hostOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function knownTab(tabId) {
    return typeof tabId === 'number' && tabId >= 0;
  }

  class WildFirePageStore {
    constructor(options) {
      const config = options || {};
      this.siteForHost = typeof config.siteForHost === 'function'
        ? config.siteForHost
        : host => host.split('.').slice(-2).join('.');
      this.isDisabledHost = typeof config.isDisabledHost === 'function'
        ? config.isDisabledHost
        : () => false;
      this.pages = new Map();
    }

    _page(tabId, create) {
      if (!knownTab(tabId)) return null;
      let page = this.pages.get(tabId);
      if (!page && create) {
        page = {
          tabId,
          url: '',
          host: '',
          site: '',
          frames: new Map(),
          documents: new Map(),
          popupSource: '',
          popupBlocked: false,
          popupCounted: false,
          blocked: 0,
          cosmetic: null,
          scriptlets: null
        };
        this.pages.set(tabId, page);
      }
      return page || null;
    }

    _frame(page, frameId, create) {
      if (!page) return null;
      const id = frameId || 0;
      let frame = page.frames.get(id);
      if (!frame && create) {
        frame = {
          frameId: id,
          url: '',
          documentId: '',
          parentFrameId: id === 0 ? undefined : 0
        };
        page.frames.set(id, frame);
      }
      return frame || null;
    }

    _forgetFrame(page, frameId) {
      const frame = page.frames.get(frameId);
      if (!frame) return;
      if (frame.documentId) page.documents.delete(frame.documentId);
      page.frames.delete(frameId);
      Array.from(page.frames.values())
        .filter(child => child.parentFrameId === frameId)
        .forEach(child => this._forgetFrame(page, child.frameId));
    }

    _forgetDocument(page, documentId) {
      if (!documentId) return;
      const frameId = page.documents.get(documentId);
      page.documents.delete(documentId);
      if (frameId !== undefined) this._forgetFrame(page, frameId);
    }

    _setFrameDocument(page, frameId, documentId, url, parentFrameId) {
      const previous = this._frame(page, frameId, false);
      if (previous && previous.documentId && previous.documentId !== documentId) {
        this._forgetDocument(page, previous.documentId);
      }
      const frame = this._frame(page, frameId, true);
      if (documentId) {
        const owner = page.documents.get(documentId);
        if (owner !== undefined && owner !== frameId) {
          const other = page.frames.get(owner);
          if (other) {
            other.documentId = '';
            other.url = '';
          }
        }
      }
      frame.documentId = documentId || '';
      if (url) frame.url = url;
      if (Number.isInteger(parentFrameId)) frame.parentFrameId = parentFrameId;
      if (documentId) page.documents.set(documentId, frameId);
      return frame;
    }

    _resetPage(page, url) {
      page.url = url || '';
      page.host = hostOf(page.url);
      page.site = page.host ? this.siteForHost(page.host) || page.host : '';
      page.frames = new Map();
      page.documents = new Map();
      page.popupSource = '';
      page.popupBlocked = false;
      page.popupCounted = false;
      page.blocked = 0;
      page.cosmetic = null;
      page.scriptlets = null;
      if (page.url) this._setFrameDocument(page, 0, '', page.url);
      return page;
    }

    // webNavigation details are authoritative for document lifetime. A new
    // top-level document clears frame and cache state; fragment/history updates
    // keep the same document and only refresh its URL.
    observeNavigation(details) {
      if (!details || !knownTab(details.tabId)) return null;
      const page = this._page(details.tabId, true);
      const frameId = details.frameId || 0;

      if (frameId === 0 && details.url) {
        const current = this._frame(page, 0, false);
        const sameDocument = details.documentId && current &&
          current.documentId === details.documentId;
        if (!sameDocument) {
          this._resetPage(page, details.url);
          const frame = this._frame(page, 0, true);
          if (details.documentId) {
            this._setFrameDocument(page, 0, details.documentId, details.url);
            frame.url = details.url;
          }
          return page;
        }
        current.url = details.url;
        return page;
      }

      if (details.documentId) this._setFrameDocument(
        page, frameId, details.documentId, details.url, details.parentFrameId);
      else {
        const frame = this._frame(page, frameId, true);
        if (details.url) frame.url = details.url;
        if (Number.isInteger(details.parentFrameId)) frame.parentFrameId = details.parentFrameId;
      }
      return page;
    }

    // webRequest details are opportunistic: they seed missing state but never
    // resurrect a document that webNavigation already replaced.
    observeRequest(details) {
      if (!details || !knownTab(details.tabId)) return null;
      const page = this._page(details.tabId, true);
      const frameId = details.frameId || 0;

      if (details.documentUrl) {
        const current = this._frame(page, frameId, false);
        const canSeed = !current || !current.documentId || !details.documentId ||
          current.documentId === details.documentId;
        if (canSeed) {
          if (details.documentId) {
            this._setFrameDocument(
              page, frameId, details.documentId, details.documentUrl, details.parentFrameId);
          } else {
            const frame = this._frame(page, frameId, true);
            frame.url = details.documentUrl;
            if (Number.isInteger(details.parentFrameId)) frame.parentFrameId = details.parentFrameId;
          }
        }
      }

      // A top-level request must not replace the committed page identity:
      // webNavigation owns that lifetime, and a cancelled navigation would
      // otherwise poison counters and pause checks with the blocked target.
      if (frameId === 0 && details.type === 'main_frame' && details.url) {
        const frame = this._frame(page, 0, true);
        if (!frame.url) frame.url = details.url;
      }
      return page;
    }

    observeTab(tabId, url) {
      const page = this._page(tabId, Boolean(url));
      if (!page || !url) return page ? page.site : '';
      page.url = url;
      page.host = hostOf(url);
      page.site = page.host ? this.siteForHost(page.host) || page.host : '';
      const frame = this._frame(page, 0, false);
      if (frame && !frame.url) frame.url = url;
      return page.site;
    }

    observeTopHost(tabId, host) {
      const page = this._page(tabId, Boolean(host));
      if (!page || !host) return page ? page.site : '';
      page.host = String(host).toLowerCase();
      page.site = this.siteForHost(page.host) || page.host;
      return page.site;
    }

    forgetTab(tabId) {
      if (knownTab(tabId)) this.pages.delete(tabId);
    }

    clear() {
      this.pages.clear();
    }

    frameFor(tabId, frameId) {
      const page = this._page(tabId, false);
      return this._frame(page, frameId || 0, false);
    }

    framesForTab(tabId) {
      const page = this._page(tabId, false);
      return page
        ? Array.from(page.frames.values()).filter(frame => Boolean(frame.url))
        : [];
    }

    urlForFrame(tabId, frameId) {
      const frame = this.frameFor(tabId, frameId);
      return frame ? frame.url : '';
    }

    topUrlForTab(tabId) {
      const page = this._page(tabId, false);
      return page ? page.url : '';
    }

    topHostForTab(tabId) {
      const page = this._page(tabId, false);
      return page ? page.host : '';
    }

    siteForTab(tabId) {
      const page = this._page(tabId, false);
      return page ? page.site : '';
    }

    siteEntries() {
      return Array.from(this.pages.entries())
        .map(([tabId, page]) => [tabId, page.site]);
    }

    documentUrlFor(details) {
      return this.contextFor(details).documentUrl;
    }

    contextFor(details) {
      const page = details ? this._page(details.tabId, false) : null;
      const frame = page ? this._frame(page, details.frameId || 0, false) : null;
      const documentFrameId = page && details.documentId
        ? page.documents.get(details.documentId)
        : undefined;
      const documentIdUrl = documentFrameId !== undefined
        ? this.urlForFrame(details.tabId, documentFrameId)
        : '';
      const ancestorUrl = details && details.frameAncestors && details.frameAncestors.length
        ? details.frameAncestors[details.frameAncestors.length - 1].url
        : '';
      const mainRequest = Boolean(details && details.type === 'main_frame');
      const topUrl = (page && page.url) || (mainRequest ? String(details.url || '') : '');
      const topHost = hostOf(topUrl) || (page ? page.host : '');
      const documentUrl = details.documentUrl || details.originUrl || documentIdUrl ||
        (mainRequest ? String(details.url || '') : '') ||
        (frame ? frame.url : '') || topUrl || ancestorUrl || '';
      const host = hostOf(documentUrl);
      return {
        page,
        frame,
        documentUrl,
        host,
        site: host ? this.siteForHost(host) || host : '',
        topUrl,
        topHost,
        topSite: topHost ? this.siteForHost(topHost) || topHost : '',
        // Pause state follows the tab's committed top-level site, even when the
        // request belongs to an embedded frame.
        disabled: this.isDisabledHost(topHost || host)
      };
    }

    markPopup(tabId, sourceUrl) {
      const page = this._page(tabId, Boolean(sourceUrl));
      if (!page || !sourceUrl) return;
      page.popupSource = sourceUrl;
      page.popupBlocked = false;
      page.popupCounted = false;
    }

    hasPopup(tabId) {
      const page = this._page(tabId, false);
      return Boolean(page && page.popupSource);
    }

    popupSourceFor(tabId) {
      const page = this._page(tabId, false);
      return page ? page.popupSource : '';
    }

    isPopupBlocked(tabId) {
      const page = this._page(tabId, false);
      return Boolean(page && page.popupBlocked);
    }

    consumePopupBlock(tabId) {
      const page = this._page(tabId, false);
      if (!page || !page.popupBlocked) return false;
      page.popupBlocked = false;
      page.popupCounted = false;
      page.popupSource = '';
      return true;
    }

    clearPopup(tabId) {
      const page = this._page(tabId, false);
      if (!page) return;
      page.popupBlocked = false;
      page.popupCounted = false;
      page.popupSource = '';
    }

    markPopupBlocked(tabId) {
      const page = this._page(tabId, true);
      if (page) page.popupBlocked = true;
    }

    isPopupCounted(tabId) {
      const page = this._page(tabId, false);
      return Boolean(page && page.popupCounted);
    }

    markPopupCounted(tabId) {
      const page = this._page(tabId, false);
      if (page) page.popupCounted = true;
    }

    recordBlocked(tabId) {
      const page = this._page(tabId, false);
      if (!page) return 0;
      page.blocked += 1;
      return page.blocked;
    }

    blockedForTab(tabId) {
      const page = this._page(tabId, false);
      return page ? page.blocked : 0;
    }

    resetBlocked() {
      this.pages.forEach(page => {
        page.blocked = 0;
      });
    }

    setCosmetic(tabId, data) {
      const page = this._page(tabId, false);
      if (page) page.cosmetic = data || null;
    }

    getCosmetic(tabId) {
      const page = this._page(tabId, false);
      return page ? page.cosmetic : null;
    }

    setScriptlets(tabId, data) {
      const page = this._page(tabId, false);
      if (page) page.scriptlets = data || null;
    }

    getScriptlets(tabId) {
      const page = this._page(tabId, false);
      return page ? page.scriptlets : null;
    }

    stats() {
      const pages = Array.from(this.pages.values());
      return {
        pages: pages.length,
        frames: pages.reduce((total, page) => total + page.frames.size, 0),
        documents: pages.reduce((total, page) => total + page.documents.size, 0),
        popups: pages.filter(page => page.popupSource).length
      };
    }
  }

  global.WildFirePageStore = WildFirePageStore;
})(this);

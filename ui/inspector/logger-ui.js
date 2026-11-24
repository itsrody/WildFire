/* WildFire - Inspector log helpers and renderer. Pure data functions plus DOM. */
(function (global) {
  'use strict';

  const api = global.WildFireInspectorUI = global.WildFireInspectorUI || {};
  try { global.wildfireInspectorUI = api; } catch (error) { /* canonical global is enough */ }

  function normalizeFilters(value) {
    const config = value || {};
    return {
      decision: String(config.decision || 'all'),
      phase: String(config.phase || 'all'),
      type: String(config.type || '').trim().toLowerCase(),
      site: String(config.site || '').trim().toLowerCase(),
      query: String(config.query || '').trim().toLowerCase(),
      rulesOnly: Boolean(config.rulesOnly)
    };
  }

  function haystack(entry) {
    const source = entry || {};
    const rule = source.rule || {};
    return [
      source.decision, source.phase, source.source, source.type,
      source.host, source.site, source.topHost, source.topSite,
      source.url, source.detail, source.reason, rule.text, rule.source
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function matches(entry, value) {
    const source = entry || {};
    const filters = normalizeFilters(value);
    const site = [source.site, source.topSite, source.host, source.topHost]
      .filter(Boolean).join(' ').toLowerCase();
    if (filters.decision !== 'all' && source.decision !== filters.decision) return false;
    if (filters.phase !== 'all' && source.phase !== filters.phase) return false;
    if (filters.type && String(source.type || '').toLowerCase() !== filters.type) return false;
    if (filters.site && !site.includes(filters.site)) return false;
    if (filters.rulesOnly && !(source.rule && source.rule.text)) return false;
    return !filters.query || haystack(source).includes(filters.query);
  }

  function filterEntries(entries, value) {
    return (Array.isArray(entries) ? entries : []).filter(entry => matches(entry, value));
  }

  function summarize(entries) {
    return (Array.isArray(entries) ? entries : []).reduce((counts, entry) => {
      const decision = String(entry && entry.decision || 'allowed');
      counts[decision] = (counts[decision] || 0) + 1;
      return counts;
    }, {});
  }

  function ruleForEntry(entry) {
    const source = entry || {};
    const rule = source.rule || {};
    const text = String(rule.text || '');
    if (text && !text.startsWith('@@')) return text;
    const host = String(source.host || '').trim().toLowerCase();
    return host ? '||' + host + '^' : '';
  }

  function timeLabel(entry) {
    const source = entry || {};
    const at = Number(source.at);
    const time = Number.isFinite(at) && at > 0 ? new Date(at).toLocaleTimeString() : '';
    const ms = Number(source.ms) || 0;
    return time + (ms ? ' · ' + ms + ' ms' : '');
  }

  function create(config) {
    const options = config || {};
    const doc = options.document || global.document;
    const elements = options.elements || {};
    const timers = options.timers || {};
    const setTimer = timers.set || global.setTimeout;
    const filters = normalizeFilters({});
    let live = null;
    let frozen = null;
    let status = '';

    function setStatus(message) {
      status = String(message || '');
      elements.status.textContent = status;
      if (status && typeof setTimer === 'function') {
        setTimer(() => {
          if (status === message) setStatus('');
        }, 4000);
      }
    }

    function cell(className, value) {
      const item = doc.createElement('td');
      item.className = className;
      item.textContent = String(value == null ? '' : value);
      return item;
    }

    function decisionClass(entry) {
      return 'decision ' + String(entry && entry.decision || 'allowed')
        .replace(/[^a-z-]/g, '');
    }

    function requestTitle(entry) {
      return [
        'URL: ' + (entry.url || '—'),
        'Document: ' + (entry.documentUrl || '—'),
        'Top site: ' + (entry.topSite || entry.topHost || '—'),
        'Type: ' + (entry.type || '—'),
        'Tab: ' + (entry.tabId == null ? '—' : entry.tabId),
        'Request: ' + (entry.requestId || '—')
      ].join('\n');
    }

    function ruleTitle(entry) {
      const rule = entry.rule || {};
      if (!rule.text) return '';
      return String(rule.source || 'wildfire') + (rule.hash ? ' · ' + rule.hash : '');
    }

    function detailText(entry) {
      return [entry.reason, entry.detail, entry.type].filter(Boolean).join(' · ') || '—';
    }

    async function copyRule(entry) {
      const rule = ruleForEntry(entry);
      if (!rule) return;
      try {
        const clipboard = options.clipboard ||
          (global.navigator && global.navigator.clipboard);
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          throw new Error('Clipboard is unavailable in this window.');
        }
        await clipboard.writeText(rule);
        setStatus('Copied rule: ' + rule);
      } catch (error) {
        setStatus(error.message || 'Could not copy rule.');
      }
    }

    function copyButton(entry) {
      const item = doc.createElement('td');
      const button = doc.createElement('button');
      const rule = ruleForEntry(entry);
      button.type = 'button';
      button.className = 'button copy-rule';
      button.textContent = 'Copy rule';
      button.disabled = !rule;
      button.addEventListener('click', () => copyRule(entry));
      item.appendChild(button);
      return item;
    }

    function render() {
      const snapshot = frozen || live;
      if (!snapshot) return;
      elements.enabled.checked = Boolean(snapshot.enabled);
      elements.freeze.textContent = frozen ? 'Unfreeze view' : 'Freeze view';
      elements.freeze.setAttribute('aria-pressed', frozen ? 'true' : 'false');

      const recorded = Array.isArray(snapshot.entries) ? snapshot.entries : [];
      const entries = filterEntries(recorded, filters);
      const counts = summarize(entries);
      const tally = Object.keys(counts).sort().map(name => name + ' ' + counts[name]).join(' · ');
      elements.summary.textContent = entries.length + ' shown' +
        (tally ? ' · ' + tally : '') +
        ' · ' + recorded.length + ' of ' + Number(snapshot.limit || 0) +
        ' decisions recorded locally in memory.' + (frozen ? ' View frozen.' : '');
      elements.rows.textContent = '';

      if (!entries.length) {
        const row = doc.createElement('tr');
        const empty = doc.createElement('td');
        empty.colSpan = 7;
        empty.className = 'empty';
        empty.textContent = !recorded.length
          ? (snapshot.enabled ? 'Waiting for request decisions.' : 'Recording is off.')
          : 'No decisions match these filters.';
        row.appendChild(empty);
        elements.rows.appendChild(row);
        return;
      }

      entries.slice().reverse().map(entry => {
        const row = doc.createElement('tr');
        const decision = cell(decisionClass(entry), entry.decision || 'allowed');
        const phase = cell('phase', entry.phase || 'request');
        const request = cell('request', entry.host || entry.site || entry.url || '—');
        request.title = requestTitle(entry);
        const rule = cell('rule', entry.rule && entry.rule.text ? entry.rule.text : '—');
        const title = ruleTitle(entry);
        if (title) rule.title = title;
        const detail = cell('detail', detailText(entry));
        row.append(
          cell('time', timeLabel(entry)), decision, phase, request, rule, detail,
          copyButton(entry));
        return row;
      }).forEach(row => elements.rows.appendChild(row));
    }

    function setSnapshot(value) {
      live = value || { enabled: false, limit: 0, entries: [] };
      if (!frozen) render();
    }

    function setFrozen(value) {
      frozen = value
        ? (frozen || live || { enabled: false, limit: 0, entries: [] })
        : null;
      render();
      return Boolean(frozen);
    }

    function updateFilter(name, value) {
      filters[name] = value;
      render();
    }

    return {
      render,
      setStatus,
      setSnapshot,
      setFrozen,
      updateFilter,
      isFrozen: () => Boolean(frozen),
      snapshot: () => frozen || live
    };
  }

  api.normalizeFilters = normalizeFilters;
  api.matches = matches;
  api.filterEntries = filterEntries;
  api.summarize = summarize;
  api.ruleForEntry = ruleForEntry;
  api.timeLabel = timeLabel;
  api.create = create;
})(this);

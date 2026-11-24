(function (global) {
  'use strict';

  const client = global.WildFireWapiClient.create();
  const log = global.WildFireInspectorLog;
  const elements = {
    enabled: document.getElementById('inspector-enabled'),
    decision: document.getElementById('inspector-decision-filter'),
    phase: document.getElementById('inspector-phase-filter'),
    type: document.getElementById('inspector-type-filter'),
    site: document.getElementById('inspector-site-filter'),
    query: document.getElementById('inspector-query-filter'),
    rulesOnly: document.getElementById('inspector-rules-only'),
    refresh: document.getElementById('inspector-refresh'),
    freeze: document.getElementById('inspector-freeze'),
    clear: document.getElementById('inspector-clear'),
    status: document.getElementById('inspector-status'),
    summary: document.getElementById('inspector-summary'),
    rows: document.getElementById('inspector-rows')
  };
  const filters = {
    decision: 'all', phase: 'all', type: '', site: '', query: '', rulesOnly: false
  };
  const REFRESH_MS = 1000;
  let live = null;
  let frozen = null;
  let pollTimer = null;
  let closed = false;

  function setStatus(message) {
    elements.status.textContent = message || '';
    if (message) {
      global.setTimeout(() => {
        if (elements.status.textContent === message) elements.status.textContent = '';
      }, 4000);
    }
  }

  function cell(className, value) {
    const item = document.createElement('td');
    item.className = className;
    item.textContent = String(value == null ? '' : value);
    return item;
  }

  function decisionClass(entry) {
    const decision = String(entry && entry.decision || 'allowed');
    return 'decision ' + decision.replace(/[^a-z-]/g, '');
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
    const rule = log.ruleForEntry(entry);
    if (!rule) return;
    try {
      const clipboard = global.navigator && global.navigator.clipboard;
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
    const item = document.createElement('td');
    const button = document.createElement('button');
    const rule = log.ruleForEntry(entry);
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
    const entries = log.filterEntries(recorded, filters);
    const counts = log.summarize(entries);
    const tally = Object.keys(counts).sort().map(name => name + ' ' + counts[name]).join(' · ');
    elements.summary.textContent = entries.length + ' shown' + (tally ? ' · ' + tally : '') +
      ' · ' + recorded.length + ' of ' + Number(snapshot.limit || 0) +
      ' decisions recorded locally in memory.' + (frozen ? ' View frozen.' : '');
    elements.rows.textContent = '';

    if (!entries.length) {
      const row = document.createElement('tr');
      const empty = document.createElement('td');
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
      const row = document.createElement('tr');
      const decision = cell(decisionClass(entry), entry.decision || 'allowed');
      const phase = cell('phase', entry.phase || 'request');
      const request = cell('request', entry.host || entry.site || entry.url || '—');
      request.title = requestTitle(entry);
      const rule = cell('rule', entry.rule && entry.rule.text ? entry.rule.text : '—');
      const title = ruleTitle(entry);
      if (title) rule.title = title;
      const detail = cell('detail', detailText(entry));
      row.append(
        cell('time', log.timeLabel(entry)), decision, phase, request, rule, detail,
        copyButton(entry));
      return row;
    }).forEach(row => elements.rows.appendChild(row));
  }

  function scheduleRefresh() {
    if (pollTimer || frozen || closed || !(live && live.enabled)) return;
    pollTimer = global.setTimeout(() => {
      pollTimer = null;
      if (frozen || closed) return;
      action({}, '').catch(error => {
        elements.summary.textContent = 'Could not refresh WildFire Inspector: ' + error.message;
      });
    }, REFRESH_MS);
  }

  async function action(payload, message) {
    const result = await client.send('inspect', payload || {});
    live = result.inspect || { enabled: false, limit: 0, entries: [] };
    if (!frozen) render();
    setStatus(message || '');
    scheduleRefresh();
    return result;
  }

  function updateFilter(name, value) {
    filters[name] = value;
    if (live || frozen) render();
  }

  function setFrozen(value) {
    if (value) {
      frozen = live || frozen || { enabled: false, limit: 0, entries: [] };
      if (pollTimer) {
        global.clearTimeout(pollTimer);
        pollTimer = null;
      }
    } else {
      frozen = null;
    }
    render();
    if (!frozen) action({}, 'View unfrozen.').catch(error => setStatus(error.message));
  }

  elements.enabled.addEventListener('change', () => {
    if (frozen) {
      frozen = null;
      render();
    }
    action({ value: elements.enabled.checked },
      elements.enabled.checked ? 'Recording on.' : 'Recording off.');
  });
  elements.decision.addEventListener('change', () =>
    updateFilter('decision', elements.decision.value));
  elements.phase.addEventListener('change', () =>
    updateFilter('phase', elements.phase.value));
  elements.type.addEventListener('input', () => updateFilter('type', elements.type.value));
  elements.site.addEventListener('input', () => updateFilter('site', elements.site.value));
  elements.query.addEventListener('input', () => updateFilter('query', elements.query.value));
  elements.rulesOnly.addEventListener('change', () =>
    updateFilter('rulesOnly', elements.rulesOnly.checked));
  elements.refresh.addEventListener('click', () => action({}, 'Refreshed.'));
  elements.freeze.addEventListener('click', () => setFrozen(!frozen));
  elements.clear.addEventListener('click', () => {
    frozen = null;
    action({ reset: true }, 'Cleared.');
  });

  if (global.addEventListener) {
    global.addEventListener('beforeunload', () => {
      closed = true;
      if (pollTimer) {
        global.clearTimeout(pollTimer);
        pollTimer = null;
      }
    });
  }

  action({}, '').catch(error => {
    elements.summary.textContent = 'Could not load WildFire Inspector: ' + error.message;
  });
})(this);

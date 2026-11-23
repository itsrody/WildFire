(function () {
  'use strict';

  const client = WildFireWapiClient.create();
  const elements = {
    enabled: document.getElementById('inspector-enabled'),
    decision: document.getElementById('inspector-decision-filter'),
    site: document.getElementById('inspector-site-filter'),
    refresh: document.getElementById('inspector-refresh'),
    clear: document.getElementById('inspector-clear'),
    status: document.getElementById('inspector-status'),
    summary: document.getElementById('inspector-summary'),
    rows: document.getElementById('inspector-rows')
  };
  const filters = { decision: 'all', site: '' };
  let snapshot = null;

  function setStatus(message) {
    elements.status.textContent = message;
    if (message) {
      setTimeout(() => {
        if (elements.status.textContent === message) elements.status.textContent = '';
      }, 4000);
    }
  }

  function cell(className, value) {
    const item = document.createElement('td');
    item.className = className;
    item.textContent = value;
    return item;
  }

  function render(value) {
    snapshot = value || { enabled: false, limit: 0, entries: [] };
    elements.enabled.checked = Boolean(snapshot.enabled);
    const recorded = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const site = filters.site.trim().toLowerCase();
    const entries = recorded.filter(entry =>
      (filters.decision === 'all' || entry.decision === filters.decision) &&
      (!site || String(entry.site || entry.host || entry.url || '')
        .toLowerCase().includes(site)));
    elements.summary.textContent = entries.length + ' shown · ' + recorded.length +
      ' of ' + Number(snapshot.limit || 0) + ' decisions recorded locally in memory.';
    elements.rows.textContent = '';

    if (!entries.length) {
      const row = document.createElement('tr');
      const empty = document.createElement('td');
      empty.colSpan = 5;
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
      const decision = cell('decision ' + String(entry.decision || ''),
        String(entry.decision || 'allowed'));
      const request = cell('',
        (entry.phase ? entry.phase + ': ' : '') + (entry.host || entry.url || '—'));
      request.title = String(entry.url || '');
      const rule = cell('rule', entry.rule ? (entry.rule.text || '—') : '—');
      if (entry.rule && (entry.rule.source || entry.rule.hash)) {
        rule.title = String(entry.rule.source || 'wildfire') +
          (entry.rule.hash ? ' · ' + entry.rule.hash : '');
      }
      const detail = cell('', String(entry.detail || entry.type || '—'));
      const time = cell('', new Date(entry.at).toLocaleTimeString() +
        (entry.ms ? ' · ' + entry.ms + ' ms' : ''));
      row.append(decision, request, rule, detail, time);
      return row;
    }).forEach(row => elements.rows.appendChild(row));
  }

  async function action(payload, message) {
    const result = await client.send('inspect', payload || {});
    render(result.inspect);
    setStatus(message || '');
    return result;
  }

  elements.enabled.addEventListener('change', () => action(
    { value: elements.enabled.checked },
    elements.enabled.checked ? 'Recording on.' : 'Recording off.'));
  elements.decision.addEventListener('change', () => {
    filters.decision = elements.decision.value;
    if (snapshot) render(snapshot);
  });
  elements.site.addEventListener('input', () => {
    filters.site = elements.site.value;
    if (snapshot) render(snapshot);
  });
  elements.refresh.addEventListener('click', () => action({}, 'Refreshed.'));
  elements.clear.addEventListener('click', () => action({ reset: true }, 'Cleared.'));

  action({}, '').catch(error => {
    elements.summary.textContent = 'Could not load WildFire Inspector: ' + error.message;
  });
})();

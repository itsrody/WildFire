(function () {
  'use strict';

  const client = WildFireWapiClient.create();
  const filters = document.getElementById('filters');
  const filterStatus = document.getElementById('filter-status');
  const sitesList = document.getElementById('sites');
  const siteForm = document.getElementById('site-form');
  const siteInput = document.getElementById('site-input');
  const suggestedList = document.getElementById('suggested-lists');
  const listsList = document.getElementById('remote-lists');
  const listForm = document.getElementById('list-form');
  const listInput = document.getElementById('list-url');
  const listStatus = document.getElementById('list-status');
  const statsText = document.getElementById('stats-text');
  const blockCspReports = document.getElementById('block-csp-reports');
  const cspReportAllow = document.getElementById('csp-report-allow');
  const cspReportForm = document.getElementById('csp-report-allow-form');
  const cspReportStatus = document.getElementById('csp-report-status');
  const inspectorEnabled = document.getElementById('inspector-enabled');
  const inspectorDecisionFilter = document.getElementById('inspector-decision-filter');
  const inspectorSiteFilter = document.getElementById('inspector-site-filter');
  const inspectorRefresh = document.getElementById('inspector-refresh');
  const inspectorClear = document.getElementById('inspector-clear');
  const inspectorStatus = document.getElementById('inspector-status');
  const inspectorSummary = document.getElementById('inspector-summary');
  const inspectorRows = document.getElementById('inspector-rows');

  let state = null;
  let lists = [];
  let suggested = [];
  let inspection = null;
  const inspectorFilters = { decision: 'all', site: '' };

  function setListStatus(message) {
    listStatus.textContent = message || '';
    if (message) {
      setTimeout(() => {
        if (listStatus.textContent === message) listStatus.textContent = '';
      }, 5000);
    }
  }

  function actionButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      try {
        await handler();
      } catch (error) {
        setListStatus(error.message || 'Action failed.');
      }
    });
    return button;
  }

  function renderSites() {
    const sites = Array.isArray(state.disabledSites) ? state.disabledSites : [];
    sitesList.textContent = '';
    if (!sites.length) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = 'No paused sites.';
      sitesList.appendChild(item);
      return;
    }
    sites.forEach(site => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = site;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        state = await client.send('toggle-site', { host: site });
        renderSites();
      });
      item.append(label, remove);
      sitesList.appendChild(item);
    });
  }

  function renderSuggested() {
    suggestedList.textContent = '';
    suggested.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'list-item';
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('span');
      label.className = 'list-label';
      label.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = entry.description;
      row.append(label, meta);

      const actions = document.createElement('div');
      actions.className = 'list-actions';
      const added = lists.some(list => list.url === entry.url);
      const add = actionButton(added ? 'Added' : 'Add',
        () => listAction('add-list', entry.url));
      add.disabled = added;
      actions.appendChild(add);
      item.append(row, actions);
      suggestedList.appendChild(item);
    });
  }

  function renderLists() {
    listsList.textContent = '';
    if (!lists.length) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = 'No remote lists added.';
      listsList.appendChild(item);
      return;
    }
    lists.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'list-item';
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('span');
      label.className = 'list-url';
      label.textContent = entry.url;
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      const when = entry.checkedAt || entry.updatedAt;
      const status = !entry.text ? 'Not fetched' : (entry.enabled ? 'Active' : 'Fetched');
      const time = when ? new Date(when).toLocaleString() : 'never';
      const hash = entry.hash ? ' · ' + String(entry.hash).slice(0, 8) : '';
      const err = entry.lastError ? ' · Error: ' + entry.lastError : '';
      meta.textContent = status + ' · ' + time + hash + err;
      row.append(label, meta);

      const actions = document.createElement('div');
      actions.className = 'list-actions';
      actions.append(
        actionButton(entry.text ? 'Update' : 'Fetch', () => listAction('update-list', entry.url)),
        actionButton(entry.enabled ? 'Disable' : 'Enable',
          () => listAction('set-list-enabled', entry.url, !entry.enabled)),
        actionButton(entry.autoUpdate ? 'Auto: on' : 'Auto: off',
          () => listAction('set-list-auto', entry.url, !entry.autoUpdate)),
        actionButton('Remove', () => listAction('remove-list', entry.url))
      );
      item.append(row, actions);
      listsList.appendChild(item);
    });
  }

  async function listAction(type, url, value) {
    const payload = { url };
    if (value !== undefined) payload.value = value;
    const result = await client.send(type, payload);
    if (Array.isArray(result.lists)) lists = result.lists;
    if (result.state) state = result.state;
    if (result.ok === false) setListStatus(result.error || 'Action failed.');
    else if (type === 'update-list') setListStatus(result.changed ? 'Updated.' : 'Checked.');
    else setListStatus('Saved.');
    renderLists();
    renderSuggested();
    return result;
  }

  function renderCspReports() {
    blockCspReports.checked = state.blockCspReports !== false;
    cspReportAllow.value = (Array.isArray(state.cspReportAllow) ? state.cspReportAllow : []).join(', ');
  }

  function setCspReportStatus(message) {
    cspReportStatus.textContent = message;
    setTimeout(() => {
      if (cspReportStatus.textContent === message) cspReportStatus.textContent = '';
    }, 4000);
  }

  function setInspectorStatus(message) {
    inspectorStatus.textContent = message;
    if (message) {
      setTimeout(() => {
        if (inspectorStatus.textContent === message) inspectorStatus.textContent = '';
      }, 4000);
    }
  }

  function inspectorCell(className, value) {
    const cell = document.createElement('td');
    cell.className = className;
    cell.textContent = value;
    return cell;
  }

  function renderInspector(snapshot) {
    inspection = snapshot || { enabled: false, limit: 0, entries: [] };
    inspectorEnabled.checked = Boolean(inspection.enabled);
    const recorded = Array.isArray(inspection.entries) ? inspection.entries : [];
    const site = inspectorFilters.site.trim().toLowerCase();
    const entries = recorded.filter(entry =>
      (inspectorFilters.decision === 'all' ||
        entry.decision === inspectorFilters.decision) &&
      (!site || String(entry.site || entry.host || entry.url || '')
        .toLowerCase().includes(site)));
    inspectorSummary.textContent = entries.length + ' shown · ' + recorded.length +
      ' of ' + Number(inspection.limit || 0) + ' decisions recorded locally in memory.';
    inspectorRows.textContent = '';

    if (!entries.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'empty';
      cell.textContent = !recorded.length
        ? (inspection.enabled ? 'Waiting for request decisions.' : 'Recording is off.')
        : 'No decisions match these filters.';
      row.appendChild(cell);
      inspectorRows.appendChild(row);
      return;
    }

    entries.slice().reverse().map(entry => {
      const row = document.createElement('tr');
      const decision = inspectorCell('decision ' + String(entry.decision || ''),
        String(entry.decision || 'allowed'));
      const request = inspectorCell('',
        (entry.phase ? entry.phase + ': ' : '') + (entry.host || entry.url || '—'));
      request.title = String(entry.url || '');
      const rule = inspectorCell('rule', entry.rule ? (entry.rule.text || '—') : '—');
      if (entry.rule && (entry.rule.source || entry.rule.hash)) {
        rule.title = String(entry.rule.source || 'wildfire') +
          (entry.rule.hash ? ' · ' + entry.rule.hash : '');
      }
      const detail = inspectorCell('', String(entry.detail || entry.type || '—'));
      const time = inspectorCell('', new Date(entry.at).toLocaleTimeString() +
        (entry.ms ? ' · ' + entry.ms + ' ms' : ''));
      row.append(decision, request, rule, detail, time);
      return row;
    }).forEach(row => inspectorRows.appendChild(row));
  }

  async function inspectorAction(payload, message) {
    const result = await client.send('inspect', payload || {});
    renderInspector(result.inspect);
    setInspectorStatus(message || '');
    return result;
  }

  function render() {
    filters.value = state.customFilters || '';
    statsText.textContent = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked since tracking began.';
    renderSites();
    renderLists();
    renderSuggested();
    renderCspReports();
    if (inspection) renderInspector(inspection);
  }

  document.getElementById('save').addEventListener('click', async () => {
    const result = await client.send('set-filters', { value: filters.value });
    state = result.state;
    filterStatus.textContent = 'Saved · ' + result.counts.network + ' network rules, ' +
      result.counts.cosmetic + ' cosmetic rules loaded.';
    statsText.textContent = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked since tracking began.';
    setTimeout(() => { filterStatus.textContent = ''; }, 4000);
  });

  siteForm.addEventListener('submit', async event => {
    event.preventDefault();
    const host = siteInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!host) return;
    state = await client.send('toggle-site', { host });
    siteInput.value = '';
    renderSites();
  });

  blockCspReports.addEventListener('change', async () => {
    state = await client.send('set-csp-report-blocking', { value: blockCspReports.checked });
    renderCspReports();
  });

  cspReportForm.addEventListener('submit', async event => {
    event.preventDefault();
    state = await client.send('set-csp-report-allow', { value: cspReportAllow.value });
    renderCspReports();
    setCspReportStatus('Allowed endpoints saved.');
  });

  inspectorEnabled.addEventListener('change', () => inspectorAction(
    { value: inspectorEnabled.checked },
    inspectorEnabled.checked ? 'Recording on.' : 'Recording off.'));
  inspectorDecisionFilter.addEventListener('change', () => {
    inspectorFilters.decision = inspectorDecisionFilter.value;
    if (inspection) renderInspector(inspection);
  });
  inspectorSiteFilter.addEventListener('input', () => {
    inspectorFilters.site = inspectorSiteFilter.value;
    if (inspection) renderInspector(inspection);
  });
  inspectorRefresh.addEventListener('click', () => inspectorAction({}, 'Refreshed.'));
  inspectorClear.addEventListener('click', () => inspectorAction({ reset: true }, 'Cleared.'));

  listForm.addEventListener('submit', async event => {
    event.preventDefault();
    const url = listInput.value.trim();
    if (!url) return;
    await listAction('add-list', url);
    listInput.value = '';
  });

  document.getElementById('reset').addEventListener('click', async () => {
    state = await client.send('reset-stats');
    render();
  });

  Promise.all([
    client.send('state'),
    client.send('list-state'),
    client.send('suggested-lists'),
    client.send('inspect')
  ])
    .then(results => {
      state = results[0].state;
      lists = Array.isArray(results[1].lists) ? results[1].lists : [];
      suggested = Array.isArray(results[2].suggested) ? results[2].suggested : [];
      inspection = results[3].inspect;
      render();
    })
    .catch(error => {
      statsText.textContent = 'Could not load options: ' + error.message;
    });
})();

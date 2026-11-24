(function () {
  'use strict';

  const client = WildFireWapiClient.create();
  const filters = document.getElementById('filters');
  const filterStatus = document.getElementById('filter-status');
  const sitesList = document.getElementById('sites');
  const siteRulesList = document.getElementById('site-rules');
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
  const cnameUncloak = document.getElementById('cname-uncloak');

  let state = null;
  let lists = [];
  let suggested = [];
  let filtersInitialized = false;

  function setFilterStatus(message) {
    filterStatus.textContent = message || '';
    if (message) {
      setTimeout(() => {
        if (filterStatus.textContent === message) filterStatus.textContent = '';
      }, 5000);
    }
  }

  const editor = WildFireOptionsEditor.create({
    document,
    client,
    textarea: filters,
    gutter: document.getElementById('filter-gutter'),
    overlay: document.getElementById('filter-highlight'),
    position: document.getElementById('filter-position'),
    dirty: document.getElementById('filter-dirty'),
    issues: document.getElementById('filter-issues'),
    find: document.getElementById('filter-find'),
    findButton: document.getElementById('find-filter'),
    validateButton: document.getElementById('validate-filters'),
    commentButton: document.getElementById('comment-filters'),
    duplicateButton: document.getElementById('duplicate-filters'),
    deleteButton: document.getElementById('delete-filters'),
    setStatus: setFilterStatus,
    onSave: () => saveFilters()
  });

  async function saveFilters() {
    try {
      const result = await client.send('set-filters', { value: editor.getValue() });
      state = result.state;
      editor.markClean();
      setFilterStatus('Saved · ' + result.counts.network + ' network rules, ' +
        result.counts.cosmetic + ' cosmetic rules loaded.');
      statsText.textContent = Number(state.blocked || 0).toLocaleString() +
        ' requests blocked since tracking began.';
    } catch (error) {
      setFilterStatus('Save failed: ' + error.message);
    }
  }

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

  function renderSiteRules() {
    const rules = state.siteRules && typeof state.siteRules === 'object' &&
      !Array.isArray(state.siteRules) ? state.siteRules : {};
    const sites = Object.keys(rules);
    siteRulesList.textContent = '';
    if (!sites.length) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = 'No dynamic site rules.';
      siteRulesList.appendChild(item);
      return;
    }
    sites.forEach(site => {
      const item = document.createElement('li');
      item.className = 'list-item';
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('span');
      label.className = 'list-label';
      label.textContent = site;
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = Object.keys(rules[site])
        .map(type => type + ': ' + rules[site][type])
        .join(' · ');
      row.append(label, meta);
      const actions = document.createElement('div');
      actions.className = 'list-actions';
      actions.append(actionButton('Clear all', async () => {
        state = await client.send('clear-site-rules', { site });
        renderSiteRules();
      }));
      item.append(row, actions);
      siteRulesList.appendChild(item);
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
      const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
      const label = document.createElement('span');
      label.className = 'list-url';
      label.textContent = entry.builtin
        ? (metadata.title || 'WildFire default filters') + ' (preshipped)'
        : (metadata.title || entry.url);
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      const when = entry.checkedAt || entry.updatedAt;
      const status = !entry.text ? 'Not fetched'
        : (entry.enabled ? (entry.builtin ? 'Active (preshipped)' : 'Active') : 'Disabled');
      const time = when ? new Date(when).toLocaleString() : 'never';
      const hash = entry.hash ? ' · ' + String(entry.hash).slice(0, 8) : '';
      const err = entry.lastError ? ' · Error: ' + entry.lastError : '';
      const details = [metadata.version, metadata.description, metadata.expires]
        .filter(Boolean).join(' · ');
      meta.textContent = status + ' · ' + time + hash + err + (details ? ' · ' + details : '');
      row.append(label, meta);

      const actions = document.createElement('div');
      actions.className = 'list-actions';
      actions.append(
        actionButton(entry.enabled ? 'Disable' : 'Enable',
          () => listAction('set-list-enabled', entry.url, !entry.enabled)),
        actionButton(entry.text ? 'Update' : 'Fetch', () => listAction('update-list', entry.url))
      );
      if (!entry.builtin) {
        actions.append(
          actionButton(entry.autoUpdate ? 'Auto: on' : 'Auto: off',
            () => listAction('set-list-auto', entry.url, !entry.autoUpdate)),
          actionButton('Remove', () => listAction('remove-list', entry.url))
        );
      }
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

  function renderCname() {
    cnameUncloak.checked = state.cnameUncloak !== false;
  }

  function setCspReportStatus(message) {
    cspReportStatus.textContent = message;
    setTimeout(() => {
      if (cspReportStatus.textContent === message) cspReportStatus.textContent = '';
    }, 4000);
  }

  function render() {
    if (!filtersInitialized) {
      editor.resetView(state.customFilters || '');
      filtersInitialized = true;
    }
    statsText.textContent = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked since tracking began.';
    renderSites();
    renderSiteRules();
    renderLists();
    renderSuggested();
    renderCspReports();
    renderCname();
  }

  document.getElementById('save').addEventListener('click', saveFilters);

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

  cnameUncloak.addEventListener('change', async () => {
    state = await client.send('set-cname-uncloak', { value: cnameUncloak.checked });
    renderCname();
  });

  cspReportForm.addEventListener('submit', async event => {
    event.preventDefault();
    state = await client.send('set-csp-report-allow', { value: cspReportAllow.value });
    renderCspReports();
    setCspReportStatus('Allowed endpoints saved.');
  });

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
    client.send('suggested-lists')
  ])
    .then(results => {
      state = results[0].state;
      lists = Array.isArray(results[1].lists) ? results[1].lists : [];
      suggested = Array.isArray(results[2].suggested) ? results[2].suggested : [];
      render();
    })
    .catch(error => {
      statsText.textContent = 'Could not load options: ' + error.message;
    });
})();

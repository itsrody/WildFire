(function () {
  'use strict';

  const client = WildFireWapiClient.create();
  const builtinCatalog = typeof WildFireBundledLists !== 'undefined'
    ? WildFireBundledLists : null;
  const filters = document.getElementById('filters');
  const filterStatus = document.getElementById('filter-status');
  const sitesList = document.getElementById('sites');
  const siteRulesList = document.getElementById('site-rules');
  const myRules = document.getElementById('my-rules');
  const myRulesIssues = document.getElementById('my-rules-issues');
  const myRulesStatus = document.getElementById('my-rules-status');
  const siteForm = document.getElementById('site-form');
  const siteInput = document.getElementById('site-input');
  const suggestedList = document.getElementById('suggested-lists');
  const listsList = document.getElementById('remote-lists');
  const assetRegistry = document.getElementById('asset-registry');
  const assetViewer = document.getElementById('asset-viewer');
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
  let groups = [];
  let registries = [];
  let filtersInitialized = false;
  let myRulesInitialized = false;

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

  function setMyRulesStatus(message) {
    myRulesStatus.textContent = message || '';
    if (message) {
      setTimeout(() => {
        if (myRulesStatus.textContent === message) myRulesStatus.textContent = '';
      }, 5000);
    }
  }

  function myRulesPayload() {
    return state && (state.myRules || state.dynamic) || null;
  }

  function myRulesText(payload) {
    if (payload && typeof payload.text === 'string') return payload.text;
    if (!payload || !Array.isArray(payload.rules)) return '';
    return payload.rules.map(rule =>
      [rule.source, rule.destination, rule.type, rule.action].join(' ')).join('\n');
  }

  function showMyRulesIssues(issues) {
    myRulesIssues.textContent = '';
    const list = Array.isArray(issues) ? issues : [];
    myRulesIssues.hidden = !list.length;
    list.forEach(issue => {
      const item = document.createElement('div');
      item.textContent = 'Line ' + issue.line + ': ' + (issue.reason || 'Invalid rule.');
      myRulesIssues.appendChild(item);
    });
  }

  function renderMyRules() {
    const payload = myRulesPayload();
    if (!myRulesInitialized) {
      myRules.value = myRulesText(payload);
      myRulesInitialized = true;
    }
    const rules = payload && Array.isArray(payload.rules) ? payload.rules : [];
    siteRulesList.textContent = '';
    if (!rules.length) {
      const item = document.createElement('li');
      item.className = 'empty';
      item.textContent = 'No dynamic site rules.';
      siteRulesList.appendChild(item);
      return;
    }
    rules.forEach(rule => {
      const item = document.createElement('li');
      item.className = 'list-item';
      const row = document.createElement('div');
      row.className = 'list-row';
      const label = document.createElement('span');
      label.className = 'list-label';
      label.textContent = [rule.source, rule.destination, rule.type, rule.action].join(' ');
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = rule.temporary ? 'temporary' : 'persistent';
      row.append(label, meta);
      item.appendChild(row);
      siteRulesList.appendChild(item);
    });
  }

  async function saveMyRules() {
    try {
      const result = await client.send('set-my-rules', { value: myRules.value });
      state = result.state;
      state.myRules = result.myRules;
      showMyRulesIssues(result.issues);
      setMyRulesStatus(result.ok ? 'Rules saved.' : 'Fix the listed lines and try again.');
      if (result.ok) renderMyRules();
    } catch (error) {
      setMyRulesStatus('Save failed: ' + error.message);
    }
  }

  async function updateDynamicRules(action, message, success) {
    try {
      const result = await client.send(action, message);
      state = result.state;
      state.myRules = result.myRules;
      myRules.value = myRulesText(result.myRules);
      renderMyRules();
      setMyRulesStatus(success);
    } catch (error) {
      setMyRulesStatus('Action failed: ' + error.message);
    }
  }

  function renderSuggested() {
    suggestedList.textContent = '';
    groups.forEach(group => {
      const heading = document.createElement('li');
      heading.className = 'list-group';
      heading.textContent = group.name;
      suggestedList.appendChild(heading);
      suggested.filter(entry => entry.group === group.id).forEach(entry => {
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
    });
    suggested.filter(entry => !groups.some(group => group.id === entry.group))
      .forEach(entry => {
        const item = document.createElement('li');
        item.className = 'list-item';
        item.textContent = entry.name + ' — ' + entry.description;
        suggestedList.appendChild(item);
      });
  }

  function renderRegistries() {
    const previous = assetRegistry.value;
    assetRegistry.textContent = '';
    registries.forEach(registry => {
      const option = document.createElement('option');
      option.value = registry.id;
      option.textContent = registry.name;
      assetRegistry.appendChild(option);
    });
    if (previous && registries.some(registry => registry.id === previous)) {
      assetRegistry.value = previous;
    }
    renderAssetViewer();
  }

  function renderAssetViewer() {
    const registry = registries.find(entry => entry.id === assetRegistry.value) || registries[0];
    if (!registry) {
      assetViewer.textContent = 'No curated registry is available.';
      return;
    }
    assetViewer.textContent = registry.entries.map(entry => {
      const fields = Object.keys(entry)
        .filter(key => key !== 'alias' && entry[key] !== '')
        .map(key => key + ': ' + String(entry[key]));
      return entry.alias + (fields.length ? ' — ' + fields.join(' · ') : '');
    }).join('\n') || 'No aliases are registered.';
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
      const catalog = entry.builtin && builtinCatalog
        ? builtinCatalog.find(entry.url)
        : suggested.find(item => item.url === entry.url);
      const label = document.createElement('span');
      label.className = 'list-url';
      label.textContent = catalog && catalog.name ? catalog.name : entry.url;
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      const when = entry.checkedAt || entry.updatedAt;
      const status = !entry.text ? 'Not fetched'
        : (entry.enabled ? 'Active' : 'Disabled') + (entry.builtin ? ' · built-in' : '');
      const time = when ? new Date(when).toLocaleString() : 'never';
      const hash = entry.hash ? ' · ' + String(entry.hash).slice(0, 8) : '';
      const err = entry.lastError ? ' · Error: ' + entry.lastError : '';
      const history = Array.isArray(entry.history) ? entry.history : [];
      const latest = history[history.length - 1];
      const update = latest ? ' · Last change: ' + latest.action +
        (latest.error ? ' failed (' + latest.error + ')' : (latest.changed ? ' applied' : ' checked')) : '';
      const details = [catalog && catalog.description, metadata.version, metadata.expires]
        .filter(Boolean).join(' · ');
      meta.textContent = status + ' · ' + time + hash + err + update +
        (details ? ' · ' + details : '');
      row.append(label, meta);

      const actions = document.createElement('div');
      actions.className = 'list-actions';
      actions.append(
        actionButton(entry.enabled ? 'Disable' : 'Enable',
          () => listAction('set-list-enabled', entry.url, !entry.enabled)),
        actionButton(entry.text ? 'Update' : 'Fetch', () => listAction('update-list', entry.url)),
        actionButton(entry.autoUpdate ? 'Auto: on' : 'Auto: off',
          () => listAction('set-list-auto', entry.url, !entry.autoUpdate))
      );
      if (!entry.builtin) {
        actions.append(actionButton('Remove', () => listAction('remove-list', entry.url)));
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
    renderMyRules();
    renderLists();
    renderSuggested();
    renderRegistries();
    renderCspReports();
    renderCname();
  }

  document.getElementById('save').addEventListener('click', saveFilters);
  document.getElementById('save-my-rules').addEventListener('click', saveMyRules);
  document.getElementById('persist-dynamic-rules').addEventListener('click', () =>
    updateDynamicRules('persist-dynamic-rules', {}, 'Temporary rules persisted.'));
  document.getElementById('clear-temporary-rules').addEventListener('click', () =>
    updateDynamicRules('clear-dynamic-rules', { scope: 'temporary' },
      'Temporary rules cleared.'));

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

  assetRegistry.addEventListener('change', renderAssetViewer);

  document.getElementById('reset').addEventListener('click', async () => {
    state = await client.send('reset-stats');
    render();
  });

  Promise.all([
    client.send('state'),
    client.send('list-state'),
    client.send('suggested-lists'),
    client.send('asset-registries')
  ])
    .then(results => {
      state = results[0].state;
      state.myRules = results[0].myRules;
      lists = Array.isArray(results[1].lists) ? results[1].lists : [];
      suggested = Array.isArray(results[2].suggested) ? results[2].suggested : [];
      groups = Array.isArray(results[2].groups) ? results[2].groups : [];
      registries = Array.isArray(results[3].registries) ? results[3].registries : [];
      render();
    })
    .catch(error => {
      statsText.textContent = 'Could not load options: ' + error.message;
    });
})();

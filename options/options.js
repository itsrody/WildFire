(function () {
  'use strict';

  const filters = document.getElementById('filters');
  const filterStatus = document.getElementById('filter-status');
  const sitesList = document.getElementById('sites');
  const siteForm = document.getElementById('site-form');
  const siteInput = document.getElementById('site-input');
  const listsList = document.getElementById('remote-lists');
  const listForm = document.getElementById('list-form');
  const listInput = document.getElementById('list-url');
  const listStatus = document.getElementById('list-status');
  const statsText = document.getElementById('stats-text');

  let state = null;
  let lists = [];

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
        state = await browser.runtime.sendMessage({ type: 'wildfire:toggle-site', host: site });
        renderSites();
      });
      item.append(label, remove);
      sitesList.appendChild(item);
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
      meta.textContent = !entry.text ? 'Not fetched'
        : (entry.enabled ? 'Active' : 'Fetched') + ' · ' +
          new Date(entry.updatedAt).toLocaleString() + ' · ' + String(entry.hash || '').slice(0, 8);
      row.append(label, meta);

      const actions = document.createElement('div');
      actions.className = 'list-actions';
      actions.append(
        actionButton(entry.text ? 'Update' : 'Fetch', () => listAction('wildfire:update-list', entry.url)),
        actionButton(entry.enabled ? 'Disable' : 'Enable',
          () => listAction('wildfire:set-list-enabled', entry.url, !entry.enabled)),
        actionButton(entry.autoUpdate ? 'Auto: on' : 'Auto: off',
          () => listAction('wildfire:set-list-auto', entry.url, !entry.autoUpdate)),
        actionButton('Remove', () => listAction('wildfire:remove-list', entry.url))
      );
      item.append(row, actions);
      listsList.appendChild(item);
    });
  }

  async function listAction(type, url, value) {
    const message = { type, url };
    if (value !== undefined) message.value = value;
    const result = await browser.runtime.sendMessage(message);
    if (Array.isArray(result.lists)) lists = result.lists;
    if (result.state) state = result.state;
    setListStatus(result.ok === false ? (result.error || 'Action failed.') : 'Saved.');
    renderLists();
    return result;
  }

  function render() {
    filters.value = state.customFilters || '';
    statsText.textContent = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked since tracking began.';
    renderSites();
    renderLists();
  }

  document.getElementById('save').addEventListener('click', async () => {
    const result = await browser.runtime.sendMessage({
      type: 'wildfire:set-filters',
      value: filters.value
    });
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
    state = await browser.runtime.sendMessage({ type: 'wildfire:toggle-site', host });
    siteInput.value = '';
    renderSites();
  });

  listForm.addEventListener('submit', async event => {
    event.preventDefault();
    const url = listInput.value.trim();
    if (!url) return;
    await listAction('wildfire:add-list', url);
    listInput.value = '';
  });

  document.getElementById('reset').addEventListener('click', async () => {
    state = await browser.runtime.sendMessage({ type: 'wildfire:reset-stats' });
    render();
  });

  Promise.all([
    browser.runtime.sendMessage({ type: 'wildfire:state' }),
    browser.runtime.sendMessage({ type: 'wildfire:list-state' })
  ])
    .then(results => {
      state = results[0].state;
      lists = Array.isArray(results[1].lists) ? results[1].lists : [];
      render();
    })
    .catch(error => {
      statsText.textContent = 'Could not load options: ' + error.message;
    });
})();

(function () {
  'use strict';

  const filters = document.getElementById('filters');
  const filterStatus = document.getElementById('filter-status');
  const sitesList = document.getElementById('sites');
  const siteForm = document.getElementById('site-form');
  const siteInput = document.getElementById('site-input');
  const statsText = document.getElementById('stats-text');

  let state = null;

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

  function render() {
    filters.value = state.customFilters || '';
    statsText.textContent = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked since tracking began.';
    renderSites();
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

  document.getElementById('reset').addEventListener('click', async () => {
    state = await browser.runtime.sendMessage({ type: 'wildfire:reset-stats' });
    render();
  });

  browser.runtime.sendMessage({ type: 'wildfire:state' })
    .then(result => {
      state = result.state;
      render();
    })
    .catch(error => {
      statsText.textContent = 'Could not load options: ' + error.message;
    });
})();

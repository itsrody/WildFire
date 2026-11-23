(function () {
  'use strict';

  const elements = {
    status: document.getElementById('status'),
    count: document.getElementById('count'),
    countLabel: document.getElementById('count-label'),
    network: document.getElementById('network-count'),
    cosmetic: document.getElementById('cosmetic-count'),
    exceptions: document.getElementById('exception-count'),
    toggle: document.getElementById('toggle'),
    site: document.getElementById('site'),
    reload: document.getElementById('reload'),
    options: document.getElementById('options')
  };

  let current = null;
  let site = { url: '', host: '', disabled: false };

  function applyResult(result) {
    current = Object.assign({}, result, { site: result.site || site });
    render();
  }

  async function refresh() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tabs.length && tabs[0].url ? tabs[0].url : '';
    const result = await browser.runtime.sendMessage({ type: 'wildfire:state', url });
    site = result.site || site;
    applyResult(result);
  }

  function render() {
    if (!current) return;
    const { state, counts, site } = current;
    const pausedHere = Boolean(site && site.host && site.disabled);

    const siteCount = Number(site && site.blocked || 0);
    elements.count.textContent = siteCount.toLocaleString();
    elements.count.title = Number(state.blocked || 0).toLocaleString() +
      ' requests blocked in total';
    elements.countLabel.textContent = site && site.host
      ? 'requests blocked on ' + site.host
      : 'requests blocked on this site';
    elements.network.textContent = counts.network.toLocaleString();
    elements.cosmetic.textContent = counts.cosmetic.toLocaleString();
    elements.exceptions.textContent = counts.exceptions.toLocaleString();

    elements.toggle.textContent = state.enabled ? 'Pause blocking' : 'Resume blocking';
    elements.site.textContent = pausedHere ? 'Resume on this site' : 'Pause on this site';
    elements.site.disabled = !state.enabled || !site.host;

    if (!state.enabled) elements.status.textContent = 'Paused globally';
    else if (pausedHere) elements.status.textContent = 'Paused on ' + site.host;
    else elements.status.textContent = site.host ? 'Blocking on ' + site.host : 'Blocking enabled';
  }

  elements.toggle.addEventListener('click', async () => {
    applyResult(await browser.runtime.sendMessage({ type: 'wildfire:toggle' }));
  });

  elements.site.addEventListener('click', async () => {
    const result = await browser.runtime.sendMessage({
      type: 'wildfire:toggle-site',
      host: site.host
    });
    site = Object.assign({}, site, { disabled: !site.disabled });
    applyResult(result);
  });

  elements.reload.addEventListener('click', async () => {
    applyResult(await browser.runtime.sendMessage({ type: 'wildfire:reload' }));
    elements.reload.textContent = 'Reloaded ✓';
    setTimeout(() => { elements.reload.textContent = 'Reload filters'; }, 1200);
  });

  elements.options.addEventListener('click', () => browser.runtime.openOptionsPage());

  refresh().catch(error => {
    elements.status.textContent = 'Could not load WildFire state';
    console.error('WildFire popup:', error);
  });
})();

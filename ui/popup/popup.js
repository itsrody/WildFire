(function () {
  'use strict';

  const client = WildFireWapiClient.create();
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
    options: document.getElementById('options'),
    inspector: document.getElementById('inspector'),
    inspectToggle: document.getElementById('inspect-toggle')
  };

  let current = null;
  let site = { url: '', host: '', disabled: false };
  let inspecting = false;

  function applyResult(result) {
    current = Object.assign({}, result, { site: result.site || site });
    render();
  }

  async function refresh() {
    const tabs = await client.tabs.query({ active: true, currentWindow: true });
    const url = tabs.length && tabs[0].url ? tabs[0].url : '';
    const [result, inspection] = await Promise.all([
      client.send('state', { url }),
      client.send('inspect').catch(() => null)
    ]);
    inspecting = Boolean(inspection && inspection.inspect && inspection.inspect.enabled);
    site = result.site || site;
    applyResult(result);
  }

  client.connect('state', message => {
    if (message && message.state && message.counts) applyResult(message);
  });

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
    elements.inspectToggle.textContent = inspecting ? 'Recording: on' : 'Recording: off';
    elements.inspectToggle.classList.toggle('active', inspecting);

    if (!state.enabled) elements.status.textContent = 'Paused globally';
    else if (pausedHere) elements.status.textContent = 'Paused on ' + site.host;
    else elements.status.textContent = site.host ? 'Blocking on ' + site.host : 'Blocking enabled';
  }

  elements.toggle.addEventListener('click', async () => {
    applyResult(await client.send('toggle'));
  });

  elements.site.addEventListener('click', async () => {
    const result = await client.send('toggle-site', { host: site.host });
    site = Object.assign({}, site, { disabled: !site.disabled });
    applyResult(result);
  });

  elements.reload.addEventListener('click', async () => {
    applyResult(await client.send('reload'));
    elements.reload.textContent = 'Reloaded ✓';
    setTimeout(() => { elements.reload.textContent = 'Reload filters'; }, 1200);
  });

  elements.options.addEventListener('click', () => client.openOptions());

  elements.inspector.addEventListener('click', () => {
    client.openWindow('ui/inspector/inspector.html').catch(error => {
      elements.status.textContent = 'Could not open WildFire Inspector';
      console.error('WildFire inspector:', error);
    });
  });

  elements.inspectToggle.addEventListener('click', async () => {
    const result = await client.send('inspect', { value: !inspecting });
    inspecting = Boolean(result && result.inspect && result.inspect.enabled);
    render();
  });

  refresh().catch(error => {
    elements.status.textContent = 'Could not load WildFire state';
    console.error('WildFire popup:', error);
  });
})();

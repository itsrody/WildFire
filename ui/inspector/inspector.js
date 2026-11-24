/* WildFire - Inspector window wiring. Rendering lives in logger-ui.js. */
(function (global) {
  'use strict';

  const client = global.WildFireWapiClient.create();
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
  const ui = global.WildFireInspectorUI.create({ document: global.document, elements });
  const REFRESH_MS = 1000;
  let pollTimer = null;
  let closed = false;

  function scheduleRefresh() {
    const snapshot = ui.snapshot();
    if (pollTimer || closed || ui.isFrozen() || !(snapshot && snapshot.enabled)) return;
    pollTimer = global.setTimeout(() => {
      pollTimer = null;
      if (closed || ui.isFrozen()) return;
      action({}, '').catch(error => {
        ui.setStatus('Could not refresh WildFire Inspector: ' + error.message);
      });
    }, REFRESH_MS);
  }

  async function action(payload, message) {
    const result = await client.send('inspect', payload || {});
    ui.setSnapshot(result.inspect);
    ui.setStatus(message || '');
    scheduleRefresh();
    return result;
  }

  elements.enabled.addEventListener('change', () => {
    if (ui.isFrozen()) ui.setFrozen(false);
    action({ value: elements.enabled.checked },
      elements.enabled.checked ? 'Recording on.' : 'Recording off.');
  });
  elements.decision.addEventListener('change', () =>
    ui.updateFilter('decision', elements.decision.value));
  elements.phase.addEventListener('change', () =>
    ui.updateFilter('phase', elements.phase.value));
  elements.type.addEventListener('input', () => ui.updateFilter('type', elements.type.value));
  elements.site.addEventListener('input', () => ui.updateFilter('site', elements.site.value));
  elements.query.addEventListener('input', () => ui.updateFilter('query', elements.query.value));
  elements.rulesOnly.addEventListener('change', () =>
    ui.updateFilter('rulesOnly', elements.rulesOnly.checked));
  elements.refresh.addEventListener('click', () => action({}, 'Refreshed.'));
  elements.freeze.addEventListener('click', () => {
    const frozen = ui.setFrozen(!ui.isFrozen());
    if (pollTimer) {
      global.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (!frozen) action({}, 'View unfrozen.');
  });
  elements.clear.addEventListener('click', () => {
    ui.setFrozen(false);
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

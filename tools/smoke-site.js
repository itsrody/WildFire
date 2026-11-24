/* Real-site performance smoke for WildFire in Firefox.
 *
 * Builds a temporary WildFire copy with local instrumentation, opens a real
 * URL through web-ext, and reports navigation timing, resource counts, engine
 * counts, remote-list state, diagnostic phase totals, cosmetic apply timing,
 * and per-request Inspector durations from the loaded page.
 *
 * Usage:
 *   node tools/smoke-site.js [--url https://www.youtube.com]
 *                            [--firefox /path/to/firefox] [--headless]
 *                            [--run-ms 6000] [--list-wait-ms 60000]
 *                            [--timeout 180000] [--out file] [--keep]
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const PRESHIPPED_URL = 'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt';

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const siteUrl = argValue('--url', 'https://www.youtube.com');
const firefoxBinary = argValue('--firefox', '');
const keep = args.includes('--keep');
const headed = args.includes('--headed') || !args.includes('--headless');
const runMs = Math.max(0, Number(argValue('--run-ms', '6000')) || 6000);
const listWaitMs = Math.max(0, Number(argValue('--list-wait-ms', '60000')) || 60000);
const timeoutMs = Math.max(30000, Number(argValue('--timeout', '180000')) || 180000);
const outFile = argValue('--out', '');

function die(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'dist', 'node_modules', 'web-ext-artifacts'].includes(entry.name)) return;
      copyDir(source, target);
      return;
    }
    if (entry.isFile()) fs.copyFileSync(source, target);
  });
}

function replaceOnce(file, needle, replacement, label) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(needle)) die('Could not patch ' + label);
  fs.writeFileSync(file, source.replace(needle, replacement));
}

function instrumentBackground(extDir) {
  const background = path.join(extDir, 'lib', 'background', 'background.js');
  replaceOnce(background,
    '        await ctx.loadFilters();\n',
    `        const smokeLoadStarted = performance.now();
        await ctx.loadFilters();
        ctx.smokeStartupLoad = {
          ms: Number((performance.now() - smokeLoadStarted).toFixed(3)),
          counts: Object.assign({}, ctx.engine.counts),
          compiler: Object.assign({}, ctx.compilerStatus)
        };
`,
    'background filter load timing');
  replaceOnce(background,
    '    ctx.diagnostics.phases = ctx.emptyPhaseStats();\n',
    `    ctx.diagnostics.phases = ctx.emptyPhaseStats();
    ctx.diagnostics.enabled = true;
    ctx.loggerEnabled = true;
    if (ctx.engine.setMatchStatsEnabled) ctx.engine.setMatchStatsEnabled(true);
`,
    'early diagnostics and inspection');

  const messages = path.join(extDir, 'lib', 'background', 'messages.js');
  replaceOnce(messages,
    '    router.registerAll({\n',
    `    router.registerAll({
      'smoke-state': () => ({
        capabilities: ctx.wapiCapabilities.snapshot(),
        startupLoad: ctx.smokeStartupLoad || null
      }),
      'smoke-report': message => {
        try {
          fetch(String(message.endpoint || ''), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message.report || {})
          }).catch(() => {});
        } catch (error) { /* the local report sink is best effort */ }
        return { ok: true };
      },
`,
    'smoke message handlers');
}

function instrumentCosmetic(extDir) {
  const file = path.join(extDir, 'content', 'cosmetic.js');
  replaceOnce(file,
    '  function apply(selectors, procedural) {\n    const safe =',
    '  function apply(selectors, procedural) {\n    const started = performance.now();\n    const safe =',
    'cosmetic apply start');
  replaceOnce(file,
    '    proceduralRules = Array.isArray(procedural) ? procedural : [];\n    applyProcedural(proceduralRules);\n  }',
    `    proceduralRules = Array.isArray(procedural) ? procedural : [];
    applyProcedural(proceduralRules);
    if (document.documentElement) {
      document.documentElement.setAttribute('data-wf-perf-cosmetic',
        String(Number((performance.now() - started).toFixed(3))));
      document.documentElement.setAttribute('data-wf-perf-cosmetic-count', String(safe.length));
      document.documentElement.setAttribute('data-wf-perf-procedural-count',
        String(proceduralRules.length));
    }
  }`,
    'cosmetic apply timing');
}

function instrumentScriptlets(extDir) {
  const file = path.join(extDir, 'lib', 'resources', 'scriptlets', 'api.js');
  replaceOnce(file,
    '  function apply(entries) {\n    const list = Array.isArray(entries) ? entries : [];',
    '  function apply(entries) {\n    const started = performance.now();\n    const list = Array.isArray(entries) ? entries : [];',
    'scriptlet apply start');
  replaceOnce(file,
    '    active.forEach(run);\n  }',
    `    active.forEach(run);
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-wf-perf-scriptlet',
        String(Number((performance.now() - started).toFixed(3))));
      global.document.documentElement.setAttribute('data-wf-perf-scriptlet-count',
        String(active.length));
    }
  }`,
    'scriptlet apply timing');
}

function siteScript(endpoint) {
  return `(function () {
  'use strict';
  if (window.__wildFireSiteSmoke) return;
  window.__wildFireSiteSmoke = true;

  var ENDPOINT = ${JSON.stringify(endpoint)};
  var LIST_URL = ${JSON.stringify(PRESHIPPED_URL)};
  var RUN_MS = ${Number(runMs)};
  var LIST_WAIT_MS = ${Number(listWaitMs)};

  function ask(type, payload) {
    var message = Object.assign({}, payload || {}, { type: 'wildfire:' + type });
    return browser.runtime.sendMessage(message);
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function askWithTimeout(type, payload, ms) {
    return Promise.race([
      ask(type, payload),
      wait(ms).then(function () { return { __timeout: true }; })
    ]);
  }

  function sendReport(report) {
    return askWithTimeout('smoke-report', { endpoint: ENDPOINT, report: report }, 5000)
      .catch(function () {});
  }

  function attr(name) {
    return document.documentElement ? document.documentElement.getAttribute(name) || '' : '';
  }

  function listReady(snapshot) {
    var lists = snapshot && Array.isArray(snapshot.lists) ? snapshot.lists : [];
    return lists.some(function (entry) { return entry.url === LIST_URL && Boolean(entry.text); });
  }

  function waitForList() {
    var deadline = Date.now() + LIST_WAIT_MS;
    return (function poll() {
      return askWithTimeout('list-state', {}, 10000).then(function (snapshot) {
        if (snapshot && snapshot.__timeout) {
          if (Date.now() >= deadline) return null;
          return wait(1000).then(poll);
        }
        if (listReady(snapshot) || Date.now() >= deadline) return snapshot;
        return wait(1000).then(poll);
      }).catch(function () { return null; });
    })();
  }

  function delta(end, start) {
    return end && start && end >= start ? end - start : null;
  }

  function navigationTiming() {
    var timing = performance.timing;
    if (!timing || !timing.navigationStart) return {};
    return {
      redirectMs: delta(timing.redirectEnd, timing.redirectStart),
      dnsMs: delta(timing.domainLookupEnd, timing.domainLookupStart),
      connectMs: delta(timing.connectEnd, timing.connectStart),
      responseMs: delta(timing.responseEnd, timing.responseStart),
      domInteractiveMs: delta(timing.domInteractive, timing.navigationStart),
      domContentLoadedMs: delta(timing.domContentLoadedEventEnd, timing.navigationStart),
      loadMs: delta(timing.loadEventEnd, timing.navigationStart)
    };
  }

  function resourceStats() {
    var entries = performance.getEntriesByType('resource');
    var byType = entries.reduce(function (result, entry) {
      var type = entry.initiatorType || 'other';
      result[type] = (result[type] || 0) + 1;
      return result;
    }, {});
    return {
      count: entries.length,
      byType: byType,
      transferSize: entries.reduce(function (sum, entry) {
        return sum + (Number(entry.transferSize) || 0);
      }, 0),
      durationMs: Number(entries.reduce(function (sum, entry) {
        return sum + (Number(entry.duration) || 0);
      }, 0).toFixed(3))
    };
  }

  function listSummary(snapshot) {
    var lists = snapshot && Array.isArray(snapshot.lists) ? snapshot.lists : [];
    return lists.map(function (entry) {
      return {
        url: entry.url,
        builtin: Boolean(entry.builtin),
        enabled: entry.enabled !== false,
        textLength: String(entry.text || '').length,
        updatedAt: Number(entry.updatedAt) || 0,
        checkedAt: Number(entry.checkedAt) || 0,
        lastError: entry.lastError || '',
        title: entry.metadata && entry.metadata.title ? entry.metadata.title : ''
      };
    });
  }

  async function collect() {
    try {
      var listSnapshot = await waitForList();
      var state = await askWithTimeout('state', {}, 15000);
      var smokeState = await askWithTimeout('smoke-state', {}, 15000);
      var diagnostics = await askWithTimeout('diagnostics', {}, 15000);
      var inspection = await askWithTimeout('inspect', {}, 15000);
      var report = {
        url: location.href,
        host: location.hostname,
        title: document.title,
        userAgent: navigator.userAgent,
        measuredAt: Date.now(),
        navigation: navigationTiming(),
        resources: resourceStats(),
        dom: {
          readyState: document.readyState,
          nodes: document.querySelectorAll('*').length
        },
        wildfire: {
          enabled: state.state.enabled,
          blocked: state.state.blocked,
          blockedBySite: state.state.blockedBySite,
          site: state.site,
          counts: state.counts,
          compiler: state.compiler,
          startupLoad: smokeState.startupLoad,
          capabilities: smokeState.capabilities,
          lists: listSummary(listSnapshot)
        },
        diagnostics: diagnostics.diagnostics,
        inspect: inspection.inspect,
        cosmetic: {
          applyMs: Number(attr('data-wf-perf-cosmetic') || 0),
          selectors: Number(attr('data-wf-perf-cosmetic-count') || 0),
          procedural: Number(attr('data-wf-perf-procedural-count') || 0),
          hiddenNodes: document.querySelectorAll('[data-wildfire-hidden]').length,
          styleLength: (document.getElementById('wildfire-cosmetic') || {}).textContent
            ? document.getElementById('wildfire-cosmetic').textContent.length : 0
        },
        scriptlet: {
          applyMs: Number(attr('data-wf-perf-scriptlet') || 0),
          applied: Number(attr('data-wf-perf-scriptlet-count') || 0)
        }
      };
      await ask('smoke-report', { endpoint: ENDPOINT, report: report });
    } catch (error) {
      await ask('smoke-report', {
        endpoint: ENDPOINT,
        report: { url: location.href, error: String(error && error.message || error) }
      }).catch(function () {});
    }
  }

  function schedule() { setTimeout(collect, RUN_MS); }
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);
})();
`;
}

function prepareExtension(extDir, endpoint) {
  copyDir(ROOT, extDir);
  instrumentBackground(extDir);
  instrumentCosmetic(extDir);
  instrumentScriptlets(extDir);
  writeFile(path.join(extDir, 'perf-site.js'), siteScript(endpoint));
  const manifestFile = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.content_scripts.unshift({
    matches: ['<all_urls>'],
    js: ['perf-site.js'],
    run_at: 'document_idle',
    all_frames: false
  });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

function startServer(reports) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'POST' || url.pathname !== '/report') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          reports.push(JSON.parse(body));
          res.writeHead(204);
        } catch (error) {
          res.writeHead(400);
        }
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function waitForReport(reports, limit) {
  const started = Date.now();
  return (function poll() {
    const full = reports.find(report => report && report.wildfire);
    if (full) return Promise.resolve(full);
    if (Date.now() - started > limit) {
      return Promise.resolve(reports.length ? reports[reports.length - 1] : null);
    }
    return sleep(500).then(poll);
  })();
}

function stopProcess(proc) {
  if (!proc || proc.killed) return Promise.resolve();
  return new Promise(resolve => {
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
      resolve();
    }, 4000);
  });
}

function runWebExt(extDir, url, logFile) {
  const params = [
    'run', '--source-dir', extDir, '--no-input', '--no-reload', '--verbose', '--start-url', url
  ];
  if (!headed) params.push('--args=-headless', '--args=--disable-gpu');
  if (firefoxBinary) params.push('--firefox', firefoxBinary);
  const proc = spawn('web-ext', params, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(logFile);
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);
  return proc;
}

function summarize(report, meta) {
  if (!report) return Object.assign({ ok: false, error: 'no report received' }, meta);
  if (report.error) return Object.assign({ ok: false, error: report.error, url: report.url }, meta);
  const phases = report.diagnostics && report.diagnostics.phases
    ? report.diagnostics.phases : {};
  const activePhases = Object.keys(phases).reduce((result, name) => {
    if (phases[name] && phases[name].calls) result[name] = phases[name];
    return result;
  }, {});
  const entries = report.inspect && Array.isArray(report.inspect.entries)
    ? report.inspect.entries : [];
  const ok = report.wildfire && report.wildfire.enabled !== false &&
    Boolean(report.navigation && typeof report.navigation.loadMs === 'number');
  return Object.assign({
    ok,
    stage: report.stage || '',
    url: report.url,
    host: report.host,
    title: report.title,
    navigation: report.navigation,
    resources: report.resources,
    dom: report.dom,
    wildfire: report.wildfire,
    phases: activePhases,
    inspectCount: entries.length,
    cosmetic: report.cosmetic,
    scriptlet: report.scriptlet
  }, meta);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildfire-site-smoke-'));
  const extDir = path.join(tmpDir, 'extension');
  const reports = [];

  const server = await startServer(reports);
  let output = null;
  try {
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/report';
    prepareExtension(extDir, endpoint);
    const logFile = path.join(tmpDir, 'web-ext.log');
    const proc = runWebExt(extDir, siteUrl, logFile);
    const report = await waitForReport(reports, timeoutMs);
    await stopProcess(proc);
    output = summarize(report, {
      siteUrl,
      firefox: firefoxBinary || 'default',
      stages: reports.map(item => item && (item.stage || 'full') || 'unknown'),
      logFile,
      tmpDir
    });
    console.log(JSON.stringify(output, null, 2));
    if (outFile) writeFile(outFile, JSON.stringify(output, null, 2) + '\n');
    if (!output.ok) process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!keep) fs.rmSync(tmpDir, { recursive: true, force: true });
    else console.error('Kept site-smoke artifacts at ' + tmpDir);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

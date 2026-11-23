/* Real-Firefox smoke probe for scriptlet world behavior.
 *
 * Runs two temporary WildFire copies against a local smoke page:
 *  - baseline: current browser.contentScripts.register() (isolated world)
 *  - main: same registration with world: 'MAIN'
 *
 * Reports whether the first inline page script sees a set-constant value,
 * and whether WildFire globals leak into the page.
 *
 * Usage: node tools/smoke.js [--firefox /path/to/firefox] [--keep]
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const firefoxArgIndex = args.indexOf('--firefox');
const firefoxBinary = firefoxArgIndex >= 0 ? args[firefoxArgIndex + 1] : '';

function die(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'dist', 'node_modules', 'web-ext-artifacts'].includes(entry.name)) return;
      copyDir(s, d);
      return;
    }
    if (entry.isFile()) fs.copyFileSync(s, d);
  });
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function patchMainWorld(extDir) {
  const file = path.join(extDir, 'background.js');
  const source = fs.readFileSync(file, 'utf8');
  const needle = "        runAt: 'document_start',\n        allFrames: true";
  const replacement = "        runAt: 'document_start',\n        world: 'MAIN',\n        allFrames: true";
  if (!source.includes(needle)) die('Could not patch background.js for MAIN world smoke');
  fs.writeFileSync(file, source.replace(needle, replacement));
}

function addSmokeRules(extDir) {
  const file = path.join(extDir, 'filters', 'default.txt');
  const rules = '\n! --- WildFire smoke probe ---\nlocalhost##+js(set-constant, wildFireSmokeValue, false)\nlocalhost###wf-cosmetic-proof\n';
  fs.appendFileSync(file, rules);
}

function addMarkers(extDir) {
  const cosmetic = path.join(extDir, 'content', 'cosmetic.js');
  const cosmeticSource = fs.readFileSync(cosmetic, 'utf8');
  fs.writeFileSync(cosmetic, cosmeticSource.replace(
    'window.__wildFireCosmeticReady = true;',
    "window.__wildFireCosmeticReady = true;\n  document.documentElement.setAttribute('data-wf-content', 'yes');"
  ));
  const scriptlets = path.join(extDir, 'lib', 'scriptlets.js');
  const scriptletsSource = fs.readFileSync(scriptlets, 'utf8');
  fs.writeFileSync(scriptlets, scriptletsSource.replace(
    "'use strict';\n\n  const MAX_PROPERTY_LENGTH = 120;",
    "'use strict';\n\n  try {\n    if (global.document && global.document.documentElement) {\n      global.document.documentElement.setAttribute('data-wf-scriptlets', 'yes');\n    }\n  } catch (error) {}\n\n  const MAX_PROPERTY_LENGTH = 120;"
  ));
}

function smokeHtml() {
  return `<!doctype html>
<script>
  (function () {
    var read = function (fn) {
      try { return fn(); } catch (error) { return 'throw:' + error.message; }
    };
    var descriptor = read(function () {
      return Object.getOwnPropertyDescriptor(window, 'wildFireSmokeValue') || null;
    });
    window.__wfEarlyResult = {
      case: new URLSearchParams(location.search).get('case'),
      host: location.hostname,
      windowValue: read(function () { return String(window.wildFireSmokeValue); }),
      bareValue: read(function () { return String(wildFireSmokeValue); }),
      ownProperty: read(function () {
        return Object.prototype.hasOwnProperty.call(window, 'wildFireSmokeValue');
      }),
      descriptor: descriptor && typeof descriptor === 'object' ? {
        value: read(function () { return String(descriptor.value); }),
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable
      } : descriptor
    };
  })();
</script>
<meta charset="utf-8">
<title>WildFire smoke page</title>
<div id="wf-cosmetic-proof">cosmetic proof</div>
<pre id="out">waiting</pre>
<script>
  var read = function (fn) {
    try { return fn(); } catch (error) { return 'throw:' + error.message; }
  };
  window.addEventListener('load', function () {
    setTimeout(function () {
      var proof = document.getElementById('wf-cosmetic-proof');
      var report = Object.assign({}, window.__wfEarlyResult, {
        cosmeticDisplay: getComputedStyle(proof).display,
        contentMarker: document.documentElement.getAttribute('data-wf-content'),
        scriptletMarker: document.documentElement.getAttribute('data-wf-scriptlets'),
        wildFireApi: read(function () { return typeof window.WildFireScriptlets; }),
        wildFireGlobals: read(function () {
          return Object.getOwnPropertyNames(window).filter(function (name) {
            return /WildFire/i.test(name);
          });
        }),
        reportedAt: Date.now()
      });
      document.getElementById('out').textContent = JSON.stringify(report, null, 2);
      fetch('/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report)
      }).catch(function () {});
    }, 1200);
  });
</script>
`;
}

function launcherHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>WildFire smoke launcher</title>
<p>Waiting for temporary add-on...</p>
<script>
  var params = new URLSearchParams(location.search);
  var smokeCase = params.get('case') || 'unknown';
  setTimeout(function () {
    location.replace('/smoke.html?case=' + encodeURIComponent(smokeCase));
  }, 10000);
</script>
`;
}

function startServer(webDir, reports) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/report') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const report = JSON.parse(body);
            reports.set(report.case, report);
            res.writeHead(204);
            res.end();
          } catch (error) {
            res.writeHead(400);
            res.end(String(error));
          }
        });
        return;
      }
      const file = url.pathname === '/' ? '/launcher.html' : url.pathname;
      const target = path.join(webDir, path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, ''));
      fs.readFile(target, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const ext = path.extname(target);
        res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function waitForReport(reports, name, timeoutMs) {
  const started = Date.now();
  return (function poll() {
    if (reports.has(name)) return Promise.resolve(reports.get(name));
    if (Date.now() - started > timeoutMs) return Promise.resolve(null);
    return sleep(500).then(poll);
  })();
}

function runWebExt(extDir, url, logFile) {
  const webExt = spawn('web-ext', [
    'run',
    '--source-dir', extDir,
    '--no-input',
    '--no-reload',
    '--start-url', url,
    '--args=-headless',
    '--args=--disable-gpu'
  ].concat(firefoxBinary ? ['--firefox', firefoxBinary] : []), {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = fs.createWriteStream(logFile);
  webExt.stdout.pipe(log);
  webExt.stderr.pipe(log);
  return webExt;
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

async function runCase(server, reports, extDir, name, tmpDir) {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/launcher.html?case=${encodeURIComponent(name)}`;
  const logFile = path.join(tmpDir, `${name}.web-ext.log`);
  const proc = runWebExt(extDir, url, logFile);
  const report = await waitForReport(reports, name, 35000);
  await stopProcess(proc);
  await sleep(1500);
  return { report, logFile };
}

function summarize(report) {
  if (!report) return { ok: false, error: 'no report received' };
  return {
    ok: report.windowValue === 'false' && report.bareValue === 'false',
    windowValue: report.windowValue,
    bareValue: report.bareValue,
    ownProperty: report.ownProperty,
    descriptor: report.descriptor,
    contentMarker: report.contentMarker,
    scriptletMarker: report.scriptletMarker,
    wildFireApi: report.wildFireApi,
    wildFireGlobals: report.wildFireGlobals
  };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildfire-smoke-'));
  const webDir = path.join(tmpDir, 'web');
  const baselineDir = path.join(tmpDir, 'baseline');
  const modifiedDir = path.join(tmpDir, 'modified');
  const reports = new Map();

  writeFile(path.join(webDir, 'smoke.html'), smokeHtml());
  writeFile(path.join(webDir, 'launcher.html'), launcherHtml());
  copyDir(ROOT, baselineDir);
  copyDir(ROOT, modifiedDir);
  [baselineDir, modifiedDir].forEach(dir => {
    addSmokeRules(dir);
    addMarkers(dir);
  });
  patchMainWorld(modifiedDir);

  const server = await startServer(webDir, reports);
  try {
    const baseline = await runCase(server, reports, baselineDir, 'baseline-isolated', tmpDir);
    const modified = await runCase(server, reports, modifiedDir, 'modified-main', tmpDir);
    const output = {
      firefox: firefoxBinary || 'default',
      baseline: Object.assign(summarize(baseline.report), { logFile: baseline.logFile }),
      modified: Object.assign(summarize(modified.report), { logFile: modified.logFile }),
      tmpDir
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.baseline.ok && !output.modified.ok) process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!keep) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } else {
      console.error('Kept smoke artifacts at ' + tmpDir);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

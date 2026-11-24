/* Real-site performance smoke for WildFire in Firefox.
 *
 * Builds a temporary WildFire copy with local instrumentation, opens a real
 * URL through web-ext, and reports navigation timing, resource counts, engine
 * counts, remote-list state, diagnostic phase totals, cosmetic apply timing,
 * and per-request Inspector durations from each loaded page. On YouTube it
 * follows randomly chosen watch links and reports deltas between pages.
 *
 * Usage:
 *   node tools/smoke-site.js [--url https://www.youtube.com]
 *                            [--firefox /path/to/firefox] [--headless]
 *                            [--video VIDEO_ID] [--navigations 3] [--run-ms 6000]
 *                            [--list-wait-ms 60000] [--timeout 180000]
 *                            [--profile dir] [--keep-profile-changes]
 *                            [--out file] [--keep]
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
const videoArg = argValue('--video', '');
const fixedVideoId = /^[A-Za-z0-9_-]{11}$/.test(videoArg) ? videoArg : '';
const fixedVideoUrl = fixedVideoId
  ? 'https://www.youtube.com/watch?v=' + fixedVideoId : '';
const navigations = Math.max(
  fixedVideoId ? 2 : 1,
  Number(argValue('--navigations', fixedVideoId ? '2' : '3')) || (fixedVideoId ? 2 : 3)
);
const runMs = Math.max(0, Number(argValue('--run-ms', '6000')) || 6000);
const listWaitMs = Math.max(0, Number(argValue('--list-wait-ms', '60000')) || 60000);
const timeoutMs = Math.max(30000, Number(argValue('--timeout', '180000')) || 180000);
const outFile = argValue('--out', '');
const profileDir = argValue('--profile', '');
const keepProfileChanges = args.includes('--keep-profile-changes');

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
      'smoke-navigate': (message, sender) => {
        const tabId = sender && sender.tab ? sender.tab.id : null;
        const url = String(message.url || '');
        const safe = url.startsWith('https://') || url.startsWith('http://');
        if (tabId !== null && tabId !== undefined && safe) {
          browser.tabs.update(tabId, { url });
        }
        return { ok: true };
      },
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

function siteScript(endpoint, navigationCount, videoUrl) {
  return `(function () {
  'use strict';
  if (window.__wildFireSiteSmoke) return;
  window.__wildFireSiteSmoke = true;

  var ENDPOINT = ${JSON.stringify(endpoint)};
  var LIST_URL = ${JSON.stringify(PRESHIPPED_URL)};
  var NAVIGATIONS = ${Number(navigationCount)};
  var FIXED_VIDEO_URL = ${JSON.stringify(videoUrl)};
  var RUN_MS = ${Number(runMs)};
  var LIST_WAIT_MS = ${Number(listWaitMs)};
  var ROTATE = NAVIGATIONS > 1 &&
    (location.hostname === 'www.youtube.com' ||
      location.hostname === 'youtube.com' || location.hostname === 'm.youtube.com');

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

  function sessionGet(name) {
    try { return sessionStorage.getItem(name) || ''; } catch (error) { return ''; }
  }

  function sessionSet(name, value) {
    try { sessionStorage.setItem(name, value); } catch (error) {}
  }

  function nextSequence() {
    var value = Number(sessionGet('wildfire-site-smoke-sequence') || 0) + 1;
    sessionSet('wildfire-site-smoke-sequence', String(value));
    return value;
  }

  function listReady(snapshot) {
    var lists = snapshot && Array.isArray(snapshot.lists) ? snapshot.lists : [];
    return lists.some(function (entry) { return entry.url === LIST_URL && Boolean(entry.text); });
  }

  function waitForList(limit) {
    var deadline = Date.now() + limit;
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

  var FALLBACK_VIDEO_IDS = ${JSON.stringify([
    'dQw4w9WgXcQ', '9bZkp7q19f0', 'jfKfPfyJRdk', 'aqz-KE-bpKQ',
    'kJQP7kiw5Fk', 'ysz5S6PUM-U', 'M7lc1UVf-VE'
  ])};
  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function addVideoId(id, ids) {
    var value = String(id || '');
    if (VIDEO_ID_RE.test(value) && ids.size < 24) ids.add(value);
  }

  function collectVideoIds(value, ids, depth) {
    if (!value || typeof value !== 'object' || depth > 8 || ids.size >= 24) return;
    if (Array.isArray(value)) {
      value.slice(0, 250).forEach(item => collectVideoIds(item, ids, depth + 1));
      return;
    }
    Object.keys(value).slice(0, 120).forEach(key => {
      var child = value[key];
      if ((key === 'videoId' || key === 'video_id') && typeof child === 'string') {
        addVideoId(child, ids);
      }
      if (child && typeof child === 'object') collectVideoIds(child, ids, depth + 1);
    });
  }

  function discoveredVideoIds() {
    var ids = new Set();
    Array.from(document.querySelectorAll('a[href*="watch?v="]'))
      .map(link => {
        try { return new URL(link.href, location.href); } catch (error) { return null; }
      })
      .filter(url => url && url.pathname === '/watch' &&
        (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' ||
          url.hostname === 'm.youtube.com'))
      .forEach(url => addVideoId(url.searchParams.get('v'), ids));
    var scripts = Array.from(document.querySelectorAll('script'))
      .map(node => node.textContent || '')
      .join('\\n');
    ['"videoId"', "'videoId'"].forEach(marker => {
      scripts.split(marker).slice(1).forEach(part => {
        var match = /^[^A-Za-z0-9_-]{0,12}([A-Za-z0-9_-]{11})/.exec(part.slice(0, 32));
        if (match) addVideoId(match[1], ids);
      });
    });
    [window.ytInitialData, window.ytInitialPlayerResponse]
      .forEach(value => {
        try { collectVideoIds(value, ids, 0); } catch (error) {}
      });
    return ids;
  }

  function videoCandidates() {
    var ids = discoveredVideoIds();
    var source = ids.size ? 'page' : 'fallback';
    if (!ids.size) FALLBACK_VIDEO_IDS.forEach(id => addVideoId(id, ids));
    return {
      source: source,
      urls: Array.from(ids).map(id => 'https://www.youtube.com/watch?v=' + id)
    };
  }

  function nextVideo(current, found) {
    var stored = [];
    try { stored = JSON.parse(sessionGet('wildfire-site-smoke-videos') || '[]'); } catch (error) {}
    var visited = [];
    try { visited = JSON.parse(sessionGet('wildfire-site-smoke-visited') || '[]'); } catch (error) {}
    var unique = Array.from(new Set((found || []).concat(stored)));
    var unseen = unique.filter(url => url !== current && !visited.includes(url));
    var pool = unseen.length ? unseen : unique.filter(url => url !== current);
    if (!pool.length) return 'https://www.youtube.com/';
    var target = pool[Math.floor(Math.random() * pool.length)];
    sessionSet('wildfire-site-smoke-visited',
      JSON.stringify(visited.concat([target]).slice(-16)));
    return target;
  }

  async function collect() {
    var sequence = nextSequence();
    try {
      var listSnapshot = await waitForList(sequence === 1 ? LIST_WAIT_MS : 10000);
      var state = await askWithTimeout('state', {}, 15000);
      var smokeState = await askWithTimeout('smoke-state', {}, 15000);
      var diagnostics = await askWithTimeout('diagnostics', {}, 15000);
      var inspection = await askWithTimeout('inspect', {}, 15000);
      var candidates = videoCandidates();
      var nextUrl = '';
      if (ROTATE && sequence < NAVIGATIONS) {
        nextUrl = FIXED_VIDEO_URL && sequence === 1
          ? FIXED_VIDEO_URL : nextVideo(location.href, candidates.urls);
      }
      var videos = {
        source: FIXED_VIDEO_URL && sequence === 1 ? 'fixed' : candidates.source,
        found: candidates.urls.length,
        sample: candidates.urls.slice(0, 3),
        nextUrl: nextUrl
      };
      var report = {
        sequence: sequence,
        url: location.href,
        host: location.hostname,
        title: document.title,
        userAgent: navigator.userAgent,
        measuredAt: Date.now(),
        navigation: navigationTiming(),
        videos: videos,
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
      await sendReport(report);
    } catch (error) {
      await sendReport({
        sequence: sequence,
        url: location.href,
        error: String(error && error.message || error)
      });
    }
    if (nextUrl) {
      sessionSet('wildfire-site-smoke-videos', JSON.stringify(candidates.urls));
      try { await askWithTimeout('smoke-navigate', { url: nextUrl }, 10000); } catch (error) {}
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
  writeFile(path.join(extDir, 'perf-site.js'),
    siteScript(endpoint, navigations, fixedVideoUrl));
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

function waitForReports(reports, count, limit) {
  const started = Date.now();
  return (function poll() {
    const full = reports.filter(report => report && report.sequence);
    if (full.length >= count) return Promise.resolve(full);
    if (Date.now() - started > limit) return Promise.resolve(full);
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
  if (profileDir) {
    params.push('--firefox-profile', profileDir, '--profile-create-if-missing');
    if (keepProfileChanges) params.push('--keep-profile-changes');
  }
  const proc = spawn('web-ext', params, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(logFile);
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);
  return proc;
}

function activePhases(report) {
  const phases = report.diagnostics && report.diagnostics.phases
    ? report.diagnostics.phases : {};
  return Object.keys(phases).reduce((result, name) => {
    if (phases[name] && phases[name].calls) result[name] = phases[name];
    return result;
  }, {});
}

function pageSummary(report) {
  const entries = report.inspect && Array.isArray(report.inspect.entries)
    ? report.inspect.entries : [];
  return {
    sequence: report.sequence,
    url: report.url,
    host: report.host,
    title: report.title,
    navigation: report.navigation,
    videos: report.videos,
    resources: report.resources,
    dom: report.dom,
    blocked: report.wildfire ? report.wildfire.blocked : 0,
    counters: report.wildfire ? report.wildfire.counts : {},
    phases: activePhases(report),
    inspectCount: entries.length,
    cosmetic: report.cosmetic,
    scriptlet: report.scriptlet
  };
}

function numberDelta(current, previous) {
  const value = Number(current) - Number(previous);
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function objectDelta(current, previous) {
  const names = Array.from(new Set(Object.keys(current || {}).concat(Object.keys(previous || {}))));
  return names.reduce((result, name) => {
    result[name] = numberDelta((current || {})[name], (previous || {})[name]);
    return result;
  }, {});
}

function phaseDeltas(current, previous) {
  const names = Array.from(new Set(Object.keys(current).concat(Object.keys(previous))));
  return names.reduce((result, name) => {
    const now = current[name] || {};
    const before = previous[name] || {};
    const calls = numberDelta(now.calls, before.calls);
    const totalMs = numberDelta(now.totalMs, before.totalMs);
    result[name] = {
      calls,
      totalMs,
      avgMs: calls > 0 ? Number((totalMs / calls).toFixed(3)) : 0,
      maxMs: Number(now.maxMs) || 0,
      candidates: numberDelta(now.candidates, before.candidates),
      regexEvaluations: numberDelta(now.regexEvaluations, before.regexEvaluations),
      cacheHits: numberDelta(now.cacheHits, before.cacheHits)
    };
    return result;
  }, {});
}

function isYouTubeSite(url) {
  try {
    return ['www.youtube.com', 'youtube.com', 'm.youtube.com']
      .includes(new URL(String(url || '')).hostname);
  } catch (error) {
    return false;
  }
}

function isYouTubeWatch(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.pathname === '/watch' && Boolean(parsed.searchParams.get('v')) &&
      ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function videoId(url) {
  try {
    return new URL(String(url || '')).searchParams.get('v') || '';
  } catch (error) {
    return '';
  }
}

function summarize(reports, meta) {
  const pages = reports.slice().sort((left, right) => left.sequence - right.sequence)
    .map(pageSummary);
  if (!pages.length) return Object.assign({ ok: false, error: 'no report received' }, meta);
  const lastReport = reports[reports.length - 1];
  const lastWildfire = lastReport.wildfire || {};
  const errors = reports.filter(report => report && report.error)
    .map(report => ({ sequence: report.sequence, url: report.url, error: report.error }));
  const deltas = pages.slice(1).map((page, index) => ({
    from: pages[index].sequence,
    to: page.sequence,
    fromUrl: pages[index].url,
    toUrl: page.url,
    blockedDelta: numberDelta(page.blocked, pages[index].blocked),
    loadMsDelta: numberDelta(page.navigation && page.navigation.loadMs,
      pages[index].navigation && pages[index].navigation.loadMs),
    resourceDelta: numberDelta(page.resources && page.resources.count,
      pages[index].resources && pages[index].resources.count),
    transferDelta: numberDelta(page.resources && page.resources.transferSize,
      pages[index].resources && pages[index].resources.transferSize),
    inspectDelta: numberDelta(page.inspectCount, pages[index].inspectCount),
    cosmeticMsDelta: numberDelta(page.cosmetic && page.cosmetic.applyMs,
      pages[index].cosmetic && pages[index].cosmetic.applyMs),
    scriptletMsDelta: numberDelta(page.scriptlet && page.scriptlet.applyMs,
      pages[index].scriptlet && page.scriptlet.applyMs),
    counters: objectDelta(page.counters, pages[index].counters),
    phases: phaseDeltas(page.phases, pages[index].phases)
  }));
  const rotate = meta.navigations > 1 && isYouTubeSite(meta.siteUrl);
  const watchPages = rotate ? pages.filter(page => isYouTubeWatch(page.url)) : [];
  const uniqueVideos = Array.from(new Set(watchPages.map(page => videoId(page.url))))
    .filter(Boolean);
  const expectedWatch = isYouTubeWatch(meta.siteUrl) ? meta.navigations
    : Math.max(0, meta.navigations - 1);
  const fixedOk = !meta.fixedVideoId ||
    (isYouTubeWatch(pages[pages.length - 1].url) &&
      videoId(pages[pages.length - 1].url) === meta.fixedVideoId);
  const rotationOk = !rotate || (meta.fixedVideoId ? fixedOk
    : uniqueVideos.length >= expectedWatch);
  const ok = pages.length >= meta.navigations && pages.every(page =>
    page.title && typeof page.navigation.loadMs === 'number') && rotationOk;
  return Object.assign({
    ok,
    pageCount: pages.length,
    url: pages[pages.length - 1].url,
    host: pages[pages.length - 1].host,
    rotate,
    fixedVideoId: meta.fixedVideoId || '',
    watchPages: watchPages.length,
    uniqueVideos,
    pages,
    deltas,
    errors,
    wildfire: {
      enabled: lastWildfire.enabled,
      blocked: lastWildfire.blocked,
      blockedBySite: lastWildfire.blockedBySite,
      counts: lastWildfire.counts,
      compiler: lastWildfire.compiler,
      startupLoad: lastWildfire.startupLoad,
      capabilities: lastWildfire.capabilities,
      lists: lastWildfire.lists
    }
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
    const collected = await waitForReports(reports, navigations, timeoutMs);
    await stopProcess(proc);
    output = summarize(collected, {
      siteUrl,
      firefox: firefoxBinary || 'default',
      navigations,
      fixedVideoId,
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

/* Real-Firefox performance smoke for every supported rule family.
 *
 * Builds a temporary WildFire copy with authored benchmark rules, loads it in
 * Firefox through web-ext, and drives a local page that exercises host/token/
 * regex matching, exceptions, redirects, rewrites, CSP, parameter and header
 * removal, cosmetic selectors, procedural selectors, and both scriptlet
 * syntaxes. The report contains page timings, engine counts, diagnostic phase
 * totals, and per-request Inspector durations.
 *
 * Usage:
 *   node tools/smoke-rules.js [--firefox /path/to/firefox] [--headed]
 *                             [--filler N] [--timeout ms] [--out file] [--keep]
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const firefoxBinary = argValue('--firefox', '');
const keep = args.includes('--keep');
const headed = args.includes('--headed');
const fillerCount = Math.max(0, Number(argValue('--filler', '0')) || 0);
const timeoutMs = Math.max(10000, Number(argValue('--timeout', '90000')) || 90000);
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

function benchmarkRules() {
  const rules = [
    '! --- WildFire rule-performance smoke ---',
    '! network host anchors',
    '||host.perf.test^',
    '||sub.host.perf.test^',
    '! network token, wildcard and separator',
    'perf-token-1234',
    'perf-wild*card',
    '! network regex',
    '/perf-regex-[0-9]+\\.js$/',
    '! exceptions, important and badfilter',
    'perf-exception',
    '@@||127.0.0.1/perf-exception^',
    '||important.perf.test^$important',
    '@@||important.perf.test^',
    '||127.0.0.1/perf-badfilter^$badfilter',
    '||127.0.0.1/perf-badfilter^',
    '! domain and third-party scope',
    '||third-party.perf.test^$third-party,domain=127.0.0.1',
    '! document and popup (compiled, not navigated during the smoke)',
    '||document.perf.test^$document',
    '||popup.perf.test^$popup',
    '! redirects',
    '||redirect.perf.test^$redirect=1x1.png',
    '/perf-redirect-rule-([a-z]+)\\.txt/$redirect-rule=tagged.svg',
    '! rewrites',
    '||127.0.0.1/perf-rewrite.json^$rewrite=blank-text',
    '/perf-rewrite-rule-([a-z]+)\\.txt/$rewrite-rule=tagged-text',
    '! CSP and CSP exceptions',
    '||127.0.0.1/perf-csp.html^$csp=no-inline-script',
    '@@||127.0.0.1/perf-csp-exempt.html^$csp',
    '! removeparam and removeheader',
    '||127.0.0.1/perf-echo^$removeparam=drop',
    '||127.0.0.1/perf-echo^$removeheader=request:x-wf-probe',
    '||127.0.0.1/perf-echo^$removeheader=response:x-wf-response',
    '! cosmetic and procedural selectors',
    '##.wf-generic',
    '##.wf-generic-exempt',
    '127.0.0.1#@#.wf-generic-exempt',
    '127.0.0.1##.wf-host',
    '127.0.0.1##.wf-text:has-text("Buy")',
    '127.0.0.1##.wf-path:matches-path(perf)',
    '127.0.0.1##.wf-attr:matches-attr(data-probe)',
    '127.0.0.1##.wf-has:has(.wf-child)',
    '127.0.0.1##.wf-xpath:xpath(self::div)',
    '127.0.0.1##.wf-media:matches-media(all)',
    '127.0.0.1##.wf-not:not(:has(.wf-keep))',
    '127.0.0.1##.wf-ancestor:has(.wf-anchor):nth-ancestor(1)',
    '127.0.0.1##.wf-css:matches-css(color: /rgb\\(255, 0, 0\\)/)',
    '! scriptlets: uBO, AdGuard and an exception',
    '127.0.0.1##+js(set-constant, wfSmokeUbo, false)',
    "127.0.0.1#%#//scriptlet('set-constant', 'wfSmokeAdguard', 'false')",
    '127.0.0.1#@#+js(set-constant, wfSmokeExempt, false)'
  ];
  const filler = Array.from({ length: fillerCount }, (_, index) =>
    'perf-filler-' + String(index).padStart(6, '0'));
  return rules.concat(filler).join('\n') + '\n';
}

function bridgeSource() {
  return `(function () {
  'use strict';
  if (window.__wildFirePerfBridge) return;
  window.__wildFirePerfBridge = true;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.wildfirePerf !== 'request') return;
    browser.runtime.sendMessage(data.message).then(function (result) {
      window.postMessage({ wildfirePerf: 'response', id: data.id, result: result }, '*');
    }, function (error) {
      window.postMessage({ wildfirePerf: 'response', id: data.id, error: String(error) }, '*');
    });
  });
})();
`;
}

function instrumentCosmetic(extDir) {
  const file = path.join(extDir, 'content', 'cosmetic.js');
  replaceOnce(file,
    '  function apply(selectors, procedural) {\n    const safe =',
    '  function apply(selectors, procedural) {\n    const started = performance.now();\n    const safe =',
    'cosmetic apply start');
  replaceOnce(file,
    '    const classified = list.map(rule => classify(rule, path));\n',
    `    const classified = list.map(rule => classify(rule, path));
    if (document.documentElement) {
      document.documentElement.setAttribute('data-wf-perf-classified', JSON.stringify(
        classified.map(item => ({
          source: item.rule && item.rule.source,
          mode: item.mode,
          selector: item.selector || item.prefilter || ''
        }))));
    }
`,
    'cosmetic classification diagnostics');
  replaceOnce(file,
    '    hiddenNodes = wanted;\n',
    `    hiddenNodes = wanted;
    if (document.documentElement) {
      document.documentElement.setAttribute('data-wf-perf-hidden',
        Array.from(wanted, node => node.id || node.className || node.tagName).join(','));
      const matches = classified.map(item => {
        const nodes = item.mode === 'css'
          ? Array.from(document.querySelectorAll(item.selector))
          : WildFireProcedural.selectAll(document, [item], location.pathname + location.search);
        return {
          source: item.rule && item.rule.source,
          mode: item.mode,
          matches: nodes.map(node => node.id || node.className || node.tagName)
        };
      });
      document.documentElement.setAttribute('data-wf-perf-procedural-matches',
        JSON.stringify(matches));
    }
`,
    'cosmetic hidden-node diagnostics');
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
    'cosmetic apply end');
}

function instrumentScriptlets(extDir) {
  ['core', 'runtime', 'transforms', 'adguard-helpers', 'definitions',
    'adguard-definitions', 'api'].forEach(name => {
    const file = path.join(extDir, 'lib', 'resources', 'scriptlets', name + '.js');
    replaceOnce(file,
      "  'use strict';\n",
      `  'use strict';
  try {
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-wf-perf-scriptlet-file-${name}', 'yes');
    }
  } catch (error) {}
`,
      'scriptlet file marker ' + name);
  });

  const core = path.join(extDir, 'lib', 'resources', 'scriptlets', 'core.js');
  replaceOnce(core,
    '  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};\n',
    `  try {
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-wf-perf-scriptlet-core', 'yes');
    }
  } catch (error) {}

  const NS = global.WildFireScriptletCore = global.WildFireScriptletCore || {};
`,
    'scriptlet core marker');

  const file = path.join(extDir, 'lib', 'resources', 'scriptlets', 'api.js');
  replaceOnce(file,
    `  Object.assign(NS, { CANONICAL, ADGUARD_CANONICAL, scriptletSyntax, canonical, validate, domainMatches, appliesTo, sameRule, run, apply, api });
`,
    `  Object.assign(NS, { CANONICAL, ADGUARD_CANONICAL, scriptletSyntax, canonical, validate, domainMatches, appliesTo, sameRule, run, apply, api });
  try {
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('data-wf-perf-scriptlet-api-end', 'yes');
    }
  } catch (error) {}
`,
    'scriptlet api completion marker');
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
    'scriptlet apply end');
}

function instrumentProcedural(extDir) {
  const file = path.join(extDir, 'lib', 'engine', 'procedural', 'nodes.js');
  replaceOnce(file,
    `      result = doc.evaluate(expr, node, null, 7, null);
`,
    `      result = doc.evaluate(expr, node, null, 7, null);
      if (global.document && global.document.documentElement) {
        global.document.documentElement.setAttribute('data-wf-perf-xpath-count',
          String(result && result.snapshotLength || 0));
      }
`,
    'xpath evaluation diagnostics');
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

  const messages = path.join(extDir, 'lib', 'background', 'messages.js');
  replaceOnce(messages,
    '    router.registerAll({\n',
    `    router.registerAll({
      'smoke-state': () => ({
        capabilities: ctx.wapiCapabilities.snapshot(),
        scripting: ctx.wapiScripting.keys(),
        scriptletSync: ctx.smokeScriptletSync || null,
        scriptlets: ctx.engine.getScriptletPayload(),
        startupLoad: ctx.smokeStartupLoad || null
      }),
`,
    'smoke-state message handler');

  const engineHost = path.join(extDir, 'lib', 'background', 'engine-host.js');
  replaceOnce(engineHost,
    `        const code = '(() => { const generation = ' + generation + '; ' +
`,
    `        const code = '(() => { const generation = ' + generation + '; ' +
          'var smokePrior = window.__wildfireScriptletGeneration || 0; ' +
          'var smokeApi = window.WildFireScriptlets; ' +
          'var mark = function () { if (document.documentElement) { ' +
          'document.documentElement.setAttribute("data-wf-perf-scriptlet-injected", "1"); ' +
          'document.documentElement.setAttribute("data-wf-perf-scriptlet-generation", ' +
          'smokePrior + "/" + generation); ' +
          'document.documentElement.setAttribute("data-wf-perf-scriptlet-api", ' +
          'String(Boolean(window.WildFireScriptlets))); ' +
          'document.documentElement.setAttribute("data-wf-perf-scriptlet-api-at-code", ' +
          'String(Boolean(smokeApi))); ' +
          'document.removeEventListener("readystatechange", mark); } }; ' +
          'mark(); document.addEventListener("readystatechange", mark); ' +
`,
    'scriptlet injection marker');
  replaceOnce(engineHost,
    `        details = {
          matches: ['<all_urls>'],
          js,
          runAt: 'document_start',
          allFrames: true
        };
`,
    `        details = {
          matches: ['<all_urls>'],
          js,
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: true
        };
`,
    'scriptlet main-world registration');
  replaceOnce(engineHost,
    `      await ctx.wapiScripting.replace('scriptlets', details);
`,
    `      ctx.smokeScriptletSync = {
        supported: true,
        generation,
        rules: fallbackRules.length,
        details: Boolean(details)
      };
      ctx.smokeScriptletSync.registered =
        await ctx.wapiScripting.replace('scriptlets', details);
`,
    'scriptlet registration diagnostics');
}

function disableRemoteAuto(extDir) {
  const file = path.join(extDir, 'lib', 'state', 'remote-lists.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = source
    .replace('autoUpdate: existing && existing.autoUpdateChoice ? existing.autoUpdate : true,',
      'autoUpdate: false,')
    .replace('autoUpdateChoice: existing ? existing.autoUpdateChoice : false,',
      'autoUpdateChoice: true,')
    .replace(/autoUpdate: remoteExisting && remoteExisting\.autoUpdateChoice\s*\?\s*remoteExisting\.autoUpdate\s*:\s*true,/,
      'autoUpdate: false,');
  if (patched === source) die('Could not disable remote auto-update in the smoke copy');
  fs.writeFileSync(file, patched);
}

function addBridge(extDir) {
  writeFile(path.join(extDir, 'perf-bridge.js'), bridgeSource());
  const file = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.content_scripts.unshift({
    matches: ['<all_urls>'],
    js: ['perf-bridge.js'],
    run_at: 'document_start',
    all_frames: false
  });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

function prepareExtension(extDir) {
  copyDir(ROOT, extDir);
  fs.appendFileSync(path.join(extDir, 'filters', 'default.txt'), benchmarkRules());
  disableRemoteAuto(extDir);
  instrumentCosmetic(extDir);
  instrumentScriptlets(extDir);
  instrumentProcedural(extDir);
  instrumentBackground(extDir);
  addBridge(extDir);
}

function launcherHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>WildFire rule-performance launcher</title>
<p>Waiting for the temporary add-on...</p>
<script>
  setTimeout(function () { location.replace('/perf-smoke.html'); }, 8000);
</script>
`;
}

function cspHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<script>
  parent.postMessage({ wfCspInline: true }, '*');
</script>
`;
}

function smokeHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>WildFire rule-performance smoke</title>
<script>
(function () {
  var read = function (fn) {
    try { return fn(); } catch (error) { return 'throw:' + error.message; }
  };
  window.__wfEarly = {
    ubo: read(function () { return String(window.wfSmokeUbo); }),
    adguard: read(function () { return String(window.wfSmokeAdguard); }),
    exempt: read(function () { return String(window.wfSmokeExempt); })
  };
  var waiting = {};
  var sequence = 0;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.wildfirePerf !== 'response') return;
    var entry = waiting[data.id];
    if (!entry) return;
    delete waiting[data.id];
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });
  window.__wfAsk = function (type, payload) {
    var id = ++sequence;
    var message = Object.assign({}, payload || {}, { type: 'wildfire:' + type });
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      window.postMessage({ wildfirePerf: 'request', id: id, message: message }, '*');
    });
  };
})();
</script></head><body>
<div class="wf-host" id="wf-host">host cosmetic</div>
<div class="wf-generic" id="wf-generic">generic cosmetic</div>
<div class="wf-generic-exempt" id="wf-generic-exempt">exempt cosmetic</div>
<div class="wf-text" id="wf-text">Buy now</div>
<div class="wf-path" id="wf-path">path cosmetic</div>
<div class="wf-attr" id="wf-attr" data-probe="yes">attribute cosmetic</div>
<div class="wf-has" id="wf-has"><span class="wf-child">child</span></div>
<div id="wf-xpath">xpath cosmetic</div>
<div class="wf-media" id="wf-media">media cosmetic</div>
<div class="wf-not" id="wf-not">negated cosmetic</div>
<div class="wf-ancestor-wrap" id="wf-ancestor-wrap"><div class="wf-ancestor"><span class="wf-anchor">anchor</span></div></div>
<div class="wf-css" id="wf-css" style="color: rgb(255, 0, 0)">computed style cosmetic</div>
<pre id="out">waiting</pre>
<script>
function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function attr(name) {
  return document.documentElement.getAttribute(name) || '';
}

function attrJson(name) {
  try { return JSON.parse(attr(name)); } catch (error) { return []; }
}

function display(id) {
  return getComputedStyle(document.getElementById(id)).display;
}

function probeFetch(spec) {
  var started = performance.now();
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 3000);
  var init = Object.assign({ cache: 'no-store', signal: controller.signal }, spec.headers
    ? { headers: spec.headers } : {});
  return fetch(spec.url, init).then(function (response) {
    return response.text().then(function (text) {
      var json = null;
      try { json = JSON.parse(text); } catch (error) {}
      return {
        name: spec.name, url: spec.url, outcome: 'resolved', status: response.status,
        responseUrl: response.url, text: text.slice(0, 120), json: json,
        responseHeader: response.headers.get('x-wf-response'),
        ms: Number((performance.now() - started).toFixed(3))
      };
    });
  }).catch(function (error) {
    return {
      name: spec.name, url: spec.url, outcome: 'rejected', error: String(error),
      ms: Number((performance.now() - started).toFixed(3))
    };
  }).then(function (result) {
    clearTimeout(timer);
    result.ok = expect(spec, result);
    return result;
  });
}

function probeImage(spec) {
  var started = performance.now();
  return new Promise(function (resolve) {
    var image = new Image();
    var timer = setTimeout(function () { finish({ outcome: 'error', error: 'image timeout' }); }, 3000);
    function finish(result) {
      clearTimeout(timer);
      result.name = spec.name;
      result.url = spec.url;
      result.ms = Number((performance.now() - started).toFixed(3));
      result.ok = result.outcome === 'loaded';
      resolve(result);
    }
    image.onload = function () {
      finish({
        outcome: 'loaded',
        src: image.src,
        currentSrc: image.currentSrc,
        naturalWidth: image.naturalWidth
      });
    };
    image.onerror = function () { finish({ outcome: 'error', error: 'image load failed' }); };
    image.src = spec.url;
  });
}

function expect(spec, result) {
  if (spec.expect === 'blocked') return result.outcome === 'rejected';
  if (result.outcome !== 'resolved') return false;
  if (spec.expect === 'resolved') return result.status === 200;
  if (spec.expect === 'data') {
    return result.responseUrl.indexOf('data:') === 0 && result.text === '';
  }
  if (spec.expect === 'image-data') {
    return result.responseUrl.indexOf('data:image/png') === 0;
  }
  if (spec.expect === 'svg') {
    return result.responseUrl.indexOf('data:image/svg') === 0 && result.text.indexOf('tag') >= 0;
  }
  if (spec.expect === 'empty') return result.text.trim() === '';
  if (spec.expect === 'tagged') return result.text.indexOf('tag') >= 0;
  if (spec.expect === 'param-clean') {
    return Boolean(result.json) && result.json.query.indexOf('drop') === -1;
  }
  if (spec.expect === 'request-header-clean') {
    return Boolean(result.json) && !result.json.requestHeader;
  }
  if (spec.expect === 'response-header-clean') return result.responseHeader === null;
  return false;
}

async function run() {
  var base = location.origin;
  var report = {
    ua: navigator.userAgent,
    dom: {
      domInteractive: performance.timing.domInteractive - performance.timing.navigationStart,
      loadEvent: performance.timing.loadEventEnd - performance.timing.navigationStart,
      resourceCount: performance.getEntriesByType('resource').length
    }
  };
  await window.__wfAsk('inspect', { value: true, reset: true });
  await window.__wfAsk('diagnostics', { value: true, reset: true });
  var state = await window.__wfAsk('state');
  var smokeState = await window.__wfAsk('smoke-state');
  report.engine = {
    counts: state.counts,
    compiler: state.compiler,
    startupLoad: smokeState.startupLoad || null
  };
  report.background = {
    capabilities: smokeState.capabilities,
    scripting: smokeState.scripting,
    scriptletSync: smokeState.scriptletSync,
    scriptlets: smokeState.scriptlets,
    startupLoad: smokeState.startupLoad
  };
  report.proceduralDebug = {
    matchMedia: window.matchMedia('all').matches,
    xpathCount: document.evaluate('self::div',
      document.getElementById('wf-xpath'), null, 7, null).snapshotLength,
    xpathRuntimeCount: Number(attr('data-wf-perf-xpath-count') || 0)
  };
  await wait(600);

  var specs = [
    { name: 'host-anchor', url: 'http://host.perf.test/resource', expect: 'blocked' },
    { name: 'subdomain', url: 'http://sub.host.perf.test/resource', expect: 'blocked' },
    { name: 'token', url: base + '/perf-token-1234.js', expect: 'blocked' },
    { name: 'wildcard', url: base + '/perf-wild-xyz-card.js', expect: 'blocked' },
    { name: 'regex', url: base + '/perf-regex-42.js', expect: 'blocked' },
    { name: 'exception', url: base + '/perf-exception', expect: 'resolved' },
    { name: 'important', url: 'http://important.perf.test/resource', expect: 'blocked' },
    { name: 'badfilter', url: base + '/perf-badfilter', expect: 'resolved' },
    { name: 'domain-third-party', url: 'http://third-party.perf.test/resource', expect: 'blocked' },
    { name: 'redirect', url: 'http://redirect.perf.test/file.png', probe: 'image' },
    { name: 'redirect-rule', url: base + '/perf-redirect-rule-tag.txt', expect: 'svg' },
    { name: 'rewrite', url: base + '/perf-rewrite.json', expect: 'empty' },
    { name: 'rewrite-rule', url: base + '/perf-rewrite-rule-tag.txt', expect: 'tagged' },
    { name: 'removeparam', url: base + '/perf-echo?keep=1&drop=1', expect: 'param-clean' },
    { name: 'removeheader-request', url: base + '/perf-echo', expect: 'request-header-clean',
      headers: { 'x-wf-probe': '1' } },
    { name: 'removeheader-response', url: base + '/perf-echo', expect: 'response-header-clean' },
    { name: 'control', url: base + '/perf-control', expect: 'resolved' }
  ];
  report.probes = await Promise.all(specs.map(function (spec) {
    return spec.probe === 'image' ? probeImage(spec) : probeFetch(spec);
  }));

  var frame = document.createElement('iframe');
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.addEventListener('load', function () { window.__wfCspLoaded = true; });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.wfCspInline) window.__wfCspInlineRan = true;
  });
  frame.src = '/perf-csp.html';
  document.body.appendChild(frame);
  await wait(800);
  report.csp = {
    loaded: Boolean(window.__wfCspLoaded),
    inlineRan: Boolean(window.__wfCspInlineRan)
  };

  report.cosmetic = {
    host: display('wf-host') === 'none',
    generic: display('wf-generic') === 'none',
    exempt: display('wf-generic-exempt') !== 'none',
    text: display('wf-text') === 'none',
    path: display('wf-path') === 'none',
    attr: display('wf-attr') === 'none',
    has: display('wf-has') === 'none',
    xpath: display('wf-xpath') === 'none',
    media: display('wf-media') === 'none',
    not: display('wf-not') === 'none',
    ancestor: display('wf-ancestor-wrap') === 'none',
    matchesCss: display('wf-css') === 'none',
    applyMs: Number(attr('data-wf-perf-cosmetic') || 0),
    selectors: Number(attr('data-wf-perf-cosmetic-count') || 0),
    procedural: Number(attr('data-wf-perf-procedural-count') || 0),
    classified: attrJson('data-wf-perf-classified'),
    proceduralMatches: attrJson('data-wf-perf-procedural-matches'),
    hidden: attr('data-wf-perf-hidden')
  };
  report.scriptlet = {
    ubo: window.__wfEarly.ubo === 'false',
    adguard: window.__wfEarly.adguard === 'false',
    exempt: window.__wfEarly.exempt === 'undefined',
    applyMs: Number(attr('data-wf-perf-scriptlet') || 0),
    applied: Number(attr('data-wf-perf-scriptlet-count') || 0),
    injected: attr('data-wf-perf-scriptlet-injected') === '1',
    generation: attr('data-wf-perf-scriptlet-generation'),
    core: attr('data-wf-perf-scriptlet-core'),
    api: attr('data-wf-perf-scriptlet-api'),
    apiEnd: attr('data-wf-perf-scriptlet-api-end'),
    apiAtCode: attr('data-wf-perf-scriptlet-api-at-code'),
    files: ['core', 'runtime', 'transforms', 'adguard-helpers', 'definitions',
      'adguard-definitions', 'api'].filter(name =>
      attr('data-wf-perf-scriptlet-file-' + name) === 'yes')
  };

  var diagnostics = await window.__wfAsk('diagnostics');
  var inspection = await window.__wfAsk('inspect');
  report.diagnostics = diagnostics.diagnostics;
  report.inspect = inspection.inspect;
  document.getElementById('out').textContent = JSON.stringify(report, null, 2);
  await fetch('/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report)
  }).catch(function () {});
}

window.addEventListener('load', function () { setTimeout(run, 1200); });
</script>
</body></html>
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
            reports.set('perf', JSON.parse(body));
            res.writeHead(204);
            res.end();
          } catch (error) {
            res.writeHead(400);
            res.end(String(error));
          }
        });
        return;
      }
      if (url.pathname.startsWith('/perf-') && url.pathname !== '/perf-smoke.html' &&
          url.pathname !== '/perf-csp.html') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-wf-response': 'present',
          'cache-control': 'no-store'
        });
        res.end(JSON.stringify({
          query: url.search,
          requestHeader: req.headers['x-wf-probe'] || ''
        }));
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
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function waitForReport(reports, limit) {
  const started = Date.now();
  return (function poll() {
    if (reports.has('perf')) return Promise.resolve(reports.get('perf'));
    if (Date.now() - started > limit) return Promise.resolve(null);
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
  const entries = report.inspect && Array.isArray(report.inspect.entries)
    ? report.inspect.entries : [];
  const timings = report.probes.reduce((result, probe) => {
    result[probe.name] = entries
      .filter(entry => entry.url === probe.url)
      .map(entry => ({
        phase: entry.phase, decision: entry.decision, source: entry.source, ms: entry.ms
      }));
    return result;
  }, {});
  report.probes.forEach(probe => {
    if (probe.name !== 'redirect' || !probe.ok) return;
    probe.ok = entries.some(entry => entry.url === probe.url &&
      entry.decision === 'redirected' && entry.source === 'redirect');
  });
  const failures = report.probes.filter(probe => !probe.ok).map(probe => probe.name);
  const cosmeticFailures = Object.keys(report.cosmetic).filter(key =>
    ['applyMs', 'selectors', 'procedural', 'classified', 'proceduralMatches', 'hidden', 'xpath'].indexOf(key) === -1 &&
    !report.cosmetic[key]);
  const scriptletFailures = Object.keys(report.scriptlet).filter(key =>
    ['applyMs', 'applied', 'injected', 'generation', 'core', 'api', 'apiEnd', 'apiAtCode', 'files'].indexOf(key) === -1 &&
    !report.scriptlet[key]);
  if (report.csp && !report.csp.loaded) failures.push('csp-loaded');
  if (report.csp && report.csp.inlineRan) failures.push('csp-inline-blocked');
  return Object.assign({
    ok: failures.length === 0 && cosmeticFailures.length === 0 && scriptletFailures.length === 0,
    failures,
    cosmeticFailures,
    scriptletFailures,
    dom: report.dom,
    engine: report.engine,
    background: report.background,
    proceduralDebug: report.proceduralDebug,
    phases: report.diagnostics && report.diagnostics.phases,
    timings,
    cosmetic: report.cosmetic,
    scriptlet: report.scriptlet,
    csp: report.csp,
    probes: report.probes
  }, meta);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildfire-rule-smoke-'));
  const webDir = path.join(tmpDir, 'web');
  const extDir = path.join(tmpDir, 'extension');
  const reports = new Map();

  writeFile(path.join(webDir, 'launcher.html'), launcherHtml());
  writeFile(path.join(webDir, 'perf-smoke.html'), smokeHtml());
  writeFile(path.join(webDir, 'perf-csp.html'), cspHtml());

  const server = await startServer(webDir, reports);
  let output = null;
  try {
    prepareExtension(extDir);
    const url = 'http://127.0.0.1:' + server.address().port + '/launcher.html';
    const logFile = path.join(tmpDir, 'web-ext.log');
    const proc = runWebExt(extDir, url, logFile);
    const report = await waitForReport(reports, timeoutMs);
    await stopProcess(proc);
    output = summarize(report, {
      firefox: firefoxBinary || 'default',
      fillerRules: fillerCount,
      logFile,
      tmpDir
    });
    console.log(JSON.stringify(output, null, 2));
    if (outFile) writeFile(outFile, JSON.stringify(output, null, 2) + '\n');
    if (!output.ok) process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!keep) fs.rmSync(tmpDir, { recursive: true, force: true });
    else console.error('Kept rule-smoke artifacts at ' + tmpDir);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

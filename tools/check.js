/* Validate the manifest and every JavaScript file before packaging. */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

function readJSON(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
  } catch (error) {
    errors.push(relative + ': ' + error.message);
    return {};
  }
}

function collectFiles(directory, skipDirs) {
  const result = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) result.push(...collectFiles(full, skipDirs));
    } else if (entry.isFile()) {
      result.push(full);
    }
  });
  return result;
}

const LOOP_STATEMENT = /^\s*(?:for\s*\(|while\s*\(|for\s+await\b|do\s*\{)/;
const CLIENT_FILE = 'lib/wapi/wapi-client.js';
const WAPI_FILES = [
  'lib/wapi/wapi.js',
  'lib/wapi/wapi-contexts.js',
  'lib/wapi/wapi-background.js',
  'lib/wapi/wapi-router.js',
  'lib/wapi/wapi-tabs.js',
  'lib/wapi/wapi-webrequest.js',
  'lib/wapi/wapi-action.js',
  'lib/wapi/wapi-capabilities.js',
  'lib/wapi/wapi-scripting.js'
];
const BACKGROUND_CHAIN = [
  'lib/background/helpers.js',
  'lib/background/engine-host.js',
  'lib/background/inspector.js',
  'lib/background/requests.js',
  'lib/background/messages.js',
  'lib/background/background.js'
];

const manifest = readJSON('manifest.json');
const gecko = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko;

if (manifest.manifest_version !== 2) errors.push('manifest_version must be 2');
if (!gecko || gecko.strict_min_version !== '153.0') {
  errors.push('browser_specific_settings.gecko.strict_min_version must be "153.0"');
}
if (!gecko || !gecko.id) errors.push('browser_specific_settings.gecko.id is required');
if (!gecko || !gecko.data_collection_permissions) {
  errors.push('browser_specific_settings.gecko.data_collection_permissions is required');
}
['alarms', 'publicSuffix', 'webNavigation'].forEach(permission => {
  if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes(permission)) {
    errors.push('permissions must include "' + permission + '"');
  }
});

const referenced = new Set();
if (manifest.icons) Object.values(manifest.icons).forEach(value => referenced.add(value));
if (manifest.browser_action && manifest.browser_action.default_icon) {
  Object.values(manifest.browser_action.default_icon).forEach(value => referenced.add(value));
}
if (manifest.browser_action && manifest.browser_action.default_popup) {
  referenced.add(manifest.browser_action.default_popup);
}
if (manifest.background && manifest.background.scripts) {
  const backgroundScripts = manifest.background.scripts;
  backgroundScripts.forEach(value => referenced.add(value));
  const wapiIndex = backgroundScripts.indexOf(WAPI_FILES[0]);
  const chainStart = backgroundScripts.indexOf(BACKGROUND_CHAIN[0]);
  if (wapiIndex === -1 || chainStart !== wapiIndex + WAPI_FILES.length ||
      WAPI_FILES.some((file, index) => backgroundScripts[wapiIndex + index] !== file)) {
    errors.push('wapi files must load immediately before the background chain');
  }
  const actualChain = backgroundScripts.slice(chainStart, chainStart + BACKGROUND_CHAIN.length);
  BACKGROUND_CHAIN.forEach((file, index) => {
    if (actualChain[index] !== file) {
      errors.push('background chain out of order: expected ' + file + ' after helpers.js');
    }
  });
  if (backgroundScripts[backgroundScripts.length - 1] !== 'background.js') {
    errors.push('background.js must be the final background script');
  }
  const rawBackend = /\bbrowserApi\.\w|\bwapi\.webRequest\b/;
  BACKGROUND_CHAIN.forEach(file => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (rawBackend.test(source)) {
      errors.push(file + ' must use wapi backbone modules for native APIs');
    }
  });
}
if (manifest.content_scripts) {
  manifest.content_scripts.forEach(entry => {
    const files = entry.js || [];
    files.forEach(value => referenced.add(value));
    const clientIndex = files.indexOf(CLIENT_FILE);
    const cosmeticIndex = files.indexOf('content/cosmetic.js');
    if (clientIndex === -1 || (cosmeticIndex !== -1 && clientIndex > cosmeticIndex)) {
      errors.push('wapi-client.js must load before content/cosmetic.js');
    }
  });
}
const clientTag = '<script src="../../lib/wapi/wapi-client.js"></script>';
[['ui/popup/popup.html', '<script src="popup.js"></script>'],
  ['ui/options/options.html', '<script src="options.js"></script>'],
  ['ui/inspector/inspector.html', '<script src="inspector.js"></script>']].forEach(([page, localTag]) => {
  const source = fs.readFileSync(path.join(ROOT, page), 'utf8');
  if (!source.includes(clientTag) || source.indexOf(localTag) < source.indexOf(clientTag)) {
    errors.push(page + ' must load wapi-client.js before its own script');
  }
});

const testSource = fs.readFileSync(path.join(ROOT, 'tools/test.js'), 'utf8');
if (!testSource.includes("const CLIENT_FILE = '" + CLIENT_FILE + "';") ||
    !testSource.includes('const loadClient = target => loadFiles(target, [CLIENT_FILE]);')) {
  errors.push('tools/test.js must define the wapi-client fixture loader');
}
const testWapi = /const WAPI_FILES = \[([\s\S]*?)\];/.exec(testSource);
if (!testWapi) {
  errors.push('tools/test.js must define WAPI_FILES');
} else {
  const testWapiFiles = Array.from(testWapi[1].matchAll(/'([^']+)'/g), match => match[1]);
  WAPI_FILES.forEach((file, index) => {
    if (testWapiFiles[index] !== file) {
      errors.push('tools/test.js wapi load order mismatch: expected ' + file);
    }
  });
}
const backgroundFixtureCount = (testSource.match(/\.\.\.BACKGROUND_FILES/g) || []).length;
const wapiFixtureCount = (testSource.match(/\.\.\.WAPI_FILES, \.\.\.BACKGROUND_FILES/g) || []).length;
if (backgroundFixtureCount !== wapiFixtureCount) {
  errors.push('tools/test.js fixtures must spread WAPI_FILES before BACKGROUND_FILES');
}
const testChain = /const BACKGROUND_FILES = \[([\s\S]*?)\];/.exec(testSource);
if (!testChain) {
  errors.push('tools/test.js must define BACKGROUND_FILES');
} else {
  const testChainFiles = Array.from(testChain[1].matchAll(/'([^']+)'/g), match => match[1]);
  BACKGROUND_CHAIN.forEach((file, index) => {
    if (testChainFiles[index] !== file) {
      errors.push('tools/test.js background chain out of order: expected ' + file);
    }
  });
}
if (manifest.options_ui && manifest.options_ui.page) referenced.add(manifest.options_ui.page);
referenced.add('ui/inspector/inspector.html');
referenced.add('filters/default.txt');
// Injected dynamically at document_start via browser.contentScripts.register.
['core', 'runtime', 'transforms', 'adguard-helpers', 'definitions',
  'adguard-definitions', 'api'].forEach(name => {
  referenced.add('lib/resources/scriptlets/' + name + '.js');
});

referenced.forEach(relative => {
  if (!fs.existsSync(path.join(ROOT, relative))) errors.push('missing referenced file: ' + relative);
});

const allFiles = collectFiles(ROOT, new Set(['.git', 'node_modules', 'dist', 'browser']));
const scripts = allFiles.filter(file => file.endsWith('.js'));
scripts.forEach(script => {
  try {
    execFileSync(process.execPath, ['--check', script], { stdio: 'pipe' });
  } catch (error) {
    errors.push(path.relative(ROOT, script) + ': ' + String(error.stderr || error.message).trim());
  }

  const hasExplicitLoop = fs.readFileSync(script, 'utf8').split(/\r?\n/)
    .some(line => LOOP_STATEMENT.test(line));
  if (hasExplicitLoop) {
    errors.push(path.relative(ROOT, script) + ': explicit loop found; use native helpers');
  }
});

const wapiLayer = new Set(WAPI_FILES.concat([CLIENT_FILE]));
const rawBrowser = /\bbrowser\.[A-Za-z_$]|\bchrome\.[A-Za-z_$]/;
scripts.forEach(script => {
  const relative = path.relative(ROOT, script).split(path.sep).join('/');
  if (wapiLayer.has(relative) || relative.startsWith('tools/') ||
      relative.startsWith('browser/')) return;
  const source = fs.readFileSync(script, 'utf8');
  if (rawBrowser.test(source)) {
    errors.push(relative + ' must use wapi backbone modules instead of raw browser APIs');
  }
});

if (errors.length) {
  console.error('WildFire check failed:');
  errors.forEach(error => console.error(' - ' + error));
  process.exit(1);
}

console.log('WildFire check passed (' + scripts.length + ' scripts, ' + referenced.size + ' referenced files, gecko >= 153.0).');

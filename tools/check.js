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
  manifest.background.scripts.forEach(value => referenced.add(value));
}
if (manifest.content_scripts) {
  manifest.content_scripts.forEach(entry => (entry.js || []).forEach(value => referenced.add(value)));
}
if (manifest.options_ui && manifest.options_ui.page) referenced.add(manifest.options_ui.page);
referenced.add('filters/default.txt');
// Injected dynamically at document_start via browser.contentScripts.register.
referenced.add('lib/resources/scriptlets.js');

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

if (errors.length) {
  console.error('WildFire check failed:');
  errors.forEach(error => console.error(' - ' + error));
  process.exit(1);
}

console.log('WildFire check passed (' + scripts.length + ' scripts, ' + referenced.size + ' referenced files, gecko >= 153.0).');

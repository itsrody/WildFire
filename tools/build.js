/* Package the extension into an unsigned Firefox XPI (a plain ZIP archive). */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'tools', 'browser', 'docs']);
const SKIP_FILES = new Set(['.DS_Store', '.gitignore', 'package-lock.json']);

function crc32(buffer) {
  const mixByte = (crc, byte) => Array.from({ length: 8 })
    .reduce(value => (value >>> 1) ^ (0xEDB88320 & -(value & 1)), crc ^ byte);
  return (~buffer.reduce(mixByte, ~0)) >>> 0;
}

function dosTime(date) {
  return ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
}

function dosDate(date) {
  return (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
}

function createZip(entries) {
  const locals = [];
  const centrals = [];
  const time = dosTime(new Date());
  const date = dosDate(new Date());
  let offset = 0;

  entries.forEach(entry => {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  });

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, end]);
}

function walk(directory, base, output) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(item => {
    const full = path.join(directory, item.name);
    const relative = base ? base + '/' + item.name : item.name;
    if (item.isDirectory()) {
      if (!SKIP_DIRS.has(item.name)) walk(full, relative, output);
    } else if (item.isFile() && !SKIP_FILES.has(item.name) && !item.name.endsWith('.md')) {
      output.push({ name: relative, data: fs.readFileSync(full) });
    }
  });
}

execFileSync(process.execPath, [path.join(__dirname, 'check.js')], { stdio: 'inherit' });

function compiledDefault() {
  const vm = require('vm');
  const ctx = { console, URL, Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number };
  ctx.window = ctx;
  vm.createContext(ctx);
  [
    'lib/engine/filter/constants.js',
    'lib/engine/filter/utils.js',
    'lib/engine/filter/pattern.js',
    'lib/engine/filter/parse-network.js',
    'lib/engine/filter/parse-procedural.js',
    'lib/engine/filter/parse-scriptlet.js',
    'lib/engine/filter/parse-cosmetic.js',
    'lib/engine/filter/engine.js',
    'lib/engine/filter/engine-compiled.js',
    'lib/engine/filter/engine-match.js',
    'lib/engine/filter/engine-cosmetic.js'
  ].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  });
  const Engine = ctx.FilterEngine;
  const engine = new Engine();
  engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
  return Buffer.from(JSON.stringify(engine.toCompiled()), 'utf8');
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const entries = [];
walk(ROOT, '', entries);
entries.push({ name: 'filters/default.compiled.json', data: compiledDefault() });
entries.sort((a, b) => a.name.localeCompare(b.name));

const dist = path.join(ROOT, 'dist');
fs.mkdirSync(dist, { recursive: true });
const minVersion = manifest.browser_specific_settings.gecko.strict_min_version;
const output = path.join(dist, `wildfire-${manifest.version}-firefox-${minVersion}.xpi`);
fs.writeFileSync(output, createZip(entries));

console.log('Built ' + path.relative(ROOT, output) +
  ' (' + entries.length + ' files, ' + (fs.statSync(output).size / 1024).toFixed(1) + ' KB)');

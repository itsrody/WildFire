/* Dependency-free unit tests for the filter engine. Run with: npm test */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const context = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/filter-engine.js'), 'utf8'), context, {
  filename: 'filter-engine.js'
});
const { FilterEngine, mapResourceType } = context;

const engine = new FilterEngine();
engine.load([
  '! comment',
  '||doubleclick.net^',
  '||tracker.example^$script',
  '||tracker.example^$~image',
  '||third.example^$third-party',
  '||only.example^$domain=page.example|~skip.page.example',
  '@@||ads.example.com^$script',
  '||ads.example.com^$image',
  '|https://exact.example/ad.js|',
  'example.org*banner.gif',
  'example.com##.promo',
  'example.com##.shared',
  '##.shared',
  'example.com#@#.promo'
].join('\n'));

function blocked(url, type, documentUrl) {
  return engine.matchRequest(url, mapResourceType(type), documentUrl).blocked;
}

assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads?x=1', 'script'), true,
  'domain-anchored rule should match subdomains');
assert.strictEqual(blocked('https://notdoubleclick.net.evil/x', 'script'), false,
  'domain-anchored rule should not match lookalike hosts');
assert.strictEqual(blocked('https://tracker.example/t.js', 'script'), true, 'type option');
assert.strictEqual(blocked('https://tracker.example/pixel.png', 'image'), false, 'excluded type option');
assert.strictEqual(blocked('https://tracker.example/pixel.gif', 'image'), false, 'excluded type option covers all image formats');
assert.strictEqual(blocked('https://third.example/x.js', 'script', 'https://third.example/'), false,
  'third-party-only rule skips same-site');
assert.strictEqual(blocked('https://third.example/x.js', 'script', 'https://other.net/'), true,
  'third-party-only rule blocks cross-site');
assert.strictEqual(blocked('https://only.example/x.js', 'script', 'https://page.example/'), true,
  'domain option includes page.example');
assert.strictEqual(blocked('https://only.example/x.js', 'script', 'https://skip.page.example/'), false,
  'domain option excludes skip.page.example');
assert.strictEqual(blocked('https://ads.example.com/app.js', 'script', 'https://elsewhere.net/'), false,
  '@@ exception wins over other rules');
assert.strictEqual(blocked('https://ads.example.com/app.png', 'image', 'https://elsewhere.net/'), true,
  'exception limited to scripts');
assert.strictEqual(blocked('https://exact.example/ad.js', 'script'), true, 'anchored pattern');
assert.strictEqual(blocked('https://exact.example/ad.js?x=1', 'script'), false, 'anchored end must match');
assert.strictEqual(blocked('https://example.org/path/banner.gif?v=2', 'image'), true, 'wildcard pattern');

assert.deepStrictEqual(Array.from(engine.getCosmetic('example.com')), ['.shared'],
  'cosmetic rules plus generic, minus exception');
assert.deepStrictEqual(Array.from(engine.getCosmetic('other.net')), ['.shared'], 'generic cosmetic only');

engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
assert.ok(engine.counts.network > 50, 'bundled list should contain network rules');
assert.ok(engine.counts.cosmetic > 5, 'bundled list should contain cosmetic rules');
assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads', 'script'), true,
  'bundled list blocks ads');

console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).');

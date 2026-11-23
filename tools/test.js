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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/document-scope.js'), 'utf8'), context, {
  filename: 'document-scope.js'
});
const { FilterEngine, mapResourceType, DocumentScope } = context;

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

// Firefox 153 Public Suffix List integration: the domain resolver is injected
// so multi-part and private suffixes scope $third-party correctly.
const pslDomains = new Map([
  ['ads.a.co.uk', 'a.co.uk'],
  ['www.b.co.uk', 'b.co.uk'],
  ['ads.user1.github.io', 'user1.github.io'],
  ['site.user2.github.io', 'user2.github.io'],
  ['ads.xn--nxasmq6b.com', 'xn--nxasmq6b.com'],
  ['site.xn--nxasmq6b.com', 'xn--nxasmq6b.com']
]);
const resolverCalls = [];
const pslEngine = new FilterEngine(host => {
  resolverCalls.push(host);
  return pslDomains.get(host) || '';
});
pslEngine.load([
  '||ads.a.co.uk^$third-party',
  '||ads.user1.github.io^$third-party',
  '||ads.xn--nxasmq6b.com^$third-party'
].join('\n'));

const pslBlocked = (url, documentUrl) =>
  pslEngine.matchRequest(url, mapResourceType('script'), documentUrl).blocked;

assert.strictEqual(pslBlocked('https://ads.a.co.uk/x.js', 'https://www.b.co.uk/'), true,
  'distinct registrable domains under co.uk are third-party');
assert.strictEqual(pslBlocked('https://ads.user1.github.io/x.js', 'https://site.user2.github.io/'), true,
  'distinct private suffixes under github.io are third-party');
assert.strictEqual(pslBlocked('https://ads.xn--nxasmq6b.com/x.js', 'https://site.xn--nxasmq6b.com/'), false,
  'punycode IDN documents share a registrable domain');
assert.ok(resolverCalls.includes('ads.a.co.uk') && resolverCalls.includes('site.xn--nxasmq6b.com'),
  'resolver receives punycode hostnames from the engine');

const fallbackEngine = new FilterEngine(() => { throw new Error('PSL unavailable'); });
fallbackEngine.load('||third.example^$third-party');
const fallbackBlocked = (url, documentUrl) =>
  fallbackEngine.matchRequest(url, mapResourceType('script'), documentUrl).blocked;
assert.strictEqual(fallbackBlocked('https://third.example/x.js', 'https://other.net/'), true,
  'resolver failure falls back to last-two-label scope');
assert.strictEqual(fallbackBlocked('https://third.example/x.js', 'https://third.example/'), false,
  'fallback still treats the same host as first-party');

// Firefox 153 documentId: request scope survives fast navigations and frames.
const scope = new DocumentScope();
scope.remember({ tabId: 7, frameId: 0, documentId: 'doc-old', url: 'https://old.example/' });
assert.strictEqual(scope.documentUrl({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'committed document URL is cached by documentId');

scope.remember({ tabId: 7, frameId: 0, documentId: 'doc-new', url: 'https://new.example/' });
assert.strictEqual(scope.documentUrl({ tabId: 7, frameId: 0, documentId: 'doc-new' }),
  'https://new.example/', 'new document replaces the cached URL');
assert.notStrictEqual(scope.documentUrl({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'stale documentId no longer resolves to the old URL');

scope.rememberFromRequest({ tabId: 7, frameId: 0, documentId: 'doc-old', documentUrl: 'https://old.example/' });
assert.notStrictEqual(scope.documentUrl({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'late request cannot resurrect a replaced document URL');

scope.remember({ tabId: 7, frameId: 2, documentId: 'doc-frame', url: 'https://frame.example/' });
assert.strictEqual(
  scope.documentUrl({ tabId: 7, frameId: 2, documentId: 'doc-frame', parentDocumentId: 'doc-new' }),
  'https://frame.example/', 'iframe keeps its own document scope');
assert.strictEqual(scope.documentUrl({
  tabId: 7,
  frameId: 2,
  documentId: 'doc-unknown',
  originUrl: 'https://origin.example/',
  documentUrl: '',
  frameAncestors: [{ url: 'https://ancestor.example/' }]
}), 'https://origin.example/', 'originUrl outranks tab URL and frame ancestors');
assert.strictEqual(scope.documentUrl({ documentId: 'doc-new', documentUrl: 'https://direct.example/' }),
  'https://direct.example/', 'request documentUrl outranks the cache');

scope.rememberFromRequest({ tabId: 8, frameId: 0, documentId: 'doc-req', documentUrl: 'https://req.example/' });
assert.strictEqual(scope.documentUrl({ tabId: 8, frameId: 0, documentId: 'doc-req' }),
  'https://req.example/', 'request details seed the document cache');

scope.forgetTab(7);
assert.strictEqual(scope.documentUrl({ tabId: 7, frameId: 0, documentId: 'doc-new' }), '',
  'tab removal clears document and tab caches');
assert.strictEqual(scope.documentUrl({ tabId: 8, frameId: 0, documentId: 'doc-req' }),
  'https://req.example/', 'other tabs are untouched');

// Generic rules use a 4-character token index; only short patterns are scanned.
const indexEngine = new FilterEngine();
indexEngine.load([
  'example.org*banner.gif',
  'first.example*second.example',
  '*ad*',
  '@@||keep.example^',
  'keep.example*popup'
].join('\n'));
assert.ok(indexEngine.tokenRules.has('bann'), 'literal chunks are indexed by token');
assert.strictEqual(indexEngine.unindexedRules.length, 1, 'short patterns stay in the fallback list');
assert.strictEqual(
  indexEngine.matchRequest('https://example.org/x/banner.gif', mapResourceType('image'), '').blocked,
  true, 'indexed rule still matches');
assert.strictEqual(
  indexEngine.matchRequest('https://first.example/r?to=second.example', mapResourceType('script'), '').blocked,
  true, 'tokens from later literal chunks are indexed');
assert.strictEqual(
  indexEngine.matchRequest('https://other.example/ad/tracker', mapResourceType('script'), '').blocked,
  true, 'unindexed short pattern still matches');
assert.strictEqual(
  indexEngine.matchRequest('https://keep.example/popup.js', mapResourceType('script'), '').blocked,
  false, 'exceptions win through the token index');

const bigEngine = new FilterEngine();
bigEngine.load(Array.from({ length: 2000 }, (_, i) => `${i}u.example/path`).join('\n'));
assert.strictEqual(bigEngine.counts.network, 2000, 'large list loads every rule');
assert.strictEqual(bigEngine.unindexedRules.length, 0, 'all generated rules are indexed');
assert.strictEqual((bigEngine.tokenRules.get('1999') || []).length, 1, 'distinctive token buckets stay small');
assert.strictEqual(
  bigEngine.matchRequest('https://1999u.example/path', mapResourceType('script'), '').blocked,
  true, 'matching still works in a large list');

engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
assert.ok(engine.counts.network > 50, 'bundled list should contain network rules');
assert.ok(engine.counts.cosmetic > 5, 'bundled list should contain cosmetic rules');
assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads', 'script'), true,
  'bundled list blocks ads');

console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).');

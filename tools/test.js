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
assert.strictEqual(scope.urlForFrame(7, 2), 'https://frame.example/',
  'frame URL is available for popup source lookup');
assert.strictEqual(scope.urlForFrame(9, 0), '', 'unknown frame has no URL');

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

// Regex filters compile with a safe flag set; catastrophic shapes are rejected at load.
const regexEngine = new FilterEngine();
regexEngine.load([
  '/ads\\.example\\.com\\/track/$script',
  '/banner\\d+\\.gif/i',
  '/dollar\\.example\\/end$/',
  '@@/keep\\.example\\/ad/$script',
  '/(a+)+$/',
  '/(foo|bar)+/',
  '/(a)(b)\\1/',
  '/(' + 'x'.repeat(600) + ')/',
  '/foo/g'
].join('\n'));
assert.strictEqual(regexEngine.counts.network, 4, 'only safe regex rules are loaded');
assert.strictEqual(regexEngine.rejectedRegex.length, 5, 'unsafe regex rules are rejected');
assert.strictEqual(regexEngine.unindexedRules.length, 4, 'regex rules bypass the token index');
assert.ok(regexEngine.rejectedRegex.some(entry => entry.reason === 'nested or alternated quantifier'),
  'nested and alternated quantifiers are rejected');
assert.ok(regexEngine.rejectedRegex.some(entry => entry.reason === 'backreferences are not allowed'),
  'backreferences are rejected');
assert.ok(regexEngine.rejectedRegex.some(entry => entry.reason === 'regex pattern too long'),
  'oversized patterns are rejected');
assert.ok(regexEngine.rejectedRegex.some(entry => entry.reason === 'unsupported regex flag'),
  'stateful flags are rejected');
assert.strictEqual(
  regexEngine.matchRequest('https://ads.example.com/track.js', mapResourceType('script'), '').blocked,
  true, 'regex rule with options matches');
assert.strictEqual(
  regexEngine.matchRequest('https://ads.example.com/track.js', mapResourceType('image'), '').blocked,
  false, 'regex rule respects type options');
assert.strictEqual(
  regexEngine.matchRequest('https://cdn.example.com/BANNER42.GIF', mapResourceType('image'), '').blocked,
  true, 'regex i flag is case-insensitive');
assert.strictEqual(
  regexEngine.matchRequest('https://dollar.example/end', mapResourceType('script'), '').blocked,
  true, '$ inside a regex pattern is not parsed as an option separator');
assert.strictEqual(
  regexEngine.matchRequest('https://keep.example/ad.js', mapResourceType('script'), '').blocked,
  false, 'regex exception wins');

// Wider resource types plus $document / $popup handling.
assert.strictEqual(mapResourceType('ping'), 'ping', 'ping is its own type');
assert.strictEqual(mapResourceType('websocket'), 'websocket', 'websocket is its own type');
assert.strictEqual(mapResourceType('web_manifest'), 'manifest', 'web_manifest alias');
assert.strictEqual(mapResourceType('csp_report'), 'csp', 'csp_report alias');

const documentEngine = new FilterEngine();
documentEngine.load([
  '||blocked.example^$document',
  '||allowed.example^$document',
  '@@||allowed.example^$document',
  '||script.example^$script',
  '||popup.example^$popup',
  '@@||keep.popup.example^$popup',
  '||scoped.example^$popup,domain=allowed.example'
].join('\n'));

assert.strictEqual(
  documentEngine.matchRequest('https://blocked.example/landing', mapResourceType('main_frame'), 'https://page.example/').blocked,
  true, '$document blocks a top-level navigation');
assert.strictEqual(
  documentEngine.matchRequest('https://allowed.example/landing', mapResourceType('main_frame'), 'https://page.example/').blocked,
  false, '$document exception wins');
assert.strictEqual(
  documentEngine.matchRequest('https://script.example/app.js', mapResourceType('script'), '').blocked,
  true, 'script rules still work');
assert.strictEqual(
  documentEngine.matchRequest('https://script.example/landing', mapResourceType('main_frame'), '').blocked,
  false, 'script rules do not block documents');
assert.strictEqual(
  documentEngine.matchPopup('https://popup.example/open', 'https://source.example/').blocked,
  true, '$popup blocks a popup navigation');
assert.strictEqual(
  documentEngine.matchPopup('https://keep.popup.example/open', 'https://source.example/').blocked,
  false, '$popup exception wins');
assert.strictEqual(
  documentEngine.matchPopup('https://script.example/app.js', 'https://source.example/').blocked,
  false, 'non-popup rules are ignored for popups');
assert.strictEqual(
  documentEngine.matchPopup('https://scoped.example/open', 'https://allowed.example/').blocked,
  true, '$popup respects $domain');
assert.strictEqual(
  documentEngine.matchPopup('https://scoped.example/open', 'https://other.example/').blocked,
  false, '$popup honors document exclusions');

const plainEngine = new FilterEngine();
plainEngine.load('example.net*track');
assert.strictEqual(
  plainEngine.matchRequest('https://example.net/landing', mapResourceType('main_frame'), '').blocked,
  false, 'plain rules never block documents');

engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
assert.ok(engine.counts.network > 50, 'bundled list should contain network rules');
assert.ok(engine.counts.cosmetic > 5, 'bundled list should contain cosmetic rules');
assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads', 'script'), true,
  'bundled list blocks ads');

console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).');

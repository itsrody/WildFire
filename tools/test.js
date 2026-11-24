/* Dependency-free unit tests for the filter engine. Run with: npm test */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
/* The filter engine is a chain of classic-script modules; load order matters. */
const ENGINE_FILES = [
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
];
/* The procedural DOM evaluator is a second classic-script chain. */
const PROCEDURAL_FILES = [
  'lib/engine/procedural/text.js',
  'lib/engine/procedural/nodes.js',
  'lib/engine/procedural/native.js',
  'lib/engine/procedural/select.js'
];
/* Scriptlet registry is another classic-script chain; definitions need helpers. */
const SCRIPTLET_FILES = [
  'lib/resources/scriptlets/core.js',
  'lib/resources/scriptlets/runtime.js',
  'lib/resources/scriptlets/transforms.js',
  'lib/resources/scriptlets/adguard-helpers.js',
  'lib/resources/scriptlets/definitions.js',
  'lib/resources/scriptlets/adguard-definitions.js',
  'lib/resources/scriptlets/api.js'
];
/* Client-side message backbone shared by extension pages and content scripts. */
const CLIENT_FILE = 'lib/wapi/wapi-client.js';
/* Native Options filter editor shell. */
const EDITOR_FILE = 'ui/options/editor.js';
/* Local Inspector renderer and pure log helpers. */
const INSPECTOR_UI_FILE = 'ui/inspector/logger-ui.js';
/* Background controller is a classic-script chain loaded before the bootstrap. */
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
const BACKGROUND_FILES = [
  'lib/background/helpers.js',
  'lib/background/url-skip.js',
  'lib/background/engine-host.js',
  'lib/background/logger.js',
  'lib/background/requests.js',
  'lib/background/messages.js',
  'lib/background/background.js'
];
const loadFiles = (target, files) => files.forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), target, { filename: file });
});
const loadEngine = target => loadFiles(target, ENGINE_FILES);
const loadScriptlets = target => loadFiles(target, SCRIPTLET_FILES);
const loadClient = target => loadFiles(target, [CLIENT_FILE]);
const context = vm.createContext({
  console, URL, setTimeout, clearTimeout, setImmediate,
  CSS: { supports: () => true }, location: { hostname: 'page.example' }
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/state/store.js'), 'utf8'), context, {
  filename: 'store.js'
});
loadEngine(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/state/page-store.js'), 'utf8'), context, {
  filename: 'page-store.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/resources/redirect-resources.js'), 'utf8'), context, {
  filename: 'redirect-resources.js'
});
loadFiles(context, PROCEDURAL_FILES);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/state/remote-lists.js'), 'utf8'), context, {
  filename: 'remote-lists.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/state/suggested-lists.js'), 'utf8'), context, {
  filename: 'suggested-lists.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/resources/csp-resources.js'), 'utf8'), context, {
  filename: 'csp-resources.js'
});
loadScriptlets(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/resources/rewrite-resources.js'), 'utf8'), context, {
  filename: 'rewrite-resources.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/compile/compile-cache.js'), 'utf8'), context, {
  filename: 'compile-cache.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/compile/compiler.js'), 'utf8'), context, {
  filename: 'compiler.js'
});
loadFiles(context, [...WAPI_FILES, ...BACKGROUND_FILES]);
const { FilterEngine, mapResourceType, WildFirePageStore, RedirectResources, WildFireProcedural, RemoteLists, WildFireSuggestedLists, CspResources, WildFireScriptlets, RewriteResources, WildFireCompileCache, WildFireCompiler, WildFireStore, WildFireBackground, WildFireWapi, wapi, WildFireWapiContexts, wapiContexts,
  WildFireWapiBackground, wapiBackground, WildFireWapiRouter, wapiRouter,
  WildFireWapiTabs, wapiTabs, WildFireWapiWebRequest, wapiWebRequest,
  WildFireWapiAction, wapiAction, WildFireWapiCapabilities, wapiCapabilities,
  WildFireWapiScripting, wapiScripting } = context;

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

const wildcardDomainEngine = new FilterEngine();
wildcardDomainEngine.load([
  '||wildads.example^$domain=page.*',
  '||wildsub.example^$domain=*.page.*',
  '@@||wildads.example^$domain=skip.page.*'
].join('\n'));
const wildcardBlocked = (url, documentUrl) =>
  wildcardDomainEngine.matchRequest(url, mapResourceType('script'), documentUrl).blocked;
assert.strictEqual(wildcardBlocked('https://wildads.example/a.js', 'https://page.com/'), true,
  'domain=page.* matches the bare registrable host with any suffix');
assert.strictEqual(wildcardBlocked('https://wildads.example/a.js', 'https://shop.page.co.uk/'), true,
  'domain=page.* matches subdomains and multi-label suffixes');
assert.strictEqual(wildcardBlocked('https://wildads.example/a.js', 'https://page/'), false,
  'domain=page.* still requires a suffix');
assert.strictEqual(wildcardBlocked('https://wildads.example/a.js', 'https://notpage.com/'), false,
  'domain=page.* does not match lookalike hosts');
assert.strictEqual(wildcardBlocked('https://wildsub.example/a.js', 'https://sub.page.com/'), true,
  'domain=*.page.* requires a subdomain');
assert.strictEqual(wildcardBlocked('https://wildsub.example/a.js', 'https://page.com/'), false,
  'domain=*.page.* does not match the bare host');
assert.strictEqual(wildcardBlocked('https://wildads.example/a.js', 'https://skip.page.dev/'), false,
  'a wildcard domain exception wins');
const wildcardBlob = wildcardDomainEngine.toCompiled();
const wildcardReload = new FilterEngine();
assert.strictEqual(wildcardReload.loadCompiled(wildcardBlob), true,
  'wildcard domain rules survive compiled round-trip');
assert.strictEqual(wildcardReload.matchRequest('https://wildads.example/a.js', 'script', 'https://page.io/').blocked,
  true, 'compiled wildcard domain rules keep their scope');
const invalidDomainEngine = new FilterEngine();
invalidDomainEngine.load('||invalid.example^$domain=page*.*');
assert.strictEqual(invalidDomainEngine.rejectedRegex.length, 1,
  'malformed wildcard domain options are rejected');
assert.strictEqual(invalidDomainEngine.matchRequest(
  'https://invalid.example/a.js', 'script', 'https://page.com/').blocked, false,
  'a rejected domain rule never blocks');

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

// Firefox-native page state: document lifetime, frame scope, and per-tab data.
const scope = new WildFirePageStore({
  siteForHost: host => host.split('.').slice(-2).join('.'),
  isDisabledHost: host => host === 'blocked.example'
});
scope.observeNavigation({ tabId: 7, frameId: 0, documentId: 'doc-old', url: 'https://old.example/' });
assert.strictEqual(scope.documentUrlFor({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'committed document URL is cached by documentId');

scope.observeNavigation({ tabId: 7, frameId: 0, documentId: 'doc-new', url: 'https://new.example/' });
assert.strictEqual(scope.documentUrlFor({ tabId: 7, frameId: 0, documentId: 'doc-new' }),
  'https://new.example/', 'new document replaces the cached URL');
assert.notStrictEqual(scope.documentUrlFor({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'stale documentId no longer resolves to the old URL');

scope.observeRequest({ tabId: 7, frameId: 0, documentId: 'doc-old', documentUrl: 'https://old.example/' });
assert.notStrictEqual(scope.documentUrlFor({ tabId: 7, frameId: 0, documentId: 'doc-old' }),
  'https://old.example/', 'late request cannot resurrect a replaced document URL');

scope.observeNavigation({
  tabId: 7, frameId: 2, parentFrameId: 0,
  documentId: 'doc-frame', url: 'https://frame.example/'
});
assert.strictEqual(scope.documentUrlFor({
  tabId: 7, frameId: 2, documentId: 'doc-frame', parentDocumentId: 'doc-new'
}), 'https://frame.example/', 'iframe keeps its own document scope');
const frameContext = scope.contextFor({
  tabId: 7,
  frameId: 2,
  documentId: 'doc-unknown',
  originUrl: 'https://origin.example/',
  documentUrl: '',
  frameAncestors: [{ url: 'https://ancestor.example/' }]
});
assert.strictEqual(frameContext.documentUrl, 'https://origin.example/',
  'originUrl outranks frame URL, tab URL and ancestors');
assert.strictEqual(frameContext.topUrl, 'https://new.example/', 'top-level URL stays separate from frame scope');
assert.strictEqual(frameContext.site, 'origin.example', 'site comes from document scope');
assert.strictEqual(scope.documentUrlFor({ documentId: 'doc-new', documentUrl: 'https://direct.example/' }),
  'https://direct.example/', 'request documentUrl outranks the cache');
assert.strictEqual(scope.urlForFrame(7, 2), 'https://frame.example/',
  'frame URL is available for popup source lookup');
assert.strictEqual(scope.urlForFrame(9, 0), '', 'unknown frame has no URL');

scope.observeRequest({ tabId: 8, frameId: 0, documentId: 'doc-req', documentUrl: 'https://req.example/' });
assert.strictEqual(scope.documentUrlFor({ tabId: 8, frameId: 0, documentId: 'doc-req' }),
  'https://req.example/', 'request details seed the document cache');
scope.observeRequest({
  tabId: 11, frameId: 0, type: 'main_frame', url: 'https://nav.example/', documentId: 'doc-nav'
});
assert.strictEqual(scope.topUrlForTab(11), '',
  'a pending main-frame request does not replace the committed top-level URL');
assert.strictEqual(scope.siteForTab(11), '',
  'a cancelled navigation cannot poison site attribution');
const pendingNav = scope.contextFor({
  tabId: 11, frameId: 0, type: 'main_frame', url: 'https://nav.example/', documentId: 'doc-nav'
});
assert.strictEqual(pendingNav.topUrl, 'https://nav.example/',
  'the pending request still supplies request-scoped top-level context');
assert.strictEqual(pendingNav.documentUrl, 'https://nav.example/',
  'the pending navigation URL is its own document scope');

scope.observeNavigation({ tabId: 9, frameId: 0, documentId: 'doc-disabled', url: 'https://blocked.example/' });
assert.strictEqual(scope.contextFor({ tabId: 9, frameId: 0 }).disabled, true,
  'paused hosts are resolved from page context');

scope.observeNavigation({ tabId: 10, frameId: 0, documentId: 'doc-frag', url: 'https://frag.example/a' });
scope.recordBlocked(10);
scope.observeNavigation({ tabId: 10, frameId: 0, documentId: 'doc-frag', url: 'https://frag.example/a#b' });
assert.strictEqual(scope.blockedForTab(10), 1,
  'fragment/history navigation keeps the same page state');
scope.resetBlocked();
assert.strictEqual(scope.blockedForTab(10), 0,
  'resetting stats clears per-page counters too');

scope.markPopup(7, 'https://source.example/');
assert.strictEqual(scope.popupSourceFor(7), 'https://source.example/', 'popup source is stored per tab');
scope.markPopupBlocked(7);
scope.markPopupCounted(7);
assert.strictEqual(scope.isPopupBlocked(7), true, 'a popup block stays pending until its request');
assert.strictEqual(scope.isPopupCounted(7), true, 'a pending popup block tracks its count');
assert.strictEqual(scope.consumePopupBlock(7), true, 'a popup block is consumed once');
assert.strictEqual(scope.isPopupBlocked(7), false, 'consuming clears the popup block flag');
assert.strictEqual(scope.isPopupCounted(7), false, 'consuming clears the popup count flag');
assert.strictEqual(scope.popupSourceFor(7), '', 'consuming clears the popup source');
scope.markPopup(7, 'https://source.example/');
scope.markPopupBlocked(7);
scope.markPopupCounted(7);
scope.clearPopup(7);
assert.strictEqual(scope.isPopupBlocked(7), false, 'cleanup clears a popup block with no follow-up request');
assert.strictEqual(scope.isPopupCounted(7), false, 'cleanup clears the popup count');
scope.setCosmetic(7, { selectors: ['.ad'] });
scope.setScriptlets(7, { hash: 'v1' });
assert.deepStrictEqual(scope.getCosmetic(7), { selectors: ['.ad'] }, 'cosmetic cache is per page');
assert.deepStrictEqual(scope.getScriptlets(7), { hash: 'v1' }, 'scriptlet cache is per page');

scope.observeNavigation({ tabId: 7, frameId: 0, documentId: 'doc-next', url: 'https://next.example/' });
assert.strictEqual(scope.urlForFrame(7, 2), '', 'a new top-level document clears old frames');
assert.strictEqual(scope.getCosmetic(7), null, 'a new document clears stale cosmetic caches');
assert.strictEqual(scope.getScriptlets(7), null, 'a new document clears stale scriptlet caches');

scope.forgetTab(7);
assert.strictEqual(scope.documentUrlFor({ tabId: 7, frameId: 0, documentId: 'doc-next' }), '',
  'tab removal clears page state');
assert.strictEqual(scope.documentUrlFor({ tabId: 8, frameId: 0, documentId: 'doc-req' }),
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
assert.ok(['bann', 'anne', 'nner', 'exam', 'xamp', 'ampl', 'mple', '.org', 'gif'].some(t => indexEngine.tokenRules.has(t)) ||
  indexEngine.unindexedRules.length < 5, 'literal chunks are indexed by token');
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

const plainEngineFast = new FilterEngine();
plainEngineFast.load([
  '||ads.example/track.js',
  '|https://exact.example/ad.js|',
  '/banner/i',
  '@@||ads.example/track.js$script',
  'example.org*banner^',
  '||wild.example^*/path/*/file.js',
  '|https://start.example^*end|'
].join('\n'));
assert.strictEqual(plainEngineFast.matchRequest('https://ads.example/track.js?x=1', 'script', '').blocked,
  false, 'plain host-anchor exception wins');
assert.strictEqual(plainEngineFast.matchRequest('https://ads.example/track.js?x=1', 'image', '').blocked,
  true, 'plain host-anchor rule matches path');
assert.strictEqual(plainEngineFast.matchRequest('https://exact.example/ad.js', 'script', '').blocked,
  true, 'plain left+right anchor matches exactly');
assert.strictEqual(plainEngineFast.matchRequest('https://cdn.example/BANNER.PNG', 'image', '').blocked,
  true, 'plain case-insensitive contains matches');
assert.strictEqual(plainEngineFast.matchRequest('https://example.org/ads/banner/', 'image', '').blocked,
  true, 'wildcard+separator regex matcher matches');
const sepEngine = new FilterEngine();
sepEngine.load('example.org*banner^');
assert.strictEqual(sepEngine.matchRequest('https://example.org/ads/banner/', 'image', '').blocked,
  true, 'separator matches /');
assert.strictEqual(sepEngine.matchRequest('https://example.org/ads/bannerx.gif', 'image', '').blocked,
  false, 'separator does not match alnum continuation');
assert.strictEqual(sepEngine.matchRequest('https://example.org/ads/banner', 'image', '').blocked,
  true, 'separator matches end of string');
assert.strictEqual(plainEngineFast.matchRequest('https://wild.example/a/path/b/file.js', 'script', '').blocked,
  true, 'host-anchor wildcard segments match');
assert.strictEqual(plainEngineFast.matchRequest('https://start.example/a/b/end', 'script', '').blocked,
  true, 'start+end anchored wildcard segments match');
assert.strictEqual(plainEngineFast.matchRequest('https://start.example/a/b/end2', 'script', '').blocked,
  false, 'end anchor is enforced for segment matcher');

const segmentEngine = new FilterEngine();
segmentEngine.load([
  'foo*bar*baz',
  '||seg.example^*/script.js',
  '|https://left.example/path/*/end|',
  'ad^banner^'
].join('\n'));
assert.strictEqual(segmentEngine.matchRequest('https://x.test/foo-1-bar-2-baz.js', 'script', '').blocked,
  true, 'multi-wildcard segment matches');
assert.strictEqual(segmentEngine.matchRequest('https://x.test/foo-1-bar-2-qux.js', 'script', '').blocked,
  false, 'multi-wildcard segment requires all literals');
assert.strictEqual(segmentEngine.matchRequest('https://sub.seg.example/a/script.js', 'script', '').blocked,
  true, 'host-anchor segment with separator and wildcard matches');
assert.strictEqual(segmentEngine.matchRequest('https://seg.example.evil/a/script.js', 'script', '').blocked,
  false, 'host-anchor segment rejects lookalike host');
assert.strictEqual(segmentEngine.matchRequest('https://left.example/path/a/b/end', 'script', '').blocked,
  true, 'start+end anchored segment with wildcard matches');
assert.strictEqual(segmentEngine.matchRequest('https://left.example/path/a/b/endx', 'script', '').blocked,
  false, 'start+end anchored segment rejects trailing chars');
assert.strictEqual(segmentEngine.matchRequest('https://x.test/ad/banner/img', 'image', '').blocked,
  true, 'separator-only segment matches separators');
assert.strictEqual(segmentEngine.matchRequest('https://x.test/adbanner/img', 'image', '').blocked,
  false, 'separator-only segment rejects missing separator');

const importantEngine = new FilterEngine();
importantEngine.load([
  '||ads.example^$script',
  '@@||ads.example^$script',
  '||ads.example^$script,important',
  '||redir.example^$script,redirect=noopjs,important',
  '@@||redir.example^$script'
].join('\n'));
assert.strictEqual(
  importantEngine.matchRequest('https://ads.example/app.js', 'script', '').blocked,
  true, '$important overrides an exception');
assert.strictEqual(
  importantEngine.matchRequest('https://ads.example/app.js', 'script', '').important,
  true, '$important result is marked important');
const importantRedirect = importantEngine.matchRequest('https://redir.example/app.js', 'script', '');
assert.strictEqual(importantRedirect.blocked, true, '$important redirect blocks');
assert.strictEqual(importantRedirect.redirect.alias, 'noopjs', '$important keeps redirect');

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

// Compiled DAT-like round-trip preserves matching behavior.
const compiledSource = new FilterEngine(null, null, { validate: () => null });
compiledSource.load([
  '||ads.example^$script,third-party',
  '||ads.example^$redirect=noopjs,script',
  '@@||ads.example/allow.js$script',
  'example.com##.ad',
  '##.global',
  'example.com#@#.global',
  'example.com##div:has-text(Ad)',
  'example.com##+js(set-constant, a, 1)'
].join('\n'));
const compiledBlob = compiledSource.toCompiled();
assert.strictEqual(compiledBlob.v, FilterEngine.COMPILED_VERSION, 'compiled version present');
assert.strictEqual(typeof compiledBlob.cap, 'number', 'compiled capabilities present');
assert.ok(Array.isArray(compiledBlob.d), 'compiled diagnostics present');
const compiledEngine = new FilterEngine(null, null, { validate: () => null });
assert.strictEqual(compiledEngine.loadCompiled(compiledBlob), true, 'compiled blob loads');
assert.strictEqual(compiledEngine.matchRequest('https://ads.example/app.js', 'script', 'https://news.test/').blocked,
  true, 'compiled network rule matches');
assert.strictEqual(compiledEngine.matchRequest('https://ads.example/allow.js', 'script', 'https://news.test/').blocked,
  false, 'compiled exception matches');
assert.deepStrictEqual(Array.from(compiledEngine.getCosmetic('example.com')).sort(), ['.ad'],
  'compiled cosmetic rules match');
assert.strictEqual(compiledEngine.getProcedural('example.com').length, 1, 'compiled procedural rule matches');
assert.strictEqual(compiledEngine.scriptletRules.length, 1, 'compiled scriptlet rule loads');
assert.strictEqual(compiledEngine.getScriptletPayload().length, 1, 'compiled scriptlet payload available');
assert.strictEqual(compiledEngine.getCapabilities() & FilterEngine.CAP.SCRIPTLET, FilterEngine.CAP.SCRIPTLET, 'scriptlet capability set');
assert.strictEqual(compiledEngine.getCapabilities() & FilterEngine.CAP.REDIRECT, FilterEngine.CAP.REDIRECT, 'redirect capability set');

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

const popupModifierEngine = new FilterEngine(null, alias => CspResources.resolve(alias));
popupModifierEngine.load([
  '||cdn.example^$popup,csp=no-script',
  '||cdn.example^$popup,removeparam=utm_source',
  '||cdn.example^$popup,removeheader=request:cookie',
  '||doc.example^$document,redirect=noopjs'
].join('\n'));
assert.deepStrictEqual(
  Array.from(popupModifierEngine.matchCsp(
    'https://cdn.example/app.js', 'document', 'https://source.example/').directives),
  [], '$popup rules never inject CSP on ordinary documents');
assert.deepStrictEqual(
  Array.from(popupModifierEngine.matchRemoveparam(
    'https://cdn.example/app.js?utm_source=x', 'document', 'https://source.example/').params),
  [], '$popup rules never remove parameters on ordinary documents');
assert.deepStrictEqual(
  Array.from(popupModifierEngine.matchRemoveheader(
    'https://cdn.example/app.js', 'document', 'https://source.example/').headers),
  [], '$popup rules never remove headers on ordinary documents');
const documentRedirect = popupModifierEngine.matchRequest(
  'https://doc.example/landing', mapResourceType('main_frame'), 'https://source.example/');
assert.strictEqual(documentRedirect.blocked, true, '$document redirect rules still block navigation');
assert.strictEqual(documentRedirect.redirect, null,
  'matchRequest never returns a redirect target for a navigation');

const plainEngine = new FilterEngine();
plainEngine.load('example.net*track');
assert.strictEqual(
  plainEngine.matchRequest('https://example.net/landing', mapResourceType('main_frame'), '').blocked,
  false, 'plain rules never block documents');

// WildFire redirect engine: rules may only choose WildFire-owned data-URI
// resources, never a URL supplied by the filter itself.
assert.ok(RedirectResources.hasAlias('noopjs'), 'known redirect alias is registered');
assert.ok(RedirectResources.hasAlias('NOOPJS'), 'alias lookup is case-insensitive');
assert.strictEqual(RedirectResources.hasAlias('unknown'), false,
  'unknown redirect alias is not registered');
assert.strictEqual(RedirectResources.resolve('noopjs'),
  'data:application/javascript;charset=utf-8,', 'noopjs resolves to an empty script');
assert.ok(RedirectResources.resolve('1x1.gif').startsWith('data:image/gif;base64,'),
  'image alias resolves to a bundled transparent pixel');
assert.strictEqual(RedirectResources.resolve('missing'), '',
  'unknown alias resolves to no redirect');
assert.ok(RedirectResources.aliases.every(alias =>
  RedirectResources.resolve(alias).startsWith('data:')),
  'every registered resource is a data: URI');

const redirectEngine = new FilterEngine();
redirectEngine.load([
  '||ads.example^$script,redirect=noopjs',
  '||img.example^$image,redirect=1x1.gif',
  '@@||keep.ads.example^$script',
  '/track\\.example\\/pixel\\/([^/]+)\\.js/$script,redirect-rule=tagged.svg',
  '||unknown.example^$script,redirect=missing'
].join('\n'));

// Mirrors the synchronous composition in background.onBeforeRequest.
function redirectFor(result) {
  return result.redirect
    ? RedirectResources.resolve(result.redirect.alias, result.redirect.captures)
    : '';
}

const scriptRedirect = redirectEngine.matchRequest(
  'https://ads.example/app.js', mapResourceType('script'), '');
assert.strictEqual(scriptRedirect.blocked, true, 'redirect rule still blocks the request');
assert.strictEqual(scriptRedirect.redirect.alias, 'noopjs', 'redirect alias is parsed');
assert.strictEqual(redirectFor(scriptRedirect), 'data:application/javascript;charset=utf-8,',
  'noopjs redirect is served from WildFire resources');

const imageRedirect = redirectEngine.matchRequest(
  'https://img.example/pixel.png', mapResourceType('image'), '');
assert.strictEqual(imageRedirect.blocked, true, 'image redirect rule matches');
assert.ok(redirectFor(imageRedirect).startsWith('data:image/gif;base64,'),
  'image redirect serves a local transparent pixel');

assert.strictEqual(redirectEngine.matchRequest(
  'https://ads.example/app.js', mapResourceType('image'), '').blocked, false,
  'redirect rule respects type options');
assert.strictEqual(redirectEngine.matchRequest(
  'https://ads.example/landing', mapResourceType('main_frame'), '').blocked, false,
  'redirect rules do not block documents');

const exceptedRedirect = redirectEngine.matchRequest(
  'https://keep.ads.example/app.js', mapResourceType('script'), '');
assert.strictEqual(exceptedRedirect.blocked, false, 'exception still wins over a redirect rule');
assert.strictEqual(exceptedRedirect.redirect, null, 'exceptions carry no redirect');

const ruleRedirect = redirectEngine.matchRequest(
  'https://track.example/pixel/hello-world.js', mapResourceType('script'), '');
assert.deepStrictEqual(Array.from(ruleRedirect.redirect.captures), ['hello-world'],
  '$redirect-rule captures regex groups');
assert.ok(redirectFor(ruleRedirect).includes('hello-world'),
  'captures are substituted into the redirect resource');
assert.ok(redirectFor(ruleRedirect).includes('%3Ctitle%3E'),
  'template body stays a data: URI');

const encodedRedirect = redirectEngine.matchRequest(
  'https://track.example/pixel/a&b<c.js', mapResourceType('script'), '');
assert.ok(redirectFor(encodedRedirect).includes('a%26b%3Cc'),
  'captures are percent-encoded before substitution');
assert.strictEqual(redirectFor(encodedRedirect).includes('&b<c'), false,
  'a redirect capture cannot inject raw markup');

const unknownRedirect = redirectEngine.matchRequest(
  'https://unknown.example/x.js', mapResourceType('script'), '');
assert.strictEqual(unknownRedirect.blocked, true, 'unknown-alias rule still blocks');
assert.strictEqual(redirectFor(unknownRedirect), '',
  'unknown alias falls back to a plain cancel');

// Procedural cosmetic selectors are parsed into trees and evaluated by DOM code.
const procEngine = new FilterEngine();
procEngine.load([
  'example.com##.ad:has-text("Buy now")',
  'example.com##.promo:matches-path(/deals/)',
  'example.com##.box:has(.inner)',
  'example.com##.deep:has(.child:has-text("x"))',
  'example.com##.also:has-text(/SALE/i):has(.tag)',
  '##.generic:has-text("hi")',
  'example.com##.bad:has-text("unclosed',
  'example.com##.bad:matches-path(/(a+)+/)',
  'example.com#@#.ad:has-text("Buy now")'
].join('\n'));
assert.strictEqual(procEngine.counts.cosmetic, 7, 'valid procedural rules are counted');
assert.strictEqual(procEngine.rejectedCosmetic.length, 2, 'malformed procedural rules are rejected');
assert.ok(procEngine.rejectedCosmetic.some(entry => entry.reason === 'unbalanced procedural selector'),
  'unbalanced procedural selector is rejected');
assert.ok(procEngine.rejectedCosmetic.some(entry => entry.reason === 'invalid :matches-path regex'),
  'unsafe procedural regex is rejected');

const procOnExample = procEngine.getProcedural('example.com');
assert.strictEqual(procOnExample.length, 5, 'domain exception removes one procedural rule');
assert.deepStrictEqual(Array.from(procOnExample, rule => rule.base),
  ['.generic', '.promo', '.box', '.deep', '.also'], 'generic rules merge with domain rules');
assert.deepStrictEqual(Array.from(procEngine.getCosmetic('example.com')), [],
  'procedural rules are not injected as CSS');
assert.deepStrictEqual(Array.from(procEngine.getProcedural('other.net'), rule => rule.base), ['.generic'],
  'generic procedural rules apply to every host');

const promoRule = procOnExample.find(rule => rule.base === '.promo');
assert.strictEqual(promoRule.steps[0].op, 'matches-path', 'matches-path is parsed');
assert.strictEqual(promoRule.steps[0].matcher.source, 'deals', 'procedural regex source is stored');
assert.strictEqual(promoRule.steps[0].matcher.flags, 'i', 'procedural regex keeps safe flags');
const hasRule = procOnExample.find(rule => rule.base === '.deep');
assert.strictEqual(hasRule.steps[0].op, 'has', ':has is parsed');
assert.strictEqual(hasRule.steps[0].inner.base, '.child', ':has stores its inner tree');
assert.strictEqual(hasRule.steps[0].inner.steps[0].op, 'has-text',
  'nested procedural selectors are parsed');

function stubDescendants(nodes) {
  return nodes.reduce((all, node) => {
    if (!node || node.nodeType === 3) return all;
    return all.concat(node, stubDescendants(node.childNodes || []));
  }, []);
}

function stubNode(selector, text, children) {
  const list = children || [];
  const node = {
    selector,
    textContent: text || '',
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    matches: query => {
      try { return typeof query === 'string' && query.split(',').map(s=>s.trim()).includes(selector); } catch (e) { return false; }
    },
    querySelector: query => {
      const all = stubDescendants(list);
      return (query === '*' ? all[0] : all.find(item => item.selector === query)) || null;
    },
    querySelectorAll: query => {
      const all = stubDescendants(list);
      return query === '*' ? all : all.filter(item => item.selector === query);
    }
  };
  list.forEach(child => {
    child.parentElement = node;
    node.childNodes.push(child);
  });
  return node;
}

const innerNode = stubNode('.inner', '');
const adNode = stubNode('.ad', 'Buy now');
const promoNode = stubNode('.promo', 'Special deals today');
const boxNode = stubNode('.box', '', [innerNode]);
const childNode = stubNode('.child', 'x marks it');
const deepNode = stubNode('.deep', '', [childNode]);
const saleNode = stubNode('.also', 'BIG SALE', [stubNode('.tag', '')]);
const genericNode = stubNode('.generic', 'Say hi there');
const procRoot = stubNode('body', '', [adNode, promoNode, boxNode, deepNode, saleNode, genericNode]);

function selected(base, path) {
  const rule = procOnExample.find(item => item.base === base);
  return WildFireProcedural.select(procRoot, rule, path);
}
assert.strictEqual(selected('.promo', '/deals/list')[0], promoNode,
  'matches-path uses the current location path');
assert.strictEqual(selected('.promo', '/nothing').length, 0,
  'matches-path rejects a non-matching path');
assert.strictEqual(selected('.box', '/')[0], boxNode, ':has checks descendants');
assert.strictEqual(selected('.deep', '/')[0], deepNode,
  'nested procedural :has selectors are evaluated');
assert.strictEqual(selected('.also', '/')[0], saleNode,
  'regex has-text is case-insensitive and composes with :has');
assert.strictEqual(selected('.generic', '/')[0], genericNode,
  'literal has-text is case-insensitive');
assert.strictEqual(WildFireProcedural.select(procRoot, { base: '[', steps: [] }, '/').length, 0,
  'an invalid base selector yields no matches');
assert.strictEqual(WildFireProcedural.matches(boxNode, { plain: '.inner' }, '/'), true,
  'plain :has inner trees match descendants');

// Firefox-native fast path: Gecko handles plain :has() and path-only rules as
// CSS, leaving JS only for text-dependent rules.
const classify = WildFireProcedural.classify;
const boxClass = classify(procOnExample.find(rule => rule.base === '.box'), '/');
assert.strictEqual(boxClass.mode, 'css', 'plain :has compiles to native CSS');
assert.strictEqual(boxClass.selector, '.box:has(.inner)');
assert.strictEqual(classify(promoRule, '/deals/list').mode, 'css',
  'a matching path-only rule becomes plain CSS');
assert.strictEqual(classify(promoRule, '/deals/list').selector, '.promo');
assert.strictEqual(classify(promoRule, '/nothing').mode, 'skip',
  'a non-matching path is skipped before any DOM work');
const deepClass = classify(hasRule, '/');
assert.strictEqual(deepClass.mode, 'js', 'text-dependent rules stay in JS');
assert.strictEqual(deepClass.prefilter, '.deep:has(.child)',
  'plain :has narrows the JS candidate set natively');
assert.strictEqual(deepClass.steps.length, 1, 'path steps are hoisted out of node checks');
assert.strictEqual(classify(procOnExample.find(rule => rule.base === '.also'), '/').prefilter,
  '.also:has(.tag)', 'native prefilter composes with text steps');
assert.strictEqual(
  classify({ base: '.a, .b', steps: [{ op: 'has', inner: { plain: '.inner' } }] }, '/').selector,
  ':is(.a, .b):has(.inner)', 'a selector-list base is scoped before appending :has');

const originalSupports = context.CSS.supports;
context.CSS.supports = () => false;
assert.strictEqual(classify(procOnExample.find(rule => rule.base === '.box'), '/').mode, 'js',
  'unsupported selectors fall back to JS evaluation');
context.CSS.supports = originalSupports;

let queryCalls = [];
const groupedRoot = {
  querySelectorAll: query => {
    queryCalls.push(query);
    return query === '.ad' ? [adNode, promoNode] : [];
  }
};
const grouped = WildFireProcedural.selectAll(groupedRoot, [
  { rule: { base: '.ad', steps: [{ op: 'has-text', matcher: { type: 'text', value: 'Buy' } }] } },
  { rule: { base: '.ad', steps: [{ op: 'has-text', matcher: { type: 'text', value: 'Special' } }] } }
], '/');
assert.deepStrictEqual(queryCalls, ['.ad'], 'rules sharing a base use one querySelectorAll');
assert.strictEqual(grouped.length, 2, 'each rule still evaluates its own steps');

queryCalls = [];
WildFireProcedural.selectAll(groupedRoot, [
  { rule: hasRule, steps: deepClass.steps, prefilter: deepClass.prefilter },
  { rule: { base: '.deep', steps: [] }, prefilter: deepClass.prefilter }
], '/');
assert.deepStrictEqual(queryCalls, ['.deep:has(.child)'],
  'a native prefilter groups rules with different bases');

// :contains() searches the subtree, :has-text() only the element's own text,
// and :nth-ancestor() changes which node is hidden.
const treeEngine = new FilterEngine();
treeEngine.load([
  'example.com##.target:contains("hit")',
  'example.com##.target:contains(/hit/i)',
  'example.com##.target:has-text("hit")',
  'example.com##.leaf:nth-ancestor(2)',
  'example.com##.target:has(.leaf:nth-ancestor(2))',
  'example.com##.bad:nth-ancestor(0)',
  'example.com##.bad:nth-ancestor(9)',
  'example.com##.bad:contains(/unclosed'
].join('\n'));
assert.strictEqual(treeEngine.counts.cosmetic, 5, 'valid new procedural rules are counted');
assert.strictEqual(treeEngine.rejectedCosmetic.length, 3, 'invalid new procedural rules are rejected');
assert.strictEqual(treeEngine.rejectedCosmetic.filter(entry => entry.reason === 'invalid :nth-ancestor argument').length,
  2, 'out-of-range ancestor counts are rejected');

const treeRules = treeEngine.getProcedural('example.com');
const leafNode = stubNode('.leaf', 'hit');
const midNode = stubNode('.mid', '', [leafNode]);
const targetNode = stubNode('.target', '', [midNode]);
const treeRoot = stubNode('body', '', [targetNode]);
const containsRule = treeRules.find(rule => rule.steps.some(step => step.op === 'contains' && step.matcher.type === 'text'));
const regexContainsRule = treeRules.find(rule => rule.steps.some(step => step.op === 'contains' && step.matcher.type === 'regex'));
const ownTextRule = treeRules.find(rule => rule.steps.some(step => step.op === 'has-text'));
const nthRule = treeRules.find(rule => rule.base === '.leaf');
const nestedNthRule = treeRules.find(rule => rule.steps.some(step => step.op === 'has'));

function treeSelected(rule) {
  return WildFireProcedural.select(treeRoot, rule, '/');
}
assert.strictEqual(treeSelected(containsRule)[0], targetNode,
  ':contains matches text found in a descendant');
assert.strictEqual(treeSelected(regexContainsRule)[0], targetNode,
  ':contains accepts a safe regex');
assert.strictEqual(treeSelected(ownTextRule).length, 0,
  ':has-text only matches the element own text');
assert.strictEqual(treeSelected(nthRule)[0], targetNode,
  ':nth-ancestor hides the nth parent rather than the matched child');
assert.strictEqual(treeSelected(nestedNthRule)[0], targetNode,
  ':nth-ancestor works inside :has');
assert.strictEqual(classify(containsRule, '/').mode, 'js', ':contains stays in the JS path');
assert.strictEqual(classify(nthRule, '/').mode, 'js', ':nth-ancestor stays in the JS path');

  const upEngine = new FilterEngine();
  upEngine.load([
    'example.com##.leaf:upward(2)',
    'example.com##.leaf:upward(.target)',
    'example.com##.bad:upward()'
  ].join('\n'));
  assert.strictEqual(upEngine.getProcedural('example.com').length, 2, 'upward(n) and upward(selector) parse');
  assert.strictEqual(upEngine.rejectedCosmetic.length, 1, 'invalid upward rejected');
  const upRule = upEngine.getProcedural('example.com').find(rule => rule.steps.some(step => step.op === 'upward' && step.selector === '.target'));
  const upNRule = upEngine.getProcedural('example.com').find(rule => rule.steps.some(step => step.op === 'nth-ancestor' && step.count === 2));
  assert.strictEqual(WildFireProcedural.select(treeRoot, upNRule, '/')[0], targetNode, 'upward(2) hides ancestor');
  const upSel = WildFireProcedural.select(treeRoot, upRule, '/');
  assert.strictEqual(upSel.length, 1, 'upward(selector) selects one ancestor');
  assert.strictEqual(upSel[0], targetNode, 'upward(selector) hides ancestor');

  const minEngine = new FilterEngine();
  minEngine.load(['example.com##.ad:min-text-length(10)', 'example.com##.ad:min-text-length(0)'].join('\n'));
  assert.strictEqual(minEngine.getProcedural('example.com').length, 1, 'min-text-length parses');
  assert.strictEqual(minEngine.rejectedCosmetic.length, 1, 'invalid min-text-length rejected');
  const shortNode = stubNode('.ad', 'short');
  const longNode = stubNode('.ad', 'long enough text');
  const minRoot = stubNode('body', '', [shortNode, longNode]);
  const minRule = minEngine.getProcedural('example.com')[0];
  const minSel = WildFireProcedural.select(minRoot, minRule, '/');
  assert.strictEqual(JSON.stringify(minSel.map(n => n.textContent)), JSON.stringify(['long enough text']), 'min-text-length filters by text length');

  const attrEngine = new FilterEngine();
  attrEngine.load([
    'example.com##div:matches-attr(data-ad)',
    'example.com##div:matches-attr(data-ad=/^yes/)',
    'example.com##div:matches-attr(bad name)'
  ].join('\n'));
  assert.strictEqual(attrEngine.getProcedural('example.com').length, 2, 'matches-attr parses');
  assert.strictEqual(attrEngine.rejectedCosmetic.length, 1, 'invalid matches-attr rejected');
  const a1 = stubNode('div', ''); a1.getAttribute = n => n==='data-ad' ? 'yes-1' : null;
  const a2 = stubNode('div', ''); a2.getAttribute = n => n==='data-ad' ? 'no' : null;
  const a3 = stubNode('div', ''); a3.getAttribute = () => null;
  const attrRoot = stubNode('body', '', [a1,a2,a3]);
  const attrRules = attrEngine.getProcedural('example.com');
  const hasRuleA = attrRules.find(r => r.steps.some(s => s.op==='matches-attr' && !s.matcher));
  const reRuleA = attrRules.find(r => r.steps.some(s => s.op==='matches-attr' && s.matcher));
  assert.strictEqual(WildFireProcedural.select(attrRoot, hasRuleA, '/').length, 2, 'matches-attr presence');
  assert.strictEqual(WildFireProcedural.select(attrRoot, reRuleA, '/').length, 1, 'matches-attr regex');
  const attrPresence = attrEngine.getProcedural('example.com').find(r => r.steps.length===1 && r.steps[0].op==='matches-attr' && !r.steps[0].matcher);
  const attrClass = WildFireProcedural.classify(attrPresence, '/');
  assert.strictEqual(attrClass.mode, 'css', 'matches-attr presence compiles to native CSS');
  assert.strictEqual(attrClass.selector, 'div[data-ad]', 'matches-attr native selector');
  const litEngine = new FilterEngine();
  litEngine.load('example.com##div:matches-attr(data-ad="promo")');
  const litRule = litEngine.getProcedural('example.com')[0];
  const litClass = WildFireProcedural.classify(litRule, '/');
  assert.strictEqual(litClass.mode, 'css', 'matches-attr literal compiles to native CSS');
  assert.strictEqual(litClass.selector, 'div[data-ad="promo"]', 'matches-attr literal selector');
  const mixed = { base: 'div', steps: [{ op: 'matches-attr', name: 'data-ad', matcher: null }, { op: 'min-text-length', length: 10 }] };
  const mixedClass = WildFireProcedural.classify(mixed, '/');
  assert.strictEqual(mixedClass.mode, 'js', 'mixed rule stays JS');
  assert.strictEqual(mixedClass.prefilter, 'div[data-ad]', 'native self fragments prefilter JS rules');

  const cssEngine = new FilterEngine();
  cssEngine.load([
    'example.com##div:matches-css(position: fixed)',
    'example.com##div:matches-css(color: /^rgb\\(255/)',
    'example.com##div:matches-css-before(content: "ad")',
    'example.com##div:matches-css(bad argument)'
  ].join('\n'));
  assert.strictEqual(cssEngine.getProcedural('example.com').length, 3, 'matches-css variants parse');
  assert.strictEqual(cssEngine.rejectedCosmetic.length, 1, 'invalid matches-css rejected');
  const cssRules = cssEngine.getProcedural('example.com');
  const fixedRule = cssRules.find(r => r.steps[0].name === 'position');
  const colorRule = cssRules.find(r => r.steps[0].name === 'color');
  const beforeRule = cssRules.find(r => r.steps[0].pseudo === '::before');
  assert.strictEqual(fixedRule.steps[0].matcher.type, 'text', 'matches-css literal matcher');
  assert.strictEqual(colorRule.steps[0].matcher.type, 'regex', 'matches-css regex matcher');
  assert.strictEqual(beforeRule.steps[0].pseudo, '::before', 'matches-css-before targets pseudo');

  // Fake computed style reached through the node, keeping procedural.js DOM-only.
  function styledNode(selector, styles, pseudoStyles) {
    const node = stubNode(selector, '');
    node.ownerDocument = {
      defaultView: {
        getComputedStyle: (el, pseudo) => ({
          getPropertyValue: name => {
            const map = pseudo ? (pseudoStyles || {}) : (styles || {});
            return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : '';
          }
        })
      }
    };
    return node;
  }
  const fixedNode = styledNode('div', { position: 'fixed' });
  const staticNode = styledNode('div', { position: 'static' });
  const redNode = styledNode('div', { color: 'rgb(255, 0, 0)' });
  const cssRoot = stubNode('body', '', [fixedNode, staticNode, redNode]);
  assert.strictEqual(WildFireProcedural.select(cssRoot, fixedRule, '/').length, 1, 'matches-css literal selects fixed node');
  assert.strictEqual(WildFireProcedural.select(cssRoot, fixedRule, '/')[0], fixedNode, 'matches-css hides the matching node');
  assert.strictEqual(WildFireProcedural.select(cssRoot, colorRule, '/').length, 1, 'matches-css regex selects red node');
  const cssClass = WildFireProcedural.classify(fixedRule, '/');
  assert.strictEqual(cssClass.mode, 'js', 'matches-css stays JS (dynamic computed style)');
  const beforeNode = styledNode('div', {}, { content: '"ad"' });
  const beforeRoot = stubNode('body', '', [beforeNode]);
  assert.strictEqual(WildFireProcedural.select(beforeRoot, beforeRule, '/').length, 1, 'matches-css-before reads pseudo style');
  const cssBlob = cssEngine.toCompiled();
  const cssReload = new FilterEngine();
  assert.strictEqual(cssReload.loadCompiled(cssBlob), true, 'matches-css compiled round-trip');
  assert.strictEqual(cssReload.getProcedural('example.com').length, 3, 'matches-css survives compiled load');

  const xpEngine = new FilterEngine();
  xpEngine.load([
    'example.com##div:xpath(.//span)',
    'example.com##div:xpath(ancestor::section[1])',
    'example.com##div:xpath()',
    'example.com##div:xpath(//div[@class="ad")',
    'example.com##div:xpath(//div[@id="' + 'z'.repeat(600) + '"])'
  ].join('\n'));
  assert.strictEqual(xpEngine.getProcedural('example.com').length, 2, 'xpath parses valid expressions');
  assert.strictEqual(xpEngine.rejectedCosmetic.length, 3, 'empty/unbalanced/overlong xpath rejected');
  const spanRule = xpEngine.getProcedural('example.com').find(r => r.steps[0].expr === './/span');
  assert.strictEqual(spanRule.steps[0].op, 'xpath', 'xpath step parsed');

  // Fake native XPath reached through the node keeps procedural.js DOM-only.
  // ORDERED_NODE_SNAPSHOT_TYPE (7) returns a native snapshot; WildFire keeps
  // only element nodes from it.
  const spanTarget = stubNode('span', ''); spanTarget.nodeType = 1;
  const textTarget = stubNode('#text', ''); textTarget.nodeType = 3;
  const docFor = targets => ({
    evaluate: (expr, context, ns, type) => {
      assert.strictEqual(type, 7, 'xpath uses ORDERED_NODE_SNAPSHOT_TYPE (native node-set)');
      return { snapshotLength: targets.length, snapshotItem: index => targets[index] };
    }
  });
  const baseA = stubNode('div', ''); baseA.ownerDocument = docFor([spanTarget]);
  const baseB = stubNode('div', ''); baseB.ownerDocument = docFor([textTarget]);
  const baseC = stubNode('div', ''); baseC.ownerDocument = { evaluate: () => { throw new Error('bad xpath'); } };
  const baseD = stubNode('div', ''); // no ownerDocument -> no match, no throw
  const xpRoot = stubNode('body', '', [baseA, baseB, baseC, baseD]);
  const xpSel = WildFireProcedural.select(xpRoot, spanRule, '/');
  assert.strictEqual(xpSel.length, 1, 'xpath hides only element results');
  assert.strictEqual(xpSel[0], spanTarget, 'xpath target is the returned element node');
  assert.strictEqual(WildFireProcedural.classify(spanRule, '/').mode, 'js', 'xpath stays JS-driven (native evaluate per node)');
  const xpBlob = xpEngine.toCompiled();
  const xpReload = new FilterEngine();
  assert.strictEqual(xpReload.loadCompiled(xpBlob), true, 'xpath compiled round-trip');
  assert.strictEqual(xpReload.getProcedural('example.com').length, 2, 'xpath survives compiled load');

  // Multi-target parity: every element result is hidden, not just the first.
  const multiRule = { base: 'div', steps: [{ op: 'xpath', expr: './/span' }] };
  const m1 = stubNode('span', ''); m1.nodeType = 1;
  const m2 = stubNode('span', ''); m2.nodeType = 1;
  const m3 = stubNode('span', ''); m3.nodeType = 1;
  const multiBase = stubNode('div', ''); multiBase.ownerDocument = docFor([m1, m2, m3]);
  const multiSel = WildFireProcedural.select(stubNode('body', '', [multiBase]), multiRule, '/');
  assert.strictEqual(multiSel.length, 3, 'xpath hides all element results');
  assert.ok(multiSel[0] === m1 && multiSel[1] === m2 && multiSel[2] === m3, 'xpath preserves node-set order');

  // Non-element results are dropped even inside a mixed node-set.
  const mixedBase = stubNode('div', ''); mixedBase.ownerDocument = docFor([m1, textTarget, m2]);
  const mixedSel = WildFireProcedural.select(stubNode('body', '', [mixedBase]), multiRule, '/');
  assert.strictEqual(mixedSel.length, 2, 'xpath drops non-element results from a mixed set');
  assert.ok(mixedSel[0] === m1 && mixedSel[1] === m2, 'xpath keeps the element results');

  // The hide set stays bounded even when the native node-set is huge.
  const many = Array.from({ length: 300 }, () => { const n = stubNode('span', ''); n.nodeType = 1; return n; });
  const capBase = stubNode('div', ''); capBase.ownerDocument = docFor(many);
  const capSel = WildFireProcedural.select(stubNode('body', '', [capBase]), multiRule, '/');
  assert.strictEqual(capSel.length, 256, 'xpath result set is capped for safety');

  // A testing step after :xpath() filters the expanded set.
  const shortSpan = stubNode('span', 'hi'); shortSpan.nodeType = 1;
  const longSpan = stubNode('span', 'long enough text'); longSpan.nodeType = 1;
  const filterBase = stubNode('div', ''); filterBase.ownerDocument = docFor([shortSpan, longSpan]);
  const filterRule = { base: 'div', steps: [{ op: 'xpath', expr: './/span' }, { op: 'min-text-length', length: 10 }] };
  const filterSel = WildFireProcedural.select(stubNode('body', '', [filterBase]), filterRule, '/');
  assert.strictEqual(filterSel.length, 1, 'steps after xpath filter the node-set');
  assert.strictEqual(filterSel[0], longSpan, 'only the matching xpath result survives the filter');

  const notEngine = new FilterEngine();
  notEngine.load([
    'example.com##div:not(:has-text(Ad))',
    'example.com##div:not(:has(.x))',
    'example.com##div:not(.plain)',
    'example.com##div:not(:min-text-length(0))',
    'example.com##div:not(:nth-ancestor(99))'
  ].join('\n'));
  assert.strictEqual(notEngine.getProcedural('example.com').length, 2, 'procedural :not parses');
  assert.strictEqual(notEngine.rejectedCosmetic.length, 2, 'invalid procedural :not operands rejected');
  assert.ok(notEngine.getCosmetic('example.com').includes('div:not(.plain)'), 'plain :not stays native CSS');
  const notRules = notEngine.getProcedural('example.com');
  const notTextRule = notRules.find(r => r.steps[0].op === 'not' && r.steps[0].inner.steps[0].op === 'has-text');
  const notHasRule = notRules.find(r => r.steps[0].op === 'not' && r.steps[0].inner.steps[0].op === 'has');
  assert.ok(notTextRule && notHasRule, ':not stores its inner procedural tree');

  const adDiv = stubNode('div', 'Ad text');
  const cleanDiv = stubNode('div', 'clean');
  const notTextRoot = stubNode('body', '', [adDiv, cleanDiv]);
  const notTextSel = WildFireProcedural.select(notTextRoot, notTextRule, '/');
  assert.strictEqual(notTextSel.length, 1, ':not(:has-text) hides only non-matching nodes');
  assert.strictEqual(notTextSel[0], cleanDiv, ':not(:has-text) excludes the Ad node');

  const withX = stubNode('div', '', [stubNode('.x', '')]);
  const withoutX = stubNode('div', '');
  const notHasRoot = stubNode('body', '', [withX, withoutX]);
  const notHasSel = WildFireProcedural.select(notHasRoot, notHasRule, '/');
  assert.strictEqual(notHasSel.length, 1, ':not(:has) hides only nodes without the descendant');
  assert.strictEqual(notHasSel[0], withoutX, ':not(:has) excludes the node containing .x');
  // A fully-native operand compiles to Gecko CSS (:has inside :not is native);
  // the JS select() result above matches that native semantics.
  const notHasClass = WildFireProcedural.classify(notHasRule, '/');
  assert.strictEqual(notHasClass.mode, 'css', ':not(:has(plain)) compiles to native CSS');
  assert.strictEqual(notHasClass.selector, 'div:not(*:has(.x))', ':not(:has) native selector');
  const notTextClass = WildFireProcedural.classify(notTextRule, '/');
  assert.strictEqual(notTextClass.prefilter, '', 'procedural :not contributes no prefilter');
  // A native :not fragment is a correct (negated) prefilter for a mixed rule.
  const mixedNotRule = { base: 'div', steps: [notHasRule.steps[0], { op: 'has-text', matcher: { type: 'text', value: 'Ad' } }] };
  const mixedNotClass = WildFireProcedural.classify(mixedNotRule, '/');
  assert.strictEqual(mixedNotClass.mode, 'js', 'mixed :not + text stays JS');
  assert.strictEqual(mixedNotClass.prefilter, 'div:not(*:has(.x))', 'native :not prefilters the JS pass');
  assert.strictEqual(WildFireProcedural.classify(notTextRule, '/').mode, 'js', ':not stays JS-evaluated');
  const notBlob = notEngine.toCompiled();
  const notReload = new FilterEngine();
  assert.strictEqual(notReload.loadCompiled(notBlob), true, ':not compiled round-trip');
  assert.strictEqual(notReload.getProcedural('example.com').length, 2, ':not survives compiled load');

  const mediaEngine = new FilterEngine();
  mediaEngine.load([
    'example.com##div:matches-media((max-width: 1000px))',
    'example.com##div:matches-media()',
    'example.com##div:matches-media(' + 'x'.repeat(300) + ')'
  ].join('\n'));
  assert.strictEqual(mediaEngine.getProcedural('example.com').length, 1, 'matches-media parses');
  assert.strictEqual(mediaEngine.rejectedCosmetic.length, 2, 'empty/overlong matches-media rejected');
  const mediaRule = mediaEngine.getProcedural('example.com')[0];
  assert.strictEqual(mediaRule.steps[0].op, 'matches-media', 'matches-media step parsed');
  assert.strictEqual(mediaRule.steps[0].query, '(max-width: 1000px)', 'matches-media stores the media query');

  // Fake native matchMedia reached through the node keeps procedural.js DOM-only.
  const mediaNode = (selector, matches) => {
    const node = stubNode(selector, '');
    node.ownerDocument = { defaultView: { matchMedia: () => ({ matches }) } };
    return node;
  };
  const narrowNode = mediaNode('div', true);
  const wideNode = mediaNode('div', false);
  const mediaRoot = stubNode('body', '', [narrowNode, wideNode]);
  const mediaSel = WildFireProcedural.select(mediaRoot, mediaRule, '/');
  assert.strictEqual(mediaSel.length, 1, 'matches-media hides only when the query matches');
  assert.strictEqual(mediaSel[0], narrowNode, 'matches-media selects the matching-viewport node');

  const throwNode = stubNode('div', '');
  throwNode.ownerDocument = { defaultView: { matchMedia: () => { throw new Error('bad query'); } } };
  const noViewNode = stubNode('div', '');
  const mediaSafeRoot = stubNode('body', '', [throwNode, noViewNode]);
  assert.strictEqual(WildFireProcedural.select(mediaSafeRoot, mediaRule, '/').length, 0, 'invalid query / missing view never matches or throws');
  assert.strictEqual(WildFireProcedural.classify(mediaRule, '/').mode, 'js', 'matches-media stays JS (viewport-dependent)');
  const mediaBlob = mediaEngine.toCompiled();
  const mediaReload = new FilterEngine();
  assert.strictEqual(mediaReload.loadCompiled(mediaBlob), true, 'matches-media compiled round-trip');
  assert.strictEqual(mediaReload.getProcedural('example.com').length, 1, 'matches-media survives compiled load');

const resolveCsp = alias => CspResources.resolve(alias);
// Arrays built inside the vm realm have a different prototype than Node's.
const cspFor = (instance, url, type, documentUrl) =>
  Array.from(instance.matchCsp(url, type, documentUrl).directives);
const cspEngine = new FilterEngine(null, resolveCsp);
cspEngine.load([
  '||tracker.example^$csp=no-script',
  '||cdn.example^$script,csp=no-inline-script',
  '||frame.example^$csp=no-frame,domain=page.example',
  '||tracker.example^$csp=default-src https://evil.example',
  '||evil.example^$script,csp=report-uri https://collect.example'
].join('\n'));
assert.strictEqual(cspEngine.counts.csp, 3, 'valid $csp rules are counted');
assert.strictEqual(cspEngine.rejectedCsp.length, 2,
  'aliases that are not curated are rejected');
assert.ok(cspEngine.rejectedCsp.every(entry => /^unknown CSP alias/.test(entry.reason)),
  'rejected aliases record a clear reason');
assert.deepStrictEqual(
  cspFor(cspEngine, 'https://tracker.example/lib.js', 'script', 'https://page.example/'),
  ["script-src 'none'"], 'a curated alias resolves to its directive');
assert.strictEqual(
  cspEngine.matchRequest('https://tracker.example/lib.js', 'script', 'https://page.example/').blocked,
  false, '$csp rules never cancel requests');
assert.deepStrictEqual(
  cspFor(cspEngine, 'https://cdn.example/lib.js', 'script', 'https://page.example/'),
  ['script-src http: https:'], '$csp accepts resource type options');
assert.deepStrictEqual(
  cspFor(cspEngine, 'https://cdn.example/pic.png', 'image', 'https://page.example/'),
  [], 'a $csp type option limits which responses are tightened');
assert.deepStrictEqual(
  cspFor(cspEngine, 'https://frame.example/embed', 'document', 'https://page.example/'),
  ["frame-src 'none'"], '$csp applies to main documents without $document');
assert.deepStrictEqual(
  cspFor(cspEngine, 'https://frame.example/embed', 'document', 'https://other.example/'),
  [], '$csp respects $domain scoping');

const cspExceptionEngine = new FilterEngine(null, resolveCsp);
cspExceptionEngine.load([
  '||ads.example^$csp=no-script',
  '@@||ads.example^$script',
  '||promo.example^$csp=no-frame',
  '||promo.example^$csp=no-script',
  '@@||promo.example^$csp=no-frame'
].join('\n'));
const plainException = cspExceptionEngine.matchCsp(
  'https://ads.example/a.js', 'script', 'https://page.example/');
assert.strictEqual(plainException.exception, false, 'a plain exception does not cover CSP rules');
assert.deepStrictEqual(Array.from(plainException.directives), ["script-src 'none'"],
  'a plain network exception leaves CSP injection intact');
assert.deepStrictEqual(
  cspFor(cspExceptionEngine, 'https://promo.example/', 'document', 'https://page.example/'),
  ["script-src 'none'"], 'a $csp exception suppresses only its own alias');

const cspBlanketEngine = new FilterEngine(null, resolveCsp);
cspBlanketEngine.load([
  '||promo.example^$csp=no-frame',
  '||promo.example^$csp=no-script',
  '@@||promo.example^$csp'
].join('\n'));
const blanketException = cspBlanketEngine.matchCsp(
  'https://promo.example/', 'document', 'https://page.example/');
assert.strictEqual(blanketException.exception, true, 'a bare $csp exception wins');
assert.deepStrictEqual(Array.from(blanketException.directives), [],
  'a bare $csp exception stops every directive');

const cspMultiEngine = new FilterEngine(null, resolveCsp);
cspMultiEngine.load([
  '||stack.example^$csp=no-script',
  '||stack.example^$csp=no-script',
  '||stack.example^$csp=no-frame'
].join('\n'));
assert.deepStrictEqual(
  cspFor(cspMultiEngine, 'https://stack.example/', 'document', 'https://page.example/'),
  ["script-src 'none'", "frame-src 'none'"],
  'all matching directives are applied once each');

const noCspEngine = new FilterEngine();
noCspEngine.load('||unavailable.example^$csp=no-script');
assert.strictEqual(noCspEngine.rejectedCsp.length, 1,
  'CSP rules are rejected when no curated registry is injected');

assert.strictEqual(CspResources.resolve('NO-SCRIPT'), "script-src 'none'",
  'aliases are normalized without trusting filter-supplied casing');
assert.strictEqual(CspResources.resolve('script-src *'), '',
  'filter text cannot supply its own header value');
const originalHeaders = [{ name: 'X-Page', value: 'kept' }];
const injectedHeaders = CspResources.withDirective(originalHeaders,
  ["script-src 'none'", "frame-src 'none'"]);
assert.strictEqual(originalHeaders.length, 1, 'response headers are not mutated');
assert.deepStrictEqual(Array.from(injectedHeaders, header => ({
  name: header.name, value: header.value
})), [
  { name: 'X-Page', value: 'kept' },
  { name: 'Content-Security-Policy', value: "script-src 'none'" },
  { name: 'Content-Security-Policy', value: "frame-src 'none'" }
], 'WildFire appends separate enforcing CSP headers');

const scriptletEngine = new FilterEngine(null, null, WildFireScriptlets);
scriptletEngine.load([
  'page.example##+js(set-constant, adblockDetected, false)',
  '##+js(abort-on-property-read, wildFireReadFlag)',
  'other.example##+js(abort-on-property-write, wildFireWriteFlag)',
  'page.example#@#+js(abort-on-property-read, wildFireReadFlag)',
  'page.example##+js(no-such-alias, wildFireFlag)',
  'page.example##+js(set-constant, wildFireFlag, "code")',
  'page.example##+js(set-constant, wildFireFlag)',
  'page.example##+js(set-constant, window.alert("x"), false)',
  'page.example##+js(set-constant, wildFireFlag, false'
].join('\n'));
assert.strictEqual(scriptletEngine.counts.scriptlets, 4,
  'valid and exception scriptlet rules are counted');
assert.strictEqual(scriptletEngine.rejectedScriptlets.length, 5,
  'unsafe or malformed scriptlet rules are rejected');
assert.ok(scriptletEngine.rejectedScriptlets.some(entry => /unknown scriptlet alias/.test(entry.reason)),
  'unknown aliases are rejected at load time');
assert.ok(scriptletEngine.rejectedScriptlets.some(entry => /unterminated/.test(entry.reason)),
  'unterminated rules are rejected at load time');
assert.strictEqual(
  scriptletEngine.matchRequest('https://page.example/ad.js', 'script', 'https://page.example/').blocked,
  false, 'scriptlet rules never become network blockers');

const scriptletPayload = Array.from(scriptletEngine.getScriptletPayload(), rule => ({
  alias: rule.alias,
  args: Array.from(rule.args),
  domains: Array.from(rule.domains),
  isException: rule.isException
}));
assert.deepStrictEqual(scriptletPayload[0], {
  alias: 'set-constant',
  args: ['adblockDetected', 'false'],
  domains: ['page.example'],
  isException: false
}, 'the injected payload is plain alias data');
assert.strictEqual(scriptletPayload[3].isException, true,
  'exceptions are included so the content side can resolve them per host');

assert.strictEqual(WildFireScriptlets.validate('set-constant', ['wildFireFlag', '1']), '',
  'allowed constants validate');
assert.notStrictEqual(WildFireScriptlets.validate('set-constant', ['wildFireFlag', 'alert(1)']), '',
  'filter-supplied values are not accepted');
assert.notStrictEqual(WildFireScriptlets.validate('eval', ['alert(1)']), '',
  'unknown aliases fail validation');
assert.notStrictEqual(WildFireScriptlets.validate('set-constant', ['window.alert("x")', 'false']), '',
  'property arguments must be plain paths');
assert.notStrictEqual(WildFireScriptlets.validate('set-constant', ['__proto__.flag', 'false']), '',
  'prototype paths are rejected');

WildFireScriptlets.apply(scriptletPayload);
assert.strictEqual(context.adblockDetected, false,
  'set-constant freezes a detection flag on its own domain');
assert.strictEqual(context.wildFireReadFlag, undefined,
  'a matching #@# rule cancels just that scriptlet');
assert.strictEqual(context.wildFireWriteFlag, undefined,
  'scriptlets do not run on other domains');

WildFireScriptlets.apply([
  { alias: 'abort-on-property-read', args: ['wildFireGuardedRead'], domains: [], isException: false }
]);
assert.throws(() => context.wildFireGuardedRead, /WildFire blocked read/,
  'abort-on-property-read throws when a page reads the property');

context.wildFireTestTarget = { flag: 42 };
WildFireScriptlets.apply([
  { alias: 'abort-on-property-write', args: ['wildFireTestTarget.flag'], domains: [], isException: false }
]);
assert.throws(() => { context.wildFireTestTarget.flag = 7; }, /WildFire blocked write/,
  'abort-on-property-write throws when a page writes the property');
assert.strictEqual(context.wildFireTestTarget.flag, 42,
  'the guarded property keeps its original value');

WildFireScriptlets.apply([
  { alias: 'eval', args: ['wildFireInvalidAlias'], domains: [], isException: false }
]);
assert.strictEqual(context.wildFireInvalidAlias, undefined,
  'invalid aliases never reach execution');

function scriptletContext(hostname) {
  const sandbox = {
    console,
    location: { hostname },
    document: { currentScript: { textContent: 'page code', getAttribute: () => 'ad.js' } },
    setTimeout: () => 42,
    setInterval: () => 43,
    open: () => ({ closed: false }),
    addEventListener: () => 'listened'
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  return vmContext;
}

assert.strictEqual(WildFireScriptlets.canonical('set'), 'set-constant',
  'short aliases canonicalize to one behavior');
assert.strictEqual(WildFireScriptlets.canonical('aopr'), 'abort-on-property-read',
  'aopr maps to the property-read trap');
assert.strictEqual(WildFireScriptlets.canonical('acs'), 'abort-current-script',
  'acs maps to abort-current-script');
assert.strictEqual(WildFireScriptlets.validate('set', ['wildFireFlag', 'false']), '',
  'short aliases validate through the canonical definition');
assert.strictEqual(WildFireScriptlets.validate('trusted-replace-fetch-response', ['x']),
  'trusted scriptlets require a trusted source', 'trusted aliases stay rejected');
assert.strictEqual(WildFireScriptlets.validate('noeval-if', ['/ads{2,3}/i']), '',
  'safe regex needles validate');
assert.notStrictEqual(WildFireScriptlets.validate('noeval-if', ['/(a+)+/']), '',
  'nested quantifier needles are rejected');
assert.notStrictEqual(WildFireScriptlets.validate('noeval-if', ['/x/gg']), '',
  'stateful regex flags are rejected');
assert.notStrictEqual(WildFireScriptlets.validate('noeval', ['extra']), '',
  'wrong argument counts are rejected');

const expandedContext = scriptletContext('page.example');
expandedContext.WildFireScriptlets.apply([
  { alias: 'set', args: ['wildFireEmptyArr', 'emptyArr'], domains: [], isException: false },
  { alias: 'set-constant', args: ['wildFireEmptyObj', 'emptyObj'], domains: [], isException: false },
  { alias: 'set-constant', args: ['wildFireEmptyStr', 'emptyStr'], domains: [], isException: false },
  { alias: 'set-constant', args: ['wildFireUndefined', 'undefined'], domains: [], isException: false }
]);
assert.deepStrictEqual(Array.from(expandedContext.wildFireEmptyArr), [],
  'emptyArr creates a fresh array');
assert.deepStrictEqual(Object.keys(expandedContext.wildFireEmptyObj), [],
  'emptyObj creates a fresh object');
assert.strictEqual(expandedContext.wildFireEmptyStr, '', 'emptyStr freezes an empty string');
assert.strictEqual(expandedContext.wildFireUndefined, undefined,
  'undefined is a supported constant token');

const scopeContext = scriptletContext('skip.page.example');
scopeContext.WildFireScriptlets.apply([
  { alias: 'set-constant', args: ['wildFireScopedFlag', 'true'],
    domains: ['page.example', '~skip.page.example'], isException: false }
]);
assert.strictEqual(scopeContext.wildFireScopedFlag, undefined,
  'a negated domain keeps the scriptlet off that host');

const runtimeContext = scriptletContext('page.example');
runtimeContext.WildFireScriptlets.apply([
  { alias: 'noeval-if', args: ['/blocked/'], domains: [], isException: false },
  { alias: 'prevent-setTimeout', args: ['/blockedTimer/'], domains: [], isException: false },
  { alias: 'addEventListener-defuser', args: ['/blockedEvent/'], domains: [], isException: false },
  { alias: 'prevent-window-open', args: ['/blocked-popup/'], domains: [], isException: false },
  { alias: 'window.name-defuser', args: [], domains: [], isException: false }
]);
assert.strictEqual(runtimeContext.eval('blocked code'), undefined,
  'noeval-if drops a matching eval');
assert.strictEqual(runtimeContext.eval('1 + 1'), 2,
  'noeval-if passes through other eval calls');
assert.strictEqual(runtimeContext.setTimeout(() => {}, 100, 'blockedTimer'), 0,
  'prevent-setTimeout defuses a matching timer');
assert.strictEqual(runtimeContext.open('https://ads.example/blocked-popup'), null,
  'prevent-window-open defuses a matching popup');
assert.strictEqual(runtimeContext.name, '', 'window.name-defuser clears window.name');
runtimeContext.addEventListener('blockedEvent', () => {});
assert.strictEqual(runtimeContext.WildFireScriptlets.validate('abort-current-script',
  ['wildFireProbe', '/page code/i', '/ad\\.js/i']), '',
  'abort-current-script accepts literals and regex needles');

assert.strictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', '20-50']), '',
  'timer defusers accept a delay range');
assert.strictEqual(WildFireScriptlets.validate('prevent-setinterval', ['blocked', '30-']), '',
  'timer defusers accept an open-ended delay range');
assert.strictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', '-100']), '',
  'timer defusers accept a maximum delay');
assert.strictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', '!300']), '',
  'timer defusers accept a negated delay');
assert.strictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', '-0']), '',
  'timer defusers accept the negative-delay sentinel');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', 'soon']), '',
  'timer defusers reject an unbounded delay token');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-settimeout', ['blocked', '50-20']), '',
  'timer defusers reject an inverted delay range');
assert.strictEqual(WildFireScriptlets.validate('prevent-settimeout',
  ['!showAd', '20-50'], 'adguard'), '',
  'adguard timer defusers accept a negated needle and delay range');

const delayContext = domScriptletContext();
let delayPassThroughCalls = 0;
const originalDelayTimer = delayContext.setTimeout;
delayContext.setTimeout = (...args) => {
  delayPassThroughCalls += 1;
  return originalDelayTimer(...args);
};
delayContext.WildFireScriptlets.apply([
  { alias: 'prevent-settimeout', args: ['', '20-50'], domains: [], isException: false }
]);
assert.strictEqual(delayContext.setTimeout(() => {}, 30), 0,
  'a matching delay range is defused');
assert.strictEqual(delayPassThroughCalls, 0, 'defused timers never reach the page timer');
assert.strictEqual(delayContext.setTimeout(() => {}, 60), 42,
  'a delay outside the range passes through');
assert.strictEqual(delayPassThroughCalls, 1, 'pass-through timers reach the page timer');

const negatedDelayContext = domScriptletContext();
let negatedPassThroughCalls = 0;
const negatedOriginalTimer = negatedDelayContext.setTimeout;
negatedDelayContext.setTimeout = (...args) => {
  negatedPassThroughCalls += 1;
  return negatedOriginalTimer(...args);
};
negatedDelayContext.WildFireScriptlets.apply([
  { alias: 'prevent-settimeout', args: ['blocked', '!300'], domains: [], isException: false }
]);
assert.strictEqual(negatedDelayContext.setTimeout(() => {}, 300, 'blocked'), 42,
  'a negated delay keeps the excluded timer');
assert.strictEqual(negatedDelayContext.setTimeout(() => {}, 400, 'blocked'), 0,
  'a negated delay defuses every other timer');
assert.strictEqual(negatedPassThroughCalls, 1, 'only the excluded timer passes through');

const negativeDelayContext = domScriptletContext();
let negativePassThroughCalls = 0;
const negativeOriginalTimer = negativeDelayContext.setTimeout;
negativeDelayContext.setTimeout = (...args) => {
  negativePassThroughCalls += 1;
  return negativeOriginalTimer(...args);
};
negativeDelayContext.WildFireScriptlets.apply([
  { alias: 'prevent-settimeout', args: ['', '-0'], domains: [], isException: false }
]);
assert.strictEqual(negativeDelayContext.setTimeout(() => {}, -10), 0,
  'the -0 sentinel defuses negative delays');
assert.strictEqual(negativeDelayContext.setTimeout(() => {}, 0), 42,
  'the -0 sentinel keeps a plain zero delay');
assert.strictEqual(negativePassThroughCalls, 1, 'plain zero timers pass through');

const negatedNeedleContext = domScriptletContext();
negatedNeedleContext.WildFireScriptlets.apply([
  { alias: 'prevent-settimeout', args: ['!showAd'], domains: [], isException: false }
]);
assert.strictEqual(negatedNeedleContext.setTimeout(() => {}, 100), 0,
  'a negated callback needle defuses non-matching callbacks');
assert.strictEqual(negatedNeedleContext.setTimeout(() => { /* showAd */ }, 100), 42,
  'a negated callback needle keeps matching callbacks');

function decoyWindowContext() {
  const sandbox = {
    console,
    location: { hostname: 'page.example' },
    document: {
      body: {
        appendChild(element) {
          sandbox.appended = element;
          element.parentNode = this;
        },
        removeChild(element) {
          sandbox.removed = element;
          element.parentNode = null;
        }
      },
      createElement(tag) {
        return {
          tagName: String(tag).toUpperCase(),
          parentNode: null,
          attributes: {},
          setAttribute(name, value) { this.attributes[name] = value; },
          contentWindow: {
            document: {},
            location: { href: 'about:blank' },
            focus() { sandbox.focused = true; },
            blur() { sandbox.blurred = true; },
            postMessage() { sandbox.posted = true; }
          }
        };
      }
    },
    setTimeout: (handler, delay) => { sandbox.cleanup = [handler, delay]; return 99; },
    open: (...args) => { sandbox.opened = args; return { real: true }; },
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  return vmContext;
}

assert.strictEqual(WildFireScriptlets.validate('prevent-window-open', ['blocked', '2', 'obj']), '',
  'window defusers accept a decoy lifetime and replacement');
assert.strictEqual(WildFireScriptlets.validate('prevent-window-open',
  ['blocked', '2', 'obj'], 'adguard'), '',
  'adguard window defusers accept the same decoy arguments');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-window-open', ['blocked', 'soon']), '',
  'window defusers reject a non-numeric decoy lifetime');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-window-open', ['blocked', '2', 'eval(1)']), '',
  'window defusers reject an unknown replacement');

const allArgsWindowContext = decoyWindowContext();
allArgsWindowContext.WildFireScriptlets.apply([
  { alias: 'prevent-window-open', args: ['popupFeature'], domains: [], isException: false }
]);
assert.strictEqual(allArgsWindowContext.open('https://ads.example/', ' popup', 'popupFeature'), null,
  'window defusers match all arguments, not only the URL');
assert.strictEqual(allArgsWindowContext.opened, undefined,
  'a matching popup never reaches the page opener');

const negatedWindowContext = decoyWindowContext();
negatedWindowContext.WildFireScriptlets.apply([
  { alias: 'prevent-window-open', args: ['!allowed.example'], domains: [], isException: false }
]);
assert.strictEqual(negatedWindowContext.open('https://allowed.example/').real, true,
  'a negated window needle keeps excluded URLs');
assert.strictEqual(negatedWindowContext.open('https://ads.example/'), null,
  'a negated window needle defuses other URLs');

const decoyWindowOpenContext = decoyWindowContext();
decoyWindowOpenContext.WildFireScriptlets.apply([
  { alias: 'prevent-window-open', args: ['blocked', '2', 'obj'], domains: [], isException: false }
]);
const decoyWindow = decoyWindowOpenContext.open('https://ads.example/blocked');
assert.strictEqual(decoyWindow.closed, false, 'the decoy starts open');
assert.strictEqual(decoyWindowOpenContext.appended.tagName, 'OBJECT',
  'obj replacement creates an object decoy');
assert.strictEqual(decoyWindowOpenContext.cleanup[1], 2000,
  'the decoy lifetime is scheduled in milliseconds');
decoyWindow.focus();
assert.strictEqual(decoyWindowOpenContext.focused, true,
  'the decoy forwards window methods');
decoyWindow.close();
assert.strictEqual(decoyWindow.closed, true, 'closing invalidates the decoy');
assert.strictEqual(decoyWindowOpenContext.removed, decoyWindowOpenContext.appended,
  'closing removes the decoy element');

const blankWindowContext = decoyWindowContext();
blankWindowContext.WildFireScriptlets.apply([
  { alias: 'prevent-window-open', args: ['blocked', '', 'blank'], domains: [], isException: false }
]);
assert.deepStrictEqual(blankWindowContext.open('https://ads.example/blocked'), { real: true },
  'blank replacement still returns the opener result');
assert.deepStrictEqual(blankWindowContext.opened, ['about:blank'],
  'blank replacement strips the popup URL');

const needleEngine = new FilterEngine(null, null, WildFireScriptlets);
needleEngine.load([
  'page.example##+js(prevent-setTimeout, /foo{2,3},bar/)',
  'page.example##+js(set-constant, wildFireQuoted, "false")'
].join('\n'));
assert.strictEqual(needleEngine.rejectedScriptlets.length, 0,
  'regex needles with commas are parsed as one argument');
const needlePayload = Array.from(needleEngine.getScriptletPayload(), rule => ({
  alias: rule.alias, args: Array.from(rule.args)
}));
assert.deepStrictEqual(needlePayload[0], {
  alias: 'prevent-settimeout', args: ['/foo{2,3},bar/']
}, 'commas inside a regex needle do not split arguments');
assert.deepStrictEqual(needlePayload[1], {
  alias: 'set-constant', args: ['wildFireQuoted', 'false']
}, 'quoted arguments are unquoted before validation');

assert.strictEqual(WildFireScriptlets.canonical('ra'), 'remove-attr',
  'ra canonicalizes to remove-attr');
assert.strictEqual(WildFireScriptlets.canonical('cookie-remover'), 'remove-cookie',
  'cookie-remover canonicalizes to remove-cookie');
assert.strictEqual(WildFireScriptlets.validate('set-attr', ['a', 'href', '/x']), '',
  'set-attr accepts a plain attribute value');
assert.notStrictEqual(WildFireScriptlets.validate('set-attr', ['a', 'onclick=alert(1)', '/x']), '',
  'attribute names cannot contain injected code');
assert.notStrictEqual(WildFireScriptlets.validate('set-cookie', ['a;b', 'x']), '',
  'cookie names cannot inject attributes');
assert.strictEqual(WildFireScriptlets.validate('href-sanitizer', ['a', '[href]', 'removeHash']), '',
  'href-sanitizer accepts a curated transform');
assert.notStrictEqual(WildFireScriptlets.validate('href-sanitizer', ['a', '[href]', 'eval(1)']), '',
  'href-sanitizer rejects unknown transforms');

assert.strictEqual(WildFireScriptlets.validate('remove-attr', ['onclick', 'a', 'stay complete']), '',
  'remove-attr accepts the documented selector and applying flags');
assert.strictEqual(WildFireScriptlets.validate('remove-attr', ['onclick|data-track']), '',
  'remove-attr accepts an attribute list without a selector');
assert.notStrictEqual(WildFireScriptlets.validate('remove-attr', ['onclick', 'a', 'eval(1)']), '',
  'remove-attr rejects unsafe applying flags');
assert.strictEqual(WildFireScriptlets.validate('remove-class', ['banner', 'a', 'stay']), '',
  'remove-class accepts the documented selector and flags');
assert.strictEqual(WildFireScriptlets.validate('set-attr', ['img', 'src', '[data-src]']), '',
  'set-attr accepts a copied attribute value');
assert.notStrictEqual(WildFireScriptlets.validate('set-attr', ['img', 'onclick', 'page()']), '',
  'set-attr cannot install an event-handler attribute');
assert.strictEqual(WildFireScriptlets.validate('prevent-innerHTML', ['a', '!safe']), '',
  'prevent-innerHTML accepts a selector and negated pattern');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-innerHTML', ['a'.repeat(501)]), '',
  'prevent-innerHTML rejects an oversized selector');
assert.strictEqual(WildFireScriptlets.validate('prevent-requestanimationframe', ['!allowed']), '',
  'the RAF defuser accepts a negated callback needle');
assert.strictEqual(WildFireScriptlets.validate('remove-node-text',
  ['#text', 'Ad', 'includes', 'sponsor', 'sedCount', '1', 'stay', '1', 'quitAfter', '1000']), '',
  'remove-node-text accepts the documented tokens');
assert.notStrictEqual(WildFireScriptlets.validate('remove-node-text',
  ['#text', 'Ad', 'eval(1)']), '', 'remove-node-text rejects unknown tokens');
assert.strictEqual(WildFireScriptlets.validate('remove-attr',
  ['onclick', 'a', 'stay'], 'adguard'), '', 'AdGuard remove-attr reuses the shared flags');

function scriptletTextNode(value) {
  return {
    nodeType: 3, nodeName: '#text', nodeValue: String(value),
    get textContent() { return this.nodeValue; }
  };
}

function scriptletElement(tag, attributes, classes, text) {
  const attrs = Object.assign({}, attributes);
  const classSet = new Set(classes || []);
  const element = {
    tagName: String(tag).toUpperCase(),
    nodeName: String(tag).toUpperCase(),
    nodeType: 1,
    parentNode: null,
    attributes: [],
    childNodes: [],
    classList: {
      add: name => classSet.add(name),
      remove: name => classSet.delete(name),
      contains: name => classSet.has(name)
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null;
    },
    setAttribute(name, value) {
      const next = String(value);
      const existing = this.attributes.find(attr => attr.name === name);
      if (existing) existing.value = next;
      else this.attributes.push({ name, value: next });
      attrs[name] = next;
      if (name === 'class') {
        next.split(/\s+/).filter(Boolean).forEach(item => classSet.add(item));
      }
    },
    removeAttribute(name) {
      delete attrs[name];
      this.attributes = this.attributes.filter(attr => attr.name !== name);
    },
    matches(selector) {
      if (selector === '*') return true;
      if (selector.startsWith('.')) return classSet.has(selector.slice(1));
      if (selector.startsWith('#')) return attrs.id === selector.slice(1);
      return selector.toLowerCase() === String(tag).toLowerCase();
    },
    get textContent() {
      return this.childNodes.map(node => node.nodeType === 3
        ? node.nodeValue : String(node.textContent || '')).join('');
    },
    set textContent(value) {
      this.childNodes = value === '' ? [] : [scriptletTextNode(value)];
    }
  };
  if (text) element.childNodes.push(scriptletTextNode(text));
  Object.keys(attrs).forEach(name => element.attributes.push({ name, value: String(attrs[name]) }));
  return element;
}

function scriptletDomContext() {
  const elements = [
    scriptletElement('a', { href: '/real', 'data-src': '/copy', onclick: 'page()' },
      ['banner'], 'sponsor Ad'),
    scriptletElement('div', { 'data-ad': '1', 'data-src': '/other' },
      ['ad'], 'Other Ad'),
    scriptletElement('img', { src: '/blank', 'data-src': '/copy' }, [], 'image')
  ];
  const sandbox = {
    console, URL, Date, Math, WeakMap,
    CSS: { supports: () => true },
    location: { hostname: 'page.example', href: 'https://page.example/', pathname: '/', search: '' },
    setTimeout: (handler, delay) => { sandbox.lastTimeout = [handler, delay]; return 42; },
    clearTimeout: () => {},
    requestAnimationFrame: () => 99,
    addEventListener: () => {},
    open: () => ({ real: true }),
    MutationObserver: class FakeMutationObserver {
      constructor(callback) { this.callback = callback; sandbox.observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
  };
  sandbox.Element = class Element {
    get innerHTML() { return this._html || ''; }
    set innerHTML(value) { this._html = String(value); }
  };
  elements.forEach(element => Object.setPrototypeOf(element, sandbox.Element.prototype));
  sandbox.document = {
    readyState: 'complete',
    cookie: '',
    childNodes: elements,
    documentElement: {},
    querySelector: () => null,
    querySelectorAll: selector => selector === '*'
      ? elements : elements.filter(element => element.matches(selector)),
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  vmContext.wildFireElements = elements;
  return vmContext;
}

const attributeContext = scriptletDomContext();
attributeContext.WildFireScriptlets.apply([
  { alias: 'remove-attr', args: ['onclick', 'a', 'stay'], domains: [], isException: false },
  { alias: 'remove-attr', args: ['data-ad'], domains: [], isException: false },
  { alias: 'remove-class', args: ['banner', 'a'], domains: [], isException: false },
  { alias: 'remove-class', args: ['ad'], domains: [], isException: false },
  { alias: 'set-attr', args: ['img', 'src', '[data-src]'], domains: [], isException: false }
]);
assert.strictEqual(attributeContext.wildFireElements[0].getAttribute('onclick'), null,
  'remove-attr takes the attribute before the selector');
assert.strictEqual(attributeContext.wildFireElements[1].getAttribute('data-ad'), null,
  'remove-attr defaults to every element');
assert.strictEqual(attributeContext.wildFireElements[0].getAttribute('href'), '/real',
  'remove-attr leaves unrelated attributes alone');
assert.strictEqual(attributeContext.wildFireElements[0].classList.contains('banner'), false,
  'remove-class takes the class before the selector');
assert.strictEqual(attributeContext.wildFireElements[1].classList.contains('ad'), false,
  'remove-class defaults to every element');
assert.strictEqual(attributeContext.wildFireElements[2].getAttribute('src'), '/copy',
  'set-attr copies a value from another attribute');
assert.ok(attributeContext.observer, 'the stay token keeps a DOM observer active');

const innerHtmlContext = scriptletDomContext();
innerHtmlContext.wildFireElements[0]._html = 'initial';
innerHtmlContext.WildFireScriptlets.apply([
  { alias: 'prevent-innerHTML', args: ['a', 'blocked'], domains: [], isException: false }
]);
innerHtmlContext.wildFireElements[0].innerHTML = 'blocked content';
assert.strictEqual(innerHtmlContext.wildFireElements[0].innerHTML, 'initial',
  'prevent-innerHTML blocks a matching scoped assignment');
innerHtmlContext.wildFireElements[1].innerHTML = 'blocked content';
assert.strictEqual(innerHtmlContext.wildFireElements[1].innerHTML, 'blocked content',
  'prevent-innerHTML leaves non-matching elements alone');

const negatedInnerHtmlContext = scriptletDomContext();
negatedInnerHtmlContext.WildFireScriptlets.apply([
  { alias: 'prevent-innerHTML', args: ['div', '!safe'], domains: [], isException: false }
]);
negatedInnerHtmlContext.wildFireElements[1].innerHTML = 'safe';
assert.strictEqual(negatedInnerHtmlContext.wildFireElements[1].innerHTML, 'safe',
  'a negated innerHTML pattern keeps matching values');
negatedInnerHtmlContext.wildFireElements[1].innerHTML = 'blocked';
assert.strictEqual(negatedInnerHtmlContext.wildFireElements[1].innerHTML, 'safe',
  'a negated innerHTML pattern blocks every other value');

const rafContext = scriptletDomContext();
rafContext.WildFireScriptlets.apply([
  { alias: 'norafif', args: ['!allowed'], domains: [], isException: false }
]);
assert.strictEqual(rafContext.requestAnimationFrame(() => 'allowed'), 99,
  'a negated RAF needle keeps the excluded callback');
assert.strictEqual(rafContext.requestAnimationFrame(() => 'blocked'), 0,
  'a negated RAF needle defuses every other callback');

const textContext = scriptletDomContext();
textContext.WildFireScriptlets.apply([
  { alias: 'remove-node-text', args: ['#text', 'Ad', 'includes', 'sponsor'],
    domains: [], isException: false }
]);
assert.strictEqual(textContext.wildFireElements[0].childNodes[0].nodeValue, '',
  'remove-node-text honors the includes token');
assert.strictEqual(textContext.wildFireElements[1].childNodes[0].nodeValue, 'Other Ad',
  'remove-node-text leaves text that fails the includes token');

const countContext = scriptletDomContext();
countContext.WildFireScriptlets.apply([
  { alias: 'rmnt', args: ['#text', 'Ad', 'sedCount', '1'], domains: [], isException: false }
]);
assert.strictEqual(countContext.wildFireElements[0].childNodes[0].nodeValue, '',
  'sedCount removes the first match');
assert.strictEqual(countContext.wildFireElements[1].childNodes[0].nodeValue, 'Other Ad',
  'sedCount stops after the configured number of removals');

const timedTextContext = scriptletDomContext();
timedTextContext.WildFireScriptlets.apply([
  { alias: 'remove-node-text', args: ['#text', 'Ad', 'stay', '1', 'quitAfter', '1000'],
    domains: [], isException: false }
]);
assert.ok(timedTextContext.observer, 'stay keeps remove-node-text observing');
assert.strictEqual(timedTextContext.lastTimeout[1], 1000,
  'quitAfter schedules observer cleanup');

function domScriptletContext() {
  const sandbox = {
    console,
    URL,
    Date,
    location: { hostname: 'page.example', href: 'https://page.example/', pathname: '/', search: '' },
    document: { cookie: '' },
    setTimeout: (handler, delay) => { sandbox.timerDelay = delay; return 42; },
    close: () => { sandbox.closed = true; },
    alert: () => {},
    confirm: () => false,
    prompt: () => '',
    localStorage: { getItem: () => null, setItem: (key, value) => { sandbox.stored = [key, value]; } },
    sessionStorage: { getItem: () => null, setItem: () => {} }
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  return vmContext;
}

const domContext = domScriptletContext();
domContext.WildFireScriptlets.apply([
  { alias: 'set-cookie', args: ['wildFireCookie', '1'], domains: [], isException: false },
  { alias: 'set-local-storage-item', args: ['wildFireKey', 'value'], domains: [], isException: false }
]);
assert.ok(String(domContext.document.cookie).includes('wildFireCookie=1'),
  'set-cookie writes the curated cookie through the page document');
assert.deepStrictEqual(domContext.stored, ['wildFireKey', 'value'],
  'set-local-storage-item writes validated data');

const timerContext = domScriptletContext();
timerContext.WildFireScriptlets.apply([
  { alias: 'adjust-settimeout', args: ['', '1000', '0.5'], domains: [], isException: false }
]);
timerContext.setTimeout(() => {}, 1000);
assert.strictEqual(timerContext.timerDelay, 500,
  'adjust-settimeout multiplies a matching delay by the curated boost');

const throwContext = domScriptletContext();
throwContext.mightThrow = () => { throw new Error('page error'); };
throwContext.WildFireScriptlets.apply([
  { alias: 'call-nothrow', args: ['mightThrow'], domains: [], isException: false }
]);
assert.strictEqual(throwContext.mightThrow(), undefined,
  'call-nothrow swallows the page exception');

const alertContext = domScriptletContext();
alertContext.WildFireScriptlets.apply([
  { alias: 'alert-buster', args: [], domains: [], isException: false }
]);
assert.strictEqual(alertContext.confirm('sure'), true,
  'alert-buster makes confirm return true');

assert.notStrictEqual(WildFireScriptlets.validate('json-prune', ['ad', 'x; eval(1)']), '',
  'prune paths cannot contain filter-supplied code');
assert.strictEqual(WildFireScriptlets.validate('prevent-fetch', ['ads.example', 'emptyObj']), '',
  'prevent-fetch accepts a curated response directive');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-fetch', ['ads', 'fetch(1)']), '',
  'prevent-fetch rejects an unknown directive');
assert.strictEqual(WildFireScriptlets.canonical('no-fetch-if'), 'prevent-fetch',
  'no-fetch-if canonicalizes to prevent-fetch');

function resolved(value) {
  return { then: callback => resolved(callback(value)) };
}

function dataScriptletContext() {
  const sandbox = {
    console, Promise, WeakMap, WeakSet, URL, Date, Math,
    JSON: { parse: (text, reviver) => JSON.parse(text, reviver), stringify: (value) => JSON.stringify(value) },
    location: { hostname: 'page.example', href: 'https://page.example/' },
    document: { cookie: '' },
    fetch: (url, init) => {
      sandbox.fetched = url;
      sandbox.sentBody = init && init.body;
      return 'original';
    }
  };
  sandbox.Response = class FakeResponse {
    constructor(body) { this.body = String(body); }
    json() { return resolved(JSON.parse(this.body)); }
    text() { return resolved(this.body); }
  };
  sandbox.XMLHttpRequest = class FakeXMLHttpRequest {
    open(method, url) { this.url = url; }
    setRequestHeader() {}
    send(body) { this.sentBody = body; }
    get responseText() { return this.body || ''; }
    set responseText(value) { this.body = value; }
  };
  sandbox.DOMParser = class FakeDOMParser {
    parseFromString() {
      return {
        querySelectorAll: () => [{
          nodeType: 1,
          parentNode: { removeChild: () => { sandbox.xmlRemoved = true; } }
        }],
        evaluate: () => ({ snapshotLength: 0, snapshotItem: () => null })
      };
    }
  };
  sandbox.XMLSerializer = class FakeXMLSerializer {
    serializeToString() { return '<pruned/>'; }
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  return vmContext;
}

const pruneContext = dataScriptletContext();
pruneContext.WildFireScriptlets.apply([
  { alias: 'json-prune', args: ['ad'], domains: [], isException: false }
]);
assert.deepStrictEqual(pruneContext.JSON.parse('{"one":1,"ad":2}'), { one: 1 },
  'json-prune removes a named property from parse results');

const obligatoryContext = dataScriptletContext();
obligatoryContext.WildFireScriptlets.apply([
  { alias: 'json-prune', args: ['ad', 'ads.url'], domains: [], isException: false }
]);
assert.deepStrictEqual(obligatoryContext.JSON.parse('{"one":1,"ad":2,"ads":{}}'),
  { one: 1, ad: 2, ads: {} },
  'obligatory properties gate pruning');

const wildcardContext = dataScriptletContext();
wildcardContext.WildFireScriptlets.apply([
  { alias: 'json-prune', args: ['a.*.ad'], domains: [], isException: false }
]);
assert.deepStrictEqual(
  wildcardContext.JSON.parse('{"a":{"x":{"ad":1,"keep":2},"y":{"ad":3,"keep":4}}}'),
  { a: { x: { keep: 2 }, y: { keep: 4 } } },
  'json-prune expands wildcard path segments');

const fetchContext = dataScriptletContext();
fetchContext.WildFireScriptlets.apply([
  { alias: 'prevent-fetch', args: ['ads.example', 'emptyObj'], domains: [], isException: false }
]);
assert.strictEqual(typeof fetchContext.fetch('https://ads.example/x.js').then, 'function',
  'prevent-fetch defuses a matching call with a resolved response object');
assert.strictEqual(fetchContext.fetched, undefined,
  'the original fetch is never called for a matching URL');
assert.strictEqual(fetchContext.fetch('https://page.example/data.json'), 'original',
  'prevent-fetch passes through non-matching URLs');
assert.strictEqual(fetchContext.fetched, 'https://page.example/data.json',
  'the original fetch sees non-matching URLs');

assert.strictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['ads.example', 'emptyObj', 'opaque']), '',
  'prevent-fetch accepts a curated response type');
assert.strictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['ads.example', 'emptyObj', '{"status":404,"statusText":"Not Found","ok":false,"type":"opaque"}']), '',
  'prevent-fetch accepts validated response properties');
assert.strictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['*', '', 'opaque'], 'adguard'), '',
  'AdGuard prevent-fetch accepts a curated response type');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['ads.example', 'emptyObj', '{"status":999}']), '',
  'prevent-fetch rejects an invalid status');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['ads.example', 'emptyObj', '{"evil":true}']), '',
  'prevent-fetch rejects unknown response properties');
assert.notStrictEqual(WildFireScriptlets.validate('prevent-fetch',
  ['ads.example', 'emptyObj', 'eval(1)']), '',
  'prevent-fetch never accepts filter-supplied code as a response config');


const detectorContext = dataScriptletContext();
detectorContext.BlockAdblock = () => true;
detectorContext.WildFireScriptlets.apply([
  { alias: 'nobab', args: [], domains: [], isException: false }
]);
assert.strictEqual(detectorContext.BlockAdblock(), false,
  'nobab defuses the BlockAdblock detector');

assert.strictEqual(WildFireScriptlets.validate('json-prune-fetch-response', []), '',
  'response prune aliases accept their optional arguments');
assert.strictEqual(WildFireScriptlets.validate('xml-prune', ['ad']), '',
  'xml-prune accepts only a selector');
assert.strictEqual(WildFireScriptlets.validate('m3u-prune', ['/ads\\.example/']), '',
  'm3u-prune accepts a safe regex needle');
assert.strictEqual(WildFireScriptlets.validate('json-edit-fetch-response', ['$.ad']), '',
  'edit aliases accept a simple JSONPath query');
assert.notStrictEqual(WildFireScriptlets.validate('json-edit', ['eval(1)']), '',
  'JSONPath queries cannot contain filter-supplied code');
assert.notStrictEqual(WildFireScriptlets.validate('replace-node-text', ['a', 'x']), '',
  'trusted-only aliases stay rejected through their short names');
assert.strictEqual(WildFireScriptlets.canonical('no-floc'), 'no-floc',
  'the deprecated no-floc alias is still accepted safely');

const nestedObligatoryContext = dataScriptletContext();
nestedObligatoryContext.WildFireScriptlets.apply([
  { alias: 'json-prune', args: ['ad', 'ads.url'], domains: [], isException: false }
]);
assert.deepStrictEqual(
  nestedObligatoryContext.JSON.parse('{"one":1,"ad":2,"ads":{"url":"x"}}'),
  { one: 1, ads: { url: 'x' } },
  'obligatory paths are resolved inside nested objects');

const editContext = dataScriptletContext();
editContext.WildFireScriptlets.apply([
  { alias: 'json-edit', args: ['$.ad'], domains: [], isException: false }
]);
assert.deepStrictEqual(editContext.JSON.parse('{"one":1,"ad":2}'), { one: 1 },
  'json-edit prunes a JSONPath target from parsed data');

const responsePruneContext = dataScriptletContext();
responsePruneContext.WildFireScriptlets.apply([
  { alias: 'json-prune-fetch-response', args: ['ad', '', 'page.example'],
    domains: [], isException: false }
]);
new responsePruneContext.Response('{"one":1,"ad":2}').json().then(value => {
  responsePruneContext.transformed = value;
});
assert.deepStrictEqual(responsePruneContext.transformed, { one: 1 },
  'json-prune-fetch-response prunes a matching fetch response');

const xhrPruneContext = dataScriptletContext();
xhrPruneContext.WildFireScriptlets.apply([
  { alias: 'json-edit-xhr-response', args: ['$.ad', 'ads.example'],
    domains: [], isException: false }
]);
const prunedXhr = new xhrPruneContext.XMLHttpRequest();
prunedXhr.open('GET', 'https://ads.example/data.json');
prunedXhr.body = '{"one":1,"ad":2}';
assert.strictEqual(prunedXhr.responseText, '{"one":1}',
  'json-edit-xhr-response prunes a matching XHR response body');

const requestEditContext = dataScriptletContext();
requestEditContext.WildFireScriptlets.apply([
  { alias: 'json-edit-fetch-request', args: ['$.ad', 'ads.example'],
    domains: [], isException: false }
]);
requestEditContext.fetch('https://ads.example/collect', {
  method: 'POST', body: '{"one":1,"ad":2}'
});
assert.strictEqual(requestEditContext.sentBody, '{"one":1}',
  'json-edit-fetch-request prunes a matching outbound body');

const xmlContext = dataScriptletContext();
xmlContext.WildFireScriptlets.apply([
  { alias: 'xml-prune', args: ['ad'], domains: [], isException: false }
]);
new xmlContext.Response('<root><ad>1</ad></root>').text().then(text => {
  xmlContext.transformed = text;
});
assert.strictEqual(xmlContext.transformed, '<pruned/>',
  'xml-prune serializes a pruned document with WildFire-owned code');
assert.strictEqual(xmlContext.xmlRemoved, true,
  'xml-prune removes the selected nodes');

const m3uContext = dataScriptletContext();
m3uContext.WildFireScriptlets.apply([
  { alias: 'm3u-prune', args: ['/ads\\.example/'], domains: [], isException: false }
]);
new m3uContext.Response('#EXTM3U\nhttps://ads.example/a.ts\nhttps://ok.example/b.ts\n')
  .text().then(text => { m3uContext.transformed = text; });
assert.strictEqual(m3uContext.transformed, '#EXTM3U\n\nhttps://ok.example/b.ts\n',
  'm3u-prune drops matching playlist lines');

const outboundEditContext = dataScriptletContext();
outboundEditContext.makeAd = () => ({ ad: 1, keep: 2 });
outboundEditContext.WildFireScriptlets.apply([
  { alias: 'edit-outbound-object', args: ['makeAd', '$.ad'], domains: [], isException: false }
]);
assert.deepStrictEqual(outboundEditContext.makeAd(), { keep: 2 },
  'edit-outbound-object prunes a returned object');

const inboundEditContext = dataScriptletContext();
inboundEditContext.consume = value => {
  inboundEditContext.seen = value;
  return 'ok';
};
inboundEditContext.WildFireScriptlets.apply([
  { alias: 'edit-inbound-object', args: ['consume', '0', '$.ad'],
    domains: [], isException: false }
]);
assert.strictEqual(inboundEditContext.consume({ ad: 1, keep: 2 }), 'ok',
  'edit-inbound-object preserves the original method return value');
assert.deepStrictEqual(inboundEditContext.seen, { keep: 2 },
  'edit-inbound-object prunes an argument before the page sees it');

const flocContext = dataScriptletContext();
flocContext.document.interestCohort = () => 'cohort';
flocContext.WildFireScriptlets.apply([
  { alias: 'no-floc', args: [], domains: [], isException: false }
]);
assert.strictEqual(flocContext.document.interestCohort, undefined,
  'no-floc defuses the deprecated cohort probe');

const adguardEngine = new FilterEngine(null, null, WildFireScriptlets);
adguardEngine.load([
  "page.example#%#//scriptlet('set-constant', 'adGuardFlag', 'yes')",
  "page.example#@%#//scriptlet('abort-on-property-read', 'guardedByBothSyntaxes')",
  'page.example##+js(abort-on-property-read, guardedByBothSyntaxes)',
  "page.example#%#//scriptlet('remove-request-query-parameter', 'utm_source,utm_medium', '/ads\\.example/')",
  "page.example#%#//scriptlet('log', 'comma,inside', '')",
  "page.example#%#//scriptlet('no-topics')",
  "page.example#%#//scriptlet('trusted-prevent-xhr', 'x')",
  "page.example#%#//scriptlet('debug-on-property-read', 'x')",
  "page.example#%#//scriptlet('no-such-adguard-alias')"
].join('\n'));
assert.strictEqual(adguardEngine.counts.scriptlets, 6,
  'valid AdGuard scriptlets are counted alongside uBO rules');
assert.strictEqual(adguardEngine.rejectedScriptlets.length, 3,
  'trusted, debug and unknown AdGuard aliases are rejected');
assert.ok(adguardEngine.rejectedScriptlets.some(entry => /trusted/.test(entry.reason)),
  'AdGuard trusted aliases need the same source-trust model');
assert.ok(adguardEngine.rejectedScriptlets.some(entry => /debug/.test(entry.reason)),
  'debug-only aliases are not accepted from production filters');
const adguardPayload = adguardEngine.getScriptletPayload();
assert.strictEqual(adguardPayload[0].syntax, 'adguard',
  'the injected payload records which scriptlet syntax was used');
assert.deepStrictEqual(Array.from(adguardPayload[0].args), ['adGuardFlag', 'yes'],
  'AdGuard arguments arrive as plain strings');
assert.deepStrictEqual(Array.from(adguardPayload[4].args), ['comma,inside', ''],
  'quoted commas and empty AdGuard arguments survive parsing');
assert.strictEqual(adguardPayload[3].args[1], '/ads\\.example/',
  'regex backslashes inside quoted AdGuard arguments are preserved');
assert.strictEqual(WildFireScriptlets.canonical('abort-current-inline-script', 'adguard'),
  'abort-current-script', 'AdGuard aliases share WildFire canonical behaviors');
assert.strictEqual(WildFireScriptlets.validate('set-constant', ['flag', 'false'], 'adguard'), '',
  'AdGuard set-constant validates as string data');
assert.ok(/must be strings/.test(WildFireScriptlets.validate('set-constant', ['flag', 1], 'adguard')),
  'AdGuard arguments must be strings');
assert.ok(/unknown AdGuard/.test(WildFireScriptlets.validate('made-up', [], 'adguard')),
  'unknown AdGuard aliases are rejected directly');

function adguardScriptletContext(hostname) {
  const sandbox = {
    console: { log: () => {} },
    Promise, WeakMap, WeakSet, URL, Date, Math, Reflect,
    JSON: { parse: text => JSON.parse(text), stringify: value => JSON.stringify(value) },
    location: {
      hostname,
      href: 'https://' + hostname + '/',
      assign: url => { sandbox.navigated = url; },
      replace: url => { sandbox.navigated = url; },
      reload: () => { sandbox.reloaded = true; }
    },
    document: {
      cookie: '',
      browsingTopics: () => ['topic'],
      querySelectorAll: () => []
    },
    fetch: url => { sandbox.fetched = url; return 'original'; },
    localStorage: {
      legacy: '1',
      getItem(key) { return this[key] || null; },
      setItem(key, value) { this[key] = value; },
      removeItem(key) { delete this[key]; }
    },
    sessionStorage: {
      getItem(key) { return this[key] || null; },
      setItem(key, value) { this[key] = value; },
      removeItem(key) { delete this[key]; }
    }
  };
  sandbox.window = sandbox;
  const vmContext = vm.createContext(sandbox);
  loadScriptlets(vmContext);
  return vmContext;
}

const adguardContext = adguardScriptletContext('page.example');
adguardContext.WildFireScriptlets.apply(adguardPayload);
assert.strictEqual(adguardContext.adGuardFlag, true,
  'AdGuard yes maps to a WildFire-owned true constant');
assert.strictEqual(adguardContext.guardedByBothSyntaxes, undefined,
  'a #@%# exception cancels the same behavior written with ##+js');
assert.strictEqual(adguardContext.document.browsingTopics, undefined,
  'AdGuard aliases without a uBO twin run through the same registry');

const queryContext = adguardScriptletContext('page.example');
queryContext.WildFireScriptlets.apply([{
  alias: 'remove-request-query-parameter', syntax: 'adguard',
  args: ['utm_source,utm_medium', '/ads/'], domains: [], isException: false
}]);
queryContext.fetch('https://ads.example/watch?utm_source=x&keep=1');
assert.strictEqual(queryContext.fetched, 'https://ads.example/watch?keep=1',
  'AdGuard query-parameter removal changes only matching request URLs');
queryContext.fetch('https://other.example/watch?utm_source=x');
assert.strictEqual(queryContext.fetched, 'https://other.example/watch?utm_source=x',
  'non-matching URLs keep their query parameters');

const constructorContext = adguardScriptletContext('page.example');
constructorContext.Widget = function (value) { this.value = value; };
constructorContext.WildFireScriptlets.apply([{
  alias: 'prevent-constructor', syntax: 'adguard',
  args: ['Widget', 'blocked'], domains: [], isException: false
}]);
assert.throws(() => new constructorContext.Widget('blocked'), /blocked constructor/,
  'AdGuard constructor guards throw only for matching arguments');
assert.strictEqual(new constructorContext.Widget('ok').value, 'ok',
  'non-matching constructor calls still work');

const storageContext = adguardScriptletContext('page.example');
storageContext.WildFireScriptlets.apply([{
  alias: 'set-local-storage-item', syntax: 'adguard',
  args: ['/^legacy$/', '$remove$'], domains: [], isException: false
}]);
assert.strictEqual(storageContext.localStorage.legacy, undefined,
  'AdGuard storage removal accepts WildFire-safe regex keys');

const rewriteEngine = new FilterEngine(null, null, null,
  alias => RewriteResources.hasAlias(alias),
  alias => RewriteResources.hasCaptureAlias(alias));
rewriteEngine.load([
  '||tracker.example^$rewrite=blank-js',
  '||cdn.example^$script,rewrite=blank-image',
  '||promo.example^$rewrite=blank-json',
  '@@||promo.example^$script',
  '||doc.example^$document,rewrite=blank-js',
  '||evil.example^$rewrite=alert(1)',
  '||rule.example^$rewrite-rule=tagged-js',
  '/ads\\.example\\/([^/]+)\\.js/$script,rewrite-rule=tagged-js',
  '/json\\.example\\/([^/]+)/$script,rewrite-rule=tagged-json',
  '/fixed\\.example\\/(x)/$rewrite-rule=blank-js',
  '/unknown\\.example\\/(x)/$rewrite-rule=alert(1)'
].join('\n'));
assert.strictEqual(rewriteEngine.counts.rewrite, 6, 'valid $rewrite rules are counted');
assert.strictEqual(rewriteEngine.rejectedRewrite.length, 3,
  'non-curated rewrite aliases are rejected');
assert.ok(rewriteEngine.rejectedRegex.some(entry => /rewrite-rule requires a regex filter/.test(entry.reason)),
  'rewrite-rule requires a regex pattern');
assert.ok(rewriteEngine.rejectedRewrite.some(entry => /unknown rewrite alias/.test(entry.reason)),
  'rejected rewrite aliases record a clear reason');

const rewritten = rewriteEngine.matchRequest(
  'https://tracker.example/x.js', 'script', 'https://page.example/');
assert.strictEqual(rewritten.blocked, true, 'rewrite rules are still matched filters');
assert.strictEqual(rewritten.rewrite.alias, 'blank-js', 'the curated alias reaches the listener');
assert.strictEqual(rewritten.redirect, null, 'a rewrite rule is not also a redirect');
assert.deepStrictEqual(
  Array.from(rewriteEngine.matchCsp(
    'https://tracker.example/x.js', 'script', 'https://page.example/').directives), [],
  '$rewrite rules never become CSP rules');
assert.strictEqual(rewriteEngine.matchRequest(
  'https://cdn.example/pic.png', 'image', 'https://page.example/').rewrite, null,
  '$rewrite respects resource type options');
assert.strictEqual(rewriteEngine.matchRequest(
  'https://promo.example/a.js', 'script', 'https://page.example/').blocked, false,
  'an exception stops a rewrite');
assert.strictEqual(rewriteEngine.matchRequest(
  'https://doc.example/', 'document', 'https://page.example/').blocked, false,
  'navigations are never rewritten');

const ruleRewrite = rewriteEngine.matchRequest(
  'https://ads.example/creative.js', 'script', 'https://page.example/');
assert.strictEqual(ruleRewrite.rewrite.alias, 'tagged-js', '$rewrite-rule reaches the listener');
assert.deepStrictEqual(Array.from(ruleRewrite.rewrite.captures), ['creative'],
  'regex captures are returned for the template');
const ruleBody = RewriteResources.resolve(
  ruleRewrite.rewrite.alias, ruleRewrite.rewrite.captures).bytes;
assert.strictEqual(Array.from(ruleBody, code => String.fromCharCode(code)).join(''),
  '/* WildFire: creative */', 'the WildFire template is filled from captures');
const rewriteBlob = rewriteEngine.toCompiled();
const rewriteReload = new FilterEngine(null, null, null,
  alias => RewriteResources.hasAlias(alias),
  alias => RewriteResources.hasCaptureAlias(alias));
assert.strictEqual(rewriteReload.loadCompiled(rewriteBlob), true,
  '$rewrite-rule survives compiled round-trip');
assert.deepStrictEqual(Array.from(rewriteReload.matchRequest(
  'https://json.example/item/', 'script', 'https://page.example/').rewrite.captures),
  ['item'], 'compiled rewrite rules keep their captures');

const noRewriteEngine = new FilterEngine();
noRewriteEngine.load('||unavailable.example^$rewrite=blank-js');
assert.strictEqual(noRewriteEngine.rejectedRewrite.length, 1,
  'rewrite rules are rejected without a curated registry');

const syncCompiler = WildFireCompiler.create({ browserApi: {} });
const syncRewrite = syncCompiler.compileSync([
  '/fixed\\.example\\/(x)/$rewrite-rule=blank-js',
  '/tagged\\.example\\/(x)/$rewrite-rule=tagged-js'
].join('\n'));
assert.strictEqual(syncRewrite.counts.rewrite, 1,
  'sync compiler keeps fixed bodies out of rewrite-rule');
assert.strictEqual(syncRewrite.capabilities & FilterEngine.CAP.REWRITE,
  FilterEngine.CAP.REWRITE, 'sync compiler still accepts curated capture aliases');
syncCompiler.destroy();

assert.strictEqual(RewriteResources.resolve('BLANK-JS').type,
  'application/javascript; charset=utf-8', 'aliases are normalized without trusting filter casing');
assert.strictEqual(RewriteResources.resolve('https://evil.example/x'), null,
  'filter text cannot supply its own response body');
assert.strictEqual(RewriteResources.hasCaptureAlias('tagged-json'), true,
  'capture templates have a separate curated registry');
assert.strictEqual(RewriteResources.hasCaptureAlias('blank-js'), false,
  'fixed bodies cannot be used by rewrite-rule');
const encodedBody = RewriteResources.resolve('tagged-json', ['a"b<']).bytes;
assert.strictEqual(Array.from(encodedBody, code => String.fromCharCode(code)).join(''),
  '{"tag":"a%22b%3C"}', 'captures are percent-encoded before entering a template');
const jsonBody = RewriteResources.resolve('blank-json').bytes;
assert.strictEqual(Array.from(jsonBody, code => String.fromCharCode(code)).join(''), '{}',
  'the JSON body is authored by WildFire');
const imageBody = RewriteResources.resolve('blank-image').bytes;
assert.strictEqual(Array.from(imageBody.slice(0, 3), code => String.fromCharCode(code)).join(''), 'GIF',
  'the image body is a real 1x1 GIF');

const originalRewriteHeaders = [
  { name: 'Content-Type', value: 'application/javascript' },
  { name: 'Content-Length', value: '9102' },
  { name: 'Content-Encoding', value: 'gzip' },
  { name: 'Transfer-Encoding', value: 'chunked' },
  { name: 'X-Page', value: 'kept' }
];
const normalizedHeaders = RewriteResources.withHeaders(originalRewriteHeaders, 'text/css; charset=utf-8');
assert.strictEqual(originalRewriteHeaders.length, 5, 'rewrite headers are not mutated in place');
assert.deepStrictEqual(Array.from(normalizedHeaders, header => ({
  name: header.name, value: header.value
})), [
  { name: 'X-Page', value: 'kept' },
  { name: 'Content-Type', value: 'text/css; charset=utf-8' }
], 'length and encoding headers are dropped and the MIME type is replaced');

engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
assert.ok(engine.counts.network > 50, 'bundled list should contain network rules');
assert.ok(engine.counts.cosmetic > 5, 'bundled list should contain cosmetic rules');
assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads', 'script'), true,
  'bundled list blocks ads');

async function testStaleGenerationWorkerHang() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial || {});
    return {
      async get(key) {
        if (key === undefined) return Object.assign({}, data);
        if (Array.isArray(key)) return key.reduce((acc, k) => { acc[k] = data[k]; return acc; }, {});
        return { [key]: data[key] };
      },
      async set(patch) { data = Object.assign({}, data, patch || {}); },
      async remove(key) { (Array.isArray(key) ? key : [key]).forEach(k => { delete data[k]; }); }
    };
  }

  const ctx0 = vm.createContext({ console, URL, Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number });
  ctx0.window = ctx0;
  loadEngine(ctx0);
  const F = ctx0.FilterEngine;
  const fakeCompiled = text => { const e = new F(null, () => '', null, () => false); e.load(text); return e.toCompiled(); };

  class HangingWorker {
    constructor() { this.messages = []; this.terminated = false; }
    postMessage(msg) {
      this.messages.push(msg);
      if (msg.type === 'ping') {
        this.onmessage({ data: { id: msg.id, ok: true, type: 'pong' } });
      }
      // compile messages intentionally hang
    }
    terminate() { this.terminated = true; }
  }
  const workers = [];
  const WorkerCtor = class extends HangingWorker { constructor() { super(); workers.push(this); } };

  const apiHooks = {};
  let bgMessageHandler;
  const ctx = vm.createContext({
    console, URL, setTimeout, clearTimeout, setImmediate, Promise,
    Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number, Error,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    fetch: async url => {
      const u = String(url);
      if (u.includes('default.compiled.json')) return { ok: true, json: async () => fakeCompiled('||bundled.example^') };
      if (u.includes('default.txt')) return { ok: true, text: async () => '||bundled.example^' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.CSS = { supports: () => true }; ctx.location = { hostname: 'page.example' };
  ctx.Worker = WorkerCtor; ctx.indexedDB = undefined;
  ctx.browser = {
    runtime: { getURL: p => 'moz-extension://test/' + p, onMessage: { addListener: handler => { bgMessageHandler = handler; } } },
    storage: { local: memoryStorage({}) },
    browserAction: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} },
    webRequest: { onBeforeRequest: { addListener: () => {} }, onHeadersReceived: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} }, onBeforeRedirect: { addListener: () => {} }, filterResponseData: () => ({ ondata() {}, onstop() {}, onerror() {}, write() {}, close() {}, disconnect() {} }) },
    webNavigation: { onCreatedNavigationTarget: { addListener: () => {} }, onCommitted: { addListener: () => {} }, onReferenceFragmentUpdated: { addListener: () => {} }, onHistoryStateUpdated: { addListener: () => {} } },
    tabs: { query: async () => [], onUpdated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, sendMessage: async () => {}, remove: async () => {} },
    alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, get: async () => null, create: async () => {} },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  };
  ['lib/state/store.js', ...ENGINE_FILES, 'lib/state/page-store.js', 'lib/resources/redirect-resources.js', 'lib/state/remote-lists.js', 'lib/state/suggested-lists.js', 'lib/resources/csp-resources.js', ...SCRIPTLET_FILES, 'lib/resources/rewrite-resources.js', 'lib/compile/compile-cache.js', 'lib/compile/compiler.js', ...WAPI_FILES, ...BACKGROUND_FILES]
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  wildfire\.start\(\);\n\}\)\(\);\s*$/, '  globalThis.__wildfireTest = wildfire.debug(); wildfire.start(); })();');
  const origDebug2 = console.debug;
  console.debug = () => {};
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });
  await new Promise(resolve => setTimeout(resolve, 30));
  console.debug = origDebug2;
  const api = ctx.__wildfireTest;

  const suggested = await bgMessageHandler({ type: 'wildfire:suggested-lists' }, {});
  assert.ok(Array.isArray(suggested.suggested) && suggested.suggested.length >= 2,
    'the background exposes the suggested-list catalog');
  assert.ok(suggested.suggested.every(entry => /^https:\/\//.test(entry.url)),
    'catalog URLs are https');

  // Make custom compile hang at worker level; default/bundled compiles still respond.
  ctx.Worker = class extends HangingWorker {
    constructor() { super(); workers.push(this); }
    postMessage(msg) {
      this.messages.push(msg);
      if (msg && msg.type === 'compile' && String(msg.text).includes('old.example')) return; // never respond
      if (msg.type === 'ping') {
        this.onmessage({ data: { id: msg.id, ok: true, type: 'pong' } });
        return;
      }
      if (msg.type === 'compile') {
        setImmediate(() => {
          if (this.terminated) return;
          this.onmessage({ data: { id: msg.id, ok: true, type: 'compiled', compiled: fakeCompiled(msg.text), counts: {} } });
        });
      }
    }
  };

  api.setState({ customFilters: '||old.example^' });
  void api.loadFilters(true);
  await new Promise(resolve => setTimeout(resolve, 80));

  // Newer generation restarts stale pending compile and activates via fallback.
  const origWarn = console.warn;
  const origDebug = console.debug;
  console.warn = () => {};
  console.debug = () => {};
  api.setState({ customFilters: '||new.example^' });
  await Promise.race([api.loadFilters(true), new Promise(resolve => setTimeout(resolve, 500))]);
  await new Promise(resolve => setTimeout(resolve, 50));
  console.warn = origWarn;
  console.debug = origDebug;

  assert.strictEqual(api.engine.matchRequest('https://new.example/x.js', 'script', 'https://site.test/').blocked, true, 'new generation activates');
  assert.strictEqual(api.engine.matchRequest('https://old.example/x.js', 'script', 'https://site.test/').blocked, false, 'stale old rule not active');
  assert.ok(workers.some(w => w.terminated), 'stale worker restarted/terminated');
}

async function testBackgroundLoadFiltersIntegration() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial || {});
    return {
      async get(key) {
        if (key === undefined) return Object.assign({}, data);
        if (Array.isArray(key)) return key.reduce((acc, k) => { acc[k] = data[k]; return acc; }, {});
        return { [key]: data[key] };
      },
      async set(patch) { data = Object.assign({}, data, patch || {}); },
      async remove(key) {
        const keys = Array.isArray(key) ? key : [key];
        keys.forEach(k => { delete data[k]; });
      }
    };
  }

  const compileCalls = [];
  const fakeCompiled = text => {
    const e = new FilterEngine(null, () => '', null, () => false);
    e.load(text);
    return e.toCompiled();
  };

  class FakeWorker {
    constructor() { this.messages = []; this.terminated = false; }
    postMessage(msg) {
      this.messages.push(msg);
      if (msg.type === 'ping') {
        this.onmessage({ data: { id: msg.id, ok: true, type: 'pong' } });
        return;
      }
      if (msg.type === 'compile') {
        setImmediate(() => {
          if (this.terminated) return;
          this.onmessage({ data: { id: msg.id, ok: true, type: 'compiled', compiled: fakeCompiled(msg.text), counts: {} } });
        });
      }
    }
    terminate() { this.terminated = true; }
  }

  const workers = [];
  const WorkerCtor = class extends FakeWorker { constructor() { super(); workers.push(this); } };

  const apiHooks = {};
  const ctx = vm.createContext({
    console, URL, setTimeout, clearTimeout, setImmediate, Promise,
    Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number, Error,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    fetch: async url => {
      const u = String(url);
      if (u.includes('default.compiled.json')) return { ok: true, json: async () => fakeCompiled('||bundled.example^') };
      if (u.includes('default.txt')) return { ok: true, text: async () => '||bundled.example^' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.CSS = { supports: () => true };
  ctx.location = { hostname: 'page.example' };
  ctx.Worker = WorkerCtor;
  ctx.indexedDB = undefined;
  const storage = memoryStorage({});
  ctx.browser = {
    runtime: {
      getURL: p => 'moz-extension://test/' + p,
      onMessage: { addListener: () => {} }
    },
    storage: { local: storage },
    browserAction: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} },
    webRequest: {
      onBeforeRequest: { addListener: (fn, filter) => { if (filter && filter.types && filter.types.indexOf('csp_report') !== -1) apiHooks.onCspReportRequest = fn; else apiHooks.onBeforeRequest = fn; } },
      onBeforeSendHeaders: { addListener: fn => { apiHooks.onBeforeSendHeaders = fn; } },
      onHeadersReceived: { addListener: fn => { apiHooks.onHeadersReceived = fn; } },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
      onBeforeRedirect: { addListener: () => {} },
      filterResponseData: () => ({ ondata() {}, onstop() {}, onerror() {}, write() {}, close() {}, disconnect() {} })
    },
    webNavigation: {
      onCreatedNavigationTarget: { addListener: () => {} },
      onCommitted: { addListener: () => {} },
      onReferenceFragmentUpdated: { addListener: () => {} },
      onHistoryStateUpdated: { addListener: () => {} }
    },
    tabs: {
      query: async () => [],
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      sendMessage: async () => {},
      remove: async () => {}
    },
    alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, get: async () => null, create: async () => {} },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  };

  [
    'lib/state/store.js', ...ENGINE_FILES, 'lib/state/page-store.js', 'lib/resources/redirect-resources.js',
    'lib/state/remote-lists.js', 'lib/state/suggested-lists.js', 'lib/resources/csp-resources.js', ...SCRIPTLET_FILES, 'lib/resources/rewrite-resources.js',
    'lib/compile/compile-cache.js', 'lib/compile/compiler.js', ...WAPI_FILES, ...BACKGROUND_FILES
  ].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  wildfire\.start\(\);\n\}\)\(\);\s*$/, '  globalThis.__wildfireTest = wildfire.debug(); wildfire.start(); })();');
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });

  // wait for init/load
  await new Promise(resolve => setTimeout(resolve, 20));
  const api = ctx.__wildfireTest;
  assert.ok(api, 'background test hook exposed');
  api._apiHooks = apiHooks;

  // Instrument compiler to count actual compiles
  const origCompile = api.compiler.compile.bind(api.compiler);
  api.compiler.compile = async text => { compileCalls.push(String(text)); return origCompile(text); };

  // Seed two remote lists
  await api.remoteLists.save({
    lists: [
      { url: 'https://a.test/list.txt', enabled: true, text: '||a.example^', hash: 'ha', updatedAt: 1, checkedAt: 1 },
      { url: 'https://b.test/list.txt', enabled: true, text: '||b.example^', hash: 'hb', updatedAt: 1, checkedAt: 1 }
    ]
  });
  compileCalls.length = 0;
  await api.loadFilters(true);
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.strictEqual(api.engine.matchRequest('https://a.example/x.js', 'script', 'https://site.test/').blocked, true, 'remote A active');
  assert.strictEqual(api.engine.matchRequest('https://b.example/x.js', 'script', 'https://site.test/').blocked, true, 'remote B active');
  const callsAfterFirst = compileCalls.length;

  // Unchanged reload should not recompile remote lists
  compileCalls.length = 0;
  await api.loadFilters(true);
  await new Promise(resolve => setTimeout(resolve, 30));
  const remoteRecompiles = compileCalls.filter(t => t.includes('wildfire remote:')).length;
  assert.strictEqual(remoteRecompiles, 0, 'unchanged remote lists do not recompile');

  // Change only list B
  await api.remoteLists.save({
    lists: [
      { url: 'https://a.test/list.txt', enabled: true, text: '||a.example^', hash: 'ha', updatedAt: 1, checkedAt: 1 },
      { url: 'https://b.test/list.txt', enabled: true, text: '||b.example^\n||b2.example^', hash: 'hb2', updatedAt: 2, checkedAt: 2 }
    ]
  });
  compileCalls.length = 0;
  await api.loadFilters();
  await new Promise(resolve => setTimeout(resolve, 30));
  const changedCalls = compileCalls.filter(t => t.includes('wildfire remote:'));
  assert.strictEqual(changedCalls.length, 1, 'only changed remote list recompiles');
  assert.ok(changedCalls[0].includes('https://b.test/list.txt'), 'changed list B compiled');
  assert.strictEqual(api.engine.matchRequest('https://b2.example/x.js', 'script', 'https://site.test/').blocked, true, 'changed rule active');

  // Worker restart/fallback does not block activation
  const origWarn = console.warn;
  console.warn = () => {};
  api.compiler.compile = async () => { throw new Error('worker hung'); };
  api.setState({ customFilters: '||fallback.example^' });
  await api.loadFilters(true);
  await new Promise(resolve => setTimeout(resolve, 20));
  console.warn = origWarn;
  assert.strictEqual(api.engine.matchRequest('https://fallback.example/x.js', 'script', 'https://site.test/').blocked, true, 'fallback compile activates rules');
}

async function testRemoveRuntimeIntegration() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial || {});
    return {
      async get(key) { if (key === undefined) return Object.assign({}, data); return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch || {}); },
      async remove(key) { (Array.isArray(key)?key:[key]).forEach(k => delete data[k]); }
    };
  }
  const apiHooks = {};
  const fakeCompiled = text => { const e=new FilterEngine(null,()=>'',null,()=>false); e.load(text); return e.toCompiled(); };
  class FakeWorker { constructor(){this.terminated=false;} postMessage(msg){ if(msg.type==='ping') return this.onmessage({data:{id:msg.id,ok:true,type:'pong'}}); if(msg.type==='compile') setImmediate(()=>!this.terminated&&this.onmessage({data:{id:msg.id,ok:true,type:'compiled',compiled:fakeCompiled(msg.text),counts:{}}})); } terminate(){this.terminated=true;} }
  const ctx = vm.createContext({ console, URL, setTimeout, clearTimeout, setImmediate, Promise, Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number, Error, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, fetch: async url => { const u=String(url); if(u.includes('default.compiled.json')) return {ok:true,json:async()=>fakeCompiled('')}; if(u.includes('default.txt')) return {ok:true,text:async()=>''}; return {ok:false,status:404,json:async()=>({}),text:async()=>''}; } });
  ctx.globalThis=ctx; ctx.window=ctx; ctx.CSS={supports:()=>true}; ctx.location={hostname:'page.example'}; ctx.Worker=FakeWorker; ctx.indexedDB=undefined;
  ctx.browser = {
    runtime:{getURL:p=>'moz-extension://test/'+p,onMessage:{addListener:()=>{}}},
    storage:{local:memoryStorage({})},
    browserAction:{setBadgeBackgroundColor:()=>{},setBadgeText:()=>{}},
    webRequest:{
      onBeforeRequest:{addListener:(fn,filter)=>{if(filter&&filter.types&&filter.types.indexOf('csp_report')!==-1)apiHooks.onCspReportRequest=fn;else apiHooks.onBeforeRequest=fn;}},
      onBeforeSendHeaders:{addListener:fn=>{apiHooks.onBeforeSendHeaders=fn;}},
      onHeadersReceived:{addListener:fn=>{apiHooks.onHeadersReceived=fn;}},
      onCompleted:{addListener:()=>{}}, onErrorOccurred:{addListener:()=>{}}, onBeforeRedirect:{addListener:()=>{}},
      filterResponseData:()=>({ondata(){},onstop(){},onerror(){},write(){},close(){},disconnect(){}})
    },
    webNavigation:{onCreatedNavigationTarget:{addListener:()=>{}},onCommitted:{addListener:()=>{}},onReferenceFragmentUpdated:{addListener:()=>{}},onHistoryStateUpdated:{addListener:()=>{}}},
    tabs:{query:async()=>[],onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}},sendMessage:async()=>{},remove:async()=>{}},
    alarms:{onAlarm:{addListener:()=>{}},clear:async()=>{},get:async()=>null,create:async()=>{}},
    contentScripts:{register:async()=>({unregister:async()=>{}})},
    publicSuffix:{getDomain:host=>host.split('.').slice(-2).join('.')}
  };
  ['lib/state/store.js',...ENGINE_FILES,'lib/state/page-store.js','lib/resources/redirect-resources.js','lib/state/remote-lists.js', 'lib/state/suggested-lists.js','lib/resources/csp-resources.js',...SCRIPTLET_FILES,'lib/resources/rewrite-resources.js','lib/compile/compile-cache.js','lib/compile/compiler.js',...WAPI_FILES, ...BACKGROUND_FILES]
    .forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f}));
  const bgSource = fs.readFileSync(path.join(ROOT,'background.js'),'utf8')
    .replace(/  wildfire\.start\(\);\n\}\)\(\);\s*$/, '  globalThis.__wildfireTest = wildfire.debug(); wildfire.start(); })();');
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });
  await new Promise(r=>setTimeout(r,30));
  const api = ctx.__wildfireTest;
  api.setState({ enabled: true, customFilters: '||track.example^$removeparam=utm_source\n||api.example^$removeheader=response:x-track', disabledSites: [] });
  await api.loadFilters(true); await new Promise(r=>setTimeout(r,30));

  const br = apiHooks.onBeforeRequest({ url:'https://track.example/p.gif?utm_source=x&keep=1', type:'image', tabId:1, frameId:0, documentUrl:'https://site.test/' });
  assert.ok(br && br.redirectUrl && br.redirectUrl.includes('keep=1') && !br.redirectUrl.includes('utm_source'), 'removeparam redirects cleaned URL');

  const hr = apiHooks.onHeadersReceived({ url:'https://api.example/data', type:'xmlhttprequest', tabId:1, frameId:0, documentUrl:'https://site.test/', responseHeaders:[{name:'X-Track',value:'1'},{name:'Content-Type',value:'text/plain'}] });
  assert.ok(hr && hr.responseHeaders && !hr.responseHeaders.some(h=>h.name.toLowerCase()==='x-track'), 'removeheader strips response header');

  const cspHeaderInput = [
    {name:'Content-Security-Policy',value:"default-src 'self'; report-uri https://reports.example/csp; script-src 'self'"},
    {name:'Content-Security-Policy-Report-Only',value:'report-to csp-endpoint; default-src *'},
    {name:'Reporting-Endpoints',value:'csp-endpoint="https://reports.example/csp"'},
    {name:'X-Track',value:'1'}
  ];
  const cspHeaders = apiHooks.onHeadersReceived({
    url:'https://api.example/page', type:'xmlhttprequest', tabId:1, frameId:0, documentUrl:'https://site.test/',
    responseHeaders: cspHeaderInput
  });
  const csp = name => cspHeaders.responseHeaders.find(h => h.name.toLowerCase() === name).value;
  assert.ok(!/report-(uri|to)/i.test(csp('content-security-policy')), 'report directives are stripped from enforcing CSP headers');
  assert.ok(csp('content-security-policy').includes("default-src 'self'") &&
    csp('content-security-policy').includes("script-src 'self'"), 'CSP enforcement directives stay intact');
  assert.ok(!/report-to/i.test(csp('content-security-policy-report-only')), 'report directives are stripped from report-only headers');
  assert.ok(csp('reporting-endpoints').includes('reports.example'), 'Reporting-Endpoints headers are untouched');
  const cspReport = apiHooks.onCspReportRequest({
    url:'https://reports.example/csp', type:'csp_report', tabId:1, frameId:0, documentUrl:'https://site.test/'
  });
  assert.ok(cspReport && cspReport.cancel, 'legacy CSP report requests are cancelled');
  api.setState({ cspReportAllow: ['reports.example'] });
  assert.strictEqual(apiHooks.onCspReportRequest({
    url:'https://reports.example/csp', type:'csp_report', tabId:1, frameId:0, documentUrl:'https://site.test/'
  }), undefined, 'allowed report endpoints receive reports');
  const allowedCspHeaders = apiHooks.onHeadersReceived({
    url:'https://api.example/page', type:'xmlhttprequest', tabId:1, frameId:0, documentUrl:'https://site.test/',
    responseHeaders: cspHeaderInput
  });
  const allowedCsp = name => allowedCspHeaders.responseHeaders.find(h => h.name.toLowerCase() === name).value;
  assert.ok(allowedCsp('content-security-policy').includes('report-uri https://reports.example/csp'),
    'allowed report-uri directives are preserved');
  assert.ok(allowedCsp('content-security-policy-report-only').includes('report-to csp-endpoint'),
    'allowed report-to directives are preserved through Reporting-Endpoints');
  api.setState({ cspReportAllow: [], enabled: false });
  assert.strictEqual(apiHooks.onCspReportRequest({
    url:'https://reports.example/csp', type:'csp_report', tabId:1, frameId:0, documentUrl:'https://site.test/'
  }), undefined, 'global pause also pauses CSP report blocking');
  api.setState({ enabled: true });

  // request header removal + exception/precedence
  api.setState({ enabled: true, customFilters: [
    '||x.example^$removeheader=request:cookie',
    '@@||x.example/allow.js$removeheader=request:cookie',
    '||x.example^$removeparam=fbclid',
    '||x.example^$script'
  ].join('\n'), disabledSites: [] });
  await api.loadFilters(true); await new Promise(r=>setTimeout(r,30));
  const req = apiHooks.onBeforeSendHeaders({ url:'https://x.example/api', type:'xmlhttprequest', tabId:1, frameId:0, documentUrl:'https://site.test/', requestHeaders:[{name:'Cookie',value:'a=1'},{name:'Accept',value:'*/*'}] });
  assert.ok(req && !req.requestHeaders.some(h=>h.name.toLowerCase()==='cookie'), 'request header removed');
  const reqEx = apiHooks.onBeforeSendHeaders({ url:'https://x.example/allow.js', type:'xmlhttprequest', tabId:1, frameId:0, documentUrl:'https://site.test/', requestHeaders:[{name:'Cookie',value:'a=1'}] });
  assert.strictEqual(reqEx, undefined, 'removeheader exception wins');
  const rpBlock = apiHooks.onBeforeRequest({ url:'https://x.example/app.js?fbclid=1', type:'script', tabId:1, frameId:0, documentUrl:'https://site.test/' });
  assert.ok(rpBlock && (rpBlock.redirectUrl || rpBlock.cancel), 'removeparam or block applies');

  // badfilter/important/domain/navigation semantics
  api.setState({ enabled: true, customFilters: [
    '||nav.example^$removeparam=utm_source',
    '||nav.example^$removeparam=utm_source,badfilter',
    '||dom.example^$removeparam=fbclid,domain=allowed.test',
    '@@||keep.example^$removeparam=keep',
    '||keep.example^$removeparam=keep,important',
    '@@||imp.example^$removeparam=id,important',
    '||imp.example^$removeparam=id'
  ].join('\n'), disabledSites: [] });
  await api.loadFilters(true); await new Promise(r=>setTimeout(r,30));
  const nav = apiHooks.onBeforeRequest({ url:'https://nav.example/page?utm_source=x', type:'main_frame', tabId:2, frameId:0, documentUrl:'https://nav.example/page?utm_source=x' });
  assert.strictEqual(nav, undefined, 'badfilter disables removeparam');
  const domNo = apiHooks.onBeforeRequest({ url:'https://dom.example/x?fbclid=1', type:'image', tabId:2, frameId:0, documentUrl:'https://other.test/' });
  assert.strictEqual(domNo, undefined, 'removeparam domain scope respected');
  const domYes = apiHooks.onBeforeRequest({ url:'https://dom.example/x?fbclid=1', type:'image', tabId:2, frameId:0, documentUrl:'https://allowed.test/' });
  assert.ok(domYes && domYes.redirectUrl && !domYes.redirectUrl.includes('fbclid'), 'removeparam applies on matching domain');
  const impBlock = apiHooks.onBeforeRequest({ url:'https://keep.example/x?keep=1', type:'image', tabId:2, frameId:0, documentUrl:'https://site.test/' });
  assert.ok(impBlock && impBlock.redirectUrl, 'important removeparam overrides exception');
  const impEx = apiHooks.onBeforeRequest({ url:'https://imp.example/x?id=1', type:'image', tabId:2, frameId:0, documentUrl:'https://site.test/' });
  assert.strictEqual(impEx, undefined, 'important remove exception wins');

  // type scoping, navigation positive, removeheader badfilter/important, redirect precedence
  api.setState({ enabled: true, customFilters: [
    '||type.example^$removeparam=fbclid,image',
    '||nav2.example^$removeparam=utm_source',
    '||hdr.example^$removeheader=response:x-a',
    '||hdr.example^$removeheader=response:x-a,badfilter',
    '@@||hdr2.example^$removeheader=request:cookie',
    '||hdr2.example^$removeheader=request:cookie,important',
    '||mix.example^$removeparam=ad,script',
    '||mix.example^$script'
  ].join('\n'), disabledSites: [] });
  await api.loadFilters(true); await new Promise(r=>setTimeout(r,30));
  const typeNo = apiHooks.onBeforeRequest({ url:'https://type.example/x?fbclid=1', type:'script', tabId:2, frameId:0, documentUrl:'https://site.test/' });
  assert.strictEqual(typeNo, undefined, 'removeparam type scope respected');
  const typeYes = apiHooks.onBeforeRequest({ url:'https://type.example/x?fbclid=1', type:'image', tabId:2, frameId:0, documentUrl:'https://site.test/' });
  assert.ok(typeYes && typeYes.redirectUrl, 'removeparam type scope matches');
  const navPos = apiHooks.onBeforeRequest({ url:'https://nav2.example/?utm_source=x', type:'main_frame', tabId:2, frameId:0, documentUrl:'https://nav2.example/?utm_source=x' });
  assert.ok(navPos && navPos.redirectUrl && !navPos.redirectUrl.includes('utm_source'), 'removeparam applies to navigation');
  const hdrBad = apiHooks.onHeadersReceived({ url:'https://hdr.example/x', type:'xmlhttprequest', tabId:2, frameId:0, documentUrl:'https://site.test/', responseHeaders:[{name:'X-A',value:'1'}] });
  assert.strictEqual(hdrBad, undefined, 'removeheader badfilter disables rule');
  const hdrImp = apiHooks.onBeforeSendHeaders({ url:'https://hdr2.example/x', type:'xmlhttprequest', tabId:2, frameId:0, documentUrl:'https://site.test/', requestHeaders:[{name:'Cookie',value:'a=1'}] });
  assert.ok(hdrImp && !hdrImp.requestHeaders.some(h=>h.name.toLowerCase()==='cookie'), 'important removeheader overrides exception');
  const mix = apiHooks.onBeforeRequest({ url:'https://mix.example/app.js?ad=1', type:'script', tabId:2, frameId:0, documentUrl:'https://site.test/' });
  assert.ok(mix && mix.cancel, 'block takes precedence over removeparam');
}

async function testIncrementalRemoteCompileSemantics() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial);
    return {
      async get(key) { return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch); },
      get data() { return data; }
    };
  }

  const cache = WildFireCompileCache.create({ browserApi: { storage: { local: memoryStorage({}) } }, version: FilterEngine.COMPILED_VERSION });
  const calls = [];
  const compiler = {
    async compile(text) {
      calls.push(text);
      const e = new FilterEngine(null, () => '', null, () => false);
      e.load(text);
      return { compiled: e.toCompiled(), counts: e.counts };
    }
  };

  async function loadCompiledOrText(engine, text) {
    let compiled = await cache.get(text);
    if (!compiled) compiled = (await compiler.compile(text)).compiled;
    if (compiled && compiled.v === FilterEngine.COMPILED_VERSION) await cache.set(text, compiled);
    if (!compiled || !engine.loadCompiled(compiled, { append: true })) engine.load(text, { append: true });
  }

  const remoteA = '! wildfire remote: https://a\n||a.example^$script';
  const remoteB = '! wildfire remote: https://b\n@@||a.example/allow.js$script';
  const engine1 = new FilterEngine();
  await loadCompiledOrText(engine1, remoteA);
  await loadCompiledOrText(engine1, remoteB);
  assert.strictEqual(calls.length, 2, 'two remote lists compile once');

  const engine2 = new FilterEngine();
  await loadCompiledOrText(engine2, remoteA);
  await loadCompiledOrText(engine2, remoteB);
  assert.strictEqual(calls.length, 2, 'unchanged remote lists use cache, no recompile');

  assert.strictEqual(engine2.matchRequest('https://a.example/app.js', 'script', 'https://site.test/').blocked, true, 'block rule applies');
  assert.strictEqual(engine2.matchRequest('https://a.example/allow.js', 'script', 'https://site.test/').blocked, false, 'exception semantics preserved');

  const remoteBChanged = '! wildfire remote: https://b\n@@||a.example/allow.js$script\n||b.example^';
  const engine3 = new FilterEngine();
  await loadCompiledOrText(engine3, remoteA);
  await loadCompiledOrText(engine3, remoteBChanged);
  assert.strictEqual(calls.length, 3, 'only changed remote list recompiles');
  assert.strictEqual(engine3.matchRequest('https://b.example/x.js', 'script', 'https://site.test/').blocked, true, 'changed list rule applies');

  const corruptKey = cache.keyFor(remoteA);
  const corruptStorage = memoryStorage({ 'wildfire.compiled.cache.v1': { [corruptKey]: { v: FilterEngine.COMPILED_VERSION, compiled: { v: FilterEngine.COMPILED_VERSION, n: 'bad' }, at: Date.now() } } });
  const corruptCache = WildFireCompileCache.create({ browserApi: { storage: { local: corruptStorage } }, version: FilterEngine.COMPILED_VERSION });
  const engine4 = new FilterEngine();
  const cached = await corruptCache.get(remoteA);
  assert.strictEqual(cached, null, 'corrupt cache entry rejected');
  engine4.load(remoteA, { append: true });
  await loadCompiledOrText(engine4, remoteB);
  assert.strictEqual(engine4.matchRequest('https://a.example/app.js', 'script', 'https://site.test/').blocked, true, 'fallback load keeps rule active');
}

async function testCompileCacheAndCompiler() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial);
    return {
      async get(key) { return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch); },
      get data() { return data; }
    };
  }

  const storage = memoryStorage({});
  const cache = WildFireCompileCache.create({ browserApi: { storage: { local: storage } }, version: FilterEngine.COMPILED_VERSION });
  const text = '||cache.example^';
  const compiled = { v: FilterEngine.COMPILED_VERSION, cap: 0, n: [], c: { g: [], ge: [], d: [], de: [] }, p: { g: [], ge: [], d: [], de: [] }, s: [], d: [] };
  await cache.set(text, compiled, { source: 'remote', hash: 'h' });
  assert.deepStrictEqual(await cache.get(text), compiled, 'compile cache round-trips compiled data');

  // In-memory LRU tier: `set` populates memory synchronously, so a subsequent
  // `get` must be served without any storage.local read.
  let storageReads = 0;
  const countingStorage = {
    async get(key) { storageReads += 1; return {}; },
    async set() {}
  };
  const memCache = WildFireCompileCache.create({ browserApi: { storage: { local: countingStorage } }, version: FilterEngine.COMPILED_VERSION });
  await memCache.set('||mem.example^', compiled);
  const readsAfterSet = storageReads;
  assert.deepStrictEqual(await memCache.get('||mem.example^'), compiled, 'memory tier returns compiled blob');
  assert.strictEqual(storageReads, readsAfterSet, 'memory cache hit avoids storage read');

  await cache.set(text, { v: 999, n: [] });
  assert.deepStrictEqual(await cache.get(text), compiled, 'invalid compiled version is ignored');

  const corruptStorage = memoryStorage({ 'wildfire.compiled.cache.v1': { [cache.keyFor('bad')]: { v: FilterEngine.COMPILED_VERSION, compiled: { v: FilterEngine.COMPILED_VERSION, n: 'bad' } } } });
  const corruptCache = WildFireCompileCache.create({ browserApi: { storage: { local: corruptStorage } }, version: FilterEngine.COMPILED_VERSION });
  assert.strictEqual(await corruptCache.get('bad'), null, 'corrupt compiled entry is rejected');

  class FakeWorker {
    constructor() { this.messages = []; this.terminated = false; }
    postMessage(msg) {
      this.messages.push(msg);
      if (msg.type === 'ping') {
        this.onmessage({ data: { id: msg.id, ok: true, type: 'pong' } });
      }
    }
    terminate() { this.terminated = true; }
  }

  let worker = null;
  const WorkerCtor = class extends FakeWorker { constructor() { super(); worker = this; } };
  context.browser = { runtime: { getURL: p => p } };
  const compiler = WildFireCompiler.create({ browserApi: context.browser, Worker: WorkerCtor });

  const pending = compiler.compile('||worker.example^');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(worker.messages.length, 1, 'worker receives compile message');
  const msg = worker.messages[0];
  worker.onmessage({ data: { id: msg.id, ok: true, type: 'compiled', compiled, counts: { network: 1 } } });
  const result = await pending;
  assert.strictEqual(result.counts.network, 1, 'worker compile result resolves');

  const ping = await compiler.ping();
  assert.strictEqual(ping, true, 'worker ping responds');

  const cancelPending = compiler.compile('||cancel.example^');
  await new Promise(resolve => setImmediate(resolve));
  const cancelMsg = worker.messages.slice().reverse().find(m => m.type === 'compile' && m.text === '||cancel.example^');
  assert.ok(cancelMsg, 'cancel compile message sent');
  const cancelResult = compiler.cancel(cancelMsg.id);
  if (!cancelResult) {
    console.error('debug cancel', { pending: compiler.pendingCount(), ids: worker.messages.map(m => m.id), types: worker.messages.map(m => m.type) });
  }
  assert.strictEqual(cancelResult, true, 'pending compile can be cancelled');
  await assert.rejects(cancelPending, /cancelled/, 'cancelled compile rejects');

  const oldWorker = worker;
  compiler.restart('test');
  assert.strictEqual(oldWorker.terminated, true, 'restart terminates old worker');
  compiler.destroy();
}

async function testCompileInFlightDedup() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial);
    return {
      async get(key) { return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch); }
    };
  }
  const ctx = vm.createContext({
    console, URL, setTimeout, clearTimeout, setImmediate, Promise, Map, Set, Array, Object,
    String, RegExp, JSON, Math, Boolean, Number, Error,
    fetch: async url => {
      const u = String(url);
      if (u.includes('default.txt')) return { ok: true, text: async () => '' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
  });
  ctx.globalThis = ctx; ctx.window = ctx;
  ctx.browser = {
    runtime: { getURL: p => p, onMessage: { addListener: () => {} } },
    storage: { local: memoryStorage({}) },
    browserAction: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} },
    webRequest: {
      onBeforeRequest: { addListener: () => {} }, onBeforeSendHeaders: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} }, onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} }, onBeforeRedirect: { addListener: () => {} },
      filterResponseData: () => ({})
    },
    webNavigation: {
      onCreatedNavigationTarget: { addListener: () => {} }, onCommitted: { addListener: () => {} },
      onReferenceFragmentUpdated: { addListener: () => {} }, onHistoryStateUpdated: { addListener: () => {} }
    },
    tabs: { query: async () => [], onUpdated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, sendMessage: async () => {}, remove: async () => {} },
    alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, get: async () => null, create: async () => {} },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: h => h.split('.').slice(-2).join('.') }
  };
  ['lib/state/store.js', ...ENGINE_FILES, 'lib/state/page-store.js', 'lib/resources/redirect-resources.js',
    'lib/state/remote-lists.js', 'lib/state/suggested-lists.js', 'lib/resources/csp-resources.js', ...SCRIPTLET_FILES, 'lib/resources/rewrite-resources.js',
    'lib/compile/compile-cache.js', 'lib/compile/compiler.js', ...WAPI_FILES, ...BACKGROUND_FILES]
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

  let compileCalls = 0;
  const mk = text => {
    const e = new ctx.FilterEngine(null, () => '', null, () => false);
    e.load(text);
    return { compiled: e.toCompiled(), counts: e.counts, capabilities: e.capabilities };
  };
  // Counting compiler stands in for the worker so we can observe dedup/memory.
  ctx.WildFireCompiler = {
    create: () => ({
      compile(text) { compileCalls += 1; return new Promise(res => setImmediate(() => res(mk(text)))); },
      on() { return () => {}; }, pendingCount() { return 0; }, cancelAll() {}, restart() {},
      ping() { return Promise.resolve(true); }
    }),
    compileSync(text) { return mk(text); }
  };
  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  wildfire\.start\(\);\n\}\)\(\);\s*$/, '  globalThis.__wildfireTest = wildfire.debug(); wildfire.start(); })();');
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });
  await new Promise(r => setTimeout(r, 20));
  const api = ctx.__wildfireTest;
  const text = '||dedup.example^$script';
  const [a, b] = await Promise.all([
    api.compileText(text, { source: 'custom' }, undefined, false),
    api.compileText(text, { source: 'custom' }, undefined, false)
  ]);
  assert.strictEqual(compileCalls, 1, 'concurrent identical compiles dedup to one');
  assert.deepStrictEqual(a, b, 'deduped compiles return the same blob');
  const c = await api.compileText(text, { source: 'custom' }, undefined, false);
  assert.strictEqual(compileCalls, 1, 'sequential repeat hits memory cache, no recompile');
  assert.ok(c && c.v === ctx.FilterEngine.COMPILED_VERSION, 'memory-cached blob is valid');
}

async function testCompileCacheIdbLru() {
  // Minimal fake IndexedDB exercising the subset compile-cache uses, so the
  // LRU prune (by `at`, not insertion order) is provable without a browser.
  function fakeIndexedDB() {
    const stores = new Map();
    const makeReq = result => {
      const r = { result, onsuccess: null, onerror: null };
      setImmediate(() => r.onsuccess && r.onsuccess());
      return r;
    };
    const makeTx = map => {
      const tx = {
        oncomplete: null, onerror: null,
        objectStore: () => ({
          get: k => makeReq(map.has(k) ? map.get(k) : undefined),
          put: (v, k) => { map.set(k, v); return makeReq(true); },
          delete: k => { map.delete(k); return makeReq(true); },
          getAll: () => makeReq(Array.from(map.values())),
          getAllKeys: () => makeReq(Array.from(map.keys()))
        })
      };
      setImmediate(() => setImmediate(() => tx.oncomplete && tx.oncomplete()));
      return tx;
    };
    return {
      open() {
        const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        setImmediate(() => {
          r.result = {
            objectStoreNames: { contains: n => stores.has(n) },
            createObjectStore: n => stores.set(n, new Map()),
            transaction: n => makeTx(stores.get(n))
          };
          r.onupgradeneeded && r.onupgradeneeded();
          r.onsuccess && r.onsuccess();
        });
        return r;
      },
      _store: () => stores.get('compiled')
    };
  }
  const idb = fakeIndexedDB();
  const prevIdb = context.indexedDB;
  context.indexedDB = idb;
  try {
    const cache = WildFireCompileCache.create({ browserApi: { storage: { local: { async get() { return {}; }, async set() {} } } }, version: FilterEngine.COMPILED_VERSION });
    const blob = { v: FilterEngine.COMPILED_VERSION, cap: 0, n: [], c: { g: [], ge: [], d: [], de: [] }, p: { g: [], ge: [], d: [], de: [] }, s: [], d: [] };
    // Fill to capacity with ascending `at`.
    await Array.from({ length: 64 }).reduce((chain, _, i) => chain.then(() =>
      cache.set('t' + i, blob, { at: i + 1 })), Promise.resolve());
    // Touch t0 so it becomes the most-recently-used, then add one more entry.
    await cache.set('t0', blob, { at: 9999 });
    await cache.set('t64', blob, { at: 5000 });
    const store = idb._store();
    assert.ok(store.has(cache.keyFor('t0')), 'LRU prune keeps recently touched entry');
    assert.ok(!store.has(cache.keyFor('t1')), 'LRU prune evicts least-recently-used entry');
    assert.ok(store.has(cache.keyFor('t64')), 'newest entry retained');
    assert.ok(store.size <= 64, 'IDB cache bounded to MAX_ENTRIES');
  } finally {
    context.indexedDB = prevIdb;
  }
}

function runCompatibilityFixtures() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/compatibility.json'), 'utf8'));
  fixtures.cases.forEach(testCase => {
    const e = new FilterEngine(
      null,
      alias => alias === 'no-script' ? "script-src 'none'" : '',
      testCase.scriptlets ? { validate: () => null } : null,
      alias => alias === 'blank-js'
    );
    e.load(testCase.rules.join('\n'));

    const expect = testCase.expect || {};
    (expect.capabilities || []).forEach(name => {
      const flag = FilterEngine.CAP[name];
      assert.ok(flag, 'unknown capability in fixture: ' + name);
      assert.ok(e.getCapabilities() & flag, testCase.name + ': capability ' + name);
    });
    if (typeof expect.scriptletCount === 'number') {
      assert.strictEqual(e.scriptletRules.length, expect.scriptletCount, testCase.name + ': scriptlet count');
    }
    (expect.diagnosticCategories || []).forEach(category => {
      assert.ok(e.getDiagnostics().some(d => d.category === category), testCase.name + ': diagnostic category ' + category);
    });
    if (Array.isArray(expect.diagnostics) && expect.diagnostics.length === 0) {
      assert.strictEqual(e.getDiagnostics().length, 0, testCase.name + ': no diagnostics');
    }

    (testCase.matches || []).forEach(m => {
      const r = e.matchRequest(m.url, mapResourceType(m.type), m.documentUrl || '');
      assert.strictEqual(r.blocked, Boolean(m.blocked), testCase.name + ': match ' + m.url);
      if (typeof m.important === 'boolean') assert.strictEqual(Boolean(r.important), m.important, testCase.name + ': important ' + m.url);
    });
    (testCase.cosmetic || []).forEach(c => {
      const sels = e.getCosmetic(c.host);
      (c.includes || []).forEach(sel => assert.ok(sels.includes(sel), testCase.name + ': cosmetic includes ' + sel));
      (c.excludes || []).forEach(sel => assert.ok(!sels.includes(sel), testCase.name + ': cosmetic excludes ' + sel));
    });
    if (testCase.proceduralCount) {
      const pc = testCase.proceduralCount;
      assert.strictEqual(e.getProcedural(pc.host).length, pc.count, testCase.name + ': procedural count');
    }

    // Compile round-trip invariants for fixture
    const blob = e.toCompiled();
    const e2 = new FilterEngine(null, alias => alias === 'no-script' ? "script-src 'none'" : '', testCase.scriptlets ? { validate: () => null } : null, alias => alias === 'blank-js');
    assert.strictEqual(e2.loadCompiled(blob), true, testCase.name + ': compiled round-trip');
    assert.strictEqual(e2.getCapabilities(), e.getCapabilities(), testCase.name + ': capabilities round-trip');
  });
}

function runPerfBaseline() {
  const enabled = process.env.WILDFIRE_PERF === '1';
  const rules = fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8');
  const parseStart = process.hrtime.bigint();
  const e = new FilterEngine();
  e.load(rules);
  const parseMs = Number(process.hrtime.bigint() - parseStart) / 1e6;

  const compileStart = process.hrtime.bigint();
  const blob = e.toCompiled();
  const compileMs = Number(process.hrtime.bigint() - compileStart) / 1e6;

  const loadStart = process.hrtime.bigint();
  const e2 = new FilterEngine();
  e2.loadCompiled(blob);
  const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6;

  const urls = [
    ['https://securepubads.g.doubleclick.net/gampad/ads', 'script', 'https://example.com/'],
    ['https://example.com/app.js', 'script', 'https://example.com/'],
    ['https://tracker.example/pixel.gif', 'image', 'https://news.example/']
  ];
  const matchStart = process.hrtime.bigint();
  Array.from({ length: 2000 }).forEach(() => urls.forEach(u => e2.matchRequest(u[0], u[1], u[2])));
  const matchMs = Number(process.hrtime.bigint() - matchStart) / 1e6;

  const cosStart = process.hrtime.bigint();
  Array.from({ length: 2000 }).forEach(() => e2.getCosmetic('example.com'));
  const cosmeticMs = Number(process.hrtime.bigint() - cosStart) / 1e6;

  const report = { parseMs, compileMs, loadMs, matchMs, cosmeticMs, network: e.counts.network, cosmetic: e.counts.cosmetic };
  if (enabled) console.log('WildFire perf baseline:', JSON.stringify(report));
  // Sanity guards - loose, just catch catastrophic regressions.
  assert.ok(parseMs < 5000, 'parse baseline sanity');
  assert.ok(compileMs < 5000, 'compile baseline sanity');
  assert.ok(loadMs < 5000, 'loadCompiled baseline sanity');
}

async function testPhase0Foundation() {
  // Rule IR / diagnostics / capabilities
  const ir = new FilterEngine(null, alias => alias === 'no-script' ? "script-src 'none'" : '', { validate: () => null }, alias => alias === 'blank-js');
  ir.load([
    '||ads.example^$script,third-party,important',
    '@@||ads.example/allow.js$script',
    '||track.example^$redirect=noopjs,script',
    '||page.example^$csp=no-script',
    '||asset.example^$rewrite=blank-js,script',
    'example.com##.ad',
    'example.com##div:has-text(Ad)',
    'example.com##+js(set-constant, a, 1)',
    '/bad(regex/',
    '||bad.example^$csp=unknown-alias'
  ].join('\n'));

  assert.ok(ir.getCapabilities() & FilterEngine.CAP.NETWORK, 'network capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.EXCEPTION, 'exception capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.IMPORTANT, 'important capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.REDIRECT, 'redirect capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.CSP, 'csp capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.REWRITE, 'rewrite capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.THIRD_PARTY, 'third-party capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.COSMETIC, 'cosmetic capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.PROCEDURAL, 'procedural capability');
  assert.ok(ir.getCapabilities() & FilterEngine.CAP.SCRIPTLET, 'scriptlet capability');

  const diags = ir.getDiagnostics();
  assert.ok(diags.some(d => d.category === 'network' && d.type === 'rejected'), 'regex parse diagnostic');
  assert.ok(diags.some(d => d.category === 'csp' && /unknown CSP alias/.test(d.reason)), 'csp rejection diagnostic');
  assert.ok(diags.every(d => typeof d.hash === 'string' && d.hash.length > 0), 'diagnostics have hashes');
  assert.ok(diags.every(d => ['wildfire', 'ubo', 'adguard', 'abp'].includes(d.sourceKind)), 'diagnostics have source kind');

  // Compiled IR round-trip preserves capabilities and diagnostics
  const compiled = ir.toCompiled();
  assert.strictEqual(compiled.v, FilterEngine.COMPILED_VERSION, 'compiled version present');
  assert.strictEqual(compiled.cap, ir.getCapabilities(), 'compiled cap matches');
  assert.ok(Array.isArray(compiled.d), 'compiled diagnostics');
  const ir2 = new FilterEngine(null, () => 'script-src \'none\'', { validate: () => null }, () => true);
  assert.strictEqual(ir2.loadCompiled(compiled), true, 'load compiled version');
  assert.strictEqual(ir2.getCapabilities(), ir.getCapabilities(), 'capabilities round-trip');
  assert.ok(ir2.getDiagnostics().length >= diags.length, 'diagnostics round-trip');

  // v1 compiled blobs are rejected (schema bump invalidation)
  const v1Blob = { v: 1, n: [], c: { g: [], ge: [], d: [], de: [] }, p: { g: [], ge: [], d: [], de: [] }, s: [] };
  const ir3 = new FilterEngine();
  assert.strictEqual(ir3.loadCompiled(v1Blob), false, 'v1 compiled rejected');

  // Safe rejection of unsupported/invalid syntax does not throw
  const safe = new FilterEngine(null, () => '', { validate: () => null }, () => true);
  assert.doesNotThrow(() => safe.load([
    '||ok.example^',
    '/(a+)+$/',
    '##+js(trusted-click-element, body)',
    '||x.example^$csp=nope',
    '||x.example^$rewrite=nope'
  ].join('\n')), 'unsupported/invalid rules do not throw');
  assert.strictEqual(safe.matchRequest('https://ok.example/x.js', 'script', 'https://site.test/').blocked, true, 'valid rule still active after rejections');

  runCompatibilityFixtures();
  runPerfBaseline();
}

async function testPhase1AAliases() {
  const e = new FilterEngine();
  e.load([
    '||a.example^$1p',
    '||b.example^$3p',
    '||c.example^$xhr',
    '||d.example^$css',
    '||e.example^$frame',
    '||f.example^$doc',
    '||g.example^$all',
    '@@||h.example^$ghide',
    '@@||i.example^$ehide',
    '@@||j.example^$shide'
  ].join('\n'));

  assert.strictEqual(e.matchRequest('https://a.example/x.js', 'script', 'https://a.example/').blocked, true, '1p same-site matches');
  assert.strictEqual(e.matchRequest('https://a.example/x.js', 'script', 'https://other.test/').blocked, false, '1p blocks third-party? no, 1p means first-party only');
  assert.strictEqual(e.matchRequest('https://b.example/x.js', 'script', 'https://other.test/').blocked, true, '3p matches third-party');
  assert.strictEqual(e.matchRequest('https://b.example/x.js', 'script', 'https://b.example/').blocked, false, '3p skips first-party');
  assert.strictEqual(e.matchRequest('https://c.example/x', 'xmlhttprequest', 'https://site.test/').blocked, true, 'xhr alias');
  assert.strictEqual(e.matchRequest('https://d.example/x.css', 'stylesheet', 'https://site.test/').blocked, true, 'css alias');
  assert.strictEqual(e.matchRequest('https://e.example/frame', 'subdocument', 'https://site.test/').blocked, true, 'frame alias');
  assert.strictEqual(e.matchRequest('https://f.example/page', 'document', 'https://site.test/').blocked, true, 'doc alias');
  assert.strictEqual(e.matchRequest('https://g.example/anything', 'image', 'https://site.test/').blocked, true, '$all matches image');
  assert.strictEqual(e.matchRequest('https://g.example/anything', 'script', 'https://site.test/').blocked, true, '$all matches script');

  assert.ok(e.getCapabilities() & FilterEngine.CAP.GENERICHIDE, 'ghide capability');
  assert.ok(e.getCapabilities() & FilterEngine.CAP.ELEMHIDE, 'ehide capability');
  assert.ok(e.getCapabilities() & FilterEngine.CAP.SPECIFICHIDE, 'shide capability');

  const blob = e.toCompiled();
  const e2 = new FilterEngine();
  assert.strictEqual(e2.loadCompiled(blob), true, 'compiled alias rules load');
  assert.strictEqual(e2.matchRequest('https://c.example/x', 'xmlhttprequest', 'https://site.test/').blocked, true, 'compiled xhr alias');
  assert.ok(e2.getCapabilities() & FilterEngine.CAP.GENERICHIDE, 'compiled ghide capability');
}

async function testHideExceptionModifiers() {
  const e = new FilterEngine();
  e.load([
    '##.global-ad',
    'example.com##.specific-ad',
    '@@||example.com^$generichide',
    '##.keep'
  ].join('\n'));
  const policy = e.getHidePolicy('https://example.com/page', 'document', 'https://example.com/page');
  assert.strictEqual(policy.generichide, true, 'generichide policy');
  const sels = e.getCosmetic('example.com', policy);
  assert.strictEqual(JSON.stringify(sels.slice().sort()), JSON.stringify(['.specific-ad']), 'generichide hides generic only');

  const e2 = new FilterEngine();
  e2.load(['##.global-ad', 'example.com##.specific-ad', '@@||example.com^$elemhide'].join('\n'));
  const p2 = e2.getHidePolicy('https://example.com/page', 'document', 'https://example.com/page');
  assert.strictEqual(e2.getCosmetic('example.com', p2).length, 0, 'elemhide disables all cosmetic rules');
  assert.strictEqual(e2.getProcedural('example.com', p2).length, 0, 'elemhide disables procedural');

  const e3 = new FilterEngine();
  e3.load(['##.global-ad', 'example.com##.specific-ad', '@@||example.com^$specifichide'].join('\n'));
  const p3 = e3.getHidePolicy('https://example.com/page', 'document', 'https://example.com/page');
  assert.strictEqual(JSON.stringify(e3.getCosmetic('example.com', p3).slice().sort()), JSON.stringify(['.global-ad']), 'specifichide hides domain-specific only');

  const e4 = new FilterEngine();
  e4.load([
    '##.global-ad',
    'example.com##.specific-ad',
    '@@||example.com^$generichide',
    '@@||example.com^$generichide,badfilter'
  ].join('\n'));
  const p4 = e4.getHidePolicy('https://example.com/page', 'document', 'https://example.com/page');
  assert.strictEqual(p4.generichide, false, 'badfilter disables generichide exception');
  assert.ok(e4.getCosmetic('example.com', p4).includes('.global-ad'), 'generic visible when generichide badfiltered');

  const eScoped = new FilterEngine();
  eScoped.load(['##.global', 'example.com##.specific', '@@||example.com^$generichide,domain=example.com'].join('\n'));
  const pScoped = eScoped.getHidePolicy('https://example.com/', 'document', 'https://example.com/');
  assert.strictEqual(pScoped.generichide, true, 'domain-scoped generichide applies');
  const pOther = eScoped.getHidePolicy('https://other.example/', 'document', 'https://other.example/');
  assert.strictEqual(pOther.generichide, false, 'generichide domain scope respected');

  const eRealm = new FilterEngine(null, resolveCsp);
  eRealm.load([
    '##.ad',
    '||ads.example^$script',
    '@@||ads.example^$generichide',
    '||ads.example^$csp=no-script',
    '||ads.example^$removeparam=track',
    '||ads.example^$removeheader=response:x-ad'
  ].join('\n'));
  assert.strictEqual(eRealm.matchRequest('https://ads.example/a.js', 'script', 'https://page.example/').blocked,
    true, 'a hide exception cannot unblock a script');
  assert.deepStrictEqual(
    Array.from(eRealm.matchCsp('https://ads.example/a.js', 'script', 'https://page.example/').directives),
    ["script-src 'none'"], 'a hide exception cannot suppress CSP injection');
  assert.strictEqual(eRealm.matchRemoveparam('https://ads.example/a.js?track=1', 'script', 'https://page.example/').params.length,
    1, 'a hide exception cannot suppress removeparam');
  assert.strictEqual(eRealm.matchRemoveheader('https://ads.example/a.js', 'script', 'https://page.example/').headers.length,
    1, 'a hide exception cannot suppress removeheader');

  const eInvalid = new FilterEngine(null, resolveCsp);
  eInvalid.load([
    '||ads.example^$generichide',
    '||ads.example^$script,generichide',
    '||ads.example^$csp',
    '@@||ads.example^$generichide,csp=no-script'
  ].join('\n'));
  assert.strictEqual(eInvalid.rejectedRegex.length, 4,
    'non-exception hide, bare csp and mixed-realm rules are rejected');
  assert.strictEqual(eInvalid.matchRequest('https://ads.example/a.js', 'script', 'https://page.example/').blocked,
    false, 'rejected hide rules never become blockers');

  const realmBlob = eRealm.toCompiled();
  const eRestored = new FilterEngine(null, resolveCsp);
  assert.strictEqual(eRestored.loadCompiled(realmBlob), true, 'realm-separated compiled blob loads');
  assert.strictEqual(eRestored.getHidePolicy('https://ads.example/', 'document', 'https://ads.example/').generichide,
    true, 'hide realm survives compiled load');
  assert.strictEqual(eRestored.matchRequest('https://ads.example/a.js', 'script', 'https://page.example/').blocked,
    true, 'network realm survives compiled load');
  assert.deepStrictEqual(
    Array.from(eRestored.matchCsp('https://ads.example/a.js', 'script', 'https://page.example/').directives),
    ["script-src 'none'"], 'csp realm survives compiled load');

  const e5 = new FilterEngine();
  e5.load([
    'example.com#?#div:-abp-has(.ad)',
    'example.com#?#div:-abp-properties(color: red)',
    'example.com#?#div:-abp-remove()'
  ].join('\n'));
  assert.strictEqual(e5.getProcedural('example.com').length, 1, 'safe ABP procedural mapped');
  assert.strictEqual(e5.rejectedCosmetic.length, 2, 'unsupported ABP action/procedural rejected');
}

async function testPhase1BBadfilter() {
  const e = new FilterEngine();
  e.load([
    '||ads.example^$script',
    '||ads.example^$script,badfilter',
    '||keep.example^$script',
    '@@||except.example^$script',
    '@@||except.example^$script,badfilter',
    '||imp.example^$script,important',
    '||imp.example^$script,important,badfilter'
  ].join('\n'));

  assert.strictEqual(e.matchRequest('https://ads.example/a.js', 'script', 'https://site.test/').blocked, false, 'badfilter removes blocker');
  assert.strictEqual(e.matchRequest('https://keep.example/a.js', 'script', 'https://site.test/').blocked, true, 'unrelated rule remains');
  assert.strictEqual(e.matchRequest('https://except.example/a.js', 'script', 'https://site.test/').blocked, false, 'exception removed by badfilter does not block');
  assert.strictEqual(e.matchRequest('https://imp.example/a.js', 'script', 'https://site.test/').blocked, false, 'important rule removed by badfilter');
  assert.ok(e.getCapabilities() & FilterEngine.CAP.BADFILTER, 'badfilter capability set');
  assert.ok(e.getDiagnostics().some(d => d.type === 'neutralized' && d.reason.includes('badfilter')), 'neutralized diagnostic');
  assert.strictEqual(e.counts.network, 1, 'only remaining network rule counted');

  // badfilter does not match different modifiers
  const e2 = new FilterEngine();
  e2.load([
    '||x.example^$script,third-party',
    '||x.example^$script,badfilter'
  ].join('\n'));
  assert.strictEqual(e2.matchRequest('https://x.example/a.js', 'script', 'https://other.test/').blocked, true, 'badfilter requires same modifiers');
  assert.ok(e2.getDiagnostics().some(d => d.type === 'orphan'), 'orphan badfilter diagnostic');

  const blob = e.toCompiled();
  const e3 = new FilterEngine();
  assert.strictEqual(e3.loadCompiled(blob), true, 'compiled load after badfilter');
  assert.strictEqual(e3.matchRequest('https://ads.example/a.js', 'script', 'https://site.test/').blocked, false, 'compiled badfilter result');
}

async function testPhase1CRemoveModifiers() {
  const e = new FilterEngine();
  e.load([
    '||track.example^$removeparam=utm_source',
    '||track.example^$removeparam=/^utm_/',
    '@@||track.example^$removeparam=utm_source',
    '||api.example^$removeheader=request:cookie',
    '||bad.example^$removeheader=bad header',
    '||bad2.example^$removeparam=/(/'
  ].join('\n'));

  assert.ok(e.getCapabilities() & FilterEngine.CAP.REMOVEPARAM, 'removeparam capability');
  assert.ok(e.getCapabilities() & FilterEngine.CAP.REMOVEHEADER, 'removeheader capability');
  // Match API excludes remove rules from blocking path.
  assert.strictEqual(e.matchRequest('https://track.example/pixel?utm_source=x', 'image', 'https://site.test/').blocked, false, 'removeparam does not block');
  const rpExcept = e.matchRemoveparam('https://track.example/pixel?utm_source=x&utm_ok=1', 'image', 'https://site.test/');
  assert.strictEqual(rpExcept.exception, true, 'removeparam exception wins');
  const eNoEx = new FilterEngine();
  eNoEx.load('||track.example^$removeparam=utm_source\n||track.example^$removeparam=/^utm_/'.replace('\\n','\n'));
  const rp = eNoEx.matchRemoveparam('https://track.example/pixel?utm_source=x&utm_ok=1', 'image', 'https://site.test/');
  assert.strictEqual(rp.exception, false, 'removeparam not excepted');
  assert.ok(rp.params.length >= 1, 'removeparam rules returned');
  const rh = e.matchRemoveheader('https://api.example/data', 'xmlhttprequest', 'https://site.test/');
  assert.ok(rh.headers.includes('request:cookie'), 'removeheader rule returned');
  assert.ok(e.getDiagnostics().some(d => /invalid removeheader/.test(d.reason)), 'invalid removeheader diagnostic');
  assert.ok(e.getDiagnostics().some(d => /invalid removeparam/.test(d.reason)), 'invalid removeparam diagnostic');

  const blob = e.toCompiled();
  const e2 = new FilterEngine();
  assert.strictEqual(e2.loadCompiled(blob), true, 'compiled remove modifiers load');
  assert.ok(e2.getCapabilities() & FilterEngine.CAP.REMOVEPARAM, 'compiled removeparam capability');
  assert.ok(e2.getCapabilities() & FilterEngine.CAP.REMOVEHEADER, 'compiled removeheader capability');
}

async function testPerSiteBadgeCounters() {
  function memoryStorage(initial) {
    let data = Object.assign({}, initial);
    return {
      async get(key) { return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch); }
    };
  }

  const fakeCompiled = text => {
    const compileEngine = new FilterEngine(
      null,
      alias => ctx.CspResources ? ctx.CspResources.resolve(alias) : '',
      null,
      () => false
    );
    compileEngine.load(text);
    return compileEngine.toCompiled();
  };
  class ImmediateWorker {
    constructor() { this.terminated = false; }
    postMessage(msg) {
      if (msg.type === 'ping') {
        this.onmessage({ data: { id: msg.id, ok: true, type: 'pong' } });
        return;
      }
      if (msg.type === 'compile') {
        setImmediate(() => {
          if (this.terminated) return;
          this.onmessage({
            data: {
              id: msg.id, ok: true, type: 'compiled',
              compiled: fakeCompiled(msg.text), counts: {}
            }
          });
        });
      }
    }
    terminate() { this.terminated = true; }
  }

  const apiHooks = {};
  const badgeTexts = [];
  const cosmeticMessages = [];
  let bgMessageHandler;
  let onActivated;
  let onUpdated;
  const ctx = vm.createContext({
    console, URL, setTimeout, clearTimeout, setImmediate, Promise,
    Map, Set, Array, Object, String, RegExp, JSON, Math, Boolean, Number, Error,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    fetch: async url => {
      const u = String(url);
      if (u.includes('default.compiled.json')) return { ok: true, json: async () => fakeCompiled('') };
      if (u.includes('default.txt')) return { ok: true, text: async () => '' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.CSS = { supports: () => true };
  ctx.location = { hostname: 'page.example' };
  ctx.Worker = ImmediateWorker;
  ctx.indexedDB = undefined;
  ctx.browser = {
    runtime: {
      getURL: p => 'moz-extension://test/' + p,
      onMessage: { addListener: handler => { bgMessageHandler = handler; } }
    },
    storage: {
      local: memoryStorage({
        'wildfire.state.v1': {
          enabled: true,
          blocked: 0,
          blockedBySite: { 'bad.test': 'x', '': 5 },
          customFilters: '',
          disabledSites: []
        }
      })
    },
    browserAction: {
      setBadgeBackgroundColor: () => {},
      setBadgeText: options => badgeTexts.push(Object.assign({}, options))
    },
    webRequest: {
      onBeforeRequest: { addListener: (fn, filter) => { if (filter && filter.types && filter.types.indexOf('csp_report') !== -1) apiHooks.onCspReportRequest = fn; else apiHooks.onBeforeRequest = fn; } },
      onBeforeSendHeaders: { addListener: fn => { apiHooks.onBeforeSendHeaders = fn; } },
      onHeadersReceived: {
        addListener: fn => { apiHooks.onHeadersReceived = fn; },
        removeListener: () => { apiHooks.onHeadersReceived = undefined; }
      },
      onCompleted: { addListener: fn => { apiHooks.onCompleted = fn; } },
      onErrorOccurred: { addListener: fn => { apiHooks.onErrorOccurred = fn; } },
      onBeforeRedirect: { addListener: () => {} },
      filterResponseData: () => ({})
    },
    webNavigation: {
      onCreatedNavigationTarget: { addListener: () => {} },
      onCommitted: { addListener: () => {} },
      onReferenceFragmentUpdated: { addListener: () => {} },
      onHistoryStateUpdated: { addListener: () => {} }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://www.example.com/' }],
      get: async id => ({
        id,
        url: id === 1 ? 'https://www.example.com/' : 'https://news.other.test/'
      }),
      onUpdated: { addListener: fn => { onUpdated = fn; } },
      onActivated: { addListener: fn => { onActivated = fn; } },
      onRemoved: { addListener: () => {} },
      sendMessage: async (tabId, message, options) => {
        cosmeticMessages.push({ tabId, message, options });
      },
      remove: async () => {}
    },
    alarms: {
      onAlarm: { addListener: () => {} },
      clear: async () => {},
      get: async () => null,
      create: async () => {}
    },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  };
  loadFiles(ctx, [
    'lib/state/store.js', ...ENGINE_FILES, 'lib/state/page-store.js',
    'lib/resources/redirect-resources.js', 'lib/state/remote-lists.js',
    'lib/state/suggested-lists.js', 'lib/resources/csp-resources.js',
    ...SCRIPTLET_FILES, 'lib/resources/rewrite-resources.js',
    'lib/compile/compile-cache.js', 'lib/compile/compiler.js', ...WAPI_FILES, ...BACKGROUND_FILES
  ]);
  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  wildfire\.start\(\);\n\}\)\(\);\s*$/, '  globalThis.__wildfireTest = wildfire.debug(); wildfire.start(); })();');
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });
  await new Promise(resolve => setTimeout(resolve, 30));
  const api = ctx.__wildfireTest;
  const siteCounts = () => JSON.parse(JSON.stringify(api.getState().blockedBySite));

  assert.strictEqual(Object.keys(api.getState().blockedBySite).length, 0,
    'invalid persisted per-site counters are discarded');
  api.setState({
    enabled: true,
    customFilters: '||ads.test^$script',
    disabledSites: []
  });
  await api.loadFilters(true);
  await new Promise(resolve => setTimeout(resolve, 30));

  const blockOn = (tabId, documentUrl) => apiHooks.onBeforeRequest({
    url: 'https://ads.test/banner.js',
    type: 'script',
    tabId,
    frameId: 0,
    documentUrl,
    requestId: 'per-site-' + tabId
  });
  const lastBadge = tabId => badgeTexts.filter(entry => entry.tabId === tabId).pop();

  assert.ok(blockOn(1, 'https://www.example.com/').cancel, 'a site block is counted');
  assert.ok(blockOn(1, 'https://shop.example.com/').cancel, 'subdomains share a site counter');
  assert.ok(blockOn(2, 'https://news.other.test/').cancel, 'another site has its own counter');
  assert.strictEqual(api.getState().blocked, 3, 'the lifetime total still increments');
  assert.strictEqual(JSON.stringify(siteCounts()),
    JSON.stringify({ 'example.com': 2, 'other.test': 1 }),
    'blocks are attributed to registrable domains');
  assert.strictEqual(lastBadge(1).text, '2', 'tab badge shows the active site count');
  assert.strictEqual(lastBadge(2).text, '1', 'a different tab badge shows its own site count');

  onActivated({ tabId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(lastBadge(1).text, '2', 'activating a tab refreshes its site badge');

  const iframeBlock = apiHooks.onBeforeRequest({
    url: 'https://ads.test/iframe.js',
    type: 'script',
    tabId: 2,
    frameId: 1,
    documentUrl: 'https://embed.third.test/',
    requestId: 'per-site-iframe'
  });
  assert.ok(iframeBlock.cancel, 'an embedded frame request is counted');
  assert.strictEqual(api.getState().blocked, 4, 'the iframe block joins the lifetime total');
  assert.strictEqual(JSON.stringify(siteCounts()),
    JSON.stringify({ 'example.com': 2, 'other.test': 2 }),
    'iframe blocks are attributed to the tab site, not the frame document');
  assert.strictEqual(lastBadge(2).text, '2', 'the tab badge includes embedded frame blocks');

  cosmeticMessages.length = 0;
  onUpdated(2, { status: 'complete', url: 'https://news.other.test/' }, {
    url: 'https://news.other.test/'
  });
  await new Promise(resolve => setImmediate(resolve));
  const tabCosmetic = cosmeticMessages.filter(entry => entry.tabId === 2);
  assert.strictEqual(tabCosmetic.length, 2,
    'a completed page refreshes cosmetics once per known frame');
  assert.ok(tabCosmetic.some(entry => entry.options && entry.options.frameId === 1),
    'iframe cosmetic messages are targeted at the iframe');
  assert.ok(tabCosmetic.every(entry => entry.message.type === 'wildfire:apply'),
    'all cosmetic messages use the apply payload');

  onUpdated(1, { url: 'https://www.other.test/' }, { url: 'https://www.other.test/' });
  assert.strictEqual(lastBadge(1).text, '2', 'navigating a tab refreshes the badge for the new site');

  const exampleState = await bgMessageHandler({
    type: 'wildfire:state', url: 'https://www.example.com/'
  }, {});
  assert.strictEqual(exampleState.state.blocked, 4, 'state keeps the lifetime total');
  assert.strictEqual(exampleState.site.site, 'example.com', 'state reports the site key');
  assert.strictEqual(exampleState.site.blocked, 2, 'state reports that site counter');

  await bgMessageHandler({ type: 'wildfire:toggle' }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(lastBadge(2).text, '', 'global pause clears known tab badges');
  await bgMessageHandler({ type: 'wildfire:toggle' }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(lastBadge(2).text, '2', 'global resume restores known tab badges');

  const reset = await bgMessageHandler({ type: 'wildfire:reset-stats' }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(reset.state.blocked, 0, 'reset clears the lifetime total');
  assert.strictEqual(Object.keys(reset.state.blockedBySite).length, 0,
    'reset clears every site counter');
  assert.strictEqual(lastBadge(1).text, '0', 'reset returns the active site badge to zero');

  const allowRule = await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'script',
    action: 'allow'
  });
  assert.strictEqual(allowRule.site.rules.script, 'allow',
    'a dynamic allow rule is returned with the active site');
  assert.strictEqual(Object.keys(allowRule.site.rules).length, 1,
    'only the changed resource type is returned');
  assert.strictEqual(allowRule.state.siteRules['example.com'].script, 'allow',
    'dynamic rules are stored by registrable domain');
  assert.strictEqual(blockOn(1, 'https://www.example.com/'), undefined,
    'a dynamic allow rule skips static blocking');
  assert.strictEqual(api.getState().blocked, 0, 'dynamic allow does not count a block');

  const blockRule = await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'script',
    action: 'block'
  });
  assert.strictEqual(blockRule.site.rules.script, 'block',
    'a dynamic allow rule can be flipped to block');
  assert.ok(blockOn(1, 'https://www.example.com/').cancel,
    'a dynamic block rule cancels before static matching');
  const dynamicFrame = apiHooks.onBeforeRequest({
    url: 'https://ads.test/iframe.js',
    type: 'script',
    tabId: 1,
    frameId: 1,
    documentUrl: 'https://embed.third.test/',
    requestId: 'dynamic-iframe'
  });
  assert.ok(dynamicFrame.cancel, 'dynamic rules use the tab site for embedded frames');
  assert.strictEqual(api.getState().blocked, 2, 'dynamic blocks count once each');

  const clearedType = await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'script',
    action: 'clear'
  });
  assert.strictEqual(Object.keys(clearedType.site.rules).length, 0,
    'one dynamic type can be cleared');
  assert.ok(blockOn(1, 'https://www.example.com/').cancel,
    'static filtering resumes after a dynamic rule is cleared');

  await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'script',
    action: 'block'
  });
  await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'image',
    action: 'allow'
  });
  const clearedSite = await bgMessageHandler({
    type: 'wildfire:clear-site-rules',
    site: 'https://www.example.com/'
  });
  assert.strictEqual(Object.keys(clearedSite.site.rules).length, 0,
    'all dynamic rules can be cleared for a site');
  assert.strictEqual(clearedSite.state.siteRules['example.com'], undefined,
    'an empty site rule map is removed from storage');

  const invalidRule = await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'document',
    action: 'block'
  });
  assert.strictEqual(Object.keys(invalidRule.state.siteRules).length, 0,
    'dynamic rules never apply to navigations');
  const invalidAction = await bgMessageHandler({
    type: 'wildfire:set-site-rule',
    site: 'https://www.example.com/',
    resourceType: 'script',
    action: 'reject'
  });
  assert.strictEqual(Object.keys(invalidAction.state.siteRules).length, 0,
    'unknown dynamic actions are ignored');

  await bgMessageHandler({ type: 'wildfire:reset-stats' });
  const initialDiagnostics = await bgMessageHandler({ type: 'wildfire:diagnostics' }, {});
  assert.strictEqual(initialDiagnostics.diagnostics.enabled, false,
    'diagnostics are opt-in and off by default');
  assert.strictEqual(typeof apiHooks.onHeadersReceived, 'function',
    'the header listener is registered for CSP report stripping');

  await bgMessageHandler({ type: 'wildfire:diagnostics', value: true }, {});
  blockOn(1, 'https://www.example.com/');
  apiHooks.onErrorOccurred({
    requestId: 'etp-block',
    error: 'NS_ERROR_TRACKING_URI',
    urlClassification: { firstParty: ['tracking_ad'], thirdParty: [] }
  });
  apiHooks.onCompleted({
    requestId: 'etp-flag',
    urlClassification: { firstParty: [], thirdParty: ['fingerprinting_content'] }
  });

  const observed = await bgMessageHandler({ type: 'wildfire:diagnostics' }, {});
  assert.strictEqual(observed.diagnostics.state, undefined,
    'diagnostics do not carry the full state snapshot');
  assert.strictEqual(observed.diagnostics.phases.request.calls, 1,
    'request matches are counted only while diagnostics are enabled');
  assert.ok(observed.diagnostics.phases.request.candidates > 0,
    'request diagnostics include candidate counts');
  assert.ok(observed.diagnostics.samples.length > 0,
    'request diagnostics keep bounded in-memory samples');
  assert.strictEqual(observed.diagnostics.etp.blocked, 1,
    'ETP block errors are observed without becoming WildFire blocks');
  assert.strictEqual(observed.diagnostics.etp.byError.NS_ERROR_TRACKING_URI, 1,
    'ETP block errors are grouped by internal reason');
  assert.strictEqual(observed.diagnostics.etp.classified, 2,
    'ETP classifications are observed from completed and failed requests');
  assert.strictEqual(observed.diagnostics.etp.byFlag.fingerprinting_content, 1,
    'ETP classifications are grouped by flag');
  assert.strictEqual(api.getState().blocked, 1,
    'ETP observation never changes the WildFire counter');

  apiHooks.onHeadersReceived({
    url:'https://www.example.com/', type:'main_frame', tabId:1, frameId:0,
    documentUrl:'https://www.example.com/',
    responseHeaders:[{name:'Content-Security-Policy',value:"default-src 'self'; report-uri https://reports.example/csp"}]
  });
  apiHooks.onCspReportRequest({
    url:'https://reports.example/csp', type:'csp_report', tabId:1, frameId:0,
    documentUrl:'https://www.example.com/'
  });
  const cspDiagnostics = await bgMessageHandler({ type: 'wildfire:diagnostics' }, {});
  assert.strictEqual(cspDiagnostics.diagnostics.cspReports.headersStripped, 1,
    'CSP report header stripping is counted in local diagnostics');
  assert.strictEqual(cspDiagnostics.diagnostics.cspReports.requestsCancelled, 1,
    'CSP report request cancels are counted in local diagnostics');

  api.setState({
    customFilters: '||ads.test^$script\n||csp.test^$csp=no-script'
  });
  await api.loadFilters(true);
  assert.strictEqual(typeof apiHooks.onHeadersReceived, 'function',
    'the header listener is registered when CSP rules are loaded');
  api.setState({ customFilters: '||ads.test^$script' });
  await api.loadFilters(true);
  assert.strictEqual(typeof apiHooks.onHeadersReceived, 'function',
    'CSP report stripping keeps the header listener registered without filter capabilities');
  await bgMessageHandler({ type: 'wildfire:set-csp-report-blocking', value: false }, {});
  assert.strictEqual(apiHooks.onHeadersReceived, undefined,
    'the header listener is removed when CSP report blocking is off and no capabilities remain');
}

async function testPopupPerSiteDisplay() {
  function element() {
    let text = '';
    return {
      title: '',
      disabled: false,
      listeners: {},
      children: [],
      classList: { toggle() {} },
      set textContent(value) { text = String(value); this.children.length = 0; },
      get textContent() { return text; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { children.forEach(child => this.children.push(child)); }
    };
  }
  const elements = {};
  [
    'status', 'count', 'count-label', 'network-count', 'cosmetic-count',
    'exception-count', 'toggle', 'site', 'reload', 'options',
    'inspector', 'inspect-toggle', 'site-rules', 'site-rules-site'
  ].forEach(id => { elements[id] = element(); });

  const sent = [];
  const sentTypes = [];
  const openedWindows = [];
  const portListeners = [];
  const nativePort = {
    name: 'wildfire:state',
    postMessage() {},
    onMessage: {
      addListener(listener) { portListeners.push(listener); },
      removeListener(listener) {
        const index = portListeners.indexOf(listener);
        if (index !== -1) portListeners.splice(index, 1);
      }
    },
    onDisconnect: { addListener() {} },
    disconnect() {}
  };
  const stateResult = {
    state: { enabled: true, blocked: 12 },
    counts: { network: 10, cosmetic: 2, exceptions: 1 },
    site: {
      url: 'https://www.example.com/', host: 'www.example.com',
      site: 'example.com', blocked: 4, disabled: false,
      rules: { script: 'block' }
    }
  };
  const ctx = vm.createContext({
    console, setTimeout,
    document: { getElementById: id => elements[id], createElement: () => element() },
    browser: {
      tabs: { query: async () => [{ url: 'https://www.example.com/' }] },
      windows: {
        create: async info => {
          openedWindows.push(info);
          return { id: 9 };
        }
      },
      runtime: {
        connect: () => nativePort,
        getURL: path => 'moz-extension://wildfire/' + path,
        sendMessage: async message => {
          sent.push(message);
          sentTypes.push(message.type);
          if (message.type === 'wildfire:inspect') {
            return {
              ok: true,
              inspect: { enabled: Boolean(message.value), limit: 256, entries: [] }
            };
          }
          return message.type === 'wildfire:toggle'
            ? Object.assign({}, stateResult, { state: { enabled: false, blocked: 12 } })
            : stateResult;
        },
        openOptionsPage: () => {}
      }
    }
  });
  loadClient(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui/popup/popup.js'), 'utf8'), ctx, {
    filename: 'popup.js'
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.strictEqual(elements.count.textContent, '4',
    'popup shows the active site counter, not the lifetime total');
  assert.strictEqual(elements.count.title, '12 requests blocked in total',
    'popup exposes the lifetime total as a tooltip');
  assert.strictEqual(elements['count-label'].textContent,
    'requests blocked on www.example.com', 'popup labels the site being counted');
  assert.strictEqual(elements['inspect-toggle'].textContent, 'Recording: off',
    'popup reflects the initial inspector state');

  portListeners[0]({
    type: 'wildfire:state',
    state: { enabled: true, blocked: 99 },
    counts: stateResult.counts,
    site: {
      url: 'https://www.example.com/',
      host: 'www.example.com',
      site: 'example.com',
      blocked: 9,
      disabled: false
    }
  });
  assert.strictEqual(elements.count.title, '99 requests blocked in total',
    'background state pushes refresh the popup lifetime counter');
  assert.strictEqual(elements.count.textContent, '9',
    'background state pushes refresh the active site counter');

  elements.toggle.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(elements.count.textContent, '4',
    'later popup actions preserve the active site counter');
  assert.ok(sentTypes.includes('wildfire:toggle'), 'popup toggle uses the message API');

  elements.inspector.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(openedWindows.length, 1, 'popup opens the inspector window');
  assert.strictEqual(openedWindows[0].url,
    'moz-extension://wildfire/ui/inspector/inspector.html',
    'inspector window uses the packaged extension page');
  assert.strictEqual(openedWindows[0].type, 'popup');

  elements['inspect-toggle'].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(elements['inspect-toggle'].textContent, 'Recording: on',
    'popup recording button toggles the local inspector');
  assert.ok(sentTypes.includes('wildfire:inspect'), 'recording toggle uses the message API');

  assert.strictEqual(elements['site-rules-site'].textContent, 'example.com',
    'popup labels the site whose rules are shown');
  assert.strictEqual(elements['site-rules'].children.length, 11,
    'popup renders one rule control per dynamic resource type');
  assert.match(elements['site-rules'].children[0].textContent, /^Script ✕/,
    'popup shows the active dynamic rule state');
  elements['site-rules'].children[1].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  const ruleMessage = sent.find(message => message.type === 'wildfire:set-site-rule');
  assert.strictEqual(ruleMessage.type, 'wildfire:set-site-rule',
    'rule controls send the dynamic rule action');
  assert.strictEqual(ruleMessage.site, 'example.com',
    'rule controls send the registrable site key');
  assert.strictEqual(ruleMessage.resourceType, 'image',
    'rule controls send the resource type outside the message type');
  assert.strictEqual(ruleMessage.action, 'block',
    'rule controls cycle from default to block');
}

async function testRemoteLists() {
  assert.strictEqual(RemoteLists.normalizeUrl('javascript:alert(1)'), '',
    'javascript URLs are rejected');
  assert.strictEqual(RemoteLists.normalizeUrl('file:///etc/passwd'), '',
    'file URLs are rejected');
  assert.strictEqual(RemoteLists.normalizeUrl('https://example.com/list.txt?a=1'),
    'https://example.com/list.txt?a=1', 'http(s) URLs are normalized');
  assert.strictEqual(RemoteLists.hashText('abc'), RemoteLists.hashText('abc'),
    'list hashing is deterministic');
  assert.notStrictEqual(RemoteLists.hashText('abc'), RemoteLists.hashText('abd'),
    'different text has a different hash');

  function memoryStorage(initial) {
    let data = Object.assign({}, initial);
    return {
      async get(key) { return { [key]: data[key] }; },
      async set(patch) { data = Object.assign({}, data, patch); },
      get data() { return data; }
    };
  }

  function remoteResponse(text, headers, status) {
    const values = headers || {};
    const code = status === undefined ? 200 : status;
    return {
      ok: code >= 200 && code < 300,
      status: code,
      headers: { get: name => values[name.toLowerCase()] || '' },
      text: async () => text
    };
  }

  const catalog = WildFireSuggestedLists.all();
  assert.ok(catalog.length >= 2, 'the catalog offers suggested lists');
  assert.ok(catalog.every(entry => entry.name && entry.description && /^https:\/\//.test(entry.url)),
    'catalog entries are complete https shortcuts');
  const copy = WildFireSuggestedLists.all();
  copy[0].url = 'https://changed.example/';
  assert.notStrictEqual(WildFireSuggestedLists.all()[0].url, 'https://changed.example/',
    'catalog data cannot be mutated by callers');
  const catalogRemote = RemoteLists.create({
    storage: memoryStorage({ [RemoteLists.KEY]: { lists: [] } }),
    fetchImpl: async () => { throw new Error('suggested-list registration must not fetch'); },
    timeoutMs: 0
  });
  const registered = await catalogRemote.add(catalog[0].url);
  assert.strictEqual(registered.ok, true, 'a suggested URL can be registered');
  assert.strictEqual(registered.list.enabled, false, 'suggested lists are registered disabled');
  assert.strictEqual(registered.list.text, '', 'suggested lists are registered unfetched');

  let clock = 1000;
  let fetchMode = 'ok';
  const fetchCalls = [];
  const remoteStorage = memoryStorage({
    [RemoteLists.KEY]: {
      lists: [
        { url: 'javascript:bad' },
        { url: 'https://list.example/rules.txt', enabled: true },
        { url: 'https://list.example/rules.txt', enabled: false }
      ]
    }
  });
  const remote = RemoteLists.create({
    storage: remoteStorage,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchMode === '304') {
        return { status: 304, ok: false, headers: { get: () => '' }, text: async () => '' };
      }
      if (fetchMode === '500') return remoteResponse('', {}, 500);
      return remoteResponse('||tracker.example^', { etag: '"v1"' });
    },
    now: () => clock,
    timeoutMs: 0
  });

  const initial = await remote.get();
  assert.strictEqual(initial.lists.length, 1,
    'invalid and duplicate stored URLs are discarded on load');
  assert.strictEqual(initial.lists[0].enabled, false,
    'the last duplicate entry wins deterministically');

  const added = await remote.add('https://fresh.example/list.txt');
  assert.strictEqual(added.ok, true, 'a valid URL can be registered');
  assert.strictEqual(added.list.enabled, false, 'registering never enables a list');
  assert.strictEqual(added.list.text, '', 'registering never fetches a list');
  assert.strictEqual(fetchCalls.length, 0, 'add performs no network request');

  const earlyEnable = await remote.setEnabled('https://fresh.example/list.txt', true);
  assert.strictEqual(earlyEnable.ok, false, 'an unfetched list cannot be enabled');
  assert.ok(/Fetch/.test(earlyEnable.error), 'the error explains the consent step');

  const fetched = await remote.update('https://fresh.example/list.txt');
  assert.strictEqual(fetched.ok, true, 'an explicit update fetches the list');
  assert.strictEqual(fetched.list.etag, '"v1"', 'the ETag is stored');
  assert.strictEqual(fetched.list.hash, RemoteLists.hashText('||tracker.example^'),
    'the exact fetched text is hashed');
  assert.strictEqual(fetchCalls.length, 1, 'one update makes one request');
  assert.strictEqual(fetchCalls[0].options.cache, 'no-store', 'fetches bypass the HTTP cache');
  assert.strictEqual(fetchCalls[0].options.headers['If-None-Match'], undefined,
    'the first fetch sends no validator');

  fetchMode = '304';
  clock = 2000;
  const revalidated = await remote.update('https://fresh.example/list.txt');
  assert.strictEqual(revalidated.ok, true, 'a 304 reuses the stored text');
  assert.strictEqual(revalidated.list.text, '||tracker.example^', '304 keeps previous rules');
  assert.strictEqual(revalidated.list.updatedAt, 1000, '304 keeps previous content time');
  assert.strictEqual(revalidated.list.checkedAt, 2000, '304 records check time');
  assert.strictEqual(revalidated.list.lastError, '', '304 clears previous error');
  assert.strictEqual(fetchCalls[1].options.headers['If-None-Match'], '"v1"',
    'revalidation sends the stored ETag');

  const enabled = await remote.setEnabled('https://fresh.example/list.txt', true);
  assert.strictEqual(enabled.ok, true, 'a fetched list can be enabled');
  assert.strictEqual(await remote.enabledText(),
    '! wildfire remote: https://fresh.example/list.txt\n||tracker.example^',
    'only enabled lists contribute filter text');

  const earlyAuto = await remote.setAutoUpdate('https://list.example/rules.txt', true);
  assert.strictEqual(earlyAuto.ok, false, 'auto-update needs an enabled fetched list');
  const auto = await remote.setAutoUpdate('https://fresh.example/list.txt', true);
  assert.strictEqual(auto.ok, true, 'auto-update can be opted into');
  assert.strictEqual(auto.list.autoUpdate, true);

  fetchMode = '500';
  clock = 3000;
  const failed = await remote.update('https://fresh.example/list.txt');
  assert.strictEqual(failed.ok, false, 'an HTTP error is reported');
  assert.strictEqual(failed.list.text, '||tracker.example^', 'a failed fetch keeps old rules');
  assert.strictEqual(failed.list.lastError, 'HTTP 500', 'a failed fetch records error');
  assert.strictEqual(failed.list.checkedAt, 3000, 'a failed fetch records check time');

  fetchMode = 'ok';
  clock = 4000;
  const due = await remote.updateDue();
  assert.strictEqual(due.ok, true, 'due updates succeed');
  assert.strictEqual(due.changed, false, 'unchanged auto-update does not mark rules changed');
  assert.strictEqual(due.results.length, 1, 'only auto-enabled fetched lists are due');

  const sizeStorage = memoryStorage({
    [RemoteLists.KEY]: { lists: [{ url: 'https://size.example/list' }] }
  });
  const sizeRemote = RemoteLists.create({
    storage: sizeStorage,
    fetchImpl: async () => remoteResponse('abcdefghij'),
    now: () => clock,
    timeoutMs: 0,
    maxTextLength: 8
  });
  const tooLarge = await sizeRemote.update('https://size.example/list');
  assert.strictEqual(tooLarge.ok, false, 'an oversized list is rejected');
  assert.ok(/exceeds/.test(tooLarge.error), 'the size limit is explained');

  const removed = await remote.remove('https://fresh.example/list.txt');
  assert.strictEqual(removed.ok, true, 'a list can be removed');
  assert.strictEqual(await remote.enabledText(), '', 'removed lists contribute no filters');
}

async function testWapiBackbone() {
  const hub = () => {
    const listeners = [];
    return {
      listeners,
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  };
  const beforeRequest = hub();
  const onMessage = hub();
  const browserApi = {
    runtime: { getURL: path => 'moz-extension://test/' + path, onMessage },
    webRequest: { onBeforeRequest: beforeRequest, filterResponseData: () => ({}) },
    tabs: { sendMessage: async () => { throw new Error('no content script'); } },
    alarms: {
      create: async () => {},
      get: async () => null,
      clear: async () => {},
      onAlarm: hub()
    },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    storage: {
      local: {
        get: async keys => ({ [keys]: { blocked: 5 } }),
        set: async () => {}
      }
    }
  };

  assert.strictEqual(wapi, WildFireWapi, 'wapi is the canonical backbone global');
  const instance = WildFireWapi.create({ browserApi });
  assert.strictEqual(instance.browser, browserApi, 'wapi exposes the native Firefox API');
  assert.strictEqual(instance.prefix, 'wildfire:', 'wapi uses the WildFire message prefix');
  assert.strictEqual(instance.storage.supported, true, 'wapi exposes local storage');
  const wrapped = await instance.storage.local.get('wildfire.state.v1');
  assert.strictEqual(wrapped['wildfire.state.v1'].blocked, 5);
  await instance.storage.local.set({ ok: true });
  const noStorage = WildFireWapi.create({ browserApi: {} });
  assert.strictEqual(noStorage.storage.supported, false);
  await assert.rejects(() => noStorage.storage.local.get('key'), /storage\.local\.get/);
  const noop = () => {};
  assert.strictEqual(instance.events.add('test.event', hub(), noop), true);
  assert.strictEqual(instance.events.add('test.event', hub(), noop), false,
    'named listeners are idempotent');
  assert.strictEqual(instance.events.count(), 1, 'only one named listener is registered');
  assert.strictEqual(instance.webRequest.onBeforeRequest('request.main', noop,
    { urls: ['<all_urls>'] }, ['blocking'], true), true);
  assert.strictEqual(instance.webRequest.onBeforeRequest('request.main', noop,
    { urls: ['<all_urls>'] }, ['blocking'], true), false,
    'webRequest registrations share the idempotent event registry');
  assert.strictEqual(beforeRequest.listeners.length, 1);
  assert.strictEqual(instance.messages(noop), true);
  assert.strictEqual(instance.messages(noop), false, 'one message router is installed');
  assert.strictEqual(onMessage.listeners.length, 1);
  const customHub = hub();
  const custom = WildFireWapi.create({
    browserApi: Object.assign({}, browserApi, {
      runtime: { getURL: path => path, onMessage: customHub }
    }),
    prefix: 'wf:'
  });
  const routed = [];
  custom.messages(message => { routed.push(message); return true; });
  const customListener = customHub.listeners[0];
  assert.strictEqual(customListener({ type: 'wildfire:state' }, {}), undefined,
    'a custom prefix ignores unrelated messages');
  assert.strictEqual(customListener({ type: 'wf:state' }, {}), true,
    'a custom prefix routes matching messages to the one handler');
  assert.strictEqual(routed.length, 1);
  assert.strictEqual(instance.events.remove('test.event'), true);
  assert.strictEqual(instance.events.count(), 2);
  assert.throws(() => WildFireWapi.create({ browserApi: {} }).messages(noop),
    /runtime\.onMessage/, 'required APIs fail loudly');
  assert.ok(instance.getURL('filters/default.txt').endsWith('filters/default.txt'));
  await instance.tabs.send(1, { type: 'wildfire:apply' });
  await instance.settle();
  await instance.ready;
}

async function testWapiScripting() {
  assert.strictEqual(wapiScripting, WildFireWapiScripting,
    'wapi-scripting is exposed as a canonical backbone module');
  const makeDetails = () => ({
    matches: ['<all_urls>'],
    js: [{ file: 'lib/resources/scriptlets/api.js' }],
    runAt: 'document_start',
    allFrames: true
  });
  const registrations = [];
  const unregistered = [];
  const errors = [];
  let failRegister = false;
  let failUnregister = false;
  let nextId = 0;
  const browserApi = {
    contentScripts: {
      register: async options => {
        if (failRegister) throw new Error('register failed');
        const registration = { id: ++nextId, options };
        registration.unregister = async () => {
          if (failUnregister) throw new Error('unregister failed');
          unregistered.push(registration);
        };
        registrations.push(registration);
        return registration;
      }
    }
  };
  const wapiStub = WildFireWapi.create({ browserApi });
  const scripting = WildFireWapiScripting.create({
    wapi: wapiStub,
    onError: error => errors.push(error)
  });

  assert.strictEqual(scripting.supported, true, 'scripting reports Firefox content script support');
  const first = await scripting.register('scriptlets', makeDetails());
  assert.strictEqual(first.id, 1);
  assert.strictEqual(scripting.get('scriptlets'), first);
  assert.strictEqual(scripting.has('scriptlets'), true);
  assert.strictEqual(scripting.size(), 1);
  assert.strictEqual(registrations[0].options.matches[0], '<all_urls>');

  const sourceDetails = makeDetails();
  await scripting.register('copy', sourceDetails);
  sourceDetails.matches.push('https://changed.test/*');
  assert.strictEqual(scripting.get('copy').options.matches.length, 1,
    'registration details are copied before crossing the native boundary');

  failRegister = true;
  assert.strictEqual(await scripting.replace('scriptlets', makeDetails()), false);
  assert.strictEqual(scripting.get('scriptlets'), first,
    'a failed replace keeps the previous registration');
  assert.strictEqual(unregistered.length, 0, 'a failed replace does not unregister anything');
  assert.strictEqual(errors.length, 1);
  failRegister = false;

  const second = await scripting.register('scriptlets', makeDetails());
  assert.strictEqual(second.id, 3);
  assert.strictEqual(scripting.get('scriptlets'), second);
  assert.strictEqual(unregistered[0], first, 'a successful replace closes the previous registration');

  failUnregister = true;
  const third = await scripting.register('scriptlets', makeDetails());
  assert.strictEqual(scripting.get('scriptlets'), third,
    'an unregister failure does not discard the replacement');
  assert.strictEqual(errors.length, 2);
  failUnregister = false;

  assert.strictEqual(await scripting.clear('scriptlets'), true);
  assert.strictEqual(scripting.get('scriptlets'), null);
  assert.strictEqual(scripting.has('scriptlets'), false);
  assert.strictEqual(await scripting.clear('missing'), false);

  await scripting.register('a', makeDetails());
  await scripting.register('b', makeDetails());
  assert.strictEqual(scripting.keys().join(','), 'copy,a,b');
  assert.strictEqual(await scripting.clearAll(), true);
  assert.strictEqual(scripting.size(), 0);

  const validationErrors = [];
  const validator = WildFireWapiScripting.create({
    wapi: wapiStub,
    onError: error => validationErrors.push(error)
  });
  assert.strictEqual(await validator.register('x', {}), null);
  assert.ok(/matches are required/.test(String(validationErrors[0])));
  assert.strictEqual(await validator.register('x', { matches: ['<all_urls>'] }), null);
  assert.ok(/js steps are required/.test(String(validationErrors[1])));

  const unsupported = WildFireWapiScripting.create({ browserApi: {} });
  assert.strictEqual(unsupported.supported, false);
  assert.strictEqual(await unsupported.register('x', makeDetails()), null);
  assert.strictEqual(await unsupported.replace('x', makeDetails()), false);
}

async function testPreventFetchResponseConfig() {
  const configuredFetchContext = dataScriptletContext();
  configuredFetchContext.WildFireScriptlets.apply([
    {
      alias: 'prevent-fetch',
      args: ['ads.example', 'emptyObj',
        '{"status":404,"statusText":"Not Found","ok":false,"type":"opaque"}'],
      domains: [], isException: false
    }
  ]);
  const configuredResponse = await configuredFetchContext.fetch('https://ads.example/x.js');
  assert.strictEqual(configuredResponse.status, 404,
    'the curated status is applied to the synthetic response');
  assert.strictEqual(configuredResponse.statusText, 'Not Found',
    'the curated status text is applied to the synthetic response');
  assert.strictEqual(configuredResponse.ok, false,
    'the curated ok flag is applied to the synthetic response');
  assert.strictEqual(configuredResponse.type, 'opaque',
    'the curated response type is applied to the synthetic response');
  assert.strictEqual(configuredFetchContext.fetched, undefined,
    'a configured response never calls the original fetch');

  const adguardFetchContext = dataScriptletContext();
  adguardFetchContext.WildFireScriptlets.apply([
    {
      alias: 'prevent-fetch', syntax: 'adguard',
      args: ['*', '{}', 'opaque'], domains: [], isException: false
    }
  ]);
  const adguardResponse = await adguardFetchContext.fetch('https://ads.example/x.js');
  assert.strictEqual(adguardResponse.type, 'opaque',
    'AdGuard response config reuses the WildFire synthetic response');
}

async function testBackgroundLogger() {
  const ctx = {
    loggerEnabled: false,
    now: () => 1700000000000,
    monotonicMs: () => 1000,
    safeHost: url => {
      try { return new URL(url).hostname.toLowerCase(); } catch (error) { return ''; }
    },
    siteKey: host => host.split('.').slice(-2).join('.')
  };
  Object.assign(ctx, context.WildFireBackgroundCore.createLogger(ctx));

  assert.strictEqual(ctx.logger.enabled, false, 'local logger starts disabled');
  assert.strictEqual(ctx.recordDecision({ url: 'https://ads.test/a.js' }), null,
    'disabled logger drops records');
  assert.strictEqual(ctx.logger.snapshot().entries.length, 0);
  assert.strictEqual(ctx.logger.limit, 256);

  ctx.logger.setEnabled(true);
  assert.strictEqual(ctx.logger.enabled, true);
  const rule = { pattern: '||ads.test^', sourceKind: 'custom', hash: 'abc' };
  const item = ctx.recordDecision({
    phase: 'request', decision: 'blocked', rule, detail: 'blocked', ms: 1.2346,
    reason: 'network rule', source: 'static',
    url: 'https://ads.test/a.js?secret=1', type: 'script', tabId: 7,
    requestId: 'req-1', documentUrl: 'https://page.test/', topHost: 'page.test'
  });
  assert.strictEqual(item.id, 1);
  assert.strictEqual(item.host, 'ads.test');
  assert.strictEqual(item.site, 'ads.test');
  assert.strictEqual(item.decision, 'blocked');
  assert.strictEqual(item.rule.text, '||ads.test^');
  assert.strictEqual(item.rule.source, 'custom');
  assert.strictEqual(item.ms, 1.235, 'durations are rounded for display');
  assert.strictEqual(item.source, 'static', 'decision source is recorded');
  assert.strictEqual(item.reason, 'network rule', 'decision reason is recorded');
  assert.strictEqual(item.topHost, 'page.test', 'top-level host is recorded');
  assert.strictEqual(item.topSite, 'page.test', 'top-level site is recorded');
  assert.strictEqual(item.documentUrl, 'https://page.test/', 'document scope is recorded');
  assert.strictEqual(item.requestId, 'req-1', 'request identity is recorded');

  const snapshot = ctx.logger.snapshot();
  assert.strictEqual(snapshot.entries.length, 1);
  snapshot.entries.length = 0;
  assert.strictEqual(ctx.logger.snapshot().entries.length, 1,
    'snapshots are copies');

  Array.from({ length: 300 }, (unused, index) => ctx.recordDecision({
    url: 'https://host' + index + '.test/',
    decision: 'allowed'
  }));
  const capped = ctx.logger.snapshot().entries;
  assert.strictEqual(capped.length, 256, 'logger keeps a bounded ring buffer');
  assert.strictEqual(capped[0].id, 46, 'oldest entries are dropped first');
  assert.strictEqual(capped[capped.length - 1].id, 301);

  const cleared = ctx.logger.clear();
  assert.strictEqual(cleared.entries.length, 0);
  ctx.logger.setEnabled(false);
  assert.strictEqual(ctx.recordDecision({ url: 'https://ads.test/' }), null);
}

function testInspectorUiHelpers() {
  const uiCtx = vm.createContext({});
  loadFiles(uiCtx, [INSPECTOR_UI_FILE]);
  const log = uiCtx.WildFireInspectorUI;
  const entries = [
    {
      at: 1700000000000, ms: 1.25, decision: 'blocked', phase: 'request',
      type: 'script', host: 'ads.test', site: 'ads.test', topSite: 'page.test',
      url: 'https://ads.test/a.js', detail: '', reason: 'network rule',
      rule: { text: '||ads.test^', source: 'custom' }
    },
    {
      at: 1700000001000, ms: 0, decision: 'allowed', phase: 'request',
      type: 'image', host: 'page.test', site: 'page.test', topSite: 'page.test',
      url: 'https://page.test/logo.png', detail: '', reason: 'no matching rule',
      rule: null
    },
    {
      at: 1700000002000, ms: 0.5, decision: 'blocked', phase: 'csp',
      type: 'document', host: 'page.test', site: 'page.test', topSite: 'page.test',
      url: 'https://page.test/', detail: 'script-src none', reason: 'curated csp',
      rule: { text: '||page.test^$csp=no-script', source: 'wildfire' }
    }
  ];
  const blockedScripts = log.filterEntries(entries, {
    decision: 'blocked', phase: 'request', type: 'script', site: 'ads',
    query: 'network rule', rulesOnly: true
  });
  assert.strictEqual(blockedScripts.length, 1, 'log filters combine every criterion');
  assert.strictEqual(blockedScripts[0].rule.text, '||ads.test^');
  assert.strictEqual(log.filterEntries(entries, { query: 'nomatch' }).length, 0,
    'free-text search narrows the log');
  const counts = log.summarize(entries);
  assert.strictEqual(counts.blocked, 2, 'summaries count decisions');
  assert.strictEqual(counts.allowed, 1);
  assert.strictEqual(log.ruleForEntry(entries[0]), '||ads.test^',
    'copy-as-rule uses the matching rule');
  assert.strictEqual(log.ruleForEntry({ host: 'ads.test', rule: { text: '@@||ads.test^' } }),
    '||ads.test^', 'an exception never copies as an exception');
  assert.strictEqual(log.ruleForEntry({ host: 'ads.test', rule: null }), '||ads.test^',
    'a blocked host becomes a WildFire domain rule');
  assert.strictEqual(log.ruleForEntry({ host: '', rule: null }), '',
    'rows without a host have no copyable rule');
  assert.ok(log.timeLabel(entries[0]).includes('1.25 ms'),
    'time labels keep the decision duration');
}

async function testInspectorPage() {
  function element(tag) {
    let text = '';
    return {
      tag,
      title: '',
      type: '',
      checked: false,
      disabled: false,
      value: '',
      colSpan: 0,
      className: '',
      attributes: {},
      children: [],
      listeners: {},
      set textContent(value) {
        text = String(value);
        this.children.length = 0;
      },
      get textContent() { return text; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { items.forEach(item => this.children.push(item)); }
    };
  }
  const ids = [
    'inspector-enabled', 'inspector-decision-filter', 'inspector-phase-filter',
    'inspector-type-filter', 'inspector-site-filter', 'inspector-query-filter',
    'inspector-rules-only', 'inspector-refresh', 'inspector-freeze', 'inspector-clear',
    'inspector-status', 'inspector-summary', 'inspector-rows'
  ];
  const elements = {};
  ids.forEach(id => { elements[id] = element(id); });
  const sent = [];
  const copied = [];
  const timers = [];
  let snapshot = {
    enabled: true,
    limit: 256,
    entries: [
      {
        id: 1, at: 1700000000000, decision: 'blocked', phase: 'request', type: 'script',
        host: 'ads.test', site: 'ads.test', topSite: 'page.test',
        url: 'https://ads.test/a.js', documentUrl: 'https://page.test/',
        rule: { text: '||ads.test^', source: 'custom' }, detail: '', reason: 'network rule', ms: 1.2
      },
      {
        id: 2, at: 1700000001000, decision: 'allowed', phase: 'request', type: 'image',
        host: 'page.test', site: 'page.test', topSite: 'page.test',
        url: 'https://page.test/logo.png', documentUrl: 'https://page.test/',
        rule: null, detail: '', reason: 'no matching rule', ms: 0.4
      },
      {
        id: 3, at: 1700000002000, decision: 'csp', phase: 'csp', type: 'document',
        host: 'page.test', site: 'page.test', topSite: 'page.test',
        url: 'https://page.test/', documentUrl: 'https://page.test/',
        rule: { text: '||page.test^$csp=no-script', source: 'wildfire' },
        detail: 'script-src none', reason: 'curated csp', ms: 0.5
      }
    ]
  };
  const ctx = vm.createContext({
    console,
    Date,
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: id => { timers[id - 1] = null; },
    navigator: {
      clipboard: {
        writeText: async value => { copied.push(value); }
      }
    },
    document: {
      getElementById: id => elements[id],
      createElement: tag => element(tag)
    },
    browser: {
      runtime: {
        sendMessage: async message => {
          sent.push(message.type);
          if (typeof message.value === 'boolean') snapshot.enabled = message.value;
          if (message.reset === true) snapshot.entries = [];
          return { ok: true, inspect: JSON.parse(JSON.stringify(snapshot)) };
        }
      }
    }
  });
  loadClient(ctx);
  loadFiles(ctx, [INSPECTOR_UI_FILE]);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui/inspector/inspector.js'), 'utf8'), ctx, {
    filename: 'inspector.js'
  });
  await new Promise(resolve => setImmediate(resolve));

  const rows = elements['inspector-rows'];
  const setFilter = (id, type, value) => {
    elements[id].value = value;
    elements[id].listeners[type]();
  };
  assert.strictEqual(sent[0], 'wildfire:inspect', 'inspector window loads its local log');
  assert.strictEqual(elements['inspector-enabled'].checked, true);
  assert.strictEqual(rows.children.length, 3);
  assert.strictEqual(elements['inspector-summary'].textContent,
    '3 shown · allowed 1 · blocked 1 · csp 1 · 3 of 256 decisions recorded locally in memory.');
  assert.strictEqual(rows.children[0].children[1].textContent, 'csp',
    'newest decisions appear first');

  setFilter('inspector-decision-filter', 'change', 'blocked');
  assert.strictEqual(rows.children.length, 1, 'decision filter narrows the visible log');
  setFilter('inspector-phase-filter', 'change', 'csp');
  assert.strictEqual(rows.children[0].children[0].textContent,
    'No decisions match these filters.', 'phase filter combines with decision');
  setFilter('inspector-decision-filter', 'change', 'all');
  assert.strictEqual(rows.children.length, 1, 'phase filter works on its own');
  setFilter('inspector-type-filter', 'input', 'script');
  assert.strictEqual(rows.children[0].children[0].textContent,
    'No decisions match these filters.', 'resource type filter narrows the log');
  setFilter('inspector-phase-filter', 'change', 'all');
  setFilter('inspector-type-filter', 'input', 'script');
  assert.strictEqual(rows.children.length, 1, 'script type filter keeps the script row');
  setFilter('inspector-query-filter', 'input', 'network rule');
  assert.strictEqual(rows.children.length, 1, 'free-text search finds reasons');
  elements['inspector-rules-only'].checked = true;
  elements['inspector-rules-only'].listeners.change();
  assert.strictEqual(rows.children.length, 1, 'rules-only keeps rows with a rule');
  setFilter('inspector-site-filter', 'input', 'nomatch');
  assert.strictEqual(rows.children.length, 1);
  assert.strictEqual(rows.children[0].children[0].textContent,
    'No decisions match these filters.');

  ['inspector-decision-filter', 'inspector-phase-filter', 'inspector-type-filter',
    'inspector-query-filter', 'inspector-site-filter'].forEach(id => setFilter(id,
    id.includes('filter') && id !== 'inspector-decision-filter' &&
    id !== 'inspector-phase-filter' ? 'input' : 'change', ''));
  elements['inspector-rules-only'].checked = false;
  elements['inspector-rules-only'].listeners.change();
  assert.strictEqual(rows.children.length, 3, 'clearing filters restores the log');

  elements['inspector-freeze'].listeners.click();
  assert.strictEqual(elements['inspector-freeze'].textContent, 'Unfreeze view');
  assert.strictEqual(elements['inspector-freeze'].attributes['aria-pressed'], 'true');
  assert.ok(elements['inspector-summary'].textContent.includes('View frozen.'));
  snapshot.entries.push({
    id: 4, at: 1700000003000, decision: 'blocked', phase: 'request', type: 'script',
    host: 'new.test', site: 'new.test', topSite: 'page.test', url: 'https://new.test/a.js',
    documentUrl: 'https://page.test/', rule: { text: '||new.test^' },
    detail: '', reason: 'network rule', ms: 0.2
  });
  elements['inspector-refresh'].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(rows.children.length, 3, 'a frozen view ignores later snapshots');
  elements['inspector-freeze'].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(elements['inspector-freeze'].textContent, 'Freeze view');
  assert.strictEqual(rows.children.length, 4, 'unfreezing restores live updates');

  const copy = rows.children[0].children[6].children[0];
  copy.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(copied[0], '||new.test^', 'copy-as-rule writes WildFire syntax');
  assert.ok(elements['inspector-status'].textContent.startsWith('Copied rule:'));

  elements['inspector-clear'].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(snapshot.entries.length, 0, 'clear resets the local log');
  assert.strictEqual(rows.children.length, 1);
  assert.strictEqual(elements['inspector-summary'].textContent,
    '0 shown · 0 of 256 decisions recorded locally in memory.');
}

function testUrlSkip() {
  const policy = context.WildFireBackgroundCore.createUrlSkip();
  assert.strictEqual(policy.urlSkipReason('https://ads.test/a.js'), '',
    'HTTP requests are filterable');
  assert.strictEqual(policy.urlSkipReason('wss://socket.test/'), '',
    'secure WebSockets are filterable');
  assert.strictEqual(policy.urlSkipReason('moz-extension://wildfire/panel.html'),
    'unsupported URL scheme moz-extension', 'extension pages are skipped');
  assert.strictEqual(policy.urlSkipReason('about:blank'),
    'unsupported URL scheme about', 'internal pages are skipped');
  assert.strictEqual(policy.urlSkipReason('data:text/plain,hello'),
    'unsupported URL scheme data', 'data URLs are skipped');
  assert.strictEqual(policy.urlSkipReason('file:///Users/me/ad.js'),
    'unsupported URL scheme file', 'local files are skipped');
  assert.strictEqual(policy.urlSkipReason(''), 'empty URL', 'empty URLs are skipped');
  assert.strictEqual(policy.isSkippedUrl('https://ads.test/a.js'), false);
  assert.strictEqual(policy.isSkippedUrl('blob:https://page.test/uuid'), true);
}

async function testWapiStorage() {
  const data = {};
  const storageCalls = [];
  const storageCtx = vm.createContext({
    console,
    browser: {
      storage: {
        local: {
          get: async key => {
            storageCalls.push(['get', key]);
            return { [key]: data[key] };
          },
          set: async patch => {
            storageCalls.push(['set', patch]);
            Object.assign(data, patch);
          }
        }
      }
    }
  });
  storageCtx.window = storageCtx;
  loadFiles(storageCtx, ['lib/state/store.js', 'lib/wapi/wapi.js']);
  const { WildFireStore, WildFireWapi: StoreWapi } = storageCtx;

  const initial = await WildFireStore.get();
  assert.strictEqual(initial.enabled, true, 'store loads defaults through wapi.storage');
  const saved = await WildFireStore.save({ blocked: 9, blockedBySite: { 'a.test': 3 } });
  assert.strictEqual(saved.blocked, 9);
  assert.strictEqual(saved.blockedBySite['a.test'], 3);
  assert.strictEqual(data['wildfire.state.v1'].blocked, 9, 'store persists snapshots');
  assert.strictEqual(storageCalls[0][0], 'get');
  assert.strictEqual(storageCalls[1][0], 'set');
  const instance = StoreWapi.create({ browserApi: storageCtx.browser });
  const wrapped = await instance.storage.local.get('wildfire.state.v1');
  assert.strictEqual(wrapped['wildfire.state.v1'].blocked, 9,
    'the same native storage is reachable through wapi');
}

function testOptionsEditorHelpers() {
  const editorCtx = vm.createContext({});
  loadFiles(editorCtx, [EDITOR_FILE]);
  const editor = editorCtx.WildFireOptionsEditor;
  assert.strictEqual(editor.classifyLine('! comment'), 'comment');
  assert.strictEqual(editor.classifyLine('@@||example.test^'), 'exception');
  assert.strictEqual(editor.classifyLine('example.test##.ad'), 'cosmetic');
  assert.strictEqual(editor.classifyLine("example.test#%#//scriptlet('set', 'a')"), 'cosmetic');
  assert.strictEqual(editor.classifyLine('||example.test^$script'), 'network');
  assert.strictEqual(editor.classifyLine('   '), 'blank');
  assert.strictEqual(editor.lineNumbers('a\nb\nc').trimEnd(), '1\n2\n3',
    'gutter numbers match editor lines');
  const caret = editor.cursorPosition('ab\ncd', 5);
  assert.strictEqual(caret.line, 2, 'caret line is one-based');
  assert.strictEqual(caret.column, 3, 'caret column is one-based');
  const lineRange = editor.selectedLineRange('one\ntwo\nthree', 4, 8);
  assert.strictEqual(lineRange.start, 2, 'selection starts on the selected line');
  assert.strictEqual(lineRange.end, 2,
    'a trailing newline does not select the next line');
  assert.strictEqual(editor.toggleComment('one\n  two', 1, 2), '! one\n  ! two',
    'comment preserves indentation');
  assert.strictEqual(editor.duplicateLines('one\ntwo', 2, 2), 'one\ntwo\ntwo',
    'duplicate repeats the selected line');
  assert.strictEqual(editor.deleteLines('one\ntwo\nthree', 2, 2), 'one\nthree',
    'delete removes the selected line');
  const found = editor.findNext('abc ABC', 'ABC', 1);
  assert.strictEqual(found.start, 4, 'find starts at the case-insensitive match');
  assert.strictEqual(found.end, 7, 'find selects the whole match');
  assert.strictEqual(editor.replaceLines('a\nb\nc', 2, 2, line => '[' + line + ']'),
    'a\n[b]\nc', 'line transforms are bounded to the selected range');
}

async function testWapiClient() {
  const sent = [];
  const queried = [];
  const openedWindows = [];
  let opened = 0;
  const hub = () => {
    const listeners = [];
    return {
      listeners,
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  };
  const messages = hub();
  const portMessages = hub();
  const portDisconnect = hub();
  const posted = [];
  let connectedName = '';
  let disconnected = 0;
  const nativePort = {
    name: 'wildfire:state',
    postMessage: payload => { posted.push(payload); },
    onMessage: portMessages,
    onDisconnect: portDisconnect,
    disconnect: () => { disconnected += 1; }
  };
  const ctx = vm.createContext({
    console,
    browser: {
      windows: {
        create: async info => {
          openedWindows.push(info);
          return { id: 4 };
        }
      },
      tabs: {
        query: async info => {
          queried.push(info);
          return [{ id: 7, url: 'https://page.test/' }];
        }
      },
      runtime: {
        onMessage: messages,
        getURL: path => 'moz-extension://wildfire/' + path,
        connect: options => {
          connectedName = options.name;
          return nativePort;
        },
        sendMessage: async message => {
          sent.push(message);
          return { ok: true, echo: message.type };
        },
        openOptionsPage: () => { opened += 1; }
      }
    }
  });
  loadClient(ctx);
  const { WildFireWapiClient, wapiClient } = ctx;
  assert.strictEqual(wapiClient, WildFireWapiClient,
    'wapi-client is exposed as the canonical client global');

  const client = WildFireWapiClient.create();
  assert.strictEqual(client.prefix, 'wildfire:');
  const result = await client.send('state', { url: 'https://page.test/', type: 'spoofed' });
  assert.strictEqual(result.echo, 'wildfire:state');
  assert.strictEqual(sent[0].type, 'wildfire:state', 'payload cannot override the message type');
  assert.strictEqual(sent[0].url, 'https://page.test/');
  await client.send('wildfire:reload');
  assert.strictEqual(sent[1].type, 'wildfire:reload', 'full types are not double-prefixed');
  await client.openOptions();
  assert.strictEqual(opened, 1, 'client wraps the native options opener');
  await client.openWindow('ui/inspector/inspector.html', { width: 900 });
  assert.strictEqual(openedWindows.length, 1, 'client wraps the native window opener');
  assert.strictEqual(openedWindows[0].url,
    'moz-extension://wildfire/ui/inspector/inspector.html',
    'window URLs are resolved against the extension');
  assert.strictEqual(openedWindows[0].type, 'popup', 'window defaults to the popup type');
  assert.strictEqual(openedWindows[0].width, 900, 'window options are forwarded');
  const activeTabs = await client.tabs.query({ active: true, currentWindow: true });
  assert.strictEqual(activeTabs[0].id, 7, 'client wraps the native tab query');
  assert.strictEqual(queried[0].active, true, 'tab query options are forwarded');
  await assert.rejects(
    () => WildFireWapiClient.create({ browserApi: {} }).tabs.query({}),
    /tabs\.query/,
    'missing tabs.query fails loudly');
  await assert.rejects(
    () => WildFireWapiClient.create({ browserApi: {} }).openWindow('x.html'),
    /windows\.create/,
    'missing windows.create fails loudly');

  const pushed = [];
  const handle = client.connect('state', payload => pushed.push(payload));
  assert.strictEqual(connectedName, 'wildfire:state', 'connect() uses a prefixed port name');
  assert.strictEqual(handle.connected, true);
  handle.send({ ping: 1 });
  assert.deepStrictEqual(posted, [{ ping: 1 }], 'port handles can send payloads');
  portMessages.listeners[0]({ type: 'wildfire:state', state: { blocked: 3 } });
  portMessages.listeners[0]({ type: 'wildfire:other' });
  portMessages.listeners[0]({ type: 'other:state' });
  assert.strictEqual(pushed.length, 1, 'port listeners ignore other channels');
  handle.close();
  assert.strictEqual(portMessages.listeners.length, 0, 'close() removes the port listener');
  assert.strictEqual(disconnected, 1, 'close() disconnects the native port');

  const seen = [];
  const off = client.on('apply', () => { seen.push('first'); return 'handled'; });
  client.on('apply', () => { seen.push('second'); });
  assert.strictEqual(messages.listeners.length, 1, 'one runtime listener routes all actions');
  const listener = messages.listeners[0];
  assert.strictEqual(listener({ type: 'wildfire:other' }, {}), undefined);
  assert.strictEqual(listener({ type: 'other:apply' }, {}), undefined,
    'unrelated prefixes are ignored');
  assert.strictEqual(listener({ type: 'wildfire:apply' }, {}), 'handled');
  assert.deepStrictEqual(seen, ['first', 'second']);
  off();
  seen.length = 0;
  assert.strictEqual(listener({ type: 'wildfire:apply' }, {}), undefined);
  assert.deepStrictEqual(seen, ['second'], 'off() removes only its own handler');
  client.close();
  assert.strictEqual(messages.listeners.length, 0, 'close() removes the runtime listener');

  const customHub = hub();
  const customSent = [];
  const custom = WildFireWapiClient.create({
    prefix: 'wf:',
    browserApi: {
      runtime: {
        onMessage: customHub,
        sendMessage: async message => { customSent.push(message); }
      }
    }
  });
  custom.on('apply', () => true);
  const customListener = customHub.listeners[0];
  assert.strictEqual(customListener({ type: 'wildfire:apply' }, {}), undefined,
    'custom prefixes ignore the default prefix');
  assert.strictEqual(customListener({ type: 'wf:apply' }, {}), true,
    'custom prefixes route matching messages');
  await custom.send('state');
  assert.strictEqual(customSent[0].type, 'wf:state');
  await assert.rejects(
    () => WildFireWapiClient.create({ browserApi: {} }).send('state'),
    /runtime\.sendMessage/,
    'missing runtime messaging fails loudly');
}

async function testWapiBackground() {
  const connectHub = (() => {
    const listeners = [];
    return {
      listeners,
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  })();
  const wapiStub = WildFireWapi.create({
    browserApi: { runtime: { onConnect: connectHub } }
  });
  const port = name => {
    const messages = [];
    const disconnects = [];
    return {
      name,
      messages,
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: {
        addListener(listener) { disconnects.push(listener); },
        fire() { disconnects.forEach(listener => listener()); }
      },
      postMessage(payload) { messages.push(payload); }
    };
  };

  assert.strictEqual(wapiBackground, WildFireWapiBackground,
    'wapi-background is exposed as a canonical backbone module');
  const channels = WildFireWapiBackground.create({ wapi: wapiStub, autoStart: false });
  assert.strictEqual(channels.connected, false, 'channels are inert before connect()');
  assert.strictEqual(channels.connect(), true);
  assert.strictEqual(channels.connect(), false, 'onConnect is registered once');

  const statePort = port('wildfire:state');
  const otherPort = port('other:state');
  const connectListener = connectHub.listeners[0];
  connectListener(statePort);
  connectListener(otherPort);
  assert.strictEqual(channels.size('state'), 1, 'only prefixed channels are tracked');
  assert.strictEqual(channels.channelNames().join(','), 'state');

  const payload = { type: 'wildfire:state', ok: true, state: { blocked: 7 } };
  assert.strictEqual(channels.broadcast('state', payload), 1);
  assert.deepStrictEqual(statePort.messages, [payload]);
  assert.strictEqual(otherPort.messages.length, 0);

  statePort.onDisconnect.fire();
  assert.strictEqual(channels.size('state'), 0, 'disconnected ports are pruned');
  const brokenPort = port('wildfire:state');
  brokenPort.postMessage = () => { throw new Error('port closed'); };
  connectListener(brokenPort);
  assert.strictEqual(channels.size('state'), 1);
  assert.strictEqual(channels.broadcast('state', payload), 0,
    'failed posts are ignored and pruned');
  assert.strictEqual(channels.size('state'), 0);

  channels.close();
  assert.strictEqual(connectHub.listeners.length, 0, 'close() removes onConnect');
}

async function testWapiRouter() {
  assert.strictEqual(wapiRouter, WildFireWapiRouter,
    'wapi-router is exposed as a canonical backbone module');
  const router = WildFireWapiRouter.create({ prefix: 'wildfire:' });
  const seen = [];
  router.register('state', (message, sender) => {
    seen.push({ url: message.url, tab: sender.tab });
    return { ok: true, action: 'state' };
  });
  router.registerAll({ reload: async () => ({ ok: true, action: 'reload' }) });
  assert.strictEqual(router.size(), 2);
  assert.strictEqual(router.accepts({ type: 'wildfire:state' }), true);
  assert.strictEqual(router.accepts({ type: 'wildfire:' }), true);
  assert.strictEqual(router.accepts({ type: 'other:state' }), false);
  assert.strictEqual(router.actionOf({ type: 'wildfire:state' }), 'state');

  const state = await router.dispatch(
    { type: 'wildfire:state', url: 'https://page.test/' },
    { tab: { id: 3 } }
  );
  assert.strictEqual(state.action, 'state');
  assert.deepStrictEqual(seen[0].tab, { id: 3 });
  const reload = await router.dispatch({ type: 'wildfire:reload' }, {});
  assert.strictEqual(reload.action, 'reload', 'async handlers are awaited');
  const unknown = await router.dispatch({ type: 'wildfire:missing' }, {});
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.error, 'Unknown action: missing');
  const empty = await router.dispatch({ type: 'wildfire:' }, {});
  assert.strictEqual(empty.error, 'Unknown action: ', 'empty actions keep the legacy error');
  assert.strictEqual(await router.dispatch({ type: 'other:state' }, {}), undefined);
  assert.strictEqual(router.unregister('reload'), true);
  assert.strictEqual(router.actions().join(','), 'state');
  assert.throws(() => router.register('', () => {}), /register\(\)/);
  router.clear();
  assert.strictEqual(router.size(), 0);
}

async function testWapiTabs() {
  assert.strictEqual(wapiTabs, WildFireWapiTabs,
    'wapi-tabs is exposed as a canonical backbone module');
  const hub = () => {
    const listeners = [];
    return {
      listeners,
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  };
  const webNavigation = {
    onCreatedNavigationTarget: hub(),
    onCommitted: hub(),
    onReferenceFragmentUpdated: hub(),
    onHistoryStateUpdated: hub()
  };
  const tabEvents = {
    onUpdated: hub(),
    onRemoved: hub(),
    onActivated: hub()
  };
  const browserApi = {
    webNavigation,
    tabs: Object.assign({
      get: async id => ({ id, url: 'https://tab.test/' })
    }, tabEvents)
  };
  const wapiStub = WildFireWapi.create({ browserApi });

  const navigations = [];
  const tabUrls = [];
  const forgotten = [];
  const pageStore = {
    observeNavigation(details) { navigations.push(details); },
    observeTab(id, url) { tabUrls.push([id, url]); },
    forgetTab(id) { forgotten.push(id); }
  };
  const popups = [];
  const topLevel = [];
  const badge = [];
  const complete = [];
  const activated = [];
  const removed = [];
  const hooks = {
    onPopupNavigation(details) { popups.push(details); },
    onTopLevelNavigation(id) { topLevel.push(id); },
    onTabUrl(id) { badge.push(id); },
    onTabComplete(id) { complete.push(id); },
    onTabActivated(id) { activated.push(id); },
    onTabRemoved(id) { removed.push(id); }
  };

  const adapter = WildFireWapiTabs.create({ wapi: wapiStub, pageStore, hooks, browserApi });
  assert.strictEqual(adapter.registered, false, 'tab listeners are inert before register()');
  assert.strictEqual(adapter.validate(), true, 'required events are checked up front');
  assert.strictEqual(adapter.register(), true);
  assert.strictEqual(adapter.register(), false, 'register() is idempotent');
  assert.strictEqual(adapter.names().join(','), [
    'webNavigation.onCreatedNavigationTarget', 'webNavigation.onCommitted',
    'webNavigation.onReferenceFragmentUpdated', 'webNavigation.onHistoryStateUpdated',
    'tabs.onUpdated', 'tabs.onRemoved', 'tabs.onActivated'
  ].join(','));

  webNavigation.onCreatedNavigationTarget.listeners[0]({ tabId: 1 });
  assert.strictEqual(popups.length, 1, 'popup navigation is delegated to policy');

  webNavigation.onCommitted.listeners[0]({ tabId: 2, frameId: 0 });
  webNavigation.onCommitted.listeners[0]({ tabId: 3, frameId: 1 });
  webNavigation.onReferenceFragmentUpdated.listeners[0]({ tabId: 4 });
  webNavigation.onHistoryStateUpdated.listeners[0]({ tabId: 4 });
  assert.strictEqual(navigations.length, 4, 'all navigation events reach PageStore');
  assert.deepStrictEqual(topLevel, [2], 'only top-level commits refresh the badge');

  tabEvents.onUpdated.listeners[0](5, { url: 'https://new.test/' },
    { url: 'https://new.test/' });
  tabEvents.onUpdated.listeners[0](6, { status: 'complete' },
    { url: 'https://done.test/' });
  assert.strictEqual(tabUrls.length, 3, 'complete updates observe the final tab URL');
  assert.strictEqual(badge.join(','), '5,6', 'complete updates badge the tab once');
  assert.deepStrictEqual(complete, [6], 'complete updates refresh cosmetics');

  tabEvents.onActivated.listeners[0]({ tabId: 7 });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(tabUrls.length, 4);
  assert.strictEqual(tabUrls[3].join(','), '7,https://tab.test/');
  assert.strictEqual(activated.length, 0, 'successful tab reads use the URL hook');

  browserApi.tabs.get = async () => { throw new Error('tab unavailable'); };
  tabEvents.onActivated.listeners[0]({ tabId: 8 });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(tabUrls.length, 4, 'failed tab reads do not observe a URL');
  assert.strictEqual(activated.join(','), '8', 'failed tab reads still refresh the badge');

  tabEvents.onRemoved.listeners[0](9);
  assert.deepStrictEqual(forgotten, [9]);
  assert.deepStrictEqual(removed, [9]);

  assert.strictEqual(adapter.unregister(), true);
  assert.strictEqual(adapter.registered, false);
  assert.strictEqual(webNavigation.onCommitted.listeners.length, 0);
  assert.strictEqual(tabEvents.onUpdated.listeners.length, 0);
  assert.strictEqual(tabEvents.onActivated.listeners.length, 0);

  const missingWapi = WildFireWapi.create({ browserApi: {} });
  const missing = WildFireWapiTabs.create({ wapi: missingWapi, hooks: {} });
  assert.throws(() => missing.validate(), /Missing required browser API/,
    'required tab events are validated at registration');
  assert.throws(() => missing.register(), /Missing required browser API/,
    'required tab events are validated at registration');
}

async function testWapiWebRequest() {
  assert.strictEqual(wapiWebRequest, WildFireWapiWebRequest,
    'wapi-webrequest is exposed as a canonical backbone module');
  const hub = () => {
    const listeners = [];
    const registrations = [];
    return {
      listeners,
      registrations,
      addListener(listener, filter, extra) {
        listeners.push(listener);
        registrations.push({ filter, extra });
      },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  };
  const events = {
    onBeforeRequest: hub(),
    onCompleted: hub(),
    onErrorOccurred: hub(),
    onBeforeRedirect: hub(),
    onHeadersReceived: hub(),
    onBeforeSendHeaders: hub()
  };
  const makeFilter = () => {
    const writes = [];
    return {
      writes,
      closed: 0,
      disconnected: 0,
      write(bytes) { writes.push(bytes); },
      close() { this.closed += 1; },
      disconnect() { this.disconnected += 1; }
    };
  };
  let filter = makeFilter();
  const browserApi = {
    webRequest: Object.assign(events, {
      filterResponseData: () => filter
    })
  };
  const wapiStub = WildFireWapi.create({ browserApi });

  const seen = [];
  const handlers = {
    beforeRequest: () => seen.push('before'),
    cspReport: () => seen.push('csp'),
    completed: () => seen.push('completed'),
    error: () => seen.push('error'),
    redirect: () => seen.push('redirect')
  };
  const adapter = WildFireWapiWebRequest.create({ wapi: wapiStub, handlers });
  assert.strictEqual(adapter.registered, false, 'webRequest listeners are inert before register()');
  assert.strictEqual(adapter.validate(), true, 'required events are checked up front');
  assert.strictEqual(adapter.register(), true);
  assert.strictEqual(adapter.register(), false, 'register() is idempotent');
  assert.strictEqual(events.onBeforeRequest.listeners.length, 2);
  assert.strictEqual(events.onBeforeRequest.registrations[0].extra.join(','), 'blocking');
  assert.strictEqual(events.onBeforeRequest.registrations[1].filter.types.join(','), 'csp_report');
  assert.strictEqual(adapter.names().length, 7);

  events.onBeforeRequest.listeners[0]({ requestId: 'r1' });
  events.onBeforeRequest.listeners[1]({ requestId: 'r1' });
  events.onCompleted.listeners[0]({ requestId: 'r1' });
  events.onErrorOccurred.listeners[0]({ requestId: 'r1' });
  events.onBeforeRedirect.listeners[0]({ requestId: 'r1' });
  assert.strictEqual(seen.join(','), 'before,csp,completed,error,redirect');

  const headerHandler = () => {};
  assert.strictEqual(adapter.headers(true, headerHandler), true);
  assert.strictEqual(events.onHeadersReceived.listeners.length, 1);
  assert.strictEqual(events.onHeadersReceived.registrations[0].extra.join(','),
    'blocking,responseHeaders');
  assert.strictEqual(adapter.headers(false), true);
  assert.strictEqual(events.onHeadersReceived.listeners.length, 0);
  assert.strictEqual(adapter.sendHeaders(true, headerHandler), true);
  assert.strictEqual(events.onBeforeSendHeaders.registrations[0].extra.join(','),
    'blocking,requestHeaders');
  assert.strictEqual(adapter.sendHeaders(false), true);
  assert.strictEqual(events.onBeforeSendHeaders.listeners.length, 0);

  const started = [];
  const finished = [];
  const filterErrors = [];
  const writeErrors = [];
  const hooks = {
    onStart: id => started.push(id),
    onFinish: id => finished.push(id),
    onFilterError: error => filterErrors.push(error),
    onWriteError: error => writeErrors.push(error)
  };
  const resource = { type: 'script', bytes: Uint8Array.of(1, 2, 3) };
  assert.strictEqual(adapter.rewrite('r2', resource, hooks), true);
  assert.deepStrictEqual(started, ['r2']);
  filter.ondata();
  assert.strictEqual(filter.writes.length, 0, 'original chunks are dropped');
  filter.onstop();
  assert.strictEqual(filter.writes[0], resource.bytes, 'curated bytes are written once');
  assert.strictEqual(filter.closed, 1);
  assert.deepStrictEqual(finished, ['r2']);
  filter.onstop();
  assert.strictEqual(finished.length, 1, 'stream completion is idempotent');

  filter = makeFilter();
  filter.write = () => { throw new Error('write failed'); };
  assert.strictEqual(adapter.rewrite('r3', resource, hooks), true);
  filter.onstop();
  assert.strictEqual(writeErrors.length, 1);
  assert.strictEqual(filter.disconnected, 1);
  assert.strictEqual(finished.length, 2);

  filter = makeFilter();
  assert.strictEqual(adapter.rewrite('r4', resource, hooks), true);
  filter.onerror();
  assert.strictEqual(filter.disconnected, 1);
  assert.strictEqual(finished.length, 3);

  browserApi.webRequest.filterResponseData = () => { throw new Error('filter failed'); };
  assert.strictEqual(adapter.rewrite('r5', resource, hooks), false);
  assert.strictEqual(filterErrors.length, 1);

  assert.strictEqual(adapter.unregister(), true);
  assert.strictEqual(adapter.registered, false);
  assert.strictEqual(events.onBeforeRequest.listeners.length, 0);
  assert.strictEqual(events.onCompleted.listeners.length, 0);

  const missingWapi = WildFireWapi.create({ browserApi: {} });
  const missing = WildFireWapiWebRequest.create({ wapi: missingWapi });
  assert.throws(() => missing.validate(), /Missing required browser API/,
    'required webRequest events are validated at registration');
}

async function testWapiAction() {
  assert.strictEqual(wapiAction, WildFireWapiAction,
    'wapi-action is exposed as a canonical backbone module');
  const calls = [];
  const browserAction = {
    setBadgeText(options) {
      calls.push(['text', options]);
      return Promise.reject(new Error('native call failed'));
    },
    setBadgeBackgroundColor(options) {
      calls.push(['color', options]);
      return undefined;
    }
  };
  const wapiStub = WildFireWapi.create({ browserApi: { browserAction } });
  const action = WildFireWapiAction.create({ wapi: wapiStub });
  assert.strictEqual(action.supported, true);
  assert.strictEqual(action.setBadgeText({ text: '7', tabId: 3 }), true);
  assert.strictEqual(action.setBadgeBackgroundColor({ color: '#e2511d' }), true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0][0], 'text');
  assert.strictEqual(calls[0][1].text, '7');
  assert.strictEqual(calls[0][1].tabId, 3);
  assert.strictEqual(calls[1][0], 'color');
  assert.strictEqual(calls[1][1].color, '#e2511d');
  await Promise.resolve();

  browserAction.setBadgeText = () => { throw new Error('native call threw'); };
  assert.strictEqual(action.setBadgeText({}), false, 'native throws are contained');

  const missing = WildFireWapiAction.create({ browserApi: {} });
  assert.strictEqual(missing.supported, false);
  assert.strictEqual(missing.setBadgeText({}), false);
  assert.strictEqual(missing.setBadgeBackgroundColor({}), false);
}

async function testWapiCapabilities() {
  assert.strictEqual(wapiCapabilities, WildFireWapiCapabilities,
    'wapi-capabilities is exposed as a canonical backbone module');
  let domainArgs = null;
  const nativeBridge = {
    setPayload: async () => {},
    clearPayload: async () => {}
  };
  const hub = { addListener() {}, removeListener() {} };
  const browserApi = {
    runtime: {
      getURL: path => 'moz-extension://test/' + path,
      sendMessage: async () => {},
      onMessage: hub
    },
    publicSuffix: {
      getDomain: (host, options) => {
        domainArgs = [host, options];
        return 'example.com';
      }
    },
    alarms: {
      onAlarm: hub,
      clear: async () => {},
      get: async () => null,
      create: async () => {}
    },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    webRequest: { filterResponseData: () => ({}) },
    wildfireNative: nativeBridge
  };
  const wapiStub = WildFireWapi.create({ browserApi });
  const caps = WildFireWapiCapabilities.create({ wapi: wapiStub });

  assert.strictEqual(caps.browser, browserApi, 'capabilities expose the native Firefox API');
  assert.strictEqual(caps.prefix, 'wildfire:', 'capabilities inherit the wapi prefix');
  assert.strictEqual(caps.ready, wapiStub.ready, 'capabilities expose wapi readiness');
  assert.strictEqual(caps.settle(), wapiStub.ready, 'settle delegates to the wapi');
  assert.strictEqual(caps.runtime.event, hub, 'runtime capability exposes the message event');
  assert.strictEqual(caps.runtime.getURL('icon.png'), 'moz-extension://test/icon.png');
  assert.strictEqual(JSON.stringify(caps.snapshot()), JSON.stringify({
    runtime: true,
    publicSuffix: true,
    alarms: true,
    contentScripts: true,
    filterResponseData: true,
    storage: true,
    nativeBridge: true
  }), 'snapshot reports every native capability');
  assert.strictEqual(caps.has('publicSuffix'), true);
  assert.strictEqual(caps.has('missing'), false);
  assert.strictEqual(caps.validate(['runtime', 'publicSuffix', 'storage']), true);
  assert.strictEqual(caps.alarms.present, true);
  assert.strictEqual(caps.alarms.event, hub);
  assert.strictEqual(caps.contentScripts.supported, true);
  assert.strictEqual(caps.storage.local, browserApi.storage.local);
  assert.strictEqual(caps.webRequest.filterResponseDataSupported, true);
  assert.strictEqual(caps.nativeBridge(), nativeBridge);

  const options = { allowIPAddress: true };
  assert.strictEqual(caps.domain('www.example.com', options), 'example.com');
  assert.strictEqual(JSON.stringify(domainArgs), JSON.stringify(['www.example.com', options]),
    'domain lookups receive the requested host and options');
  browserApi.publicSuffix.getDomain = () => { throw new Error('lookup failed'); };
  assert.strictEqual(caps.domain('www.example.com'), '', 'failed domain lookups are contained');

  const missing = WildFireWapiCapabilities.create({ browserApi: {} });
  assert.strictEqual(missing.has('publicSuffix'), false);
  assert.strictEqual(missing.domain('www.example.com'), '');
  assert.strictEqual(missing.nativeBridge(), null);
  assert.throws(() => missing.validate(['publicSuffix', 'alarms']),
    /Missing required WildFire capability: publicSuffix, alarms/);
  const invalidBridge = WildFireWapiCapabilities.create({ browserApi: { wildfireNative: {} } });
  assert.strictEqual(invalidBridge.has('nativeBridge'), false,
    'a bridge without setPayload is not a capability');
}

async function testWapiContexts() {
  const sent = [];
  const wapiStub = {
    tabs: {
      send: async (tabId, payload, options) => {
        sent.push({ tabId, payload, options });
        return { ok: true };
      }
    }
  };
  assert.strictEqual(wapiContexts, WildFireWapiContexts,
    'wapi-contexts is exposed as a canonical backbone module');
  const contexts = WildFireWapiContexts.create({ wapi: wapiStub });
  const sender = { tab: { id: 7, url: 'https://page.test/' }, frameId: 0 };
  const observed = contexts.observe({ type: 'wildfire:cosmetic', url: 'https://page.test/ad' }, sender);
  assert.strictEqual(observed.tabId, 7);
  assert.strictEqual(observed.frameId, 0);
  assert.strictEqual(observed.url, 'https://page.test/ad');
  assert.strictEqual(contexts.size(), 1);
  contexts.observe({ type: 'wildfire:cosmetic', url: 'https://page.test/frame' },
    { tab: { id: 7, url: 'https://page.test/' }, frameId: 2 });
  assert.strictEqual(contexts.framesForTab(7).length, 2,
    'each content script frame is tracked separately');
  assert.strictEqual(contexts.find(7, 2).url, 'https://page.test/frame');
  await contexts.send(7, 2, { type: 'wildfire:apply' });
  assert.strictEqual(sent[0].options.frameId, 2,
    'frame-targeted messages use Firefox native frame options');
  await contexts.broadcast({ type: 'wildfire:apply' });
  assert.strictEqual(sent.length, 3, 'broadcast reaches every registered frame');
  assert.strictEqual(contexts.forgetFrame(7, 2), true);
  assert.strictEqual(contexts.size(), 1);
  contexts.forgetTab(7);
  assert.strictEqual(contexts.size(), 0, 'tab removal forgets all frame contexts');
}

async function testBackgroundControllerRobustness() {
  const eventHub = () => {
    const listeners = [];
    return {
      listeners,
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      }
    };
  };
  const makeLocalStore = () => {
    let data = {};
    return {
      get: async key => ({ [key]: data[key] }),
      set: async patch => { data = Object.assign({}, data, patch); }
    };
  };
  const makeBrowser = () => ({
    runtime: {
      getURL: path => 'moz-extension://test/' + path,
      onMessage: eventHub(),
      onConnect: eventHub()
    },
    storage: { local: makeLocalStore() },
    browserAction: {
      setBadgeBackgroundColor: () => {},
      setBadgeText: () => {}
    },
    webRequest: {
      onBeforeRequest: eventHub(),
      onBeforeSendHeaders: eventHub(),
      onHeadersReceived: eventHub(),
      onCompleted: eventHub(),
      onErrorOccurred: eventHub(),
      onBeforeRedirect: eventHub()
    },
    webNavigation: {
      onCreatedNavigationTarget: eventHub(),
      onCommitted: eventHub(),
      onReferenceFragmentUpdated: eventHub(),
      onHistoryStateUpdated: eventHub()
    },
    tabs: {
      query: async () => [],
      get: async id => ({ id, url: '' }),
      onUpdated: eventHub(),
      onActivated: eventHub(),
      onRemoved: eventHub(),
      sendMessage: async () => {},
      remove: async () => {}
    },
    alarms: {
      onAlarm: eventHub(),
      clear: async () => {},
      get: async () => null,
      create: async () => {}
    },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  });

  const defaults = WildFireStore.defaults;
  const makeStore = (getImpl) => ({
    defaults,
    get: getImpl,
    save: async patch => patch
  });
  const defaultText = fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8');
  const savedFetch = context.fetch;
  const savedError = console.error;
  const savedWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  context.fetch = async url => String(url).includes('default.compiled.json')
    ? { ok: false }
    : { ok: true, text: async () => defaultText };

  try {
    const failingBrowser = makeBrowser();
    const failing = WildFireBackground.create({
      browserApi: failingBrowser,
      store: makeStore(async () => { throw new Error('storage unavailable'); })
    });
    await failing.start();
    assert.ok(failingBrowser.webRequest.onBeforeRequest.listeners.length > 0,
      'blocking listeners are registered before async initialization');
    assert.ok(failingBrowser.runtime.onMessage.listeners.length > 0,
      'message listeners are registered before async initialization');
    const failedState = await failing.debug().onMessage({ type: 'wildfire:state' }, {});
    assert.strictEqual(failedState.ok, false, 'messages report initialization failure');
    assert.ok(/storage unavailable/.test(failedState.error), 'the failure reason is included');
    assert.strictEqual(failing.context.startup.ok, false,
      'a failed startup is recorded in diagnostics state');
    assert.strictEqual(failing.context.startup.total,
      Object.values(failing.context.startup.counts)
        .reduce((sum, value) => sum + (Number(value) || 0), 0),
      'startup counts use the same shape on failure');

    const healthyBrowser = makeBrowser();
    const healthy = WildFireBackground.create({
      browserApi: healthyBrowser,
      store: makeStore(async () => Object.assign({}, defaults))
    });
    await healthy.start();
    const firstCount = healthy.debug().getListenerCount();
    assert.ok(firstCount > 0, 'a healthy startup registers listeners');
    const pushed = [];
    healthyBrowser.runtime.onConnect.listeners[0]({
      name: 'wildfire:state',
      postMessage: payload => { pushed.push(payload); },
      onDisconnect: { addListener() {} }
    });
    await healthy.context.persist({ blocked: 42 });
    const push = pushed.find(payload => payload.type === 'wildfire:state');
    assert.ok(push && push.state.blocked === 42,
      'state persistence broadcasts to connected extension pages');
    await healthy.start();
    assert.strictEqual(healthy.debug().getListenerCount(), firstCount,
      'starting twice does not register duplicate listeners');
    const diagnostics = await healthy.debug().onMessage({ type: 'wildfire:diagnostics' }, {});
    assert.strictEqual(diagnostics.diagnostics.startup.ok, true,
      'diagnostics report engine health');
    assert.ok(diagnostics.diagnostics.startup.total > 0,
      'a healthy startup loads bundled rules');
    const actions = healthy.debug().wapiRouter.actions();
    assert.strictEqual(actions.join(','), [
      'state', 'toggle', 'toggle-site', 'set-filters', 'validate-filters',
      'set-csp-report-blocking', 'set-csp-report-allow', 'set-site-rule', 'clear-site-rules',
      'reset-stats',
      'reload', 'suggested-lists', 'list-state', 'add-list', 'remove-list',
      'update-list', 'set-list-enabled', 'set-list-auto', 'cosmetic',
      'diagnostics', 'inspect'
    ].join(','), 'router registers every wildfire action');
    const beforeValidation = healthy.context.state.customFilters;
    const validation = await healthy.debug().onMessage({
      type: 'wildfire:validate-filters',
      value: '||good.example^\n! note\n/(a+)+$/\n||bad.example^$csp=not-curated'
    }, {});
    assert.strictEqual(validation.ok, true, 'filter validation returns a local result');
    assert.strictEqual(validation.validation.counts.network, 1,
      'validation counts accepted rules without loading them');
    assert.strictEqual(validation.validation.issues.length, 2,
      'validation reports every rejected rule');
    assert.strictEqual(validation.validation.issues[0].line, 3,
      'validation reports the unsafe regex line');
    assert.strictEqual(validation.validation.issues[1].line, 4,
      'validation reports the unknown alias line');
    assert.strictEqual(healthy.context.state.customFilters, beforeValidation,
      'validation never persists custom filters');
    const unknown = await healthy.debug().onMessage({ type: 'wildfire:missing' }, {});
    assert.strictEqual(unknown.error, 'Unknown action: missing',
      'unknown actions keep the existing error shape');
    assert.strictEqual(healthy.debug().wapiTabs.registered, true,
      'startup registers the native tab adapter');
    assert.strictEqual(healthy.debug().wapiWebRequest.registered, true,
      'startup registers the native webRequest adapter');
    assert.strictEqual(healthy.debug().wapiAction.supported, true,
      'startup exposes the native action adapter');
    assert.strictEqual(healthy.debug().wapiScripting, healthy.context.wapiScripting,
      'startup exposes the native scripting adapter');
    assert.strictEqual(healthy.debug().logger, healthy.context.logger,
      'startup exposes the local decision logger');
    const caps = healthy.debug().wapiCapabilities.snapshot();
    assert.strictEqual(caps.publicSuffix, true,
      'startup exposes the native domain capability');
    assert.strictEqual(caps.contentScripts, true,
      'startup exposes the content script capability');
    assert.strictEqual(caps.nativeBridge, false,
      'the optional native bridge stays unavailable when not supplied');

    const previous = await healthy.context.wapiScripting.register('scriptlets', {
      matches: ['<all_urls>'],
      js: [{ code: '/* seed */' }]
    });
    assert.ok(previous, 'wapi-scripting owns the seeded scriptlet registration');
    let unregistered = 0;
    const nativeUnregister = previous.unregister;
    previous.unregister = async () => {
      unregistered += 1;
      await nativeUnregister();
    };
    healthy.context.engine.getScriptletPayload = () => [{
      alias: 'set-constant',
      args: ['foo', '1'],
      domains: ['example.com'],
      isException: false
    }];
    let registerCalls = 0;
    let registered;
    const next = { unregister: async () => {} };
    healthyBrowser.contentScripts.register = async registration => {
      registered = registration;
      registerCalls += 1;
      if (registerCalls === 1) throw new Error('registration failed');
      return next;
    };
    await healthy.context.syncScriptlets();
    assert.strictEqual(healthy.context.wapiScripting.get('scriptlets'), previous,
      'a failed scriptlet swap keeps the previous registration');
    assert.strictEqual(unregistered, 0, 'the previous registration is not closed on failure');
    await healthy.context.syncScriptlets();
    assert.strictEqual(healthy.context.wapiScripting.get('scriptlets'), next,
      'a successful swap installs the new registration');
    assert.strictEqual(unregistered, 1, 'the previous registration is closed after success');
    const injectedCode = registered.js[registered.js.length - 1].code;
    assert.ok(injectedCode.includes('__wildfireScriptletGeneration'),
      'overlapping registrations are guarded by a generation stamp');

    const inspectOn = await healthy.debug().onMessage({ type: 'wildfire:inspect', value: true }, {});
    assert.strictEqual(inspectOn.inspect.enabled, true,
      'inspect action enables local recording');
    const savedRecordBlock = healthy.context.recordBlock;
    healthy.context.recordBlock = () => {};
    let skippedMatches = 0;
    healthy.context.engine.matchRequest = () => {
      skippedMatches += 1;
      return { blocked: false, rule: null, exception: null, redirect: null, rewrite: null };
    };
    const skipped = healthy.context.onBeforeRequest({
      url: 'moz-extension://wildfire/panel.html',
      type: 'document',
      tabId: 11,
      requestId: 'inspect-skipped',
      documentUrl: 'https://page.test/'
    });
    assert.strictEqual(skipped, undefined, 'skipped URLs are not cancelled');
    assert.strictEqual(skippedMatches, 0, 'URL skip bypasses engine matching');
    const skippedEntries = (await healthy.debug()
      .onMessage({ type: 'wildfire:inspect' }, {})).inspect.entries;
    const skippedEntry = skippedEntries.find(entry =>
      entry.decision === 'skipped' && entry.url === 'moz-extension://wildfire/panel.html');
    assert.ok(skippedEntry, 'URL skip is recorded in the local inspector');
    assert.strictEqual(skippedEntry.detail,
      'url skip: unsupported URL scheme moz-extension');

    healthy.context.engine.matchRequest = () => ({
      blocked: true,
      rule: { pattern: '||ads.test^', sourceKind: 'custom', hash: 'block-hash' },
      exception: null,
      redirect: null,
      rewrite: null
    });
    const blocked = healthy.context.onBeforeRequest({
      url: 'https://ads.test/a.js',
      type: 'script',
      tabId: 11,
      requestId: 'inspect-block',
      documentUrl: 'https://page.test/'
    });
    assert.strictEqual(blocked.cancel, true, 'blocked request is cancelled');
    const blockedEntries = (await healthy.debug()
      .onMessage({ type: 'wildfire:inspect' }, {})).inspect.entries;
    const blockedEntry = blockedEntries.find(entry =>
      entry.decision === 'blocked' && entry.host === 'ads.test');
    assert.ok(blockedEntry, 'a blocked request appears in the inspector');
    assert.strictEqual(blockedEntry.rule.text, '||ads.test^');
    assert.strictEqual(blockedEntry.rule.source, 'custom');

    healthy.context.engine.matchRequest = () => ({
      blocked: false,
      rule: null,
      exception: { pattern: '@@||ads.test^', sourceKind: 'custom', hash: 'exception-hash' },
      redirect: null,
      rewrite: null
    });
    healthy.context.onBeforeRequest({
      url: 'https://ads.test/b.js',
      type: 'script',
      tabId: 11,
      requestId: 'inspect-exception',
      documentUrl: 'https://page.test/'
    });
    const exceptionEntries = (await healthy.debug()
      .onMessage({ type: 'wildfire:inspect' }, {})).inspect.entries;
    const exceptionEntry = exceptionEntries.find(entry => entry.decision === 'exception');
    assert.ok(exceptionEntry, 'an exception appears in the inspector');
    assert.strictEqual(exceptionEntry.rule.text, '@@||ads.test^');

    const cleared = await healthy.debug()
      .onMessage({ type: 'wildfire:inspect', reset: true }, {});
    assert.strictEqual(cleared.inspect.entries.length, 0, 'inspect reset clears local entries');
    healthy.context.recordBlock = savedRecordBlock;
  } finally {
    context.fetch = savedFetch;
    console.error = savedError;
    console.warn = savedWarn;
  }
}

async function testCompilerTimeoutFallback() {
  let worker = null;
  class HangingWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      worker = this;
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const events = [];
  const compiler = WildFireCompiler.create({
    browserApi: { runtime: { getURL: path => path } },
    Worker: HangingWorker,
    setTimeout,
    clearTimeout,
    timeoutMs: 5
  });
  compiler.on(event => events.push(event.type));

  const result = await compiler.compile('||timeout.example^');
  assert.strictEqual(result.counts.network, 1,
    'a timed-out worker compile falls back to the synchronous engine');
  assert.strictEqual(result.id, 0, 'fallback results use the synchronous result id');
  assert.ok(worker.terminated, 'a timed-out worker is terminated');
  assert.ok(events.includes('worker-timeout'), 'worker timeout is reported locally');
  assert.ok(events.includes('fallback'), 'timeout triggers the normal fallback path');
  compiler.destroy();
}

async function testTrafficPathRegressions() {
  const savedFetch = context.fetch;
  const savedWarn = console.warn;
  const savedDebug = console.debug;
  console.warn = () => {};
  console.debug = () => {};
  context.fetch = async url => String(url).includes('default.compiled.json')
    ? { ok: false }
    : { ok: true, text: async () => '' };

  const hooks = {};
  const localData = {};
  const local = {
    async get(key) { return key === undefined ? Object.assign({}, localData) : { [key]: localData[key] }; },
    async set(patch) { Object.assign(localData, patch || {}); },
    async remove(key) { delete localData[key]; }
  };
  let delaySave = false;
  let releaseSave = null;
  const store = {
    defaults: WildFireStore.defaults,
    async get() { return Object.assign({}, WildFireStore.defaults); },
    async save(next) {
      if (delaySave) {
        delaySave = false;
        await new Promise(resolve => { releaseSave = resolve; });
      }
      return Object.assign({}, next);
    }
  };
  const hub = { addListener() {}, removeListener() {} };
  const browserApi = {
    runtime: {
      getURL: path => 'moz-extension://test/' + path,
      onMessage: hub,
      onConnect: hub
    },
    storage: { local },
    browserAction: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    webRequest: {
      onBeforeRequest: {
        addListener(fn, filter) {
          if (filter && Array.isArray(filter.types) && filter.types.includes('csp_report')) hooks.cspReport = fn;
          else hooks.beforeRequest = fn;
        }
      },
      onBeforeSendHeaders: { addListener(fn) { hooks.sendHeaders = fn; } },
      onHeadersReceived: { addListener(fn) { hooks.headers = fn; } },
      onCompleted: hub,
      onErrorOccurred: hub,
      onBeforeRedirect: hub,
      filterResponseData: () => ({
        ondata() {}, onstop() {}, onerror() {}, write() {}, close() {}, disconnect() {}
      })
    },
    webNavigation: {
      onCreatedNavigationTarget: { addListener(fn) { hooks.popup = fn; } },
      onCommitted: hub,
      onReferenceFragmentUpdated: hub,
      onHistoryStateUpdated: hub
    },
    tabs: {
      query: async () => [],
      remove: async () => new Promise(() => {}),
      sendMessage: async () => {},
      onUpdated: hub,
      onRemoved: hub
    },
    alarms: {
      onAlarm: hub, clear: async () => {}, get: async () => null, create: async () => {}
    },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  };

  try {
    const bg = WildFireBackground.create({ browserApi, store });
    await bg.start();
    const c = bg.context;
    const wait = () => new Promise(resolve => setTimeout(resolve, 20));

    c.state = Object.assign({}, c.state, {
      enabled: true,
      customFilters: '||blocked-target.test^$document',
      disabledSites: [],
      siteRules: {}
    });
    await c.loadFilters(true);
    await wait();
    c.pageStore.observeNavigation({
      tabId: 1, frameId: 0, documentId: 'doc-news', url: 'https://news.example.com/'
    });
    const nav = c.onBeforeRequest({
      url: 'https://blocked-target.test/landing',
      type: 'main_frame',
      tabId: 1,
      frameId: 0,
      documentUrl: 'https://blocked-target.test/landing',
      requestId: 'nav-block'
    });
    assert.ok(nav && nav.cancel, 'a $document rule cancels the navigation');
    assert.strictEqual(c.pageStore.topUrlForTab(1), 'https://news.example.com/',
      'a cancelled navigation leaves the committed page untouched');
    assert.strictEqual(c.state.blocked, 1, 'the navigation block is counted once');
    assert.strictEqual(c.state.blockedBySite['example.com'], 1,
      'a blocked navigation is attributed to the tab site');
    assert.strictEqual(c.state.blockedBySite['blocked-target.test'] || 0, 0,
      'a blocked navigation target is not charged for the block');

    c.state = Object.assign({}, c.state, {
      customFilters: '||popup.example^$popup',
      disabledSites: [],
      siteRules: {}
    });
    await c.loadFilters(true);
    await wait();
    c.pageStore.observeNavigation({
      tabId: 2, frameId: 0, documentId: 'doc-source', url: 'https://source.example.com/'
    });
    assert.strictEqual(typeof hooks.popup, 'function', 'popup navigation hook is registered');
    hooks.popup({
      tabId: 3,
      sourceTabId: 2,
      sourceFrameId: 0,
      url: 'https://popup.example/open'
    });
    const afterEarlyBlock = c.state.blocked;
    assert.strictEqual(afterEarlyBlock, 2, 'the early popup block is counted once');
    const popupRequest = c.onBeforeRequest({
      url: 'https://popup.example/open',
      type: 'main_frame',
      tabId: 3,
      frameId: 0,
      documentUrl: 'https://popup.example/open',
      requestId: 'popup-request'
    });
    assert.ok(popupRequest && popupRequest.cancel,
      'a follow-up popup request is cancelled even before tabs.remove() lands');
    assert.strictEqual(c.state.blocked, afterEarlyBlock,
      'the follow-up popup request does not count twice');
    assert.strictEqual(c.state.blockedBySite['popup.example'] || 0, 0,
      'a popup block is attributed to its source site');
    assert.strictEqual(c.popupCleanupTimers.has(3), false,
      'consuming a pending popup block cancels its cleanup timer');

    c.state = Object.assign({}, c.state, {
      customFilters: '||api.example^$removeheader=response:x-track',
      disabledSites: [],
      siteRules: { 'example.com': { script: 'allow' } }
    });
    await c.loadFilters(true);
    await wait();
    c.pageStore.observeNavigation({
      tabId: 4, frameId: 0, documentId: 'doc-top', url: 'https://www.example.com/'
    });
    c.pageStore.observeNavigation({
      tabId: 4, frameId: 1, parentFrameId: 0, documentId: 'doc-frame',
      url: 'https://embed.third.test/'
    });
    const iframeHeaders = c.onHeadersReceived({
      url: 'https://api.example/data',
      type: 'script',
      tabId: 4,
      frameId: 1,
      documentUrl: 'https://embed.third.test/',
      responseHeaders: [{ name: 'X-Track', value: '1' }]
    });
    assert.strictEqual(iframeHeaders, undefined,
      'a top-level allow suppresses header edits inside embedded frames');

    c.state = Object.assign({}, c.state, {
      disabledSites: ['example.com'],
      siteRules: {}
    });
    const pausedHeaders = c.onHeadersReceived({
      url: 'https://api.example/data',
      type: 'script',
      tabId: 4,
      frameId: 1,
      documentUrl: 'https://embed.third.test/',
      responseHeaders: [{ name: 'X-Track', value: '1' }]
    });
    assert.strictEqual(pausedHeaders, undefined,
      'a paused top-level site suppresses header edits inside embedded frames');

    c.state = Object.assign({}, c.state, {
      enabled: true,
      blocked: 0,
      blockedBySite: {},
      disabledSites: [],
      siteRules: {}
    });
    delaySave = true;
    const saving = c.persist({ cspReportAllow: ['reports.example'] });
    await new Promise(resolve => setImmediate(resolve));
    c.recordBlock(9, 'blocked.test');
    releaseSave();
    const saved = await saving;
    assert.strictEqual(saved.state.blocked, 1,
      'a counter recorded during a storage write survives the write');
    assert.strictEqual(saved.state.blockedBySite['blocked.test'], 1,
      'a per-site counter recorded during a storage write survives the write');
    assert.deepStrictEqual(saved.state.cspReportAllow, ['reports.example'],
      'the persisted patch is still applied after the concurrent counter');
  } finally {
    // Compiler status events are emitted asynchronously after loadFilters().
    await new Promise(resolve => setTimeout(resolve, 50));
    context.fetch = savedFetch;
    console.warn = savedWarn;
    console.debug = savedDebug;
  }
}

Promise.resolve()
  .then(() => testPhase0Foundation())
  .then(() => testPhase1AAliases())
  .then(() => testHideExceptionModifiers())
  .then(() => testPhase1BBadfilter())
  .then(() => testPhase1CRemoveModifiers())
  .then(() => testCompileCacheAndCompiler())
  .then(() => testCompilerTimeoutFallback())
  .then(() => testTrafficPathRegressions())
  .then(() => testCompileCacheIdbLru())
  .then(() => testCompileInFlightDedup())
  .then(() => testIncrementalRemoteCompileSemantics())
  .then(() => testBackgroundLoadFiltersIntegration())
  .then(() => testStaleGenerationWorkerHang())
  .then(() => testRemoveRuntimeIntegration())
  .then(() => testPerSiteBadgeCounters())
  .then(() => testWapiBackbone())
  .then(() => testWapiStorage())
  .then(() => testOptionsEditorHelpers())
  .then(() => testWapiClient())
  .then(() => testWapiBackground())
  .then(() => testWapiRouter())
  .then(() => testWapiTabs())
  .then(() => testWapiWebRequest())
  .then(() => testWapiAction())
  .then(() => testWapiCapabilities())
  .then(() => testWapiScripting())
  .then(() => testPreventFetchResponseConfig())
  .then(() => testBackgroundLogger())
  .then(() => testInspectorUiHelpers())
  .then(() => testInspectorPage())
  .then(() => testUrlSkip())
  .then(() => testWapiContexts())
  .then(() => testBackgroundControllerRobustness())
  .then(() => testPopupPerSiteDisplay())
  .then(() => testRemoteLists())
  .then(() => console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

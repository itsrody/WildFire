/* Dependency-free unit tests for the filter engine. Run with: npm test */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const context = vm.createContext({
  console, URL, CSS: { supports: () => true }, location: { hostname: 'page.example' }
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/filter-engine.js'), 'utf8'), context, {
  filename: 'filter-engine.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/document-scope.js'), 'utf8'), context, {
  filename: 'document-scope.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/redirect-resources.js'), 'utf8'), context, {
  filename: 'redirect-resources.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/procedural.js'), 'utf8'), context, {
  filename: 'procedural.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/remote-lists.js'), 'utf8'), context, {
  filename: 'remote-lists.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/csp-resources.js'), 'utf8'), context, {
  filename: 'csp-resources.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/scriptlets.js'), 'utf8'), context, {
  filename: 'scriptlets.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/rewrite-resources.js'), 'utf8'), context, {
  filename: 'rewrite-resources.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/compile-cache.js'), 'utf8'), context, {
  filename: 'compile-cache.js'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/compiler.js'), 'utf8'), context, {
  filename: 'compiler.js'
});
const { FilterEngine, mapResourceType, DocumentScope, RedirectResources, WildFireProcedural, RemoteLists, CspResources, WildFireScriptlets, RewriteResources, WildFireCompileCache, WildFireCompiler } = context;

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
  '@@||promo.example^$csp=no-frame'
].join('\n'));
const plainException = cspExceptionEngine.matchCsp(
  'https://ads.example/a.js', 'script', 'https://page.example/');
assert.strictEqual(plainException.exception, true, 'a plain exception covers CSP rules');
assert.deepStrictEqual(Array.from(plainException.directives), [], 'an exception stops CSP injection');
assert.deepStrictEqual(
  cspFor(cspExceptionEngine, 'https://promo.example/', 'document', 'https://page.example/'),
  [], 'a $csp exception also stops CSP injection');

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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/scriptlets.js'), 'utf8'), vmContext, {
    filename: 'scriptlets.js'
  });
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/scriptlets.js'), 'utf8'), vmContext, {
    filename: 'scriptlets.js'
  });
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/scriptlets.js'), 'utf8'), vmContext, {
    filename: 'scriptlets.js'
  });
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/scriptlets.js'), 'utf8'), vmContext, {
    filename: 'scriptlets.js'
  });
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
  alias => RewriteResources.hasAlias(alias));
rewriteEngine.load([
  '||tracker.example^$rewrite=blank-js',
  '||cdn.example^$script,rewrite=blank-image',
  '||promo.example^$rewrite=blank-json',
  '@@||promo.example^$script',
  '||doc.example^$document,rewrite=blank-js',
  '||evil.example^$rewrite=alert(1)',
  '||rule.example^$rewrite-rule=blank-js'
].join('\n'));
assert.strictEqual(rewriteEngine.counts.rewrite, 4, 'valid $rewrite rules are counted');
assert.strictEqual(rewriteEngine.rejectedRewrite.length, 1,
  'an alias that is not curated is rejected');
assert.ok(/^unknown rewrite alias/.test(rewriteEngine.rejectedRewrite[0].reason),
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
const ignoredOption = rewriteEngine.matchRequest(
  'https://rule.example/a.js', 'script', 'https://page.example/');
assert.strictEqual(ignoredOption.blocked, true, 'unknown $rewrite-rule is ignored like other options');
assert.strictEqual(ignoredOption.rewrite, null, 'unknown $rewrite-rule never rewrites');

const noRewriteEngine = new FilterEngine();
noRewriteEngine.load('||unavailable.example^$rewrite=blank-js');
assert.strictEqual(noRewriteEngine.rejectedRewrite.length, 1,
  'rewrite rules are rejected without a curated registry');

assert.strictEqual(RewriteResources.resolve('BLANK-JS').type,
  'application/javascript; charset=utf-8', 'aliases are normalized without trusting filter casing');
assert.strictEqual(RewriteResources.resolve('https://evil.example/x'), null,
  'filter text cannot supply its own response body');
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
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/filter-engine.js'), 'utf8'), ctx0);
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
    runtime: { getURL: p => 'moz-extension://test/' + p, onMessage: { addListener: () => {} } },
    storage: { local: memoryStorage({}) },
    browserAction: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} },
    webRequest: { onBeforeRequest: { addListener: () => {} }, onHeadersReceived: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} }, onBeforeRedirect: { addListener: () => {} }, filterResponseData: () => ({ ondata() {}, onstop() {}, onerror() {}, write() {}, close() {}, disconnect() {} }) },
    webNavigation: { onCreatedNavigationTarget: { addListener: () => {} }, onCommitted: { addListener: () => {} }, onReferenceFragmentUpdated: { addListener: () => {} }, onHistoryStateUpdated: { addListener: () => {} } },
    tabs: { query: async () => [], onUpdated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, sendMessage: async () => {}, remove: async () => {} },
    alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, get: async () => null, create: async () => {} },
    contentScripts: { register: async () => ({ unregister: async () => {} }) },
    publicSuffix: { getDomain: host => host.split('.').slice(-2).join('.') }
  };
  ['lib/store.js', 'lib/filter-engine.js', 'lib/document-scope.js', 'lib/redirect-resources.js', 'lib/remote-lists.js', 'lib/csp-resources.js', 'lib/scriptlets.js', 'lib/rewrite-resources.js', 'lib/compile-cache.js', 'lib/compiler.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  init\(\);\n}\)\(\);\s*$/, '  globalThis.__wildfireTest = { loadFilters, engine, getState: () => state, setState: p => { state = Object.assign({}, state, p); }, compiler }; init(); })();');
  const origDebug2 = console.debug;
  console.debug = () => {};
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });
  await new Promise(resolve => setTimeout(resolve, 30));
  console.debug = origDebug2;
  const api = ctx.__wildfireTest;

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
      onBeforeRequest: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} },
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
    'lib/store.js', 'lib/filter-engine.js', 'lib/document-scope.js', 'lib/redirect-resources.js',
    'lib/remote-lists.js', 'lib/csp-resources.js', 'lib/scriptlets.js', 'lib/rewrite-resources.js',
    'lib/compile-cache.js', 'lib/compiler.js'
  ].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8')
    .replace(/  init\(\);\n}\)\(\);\s*$/, '  globalThis.__wildfireTest = { loadFilters, engine, getState: () => state, setState: p => { state = Object.assign({}, state, p); }, remoteLists, compiler, compileCache }; init(); })();');
  vm.runInContext(bgSource, ctx, { filename: 'background.js' });

  // wait for init/load
  await new Promise(resolve => setTimeout(resolve, 20));
  const api = ctx.__wildfireTest;
  assert.ok(api, 'background test hook exposed');

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
    });

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
  assert.strictEqual(compiled.v, FilterEngine.COMPILED_VERSION, 'compiled v2');
  assert.strictEqual(compiled.cap, ir.getCapabilities(), 'compiled cap matches');
  assert.ok(Array.isArray(compiled.d), 'compiled diagnostics');
  const ir2 = new FilterEngine(null, () => 'script-src \'none\'', { validate: () => null }, () => true);
  assert.strictEqual(ir2.loadCompiled(compiled), true, 'load compiled v2');
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

Promise.resolve()
  .then(() => testPhase0Foundation())
  .then(() => testPhase1AAliases())
  .then(() => testPhase1BBadfilter())
  .then(() => testCompileCacheAndCompiler())
  .then(() => testIncrementalRemoteCompileSemantics())
  .then(() => testBackgroundLoadFiltersIntegration())
  .then(() => testStaleGenerationWorkerHang())
  .then(() => testRemoteLists())
  .then(() => console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

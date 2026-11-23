/* Dependency-free unit tests for the filter engine. Run with: npm test */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const context = vm.createContext({ console, URL, CSS: { supports: () => true } });
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
const { FilterEngine, mapResourceType, DocumentScope, RedirectResources, WildFireProcedural } = context;

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

function stubNode(selector, text, children) {
  const list = children || [];
  return {
    selector,
    textContent: text || '',
    querySelector: query => (query === '*' ? list[0] || null : list.find(item => item.selector === query) || null),
    querySelectorAll: query => (query === '*' ? list : list.filter(item => item.selector === query))
  };
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

engine.load(fs.readFileSync(path.join(ROOT, 'filters/default.txt'), 'utf8'));
assert.ok(engine.counts.network > 50, 'bundled list should contain network rules');
assert.ok(engine.counts.cosmetic > 5, 'bundled list should contain cosmetic rules');
assert.strictEqual(blocked('https://securepubads.g.doubleclick.net/gampad/ads', 'script'), true,
  'bundled list blocks ads');

console.log('WildFire tests passed (' + engine.counts.network + ' network rules loaded from bundled list).');

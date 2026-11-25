/* WildFire compatibility corpus: WildFire-authored rule-family matrix.
 * No upstream filter text, resource bytes, or generated list data is stored here.
 * Every rule is a synthetic behavioral probe used by tools/test.js. */
'use strict';

const repeatText = (prefix, unit, count, suffix) => prefix + unit.repeat(count) + suffix;

const request = (url, type, documentUrl, blocked, extra) =>
  Object.assign({ kind: 'network', url, type, documentUrl, blocked }, extra || {});
const popup = (url, sourceUrl, blocked) =>
  ({ kind: 'popup', url, sourceUrl, blocked });
const cosmeticCheck = (host, includes, excludes) =>
  ({ kind: 'cosmetic', host, includes: includes || [], excludes: excludes || [] });
const proceduralCheck = (host, count) => ({ kind: 'procedural', host, count });
const scriptletCheck = (count, alias, isException) =>
  ({ kind: 'scriptlet', count, alias: alias || '', isException: Boolean(isException) });
const capabilityCheck = (name, reason) =>
  ({ kind: 'capability', name, reason: reason || 'capability enabled' });
const cspCheck = (url, type, documentUrl, includes, exception) =>
  ({ kind: 'csp', url, type, documentUrl, includes: includes || [], exception: Boolean(exception) });
const removeparamCheck = (url, type, documentUrl, values, exception) =>
  ({ kind: 'removeparam', url, type, documentUrl, values: values || [], exception: Boolean(exception) });
const removeheaderCheck = (url, type, documentUrl, names, phase, exception) =>
  ({ kind: 'removeheader', url, type, documentUrl, names: names || [], phase: phase || 'request', exception: Boolean(exception) });
const htmlCheck = (url, type, documentUrl, headers, selectors, exception) =>
  ({ kind: 'html', url, type, documentUrl, headers: headers || [],
    selectors: selectors || [], exception: Boolean(exception) });
const dynamicCheck = (rule, source, destination, type, action) =>
  ({ kind: 'dynamic', rule, source, destination, type, action });

const accepted = (id, family, rule, decision, inspectorReason, checks, engineOptions) => ({
  id, family, rule, outcome: 'accepted', decision, inspectorReason,
  checks: Array.isArray(checks) ? checks : [checks],
  engineOptions: engineOptions || {}
});
const rejected = (id, family, rule, rejection, reason, engineOptions) => ({
  id, family, rule, outcome: 'rejected', decision: 'rejected',
  rejection, reason, inspectorReason: reason,
  checks: [], engineOptions: engineOptions || {}
});

const families = [
  'network.comment', 'network.plain', 'network.wildcard', 'network.host',
  'network.anchors', 'network.regex', 'network.exception', 'network.types',
  'network.party', 'network.domain', 'network.to', 'network.denyallow',
  'network.top', 'network.strict-party', 'network.document', 'network.popup',
  'network.important', 'network.badfilter', 'network.redirect', 'network.rewrite',
  'network.csp', 'network.removeparam', 'network.removeheader',
  'network.hide-modifier', 'cname.scope', 'cosmetic.plain', 'cosmetic.scope',
  'cosmetic.exception', 'cosmetic.abp', 'procedural.text', 'procedural.path', 'procedural.has',
  'procedural.ancestor', 'procedural.attr', 'procedural.css', 'procedural.xpath',
  'procedural.not', 'procedural.media', 'procedural.action', 'procedural.prop',
  'procedural.others', 'procedural.watch', 'scriptlet.ubo', 'scriptlet.adguard',
  'scriptlet.exception', 'scriptlet.scope', 'html.selector', 'html.responseheader',
  'dynamic.rule'
].map(id => ({ id }));

const rejectionClasses = [
  { id: 'network.domain.invalid', match: 'invalid domain option:' },
  { id: 'network.to.invalid', match: 'invalid to option:' },
  { id: 'network.denyallow.invalid', match: 'invalid denyallow option:' },
  { id: 'network.denyallow.domain', match: 'denyallow requires domain option' },
  { id: 'network.top.invalid', match: 'invalid top option:' },
  { id: 'network.host.regex', match: 'invalid host regex' },
  { id: 'network.hide-modifier.non-exception', match: 'hide modifiers require an exception' },
  { id: 'network.hide-modifier.mixed', match: 'hide modifiers cannot be combined with network actions' },
  { id: 'network.csp.bare', match: 'bare csp requires an exception' },
  { id: 'network.rewrite.mixed', match: 'rewrite and rewrite-rule cannot be combined' },
  { id: 'network.rewrite.non-regex', match: 'rewrite-rule requires a regex filter' },
  { id: 'network.removeparam.invalid', match: 'invalid removeparam value' },
  { id: 'network.removeparam.regex', match: 'invalid removeparam regex:' },
  { id: 'network.removeheader.invalid', match: 'invalid removeheader value' },
  { id: 'regex.invalid', match: 'invalid regex:' },
  { id: 'regex.flag', match: 'unsupported regex flag' },
  { id: 'regex.length', match: 'regex pattern too long' },
  { id: 'regex.groups', match: 'too many groups' },
  { id: 'regex.quantifiers', match: 'too many quantifiers' },
  { id: 'regex.nested', match: 'nested or alternated quantifier' },
  { id: 'regex.backreference', match: 'backreferences are not allowed' },
  { id: 'cosmetic.abp-action', match: 'unsupported ABP action selector' },
  { id: 'cosmetic.abp-procedural', match: 'unsupported ABP procedural selector' },
  { id: 'cosmetic.abp-missing-operator', match: 'ABP procedural selector missing procedural operator' },
  { id: 'cosmetic.empty-negated', match: 'empty negated cosmetic domain' },
  { id: 'cosmetic.domain-invalid', match: 'invalid domain:' },
  { id: 'cosmetic.generic-procedural', match: 'generic procedural rules need domain scope' },
  { id: 'html.selector.generic', match: 'HTML filters need domain scope' },
  { id: 'html.selector.unsafe', match: 'unsafe HTML filter selector' },
  { id: 'html.selector.length', match: 'HTML filter selector too long' },
  { id: 'html.selector.invalid', match: 'invalid HTML filter selector' },
  { id: 'html.responseheader.declaration', match: 'invalid responseheader declaration' },
  { id: 'html.responseheader.unsupported', match: 'unsupported response header:' },
  { id: 'html.responseheader.generic', match: 'responseheader filters need domain scope' },
  { id: 'html.specific-generic', match: 'specific-generic HTML filters are unsupported' },
  { id: 'procedural.unbalanced', match: 'unbalanced procedural selector' },
  { id: 'procedural.has-empty', match: 'empty :has argument' },
  { id: 'procedural.has-text-empty', match: 'empty :has-text argument' },
  { id: 'procedural.regex', match: 'invalid :matches-path argument' },
  { id: 'procedural.depth', match: 'procedural selector too deep' },
  { id: 'procedural.nth', match: 'invalid :nth-ancestor argument' },
  { id: 'procedural.upward', match: 'invalid :upward argument' },
  { id: 'procedural.min-text', match: 'invalid :min-text-length argument' },
  { id: 'procedural.attr', match: 'invalid :matches-attr argument' },
  { id: 'procedural.css', match: 'invalid :matches-css regex' },
  { id: 'procedural.css-invalid', match: 'invalid :matches-css argument' },
  { id: 'procedural.xpath', match: ':xpath expression too long' },
  { id: 'procedural.xpath-empty', match: 'empty :xpath argument' },
  { id: 'procedural.xpath-unbalanced', match: 'unbalanced :xpath argument' },
  { id: 'procedural.media', match: 'empty :matches-media argument' },
  { id: 'procedural.media-invalid', match: 'invalid :matches-media argument' },
  { id: 'procedural.not-inner', match: 'empty :has-text argument' },
  { id: 'procedural.style-unsafe', match: 'unsafe :style value' },
  { id: 'procedural.action-tail', match: 'action operator must be trailing on the root selector' },
  { id: 'procedural.prop-path', match: 'invalid :matches-prop path' },
  { id: 'procedural.others-arg', match: 'unexpected :others argument' },
  { id: 'procedural.watch-name', match: 'invalid :watch-attr argument' },
  { id: 'scriptlet.trusted', match: 'trusted scriptlets require a trusted source' },
  { id: 'scriptlet.unknown', match: 'unknown scriptlet alias:' },
  { id: 'scriptlet.arity', match: 'wrong argument count' },
  { id: 'scriptlet.property', match: 'invalid scriptlet property' },
  { id: 'scriptlet.regex-nested', match: 'nested or alternated regex quantifier' },
  { id: 'scriptlet.regex-flag', match: 'unsupported scriptlet regex flag' },
  { id: 'scriptlet.unterminated-rule', match: 'unterminated +js rule' },
  { id: 'scriptlet.unterminated-arg', match: 'unterminated +js argument' },
  { id: 'scriptlet.unbalanced', match: 'unbalanced +js argument' },
  { id: 'scriptlet.empty-alias', match: 'empty scriptlet alias' },
  { id: 'scriptlet.code', match: 'unsupported constant value' },
  { id: 'adguard.debug', match: 'debug scriptlets are not allowed in production filters' },
  { id: 'adguard.alias-unknown', match: 'unknown AdGuard scriptlet alias:' },
  { id: 'adguard.unterminated', match: 'unterminated AdGuard scriptlet rule' },
  { id: 'adguard.empty-alias', match: 'empty AdGuard scriptlet alias' },
  { id: 'csp.alias', match: 'unknown CSP alias:' },
  { id: 'rewrite.alias', match: 'unknown rewrite alias:' },
  { id: 'registry.rewrite', match: 'unknown rewrite alias:' },
  { id: 'registry.scriptlet', match: 'scriptlet registry unavailable' }
];

const longRegex = repeatText('/', 'a', 513, '/');
const longHtmlSelector = 'html.example##^.' + 'x'.repeat(257);
const manyGroups = '/' + Array.from({ length: 17 }, () => '(a)').join('') + '/';
const manyQuantifiers = '/' + Array.from({ length: 17 }, () => 'a+').join('') + '/';
const deepHas = 'example.com##.x' + ':has(.y'.repeat(12) + ')'.repeat(12);

const rules = [
  accepted('network.comment.accepted', 'network.comment', '! WildFire-authored probe',
    'ignored', 'comment ignored', { kind: 'ignored' }),
  accepted('network.plain.accepted', 'network.plain', 'example.com/banner.gif',
    'blocked', 'network rule', request('https://example.com/banner.gif', 'image', 'https://site.test/', true)),
  accepted('network.wildcard.accepted', 'network.wildcard', 'example.com*promo.gif',
    'blocked', 'network rule', request('https://example.com/a/promo.gif', 'image', 'https://site.test/', true)),
  accepted('network.host.accepted', 'network.host', '||ads.example^',
    'blocked', 'network rule', request('https://cdn.ads.example/a.js', 'script', 'https://site.test/', true)),
  accepted('network.hosts.accepted', 'network.host', 'hosts.example',
    'blocked', 'network rule', [
      request('https://hosts.example/a.js', 'script', 'https://site.test/', true),
      request('https://cdn.hosts.example/a.js', 'script', 'https://site.test/', true),
      request('https://nothosts.example/a.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' }),
      request('https://other.test/?q=hosts.example', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.host.entity.accepted', 'network.host', '||entity.example.*^',
    'blocked', 'network rule', [
      request('https://ads.entity.example.com/a.js', 'script', 'https://site.test/', true),
      request('https://entity.test/a.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.host.regex.accepted', 'network.host', '||/ads[0-9]+\\.regex\\.test/^',
    'blocked', 'network rule', [
      request('https://ads12.regex.test/a.js', 'script', 'https://site.test/', true),
      request('https://ads.regex.test/a.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.anchors.accepted', 'network.anchors', '|https://exact.example/ad.js|',
    'blocked', 'network rule', [
      request('https://exact.example/ad.js', 'script', 'https://site.test/', true),
      request('https://exact.example/ad.js?x=1', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.regex.accepted', 'network.regex', '/ads\\.example\\/promo/iu',
    'blocked', 'network rule', request('https://ads.example/PROMO', 'script', 'https://site.test/', true)),
  accepted('network.exception.accepted', 'network.exception', ['||ads.example^', '@@||ads.example/keep.js^'],
    'blocked', 'network rule', [
      request('https://ads.example/keep.js', 'script', 'https://site.test/', false,
        { decision: 'exception', inspectorReason: 'exception wins' }),
      request('https://ads.example/drop.js', 'script', 'https://site.test/', true)
    ]),
  accepted('network.types.accepted', 'network.types', '||asset.example^$image,~font',
    'blocked', 'network rule', [
      request('https://asset.example/a.png', 'image', 'https://site.test/', true),
      request('https://asset.example/a.woff', 'font', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.all.accepted', 'network.types', '||all.example^$~script,all',
    'blocked', 'network rule', [
      request('https://all.example/a.js', 'script', 'https://site.test/', true),
      request('https://all.example/page', 'document', 'https://site.test/', true,
        { decision: 'blocked', inspectorReason: '$document' }),
      Object.assign(
        popup('https://all.example/pop', 'https://site.test/', true),
        { decision: 'blocked', inspectorReason: '$popup' }
      )
    ]),
  accepted('network.party.accepted', 'network.party', ['||third.example^$3p', '||first.example^$1p'],
    'blocked', 'network rule', [
      request('https://third.example/a.js', 'script', 'https://site.test/', true),
      request('https://third.example/a.js', 'script', 'https://third.example/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' }),
      request('https://first.example/a.js', 'script', 'https://first.example/', true)
    ]),
  accepted('network.not-party.accepted', 'network.party', '||same.example^$~third-party',
    'blocked', 'network rule', [
      request('https://same.example/a.js', 'script', 'https://same.example/', true),
      request('https://same.example/a.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.domain.accepted', 'network.domain', '||scope.example^$domain=site.test|~skip.site.test',
    'blocked', 'network rule', [
      request('https://scope.example/a.js', 'script', 'https://site.test/', true),
      request('https://scope.example/a.js', 'script', 'https://skip.site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.domain-wildcard.accepted', 'network.domain', '||wild.example^$domain=site.*|~skip.site.*',
    'blocked', 'network rule', [
      request('https://wild.example/a.js', 'script', 'https://site.test/', true),
      request('https://wild.example/a.js', 'script', 'https://skip.site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.domain-from.accepted', 'network.domain', '||from.example^$from=site.test',
    'blocked', 'network rule', request('https://from.example/a.js', 'script', 'https://site.test/', true)),
  accepted('network.domain-regex.accepted', 'network.domain', '||regex.example^$domain=/^cdn[0-9]+\\.scope\\.test$/',
    'blocked', 'network rule', [
      request('https://regex.example/a.js', 'script', 'https://cdn1.scope.test/', true),
      request('https://regex.example/a.js', 'script', 'https://other.scope.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.to.accepted', 'network.to', 'ad.js*$script,to=site.test',
    'blocked', 'network rule', [
      request('https://site.test/ad.js', 'script', 'https://site.test/', true),
      request('https://other.test/ad.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.to-entity.accepted', 'network.to', 'ad.js*$script,to=ads.*',
    'blocked', 'network rule', [
      request('https://ads.example/ad.js', 'script', 'https://site.test/', true),
      request('https://site.test/ad.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.to-regex.accepted', 'network.to', 'ad.js*$script,to=/^ads[0-9]+\\.scope\\.test$/',
    'blocked', 'network rule', [
      request('https://ads12.scope.test/ad.js', 'script', 'https://site.test/', true),
      request('https://other.scope.test/ad.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.to-negated.accepted', 'network.to', 'ad.js*$script,to=~blocked.test',
    'blocked', 'network rule', [
      request('https://site.test/ad.js', 'script', 'https://site.test/', true),
      request('https://blocked.test/ad.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.denyallow.accepted', 'network.denyallow',
    'ad.js*$script,domain=site.test,denyallow=skip.site.test',
    'blocked', 'network rule', [
      request('https://site.test/ad.js', 'script', 'https://site.test/', true),
      request('https://skip.site.test/ad.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.top.accepted', 'network.top', '||ads.test^$script,top=site.test',
    'blocked', 'network rule', [
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', true,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['site.test'] } }),
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', false,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['other.test'] },
          decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.top-negated.accepted', 'network.top', '||ads.test^$script,~top=skip.test',
    'blocked', 'network rule', [
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', true,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['site.test'] } }),
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', false,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['skip.test'] },
          decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.top-regex.accepted', 'network.top', '||ads.test^$script,top=/^site[0-9]+\\.test$/',
    'blocked', 'network rule', [
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', true,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['site12.test'] } }),
      request('https://ads.test/a.js', 'script', 'https://embed.other.test/', false,
        { hosts: { target: ['ads.test'], document: ['embed.other.test'], top: ['site.test'] },
          decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.strict-party.accepted', 'network.strict-party',
    ['||strict.example^$strict1p', '||cross.example^$strict3p'],
    'blocked', 'network rule', [
      request('https://strict.example/a.js', 'script', 'https://strict.example/', true),
      request('https://strict.example/a.js', 'script', 'https://sub.strict.example/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' }),
      request('https://a.cross.example/a.js', 'script', 'https://b.cross.example/', true),
      request('https://a.cross.example/a.js', 'script', 'https://a.cross.example/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' })
    ]),
  accepted('network.document.accepted', 'network.document', '||nav.example^$document',
    'blocked', '$document', request('https://nav.example/page', 'document', 'https://site.test/', true)),
  accepted('network.popup.accepted', 'network.popup', '||popup.example^$popup',
    'blocked', '$popup', popup('https://popup.example/page', 'https://site.test/', true)),
  accepted('network.important.accepted', 'network.important', ['@@||important.example^$script', '||important.example^$script,important'],
    'blocked', 'network rule', request('https://important.example/a.js', 'script', 'https://site.test/', true, { important: true })),
  accepted('network.badfilter.accepted', 'network.badfilter', ['||gone.example^', '||gone.example^$badfilter', '||keep.example^'],
    'blocked', 'network rule', [
      request('https://gone.example/a.js', 'script', 'https://site.test/', false,
        { decision: 'allowed', inspectorReason: 'no matching rule' }),
      request('https://keep.example/a.js', 'script', 'https://site.test/', true)
    ]),
  accepted('network.redirect.accepted', 'network.redirect', '||redirect.example^$redirect=noopjs',
    'redirected', 'noopjs', request('https://redirect.example/a.js', 'script', 'https://site.test/', true, { redirectAlias: 'noopjs' })),
  accepted('network.redirect-fallback.accepted', 'network.redirect', '||redirect.example^$redirect=not-curated',
    'blocked', 'unknown redirect alias', request('https://redirect.example/b.js', 'script', 'https://site.test/', true, { redirectAlias: 'not-curated', redirectFallback: true })),
  accepted('network.redirect-rule.accepted', 'network.redirect', '/promo-(\\d+)\\.js/$redirect-rule=1x1.gif',
    'redirected', '1x1.gif', request('https://asset.example/promo-7.js', 'script', 'https://site.test/', true, { redirectAlias: '1x1.gif' })),
  accepted('network.rewrite.accepted', 'network.rewrite', '||fixed.example^$rewrite=blank-js',
    'rewritten', 'blank-js', request('https://fixed.example/a.js', 'script', 'https://site.test/', true, { rewriteAlias: 'blank-js' })),
  accepted('network.rewrite-rule.accepted', 'network.rewrite', '/tag-([a-z]+)\\.js/$rewrite-rule=tagged-js',
    'rewritten', 'tagged-js', request('https://asset.example/tag-promo.js', 'script', 'https://site.test/', true, { rewriteAlias: 'tagged-js' })),
  accepted('network.csp.accepted', 'network.csp', ['||frame.example^$csp=no-frame', '@@||allow.example^$csp'],
    'csp', 'extra enforcing directives', [
      cspCheck('https://frame.example/embed', 'subdocument', 'https://site.test/', ["frame-src 'none'"], false),
      Object.assign(
        cspCheck('https://allow.example/embed', 'subdocument', 'https://site.test/', [], true),
        { decision: 'exception', inspectorReason: 'exception wins' }
      )
    ]),
  accepted('network.removeparam.accepted', 'network.removeparam', ['||track.example^$removeparam=utm_source', '@@||track.example/keep$removeparam=utm_source'],
    'removeparam', 'utm_source', [
      removeparamCheck('https://track.example/p?utm_source=x', 'image', 'https://site.test/', ['utm_source'], false),
      Object.assign(
        removeparamCheck('https://track.example/keep?utm_source=x', 'image', 'https://site.test/', [], true),
        { decision: 'exception', inspectorReason: 'exception wins' }
      )
    ]),
  accepted('network.removeparam-regex.accepted', 'network.removeparam', '||regex-track.example^$removeparam=/^x=/',
    'removeparam', '/^x=/', removeparamCheck('https://regex-track.example/r?x=1', 'image', 'https://site.test/', ['/^x=/'])),
  accepted('network.removeheader.accepted', 'network.removeheader', '||api.example^$removeheader=request:x-track',
    'removeheader-request', 'request headers', removeheaderCheck('https://api.example/data', 'script', 'https://site.test/', ['request:x-track'], 'request')),
  accepted('network.removeheader-response.accepted', 'network.removeheader', '||api.example^$removeheader=response:x-track',
    'removeheader-response', 'response headers', removeheaderCheck('https://api.example/data', 'script', 'https://site.test/', ['response:x-track'], 'response')),
  accepted('network.hide-modifier.accepted', 'network.hide-modifier', '@@||example.com^$generichide',
    'accepted', 'hide exception stored', capabilityCheck('GENERICHIDE', 'hide exception stored')),
  accepted('network.elemhide.accepted', 'network.hide-modifier', '@@||hide.example^$elemhide',
    'accepted', 'hide exception stored', capabilityCheck('ELEMHIDE', 'hide exception stored')),
  accepted('network.specifichide.accepted', 'network.hide-modifier', '@@||hide.example^$specifichide',
    'accepted', 'hide exception stored', capabilityCheck('SPECIFICHIDE', 'hide exception stored')),
  accepted('cname.scope.accepted', 'cname.scope', '||canonical.example^$script',
    'blocked', 'network rule', request('https://alias.example/a.js', 'script', 'https://site.test/', true, {
      hosts: { target: ['alias.example', 'canonical.example'], document: ['site.test'] }
    })),
  accepted('cosmetic.plain.accepted', 'cosmetic.plain', 'example.com##.promo',
    'cosmetic', 'cosmetic selector', cosmeticCheck('example.com', ['.promo'])),
  accepted('cosmetic.scope.accepted', 'cosmetic.scope', ['example.com,~sub.example.com##.scoped', '##.everywhere'],
    'cosmetic', 'cosmetic selector', [
      cosmeticCheck('example.com', ['.scoped', '.everywhere']),
      cosmeticCheck('sub.example.com', ['.everywhere'], ['.scoped'])
    ]),
  accepted('cosmetic.exception.accepted', 'cosmetic.exception', ['example.com##.gone', 'example.com#@#.gone'],
    'cosmetic', 'cosmetic selector', cosmeticCheck('example.com', [], ['.gone'])),
  accepted('cosmetic.abp.accepted', 'cosmetic.abp', ['example.com#?#div:-abp-has(.ad)', 'example.com#@?#div:-abp-has(.ad)'],
    'procedural', 'procedural selector', proceduralCheck('example.com', 0)),
  accepted('cosmetic.entity.accepted', 'cosmetic.scope', 'example.*##.entity',
    'cosmetic', 'cosmetic selector', cosmeticCheck('shop.example.com', ['.entity'])),
  accepted('cosmetic.regex.accepted', 'cosmetic.scope', '/^ads[0-9]+\\.corpus\\.test$/##.regex',
    'cosmetic', 'cosmetic selector', cosmeticCheck('ads42.corpus.test', ['.regex'])),
  accepted('cosmetic.specific-generic.accepted', 'cosmetic.scope',
    ['##.global', 'example.*##.entity', '*##.surveyor'], 'cosmetic', 'cosmetic selector', [
      cosmeticCheck('shop.example.com', ['.global', '.entity', '.surveyor']),
      cosmeticCheck('unrelated.test', ['.global'], ['.surveyor'])
    ]),
  accepted('procedural.text.accepted', 'procedural.text', [
    'example.com##.ad:has-text("Buy")',
    'example.com##.box:contains(/SALE/i)',
    'example.com##.long:min-text-length(10)'
  ], 'procedural', 'procedural selector', proceduralCheck('example.com', 3)),
  accepted('procedural.path.accepted', 'procedural.path', 'example.com##.promo:matches-path(/deals/)',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.has.accepted', 'procedural.has', 'example.com##.deep:has(.child:has-text("x"))',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.ancestor.accepted', 'procedural.ancestor', [
    'example.com##.a:nth-ancestor(2)',
    'example.com##.b:upward(.wrap)',
    'example.com##.c:upward(2)'
  ], 'procedural', 'procedural selector', proceduralCheck('example.com', 3)),
  accepted('procedural.attr.accepted', 'procedural.attr', [
    'example.com##.a:matches-attr(data-ad)',
    'example.com##.b:matches-attr(data-ad="1")',
    'example.com##.c:matches-attr(data-ad=/^promo/)'
  ], 'procedural', 'procedural selector', proceduralCheck('example.com', 3)),
  accepted('procedural.css.accepted', 'procedural.css', [
    'example.com##.a:matches-css(position: fixed)',
    'example.com##.b:matches-css(color: /red/)',
    'example.com##.c:matches-css-after(content: "x")'
  ], 'procedural', 'procedural selector', proceduralCheck('example.com', 3)),
  accepted('procedural.xpath.accepted', 'procedural.xpath', "example.com##.a:xpath(.//span[@class='ad'])",
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.not.accepted', 'procedural.not', 'example.com##.a:not(:has-text(Ad))',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.media.accepted', 'procedural.media', 'example.com##.a:matches-media((max-width: 900px))',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.action.accepted', 'procedural.action', 'example.com##.banner:remove()',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.prop.accepted', 'procedural.prop', 'example.com##.item:matches-prop(dataset.id="42")',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.others.accepted', 'procedural.others', 'example.com##.keep:others()',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('procedural.watch.accepted', 'procedural.watch', 'example.com##.watch:watch-attr(data-state)',
    'procedural', 'procedural selector', proceduralCheck('example.com', 1)),
  accepted('scriptlet.ubo.accepted', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, 1)',
    'scriptlet', 'scriptlet payload', scriptletCheck(1, 'set-constant')),
  accepted('scriptlet.adguard.accepted', 'scriptlet.adguard', "example.com#%#//scriptlet('set-constant', 'flag', '1')",
    'scriptlet', 'scriptlet payload', scriptletCheck(1, 'set-constant')),
  accepted('scriptlet.exception.accepted', 'scriptlet.exception', ['example.com##+js(set-constant, flag, 1)', 'example.com#@#+js(set, flag, 1)'],
    'scriptlet', 'scriptlet payload', scriptletCheck(2, 'set-constant', true)),
  accepted('scriptlet.adguard-exception.accepted', 'scriptlet.exception', [
    "example.com#%#//scriptlet('set-constant', 'flag', '1')",
    "example.com#@%#//scriptlet('set-constant', 'flag', '1')"
  ], 'scriptlet', 'scriptlet payload', scriptletCheck(2, 'set-constant', true)),
  accepted('scriptlet.entity.accepted', 'scriptlet.scope', 'example.*##+js(set-constant, corpusEntityFlag, 1)',
    'scriptlet', 'scriptlet payload', scriptletCheck(1, 'set-constant')),
  accepted('scriptlet.regex.accepted', 'scriptlet.scope', '/^ads[0-9]+\\.corpus\\.test$/##+js(set-constant, corpusRegexFlag, 1)',
    'scriptlet', 'scriptlet payload', scriptletCheck(1, 'set-constant')),
  accepted('scriptlet.specific-generic.accepted', 'scriptlet.scope',
    ['example.*##+js(set-constant, corpusEntityFlag, 1)', '*##+js(set-constant, corpusGlobalFlag, 1)'],
    'scriptlet', 'scriptlet payload', scriptletCheck(2, 'set-constant')),
  accepted('html.selector.accepted', 'html.selector',
    'example.com##^.promo, div.banner[data-x="1"]', 'html', 'HTML stream selectors',
    htmlCheck('https://example.com/page', 'document', 'https://example.com/page', [], [
      { tag: '', id: [], classes: ['promo'], attr: null },
      { tag: 'div', id: [], classes: ['banner'], attr: { name: 'data-x', value: '1' } }
    ])),
  accepted('html.selector.exception.accepted', 'html.selector',
    ['example.com##^.promo', 'example.com#@^.promo'], 'exception', 'exception wins',
    htmlCheck('https://example.com/page', 'document', 'https://example.com/page', [], [], true)),
  accepted('html.responseheader.accepted', 'html.responseheader',
    'example.com##^responseheader(location)', 'html-responseheader', 'HTML response header action',
    htmlCheck('https://example.com/page', 'document', 'https://example.com/page', ['location'], [])),
  accepted('html.responseheader.exception.accepted', 'html.responseheader',
    ['example.com##^responseheader(location)', 'example.com#@^responseheader(location)'],
    'exception', 'exception wins',
    htmlCheck('https://example.com/page', 'document', 'https://example.com/page', [], [], true)),
  accepted('dynamic.block.accepted', 'dynamic.rule', '* * script block',
    'dynamic', 'block', dynamicCheck('* * script block', '*', '*', 'script', 'block')),
  accepted('dynamic.noop.accepted', 'dynamic.rule', 'example.com ads.test script noop',
    'dynamic', 'noop', dynamicCheck('example.com ads.test script noop', 'example.com', 'ads.test', 'script', 'noop')),
  accepted('dynamic.allow.accepted', 'dynamic.rule', 'example.com * script allow',
    'dynamic', 'allow', dynamicCheck('example.com * script allow', 'example.com', '*', 'script', 'allow')),

  rejected('network.domain.invalid.rejected', 'network.domain', '||bad.example^$domain=bad..example', 'rejectedRegex', 'invalid domain option: bad..example'),
  rejected('network.to.invalid.rejected', 'network.to', '||bad.example^$to=bad..example', 'rejectedRegex', 'invalid to option: bad..example'),
  rejected('network.denyallow.invalid.rejected', 'network.denyallow', '||bad.example^$denyallow=bad..example', 'rejectedRegex', 'invalid denyallow option: bad..example'),
  rejected('network.denyallow.entity.rejected', 'network.denyallow', '||bad.example^$domain=site.test,denyallow=skip.site.*', 'rejectedRegex', 'invalid denyallow option: skip.site.*'),
  rejected('network.denyallow.regex.rejected', 'network.denyallow', '||bad.example^$domain=site.test,denyallow=/skip\\.site\\.test/', 'rejectedRegex', 'invalid denyallow option: /skip\\.site\\.test/'),
  rejected('network.denyallow.negated.rejected', 'network.denyallow', '||bad.example^$domain=site.test,denyallow=~skip.site.test', 'rejectedRegex', 'invalid denyallow option: ~skip.site.test'),
  rejected('network.denyallow.domain.rejected', 'network.denyallow', '||bad.example^$denyallow=skip.site.test', 'rejectedRegex', 'denyallow requires domain option'),
  rejected('network.top.invalid.rejected', 'network.top', '||bad.example^$top=bad..example', 'rejectedRegex', 'invalid top option: bad..example'),
  rejected('network.host.regex.rejected', 'network.host', '||/([a-z]+)+/^', 'rejectedRegex', 'invalid host regex'),
  rejected('network.hide-modifier.non-exception.rejected', 'network.hide-modifier', '||bad.example^$generichide', 'rejectedRegex', 'hide modifiers require an exception'),
  rejected('network.hide-modifier.mixed.rejected', 'network.hide-modifier', '@@||bad.example^$generichide,rewrite=blank-js', 'rejectedRegex', 'hide modifiers cannot be combined with network actions'),
  rejected('network.csp.bare.rejected', 'network.csp', '||bad.example^$csp', 'rejectedRegex', 'bare csp requires an exception'),
  rejected('network.rewrite.mixed.rejected', 'network.rewrite', '||bad.example^$rewrite=blank-js,rewrite-rule=tagged-js', 'rejectedRegex', 'rewrite and rewrite-rule cannot be combined'),
  rejected('network.rewrite.non-regex.rejected', 'network.rewrite', 'example.com*promo$rewrite-rule=tagged-js', 'rejectedRegex', 'rewrite-rule requires a regex filter'),
  rejected('network.removeparam.invalid.rejected', 'network.removeparam', '||bad.example^$removeparam=\u0000', 'rejectedRegex', 'invalid removeparam value'),
  rejected('network.removeparam.regex.rejected', 'network.removeparam', '||bad.example^$removeparam=/(a+)+/', 'rejectedRegex', 'invalid removeparam regex: nested or alternated quantifier'),
  rejected('network.removeheader.invalid.rejected', 'network.removeheader', '||bad.example^$removeheader=request:Bad Header', 'rejectedRegex', 'invalid removeheader value'),
  rejected('regex.invalid.rejected', 'network.regex', '/bad(/', 'rejectedRegex', 'invalid regex: '),
  rejected('regex.flag.rejected', 'network.regex', '/x/g', 'rejectedRegex', 'unsupported regex flag'),
  rejected('regex.length.rejected', 'network.regex', longRegex, 'rejectedRegex', 'regex pattern too long'),
  rejected('regex.groups.rejected', 'network.regex', manyGroups, 'rejectedRegex', 'too many groups'),
  rejected('regex.quantifiers.rejected', 'network.regex', manyQuantifiers, 'rejectedRegex', 'too many quantifiers'),
  rejected('regex.nested.rejected', 'network.regex', '/(a+)+$/', 'rejectedRegex', 'nested or alternated quantifier'),
  rejected('regex.backreference.rejected', 'network.regex', '/(a)\\1/', 'rejectedRegex', 'backreferences are not allowed'),
  rejected('cosmetic.abp-action.rejected', 'cosmetic.abp', 'example.com#?#div:-abp-remove()', 'rejectedCosmetic', 'unsupported ABP action selector'),
  rejected('cosmetic.abp-procedural.rejected', 'cosmetic.abp', 'example.com#?#div:-abp-properties(color: red)', 'rejectedCosmetic', 'unsupported ABP procedural selector'),
  rejected('cosmetic.abp-missing-operator.rejected', 'cosmetic.abp', 'example.com#?#div', 'rejectedCosmetic', 'ABP procedural selector missing procedural operator'),
  rejected('cosmetic.empty-negated.rejected', 'cosmetic.scope', '~,example.com##.ad', 'rejectedCosmetic', 'empty negated cosmetic domain'),
  rejected('cosmetic.generic-procedural.rejected', 'cosmetic.scope', '##.ad:has-text("x")', 'rejectedCosmetic', 'generic procedural rules need domain scope'),
  rejected('cosmetic.domain-invalid.rejected', 'cosmetic.scope', 'bad..corpus##.ad', 'rejectedCosmetic', 'invalid domain: bad..corpus'),
  rejected('procedural.unbalanced.rejected', 'procedural.text', 'example.com##.bad:has-text("unclosed', 'rejectedCosmetic', 'unbalanced procedural selector'),
  rejected('procedural.has-empty.rejected', 'procedural.has', 'example.com##.bad:has()', 'rejectedCosmetic', 'empty :has argument'),
  rejected('procedural.has-text-empty.rejected', 'procedural.text', 'example.com##.bad:has-text()', 'rejectedCosmetic', 'empty :has-text argument'),
  rejected('procedural.regex.rejected', 'procedural.path', 'example.com##.bad:matches-path(/(a+)+/)', 'rejectedCosmetic', 'invalid :matches-path argument'),
  rejected('procedural.depth.rejected', 'procedural.has', deepHas, 'rejectedCosmetic', 'procedural selector too deep'),
  rejected('procedural.nth.rejected', 'procedural.ancestor', 'example.com##.bad:nth-ancestor(99)', 'rejectedCosmetic', 'invalid :nth-ancestor argument'),
  rejected('procedural.upward.rejected', 'procedural.ancestor', 'example.com##.bad:upward(99)', 'rejectedCosmetic', 'invalid :upward argument'),
  rejected('procedural.min-text.rejected', 'procedural.text', 'example.com##.bad:min-text-length(0)', 'rejectedCosmetic', 'invalid :min-text-length argument'),
  rejected('procedural.attr.rejected', 'procedural.attr', 'example.com##.bad:matches-attr()', 'rejectedCosmetic', 'invalid :matches-attr argument'),
  rejected('procedural.css.rejected', 'procedural.css', 'example.com##.bad:matches-css(color: /(a+)+/)', 'rejectedCosmetic', 'invalid :matches-css regex'),
  rejected('procedural.css-invalid.rejected', 'procedural.css', 'example.com##.bad:matches-css(color:)', 'rejectedCosmetic', 'invalid :matches-css argument'),
  rejected('procedural.xpath.rejected', 'procedural.xpath', 'example.com##.bad:xpath(' + './/a'.repeat(130) + ')', 'rejectedCosmetic', ':xpath expression too long'),
  rejected('procedural.xpath-empty.rejected', 'procedural.xpath', 'example.com##.bad:xpath()', 'rejectedCosmetic', 'empty :xpath argument'),
  rejected('procedural.xpath-unbalanced.rejected', 'procedural.xpath', 'example.com##.bad:xpath(.//a[)', 'rejectedCosmetic', 'unbalanced :xpath argument'),
  rejected('procedural.media.rejected', 'procedural.media', 'example.com##.bad:matches-media()', 'rejectedCosmetic', 'empty :matches-media argument'),
  rejected('procedural.media-invalid.rejected', 'procedural.media', 'example.com##.bad:matches-media(\0)', 'rejectedCosmetic', 'invalid :matches-media argument'),
  rejected('procedural.not.rejected', 'procedural.not', 'example.com##.bad:not(:has-text())', 'rejectedCosmetic', 'empty :has-text argument'),
  rejected('procedural.style-unsafe.rejected', 'procedural.action', 'example.com##.bad:style(color:url(evil))', 'rejectedCosmetic', 'unsafe :style value'),
  rejected('procedural.action-tail.rejected', 'procedural.action', 'example.com##.bad:remove():has(.x)', 'rejectedCosmetic', 'action operator must be trailing on the root selector'),
  rejected('procedural.prop-path.rejected', 'procedural.prop', 'example.com##.bad:matches-prop(__proto__.flag)', 'rejectedCosmetic', 'invalid :matches-prop path'),
  rejected('procedural.others-arg.rejected', 'procedural.others', 'example.com##.bad:others(x)', 'rejectedCosmetic', 'unexpected :others argument'),
  rejected('procedural.watch-name.rejected', 'procedural.watch', 'example.com##.bad:watch-attr(bad name)', 'rejectedCosmetic', 'invalid :watch-attr argument'),
  rejected('scriptlet.trusted.rejected', 'scriptlet.ubo', 'example.com##+js(trusted-click-element, body)', 'rejectedScriptlets', 'trusted scriptlets require a trusted source'),
  rejected('scriptlet.unknown.rejected', 'scriptlet.ubo', 'example.com##+js(made-up-alias)', 'rejectedScriptlets', 'unknown scriptlet alias: made-up-alias'),
  rejected('scriptlet.domain-invalid.rejected', 'scriptlet.scope', 'bad..corpus##+js(set-constant, flag, 1)', 'rejectedScriptlets', 'invalid domain: bad..corpus'),
  rejected('scriptlet.arity.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag)', 'rejectedScriptlets', 'wrong argument count'),
  rejected('scriptlet.property.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, __proto__.flag, 1)', 'rejectedScriptlets', 'invalid scriptlet property'),
  rejected('scriptlet.regex-nested.rejected', 'scriptlet.ubo', 'example.com##+js(abort-on-stack-trace, document.cookie, /(a+)+/)', 'rejectedScriptlets', 'nested or alternated regex quantifier'),
  rejected('scriptlet.regex-flag.rejected', 'scriptlet.ubo', 'example.com##+js(abort-on-stack-trace, document.cookie, /x/g)', 'rejectedScriptlets', 'unsupported scriptlet regex flag'),
  rejected('scriptlet.unterminated-rule.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, 1', 'rejectedScriptlets', 'unterminated +js rule'),
  rejected('scriptlet.unterminated-arg.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, "1)', 'rejectedScriptlets', 'unterminated +js argument'),
  rejected('scriptlet.unbalanced.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, 1))', 'rejectedScriptlets', 'unbalanced +js argument'),
  rejected('scriptlet.empty-alias.rejected', 'scriptlet.ubo', 'example.com##+js()', 'rejectedScriptlets', 'empty scriptlet alias'),
  rejected('scriptlet.code.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, alert(1))', 'rejectedScriptlets', 'unsupported constant value'),
  rejected('adguard.debug.rejected', 'scriptlet.adguard', "example.com#%#//scriptlet('debug-current-inline-script', 'x')", 'rejectedScriptlets', 'debug scriptlets are not allowed in production filters'),
  rejected('adguard.alias-unknown.rejected', 'scriptlet.adguard', "example.com#%#//scriptlet('made-up-alias', 'x')", 'rejectedScriptlets', 'unknown AdGuard scriptlet alias: made-up-alias'),
  rejected('adguard.unterminated.rejected', 'scriptlet.adguard', "example.com#%#//scriptlet('set-constant', 'flag', '1'", 'rejectedScriptlets', 'unterminated AdGuard scriptlet rule'),
  rejected('adguard.empty-alias.rejected', 'scriptlet.adguard', 'example.com#%#//scriptlet()', 'rejectedScriptlets', 'empty AdGuard scriptlet alias'),
  rejected('csp.alias.rejected', 'network.csp', '||bad.example^$csp=not-curated', 'rejectedCsp', 'unknown CSP alias: not-curated'),
  rejected('rewrite.alias.rejected', 'network.rewrite', '||bad.example^$rewrite=not-curated', 'rejectedRewrite', 'unknown rewrite alias: not-curated'),
  rejected('registry.rewrite.rejected', 'network.rewrite', '||bad.example^$rewrite=blank-js', 'rejectedRewrite', 'unknown rewrite alias: blank-js', { rewrite: false }),
  rejected('registry.scriptlet.rejected', 'scriptlet.ubo', 'example.com##+js(set-constant, flag, 1)', 'rejectedScriptlets', 'scriptlet registry unavailable', { scriptlets: false }),
  rejected('html.selector.generic.rejected', 'html.selector', '##^.ad', 'rejectedCosmetic', 'HTML filters need domain scope'),
  rejected('html.selector.unsafe.rejected', 'html.selector', 'example.com##^script', 'rejectedCosmetic', 'unsafe HTML filter selector'),
  rejected('html.selector.length.rejected', 'html.selector', longHtmlSelector, 'rejectedCosmetic', 'HTML filter selector too long'),
  rejected('html.selector.invalid.rejected', 'html.selector', 'example.com##^.a,,.b', 'rejectedCosmetic', 'invalid HTML filter selector'),
  rejected('html.responseheader.declaration.rejected', 'html.responseheader', 'example.com##^responseheader(bad name)', 'rejectedCosmetic', 'invalid responseheader declaration'),
  rejected('html.responseheader.unsupported.rejected', 'html.responseheader', 'example.com##^responseheader(x-frame-options)', 'rejectedCosmetic', 'unsupported response header: x-frame-options'),
  rejected('html.responseheader.generic.rejected', 'html.responseheader', '##^responseheader(location)', 'rejectedCosmetic', 'responseheader filters need domain scope'),
  rejected('html.specific-generic.rejected', 'html.selector', '*##^.ad', 'rejectedCosmetic', 'specific-generic HTML filters are unsupported')
];

const smokeScenarios = [
  { id: 'network-core', capability: 'NETWORK', ruleIds: ['network.host.accepted', 'network.plain.accepted', 'network.types.accepted'] },
  { id: 'network-exception', capability: 'EXCEPTION', ruleIds: ['network.exception.accepted'] },
  { id: 'network-important', capability: 'IMPORTANT', ruleIds: ['network.important.accepted'] },
  { id: 'network-redirect', capability: 'REDIRECT', ruleIds: ['network.redirect.accepted', 'network.redirect-rule.accepted'] },
  { id: 'network-rewrite', capability: 'REWRITE', ruleIds: ['network.rewrite.accepted', 'network.rewrite-rule.accepted'] },
  { id: 'network-csp', capability: 'CSP', ruleIds: ['network.csp.accepted'] },
  { id: 'network-popup', capability: 'POPUP', ruleIds: ['network.popup.accepted', 'network.all.accepted'] },
  { id: 'network-document', capability: 'DOCUMENT', ruleIds: ['network.document.accepted', 'network.all.accepted'] },
  { id: 'network-party', capability: 'THIRD_PARTY', ruleIds: ['network.party.accepted', 'network.not-party.accepted'] },
  { id: 'network-domain', capability: 'DOMAIN', ruleIds: ['network.domain.accepted', 'network.domain-wildcard.accepted', 'network.domain-from.accepted', 'cname.scope.accepted'] },
  { id: 'network-regex', capability: 'REGEX', ruleIds: ['network.regex.accepted', 'network.redirect-rule.accepted', 'network.rewrite-rule.accepted'] },
  { id: 'hide-generichide', capability: 'GENERICHIDE', ruleIds: ['network.hide-modifier.accepted'] },
  { id: 'hide-elemhide', capability: 'ELEMHIDE', ruleIds: ['network.elemhide.accepted'] },
  { id: 'hide-specifichide', capability: 'SPECIFICHIDE', ruleIds: ['network.specifichide.accepted'] },
  { id: 'network-badfilter', capability: 'BADFILTER', ruleIds: ['network.badfilter.accepted'] },
  { id: 'network-removeparam', capability: 'REMOVEPARAM', ruleIds: ['network.removeparam.accepted', 'network.removeparam-regex.accepted'] },
  { id: 'network-removeheader', capability: 'REMOVEHEADER', ruleIds: ['network.removeheader.accepted', 'network.removeheader-response.accepted'] },
  { id: 'cosmetic-core', capability: 'COSMETIC', ruleIds: ['cosmetic.plain.accepted', 'cosmetic.scope.accepted', 'cosmetic.exception.accepted', 'cosmetic.abp.accepted', 'cosmetic.entity.accepted', 'cosmetic.regex.accepted', 'cosmetic.specific-generic.accepted'] },
  { id: 'procedural-core', capability: 'PROCEDURAL', ruleIds: ['procedural.text.accepted', 'procedural.path.accepted', 'procedural.has.accepted', 'procedural.ancestor.accepted', 'procedural.attr.accepted', 'procedural.css.accepted', 'procedural.xpath.accepted', 'procedural.not.accepted', 'procedural.media.accepted', 'procedural.action.accepted', 'procedural.prop.accepted', 'procedural.others.accepted', 'procedural.watch.accepted'] },
  { id: 'scriptlet-core', capability: 'SCRIPTLET', ruleIds: ['scriptlet.ubo.accepted', 'scriptlet.adguard.accepted', 'scriptlet.exception.accepted', 'scriptlet.adguard-exception.accepted', 'scriptlet.entity.accepted', 'scriptlet.regex.accepted', 'scriptlet.specific-generic.accepted'] },
  { id: 'html-stream', capability: 'HTML', ruleIds: ['html.selector.accepted'] },
  { id: 'html-response-header', capability: 'RESPONSE_HEADER', ruleIds: ['html.responseheader.accepted'] }
];

module.exports = {
  version: 1,
  provenance: {
    owner: 'WildFire',
    generated: false,
    description: 'Synthetic WildFire-authored behavioral probes; no upstream filter text or resources.',
    sources: []
  },
  families,
  rejectionClasses,
  rules,
  smokeScenarios
};

# AGENTS.md — WildFire, the complete guide

Read this before touching code. It defines what the product is, why it exists,
how the pieces fit together, the conventions that decide whether a change is
good, and the checks that prove it.

---

## 1. The goal (load-bearing)

**WildFire is a clean-room, uBO-inspired content blocker built from scratch for
100% Firefox/Gecko native runtime, under a new brand: WildFire.**

That sentence is the constitution of this repo. Unpack it:

- **uBO-inspired, not uBO-derived.** We reimplement the *ideas* — network
  filtering with exceptions, domain/wildcard matching, element hiding, a
  counter, per-site controls — in original code. This is **not** a fork,
  repackaging, minified copy, port, or adaptation of uBO source. Behavior comes
  from public filter-syntax docs, Gecko/WebExtensions docs, our own tests, and
  reading upstream implementations for inspiration; architecture, names,
  registries, assets, and code are WildFire's. If a behavior is needed, specify
  it here and write it here.
- **Inspiration allowed, cloning not.** Reading individual upstream
  uBO/AdGuard source files to understand an approach is allowed. Do not clone
  or download repositories into the workspace, vendor files, or copy,
  translate, adapt, minify, or paste upstream code, engines, build scripts, or
  assets. Do not import upstream modules. A feature is complete only when it
  has WildFire-owned code, tests, and docs.
- **100% Firefox native.** Firefox is the only target. The manifest uses
  Firefox's `browser_specific_settings`, runtime code uses the promise-based
  `browser.*` API through thin WildFire `wapi` modules, and there is no Chrome
  target, no `chrome.*` shim, no callback bridge, no cross-browser abstraction
  layer, and no MV3 fallback. Do not add Chromium compatibility code or a
  manifest fork "just in case".
- **No generic compatibility code.** Prefer small, named, Firefox-specific
  modules over generic adapters or frameworks. `wapi` is a native API boundary,
  not a portability layer.
- **Loop-free by construction.** Runtime code and tools express iteration with
  native helpers — `map`, `filter`, `reduce`, `forEach`, `some`, `every`,
  `find`, `flatMap`, `Array.from` — instead of hand-written `for`, `while`, or
  `do` loops. `tools/check.js` rejects explicit loops in every `.js` file.
- **New brand: WildFire.** Name, icon, colors, storage keys, message names, and
  artifact names are WildFire's. Do not leave uBO branding in user-visible
  text, comments, or filenames. Flame icon; primary orange `#e2511d`, accent
  `#ff8a4c`, inner flame `#ffd257`, dark UI `#16181d`.

**Non-negotiable platform floor:** Manifest V2,
`browser_specific_settings.gecko.strict_min_version = "153.0"` (the current
ESR line). Firefox 153 is why MV2 is viable here: it still supports
`webRequestBlocking`, which is the model WildFire's blocking engine relies on.
Do not raise, lower, or remove the floor, and do not migrate to MV3 without an
explicit product decision from the owner.

**Honest scope.** "Clean-room, uBO-inspired" is the *direction*, not a claim of
feature parity today. The current engine is deliberately minimal (§5). Grow it
in the WildFire style; never close a gap by importing upstream code.

---

## 2. Repo shape

```
manifest.json          MV2 manifest; gecko floor 153.0; all permissions
background.js          thin bootstrap for the background controller
lib/
  wapi/                Firefox-native API backbone (wapi), no browser shims
    wapi.js            named listener registry, prefix router, tabs/alarms/storage/content scripts
    wapi-contexts.js   per-frame content script context registry and frame targeting
    wapi-background.js background-side port channels for push updates
    wapi-router.js     named action registry for wildfire:* messages
    wapi-tabs.js       native tab/navigation event adapter for PageStore
    wapi-webrequest.js native webRequest listener, stream and header plumbing
    wapi-action.js     native browserAction/badge plumbing
    wapi-capabilities.js readiness/capability surface for native Firefox APIs
    wapi-scripting.js  dynamic content-script registration with atomic replacement
    wapi-dns.js        native Firefox DNS canonical-name lookups
    wapi-client.js     client-side message API for extension pages and content scripts
  background/          background classic-script chain, load in order:
    cname.js           bounded canonical-host cache and alias/canonical host sets
    helpers.js         counters/badge, snapshots, diagnostics and host helpers
    url-skip.js        local scheme bypass policy before engine matching
    engine-host.js     engine lifecycle, compiler/cache, cosmetic and scriptlet sync
    logger.js          local-only bounded request decision logger
    requests.js        synchronous webRequest handlers and rewrite streams
    messages.js        wildfire:* message router
    background.js      controller: state, listeners, startup and readiness
  engine/
    filter/            filter engine module chain (classic scripts, load in order):
      constants.js     limits, capability flags, token/type tables
      utils.js         hashing, host/URL helpers, tokenization
      pattern.js       pattern compilation + plain/segment/regex matching
      parse-network.js network line parser ($options IR)
      parse-procedural.js  procedural cosmetic selector parser
      parse-scriptlet.js   uBO/AdGuard scriptlet line parsers
      parse-cosmetic.js    cosmetic line parser (safe ABP mapping)
      engine.js        FilterEngine core: state, indexing, load()
      engine-compiled.js   toCompiled/loadCompiled serialization
      engine-match.js  request matching hot path
      engine-cosmetic.js   cosmetic storage + per-host getters
    procedural/        DOM-based procedural cosmetic evaluator module chain:
      text.js          regex cache + text/path matchers
      nodes.js         step evaluation + target-set traversal (XPath, ancestors)
      native.js        native Gecko CSS compilation for safe steps
      select.js        rule classification, grouped selection, public API
  compile/
    compiler.js        dynamic compile engine: worker with sync fallback
    compile-cache.js   compiled-filter cache (memory LRU + IndexedDB/local)
    compiler-worker.js worker entry; importScripts engine + resource registries
  resources/
    scriptlets/        WildFire-owned scriptlet module chain (no filter-supplied code):
      core.js          validators, needle safety, path/property primitives
      runtime.js       page defusers, DOM/cookie/storage helpers, detectors
      transforms.js    JSON prune/edit and response/request transforms
      adguard-helpers.js  AdGuard argument mapping and original helpers
      definitions.js   uBO alias catalog (validators + implementations)
      adguard-definitions.js  AdGuard alias catalog delegated to uBO twins
      shims/           one original compatibility shim per file
        set-constant-tokens.js  expanded constant tokens
        replace-node-text.js    `rpnt` and AdGuard replacement behavior
        prevent-clipboard-write.js  clipboard write defuser
        prevent-navigation.js   uBO-style navigation bridge
        popads-net.js           dotted `popads.net` alias
        multiup.js              MultiUp detector stub
        edit-object-on-setter.js  JSONPath edit on assignment
        ubo-acis.js             AdGuard `ubo-acis.js` bridge
        ubo-aeld.js             AdGuard `ubo-aeld.js` bridge
        ubo-aopw.js             AdGuard `ubo-aopw.js` bridge
        ubo-aost.js             AdGuard `ubo-aost` bridge
      api.js           canonicalization, validation, apply, public API
    csp-resources.js   curated CSP directives for $csp response headers
    redirect-resources.js  WildFire-owned data-URI redirect resources
    rewrite-resources.js   WildFire-owned bodies for $rewrite responses
  state/
    store.js           wapi.storage.local wrapper, key wildfire.state.v1
    bundled-lists.js   inert catalog of the preshipped default list and update URL
    remote-lists.js    preshipped + opt-in remote list store, key wildfire.remote.v1
    suggested-lists.js inert catalog of suggested list URLs (Options shortcuts)
    page-store.js      per-tab/frame document, site, popup and page cache state
content/cosmetic.js    injects hidden-element CSS in every frame
filters/default.txt    bundled starter rules (~85 network rules)
ui/
  popup/               toolbar popup (status, counter, pause controls, inspector buttons)
  options/             custom filters, paused sites, remote lists, stats reset
  inspector/           local-only request decision window (logger-ui.js renderer)
assets/                generated PNG icons (16/32/48/96/128)
tools/                 icon generator, validator, tests, XPI packager, Firefox smoke tools
dist/                  generated XPI — ignored, never reviewed or committed
docs/                  design notes for non-shipped architecture explorations
browser/               FOSS Firefox native bridge scaffold (not packaged in XPI)
AGENTS.md, README.md   this guide and the user-facing overview
```

Everything is plain ES2015+ JavaScript in classic scripts. There is no module
bundler, no transpiler, no npm dependencies, and no runtime build step. Node is
used **only** by `tools/`.

---

## 3. Runtime architecture

### Loading order (manifest `background.scripts`)

1. `lib/state/store.js` → `window.WildFireStore`
2. `lib/engine/filter/` chain, in order: `constants.js`, `utils.js`, `pattern.js`,
   `parse-network.js`, `parse-procedural.js`, `parse-scriptlet.js`,
   `parse-cosmetic.js`, `engine.js`, `engine-compiled.js`, `engine-match.js`,
   `engine-cosmetic.js` → `window.FilterEngine`, `window.mapResourceType`
3. `lib/state/page-store.js` → `window.WildFirePageStore`
4. `lib/resources/redirect-resources.js` → `window.RedirectResources`
5. `lib/state/bundled-lists.js` → `window.WildFireBundledLists`
6. `lib/state/remote-lists.js` → `window.RemoteLists`
7. `lib/state/suggested-lists.js` → `window.WildFireSuggestedLists`
8. `lib/resources/csp-resources.js` → `window.CspResources`
9. `lib/resources/scriptlets/` chain, in order: `core.js`, `runtime.js`,
   `transforms.js`, `adguard-helpers.js`, `definitions.js`,
   `adguard-definitions.js`, `shims/set-constant-tokens.js`,
   `shims/replace-node-text.js`, `shims/prevent-clipboard-write.js`,
   `shims/prevent-navigation.js`, `shims/popads-net.js`, `shims/multiup.js`,
   `shims/edit-object-on-setter.js`, `shims/ubo-acis.js`, `shims/ubo-aeld.js`,
   `shims/ubo-aopw.js`, `shims/ubo-aost.js`, `api.js` →
   `window.WildFireScriptlets`
10. `lib/resources/rewrite-resources.js` → `window.RewriteResources`
11. `lib/compile/compile-cache.js` → `window.WildFireCompileCache`
12. `lib/compile/compiler.js` → `window.WildFireCompiler`
13. `lib/wapi/wapi.js` → `window.WildFireWapi` (aliased as `window.wapi`)
14. `lib/wapi/wapi-contexts.js` → `window.WildFireWapiContexts` (aliased as `window.wapiContexts`)
15. `lib/wapi/wapi-background.js` → `window.WildFireWapiBackground` (aliased as `window.wapiBackground`)
16. `lib/wapi/wapi-router.js` → `window.WildFireWapiRouter` (aliased as `window.wapiRouter`)
17. `lib/wapi/wapi-tabs.js` → `window.WildFireWapiTabs` (aliased as `window.wapiTabs`)
18. `lib/wapi/wapi-webrequest.js` → `window.WildFireWapiWebRequest` (aliased as `window.wapiWebRequest`)
19. `lib/wapi/wapi-action.js` → `window.WildFireWapiAction` (aliased as `window.wapiAction`)
20. `lib/wapi/wapi-capabilities.js` → `window.WildFireWapiCapabilities` (aliased as `window.wapiCapabilities`)
21. `lib/wapi/wapi-scripting.js` → `window.WildFireWapiScripting` (aliased as `window.wapiScripting`)
22. `lib/wapi/wapi-dns.js` → `window.WildFireWapiDns` (aliased as `window.wapiDns`)
23. `lib/background/` chain, in order: `cname.js`, `helpers.js`, `url-skip.js`,
    `engine-host.js`, `logger.js`, `requests.js`, `messages.js`,
    `background.js` → `window.WildFireBackground`
24. `background.js` → calls `WildFireBackground.create(...).start()`

`wapi.js` is WildFire's Firefox-native API backbone: named idempotent listener
registration, one prefix-filtered message listener, and thin promise wrappers for
tabs, alarms, storage, content-script registration and response-stream access.
`wapi-contexts.js` builds on it to track per-frame content script contexts and
route frame-targeted messages. `wapi-background.js` adds native `runtime.onConnect`
port channels so the background can push debounced state updates to the popup.
`wapi-router.js` is the named action registry: `lib/background/messages.js`
registers each `wildfire:*` handler there, and `wapi.messages()` remains the only
listener. `wapi-tabs.js` owns native `tabs`/`webNavigation` event registration and
feeds `WildFirePageStore`. `wapi-webrequest.js` owns native `webRequest`
listener, stream-filter and header-listener plumbing; all blocking, rewrite,
CSP and remove-header policy stays in `lib/background/requests.js`.
`wapi-action.js` wraps native badge calls while `helpers.js` owns counter
formatting and tooltip policy. `wapi-capabilities.js` is the single readiness
surface for `publicSuffix`, DNS, `alarms`, `contentScripts`, storage and the
optional native bridge; policy that depends on those capabilities stays in the
background chain. `wapi-scripting.js` owns named dynamic content-script
registrations and their atomic replacement: a failed register keeps the previous
working registration, and lifecycle cleanup goes through Firefox's registration
handle.
The background chain owns these modules; do not add a Chromium shim or
callback bridge there.

`wapi-client.js` is the matching client-side backbone: popup, options, inspector
and content scripts use one prefix-filtered message API, one runtime listener,
native port handles, a wrapped `tabs.query()` and a wrapped native window opener
instead of scattering raw Firefox API calls. It does not replace the background
router.

Content scripts load in this order: `lib/wapi/wapi-client.js` → `lib/engine/procedural/` chain (`text.js`,
`nodes.js`, `native.js`, `select.js`) → `content/cosmetic.js`, so the DOM
evaluator exists before the content script runs. The chain shares one internal
namespace, `window.WildFireProceduralCore`; `select.js` publishes the public
`window.WildFireProcedural` API. Load order is pinned in the manifest and in
`tools/test.js` (`PROCEDURAL_FILES`) — keep both in sync.

Libraries export by attaching to `this` (the window/global in a classic
script). Keep that pattern; do not introduce imports, `export`, or a module
graph without a deliberate redesign.

### Request blocking (hot path)

`webRequest.onBeforeRequest` is registered with `{urls:['<all_urls>']}` and
`['blocking']`, so **the listener must be synchronous**:

- First cancel a `main_frame` request whose tab already has a pending `$popup`
  block; the block was counted when the decision was made, so this step never
  counts again. Then skip when `state.enabled` is false.
- Apply the local `url-skip.js` scheme policy before any engine matching: only
  `http`, `https`, `ws`, `wss` and `ftp` URLs are filterable. Internal, extension,
  `data:`, `blob:` and `file:` URLs return no blocking response and record a
  `skipped` Inspector reason instead of a counter.
- Resolve the document URL through `WildFirePageStore`: `details.documentUrl`,
  then `details.originUrl`, then the frame URL cached by `documentId` from
  `webNavigation`/`webRequest`, then the `main_frame` request URL, then the
  cached frame URL, then the committed top-level page URL, then the last frame
  ancestor. The store is synchronous, in-memory, and owns per-tab frame trees,
  popup state, site attribution, and transient page caches. An in-flight
  top-level request never replaces the committed page identity, so a blocked
  navigation cannot poison counters or pause checks.
- Skip if the tab's top-level host is in `state.disabledSites` (exact or
  subdomain), including requests from embedded frames.
- Map `details.type` through `mapResourceType`, then call
  `engine.matchRequest(url, type, documentUrl, matchHosts)`. `matchHosts` carries
  the request and document hosts plus any cached canonical CNAME targets, so
  alias hosts match `||host^`, `$domain=`, third-party, CSP, header, rewrite and
  hide rules while the original request URL stays intact for redirects and the
  Inspector.
- On a block: increment `state.blocked` and `state.blockedBySite[site]` (keyed by
  the tab's top-level registrable domain, not an embedded frame), refresh that
  tab's badge, schedule a debounced stats save (1.5 s), return `{cancel:true}` —
  or `{redirectUrl}` when
  the rule has `$redirect`/`$redirect-rule` and the alias resolves to a
  WildFire-owned data-URI resource. When the rule has `$rewrite`, create a
  `filterResponseData()` stream filter **synchronously**, discard the original
  chunks, and write the curated WildFire body on `onstop`; `onHeadersReceived`
  then drops length/encoding headers and sets the resource's MIME type. Return
  no blocking response so the request continues with the substituted body.
  Navigations are never redirected or rewritten, and an unknown alias falls
  back to a cancel.
- Exceptions (`@@`) win unless an `$important` blocker applies; the engine
  scans all candidates in load order to make that decision.

**Never make the blocking listener async.** Engine state lives in memory and
is rebuilt from `filters/default.txt` plus `customFilters` at startup; storage
reads happen only in `init()` and message handlers. Top-level navigations only
match rules with an explicit `$document` or `$popup` option, so plain network
rules cannot cancel navigation. `$popup` uses a Firefox-native two-step path:
`webNavigation.onCreatedNavigationTarget` records the source tab/frame and does
an early `tabs.remove()` when it can prove a block, and `webRequest.onBeforeRequest`
synchronously cancels the popup's `main_frame` request when a popup source is
known. The blocked tab id stays marked until that request arrives (or a bounded
cleanup timer fires), and a separate counted flag ensures the block is charged
exactly once even if `tabs.remove()` loses the race.

CNAME uncloaking is a local, cache-backed extension of that synchronous path.
`lib/wapi/wapi-dns.js` is the only caller of Firefox
`browser.dns.resolve(host, ['canonical_name'])`; it normalizes hosts, contains
errors and never executes filter text. `lib/background/cname.js` keeps a bounded
in-memory map of alias → canonical names with positive and negative TTLs. A
request can only consume canonical names already in that map: the blocking
listener starts the async lookup but never awaits it, so the first request to a
new alias may pass. Resolutions feed host-index lookups, `$domain=`, third-party
scope, header/CSP/rewrite matching, cosmetic scoping and `siteKey()` counters.
Only alias and canonical host sets cross the API boundary; no DNS results are
persisted or reported, and `data_collection_permissions.required` stays
`["none"]`.

### Engine shape

`FilterEngine.load(text)` resets and rebuilds three request-rule realms —
`network`, `csp` and `hide` — each with its own host, token and unindexed
indexes, plus cosmetic and scriptlet indexes:

- `hostRules: Map<host, rule[]>` for `||host^` rules, keyed by the pattern's
  leading host (looked up against every request/document host and all their
  parents, including cached CNAME canonical names). A reversed-label
  `hostTrie` stores the same rules so suffix lookups avoid rebuilding parent
  strings on every request; `cspHostTrie` and `hideHostTrie` mirror it.
  `cspHostRules` and `hideHostRules` mirror the flat map for the other realms, so
  hide exceptions can never suppress requests and CSP exceptions can never
  suppress blockers.
- `tokenRules: Map<token, rule[]>` for generic rules, keyed by one 4-character
  token chosen from the rule's literal chunks using corpus frequency and bucket
  cost; `unindexedRules: rule[]` holds patterns with no usable token. Candidates
  are the union of host, token and fallback matches within one realm, sorted by
  load order before exception/blocker selection. A bounded per-generation
  decision cache short-circuits repeated request/type/host tuples; any filter
  load or compiled activation clears it.
- `cosmeticByDomain` / `cosmeticExceptionsByDomain: Map<domain, entry[]>` plus
  `genericCosmetic` / `genericCosmeticExceptions`. Each entry carries a selector
  and `include`/`exclude` host scopes; negated (`~host`) targets are preserved
  and resolved with parent-domain scoping. Procedural maps use the same entry
  shape with a parsed tree instead of a plain selector.
- `scriptletRules`/`rejectedScriptlets` for `##+js(alias, args)` rules.
- `counts: {network, exceptions, cosmetic, csp, scriptlets, rewrite}` for the UI.

`FilterEngine` accepts injected registrable-domain, CSP, scriptlet and rewrite
resolvers so the engine stays self-contained and unit-testable. Background
supplies Firefox 153's synchronous `browser.publicSuffix.getDomain()` (with IP,
plain-suffix and unknown-suffix lookups enabled), `CspResources.resolve()`,
`WildFireScriptlets.validate()` and `RewriteResources.hasAlias()`. The engine
falls back to a last-two-label scope when no domain resolver is given or a
lookup fails, and rejects `$csp`, `##+js()` and `$rewrite` rules when their
registry is unavailable. Never call `browser.*` from the `lib/engine/filter/` chain.

The filter engine is a chain of classic-script modules sharing one internal
namespace, `window.WildFireFilter`: each file imports what it needs from the
namespace at load time and exports its own helpers back into it. `engine.js`
defines the `FilterEngine` class core (state, indexing, `load()`); the
`engine-compiled.js`, `engine-match.js` and `engine-cosmetic.js` parts extend
`FilterEngine.prototype` with their method groups. The load order is pinned in
the manifest, the compiler worker's `importScripts`, `tools/test.js`
(`ENGINE_FILES`) and `tools/build.js` — keep all four in sync when adding a
module. The chain stays self-contained and unit-testable; only `engine.js`
publishes the public `FilterEngine`/`mapResourceType` globals.

`matchRequest()` returns `redirect: {alias, captures}` when the winning rule
carries `$redirect` or `$redirect-rule`. `RedirectResources.resolve()` is the
only place redirect targets are defined: it serves WildFire-authored `data:`
URIs, fills `{{1}}`–`{{9}}` placeholders from regex captures with
percent-encoding, and returns `''` for unknown aliases so the listener falls
back to a cancel. Filter text can never supply a redirect URL itself.

`matchRequest()` also returns `rewrite: {alias, captures}` for a winning
`$rewrite` or `$rewrite-rule` rule. `RewriteResources.resolve()` is the only
place substitute bodies and MIME types are defined; fixed aliases return a
copied `Uint8Array`, and capture aliases fill WildFire-authored templates from
percent-encoded regex captures. Background creates the stream filter from
`onBeforeRequest`, normalizes headers through `RewriteResources.withHeaders()`
in the existing blocking `onHeadersReceived` listener, and lets
`onCompleted`/`onErrorOccurred`/`onBeforeRedirect` forget the request id. Unknown
aliases are rejected at load time into `engine.rejectedRewrite` instead of
becoming blockers. `$rewrite-rule` requires a regex filter and a separate
curated capture alias; fixed bodies cannot be used with captures. Rewrites never
apply to navigations and count as one filtered/blocked request. Filter text can
never supply a response body.

`matchCsp()` is the response-header counterpart in the separate `csp` realm:
a bare `@@...$csp` exception stops all injection, `@@...$csp=alias` stops only
that alias, and a plain network exception has no effect. Matching curated
directives are returned once each. `$csp` rules are excluded from
`matchRequest()` so they never cancel requests. `CspResources.resolve()` is the
only place CSP directive values are defined; an unknown alias is rejected at
load time into `engine.rejectedCsp`
rather than becoming a blocker. Background calls the synchronously registered
`webRequest.onHeadersReceived` listener with `['blocking', 'responseHeaders']`
and appends the directives as extra enforcing `Content-Security-Policy`
headers without touching the site's own headers. CSP report requests are
skipped by the general blocking listener and handled by a separate
type-filtered `csp_report` listener. Filter text can never supply a header value
itself.

CSP report blocking is a default-on local privacy toggle, independent of `$csp`.
The existing blocking `onHeadersReceived` listener removes only `report-uri` and
`report-to` directives from CSP headers, leaving every enforcement directive and
all other headers intact. A separate `webRequest.onBeforeRequest` listener
registered for `types: ['csp_report']` cancels legacy report requests as a
backstop. Endpoint hosts in `state.cspReportAllow` are allowed; paused sites and
a global pause skip both behaviors. Report blocking counts only in local
diagnostics (`cspReports.headersStripped` and `cspReports.requestsCancelled`),
never in `blocked` or `blockedBySite`. WildFire does not change Firefox ETP or
native CSP preferences.

`getScriptletPayload()` returns plain `{alias, args, domains, isException}`
data. Background registers the `lib/resources/scriptlets/` module chain at
`document_start` with `['<all_urls>']`/all frames, as ordered `js: [{file: …}]`
entries, and injects only a JSON payload through the final `code` step.
`wapi-scripting.js` owns the Firefox `contentScripts.register()` handle and
swaps the named registration atomically. The chain shares one internal
namespace, `window.WildFireScriptletCore`; `api.js` publishes the public
`window.WildFireScriptlets` API. Load order is pinned in the manifest, the
registration details in `engine-host.js`, the compiler worker's
`importScripts`, `tools/test.js` (`SCRIPTLET_FILES`) and `tools/check.js` — keep
all five in sync. There is no `eval`, no `Function`, and no filter-sourced script
anywhere;
`WildFireScriptlets.apply()` revalidates every entry, resolves domains against
`location.hostname`, and lets `#@#+js()` cancel the matching
alias/arguments. A validated, data-only scriptlet snapshot is persisted in the
compile-cache layer and registered before async startup work, so a previously
fetched list applies on the first navigation after restart or update.
Registrations are replaced whenever the engine reloads, and only future
navigations receive updated scriptlets.

`getCosmetic(host, policy)` merges generic selectors with every parent-domain
selector and subtracts applicable exceptions, including hide modifiers from the
policy. `content/cosmetic.js` asks for them once
on load via `wildfire:cosmetic` and re-applies on `wildfire:apply` broadcasts;
it validates each selector with `CSS.supports('selector(…)')` and
`document.querySelector` before injecting a `<style id="wildfire-cosmetic">`.

Procedural selectors (`:has-text()`, `:contains()`, `:matches-path()`, `:has()`,
`:nth-ancestor()`, `:upward()`, `:min-text-length()`, `:matches-attr()`,
`:matches-css()`, `:xpath()`, `:not()`, `:matches-media()`) are parsed in
`lib/engine/filter/parse-procedural.js` into trees with `base` plus ordered `steps`; malformed or
unsafe ones are recorded in `engine.rejectedCosmetic` and never sent to pages.
`getProcedural(host, policy)` merges generic and domain trees and subtracts
`#@#` exceptions and hide modifiers. Generic JS-evaluated procedural rules are
rejected at load time; only generic path-only and fully native-compilable trees
are delivered everywhere, while generic exceptions remain valid. Background
sends the result in the same `wildfire:apply` message as CSS and caches the
payload per host/hide-policy within one filter generation.

`WildFireProcedural.classify()` picks the cheapest Firefox-native route per
rule. `:matches-path(text|/re/)` is a page constant, so it is matched once per
apply and dropped from the node steps; non-matching rules are skipped entirely.
Plain text is a case-insensitive substring. Native `:has()` steps and
`:matches-attr(name)`/`=(name="literal")` are compiled to CSS
and validated with `CSS.supports`, so Gecko handles them in
`#wildfire-cosmetic-procedural` with no JS re-evaluation. When dynamic steps
remain, every native-safe fragment (`:has()` base, attribute presence/literal)
contributes a native **prefilter** on the `querySelectorAll` call. `selectAll()`
groups rules sharing a base (or prefilter) into one query pass instead of one
per rule. Only the remaining text/regex/ancestor/computed-style-dependent rules
hide nodes via `data-wildfire-hidden`, and the attribute is diffed so unchanged
nodes are never touched. `:matches-css(prop: value|/re/)` reads Gecko's computed
style read-only; literal values must match exactly (CSS string quotes are
ignored), and `-before`/`-after` pseudo variants stay JS-evaluated.
`:xpath(expr)` is a transforming step that calls Gecko's native
`document.evaluate` (read-only, `ORDERED_NODE_SNAPSHOT_TYPE`) with the current
node as context and expands the target set to every element result (bounded);
later steps filter/map that set. It stays JS-driven, not CSS.
`:not(<procedural>)` negates a procedural operand on the node itself. When the
operand is fully native-representable (e.g. `:not(:has(.x))`) it compiles to
native Gecko CSS — `:has()` inside `:not()` is native — or prefilters a mixed JS
rule with the negated selector. A procedural operand (text/regex/…) stays
JS-evaluated with no prefilter. A plain `:not(.x)` is never lifted and stays in
the native CSS base.
`:has-text()` checks an element's own text nodes; `:contains()` also searches
descendants. Both share the safe literal/regex matcher. `:nth-ancestor(n)` is a
transforming step: the rule hides the nth parent of a match instead of the
match itself, so `targetOf()` returns the final node to hide.
`content/cosmetic.js` schedules re-applies with `requestAnimationFrame` to merge
multiple `MutationObserver` batches per frame, only observes `characterData`
when a live rule actually depends on text, and widens the attribute watch to all
attributes when a rule uses `:matches-attr()`, `:matches-css()` or `:xpath()`.
A `:matches-media()` rule additionally binds a `resize` listener (the viewport
can change without a DOM mutation) and unbinds it when no live rule needs it.
Filter text is never executed.

### State and messages

Storage key `wildfire.state.v1` holds `{enabled, blocked, blockedBySite,
customFilters, disabledSites, siteRules, blockCspReports, cspReportAllow,
cnameUncloak}`.
`blocked` is the lifetime total shown in Options;
`blockedBySite` maps registrable domains to per-site counters shown by the
toolbar badge and popup. The badge is set per tab and refreshed on activation
and navigation, so subdomains share one site count while each tab shows its own
site. `persist(patch)` merges into the in-memory copy and writes a
**full snapshot** — do not write partial objects directly, or parallel message
handlers will clobber unrelated fields. `cnameUncloak` is default-on; turning it
off stops new DNS lookups and ignores cached canonical names immediately, while
the bounded cache itself stays purely in memory.

`siteRules` maps registrable domains to validated per-resource-type `allow` or
`block` actions. Dynamic rules are set from the popup, override static filter
decisions before engine matching, and never apply to navigations or globally /
per-site paused tabs. An `allow` rule also skips `$removeparam`, `$removeheader`,
`$csp`, report stripping and rewrite/CSP header work; a `block` rule counts as
one filtered request and is recorded as a local Inspector decision. Rules are
keyed by the tab's top-level site even when the request comes from an embedded
frame. Storage key `wildfire.remote.v1` holds
`{lists: [{url, builtin, enabled, autoUpdate, etag, lastModified, text,
updatedAt, checkedAt, hash, lastError, metadata}]}` and is owned entirely by
`lib/state/remote-lists.js`. The preshipped default entry points directly at
`https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`, starts
enabled, and auto-fetches on startup before following `! Expires`; it cannot be
removed and can be disabled or opted out of Auto in Options. The old
`wildfire:bundled/default.txt` sentinel and the former WildFire starter URL are
migrated to that URL. No upstream filter text is vendored into the repository;
`filters/default.txt` remains only an offline engine fallback.

Background listens for `wildfire:*` messages:

| Action | Purpose |
| --- | --- |
| `state` | snapshot + active-tab `{url, host, site, blocked, disabled, rules}` |
| `toggle` | flip global `enabled` |
| `toggle-site` | add/remove a host in `disabledSites` |
| `set-filters` | save custom filters, reload engine, refresh cosmetics |
| `validate-filters` | parse custom filter text with a temporary engine and return line-numbered rejections; no state change |
| `set-csp-report-blocking` | enable or disable default-on CSP report blocking |
| `set-csp-report-allow` | replace the allowlist of report endpoint hosts |
| `set-cname-uncloak` | enable or disable cache-backed CNAME uncloaking |
| `set-site-rule` | set/clear/flip one `resourceType` rule for a site |
| `clear-site-rules` | remove every dynamic rule for a site |
| `reset-stats` | zero the lifetime total and every site counter |
| `reload` | rebuild from bundled + custom + enabled remote filters |
| `list-state` | return registered remote lists |
| `suggested-lists` | return the inert catalog of suggested list URLs |
| `add-list` | register an http(s) list URL, fetch it once, leave it disabled |
| `remove-list` | forget a list and stop applying its rules |
| `update-list` | explicitly fetch/revalidate one list |
| `set-list-enabled` | apply or stop a fetched list |
| `set-list-auto` | turn automatic first fetch and `! Expires` checks on or off |
| `cosmetic` | return selectors for a URL |
| `diagnostics` | toggle/reset in-memory request metrics, ETP observation, CSP report counts and CNAME cache counters |
| `inspect` | enable/reset/return the bounded local request decision log |

`state`-only fields are not on other responses. The popup keeps the tab info
it got from `state` and merges it into later responses (`applyResult`); keep
that behavior when adding popup actions.

`diagnostics` is local-only: metrics, ETP observations and the CNAME cache
snapshot live in memory, are disabled by default, and are never persisted or
reported. WildFire never changes Firefox's ETP settings. ETP block errors and
`urlClassification` flags are observed as hints only; they must never affect
`blocked`, `blockedBySite`, or filter decisions. `onHeadersReceived` is
registered while loaded rules need `$csp`, `$rewrite`, or `$removeheader`, and
also while CSP report blocking is enabled.

`inspect` is local-only: `lib/background/logger.js` keeps a bounded in-memory
ring of request, CSP, CSP-report and CNAME decisions with phase, source, reason,
document scope, top-level site, request identity and duration. It is disabled by
default, never persisted, and never sent anywhere; the popup and Inspector use
`wapi-client` to enable it, refresh it, and clear it. The structured Inspector
window is split: `ui/inspector/logger-ui.js` owns pure filtering, summary,
copy-rule helpers and DOM rendering, while `ui/inspector/inspector.js` only wires
native messages, controls and refresh. The window filters by decision, phase,
resource type, site and free text, freezes the current view while recording
continues, and copies a matching rule as WildFire syntax. The blocking listener
records only when the logger is enabled, and inspection never changes `blocked`,
`blockedBySite`, or filter decisions.

The preshipped default list is remote-list shaped and is fetched directly from
`https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`.
`lib/state/bundled-lists.js` is an inert catalog with that default URL;
`lib/state/remote-lists.js` seeds the entry at startup, parses `! Title`,
`! Description`, `! Version`, `! Homepage`, `! License`, `! Expires`,
`! Checksum`, `! Diff-Path` and `! Last Modified` metadata, stores the fetched
text and hash, and loads it once before custom and external remote rules. It
auto-fetches on startup, then revalidates at its `! Expires` interval;
`remove-list` rejects it, while `set-list-enabled` and `set-list-auto` can opt it
out. A fetched update persists across extension reseeds; the legacy
`wildfire:bundled/default.txt` sentinel and the former WildFire starter URL
migrate to the default URL while preserving user choices. No upstream filter
text is vendored into this repository; `filters/default.txt` supplies offline
fallback rules only. The bundled `lib/state/suggested-lists.js` catalog remains
inert: Options shows its URLs as shortcuts, and clicking one only sends
`add-list`. Every registered list, including the default list,
auto-fetches once and then revalidates at its `! Expires` interval, which
defaults to one day and can be as short as one minute. `set-list-auto` can
disable this per list. User-added lists stay disabled until the user enables
them. Fetches use `cache: 'no-store'`, validator headers, a size cap (including
`Content-Length` preflight), a 60-second `AbortController` timeout, final-URL and
HTML-error checks, and parsed header metadata. A 304 keeps the stored text and
metadata but refreshes the check time; an unchanged 200 keeps the original
content time. The `alarms` permission supports the one named alarm, whose period
tracks the shortest active list interval. No data about the user is collected or
reported, so `data_collection_permissions.required` stays `["none"]`.

---

## 4. UI conventions

- Dark theme with system font stack; popup is a fixed 330 px panel, options is
  a centered 760 px page. Reuse the existing CSS variables/colors rather than
  inventing a second palette.
- Popup and options are classic scripts (no framework). They talk to the
  background **only** through `wapi-client.js` — never read `browser.storage`
  or the engine directly.
- Keep user-facing strings branded WildFire, and keep the Firefox 153 / ESR
  note where it currently appears. The Inspector table has its own
  `ui/inspector/` window, opens from the popup, and uses the existing dark
  palette; it never exposes upstream branding.
- The Options custom-filter editor is native: the textarea is the single source
  of truth, `ui/options/editor.js` owns the gutter, syntax overlay, caret status,
  line commands and `wildfire:validate-filters` presentation. No editor
  dependency or upstream keymap/theme is bundled.

---

## 5. Filter language — supported vs. out of scope

| Supported | Not supported (yet) |
| --- | --- |
| `||host^` domain anchors, subdomains | other advanced selectors |
| `|url|` start/end anchors | full EasyList-scale list curation |
| `*` wildcards, `^` separator | full EasyList-scale performance tuning |
| `@@` exceptions | |
| `@@||host^$elemhide`, `$generichide`, `$specifichide` document exceptions | |
| `$script`, `$image`, `$~type`, other resource types | |
| `$third-party`, `$~third-party`, `$1p`, `$3p` | |
| `$domain=a\|~b` (`from=` alias), including `example.*` and `*.example.*` | |
| `$document`, `$popup`, `$important`, `$badfilter` | |
| `$redirect=alias`, `$redirect-rule=alias` | |
| `$rewrite=alias`, `/regex/$rewrite-rule=alias` (curated aliases only) | |
| `$csp=alias` (curated aliases only) | |
| `$removeparam`, `$removeheader` (capability-gated) | |
| `/regex/` filters (`i`, `m`, `s`, `u` flags only) | |
| `##selector`, `#@#selector`, `host,~host##selector` | |
| `##sel:has-text("…")`, `##sel:matches-path(text|/re/)`, `##sel:has(sel)` | |
| `##sel:contains("…")`, `##sel:nth-ancestor(n)`, `##sel:upward(n|sel)`, `##sel:min-text-length(n)`, `##sel:matches-attr(name[=value|/re/])`, `##sel:matches-css[-before|-after](prop: value|/re/)`, `##sel:xpath(expr)` (bounded, read-only, all results), `##sel:not(<procedural>)`, `##sel:matches-media(query)` | |
| `#?#` / `#@?#` with safe `:-abp-has()`/`:-abp-contains()` | unsupported ABP action/procedural selectors rejected |
| `domain##+js(alias, args)` (curated aliases only) | |
| `domain#%#//scriptlet('alias', 'args')` (AdGuard, string-only) | AdGuard trusted/debug aliases |

Regex filters are checked at load time. Backreferences, nested or alternated
quantifiers, excessive quantifier/group counts, long patterns and stateful
flags (`g`, `y`, `d`) are rejected into `engine.rejectedRegex` and never reach
the blocking listener. Regex rules bypass the token index and are evaluated on
URLs up to 8192 characters.

Redirect rules name an alias from `lib/resources/redirect-resources.js`: `noopjs`,
`noopcss`, `nooptext`, `noopjson`, `noophtml`, `1x1.gif`, `1x1.png`,
`tagged.svg`. `$redirect-rule` uses regex captures to fill that resource's
`{{1}}`–`{{9}}` placeholders; captures are percent-encoded before insertion.
An unregistered alias cancels instead. No upstream resources are bundled.

`$rewrite=alias` replaces a matching response body through Firefox's
`webRequest.filterResponseData()` stream filter. Fixed aliases are `blank-js`,
`blank-css`, `blank-text`, `blank-json`, `blank-html` and `blank-image` from
`lib/resources/rewrite-resources.js`; each maps to a fixed MIME type and
WildFire-authored bytes. `/regex/$rewrite-rule=alias` uses the separate capture
aliases `tagged-js`, `tagged-json`, `tagged-text` and `tagged-html`. Regex
captures fill `{{1}}`–`{{9}}` placeholders after percent-encoding; only capture
aliases accept `$rewrite-rule`, and combining it with `$rewrite` is rejected.
Malformed wildcard `domain=` options, non-regex rewrite rules, and unknown
aliases are rejected into `engine.rejectedRegex` or `engine.rejectedRewrite` at
load time instead of becoming blockers. Rewrites honor the usual
type/domain/third-party options and `@@` exceptions, never apply to navigations,
and count as one filtered request. Filter-supplied bodies are not supported.

`$removeparam` and `$removeheader` are parsed/validated in the IR and applied
only when compiled capabilities require them. `$removeparam` redirects to a
cleaned URL when a request is not blocked/redirected by a normal rule; plain
names are case-sensitive, while regex values match the raw `name=value` pair
with authored `i`/`m`/`s`/`u` flags and no implicit `i`. Option names are
normalized but option values are preserved. Plain network patterns use an
option-aware `$` delimiter so literal `$` and `$removeparam=/^x=$/` survive
parsing. `$removeheader` strips validated request/response header names in
`onBeforeSendHeaders`/`onHeadersReceived`. Both respect `@@`, `$important`,
domain/type scoping, and compile-time `$badfilter`. Filter text cannot supply
code or arbitrary header/body values.

`$csp` rules name an alias from `lib/resources/csp-resources.js`: `no-script`,
`no-inline-script`, `no-frame`, `no-worker`, `no-object`, `no-font`, `no-media`,
`no-connect`. Each resolves to a fixed directive that can only tighten a
response. Unknown aliases are rejected into `engine.rejectedCsp` instead of
becoming blocking rules, so a filter can never supply a header value or a
weaker policy. `$csp` accepts the same type/domain/third-party options as
network rules, and applies to main documents without `$document`.

Scriptlet rules use `##+js(alias, args)` and may be scoped by comma-separated
domains or negated with `#@#+js(...)`. The registry in the
`lib/resources/scriptlets/` chain owns one canonical alias per behavior plus
uBO short aliases (`aopr`, `acs`, `set`,
…); the engine canonicalizes names so an exception matches either spelling.
Arguments are validated data: plain dotted property paths, fixed constant tokens
(`true`, `false`, `null`, `undefined`, `0`, `1`, `emptyObj`, `emptyArr`,
`emptyStr`), and safe literal/regex "needles" using the same conservative regex
subset as network filters. Bad aliases, wrong arity, unsafe regexes, injected
code, unterminated rules and every `trusted-*` alias go into
`engine.rejectedScriptlets`. A `#@#` exception cancels the same alias/arguments
on matching domains. The catalog covers the phases in §8. AdGuard
`[domains]#%#//scriptlet('alias', 'arg', ...)` rules are parsed into the same
payload with string-only arguments and validated by the
`lib/resources/scriptlets/adguard-definitions.js` catalog;
`#@%#//scriptlet()` cancels the same rule. No filter can
supply script text.

Procedural cosmetic rules are parsed into a base selector plus ordered steps.
`:has-text()` and `:contains()` accept a quoted literal (case-insensitive) or a
`/regex/` with the same safe subset as network regexes; `:contains()` also
searches descendants. `:matches-path()` takes plain text (case-insensitive
substring) or a `/regex/` checked against `location.pathname + location.search`;
`:has()` accepts another plain or
procedural selector and can be nested up to eight levels; `:nth-ancestor(n)`
accepts 1–8 and hides the nth parent of a match. `:min-text-length(n)` accepts
1–16384. `:matches-attr(name)`, `=(name="literal")` or `=(name=/re/)` tests an
attribute (presence/literal compile to native CSS). `:matches-css(prop: value|/re/)`
(and `-before`/`-after`) reads computed style read-only; literal values must
match exactly (CSS string quotes are ignored) and regex values search. The
property must be a plain CSS identifier and the value a bounded literal or safe
regex. `:xpath(expr)`
is bounded data, never code: the expression is capped at 512 chars, must have
paired quotes/brackets, and is evaluated read-only by Gecko's `document.evaluate`
(`ORDERED_NODE_SNAPSHOT_TYPE`). It hides every element result, capped at 256 per
base match; a runtime syntax error yields no match, never a throw into the page.
Procedural evaluation threads a target set through the steps: testing steps
filter it, `:nth-ancestor()`/`:upward()` map it, and `:xpath()` expands it.
`:not(<procedural>)`
negates a procedural operand tested against the node itself (base plus steps);
only a recognized procedural operand is lifted, while a plain `:not(.x)` stays in
the native CSS base. `:matches-media(query)` is answered read-only by Gecko's
native `matchMedia`; the query is bounded data (≤256 chars, no control chars) and
Gecko validates its syntax at runtime, so an invalid query never matches. It is
viewport-dependent, so `content/cosmetic.js` re-applies on `resize` while such a
rule is live. Invalid rules land in `engine.rejectedCosmetic`. Generic
JS-evaluated procedural rules also land there unless they carry a domain scope;
generic path-only and fully native-compilable trees are kept. Evaluation
lives entirely in the `lib/engine/procedural/` chain and `content/cosmetic.js` —
never in injected script.

Add new syntax by extending the `lib/engine/filter/` chain (parser **and** the
relevant engine part) **and** `tools/test.js` in the same change. `README.md`
gets a syntax-table row when the feature is user-visible.

---

## 6. Working rules

1. **Firefox only.** Use `browser.*` promise APIs. No `chrome.*`, no callback
   wrappers, no polyfills, no "cross-browser" conditional code.
2. **Zero runtime dependencies.** Adding a package means it must be dev-only
   and justified; the extension itself stays dependency-free.
3. **Inspiration allowed, no cloning.** Reading upstream source for ideas is
   fine; cloning repositories, vendoring files, or copying/adapting upstream
   implementations is not. Write every implementation here.
4. **Floor is 153.0 / MV2.** Treat the manifest's gecko block as pinned.
5. **Keep the blocking listener synchronous.**
6. **Validate selectors before injecting CSS.** A malformed cosmetic rule must
   never throw into a page.
7. **Never commit `dist/`, `node_modules/`, or generated icons' source edits
   without running `npm run icons`.** PNG icons are checked in; regenerate them
   from `tools/make-icons.js` when changing the artwork.
8. **Do not hand-edit version strings in multiple places.** Keep `package.json`
   and `manifest.json` versions in sync when bumping, and let `tools/build.js`
   derive the XPI filename.
9. **Unknown filter options are ignored**, not fatal. Preserve that forgiving
   behavior unless there is a reason to reject a rule.
10. **No hand-written `for` / `while` / `do` loops.** Express iteration with
    native helpers — `map`, `filter`, `reduce`, `forEach`, `some`, `every`,
    `find`, `flatMap`, `Array.from({length: n})`. `tools/check.js` fails on any
    line that starts an explicit loop, in runtime code *and* tools. The
    non-packaged `browser/` scaffold is exempt from this check.

---

## 7. Verification — required before every commit

```sh
npm test          # vm-based engine unit tests (matching, options, cosmetics)
npm run build     # runs check.js, then writes dist/wildfire-<v>-firefox-153.0.xpi
web-ext lint --source-dir . --output text
```

The bar is: tests pass, build succeeds, `web-ext lint` reports **0 errors and
0 warnings**. `tools/check.js` asserts MV2, the 153.0 floor, the gecko id,
data-collection disclosure (`required: ["none"]`), the `publicSuffix`,
`webNavigation`, `webRequest`, `webRequestBlocking` and `<all_urls>` permissions,
every manifest-referenced file, `node --check` on all scripts, the loop-free
rule across every packaged `.js` file (including tools), and the wapi boundary
rule that keeps raw `browser.*`/`chrome.*` calls inside `lib/wapi/`.
If any of those change, update the check in the same commit.

For manual testing: `npm run dev` (or load `manifest.json` through
`about:debugging → This Firefox → Load Temporary Add-on`). Exercise blocking
on a real page, the popup counter/toggles, custom filters in Options, and
cosmetic hiding.

---

## 8. Where to extend next

The scriptlet catalog covers both uBO `##+js()` and AdGuard
`#%#//scriptlet()` syntax. It grew as a phased expansion of the registry in the
`lib/resources/scriptlets/` chain; every alias lands with a validator, an original
implementation, tests, and a README row. Keep these load-bearing rules:

- **Inspiration allowed, no cloning.** Reading upstream source for ideas is
  fine; copying or adapting uBO or AdGuard source is not. Write every
  implementation here.
- **No code from filter text.** No `eval`, no `Function`, no filter-supplied
  script. Alias arguments are validated data only.
- **No `trusted-*` yet.** Trusted-only aliases are rejected into
  `engine.rejectedScriptlets` until an explicit source-trust model exists.
- **Aliases are canonicalized.** Short names (`aopr`, `acs`, `set`, …) map to a
  canonical name so `#@#+js()` exceptions match regardless of spelling.

Phase 1 — uBO syntax (`##+js()`), in batches:

1. **1A, core runtime** — registry with validators, short-alias map, safe regex
   needles, expanded `set-constant` tokens, property traps, `abort-current-script`,
   `noeval*`, timer/event defusers, `window.name-defuser`, `prevent-window-open`.
2. **1B, DOM and storage** — `remove-attr`, `remove-class`, `set-attr`,
   `set-cookie`, `remove-cookie`, `set-local-storage-item`, link/newtab defusers.
3. **1C, data and defusers** — `json-prune*`, `xml-prune`, `m3u-prune`,
   `prevent-fetch`/`prevent-xhr`, `nobab`/`nofab`/fingerprint defusers, remaining
   general aliases.

Phase 2 — AdGuard syntax and cosmetic compatibility (implemented):

4. `[domains]#%#//scriptlet('name', 'arg', …)` and `#@%#//scriptlet()`
   exceptions are parsed into the same payload, validated by the AdGuard
   string-only registry, and mapped to WildFire canonical behaviors. AdGuard
   trusted and debug-only scriptlets stay rejected under the same rules as uBO
   `trusted-*`.
5. Safe ABP cosmetic/procedural compatibility: `#?#`/`#@?#` with `:-abp-has()` →
   `:has()` and `:-abp-contains()` → `:has-text()`; `:upward(n|selector)`; and
   `generichide/elemhide/specifichide` document exceptions. Unsupported ABP
   action/procedural selectors are rejected with diagnostics.

Already implemented and tested: Firefox-native registrable-domain scoping
(`publicSuffix`), `documentId`-keyed request scope, the 4-character token index,
safe regex filters, wider resource types with `$document`/`$popup`, a
from-scratch redirect engine with WildFire-owned data-URI resources, DOM-based
procedural cosmetic selectors (including native-CSS compilation, `:contains()`,
`:nth-ancestor()`/`:upward()`), opt-in remote lists with a deterministic
update store and user consent, curated `$csp` response-header filtering on
Firefox's `onHeadersReceived`, fixed-mapping `$rewrite` response bodies through
Firefox's `filterResponseData()` stream filter, cache-backed CNAME uncloaking
through Firefox's DNS API, and a scriptlet alias registry
injected at `document_start` through `wapi-scripting`'s Firefox
`contentScripts.register()` lifecycle.
Phase 1A, 1B and 1C are implemented: canonical short aliases, safe needles,
property traps, eval/timer/event/window defusers, DOM/storage aliases,
`json-prune` with wildcard paths, response transforms, JSONPath/edit aliases,
fetch/XHR guards and the detector defusers, timer delay ranges, window decoys,
curated fetch response configs, and documented DOM argument order and tokens.
All non-trusted uBO general-purpose and
defuser aliases are covered. Phase 2 is implemented: AdGuard quoted
string-only scriptlets map to WildFire canonical behaviors; safe ABP
`#?#`/`#@?#` procedural mappings, `:upward()`, and hide exception modifiers are
supported; unsupported ABP action/procedural selectors and trusted/debug-only
scriptlets are rejected safely.

Do not start a later item while an earlier one is only half-implemented. A
small, correct, fully tested engine is the product.

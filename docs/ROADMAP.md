# WildFire roadmap

Status: implementation plan; Phase 0–5 complete, Phase 6 list/catalog slice
complete; updated 2026-11-25.

WildFire is a **native Firefox rewrite of uBO behavior** under the WildFire brand.
This document maps the remaining work from today's engine to broader uBO-style
behavior. It is a behavioral roadmap, not an import plan: every feature must be
implemented in WildFire-owned code, with WildFire-owned tests and docs.

## 0. Non-negotiable guardrails

These constraints do not change as features are added:

- **Firefox only.** MV2, `browser_specific_settings.gecko.strict_min_version =
  "153.0"`, promise-based `browser.*` through `wapi`. No Chrome target, `chrome.*`,
  callback bridge, cross-browser abstraction, or MV3 fallback.
- **Rewrite, not clone.** Public docs, Gecko docs, local tests, and behavioral
  source inspection are allowed. Cloning, vendoring, copying, translating,
  minifying, or adapting upstream source, build files, assets, or filter text is
  not. No upstream repository is added to the workspace.
- **No filter-supplied code.** No `eval`, no `Function`, no dynamic source
  execution, no filter-supplied script/body/header/URL value. Scriptlets and
  rewrites resolve only curated WildFire-owned registries.
- **Trusted-source features stay rejected** until an explicit source-trust model
  exists. This includes all `trusted-*` scriptlets, `$replace`, `$uritransform`,
  `$urlskip`, `!#include`, and raw `$csp` directive values.
- **Synchronous blocking listener.** No `await`, storage read, DNS wait, or async
  engine reload in `webRequest.onBeforeRequest`.
- **Loop-free by construction.** Native iteration helpers only; `tools/check.js`
  enforces this across packaged scripts and tools.
- **Firefox-native boundary.** Raw `browser.*`/`chrome.*` calls stay inside
  `lib/wapi/`; background policy stays in the background chain.
- **Pinned load orders.** `manifest.json`, `lib/compile/compiler-worker.js`,
  `lib/background/engine-host.js`, `tools/test.js`, `tools/build.js`, and
  `tools/check.js` must stay in sync whenever a classic-script chain grows.
- **No user data collection.** `data_collection_permissions.required` remains
  `["none"]`; diagnostics and Inspector data stay local and in memory. Firefox
  ETP settings stay untouched, and ETP observations never affect filter
  decisions or counters.

## 1. Current baseline

Already implemented and verified in the shipped tree:

- Firefox MV2 background chain, `wapi` API boundary, named message router, native
  tabs/navigation/content-script/DNS/action adapters, and dynamic scriptlet
  registration.
- Engine module chains for network, cosmetic, procedural, and scriptlet parsing;
  compiled-filter cache with worker build and synchronous fallback; host trie,
  token index, decision cache, and safe regex subset.
- Network blocking with exceptions, `$important`, `$badfilter`, resource types,
  party/domain scoping, `$document`, `$popup`, CNAME uncloaking, curated
  `$redirect`/`$redirect-rule`, `$rewrite`/`$rewrite-rule`, `$csp`,
  `$removeparam`, and `$removeheader`.
- Domain-scoped HTML stream filtering through bounded UTF-8 selectors and safe
  response-header removal, with no counters, no request cancellation, and no
  filter-supplied code or header values.
- Cosmetic and procedural hiding with native-CSS compilation where possible,
  grouped selection, `MutationObserver` batching, `matchMedia` reapply, and safe
  XPath evaluation.
- Full non-trusted uBO `##+js()` and AdGuard `#%#//scriptlet()` alias coverage,
  canonicalized exceptions, one-WildFire-file-per-shim structure, and rejection
  of all trusted/debug aliases.
- Remote list store with the preshipped uAssets CDN default list, opt-in custom
  lists, metadata parsing, size/timeout checks, conditional fetches, and local
  offline fallback rules.
- Popup, Options custom-filter editor, per-site `allow`/`block` resource rules,
  local diagnostics, and a local-only request decision Inspector.

This baseline is deliberately narrower than uBO. The gaps below define the
roadmap.

## 2. Research basis

Behavior was reviewed from public uBO documentation and repository structure:

- uBO README and Firefox manifest: product scope, default list families, MV2
  permissions, Firefox-first behavior. uBO's floor is 128; WildFire keeps 153.
  Only decision gate D3 can add permissions; no Chromium/MV3 tokens are imported.
- `src/js` module inventory: static filtering parser/engine, filtering context,
  dynamic rules, HTML/header filtering, redirect resources, scriptlets, logger,
  dashboard, element picker, DOM inspector, trusted sites, diff updates, public
  suffix, and benchmarks.
- Wiki *Static filter syntax*: network options, modifier filters, static extended
  filters, action operators, HTML filters, response-header filtering, and
  scriptlet injection.
- Wiki *Dynamic filtering: quick guide* and *rule syntax*: source/destination/type
  rules with `block`, `noop`, and `allow`, local/global precedence, temporary vs
  persisted rules, and static-override semantics.
- Wiki *Procedural cosmetic filters*: remaining selectors and action behavior.

Only behavior and syntax were used. No upstream implementation was vendored or
used as a source file for WildFire code.

## 3. Gap map

| Area | uBO behavior still missing in WildFire | Route |
| --- | --- | --- |
| Static network syntax | HOSTS-file interpretation, entity host values, regex host/domain values, `$to`, `$denyallow`, `$top`, `$strict1p`, `$strict3p`, `$header`, `$method`, `$ipaddress`, `$permissions`, `$cname` exceptions, `$empty`/`$mp4`, redirect priority and standalone directives, broader curated redirect resources, `!#if`/`!#else`/`!#endif` | Phase 2 |
| Navigation semantics | uBO host-only entries imply strict document blocking; WildFire currently requires explicit `$document`/`$popup` | Decision gate D1 |
| Cosmetic scope | entity targets, regex host targets, specific-generic `*##selector`, generic DOM-surveyor behavior, action operators `:remove()`, `:style()`, `:remove-attr()`, `:remove-class()` | Complete (Phase 3) |
| Procedural selectors | `:matches-prop()`, `:others()`, `:watch-attr()`; richer mutation/attribute watching for those selectors | Complete (Phase 3) |
| Response filtering | `example.com##^selector` HTML stream filtering and `##^responseheader(name)` header removal; encoding handling and safe stream composition | Complete (Phase 4): bounded UTF-8 simple selectors and safe header set only |
| Dynamic filtering | global/local source-destination-type rules, `noop`, precedence, hostname-based rules, temporary vs persisted rules, plain-text “My rules”, full static override semantics | Complete (Phase 5): versioned state, one-time `siteRules` migration, distinct diagnostics phase |
| Filter lists | broader preshipped catalog, list categories, checksum/diff-patch updates, update status/history, asset viewer | Complete (Phase 6 list slice): grouped inert catalog, diff checksum validation, bounded history, local asset viewer |
| UI/tools | full dashboard, per-site switches, DOM inspector, element picker/zapper, context menu, keyboard shortcuts, advanced settings, richer logger views | Phase 6 |
| Scriptlet timing | realm-birth `set-constant` guarantees, hardened `MAIN` fallback, native exception propagation, `syncNativeScriptlets()` tests | Complete (Phase 7 native slice): non-packaged scaffold, realm-birth exceptions, payload sync tests; shipping still gated by D4 |
| Trust/source model | trusted aliases, `$replace`, `$uritransform`, `$urlskip`, `!#include`, raw `$csp` | Phase 7, gated |
| Cosmetic timing | `document_idle` injection can flash unhidden content before cosmetic CSS applies | Complete (Phase 3): `document_start` |
| Performance | parser fuzzing, benchmark thresholds, long-run memory profiling (the repeatable local compatibility corpus is in place) | Continuous |

Curated WildFire aliases for `$redirect`, `$rewrite`, and `$csp` are a deliberate
security boundary, not an accidental gap. Filter text still never supplies a
redirect URL, response body, header value, or script.

## 4. Recommended implementation order

### Phase 0 — Compatibility harness first

**Priority:** P0. **Depends on:** nothing.

- Add a local, WildFire-authored compatibility corpus covering every supported
  syntax family and every rejection class. Never vendor upstream filter text;
  audit external corpora only when needed and keep results outside the repo.
- Record a rule-family matrix in tests: input rule, expected accepted/rejected
  state, expected decision, and expected Inspector reason.
- Add or extend checks for load-order registries, manifest references, loop-free
  code, and the `wapi` boundary before each chain grows.
- Add a phase-specific smoke scenario for each engine capability as it lands.

**Exit criteria:** corpus runs in `npm test`; build/lint stay clean; no generated
or upstream filter text is committed.

### Phase 1 — Verify and document current feature truth (complete)

**Priority:** P0. **Depends on:** Phase 0.

- Reconciled `README.md`, `AGENTS.md`, and this roadmap with the exact implemented
  option set. The product is documented as a Firefox-native uBO rewrite, the
  message list includes `validate-filters`, `set-site-rule`, and
  `clear-site-rules`, and Options/suggested-list text matches `add-list`, which
  fetches immediately but leaves a new list disabled.
- Audited option/resource-type aliases (`css`, `frame`, `xhr`, `first-party`,
  `third-party`, `doc`, `ehide`, `ghide`, `shide`, and similar) and documented
  every accepted form; unknown options remain forgivingly ignored.
- Deferred-but-recognized options are no longer silent: they stay non-fatal
  blockers and produce `ignored` diagnostics plus `validate-filters` notices.
- Compiled schema is v14; every new IR field requires a version bump, and stale
  cache entries are rejected and rebuilt from text.

**Exit criteria:** documentation matches parser/engine behavior; validation
messages are stable and tested; cached compiled data from older schemas is
rejected.

### Phase 2 — Static network behavior completeness

**Priority:** P0. **Depends on:** Phase 1.

Scope, in dependency order:

1. HOSTS-file interpretation: a bare valid hostname behaves as `||host^` for
   resource matching; hostname-like patterns can still be forced to plain
   pattern semantics with a wildcard.
2. Entity and regex host values in targets, `domain=`/`from=`, `to=`, and static
   extended host lists, with negation and safe-regex validation.
3. `$to`, `$denyallow`, `$top`, `$strict1p`, `$strict3p`, and `$all` semantics.
   Implemented with destination/top-context scopes, strict exact-host party
   checks, order-independent `$all`, and line-numbered rejection reasons.
4. `$header`, `$method`, `$ipaddress`, and `$permissions`, reusing the existing
   `wapi-webrequest` header/stream plumbing and bounded CNAME cache; IP matching
   needs new bounded DNS-address state.
5. Redirect priorities, standalone `$redirect-rule` directives, `$redirect-rule`
   exceptions, `$empty`/`$mp4` aliases, `$cname` exceptions, and bare
   `$removeparam`. Expand the WildFire-owned redirect registry with curated
   empty audio/video/ad-manifest resources; no upstream resource bytes are
   copied.
6. `!#if`/`!#else`/`!#endif` with WildFire capability tokens only: Firefox is
   true, Chromium/MV3/adguard environment tokens are false, and capability
   tokens reflect real WildFire registries. `!#include` waits for the trust
   model.

**Files most likely touched:** `lib/engine/filter/parse-network.js`,
`lib/engine/filter/utils.js`, `lib/engine/filter/engine*.js`,
`lib/background/requests.js`, `lib/background/cname.js`,
`lib/wapi/wapi-dns.js`, `lib/wapi/wapi-webrequest.js`,
`lib/resources/redirect-resources.js`, `tools/test.js`, `README.md`.

**Exit criteria:** every accepted rule is matched in unit tests and visible in
the Inspector; every rejected rule has a line-numbered validation reason; the
blocking listener remains synchronous; all load-order registries stay in sync.

### Phase 3 — Cosmetic and procedural completeness (complete)

**Priority:** P0/P1. **Depends on:** Phase 2 for entity/regex host scope.

- Added entity and regex host targets for cosmetic and scriptlet rules through
  one shared host-scope parser; literal hosts stay in domain indexes and
  entity/regex scopes use pattern buckets.
- Implemented `*##selector` and `*##+js()` as bounded surveyor-style rules.
  `*##` is delivered only while a non-excepted domain-scoped cosmetic or
  procedural rule is live; the content-side scriptlet registry activates
  `*##+js()` only while a non-excepted domain-scoped scriptlet is live on that
  host. Exceptions remove the specific rule before the surveyor trigger is
  evaluated, and generic/hide exceptions still win.
- Added safe trailing action operators: `:remove()`, `:style()`,
  `:remove-attr()`, and `:remove-class()`. Declarations and names are validated
  data; URLs, comments, escapes, executable values, and non-trailing actions are
  rejected. Bare generic actions stay rejected; `*##` actions use the surveyor
  policy.
- Added `:matches-prop()` (bounded dot-separated property path with optional
  literal/regex value), `:others()` (bounded complement of the selected set),
  and `:watch-attr()` (pass-through attribute-change trigger with an optional
  attribute list) to the procedural chain, using the same native-prefilter-first
  strategy as existing selectors.
- Widened `MutationObserver` handling only when a live rule needs attribute or
  watched-attribute changes; text observation stays conditional on live text
  rules and `resize` binding stays conditional on `:matches-media()`.
- Moved the cosmetic content script from `document_idle` to `document_start`,
  with style nodes mounted as soon as `head`/`documentElement` exists. Manifest,
  test chain, and `tools/check.js` pin the earlier timing.
- Raised the compiled schema from v12 to v13 for surveyor and pattern buckets
  and added WildFire-authored corpus families, unit tests, and line-numbered
  validation coverage for every new accepted and rejected class.

**Exit criteria:** selectors are validated before CSS injection or DOM action;
malformed rules land in `engine.rejectedCosmetic`; generic exceptions and hide
modifiers still win correctly; no filter text becomes executable code.

### Phase 4 — HTML and response-header filtering (complete)

**Priority:** P1. **Depends on:** Phase 3 selectors and existing rewrite stream
infrastructure.

- Added `domain##^selector[,selector…]` and `#@^` exceptions as a separate
  `html` realm. Selectors are bounded, validated tag/id/class/attribute data;
  generic, specific-generic, procedural, oversized, and unsafe tags/selectors
  are rejected into `engine.rejectedCosmetic`.
- `engine.matchHtml()` applies domain/entity/regex scopes to document and
  subdocument responses only. Stream filters are created synchronously in
  `onBeforeRequest`; UTF-8 bodies are buffered to 2 MiB, transformed as data,
  and written back with stale length/encoding headers normalized. Filtering
  never cancels a request, changes counters, or runs filter text.
- Implemented `##^responseheader(name)` and `#@^` exceptions for only `location`,
  `refresh`, `report-to`, and `set-cookie` on document/subdocument responses.
  Security headers are never removable, and MIME type is preserved.
- Added `CAP.HTML`/`CAP.RESPONSE_HEADER` listener gating, `htmlRules` and
  `counts.html`, compiled schema v14 serialization/revalidation, Inspector
  `html`/`responseheader` phases, WildFire-authored corpus cases, and unit/runtime
  coverage for streams, exceptions, limits, pause behavior, and header safety.

**Exit criteria:** stream filters are created synchronously in
`onBeforeRequest`; body/header outcomes appear in Inspector diagnostics;
navigation counters and pause/site-rule semantics remain unchanged; no page code
is derived from filter text.

### Phase 5 — Dynamic filtering model (complete)

**Priority:** P1. **Depends on:** Phases 2–4 for override targets.

- Introduce a versioned dynamic-rule state that supports global and local rules
  of the form `source destination type action`, with `block`, `noop`, and
  `allow`.
- Preserve current per-site `allow`/`block` resource rules as a migration input;
  do not silently drop existing user state.
- Implement rule precedence: more specific source/destination rules override
  broader type rules; local rules override global rules; `noop` cancels dynamic
  filtering only; `allow` overrides static blockers and WildFire handling for
  the matched scope.
- Make rules temporary by default with explicit persistence, and add a
  plain-text “My rules” surface.
- Extend diagnostics so dynamic decisions are distinguishable from static
  network decisions.

Decision gate D1 applies here: uBO-style strict navigation blocking requires an
explicit product decision before changing the current “only `$document`/`$popup`
blocks navigation” rule.

**Exit criteria:** precedence tests cover local/global, hostname/type, and
`block`/`noop`/`allow`; existing `siteRules` migrate safely; dynamic `allow`
does not accidentally re-enable filter-supplied code paths.

Completed with versioned `dynamic` state in `wildfire.state.v1`, one-time
`siteRules` migration, source/destination/type precedence, temporary popup
rules with explicit persistence, a plain-text My rules surface in Options, and
a distinct `dynamic` diagnostics/Inspector phase. The blocking listener remains
synchronous and navigation rules remain ignored under decision gate D1.

### Phase 6 — Lists, catalog, and UI/tools

**Priority:** P1/P2. **Depends on:** parser/engine phases for list correctness.

- Expanded the inert suggested catalog with grouped ads, privacy, malicious,
  social, and regional shortcuts; no list text is vendored.
- Added checksum-validated `! Diff-Path` updates with full-fetch fallback,
  bounded update history, and a read-only local viewer for curated registries.
- Build out the dashboard with clear panes for filter lists, custom rules,
  dynamic rules, trusted sites (status/rejection explanation), settings, and
  support.
- Add per-site switches, element picker/zapper, DOM inspector, context-menu
  actions, keyboard shortcuts, and richer logger filters using `wapi-client`
  only.
- Any new permission (`menus`, `privacy`, `unlimitedStorage`) is a separate
  decision and requires matching `tools/check.js` assertions and docs.

**Exit criteria:** UI reads and writes only through `wildfire:*` messages;
user-visible strings are WildFire-branded; no upstream branding appears in UI;
`data_collection_permissions.required` stays `["none"]`.

The list/catalog slice is complete: Options groups suggested shortcuts, shows
per-list status and bounded history, and opens a local asset viewer through
`wildfire:asset-registries`. The dashboard/tools and context-menu/shortcut work
in this phase remains deferred; no new permission was added.

### Phase 7 — Trust-gated features and native realm birth

**Priority:** trust work deferred; native scaffold slice complete. **Depends on:**
explicit product/source-trust decision before any trust-gated syntax.

The non-packaged FOSS bridge slice is complete and tested:

- Realm-birth `set-constant` entries and their exceptions travel together, so
  `#@#+js(set-constant, …)` cancels the native entry before the first page
  script. Surveyor entries stay gated by a live domain-scoped rule.
- `syncNativeScriptlets()` was covered for canonical generation/hash payloads,
  empty-payload clearing, and full `document_start` fallback on bridge failure.
- Both scaffold layers revalidate data-only payloads; the parent preserves the
  surveyor marker and rejects trusted or realm-unsafe aliases.
- `docs/native-global-integration.md` now describes the tested scaffold state.
  The stock extension keeps its `document_start` fallback and never ships
  `browser/`. Shipping the bridge still needs D4 owner approval.

Still deferred until a written source-trust model and owner approval exist:

- Distinguish trusted list origin and trusted local input in state.
- Reconsider `trusted-*` aliases, `$replace`, `$uritransform`, `$urlskip`,
  `!#include`, and raw `$csp` directive values.
- Harden any `world: "MAIN"` mitigation with a non-page-visible trampoline;
  treat it as best-effort `document_start`, never proof of realm birth.
- Real-Firefox smoke validation of the privileged `Debugger` hook before D4.

**Exit criteria for the full phase:** a written trust model, explicit owner
approval, independent validation in both layers, and no regression to
stock-Firefox behavior.

### Continuous — Performance, privacy, and verification

Run for every phase:

- `npm test`, `npm run build`, and
  `web-ext lint --source-dir . --output text` with zero errors/warnings.
- Local compatibility corpus and focused tests for each changed syntax family.
- Real-site smoke (`npm run smoke:rules`, `npm run smoke:site`) after engine or
  UI changes; report counters, diagnostics, and Inspector decisions.
- Benchmark request decision cost and cosmetic/scriptlet startup before and
  after large phases; keep caches bounded and deterministic.
- Confirm no raw `browser.*` outside `lib/wapi/`, no hand-written loops, no
  `dist/` or `node_modules/` changes, and no upstream text or source vendored.

## 5. Decision gates

| Gate | Decision needed | Default until decided |
| --- | --- | --- |
| D1 | Whether bare-host/`||host^` rules may cancel top-level navigation like uBO strict blocking | Keep explicit `$document`/`$popup` only |
| D2 | Whether any list source is trusted enough for code-like modifiers | Reject all trusted-only aliases and modifiers |
| D3 | Whether to add `menus`, `privacy`, or `unlimitedStorage` for UI/list scale | Keep current permission set |
| D4 | Whether to ship a FOSS/custom Firefox native bridge for realm-birth scriptlets | Keep bridge as a tested, non-packaged prototype only |

## 6. Definition of done for any roadmap item

A feature is complete only when all of these are true:

1. WildFire-owned implementation, tests, and docs are in the same change.
2. Public syntax is documented in `README.md`; internal invariants are in
   `AGENTS.md` if they become load-bearing.
3. All pinned load-order registries are updated together.
4. Rejected input has a stable reason in validation and local diagnostics.
5. The blocking listener remains synchronous and no async capability lookup
   affects a filter decision.
6. Inspector records the decision without changing counters.
7. Verification gates pass with zero errors and zero warnings.
8. No upstream source, asset, build script, or filter text was copied into the
   repository.

## 7. Immediate next actions

1. Build the local compatibility harness and current-truth matrix (Phase 0).
2. Implement HOSTS-file interpretation and entity/regex host scope (Phase 2
   steps 1–2), including strict-blocking decision gate D1 documentation.
3. Implemented `$to`, `$denyallow`, `$top`, strict party options, and `$all`
   (Phase 2 step 3) with Inspector and validation tests.
4. Implement Phase 2 steps 4–6 with WildFire-owned registries and trusted-source
   gates where required.

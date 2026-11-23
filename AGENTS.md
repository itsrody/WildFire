# AGENTS.md — WildFire, the complete guide

Read this before touching code. It defines what the product is, why it exists,
how the pieces fit together, the conventions that decide whether a change is
good, and the checks that prove it.

---

## 1. The goal (load-bearing)

**WildFire is uBlock Origin rewritten from scratch to be 100% Firefox native,
under a new brand: WildFire.**

That sentence is the constitution of this repo. Unpack it:

- **uBO rewritten from scratch.** We reimplement uBO's *ideas* — network
  filtering with exceptions, domain/wildcard matching, element hiding, a
  counter, per-site controls — in original code. This is **not** a fork, a
  repackaging, a minified copy, or a port of uBO source. No upstream uBO code,
  assets, filter engines, or build scripts may be copied into this tree. If a
  behavior is needed, write it here.
- **100% Firefox native.** Firefox is the only target. The manifest uses
  Firefox's `browser_specific_settings`, the code uses the promise-based
  `browser.*` API, and there is no Chrome target, no `chrome.*` shim, no
  cross-browser abstraction layer, and no MV3 fallback. Do not add Chromium
  compatibility code or a manifest fork "just in case".
- **New brand: WildFire.** Name, icon, colors, storage keys, message names, and
  artifact names are WildFire's. Do not leave uBO branding in user-visible
  text, comments, or filenames. Flame icon; primary orange `#e2511d`, accent
  `#ff8a4c`, inner flame `#ffd257`, dark UI `#16181d`.

**Non-negotiable platform floor:** Manifest V2,
`browser_specific_settings.gecko.strict_min_version = "153.0"` (the current
ESR line). Firefox 153 is why MV2 is viable here: it still supports
`webRequestBlocking`, which is the model uBO's blocking engine needs. Do not
raise, lower, or remove the floor, and do not migrate to MV3 without an
explicit product decision from the owner.

**Honest scope.** "Rewritten from scratch" is the *direction*, not a claim of
feature parity today. The current engine is deliberately minimal (§5). Grow it
in the WildFire style; never close a gap by importing upstream code.

---

## 2. Repo shape

```
manifest.json          MV2 manifest; gecko floor 153.0; all permissions
background.js          blocking listener, counters/badge, message API
lib/filter-engine.js   filter parser + matcher (self-contained, no deps)
lib/document-scope.js  documentId -> document URL cache for request scope
lib/redirect-resources.js  WildFire-owned data-URI redirect resources
lib/csp-resources.js   curated CSP directives for $csp response headers
lib/scriptlets.js      WildFire-owned scriptlet aliases (no filter-supplied code)
lib/rewrite-resources.js  WildFire-owned bodies for $rewrite responses
lib/procedural.js      DOM-based procedural cosmetic evaluator (no browser APIs)
lib/remote-lists.js    opt-in remote list store, key wildfire.remote.v1
lib/store.js           browser.storage.local wrapper, key wildfire.state.v1
content/cosmetic.js    injects hidden-element CSS in every frame
filters/default.txt    bundled starter rules (~85 network rules)
popup/                 toolbar popup (status, counter, pause controls)
options/               custom filters, paused sites, remote lists, stats reset
assets/                generated PNG icons (16/32/48/96/128)
tools/                 icon generator, validator, tests, XPI packager
dist/                  generated XPI — ignored, never reviewed or committed
docs/                  design notes for non-shipped architecture explorations
AGENTS.md, README.md   this guide and the user-facing overview
```

Everything is plain ES2015+ JavaScript in classic scripts. There is no module
bundler, no transpiler, no npm dependencies, and no runtime build step. Node is
used **only** by `tools/`.

---

## 3. Runtime architecture

### Loading order (manifest `background.scripts`)

1. `lib/store.js` → `window.WildFireStore`
2. `lib/filter-engine.js` → `window.FilterEngine`, `window.mapResourceType`
3. `lib/document-scope.js` → `window.DocumentScope`
4. `lib/redirect-resources.js` → `window.RedirectResources`
5. `lib/remote-lists.js` → `window.RemoteLists`
6. `lib/csp-resources.js` → `window.CspResources`
7. `lib/scriptlets.js` → `window.WildFireScriptlets`
8. `lib/rewrite-resources.js` → `window.RewriteResources`
9. `background.js` → the engine instance and all listeners

Content scripts load in this order: `lib/procedural.js` → `content/cosmetic.js`,
so the DOM evaluator exists before the content script runs.

Libraries export by attaching to `this` (the window/global in a classic
script). Keep that pattern; do not introduce imports, `export`, or a module
graph without a deliberate redesign.

### Request blocking (hot path)

`webRequest.onBeforeRequest` is registered with `{urls:['<all_urls>']}` and
`['blocking']`, so **the listener must be synchronous**:

- Skip when `state.enabled` is false, or when the tab's popup was already
  closed by `$popup`.
- Resolve the document URL through `DocumentScope`: `details.documentUrl`,
  then `details.originUrl`, then the URL cached by `documentId` from
  `webNavigation`/`webRequest`, then the tab URL, then the last frame ancestor.
- Skip if the document host is in `state.disabledSites` (exact or subdomain).
- Map `details.type` through `mapResourceType`, then call
  `engine.matchRequest(url, type, documentUrl)`.
- On a block: increment `state.blocked`, refresh the badge, schedule a
  debounced stats save (1.5 s), return `{cancel:true}` — or `{redirectUrl}` when
  the rule has `$redirect`/`$redirect-rule` and the alias resolves to a
  WildFire-owned data-URI resource. When the rule has `$rewrite`, create a
  `filterResponseData()` stream filter **synchronously**, discard the original
  chunks, and write the curated WildFire body on `onstop`; `onHeadersReceived`
  then drops length/encoding headers and sets the resource's MIME type. Return
  no blocking response so the request continues with the substituted body.
  Navigations are never redirected or rewritten, and an unknown alias falls
  back to a cancel.
- Exceptions (`@@`) always win; the engine returns early on the first match.

**Never make the blocking listener async.** Engine state lives in memory and
is rebuilt from `filters/default.txt` plus `customFilters` at startup; storage
reads happen only in `init()` and message handlers. Top-level navigations only
match rules with an explicit `$document` or `$popup` option, so plain network
rules cannot cancel navigation. `$popup` is evaluated from
`webNavigation.onCreatedNavigationTarget`; a match closes the new tab with
`browser.tabs.remove()` and counts one block, with the tab id added to
`blockedPopups` so the later `main_frame` request is not counted twice.

### Engine shape

`FilterEngine.load(text)` resets and rebuilds four indexes:

- `hostRules: Map<host, rule[]>` for `||host^` rules, keyed by the pattern's
  leading host (looked up against the request hostname and all its parents).
- `tokenRules: Map<token, rule[]>` for generic rules, keyed by a few 4-character
  tokens from each required literal chunk; `unindexedRules: rule[]` holds
  patterns with no usable token. Candidates are the union of host, token and
  fallback matches, sorted by load order before exception/blocker selection.
- `cosmeticByDomain` / `cosmeticExceptionsByDomain: Map<domain, selector[]>`
  plus `genericCosmetic` / `genericCosmeticExceptions`.
- `scriptletRules`/`rejectedScriptlets` for `##+js(alias, args)` rules.
- `counts: {network, exceptions, cosmetic, csp, scriptlets, rewrite}` for the UI.

`FilterEngine` accepts injected registrable-domain, CSP, scriptlet and rewrite
resolvers so the engine stays self-contained and unit-testable. Background
supplies Firefox 153's synchronous `browser.publicSuffix.getDomain()` (with IP,
plain-suffix and unknown-suffix lookups enabled), `CspResources.resolve()`,
`WildFireScriptlets.validate()` and `RewriteResources.hasAlias()`. The engine
falls back to a last-two-label scope when no domain resolver is given or a
lookup fails, and rejects `$csp`, `##+js()` and `$rewrite` rules when their
registry is unavailable. Never call `browser.*` from `lib/filter-engine.js`.

`matchRequest()` returns `redirect: {alias, captures}` when the winning rule
carries `$redirect` or `$redirect-rule`. `RedirectResources.resolve()` is the
only place redirect targets are defined: it serves WildFire-authored `data:`
URIs, fills `{{1}}`–`{{9}}` placeholders from regex captures with
percent-encoding, and returns `''` for unknown aliases so the listener falls
back to a cancel. Filter text can never supply a redirect URL itself.

`matchRequest()` also returns `rewrite: {alias}` for the winning `$rewrite`
rule. `RewriteResources.resolve()` is the only place substitute bodies and MIME
types are defined; it returns a copied `Uint8Array` so no caller can mutate the
registry. Background creates the stream filter from `onBeforeRequest`,
normalizes headers through `RewriteResources.withHeaders()` in the existing
blocking `onHeadersReceived` listener, and lets `onCompleted`/`onErrorOccurred`/
`onBeforeRedirect` forget the request id. Unknown aliases are rejected at load
time into `engine.rejectedRewrite` instead of becoming blockers. `$rewrite` does
not accept captures (`$rewrite-rule` is not supported), never applies to
navigations, and counts as one filtered/blocked request. Filter text can never
supply a response body.

`matchCsp()` is the response-header counterpart: any applicable `@@` exception
stops injection, otherwise all matching curated directives are returned once
each. `$csp` rules are excluded from `matchRequest()` so they never cancel
requests. `CspResources.resolve()` is the only place CSP directive values are
defined; an unknown alias is rejected at load time into `engine.rejectedCsp`
rather than becoming a blocker. Background calls the synchronously registered
`webRequest.onHeadersReceived` listener with `['blocking', 'responseHeaders']`
and appends the directives as extra enforcing `Content-Security-Policy`
headers without touching the site's own headers. CSP report requests are
skipped. Filter text can never supply a header value itself.

`getScriptletPayload()` returns plain `{alias, args, domains, isException}`
data. Background registers `lib/scriptlets.js` through Firefox's
`browser.contentScripts.register()` at `document_start` with
`['<all_urls>']`/all frames, and injects only a JSON payload through the
registered `code` step. There is no `eval`, no `Function`, and no filter-sourced
script anywhere; `WildFireScriptlets.apply()` revalidates every entry, resolves
domains against `location.hostname`, and lets `#@#+js()` cancel the matching
alias/arguments. Registrations are replaced whenever the engine reloads, and
only future navigations receive updated scriptlets.

`getCosmetic(host)` merges generic selectors with every parent-domain selector
and subtracts applicable exceptions. `content/cosmetic.js` asks for them once
on load via `wildfire:cosmetic` and re-applies on `wildfire:apply` broadcasts;
it validates each selector with `CSS.supports('selector', …)` and
`document.querySelector` before injecting a `<style id="wildfire-cosmetic">`.

Procedural selectors (`:has-text()`, `:contains()`, `:matches-path()`, `:has()`,
`:nth-ancestor()`) are parsed in `lib/filter-engine.js` into trees with `base`
plus ordered `steps`; malformed or unsafe ones are recorded in
`engine.rejectedCosmetic` and never sent to pages.
`getProcedural(host)` merges generic and domain trees and subtracts `#@#`
exceptions. Background sends them in the same `wildfire:apply` message as CSS.

`WildFireProcedural.classify()` picks the cheapest Firefox-native route per
rule. `:matches-path()` is a page constant, so it is matched once per apply and
dropped from the node steps; non-matching rules are skipped entirely. Plain
`:has()` steps are compiled to CSS and validated with `CSS.supports`, so Gecko
handles them in `#wildfire-cosmetic-procedural` with no JS re-evaluation. When
text steps remain, every `:has()` inner tree contributes its plain base as a
native `:has()` **prefilter** on the `querySelectorAll` call. `selectAll()` groups
rules sharing a base (or prefilter) into one query pass instead of one per rule.
Only the remaining text-dependent rules hide nodes via `data-wildfire-hidden`,
and the attribute is diffed so unchanged nodes are never touched.
`:has-text()` checks an element's own text nodes; `:contains()` also searches
descendants. Both share the safe literal/regex matcher. `:nth-ancestor(n)` is a
transforming step: the rule hides the nth parent of a match instead of the
match itself, so `targetOf()` returns the final node to hide.
`content/cosmetic.js` schedules re-applies with `requestAnimationFrame` to merge
multiple `MutationObserver` batches per frame, and only observes `characterData`
when a live rule actually depends on text. Filter text is never executed.

### State and messages

Storage key `wildfire.state.v1` holds `{enabled, blocked, customFilters,
disabledSites}`. `persist(patch)` merges into the in-memory copy and writes a
**full snapshot** — do not write partial objects directly, or parallel message
handlers will clobber unrelated fields. Storage key `wildfire.remote.v1` holds
`{lists: [{url, enabled, autoUpdate, etag, lastModified, text, updatedAt, hash}]}`
and is owned entirely by `lib/remote-lists.js`.

Background listens for `wildfire:*` messages:

| Action | Purpose |
| --- | --- |
| `state` | snapshot + active-tab `{url, host, disabled}` |
| `toggle` | flip global `enabled` |
| `toggle-site` | add/remove a host in `disabledSites` |
| `set-filters` | save custom filters, reload engine, refresh cosmetics |
| `reset-stats` | zero the blocked counter |
| `reload` | rebuild from bundled + custom + enabled remote filters |
| `list-state` | return registered remote lists |
| `add-list` | register an http(s) list URL, disabled and unfetched |
| `remove-list` | forget a list and stop applying its rules |
| `update-list` | explicitly fetch/revalidate one list |
| `set-list-enabled` | apply or stop a fetched list |
| `set-list-auto` | opt a fetched, enabled list into daily checks |
| `cosmetic` | return selectors for a URL |

`state`-only fields are not on other responses. The popup keeps the tab info
it got from `state` and merges it into later responses (`applyResult`); keep
that behavior when adding popup actions.

Remote lists are strictly opt-in. No URL is bundled, `add-list` never fetches,
and a list cannot be enabled until an explicit `update-list` has stored text.
`lib/remote-lists.js` fetches with `cache: 'no-store'`, a size cap and an
`AbortController` timeout; a 304 keeps the stored text but refreshes the check
time. The exact text and its hash are persisted so the applied rules are
reproducible. `loadFilters()` composes bundled → custom → enabled remote text,
and exceptions still win over blockers. Daily checks exist only for lists whose
owner opted in via `set-list-auto`; the `alarms` permission supports that one
named alarm. Because nothing is collected or sent about the user and no list is
fetched before consent, `data_collection_permissions.required` stays `["none"]`.

---

## 4. UI conventions

- Dark theme with system font stack; popup is a fixed 330 px panel, options is
  a centered 760 px page. Reuse the existing CSS variables/colors rather than
  inventing a second palette.
- Popup and options are classic scripts (no framework). They talk to the
  background **only** through `browser.runtime.sendMessage` — never read
  `browser.storage` or the engine directly.
- Keep user-facing strings branded WildFire, and keep the Firefox 153 / ESR
  note where it currently appears.

---

## 5. Filter language — supported vs. out of scope

| Supported | Not supported (yet) |
| --- | --- |
| `||host^` domain anchors, subdomains | `$rewrite-rule` |
| `|url|` start/end anchors | `elemhide`, `generichide`, `ghide` |
| `*` wildcards, `^` separator | other advanced selectors |
| `@@` exceptions | full EasyList-scale list curation |
| `$script`, `$image`, `$~type`, other resource types | `domain=` with wildcard `.*` patterns |
| `$third-party`, `$~third-party` | full EasyList-scale performance tuning |
| `$domain=a\|~b` (`from=` alias) | |
| `$document`, `$popup` | |
| `$redirect=alias`, `$redirect-rule=alias` | |
| `$rewrite=alias` (curated aliases only) | |
| `$csp=alias` (curated aliases only) | |
| `/regex/` filters (`i`, `m`, `s`, `u` flags only) | |
| `##selector`, `#@#selector` | |
| `##sel:has-text("…")`, `##sel:matches-path(/re/)`, `##sel:has(sel)` | |
| `##sel:contains("…")`, `##sel:nth-ancestor(n)` | |
| `domain##+js(alias, args)` (curated aliases only) | |
| `domain#%#//scriptlet('alias', 'args')` (AdGuard, string-only) | AdGuard trusted/debug aliases |

Regex filters are checked at load time. Backreferences, nested or alternated
quantifiers, excessive quantifier/group counts, long patterns and stateful
flags (`g`, `y`, `d`) are rejected into `engine.rejectedRegex` and never reach
the blocking listener. Regex rules bypass the token index and are evaluated on
URLs up to 8192 characters.

Redirect rules name an alias from `lib/redirect-resources.js`: `noopjs`,
`noopcss`, `nooptext`, `noopjson`, `noophtml`, `1x1.gif`, `1x1.png`,
`tagged.svg`. `$redirect-rule` uses regex captures to fill that resource's
`{{1}}`–`{{9}}` placeholders; captures are percent-encoded before insertion.
An unregistered alias cancels instead. No upstream resources are bundled.

`$rewrite=alias` replaces a matching response body through Firefox's
`webRequest.filterResponseData()` stream filter. The only aliases are
`blank-js`, `blank-css`, `blank-text`, `blank-json`, `blank-html` and
`blank-image` from `lib/rewrite-resources.js`; each maps to a fixed MIME type
and WildFire-authored bytes. Unknown aliases are rejected into
`engine.rejectedRewrite` at load time instead of becoming blockers. Rewrites
honor the usual type/domain/third-party options and `@@` exceptions, never
apply to navigations, and count as one filtered request. `$rewrite-rule` and
filter-supplied bodies are not supported.

`$csp` rules name an alias from `lib/csp-resources.js`: `no-script`,
`no-inline-script`, `no-frame`, `no-worker`, `no-object`, `no-font`, `no-media`,
`no-connect`. Each resolves to a fixed directive that can only tighten a
response. Unknown aliases are rejected into `engine.rejectedCsp` instead of
becoming blocking rules, so a filter can never supply a header value or a
weaker policy. `$csp` accepts the same type/domain/third-party options as
network rules, and applies to main documents without `$document`.

Scriptlet rules use `##+js(alias, args)` and may be scoped by comma-separated
domains or negated with `#@#+js(...)`. The registry in `lib/scriptlets.js` owns
one canonical alias per behavior plus uBO short aliases (`aopr`, `acs`, `set`,
…); the engine canonicalizes names so an exception matches either spelling.
Arguments are validated data: plain dotted property paths, fixed constant tokens
(`true`, `false`, `null`, `undefined`, `0`, `1`, `emptyObj`, `emptyArr`,
`emptyStr`), and safe literal/regex "needles" using the same conservative regex
subset as network filters. Bad aliases, wrong arity, unsafe regexes, injected
code, unterminated rules and every `trusted-*` alias go into
`engine.rejectedScriptlets`. A `#@#` exception cancels the same alias/arguments
on matching domains. The catalog covers the phases in §8. AdGuard
`[domains]#%#//scriptlet('alias', 'arg', ...)` rules are parsed into the same
payload with string-only arguments and validated in `lib/scriptlets.js`'s
AdGuard registry; `#@%#//scriptlet()` cancels the same rule. No filter can
supply script text.

Procedural cosmetic rules are parsed into a base selector plus ordered steps.
`:has-text()` and `:contains()` accept a quoted literal (case-insensitive) or a
`/regex/` with the same safe subset as network regexes; `:contains()` also
searches descendants. `:matches-path()` takes a `/regex/` checked against
`location.pathname + location.search`; `:has()` accepts another plain or
procedural selector and can be nested up to eight levels; `:nth-ancestor(n)`
accepts 1–8 and hides the nth parent of a match. Invalid rules land in
`engine.rejectedCosmetic`. Evaluation lives entirely in `lib/procedural.js` and
`content/cosmetic.js` — never in injected script.

Add new syntax by extending `lib/filter-engine.js` **and** `tools/test.js` in
the same change. `README.md` gets a syntax-table row when the feature is
user-visible.

---

## 6. Working rules

1. **Firefox only.** Use `browser.*` promise APIs. No `chrome.*`, no callback
   wrappers, no polyfills, no "cross-browser" conditional code.
2. **Zero runtime dependencies.** Adding a package means it must be dev-only
   and justified; the extension itself stays dependency-free.
3. **No upstream code.** Do not fetch, vendor, adapt, or paste uBO source.
   Reading public filter-list syntax docs is fine; copying implementations is
   not.
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
    line that starts an explicit loop, in runtime code *and* tools.

---

## 7. Verification — required before every commit

```sh
npm test          # vm-based engine unit tests (matching, options, cosmetics)
npm run build     # runs check.js, then writes dist/wildfire-<v>-firefox-153.0.xpi
web-ext lint --source-dir . --output text
```

The bar is: tests pass, build succeeds, `web-ext lint` reports **0 errors and
0 warnings**. `tools/check.js` asserts MV2, the 153.0 floor, the gecko id,
data-collection disclosure, the `publicSuffix` and `webNavigation` permissions,
every manifest-referenced file, `node --check` on all scripts, and the loop-free
rule across every `.js` file (including tools).
If any of those change, update the check in the same commit.

For manual testing: `npm run dev` (or load `manifest.json` through
`about:debugging → This Firefox → Load Temporary Add-on`). Exercise blocking
on a real page, the popup counter/toggles, custom filters in Options, and
cosmetic hiding.

---

## 8. Where to extend next

The scriptlet catalog covers both uBO `##+js()` and AdGuard
`#%#//scriptlet()` syntax. It grew as a phased expansion of the registry in
`lib/scriptlets.js`; every alias lands with a validator, an original
implementation, tests, and a README row. Keep these load-bearing rules:

- **No upstream code.** Public syntax docs are fine; copying or adapting uBO or
  AdGuard source is not. Write every implementation here.
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

Phase 2 — AdGuard syntax (implemented):

4. `[domains]#%#//scriptlet('name', 'arg', …)` and `#@%#//scriptlet()`
   exceptions are parsed into the same payload, validated by the AdGuard
   string-only registry, and mapped to WildFire canonical behaviors. AdGuard
   trusted and debug-only scriptlets stay rejected under the same rules as uBO
   `trusted-*`.

Already implemented and tested: Firefox-native registrable-domain scoping
(`publicSuffix`), `documentId`-keyed request scope, the 4-character token index,
safe regex filters, wider resource types with `$document`/`$popup`, a
from-scratch redirect engine with WildFire-owned data-URI resources, DOM-based
procedural cosmetic selectors (including native-CSS compilation, `:contains()`,
and `:nth-ancestor()`), opt-in remote lists with a deterministic update store
and user consent, curated `$csp` response-header filtering on Firefox's
`onHeadersReceived`, fixed-mapping `$rewrite` response bodies through Firefox's
`filterResponseData()` stream filter, and a scriptlet alias registry injected at
`document_start` through Firefox's `contentScripts.register()`. Phase 1A, 1B and
1C are implemented: canonical short aliases, safe needles, property traps,
eval/timer/event/window defusers, DOM/storage aliases, `json-prune` with
wildcard paths, response transforms, JSONPath/edit aliases, fetch/XHR guards and
the detector defusers. All non-trusted uBO general-purpose and defuser aliases
are covered. Phase 2 AdGuard syntax is implemented: quoted string-only aliases
are parsed into the same payload, validated in a separate AdGuard registry,
mapped to WildFire canonical behaviors where possible, and rejected when
trusted or debug-only.

Do not start a later item while an earlier one is only half-implemented. A
small, correct, fully tested engine is the product.

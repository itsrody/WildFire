# WildFire

A minimal, **uBO-inspired** content blocker built from scratch for Firefox using a
clean-room approach: public filter-syntax docs, Gecko/WebExtensions docs, and
upstream source read for inspiration inform the behavior, while the architecture,
code, registries, and assets are WildFire's. No vendored upstream source, no npm
dependencies, no cross-browser shim, and no build framework — just Firefox-native
WebExtensions APIs and a small filter engine.

- **Manifest:** MV2 (`manifest_version: 2`)
- **Firefox floor:** `strict_min_version: "153.0"` (current ESR line)
- **Engine:** network blocking + exceptions, domain/wildcard matching, cosmetic hiding
- **Style:** promise-based `browser.*` through WildFire `wapi` modules; no hand-written
  JS loops, no callback bridges, no generic compatibility layer

## Layout

```
manifest.json          Firefox MV2 manifest, gecko floor 153.0
background.js          thin bootstrap for the background controller
lib/wapi/              Firefox-native API backbone: wapi, contexts, background, router, tabs, webrequest, action, capabilities, dns, client
lib/background/        background chain: CNAME cache, helpers, engine lifecycle, logger, requests, messages, controller
lib/engine/            filter engine module chain (filter/), procedural DOM evaluator
lib/compile/           filter compiler, worker, compiled-filter cache
lib/resources/         curated scriptlet / CSP / redirect / rewrite registries
lib/state/             storage wrapper, preshipped + remote lists, per-tab/frame page state
content/cosmetic.js    injects hidden-element CSS, re-applies on demand
filters/default.txt    bundled starter rules
ui/popup/              toolbar popup with inspector buttons
ui/options/            custom filters + paused sites
ui/inspector/          local-only request decision window with logger-ui renderer
assets/                generated PNG icons
tools/                 icon generator, validator, tests, XPI packager, Firefox smoke tools
dist/                  build output (generated)
```

## Run it

Load the directory as a temporary add-on:

```sh
npm run dev
# or: web-ext run --source-dir .
# or: about:debugging -> This Firefox -> Load Temporary Add-on -> manifest.json
```

Requires Firefox or Firefox ESR **153 or newer**; older versions will refuse to install.

## Rule-performance smoke

Run every supported rule family against a real Firefox instance:

```sh
npm run smoke:rules
# optional: -- --firefox /path/to/firefox --headed --filler 2000 --out report.json
```

The tool builds a temporary WildFire copy with locally authored benchmark rules,
loads it through `web-ext`, and reports blocking, redirect, rewrite, CSP,
parameter/header removal, cosmetic, procedural, and scriptlet outcomes alongside
engine counts, diagnostic phase timings, and per-request Inspector durations.
Remote auto-updates are disabled in the smoke copy so measurements are local.
The smoke copy registers scriptlets in the main world so page-visible defusers
can be measured; XPath hide state is reported as a diagnostic because Gecko
evaluates node-context XPath in the content-script world.

## Real-site smoke

Run WildFire against a live site with the shipped remote lists enabled:

```sh
npm run smoke:site
# optional: -- --url https://www.youtube.com --firefox /path/to/firefox --navigations 5 --run-ms 10000 --out site.json
# fixed video: -- --url https://www.youtube.com --video kHW-UVXOcLU --out site.json
```

The tool opens the URL in a headed Firefox window by default (use `--headless`
to opt out), waits for the preshipped remote list to load, and reports navigation
timing, resource totals, engine counts, diagnostic phase totals, Inspector
decisions, cosmetic/scriptlet timings, and remote-list state. On YouTube it
follows randomly chosen watch links for `--navigations` pages (default 3) and
reports per-page deltas. Pass `--video VIDEO_ID` to navigate from the starting
page to one fixed watch URL in the same tab. Scriptlet timings reflect the
rules active at each navigation start.

## Counters

The toolbar badge and popup count requests blocked on the active tab's site
(registrable domain), so `www.example.com` and `shop.example.com` share one
count. Each tab has its own badge, updated when you switch tabs or navigate.
Options shows the lifetime total; **Reset stats** clears both the total and all
site counters.

## Build the XPI

```sh
npm run check   # manifest + JS syntax validation
npm run build   # writes dist/wildfire-0.1.0-firefox-153.0.xpi
```

The XPI is a plain ZIP, so it is unsigned. For local installs use `about:debugging`
or set `extensions.autoDisableScopes`/`xpinstall.signatures.required` in a dev profile.

To regenerate icons after changing `tools/make-icons.js`:

```sh
npm run icons
```

## Filter syntax

The bundled `filters/default.txt` is an offline fallback, not the registered
default list. Add your own rules in the options page (one per line). The native
editor shows line numbers, caret position, rule coloring, unsaved changes and
line-numbered validation issues from WildFire's own parser; `Ctrl/Cmd+S` saves.

| Rule | Meaning |
| --- | --- |
| `||ads.example.com^` | Block that host and its subdomains |
| `|https://example.com/ad|` | Match a URL from its start/end |
| `example.org*banner.gif` | Wildcard match |
| `/ads\.example\.com\/track$/` | Regular-expression match (safe subset) |
| `@@||ads.example.com^` | Allow requests that would otherwise be blocked |
| `@@/keep\.example\/ad/` | Regular-expression exception |
| `@@||tracker.net^$elemhide` | Keep all elements visible on matching documents (`ehide`, exception-only) |
| `@@||tracker.net^$generichide` | Keep generic cosmetic rules from applying (`ghide`, exception-only) |
| `@@||tracker.net^$specifichide` | Keep domain-specific cosmetic rules from applying (`shide`, exception-only) |
| `||tracker.net^$script` | Only block scripts |
| `||tracker.net^$~image` | Block everything except images |
| `||tracker.net^$all` | Match every resource type, overriding earlier type filters |
| `||tracker.net^$match-case` | Make the pattern case-sensitive |
| `||tracker.net^$third-party` | Only block cross-site requests |
| `||tracker.net^$domain=site.com\|~good.site.com` | Only on matching document hosts |
| `||tracker.net^$from=site.com` | `domain=` alias |
| `||tracker.net^$domain=site.*` | Match document hosts with any suffix |
| `||tracker.net^$domain=*.site.*` | Match subdomains with any suffix |
| `||landing.example^$document` | Block a top-level navigation to that host |
| `||popup.example^$popup` | Block a popup opened as a new tab/window (Firefox native tab close + request cancel) |
| `||tracker.net^$script,redirect=noopjs` | Serve WildFire's empty script instead of cancelling |
| `/ads\.example/([^/]+)\.js/$script,redirect-rule=tagged.svg` | Fill a redirect resource from regex captures |
| `||tracker.net^$script,rewrite=blank-js` | Replace the response body with WildFire's empty script |
| `/ads\.example/([^/]+)\.js/$script,rewrite-rule=tagged-js` | Fill a WildFire rewrite template from regex captures |
| `||tracker.net^$script,csp=no-script` | Add WildFire's `script-src 'none'` CSP header to matching script responses |
| `@@||tracker.net^$csp=no-script` | Stop only that CSP directive on matching responses |
| `@@||tracker.net^$csp` | Stop every CSP injection on matching responses |
| `site.example##+js(set-constant, adblockDetected, false)` | Freeze a detection flag before page scripts run |
| `site.example#@#+js(set-constant, adblockDetected, false)` | Cancel that scriptlet on the matching site |
| `site.example#%#//scriptlet('set-constant', 'adblockDetected', 'false')` | AdGuard-style scriptlet with the same WildFire runtime |
| `site.example#@%#//scriptlet('set-constant', 'adblockDetected', 'false')` | Cancel that AdGuard-style scriptlet |
| `example.com##.promo` | Hide `.promo` on example.com |
| `example.com,~ads.example.com##.promo` | Hide on example.com except on ads.example.com |
| `example.com#@#.promo` | Keep `.promo` on example.com |
| `##.ad-container` | Hide everywhere (generic cosmetic rule) |
| `example.com##.ad:has-text("Buy now")` | Hide `.ad` when its text contains the phrase |
| `example.com##.promo:matches-path(deals)` | Hide `.promo` only on paths containing `deals` |
| `example.com##.promo:matches-path(/deals/)` | Hide `.promo` only on matching URL paths |
| `example.com##.box:has(.inner)` | Hide `.box` when it contains `.inner` |
| `example.com##.ad:contains("Buy now")` | Hide `.ad` when its own text or a descendant's text matches |
| `example.com##.leaf:nth-ancestor(2)` / `:upward(2)` | Hide the nth parent of every `.leaf` match |
| `example.com##.leaf:upward(.panel)` | Hide the nearest matching ancestor |
| `example.com##.ad:min-text-length(200)` | Hide `.ad` when its text is at least N characters |
| `example.com##div:matches-attr(data-ad=/^promo/)` | Hide when an attribute matches a safe regex |
| `example.com##div:matches-attr(data-ad)` / `:matches-attr(data-ad="promo")` | Hide by attribute presence or exact literal value (native CSS) |
| `example.com##.bar:matches-css(position: fixed)` | Hide when a computed CSS property matches a value or `/regex/` |
| `example.com##.bar:matches-css-before(content: "ad")` | Same, reading the `::before` pseudo-element (`-after` too) |
| `example.com##.box:xpath(.//span[@class="ad"])` | Hide every element returned by a bounded, read-only native XPath |
| `example.com##.ad:not(:has-text("Sponsored"))` | Hide `.ad` only when it does NOT match the procedural operand |
| `example.com##.side:matches-media((max-width: 1000px))` | Hide only when a native CSS media query matches the viewport |
| `example.com#?#div:-abp-has(.ad)` | ABP procedural form, mapped safely to `:has()` |
| `example.com#?#div:-abp-contains(Ad)` | ABP procedural form, mapped safely to `:has-text()` |

Cosmetic host lists accept comma-separated domains and `~domain` exclusions;
both positive and negated hosts use parent-domain scoping. Lines starting with
`!` are comments.

## Filter lists

The preshipped `WildFire default filters` list points directly at
`https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt`. It starts
enabled, is fetched into storage on startup, and then revalidates on its
`! Expires` interval. It cannot be removed; **Disable** or **Auto: off** opts
out. No upstream filter text is vendored into this repository:
`filters/default.txt` only supplies offline fallback rules until the default
list is fetched.

Open Options → **Suggested lists** for shortcuts to well-known community lists,
or **Filter lists** to add any `http(s)` URL. Adding a URL — suggested or typed —
fetches it immediately but leaves it disabled; choose **Enable** to apply its
rules. Every list then revalidates on its own `! Expires` interval; **Auto: off**
disables automatic checks, and **Update** forces a check now. The suggested
catalog is inert: WildFire never adds or enables those shortcut lists for you,
and it sends no data about you — the manifest still declares
`data_collection_permissions: ["none"]`.

Fetches bypass the HTTP cache, are size-capped (including `Content-Length`
preflight), time-limited to 60 seconds, and support `ETag`/`Last-Modified`
revalidation. A
`304` reuses the stored rules; an unchanged `200` keeps the original content
time. WildFire reads standard `! Title`, `! Description`, `! Version`,
`! Homepage`, `! License`, `! Expires`, `! Checksum`, `! Diff-Path` and
`! Last Modified` headers, stores them with the exact text, and uses `! Expires`
to pace checks (default one day, minimum one minute). Everything is stored under
`wildfire.remote.v1`, so the applied rules are reproducible.

## Dynamic site rules

The popup's **Site rules** grid sets per-site `block` or `allow` actions for a
resource type. Click a type to cycle **default → block → allow**; rules apply to
the tab's top-level site, including requests from embedded frames. Dynamic
rules override static filters and are saved with the rest of WildFire's state.
Options lists every site with rules and can clear them. Navigations are never
affected, and paused tabs keep their existing pause behavior.

An `allow` rule skips all WildFire handling for that type, including parameter
and header edits, CSP injection/report stripping, redirects and rewrites. A
rewrite already started before the rule changed still gets its response headers
normalized so the substituted body stays valid. A `block` rule cancels the
request, counts once, and appears in the local Inspector as a site-rule decision.

## Uncloak CNAME aliases

Options → **CNAME uncloaking** is on by default. WildFire asks Firefox DNS for
the canonical name of a request host and keeps the result in a bounded,
in-memory cache with positive and negative TTLs. Cached aliases and canonical
names both participate in `||host^`, `$domain=`, third-party, CSP, header,
rewrite and cosmetic matching, and site counters use the canonical registrable
domain. The request URL is never changed, so redirects and the Inspector still
show what the page actually requested.

DNS resolution is asynchronous and the blocking listener stays synchronous: the
first request to a new alias may pass, and later requests use the cached name.
Lookups are local Firefox DNS queries, bounded and never persisted; WildFire
does not collect or send DNS data, and `data_collection_permissions` remains
`["none"]`. Turning the toggle off stops new lookups and ignores cached
canonical names immediately. The Inspector can record `cname` decisions, and
local diagnostics report cache hits, misses and resolved aliases.

## Curated CSP rules

`$csp=alias` adds an extra enforcing `Content-Security-Policy` header to a
matching response. Firefox enforces each CSP header independently, so WildFire
only **appends** directives — your site's own headers are left untouched and
the effective policy can only get stricter. Rules can use the usual resource
type, domain and third-party options. `@@||host^$csp=alias` suppresses only that
alias; bare `@@||host^$csp` suppresses every CSP injection. A plain network
exception does not suppress CSP, and document hide exceptions never affect
request or header decisions.

Filter text can never supply a header value. Only these WildFire-owned aliases
are accepted: `no-script`, `no-inline-script`, `no-frame`, `no-worker`,
`no-object`, `no-font`, `no-media`, `no-connect`. Unknown aliases are rejected
when the list loads and never turn into request blockers.

## Block CSP reports

Options → **CSP reports** is on by default. WildFire removes only `report-uri`
and `report-to` directives from `Content-Security-Policy` and
`Content-Security-Policy-Report-Only` headers. Enforcement directives and all
other headers — including `Reporting-Endpoints` — are left alone, so pages keep
working while violation reports are not sent. A type-filtered
`webRequest.onBeforeRequest` listener also cancels legacy `csp_report` requests
as a backstop for cached pages.

Report endpoint hosts can be allowlisted in Options, and a global pause also
pauses this feature. Blocked report requests and stripped headers are counted
only in local diagnostics; they never change `blocked` or `blockedBySite`.
WildFire does not change Firefox's ETP settings or native CSP preferences.

## Inspect request decisions

The popup's **Open Inspector** button opens the standalone WildFire Inspector
window; **Recording: off/on** toggles local recording without leaving the popup.
The window shows bounded, in-memory entries for blocked requests, exceptions,
redirects, rewrites, header changes, CSP headers, CSP-report cancellations, and
resolved CNAME aliases.
Each row shows the time, decision, phase, request host, resource type, matching
WildFire rule, reason/detail, and duration. The log can be filtered by decision,
phase, type, site and free text, limited to rows with a rule, frozen for review
while recording continues, and a row's **Copy rule** button copies WildFire
domain-rule syntax to the clipboard.

Internal, extension, `data:`, `blob:` and `file:` URLs are skipped before engine
matching; with recording on they appear as `skipped` decisions and never change
counters. Nothing is persisted or sent anywhere, recording is off by default,
and inspection never changes counters or filter decisions. The blocking listener
only records while the inspector is enabled.

## Curated response rewrites

`$rewrite=alias` replaces a matching response **body** using Firefox's native
`webRequest.filterResponseData()` stream filter. WildFire sets up the filter in
the synchronous request listener, discards the original chunks, writes its own
body, and fixes the response headers (removing stale length/encoding headers and
setting the right MIME type). The site's other headers are left alone. Rewrites
count as one filtered request and honor the usual resource type, domain,
third-party and `@@` options; navigations are never rewritten.

Filter text can never supply a body, URL, or header value. Fixed-body
WildFire-owned aliases are `blank-js`, `blank-css`, `blank-text`, `blank-json`,
`blank-html` and `blank-image`. `/regex/$rewrite-rule=alias` requires a regex
filter and one of the separate capture aliases `tagged-js`, `tagged-json`,
`tagged-text` or `tagged-html`; captures are percent-encoded before filling
WildFire's `{{1}}`–`{{9}}` placeholders. It cannot be combined with `$rewrite`.
Unknown aliases, malformed rules and unsupported domain patterns are rejected
when the list loads and never turn into request blockers.
`elemhide/generichide/specifichide` are supported as exception-only document
modifiers; non-exception or combined hide/network rules are rejected. Unsupported
ABP procedural selectors are rejected safely.

## Removeparam / removeheader (capability-gated)

WildFire parses and applies `$removeparam` and `$removeheader` as validated,
capability-gated modifiers. No filter-supplied code or arbitrary header/body
template is executed.

- `$removeparam` / `$removeparam=name` / `$removeparam=/re/`: removes matching
  query params by redirecting the request to a cleaned URL when the request is
  not blocked/redirected by a normal network rule. Plain names are
  case-sensitive; regexes match the raw `name=value` pair and are also
  case-sensitive unless authored with `/i`, `/m`, `/s` or `/u` flags. Applies to
  matching requests (including navigations) and respects `@@` exceptions,
  `$important`, domain/type options, and `$badfilter`.
- `$removeheader=request:header-name` / `$removeheader=response:header-name`:
  removes matching request headers in `onBeforeSendHeaders` and response headers
  in `onHeadersReceived`. Header names are validated; invalid rules are rejected
  at load time. `$important` remove exceptions can disable remove rules.

Listeners are registered only when compiled capabilities require them.

## Curated scriptlets

Some sites probe for blocker side effects. `##+js(alias, args)` lets a filter
ask WildFire to neutralize those probes **before page scripts run**, using
Firefox's `browser.contentScripts.register()` at `document_start`. The rules
are accepted aliases and plain data only — no filter ever supplies code, and
WildFire never executes filter text. `#@#+js(...)` cancels the same alias and
arguments on matching domains, including short aliases (`set` cancels
`set-constant`, `aopr` cancels `abort-on-property-read`).

Implemented uBO-compatible alias families:

| Family | Examples |
| --- | --- |
| Property traps | `set-constant` (`set`), `abort-on-property-read` (`aopr`), `abort-on-property-write` (`aopw`), `abort-on-stack-trace` (`aost`) |
| Script guards | `abort-current-script` (`acs`), `noeval`, `noeval-silent`, `noeval-if` |
| Timer / event defusers | `prevent-setTimeout`, `prevent-setInterval`, `adjust-setTimeout`, `adjust-setInterval`, `addEventListener-defuser`, `prevent-requestAnimationFrame`, `prevent-refresh` |
| Window / browser defusers | `prevent-window-open`, `close-window`, `window.name-defuser`, `nowebrtc`, `webrtc-if`, `no-floc`, `alert-buster`, `prevent-dialog`, `prevent-navigation`, `prevent-clipboard-write` |
| DOM / style | `remove-attr` (`ra`), `remove-class` (`rc`), `set-attr`, `remove-node-text` (`rmnt`), `replace-node-text` (`rpnt`), `disable-newtab-links`, `href-sanitizer`, `overlay-buster`, `spoof-css`, `prevent-canvas` |
| Cookies / storage | `set-cookie`, `set-cookie-reload`, `remove-cookie`, `set-local-storage-item`, `set-session-storage-item` |
| Data | `json-prune`, `evaldata-prune`, `prevent-fetch`, `prevent-xhr` |
| Response transforms | `json-prune-fetch-response`, `json-prune-xhr-response`, `xml-prune`, `m3u-prune` |
| Object / JSONPath edits | `json-edit`, `json-edit-fetch/xhr-request`, `json-edit-fetch/xhr-response`, `jsonl-edit-fetch/xhr-response`, `edit-outbound-object`, `edit-inbound-object`, `edit-this-object`, `edit-object-on-setter`, `edit-element-object` |
| Detectors | `nobab`, `nobab2`, `nofab`, `fingerprint2`, `fingerprint3`, `popads` (`popads.net`), `popads-dummy`, `multiup`, `prebid-ads`, `ampproject_v0` |

Constants include `true`, `false`, `null`, `undefined`, `0`, `1`, `emptyObj`,
`emptyArr`, `emptyStr`, `''`, `{}`, `[]`, bounded integers, and WildFire-owned
function tokens such as `noopFunc`, `trueFunc`, `falseFunc` and `throwFunc`.
Needles can be case-insensitive literals or a conservative `/regex/` with `i`,
`m`, `s` or `u` flags; balanced parentheses are plain needle data. Unsafe
patterns are rejected at load time and never reach a page. Properties are plain dotted paths,
and prototype paths such as `__proto__` are rejected. Every alias is validated
again before it runs. `trusted-*` aliases stay rejected until WildFire has an
explicit source-trust model.

Timer defusers accept an optional delay matcher: an exact value, `min-max`,
`min-`, `-max`, `!value` for negation, and `-0` for negative delays. Callback
needles can also be negated with `!`. `prevent-window-open` matches all
`window.open()` arguments and accepts an optional decoy lifetime in seconds plus
`obj` or `blank` replacement. `prevent-fetch` accepts a curated third
response-config argument: a response type shorthand or a JSON object limited to
`ok`, `redirected`, `status`, `statusText`, and `type`.

`remove-attr` and `remove-class` take the attribute or class list first, then an
optional selector and `asap`, `complete`, or `stay` flags. `set-attr` copies a
source attribute with `[data-src]`. `prevent-innerHTML` accepts an optional
selector and a pattern that can be negated with `!`. The RAF defuser accepts
negated callback needles, and `remove-node-text` supports `includes`,
`excludes`, `sedCount`, `stay`, and `quitAfter` tokens. `replace-node-text`
uses the same needle/token data, inserts the replacement as literal text, and
skips `script`, `style`, `noscript`, and `template` subtrees so filter text can
never become executable page code.

The non-trusted uBO general-purpose and defuser catalog is implemented with
original WildFire code, including WildFire-owned bridges for `rpnt`,
`edit-object-on-setter`, `prevent-clipboard-write`, `prevent-navigation`,
`popads.net`, and `multiup`. Trusted-only aliases remain rejected because
WildFire has no source-trust model. Updated scriptlets apply to pages opened
after the change. A validated, data-only scriptlet snapshot is restored before
async startup work, so a previously fetched list also applies on the first page
after a restart.

AdGuard scriptlets are also accepted with
`[domains]#%#//scriptlet('alias', 'arg', ...)`; `#@%#//scriptlet(...)`
cancels the same rule. Arguments must be strings. AdGuard aliases are validated
in their own registry and then reuse WildFire's implementations, so an
AdGuard `set-constant` can be cancelled by the equivalent uBO `#@#+js()` rule.
The catalog covers the documented untrusted AdGuard aliases, including:

| Family | Examples |
| --- | --- |
| Shared behavior | `abort-current-inline-script`, `set-constant`, `prevent-fetch`, `remove-attr`, `json-prune`, `xml-prune` |
| Privacy / navigation | `no-topics`, `no-protected-audience`, `prevent-navigation`, `prevent-constructor`, `prevent-canvas`, `prevent-element-src-loading` |
| DOM / requests | `hide-in-shadow-dom`, `remove-in-shadow-dom`, `inject-css-in-shadow-dom`, `remove-request-query-parameter`, `prevent-innerHTML` |
| Analytics / detector stubs | `google-analytics`, `matomo`, `metrika-yandex-tag`, `prebid`, `scorecardresearch-beacon`, `set-popads-dummy` |
| Introspection | `log`, `log-eval`, `log-addEventListener`, `dir-string` |
| uBO bridges | `ubo-acis.js`, `ubo-aeld.js`, `ubo-aopw.js`, `ubo-aost` |

AdGuard aliases documented as debug-only or trusted-only are rejected. Filter
text still never supplies code: values such as `trueFunc` map to WildFire-owned
functions, and no `eval`, `Function` or dynamic source execution is used.

## Design notes / limits

This is deliberately a *minimal* engine, not a full uBO port:

- Filter compilation is event-driven (worker-backed with sync fallback) and cached by compiled schema version + content hash. The compiled schema is versioned; incompatible compiled data is rejected and rebuilt from text.

- Regex filters use a safe subset: backreferences, nested/alternated quantifiers,
  long patterns and stateful flags are rejected when the list loads.
- Advanced `domain=` patterns are limited to `example.*` and `*.example.*`;
  `elemhide` is not supported as a standalone network option.
- Rules are indexed by their `||host^` key (also stored in a reverse-label trie)
  and one frequency-ranked 4-character token; patterns with no usable token
  (including regex filters) are scanned per request. A bounded decision cache
  skips repeated request/type/host tuples within one filter generation.
- Page/tab/frame state lives in a synchronous in-memory store. It tracks document
  lifetimes, frame URLs, top-level site attribution, popup state, and per-page
  cosmetic/scriptlet caches; nothing about visited pages is persisted.
- `wapi` is the Firefox-native API backbone: named idempotent listener
  registration, a single prefix-filtered message listener, and promise wrappers
  for tabs, alarms, storage, content scripts and response streams. `wapi-contexts` tracks
  per-frame content script contexts so cosmetic updates can be targeted precisely.
  `wapi-background` adds native port channels so debounced counter and state
  updates can be pushed to the popup without polling. `wapi-router` registers
  named `wildfire:*` handlers instead of a monolithic switch. `wapi-tabs` owns
  native tab/navigation events and feeds PageStore. `wapi-webrequest` owns native
  request, stream-filter and header-listener plumbing. `wapi-action` wraps native
  badge calls, `wapi-capabilities` reports native API readiness, `wapi-dns` wraps
  Firefox DNS canonical-name lookups, and `wapi-scripting` owns dynamic
  content-script registrations with atomic swaps.
  `wapi-client` gives popup,
  options and content scripts one prefix-filtered message API with native port
  handles and a wrapped `tabs.query()` instead of scattered Firefox API calls.
  There is no Chrome shim or callback bridge.
- The background controller owns startup, listener registration and engine
  lifecycle through `wapi`. The blocking listener stays synchronous; listener
  registration is idempotent, a failed init settles readiness with a recorded
  error, and scriptlet registrations are swapped atomically so a failed
  replacement keeps the old one.
- The default list ships preshipped, and the uAssets CDN list is preshipped as a
  direct remote URL. Every list auto-fetches once and revalidates on its
  `! Expires` interval unless Auto is off. User-added lists must be enabled
  before their rules apply. WildFire stores the exact text, a hash, and parsed
  header metadata for each list.
- Firefox ETP is left untouched. WildFire observes ETP block errors and
  classifications only while diagnostics are enabled, and never adds them to
  WildFire's counters. Header listeners are registered when loaded rules need
  CSP, rewrite or request/response-header handling, or while CSP report
  blocking is enabled.
- No hand-written `for`/`while`/`do` loops; iteration uses native helpers
  (`map`, `filter`, `reduce`, `forEach`, `find`, `flatMap`, `Array.from`).
  `npm run check` enforces this across all scripts.
- Resource types include scripts, images, stylesheets, fonts, media, objects,
  XHR, WebSockets, pings, CSP reports and manifests; unknown types fall into `other`.
- Top-level navigations are only blocked by explicit `$document` or `$popup`
  rules, so plain network rules never cancel a page load.
- `$important` blockers/redirects/rewrites override `@@` exceptions (uBO-style).
- Redirect filters can only name WildFire-owned aliases (`noopjs`, `noopcss`,
  `nooptext`, `noopjson`, `noophtml`, `1x1.gif`, `1x1.png`, `tagged.svg`); the
  response is a bundled `data:` URI, never a URL from the filter. Unknown
  aliases cancel normally.
- Procedural cosmetic rules (`:has-text()`, `:contains()`, `:matches-path()`,
  `:has()`, `:nth-ancestor()`, `:matches-attr()`, `:matches-css()`, `:xpath()`,
  `:not()`, `:matches-media()`) use Firefox-native CSS wherever possible: plain `:has()` rules and
  `:matches-attr(name)`/`=(name="literal")` are compiled into the cosmetic
  stylesheet, and `:matches-path()` is checked once per page. Generic
  JS-evaluated procedural rules need a domain scope; generic path-only and
  fully native-compilable rules are kept, and generic procedural exceptions
  still apply. Only text/regex/ancestor/computed-style-dependent rules are
  evaluated in
  WildFire's DOM code, using native `:has()`/attribute prefilters and one query
  per shared selector. `:has-text()` checks an element's own text;
  `:contains()` also searches descendants. `:nth-ancestor(n)`/`:upward(n|selector)` hides an ancestor
  parent of a match. `:matches-css(prop: value|/re/)` reads Gecko's computed
  style (read-only); literal values must match exactly (CSS string quotes are
  ignored), with `-before`/`-after` variants for pseudo-elements.
  `:xpath(expr)` delegates to Gecko's native XPath engine (`document.evaluate`),
  read-only and bounded (expression length capped, element node-set capped per
  base match); it hides every element result, and later steps filter that set. A
  malformed expression simply matches nothing. `:not()`
  negates a procedural operand on the node itself; a fully native operand such
  as `:not(:has(.x))` compiles to native CSS, while a plain `:not(.x)` stays in
  the native CSS base. `:matches-media(query)` asks Gecko's native `matchMedia`
  engine (read-only) and re-applies on viewport resize. No script from a filter
  is ever injected.

## Message API (internal)

Background listens for `wildfire:*` messages: `state`, `toggle`, `toggle-site`,
`set-filters`, `set-csp-report-blocking`, `set-csp-report-allow`,
`set-cname-uncloak`, `reset-stats`,
`reload`, `list-state`, `suggested-lists`, `add-list`, `remove-list`,
`update-list`, `set-list-enabled`, `set-list-auto`, `cosmetic`, `diagnostics`, and
`inspect`. `diagnostics` accepts an optional boolean `value` to enable/disable
in-memory request metrics, ETP observation and CSP report counts, and an optional
`reset: true` to clear them. `inspect` accepts `value` to enable/disable the
local decision log and `reset: true` to clear it; it always returns the current
bounded snapshot.

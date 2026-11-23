# WildFire

A minimal, uBO-style content blocker **built from scratch** for Firefox. No upstream
uBlock Origin code, no npm dependencies, and no build framework — just WebExtensions
APIs and a small filter engine.

- **Manifest:** MV2 (`manifest_version: 2`)
- **Firefox floor:** `strict_min_version: "153.0"` (current ESR line)
- **Engine:** network blocking + exceptions, domain/wildcard matching, cosmetic hiding

## Layout

```
manifest.json          Firefox MV2 manifest, gecko floor 153.0
background.js          webRequest blocking, cosmetic injection, message API
lib/filter-engine.js   filter parser + matcher (no dependencies)
lib/store.js           browser.storage.local wrapper
content/cosmetic.js    injects hidden-element CSS, re-applies on demand
filters/default.txt    bundled starter rules
popup/                 toolbar popup
options/               custom filters + paused sites
assets/                generated PNG icons
tools/                 icon generator, validator, XPI packager
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

The bundled `filters/default.txt` is intentionally small. Add your own rules in the
options page (one per line):

| Rule | Meaning |
| --- | --- |
| `||ads.example.com^` | Block that host and its subdomains |
| `|https://example.com/ad|` | Match a URL from its start/end |
| `example.org*banner.gif` | Wildcard match |
| `/ads\.example\.com\/track$/` | Regular-expression match (safe subset) |
| `@@||ads.example.com^` | Allow requests that would otherwise be blocked |
| `@@/keep\.example\/ad/` | Regular-expression exception |
| `||tracker.net^$script` | Only block scripts |
| `||tracker.net^$~image` | Block everything except images |
| `||tracker.net^$third-party` | Only block cross-site requests |
| `||tracker.net^$domain=site.com\|~good.site.com` | Only on matching document hosts |
| `||landing.example^$document` | Block a top-level navigation to that host |
| `||popup.example^$popup` | Block a popup opened as a new tab/window (Firefox native tab close + request cancel) |
| `||tracker.net^$script,redirect=noopjs` | Serve WildFire's empty script instead of cancelling |
| `/ads\.example/([^/]+)\.js/$script,redirect-rule=tagged.svg` | Fill a redirect resource from regex captures |
| `||tracker.net^$script,rewrite=blank-js` | Replace the response body with WildFire's empty script |
| `||tracker.net^$script,csp=no-script` | Add WildFire's `script-src 'none'` CSP header to matching script responses |
| `site.example##+js(set-constant, adblockDetected, false)` | Freeze a detection flag before page scripts run |
| `site.example#@#+js(set-constant, adblockDetected, false)` | Cancel that scriptlet on the matching site |
| `site.example#%#//scriptlet('set-constant', 'adblockDetected', 'false')` | AdGuard-style scriptlet with the same WildFire runtime |
| `site.example#@%#//scriptlet('set-constant', 'adblockDetected', 'false')` | Cancel that AdGuard-style scriptlet |
| `example.com##.promo` | Hide `.promo` on example.com |
| `example.com#@#.promo` | Keep `.promo` on example.com |
| `##.ad-container` | Hide everywhere (generic cosmetic rule) |
| `example.com##.ad:has-text("Buy now")` | Hide `.ad` when its text contains the phrase |
| `example.com##.promo:matches-path(/deals/)` | Hide `.promo` only on matching URL paths |
| `example.com##.box:has(.inner)` | Hide `.box` when it contains `.inner` |
| `example.com##.ad:contains("Buy now")` | Hide `.ad` when its own text or a descendant's text matches |
| `example.com##.leaf:nth-ancestor(2)` | Hide the second parent of every `.leaf` match |

Lines starting with `!` are comments.

## Remote filter lists

Open Options → **Remote filter lists** to add an `http(s)` URL. Adding a URL only
registers it; use **Fetch** to download it, then **Enable** to apply its rules.
You can **Update** it later, opt into daily checks with **Auto**, or **Remove**
it. WildFire never ships a list URL, never fetches without your action, and
sends no data about you — the manifest still declares `data_collection_permissions: ["none"]`.

Fetches bypass the HTTP cache, are size-capped and time-limited, and support
`ETag`/`Last-Modified` revalidation. A `304` reuses the stored rules. The exact
text is stored under `wildfire.remote.v1`, so the applied rules are reproducible.

## Curated CSP rules

`$csp=alias` adds an extra enforcing `Content-Security-Policy` header to a
matching response. Firefox enforces each CSP header independently, so WildFire
only **appends** directives — your site's own headers are left untouched and
the effective policy can only get stricter. Rules can use the usual resource
type, domain and third-party options; an `@@` exception prevents injection.

Filter text can never supply a header value. Only these WildFire-owned aliases
are accepted: `no-script`, `no-inline-script`, `no-frame`, `no-worker`,
`no-object`, `no-font`, `no-media`, `no-connect`. Unknown aliases are rejected
when the list loads and never turn into request blockers.

## Curated response rewrites

`$rewrite=alias` replaces a matching response **body** using Firefox's native
`webRequest.filterResponseData()` stream filter. WildFire sets up the filter in
the synchronous request listener, discards the original chunks, writes its own
body, and fixes the response headers (removing stale length/encoding headers and
setting the right MIME type). The site's other headers are left alone. Rewrites
count as one filtered request and honor the usual resource type, domain,
third-party and `@@` options; navigations are never rewritten.

Filter text can never supply a body, URL, or header value. Only these
WildFire-owned aliases are accepted: `blank-js`, `blank-css`, `blank-text`,
`blank-json`, `blank-html`, `blank-image`. Unknown aliases are rejected when the
list loads and never turn into request blockers. `$rewrite-rule` is not
supported. `elemhide/generichide/specifichide` are supported as document exception modifiers; unsupported ABP procedural selectors are rejected safely.

## Removeparam / removeheader (capability-gated)

WildFire parses and applies `$removeparam` and `$removeheader` as validated,
capability-gated modifiers. No filter-supplied code or arbitrary header/body
template is executed.

- `$removeparam` / `$removeparam=name` / `$removeparam=/re/`: removes matching
  query params by redirecting the request to a cleaned URL when the request is
  not blocked/redirected by a normal network rule. Applies to matching requests
  (including navigations) and respects `@@` exceptions, `$important`,
  domain/type options, and `$badfilter`.
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
| Window / browser defusers | `prevent-window-open`, `close-window`, `window.name-defuser`, `nowebrtc`, `webrtc-if`, `no-floc`, `alert-buster`, `prevent-dialog` |
| DOM / style | `remove-attr` (`ra`), `remove-class` (`rc`), `set-attr`, `remove-node-text` (`rmnt`), `disable-newtab-links`, `href-sanitizer`, `overlay-buster`, `spoof-css`, `prevent-canvas` |
| Cookies / storage | `set-cookie`, `set-cookie-reload`, `remove-cookie`, `set-local-storage-item`, `set-session-storage-item` |
| Data | `json-prune`, `evaldata-prune`, `prevent-fetch`, `prevent-xhr` |
| Response transforms | `json-prune-fetch-response`, `json-prune-xhr-response`, `xml-prune`, `m3u-prune` |
| Object / JSONPath edits | `json-edit`, `json-edit-fetch/xhr-request`, `json-edit-fetch/xhr-response`, `jsonl-edit-fetch/xhr-response`, `edit-outbound-object`, `edit-inbound-object`, `edit-this-object`, `edit-element-object` |
| Detectors | `nobab`, `nobab2`, `nofab`, `fingerprint2`, `fingerprint3`, `popads`, `popads-dummy`, `prebid-ads`, `ampproject_v0` |

Constants include `true`, `false`, `null`, `undefined`, `0`, `1`, `emptyObj`,
`emptyArr` and `emptyStr`. Needles can be case-insensitive literals or a
conservative `/regex/` with `i`, `m`, `s` or `u` flags; unsafe patterns are
rejected at load time and never reach a page. Properties are plain dotted paths,
and prototype paths such as `__proto__` are rejected. Every alias is validated
again before it runs. `trusted-*` aliases stay rejected until WildFire has an
explicit source-trust model.

The non-trusted uBO general-purpose and defuser catalog is implemented with
original WildFire code. Trusted-only aliases (including `replace-node-text` /
`rpnt`) remain rejected because WildFire has no source-trust model. Updated
scriptlets apply to pages opened after the change.

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

AdGuard aliases documented as debug-only or trusted-only are rejected. Filter
text still never supplies code: values such as `trueFunc` map to WildFire-owned
functions, and no `eval`, `Function` or dynamic source execution is used.

## Design notes / limits

This is deliberately a *minimal* engine, not a full uBO port:

- Filter compilation is event-driven (worker-backed with sync fallback) and cached by compiled schema version + content hash. The compiled schema is versioned; incompatible compiled data is rejected and rebuilt from text.

- Regex filters use a safe subset: backreferences, nested/alternated quantifiers,
  long patterns and stateful flags are rejected when the list loads.
- `$rewrite-rule` and `elemhide` are not supported.
- Rules are indexed by their `||host^` key and 4-character tokens; patterns with
  no usable token (including regex filters) are scanned per request.
- Remote lists are opt-in: no URL is bundled, nothing is fetched until you add a
  URL and explicitly fetch it, and a fetched list must be enabled before its
  rules apply. WildFire stores the exact text and a hash of each applied list.
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
  `:has()`, `:nth-ancestor()`) use Firefox-native CSS wherever possible: plain
  `:has()` rules are compiled into the cosmetic stylesheet, and
  `:matches-path()` is checked once per page. Only text/ancestor-dependent
  rules are evaluated in WildFire's DOM code, using native `:has()` prefilters
  and one query per shared selector. `:has-text()` checks an element's own text;
  `:contains()` also searches descendants. `:nth-ancestor(n)` hides the nth
  parent of a match. No script from a filter is ever injected.

## Message API (internal)

Background listens for `wildfire:*` messages: `state`, `toggle`, `toggle-site`,
`set-filters`, `reset-stats`, `reload`, `list-state`, `add-list`, `remove-list`,
`update-list`, `set-list-enabled`, `set-list-auto`, and `cosmetic`.

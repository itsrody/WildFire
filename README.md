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
| `||popup.example^$popup` | Close a new tab/window opened as a popup |
| `||tracker.net^$script,redirect=noopjs` | Serve WildFire's empty script instead of cancelling |
| `/ads\.example/([^/]+)\.js/$script,redirect-rule=tagged.svg` | Fill a redirect resource from regex captures |
| `example.com##.promo` | Hide `.promo` on example.com |
| `example.com#@#.promo` | Keep `.promo` on example.com |
| `##.ad-container` | Hide everywhere (generic cosmetic rule) |
| `example.com##.ad:has-text("Buy now")` | Hide `.ad` when its text contains the phrase |
| `example.com##.promo:matches-path(/deals/)` | Hide `.promo` only on matching URL paths |
| `example.com##.box:has(.inner)` | Hide `.box` when it contains `.inner` |
| `example.com##.ad:contains("Buy now")` | Hide `.ad` when its own text or a descendant's text matches |
| `example.com##.leaf:nth-ancestor(2)` | Hide the second parent of every `.leaf` match |

Lines starting with `!` are comments.

## Design notes / limits

This is deliberately a *minimal* engine, not a full uBO port:

- Regex filters use a safe subset: backreferences, nested/alternated quantifiers,
  long patterns and stateful flags are rejected when the list loads.
- `$csp`, `$rewrite`, and `elemhide` are not supported.
- Rules are indexed by their `||host^` key and 4-character tokens; patterns with
  no usable token (including regex filters) are scanned per request.
- No remote list fetching or auto-updating — `filters/default.txt` plus your custom
  filters are the complete rule set.
- No hand-written `for`/`while`/`do` loops; iteration uses native helpers
  (`map`, `filter`, `reduce`, `forEach`, `find`, `flatMap`, `Array.from`).
  `npm run check` enforces this across all scripts.
- Resource types include scripts, images, stylesheets, fonts, media, objects,
  XHR, WebSockets, pings, CSP reports and manifests; unknown types fall into `other`.
- Top-level navigations are only blocked by explicit `$document` or `$popup`
  rules, so plain network rules never cancel a page load.
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
`set-filters`, `reset-stats`, `reload`, and `cosmetic`.

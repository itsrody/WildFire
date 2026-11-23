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
| `@@||ads.example.com^` | Allow requests that would otherwise be blocked |
| `||tracker.net^$script` | Only block scripts |
| `||tracker.net^$~image` | Block everything except images |
| `||tracker.net^$third-party` | Only block cross-site requests |
| `||tracker.net^$domain=site.com\|~good.site.com` | Only on matching document hosts |
| `example.com##.promo` | Hide `.promo` on example.com |
| `example.com#@#.promo` | Keep `.promo` on example.com |
| `##.ad-container` | Hide everywhere (generic cosmetic rule) |

Lines starting with `!` are comments.

## Design notes / limits

This is deliberately a *minimal* engine, not a full uBO port:

- No regular-expression filters (`/pattern/`), `$csp`, `$rewrite`, `elemhide`, or
  procedural cosmetics such as `:has-text()`.
- Rules are indexed by their `||host^` key; generic rules are scanned per request.
  Importing a full EasyList-sized list will work but is not optimized for that scale.
- No remote list fetching or auto-updating — `filters/default.txt` plus your custom
  filters are the complete rule set.
- Resource type detection relies on `webRequest` details; the `other` bucket covers
  types this engine does not model separately.

## Message API (internal)

Background listens for `wildfire:*` messages: `state`, `toggle`, `toggle-site`,
`set-filters`, `reset-stats`, `reload`, and `cosmetic`.

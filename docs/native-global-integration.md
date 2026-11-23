# WildFire native global integration — design note

Status: **design only, not implemented**

This document explores a Firefox-integrated execution path for WildFire scriptlets.
It does not change the shipped extension. The current MV2 extension remains the
reference implementation and must keep working without any Firefox patch.

**FOSS distribution target:** the intended delivery is a custom/FOSS Firefox build
(or a build that ships a privileged WildFire component), not AMO. The WildFire
XPI remains data-only and falls back to stock-extension behavior when the native
bridge is absent.

## 1. Goal

The current scriptlet runtime patches the page at `document_start`. With
`world: "MAIN"` this is already before normal page scripts, but it is still an
injected runtime doing patching after the page realm exists.

The desired behavior is stronger:

> The page realm should already contain WildFire's values when the first page
> script is compiled, so those values behave like native globals rather than
> like an extension that modified the page later.

Example:

```html
<script>
  if (window.adValue === false) {
    // This branch should see WildFire's value from the first instruction.
  }
</script>
```

This is a realm-birth requirement, not a `document_start` requirement.

## 2. What Firefox actually offers

SpiderMonkey has a new-global notification:

- `JS_FireOnNewGlobalObject()` in `js/public/GlobalObject.h`
- `Debugger.onNewGlobalObject(global)` in the Debugger API

Firefox's `dom/base/nsGlobalWindowInner.cpp` calls
`nsGlobalWindowInner::FireOnNewGlobalObject()`, which enters the global with an
`AutoEntryScript` and calls `JS_FireOnNewGlobalObject()`.

`js/public/GlobalObject.h` states that embedders using
`DontFireOnNewGlobalHook` must fire the hook exactly once **before compiling any
script in the global's scope**. That is the closest engine-level moment to the
requested behavior.

The Debugger API documents that `onNewGlobalObject` is chrome-privileged only.
It can observe all globals in the JS runtime, which is why ordinary WebExtensions
cannot use it. There is no `browser.debugger` API in Firefox and no WebExtension
permission that exposes raw SpiderMonkey `Debugger`.

`browser.contentScripts.register()` supports `world: "MAIN"` and
`runAt: "document_start"` (Firefox 128+), but
`toolkit/components/extensions/ExtensionContent.sys.mjs` executes MAIN scripts
through `script.executeInGlobal(context.contentWindow, ...)` after content-script
scheduling/parsing control. It is still runtime injection.

Therefore:

- A normal MV2 extension cannot request realm-birth behavior.
- A WebExtension Experiment or Firefox source patch can.
- `MAIN` world at `document_start` remains the maximum stock-extension
  mitigation/fallback, not proof of realm-birth initialization.

## 2.1. Real-Firefox smoke evidence (Firefox 160.0.1)

`tools/smoke.js` (`npm run smoke`) runs the same localhost smoke page against
baseline WildFire and a temporary copy patched with `world: 'MAIN'`. The smoke
rule is `localhost##+js(set-constant, wildFireSmokeValue, false)`.

| Case | First inline script | Cosmetic/content markers | Page leakage |
| --- | --- | --- | --- |
| Baseline isolated | `window.wildFireSmokeValue`/bare identifier threw or were `undefined` | cosmetic applied, content marker present, scriptlet marker absent | no `WildFireScriptlets` in page |
| `MAIN` + `document_start` | value `false`, descriptor present at first inline script | cosmetic and markers present | `window.WildFireScriptlets` and WildFire-named globals visible to page |

Conclusion: `MAIN` is a useful mitigation and prototype signal, but it is
insufficient for the stated requirement. It also has a leak-hardening problem:
WildFire runtime globals must never be exposed to page code.

## 3. Product decision required

The FOSS distribution target makes a hybrid viable:

```text
FOSS/custom Firefox build  +  privileged WildFire component  +  normal MV2 extension
```

The extension keeps filter parsing, validation, UI, and stock fallback. The
privileged component only applies validated data-only scriptlet payloads.

This is still a product decision: users need the custom/FOSS Firefox build for
realm-birth behavior. Stock Firefox users get the best-effort `document_start`
fallback, not realm-birth guarantees.

Until an explicit source-trust model exists, `trusted-*` aliases remain rejected
in all layers.

## 4. Architecture overview

```text
WildFire extension
  background.js
    engine.getScriptletPayload()
    validation / canonicalization / domain scoping
          |
          | data-only payload
          v
privileged bridge API
  browser.wildfireNative.setPayload(payload)
          |
          v
Firefox component
  WildFireNative.sys.mjs       parent process / API implementation
  WildFireNativeChild.sys.mjs  content process / realm hook host
          |
          +-- onNewGlobalObject: apply realm-birth values
          |
          +-- document_start MAIN: apply DOM-dependent aliases
```

The privileged component receives only validated data. It never receives filter
text, function source, or executable strings.

## 5. Extension-side responsibilities

The extension keeps its current responsibilities:

1. Parse filter text in `lib/filter-engine.js`.
2. Canonicalize aliases and merge `#@#+js()` / `#@%#//scriptlet()` exceptions.
3. Reject unknown, malformed, unsafe, and `trusted-*` aliases.
4. Build `engine.getScriptletPayload()`.
5. Split payload by phase: `realmBirth` for data-only aliases proven safe before
   DOM startup; `documentStart` for DOM-dependent aliases.
6. Send payload to `browser.wildfireNative` when present.
7. Register `document_start` fallback through `browser.contentScripts.register()`
   for `documentStart` rules, or for all rules when the bridge is absent/fails.

No new filter syntax is required by this design.

### Stock `MAIN` fallback hardening

The smoke probe showed `world: 'MAIN'` can expose `window.WildFireScriptlets`.
Before using `MAIN` as a mitigation, harden it:

- Execute scriptlets through a non-page-visible trampoline (no persistent
  `window.WildFireScriptlets` object, no enumerable WildFire globals).
- Keep the implementation in WildFire-owned extension files; payload remains data.
- Treat `MAIN` as best-effort `document_start`, never as realm-birth.
- Re-run `tools/smoke.js` and add a leakage assertion to CI/manual smoke checks.

## 6. Native bridge API

Proposed internal API, available only when the privileged component is present:

```js
browser.wildfireNative.setPayload(payload)
browser.wildfireNative.clearPayload()
browser.wildfireNative.getStatus()
```

`payload` is a JSON-safe object:

```json
{
  "version": 1,
  "generation": 42,
  "hash": "sha256:...",
  "phases": {
    "realmBirth": [],
    "documentStart": []
  }
}
```

Each entry:

```json
{
  "alias": "set-constant",
  "syntax": "ubo",
  "args": ["window.adValue", "false"],
  "domains": ["example.com", "~ads.example.com"],
  "isException": false
}
```

Rules:

- `args` must be JSON primitives or arrays of JSON primitives.
- No property in the payload may contain source code.
- No function may be serialized into the payload.
- `generation` increases whenever the extension reloads its engine.
- `hash` is computed from the canonical payload body for auditing and tests.
- A changed payload affects only future document loads, matching current
  registration semantics.

## 7. Privileged component layout

Proposed Firefox source files:

```text
toolkit/components/wildfire/WildFireNative.sys.mjs
toolkit/components/wildfire/WildFireNativeChild.sys.mjs
toolkit/components/wildfire/WildFireValidator.sys.mjs
toolkit/components/wildfire/wildfire-native.json
```

Responsibilities:

### `WildFireNative.sys.mjs`

- Implements the `browser.wildfireNative` API schema.
- Stores the latest accepted payload in the parent process.
- Broadcasts payload changes to content processes.
- Reports bridge status and validation errors back to the extension.
- Enforces payload size, rule count, and argument limits.

### `WildFireNativeChild.sys.mjs`

- Receives payload changes in each content process.
- Installs the privileged `Debugger` and `onNewGlobalObject` hook.
- Applies realm-birth entries to new web-content globals.
- Exposes a message handler for `document_start` DOM-dependent entries.
- Never throws into page code.

### `WildFireValidator.sys.mjs`

- Revalidates payload shape independently of the extension.
- Rejects `trusted-*`.
- Rejects unknown aliases.
- Rejects unsafe regexes, property paths, arity mismatches, and
  non-JSON arguments.
- Splits entries into realm-birth and document-start phases.

## 8. New-global hook

### Smallest robust hook points

- **Realm birth (required for "from beginning"):**
  `nsGlobalWindowInner::FireOnNewGlobalObject()` in
  `dom/base/nsGlobalWindowInner.cpp`. It already enters the global through
  `AutoEntryScript` and calls `JS_FireOnNewGlobalObject()` before page script can
  compile. A C++ fast path would define WildFire-owned properties here, behind a
  content-process payload cache and strict principal/URL filters.
- **Privileged JS prototype:** content-process `Debugger.onNewGlobalObject`
  installed from a privileged component (`addDebuggerToGlobal` via
  `moz-src:///devtools/platform/jsdebugger.sys.mjs`). Same realm-birth contract,
  easier to prototype/audit, but must be profiled for overhead.
- **Not realm birth:** `ExtensionContent.sys.mjs` content-script scheduling and
  `script.executeInGlobal()` for `MAIN`. Keep this only as fallback for
  document-start aliases.

The child component can use the privileged Debugger API:

```js
ChromeUtils.importESModule("moz-src:///devtools/platform/jsdebugger.sys.mjs")
  .addDebuggerToGlobal(globalThis);

const debuggerInstance = new Debugger();
debuggerInstance.onNewGlobalObject = globalObject => {
  // 1. Filter by principal/class/URL before dereferencing or defining.
  // 2. Apply only realmBirth entries through Debugger.Object data APIs.
  // 3. Never retain globalObject strongly.
};
```

Implementation constraints:

- Install once per content process; root the `Debugger` for process lifetime.
- Add no `onEnterFrame`, `onNewScript`, or `onPromiseSettled` hooks.
- Filter before touching page objects: system/chrome/extension/resource globals
  out; `http/https/file` content windows in; workers/worklets out in Phase A.
- Catch and report hook errors to browser diagnostics; never throw into page.
- No strong references to page globals; payload is immutable data.
- Revalidate payload in the privileged layer even if extension validated it.

## 9. Realm filtering

The hook sees all globals in the process, not only web pages. It must filter
before touching anything.

Allowed:

- `http:` and `https:` content realms.
- matching frames in `allFrames` mode.
- `about:blank` and `about:srcdoc` only when their inherited document URL
  matches, matching current content-script behavior.

Rejected:

- browser chrome globals;
- extension pages;
- privileged `resource:` globals;
- DevTools and other system principals;
- service workers and worklets in the first version;
- non-content process globals.

Domain matching uses the existing WildFire semantics: exact host or subdomain,
plus `~domain` exclusions. `#@#` / `#@%#` exceptions are already resolved in the
extension payload.

## 10. Phase assignment

Not every alias can run at realm birth. Some need a live `document`, DOM
prototypes, storage, or event targets.

### Realm-birth candidates

These can be considered for the new-global hook after per-alias verification:

- `set-constant`
- `nowebrtc`-style pure global constants, if added later
- `noop*` global function replacements
- global property traps that do not require DOM
- `noeval` / `noeval-sandbox`-style global API replacements

These must preserve original property descriptors where possible:
`writable`, `enumerable`, `configurable`, and prototype identity.

### Document-start candidates

These stay in a `MAIN` world content script registered at `document_start`:

- `abort-current-script`
- timer and event defusers
- `window.name-defuser`
- `prevent-window-open`
- DOM aliases such as `remove-attr`, `remove-class`, `set-attr`
- storage aliases
- `json-prune`, `xml-prune`, `m3u-prune`
- `prevent-fetch`, `prevent-xhr`
- detector defusers
- AdGuard aliases that map to DOM/response behavior

### Not possible by any extension-level or realm-birth route

- rewriting local lexical bindings inside already-authored page source;
- changing literals during compilation;
- altering bytecode before execution without a full source-transform layer.

Debugger APIs can observe scripts, but a general pre-compile source rewrite is a
separate project and is out of scope here.

## 11. Fallback behavior

The shipped XPI must detect the bridge at startup:

```js
const native = browser.wildfireNative &&
  typeof browser.wildfireNative.setPayload === 'function';
```

Behavior:

- bridge available: send payload, keep or suppress the `MAIN` registration
  depending on phase assignment;
- bridge unavailable: use today's `browser.contentScripts.register()` path;
- bridge available but payload rejected: log diagnostics, fall back to the
  current page-world runtime;
- extension update while pages are open: native payload changes apply to future
  navigations only.

No manifest permission should be added solely for the bridge unless the
experiment schema requires it. `data_collection_permissions.required` remains
`["none"]`.

## 12. Security rules

Non-negotiable:

1. No filter-supplied code reaches the privileged layer.
2. No `eval`, `Function`, `Cu.evalInSandbox`, or string execution from payload
   data in the privileged component.
3. No `trusted-*` alias until a source-trust model exists.
4. Validate twice: once in `lib/scriptlets.js`, once in the privileged layer.
5. Cap payload size, rule count, regex length, property path length, and
   argument count.
6. Filter by principal before applying any patch.
7. Never let a hook exception propagate into page code.
8. Keep all implementations original WildFire code; no upstream uBO or AdGuard
   source may be copied.

The privileged component should use data APIs only: define properties, define
accessors, replace function properties with WildFire-owned native functions, and
install accessors backed by validated constants.

## 13. Testing plan

Extension tests remain unchanged and must keep passing:

```sh
npm test
npm run build
web-ext lint --source-dir . --output text
```

Native integration tests require a custom Firefox build or experiment-enabled
Firefox:

```sh
./mach test toolkit/components/wildfire
```

Required test cases:

- inline `<head>` script reads a `set-constant` value from its first instruction;
- bare identifier and `window.<name>` both resolve to the patched value;
- property descriptors match the originals where applicable;
- `JSON.parse` replacement is visible to the page's own script;
- `abort-current-script` fires at the page call site;
- `#@#+js()` and `#@%#//scriptlet()` cancel native and document-start entries;
- AdGuard and uBO payloads apply through the same validator;
- `trusted-*` and injected-code arguments are rejected;
- no privileged error appears in the browser console;
- no bridge falls back cleanly to the current `MAIN` runtime;
- payload changes affect only future navigations;
- iframe and excluded-domain behavior matches current matching rules.

A dedicated test page should place assertions before any external script loads.

## 14. Delivery phases

### Phase A — prototype (start here)

- Add the privileged bridge API and child hook in a FOSS Firefox build.
- Support only `set-constant` at realm birth; data-only payload, double
  validation, bounded size/count/arg limits.
- Keep all other aliases on `document_start` fallback (`MAIN` only after leakage
  hardening; otherwise isolated fallback).
- Add smoke/integration tests: first inline script sees value, no page-visible
  WildFire globals, exceptions cancel, payload updates affect future loads only.
- Benchmark `onNewGlobalObject` overhead on representative pages.

### Phase B — realm-birth catalog

- Add pure global/builtin aliases after per-alias proof (descriptor semantics,
  no DOM dependency, no page leakage).
- Preserve original descriptors/prototypes where applicable.
- Keep `trusted-*` rejected.

### Phase C — hybrid runtime

- Harden `MAIN` fallback to remove `window.WildFireScriptlets` leakage.
- Coordinate exceptions across realm-birth and document-start phases.
- Keep stock XPI fully functional with fallback.

### Phase D — optional C++ fast path

- If Debugger overhead is measurable, move hot path near
  `nsGlobalWindowInner::FireOnNewGlobalObject()` using JSAPI property defines.
- Keep the same payload schema and validation boundary.

## 15. Implementation plan (concrete)

1. **Harden extension boundary (done in this repo as scaffold):** split payload by
   phase in `background.js`, detect `browser.wildfireNative`, send realm-birth
   rules over bridge, register only document-start fallback rules. No manifest
   permission changes.
2. **FOSS Firefox component prototype:** move `browser/extensions/wildfire-native`
   scaffold into Firefox source as privileged experiment/component; wire
   `schema.json`/manifest registration; implement parent sharedData broadcast and
   child `Debugger.onNewGlobalObject` hook.
3. **Validation parity:** port/duplicate WildFire scriptlet validation in the
   component (alias allowlist, arg types, constant tokens, domain syntax, max
   sizes, no `trusted-*`).
4. **Smoke gate:** extend `tools/smoke.js` with a native mode that runs against a
   custom Firefox build containing the component; require value at first inline
   script and zero WildFire globals.
5. **Rollout:** ship as FOSS/custom Firefox build artifact; keep normal XPI as
   fallback channel for stock Firefox.

## 15. Open decisions

Before implementation, the owner needs to decide:

1. Experiment prototype or direct Firefox source patch first.
2. Whether the native bridge is optional or required.
3. Which aliases are allowed at realm birth.
4. Whether any `trusted-*` alias becomes allowable under a new trust model.
5. Whether AMO distribution matters for the hybrid build.
6. Whether service workers and dedicated workers are in scope later.
7. Whether the C++ fast path is required for release or only later optimization.

Until those decisions are made, the normal `MAIN` world design remains the
shippable WildFire architecture.

# WildFire native scriptlet bridge (FOSS Firefox component)

Status: **prototype scaffold for a custom/FOSS Firefox build**. Not used by the
normal WildFire XPI unless `browser.wildfireNative` is present.

## Goal

Apply validated WildFire scriptlet data at **realm birth** for aliases that are
safe before DOM startup (`set-constant` first). DOM-dependent aliases stay on the
existing `document_start` MAIN/content-script fallback.

## Files

- `schema.json` - WebExtension Experiment schema for `browser.wildfireNative`.
- `parent/ext-wildfire-native.js` - parent process API: validates payload,
  stores generation/hash, broadcasts to content processes.
- `child/ext-wildfire-native.js` - content process hook host: installs
  `Debugger.onNewGlobalObject`, filters content windows, applies realm-birth
  entries through data-only Debugger object APIs.

## Integration

This is intentionally **not wired into Firefox build files** in this repo. To use
it in a FOSS Firefox build, copy/register it as a privileged extension experiment
or built-in component and expose it only to the WildFire extension ID.

The WildFire extension already detects the bridge:

```js
const native = browser.wildfireNative?.setPayload;
```

When present, it sends realm-birth rules to the bridge and keeps only
document-start rules in `browser.contentScripts.register()`.

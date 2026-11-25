/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAYLOADS = new Map();
let debuggerInstalled = false;
let dbg = null;

function isContentWindow(win) {
  try {
    if (!win || !win.document) return false;
    const uri = win.document.documentURIObject;
    if (!uri) return false;
    const scheme = uri.scheme;
    if (scheme !== "http" && scheme !== "https" && scheme !== "file") return false;
    const principal = win.document.nodePrincipal;
    if (!principal || principal.isSystemPrincipal) return false;
    return true;
  } catch (_e) {
    return false;
  }
}

function domainMatches(host, domain) {
  const normalizedHost = String(host || "").toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  const key = String(domain || "").toLowerCase().replace(/^\./, "").replace(/\.$/, "")
    .replace(/^~/, "").trim();
  if (!normalizedHost || !key) return false;
  if (key === "*") return true;
  // Regex/scoped values are validated in the extension layer. This privileged
  // mirror deliberately handles only literal, `*`, and entity forms as data.
  if (key.startsWith("/")) return false;
  if (!key.includes("*")) {
    return normalizedHost === key || normalizedHost.endsWith("." + key);
  }
  const labels = normalizedHost.split(".").filter(Boolean);
  const leading = key.startsWith("*.");
  const trailing = key.endsWith(".*");
  const parts = key.slice(leading ? 2 : 0, trailing ? -2 : undefined)
    .split(".").filter(Boolean);
  if (!parts.length) return false;
  const partAt = (index, offset) => labels[index + offset] === parts[offset];
  if (leading && trailing) {
    return labels.some((unused, index) =>
      index > 0 && index + parts.length < labels.length &&
      parts.every((part, offset) => partAt(index, offset)));
  }
  if (trailing) {
    return labels.some((unused, index) =>
      index + parts.length < labels.length &&
      parts.every((part, offset) => partAt(index, offset)));
  }
  const start = labels.length - parts.length;
  return start > 0 && parts.every((part, offset) => partAt(start, offset));
}

function appliesTo(entry, host) {
  const domains = Array.isArray(entry.domains) ? entry.domains : [];
  if (!domains.length) return true;
  const included = domains.filter(d => !d.startsWith("~"));
  const excluded = domains.filter(d => d.startsWith("~")).map(d => d.slice(1));
  const isIncluded = !included.length || included.some(d => domainMatches(host, d));
  return isIncluded && !excluded.some(d => domainMatches(host, d));
}

function canonicalAlias(entry) {
  const alias = String(entry && entry.alias || "").trim().toLowerCase();
  return alias === "set" ? "set-constant" : alias;
}

function sameRule(left, right) {
  const leftArgs = Array.isArray(left.args) ? left.args : [];
  const rightArgs = Array.isArray(right.args) ? right.args : [];
  if (canonicalAlias(left) !== canonicalAlias(right)) return false;
  if (leftArgs.length !== rightArgs.length) return false;
  return leftArgs.every((arg, index) => String(arg) === String(rightArgs[index]));
}

function hasScopedDomain(entry) {
  const domains = Array.isArray(entry && entry.domains) ? entry.domains : [];
  return domains.some(domain => typeof domain === "string" &&
    domain && domain !== "*" && !domain.startsWith("~"));
}

function constantValue(token) {
  switch (String(token)) {
    case "undefined": return undefined;
    case "false": return false;
    case "true": return true;
    case "null": return null;
    case "noopFunc":
    case "noopCallbackFunc":
    case "trueFunc":
    case "falseFunc":
    case "throwFunc":
    case "noopPromiseResolve":
    case "noopPromiseReject":
      return function () {
        if (token === "trueFunc") return true;
        if (token === "falseFunc") return false;
        if (token === "throwFunc") throw new Error("");
        if (token === "noopPromiseResolve") return Promise.resolve();
        if (token === "noopPromiseReject") return Promise.reject();
        return undefined;
      };
    case "emptyObj": return {};
    case "{}": return {};
    case "emptyArr": return [];
    case "[]": return [];
    case "emptyStr": return "";
    case "''": return "";
    case "": return "";
    case "0": return 0;
    case "1": return 1;
    case "-1": return -1;
    case "NaN": return NaN;
    case "yes": return "yes";
    case "no": return "no";
    default: return undefined;
  }
}

function isSafePropertyPath(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 120) return false;
  if (raw.includes("__proto__") || raw.includes("prototype") || raw.includes("constructor")) return false;
  return /^[$_A-Za-z][$_0-9A-Za-z]*(?:\.(?:[$_A-Za-z][$_0-9A-Za-z]*|\[\d+\]))*$/.test(raw);
}

function defineConstant(globalDO, path, value) {
  if (!isSafePropertyPath(path)) return;
  const parts = String(path || "").split(".");
  let target = globalDO;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    let desc;
    try { desc = target.getOwnPropertyDescriptor(part); } catch (_e) { desc = undefined; }
    if (!desc || !desc.value) {
      const ok = target.defineProperty(part, {
        value: globalDO.makeDebuggeeValue(Object.create(null)),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      if (!ok) return;
      desc = target.getOwnPropertyDescriptor(part);
    }
    target = desc.value;
    if (!target || typeof target.getOwnPropertyDescriptor !== "function") return;
  }
  const key = parts[parts.length - 1];
  if (!key) return;
  let existing;
  try { existing = target.getOwnPropertyDescriptor(key); } catch (_e) { existing = undefined; }
  const configurable = existing ? !!existing.configurable : false;
  const enumerable = existing ? !!existing.enumerable : true;
  target.defineProperty(key, {
    value: globalDO.makeDebuggeeValue(value),
    writable: false,
    enumerable,
    configurable,
  });
}

function applyPayloadToGlobal(globalDO) {
  let win;
  try {
    win = globalDO.unsafeDereference();
  } catch (_e) {
    return;
  }
  if (!isContentWindow(win)) return;
  const host = String(win.location && win.location.hostname || "").toLowerCase();

  PAYLOADS.forEach(payload => {
    const rules = payload?.phases?.realmBirth || [];
    const applicable = rules.filter(rule => appliesTo(rule, host));
    const exceptions = applicable.filter(rule => rule.isException);
    const unexcepted = applicable.filter(rule => !rule.isException &&
      !exceptions.some(exception => sameRule(exception, rule)));
    // Surveyor rules are gated by a live domain-scoped rule, matching the
    // stock document_start registry. Exceptions remove scoped rules first.
    const hasScopedRule = unexcepted.some(rule => hasScopedDomain(rule));
    unexcepted.filter(rule => !rule.specificGeneric || hasScopedRule).forEach(rule => {
      if (canonicalAlias(rule) === "set-constant") {
        defineConstant(globalDO, rule.args[0], constantValue(rule.args[1]));
      }
    });
  });
}

function ensureDebugger() {
  if (debuggerInstalled) return;
  debuggerInstalled = true;
  try {
    ChromeUtils.importESModule("moz-src:///devtools/platform/jsdebugger.sys.mjs").addDebuggerToGlobal(globalThis);
  } catch (_e) {
    // Older/alternate trees may expose Debugger differently; fail closed.
  }
  if (typeof Debugger !== "function") {
    Cu.reportError("WildFireNative: Debugger API unavailable");
    return;
  }
  dbg = new Debugger();
  dbg.uncaughtExceptionHook = err => { Cu.reportError(err); };
  dbg.onNewGlobalObject = globalDO => {
    try {
      applyPayloadToGlobal(globalDO);
    } catch (e) {
      Cu.reportError(e);
    }
  };
}

function loadExistingPayloads() {
  const data = Services.ppmm.sharedData.getAll();
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("WildFireNative:Payload:")) {
      PAYLOADS.set(key.slice("WildFireNative:Payload:".length), value);
    }
  }
}

export class WildFireNativeChild {
  constructor() {
    ensureDebugger();
    loadExistingPayloads();
    Services.cpmm.addMessageListener("WildFireNative:Payload", this);
    Services.cpmm.addMessageListener("WildFireNative:Clear", this);
  }

  receiveMessage(msg) {
    try {
      if (msg.name === "WildFireNative:Payload") {
        PAYLOADS.set(msg.data.id, msg.data.payload);
      } else if (msg.name === "WildFireNative:Clear") {
        PAYLOADS.delete(msg.data.id);
      }
    } catch (e) {
      Cu.reportError(e);
    }
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const MAX_RULES = 2048;
const MAX_ARGS = 8;
const MAX_STRING = 512;
const ALLOWED_ALIASES = new Set(["set-constant"]);
const CANONICAL = new Map([
  ["set-constant", "set-constant"],
  ["set", "set-constant"],
]);
const ALLOWED_CONSTANTS = new Set([
  "undefined", "false", "true", "null", "noopFunc", "noopCallbackFunc",
  "trueFunc", "falseFunc", "throwFunc", "noopPromiseResolve", "noopPromiseReject",
  "emptyObj", "emptyArr", "emptyStr", "''", "0", "1", "-1", "NaN", "yes", "no",
  "{}", "[]", ""
]);

function isPlainString(value) {
  return typeof value === "string" && value.length <= MAX_STRING;
}

function isSafePropertyPath(value) {
  const raw = String(value || "");
  if (!raw || raw.length > 120) return false;
  if (raw.includes("__proto__") || raw.includes("prototype") || raw.includes("constructor")) return false;
  return /^[$_A-Za-z][$_0-9A-Za-z]*(?:\.(?:[$_A-Za-z][$_0-9A-Za-z]*|\[\d+\]))*$/.test(raw);
}

function validateEntry(entry, phase) {
  if (!entry || typeof entry !== "object") throw new Error("invalid scriptlet entry");
  if (!isPlainString(entry.alias)) throw new Error("invalid scriptlet alias");
  const syntax = entry.syntax === "adguard" ? "adguard" : "ubo";
  const rawAlias = entry.alias.trim().toLowerCase();
  if (rawAlias.startsWith("trusted-")) throw new Error("trusted scriptlets are not allowed");
  const alias = CANONICAL.get(rawAlias);
  if (!alias) throw new Error("unknown scriptlet alias: " + rawAlias);
  if (phase === "realmBirth" && !ALLOWED_ALIASES.has(alias)) {
    throw new Error("alias not allowed at realm birth: " + alias);
  }
  if (!Array.isArray(entry.args) || entry.args.length > MAX_ARGS) {
    throw new Error("invalid scriptlet args");
  }
  const args = entry.args.map(arg => {
    const ok = typeof arg === "string" || typeof arg === "number" ||
      typeof arg === "boolean" || arg === null;
    if (!ok || (typeof arg === "string" && arg.length > MAX_STRING)) {
      throw new Error("invalid scriptlet arg");
    }
    return arg;
  });
  if (alias === "set-constant") {
    if (args.length < 2 || args.length > 3) throw new Error("invalid set-constant arity");
    if (!isSafePropertyPath(args[0])) throw new Error("invalid set-constant property path");
    const value = String(args[1] ?? "");
    if (!ALLOWED_CONSTANTS.has(value)) throw new Error("unsupported set-constant value");
    if (args.length === 3 && typeof args[2] !== "string") throw new Error("invalid set-constant stack arg");
  }
  const domains = Array.isArray(entry.domains) ? entry.domains : [];
  domains.forEach(domain => {
    if (!isPlainString(domain)) throw new Error("invalid scriptlet domain");
  });
  return {
    alias,
    syntax,
    args,
    domains: domains.slice(),
    isException: !!entry.isException,
  };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("invalid payload");
  if (payload.version !== 1) throw new Error("unsupported payload version");
  if (!Number.isInteger(payload.generation) || payload.generation < 0) {
    throw new Error("invalid payload generation");
  }
  if (!isPlainString(payload.hash)) throw new Error("invalid payload hash");
  const phases = payload.phases && typeof payload.phases === "object" ? payload.phases : {};
  const realmBirth = Array.isArray(phases.realmBirth) ? phases.realmBirth : [];
  const documentStart = Array.isArray(phases.documentStart) ? phases.documentStart : [];
  if (realmBirth.length + documentStart.length > MAX_RULES) {
    throw new Error("payload too large");
  }
  return {
    version: 1,
    generation: payload.generation,
    hash: payload.hash,
    phases: {
      realmBirth: realmBirth.map(entry => validateEntry(entry, "realmBirth")),
      documentStart: documentStart.map(entry => validateEntry(entry, "documentStart")),
    },
  };
}

this.wildfireNative = class extends ExtensionAPI {
  getAPI(context) {
    const { extension } = context;
    const id = extension.id;

    return {
      wildfireNative: {
        async setPayload(payload) {
          const validated = validatePayload(payload);
          Services.ppmm.sharedData.set("WildFireNative:Payload:" + id, validated);
          Services.ppmm.sharedData.flush();
          Services.ppmm.broadcastAsyncMessage("WildFireNative:Payload", { id, payload: validated });
          return { ok: true, generation: validated.generation, count: validated.phases.realmBirth.length };
        },

        async clearPayload() {
          Services.ppmm.sharedData.delete("WildFireNative:Payload:" + id);
          Services.ppmm.sharedData.flush();
          Services.ppmm.broadcastAsyncMessage("WildFireNative:Clear", { id });
          return { ok: true };
        },

        async getStatus() {
          const payload = Services.ppmm.sharedData.get("WildFireNative:Payload:" + id);
          return {
            ok: true,
            hasPayload: !!payload,
            generation: payload ? payload.generation : 0,
            realmBirthRules: payload ? payload.phases.realmBirth.length : 0,
          };
        },
      },
    };
  }
};

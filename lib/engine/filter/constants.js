/* WildFire filter engine: shared limits, capability flags, token/type tables.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};

  const TOKEN_LENGTH = 4;
  const MAX_REGEX_LENGTH = 512;
  const MAX_REGEX_QUANTIFIERS = 16;
  const MAX_REGEX_GROUPS = 16;
  const MAX_REGEX_URL_LENGTH = 8192;
  const PROCEDURAL_OPS = ['has-text(', 'contains(', 'matches-path(', 'has(', 'nth-ancestor(', 'upward(', 'min-text-length(', 'matches-attr(', 'matches-css(', 'matches-css-before(', 'matches-css-after(', 'xpath(', 'not(', 'matches-media('];
  const MAX_PROCEDURAL_DEPTH = 8;
  const MAX_NTH_ANCESTOR = 8;
  const MAX_XPATH_LENGTH = 512;
  const WORST_TOKEN_USAGE = 0x7fffffff;
  const BAD_TOKEN_USAGE = 0x3fffffff;
  const COMPILED_VERSION = 5;
  const WORST_TOKENS = new Set(['https', 'http', 'www', 'com']);

  // Capability flags: compact compile-time summary for listener gating and
  // diagnostics. A flag is set when any active rule requires the capability.
  const CAP = {
    NETWORK: 1 << 0,
    EXCEPTION: 1 << 1,
    IMPORTANT: 1 << 2,
    REDIRECT: 1 << 3,
    REWRITE: 1 << 4,
    CSP: 1 << 5,
    POPUP: 1 << 6,
    DOCUMENT: 1 << 7,
    THIRD_PARTY: 1 << 8,
    DOMAIN: 1 << 9,
    REGEX: 1 << 10,
    COSMETIC: 1 << 11,
    PROCEDURAL: 1 << 12,
    SCRIPTLET: 1 << 13,
    GENERICHIDE: 1 << 14,
    ELEMHIDE: 1 << 15,
    SPECIFICHIDE: 1 << 16,
    BADFILTER: 1 << 17,
    REMOVEPARAM: 1 << 18,
    REMOVEHEADER: 1 << 19
  };

  const BAD_TOKENS = new Set([
    'uk', 'net', 'org', 'io', 'de', 'fr', 'es', 'it', 'nl', 'se', 'ru', 'pl', 'co',
    'js', 'css', 'img', 'jpg', 'html', 'png', 'cdn', 'static', 'images', 'api', 'wp',
    'ad', 'ads', 'content', 'doubleclick', 'analytics', 'assets', 'id', 'min',
    'amazon', 'google', 'googlesyndication', 'googleapis'
  ]);

  const RESOURCE_TYPES = new Set([
    'document', 'subdocument', 'script', 'image', 'imageset', 'stylesheet',
    'object', 'xmlhttprequest', 'font', 'media', 'websocket',
    'ping', 'csp', 'manifest', 'other'
  ]);

  const TYPE_ALIASES = {
    main_frame: 'document',
    document: 'document',
    doc: 'document',
    sub_frame: 'subdocument',
    subdocument: 'subdocument',
    frame: 'subdocument',
    script: 'script',
    image: 'image',
    imageset: 'imageset',
    stylesheet: 'stylesheet',
    css: 'stylesheet',
    object: 'object',
    object_subrequest: 'object',
    xmlhttprequest: 'xmlhttprequest',
    xhr: 'xmlhttprequest',
    font: 'font',
    media: 'media',
    websocket: 'websocket',
    ws: 'websocket',
    wss: 'websocket',
    ping: 'ping',
    csp: 'csp',
    csp_report: 'csp',
    manifest: 'manifest',
    web_manifest: 'manifest',
    other: 'other',
    eventsource: 'other',
    speculative: 'other'
  };

  Object.assign(NS, { TOKEN_LENGTH, MAX_REGEX_LENGTH, MAX_REGEX_QUANTIFIERS, MAX_REGEX_GROUPS, MAX_REGEX_URL_LENGTH, PROCEDURAL_OPS, MAX_PROCEDURAL_DEPTH, MAX_NTH_ANCESTOR, MAX_XPATH_LENGTH, WORST_TOKEN_USAGE, BAD_TOKEN_USAGE, COMPILED_VERSION, WORST_TOKENS, CAP, BAD_TOKENS, RESOURCE_TYPES, TYPE_ALIASES });
})(this);

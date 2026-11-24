/* WildFire - local Inspector log helpers. Pure data functions, no browser APIs. */
(function (global) {
  'use strict';

  const api = global.WildFireInspectorLog = global.WildFireInspectorLog || {};
  try { global.wildfireInspectorLog = api; } catch (error) { /* canonical global is enough */ }

  function normalizeFilters(value) {
    const config = value || {};
    return {
      decision: String(config.decision || 'all'),
      phase: String(config.phase || 'all'),
      type: String(config.type || '').trim().toLowerCase(),
      site: String(config.site || '').trim().toLowerCase(),
      query: String(config.query || '').trim().toLowerCase(),
      rulesOnly: Boolean(config.rulesOnly)
    };
  }

  function haystack(entry) {
    const source = entry || {};
    const rule = source.rule || {};
    return [
      source.decision, source.phase, source.source, source.type,
      source.host, source.site, source.topHost, source.topSite,
      source.url, source.detail, source.reason, rule.text, rule.source
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function matches(entry, value) {
    const source = entry || {};
    const filters = normalizeFilters(value);
    const site = [source.site, source.topSite, source.host, source.topHost]
      .filter(Boolean).join(' ').toLowerCase();
    if (filters.decision !== 'all' && source.decision !== filters.decision) return false;
    if (filters.phase !== 'all' && source.phase !== filters.phase) return false;
    if (filters.type && String(source.type || '').toLowerCase() !== filters.type) return false;
    if (filters.site && !site.includes(filters.site)) return false;
    if (filters.rulesOnly && !(source.rule && source.rule.text)) return false;
    return !filters.query || haystack(source).includes(filters.query);
  }

  function filterEntries(entries, value) {
    return (Array.isArray(entries) ? entries : []).filter(entry => matches(entry, value));
  }

  function summarize(entries) {
    return (Array.isArray(entries) ? entries : []).reduce((counts, entry) => {
      const decision = String(entry && entry.decision || 'allowed');
      counts[decision] = (counts[decision] || 0) + 1;
      return counts;
    }, {});
  }

  function ruleForEntry(entry) {
    const source = entry || {};
    const rule = source.rule || {};
    const text = String(rule.text || '');
    if (text && !text.startsWith('@@')) return text;
    const host = String(source.host || '').trim().toLowerCase();
    return host ? '||' + host + '^' : '';
  }

  function timeLabel(entry) {
    const source = entry || {};
    const at = Number(source.at);
    const time = Number.isFinite(at) && at > 0
      ? new Date(at).toLocaleTimeString()
      : '';
    const ms = Number(source.ms) || 0;
    return time + (ms ? ' · ' + ms + ' ms' : '');
  }

  api.normalizeFilters = normalizeFilters;
  api.matches = matches;
  api.filterEntries = filterEntries;
  api.summarize = summarize;
  api.ruleForEntry = ruleForEntry;
  api.timeLabel = timeLabel;
})(this);

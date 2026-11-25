/* WildFire filter engine: uBO ##+js() and AdGuard #%#//scriptlet() line parsers.
 * Classic-script module; load after its dependencies (manifest background order). */
(function (global) {
  'use strict';

  const NS = global.WildFireFilter = global.WildFireFilter || {};
  const { parseHostScopeList } = NS;

  // A leading slash is a regex literal only when it has a closing delimiter
  // and safe flags. uBO filters also use bare slash-prefixed needles such as
  // `/dash`; those stay literal data for the registry to validate.
  function startsRegexLiteral(text, index) {
    const chars = Array.from(text);
    const scan = chars.reduce((current, ch, position) => {
      if (position <= index || current.done) return current;
      if (current.escaped) {
        current.escaped = false;
        return current;
      }
      if (ch === '\\') {
        current.escaped = true;
        return current;
      }
      if (ch !== '/') return current;
      current.done = true;
      current.close = position;
      return current;
    }, { done: false, escaped: false, close: -1 });
    return scan.close >= 0 &&
      /^[imsu]*(?=$|[,\s])/.test(chars.slice(scan.close + 1).join(''));
  }

  // Split scriptlet arguments without splitting commas inside quoted strings
  // or regex literals. Everything remains plain text; the registry validates
  // each argument before any implementation sees it.
  function splitScriptletArgs(text) {
    const source = String(text);
    const state = Array.from(source).reduce((current, ch, index) => {
      if (current.error) return current;
      if (current.escaped) {
        current.current += ch;
        current.escaped = false;
        return current;
      }
      if (current.quote) {
        if (ch === current.quote) current.quote = '';
        else if (ch === '\\') current.escaped = true;
        current.current += ch;
        return current;
      }
      if (current.regex) {
        if (ch === '\\') {
          current.escaped = true;
        } else if (ch === '/') {
          current.regex = false;
        }
        current.current += ch;
        return current;
      }
      // Parentheses are plain data inside an argument. Real filters use them
      // in needles such as `(!o)`; track balance so commas inside stay grouped.
      if (ch === '(') {
        current.depth += 1;
        current.current += ch;
        return current;
      }
      if (ch === ')') {
        if (!current.depth) {
          current.error = 'unbalanced +js argument';
          return current;
        }
        current.depth -= 1;
        current.current += ch;
        return current;
      }
      if (ch === ',' && !current.depth) {
        current.parts.push(current.current.trim());
        current.current = '';
        return current;
      }
      if ((ch === '"' || ch === "'") && !current.current.trim()) {
        current.quote = ch;
        current.current += ch;
        return current;
      }
      if (ch === '/' && !current.current.trim() && startsRegexLiteral(source, index)) {
        current.regex = true;
        current.current += ch;
        return current;
      }
      current.current += ch;
      return current;
    }, { parts: [], current: '', quote: '', regex: false, escaped: false, depth: 0, error: '' });

    if (state.error) return { error: state.error };
    if (state.quote || state.regex) return { error: 'unterminated +js argument' };
    if (state.depth) return { error: 'unbalanced +js argument' };
    const parts = state.parts.concat(state.current.trim());
    const args = parts.map(part => {
      if (part.length > 1 && (part[0] === '"' || part[0] === "'") &&
        part[part.length - 1] === part[0]) {
        return part.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      return part;
    });
    return { args };
  }

  // Scriptlet rules carry an alias and plain data only. The injected registry
  // decides whether the alias and its arguments are allowed. A leading `~` is
  // preserved so the registry can apply negated domain scopes per host.
  function parseScriptlet(line) {
    const text = line.trim();
    const exceptAt = text.indexOf('#@#+js(');
    const hideAt = text.indexOf('##+js(');
    let index;
    let isException;
    let open;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
      open = exceptAt + '#@#+js('.length - 1;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
      open = hideAt + '##+js('.length - 1;
    } else {
      return null;
    }

    const body = text.slice(open + 1).trim();
    if (!body.endsWith(')')) return { error: 'unterminated +js rule' };
    const parsedArgs = splitScriptletArgs(body.slice(0, -1));
    if (parsedArgs.error) return { error: parsedArgs.error };
    const parts = parsedArgs.args;
    const alias = (parts.shift() || '').toLowerCase();
    if (!alias) return { error: 'empty scriptlet alias' };

    const scopes = parseHostScopeList(text.slice(0, index));
    if (scopes.error) return { error: scopes.error };
    const domains = scopes.include.concat(scopes.exclude.map(domain => '~' + domain));
    if (scopes.specificGeneric) domains.push('*');
    return {
      domains, alias, args: parts, isException, syntax: 'ubo',
      specificGeneric: scopes.specificGeneric
    };
  }

  // AdGuard scriptlets use single-quoted string arguments. Parse them as
  // plain data; the content-side registry validates every value again.
  function splitAdguardArgs(text) {
    const state = Array.from(text).reduce((current, ch) => {
      if (current.error) return current;
      if (current.escaped) {
        current.current += (ch === current.quote || ch === '\\') ? ch : '\\' + ch;
        current.escaped = false;
        return current;
      }
      if (current.quote) {
        if (ch === current.quote) current.quote = '';
        else if (ch === '\\') {
          current.escaped = true;
          return current;
        }
        current.current += ch;
        return current;
      }
      if (ch === ',' && !current.current.trim()) {
        return current;
      }
      if (ch === ',' && current.current.trim()) {
        current.parts.push(current.current.trim());
        current.current = '';
        return current;
      }
      if ((ch === '"' || ch === "'") && !current.current.trim()) {
        current.quote = ch;
        current.current += ch;
        return current;
      }
      current.current += ch;
      return current;
    }, { parts: [], current: '', quote: '', escaped: false, error: '' });

    if (state.error) return { error: state.error };
    if (state.quote) return { error: 'unterminated AdGuard scriptlet argument' };
    const parts = state.parts.concat(state.current.trim()).filter(Boolean);
    const args = parts.map(part => {
      if (part.length > 1 && (part[0] === '"' || part[0] === "'") &&
        part[part.length - 1] === part[0]) {
        return part.slice(1, -1);
      }
      return part;
    });
    return { args };
  }

  function parseAdguardScriptlet(line) {
    const text = line.trim();
    const exceptAt = text.indexOf('#@%#//scriptlet(');
    const hideAt = text.indexOf('#%#//scriptlet(');
    let index;
    let isException;
    let open;

    if (exceptAt !== -1 && (hideAt === -1 || exceptAt < hideAt)) {
      index = exceptAt;
      isException = true;
      open = exceptAt + '#@%#//scriptlet('.length - 1;
    } else if (hideAt !== -1) {
      index = hideAt;
      isException = false;
      open = hideAt + '#%#//scriptlet('.length - 1;
    } else {
      return null;
    }

    const body = text.slice(open + 1).trim();
    if (!body.endsWith(')')) return { error: 'unterminated AdGuard scriptlet rule' };
    const parsed = splitAdguardArgs(body.slice(0, -1));
    if (parsed.error) return { error: parsed.error };
    const parts = parsed.args;
    const alias = (parts.shift() || '').toLowerCase();
    if (!alias) return { error: 'empty AdGuard scriptlet alias' };

    const scopes = parseHostScopeList(text.slice(0, index));
    if (scopes.error) return { error: scopes.error };
    const domains = scopes.include.concat(scopes.exclude.map(domain => '~' + domain));
    if (scopes.specificGeneric) domains.push('*');
    return {
      domains, alias, args: parts, isException, syntax: 'adguard',
      specificGeneric: scopes.specificGeneric
    };
  }

  Object.assign(NS, { splitScriptletArgs, parseScriptlet, splitAdguardArgs, parseAdguardScriptlet });
})(this);

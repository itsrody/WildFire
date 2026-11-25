/* WildFire - native custom-filter editor shell.
 * The textarea stays the single source of truth; the overlay only paints. */
(function (global) {
  'use strict';

  const api = global.WildFireOptionsEditor = global.WildFireOptionsEditor || {};
  try { global.wildfireOptionsEditor = api; } catch (error) { /* canonical global is enough */ }

  const COSMETIC_MARKERS = ['##', '#@#', '#?#', '#@?#', '#%#', '#@%#'];

  function splitLines(text) {
    return String(text == null ? '' : text).split(/\r?\n/);
  }

  function cosmeticMarker(line) {
    return COSMETIC_MARKERS.find(marker => line.indexOf(marker) !== -1) || '';
  }

  function classifyLine(line) {
    const value = String(line || '');
    if (!value.trim()) return 'blank';
    if (value.startsWith('!')) return 'comment';
    if (cosmeticMarker(value)) return 'cosmetic';
    if (value.startsWith('@@')) return 'exception';
    return 'network';
  }

  function lineNumbers(text) {
    return splitLines(text)
      .map((line, index) => String(index + 1))
      .join('\n') + '\n';
  }

  function cursorPosition(text, index) {
    const source = String(text || '');
    const safe = Math.max(0, Math.min(Number(index) || 0, source.length));
    const before = source.slice(0, safe).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }

  function selectedLineRange(text, start, end) {
    const source = String(text || '');
    const from = cursorPosition(source, start);
    const finish = cursorPosition(source, end);
    const to = finish.column === 1 && finish.line > from.line && end > start
      ? finish.line - 1
      : finish.line;
    return { start: from.line, end: Math.max(from.line, to) };
  }

  function replaceLines(text, start, end, transform) {
    return splitLines(text)
      .map((line, index) => {
        const number = index + 1;
        return number >= start && number <= end ? String(transform(line, number)) : line;
      })
      .join('\n');
  }

  function toggleComment(text, start, end) {
    return replaceLines(text, start, end, line => {
      const indent = (String(line).match(/^\s*/) || [''])[0];
      const body = String(line).slice(indent.length);
      if (body.startsWith('!')) return indent + body.slice(1).replace(/^\s+/, '');
      return indent + '! ' + body;
    });
  }

  function duplicateLines(text, start, end) {
    const lines = splitLines(text);
    const from = Math.max(1, start);
    const to = Math.min(lines.length, end);
    const copies = lines.slice(from - 1, to);
    return lines.reduce((result, line, index) => {
      result.push(line);
      if (index + 1 >= from && index + 1 <= to) result.push(copies[index + 1 - from]);
      return result;
    }, []).join('\n');
  }

  function deleteLines(text, start, end) {
    return splitLines(text)
      .filter((line, index) => index + 1 < start || index + 1 > end)
      .join('\n');
  }

  function findNext(text, query, from) {
    const source = String(text || '');
    const needle = String(query || '');
    if (!needle) return null;
    const at = source.toLowerCase().indexOf(needle.toLowerCase(), Math.max(0, Number(from) || 0));
    return at === -1 ? null : { start: at, end: at + needle.length };
  }

  function span(doc, className, value) {
    const node = doc.createElement('span');
    node.className = className;
    node.textContent = String(value || '');
    return node;
  }

  function decorateLine(doc, parent, line) {
    const value = String(line || '');
    const kind = classifyLine(value);
    const wrapper = doc.createElement('span');
    wrapper.className = 'filter-line filter-line--' + kind;
    const marker = cosmeticMarker(value);

    if (kind === 'comment') {
      wrapper.appendChild(span(doc, 'filter-comment', value));
    } else if (kind === 'cosmetic' && marker) {
      const at = value.indexOf(marker);
      wrapper.append(
        span(doc, 'filter-domain', value.slice(0, at)),
        span(doc, 'filter-marker', marker),
        span(doc, 'filter-selector', value.slice(at + marker.length))
      );
    } else if (kind === 'exception') {
      const optionAt = value.indexOf('$');
      wrapper.append(
        span(doc, 'filter-exception', '@@'),
        span(doc, 'filter-pattern', value.slice(2, optionAt === -1 ? undefined : optionAt)),
        optionAt === -1 ? doc.createTextNode('') : span(doc, 'filter-options', value.slice(optionAt))
      );
    } else {
      const optionAt = value.indexOf('$');
      wrapper.append(
        span(doc, 'filter-pattern', value.slice(0, optionAt === -1 ? undefined : optionAt)),
        optionAt === -1 ? doc.createTextNode('') : span(doc, 'filter-options', value.slice(optionAt))
      );
    }
    parent.appendChild(wrapper);
  }

  function renderHighlight(doc, overlay, text) {
    if (!doc || !overlay) return;
    const lines = splitLines(text);
    overlay.textContent = '';
    lines.forEach((line, index) => {
      decorateLine(doc, overlay, line);
      if (index < lines.length - 1) overlay.appendChild(doc.createTextNode('\n'));
    });
    overlay.appendChild(doc.createTextNode('\n'));
  }

  function create(config) {
    const options = config || {};
    const doc = options.document || global.document;
    const textarea = options.textarea;
    const gutter = options.gutter;
    const overlay = options.overlay;
    const position = options.position;
    const dirty = options.dirty;
    const issues = options.issues;
    const findInput = options.find;
    const client = options.client;
    const setStatus = options.setStatus || (() => {});
    const onSave = options.onSave || (() => {});
    let savedValue = String(options.value || '');

    function render() {
      const value = textarea.value;
      gutter.textContent = lineNumbers(value);
      renderHighlight(doc, overlay, value);
      overlay.scrollTop = textarea.scrollTop;
      gutter.scrollTop = textarea.scrollTop;
      if (dirty) dirty.hidden = value === savedValue;
      updatePosition();
    }

    function resetView(value) {
      textarea.value = String(value || '');
      savedValue = textarea.value;
      render();
    }

    function updatePosition() {
      if (!position) return;
      const point = cursorPosition(textarea.value, textarea.selectionStart);
      position.textContent = 'Ln ' + point.line + ', Col ' + point.column;
    }

    function changed() {
      render();
      if (issues) issues.textContent = '';
    }

    function syncScroll() {
      overlay.scrollTop = textarea.scrollTop;
      gutter.scrollTop = textarea.scrollTop;
    }

    function selectRange(start, end) {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      updatePosition();
    }

    function transformSelection(transform) {
      const range = selectedLineRange(textarea.value,
        textarea.selectionStart, textarea.selectionEnd);
      const before = textarea.value;
      textarea.value = transform(before, range.start, range.end);
      const kept = Math.min(textarea.selectionStart, textarea.value.length);
      selectRange(kept, kept);
      changed();
    }

    function insertIndent() {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText('  ', start, end, 'end');
      changed();
    }

    function focusLine(lineNumber) {
      const lines = splitLines(textarea.value);
      const target = Math.max(1, Math.min(Number(lineNumber) || 1, lines.length));
      const start = lines.slice(0, target - 1)
        .reduce((total, line) => total + line.length + 1, 0);
      selectRange(start, start + lines[target - 1].length);
    }

    function findAgain() {
      const query = findInput ? findInput.value : '';
      if (!query) return;
      const from = textarea.selectionEnd;
      const found = findNext(textarea.value, query, from) ||
        findNext(textarea.value, query, 0);
      if (!found) {
        setStatus('No match for "' + query + '".');
        return;
      }
      selectRange(found.start, found.end);
    }

    function showIssues(entries) {
      if (!issues) return;
      const list = Array.isArray(entries) ? entries : [];
      issues.textContent = '';
      if (!list.length) {
        const empty = doc.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'No issues found.';
        issues.appendChild(empty);
        return;
      }
      list.forEach(entry => {
        const item = doc.createElement('li');
        const jump = doc.createElement('button');
        jump.type = 'button';
        jump.className = 'issue-line';
        jump.textContent = 'Line ' + (Number(entry.line) || 0);
        jump.addEventListener('click', () => focusLine(entry.line));
        const message = doc.createElement('span');
        const label = entry.kind === 'notice' ? 'notice' : (entry.category || 'rule');
        if (entry.kind === 'notice') item.className = 'notice';
        message.textContent = label + ': ' + (entry.reason || 'invalid rule');
        item.append(jump, message);
        issues.appendChild(item);
      });
    }

    async function validate() {
      setStatus('Validating…');
      try {
        const result = await client.send('validate-filters', { value: textarea.value });
        if (!result.ok) throw new Error(result.error || 'Validation failed.');
        const validation = result.validation || {};
        const issues = Array.isArray(validation.issues) ? validation.issues : [];
        const notices = Array.isArray(validation.notices) ? validation.notices : [];
        showIssues(issues.map(entry => Object.assign({ kind: 'issue' }, entry))
          .concat(notices.map(entry => Object.assign({ kind: 'notice' }, entry)))
          .sort((left, right) => left.line - right.line));
        setStatus(issues.length
          ? issues.length + (issues.length === 1 ? ' issue found.' : ' issues found.')
          : notices.length
            ? 'No issues; ' + notices.length + (notices.length === 1 ? ' notice.' : ' notices.')
            : 'No issues found.');
      } catch (error) {
        setStatus(error.message || 'Validation failed.');
      }
    }

    textarea.addEventListener('input', changed);
    textarea.addEventListener('scroll', syncScroll);
    textarea.addEventListener('click', updatePosition);
    textarea.addEventListener('keyup', updatePosition);
    textarea.addEventListener('select', updatePosition);
    textarea.addEventListener('keydown', event => {
      const mod = event.ctrlKey || event.metaKey;
      const key = String(event.key || '').toLowerCase();
      if (mod && key === 's') {
        event.preventDefault();
        onSave();
      } else if (mod && key === '/') {
        event.preventDefault();
        transformSelection(toggleComment);
      } else if (mod && key === 'd') {
        event.preventDefault();
        transformSelection(duplicateLines);
      } else if (mod && event.shiftKey && key === 'k') {
        event.preventDefault();
        transformSelection(deleteLines);
      } else if (mod && key === 'g') {
        event.preventDefault();
        if (findInput) findInput.focus();
      } else if (key === 'tab') {
        event.preventDefault();
        insertIndent();
      }
    });

    if (options.validateButton) {
      options.validateButton.addEventListener('click', validate);
    }
    if (options.commentButton) {
      options.commentButton.addEventListener('click',
        () => transformSelection(toggleComment));
    }
    if (options.duplicateButton) {
      options.duplicateButton.addEventListener('click',
        () => transformSelection(duplicateLines));
    }
    if (options.deleteButton) {
      options.deleteButton.addEventListener('click',
        () => transformSelection(deleteLines));
    }
    if (options.findButton) options.findButton.addEventListener('click', findAgain);
    if (findInput) {
      findInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          findAgain();
        }
      });
    }

    resetView(options.value);

    return {
      render,
      resetView,
      validate,
      showIssues,
      focusLine,
      getValue: () => textarea.value,
      isDirty: () => textarea.value !== savedValue,
      markClean: () => {
        savedValue = textarea.value;
        if (dirty) dirty.hidden = true;
      },
      focusFind: () => { if (findInput) findInput.focus(); }
    };
  }

  api.splitLines = splitLines;
  api.classifyLine = classifyLine;
  api.lineNumbers = lineNumbers;
  api.cursorPosition = cursorPosition;
  api.selectedLineRange = selectedLineRange;
  api.replaceLines = replaceLines;
  api.toggleComment = toggleComment;
  api.duplicateLines = duplicateLines;
  api.deleteLines = deleteLines;
  api.findNext = findNext;
  api.renderHighlight = renderHighlight;
  api.create = create;
})(this);

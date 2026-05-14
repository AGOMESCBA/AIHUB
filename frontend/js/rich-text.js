(function () {
  const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'SPAN']);
  const QUILL_EDITORS = new Map();

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function looksLikeHtml(value) {
    return /<\/?(p|br|strong|b|em|i|u|ul|ol|li|span)\b/i.test(String(value || ''));
  }

  function plainToHtml(value) {
    const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!text.trim()) return '';
    return text.split(/\n{2,}/).map(block => {
      const lines = block.split('\n').map(line => escapeHtml(line));
      return `<p>${lines.join('<br>')}</p>`;
    }).join('');
  }

  function sanitizeColor(value) {
    const color = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
    if (/^rgb(a)?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
    return '';
  }

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;

    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');

      const tag = node.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        node.childNodes.forEach(child => fragment.appendChild(clean(child)));
        return fragment;
      }

      const el = document.createElement(tag.toLowerCase());
      if (tag === 'SPAN') {
        const color = sanitizeColor(node.style.color);
        if (color) el.style.color = color;
      }
      node.childNodes.forEach(child => el.appendChild(clean(child)));
      return el;
    }

    const out = document.createElement('div');
    root.childNodes.forEach(child => out.appendChild(clean(child)));
    return out.innerHTML
      .replace(/<p>\s*<\/p>/gi, '')
      .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
      .trim();
  }

  function normalizeRich(value) {
    const html = looksLikeHtml(value) ? String(value || '') : plainToHtml(value);
    return sanitizeHtml(html);
  }

  function richPlainText(value) {
    const html = normalizeRich(value);
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const parts = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') parts.push('\n');
      if (tag === 'LI') parts.push('- ');
      node.childNodes.forEach(walk);
      if (['P', 'LI', 'UL', 'OL'].includes(tag)) parts.push('\n');
    }

    doc.body.firstElementChild.childNodes.forEach(walk);
    return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function ensureInitialized(id) {
    const textarea = document.getElementById(id);
    if (textarea && textarea.matches('textarea[data-rich-text]') && textarea.dataset.richInitialized !== '1') {
      initRichEditors(textarea.parentElement || document);
    }
  }

  function setRichValue(id, value) {
    ensureInitialized(id);
    const textarea = document.getElementById(id);
    const html = normalizeRich(value || '');
    if (textarea) textarea.value = html;
    const quill = QUILL_EDITORS.get(id);
    if (quill) {
      quill.clipboard.dangerouslyPasteHTML(html || '');
      return;
    }
    const editor = document.querySelector(`[data-rich-editor-for="${id}"]`);
    if (editor) editor.innerHTML = html;
  }

  function getRichValue(id) {
    ensureInitialized(id);
    const textarea = document.getElementById(id);
    const quill = QUILL_EDITORS.get(id);
    const editor = document.querySelector(`[data-rich-editor-for="${id}"]`);
    const raw = quill ? quill.root.innerHTML : (editor ? editor.innerHTML : textarea?.value || '');
    const html = sanitizeHtml(raw);
    if (textarea) textarea.value = html;
    return html;
  }

  function createQuillEditor(textarea) {
    const wrap = document.createElement('div');
    wrap.className = 'rich-text rich-text-quill';

    const editor = document.createElement('div');
    editor.setAttribute('data-rich-editor-for', textarea.id);
    wrap.appendChild(editor);
    textarea.insertAdjacentElement('afterend', wrap);

    const quill = new Quill(editor, {
      theme: 'snow',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ list: 'bullet' }, { list: 'ordered' }],
          [{ color: [] }],
          ['clean'],
        ],
      },
    });

    QUILL_EDITORS.set(textarea.id, quill);
    quill.clipboard.dangerouslyPasteHTML(normalizeRich(textarea.value || ''));
    textarea.value = sanitizeHtml(quill.root.innerHTML);
    quill.on('text-change', () => {
      textarea.value = sanitizeHtml(quill.root.innerHTML);
    });
  }

  function createFallbackEditor(textarea) {
    const wrap = document.createElement('div');
    wrap.className = 'rich-text rich-text-fallback';
    const editor = document.createElement('div');
    editor.className = 'rich-text-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('data-rich-editor-for', textarea.id);
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.dataset.placeholder = textarea.getAttribute('placeholder') || '';
    editor.innerHTML = normalizeRich(textarea.value || '');
    editor.addEventListener('input', () => { textarea.value = sanitizeHtml(editor.innerHTML); });
    editor.addEventListener('blur', () => { editor.innerHTML = sanitizeHtml(editor.innerHTML); textarea.value = editor.innerHTML; });
    wrap.appendChild(editor);
    textarea.insertAdjacentElement('afterend', wrap);
    textarea.value = sanitizeHtml(editor.innerHTML);
  }

  function initRichEditors(scope = document) {
    scope.querySelectorAll('textarea[data-rich-text]').forEach(textarea => {
      if (textarea.dataset.richInitialized === '1') return;
      textarea.dataset.richInitialized = '1';
      textarea.classList.add('rich-text-source');
      if (window.Quill) createQuillEditor(textarea);
      else createFallbackEditor(textarea);
    });
  }

  window.initRichEditors = initRichEditors;
  window.setRichValue = setRichValue;
  window.getRichValue = getRichValue;
  window.richRender = normalizeRich;
  window.richPlainText = richPlainText;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initRichEditors());
  } else {
    initRichEditors();
  }
})();

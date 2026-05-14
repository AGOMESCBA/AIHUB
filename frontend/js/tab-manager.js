(function () {
  // url → { label, icon, empresaId, empresaNome, chip, frame }
  const _tabs   = new Map();
  let   _active = null;
  let   _listaEmpresas = null;

  // ── Persistência de abas (sobrevive ao F5) ────────────────────────────────────
  const _PERSIST_KEY = 'iahub_mdi_state';
  let   _restoring   = false;

  function _saveState() {
    if (_restoring) return;
    try {
      sessionStorage.setItem(_PERSIST_KEY, JSON.stringify({
        tabs: [..._tabs.entries()].map(([k, t]) => ({
          k, url: t.url, label: t.label, icon: t.icon,
          empresaId: t.empresaId, empresaNome: t.empresaNome,
        })),
        active: _active,
      }));
    } catch(_) {}
  }

  function _restoreState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(_PERSIST_KEY) || 'null');
      if (!saved?.tabs?.length) return;
      const targetActive = saved.active;
      _restoring = true;
      saved.tabs.forEach(t =>
        openTab(t.url, t.label, t.icon,
          t.empresaId != null ? t.empresaId : null,
          t.empresaNome || null)
      );
      _restoring = false;
      if (targetActive && _tabs.has(targetActive)) _activateTab(targetActive);
      else if (_tabs.size > 0) _activateTab([..._tabs.keys()][0]);
      _saveState();
    } catch(_) { _restoring = false; }
  }

  async function _getEmpresas() {
    if (_listaEmpresas) return _listaEmpresas;
    _listaEmpresas = await fetch('/api/empresas/minhas').then(r => r.json()).catch(() => []);
    _listaEmpresas.sort((a, b) =>
      (a.razao_social || a.nome || '').localeCompare(b.razao_social || b.nome || '', 'pt-BR'));
    return _listaEmpresas;
  }

  // ── Abrir ou ativar aba ───────────────────────────────────────────────────────
  // empresaIdOverride / empresaNomeOverride: quando a aba deve usar uma empresa
  // diferente da sessão (ex: abrir monitor de outra empresa pelo Monitores)
  function openTab(url, label, icon, empresaIdOverride = null, empresaNomeOverride = null) {
    const empresaId   = (empresaIdOverride != null) ? empresaIdOverride : (window._iahubEmpresa?.id ?? null);
    const empresaNome = empresaNomeOverride ?? window._iahubEmpresa?.nome ?? '';
    // Chave inclui empresa para permitir o mesmo URL aberto para empresas diferentes
    const tabKey = empresaId ? `${url}?_empresa=${empresaId}` : url;

    if (_tabs.has(tabKey)) { _activateTab(tabKey); return; }

    const bar     = document.getElementById('mdi-tabbar');
    const content = document.getElementById('mdi-content');
    if (!bar || !content) return;

    const chip = document.createElement('button');
    chip.type      = 'button';
    chip.className = 'mdi-tab';
    chip.dataset.url = tabKey;
    chip.draggable = true;
    chip.innerHTML = _chipHtml(icon, label);

    chip.addEventListener('click', (e) => {
      if (chip.dataset.dragSuppress === '1') return;
      if (e.target.closest('.mdi-tab-close')) {
        e.stopPropagation();
        closeTab(tabKey);
      } else {
        _activateTab(tabKey);
      }
    });
    chip.addEventListener('dragstart', (e) => _handleTabDragStart(e, tabKey));
    chip.addEventListener('dragend', () => _handleTabDragEnd(chip));
    bar.appendChild(chip);

    const frame = document.createElement('iframe');
    frame.className   = 'mdi-iframe';
    frame.dataset.url = tabKey;
    frame.src         = empresaId ? `${url}?_empresa=${empresaId}` : url;
    frame.addEventListener('load', () => _prepareFrame(frame, _tabs.get(tabKey)));
    content.appendChild(frame);

    _tabs.set(tabKey, { label, icon, empresaId, empresaNome, url, chip, frame });
    _activateTab(tabKey);
    _saveState();
    setTimeout(_updateScrollBtns, 60);
  }

  // ── Fechar aba ────────────────────────────────────────────────────────────────
  function closeTab(url) {
    const t = _tabs.get(url);
    if (!t) return;
    t.chip.remove();
    t.frame.remove();
    _tabs.delete(url);

    if (_active === url) {
      _active = null;
      const keys = [..._tabs.keys()];
      if (keys.length) {
        _activateTab(keys[keys.length - 1]);
      } else {
        _syncSidebarActive(null);
        _setTopbarTitle(null);
        const empty = document.getElementById('mdi-empty');
        if (empty) empty.style.display = '';
      }
    }
    _saveState();
    setTimeout(_updateScrollBtns, 60);
  }

  // ── Ativar aba existente ──────────────────────────────────────────────────────
  function _activateTab(url) {
    _tabs.forEach(({ chip, frame }) => {
      chip.classList.remove('active');
      frame.classList.remove('active');
    });
    const t = _tabs.get(url);
    if (!t) return;
    t.chip.classList.add('active');
    t.frame.classList.add('active');
    _active = url;

    const empty = document.getElementById('mdi-empty');
    if (empty) empty.style.display = 'none';

    t.chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    setTimeout(_updateScrollBtns, 350);
    _syncSidebarActive(url);
    _setTopbarTitle(t);
    _saveState();
  }

  function _handleTabDragStart(e, tabKey) {
    if (e.target.closest('.mdi-tab-close')) {
      e.preventDefault();
      return;
    }

    const chip = _tabs.get(tabKey)?.chip;
    if (!chip) return;

    chip.dataset.dragSuppress = '1';
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabKey);
  }

  function _handleTabDragEnd(chip) {
    chip.classList.remove('dragging');
    setTimeout(() => { delete chip.dataset.dragSuppress; }, 0);
    _syncTabOrderFromDom();
    _saveState();
    _updateScrollBtns();
  }

  function _enableTabReorder(bar) {
    bar.addEventListener('dragover', (e) => {
      const dragging = bar.querySelector('.mdi-tab.dragging');
      if (!dragging) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const after = _getDragAfterTab(bar, e.clientX);
      if (after) bar.insertBefore(dragging, after);
      else bar.appendChild(dragging);
    });

    bar.addEventListener('drop', (e) => {
      if (!bar.querySelector('.mdi-tab.dragging')) return;
      e.preventDefault();
      _syncTabOrderFromDom();
      _saveState();
    });
  }

  function _getDragAfterTab(bar, x) {
    return [...bar.querySelectorAll('.mdi-tab:not(.dragging)')].reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function _syncTabOrderFromDom() {
    const bar = document.getElementById('mdi-tabbar');
    if (!bar) return;

    const ordered = new Map();
    bar.querySelectorAll('.mdi-tab').forEach(chip => {
      const key = chip.dataset.url;
      const tab = _tabs.get(key);
      if (tab) ordered.set(key, tab);
    });
    _tabs.forEach((tab, key) => {
      if (!ordered.has(key)) ordered.set(key, tab);
    });

    _tabs.clear();
    ordered.forEach((tab, key) => _tabs.set(key, tab));
  }

  // ── Trocar empresa de uma aba (barra da empresa ou postMessage) ───────────────
  async function _trocarEmpresaTab(url, empresaId) {
    const t = _tabs.get(url);
    if (!t) return;

    const lista = await _getEmpresas();
    const emp   = lista.find(e => Number(e.id) === Number(empresaId));
    if (!emp) return;

    t.empresaId   = emp.id;
    t.empresaNome = emp.razao_social || emp.nome || '';

    t.empresaId   = emp.id;
    t.empresaNome = emp.razao_social || emp.nome || '';
    t.frame.src   = `${t.url}?_empresa=${emp.id}`;
    _saveState();
  }

  // ── Seletor de empresa (dropdown flutuante na barra da aba) ───────────────────
  let _dropdownAtivo = null;

  async function _abrirSeletorEmpresa(url, anchorEl, frame = null) {
    _fecharDropdown();

    const lista = await _getEmpresas();
    const t     = _tabs.get(url);
    if (!lista.length || !t) return;

    const drop = document.createElement('div');
    drop.style.cssText = `
      position:fixed;top:0;left:0;z-index:9999;visibility:hidden;
      background:var(--bg-card);border:1px solid var(--border);border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,.2);width:max-content;min-width:220px;max-width:min(320px, calc(100vw - 16px));
      max-height:min(320px, calc(100vh - 16px));overflow:auto;padding:6px;font-size:13px;
    `;
    drop.innerHTML = lista.map(e => {
      const ativa = Number(e.id) === Number(t.empresaId);
      return `<button
        style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;
               background:${ativa ? 'var(--bg-active)' : 'none'};
               border:none;border-radius:7px;cursor:pointer;text-align:left;
               color:var(--text-hi);transition:background .12s;"
        onmouseover="this.style.background='var(--bg-hover)'"
        onmouseout="this.style.background='${ativa ? 'var(--bg-active)' : 'none'}'"
        data-id="${e.id}">
        <span style="font-size:14px">🏢</span>
        <span style="flex:1;font-weight:${ativa ? '700' : '500'}">${e.razao_social || e.nome || 'Empresa'}</span>
        ${ativa ? '<span style="font-size:10px;color:var(--accent)">✓</span>' : ''}
      </button>`;
    }).join('');

    drop.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      _fecharDropdown();
      _trocarEmpresaTab(url, Number(btn.dataset.id));
    });

    document.body.appendChild(drop);
    _posicionarDropdownEmpresa(drop, anchorEl, frame);
    _dropdownAtivo = drop;
    setTimeout(() => {
      document.addEventListener('click', _fecharDropdown, { once: true });
      if (anchorEl.ownerDocument !== document) {
        anchorEl.ownerDocument.addEventListener('click', _fecharDropdown, { once: true });
      }
    }, 0);
  }

  function _posicionarDropdownEmpresa(drop, anchorEl, frame = null) {
    const margin = 8;
    const gap = 4;
    const rect = _getAnchorRect(anchorEl, frame);
    const dropRect = drop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let left = rect.left - 10;
    if (left + dropRect.width > vw - margin) left = rect.right - dropRect.width + 10;
    left = Math.max(margin, Math.min(left, vw - dropRect.width - margin));

    let top = rect.bottom + gap;
    if (top + dropRect.height > vh - margin) top = rect.top - dropRect.height - gap;
    top = Math.max(margin, Math.min(top, vh - dropRect.height - margin));

    drop.style.left = `${left}px`;
    drop.style.top = `${top}px`;
    drop.style.visibility = 'visible';
  }

  function _getAnchorRect(anchorEl, frame = null) {
    const rect = anchorEl.getBoundingClientRect();
    if (!frame || anchorEl.ownerDocument === document) return rect;

    const frameRect = frame.getBoundingClientRect();
    return {
      left: frameRect.left + rect.left,
      right: frameRect.left + rect.right,
      top: frameRect.top + rect.top,
      bottom: frameRect.top + rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function _fecharDropdown() {
    _dropdownAtivo?.remove();
    _dropdownAtivo = null;
  }

  // ── Injetar CSS + barra de empresa no iframe ──────────────────────────────────
  function _prepareFrame(frame, tab) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.head) return;

      // CSS: oculta nav interna
      const prev = doc.getElementById('_mdi-style');
      if (prev) prev.remove();
      const s = doc.createElement('style');
      s.id = '_mdi-style';
      s.textContent = `
        html, body { overflow: hidden !important; }
        #sidebar, .sidebar, .topbar, #_empresa-badge,
        .sidebar-userinfo { display: none !important; }
        .layout { display: flex !important; flex-direction: column !important; height: 100% !important; }
        .main   { margin-left: 0 !important; flex: 1 !important; min-height: 0 !important; padding-top: 0 !important; }
        #_mdi-emp-bar {
          display: flex; align-items: center;
          padding: 5px 16px;
          color: var(--text-lo, #64748b);
          background: var(--bg-base, #f8fafc);
          border-bottom: 1px solid var(--border, #e2e8f0);
          flex-shrink: 0;
        }
        #_mdi-emp-btn {
          display: inline-flex; align-items: center; gap: 7px;
          max-width: 100%;
          padding: 3px 8px;
          border: 1px solid transparent;
          border-radius: 7px;
          background: transparent;
          color: var(--text-lo, #64748b);
          font: inherit;
          font-size: 12px; font-weight: 600;
          cursor: pointer;
        }
        #_mdi-emp-btn:hover {
          color: var(--accent, #2563eb);
          background: var(--bg-hover, #f1f5f9);
          border-color: var(--border, #e2e8f0);
        }
        #_mdi-emp-btn ._mdi-emp-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #_mdi-emp-btn ._mdi-emp-caret {
          font-size: 10px;
          opacity: .7;
          flex-shrink: 0;
        }
      `;
      doc.head.appendChild(s);

      // Barra de empresa — injeta antes do conteúdo principal
      const prevBar = doc.getElementById('_mdi-emp-bar');
      if (prevBar) prevBar.remove();
      const nome = tab?.empresaNome || '';
      if (nome) {
        const bar = doc.createElement('div');
        bar.id = '_mdi-emp-bar';
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.id = '_mdi-emp-btn';
        btn.title = `${nome} — clique para trocar a empresa desta aba`;

        const icon = doc.createElement('span');
        icon.textContent = '🏢';
        const name = doc.createElement('span');
        name.className = '_mdi-emp-name';
        name.textContent = nome;
        const caret = doc.createElement('span');
        caret.className = '_mdi-emp-caret';
        caret.textContent = '▼';

        btn.append(icon, name, caret);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          _abrirSeletorEmpresa(frame.dataset.url, btn, frame);
        });
        bar.appendChild(btn);
        const main = doc.querySelector('.main') || doc.body;
        main.insertBefore(bar, main.firstChild);
      }
    } catch (_) {}
  }

  // ── Escutar postMessage do iframe (troca de empresa por aba) ──────────────────
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const { type, empresaId } = e.data || {};
    if (type !== 'mdi:trocar-empresa' || !empresaId) return;
    for (const [url, t] of _tabs) {
      if (t.frame.contentWindow === e.source) {
        _trocarEmpresaTab(url, empresaId);
        break;
      }
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function _chipHtml(icon, label) {
    return `
      <span class="mdi-tab-icon">${icon}</span>
      <span class="mdi-tab-label" title="${label}">${label}</span>
      <span class="mdi-tab-close" title="Fechar aba">×</span>`;
  }

  function _syncSidebarActive(url) {
    document.querySelectorAll('#sidebar .nav-item').forEach(a => {
      const href  = a.getAttribute('href');
      const match = url && href && (url === href || url.endsWith(href));
      a.classList.toggle('active', !!match);
    });
  }

  function _setTopbarTitle(tab) {
    const el = document.getElementById('shell-title');
    if (!el) return;
    el.textContent = tab ? `${tab.icon}  ${tab.label}` : 'IAHub';
  }

  // ── Scroll buttons ────────────────────────────────────────────────────────────
  function _updateScrollBtns() {
    const bar   = document.getElementById('mdi-tabbar');
    const left  = document.getElementById('mdi-scroll-left');
    const right = document.getElementById('mdi-scroll-right');
    if (!bar || !left || !right) return;

    const chips = bar.querySelectorAll('.mdi-tab');
    if (!chips.length) {
      left.style.display = right.style.display = 'none';
      return;
    }

    // Usa posições visuais reais — mais confiável que scrollWidth em layouts flex
    const barRect   = bar.getBoundingClientRect();
    const firstRect = chips[0].getBoundingClientRect();
    const lastRect  = chips[chips.length - 1].getBoundingClientRect();

    left.style.display  = firstRect.left  < barRect.left  - 2 ? 'flex' : 'none';
    right.style.display = lastRect.right  > barRect.right + 2 ? 'flex' : 'none';
  }

  function scrollMdiTabs(dir) {
    const bar = document.getElementById('mdi-tabbar');
    if (bar) bar.scrollBy({ left: dir * 220, behavior: 'smooth' });
    setTimeout(_updateScrollBtns, 320);
  }

  // ── API pública ───────────────────────────────────────────────────────────────
  window.openTab       = openTab;
  window.closeTab      = closeTab;
  window.scrollMdiTabs = scrollMdiTabs;

  document.addEventListener('DOMContentLoaded', () => {
    _restoreState();

    const bar = document.getElementById('mdi-tabbar');
    if (bar) {
      _enableTabReorder(bar);
      bar.addEventListener('scroll', _updateScrollBtns);
      // Observa o wrap pai (muda de tamanho quando a janela redimensiona)
      new ResizeObserver(_updateScrollBtns).observe(bar.parentElement || bar);
      // Detecta adição/remoção de chips (scrollWidth muda mas clientWidth não)
      new MutationObserver(() => setTimeout(_updateScrollBtns, 50)).observe(bar, { childList: true });
    }
    window.addEventListener('resize', _updateScrollBtns);
    // Atualiza após todo o restore estar pintado na tela
    setTimeout(_updateScrollBtns, 100);
    setTimeout(_updateScrollBtns, 500);

    // Intercepta F5 e Ctrl+R quando o foco está no shell (fora dos iframes)
    // → recarrega o iframe ativo em vez do shell inteiro
    document.addEventListener('keydown', (e) => {
      const isRefresh = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.shiftKey);
      if (!isRefresh) return;
      const t = _active ? _tabs.get(_active) : null;
      if (!t?.frame) return;
      e.preventDefault();
      try { t.frame.contentWindow.location.reload(); } catch(_) {}
    });
  });
})();

(function () {
  // url → { label, icon, empresaId, empresaNome, chip, frame }
  const _tabs   = new Map();
  let   _active = null;
  let   _listaEmpresas = null;

  // Chave separada do IA Recruit para não misturar estado de abas
  const _PERSIST_KEY = 'iac_mdi_state';
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

  function _stripEmpresaParam(url) {
    try {
      const [path, qs] = url.split('?');
      if (!qs) return url;
      const params = new URLSearchParams(qs);
      params.delete('empresa_id');
      const cleaned = params.toString();
      return cleaned ? `${path}?${cleaned}` : path;
    } catch (_) { return url; }
  }

  function openTab(url, label, icon, empresaIdOverride = null, empresaNomeOverride = null) {
    const baseUrl   = _stripEmpresaParam(url);
    const empresaId   = (empresaIdOverride != null) ? empresaIdOverride : (window._iahubEmpresa?.id ?? null);
    const empresaNome = empresaNomeOverride ?? window._iahubEmpresa?.nome ?? '';
    const tabKey = empresaId ? `${baseUrl}?empresa_id=${empresaId}` : baseUrl;

    if (_tabs.has(tabKey)) { _activateTab(tabKey); _reloadTab(tabKey); return; }

    // Fallback: aba com mesma URL base já aberta (ex.: empresa mudou mas página é a mesma)
    for (const [key, tab] of _tabs) {
      if (tab.url === baseUrl) { _activateTab(key); _reloadTab(key); return; }
    }

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
      const currentKey = chip.dataset.url;
      if (e.target.closest('.mdi-tab-close')) {
        e.stopPropagation();
        closeTab(currentKey);
      } else {
        _activateTab(currentKey);
      }
    });
    chip.addEventListener('dragstart', (e) => _handleTabDragStart(e, chip.dataset.url));
    chip.addEventListener('dragend', () => _handleTabDragEnd(chip));
    bar.appendChild(chip);

    const frame = document.createElement('iframe');
    frame.className   = 'mdi-iframe';
    frame.dataset.url = tabKey;
    frame.src         = _tabSrc(baseUrl, empresaId);
    frame.addEventListener('load', () => _prepareFrame(frame, _tabs.get(frame.dataset.url)));
    content.appendChild(frame);

    _tabs.set(tabKey, { label, icon, empresaId, empresaNome, url: baseUrl, chip, frame });
    _activateTab(tabKey);
    _saveState();
    setTimeout(_updateScrollBtns, 60);
  }

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

  function _tabSrc(baseUrl, empresaId) {
    return empresaId ? `${baseUrl}?empresa_id=${empresaId}&_v=${Date.now()}` : `${baseUrl}?_v=${Date.now()}`;
  }

  function _reloadTab(tabKey) {
    const tab = _tabs.get(tabKey);
    if (!tab?.frame) return;
    tab.frame.src = _tabSrc(tab.url, tab.empresaId);
  }

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
    _syncTopbarHelp(t);
    _saveState();
  }

  function _handleTabDragStart(e, tabKey) {
    if (e.target.closest('.mdi-tab-close')) { e.preventDefault(); return; }
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
    _tabs.forEach((tab, key) => { if (!ordered.has(key)) ordered.set(key, tab); });
    _tabs.clear();
    ordered.forEach((tab, key) => _tabs.set(key, tab));
  }

  async function _trocarEmpresaTab(url, empresaId) {
    const t = _tabs.get(url);
    if (!t) return;
    const lista = await _getEmpresas();
    const emp   = lista.find(e => Number(e.id) === Number(empresaId));
    if (!emp) return;
    _atualizarEmpresaTab(url, emp);
  }

  function _tabKey(tab, empresaId) {
    return empresaId ? `${tab.url}?empresa_id=${empresaId}` : tab.url;
  }

  function _aplicarEmpresaNaTab(oldKey, tab, emp) {
    const newKey = _tabKey(tab, emp.id);
    tab.empresaId   = emp.id;
    tab.empresaNome = emp.razao_social || emp.nome || '';
    tab.chip.dataset.url  = newKey;
    tab.frame.dataset.url = newKey;
    tab.frame.src         = _tabSrc(tab.url, emp.id);
    if (_active === oldKey) _active = newKey;
    return newKey;
  }

  function _atualizarEmpresaTab(oldKey, emp) {
    const tab = _tabs.get(oldKey);
    if (!tab) return;
    const newKey = _aplicarEmpresaNaTab(oldKey, tab, emp);
    if (newKey !== oldKey) {
      _tabs.delete(oldKey);
      const duplicate = _tabs.get(newKey);
      if (duplicate) {
        duplicate.chip.remove();
        duplicate.frame.remove();
      }
      _tabs.set(newKey, tab);
    }
    _activateTab(newKey);
    _saveState();
  }

  async function trocarEmpresaTodasAbas(empresaId, empresaNome = null) {
    const lista = empresaNome ? [] : await _getEmpresas();
    const emp = empresaNome
      ? { id: Number(empresaId), razao_social: empresaNome }
      : lista.find(e => Number(e.id) === Number(empresaId));
    if (!emp) return;

    const entries = [..._tabs.entries()];
    if (!entries.length) return;

    const chosen = new Map();
    for (const [oldKey, tab] of entries) {
      const newKey = _tabKey(tab, emp.id);
      const existing = chosen.get(newKey);
      if (!existing || oldKey === _active) chosen.set(newKey, { oldKey, tab });
    }

    const keepTabs = new Set([...chosen.values()].map(({ tab }) => tab));
    for (const [, tab] of entries) {
      if (keepTabs.has(tab)) continue;
      tab.chip.remove();
      tab.frame.remove();
    }

    const nextTabs = new Map();
    for (const [oldKey, tab] of entries) {
      if (!keepTabs.has(tab)) continue;
      const newKey = _aplicarEmpresaNaTab(oldKey, tab, emp);
      nextTabs.set(newKey, tab);
    }

    _tabs.clear();
    nextTabs.forEach((tab, key) => _tabs.set(key, tab));
    if (_active && !_tabs.has(_active)) _active = [..._tabs.keys()][0] || null;
    if (_active) _activateTab(_active);
    _saveState();
    setTimeout(_updateScrollBtns, 60);
  }

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
      box-shadow:0 8px 32px rgba(0,0,0,.2);width:max-content;min-width:220px;max-width:min(320px,calc(100vw - 16px));
      max-height:min(320px,calc(100vh - 16px));overflow:auto;padding:6px;font-size:13px;
    `;
    drop.innerHTML = lista.map(e => {
      const ativa = Number(e.id) === Number(t.empresaId);
      return `<button style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;
        background:${ativa ? 'var(--bg-active)' : 'none'};border:none;border-radius:7px;cursor:pointer;
        text-align:left;color:var(--text-hi);transition:background .12s;"
        onmouseover="this.style.background='var(--bg-hover)'"
        onmouseout="this.style.background='${ativa ? 'var(--bg-active)' : 'none'}'"
        data-id="${e.id}">
        <span style="font-size:14px">🏢</span>
        <span style="flex:1;font-weight:${ativa ? '700' : '500'}">${e.razao_social || e.nome || 'Empresa'}</span>
        ${ativa ? '<span style="font-size:10px;color:#7c3aed">✓</span>' : ''}
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
      if (anchorEl.ownerDocument !== document)
        anchorEl.ownerDocument.addEventListener('click', _fecharDropdown, { once: true });
    }, 0);
  }

  function _posicionarDropdownEmpresa(drop, anchorEl, frame = null) {
    const margin = 8; const gap = 4;
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
      left: frameRect.left + rect.left, right: frameRect.left + rect.right,
      top: frameRect.top + rect.top, bottom: frameRect.top + rect.bottom,
      width: rect.width, height: rect.height,
    };
  }

  function _fecharDropdown() { _dropdownAtivo?.remove(); _dropdownAtivo = null; }

  function _prepareFrame(frame, tab) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.head) return;

      const prev = doc.getElementById('_mdi-style');
      if (prev) prev.remove();
      const s = doc.createElement('style');
      s.id = '_mdi-style';
      s.textContent = `
        html, body { overflow: hidden !important; min-width: 0 !important; }
        #sidebar, .sidebar, .topbar, #_empresa-badge,
        .sidebar-userinfo { display: none !important; }
        .layout { display: flex !important; flex-direction: column !important; height: 100% !important; min-width: 0 !important; }
        .main   { margin-left: 0 !important; flex: 1 !important; min-height: 0 !important; min-width: 0 !important; padding-top: 0 !important; }
        .page-content { min-width: 0 !important; }
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
          max-width: 100%; padding: 3px 8px;
          border: 1px solid transparent; border-radius: 7px;
          background: transparent; color: var(--text-lo, #64748b);
          font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
        }
        #_mdi-emp-btn:hover {
          color: #7c3aed; background: var(--bg-hover, #f1f5f9);
          border-color: var(--border, #e2e8f0);
        }
        #_mdi-emp-btn ._mdi-emp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #_mdi-emp-btn ._mdi-emp-caret { font-size: 10px; opacity: .7; flex-shrink: 0; }
        #_mdi-help-btn {
          margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
          height: 26px; padding: 0 9px; border: 1px solid transparent; border-radius: 7px;
          background: transparent; color: var(--text-lo, #64748b);
          font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
        }
        #_mdi-help-btn:hover {
          color: #7c3aed; background: var(--bg-hover, #f1f5f9);
          border-color: var(--border, #e2e8f0);
        }
        .table-wrap,
        .card,
        .form-section,
        .detail-card,
        .tabulator {
          min-width: 0 !important;
        }
        .table-wrap,
        .tabulator {
          overflow-x: auto !important;
        }
        .quick-row,
        .grid-toolbar,
        .head-row,
        .head-actions,
        .page-head,
        .editor-bar,
        .editor-actions,
        .con-toolbar {
          min-width: 0 !important;
        }
        @media (max-width: 900px) {
          .page-content { padding: 16px !important; }
          .page-head,
          .head-row,
          .editor-bar,
          .grid-toolbar {
            align-items: flex-start !important;
            flex-direction: column !important;
          }
          .head-actions,
          .editor-actions,
          .quick-row,
          .con-toolbar,
          .grid-toolbar > * {
            width: 100% !important;
          }
          .quick-row .form-control,
          .quick-row input.form-control,
          .quick-row select.form-control,
          .busca-wrap,
          .busca-wrap input {
            width: 100% !important;
            min-width: 0 !important;
          }
          .btn {
            max-width: 100%;
          }
          .editor-grid,
          .editor-grid-wide,
          .split,
          .dialog-grid,
          .inline-form,
          .date-row {
            grid-template-columns: 1fr !important;
          }
          .tabs,
          .form-tabs,
          .tabs-header {
            overflow-x: auto !important;
            flex-wrap: nowrap !important;
          }
        }
        @media (max-width: 520px) {
          .page-content { padding: 12px !important; }
          .card-body,
          .form-section-body,
          .tab-panel {
            padding: 14px !important;
          }
        }
      `;
      doc.head.appendChild(s);

      const prevBar = doc.getElementById('_mdi-emp-bar');
      if (prevBar) prevBar.remove();
      const nome = tab?.empresaNome || '';
      if (nome) {
        const bar = doc.createElement('div');
        bar.id = '_mdi-emp-bar';
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.id = '_mdi-emp-btn';
        btn.title = `${nome} — clique para trocar a empresa desta aba`;
        const icon = doc.createElement('span'); icon.textContent = '🏢';
        const name = doc.createElement('span'); name.className = '_mdi-emp-name'; name.textContent = nome;
        const caret = doc.createElement('span'); caret.className = '_mdi-emp-caret'; caret.textContent = '▼';
        btn.append(icon, name, caret);
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          _abrirSeletorEmpresa(frame.dataset.url, btn, frame);
        });
        bar.appendChild(btn);
        if (doc.getElementById('help-drawer')) {
          const helpBtn = doc.createElement('button');
          helpBtn.type = 'button';
          helpBtn.id = '_mdi-help-btn';
          helpBtn.title = 'Ajuda da pagina';
          helpBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Ajuda</span>`;
          helpBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            try {
              if (typeof frame.contentWindow.abrirAjuda === 'function') frame.contentWindow.abrirAjuda();
              else frame.contentWindow.postMessage({ type: 'page:open-ajuda' }, location.origin);
            } catch(_) {}
          });
          bar.appendChild(helpBtn);
        }
        const main = doc.querySelector('.main') || doc.body;
        main.insertBefore(bar, main.firstChild);
      }
      _enhanceHelpDrawer(doc, tab);
      if (tab && frame.classList.contains('active')) _syncTopbarHelp(tab);
    } catch (_) {}
  }

  function _enhanceHelpDrawer(doc, tab) {
    if (!/whatsapp-services\.html(?:$|\?)/.test(tab?.url || '')) return;
    const drawer = doc.getElementById('help-drawer');
    if (!drawer || drawer.dataset.mdiHelpEnhanced === '1') return;
    const body = drawer.querySelector('.help-drawer-body');
    if (!body) return;

    drawer.dataset.mdiHelpEnhanced = '1';
    const title = drawer.querySelector('.help-drawer-title')?.textContent || tab?.label || 'Ajuda';
    const profile = _helpProfile(tab?.url || '', title);

    const style = doc.createElement('style');
    style.id = '_mdi-help-enhance-style';
    style.textContent = `
      .mdi-help-updated { padding: 18px 22px 8px; border-bottom: 1px solid var(--border, #e2e8f0); background: var(--bg-card, #fff); }
      .mdi-help-kicker { color: var(--accent, #7c3aed); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
      .mdi-help-lead { color: var(--text-hi, #0f172a); font-size: 14px; line-height: 1.6; margin: 0 0 14px; }
      .mdi-help-visual { border: 1px solid var(--border, #e2e8f0); border-radius: 8px; background: linear-gradient(180deg, rgba(124,58,237,.06), rgba(14,165,233,.04)); margin: 12px 0 14px; overflow: hidden; }
      .mdi-help-visual svg { display: block; width: 100%; height: auto; }
      .mdi-help-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border, #e2e8f0); margin-top: 8px; overflow-x: auto; }
      .mdi-help-tab { border: 0; background: transparent; color: var(--text-lo, #64748b); cursor: pointer; padding: 9px 8px; font: inherit; font-size: 12px; font-weight: 800; border-bottom: 2px solid transparent; white-space: nowrap; }
      .mdi-help-tab.active { color: var(--accent, #7c3aed); border-bottom-color: var(--accent, #7c3aed); }
      .mdi-help-panel { display: none; padding: 14px 0 4px; }
      .mdi-help-panel.active { display: block; }
      .mdi-help-grid { display: grid; gap: 10px; }
      .mdi-help-card { border: 1px solid var(--border, #e2e8f0); border-radius: 8px; padding: 11px 12px; background: var(--bg-base, #f8fafc); }
      .mdi-help-card b { display: block; color: var(--text-hi, #0f172a); font-size: 13px; margin-bottom: 4px; }
      .mdi-help-card span { display: block; color: var(--text-md, #475569); font-size: 12.5px; line-height: 1.55; }
      .mdi-help-old-title { margin: 16px 0 10px; padding-top: 14px; border-top: 1px solid var(--border, #e2e8f0); color: var(--text-lo, #64748b); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
    `;
    doc.head.appendChild(style);

    const wrap = doc.createElement('div');
    wrap.className = 'mdi-help-updated';
    wrap.innerHTML = `
      <div class="mdi-help-kicker">Help atualizado do IA Command</div>
      <p class="mdi-help-lead">${profile.lead}</p>
      <div class="mdi-help-visual" aria-hidden="true">${_helpSvg(profile)}</div>
      <div class="mdi-help-tabs">
        <button class="mdi-help-tab active" type="button" data-help-panel="visao">Vis&atilde;o</button>
        <button class="mdi-help-tab" type="button" data-help-panel="fluxo">Fluxo</button>
        <button class="mdi-help-tab" type="button" data-help-panel="operacao">Opera&ccedil;&atilde;o</button>
      </div>
      <div class="mdi-help-panel active" data-help-panel-id="visao">${_helpCards(profile.visao)}</div>
      <div class="mdi-help-panel" data-help-panel-id="fluxo">${_helpCards(profile.fluxo)}</div>
      <div class="mdi-help-panel" data-help-panel-id="operacao">${_helpCards(profile.operacao)}</div>
    `;

    body.insertBefore(wrap, body.firstChild);
    const oldTitle = doc.createElement('div');
    oldTitle.className = 'mdi-help-old-title';
    oldTitle.textContent = 'Detalhes da tela';
    body.insertBefore(oldTitle, wrap.nextSibling);

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.mdi-help-tab');
      if (!btn) return;
      const id = btn.dataset.helpPanel;
      wrap.querySelectorAll('.mdi-help-tab').forEach(item => item.classList.toggle('active', item === btn));
      wrap.querySelectorAll('.mdi-help-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.helpPanelId === id));
    });
  }

  function _helpCards(items) {
    return `<div class="mdi-help-grid">${items.map(item => `
      <div class="mdi-help-card"><b>${item.t}</b><span>${item.d}</span></div>
    `).join('')}</div>`;
  }

  function _helpProfile(url, title) {
    const key = `${url} ${title}`.toLowerCase();
    const commonGrid = {
      t: 'Grid evoluida',
      d: 'Use busca, filtros por coluna, ordenacao e agrupamento para chegar ao registro certo antes de abrir detalhes ou executar acoes.'
    };

    if (/interpretacoes|execucoes|auditoria|logs|consumo/.test(key)) return {
      tone: 'trace',
      lead: 'Esta tela ajuda a diagnosticar o que a IA fez: entrada recebida, pipeline utilizado, SQL canonico, SQL executado, duracao e alertas de validacao.',
      visao: [
        { t: 'Observabilidade', d: 'Use a tela para investigar respostas incorretas, lentidao, quedas para pipeline classico e reaproveitamento canonico entre empresas.' },
        commonGrid,
        { t: 'Leitura principal', d: 'Comece por status, periodo, empresa, modulo e badges do pipeline antes de abrir SQL ou payloads detalhados.' }
      ],
      fluxo: [
        { t: 'Mensagem', d: 'A pergunta do usuario entra pelo WhatsApp ou teste interno e recebe contexto de empresa, canal e conversa.' },
        { t: 'IA e validacao', d: 'O sistema tenta resolver a intencao, gerar consulta segura e validar limites antes de tocar no ERP.' },
        { t: 'Resposta', d: 'O historico registra resultado, erro, duracao, SQL final e avisos para facilitar correcao fina.' }
      ],
      operacao: [
        { t: 'Quando usar', d: 'Use apos uma resposta estranha, consulta lenta, retorno vazio, erro de middleware ou duvida sobre qual modulo respondeu.' },
        { t: 'Sinais importantes', d: 'Badges de chat-first, classico, reuso canonico, validacao e fallback costumam explicar a maior parte dos casos.' },
        { t: 'Proximo passo', d: 'Com o diagnostico em maos, ajuste dataset, equivalencias, sinonimos, SX2/SX3 ou regras do modulo responsavel.' }
      ]
    };

    if (/whatsapp|monitor|canai|mensagens|numero|services/.test(key)) return {
      tone: 'whatsapp',
      lead: 'Esta tela faz parte da operacao WhatsApp: canais, numeros, sessoes, servicos Windows, mensagens recebidas e saude do bot.',
      visao: [
        { t: 'Canal por empresa', d: 'Cada numero deve estar vinculado a empresa, conexao ERP e configuracao de atendimento correta.' },
        commonGrid,
        { t: 'Estado operacional', d: 'Conectado, aguardando QR, parado e sem servico indicam pontos diferentes da cadeia WhatsApp.' }
      ],
      fluxo: [
        { t: 'Recepcao', d: 'A mensagem chega no canal, identifica empresa e contato, e segue para a camada de IA.' },
        { t: 'Consulta', d: 'A IA interpreta a pergunta, consulta o ERP quando necessario e registra rastros para auditoria.' },
        { t: 'Envio', d: 'A resposta volta pelo canal ativo; falhas aparecem no monitor, mensagens e historico de execucao.' }
      ],
      operacao: [
        { t: 'Primeiro checklist', d: 'Confirme servico iniciado, QR autenticado, empresa correta, conexao ativa e permissoes do usuario.' },
        { t: 'Falhas comuns', d: 'Sessao expirada, numero sem servico, canal sem empresa, conexao ERP indisponivel ou pergunta fora do escopo.' },
        { t: 'Boa pratica', d: 'Use numeros dedicados ao bot e acompanhe mensagens recentes antes de reiniciar servicos.' }
      ]
    };

    if (/dataset|conex|middleware|protheus|sx2|sx3|dicion/.test(key)) return {
      tone: 'data',
      lead: 'Esta area define como a IA entende o Protheus: conexoes, dicionarios, datasets SQL, campos permitidos e protecoes antes de consultar o ERP.',
      visao: [
        { t: 'Base tecnica da IA', d: 'Conexao, SX2/SX3, datasets e middleware formam o contrato entre linguagem natural e consulta segura.' },
        commonGrid,
        { t: 'Impacto direto', d: 'Uma descricao boa de tabela, campo, periodo e relacionamento melhora a resposta sem precisar alterar codigo.' }
      ],
      fluxo: [
        { t: 'Pergunta', d: 'O usuario pede uma analise em linguagem natural.' },
        { t: 'Mapeamento', d: 'A IA cruza intencao, datasets, sinonimos, SX2/SX3 e regras de periodo para montar o plano.' },
        { t: 'Protecao', d: 'O middleware valida SQL, tabelas, colunas e limites antes da execucao.' }
      ],
      operacao: [
        { t: 'Ao cadastrar', d: 'Prefira nomes de negocio, exemplos reais, filtros de periodo claros e campos textuais bem descritos.' },
        { t: 'Ao depurar', d: 'Compare SQL canonico com SQL executado e veja se a tabela fisica, filial, delete logico e periodo foram aplicados.' },
        { t: 'Evite', d: 'Datasets duplicados, descricoes genericas e campos criticos sem sinonimos de negocio.' }
      ]
    };

    if (/intenc|modulo|sinon|normaliza|dialog/.test(key)) return {
      tone: 'language',
      lead: 'Esta tela cuida da camada linguistica: como a IA reconhece assunto, vocabulario do usuario, dialogos sem ERP e variacoes de escrita.',
      visao: [
        { t: 'Entendimento de linguagem', d: 'Modulos, intencoes, sinonimos, equivalencias e normalizacao reduzem ambiguidades nas perguntas.' },
        commonGrid,
        { t: 'Quando mexer aqui', d: 'Ajuste quando a IA escolhe o modulo errado, nao entende um termo do negocio ou responde consulta para uma saudacao.' }
      ],
      fluxo: [
        { t: 'Texto bruto', d: 'A mensagem passa por normalizacao e pistas de vocabulario.' },
        { t: 'Classificacao', d: 'A IA combina exemplos, palavras-chave, intencoes e contexto da conversa.' },
        { t: 'Resposta', d: 'Pode seguir para ERP, pedir esclarecimento ou retornar um dialogo conversacional.' }
      ],
      operacao: [
        { t: 'Bons exemplos', d: 'Use frases reais dos usuarios, com variacoes de nomes, abreviacoes e perguntas incompletas.' },
        { t: 'Equivalencias', d: 'Cadastre termos de negocio que nao aparecem no Protheus, como apelidos de clientes, produtos ou indicadores.' },
        { t: 'Cuidado', d: 'Sinonimos amplos demais podem puxar uma pergunta para o modulo errado.' }
      ]
    };

    return {
      tone: 'overview',
      lead: 'Esta ajuda foi atualizada para refletir o IA Command atual: operacao por abas, troca de empresa por rotina, grids com filtros e rastreabilidade de IA.',
      visao: [
        { t: 'Tela dentro do MDI', d: 'Cada rotina abre em uma aba e pode manter empresa propria, filtros e contexto enquanto voce navega.' },
        commonGrid,
        { t: 'Ajuda contextual', d: 'O conteudo abaixo combina orientacao nova com os detalhes especificos que a tela ja possuia.' }
      ],
      fluxo: [
        { t: 'Configurar', d: 'Revise empresas, conexoes, dicionarios, datasets, intencoes e canais.' },
        { t: 'Operar', d: 'Acompanhe WhatsApp, mensagens, execucoes e interpretacoes.' },
        { t: 'Ajustar', d: 'Use os rastros para melhorar vocabulario, SQL base e regras de seguranca.' }
      ],
      operacao: [
        { t: 'Dica de navegacao', d: 'Use a barra superior da aba para trocar empresa e abrir esta ajuda sem sair da rotina.' },
        { t: 'Dica de grid', d: 'Agrupamentos ajudam a ver volume por empresa, status, modulo ou periodo sem exportar dados.' },
        { t: 'Dica de suporte', d: 'Ao reportar problema, envie empresa, horario, pergunta original e registro de interpretacao ou execucao.' }
      ]
    };
  }

  function _helpSvg(profile) {
    const colors = {
      trace: ['#7c3aed', '#0ea5e9', '#22c55e'],
      whatsapp: ['#16a34a', '#0ea5e9', '#7c3aed'],
      data: ['#0f766e', '#7c3aed', '#f59e0b'],
      language: ['#7c3aed', '#db2777', '#0ea5e9'],
      overview: ['#7c3aed', '#0ea5e9', '#22c55e']
    }[profile.tone] || ['#7c3aed', '#0ea5e9', '#22c55e'];
    return `
      <svg viewBox="0 0 520 150" role="img" aria-label="Fluxo visual do help">
        <defs>
          <linearGradient id="mdiHelpGrad" x1="0" x2="1">
            <stop offset="0" stop-color="${colors[0]}" stop-opacity=".16"/>
            <stop offset="1" stop-color="${colors[1]}" stop-opacity=".12"/>
          </linearGradient>
        </defs>
        <rect width="520" height="150" fill="url(#mdiHelpGrad)"/>
        <g font-family="Inter,Segoe UI,Arial,sans-serif" font-size="12" font-weight="800" text-anchor="middle">
          <rect x="28" y="42" width="120" height="54" rx="8" fill="#fff" stroke="${colors[0]}" stroke-opacity=".38"/>
          <text x="88" y="65" fill="#0f172a">Pergunta</text><text x="88" y="82" fill="#64748b" font-weight="600">usuario + empresa</text>
          <path d="M156 69 H204" stroke="${colors[1]}" stroke-width="3" stroke-linecap="round"/><path d="M198 62 l10 7 -10 7" fill="none" stroke="${colors[1]}" stroke-width="3"/>
          <rect x="212" y="42" width="120" height="54" rx="8" fill="#fff" stroke="${colors[1]}" stroke-opacity=".38"/>
          <text x="272" y="65" fill="#0f172a">IA Command</text><text x="272" y="82" fill="#64748b" font-weight="600">contexto + regras</text>
          <path d="M340 69 H388" stroke="${colors[2]}" stroke-width="3" stroke-linecap="round"/><path d="M382 62 l10 7 -10 7" fill="none" stroke="${colors[2]}" stroke-width="3"/>
          <rect x="396" y="42" width="96" height="54" rx="8" fill="#fff" stroke="${colors[2]}" stroke-opacity=".42"/>
          <text x="444" y="65" fill="#0f172a">Resultado</text><text x="444" y="82" fill="#64748b" font-weight="600">ERP ou dialogo</text>
        </g>
        <g fill="${colors[0]}" opacity=".12"><circle cx="54" cy="122" r="10"/><circle cx="470" cy="25" r="14"/><circle cx="260" cy="122" r="8"/></g>
      </svg>`;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const { type, empresaId } = e.data || {};
    if (type !== 'mdi:trocar-empresa' || !empresaId) return;
    for (const [url, t] of _tabs) {
      if (t.frame.contentWindow === e.source) { _trocarEmpresaTab(url, empresaId); break; }
    }
  });

  function _chipHtml(icon, label) {
    return `<span class="mdi-tab-icon">${icon}</span>
      <span class="mdi-tab-label" title="${label}">${label}</span>
      <span class="mdi-tab-close" title="Fechar aba">×</span>`;
  }

  function _syncSidebarActive(url) {
    const baseUrl = url ? url.split('?')[0] : null;
    document.querySelectorAll('#sidebar .nav-item').forEach(a => {
      const href  = a.getAttribute('href');
      const match = baseUrl && href && (baseUrl === href || baseUrl.endsWith(href));
      a.classList.toggle('active', !!match);
    });
  }

  function _setTopbarTitle(tab) {
    const el = document.getElementById('shell-title');
    if (!el) return;
    el.textContent = tab ? `${tab.icon}  ${tab.label}` : 'IA Command';
    _syncTopbarHelp(tab);
  }

  function _syncTopbarHelp(tab) {
    const btn = document.getElementById('_ajuda-btn');
    if (!btn) return;
    let hasHelp = false;
    try { hasHelp = !!tab?.frame?.contentDocument?.getElementById('help-drawer'); } catch (_) {}
    btn.style.display = hasHelp ? '' : 'none';
  }

  function _updateScrollBtns() {
    const bar   = document.getElementById('mdi-tabbar');
    const left  = document.getElementById('mdi-scroll-left');
    const right = document.getElementById('mdi-scroll-right');
    if (!bar || !left || !right) return;
    const chips = bar.querySelectorAll('.mdi-tab');
    if (!chips.length) { left.style.display = right.style.display = 'none'; return; }
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

  window.openTab       = openTab;
  window.closeTab      = closeTab;
  window.scrollMdiTabs = scrollMdiTabs;
  window.trocarEmpresaTodasAbas = trocarEmpresaTodasAbas;

  // ── Escutar postMessages dos iframes ─────────────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const { type, empresaId } = e.data || {};

    if (type === 'mdi:trocar-empresa' && empresaId) {
      for (const [url, t] of _tabs) {
        if (t.frame.contentWindow === e.source) { _trocarEmpresaTab(url, empresaId); break; }
      }
    }

    if (type === 'mdi:close-self') {
      for (const [url, t] of _tabs) {
        if (t.frame.contentWindow === e.source) { closeTab(url); break; }
      }
    }

    if (type === 'mdi:open-tab') {
      const { url: tabUrl, label: tabLabel, icon: tabIcon } = e.data;
      if (tabUrl) openTab(tabUrl, tabLabel || tabUrl, tabIcon || '📄');
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    _restoreState();
    const bar = document.getElementById('mdi-tabbar');
    if (bar) {
      _enableTabReorder(bar);
      bar.addEventListener('scroll', _updateScrollBtns);
      new ResizeObserver(_updateScrollBtns).observe(bar.parentElement || bar);
      new MutationObserver(() => setTimeout(_updateScrollBtns, 50)).observe(bar, { childList: true });
    }
    window.addEventListener('resize', _updateScrollBtns);
    setTimeout(_updateScrollBtns, 100);
    setTimeout(_updateScrollBtns, 500);

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

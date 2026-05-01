(function () {
  const PIN_KEY = 'iahub_sidebar_pinned';

  // ── Definição do menu ─────────────────────────────────────────────────────────
  const MENU = [
    {
      id: 'monitoramento', label: 'Monitoramento', icon: '💬', defaultOpen: true,
      items: [
        { label: 'Dashboard',        href: '/dashboard.html',     icon: '⊞' },
        { label: 'Monitor WhatsApp', href: '/monitor.html',        icon: '💬' },
        { label: 'Monitor E-mail',   href: '/monitor-email.html',  icon: '📧' },
      ],
    },
    {
      id: 'recrutamento', label: 'Recrutamento', icon: '🎯', defaultOpen: false,
      items: [
        { label: 'Currículos', href: '/curriculos.html', icon: '☰' },
        {
          id: 'ps', label: 'Processo Seletivo', icon: '🎯',
          items: [
            { label: 'Cadastro de Funções', href: '/funcoes.html',          icon: '📋' },
            { label: 'Vagas por Função',    href: '/vagas.html',            icon: '💼' },
            { label: 'Processo Seletivo',   href: '/processoseletivo.html', icon: '🌐' },
          ],
        },
        {
          id: 'analisador', label: 'Analisador de Currículos', icon: '🔍',
          items: [
            { label: 'Analisador',            href: '/analisador.html',  icon: '🔍' },
            { label: 'Histórico de Análises', href: '/historico.html',   icon: '📊' },
          ],
        },
      ],
    },
    {
      id: 'integracoes', label: 'Integrações', icon: '🔗', defaultOpen: false,
      items: [
        { label: 'SE Currículos', href: '/se-curriculos.html', icon: '🔗' },
      ],
    },
    {
      id: 'configurador', label: 'Configurador', icon: '⚙', defaultOpen: false,
      items: [
        { label: 'Configurações', href: '/configuracoes.html', icon: '⚙' },
        { label: 'Administração', href: '/administracao.html', icon: '🏢' },
      ],
    },
  ];

  // ── Utilitários ───────────────────────────────────────────────────────────────
  const curPath = location.pathname;

  function isActive(href) {
    return curPath === href || curPath.endsWith(href);
  }

  function itemsContainActive(items) {
    return items.some(i => (i.href && isActive(i.href)) || (i.items && itemsContainActive(i.items)));
  }

  function getSectionsOpen() {
    return new Set(MENU.filter(s => s.defaultOpen).map(s => s.id));
  }

  // ── Geração de HTML ───────────────────────────────────────────────────────────

  function navItemHtml(item, depth) {
    const active = item.href && isActive(item.href);
    const cls = ['nav-item', depth === 1 ? 'sub' : 'sub2', active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${item.href}" class="${cls}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
  }

  function navGroupHtml(group) {
    const hasActive = itemsContainActive(group.items || []);
    const openCls = hasActive ? ' open' : '';
    const parentOpenCls = hasActive ? ' open' : '';
    return `
      <div class="nav-parent${parentOpenCls}" onclick="toggleSubmenu('${group.id}')">
        <span class="nav-icon">${group.icon}</span>
        <span class="nav-label">${group.label}</span>
        <span class="nav-arrow">▾</span>
      </div>
      <div class="submenu${openCls}" id="sub-${group.id}">
        ${(group.items || []).map(i => navItemHtml(i, 2)).join('')}
      </div>`;
  }

  function sectionHtml(section, isOpen) {
    const openCls    = isOpen ? ' open' : '';
    const hdrOpenCls = isOpen ? ' open' : '';
    const itemsHtml  = section.items.map(item =>
      item.items ? navGroupHtml(item) : navItemHtml(item, 1)
    ).join('');
    return `
      <div class="nav-section-hdr${hdrOpenCls}" onclick="toggleSection('${section.id}')">
        <span class="nav-icon">${section.icon}</span>
        <span class="nav-label">${section.label}</span>
        <span class="nav-arrow">▾</span>
      </div>
      <div class="nav-section-body${openCls}" id="section-${section.id}">
        ${itemsHtml}
      </div>`;
  }

  // ── Construção do nav ─────────────────────────────────────────────────────────

  function buildNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const openSections = getSectionsOpen();

    // Auto-abre a seção que contém a página ativa
    MENU.forEach(section => {
      if (itemsContainActive(section.items)) openSections.add(section.id);
    });

    nav.innerHTML = MENU.map(s => sectionHtml(s, openSections.has(s.id))).join('');
  }

  // ── Toggle seção ──────────────────────────────────────────────────────────────

  function toggleSection(id) {
    const body = document.getElementById('section-' + id);
    const hdr  = body?.previousElementSibling;
    if (!body) return;
    const opening = !body.classList.contains('open');
    body.classList.toggle('open', opening);
    hdr?.classList.toggle('open', opening);
  }

  // ── Toggle submenu (2º nível) ─────────────────────────────────────────────────

  function toggleSubmenu(id) {
    const sm     = document.getElementById('sub-' + id);
    const parent = sm?.previousElementSibling;
    if (!sm) return;
    const opening = !sm.classList.contains('open');
    sm.classList.toggle('open', opening);
    parent?.classList.toggle('open', opening);
  }

  // ── Pin / retrair sidebar ─────────────────────────────────────────────────────

  function getSidebar() { return document.getElementById('sidebar'); }
  function getLayout()  { return document.querySelector('.layout'); }

  function applyPin(pinned) {
    const sb = getSidebar();
    if (!sb) return;
    sb.classList.toggle('pinned', pinned);
    getLayout()?.classList.toggle('sidebar-pinned', pinned);
    const btn = sb.querySelector('.sidebar-pin-btn');
    if (btn) {
      btn.textContent = pinned ? '◀' : '▶';
      btn.title       = pinned ? 'Recolher menu' : 'Fixar menu';
    }
  }

  function toggle() {
    const sb = getSidebar();
    if (!sb) return;
    const pinned = !sb.classList.contains('pinned');
    applyPin(pinned);
    localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    buildNav();

    const sb = getSidebar();
    if (sb && !sb.querySelector('.sidebar-pin-btn')) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-pin-btn';
      btn.onclick   = (e) => { e.stopPropagation(); toggle(); };
      sb.querySelector('.sidebar-logo')?.appendChild(btn);
    }

    applyPin(localStorage.getItem(PIN_KEY) === '1');
  }

  window.toggleSidebar = toggle;
  window.toggleSection = toggleSection;
  window.toggleSubmenu = toggleSubmenu;

  document.addEventListener('DOMContentLoaded', init);
})();

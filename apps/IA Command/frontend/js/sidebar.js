(function () {
  const PIN_KEY = 'iac_sidebar_pinned';

  const MENU = [
    {
      id: 'operacao', label: 'Monitor', icon: '⚡', defaultOpen: false,
      items: [
        { id: 'iac-dashboard',           label: 'Dashboard',            href: '/app/ia-command/dashboard.html',          icon: '⊞' },
        { id: 'iac-whatsapp-services',   label: 'WhatsApp Services',    href: '/app/ia-command/whatsapp-services.html',  icon: '📡' },
        { id: 'iac-monitor-whatsapp',    label: 'Monitor',              href: '/app/ia-command/monitor.html',            icon: '💬' },
        { id: 'iac-admin-auditoria',  label: 'Histórico',        href: '/app/ia-command/admin-interpretacoes-v2.html',  icon: '🧭' },
        { id: 'iac-admin-spec-feedback', label: 'Propostas de Correção', href: '/app/ia-command/admin-spec-feedback.html', icon: '🛠️' },
      ],
    },
    {
      id: 'whatsapp', label: 'WhatsApp', icon: '💬', defaultOpen: false,
      items: [
        { id: 'iac-admin-canais-whatsapp',        label: 'Canais',              href: '/app/ia-command/admin-canais-whatsapp.html',        icon: '📡' },
        { id: 'iac-admin-numeros-whatsapp',       label: 'Números Autorizados', href: '/app/ia-command/admin-numeros-whatsapp.html',       icon: '📱' },
        { id: 'iac-admin-grupos-whatsapp',        label: 'Grupos',              href: '/app/ia-command/admin-grupos-whatsapp.html',        icon: '👥' },
        { id: 'iac-admin-mensagens-whatsapp',     label: 'Mensagens',           href: '/app/ia-command/admin-mensagens-whatsapp.html',     icon: '✉️' },
        { id: 'iac-financeiro-whatsapp',          label: 'Relatório Financeiro', href: '/app/ia-command/admin-financeiro-whatsapp.html',   icon: '💰' },
      ],
    },
    {
      id: 'cadastros', label: 'Cadastros', icon: '📁', defaultOpen: false,
      items: [
        { id: 'iac-admin-modulos',   label: 'Módulos',      href: '/app/ia-command/admin-modulos.html',    icon: '📂' },
        { id: 'iac-admin-sinonimos', label: 'Equivalências', href: '/app/ia-command/admin-sinonimos.html',  icon: '🔤' },
      ],
    },
    {
      id: 'configuracao', label: 'Configuração', icon: '⚙', defaultOpen: false,
      items: [
        { id: 'iac-config-conexoes', label: 'Conexões ERP',      href: '/app/ia-command/config-conexoes.html',  icon: '🔌' },
        { id: 'iac-admin-datasets',  label: 'Datasets ERP',      href: '/app/ia-command/admin-datasets.html',   icon: '📊' },
        { id: 'iac-config-ia',       label: 'Configuração de IA', href: '/app/ia-command/config-ia.html',       icon: '🤖' },
        { id: 'iac-admin-intencoes', label: 'Intenções',          href: '/app/ia-command/admin-intencoes.html', icon: '🧠' },
        { id: 'iac-migrar-dados',    label: 'Migrar Dados',       href: '/app/ia-command/migrar-dados.html',    icon: '⇄' },
      ],
    },
    {
      id: 'integracao', label: 'Integração', icon: '🔗', defaultOpen: false,
      items: [
        {
          type: 'group', id: 'erp-protheus', label: 'ERP Protheus', icon: '🏭',
          items: [
            { id: 'iac-config-middleware',    label: 'Middleware SQL',   href: '/app/ia-command/config-middleware-protheus.html', icon: '🛡' },
            { id: 'iac-admin-logs-consultas', label: 'Log de Consultas', href: '/app/ia-command/admin-logs-consultas.html',        icon: '📋' },
            { id: 'iac-admin-protheus-sx2',   label: 'Dicionário SX2',  href: '/app/ia-command/admin-protheus-sx2.html',          icon: '📖' },
            { id: 'iac-admin-protheus-sx3',   label: 'Dicionário SX3',  href: '/app/ia-command/admin-protheus-sx3.html',          icon: '📑' },
            { id: 'iac-admin-protheus-sys-company',     label: 'Dicionário SYS_COMPANY',     href: '/app/ia-command/admin-protheus-sys-company.html',     icon: '🏢' },
            { id: 'iac-admin-protheus-sys-company-cfg', label: 'Dicionário SYS_COMPANY_CFG', href: '/app/ia-command/admin-protheus-sys-company-cfg.html', icon: '🧭' },
          ],
        },
        {
          type: 'group', id: 'agente-local', label: 'Agente Local', icon: '🤖',
          items: [
            { id: 'iac-agente-local-cargas', label: 'Cargas', href: '/app/ia-command/admin-agente-local-cargas.html', icon: '📤' },
          ],
        },
      ],
    },
    {
      id: 'agendamento', label: 'Agendamento', icon: '⏱', defaultOpen: false,
      items: [
        { id: 'iac-admin-agendamento', label: 'Perguntas Agendadas', href: '/app/ia-command/admin-agendamento.html', icon: '⏱' },
        { id: 'iac-admin-chat-favoritos', label: 'Chat Favoritos', href: '/app/ia-command/admin-chat-favoritos.html', icon: '★' },
      ],
    },
    {
      id: 'aprendizado-nlsql', label: 'Aprendizado NL-SQL', icon: '◈', defaultOpen: false,
      items: [
        { id: 'iac-admin-auditoria', label: 'Saude do Aprendizado', href: '/app/ia-command/admin-nlsql-saude.html?v=20260727-scroll', icon: '◎' },
        { id: 'iac-admin-execucoes', label: 'Auditoria de Consultas IA', href: '/app/ia-command/admin-execucoes.html', icon: '📋' },
        { id: 'iac-admin-auditoria', label: 'Auditoria do Shadow Mode', href: '/app/ia-command/admin-nlsql-shadow.html', icon: '◐' },
        { id: 'iac-admin-auditoria', label: 'Decisoes Automaticas', href: '/app/ia-command/admin-nlsql-politicas.html', icon: '◇' },
      ],
    },
    {
      id: 'administracao', label: 'Administração', icon: '🛠', defaultOpen: false,
      items: [
        { id: 'iac-admin-auditoria',          label: 'Interpretações',           href: '/app/ia-command/admin-interpretacoes-v2.html',     icon: '🧭' },
        { id: 'iac-admin-spec-feedback',      label: 'Propostas de Correção',    href: '/app/ia-command/admin-spec-feedback.html',       icon: '🛠️' },
        { id: 'iac-admin-auditoria',          label: 'Auditoria',                href: '/app/ia-command/admin-auditoria.html',           icon: '🔍' },
        { id: 'iac-admin-dialogos',           label: 'Diálogos Conversacionais', href: '/app/ia-command/admin-dialogos.html',            icon: '💬' },
        { id: 'iac-console-servidor',         label: 'Console do Servidor',      href: '/app/ia-command/console-servidor.html',          icon: '🖥' },
        { id: 'iac-admin-instalador-agente',  label: 'Gerar Inst Agente-local',  href: '/app/ia-command/admin-instalador-agente.html',   icon: '📦' },
      ],
    },
  ];

  const cadastros = MENU.find(s => s.id === 'cadastros');
  if (cadastros && !cadastros.items.some(i => i.id === 'iac-admin-normalizacao')) {
    cadastros.items.push({ id: 'iac-admin-normalizacao', label: 'Normalizacao', href: '/app/ia-command/admin-normalizacao.html', icon: '🧹' });
  }

  const administracao = MENU.find(s => s.id === 'administracao');
  if (administracao && !administracao.items.some(i => i.href === '/app/ia-command/admin-consumo-ia.html')) {
    administracao.items.splice(1, 0, {
      id: 'iac-admin-execucoes',
      label: 'Consumo IA',
      href: '/app/ia-command/admin-consumo-ia.html',
      icon: '$',
    });
  }
  if (administracao && !administracao.items.some(i => i.href === '/app/ia-command/admin-protheus-chat-encaminhamentos.html')) {
    administracao.items.splice(2, 0, {
      id: 'iac-admin-auditoria',
      label: 'Encaminhamentos',
      href: '/app/ia-command/admin-protheus-chat-encaminhamentos.html',
      icon: '->',
    });
  }

  const curPath = location.pathname;

  function isActive(href) {
    const hrefPath = href.split('?')[0];
    return curPath === hrefPath || curPath.endsWith(hrefPath);
  }

  function itemsContainActive(items) {
    return items.some(i =>
      (i.href && isActive(i.href)) ||
      (i.items && itemsContainActive(i.items))
    );
  }

  function filtrarMenu(rotinas) {
    if (rotinas === null) return MENU;
    return MENU.map(section => ({
      ...section,
      items: section.items
        .map(item => {
          if (item.type === 'group') {
            const filteredItems = item.items.filter(gi =>
              rotinas.includes(gi.id) || (gi.aliases || []).some(a => rotinas.includes(a))
            );
            return filteredItems.length ? { ...item, items: filteredItems } : null;
          }
          return (rotinas.includes(item.id) || (item.aliases || []).some(a => rotinas.includes(a))) ? item : null;
        })
        .filter(Boolean),
    })).filter(section => section.items.length > 0);
  }

  function navItemHtml(item) {
    if (item.type === 'group') return groupHtml(item);
    const active = item.href && isActive(item.href);
    const cls = ['nav-item', 'sub', active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${item.href}" class="${cls}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
  }

  function groupItemHtml(item) {
    const active = item.href && isActive(item.href);
    const cls = ['nav-item', 'sub2', active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${item.href}" class="${cls}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
  }

  function groupHtml(group) {
    const hasActive = itemsContainActive(group.items);
    const openCls = hasActive ? ' open' : '';
    const itemsHtml = group.items.map(gi => groupItemHtml(gi)).join('');
    return `
      <div class="nav-parent${openCls}" onclick="toggleGroup('${group.id}')">
        <span class="nav-icon">${group.icon}</span>
        <span class="nav-label">${group.label}</span>
        <span class="nav-arrow">▾</span>
      </div>
      <div class="submenu${openCls}" id="group-${group.id}">
        ${itemsHtml}
      </div>`;
  }

  function sectionHtml(section, isOpen) {
    const openCls    = isOpen ? ' open' : '';
    const hdrOpenCls = isOpen ? ' open' : '';
    const itemsHtml  = section.items.map(item => navItemHtml(item)).join('');
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

  function buildNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const rotinas      = window._iahubRotinas ?? null;
    const menuFiltrado = filtrarMenu(rotinas);

    if (rotinas !== null && menuFiltrado.length === 0) {
      nav.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text-lo);font-size:12px;line-height:1.6">
        <div style="font-size:28px;margin-bottom:8px">🔒</div>Sem acesso às rotinas.<br>Contate o administrador.</div>`;
      return;
    }

    const openSections = new Set(MENU.filter(s => s.defaultOpen).map(s => s.id));
    menuFiltrado.forEach(section => {
      if (itemsContainActive(section.items)) openSections.add(section.id);
    });

    nav.innerHTML = menuFiltrado.map(s => sectionHtml(s, openSections.has(s.id))).join('');
  }

  function toggleSection(id) {
    const body = document.getElementById('section-' + id);
    const hdr  = body?.previousElementSibling;
    if (!body) return;
    const opening = !body.classList.contains('open');
    body.classList.toggle('open', opening);
    hdr?.classList.toggle('open', opening);
  }

  function toggleGroup(id) {
    const body = document.getElementById('group-' + id);
    const hdr  = body?.previousElementSibling;
    if (!body) return;
    const opening = !body.classList.contains('open');
    body.classList.toggle('open', opening);
    hdr?.classList.toggle('open', opening);
  }

  function getSidebar() { return document.getElementById('sidebar'); }
  function getLayout()  { return document.querySelector('.layout'); }
  function getOverlay() { return document.getElementById('sidebar-overlay'); }
  function isDrawerMode() {
    return window.matchMedia?.('(max-width: 900px)').matches;
  }

  function setDrawer(open) {
    const sb = getSidebar();
    if (!sb) return;
    sb.classList.toggle('drawer-open', open);
    getOverlay()?.classList.toggle('open', open);
    document.body?.classList.toggle('sidebar-drawer-open', open);
  }

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
    if (isDrawerMode()) {
      setDrawer(!sb.classList.contains('drawer-open'));
      return;
    }
    const pinned = !sb.classList.contains('pinned');
    applyPin(pinned);
    localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
  }

  function closeDrawer() {
    setDrawer(false);
  }

  async function sair() {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (_) {}
    location.href = '/';
  }

  function buildFooter() {
    const sb = getSidebar();
    if (!sb || sb.querySelector('.sidebar-footer')) return;
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.innerHTML = `
      <button class="nav-item sub sidebar-logout-btn" onclick="window._sidebarSair()" title="Sair do sistema">
        <span class="nav-icon">↩</span>
        <span class="nav-label">Sair</span>
      </button>`;
    sb.appendChild(footer);
  }

  function init() {
    buildNav();
    buildFooter();
    const sb = getSidebar();
    if (sb && !sb.querySelector('.sidebar-pin-btn')) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-pin-btn';
      btn.onclick   = (e) => { e.stopPropagation(); toggle(); };
      sb.querySelector('.sidebar-logo')?.appendChild(btn);
    }
    localStorage.removeItem(PIN_KEY);
    applyPin(false);
    window.addEventListener('resize', () => {
      if (!isDrawerMode()) setDrawer(false);
    });
  }

  window._sidebarSair = sair;

  window.toggleSidebar = toggle;
  window.closeSidebarDrawer = closeDrawer;
  window.toggleSection = toggleSection;
  window.toggleGroup   = toggleGroup;
  window.MENU = MENU;

  document.addEventListener('DOMContentLoaded', async () => {
    await (window._iahubRotinasReady || Promise.resolve(null));
    init();
  });
})();

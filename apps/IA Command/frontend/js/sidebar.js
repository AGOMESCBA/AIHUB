(function () {
  const PIN_KEY = 'iac_sidebar_pinned';

  const MENU = [
    {
      id: 'operacao', label: 'Monitor', icon: '⚡', defaultOpen: true,
      items: [
        { id: 'iac-dashboard',        label: 'Dashboard',        href: '/app/ia-command/dashboard.html',      icon: '⊞' },
        { id: 'iac-monitor-whatsapp', label: 'Monitor',          href: '/app/ia-command/monitor.html',        icon: '💬' },
      ],
    },
    {
      id: 'whatsapp', label: 'WhatsApp', icon: '💬', defaultOpen: true,
      items: [
        { id: 'iac-admin-canais-whatsapp', label: 'Canais', href: '/app/ia-command/admin-canais-whatsapp.html', icon: '📡' },
        { id: 'iac-admin-numeros-whatsapp', label: 'Números Autorizados', href: '/app/ia-command/admin-numeros-whatsapp.html', icon: '📱' },
        { id: 'iac-admin-mensagens-whatsapp', label: 'Mensagens', href: '/app/ia-command/admin-mensagens-whatsapp.html', icon: '✉️' },
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
        { id: 'iac-config-conexoes', label: 'Conexões ERP',  href: '/app/ia-command/config-conexoes.html', icon: '🔌' },
        { id: 'iac-admin-datasets',  label: 'Datasets ERP', href: '/app/ia-command/admin-datasets.html',   icon: '📊' },
        { id: 'iac-config-ia',       label: 'Configuração de IA', href: '/app/ia-command/config-ia.html',       icon: '🤖' },
        { id: 'iac-admin-intencoes', label: 'Intenções',    href: '/app/ia-command/admin-intencoes.html',  icon: '🧠' },
        { id: 'iac-migrar-dados',    label: 'Migrar Dados', href: '/app/ia-command/migrar-dados.html',     icon: '⇄' },
      ],
    },
    {
      id: 'administracao', label: 'Administração', icon: '🛠', defaultOpen: false,
      items: [
        { id: 'iac-admin-execucoes', label: 'Log Execuções', href: '/app/ia-command/admin-execucoes.html', icon: '📋' },
        { id: 'iac-admin-auditoria', label: 'Interpretações', href: '/app/ia-command/admin-interpretacoes.html', icon: '🧭' },
        { id: 'iac-admin-auditoria', label: 'Auditoria',     href: '/app/ia-command/admin-auditoria.html', icon: '🔍' },
        { id: 'iac-admin-dialogos',  label: 'Diálogos Conversacionais', href: '/app/ia-command/admin-dialogos.html', icon: '💬' },
      ],
    },
  ];

  const cadastros = MENU.find(s => s.id === 'cadastros');
  if (cadastros && !cadastros.items.some(i => i.id === 'iac-admin-normalizacao')) {
    cadastros.items.push({ id: 'iac-admin-normalizacao', label: 'Normalizacao', href: '/app/ia-command/admin-normalizacao.html', icon: '🧹' });
  }

  const curPath = location.pathname;

  function isActive(href) {
    return curPath === href || curPath.endsWith(href);
  }

  function itemsContainActive(items) {
    return items.some(i => (i.href && isActive(i.href)) || (i.items && itemsContainActive(i.items)));
  }

  function filtrarMenu(rotinas) {
    if (rotinas === null) return MENU;
    return MENU.map(section => ({
      ...section,
      items: section.items.filter(item =>
        rotinas.includes(item.id) || (item.aliases || []).some(alias => rotinas.includes(alias))
      ),
    })).filter(section => section.items.length > 0);
  }

  function navItemHtml(item) {
    const active = item.href && isActive(item.href);
    const cls = ['nav-item', 'sub', active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${item.href}" class="${cls}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
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
  window.MENU = MENU;

  document.addEventListener('DOMContentLoaded', async () => {
    await (window._iahubRotinasReady || Promise.resolve(null));
    init();
  });
})();

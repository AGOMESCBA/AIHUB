(function () {
  const PIN_KEY = 'iasvc_sidebar_pinned';

  // Mesma normalização de apps/IA Service/backend/routes/login-externo-routes.js
  // (_slugify) — precisa ser IDÊNTICA nos dois lados: o backend resolve o
  // slug de volta para a empresa via /entrar-servico/:empresaSlug.
  function _slugify(nome) {
    return String(nome || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Radar SEMPRE abre pela tela de login externo por WhatsApp (2026-09,
  // decisão explícita do usuário) — mesmo para quem já está logado no
  // IAHub. Motivo: o cookie de sessão do Hub não é confiavelmente enviado
  // ao abrir uma nova aba via target="_blank" em todos os navegadores
  // testados (bug nunca resolvido trocando sameSite strict->lax), então a
  // nova aba caía em /login.html sem sessão. O login externo (token próprio
  // do IA Service, já validado ponta a ponta) não depende de cookie
  // cruzando abas — sempre funciona, ao custo de pedir o código do
  // WhatsApp mais uma vez ao abrir o Radar numa aba nova.
  function radarHref() {
    const nomeEmpresa = window._iahubEmpresa?.nome || window._iahubEmpresa?.razao_social;
    if (!nomeEmpresa) return '/app/ia-service/chat'; // fallback: empresa ainda não carregada
    return `/entrar-servico/${_slugify(nomeEmpresa)}`;
  }

  const MENU = [
    {
      id: 'operacao', label: 'Operação', icon: '⚡', defaultOpen: true,
      items: [
        // href resolvido em navItemHtml() (chamado de dentro de buildNav,
        // já depois de window._iahubEmpresa estar populado) — calcular aqui
        // no topo do módulo sempre cairia no fallback, pois auth.js ainda
        // não terminou o fetch assíncrono da empresa neste ponto.
        { id: 'svc-radar',        label: 'Radar de Chamados', hrefDinamico: radarHref,                    icon: '📡', novaGuia: true },
        { id: 'svc-atendimentos', label: 'Atendimentos',      href: '/app/ia-service/atendimentos.html', icon: '💬' },
      ],
    },
    {
      id: 'base-conhecimento', label: 'Base de Conhecimento', icon: '🧠', defaultOpen: false,
      items: [
        { id: 'svc-base-historica', label: 'Base Histórica', href: '/app/ia-service/base-historica.html', icon: '🗂' },
      ],
    },
    {
      id: 'configuracao', label: 'Configuração', icon: '⚙', defaultOpen: false,
      items: [
        { id: 'svc-consultores', label: 'Consultores', href: '/app/ia-service/consultores.html', icon: '👤' },
      ],
    },
  ];

  const curPath = location.pathname;

  function isActive(href) {
    const hrefPath = href.split('?')[0];
    return curPath === hrefPath || curPath.endsWith(hrefPath);
  }

  function itemsContainActive(items) {
    return items.some(i => {
      const href = i.hrefDinamico ? i.hrefDinamico() : i.href;
      return href && !i.novaGuia && isActive(href);
    });
  }

  function filtrarMenu(rotinas) {
    if (rotinas === null) return MENU;
    return MENU.map(section => ({
      ...section,
      items: section.items.filter(item => rotinas.includes(item.id)),
    })).filter(section => section.items.length > 0);
  }

  function navItemHtml(item) {
    // Radar abre em nova guia SEMPRE pela tela de login externo (ver
    // radarHref acima) — não é mais "página do sistema", nunca fica
    // "ativo" no menu (não há como saber se a aba externa está de fato no
    // Radar). Os outros itens continuam navegando na mesma aba.
    const href = item.hrefDinamico ? item.hrefDinamico() : item.href;
    const active = href && isActive(href) && !item.novaGuia;
    const cls = ['nav-item', 'sub', active ? 'active' : ''].filter(Boolean).join(' ');
    const targetAttr = item.novaGuia ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${href}" class="${cls}"${targetAttr}>
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
  }

  function sectionHtml(section, isOpen) {
    const openCls    = isOpen ? ' open' : '';
    const itemsHtml  = section.items.map(item => navItemHtml(item)).join('');
    return `
      <div class="nav-section-hdr${openCls}" onclick="toggleSection('${section.id}')">
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
    const salvo = localStorage.getItem(PIN_KEY);
    applyPin(salvo === '1');
    window.addEventListener('resize', () => {
      if (!isDrawerMode()) setDrawer(false);
    });
  }

  window._sidebarSair = sair;

  window.toggleSidebar = toggle;
  window.closeSidebarDrawer = closeDrawer;
  window.toggleSection = toggleSection;
  window.MENU = MENU;

  document.addEventListener('DOMContentLoaded', async () => {
    await (window._iahubRotinasReady || Promise.resolve(null));
    init();
  });
})();

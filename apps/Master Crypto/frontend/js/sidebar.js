(function () {
  const PIN_KEY = 'mc_sidebar_pinned';

  const MENU = [
    {
      id: 'operacao', label: 'Operacao', icon: 'satellite', defaultOpen: true,
      items: [
        { id: 'mc-radar', label: 'Radar de Oportunidades 24x7', href: '/app/master-crypto/radar.html', icon: 'radar' },
        { id: 'mc-ativos', label: 'Ativos', href: '/app/master-crypto/ativos.html', icon: 'coins' },
      ],
    },
    {
      id: 'analise-trade', label: 'Analise de Trade', icon: 'chart-line', defaultOpen: true,
      items: [
        { id: 'mc-plano-trade', label: 'Plano de Trade & Binance Pro', href: '/app/master-crypto/plano-trade.html', icon: 'candles' },
        { id: 'mc-analista-ia', label: 'Analista IA Assistente', href: '/app/master-crypto/analista-ia.html', icon: 'bot' },
      ],
    },
    {
      id: 'estrategias-mercado', label: 'Estrategias e Mercado', icon: 'layers', defaultOpen: false,
      items: [
        { id: 'mc-ciclo-btc', label: 'Ciclos do Bitcoin & Halving', href: '/app/master-crypto/ciclo-btc.html', icon: 'bitcoin-cycle' },
        { id: 'mc-backtest', label: 'Backtest & Performance', href: '/app/master-crypto/backtest.html', icon: 'flask' },
        { id: 'mc-noticias', label: 'Noticias & Sentimento Macro', href: '/app/master-crypto/noticias.html', icon: 'newspaper' },
      ],
    },
    {
      id: 'simulacao', label: 'Simulacao', icon: 'wallet', defaultOpen: false,
      items: [
        { id: 'mc-paper-trading', label: 'Paper Trading (Banca Virtual)', href: '/app/master-crypto/paper-trading.html', icon: 'wallet-cards' },
        { id: 'mc-historico-trades', label: 'Historico de Trades', href: '/app/master-crypto/historico-trades.html', icon: 'history' },
      ],
    },
    {
      id: 'configuracao', label: 'Configuracao', icon: 'settings', defaultOpen: false,
      items: [
        { id: 'mc-configuracoes', label: 'Parametros & Risco', href: '/app/master-crypto/configuracoes.html', icon: 'sliders' },
      ],
    },
  ];

  const ICONS = {
    satellite: '<path d="M13 7 9 3 7 5l4 4"/><path d="m17 11 4 4-2 2-4-4"/><path d="M8 12a7 7 0 0 0-5 5"/><path d="M11 15a3 3 0 0 0-3 3"/><path d="m8 8 8 8"/><path d="m16 4 4 4-8 8-4-4Z"/>',
    radar: '<path d="M12 12 19 5"/><path d="M20 12a8 8 0 1 1-8-8"/><path d="M16 12a4 4 0 1 1-4-4"/><circle cx="12" cy="12" r="1"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3"/>',
    coins: '<circle cx="8" cy="8" r="5"/><path d="M8 13v4a5 5 0 0 0 10 0v-4"/><path d="M13 8h3a5 5 0 0 1 0 10h-3"/><path d="M3 8h10"/><path d="M3 11h10"/><path d="M13 13h8"/><path d="M13 16h8"/>',
    'chart-line': '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/><path d="M18 7h1v1"/>',
    candles: '<path d="M7 3v4M7 17v4M5 7h4v10H5Z"/><path d="M17 3v7M17 18v3M15 10h4v8h-4Z"/>',
    bot: '<path d="M12 8V4"/><rect x="5" y="8" width="14" height="10" rx="3"/><path d="M9 18v2M15 18v2"/><path d="M9 13h.01M15 13h.01"/><path d="M4 13H2M22 13h-2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
    'bitcoin-cycle': '<circle cx="12" cy="12" r="9"/><path d="M9 7h4.5a2 2 0 0 1 0 4H9"/><path d="M9 11h5a2 2 0 0 1 0 4H9"/><path d="M10 7v8M12 7v8"/><path d="M7 12a5 5 0 0 0 10 0"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M7 16h10"/>',
    newspaper: '<path d="M4 5h13a3 3 0 0 1 3 3v11H6a2 2 0 0 1-2-2Z"/><path d="M8 8h6M8 12h8M8 16h5"/><path d="M17 8v11"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v14H6a2 2 0 0 1-2-2Z"/><path d="M18 10h3v6h-3a3 3 0 0 1 0-6Z"/><path d="M18 13h.01"/>',
    'wallet-cards': '<path d="M4 7a2 2 0 0 1 2-2h12v14H6a2 2 0 0 1-2-2Z"/><path d="M8 9h6M8 13h4"/><path d="M17 12h3v4h-3a2 2 0 0 1 0-4Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    sliders: '<path d="M4 6h10M18 6h2"/><path d="M4 12h2M10 12h10"/><path d="M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
  };

  function iconHtml(name) {
    const body = ICONS[name] || ICONS.radar;
    return `<svg class="mc-menu-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  const curPath = location.pathname;

  function isActive(href) {
    const hrefPath = href.split('?')[0];
    return curPath === hrefPath || curPath.endsWith(hrefPath);
  }

  function itemsContainActive(items) {
    return items.some(item => item.href && isActive(item.href));
  }

  function filtrarMenu(rotinas) {
    if (rotinas === null || rotinas === undefined) return MENU;
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
    return `<a href="${item.href}" class="${cls}" data-id="${item.id}">
      <span class="nav-icon">${iconHtml(item.icon)}</span>
      <span class="nav-label">${item.label}</span>
    </a>`;
  }

  function sectionHtml(section, isOpen) {
    const openCls = isOpen ? ' open' : '';
    return `
      <div class="nav-section-hdr${openCls}" onclick="toggleSection('${section.id}')">
        <span class="nav-icon">${iconHtml(section.icon)}</span>
        <span class="nav-label">${section.label}</span>
        <span class="nav-arrow">&#9662;</span>
      </div>
      <div class="nav-section-body${openCls}" id="section-${section.id}">
        ${section.items.map(navItemHtml).join('')}
      </div>`;
  }

  function buildNav() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const rotinas = window._iahubRotinas ?? null;
    const menuFiltrado = filtrarMenu(rotinas);

    if (rotinas !== null && menuFiltrado.length === 0) {
      nav.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text-lo);font-size:12px;line-height:1.6">
        <div style="font-size:28px;margin-bottom:8px">!</div>Sem acesso as rotinas.<br>Contate o administrador.</div>`;
      return;
    }

    const openSections = new Set(MENU.filter(section => section.defaultOpen).map(section => section.id));
    menuFiltrado.forEach(section => {
      if (itemsContainActive(section.items)) openSections.add(section.id);
    });
    nav.innerHTML = menuFiltrado.map(section => sectionHtml(section, openSections.has(section.id))).join('');
  }

  function toggleSection(id) {
    const body = document.getElementById('section-' + id);
    const hdr = body?.previousElementSibling;
    if (!body) return;
    const opening = !body.classList.contains('open');
    body.classList.toggle('open', opening);
    hdr?.classList.toggle('open', opening);
  }

  function getSidebar() { return document.getElementById('sidebar'); }
  function getLayout() { return document.querySelector('.layout'); }
  function getOverlay() { return document.getElementById('sidebar-overlay'); }
  function isDrawerMode() { return window.matchMedia?.('(max-width: 900px)').matches; }

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
      btn.textContent = pinned ? '<' : '>';
      btn.title = pinned ? 'Recolher menu' : 'Fixar menu';
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

  function ensurePinButton() {
    const sb = getSidebar();
    if (!sb || sb.querySelector('.sidebar-pin-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'sidebar-pin-btn';
    btn.onclick = (e) => { e.stopPropagation(); toggle(); };
    sb.querySelector('.sidebar-logo')?.appendChild(btn);
  }

  function init() {
    buildNav();
    ensurePinButton();
    applyPin(localStorage.getItem(PIN_KEY) === '1');
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

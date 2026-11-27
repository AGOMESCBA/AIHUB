// IA Talk — menu lateral (mesmo formato e classes do sidebar.js do IA Service).
// Itens filtrados pelas rotinas da sessão (GET /api/admin/sessao → rotinas).
// Tela ainda não construída: `etapa` preenchida → abre em-breve.html. Quem
// entregar a tela troca `etapa: null` e confirma o `href`.
(function () {
  const PIN_KEY = 'talk_sidebar_fixa';
  const B = '/app/ia-talk';

  const MENU = [
    {
      id: 'operacao', label: 'Operação', icon: '📡', defaultOpen: true,
      items: [
        { id: 'talk-painel', label: 'Painel', href: `${B}/painel.html`, icon: '📊', etapa: null },
        { id: 'talk-atendimento', label: 'Atendimento', href: `${B}/atendimento.html`, icon: '🎧', etapa: null },
        { id: 'talk-canais', label: 'Canais', href: `${B}/canais.html`, icon: '📱', etapa: null },
        { id: 'talk-mensagens', label: 'Histórico de mensagens', href: `${B}/mensagens.html`, icon: '💬', etapa: null },
        { id: 'talk-eventos', label: 'Eventos e webhooks', href: `${B}/eventos.html`, icon: '🔔', etapa: 'G3' },
      ],
    },
    {
      id: 'integracoes', label: 'Integrações', icon: '🔌', defaultOpen: false,
      items: [
        { id: 'talk-aplicacoes', label: 'Aplicações e tokens', href: `${B}/aplicacoes.html`, icon: '🔑', etapa: null },
      ],
    },
    {
      id: 'administracao', label: 'Administração', icon: '⚙', defaultOpen: false,
      items: [
        { id: 'talk-setores', label: 'Setores e respostas', href: `${B}/setores.html`, icon: '🗂', etapa: null },
        { id: 'talk-usuarios', label: 'Usuários e papéis', href: `${B}/usuarios.html`, icon: '👥', etapa: null },
        { id: 'talk-configuracoes', label: 'Configurações', href: `${B}/configuracoes.html`, icon: '🛠', etapa: null },
        { id: 'talk-auditoria', label: 'Auditoria', href: `${B}/auditoria.html`, icon: '🧾', etapa: null },
        // Só administração da plataforma. Tela modelo da C0 (pronta).
        { id: 'talk-empresas', label: 'Empresas', href: `${B}/empresas.html`, icon: '🏢', etapa: null, somenteAdmin: true },
      ],
    },
  ];

  function hrefDo(item) {
    return item.etapa ? `${B}/em-breve.html?tela=${encodeURIComponent(item.label)}&etapa=${item.etapa}` : item.href;
  }

  function filtrarMenu(rotinas) {
    return MENU.map(s => ({ ...s, items: s.items.filter(i => rotinas.includes(i.id)) })).filter(s => s.items.length);
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function navItemHtml(item) {
    return `<a href="${esc(hrefDo(item))}" class="nav-item sub" data-rotina="${esc(item.id)}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="nav-label">${esc(item.label)}</span>
    </a>`;
  }

  function sectionHtml(section, aberta) {
    const cls = aberta ? ' open' : '';
    return `
      <div class="nav-section-hdr${cls}" role="button" tabindex="0" aria-expanded="${aberta}" data-secao="${section.id}">
        <span class="nav-icon" aria-hidden="true">${section.icon}</span>
        <span class="nav-label">${esc(section.label)}</span>
        <span class="nav-arrow" aria-hidden="true">▾</span>
      </div>
      <div class="nav-section-body${cls}" id="section-${section.id}">${section.items.map(navItemHtml).join('')}</div>`;
  }

  function construir(rotinas) {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const menu = filtrarMenu(rotinas || []);
    if (!menu.length) {
      nav.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text-lo);font-size:12px;line-height:1.6">
        <div style="font-size:28px;margin-bottom:8px" aria-hidden="true">🔒</div>Sem acesso às rotinas.<br>Fale com o administrador da empresa.</div>`;
      return;
    }
    nav.innerHTML = menu.map(s => sectionHtml(s, s.defaultOpen)).join('');
    nav.querySelectorAll('.nav-section-hdr').forEach(h => {
      const alternar = () => {
        const corpo = document.getElementById(`section-${h.dataset.secao}`);
        const abrir = !corpo.classList.contains('open');
        corpo.classList.toggle('open', abrir);
        h.classList.toggle('open', abrir);
        h.setAttribute('aria-expanded', String(abrir));
      };
      h.addEventListener('click', alternar);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    });
  }

  const sidebar = () => document.getElementById('sidebar');
  const modoGaveta = () => window.matchMedia('(max-width: 900px)').matches;

  function gaveta(abrir) {
    sidebar()?.classList.toggle('drawer-open', abrir);
    document.getElementById('sidebar-overlay')?.classList.toggle('open', abrir);
    document.body.classList.toggle('sidebar-drawer-open', abrir);
  }

  function fixar(fixa) {
    const sb = sidebar();
    if (!sb) return;
    sb.classList.toggle('pinned', fixa);
    document.querySelector('.layout')?.classList.toggle('sidebar-pinned', fixa);
    const btn = sb.querySelector('.sidebar-pin-btn');
    if (btn) { btn.textContent = fixa ? '◀' : '▶'; btn.title = fixa ? 'Recolher menu' : 'Fixar menu'; }
  }

  function alternar() {
    const sb = sidebar();
    if (!sb) return;
    if (modoGaveta()) return gaveta(!sb.classList.contains('drawer-open'));
    const fixa = !sb.classList.contains('pinned');
    fixar(fixa);
    try { localStorage.setItem(PIN_KEY, fixa ? '1' : '0'); } catch (_) { /* sem localStorage */ }
  }

  function iniciar(rotinas) {
    construir(rotinas);
    const sb = sidebar();
    if (sb && !sb.querySelector('.sidebar-pin-btn')) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-pin-btn';
      btn.type = 'button';
      btn.onclick = (e) => { e.stopPropagation(); alternar(); };
      sb.querySelector('.sidebar-logo')?.appendChild(btn);
    }
    let fixa = false;
    try { fixa = localStorage.getItem(PIN_KEY) === '1'; } catch (_) { /* sem localStorage */ }
    fixar(fixa);
    window.addEventListener('resize', () => { if (!modoGaveta()) gaveta(false); });
  }

  window.TalkMenu = { MENU, iniciar, hrefDo };
  window.toggleSidebar = alternar;
  window.closeSidebarDrawer = () => gaveta(false);
})();

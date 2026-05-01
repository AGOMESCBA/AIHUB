// Sinal de pronto: resolve quando window._iahubEmpresa estiver disponível
let _authReadyResolve;
window._iahubAuthReady = new Promise(r => { _authReadyResolve = r; });

// Páginas que não exigem empresa selecionada
const _PAGINAS_LIVRES = [
  '/login.html', '/selecionar-empresa.html',
  '/empresas.html', '/usuarios.html', '/seguranca.html', '/configuracoes.html',
  '/administracao.html',
];

function _paginaLivre() {
  return _PAGINAS_LIVRES.some(p => location.pathname === p || location.pathname.endsWith(p));
}

(async function () {
  // 1. Verificar autenticação e obter dados do usuário
  const meRes = await fetch('/api/me').catch(() => null);
  if (!meRes?.ok) {
    if (!location.pathname.endsWith('/login.html')) location.href = '/login.html';
    return;
  }
  const me = await meRes.json().catch(() => ({}));

  // 2. Atualiza sidebar em todas as páginas (evita "A" hardcoded ficar visível)
  _atualizarSidebarUsuario(me);

  // Expõe dados do usuário globalmente em todas as páginas
  window._iahubUser = { user: me.user, role: me.role };

  // 3. Verificar empresa nas páginas que exigem
  if (!_paginaLivre()) {
    const sessao = await fetch('/api/session/empresa').then(r => r.json()).catch(() => ({}));
    // Admin sem empresa selecionada pode acessar o sistema para cadastrar empresas
    if (!sessao.empresa_id && me.role !== 'admin') {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    window._iahubEmpresa = sessao.empresa_id
      ? { id: sessao.empresa_id, nome: sessao.empresa_nome || '' }
      : { id: '—', nome: '(nenhuma)' };
  }

  _authReadyResolve?.();

  // 4. Injetar combo de empresa no topbar
  _injetarEmpresaTopbar();
})();

// ── Sidebar: injeta info real do usuário abaixo do logo ───────────────────────
function _atualizarSidebarUsuario(me) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const logo = sidebar.querySelector('.sidebar-logo');
  const nav  = sidebar.querySelector('.sidebar-nav');

  // Determina inicial e label de role
  const inicial = (me.user || '?')[0].toUpperCase();
  const roleLabel = me.role === 'admin' ? 'Administrador' : 'Usuário';

  // Injeta bloco de usuário entre logo e nav (evita duplicação)
  if (logo && nav && !sidebar.querySelector('.sidebar-userinfo')) {
    const div = document.createElement('div');
    div.className = 'sidebar-userinfo';
    div.innerHTML = `
      <div class="user-avatar">${inicial}</div>
      <div class="user-info-text">
        <div class="user-name">${me.user || '—'}</div>
        <div class="user-role">${roleLabel}</div>
      </div>`;
    nav.parentNode.insertBefore(div, nav);
  }

  // Substitui o footer por botão de logout maior e centralizado
  const footer = sidebar.querySelector('.sidebar-footer');
  if (footer) {
    footer.innerHTML = `
      <button class="btn-logout" onclick="logout()" title="Sair do sistema">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        <span class="btn-logout-text">Sair</span>
      </button>`;
  }
}

// ── Combo de empresa no cabeçalho ─────────────────────────────────────────────
async function _injetarEmpresaTopbar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('_empresa-badge')) return;

  const [sessao, empresas] = await Promise.all([
    fetch('/api/session/empresa').then(r => r.json()).catch(() => ({})),
    fetch('/api/empresas/minhas').then(r => r.json()).catch(() => []),
  ]);

  // Se não há empresas disponíveis, não exibe o badge
  if (!empresas.length) return;

  // Remove o elemento de data (evita conflito de layout)
  topbar.querySelector('#topbar-date')?.remove();

  const nomeAtual  = sessao.empresa_nome || '— Selecione a Empresa —';
  const semEmpresa = !sessao.empresa_id;

  const badge = document.createElement('div');
  badge.id = '_empresa-badge';
  badge.style.cssText = 'margin-left:auto;position:relative;';
  badge.innerHTML = `
    <button id="_empresa-btn" style="
      display:flex;align-items:center;gap:7px;
      background:${semEmpresa ? 'var(--accent)' : 'var(--bg-hover)'};
      border:1px solid ${semEmpresa ? 'var(--accent)' : 'var(--border)'};
      border-radius:7px;padding:5px 12px;cursor:pointer;
      font-size:13px;font-weight:600;
      color:${semEmpresa ? '#fff' : 'var(--text-hi)'};
      transition:border-color .15s,background .15s;
    ">
      <span style="font-size:15px">🏢</span>
      <span id="_empresa-nome">${nomeAtual}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.7">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <div id="_empresa-dropdown" style="
      display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:9999;
      background:var(--bg-card);border:1px solid var(--border);border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,.35);min-width:220px;padding:6px;
    "></div>`;

  topbar.appendChild(badge);

  const btn      = document.getElementById('_empresa-btn');
  const dropdown = document.getElementById('_empresa-dropdown');
  let   aberto   = false;
  let   eidAtual = sessao.empresa_id;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    aberto = !aberto;

    if (aberto) {
      btn.style.borderColor = 'var(--accent)';
      dropdown.style.display = 'block';

      const lista = await fetch('/api/empresas/minhas').then(r => r.json()).catch(() => []);
      lista.sort((a, b) => (a.razao_social || a.nome || '').localeCompare(b.razao_social || b.nome || '', 'pt-BR'));

      dropdown.innerHTML = lista.map(e => `
        <button onclick="window._trocarEmpresa(${e.id})" style="
          display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;
          background:${e.id === eidAtual ? 'var(--bg-hover)' : 'none'};
          border:none;border-radius:7px;cursor:pointer;text-align:left;
          color:var(--text-hi);font-size:13px;transition:background .12s;
        " onmouseover="this.style.background='var(--bg-hover)'"
           onmouseout="this.style.background='${e.id === eidAtual ? 'var(--bg-hover)' : 'none'}'">
          <span style="font-size:15px">🏢</span>
          <span style="flex:1;font-weight:${e.id === eidAtual ? '700' : '500'}">
            ${e.razao_social || e.nome || 'Empresa'}
          </span>
          ${e.id === eidAtual ? '<span style="font-size:10px;color:var(--accent)">✓ ativa</span>' : ''}
        </button>`).join('') ||
        '<div style="padding:10px 8px;font-size:12px;color:var(--text-lo)">Nenhuma empresa disponível.</div>';
    } else {
      fecharDropdown();
    }
  });

  function fecharDropdown() {
    aberto = false;
    dropdown.style.display = 'none';
    btn.style.borderColor = '';
  }

  document.addEventListener('click', fecharDropdown);
}

window._trocarEmpresa = async function (empresa_id) {
  const res = await fetch('/api/empresas/selecionar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id }),
  });
  if (res.ok) location.reload();
};

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  fetch('/api/logout', { method: 'POST' }).finally(() => {
    location.href = '/login.html';
  });
}

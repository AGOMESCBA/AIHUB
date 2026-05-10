// Sinal de pronto: resolve quando window._iahubEmpresa estiver disponível
let _authReadyResolve;
window._iahubAuthReady = new Promise(r => { _authReadyResolve = r; });

// Sinal de rotinas: resolve quando window._iahubRotinas estiver disponível
// null = admin (sem filtro) | [] = sem acesso | [...ids] = rotinas permitidas
let _rotinasResolve;
window._iahubRotinasReady = new Promise(r => { _rotinasResolve = r; });

// Páginas que não exigem empresa selecionada
const _PAGINAS_LIVRES = [
  '/login.html', '/selecionar-empresa.html',
  '/empresas.html', '/usuarios.html', '/seguranca.html',
  '/administracao.html',
];

// Mapa página → id da rotina (deve espelhar os ids do sidebar.js)
const _PAGINA_ROTINA = {
  '/dashboard.html':        'dashboard',
  '/monitor.html':          'monitor-whatsapp',
  '/monitor-email.html':    'monitor-email',
  '/curriculos.html':       'curriculos',
  '/funcoes.html':          'funcoes',
  '/vagas.html':            'vagas',
  '/processoseletivo.html': 'processo-seletivo',
  '/analisador.html':       'analisador',
  '/historico.html':        'historico',
  '/config-analisador.html':'config-analisador',
  '/se-integracoes.html':   'se-integracoes',
  '/se-curriculos.html':    'se-curriculos',
  '/se-funcoes.html':       'se-funcoes',
  '/se-vagas.html':         'se-vagas',
  '/se-integracoes-config.html': 'se-integracoes-config',
  '/se-api-configurador.html':  'se-api-configurador',
  '/configuracoes.html':    'configuracoes',
  '/administracao.html':    'administracao',
};

const _ROTINA_ALIASES = {
  'se-integracoes': ['se-curriculos', 'se-funcoes', 'se-vagas', 'se-integracoes-config'],
  'se-curriculos':  ['se-integracoes'],
  'se-funcoes':     ['se-integracoes'],
  'se-vagas':       ['se-integracoes'],
  'se-integracoes-config': ['se-integracoes'],
};

function _paginaLivre() {
  return _PAGINAS_LIVRES.some(p => location.pathname === p || location.pathname.endsWith(p));
}

function _rotinaIdDaPagina() {
  return Object.entries(_PAGINA_ROTINA).find(
    ([p]) => location.pathname === p || location.pathname.endsWith(p)
  )?.[1] ?? null;
}

function _verificarAcessoPagina() {
  const rotinas  = window._iahubRotinas;
  if (rotinas === null) return true;  // admin: acesso irrestrito

  const rotinaId = _rotinaIdDaPagina();
  if (!rotinaId) return true;         // página sem rotina mapeada: livre

  if (rotinas.includes(rotinaId)) return true;
  if ((_ROTINA_ALIASES[rotinaId] || []).some(alias => rotinas.includes(alias))) return true;

  // Página atual não permitida. Se há outras rotinas, redireciona silenciosamente.
  if (rotinas.length > 0) {
    const rotinaHref = Object.fromEntries(
      Object.entries(_PAGINA_ROTINA).map(([href, rid]) => [rid, href])
    );
    rotinaHref['se-curriculos'] = '/se-integracoes.html#curriculos';
    rotinaHref['se-funcoes']    = '/se-integracoes.html#funcoes';
    rotinaHref['se-vagas']      = '/se-integracoes.html#vagas';
    rotinaHref['se-integracoes-config'] = '/se-integracoes.html#flowapi';
    const destino = rotinaHref[rotinas[0]];
    if (destino) { location.href = destino; return false; }
  }

  // Sem nenhuma rotina disponível: exibe overlay bloqueador
  _mostrarOverlaySemAcesso();
  return false;
}

function _mostrarOverlaySemAcesso() {
  function _inserir() {
    const el = document.createElement('div');
    el.id = '_acesso-negado';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:500',
      'background:var(--bg,#0f1117)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    el.innerHTML = `
      <div style="text-align:center;max-width:380px;padding:40px;
                  background:var(--bg-card,#1a1d27);border:1px solid var(--border,#2a2d3e);
                  border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.4)">
        <div style="font-size:52px;margin-bottom:16px">🔒</div>
        <div style="font-size:17px;font-weight:700;color:var(--text-hi,#e2e8f0);margin-bottom:8px">
          Sem acesso a esta rotina
        </div>
        <div style="font-size:13px;color:var(--text-lo,#64748b);line-height:1.7;margin-bottom:24px">
          Você não tem permissão para acessar esta página.<br>
          Contate o administrador do sistema para solicitar acesso.
        </div>
        <button onclick="history.back()" style="
          padding:9px 22px;border-radius:8px;
          border:1px solid var(--border,#2a2d3e);
          background:var(--bg-hover,#242736);
          color:var(--text-hi,#e2e8f0);font-size:13px;cursor:pointer;
        ">← Voltar</button>
      </div>`;
    document.body.appendChild(el);
  }
  if (document.body) _inserir();
  else document.addEventListener('DOMContentLoaded', _inserir);
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

    // 3b. Carregar rotinas permitidas para filtrar o menu lateral
    const rotinasRes = await fetch('/api/minhas-rotinas').catch(() => null);
    if (rotinasRes?.ok) {
      const data = await rotinasRes.json().catch(() => ({}));
      // Preserva null (= admin sem filtro). Só usa [] como fallback quando a chave está ausente.
      window._iahubRotinas = 'rotinas' in data ? data.rotinas : [];
    } else {
      window._iahubRotinas = [];
    }
  } else {
    // Páginas livres: admin não precisa de filtro, usuário sem empresa não tem rotinas ainda
    window._iahubRotinas = me.role === 'admin' ? null : [];
  }

  _rotinasResolve?.(window._iahubRotinas);

  // 4. Verificar permissão de acesso à página atual
  const _temAcesso = _verificarAcessoPagina();
  if (!_temAcesso) {
    // Overlay já exibido; injeta empresa no topbar mas NÃO resolve authReady
    // (impede que os scripts da página iniciem o carregamento de dados)
    _injetarEmpresaTopbar();
    return;
  }

  _authReadyResolve?.();

  // 5. Injetar combo de empresa no topbar
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

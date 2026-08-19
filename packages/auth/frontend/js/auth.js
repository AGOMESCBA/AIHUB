// Sinal de pronto: resolve quando window._iahubEmpresa estiver disponível
let _authReadyResolve;
window._iahubAuthReady = new Promise(r => { _authReadyResolve = r; });

// Sinal de rotinas: resolve quando window._iahubRotinas estiver disponível
// null = admin (sem filtro) | [] = sem acesso | [...ids] = rotinas permitidas
let _rotinasResolve;
window._iahubRotinasReady = new Promise(r => { _rotinasResolve = r; });

const _IAHUB_BROWSER_SESSION_KEY = 'iahub_browser_session_active';

// Páginas de monitor que ficam abertas continuamente (TVs, painéis) — usam localStorage
// para persistir a flag de sessão entre reinicializações do browser.
const _PAGINAS_MONITOR_PERSISTENTE = [
  '/app/ia-command/monitor.html',
  '/monitor.html',
  '/monitor-email.html',
  '/monitores.html',
];
function _paginaMonitorPersistente() {
  return _PAGINAS_MONITOR_PERSISTENTE.some(
    p => location.pathname === p || location.pathname.endsWith(p)
  );
}
function _sessionStorage() {
  return _paginaMonitorPersistente() ? localStorage : sessionStorage;
}

// Páginas que não exigem empresa selecionada nem verificação de rotina
const _PAGINAS_LIVRES = [
  '/login.html', '/selecionar-empresa.html',
  '/empresas.html', '/usuarios.html', '/seguranca.html',
];

// Páginas estruturais: carregam empresa+rotinas normalmente, mas não têm rotina própria para verificar
const _PAGINAS_ESTRUTURAIS = ['/iahub.html', '/shell.html', '/administracao.html'];
function _paginaEstrutural() {
  return _PAGINAS_ESTRUTURAIS.some(p => location.pathname === p || location.pathname.endsWith(p));
}

// Mapa página → id da rotina (deve espelhar os ids do sidebar.js)
const _PAGINA_ROTINA = {
  // ── IA Command (entradas completas antes dos curtos para evitar endsWith falso-positivo)
  '/app/ia-command/dashboard.html':       'iac-dashboard',
  '/app/ia-command/whatsapp-services.html': 'iac-whatsapp-services',
  '/app/ia-command/monitor.html':          'iac-monitor-whatsapp',
  '/app/ia-command/config-conexoes.html':       'iac-config-conexoes',
  '/app/ia-command/config-conexao-form.html':  'iac-config-conexoes',
  '/app/ia-command/config-ia.html':            'iac-config-ia',
  '/app/ia-command/admin-modulos.html':        'iac-admin-modulos',
  '/app/ia-command/admin-modulo-form.html':    'iac-admin-modulos',
  '/app/ia-command/admin-intencoes.html':      'iac-admin-intencoes',
  '/app/ia-command/admin-intencao-form.html':  'iac-admin-intencoes',
  '/app/ia-command/admin-datasets.html':       'iac-admin-datasets',
  '/app/ia-command/admin-dataset-form.html':   'iac-admin-datasets',
  '/app/ia-command/migrar-dados.html':         'iac-migrar-dados',
  '/app/ia-command/admin-execucoes.html':      'iac-admin-execucoes',
  '/app/ia-command/admin-consumo-ia.html':     'iac-admin-execucoes',
  '/app/ia-command/admin-auditoria.html':      'iac-admin-auditoria',
  '/app/ia-command/admin-interpretacoes.html':    'iac-admin-auditoria',
  '/app/ia-command/admin-interpretacoes-v2.html': 'iac-admin-auditoria',
  '/app/ia-command/admin-interpretacoes-old.html': 'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-backfill.html':    'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-calibracao.html':  'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-embeddings.html':  'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-politicas.html':   'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-saude.html':       'iac-admin-auditoria',
  '/app/ia-command/admin-nlsql-shadow.html':      'iac-admin-auditoria',
  '/app/ia-command/admin-spec-feedback.html':     'iac-admin-spec-feedback',
  '/app/ia-command/admin-logs-consultas.html':    'iac-admin-logs-consultas',
  '/app/ia-command/console-servidor.html':     'iac-console-servidor',
  '/app/ia-command/admin-sinonimos.html':      'iac-admin-sinonimos',
  '/app/ia-command/admin-normalizacao.html':   'iac-admin-normalizacao',
  '/app/ia-command/admin-dialogos.html':       'iac-admin-dialogos',
  '/app/ia-command/admin-financeiro-whatsapp.html': 'iac-financeiro-whatsapp',
  '/app/ia-command/admin-logmodulos-queries.html':    'iac-admin-compras',
  '/app/ia-command/config-middleware-protheus.html':  'iac-config-middleware',
  '/app/ia-command/admin-protheus-sx2.html':          'iac-admin-protheus-sx2',
  '/app/ia-command/admin-protheus-sx3.html':          'iac-admin-protheus-sx3',
  '/app/ia-command/admin-protheus-sys-company.html':      'iac-admin-protheus-sys-company',
  '/app/ia-command/admin-protheus-sys-company-cfg.html':  'iac-admin-protheus-sys-company-cfg',
  '/app/ia-command/admin-agente-local-cargas.html':   'iac-agente-local-cargas',
  '/app/ia-command/admin-instalador-agente.html':     'iac-admin-instalador-agente',
  '/app/ia-command/admin-canais-whatsapp.html':       'iac-admin-canais-whatsapp',
  '/app/ia-command/admin-numeros-whatsapp.html':      'iac-admin-numeros-whatsapp',
  '/app/ia-command/admin-grupos-whatsapp.html':       'iac-admin-grupos-whatsapp',
  '/app/ia-command/admin-mensagens-whatsapp.html':    'iac-admin-mensagens-whatsapp',
  '/app/ia-command/admin-agendamento.html':           'iac-admin-agendamento',
  '/app/ia-command/admin-agendamento-historico.html': 'iac-admin-agendamento',
  // ── IAHub / IA Recruit
  '/dashboard.html':        'dashboard',
  '/monitores.html':        'monitores',
  '/monitor.html':          'monitor-whatsapp',
  '/monitor-email.html':    'monitor-email',
  '/curriculos.html':       'curriculos',
  '/curriculo.html':        'curriculos',
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

const _ROTINA_LABELS = {
  // ── IA Command
  'iac-dashboard':           'IA Command - Dashboard',
  'iac-whatsapp-services':   'IA Command - WhatsApp Services',
  'iac-monitor-whatsapp':    'IA Command - Monitor WhatsApp',
  'iac-config-conexoes':     'IA Command - Conexões ERP',
  'iac-config-ia':           'IA Command - Configurar IA',
  'iac-admin-modulos':       'IA Command - Módulos',
  'iac-admin-intencoes':     'IA Command - Intenções',
  'iac-admin-datasets':      'IA Command - Datasets ERP',
  'iac-migrar-dados':        'IA Command - Migrar Dados',
  'iac-admin-execucoes':     'IA Command - Log de Execuções',
  'iac-admin-auditoria':     'IA Command - Auditoria',
  'iac-admin-spec-feedback': 'IA Command - Propostas de Correcao',
  'iac-admin-logs-consultas': 'IA Command - Log de Consultas',
  'iac-console-servidor':    'IA Command - Console do Servidor',
  'iac-admin-sinonimos':     'IA Command - Equivalências',
  'iac-admin-normalizacao':  'IA Command - Normalização',
  'iac-admin-dialogos':      'IA Command - Diálogos Conversacionais',
  'iac-financeiro-whatsapp': 'IA Command - Relatorio Financeiro WhatsApp',
  'iac-admin-compras':          'IA Command - Consultas de Compras',
  'iac-config-middleware':      'IA Command - Middleware SQL Protheus',
  'iac-admin-protheus-sx2':     'IA Command - Dicionário SX2 Protheus',
  'iac-admin-protheus-sx3':     'IA Command - Dicionário SX3 Protheus',
  'iac-admin-protheus-sys-company':     'IA Command - Dicionário SYS_COMPANY Protheus',
  'iac-admin-protheus-sys-company-cfg': 'IA Command - Dicionário SYS_COMPANY_CFG Protheus',
  'iac-agente-local-cargas':    'IA Command - Cargas Agente Local',
  'iac-admin-instalador-agente': 'IA Command - Instalador Agente Local',
  'iac-admin-agendamento':      'IA Command - Agendamento',
  'iac-admin-grupos-whatsapp':  'IA Command - Grupos WhatsApp',
  // ── IAHub / IA Recruit
  'dashboard': 'Dashboard',
  'monitores': 'Monitores',
  'monitor-whatsapp': 'Monitor WhatsApp',
  'monitor-email': 'Monitor E-mail',
  'curriculos': 'Curriculos',
  'funcoes': 'Cadastro de Funcoes',
  'vagas': 'Vagas por Funcao',
  'processo-seletivo': 'Processo Seletivo',
  'analisador': 'Analisador',
  'historico': 'Historico de Analises',
  'config-analisador': 'Configuracao do Analisador',
  'se-integracoes': 'SE Integracoes',
  'se-curriculos': 'SE Curriculos',
  'se-funcoes': 'SE Funcoes',
  'se-vagas': 'SE Vagas',
  'se-integracoes-config': 'SE Integracoes - Configuracao',
  'se-api-configurador': 'SE API Configurador',
  'configuracoes': 'Configuracoes',
  'administracao': 'Administracao',
};

function _paginaLivre() {
  return _PAGINAS_LIVRES.some(p => location.pathname === p || location.pathname.endsWith(p));
}

function _rotinaIdDaPagina() {
  return Object.entries(_PAGINA_ROTINA).find(
    ([p]) => location.pathname === p || location.pathname.endsWith(p)
  )?.[1] ?? null;
}

function _nomeRotinaAtual(rotinaId = null) {
  const rid = rotinaId || _rotinaIdDaPagina();
  if (rid && _ROTINA_LABELS[rid]) return _ROTINA_LABELS[rid];
  const arquivo = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  return arquivo ? arquivo.replace(/[-_]+/g, ' ') : 'esta rotina';
}

function _escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function _redirecionarSemAcesso(msg) {
  if (msg) _mostrarToastAviso(msg);
  _mostrarOverlaySemAcesso(_nomeRotinaAtual());
  return false;
}

function _verificarAcessoPagina() {
  const rotinas  = window._iahubRotinas;
  if (rotinas === null) return true;  // admin: acesso irrestrito

  // Administração é restrita ao perfil admin — redireciona sem abrir a página
  if (location.pathname === '/administracao.html' || location.pathname.endsWith('/administracao.html')) {
    const role = window._iahubUser?.role;
    if (role !== 'admin') return _redirecionarSemAcesso('A área de Administração é restrita ao perfil Administrador.');
    return true;
  }

  const rotinaId = _rotinaIdDaPagina();
  if (!rotinaId) {
    if (_paginaLivre() || _paginaEstrutural()) return true; // sem rotina própria = OK
    return _redirecionarSemAcesso(`Voce nao tem acesso a rotina ${_nomeRotinaAtual()}.`);
  }

  if (rotinas.includes(rotinaId)) return true;
  if ((_ROTINA_ALIASES[rotinaId] || []).some(alias => rotinas.includes(alias))) return true;

  return _redirecionarSemAcesso(`Voce nao tem acesso a rotina ${_nomeRotinaAtual(rotinaId)}.`);
}

function _mostrarOverlaySemAcesso(rotinaNome = 'esta rotina') {
  function _inserir() {
    document.getElementById('_acesso-negado')?.remove();
    const rotinaSegura = _escapeHtml(rotinaNome);
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
          Usuario sem acesso a rotina
        </div>
        <div style="font-size:13px;color:var(--text-lo,#64748b);line-height:1.7">
          Solicite ao administrador acesso a rotina:<br>
          <strong style="color:var(--text-hi,#e2e8f0)">${rotinaSegura}</strong>
        </div>
      </div>`;
    document.body.appendChild(el);
  }
  if (document.body) _inserir();
  else document.addEventListener('DOMContentLoaded', _inserir);
}

(async function () {
  if (_sessionStorage().getItem(_IAHUB_BROWSER_SESSION_KEY) !== '1') {
    await fetch('/api/logout', { method: 'POST' }).catch(() => null);
    if (!location.pathname.endsWith('/login.html')) location.href = '/login.html';
    return;
  }

  // ── Detectar modo MDI: empresa vem da URL em vez da sessão ───────────────────
  const _empresaUrlId = Number(new URLSearchParams(location.search).get('empresa_id')) || null;

  // Quando em aba MDI, injeta empresa_id em todas as chamadas /api/ automaticamente.
  // Páginas existentes não precisam ser alteradas — o patch é transparente.
  if (_empresaUrlId) {
    const _orig = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        const method = (init.method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
          if (!input.includes('empresa_id='))
            input = input + (input.includes('?') ? '&' : '?') + 'empresa_id=' + _empresaUrlId;
        } else {
          // POST/PUT/PATCH — injeta empresa_id no body existente ou cria body se ausente
          if (init.body) {
            try {
              const b = JSON.parse(init.body);
              if (!b.empresa_id) { b.empresa_id = _empresaUrlId; init = { ...init, body: JSON.stringify(b) }; }
            } catch (_) {}
          } else {
            init = {
              ...init,
              body: JSON.stringify({ empresa_id: _empresaUrlId }),
              headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
            };
          }
        }
      }
      return _orig(input, init);
    };
  }

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
  window._iahubUser = {
    user: me.user,
    user_id: me.user_id,
    nome: me.nome || me.user,
    email: me.email || '',
    role: me.role,
  };
  _atualizarTopbarUsuario(me);

  // 3. Verificar empresa nas páginas que exigem
  if (!_paginaLivre()) {

    if (_empresaUrlId) {
      // ── Modo MDI: empresa independente por aba ────────────────────────────────
      const lista = await fetch('/api/empresas/minhas').then(r => r.json()).catch(() => []);
      const emp   = lista.find(e => Number(e.id) === _empresaUrlId);
      if (!emp && me.role !== 'admin') { location.href = '/login.html'; return; }
      window._iahubEmpresa = emp
        ? { id: emp.id, nome: emp.razao_social || emp.nome || '' }
        : { id: _empresaUrlId, nome: '(empresa)' };
      // Troca de empresa nesta aba comunica ao shell sem alterar a sessão global
      window._trocarEmpresa = (novaEmpresaId) => {
        window.parent.postMessage(
          { type: 'mdi:trocar-empresa', empresaId: Number(novaEmpresaId) },
          location.origin
        );
      };

    } else {
      // ── Modo normal: empresa vem da sessão ───────────────────────────────────
      const sessao = await fetch('/api/session/empresa').then(r => r.json()).catch(() => ({}));
      // Admin sem empresa selecionada pode acessar o sistema para cadastrar empresas
      if (!sessao.empresa_id && me.role !== 'admin') {
        location.href = '/login.html?next=' + encodeURIComponent('/iahub.html');
        return;
      }
      window._iahubEmpresa = sessao.empresa_id
        ? { id: sessao.empresa_id, nome: sessao.empresa_nome || '' }
        : { id: '—', nome: '(nenhuma)' };
    }

    // 3b. Carregar rotinas permitidas — em modo MDI o patch injeta empresa_id
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

  // 6. Exibir aviso de acesso negado vindo de redirecionamento anterior
  const _aviso = sessionStorage.getItem('_iahub_aviso');
  if (_aviso) {
    sessionStorage.removeItem('_iahub_aviso');
    _mostrarToastAviso(_aviso);
  }
})();

function _mostrarToastAviso(msg) {
  function _inserir() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9999', 'background:var(--bg-card,#1a1d27)',
      'border:1px solid rgba(239,68,68,.4)', 'border-radius:10px',
      'padding:12px 20px', 'display:flex', 'align-items:center', 'gap:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,.4)', 'font-size:13px',
      'color:var(--text-hi,#e2e8f0)', 'max-width:90vw',
      'animation:_fadeInDown .25s ease',
    ].join(';');
    el.innerHTML = `<span style="font-size:18px;flex-shrink:0">🔒</span><span>${msg}</span>`;
    const style = document.createElement('style');
    style.textContent = '@keyframes _fadeInDown{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
  }
  if (document.body) _inserir();
  else document.addEventListener('DOMContentLoaded', _inserir);
}

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
        <button class="user-change-pass" onclick="window._abrirTrocarSenha?.()" title="Alterar senha">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Alterar senha
        </button>
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
function _atualizarTopbarUsuario(me) {
  const nome = me.nome || me.user || '';
  const email = me.email || '';
  const label = [nome, email ? `(${email})` : ''].filter(Boolean).join(' ');
  if (!label) return;

  document.querySelectorAll('.topbar-title').forEach(title => {
    const existing = title.querySelector('.topbar-user');
    const userEl = existing || document.createElement('span');
    userEl.className = 'topbar-user';
    userEl.textContent = ` - ${label}`;
    if (!existing) title.appendChild(userEl);
  });
}

async function _injetarEmpresaTopbar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('_empresa-badge')) return;
  const topbarTarget = topbar.querySelector('.topbar-company-slot')
    || topbar.querySelector('.topbar-actions')
    || topbar;

  // Modo monitor: empresa fixada via ?empresa=ID — exibe badge somente-leitura
  const _monitorEid = Number(new URLSearchParams(location.search).get('empresa')) || null;
  if (_monitorEid) {
    const empresas = await fetch('/api/empresas/minhas').then(r => r.json()).catch(() => []);
    const emp  = empresas.find(e => e.id === _monitorEid);
    const nome = emp ? (emp.razao_social || emp.nome) : `Empresa #${_monitorEid}`;
    const badge = document.createElement('div');
    badge.id = '_empresa-badge';
    badge.style.cssText = topbarTarget === topbar ? 'margin-left:auto;' : '';
    badge.innerHTML = `<div style="
      display:flex;align-items:center;gap:7px;
      background:var(--bg-hover);border:1px solid var(--border);
      border-radius:7px;padding:5px 12px;
      font-size:13px;font-weight:600;color:var(--text-hi);
    "><span style="font-size:15px">🏢</span><span>${nome}</span></div>`;
    topbarTarget.appendChild(badge);
    return;
  }

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
  badge.style.cssText = 'position:relative;';
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

  // Botão Guia de Uso — injetado apenas em páginas sem #_guia-btn próprio.
  const isAdminApp    = location.pathname.includes('/app/ia-administracao/')
    || location.pathname === '/administracao.html'
    || location.pathname.endsWith('/administracao.html');
  const isIaCommand   = location.pathname.includes('/app/ia-command/');
  if (!isAdminApp && !isIaCommand && !topbar.querySelector('#_guia-btn')) {
    const guiaBtn = document.createElement('a');
    guiaBtn.id        = '_guia-btn';
    guiaBtn.href      = '/guia/';
    guiaBtn.target    = '_blank';
    guiaBtn.title     = 'Guia de uso do sistema';
    guiaBtn.className = 'btn btn-primary';
    guiaBtn.style.cssText = 'margin-left:auto;gap:6px;font-size:13px;white-space:nowrap;color:#fff;';
    guiaBtn.innerHTML = `<span style="font-size:15px">❓</span><span>Guia de Uso</span>`;
    topbar.appendChild(guiaBtn);
  }

  badge.style.cssText = 'margin-left:8px;position:relative;';
  topbar.appendChild(badge);

  const btn      = document.getElementById('_empresa-btn');
  const dropdown = document.getElementById('_empresa-dropdown');
  let   aberto   = false;
  let   eidAtual = sessao.empresa_id;

  window._iahubAtualizarEmpresaBadge = function ({ id, nome } = {}) {
    if (id !== undefined && id !== null) eidAtual = Number(id);
    if (nome !== undefined) {
      const nomeEl = document.getElementById('_empresa-nome');
      if (nomeEl) nomeEl.textContent = nome || '';
    }
    fecharDropdown();
  };

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
  if (res.ok) {
    // Sinaliza outras abas abertas para recarregarem com a nova empresa
    try { localStorage.setItem('_iahub_empresa_switch', String(empresa_id) + '_' + Date.now()); } catch (_) {}
    location.reload();
  }
};

// Detecta troca de empresa feita em outra aba e recarrega esta
// Páginas de monitor com ?empresa=ID são independentes da sessão — não recarregam
window.addEventListener('storage', (e) => {
  if (e.key === '_iahub_empresa_switch' && e.newValue
      && !new URLSearchParams(location.search).get('empresa'))
    location.reload();
});

// ── Modal: Trocar senha ───────────────────────────────────────────────────────
(function () {
  function _injetarModalSenha() {
    if (document.getElementById('_modal-trocar-senha')) return;

    const overlay = document.createElement('div');
    overlay.id = '_modal-trocar-senha-overlay';
    overlay.onclick = fechar;
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998';

    const modal = document.createElement('div');
    modal.id = '_modal-trocar-senha';
    modal.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:28px 32px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit';
    modal.innerHTML = `
      <div style="font-size:16px;font-weight:700;color:var(--text-hi);margin-bottom:4px">Alterar senha</div>
      <div style="font-size:13px;color:var(--text-lo);margin-bottom:20px">Defina uma nova senha para sua conta.</div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-lo);display:block;margin-bottom:5px">Senha atual</label>
        <div style="position:relative;display:flex;align-items:center">
          <input id="_ts-atual" type="password" placeholder="••••••••" style="width:100%;padding:8px 38px 8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-body);color:var(--text-hi);font-size:13px;outline:none;box-sizing:border-box">
          <button type="button" onclick="_tsToggle('_ts-atual')" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;color:var(--text-lo);padding:0;display:flex">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-lo);display:block;margin-bottom:5px">Nova senha</label>
        <div style="position:relative;display:flex;align-items:center">
          <input id="_ts-nova" type="password" placeholder="Mínimo 8 caracteres" style="width:100%;padding:8px 38px 8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-body);color:var(--text-hi);font-size:13px;outline:none;box-sizing:border-box">
          <button type="button" onclick="_tsToggle('_ts-nova')" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;color:var(--text-lo);padding:0;display:flex">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-lo);display:block;margin-bottom:5px">Confirmar nova senha</label>
        <div style="position:relative;display:flex;align-items:center">
          <input id="_ts-conf" type="password" placeholder="Repita a nova senha" style="width:100%;padding:8px 38px 8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-body);color:var(--text-hi);font-size:13px;outline:none;box-sizing:border-box">
          <button type="button" onclick="_tsToggle('_ts-conf')" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;color:var(--text-lo);padding:0;display:flex">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div id="_ts-alert" style="display:none;font-size:12px;padding:8px 12px;border-radius:8px;margin-bottom:14px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="_tsFechar()" style="padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text-md);font-size:13px;cursor:pointer">Cancelar</button>
        <button onclick="_tsSalvar()" style="padding:8px 18px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer">Salvar</button>
      </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });

    function fechar() {
      overlay.style.display = 'none';
      modal.style.display   = 'none';
    }
    window._tsFechar = fechar;
  }

  window._tsToggle = function (id) {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
  };

  window._tsSalvar = async function () {
    const atual = document.getElementById('_ts-atual').value;
    const nova  = document.getElementById('_ts-nova').value;
    const conf  = document.getElementById('_ts-conf').value;
    const alert = document.getElementById('_ts-alert');

    function erro(msg) {
      alert.textContent = msg;
      alert.style.cssText = 'display:block;font-size:12px;padding:8px 12px;border-radius:8px;margin-bottom:14px;color:#dc2626;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2)';
    }
    function ok(msg) {
      alert.textContent = msg;
      alert.style.cssText = 'display:block;font-size:12px;padding:8px 12px;border-radius:8px;margin-bottom:14px;color:#059669;background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.2)';
    }

    if (!atual)        return erro('Informe a senha atual.');
    if (nova.length < 8) return erro('A nova senha deve ter no mínimo 8 caracteres.');
    if (nova !== conf) return erro('As senhas não coincidem.');

    try {
      const r    = await fetch('/api/usuarios/minha-senha', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ senha_atual: atual, nova_senha: nova }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        ok('✓ Senha alterada com sucesso!');
        setTimeout(window._tsFechar, 1800);
      } else {
        erro(data.error || data.detail || 'Erro ao alterar a senha.');
      }
    } catch (e) {
      erro('Erro de comunicação: ' + e.message);
    }
  };

  window._abrirTrocarSenha = function () {
    _injetarModalSenha();
    document.getElementById('_ts-atual').value = '';
    document.getElementById('_ts-nova').value  = '';
    document.getElementById('_ts-conf').value  = '';
    document.getElementById('_ts-alert').style.display = 'none';
    document.getElementById('_modal-trocar-senha-overlay').style.display = 'block';
    document.getElementById('_modal-trocar-senha').style.display = 'block';
    document.getElementById('_ts-atual').focus();
  };

  document.addEventListener('DOMContentLoaded', _injetarModalSenha);
})();

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  fetch('/api/logout', { method: 'POST' }).finally(() => {
    try { sessionStorage.removeItem('iahub_mdi_state'); } catch(_) {}
    try { sessionStorage.removeItem('iac_mdi_state');   } catch(_) {}
    try { _sessionStorage().removeItem(_IAHUB_BROWSER_SESSION_KEY); } catch(_) {}
    try { localStorage.removeItem(_IAHUB_BROWSER_SESSION_KEY); } catch(_) {}
    location.href = '/login.html';
  });
}

(() => {
  'use strict';

  const TOKEN_KEY = 'svc_token_externo';
  const THEME_KEY = 'iaservice_j2a_theme';
  const $ = (id) => document.getElementById(id);

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    phone: '',
    challengeId: '',
    whoami: null,
    queueFilter: 'todos',
    riskFilter: 'todos',
    riskWaiting: 'todos',
    riskConsultant: 'todos',
    knowledgeTab: 'internal',
    activePanel: 'conversation',
    mobileTarget: 'queue',
    queue: [],
    risk: { consultores: [], chamados: [] },
    selected: null,
    atendimentoId: null,
    messages: [],
    localAttachments: [],
    softAttachments: [],
    pendingFiles: [],
    research: null,
    dossie: null,
    investigations: [],
    trilha: [],
    trilhaExpandida: new Set(),
    processing: new Set(),
    chatStatusText: null,
    chatStatusAtendimentoId: null,
    autoTimer: null,
    countdownTimer: null,
    nextRefreshAt: 0,
    avaliacaoMensagemId: null,
    // state.processing guarda atendimentoId (retornado por abrir-atendimento),
    // mas renderQueue itera sobre chamados (chamadoId) -- este mapa resolve
    // chamadoId -> atendimentoId para o badge "pesquisando" saber qual
    // chave consultar em state.processing. Populado em selectTicket() assim
    // que abrir-atendimento resolve o atendimentoId real.
    atendimentoIdPorChamado: new Map(),
  };

  // Avaliacao Humana (2026-10) -- mesmos criterios/faixas de
  // frontend/atendimento.html (apps/IA Service/frontend/atendimento.html),
  // portados ao J2A.
  const CRITERIOS_AVALIACAO = [
    ['compreensaoProblema', 'Compreensão do problema'],
    ['aproveitamentoEvidencias', 'Aproveitamento das evidências'],
    ['profundidadeTecnica', 'Profundidade técnica'],
    ['orientacaoPratica', 'Orientação prática'],
    ['confiabilidadeTecnica', 'Confiabilidade técnica'],
  ];
  const FAIXAS_AVALIACAO = [
    { chave: 'EXCELENTE', rotulo: 'Excelente', min: 22, max: 25 },
    { chave: 'BOA', rotulo: 'Boa', min: 18, max: 21 },
    { chave: 'PARCIAL', rotulo: 'Parcial', min: 13, max: 17 },
    { chave: 'INSATISFATORIA', rotulo: 'Insatisfatória', min: 0, max: 12 },
  ];
  function faixaDeNotaTotal(notaTotal) {
    return FAIXAS_AVALIACAO.find((f) => notaTotal >= f.min && notaTotal <= f.max)?.rotulo || 'Insatisfatória';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function text(value, fallback = '-') {
    const s = String(value ?? '').trim();
    return s || fallback;
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('active');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('active'), 3600);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    // Botao so-icone (ex. research-btn, sem texto visivel por design — ver
    // "Remove texto do botao Pesquisar Solucoes") nunca deve ter o conteudo
    // substituido por um label de texto: isso estoura a largura fixa do
    // botao e vaza por cima dos elementos vizinhos no cabecalho. Para esses
    // casos so alterna o estado visual (spinner via .loading), sem tocar no
    // innerHTML.
    if (button.classList.contains('icon-only')) {
      button.classList.toggle('loading', !!busy);
      button.disabled = !!busy;
      return;
    }
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      const labelEl = button.querySelector('span:last-child');
      if (labelEl) labelEl.textContent = label || 'Aguarde...';
      else button.textContent = label || 'Aguarde...';
      button.classList.add('loading');
      button.disabled = true;
    } else {
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  function setAccessStatus(message, type = '') {
    const el = $('access-status');
    el.textContent = message || '';
    el.className = `status-line${type ? ' ' + type : ''}`;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatPhone(value) {
    const d = digits(value);
    if (d.length === 13 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    return d ? `+${d}` : '';
  }

  function digitCountBeforeCaret(value, caret) {
    return digits(String(value || '').slice(0, Math.max(0, caret || 0))).length;
  }

  function caretAfterDigitIndex(value, digitIndex) {
    if (digitIndex <= 0) return value.startsWith('+') ? 1 : 0;
    let seen = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (/\d/.test(value[i])) {
        seen += 1;
        if (seen >= digitIndex) return i + 1;
      }
    }
    return value.length;
  }

  function codeInputs() {
    return [...document.querySelectorAll('#code-row input')];
  }

  function codeValue() {
    return codeInputs().map((input) => input.value).join('');
  }

  function syncHiddenCode() {
    $('code-input').value = codeValue();
  }

  function setAccessStep(step) {
    const isPhone = step === 'phone';
    const isCode = step === 'code';
    const isCompany = step === 'company';
    $('phone-form').hidden = !isPhone;
    $('code-form').hidden = !isCode;
    $('company-form').hidden = !isCompany;
    $('phone-form').classList.toggle('active', isPhone);
    $('code-form').classList.toggle('active', isCode);
    $('company-form').classList.toggle('active', isCompany);
    $('pill-phone').classList.toggle('active', isPhone);
    $('pill-code').classList.toggle('active', isCode || isCompany);
    $('access-panel-title').textContent = isPhone ? 'Identifique seu WhatsApp' : isCompany ? 'Escolha a empresa' : 'Confirme o código';
    $('access-panel-subtitle').textContent = isPhone
      ? 'Informe o número com DDI e DDD para receber o código de entrada.'
      : isCompany ? 'Seu telefone está cadastrado em mais de um cliente.'
        : 'Verifique a mensagem recebida e conclua o acesso ao Radar.';
    setAccessStatus('');
    if (isPhone) setTimeout(() => $('phone-input').focus(), 0);
    if (isCode) setTimeout(() => codeInputs()[0]?.focus(), 0);
  }

  function apiHeaders(json = true) {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (state.token) headers['x-sessao-externa'] = state.token;
    return headers;
  }

  async function request(path, options = {}) {
    const json = options.json !== false;
    const res = await fetch(path, {
      ...options,
      headers: { ...apiHeaders(json), ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if ((res.status === 401 || res.status === 403) && state.token) {
      localStorage.removeItem(TOKEN_KEY);
      state.token = '';
      showAccess('Sessao expirada. Entre novamente.');
    }
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    return body;
  }

  const ext = (path) => `/api/ia-service-externo${path}`;

  function applyTheme(value) {
    const theme = value || localStorage.getItem(THEME_KEY) || 'system';
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('#theme-switch [data-theme-option]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeOption === theme);
    });
    localStorage.setItem(THEME_KEY, theme);
  }

  function showAccess(message) {
    $('access-screen').hidden = false;
    $('radar-screen').hidden = true;
    $('app').dataset.view = 'access';
    setAccessStatus(message || '', message ? 'error' : '');
  }

  function showRadar() {
    $('access-screen').hidden = true;
    $('radar-screen').hidden = false;
    $('app').dataset.view = 'radar';
  }

  function initials(name) {
    return text(name, 'IA').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('pt-BR');
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatNumber(value, decimals = 1) {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('pt-BR', { maximumFractionDigits: decimals });
  }

  function formatDays(value) {
    if (value === null || value === undefined || value === '') return '-';
    return `${formatNumber(value)} dias`;
  }

  function formatHours(value) {
    if (value === null || value === undefined || value === '') return '-';
    return `${formatNumber(value)} h`;
  }

  function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  }

  function waitingLabel(value) {
    if (!value) return null;
    const v = String(value).toUpperCase();
    if (v.includes('ATENDENTE')) return 'Aguardando Atendente';
    if (v.includes('CLIENTE')) return 'Aguardando Cliente';
    if (v.includes('FORNECEDOR')) return 'Aguardando Fornecedor';
    return `Aguardando: ${value}`;
  }

  function diasEntre(dataIso) {
    if (!dataIso) return null;
    const inicio = new Date(dataIso);
    if (Number.isNaN(inicio.getTime())) return null;
    const ms = Date.now() - inicio.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }

  function slaBadge(value) {
    const label = text(value, '');
    if (!label) return '';
    const cls = label === 'Em atraso' ? 'danger' : label === 'Proxima do vencimento' ? 'warn' : label === 'Em dia' ? 'ok' : '';
    const display = label === 'Proxima do vencimento' ? 'Prox. vencimento' : label;
    return `<span class="badge ${cls}">${escapeHtml(display)}</span>`;
  }

  function safeUrl(url) {
    try {
      const u = new URL(url, location.origin);
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      return u.href;
    } catch (_) {
      return '';
    }
  }

  function currentTicketTitle(c) {
    return c?.titulo || c?.assunto || c?.breveDescricao || '(sem titulo)';
  }

  async function startLogin(event) {
    event.preventDefault();
    const phone = digits($('phone-input').value);
    if (phone.length < 10 || phone.length > 15) {
      setAccessStatus('Informe o número com DDI e DDD.', 'error');
      return;
    }
    const btn = $('request-code-btn');
    setBusy(btn, true, 'Enviando...');
    setAccessStatus('Enviando código pelo WhatsApp...');
    try {
      const body = await request('/api/ia-service-publico/login/iniciar', {
        method: 'POST',
        body: JSON.stringify({ telefone: phone }),
      });
      state.phone = phone;
      state.challengeId = body.challengeId;
      $('phone-summary').textContent = body.destino || formatPhone(phone);
      $('code-destination').textContent = `Codigo enviado para ${body.destino || 'o WhatsApp informado'}.`;
      codeInputs().forEach((input) => { input.value = ''; });
      $('code-input').value = '';
      setAccessStep('code');
      setAccessStatus('Código enviado. Confira seu WhatsApp.', 'ok');
    } catch (err) {
      setAccessStatus(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  async function verifyLogin(event) {
    event.preventDefault();
    syncHiddenCode();
    const code = $('code-input').value.trim();
    if (code.length !== 6) {
      setAccessStatus('Digite os 6 dígitos do código.', 'error');
      return;
    }
    const btn = $('verify-code-btn');
    setBusy(btn, true, 'Validando...');
    try {
      const body = await request('/api/ia-service-publico/login/verificar', {
        method: 'POST',
        body: JSON.stringify({ challengeId: state.challengeId, telefone: state.phone, codigo: code }),
      });
      if (body.escolhaEmpresa) {
        renderCompanyChoice(body.empresas || []);
        return;
      }
      finishLogin(body.token);
    } catch (err) {
      setAccessStatus(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  function renderCompanyChoice(companies) {
    setAccessStep('company');
    $('company-list').innerHTML = companies.map((c) => `
      <button class="company-option" type="button" data-company-id="${escapeHtml(c.id)}">${escapeHtml(c.nome || `Empresa ${c.id}`)}</button>
    `).join('') || '<div class="status-line">Nenhuma empresa disponivel.</div>';
  }

  async function chooseCompany(event) {
    const btn = event.target.closest('[data-company-id]');
    if (!btn) return;
    setBusy(btn, true, 'Entrando...');
    try {
      const body = await request('/api/ia-service-publico/login/escolher-empresa', {
        method: 'POST',
        body: JSON.stringify({ telefone: state.phone, empresaId: btn.dataset.companyId }),
      });
      finishLogin(body.token);
    } catch (err) {
      setAccessStatus(err.message, 'error');
      setBusy(btn, false);
    }
  }

  function finishLogin(token) {
    state.token = token || '';
    localStorage.setItem(TOKEN_KEY, state.token);
    bootRadar();
  }

  async function bootRadar() {
    if (!state.token) {
      showAccess();
      return;
    }
    try {
      state.whoami = await request(ext('/whoami'));
      showRadar();
      $('company-name').textContent = state.whoami.empresaNome || '-';
      $('consultant-name').textContent = state.whoami.consultorNome || 'Consultor';
      $('user-initials').textContent = initials(state.whoami.consultorNome);
      await Promise.allSettled([loadPreferences(), loadQueue(), loadRisk()]);
      setupAutoRefresh();
      setMobileTarget('queue');
    } catch (err) {
      showAccess(err.message);
    }
  }

  async function loadPreferences() {
    const pref = await request(ext('/radar/minhas-preferencias'));
    $('pre-analysis-toggle').checked = pref.preAnaliseAutomatica !== false;
    try {
      const config = await request(ext('/radar/config'));
      if (config?.autoRefreshSegundos != null) $('auto-refresh-select').value = String(config.autoRefreshSegundos);
    } catch (_) {
      // Mantem o valor padrao do <select> (900s) se a config ainda nao existir/falhar.
    }
  }

  async function savePreferences() {
    try {
      await request(ext('/radar/minhas-preferencias'), {
        method: 'PUT',
        body: JSON.stringify({ preAnaliseAutomatica: $('pre-analysis-toggle').checked }),
      });
      toast('Preferencia salva.');
    } catch (err) {
      toast(`Nao foi possivel salvar: ${err.message}`);
    }
  }

  async function saveAutoRefreshConfig() {
    try {
      const autoRefreshSegundos = Number($('auto-refresh-select').value || 0);
      await request(ext('/radar/config'), {
        method: 'PUT',
        body: JSON.stringify({ autoRefreshSegundos }),
      });
    } catch (err) {
      toast(`Nao foi possivel salvar o intervalo: ${err.message}`);
    }
  }

  async function loadQueue({ forceSync = false } = {}) {
    $('queue-list').innerHTML = '<div class="empty-block">Carregando fila...</div>';
    const params = new URLSearchParams({ filtro_sla: state.queueFilter });
    if (forceSync) params.set('force_sync', 'true');
    try {
      const body = await request(ext(`/radar/fila?${params.toString()}`));
      state.queue = body.chamados || [];
      if (body.sincronizacao?.status === 'em_andamento') toast('Sincronizando SoftExpert em segundo plano...');
      renderQueue();
    } catch (err) {
      $('queue-list').innerHTML = `<div class="empty-block">Nao foi possivel carregar a fila: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderQueue() {
    const term = $('queue-search').value.trim().toLowerCase();
    const filtered = state.queue.filter((c) => {
      if (!term) return true;
      return [c.numero, c.clienteNome, c.solicitanteNome, c.produto, currentTicketTitle(c)]
        .some((v) => String(v || '').toLowerCase().includes(term));
    });
    $('queue-count').textContent = `${state.queue.length} chamado(s)`;
    if (!filtered.length) {
      $('queue-list').innerHTML = '<div class="empty-block">Nenhum chamado encontrado para este filtro.</div>';
      return;
    }
    $('queue-list').innerHTML = filtered.map((c) => `
      <button class="ticket ${state.selected?.id === c.id ? 'active' : ''}" data-ticket-id="${escapeHtml(c.id)}">
        <span class="ticket-top">
          <span class="ticket-number">#${escapeHtml(c.numero)}</span>
          ${slaBadge(c.slaPrazo)}
          ${pesquisaBadge(c.id)}
        </span>
        <span class="ticket-title">${escapeHtml(currentTicketTitle(c))}</span>
        <span class="ticket-meta">${escapeHtml([c.clienteNome, c.produto].filter(Boolean).join(' | '))}<br>Aberto em ${escapeHtml(formatDate(c.dataAbertura))}</span>
      </button>
    `).join('');
  }

  // Indicador de pesquisa em andamento por chamado (pedido do usuario,
  // 2026-10: "nunca sei quando a pesquisa do primeiro ou do segundo que
  // naveguei acabou"). Mostra "Pesquisando..." enquanto o atendimento
  // daquele chamado esta em state.processing (setado em pollMessages/
  // sendMessage/researchSolutions); nao mostra nada quando concluido --
  // decisao deliberada para nao poluir a fila com um badge permanente "lido/
  // nao lido" sem pedido explicito disso.
  function pesquisaBadge(chamadoId) {
    const atendimentoId = state.atendimentoIdPorChamado.get(String(chamadoId));
    if (!atendimentoId || !state.processing.has(atendimentoId)) return '';
    return '<span class="badge warn pulsing">Pesquisando…</span>';
  }

  async function selectTicket(id) {
    const ticket = state.queue.find((c) => String(c.id) === String(id)) || state.risk.chamados.find((c) => String(c.id) === String(id));
    if (!ticket) return;
    state.selected = ticket;
    state.research = null;
    state.dossie = null;
    state.investigations = [];
    state.trilha = [];
    state.trilhaExpandida = new Set();
    state.localAttachments = [];
    state.softAttachments = [];
    state.messages = [];
    state.atendimentoId = null;
    renderQueue();
    renderCaseShell();
    setPanel('conversation');
    setMobileTarget('conversation');
    try {
      await loadSoftAttachments(ticket.id);
      const open = await request(ext(`/radar/chamados/${encodeURIComponent(ticket.id)}/abrir-atendimento`), { method: 'POST' });
      state.atendimentoId = open.atendimentoId;
      state.atendimentoIdPorChamado.set(String(ticket.id), open.atendimentoId);
      await Promise.allSettled([
        loadMessages(),
        loadLocalAttachments(),
        loadResearch(ticket.id),
        loadDossier(),
        loadInvestigations(),
        loadTrilha(),
      ]);
      renderAllCaseData();
      // Bug real corrigido (2026-10): a chamada nao passava atendimentoId
      // como 1o argumento (assinatura exige -- ver comentario de
      // pollMessages), entao a guarda "atendimentoId !== state.atendimentoId"
      // comparava 60 (o antigo 1o argumento "times") contra o atendimentoId
      // real e sempre retornava cedo -- o polling nunca rodava de fato, e o
      // indicador "Aguardando pre-analise..." podia ficar preso na tela sem
      // nunca checar se a resposta ja chegou.
      if (open.preAnaliseDisparada) pollMessages(state.atendimentoId, 60, 3000, 'Aguardando pre-analise automatica da IA...');
    } catch (err) {
      toast(`Nao foi possivel abrir o chamado: ${err.message}`);
    }
  }

  function backToRadar() {
    if (state.selected) {
      setPanel('conversation');
      setMobileTarget('conversation');
      return;
    }
    $('empty-state').hidden = false;
    $('case-view').hidden = true;
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => btn.classList.remove('active'));
    $('nav-radar-btn').classList.add('active');
    setMobileTarget('queue');
  }

  function renderCaseShell() {
    $('empty-state').hidden = true;
    $('case-view').hidden = false;
    const c = state.selected;
    $('case-title').textContent = currentTicketTitle(c);
    $('case-number').textContent = `#${c.numero || '-'}`;
    $('case-badges').innerHTML = [
      waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno) ? `<span class="badge warn">${escapeHtml(waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno))}</span>` : '',
      slaBadge(c.slaPrazo),
      c.tecnicoResponsavelNome ? `<span class="badge">Consultor: ${escapeHtml(c.tecnicoResponsavelNome)}</span>` : '',
    ].filter(Boolean).join('');
    $('case-meta').innerHTML = [
      ['Cliente', c.clienteNome],
      ['Usuario', [c.solicitanteNome, c.solicitanteEmail].filter(Boolean).join(' - ')],
      ['Produto', c.produto],
      ['Previsao', c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : null],
    ].map(([k, v]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(text(v))}</strong></div>`).join('');
    $('messages').innerHTML = '<div class="empty-block">Carregando conversa...</div>';
    renderDescription();
    renderDetails();
    renderSummary();
  }

  function renderDescription() {
    const c = state.selected;
    const desc = text(c.descricao || c.breveDescricao || '', '').trim();
    const section = $('case-description');
    if (!desc) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    $('description-body').textContent = desc;
  }

  function renderAllCaseData() {
    renderMessages();
    renderEvidence();
    renderKnowledge();
    renderTrail();
    renderDetails();
    renderSummary();
  }

  async function loadMessages() {
    if (!state.atendimentoId) return;
    state.messages = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/mensagens`));
    renderMessages();
  }

  async function loadLocalAttachments() {
    if (!state.atendimentoId) return;
    state.localAttachments = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/anexos`));
  }

  async function loadSoftAttachments(ticketId) {
    try {
      const body = await request(ext(`/radar/chamados/${encodeURIComponent(ticketId)}/anexos-softexpert`));
      state.softAttachments = body.anexos || [];
    } catch (err) {
      state.softAttachments = [];
      toast(`Anexos SoftExpert indisponiveis: ${err.message}`);
    }
  }

  async function loadResearch(ticketId) {
    try {
      state.research = await request(ext(`/radar/chamados/${encodeURIComponent(ticketId)}/pesquisa-tecnica`));
    } catch (_) {
      state.research = null;
    }
  }

  async function loadDossier() {
    if (!state.atendimentoId) return;
    try {
      state.dossie = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/dossie`));
    } catch (_) {
      state.dossie = null;
    }
  }

  async function loadInvestigations() {
    if (!state.atendimentoId) return;
    try {
      const body = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/investigacoes?limite=20`));
      state.investigations = body.execucoes || [];
    } catch (_) {
      state.investigations = [];
    }
  }

  async function loadTrilha() {
    if (!state.atendimentoId) return;
    try {
      const body = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/trilha?limite=20`));
      state.trilha = body.trilha || [];
      if (state.trilha.length && state.trilhaExpandida.size === 0) {
        state.trilhaExpandida.add(state.trilha[state.trilha.length - 1].execucaoId);
      }
    } catch (_) {
      state.trilha = [];
    }
    renderTrail();
  }

  function messageRole(m) {
    const autor = text(m.origemAutor, '').trim();
    if (m.papel === 'assistant') return 'IA Service';
    if (m.papel === 'customer') return autor ? `Cliente - ${autor}` : 'Cliente';
    if (m.papel === 'system') return 'Sistema';
    const base = m.direcao === 'out' ? 'Analista' : 'Mensagem';
    return autor ? `${base} - ${autor}` : base;
  }

  function messageAvatar(m) {
    if (m.papel === 'assistant') return '🤖';
    if (m.papel === 'customer') return '👤';
    if (m.papel === 'system') return '⚙️';
    return '🎧';
  }

  function messageSide(m) {
    return m.papel === 'customer' ? 'left' : 'right';
  }

  function messageText(m) {
    return m.conteudo || m.texto || m.resposta || '';
  }

  function messageTimestamp(m) {
    return m.criadoEm || m.createdAt || m.dataCriacao || '';
  }

  function messageAttachments(m) {
    return state.localAttachments.filter((a) => a.mensagemId != null && String(a.mensagemId) === String(m.id));
  }

  // Analista rolando para cima para ler mensagens antigas nao deve ser
  // "puxado" de volta para o fim a cada re-render (achado real, 2026-10) --
  // so forca o scroll para o fim quando o usuario ja estava perto dele
  // (ou o container ainda esta vazio, 1a renderizacao do atendimento).
  function _estaPertoDoFim(container, limiar = 80) {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < limiar;
  }

  // Indicador de progresso dentro do corpo do chat (nao no botao, que tem
  // largura fixa e so comporta um icone) — pedido do usuario: deixar claro
  // que a IA esta processando com base em todo o historico, nao travada.
  function appendChatStatusRow(texto, pertoDoFim = true) {
    const existing = $('chat-status-row');
    if (existing) existing.remove();
    const container = $('messages');
    if (!container) return;
    const row = document.createElement('article');
    row.className = 'message message-left chat-status-row';
    row.id = 'chat-status-row';
    row.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-card chat-status-card">
        <span class="chat-status-dot"></span>
        <span class="chat-status-dot"></span>
        <span class="chat-status-dot"></span>
        <span class="chat-status-text">${escapeHtml(texto || 'Processando...')}</span>
      </div>
    `;
    container.appendChild(row);
    if (pertoDoFim) container.scrollTop = container.scrollHeight;
  }

  // BUG REAL corrigido (2026-10): state.chatStatusText era uma variavel
  // GLOBAL unica, sem nenhuma associacao a qual atendimento o "Aguardando
  // pre-analise..." pertencia -- abrir o chamado A (que dispara o status),
  // depois trocar para o chamado B, fazia renderMessages() de B reexibir o
  // mesmo texto "escapando" do chamado A, mesmo B nao estando em
  // processamento nenhum (reportado pelo usuario: aparecia em TODOS os
  // chamados, nao so no que estava sendo pesquisado). Corrigido associando
  // o texto ao atendimentoId que o gerou -- so e exibido quando esse
  // atendimento ainda e o visivel na tela.
  function showChatStatus(texto, atendimentoId = state.atendimentoId) {
    state.chatStatusText = texto || 'Processando...';
    state.chatStatusAtendimentoId = atendimentoId;
    if (atendimentoId === state.atendimentoId) appendChatStatusRow(state.chatStatusText);
  }

  function hideChatStatus(atendimentoId = state.atendimentoId) {
    if (atendimentoId !== state.chatStatusAtendimentoId) return; // nao esconde status de OUTRO atendimento
    state.chatStatusText = null;
    state.chatStatusAtendimentoId = null;
    const row = $('chat-status-row');
    if (row) row.remove();
  }

  function renderMessages() {
    const container = $('messages');
    const pertoDoFim = _estaPertoDoFim(container);
    // So exibe o indicador "Aguardando pre-analise.../Pesquisando..." se ele
    // pertencer ao atendimento ATUALMENTE visivel -- ver comentario de
    // showChatStatus/hideChatStatus (bug real: status "vazando" para
    // qualquer chamado aberto depois, nao so o que estava em processamento).
    const statusPertenceAoAtual = state.chatStatusText && state.chatStatusAtendimentoId === state.atendimentoId;
    if (!state.messages.length) {
      container.innerHTML = statusPertenceAoAtual ? '' : '<div class="empty-block">Sem mensagens neste atendimento.</div>';
      if (statusPertenceAoAtual) appendChatStatusRow(state.chatStatusText, pertoDoFim);
      return;
    }
    const sorted = [...state.messages].sort((a, b) => new Date(messageTimestamp(a)) - new Date(messageTimestamp(b)));
    container.innerHTML = sorted.map((m) => {
      const assistant = m.papel === 'assistant';
      const side = messageSide(m);
      const attachments = messageAttachments(m);
      const attachmentsHtml = attachments.length ? `
        <div class="message-attachments">${attachments.map((a) => `
          <a class="message-attachment" href="${escapeHtml(ext(`/anexos/${encodeURIComponent(a.id)}/download`))}" target="_blank" rel="noopener">📎 ${escapeHtml(a.nome || a.nomeOriginal || 'Anexo')}</a>
        `).join('')}</div>
      ` : '';
      const avaliacaoHtml = assistant ? renderizarAvaliacaoHumana(m) : '';
      return `
        <article class="message message-${side} ${assistant ? 'assistant' : ''}">
          <div class="message-avatar">${escapeHtml(messageAvatar(m))}</div>
          <div class="message-card">
            <div class="message-head"><strong>${escapeHtml(messageRole(m))}</strong><span>${escapeHtml(formatDateTime(messageTimestamp(m)))}</span></div>
            <div class="message-text">${escapeHtml(messageText(m))}</div>
            ${attachmentsHtml}
            ${avaliacaoHtml}
          </div>
        </article>
      `;
    }).join('');
    if (statusPertenceAoAtual) appendChatStatusRow(state.chatStatusText, pertoDoFim);
    if (pertoDoFim) container.scrollTop = container.scrollHeight;
  }

  // Avaliacao humana de utilidade tecnica real (consultor), independente do
  // Quality Gate -- nunca altera o motor. Mostra resumo compacto se o
  // consultor logado ja avaliou; senao, link discreto para abrir o modal.
  // Porta a mesma logica/UX de atendimento.html (renderizarAvaliacaoHumana),
  // adaptada ao estilo "full re-render a partir do estado" do J2A.
  function renderizarAvaliacaoHumana(m) {
    const avaliacaoHumana = m.respostaOperacional?.avaliacaoHumana;
    const minha = avaliacaoHumana?.minhaAvaliacaoAtual || null;
    const outras = (avaliacaoHumana?.todasAsAvaliacoesAtuais || []).filter(
      (a) => !minha || String(a.usuarioId) !== String(minha.usuarioId),
    );
    const resumoMinha = minha
      ? `<span class="avaliacao-resumo">Sua avaliação: ${minha.notaTotal}/25 · ${escapeHtml(faixaDeNotaTotal(minha.notaTotal))}</span>
         <button type="button" class="avaliacao-link" data-avaliacao-abrir="${escapeHtml(m.id)}">editar</button>`
      : `<button type="button" class="avaliacao-link" data-avaliacao-abrir="${escapeHtml(m.id)}">Avaliar investigação</button>`;
    const outrasHtml = outras.length
      ? `<span class="avaliacao-outras">· ${outras.length} outra(s) avaliação(ões) de ${escapeHtml(outras.map((a) => a.nomeAvaliador || 'consultor').join(', '))}</span>`
      : '';
    return `<div class="message-avaliacao" id="avaliacao-card-${escapeHtml(m.id)}">${resumoMinha}${outrasHtml}</div>`;
  }

  function _renderizarCamposAvaliacao(valores) {
    return `
      ${CRITERIOS_AVALIACAO.map(([campo, rotulo]) => `
        <div class="avaliacao-criterio">
          <label for="avaliacao-${campo}">${escapeHtml(rotulo)}</label>
          <select id="avaliacao-${campo}">
            ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${valores?.notas?.[campo] === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      `).join('')}
      <div class="avaliacao-observacoes">
        <textarea id="avaliacao-observacoes" placeholder="Observações (opcional)" maxlength="2000">${escapeHtml(valores?.observacoes || '')}</textarea>
      </div>
    `;
  }

  function abrirModalAvaliacao(mensagemId) {
    state.avaliacaoMensagemId = mensagemId;
    const m = state.messages.find((msg) => String(msg.id) === String(mensagemId));
    const minha = m?.respostaOperacional?.avaliacaoHumana?.minhaAvaliacaoAtual || null;
    $('avaliacao-modal-sugestao-aviso').innerHTML = '';
    $('avaliacao-modal-campos').innerHTML = _renderizarCamposAvaliacao(minha);
    $('avaliacao-erro-critico').checked = !!minha?.erroTecnicoCritico;
    $('avaliacao-modal-backdrop').classList.add('ativo');
    // Sugestao por IA so e buscada quando ainda nao ha avaliacao salva --
    // nunca sobrescreve uma nota que o consultor ja registrou antes.
    if (!minha) _buscarSugestaoAvaliacao(mensagemId);
  }

  function fecharModalAvaliacao() {
    $('avaliacao-modal-backdrop').classList.remove('ativo');
  }

  async function _buscarSugestaoAvaliacao(mensagemId) {
    const aviso = $('avaliacao-modal-sugestao-aviso');
    if (aviso) aviso.innerHTML = '<div class="avaliacao-sugestao-status">Gerando sugestão da IA…</div>';
    try {
      const resp = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/mensagens/${encodeURIComponent(mensagemId)}/avaliacao/sugestao`));
      // O modal pode ter sido fechado/trocado de mensagem enquanto a chamada
      // estava em voo -- nunca aplica a sugestao em um modal que ja nao e o
      // desta mensagem.
      if (state.avaliacaoMensagemId !== mensagemId) return;
      const avisoAtual = $('avaliacao-modal-sugestao-aviso');
      if (!resp?.sucesso) {
        if (avisoAtual) avisoAtual.innerHTML = '';
        return;
      }
      const campos = $('avaliacao-modal-campos');
      if (campos) campos.innerHTML = _renderizarCamposAvaliacao(resp.sugestao);
      if (avisoAtual) avisoAtual.innerHTML = '<div class="avaliacao-sugestao-rotulo">Sugestão da IA — revise antes de salvar</div>';
    } catch (_) {
      if (state.avaliacaoMensagemId !== mensagemId) return;
      const avisoAtual = $('avaliacao-modal-sugestao-aviso');
      if (avisoAtual) avisoAtual.innerHTML = '';
    }
  }

  async function salvarAvaliacaoInvestigacao() {
    const mensagemId = state.avaliacaoMensagemId;
    if (!mensagemId) return;
    const notas = {};
    for (const [campo] of CRITERIOS_AVALIACAO) {
      notas[campo] = Number($(`avaliacao-${campo}`).value);
    }
    const observacoes = $('avaliacao-observacoes').value.trim() || null;
    const erroTecnicoCritico = $('avaliacao-erro-critico').checked;
    try {
      const resp = await request(ext(`/atendimentos/${encodeURIComponent(state.atendimentoId)}/mensagens/${encodeURIComponent(mensagemId)}/avaliacao`), {
        method: 'POST',
        body: JSON.stringify({ notas, observacoes, erroTecnicoCritico }),
      });
      const m = state.messages.find((msg) => String(msg.id) === String(mensagemId));
      if (m) {
        m.respostaOperacional = m.respostaOperacional || {};
        m.respostaOperacional.avaliacaoHumana = m.respostaOperacional.avaliacaoHumana || { minhaAvaliacaoAtual: null, todasAsAvaliacoesAtuais: [] };
        m.respostaOperacional.avaliacaoHumana.minhaAvaliacaoAtual = resp.avaliacaoAtual;
        const outras = (m.respostaOperacional.avaliacaoHumana.todasAsAvaliacoesAtuais || [])
          .filter((a) => String(a.usuarioId) !== String(resp.avaliacaoAtual.usuarioId));
        m.respostaOperacional.avaliacaoHumana.todasAsAvaliacoesAtuais = [...outras, resp.avaliacaoAtual];
      }
      fecharModalAvaliacao();
      renderMessages();
    } catch (err) {
      toast(`Não foi possível registrar a avaliação: ${err.message}`);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.atendimentoId || state.processing.has(state.atendimentoId)) return;
    const textarea = $('message-input');
    const texto = textarea.value.trim();
    if (!texto && !state.pendingFiles.length) return;
    const atendimentoId = state.atendimentoId;
    state.processing.add(atendimentoId);
    renderQueue();
    setBusy($('send-btn'), true, 'Enviando');
    showChatStatus('Pesquisando e analisando o chamado com a IA...', atendimentoId);
    try {
      const anexoIds = await uploadPendingFiles(atendimentoId);
      const body = await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/investigar`), {
        method: 'POST',
        body: JSON.stringify({ texto: texto || 'Analise os anexos enviados.', anexoIds, anexosComoContexto: anexoIds.length > 0 }),
      });
      textarea.value = '';
      state.pendingFiles = [];
      renderPendingFiles();
      state.messages.push(body);
      state.trilhaExpandida = new Set();
      await Promise.allSettled([loadMessages(), loadLocalAttachments(), loadDossier(), loadInvestigations(), loadTrilha()]);
      renderAllCaseData();
    } catch (err) {
      toast(`Nao foi possivel enviar: ${err.message}`);
    } finally {
      state.processing.delete(atendimentoId);
      renderQueue();
      setBusy($('send-btn'), false);
      hideChatStatus(atendimentoId);
    }
  }

  async function uploadPendingFiles(atendimentoId) {
    const ids = [];
    for (const file of state.pendingFiles) {
      const form = new FormData();
      form.append('arquivo', file);
      const res = await fetch(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/anexos`), {
        method: 'POST',
        headers: apiHeaders(false),
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Erro ${res.status} no upload`);
      ids.push(body.id);
    }
    return ids;
  }

  async function researchSolutions() {
    if (!state.atendimentoId || !state.selected || state.processing.has(state.atendimentoId)) return;
    const atendimentoId = state.atendimentoId;
    state.processing.add(atendimentoId);
    renderQueue();
    setBusy($('research-btn'), true);
    showChatStatus('Pesquisando no histórico completo do chamado...', atendimentoId);
    try {
      await request(ext(`/radar/chamados/${encodeURIComponent(state.selected.id)}/anexos-softexpert/sincronizar`), {
        method: 'POST',
        body: JSON.stringify({ atendimentoId }),
      }).catch(() => null);
      await loadLocalAttachments();
      const anexoIds = state.localAttachments.map((a) => a.id).filter(Boolean);
      await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/investigar`), {
        method: 'POST',
        body: JSON.stringify({
          texto: 'Revise todo o historico, anexos e fontes disponiveis e pesquise uma solucao para este chamado.',
          anexoIds,
          anexosComoContexto: true,
          forcarPesquisa: true,
        }),
      });
      state.trilhaExpandida = new Set();
      await Promise.allSettled([loadMessages(), loadResearch(state.selected.id), loadDossier(), loadInvestigations(), loadTrilha()]);
      renderAllCaseData();
    } catch (err) {
      toast(`Nao foi possivel pesquisar solucoes: ${err.message}`);
    } finally {
      state.processing.delete(atendimentoId);
      renderQueue();
      setBusy($('research-btn'), false);
      hideChatStatus(atendimentoId);
    }
  }

  // atendimentoId é capturado pelo CHAMADOR no momento em que a espera
  // começa (nunca lido de novo de state.atendimentoId aqui dentro) -- sem
  // isso, o polling de um chamado A continuava rodando em background depois
  // do analista trocar para o chamado B (fire-and-forget em selectTicket,
  // sem await): cada iteração via mostrar/esconder o indicador "Aguardando
  // pre-analise..." na tela de B, mesmo esse chamado ja tendo resposta
  // pronta ha tempo -- o mesmo achado real ja corrigido em radar.html
  // principal, replicado aqui porque este e um frontend separado.
  //
  // Deliberadamente NAO para o loop so porque o analista trocou de chamado
  // (diferente da 1a versao deste fix): o polling continua em background
  // ate a resposta chegar ou o tempo esgotar, para alimentar o badge "em
  // andamento" da fila (renderQueue/state.processing) mesmo em chamados que
  // nao estao na tela agora -- so a parte que MEXE NA TELA (showChatStatus/
  // hideChatStatus/loadMessages) e que respeita "ainda e o atendimento
  // visivel?".
  async function pollMessages(atendimentoId, times, interval, statusTexto) {
    const aindaVisivel = () => atendimentoId === state.atendimentoId;
    if (statusTexto) showChatStatus(statusTexto, atendimentoId); // showChatStatus ja so exibe na tela se aindaVisivel() -- nao precisa checar aqui tambem
    state.processing.add(atendimentoId);
    renderQueue();
    try {
      for (let i = 0; i < times; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const temMensagemNova = await _verificarMensagemNova(atendimentoId, aindaVisivel());
        if (temMensagemNova) break;
      }
    } finally {
      state.processing.delete(atendimentoId);
      renderQueue();
      if (statusTexto) hideChatStatus(atendimentoId);
    }
  }

  // Verifica se chegou mensagem nova para `atendimentoId`. Se ainda for o
  // atendimento visivel na tela, reusa loadMessages() (que ja atualiza
  // state.messages/renderMessages); senao, consulta a mesma rota
  // diretamente SEM mexer no estado da tela atual, so para saber se deve
  // encerrar o polling de fundo.
  const _ultimaContagemConhecida = new Map();
  async function _verificarMensagemNova(atendimentoId, aindaVisivel) {
    if (aindaVisivel) {
      const before = state.messages.length;
      await loadMessages().catch(() => null);
      return state.messages.length > before;
    }
    try {
      const mensagens = await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/mensagens`));
      const antes = _ultimaContagemConhecida.get(atendimentoId) ?? mensagens.length;
      _ultimaContagemConhecida.set(atendimentoId, mensagens.length);
      return mensagens.length > antes;
    } catch (_) {
      return false;
    }
  }

  function attachmentRows(list, source) {
    if (!list.length) return '<div class="empty-block">Nenhum anexo encontrado.</div>';
    return `<div class="risk-grid"><table class="risk-table"><thead><tr><th>Arquivo</th><th>Origem</th><th>Tamanho</th><th>Acoes</th></tr></thead><tbody>${
      list.map((a) => {
        const name = a.nome || a.nomeOriginal || 'Anexo';
        const open = source === 'soft'
          ? ext(`/radar/chamados/${encodeURIComponent(state.selected.id)}/anexos-softexpert/${encodeURIComponent(a.oid)}`)
          : ext(`/anexos/${encodeURIComponent(a.id)}/download`);
        return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(a.origem || source)}</td><td>${escapeHtml(formatSize(a.tamanho))}</td><td><button data-open-url="${escapeHtml(open)}">Abrir</button></td></tr>`;
      }).join('')
    }</tbody></table></div>`;
  }

  function renderEvidence() {
    $('evidence-content').innerHTML = `
      <div class="info-card"><h3>Anexos SoftExpert</h3>${attachmentRows(state.softAttachments, 'soft')}</div>
      <div class="info-card"><h3>Anexos do atendimento</h3>${attachmentRows(state.localAttachments, 'local')}</div>
      <div class="info-card"><h3>Validação da análise</h3>${renderValidation()}</div>
    `;
  }

  function renderValidation() {
    if (!state.investigations.length) return '<div class="empty-block">Sem validação registrada para este atendimento.</div>';
    return state.investigations.slice(0, 5).map((exec) => {
      const q = exec.qualityGate || exec.quality_gate || exec.quality || null;
      const label = q ? 'Validação disponível' : 'Execução registrada';
      return `<div class="summary-item"><span>${escapeHtml(formatDateTime(exec.criadoEm || exec.createdAt))}</span><strong>${escapeHtml(label)}</strong></div>`;
    }).join('');
  }

  const TRILHA_STATUS_BADGE = {
    concluido: 'ok',
    aprovado: 'ok',
    alerta: 'warn',
    bloqueado: 'danger',
    erro: 'danger',
    sem_resultado: 'warn',
    dispensada: '',
    sem_dado: '',
    indisponivel: '',
  };

  function trilhaStatusLabel(status) {
    const labels = {
      concluido: 'Concluído',
      aprovado: 'Aprovado',
      alerta: 'Alerta',
      bloqueado: 'Bloqueado',
      erro: 'Erro',
      sem_resultado: 'Sem resultado',
      dispensada: 'Dispensada',
      sem_dado: 'Sem dado registrado',
      indisponivel: 'Indisponível',
    };
    return labels[status] || status || '-';
  }

  function trilhaEventoDetalhes(evento) {
    const d = evento.detalhes;
    if (!d) return '';
    if (evento.tipo === 'processamento_anexos') {
      const linhas = [...(d.processados || []).map((p) => `<div class="summary-item"><span>${escapeHtml(p.nome)}</span><strong>${escapeHtml(p.status)}${p.enviadoComoImagem ? ' · imagem' : ''}</strong></div>`),
        ...(d.omitidos || []).map((o) => `<div class="summary-item"><span>${escapeHtml(o.nome)}</span><strong>Omitido — ${escapeHtml(o.motivo || o.status)}</strong></div>`)];
      const observacoesVisuais = (d.observacoesVisuais || []).map((o) => {
        const textos = [...(o.textosVisiveis || []), ...(o.campos || []), ...(o.valores || [])].slice(0, 6).join(' · ');
        return `<div class="knowledge-card"><h3>${escapeHtml(o.nome || 'Imagem')}${o.confiancaVisual ? ` · confiança ${escapeHtml(o.confiancaVisual)}` : ''}</h3><p>${escapeHtml(o.observacao || textos || 'Sem observação registrada.')}</p></div>`;
      }).join('');
      return linhas.join('') + observacoesVisuais || '<div class="empty-block">Sem anexos nesta execução.</div>';
    }
    if (evento.tipo === 'pesquisa_tecnica') {
      const fontes = (d.fontes || []).map((f) => {
        const url = safeUrl(f.url);
        return `<div class="knowledge-card"><h3>${escapeHtml(f.titulo || f.url || 'Fonte')}${f.oficial ? ' · oficial' : ''}</h3><p>Status: ${escapeHtml(f.status || '-')}</p>${url ? `<a class="link-safe" href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir fonte</a>` : ''}</div>`;
      }).join('');
      const tentativas = (d.tentativasBusca || []).map((t) => `<div class="summary-item"><span>${escapeHtml(t.provider)}</span><strong>${escapeHtml(t.status)}${t.latenciaMs ? ` · ${t.latenciaMs}ms` : ''}</strong></div>`).join('');
      const consultas = (d.consultasExecutadas || []).map((c) => `<div class="summary-item"><span>Consulta</span><strong>${escapeHtml(c)}</strong></div>`).join('');
      return consultas + tentativas + fontes || '<div class="empty-block">Sem pesquisa registrada.</div>';
    }
    if (evento.tipo === 'chamada_provider') {
      const linhas = [
        `<div class="summary-item"><span>Provider final</span><strong>${escapeHtml(d.providerFinal || '-')}${d.modelFinal ? ` (${escapeHtml(d.modelFinal)})` : ''}</strong></div>`,
        `<div class="summary-item"><span>Latência</span><strong>${d.latenciaMs != null ? `${d.latenciaMs}ms` : '-'}</strong></div>`,
        `<div class="summary-item"><span>Tokens (prompt/resposta)</span><strong>${d.tokensPrompt ?? '-'} / ${d.tokensResposta ?? '-'}</strong></div>`,
        d.respostaTruncada ? '<div class="summary-item"><span>Aviso</span><strong>Resposta truncada pelo limite de tamanho</strong></div>' : '',
        ...(d.tentativas || []).map((t) => `<div class="summary-item"><span>Tentativa — ${escapeHtml(t.provider)}${t.model ? ` (${escapeHtml(t.model)})` : ''}</span><strong>${escapeHtml(t.status)}${t.latenciaMs ? ` · ${t.latenciaMs}ms` : ''}${t.erro ? ` · ${escapeHtml(t.erro)}` : ''}</strong></div>`),
      ];
      return linhas.filter(Boolean).join('');
    }
    if (evento.tipo === 'quality_gate') {
      const falhas = (d.falhas || []).map((f) => `<div class="summary-item"><span>${escapeHtml(f.codigo)}${f.categoria ? ` · ${escapeHtml(f.categoria)}` : ''}</span><strong>${escapeHtml(f.severidade || '-')}${f.detalhe ? ` · ${escapeHtml(f.detalhe)}` : ''}</strong></div>`).join('');
      const retry = d.retryCorretivo?.executado
        ? `<div class="summary-item"><span>Retry corretivo</span><strong>${escapeHtml((d.retryCorretivo.acoes || []).join(', ') || 'executado')}${d.retryCorretivo.falhasAntes?.length ? ` · antes: ${escapeHtml(d.retryCorretivo.falhasAntes.join(', '))}` : ''}${d.retryCorretivo.falhasDepois?.length ? ` · depois: ${escapeHtml(d.retryCorretivo.falhasDepois.join(', '))}` : ' · depois: aprovado'}</strong></div>`
        : '';
      const recuperacao = d.recuperacaoDeterministica?.aplicada
        ? `<div class="summary-item"><span>Recuperação determinística</span><strong>Aplicada${d.recuperacaoDeterministica.modo ? ` · modo ${escapeHtml(d.recuperacaoDeterministica.modo)}` : ''}${d.recuperacaoDeterministica.origem ? ` · origem ${escapeHtml(d.recuperacaoDeterministica.origem)}` : ''}</strong></div>`
        : '';
      const revisao = d.revisaoNecessaria ? `<div class="summary-item"><span>Revisão necessária</span><strong>${escapeHtml(d.revisaoNecessaria.motivo || '-')}</strong></div>` : '';
      return falhas + retry + recuperacao + revisao || '<div class="empty-block">Nenhum ponto de atenção identificado.</div>';
    }
    if (evento.tipo === 'leitura_historico') {
      return [
        `<div class="summary-item"><span>Mensagens</span><strong>${d.mensagensSelecionadas ?? '-'} de ${d.mensagensDisponiveis ?? '-'} selecionadas</strong></div>`,
        d.dossieStatus ? `<div class="summary-item"><span>Dossiê técnico</span><strong>${escapeHtml(d.dossieStatus)}${d.dossieStale ? ' · desatualizado' : ''}</strong></div>` : '',
      ].filter(Boolean).join('');
    }
    if (evento.tipo === 'diagnostico_estruturado') {
      const papeis = Object.entries(d.evidenciasPorPapel || {}).map(([papel, n]) => `${papel}: ${n}`).join(' · ');
      const linhas = [
        d.problemaPrincipal ? `<div class="summary-item"><span>Problema principal</span><strong>${escapeHtml(d.problemaPrincipal)}</strong></div>` : '',
        d.estadoOperacional ? `<div class="summary-item"><span>Estado operacional</span><strong>${escapeHtml(d.estadoOperacional)}</strong></div>` : '',
        papeis ? `<div class="summary-item"><span>Evidências por papel causal</span><strong>${escapeHtml(papeis)}</strong></div>` : '',
        ...(d.lacunasInformacao || []).map((l) => `<div class="summary-item"><span>Lacuna</span><strong>${escapeHtml(l)}</strong></div>`),
        ...(d.acoesParaReduzirIncerteza || []).map((a) => `<div class="summary-item"><span>Ação para reduzir incerteza</span><strong>${escapeHtml(a)}</strong></div>`),
      ];
      if (d.planoRespostaRastreavel) {
        const prr = d.planoRespostaRastreavel;
        linhas.push(`<div class="summary-item"><span>Plano de Resposta Rastreável</span><strong>${prr.fatosComprovados} fato(s) · ${prr.hipotesesFundamentadas} hipótese(s) · ${prr.termosTecnicosPermitidos} termo(s) técnico(s) permitido(s)</strong></div>`);
        for (const l of prr.lacunasObrigatorias || []) {
          linhas.push(`<div class="summary-item"><span>Lacuna obrigatória${l.bloqueiaConclusao ? ' (bloqueante)' : ''}</span><strong>${escapeHtml(l.texto)}</strong></div>`);
        }
        if (prr.proximoPassoRecomendado) linhas.push(`<div class="summary-item"><span>Próximo passo recomendado</span><strong>${escapeHtml(prr.proximoPassoRecomendado)}</strong></div>`);
      }
      return linhas.filter(Boolean).join('') || '<div class="empty-block">Sem quadro investigativo estruturado.</div>';
    }
    return '';
  }

  function renderTrail() {
    const content = $('trail-content');
    if (!content) return;
    if (!state.trilha.length) {
      content.innerHTML = '<div class="empty-block">Nenhuma execução de investigação registrada ainda para este atendimento.</div>';
      return;
    }
    content.innerHTML = state.trilha.map((execucao, idx) => {
      const aberta = state.trilhaExpandida.has(execucao.execucaoId);
      const badge = TRILHA_STATUS_BADGE[execucao.status] ?? (execucao.status?.includes('alerta') ? 'warn' : execucao.status?.includes('revisao') ? 'danger' : '');
      const eventosHtml = execucao.eventos.map((evento, eIdx) => {
        const evBadge = TRILHA_STATUS_BADGE[evento.status] || '';
        return `
          <div class="trail-step" data-trail-step="${execucao.execucaoId}:${eIdx}">
            <button type="button" class="trail-step-head" data-trail-step-toggle="${execucao.execucaoId}:${eIdx}">
              <span class="trail-step-title">${eIdx + 1}. ${escapeHtml(evento.titulo)}</span>
              <span class="badge ${escapeHtml(evBadge)}">${escapeHtml(trilhaStatusLabel(evento.status))}</span>
            </button>
            <div class="trail-step-summary">${escapeHtml(evento.resumo)}</div>
            <div class="trail-step-details" hidden>${trilhaEventoDetalhes(evento)}</div>
          </div>`;
      }).join('');
      return `
        <div class="trail-execution">
          <button type="button" class="trail-execution-head" data-trail-toggle="${execucao.execucaoId}">
            <span class="trail-execution-title">Execução investigativa #${state.trilha.length - idx} — ${escapeHtml(formatDateTime(execucao.criadoEm))}</span>
            <span class="badge ${escapeHtml(badge)}">${escapeHtml(execucao.statusLabel)}</span>
          </button>
          <div class="trail-execution-body" ${aberta ? '' : 'hidden'}>${eventosHtml}</div>
        </div>`;
    }).join('');
  }

  function renderKnowledge() {
    const content = $('knowledge-content');
    if (!state.research) {
      content.innerHTML = '<div class="empty-block">Pesquisa ainda não carregada para este chamado.</div>';
      return;
    }
    const internal = state.research.relacionados || [];
    const pesquisa = state.research.pesquisa || {};
    if (state.knowledgeTab === 'technical') {
      const results = (pesquisa.resultados || []).map((r) => {
        const url = safeUrl(r.url);
        return `<div class="knowledge-card"><h3>${escapeHtml(r.titulo || r.fonte || 'Resultado')}</h3><p>${escapeHtml(r.trecho || '')}</p>${url ? `<a class="link-safe" href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir fonte</a>` : ''}</div>`;
      }).join('');
      const links = (pesquisa.links || []).map((l) => {
        const url = safeUrl(l.url);
        return `<div class="knowledge-card"><h3>${escapeHtml(l.fonte || 'Consulta')}</h3><p>${escapeHtml(l.consulta || '')}</p>${url ? `<a class="link-safe" href="${escapeHtml(url)}" target="_blank" rel="noopener">Abrir pesquisa</a>` : ''}</div>`;
      }).join('');
      content.innerHTML = results || links || '<div class="empty-block">Nenhuma trilha técnica encontrada.</div>';
      return;
    }
    content.innerHTML = internal.map((r) => {
      const c = r.chamado || r;
      return `<div class="knowledge-card"><h3>#${escapeHtml(c.numero || '')} ${escapeHtml(currentTicketTitle(c))}</h3><p>${escapeHtml(c.descricao || c.breveDescricao || '')}</p><div class="case-badges"><span class="badge">score ${escapeHtml(r.score ?? '-')}</span>${r.temSolucaoAplicada ? '<span class="badge ok">Possui solução</span>' : ''}</div></div>`;
    }).join('') || '<div class="empty-block">Nenhum chamado semelhante encontrado.</div>';
  }

  function slaPrazosFields(c) {
    return [
      ['Aguardando retorno', waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno)],
      ['SLA', c.slaPrazo || c.slaStatus],
      ['Previsão de conclusão', c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : null],
      ['SLA em horas', c.slaHoras],
      ['SLA inicial', c.slaInicial],
      ['SLA anterior', c.slaAnterior],
      ['Aberto em', formatDate(c.dataAbertura)],
      ['Último posicionamento', formatDate(c.ultimoPosicionamentoEm)],
      ['Duração total', formatDays(c.diasDur)],
      ['Duração total em horas', formatHours(c.hrDur)],
      ['Em suporte', formatDays(c.diasDurSup)],
      ['Em desenvolvimento', formatDays(c.diasDurFsw)],
      ['Com o distribuidor', formatDays(c.diasDurDist)],
      ['Com o cliente', formatDays(c.diasDurCli)],
      ['Com a tecnologia do cliente', formatDays(c.diasDurTicli)],
    ];
  }

  function renderDetails() {
    const c = state.selected;
    if (!c) return;
    const groups = [
      ['📄', 'Identificação', [
        ['Cliente', c.clienteNome],
        ['Usuário', [c.solicitanteNome, c.solicitanteEmail].filter(Boolean).join(' - ')],
        ['Consultor', c.tecnicoResponsavelNome],
        ['Chamado de referência', c.chamadoReferencia ? `#${c.chamadoReferencia}` : null],
      ], true],
      ['⏱', 'SLA & prazos', slaPrazosFields(c), true],
      ['🏷', 'Classificação', [
        ['Produto', c.produto],
        ['Família', c.familia],
        ['Módulo', c.modulo],
        ['Serviço', c.servico],
        ['Tipo', c.tipoChamadoFinal || c.tipoChamado],
        ['Natureza', c.natureza],
        ['Nível', c.nivel],
      ], true],
      ['📋', 'Kanban — atividade de desenvolvimento', [
        ['ID Kanban', c.kanbanId],
        ['Chave', c.kanbanKey],
        ['Atributos', c.kanbanAtributos],
        ['Início', c.kanbanDataInicio ? formatDateTime(c.kanbanDataInicio) : null],
      ], !!c.kanbanId],
    ];
    $('details-content').innerHTML = groups
      .filter(([, , , visivel]) => visivel)
      .map(([icon, title, fields]) => {
        const preenchidos = fields.filter(([, v]) => v !== null && v !== undefined && v !== '');
        if (!preenchidos.length) return '';
        return `
          <div class="info-card"><h3><span class="info-card-icon">${icon}</span>${escapeHtml(title)}</h3><div class="info-grid">${
            preenchidos.map(([k, v]) => `<div class="info-item"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')
          }</div></div>
        `;
      })
      .filter(Boolean)
      .join('');
  }

  function dossieText() {
    const d = state.dossie || {};
    return d.resumoEstado || d.resumo || d.texto || d.dossie?.resumoEstado || '';
  }

  function renderSummary() {
    if (!state.selected) {
      $('summary-content').innerHTML = '<div class="empty-block">Selecione um chamado para carregar dossiê, pesquisa e risco.</div>';
      return;
    }
    const c = state.selected;
    const elapsed = Number(c.hrDur || 0);
    const goal = Number(c.slaHoras || 0);
    const pct = goal > 0 ? Math.min(100, Math.round((elapsed / goal) * 100)) : 0;
    const dias = diasEntre(c.ultimoPosicionamentoEm || c.dataAbertura);
    const waitHighlight = waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno) && dias !== null
      ? `<div class="waiting-highlight waiting-highlight-compact">
          <div class="waiting-highlight-label">${escapeHtml(waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno))}</div>
          <div class="waiting-highlight-days">${escapeHtml(dias === 0 ? 'Hoje' : dias === 1 ? '1 dia' : `${dias} dias`)}</div>
          <div class="waiting-highlight-sub">desde o último posicionamento em ${escapeHtml(formatDate(c.ultimoPosicionamentoEm || c.dataAbertura))}</div>
        </div>`
      : '';
    const slaPrazosHtml = slaPrazosFields(c)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<div class="summary-item"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`)
      .join('');
    const waitingItem = waitHighlight
      ? ''
      : `<div class="summary-item"><span>Aguardando retorno</span><strong>${escapeHtml(waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno) || 'Não informado')}</strong></div>`;
    $('summary-content').innerHTML = `
      <div class="summary-card"><h3>Chamado</h3><div class="summary-list">
        <div class="summary-item"><span>Problema identificado</span><strong>${escapeHtml(currentTicketTitle(c))}</strong></div>
        <div class="summary-item"><span>SLA</span><strong>${escapeHtml(c.slaPrazo || c.slaStatus || '-')}</strong></div>
        <div class="summary-item"><span>Previsão</span><strong>${escapeHtml(c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : '-')}</strong></div>
        ${waitingItem}
        ${waitHighlight}
        <div class="summary-item"><span>Dossiê</span><div>${escapeHtml(dossieText() || 'Sem resumo estruturado disponível.')}</div></div>
      </div></div>
      <div class="summary-card"><h3>Pesquisa Técnica</h3><div class="summary-item"><strong>${escapeHtml(String((state.research?.relacionados || []).length))} similar(es)</strong><div>${escapeHtml(String((state.research?.pesquisa?.resultados || state.research?.pesquisa?.links || []).length))} fonte(s)/trilha(s)</div></div></div>
      <div class="summary-card"><h3>Risco SLA</h3><div class="summary-item"><span>Status</span><strong>${escapeHtml(c.slaPrazo || '-')}</strong></div><div class="progress" title="${pct}%"><span style="--value:${pct}%"></span></div><div class="summary-item"><span>Previsão</span><strong>${escapeHtml(c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : '-')}</strong></div></div>
      <div class="summary-card"><h3>SLA e Prazos</h3><div class="summary-list">${slaPrazosHtml}</div></div>
    `;
  }

  async function loadRisk({ forceSync = false } = {}) {
    const params = new URLSearchParams({ filtro: state.riskFilter });
    if (forceSync) params.set('force_sync', 'true');
    try {
      const body = await request(ext(`/radar/risco-sla?${params.toString()}`));
      state.risk = { consultores: body.consultores || [], chamados: body.chamados || [] };
      renderRisk();
    } catch (err) {
      $('risk-grid').innerHTML = `<div class="empty-block">Nao foi possivel carregar Risco SLA: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderRisk() {
    const chamadosBase = state.riskConsultant === 'todos'
      ? state.risk.chamados
      : state.risk.chamados.filter((c) => String(c.tecnicoResponsavelId || '__sem_consultor__') === String(state.riskConsultant));
    const term = $('risk-search').value.trim().toLowerCase();
    const filtered = chamadosBase.filter((c) => {
      const wait = waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno);
      if (state.riskWaiting !== 'todos' && wait !== state.riskWaiting) return false;
      if (!term) return true;
      return [c.numero, c.clienteNome, c.solicitanteNome, currentTicketTitle(c), wait].some((v) => String(v || '').toLowerCase().includes(term));
    });
    const totals = {
      atraso: state.risk.chamados.filter((c) => c.slaPrazo === 'Em atraso').length,
      proximo: state.risk.chamados.filter((c) => c.slaPrazo === 'Proxima do vencimento').length,
    };
    $('risk-consultants').innerHTML = `
      <button class="risk-consultant ${state.riskConsultant === 'todos' ? 'active' : ''}" data-consultant-id="todos"><strong>Todos os consultores</strong><br><small>${state.risk.chamados.length} chamado(s) · ${totals.atraso} atraso · ${totals.proximo} prox.</small></button>
      ${state.risk.consultores.map((c) => `<button class="risk-consultant ${String(state.riskConsultant) === String(c.id) ? 'active' : ''}" data-consultant-id="${escapeHtml(c.id || '__sem_consultor__')}"><strong>${escapeHtml(c.nome || 'Sem consultor')}</strong><br><small>${escapeHtml(c.total || 0)} chamado(s) · ${escapeHtml(c.emAtraso || 0)} atraso · ${escapeHtml(c.proximo || 0)} prox.</small></button>`).join('')}
    `;
    if (!filtered.length) {
      $('risk-grid').innerHTML = '<div class="empty-block">Nenhum chamado encontrado.</div>';
      return;
    }
    let lastConsultant = '';
    const rows = [];
    for (const c of filtered) {
      const consultant = c.tecnicoResponsavelNome || 'Sem consultor';
      if (consultant !== lastConsultant) {
        rows.push(`<tr class="group-row"><td colspan="15">${escapeHtml(consultant)}</td></tr>`);
        lastConsultant = consultant;
      }
      rows.push(`<tr>
        <td><button data-ticket-id="${escapeHtml(c.id)}">#${escapeHtml(c.numero || '-')}</button></td>
        <td>${escapeHtml(currentTicketTitle(c))}</td>
        <td>${escapeHtml(c.clienteNome || '-')}</td>
        <td>${escapeHtml(c.solicitanteNome || '-')}</td>
        <td>${escapeHtml(waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno) || '-')}</td>
        <td>${slaBadge(c.slaPrazo)}</td>
        <td>${escapeHtml(c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : '-')}</td>
        <td>${escapeHtml(formatDays(c.diasDur))}</td>
        <td>${escapeHtml(formatHours(c.hrDur))}</td>
        <td>${escapeHtml(formatDays(c.diasDurSup))}</td>
        <td>${escapeHtml(formatDays(c.diasDurFsw))}</td>
        <td>${escapeHtml(formatDays(c.diasDurDist))}</td>
        <td>${escapeHtml(formatDays(c.diasDurCli))}</td>
        <td>${escapeHtml(formatDays(c.diasDurTicli))}</td>
        <td>${escapeHtml(formatDate(c.ultimoPosicionamentoEm))}</td>
      </tr>`);
    }
    $('risk-grid').innerHTML = `<table class="risk-table"><thead><tr><th>Chamado</th><th>Título</th><th>Cliente</th><th>Usuário</th><th>Aguardando retorno</th><th>Status</th><th>Previsão conclusão</th><th>Duração</th><th>Horas duração</th><th>Dias suporte</th><th>Dias desenv.</th><th>Dias distrib.</th><th>Dias cliente</th><th>Dias tecn. cliente</th><th>Último</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function setPanel(panel) {
    state.activePanel = panel;
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.panelTab === panel));
    $('nav-radar-btn').classList.remove('active');
    ['conversation', 'evidence', 'knowledge', 'trail', 'details', 'risk'].forEach((name) => {
      const el = $(`panel-${name}`);
      if (el) el.classList.toggle('active', name === panel);
    });
    $('radar-layout').classList.toggle('summary-auto-collapsed', panel !== 'conversation');
    if (panel === 'risk') loadRisk();
    if (panel === 'knowledge') renderKnowledge();
    if (panel === 'trail') renderTrail();
  }

  function setMobileTarget(target) {
    state.mobileTarget = target;
    const layout = $('radar-layout');
    layout.classList.remove('mobile-queue', 'mobile-conversation', 'mobile-summary', 'mobile-more');
    layout.classList.add(`mobile-${target}`);
    document.querySelectorAll('.mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.mobileTarget === target));
    if (target === 'conversation') setPanel('conversation');
    if (target === 'summary') renderSummary();
    if (target === 'more' && state.activePanel === 'conversation') setPanel('details');
  }

  function renderPendingFiles() {
    const el = $('pending-files');
    el.classList.toggle('active', state.pendingFiles.length > 0);
    el.textContent = state.pendingFiles.map((f) => f.name).join(', ');
  }

  function setupAutoRefresh() {
    clearInterval(state.autoTimer);
    clearInterval(state.countdownTimer);
    const seconds = Number($('auto-refresh-select').value || 0);
    const countdownEl = $('refresh-countdown');
    if (!seconds) {
      countdownEl.hidden = true;
      return;
    }
    state.nextRefreshAt = Date.now() + seconds * 1000;
    countdownEl.hidden = false;
    renderCountdown();
    state.countdownTimer = setInterval(renderCountdown, 1000);
    state.autoTimer = setInterval(() => {
      loadQueue().catch(() => null);
      if (state.activePanel === 'risk') loadRisk().catch(() => null);
      state.nextRefreshAt = Date.now() + seconds * 1000;
    }, seconds * 1000);
  }

  function renderCountdown() {
    const countdownEl = $('refresh-countdown');
    if (!countdownEl || countdownEl.hidden) return;
    const remaining = Math.max(0, Math.round((state.nextRefreshAt - Date.now()) / 1000));
    const mm = Math.floor(remaining / 60);
    const ss = remaining % 60;
    countdownEl.textContent = mm > 0 ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
  }

  function bindEvents() {
    $('phone-form').addEventListener('submit', startLogin);
    $('code-form').addEventListener('submit', verifyLogin);
    $('back-to-phone-btn').addEventListener('click', () => {
      state.challengeId = '';
      codeInputs().forEach((input) => { input.value = ''; });
      syncHiddenCode();
      setAccessStep('phone');
    });
    $('back-company-btn').addEventListener('click', () => {
      state.challengeId = '';
      state.phone = '';
      codeInputs().forEach((input) => { input.value = ''; });
      syncHiddenCode();
      setAccessStep('phone');
    });
    $('phone-input').addEventListener('input', () => {
      const input = $('phone-input');
      const digitIndex = digitCountBeforeCaret(input.value, input.selectionStart);
      input.value = formatPhone(input.value);
      const pos = caretAfterDigitIndex(input.value, digitIndex);
      try { input.setSelectionRange(pos, pos); } catch (_) {}
    });
    codeInputs().forEach((input, idx, inputs) => {
      input.addEventListener('input', () => {
        input.value = digits(input.value).slice(0, 1);
        syncHiddenCode();
        if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (codeValue().length === 6) $('verify-code-btn').focus();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
        if (event.key === 'ArrowLeft' && idx > 0) inputs[idx - 1].focus();
        if (event.key === 'ArrowRight' && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (event.key === 'Enter') $('verify-code-btn').click();
      });
      input.addEventListener('paste', (event) => {
        event.preventDefault();
        const chars = digits(event.clipboardData.getData('text')).slice(0, 6).split('');
        inputs.forEach((el, i) => { el.value = chars[i] || ''; });
        syncHiddenCode();
        inputs[Math.min(chars.length, inputs.length - 1)]?.focus();
      });
    });
    $('company-list').addEventListener('click', chooseCompany);
    $('logout-btn').addEventListener('click', () => {
      localStorage.removeItem(TOKEN_KEY);
      state.token = '';
      showAccess('Sessao encerrada.');
    });
    $('theme-switch').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-theme-option]');
      if (btn) applyTheme(btn.dataset.themeOption);
    });
    $('refresh-queue-btn').addEventListener('click', () => {
      loadQueue({ forceSync: true });
      const seconds = Number($('auto-refresh-select').value || 0);
      if (seconds) state.nextRefreshAt = Date.now() + seconds * 1000;
    });
    $('queue-search').addEventListener('input', renderQueue);
    document.querySelectorAll('[data-queue-filter]').forEach((btn) => btn.addEventListener('click', () => {
      state.queueFilter = btn.dataset.queueFilter;
      document.querySelectorAll('[data-queue-filter]').forEach((b) => b.classList.toggle('active', b === btn));
      loadQueue();
    }));
    $('auto-refresh-select').addEventListener('change', () => {
      setupAutoRefresh();
      saveAutoRefreshConfig();
    });
    $('pre-analysis-toggle').addEventListener('change', savePreferences);
    $('nav-radar-btn').addEventListener('click', backToRadar);
    $('queue-list').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ticket-id]');
      if (btn) selectTicket(btn.dataset.ticketId);
    });
    $('risk-grid').addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-url]');
      if (open) return openAttachment(open.dataset.openUrl);
      const btn = event.target.closest('[data-ticket-id]');
      if (btn) selectTicket(btn.dataset.ticketId);
    });
    $('evidence-content').addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-url]');
      if (open) openAttachment(open.dataset.openUrl);
    });
    $('trail-content').addEventListener('click', (event) => {
      const execToggle = event.target.closest('[data-trail-toggle]');
      if (execToggle) {
        const id = execToggle.dataset.trailToggle;
        if (state.trilhaExpandida.has(id)) state.trilhaExpandida.delete(id);
        else state.trilhaExpandida.add(id);
        renderTrail();
        return;
      }
      const stepToggle = event.target.closest('[data-trail-step-toggle]');
      if (stepToggle) {
        const body = stepToggle.closest('.trail-step').querySelector('.trail-step-details');
        if (body) body.hidden = !body.hidden;
        return;
      }
      const open = event.target.closest('[data-open-url]');
      if (open) openAttachment(open.dataset.openUrl);
    });
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => btn.addEventListener('click', () => {
      setPanel(btn.dataset.panelTab);
      if (state.selected && (state.mobileTarget === 'queue' || state.mobileTarget === 'summary')) setMobileTarget('conversation');
    }));
    document.querySelectorAll('[data-knowledge-tab]').forEach((btn) => btn.addEventListener('click', () => {
      state.knowledgeTab = btn.dataset.knowledgeTab;
      document.querySelectorAll('[data-knowledge-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      renderKnowledge();
    }));
    document.querySelectorAll('[data-risk-filter]').forEach((btn) => btn.addEventListener('click', () => {
      state.riskFilter = btn.dataset.riskFilter;
      document.querySelectorAll('[data-risk-filter]').forEach((b) => b.classList.toggle('active', b === btn));
      loadRisk();
    }));
    $('risk-waiting-filter').addEventListener('change', (e) => { state.riskWaiting = e.target.value; renderRisk(); });
    $('risk-search').addEventListener('input', renderRisk);
    $('risk-consultants').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-consultant-id]');
      if (!btn) return;
      state.riskConsultant = btn.dataset.consultantId;
      renderRisk();
    });
    $('toggle-risk-consultants').addEventListener('click', () => $('risk-layout').classList.toggle('consultants-collapsed'));
    $('toggle-summary-btn').addEventListener('click', () => {
      const layout = $('radar-layout');
      const collapsed = layout.classList.contains('summary-collapsed') || layout.classList.contains('summary-auto-collapsed');
      layout.classList.remove('summary-auto-collapsed');
      layout.classList.toggle('summary-collapsed', !collapsed);
    });
    $('summary-reopen-rail').addEventListener('click', () => {
      $('radar-layout').classList.remove('summary-collapsed', 'summary-auto-collapsed');
    });
    $('description-toggle').addEventListener('click', () => $('case-description').classList.toggle('collapsed'));
    $('toggle-header-btn').addEventListener('click', () => {
      const collapsed = $('case-header').classList.toggle('collapsed');
      $('case-view').classList.toggle('header-collapsed', collapsed);
      $('toggle-header-btn').classList.toggle('collapsed', collapsed);
      $('toggle-header-btn').title = collapsed ? 'Mostrar detalhes do chamado' : 'Ocultar detalhes do chamado';
      const layout = $('radar-layout');
      layout.classList.remove('summary-auto-collapsed');
      layout.classList.toggle('summary-collapsed', collapsed);
    });
    $('research-btn').addEventListener('click', researchSolutions);
    $('composer').addEventListener('submit', sendMessage);
    $('file-input').addEventListener('change', (event) => {
      state.pendingFiles = [...event.target.files];
      renderPendingFiles();
    });
    document.querySelectorAll('.mobile-nav button').forEach((btn) => btn.addEventListener('click', () => setMobileTarget(btn.dataset.mobileTarget)));

    // Avaliacao Humana -- delegacao de clique dentro do chat (botao
    // "Avaliar investigação"/"editar" e reconstruido a cada renderMessages,
    // mesmo padrao ja usado para data-ticket-id/data-open-url).
    $('messages').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-avaliacao-abrir]');
      if (btn) abrirModalAvaliacao(btn.dataset.avaliacaoAbrir);
    });
    $('avaliacao-modal-backdrop').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) fecharModalAvaliacao();
    });
    $('avaliacao-modal-close').addEventListener('click', fecharModalAvaliacao);
    $('avaliacao-modal-cancelar').addEventListener('click', fecharModalAvaliacao);
    $('avaliacao-modal-salvar').addEventListener('click', salvarAvaliacaoInvestigacao);
  }

  async function openAttachment(url) {
    try {
      const res = await fetch(url, { headers: apiHeaders(false) });
      const body = res.ok ? null : await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      toast(`Nao foi possivel abrir o anexo: ${err.message}`);
    }
  }

  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
    bindEvents();
    bootRadar();
  }

  init();
})();

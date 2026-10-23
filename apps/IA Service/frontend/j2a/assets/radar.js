(() => {
  'use strict';

  const TOKEN_KEY = 'svc_token_externo';
  const THEME_KEY = 'iaservice_j2a_theme';
  const $ = (id) => document.getElementById(id);
  let retornoPanel = null;
  let detalhesTecnicos = null;
  let chatInterno = null;

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    phone: '',
    challengeId: '',
    tokenEscolha: '',
    whoami: null,
    queueFilter: 'todos',
    queueWaiting: 'todos',
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
    // Guard contra multiplos pollMessages concorrentes para o MESMO
    // atendimentoId (bug real, 2026-10: reabrir o mesmo chamado varias
    // vezes antes da pre-analise anterior terminar criava um novo polling
    // fire-and-forget a cada vez; cada um escrevia em
    // state.chatStatusText/chatStatusAtendimentoId, e o indicador podia
    // ficar "preso" na tela mesmo apos a resposta real ja ter chegado --
    // um F5 limpava porque reiniciava o JS do zero, matando os pollings
    // antigos). Analogo ao preAnalisesEmAndamento do backend
    // (radar-service.js), mas do lado do cliente.
    pollingsAtivos: new Set(),
    // atendimentoIds cuja pesquisa terminou enquanto OUTRO chamado estava na
    // tela -- alimenta o badge "Concluida" da fila ate o analista abrir o
    // chamado (pedido do usuario, 2026-10). So em memoria: F5 limpa.
    concluidosNaoVistos: new Set(),
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
    // cache:'no-store' -- pedido do usuario (ja levantado em sessoes
    // anteriores): o chat da IA nunca pode servir uma resposta antiga do
    // cache HTTP do navegador em vez de buscar o estado real do servidor.
    // Sem isso, mensagens/dossie apagados manualmente (ex. botao "Pesquisas
    // e Dossies da IA" na Base Historica) podiam continuar aparecendo no
    // J2A mesmo numa aba aberta DEPOIS da limpeza, ate um F5 forcar o
    // navegador a ignorar o cache.
    const res = await fetch(path, {
      cache: 'no-store',
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
    // O botao fechado mostra o icone do tema escolhido; as opcoes ficam no menu.
    const escolhido = document.querySelector(`#theme-switch [data-theme-option="${theme}"]`);
    const toggle = $('theme-toggle');
    if (toggle && escolhido) {
      toggle.textContent = escolhido.querySelector('span')?.textContent || toggle.textContent;
      toggle.title = `Tema: ${escolhido.textContent.trim()}`;
    }
    localStorage.setItem(THEME_KEY, theme);
  }

  function setThemeMenu(open) {
    const menu = $('theme-menu');
    const toggle = $('theme-toggle');
    if (!menu || !toggle) return;
    // Dentro do menu da conta as opcoes ficam sempre visiveis.
    if (menu.closest('.account-panel')) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function closeTopbarMenus(except) {
    document.querySelectorAll('.topbar-menu[open]').forEach((menu) => {
      if (menu !== except) menu.open = false;
    });
    if (!except || !except.querySelector('#theme-switch')) setThemeMenu(false);
  }

  function showAccess(message) {
    state.tokenEscolha = '';
    retornoPanel?.clear();
    chatInterno?.stop();
    // Sempre volta ao passo do telefone com os digitos limpos -- antes, depois
    // de Sair a tela reaparecia no passo "Codigo" com o codigo antigo.
    codeInputs().forEach((input) => { input.value = ''; });
    $('code-input').value = '';
    setAccessStep('phone');
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
    // Hora no padrao brasileiro com "h" (05h40 / 17h40): deixa claro que e
    // relogio de 24 horas, sem AM/PM.
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}h${p(d.getMinutes())}`;
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

  function waitingBadge(value, fallback = '') {
    const label = waitingLabel(value) || fallback;
    if (!label) return '';
    const tone = label === 'Aguardando Atendente' ? 'danger'
      : label === 'Aguardando Cliente' ? 'ok'
        : value ? 'warn' : '';
    return `<span class="sla-status waiting-status ${tone}">${escapeHtml(label)}</span>`;
  }

  function slaBadge(value) {
    const label = text(value, '');
    if (!label) return '';
    const cls = label === 'Em atraso' ? 'danger' : label === 'Proxima do vencimento' ? 'warn' : label === 'Em dia' ? 'ok' : '';
    const display = label === 'Proxima do vencimento' ? 'Próximo a vencer' : label;
    return `<span class="sla-status ${cls}">${escapeHtml(display)}</span>`;
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
        state.tokenEscolha = body.tokenEscolha || '';
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
        body: JSON.stringify({ telefone: state.phone, empresaId: btn.dataset.companyId, tokenEscolha: state.tokenEscolha }),
      });
      finishLogin(body.token);
    } catch (err) {
      setAccessStatus(err.message, 'error');
      setBusy(btn, false);
    }
  }

  function finishLogin(token) {
    state.tokenEscolha = '';
    state.token = token || '';
    localStorage.setItem(TOKEN_KEY, state.token);
    bootRadar();
  }

  // Zera todo estado de chat/fila em memoria antes de (re)entrar no Radar --
  // pedido explicito do usuario (ja levantado em sessoes anteriores): login
  // nunca pode herdar nenhum resquicio de uma sessao/chamado anterior nesta
  // mesma aba (ex. trocar de empresa, ou sessao expirar e logar de novo sem
  // dar F5). Mantem so token/preferencias de tema, que sao do dispositivo,
  // nao da sessao.
  function _resetEstadoDoChat() {
    detalhesTecnicos?.close(false);
    $('response-style-select').value = 'ORIGINAL';
    $('response-style-select').disabled = true;
    retornoPanel?.clear();
    state.queue = [];
    state.risk = { consultores: [], chamados: [] };
    state.selected = null;
    state.atendimentoId = null;
    state.messages = [];
    state.localAttachments = [];
    state.softAttachments = [];
    state.pendingFiles = [];
    state.research = null;
    state.dossie = null;
    state.investigations = [];
    state.trilha = [];
    state.trilhaExpandida = new Set();
    state.processing = new Set();
    state.chatStatusText = null;
    state.chatStatusAtendimentoId = null;
    state.avaliacaoMensagemId = null;
    state.atendimentoIdPorChamado = new Map();
    state.pollingsAtivos = new Set();
    state.concluidosNaoVistos = new Set();
    // O estado em memoria nao basta: o DOM do caso anterior continuava
    // visivel apos um novo login na mesma aba (sessao expirada -> login), mesmo
    // com as mensagens ja apagadas no servidor -- so um F5 limpava
    // (reportado em producao, 2026-10).
    $('case-view').hidden = true;
    $('empty-state').hidden = false;
    for (const id of ['messages', 'evidence-content', 'details-content', 'trail-content', 'knowledge-content']) {
      const el = $(id);
      if (el) el.innerHTML = '';
    }
    fecharModalAvaliacao();
  }

  async function bootRadar() {
    if (!state.token) {
      showAccess();
      return;
    }
    _resetEstadoDoChat();
    try {
      state.whoami = await request(ext('/whoami'));
      showRadar();
      $('company-name').textContent = state.whoami.empresaNome || '-';
      $('consultant-name').textContent = state.whoami.consultorNome || 'Consultor';
      const accountCompany = $('account-company-readonly');
      const accountConsultant = $('account-consultant-readonly');
      if (accountCompany) accountCompany.textContent = state.whoami.empresaNome || '-';
      if (accountConsultant) accountConsultant.textContent = state.whoami.consultorNome || 'Consultor';
      $('user-initials').textContent = initials(state.whoami.consultorNome);
      // Presença (Monitor de Acessos) e Chat interno ligam JÁ — antes esperavam
      // a fila e o Radar terminarem de carregar (pode demorar com a
      // atualização do SoftExpert) e o botão Mensagens aparecia atrasado.
      iniciarPresenca();
      chatInterno?.start();
      await Promise.allSettled([loadPreferences(), loadQueue(), loadRisk()]);
      setupAutoRefresh();
      setMobileTarget('queue');
    } catch (err) {
      showAccess(err.message);
    }
  }

  async function loadPreferences() {
    const toggle = $('pre-analysis-toggle');
    const estilo = $('response-style-select');
    const tokenDoPedido = state.token;
    estilo.disabled = true;
    let pref;
    try {
      pref = await request(ext('/radar/minhas-preferencias'));
    } catch (err) {
      // Nunca deixa o toggle "ligado por padrao" fingindo ser a preferencia real.
      toggle.disabled = true;
      toggle.title = 'Nao foi possivel carregar a preferencia de pre-analise.';
      toast(`Nao foi possivel carregar a preferencia de pre-analise: ${err.message}`);
      throw err;
    }
    if (state.token !== tokenDoPedido) return;
    toggle.disabled = false;
    toggle.title = '';
    toggle.checked = pref.preAnaliseAutomatica !== false;
    estilo.value = pref.estiloResposta || 'ORIGINAL';
    estilo.dataset.salvo = estilo.value;
    estilo.disabled = pref.consultorEncontrado === false;
    renderPreferenciaPadrao(pref);
    try {
      const config = await request(ext('/radar/config'));
      if (config?.autoRefreshSegundos != null) $('auto-refresh-select').value = String(config.autoRefreshSegundos);
    } catch (_) {
      // Mantem o valor padrao do <select> (900s) se a config ainda nao existir/falhar.
    }
  }

  // O padrao vem do cadastro da Plataforma; a escolha feita aqui e pessoal e
  // fica guardada a parte (nunca altera o cadastro). Mostra o aviso e o botao
  // "Voltar ao padrao" so quando a escolha pessoal difere do padrao.
  function renderPreferenciaPadrao(pref) {
    const box = $('pre-analysis-padrao');
    if (!box) return;
    const difere = pref && pref.preAnalisePessoal !== null && pref.preAnalisePessoal !== undefined
      && pref.preAnalisePessoal !== (pref.preAnalisePadrao !== false);
    box.hidden = !difere;
    if (difere) {
      $('pre-analysis-padrao-texto').textContent = `Sua escolha. Padrão do cadastro: ${pref.preAnalisePadrao !== false ? 'Automática' : 'Manual'}.`;
    }
  }

  async function savePreferences(valor) {
    // valor: undefined = usa o toggle; null = voltar ao padrao do cadastro.
    const enviar = valor === undefined ? $('pre-analysis-toggle').checked : valor;
    try {
      const pref = await request(ext('/radar/minhas-preferencias'), {
        method: 'PUT',
        body: JSON.stringify({ preAnaliseAutomatica: enviar }),
      });
      $('pre-analysis-toggle').checked = pref.preAnaliseAutomatica !== false;
      renderPreferenciaPadrao(pref);
      toast(enviar === null ? 'Voltou ao padrão do cadastro.' : 'Preferencia salva.');
    } catch (err) {
      toast(`Nao foi possivel salvar: ${err.message}`);
    }
  }

  async function saveResponseStyle() {
    const seletor = $('response-style-select');
    const tokenDoPedido = state.token;
    seletor.disabled = true;
    try {
      const pref = await request(ext('/radar/minhas-preferencias'), {
        method: 'PUT', body: JSON.stringify({ estiloResposta: seletor.value }),
      });
      if (state.token !== tokenDoPedido) return;
      seletor.value = pref.estiloResposta || 'ORIGINAL';
      seletor.dataset.salvo = seletor.value;
      toast('Estilo salvo para as próximas respostas.');
    } catch (err) {
      if (state.token !== tokenDoPedido) return;
      seletor.value = seletor.dataset.salvo || 'ORIGINAL';
      toast(`Não foi possível salvar o estilo: ${err.message}`);
    } finally {
      if (state.token === tokenDoPedido) seletor.disabled = false;
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

  async function loadQueue({ forceSync = false, silencioso = false } = {}) {
    if (!silencioso) $('queue-list').innerHTML = '<div class="empty-block">Carregando fila...</div>';
    const params = new URLSearchParams({ filtro_sla: state.queueFilter });
    if (forceSync) params.set('force_sync', 'true');
    try {
      const body = await request(ext(`/radar/fila?${params.toString()}`));
      state.queue = body.chamados || [];
      updateQueueWaitingOptions();
      renderQueue();
      posSincronizacaoFila(body.sincronizacao);
    } catch (err) {
      $('queue-list').innerHTML = `<div class="empty-block">Nao foi possivel carregar a fila: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Refresh sincroniza em segundo plano: a fila aparece na hora e esta rotina
  // consulta de novo (sem forcar) ate terminar, entao o analista ve fila,
  // cabecalho e mensagens atualizados sem clicar outra vez. Parcial e sinalizado.
  let pollSyncTimer = null;
  let pollSyncTentativas = 0;
  let ultimoProgressoAplicado = null;
  function posSincronizacaoFila(sinc) {
    if (pollSyncTimer) { clearTimeout(pollSyncTimer); pollSyncTimer = null; }
    if (sinc?.status === 'em_andamento') {
      if (pollSyncTentativas === 0) toast('Atualizando chamados a partir do SoftExpert...');
      // Etapa prioritaria concluida: tela e chat aberto ja refletem os dados novos.
      if (sinc.progresso?.etapa === 'tela_atualizada' && sinc.progresso.em !== ultimoProgressoAplicado) {
        ultimoProgressoAplicado = sinc.progresso.em;
        if (state.selected) {
          const atualizado = state.queue.find((c) => c.id === state.selected.id);
          if (atualizado) state.selected = atualizado;
          if (!state.processing.has(state.atendimentoId)) sincronizarChatAtivo();
        }
      }
      if (pollSyncTentativas < 60) {
        pollSyncTentativas++;
        pollSyncTimer = setTimeout(() => loadQueue({ silencioso: true }), 1500);
      } else {
        pollSyncTentativas = 0;
        toast('A atualizacao esta demorando; use o botao de atualizar novamente.');
      }
      return;
    }
    const veioDeSync = pollSyncTentativas > 0 || sinc?.status === 'concluido';
    pollSyncTentativas = 0;
    const res = sinc?.resultado;
    if (!veioDeSync || !res) return;
    if (res.motivosParcial?.length) console.warn('[Refresh] atualizacao parcial/falha — motivos:', res.motivosParcial);
    if (res.falhou) toast('Nao foi possivel atualizar agora; os dados exibidos podem estar desatualizados.');
    else if (res.sucesso === true) toast('Fila atualizada.');
    else toast('Atualizacao parcial: alguns chamados nao puderam ser atualizados agora.');
    if (state.selected) {
      const atualizado = state.queue.find((c) => c.id === state.selected.id);
      if (atualizado) state.selected = atualizado;
      if (!state.processing.has(state.atendimentoId)) sincronizarChatAtivo();
    }
  }

  // Estado dos botoes Enviar/Pesquisar e POR CHAMADO: so ficam ocupados se o
  // atendimento que esta na tela esta em state.processing. Antes, setBusy
  // mexia no botao global e o spinner de um chamado vazava para o outro,
  // bloqueando pesquisas paralelas em chamados diferentes.
  // Chamado encerrado: consulta apenas — sem enviar mensagem, anexar nem pesquisar
  // (o backend tambem recusa: 409 CHAMADO_ENCERRADO).
  function aplicarModoSomenteLeitura() {
    const ro = !!state.somenteLeitura;
    ['message-input', 'file-input', 'send-btn'].forEach((id) => { const el = $(id); if (el) el.disabled = ro; });
    const composer = $('composer');
    if (composer) composer.classList.toggle('somente-leitura', ro);
    const msg = $('message-input');
    if (msg) msg.placeholder = ro ? 'Chamado encerrado: somente consulta.' : 'Digite sua mensagem para a IA Service...';
    const pesquisar = $('research-btn');
    if (pesquisar) { pesquisar.disabled = ro || pesquisar.disabled; pesquisar.title = ro ? 'Chamado encerrado: pesquisa indisponivel' : 'Pesquisar Soluções'; }
    const aviso = $('case-readonly-banner');
    if (aviso) aviso.hidden = !ro;
  }

  // Trilho da fila recolhida: mostra o numero do chamado aberto (clicavel para reabrir).
  function atualizarRotuloFila(ticket) {
    const el = $('queue-rail-label');
    if (el) el.textContent = ticket?.numero ? `#${ticket.numero} · Fila` : 'Fila de chamados';
  }

  function syncBotoesAcao() {
    const ocupado = !!state.atendimentoId && state.processing.has(state.atendimentoId);
    setBusy($('research-btn'), ocupado);
    setBusy($('send-btn'), ocupado, 'Enviando');
    if (state.somenteLeitura) aplicarModoSomenteLeitura();
  }

  function queueWaitingLabel(chamado) {
    return waitingLabel(chamado.aguardandoConsolidado || chamado.situacaoRetorno) || 'Aguardando não informado';
  }

  function updateQueueWaitingOptions() {
    const options = [...new Set(state.queue.map(queueWaitingLabel))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (state.queueWaiting !== 'todos' && !options.includes(state.queueWaiting)) {
      state.queueWaiting = 'todos';
    }
    $('queue-waiting-filter').innerHTML = '<option value="todos">Todos</option>'
      + options.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('');
    $('queue-waiting-filter').value = state.queueWaiting;
  }

  function renderQueue() {
    syncBotoesAcao();
    $('queue-waiting-control').classList.toggle('active', state.queueWaiting !== 'todos');
    const term = $('queue-search').value.trim().toLowerCase();
    const filtered = state.queue.filter((c) => {
      if (state.queueWaiting !== 'todos' && queueWaitingLabel(c) !== state.queueWaiting) return false;
      if (!term) return true;
      return [c.numero, c.clienteNome, c.solicitanteNome, c.produto, currentTicketTitle(c)]
        .some((v) => String(v || '').toLowerCase().includes(term));
    });
    $('queue-count').textContent = `${filtered.length} chamado(s)`;
    if (!filtered.length) {
      $('queue-list').innerHTML = '<div class="empty-block">Nenhum chamado encontrado para este filtro.</div>';
      return;
    }
    $('queue-list').innerHTML = filtered.map((c) => `
      <button class="ticket ${state.selected?.id === c.id ? 'active' : ''}" data-ticket-id="${escapeHtml(c.id)}">
        <span class="ticket-top">
          <span class="ticket-number">#${escapeHtml(c.numero)}</span>
          ${pesquisaBadge(c.id)}
          <span class="ticket-statuses">
            ${waitingBadge(c.aguardandoConsolidado || c.situacaoRetorno, 'Aguardando não informado')}
            ${slaBadge(c.slaPrazo)}
          </span>
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
  // sendMessage/researchSolutions). Quando a pesquisa termina com outro
  // chamado na tela, mostra "Concluida" ate o analista abrir o chamado
  // (state.concluidosNaoVistos).
  function pesquisaBadge(chamadoId) {
    const atendimentoId = state.atendimentoIdPorChamado.get(String(chamadoId));
    if (!atendimentoId) return '';
    if (state.processing.has(atendimentoId)) return '<span class="badge warn pulsing">Pesquisando…</span>';
    if (state.concluidosNaoVistos.has(atendimentoId)) return '<span class="badge ok">Concluída</span>';
    return '';
  }

  // Chamado cuja pesquisa terminou fora da tela vira "Concluida" na fila ate
  // ser aberto; se ja esta na tela, o analista ve a resposta e nao precisa de sinal.
  function marcarConcluidoSeNaoVisivel(atendimentoId) {
    if (!atendimentoId || atendimentoId === state.atendimentoId) return;
    state.concluidosNaoVistos.add(atendimentoId);
  }

  async function selectTicket(id) {
    const ticket = state.queue.find((c) => String(c.id) === String(id))
      || state.risk.chamados.find((c) => String(c.id) === String(id))
      || state.relatedById?.get(String(id));
    if (!ticket) return;
    state.somenteLeitura = ticket.statusEncerramento === 'Encerrado';
    aplicarModoSomenteLeitura();
    atualizarRotuloFila(ticket);
    const atendimentoConhecido = state.atendimentoIdPorChamado.get(String(ticket.id));
    if (atendimentoConhecido) state.concluidosNaoVistos.delete(atendimentoConhecido);
    state.selected = ticket;
    detalhesTecnicos?.close(false);
    retornoPanel?.contextChanged();
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
      if (open.chamado) {
        // Chamado aberto fora da fila (ex.: Base de Conhecimento): completa nomes/prazos.
        state.selected = { ...ticket, ...open.chamado };
        state.somenteLeitura = open.somenteLeitura === true || state.selected.statusEncerramento === 'Encerrado';
        aplicarModoSomenteLeitura();
        renderCaseShell();
      }
      state.atendimentoIdPorChamado.set(String(ticket.id), open.atendimentoId);
      state.concluidosNaoVistos.delete(open.atendimentoId);
      syncBotoesAcao();
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

  function renderCaseShell() {
    $('empty-state').hidden = true;
    $('case-view').hidden = false;
    const c = state.selected;
    $('case-title').textContent = currentTicketTitle(c);
    $('case-number').textContent = `#${c.numero || '-'}`;
    $('case-badges').innerHTML = [
      waitingBadge(c.aguardandoConsolidado || c.situacaoRetorno),
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
    const base = 'Atendente';
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
    return state.localAttachments.filter((a) => [a.mensagemId, a.mensagemOrigemId].some(id => id != null && String(id) === String(m.id)));
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
    // Etapas do turno (andamento da pesquisa/análise), quando o backend já informou.
    const etapas = state.chatStatusAtendimentoId === state.atendimentoId ? (state.chatStatusEtapas || []) : [];
    if (etapas.length) {
      row.querySelector('.message-card').insertAdjacentHTML('beforeend', `<div class="chat-status-etapas">${etapas.map((e) => `<div class="chat-status-etapa${e.concluida ? ' ok' : ''}">${e.concluida ? '✓' : '⏳'} ${escapeHtml(e.texto)}</div>`).join('')}</div>`);
    }
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
  function showChatStatus(texto, atendimentoId = state.atendimentoId, etapas = null) {
    state.chatStatusText = texto || 'Processando...';
    state.chatStatusAtendimentoId = atendimentoId;
    state.chatStatusEtapas = etapas;
    // Atualização de etapas só rola o chat se o analista já estava no fim dele.
    if (atendimentoId === state.atendimentoId) appendChatStatusRow(state.chatStatusText, etapas ? _estaPertoDoFim($('messages')) : true);
  }

  // Consulta o andamento do turno a cada 1,5 s e mostra as etapas na mensagem
  // de status. Sem progresso (backend antigo/reiniciado), fica o texto genérico.
  function acompanharProgresso(atendimentoId, texto) {
    let ativo = true;
    let ultimo = '';
    const timer = setInterval(async () => {
      try {
        const p = await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/progresso`));
        const etapas = Array.isArray(p?.etapas) ? p.etapas : [];
        const assinatura = JSON.stringify(etapas);
        if (ativo && etapas.length && assinatura !== ultimo && state.chatStatusAtendimentoId === atendimentoId) {
          ultimo = assinatura;
          showChatStatus(texto, atendimentoId, etapas);
        }
      } catch (_) { /* sem progresso: mantém o texto genérico */ }
    }, 1500);
    return () => { ativo = false; clearInterval(timer); };
  }

  function hideChatStatus(atendimentoId = state.atendimentoId) {
    if (atendimentoId !== state.chatStatusAtendimentoId) return; // nao esconde status de OUTRO atendimento
    state.chatStatusText = null;
    state.chatStatusAtendimentoId = null;
    state.chatStatusEtapas = null;
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
          <a class="message-attachment" href="${escapeHtml(ext(`/anexos/${encodeURIComponent(a.id)}/download`))}" data-download-name="${escapeHtml(a.nome || a.nomeOriginal || 'Anexo')}">📎 ${escapeHtml(a.nome || a.nomeOriginal || 'Anexo')}${a.anexoOriginalId ? ' — Correção proposta: validar antes de usar' : ''}</a>
        `).join('')}</div>
      ` : '';
      // Avisos de fonte corrigido vêm do servidor (persistidos na mensagem),
      // independentes da redação humanizada.
      const avisosFonte = assistant && Array.isArray(m.avisosFonteCorrigido) ? m.avisosFonteCorrigido : [];
      const avisosFonteHtml = avisosFonte.length
        ? `<div class="message-source-warnings" role="note">${avisosFonte.map((a) => `<p>⚠️ ${escapeHtml(a)}</p>`).join('')}</div>` : '';
      const avaliacaoHtml = assistant ? renderizarAvaliacaoHumana(m) : '';
      // Avaliação à esquerda e Detalhes Técnicos à direita, na mesma faixa.
      const detalhesHtml = window.IaDetalhesTecnicos.botao(m, 'detalhes-tecnicos-link');
      const acoesHtml = avaliacaoHtml || detalhesHtml ? `<div class="message-acoes">${avaliacaoHtml}${detalhesHtml}</div>` : '';
      // Setinha de opções sempre visível (padrão do chat do IA Command).
      const menuAberto = m.id && state.menuMensagemId === String(m.id);
      const menuHtml = m.id
        ? `<button type="button" class="message-menu-trigger${menuAberto ? ' open' : ''}" data-menu-msg="${escapeHtml(m.id)}" title="Opções da mensagem" aria-label="Opções da mensagem" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`
        : '';
      return `
        <article class="message message-${side} ${assistant ? 'assistant' : ''}">
          <div class="message-avatar">${escapeHtml(messageAvatar(m))}</div>
          <div class="message-card${menuHtml ? ' com-menu' : ''}">
            ${menuHtml}
            <div class="message-head"><strong>${escapeHtml(messageRole(m))}</strong><span>${escapeHtml(formatDateTime(messageTimestamp(m)))}</span></div>
            <div class="message-text">${escapeHtml(messageText(m))}</div>
            ${attachmentsHtml}
            ${avisosFonteHtml}
            ${acoesHtml}
          </div>
        </article>
      `;
    }).join('');
    if (statusPertenceAoAtual) appendChatStatusRow(state.chatStatusText, pertoDoFim);
    if (pertoDoFim) container.scrollTop = container.scrollHeight;
    // Re-render (polling) com o menu aberto: mensagem sumiu => fecha o menu.
    if (state.menuMensagemId && !container.querySelector(`[data-menu-msg="${CSS.escape(state.menuMensagemId)}"]`)) fecharMenuMensagem();
  }

  // Menu de opções da mensagem (setinha estilo WhatsApp). Um único menu
  // flutuante, criado sob demanda; por enquanto só "Copiar mensagem".
  function menuMensagemEl() {
    let menu = $('message-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'message-context-menu';
    menu.className = 'message-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <button type="button" class="message-context-item" role="menuitem" data-menu-action="copiar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
        <span>Copiar mensagem</span>
      </button>`;
    menu.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-menu-action]');
      if (!item) return;
      const mensagem = state.messages.find((m) => String(m.id) === state.menuMensagemId);
      fecharMenuMensagem();
      if (item.dataset.menuAction === 'copiar' && mensagem) {
        toast(await copiarTextoMensagem(messageText(mensagem)) ? 'Mensagem copiada.' : 'Não foi possível copiar a mensagem.');
      }
    });
    document.body.appendChild(menu);
    return menu;
  }

  function abrirMenuMensagem(trigger) {
    const id = trigger?.dataset.menuMsg;
    if (!id) return;
    if (state.menuMensagemId === id) { fecharMenuMensagem(); return; }
    fecharMenuMensagem();
    const menu = menuMensagemEl();
    state.menuMensagemId = id;
    trigger.classList.add('open');
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margem = 8;
    menu.style.left = `${Math.min(window.innerWidth - menuRect.width - margem, Math.max(margem, rect.right - menuRect.width))}px`;
    menu.style.top = `${Math.min(window.innerHeight - menuRect.height - margem, Math.max(margem, rect.bottom + 4))}px`;
    menu.querySelector('.message-context-item')?.focus();
  }

  function fecharMenuMensagem() {
    if (!state.menuMensagemId) return;
    state.menuMensagemId = null;
    const menu = $('message-context-menu');
    if (menu) { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); }
    document.querySelectorAll('.message-menu-trigger.open').forEach((b) => b.classList.remove('open'));
  }

  // Em HTTP (sem contexto seguro) navigator.clipboard não existe: cai para
  // textarea + execCommand, mesmo recurso dos Detalhes Técnicos.
  async function copiarTextoMensagem(texto) {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
    } catch (_) { /* tenta o fallback */ }
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }

  // Avaliacao humana de utilidade tecnica real (consultor), independente do
  // Quality Gate -- nunca altera o motor. Mostra resumo compacto se o
  // consultor logado ja avaliou; senao, link discreto para abrir o modal.
  // Porta a mesma logica/UX de atendimento.html (renderizarAvaliacaoHumana),
  // adaptada ao estilo "full re-render a partir do estado" do J2A.
  function renderizarAvaliacaoHumana(m) {
    // Nunca oferece "Avaliar investigação" numa resposta que o proprio
    // Quality Gate ja marcou como bloqueada para revisao (pedido explicito
    // do usuario, 2026-10) -- o backend tambem rejeita a gravacao
    // (avaliacao-investigacao-service.js), isto aqui e so para nao mostrar
    // um botao que levaria a um erro.
    if (m.respostaOperacional?.qualityGateBloqueado) return '';
    const avaliacaoHumana = m.respostaOperacional?.avaliacaoHumana;
    const minha = avaliacaoHumana?.minhaAvaliacaoAtual || null;
    // Resposta que nao veio de uma pesquisa da IA (atalho curto, erro de
    // provider): nao oferece avaliar; mantem o resumo se ja avaliada antes.
    if (m.respostaOperacional?.avaliavel === false && !minha) return '';
    const outras = (avaliacaoHumana?.todasAsAvaliacoesAtuais || []).filter(
      (a) => !minha || String(a.usuarioId) !== String(minha.usuarioId),
    );
    const resumoMinha = minha
      ? `<span class="avaliacao-resumo">Sua avaliação: ${minha.notaTotal}/25 · ${escapeHtml(faixaDeNotaTotal(minha.notaTotal))}</span>
         <button type="button" class="avaliacao-link" data-avaliacao-abrir="${escapeHtml(m.id)}">editar</button>`
      : `<button type="button" class="avaliacao-link" data-avaliacao-abrir="${escapeHtml(m.id)}">Avaliar Pesquisa da IA</button>`;
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

  // Campo de mensagem cresce com o texto (como no WhatsApp) ate o max-height
  // do CSS; acima disso passa a rolar por dentro.
  function ajustarAlturaMensagem() {
    const t = $('message-input');
    if (!t) return;
    const max = parseFloat(getComputedStyle(t).maxHeight) || 200;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, max)}px`;
    t.style.overflowY = t.scrollHeight > max ? 'auto' : 'hidden';
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.somenteLeitura) return;
    if (!state.atendimentoId || state.processing.has(state.atendimentoId)) return;
    const textarea = $('message-input');
    const texto = textarea.value.trim();
    if (!texto && !state.pendingFiles.length) return;
    const atendimentoId = state.atendimentoId;
    state.processing.add(atendimentoId);
    renderQueue();
    showChatStatus('Pesquisando e analisando o chamado com a IA...', atendimentoId);
    const pararProgresso = acompanharProgresso(atendimentoId, 'Pesquisando e analisando o chamado com a IA...');
    let concluiu = false;
    try {
      const anexoIds = await uploadPendingFiles(atendimentoId);
      const body = await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/investigar`), {
        method: 'POST',
        body: JSON.stringify({ texto: texto || 'Analise os anexos enviados.', anexoIds, anexosComoContexto: anexoIds.length > 0, origemAcao: 'texto_livre' }),
      });
      textarea.value = '';
      ajustarAlturaMensagem();
      state.pendingFiles = [];
      renderPendingFiles();
      state.messages.push(body);
      state.trilhaExpandida = new Set();
      await Promise.allSettled([loadMessages(), loadLocalAttachments(), loadDossier(), loadInvestigations(), loadTrilha()]);
      renderAllCaseData();
      concluiu = true;
    } catch (err) {
      toast(`Nao foi possivel enviar: ${err.message}`);
    } finally {
      pararProgresso();
      state.processing.delete(atendimentoId);
      if (concluiu) marcarConcluidoSeNaoVisivel(atendimentoId);
      renderQueue();
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
    if (state.somenteLeitura) return;
    if (!state.atendimentoId || !state.selected || state.processing.has(state.atendimentoId)) return;
    const atendimentoId = state.atendimentoId;
    state.processing.add(atendimentoId);
    renderQueue();
    showChatStatus('Pesquisando no histórico completo do chamado...', atendimentoId);
    const pararProgresso = acompanharProgresso(atendimentoId, 'Pesquisando no histórico completo do chamado...');
    let concluiu = false;
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
          origemAcao: 'botao_pesquisar',
        }),
      });
      state.trilhaExpandida = new Set();
      await Promise.allSettled([loadMessages(), loadResearch(state.selected.id), loadDossier(), loadInvestigations(), loadTrilha()]);
      renderAllCaseData();
      concluiu = true;
    } catch (err) {
      toast(`Nao foi possivel pesquisar solucoes: ${err.message}`);
    } finally {
      pararProgresso();
      state.processing.delete(atendimentoId);
      if (concluiu) marcarConcluidoSeNaoVisivel(atendimentoId);
      renderQueue();
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
    // Nunca inicia um 2o polling para o mesmo atendimentoId (ver comentario
    // de state.pollingsAtivos) -- reabrir o mesmo chamado repetidas vezes
    // antes da pre-analise anterior terminar nao deve empilhar pollings.
    if (state.pollingsAtivos.has(atendimentoId)) return;
    state.pollingsAtivos.add(atendimentoId);
    const aindaVisivel = () => atendimentoId === state.atendimentoId;
    if (statusTexto) showChatStatus(statusTexto, atendimentoId); // showChatStatus ja so exibe na tela se aindaVisivel() -- nao precisa checar aqui tambem
    state.processing.add(atendimentoId);
    renderQueue();
    let chegouResposta = false;
    try {
      for (let i = 0; i < times; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const temMensagemNova = await _verificarMensagemNova(atendimentoId, aindaVisivel());
        if (temMensagemNova) { chegouResposta = true; break; }
      }
    } finally {
      state.pollingsAtivos.delete(atendimentoId);
      state.processing.delete(atendimentoId);
      if (chegouResposta) marcarConcluidoSeNaoVisivel(atendimentoId);
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
    if (evento.tipo === 'resposta_tecnica_original' || evento.tipo === 'resposta_ajustada') {
      const meta = evento.tipo === 'resposta_ajustada'
        ? `<div class="summary-item"><span>Estilo / status</span><strong>${escapeHtml(d.estilo || '-')} · ${escapeHtml(d.statusHumanizacao || '-')}</strong></div>
           <div class="summary-item"><span>Provider / modelo</span><strong>${escapeHtml(d.provider || '-')}${d.model ? ` · ${escapeHtml(d.model)}` : ''}</strong></div>
           ${d.motivo ? `<div class="summary-item"><span>Motivo</span><strong>${escapeHtml(d.motivo)}</strong></div>` : ''}
           <div class="summary-item"><span>Tokens adicionais (entrada / saída / total)</span><strong>${d.consumoAdicional?.entrada ?? '-'} / ${d.consumoAdicional?.saida ?? '-'} / ${d.consumoAdicional?.total ?? '-'}</strong></div>` : '';
      const rejeicoes = (d.validacaoPreservacao?.falhas || []).map(f =>
        `<div class="knowledge-card"><h3>${escapeHtml(f.codigo)}</h3><p>${escapeHtml(f.detalhe || '')}</p><pre class="trail-response-text">${escapeHtml((f.informacoes || []).join('\n'))}</pre></div>`).join('');
      const candidata = d.respostaCandidata && d.validacaoPreservacao?.aprovado === false
        ? `<details><summary>Candidata rejeitada — não entregue ao analista</summary><pre class="trail-response-text">${escapeHtml(d.respostaCandidata)}</pre></details>` : '';
      return meta + rejeicoes + candidata + `<div class="knowledge-card"><pre class="trail-response-text">${escapeHtml(d.conteudo || '')}</pre></div>`;
    }
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
      const c = d.proveniencia?.contagem;
      const proveniencia = c
        ? `<div class="summary-item"><span>Proveniência das referências técnicas</span><strong>no chamado: ${c.chamado || 0} · pesquisa: ${c.pesquisa || 0} · conhecimento do modelo (hipótese/orientação): ${c.conhecimento_modelo || 0}${d.proveniencia.atribuicoesFalsas ? ` · atribuições indevidas ao caso: ${d.proveniencia.atribuicoesFalsas}` : ''}</strong></div>`
        : '';
      return falhas + retry + recuperacao + revisao + proveniencia || '<div class="empty-block">Nenhum ponto de atenção identificado.</div>';
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
            <span class="trail-execution-title">${execucao.origem === 'conversa' ? 'Conversa com a IA' : `Execução investigativa #${state.trilha.length - idx}`} — ${escapeHtml(formatDateTime(execucao.criadoEm))}</span>
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
    state.relatedById = new Map(internal.map((r) => r.chamado || r).filter((c) => c?.id).map((c) => [String(c.id), c]));
    content.innerHTML = internal.map((r) => {
      const c = r.chamado || r;
      const encerrado = c.statusEncerramento === 'Encerrado';
      return `<div class="knowledge-card knowledge-card-link" data-related-id="${escapeHtml(c.id || '')}" role="button" tabindex="0" title="Abrir mensagens do chamado"><h3>#${escapeHtml(c.numero || '')} ${escapeHtml(currentTicketTitle(c))}${encerrado ? ' <span class="badge">Encerrado</span>' : ''}</h3><p>${escapeHtml(c.descricao || c.breveDescricao || '')}</p><div class="case-badges"><span class="badge">score ${escapeHtml(r.score ?? '-')}</span>${r.temSolucaoAplicada ? '<span class="badge ok">Possui solução</span>' : ''}</div></div>`;
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

  async function loadRisk({ forceSync = false } = {}) {
    const params = new URLSearchParams({ filtro: state.riskFilter });
    if (forceSync) params.set('force_sync', 'true');
    try {
      const body = await request(ext(`/radar/risco-sla?${params.toString()}`));
      state.risk = { consultores: body.consultores || [], chamados: body.chamados || [] };
      renderRisk();
    } catch (err) {
      $('risk-grid').innerHTML = `<div class="empty-block">Nao foi possivel carregar o Radar de Chamados: ${escapeHtml(err.message)}</div>`;
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
    const cols = visibleRiskColumns();
    const header = cols.map((col) => {
      const drag = col.fixed ? '' : ' draggable="true"';
      return `<th data-col-id="${col.id}"${drag}${riskColumnStyle(col.id)}>${escapeHtml(col.title)}<span class="col-resizer" title="Arraste para ajustar a largura (duplo clique volta ao automático)"></span></th>`;
    }).join('');
    const consultantOf = (c) => c.tecnicoResponsavelNome || 'Sem consultor';
    const groupCount = new Map();
    for (const c of filtered) groupCount.set(consultantOf(c), (groupCount.get(consultantOf(c)) || 0) + 1);
    let lastConsultant = '';
    const rows = [];
    for (const c of filtered) {
      const consultant = consultantOf(c);
      const collapsed = riskCollapsedGroups.has(consultant);
      if (consultant !== lastConsultant) {
        rows.push(`<tr class="group-row${collapsed ? ' collapsed' : ''}"><td colspan="${cols.length}"><button type="button" class="group-toggle" data-group-toggle="${escapeHtml(consultant)}" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? 'Expandir' : 'Recolher'} chamados de ${escapeHtml(consultant)}"><span class="group-sign" aria-hidden="true"></span>${escapeHtml(consultant)} <small>(${groupCount.get(consultant)})</small></button></td></tr>`);
        lastConsultant = consultant;
      }
      if (collapsed) continue;
      rows.push(`<tr>${cols.map((col) => `<td${riskColumnStyle(col.id)}>${col.render(c)}</td>`).join('')}</tr>`);
    }
    $('risk-grid').innerHTML = `<table class="risk-table"><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    const allCollapsed = groupCount.size > 0 && [...groupCount.keys()].every((g) => riskCollapsedGroups.has(g));
    const toggleAll = $('risk-groups-toggle');
    if (toggleAll) {
      toggleAll.textContent = allCollapsed ? '⊞ Expandir todos' : '⊟ Recolher todos';
      toggleAll.dataset.action = allCollapsed ? 'expand' : 'collapse';
      toggleAll.hidden = groupCount.size === 0;
    }
  }

  // Grupos (consultores) recolhidos no Radar de Chamados. Fica so no
  // navegador, como a organizacao das colunas.
  const RISK_GROUPS_KEY = 'iaservice.radarGruposRecolhidos';
  let riskCollapsedGroups = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RISK_GROUPS_KEY) || '[]');
      return new Set(Array.isArray(saved) ? saved.filter((g) => typeof g === 'string') : []);
    } catch (_) { return new Set(); }
  })();

  function saveRiskCollapsedGroups() {
    try { localStorage.setItem(RISK_GROUPS_KEY, JSON.stringify([...riskCollapsedGroups])); } catch (_) { /* opcional */ }
  }

  function toggleRiskGroup(name) {
    if (riskCollapsedGroups.has(name)) riskCollapsedGroups.delete(name); else riskCollapsedGroups.add(name);
    saveRiskCollapsedGroups();
    renderRisk();
    $('risk-grid').querySelector(`[data-group-toggle="${CSS.escape(name)}"]`)?.focus();
  }

  function toggleAllRiskGroups(action) {
    const visible = [...new Set([...$('risk-grid').querySelectorAll('[data-group-toggle]')].map((b) => b.dataset.groupToggle))];
    visible.forEach((g) => (action === 'expand' ? riskCollapsedGroups.delete(g) : riskCollapsedGroups.add(g)));
    saveRiskCollapsedGroups();
    renderRisk();
  }

  // Colunas do Radar de Chamados. A ordem desta lista e o padrao; cada usuario
  // pode reordenar, esconder e ajustar largura. A preferencia fica so no
  // navegador (localStorage) e e saneada na leitura: ids que deixaram de existir
  // sao ignorados e colunas novas entram no fim, visiveis.
  const RISK_COLUMNS_KEY = 'iaservice.radarColunas';
  const RISK_COLUMN_MIN_WIDTH = 60;
  const RISK_COLUMN_MAX_WIDTH = 800;
  const RISK_COLUMNS = [
    { id: 'chamado', title: 'Chamado', fixed: true, render: (c) => `<button data-ticket-id="${escapeHtml(c.id)}">#${escapeHtml(c.numero || '-')}</button>` },
    { id: 'status', title: 'Status', render: (c) => slaBadge(c.slaPrazo) },
    { id: 'aguardando', title: 'Aguardando retorno', render: (c) => escapeHtml(waitingLabel(c.aguardandoConsolidado || c.situacaoRetorno) || '-') },
    { id: 'titulo', title: 'Título', render: (c) => escapeHtml(currentTicketTitle(c)) },
    { id: 'cliente', title: 'Cliente', render: (c) => escapeHtml(c.clienteNome || '-') },
    { id: 'usuario', title: 'Usuário', render: (c) => escapeHtml(c.solicitanteNome || '-') },
    { id: 'previsao', title: 'Previsão conclusão', render: (c) => escapeHtml(c.slaDataPrevFim ? formatDateTime(c.slaDataPrevFim) : '-') },
    { id: 'duracao', title: 'Duração', render: (c) => escapeHtml(formatDays(c.diasDur)) },
    { id: 'horasDuracao', title: 'Horas duração', render: (c) => escapeHtml(formatHours(c.hrDur)) },
    { id: 'diasSuporte', title: 'Dias suporte', render: (c) => escapeHtml(formatDays(c.diasDurSup)) },
    { id: 'diasDesenv', title: 'Dias desenv.', render: (c) => escapeHtml(formatDays(c.diasDurFsw)) },
    { id: 'diasDistrib', title: 'Dias distrib.', render: (c) => escapeHtml(formatDays(c.diasDurDist)) },
    { id: 'diasCliente', title: 'Dias cliente', render: (c) => escapeHtml(formatDays(c.diasDurCli)) },
    { id: 'diasTecnCliente', title: 'Dias tecn. cliente', render: (c) => escapeHtml(formatDays(c.diasDurTicli)) },
    { id: 'ultimo', title: 'Último', render: (c) => escapeHtml(formatDate(c.ultimoPosicionamentoEm)) },
  ];
  const RISK_COLUMNS_BY_ID = new Map(RISK_COLUMNS.map((col) => [col.id, col]));
  let riskColumnsPref = loadRiskColumnsPref();
  let riskResizing = false;

  function sanitizeRiskColumnsPref(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const order = (Array.isArray(src.order) ? src.order : []).filter((id, i, arr) => RISK_COLUMNS_BY_ID.has(id) && arr.indexOf(id) === i);
    for (const col of RISK_COLUMNS) if (!order.includes(col.id)) order.push(col.id);
    // Colunas fixas (Chamado) sempre primeiro e sempre visiveis.
    const fixed = RISK_COLUMNS.filter((col) => col.fixed).map((col) => col.id);
    const finalOrder = [...fixed, ...order.filter((id) => !fixed.includes(id))];
    const hidden = (Array.isArray(src.hidden) ? src.hidden : []).filter((id) => RISK_COLUMNS_BY_ID.has(id) && !fixed.includes(id));
    const widths = {};
    for (const [id, w] of Object.entries(src.widths && typeof src.widths === 'object' ? src.widths : {})) {
      const n = Math.round(Number(w));
      if (RISK_COLUMNS_BY_ID.has(id) && Number.isFinite(n)) widths[id] = Math.min(RISK_COLUMN_MAX_WIDTH, Math.max(RISK_COLUMN_MIN_WIDTH, n));
    }
    return { order: finalOrder, hidden: [...new Set(hidden)], widths };
  }

  function loadRiskColumnsPref() {
    try {
      return sanitizeRiskColumnsPref(JSON.parse(localStorage.getItem(RISK_COLUMNS_KEY) || 'null'));
    } catch (_) {
      return sanitizeRiskColumnsPref(null);
    }
  }

  function saveRiskColumnsPref() {
    riskColumnsPref = sanitizeRiskColumnsPref(riskColumnsPref);
    try { localStorage.setItem(RISK_COLUMNS_KEY, JSON.stringify(riskColumnsPref)); } catch (_) { /* opcional */ }
  }

  function visibleRiskColumns() {
    return riskColumnsPref.order.filter((id) => !riskColumnsPref.hidden.includes(id)).map((id) => RISK_COLUMNS_BY_ID.get(id));
  }

  function riskColumnStyle(id) {
    const w = riskColumnsPref.widths[id];
    return w ? ` style="width:${w}px;min-width:${w}px;max-width:${w}px"` : '';
  }

  function moveRiskColumn(id, targetId, after) {
    if (!id || id === targetId || RISK_COLUMNS_BY_ID.get(id)?.fixed) return;
    const order = riskColumnsPref.order.filter((x) => x !== id);
    let idx = order.indexOf(targetId);
    if (idx < 0) return;
    if (after) idx += 1;
    order.splice(idx, 0, id);
    riskColumnsPref.order = order;
    saveRiskColumnsPref();
    renderRisk();
    renderRiskColumnsMenu();
  }

  function renderRiskColumnsMenu() {
    const list = $('risk-columns-list');
    if (!list) return;
    const movable = riskColumnsPref.order.filter((id) => !RISK_COLUMNS_BY_ID.get(id).fixed);
    list.innerHTML = riskColumnsPref.order.map((id) => {
      const col = RISK_COLUMNS_BY_ID.get(id);
      const pos = movable.indexOf(id);
      const checked = riskColumnsPref.hidden.includes(id) ? '' : ' checked';
      const lock = col.fixed ? ' disabled title="Coluna fixa"' : '';
      const upOff = col.fixed || pos <= 0 ? ' disabled' : '';
      const downOff = col.fixed || pos === movable.length - 1 ? ' disabled' : '';
      return `<li class="risk-columns-item">
        <label><input type="checkbox" data-col-toggle="${id}"${checked}${lock}> ${escapeHtml(col.title)}</label>
        <span class="risk-columns-move">
          <button type="button" data-col-move="${id}" data-dir="-1" aria-label="Mover ${escapeHtml(col.title)} para a esquerda"${upOff}>↑</button>
          <button type="button" data-col-move="${id}" data-dir="1" aria-label="Mover ${escapeHtml(col.title)} para a direita"${downOff}>↓</button>
        </span>
      </li>`;
    }).join('');
  }

  function bindRiskColumns() {
    const grid = $('risk-grid');
    const menu = $('risk-columns-menu');
    const clearDrop = () => grid.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const dropAfter = (th, event) => {
      const rect = th.getBoundingClientRect();
      return event.clientX > rect.left + rect.width / 2;
    };

    grid.addEventListener('dragstart', (event) => {
      const th = event.target.closest?.('th[data-col-id]');
      if (!th || riskResizing) { event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', th.dataset.colId);
      th.classList.add('dragging');
    });
    grid.addEventListener('dragover', (event) => {
      const th = event.target.closest('th[data-col-id]');
      if (!th) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDrop();
      const fixed = RISK_COLUMNS_BY_ID.get(th.dataset.colId)?.fixed;
      th.classList.add(fixed || dropAfter(th, event) ? 'drop-after' : 'drop-before');
    });
    grid.addEventListener('dragleave', (event) => {
      if (!grid.contains(event.relatedTarget)) clearDrop();
    });
    grid.addEventListener('drop', (event) => {
      const th = event.target.closest('th[data-col-id]');
      if (!th) return;
      event.preventDefault();
      const id = event.dataTransfer.getData('text/plain');
      const fixed = RISK_COLUMNS_BY_ID.get(th.dataset.colId)?.fixed;
      clearDrop();
      moveRiskColumn(id, th.dataset.colId, fixed || dropAfter(th, event));
    });
    grid.addEventListener('dragend', () => {
      clearDrop();
      grid.querySelectorAll('th.dragging').forEach((el) => el.classList.remove('dragging'));
    });

    // Ajuste de largura: arrasta a borda direita do cabecalho.
    grid.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('.col-resizer');
      if (!handle) return;
      event.preventDefault();
      const th = handle.closest('th');
      const id = th.dataset.colId;
      const index = Array.from(th.parentElement.children).indexOf(th) + 1;
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;
      riskResizing = true;
      document.body.classList.add('col-resizing');
      const cells = () => grid.querySelectorAll(`thead th:nth-child(${index}), tbody tr:not(.group-row) > td:nth-child(${index})`);
      let width = startWidth;
      const onMove = (e) => {
        width = Math.min(RISK_COLUMN_MAX_WIDTH, Math.max(RISK_COLUMN_MIN_WIDTH, Math.round(startWidth + e.clientX - startX)));
        cells().forEach((cell) => { cell.style.width = cell.style.minWidth = cell.style.maxWidth = `${width}px`; });
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.classList.remove('col-resizing');
        riskResizing = false;
        if (Math.abs(width - startWidth) >= 1) {
          riskColumnsPref.widths[id] = width;
          saveRiskColumnsPref();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    grid.addEventListener('dblclick', (event) => {
      const handle = event.target.closest('.col-resizer');
      if (!handle) return;
      delete riskColumnsPref.widths[handle.closest('th').dataset.colId];
      saveRiskColumnsPref();
      renderRisk();
    });

    // Menu "Colunas": mostrar/esconder, mover pelo teclado e restaurar padrao.
    menu.addEventListener('toggle', () => { if (menu.open) renderRiskColumnsMenu(); });
    $('risk-columns-list').addEventListener('change', (event) => {
      const id = event.target.dataset.colToggle;
      if (!id) return;
      const hidden = new Set(riskColumnsPref.hidden);
      if (event.target.checked) hidden.delete(id); else hidden.add(id);
      riskColumnsPref.hidden = [...hidden];
      saveRiskColumnsPref();
      renderRisk();
    });
    $('risk-columns-list').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-col-move]');
      if (!btn) return;
      const id = btn.dataset.colMove;
      const movable = riskColumnsPref.order.filter((x) => !RISK_COLUMNS_BY_ID.get(x).fixed);
      const target = movable[movable.indexOf(id) + Number(btn.dataset.dir)];
      if (!target) return;
      moveRiskColumn(id, target, Number(btn.dataset.dir) > 0);
      $('risk-columns-list').querySelector(`[data-col-move="${id}"][data-dir="${btn.dataset.dir}"]:not([disabled])`)?.focus();
    });
    $('risk-columns-reset').addEventListener('click', () => {
      riskColumnsPref = sanitizeRiskColumnsPref(null);
      saveRiskColumnsPref();
      renderRisk();
      renderRiskColumnsMenu();
      toast('Colunas restauradas ao padrão.');
    });
    document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
  }

  const ROTULOS_ROTINA = {
    conversation: 'Chamados',
    risk: 'Radar de Chamados',
    evidence: 'Evidências',
    trail: 'Trilha de Investigação',
    details: 'Detalhes',
    knowledge: 'Base de Conhecimento',
  };

  function filaRecolhidaSalva() {
    try { return localStorage.getItem('iaservice.filaRecolhida') === '1'; } catch (_) { return false; }
  }

  function setPanel(panel) {
    if (panel !== 'conversation') detalhesTecnicos?.close(false);
    state.activePanel = panel;
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.panelTab === panel));
    ['conversation', 'evidence', 'knowledge', 'trail', 'details', 'risk'].forEach((name) => {
      const el = $(`panel-${name}`);
      if (el) el.classList.toggle('active', name === panel);
    });
    // Radar de Chamados lista todos os chamados: cabecalho e descricao do
    // chamado selecionado nao se aplicam e so tomam espaco da grade.
    $('case-view').classList.toggle('modo-radar', panel === 'risk');
    // O Radar nao depende de chamado selecionado: sem chamado aberto, mostra a
    // area do Radar no lugar do "Selecione um chamado" (antes ficava vazia).
    if (!state.selected) {
      $('case-view').hidden = panel !== 'risk';
      $('empty-state').hidden = panel === 'risk';
    }
    // No Radar a Fila tambem recolhe (o Resumo ja recolhe acima), para a grade
    // usar a largura toda. Nao grava preferencia: ao sair, volta ao que o
    // usuario deixou salvo.
    $('radar-layout').classList.toggle('queue-collapsed', panel === 'risk' || filaRecolhidaSalva());
    if (panel === 'risk' && $('retorno-btn')?.getAttribute('aria-expanded') === 'true') retornoPanel?.close();
    // Registrar retorno exige chamado aberto: some do menu ⋯ no Radar.
    if ($('retorno-btn')) $('retorno-btn').hidden = panel === 'risk';
    // O menu de exportar (⋯) mora no cabecalho; no Radar ele vai para a barra
    // de filtros, para continuar disponivel com o cabecalho escondido.
    const exportMenu = document.querySelector('.ia-export-menu');
    const exportHost = panel === 'risk' ? document.querySelector('.risk-toolbar') : document.querySelector('.case-actions');
    if (exportMenu && exportHost && exportMenu.parentElement !== exportHost) exportHost.append(exportMenu);
    // Pesquisar Soluções só faz sentido na tela de mensagens.
    const pesquisarBtn = $('research-btn');
    if (pesquisarBtn) pesquisarBtn.hidden = panel !== 'conversation';
    const rotuloEl = $('routine-title');
    if (rotuloEl) {
      const rotulo = ROTULOS_ROTINA[panel] || '';
      rotuloEl.textContent = rotulo;
      rotuloEl.hidden = !rotulo || panel === 'conversation';
    }
    if (panel === 'risk') loadRisk();
    if (panel === 'knowledge') renderKnowledge();
    if (panel === 'trail') renderTrail();
    enviarPresenca();
  }

  function setMobileTarget(target) {
    state.mobileTarget = target;
    const layout = $('radar-layout');
    layout.classList.remove('mobile-queue', 'mobile-conversation', 'mobile-more');
    layout.classList.add(`mobile-${target}`);
    document.querySelectorAll('.mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.mobileTarget === target));
    if (target === 'conversation') setPanel('conversation');
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

  // Monitor de Acessos (2026-10): sinal de presença a cada 30s, só com a aba
  // visível. Leva apenas tela, ação e o id do chamado aberto (o número é
  // resolvido no servidor) — nunca texto digitado pelo consultor. Falha de
  // rede é silenciosa: o sinal nunca pode atrapalhar o uso do chat.
  function presencaAtual() {
    if (state.activePanel === 'risk') return { tela: 'Radar J2A', acao: 'Radar de Chamados (visão de risco)', chamadoId: null };
    if (state.selected) {
      const painel = ROTULOS_ROTINA[state.activePanel] || 'Conversa';
      const rotulo = state.activePanel === 'conversation' ? 'Conversa com a IA' : painel;
      return { tela: 'Radar J2A', acao: state.somenteLeitura ? `${rotulo} · somente leitura` : rotulo, chamadoId: state.selected.id };
    }
    return { tela: 'Radar J2A', acao: `Fila pessoal · filtro ${state.queueFilter}`, chamadoId: null };
  }

  function enviarPresenca() {
    if (!state.token || document.hidden) return;
    fetch(ext('/presenca'), {
      method: 'POST',
      cache: 'no-store',
      headers: apiHeaders(),
      body: JSON.stringify({ ...presencaAtual(), visivel: true }),
    }).catch(() => null);
  }

  function iniciarPresenca() {
    clearInterval(state.presencaTimer);
    enviarPresenca();
    verificarVersaoServidor();
    state.presencaTimer = setInterval(() => { enviarPresenca(); verificarVersaoServidor(); }, 30 * 1000);
  }

  // Limpa a sessão SÓ no navegador e volta ao login (Sair, ou sessão derrubada
  // pelo administrador no Monitor de Acessos).
  function encerrarSessaoLocal(mensagem) {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    clearInterval(state.autoTimer);
    clearInterval(state.countdownTimer);
    clearInterval(state.presencaTimer);
    _resetEstadoDoChat();
    showAccess(mensagem);
  }

  // Aba aberta ANTES de uma atualização do servidor continua rodando o código
  // antigo (caso real 2026-10: "Sair" de uma aba antiga não encerrava a sessão
  // e o Monitor seguia mostrando a pessoa). Quando a versão do servidor muda,
  // recarrega sozinho — mas nunca no meio de algo: texto digitado, análise da
  // IA em andamento ou aba em segundo plano (espera o próximo ciclo).
  function verificarVersaoServidor() {
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const v = body?.v;
        if (!v) return;
        if (!state.versaoServidor) { state.versaoServidor = v; return; }
        if (v === state.versaoServidor) return;
        const editando = [...document.querySelectorAll('textarea, input[type="text"], input[type="search"]')]
          .some((el) => el.value && el.value.trim() && el.offsetParent !== null);
        if (document.hidden || editando || state.processing.size) return;
        location.reload();
      })
      .catch(() => null);
  }

  function renderCountdown() {
    const countdownEl = $('refresh-countdown');
    if (!countdownEl || countdownEl.hidden) return;
    const remaining = Math.max(0, Math.round((state.nextRefreshAt - Date.now()) / 1000));
    const mm = Math.floor(remaining / 60);
    const ss = remaining % 60;
    countdownEl.textContent = mm > 0 ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
  }

  // Aba deixada aberta enquanto os dados mudaram em outro lugar (ex. "Pesquisas
  // e Dossies da IA" na Base Historica): ao voltar para a aba, rebusca a
  // conversa do chamado aberto no servidor em vez de manter o que estava na
  // tela. Nao roda enquanto aquele atendimento esta pesquisando (nao
  // interfere na deteccao de resposta nova de pollMessages).
  async function sincronizarChatAtivo() {
    const atendimentoId = state.atendimentoId;
    if (!atendimentoId || !state.selected || !state.token) return;
    if (state.processing.has(atendimentoId)) return;
    try {
      const mensagens = await request(ext(`/atendimentos/${encodeURIComponent(atendimentoId)}/mensagens`));
      if (atendimentoId !== state.atendimentoId || state.processing.has(atendimentoId)) return;
      state.messages = mensagens;
      await Promise.allSettled([loadLocalAttachments(), loadDossier(), loadInvestigations(), loadTrilha()]);
      if (atendimentoId !== state.atendimentoId) return;
      renderAllCaseData();
    } catch (_) {
      // Falha ao atualizar nunca derruba a tela: mantem o que ja estava exibido.
    }
  }

  function bindEvents() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sincronizarChatAtivo();
    });
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
      // Encerra a sessão também no servidor (antes só apagava o token local e
      // a sessão seguia válida por até 8h). keepalive: conclui mesmo se a aba
      // for fechada logo em seguida.
      if (state.token) {
        fetch(ext('/sessao/encerrar'), { method: 'POST', keepalive: true, headers: apiHeaders() }).catch(() => null);
      }
      encerrarSessaoLocal('Sessao encerrada.');
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) enviarPresenca();
    });
    // Aba fechada/recarregada: avisa o Monitor de Acessos na hora, sem esperar
    // o ciclo de 2 min. Recarregar manda um sinal novo logo em seguida.
    window.addEventListener('pagehide', () => {
      if (!state.token) return;
      fetch(ext('/presenca/saindo'), { method: 'POST', keepalive: true, headers: apiHeaders() }).catch(() => null);
    });
    $('theme-switch').addEventListener('click', (event) => {
      if (event.target.closest('#theme-toggle')) {
        setThemeMenu($('theme-menu').hidden);
        return;
      }
      const btn = event.target.closest('[data-theme-option]');
      if (btn) {
        applyTheme(btn.dataset.themeOption);
        setThemeMenu(false);
      }
    });
    document.querySelectorAll('.topbar-menu').forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (menu.open) closeTopbarMenus(menu);
      });
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.topbar-menu')) closeTopbarMenus();
      if (!event.target.closest('#theme-switch')) setThemeMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeTopbarMenus();
    });
    $('refresh-queue-btn').addEventListener('click', () => {
      loadQueue({ forceSync: true });
      const seconds = Number($('auto-refresh-select').value || 0);
      if (seconds) state.nextRefreshAt = Date.now() + seconds * 1000;
    });
    $('queue-search').addEventListener('input', renderQueue);
    $('queue-waiting-filter').addEventListener('change', () => {
      state.queueWaiting = $('queue-waiting-filter').value;
      renderQueue();
    });
    document.querySelectorAll('[data-queue-filter]').forEach((btn) => btn.addEventListener('click', () => {
      state.queueFilter = btn.dataset.queueFilter;
      document.querySelectorAll('[data-queue-filter]').forEach((b) => b.classList.toggle('active', b === btn));
      loadQueue();
    }));
    $('auto-refresh-select').addEventListener('change', () => {
      setupAutoRefresh();
      saveAutoRefreshConfig();
    });
    $('pre-analysis-toggle').addEventListener('change', () => savePreferences());
    $('response-style-select').addEventListener('change', saveResponseStyle);
    $('pre-analysis-padrao-btn').addEventListener('click', () => savePreferences(null));
    $('queue-list').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ticket-id]');
      if (btn) selectTicket(btn.dataset.ticketId);
    });
    $('risk-grid').addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-url]');
      if (open) return openAttachment(open.dataset.openUrl);
      const group = event.target.closest('[data-group-toggle]');
      if (group) return toggleRiskGroup(group.dataset.groupToggle);
      const btn = event.target.closest('[data-ticket-id]');
      if (btn) selectTicket(btn.dataset.ticketId);
    });
    $('risk-groups-toggle').addEventListener('click', (event) => toggleAllRiskGroups(event.currentTarget.dataset.action));
    bindRiskColumns();
    $('evidence-content').addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-url]');
      if (open) openAttachment(open.dataset.openUrl);
    });
    const abrirRelacionado = (event) => {
      if (event.target.closest('a, [data-open-url]')) return;
      const card = event.target.closest('[data-related-id]');
      if (card?.dataset.relatedId) selectTicket(card.dataset.relatedId);
    };
    $('knowledge-content').addEventListener('click', abrirRelacionado);
    $('knowledge-content').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); abrirRelacionado(event); }
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
      closeTopbarMenus();
      if (state.selected && state.mobileTarget === 'queue') setMobileTarget('conversation');
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
    $('toggle-risk-consultants').addEventListener('click', (event) => {
      const collapsed = $('risk-layout').classList.toggle('consultants-collapsed');
      const btn = event.currentTarget;
      btn.textContent = collapsed ? '⇥' : '⇤';
      btn.title = collapsed ? 'Expandir lista de consultores' : 'Recolher lista de consultores';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    // Fila recolhivel (desktop): espelha o recolher do painel direito; a escolha fica salva.
    const aplicarFilaRecolhida = (recolhida) => {
      $('radar-layout').classList.toggle('queue-collapsed', recolhida);
      try { localStorage.setItem('iaservice.filaRecolhida', recolhida ? '1' : '0'); } catch (_) { /* opcional */ }
    };
    if (filaRecolhidaSalva()) $('radar-layout').classList.add('queue-collapsed');
    $('toggle-queue-btn').addEventListener('click', () => aplicarFilaRecolhida(true));
    $('queue-reopen-rail').addEventListener('click', () => aplicarFilaRecolhida(false));
    $('description-toggle').addEventListener('click', () => $('case-description').classList.toggle('collapsed'));
    $('toggle-header-btn').addEventListener('click', () => {
      const collapsed = $('case-header').classList.toggle('collapsed');
      $('case-view').classList.toggle('header-collapsed', collapsed);
      $('toggle-header-btn').classList.toggle('collapsed', collapsed);
      $('toggle-header-btn').title = collapsed ? 'Mostrar detalhes do chamado' : 'Ocultar detalhes do chamado';
    });
    $('research-btn').addEventListener('click', researchSolutions);
    $('composer').addEventListener('submit', sendMessage);
    $('message-input').addEventListener('input', ajustarAlturaMensagem);
    window.addEventListener('resize', ajustarAlturaMensagem);
    $('file-input').addEventListener('change', (event) => {
      state.pendingFiles = [...event.target.files];
      renderPendingFiles();
    });
    document.querySelectorAll('.mobile-nav button').forEach((btn) => btn.addEventListener('click', () => setMobileTarget(btn.dataset.mobileTarget)));

    // Avaliacao Humana -- delegacao de clique dentro do chat (botao
    // "Avaliar investigação"/"editar" e reconstruido a cada renderMessages,
    // mesmo padrao ja usado para data-ticket-id/data-open-url).
    $('messages').addEventListener('click', (event) => {
      const download = event.target.closest('.message-attachment');
      if (download) { event.preventDefault(); openAttachment(download.href, download.dataset.downloadName); return; }
      const menuTrigger = event.target.closest('[data-menu-msg]');
      if (menuTrigger) { event.stopPropagation(); abrirMenuMensagem(menuTrigger); return; }
      const btn = event.target.closest('[data-avaliacao-abrir]');
      if (btn) abrirModalAvaliacao(btn.dataset.avaliacaoAbrir);
    });
    // Menu da mensagem fecha ao clicar fora, Esc, rolar o chat ou redimensionar.
    document.addEventListener('click', (event) => {
      if (state.menuMensagemId && !event.target.closest('#message-context-menu, [data-menu-msg]')) fecharMenuMensagem();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') fecharMenuMensagem(); });
    $('messages').addEventListener('scroll', fecharMenuMensagem, { passive: true });
    window.addEventListener('resize', fecharMenuMensagem);
    $('avaliacao-modal-backdrop').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) fecharModalAvaliacao();
    });
    $('avaliacao-modal-close').addEventListener('click', fecharModalAvaliacao);
    $('avaliacao-modal-cancelar').addEventListener('click', fecharModalAvaliacao);
    $('avaliacao-modal-salvar').addEventListener('click', salvarAvaliacaoInvestigacao);
  }

  async function openAttachment(url, nomeDownload = null) {
    try {
      const res = await fetch(url, { headers: apiHeaders(false) });
      const body = res.ok ? null : await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Erro ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      if (nomeDownload) {
        const a = document.createElement('a');
        a.href = blobUrl; a.download = nomeDownload;
        document.body.append(a); a.click(); a.remove();
      } else window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      toast(`Nao foi possivel abrir o anexo: ${err.message}`);
    }
  }

  async function carregarIdentidadeDoLink() {
    const partes = location.pathname.split('/').filter(Boolean);
    const apelido = partes[0] === 'iaservice' ? partes[1] : null;
    if (!apelido) return;
    try {
      const response = await fetch(`/api/ia-service-publico/empresa-por-apelido/${encodeURIComponent(apelido)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const info = await response.json();
      if (info.nome) $('access-company-name').textContent = info.nome;
      if (info.logoUrl) {
        const url = new URL(info.logoUrl, location.origin);
        // Em HTTPS, usa o proxy para logos locais salvos com o endereço HTTP antigo.
        if (location.protocol === 'https:' && url.protocol === 'http:' && url.pathname.startsWith('/uploads/')) {
          url.protocol = location.protocol;
          url.host = location.host;
          url.port = location.port;
        }
        if (!['http:', 'https:'].includes(url.protocol) || (location.protocol === 'https:' && url.protocol === 'http:')) return;
        const img = document.createElement('img');
        img.src = url.href;
        img.alt = info.nome || 'Logomarca da empresa';
        img.onload = () => $('access-brand-mark').replaceChildren(img);
      }
    } catch (_) { /* Identidade visual opcional; nunca interfere no login. */ }
  }

  function init() {
    carregarIdentidadeDoLink();
    // Chat interno da equipe (2026-10): botão "Mensagens" no topo, ao lado da Ajuda.
    if (window.IaChatInterno) {
      chatInterno = window.IaChatInterno.mount({
        anchor: document.querySelector('#radar-screen .topbar-actions'),
        getToken: () => state.token,
        request,
        ext,
        onSessaoEncerrada: (mensagem) => encerrarSessaoLocal(mensagem),
      });
    }
    retornoPanel = window.IaRetornoSoftExpert.mount({
      button: $('retorno-btn'),
      alignTo: () => $('case-view'),
      getContext: () => ({ scopeKey: state.token, chamadoId: state.selected?.id, numero: state.selected?.numero, readonly: state.somenteLeitura }),
      request: async (context, options) => {
        const suffix = options.consultaChave ? `/por-chave/${encodeURIComponent(options.consultaChave)}` : '';
        const response = await fetch(ext(`/radar/chamados/${encodeURIComponent(context.chamadoId)}/retorno${suffix}`), {
          ...options, cache: 'no-store', headers: apiHeaders(false),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(body.error || 'Não foi possível preparar o retorno.'), { status: response.status });
        return body;
      },
      onSuccess: async () => { await Promise.allSettled([loadMessages(), loadSoftAttachments(state.selected.id)]); },
    });
    detalhesTecnicos = window.IaDetalhesTecnicos.mount({
      getContext: () => state.atendimentoId ? `${state.token}:${state.atendimentoId}` : null,
      getMessage: id => state.messages.find(m => String(m.id) === String(id) && (!m.atendimentoId || String(m.atendimentoId) === String(state.atendimentoId))),
      alignTo: () => $('case-view'),
      onOpen: () => { retornoPanel.close(); return $('retorno-btn').getAttribute('aria-expanded') !== 'true'; },
    });
    $('retorno-btn').addEventListener('click', () => detalhesTecnicos.close(false), true);
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
  window.IaTabExport.mount(document.querySelector('.case-actions'), () => ({
    element: $(`panel-${state.activePanel}`),
    title: ROTULOS_ROTINA[state.activePanel],
    context: state.activePanel === 'risk' ? '' : [ $('case-number').textContent, $('case-title').textContent ].join(' — '),
  }), { itens: [$('retorno-btn')], icones: true });
  bindEvents();
    bootRadar();
  }

  init();
})();

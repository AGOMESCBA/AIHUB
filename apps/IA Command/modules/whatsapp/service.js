const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode               = require('qrcode');
const { EventEmitter }     = require('events');
const path                 = require('path');
const fs                   = require('fs');
const { exec }             = require('child_process');

const intentService       = require('../ai/intent-service');
const intentMerger        = require('../ai/intent-merger');
const transcriptionService = require('../ai/transcription-service');
const intentRouter        = require('../erp/intent-router');
const responseFormatter   = require('../erp/response-formatter');
const interpretationLog   = require('../ai/interpretation-log');
const channelStore        = require('./channel-store');
const messageTemplates    = require('./message-templates');
const dialogResolver      = require('../ai/dialog-resolver');
const crud                = require('../database/crud');

const AUTH_BASE = path.join(__dirname, '..', '..', '..', '..', '.wwebjs_auth');
const TEMP_DIR  = path.join(__dirname, '..', '..', 'temp');

const PUPPETEER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-default-apps', '--disable-sync', '--mute-audio',
  '--hide-scrollbars', '--metrics-recording-only',
];

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || process.env.CHROME_PATH || null;
}

class IACWhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client      = null;
    this.status      = 'stopped';
    this.lastQrUrl   = null;
    this._stopping   = false;
    this._empresaId  = null;
    this._channelId  = null;
    this._channelName = null;
    this._authClientId = null;
    this._logBuffer  = [];
    this._wired      = false;
    this._msgCount   = 0;
    this._senderContext = new Map();
  }

  getStatus()    { return this.status; }
  getQr()        { return this.lastQrUrl; }
  getEmpresaId() { return this._empresaId; }
  getChannelId() { return this._channelId; }
  getChannelName() { return this._channelName; }
  getMsgCount()  { return this._msgCount; }
  getLogBuffer() { return this._logBuffer; }
  clearBuffer()  { this._logBuffer = []; }

  log(message, type = 'info') {
    const entry = { message, type, timestamp: new Date().toLocaleTimeString('pt-BR') };
    this._logBuffer.push(entry);
    if (this._logBuffer.length > 500) this._logBuffer.shift();
    this.emit('iac-log', entry);
  }

  setStatus(s) {
    this.status = s;
    this.emit('iac-status', { status: s, empresa_id: this._empresaId, channel_id: this._channelId });
  }

  async start(config) {
    const cfg = typeof config === 'object'
      ? config
      : { empresaId: Number(config), channel: channelStore.ensureDefaultForEmpresa(Number(config)) };
    const empresaId = Number(cfg.empresaId || cfg.channel?.empresas?.[0]?.empresa_id || 0);
    const channel = cfg.channel || channelStore.ensureDefaultForEmpresa(empresaId);

    if (!empresaId) return this.log('empresa_id é obrigatório.', 'error');
    if (!channel?.id) return this.log('Canal WhatsApp é obrigatório.', 'error');
    if (this._stopping) return this.log('Aguardando parada anterior...', 'warning');
    if (this.status !== 'stopped') {
      if (this._channelId !== String(channel.id))
        return this.log(`Serviço já em execução para o canal ${this._channelName || this._channelId}.`, 'error');
      return this.log('Serviço já está em execução.', 'warning');
    }

    this._empresaId = Number(empresaId);
    this._channelId = String(channel.id);
    this._channelName = channel.nome || `Canal ${channel.id}`;
    this._authClientId = channel.auth_client_id || `iac_ch_${channel.id}`;
    this.setStatus('starting');
    this._startTime = Date.now();
    this.log(`Iniciando IA Command WhatsApp no canal "${this._channelName}"...`, 'info');
    const chromePath = resolveChromePath();
    if (chromePath) this.log(`Chrome: ${chromePath}`, 'info');

    const puppeteerCfg = { headless: true, args: PUPPETEER_ARGS };
    if (chromePath) puppeteerCfg.executablePath = chromePath;

    // Prefixo 'iac_' evita conflito com sessões do IAHub Recrutamento
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: this._authClientId, dataPath: AUTH_BASE }),
      puppeteer: puppeteerCfg,
    });

    let step = 0;
    const MSGS = [
      'Aguardando Chrome iniciar…', 'Chrome iniciado, carregando WhatsApp Web…',
      'Aguardando QR code ou sessão salva…', 'Primeira execução pode levar até 3 minutos…',
      'Aguardando autenticação…', 'Quase lá, aguarde…',
    ];
    const progressTimer = setInterval(() => {
      if (this.status !== 'starting') { clearInterval(progressTimer); return; }
      this.log(MSGS[Math.min(step++, MSGS.length - 1)], 'info');
    }, 15000);

    const initTimeout = setTimeout(() => {
      if (this.status !== 'starting') return;
      clearInterval(progressTimer);
      this.log('Tempo limite de 180s atingido. Verifique o Chrome e tente novamente.', 'error');
      this.stop();
    }, 180000);

    const clearTimers = () => { clearInterval(progressTimer); clearTimeout(initTimeout); };

    this.client.on('qr', async (qr) => {
      clearTimers();
      this.log('QR Code gerado — escaneie com o WhatsApp.', 'info');
      this.lastQrUrl = await qrcode.toDataURL(qr);
      this.emit('iac-qr', this.lastQrUrl);
    });

    this.client.on('ready', () => {
      clearTimers();
      this.lastQrUrl = null;
      this.setStatus('connected');
      const seg = ((Date.now() - this._startTime) / 1000).toFixed(1);
      this.log(`Conectado! Número: ${this.client.info.wid.user} — ${seg}s`, 'success');
      try {
        const { getDB } = require('../database');
        getDB().prepare('UPDATE whatsapp_channels SET numero = ?, atualizado_em = ? WHERE id = ?')
          .run(this.client.info.wid.user, new Date().toISOString(), this._channelId);
      } catch (_) {}
    });

    this.client.on('auth_failure', () => {
      clearTimers();
      this.setStatus('stopped');
      this.log('Falha de autenticação. Delete a pasta .wwebjs_auth e tente novamente.', 'error');
    });

    this.client.on('disconnected', () => {
      clearTimers();
      this.setStatus('stopped');
      this.log('WhatsApp desconectado.', 'warning');
    });

    this.client.on('message', (msg) => this._handleMessage(msg));

    this.client.initialize().catch((err) => {
      clearTimers();
      this.client = null;
      this.setStatus('stopped');
      this.log(`Falha ao inicializar: ${err.message}`, 'error');
    });
  }

  // Mata processos Chrome que ainda seguram o userDataDir desta sessão (Windows)
  _killChromeForSession(clientId) {
    return new Promise((resolve) => {
      const marker = `session-${clientId}`.replace(/'/g, '');
      const cmd = `powershell -NoProfile -Command "Get-WmiObject Win32_Process -Filter \\"Name='chrome.exe' AND CommandLine LIKE '%${marker}%'\\" | ForEach-Object { $_.Terminate() }"`;
      exec(cmd, () => resolve());
    });
  }

  async stop() {
    if (this._stopping) return;
    this._stopping = true;
    const clientId = this._authClientId;
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    await new Promise(r => setTimeout(r, 1000));
    if (clientId) await this._killChromeForSession(clientId);
    this.lastQrUrl = null;
    this._stopping = false;
    this.setStatus('stopped');
    this.log('Serviço parado.', 'info');
  }

  async disconnectSession(authClientId = null) {
    const clientId = authClientId || this._authClientId;
    if (!clientId) throw new Error('Identificador da sessão WhatsApp não informado.');

    this._stopping = true;
    if (this.client) {
      await this.client.logout().catch(() => {});
      await this.client.destroy().catch(() => {});
      this.client = null;
    }

    await new Promise(r => setTimeout(r, 1000));
    await this._killChromeForSession(clientId);

    this.lastQrUrl = null;
    this._senderContext.clear();
    await fs.promises.rm(path.join(AUTH_BASE, `session-${clientId}`), { recursive: true, force: true }).catch(() => {});
    this._stopping = false;
    this.setStatus('stopped');
    this.log('Sessão WhatsApp desconectada. Inicie novamente para ler outro QR Code.', 'warning');
  }

  async sendMessage(numero, texto) {
    if (!this.client || this.status !== 'connected')
      throw new Error('WhatsApp não está conectado.');
    const id = await this.client.getNumberId(numero.replace(/\D/g, ''));
    if (!id) throw new Error(`Número ${numero} não encontrado no WhatsApp.`);
    await this.client.sendMessage(id._serialized, texto);
  }

  _normalizarNumeroWa(valor) {
    return String(valor || '').split('@')[0].replace(/\D/g, '');
  }

  _isSenderAuthorized(sender) {
    const numero = this._normalizarNumeroWa(sender);
    if (!numero) return false;

    try {
      if (this._channelId) {
        return channelStore
          .listarEmpresasDoCanal(this._channelId)
          .some(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender));
      }

      const { getDB } = require('../database');
      const db = getDB();
      const total = db.prepare(
        'SELECT COUNT(*) AS total FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND ativo = 1'
      ).get(this._empresaId)?.total || 0;

      if (!total) return false;

      const numeros = channelStore.variantesNumeroBrasil(sender);
      const lid = channelStore.extrairLid(sender);
      const placeholders = numeros.map(() => '?').join(',');
      const row = db.prepare(`
        SELECT id FROM whatsapp_allowed_numbers
        WHERE empresa_id = ? AND ativo = 1
          AND (numero IN (${placeholders}) OR wa_lid = ?)
        LIMIT 1
      `).get(this._empresaId, ...numeros, lid);
      return !!row;
    } catch (err) {
      this.log(`Falha ao validar numero autorizado: ${err.message}`, 'warning');
      return false;
    }
  }

  _sessionKey(sender) {
    return this._normalizarNumeroWa(sender);
  }

  _getSenderContext(sender) {
    const key = this._sessionKey(sender);
    const ctx = this._senderContext.get(key);
    if (!ctx) return null;
    if (ctx.expiresAt && ctx.expiresAt < Date.now()) {
      this._senderContext.delete(key);
      return null;
    }
    return ctx;
  }

  _setSenderContext(sender, patch) {
    const key = this._sessionKey(sender);
    this._senderContext.set(key, {
      ...(this._senderContext.get(key) || {}),
      ...patch,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
  }

  _clearLastIntent(sender) {
    const ctx = this._getSenderContext(sender);
    if (!ctx) return;
    delete ctx.lastIntent;
    delete ctx.lastIntentTs;
    delete ctx.lastIntentEmpresaId;
    delete ctx.lastIntentChannelId;
    this._setSenderContext(sender, ctx);
  }

  _getScopedLastIntent(sender, empresaId) {
    const ctx = this._getSenderContext(sender);
    const intent = ctx?.lastIntent || null;
    if (!intent) return { intent: null, ts: 0 };

    const sameEmpresa = String(ctx.lastIntentEmpresaId || '') === String(empresaId);
    const sameChannel = String(ctx.lastIntentChannelId || '') === String(this._channelId || '');
    if (!sameEmpresa || !sameChannel) return { intent: null, ts: 0 };

    return { intent, ts: ctx.lastIntentTs || 0 };
  }

  _saveLastIntent(sender, intent, empresaId) {
    this._setSenderContext(sender, {
      lastIntent: intent,
      lastIntentTs: Date.now(),
      lastIntentEmpresaId: empresaId,
      lastIntentChannelId: this._channelId || null,
    });
  }

  _isPedidoPorEmpresa(texto) {
    const normalizado = String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /\bpor\s+empresas?\b/.test(normalizado);
  }

  _isColunaNumericaResumo(nome, valor) {
    const k = String(nome || '').toLowerCase();
    const skip = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia'];
    if (skip.some(p => k === p || k.startsWith(p + '_') || k.endsWith('_' + p))) return false;
    if (/^data$|^dt_|^data_/.test(k)) return false;
    return typeof valor === 'number' || (typeof valor === 'string' && valor !== '' && !isNaN(parseFloat(valor)));
  }

  _metricasEmpresa(intent, rows = []) {
    const metricas = new Set();
    for (const m of intent?._metricasDetectadas || []) metricas.add(String(m).replace(/[^\w]/g, '').toLowerCase());
    const ordem = String(intent?.ordenar_por || '').split(':')[0];
    if (ordem) metricas.add(String(ordem).replace(/[^\w]/g, '').toLowerCase());
    for (const row of rows) {
      for (const [k, v] of Object.entries(row || {})) {
        if (k === 'empresa') continue;
        if (this._isColunaNumericaResumo(k, v)) metricas.add(k);
      }
    }
    if (!metricas.size) metricas.add('faturamento');
    return [...metricas].filter(Boolean);
  }

  _normalizarMetricaResumo(nome) {
    const n = String(nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const tokens = n.split('_').filter(Boolean);
    if (tokens.some(t => ['quantidade', 'qtd', 'qtde', 'volume', 'unidade', 'unidades', 'itens'].includes(t))) {
      return 'quantidade';
    }
    if (tokens.some(t => ['faturamento', 'valor', 'vlr', 'receita', 'total'].includes(t))) {
      return 'faturamento';
    }
    return n || nome;
  }

  _resumirEmpresa(emp, rows = []) {
    const resumo = { empresa: emp.nome || `Empresa #${emp.empresa_id}` };
    for (const row of rows || []) {
      for (const [k, v] of Object.entries(row || {})) {
        if (!this._isColunaNumericaResumo(k, v)) continue;
        const metrica = this._normalizarMetricaResumo(k);
        resumo[metrica] = (resumo[metrica] || 0) + (parseFloat(v) || 0);
      }
    }
    return resumo;
  }

  _intentConsultaConsolidada(intent = {}) {
    return {
      ...intent,
      group_by: null,
      agrupar_por: null,
      agrupar_por_composto: null,
      ordenar_por: null,
      limite: null,
    };
  }

  _configAnaliticaEmpresa(empresaId) {
    try {
      return {
        intencoes: crud.listar('intentions', { empresa_id: empresaId, ativo: 1 }),
        datasets: crud.listar('datasets', { empresa_id: empresaId }),
      };
    } catch (_) {
      return { intencoes: [], datasets: [] };
    }
  }

  _completarMetricasEmpresa(rows, metricas) {
    return rows.map(row => {
      const out = { ...row };
      for (const m of metricas) {
        if (out[m] == null) out[m] = 0;
      }
      return out;
    });
  }

  _clearPending(sender) {
    const ctx = this._getSenderContext(sender);
    if (!ctx) return;
    delete ctx.pendingText;
    this._setSenderContext(sender, ctx);
  }

  _formatarClarificacao(empresas) {
    const opcoes = ['1. Todas as empresas', ...empresas.map((e, idx) => `${idx + 2}. ${e.nome}`)].join('\n');
    return messageTemplates.render(this._empresaId, 'empresa_ambigua', {
      opcoes_empresas: opcoes,
      canal_nome: this._channelName || '',
    });
  }

  _rotuloMotor(intent = {}) {
    if (intent._contextoAplicado) {
      return 'IA interna do sistema (contexto da conversa)';
    }
    if (intent._provedor === 'deterministico' || intent._resolvidoLocalmente) {
      return 'IA interna do sistema (motor local)';
    }
    if (intent._provedor === 'nenhum') return 'sem IA disponivel';
    return `IA externa (${intent._provedor})`;
  }

  _resumoPeriodoMonitor(periodo = {}) {
    const tipo = periodo?.tipo || 'nenhum';
    const inicio = periodo?.dataInicio || periodo?.data_inicio || null;
    const fim = periodo?.dataFim || periodo?.data_fim || null;
    if (inicio && fim) return `${tipo} (${inicio} -> ${fim})`;
    return tipo;
  }

  _resumoGroupByMonitor(intent = {}) {
    const groupBy = Array.isArray(intent.group_by) && intent.group_by.length
      ? intent.group_by
      : Array.isArray(intent.agrupar_por_composto) && intent.agrupar_por_composto.length
        ? intent.agrupar_por_composto
        : intent.agrupar_por ? [intent.agrupar_por] : [];
    return groupBy.length ? groupBy.join(' > ') : 'consolidado';
  }

  _resumoFiltrosMonitor(filtros = {}) {
    const ativos = Object.entries(filtros || {}).filter(([, v]) => v);
    return ativos.length ? ativos.map(([k, v]) => `${k}=${v}`).join(', ') : 'nenhum';
  }

  _resumoMetricasMonitor(intent = {}) {
    const metricas = Array.isArray(intent._metricasDetectadas) && intent._metricasDetectadas.length
      ? intent._metricasDetectadas
      : [];
    return metricas.length ? metricas.join(', ') : 'padrao do dataset';
  }

  _logCaminhoIntent({ intent = {}, contextoAnterior = null, escopo = 'single' } = {}) {
    const partes = [
      `escopo=${escopo}`,
      `motor=${this._rotuloMotor(intent)}`,
      `provedor=${intent._provedor || 'n/a'}`,
      `intencao=${intent.intencao || 'desconhecido'}`,
      `periodo=${this._resumoPeriodoMonitor(intent.periodo)}`,
      `group_by=${this._resumoGroupByMonitor(intent)}`,
      `filtros=${this._resumoFiltrosMonitor(intent.filtros)}`,
      `metricas=${this._resumoMetricasMonitor(intent)}`,
    ];

    const flags = [];
    if (contextoAnterior) flags.push(`contexto_anterior=${contextoAnterior.intencao || 'desconhecido'}/${this._resumoGroupByMonitor(contextoAnterior)}`);
    if (intent._contextoAplicado) flags.push('contexto_aplicado');
    if (intent._herdouIntencao) flags.push('herdou_intencao');
    if (intent._herdouPeriodo) flags.push('herdou_periodo');
    if (intent._periodoMesDoContexto) flags.push('refinou_mes_no_contexto');
    if (intent._agrupamentoCompostoDoContexto) flags.push('drilldown_contexto');
    if (intent._agrupamentoCompostoDetectado) flags.push('group_by_da_mensagem');
    if (intent._dimensaoDetectada) flags.push(`dimensao=${intent._dimensaoDetectada}`);
    if (intent._granularidadeDetectada) flags.push(`granularidade=${intent._granularidadeDetectada}`);

    this.log(`Caminho IA Command: ${partes.join(' | ')}${flags.length ? ` | flags=${flags.join(', ')}` : ''}`, 'info');
  }

  _metaMonitorIntent(intent = {}) {
    const metricas = Array.isArray(intent._metricasDetectadas) ? intent._metricasDetectadas : [];
    const origem = intent._contextoAplicado
      ? 'contexto da conversa'
      : (intent._provedor === 'deterministico' || intent._resolvidoLocalmente)
        ? 'motor local'
        : intent._provedor === 'nenhum'
          ? 'nao reconhecida'
          : 'IA externa';

    return {
      origem,
      contexto_aplicado: !!intent._contextoAplicado,
      herdou_intencao: !!intent._herdouIntencao,
      herdou_periodo: !!intent._herdouPeriodo,
      herdou_filtros: !!intent._herdouFiltros,
      herdou_metricas: !!intent._herdouMetricas,
      periodo_mes_contexto: !!intent._periodoMesDoContexto,
      dimensao_detectada: intent._dimensaoDetectada || null,
      granularidade_detectada: intent._granularidadeDetectada || null,
      group_by: Array.isArray(intent.group_by) ? intent.group_by : null,
      agrupamento_composto: Array.isArray(intent.group_by) ? intent.group_by : Array.isArray(intent.agrupar_por_composto) ? intent.agrupar_por_composto : null,
      agrupamento_composto_contexto: !!intent._agrupamentoCompostoDoContexto,
      metricas,
    };
  }

  _registrarInterpretacao({ empresaId, sender, texto, intent, resultado, resposta, duracaoMs }) {
    try {
      interpretationLog.registrar({
        empresa_id: empresaId,
        usuario: sender,
        numero_wa: this._normalizarNumeroWa(sender),
        canal_id: this._channelId,
        texto_original: texto,
        intent,
        resultado,
        resposta_entregue: resposta,
      });
    } catch (err) {
      this.log(`Falha ao registrar interpretacao: ${err.message}`, 'warning');
    }

    try {
      const { getDB } = require('../database');
      const STATUS_MAP = { sucesso: 'sucesso', erro: 'erro', sem_dados: 'sem_dados', dialogo: 'dialogo', desconhecido: 'desconhecido' };
      getDB().prepare(
        `INSERT OR IGNORE INTO execution_log
           (correlation_id, empresa_id, usuario, numero_wa, intencao, status, duracao_ms, tipo_mensagem, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        require('crypto').randomUUID(),
        empresaId,
        sender,
        this._normalizarNumeroWa(sender),
        intent?.intencao || 'desconhecido',
        STATUS_MAP[resultado?.tipo] ?? resultado?.tipo ?? 'desconhecido',
        duracaoMs ?? null,
        this._tipoMensagemAtual || 'texto',
        new Date().toISOString(),
      );
    } catch (err) {
      this.log(`Falha ao registrar execucao: ${err.message}`, 'warning');
    }
  }

  async _resolverSender(msg) {
    const raw = msg.from;
    const candidatos = [raw, msg.author];

    try {
      const contact = await msg.getContact();
      candidatos.push(
        contact?.number,
        contact?.id?._serialized
      );
    } catch (err) {
      this.log(`Nao foi possivel resolver contato do remetente: ${err.message}`, 'warning');
    }

    const rawLid = String(raw || '').includes('@lid') ? this._normalizarNumeroWa(raw) : '';
    const normalizados = candidatos
      .filter(Boolean)
      .map(v => {
        const valor = String(v);
        if (valor.includes('@')) return valor;
        const digitos = valor.replace(/\D/g, '');
        if (!digitos) return '';
        if (rawLid && digitos === rawLid) return `${digitos}@lid`;
        return `${digitos}@c.us`;
      })
      .filter(v => this._normalizarNumeroWa(v));

    const resolvido = normalizados.find(v => !String(v).includes('@lid')) || normalizados[0] || raw;
    if (resolvido !== raw) this.log(`Remetente resolvido: ${raw} -> ${resolvido}`, 'info');
    return resolvido;
  }

  // ── Recebimento de mensagens ─────────────────────────────────────────────────

  async _handleMessage(msg) {
    const senderRaw = msg.from;
    const sender = await this._resolverSender(msg);
    const tipo   = msg.type;

    this._msgCount++;
    this.log(`━━ Mensagem #${this._msgCount} — tipo: ${tipo} | de: ${sender}`, 'info');

    if (!this._isSenderAuthorized(sender)) {
      this.log(`Numero nao autorizado para empresa #${this._empresaId}: ${sender}`, 'warning');
      try {
        const chat = await msg.getChat();
        await chat.sendMessage(messageTemplates.render(this._empresaId, 'numero_nao_autorizado', {
          numero: this._normalizarNumeroWa(sender),
          canal_nome: this._channelName || '',
        }));
      } catch (_) {}
      return;
    }

    this.emit('iac-msg', {
      sender,
      tipo,
      body:      msg.body || '',
      timestamp: new Date().toISOString(),
    });

    try {
      if (tipo === 'chat' || tipo === 'text') {
        await this._handleText(msg, sender);
      } else if (['audio', 'ptt', 'voice'].includes(tipo)) {
        await this._handleAudio(msg, sender);
      } else {
        this.log(`Tipo "${tipo}" ignorado nesta fase.`, 'info');
      }
    } catch (err) {
      this.log(`Erro ao processar mensagem de ${sender}: ${err.message}`, 'error');
    }
  }

  async _handleText(msg, sender = msg.from) {
    const texto = (msg.body || '').trim();
    this._tipoMensagemAtual = 'texto';
    this.log(`📩 Texto recebido: "${texto.slice(0, 100)}"`, 'received');

    const chat = await msg.getChat();
    await chat.sendMessage(messageTemplates.render(this._empresaId, 'processando', {
      canal_nome: this._channelName || '',
      numero: this._normalizarNumeroWa(sender),
    }));
    this.log(`⏳ Acuse de recebimento enviado — iniciando pipeline...`, 'info');

    const t0 = Date.now();
    try {
      const resposta = await this._pipeline(texto, sender);
      await chat.sendMessage(resposta);
      this.log(`✅ Resposta enviada para ${sender} (${Date.now() - t0}ms)`, 'success');
    } catch (err) {
      this.log(`❌ Pipeline falhou (${Date.now() - t0}ms): ${err.message}`, 'error');
      await chat.sendMessage(messageTemplates.render(this._empresaId, 'erro_processamento', { erro: err.message }));
    }
  }

  async _handleAudio(msg, sender = msg.from) {
    this._tipoMensagemAtual = msg.type || 'audio';
    this.log(`Áudio recebido de ${sender} (${msg.type}) — baixando...`, 'info');

    fs.mkdirSync(TEMP_DIR, { recursive: true });

    let tmpPath = null;
    try {
      const media = await msg.downloadMedia();
      if (!media) return this.log('Falha ao baixar áudio.', 'error');

      const ext = media.mimetype?.includes('ogg') ? 'ogg' : 'mp3';
      tmpPath   = path.join(TEMP_DIR, `audio_${Date.now()}_${this._empresaId}.${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(media.data, 'base64'));

      const sizeKb = Math.round(fs.statSync(tmpPath).size / 1024);
      this.log(`Áudio salvo: ${path.basename(tmpPath)} (${sizeKb} KB) — transcrevendo...`, 'info');

      const chat = await msg.getChat();
      await chat.sendMessage(messageTemplates.render(this._empresaId, 'audio_recebido', {
        canal_nome: this._channelName || '',
        numero: this._normalizarNumeroWa(sender),
      }));

      let transcricao;
      try {
        transcricao = await transcriptionService.transcrever(tmpPath, this._empresaId);
        this.log(`Transcrição: "${transcricao.slice(0, 100)}"`, 'info');
      } catch (transcErr) {
        this.log(`Transcrição falhou: ${transcErr.message}`, 'error');
        await chat.sendMessage(messageTemplates.render(this._empresaId, 'erro_transcricao', { erro: transcErr.message }));
        return;
      }

      try {
        const resposta = await this._pipeline(transcricao, sender);
        await chat.sendMessage(messageTemplates.render(this._empresaId, 'audio_resposta_prefixo', {
          transcricao: `${transcricao.slice(0, 120)}${transcricao.length > 120 ? '...' : ''}`,
          resposta,
        }));
        this.log(`Resposta de áudio enviada para ${sender}`, 'success');
      } catch (err) {
        this.log(`Pipeline (áudio) falhou: ${err.message}`, 'error');
        await chat.sendMessage(messageTemplates.render(this._empresaId, 'erro_processamento', { erro: err.message }));
      }

    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        this.log(`Arquivo temporário apagado.`, 'info');
      }
    }
  }

  // ── IA Pipeline: classify → route → format ──────────────────────────────────

  async _pipeline(texto, sender) {
    const _t0 = Date.now();
    let empresaId = this._empresaId;
    let empresaResolvida = null;
    let textoExecucao = texto;

    if (this._channelId) {
      // Comandos explícitos de troca — sempre ativam o menu (independente de sessão prévia)
      const _trocaExplicita = [
        'trocar empresa',    'mudar empresa',    'alterar empresa',    'selecionar empresa',
        'alternar empresa',  'escolher empresa',  'trocar de empresa', 'mudar de empresa',
        'alterar de empresa','selecionar de empresa','alternar de empresa',
        'trocar filial',     'mudar filial',     'alterar filial',     'selecionar filial',
        'trocar de filial',  'mudar de filial',  'alterar de filial',
        'change company',    'switch company',
      ];
      // Palavras genéricas — só ativam quando já há empresa resolvida na sessão (evita falso positivo)
      const _trocaComContexto = ['empresa', 'voltar'];
      const textoNorm = texto.toLowerCase().trim();
      const isExplicitaTroca  = _trocaExplicita.some(k => textoNorm === k);
      const isContextoTroca   = _trocaComContexto.some(k => textoNorm === k) && this._getSenderContext(sender)?.empresaId;
      if (isExplicitaTroca || isContextoTroca) {
        // Sentinel '__trocar__': mantém pending=true para aceitar o próximo dígito/nome como seleção
        this._clearLastIntent(sender);
        this._setSenderContext(sender, { empresaId: null, pendingText: '__trocar__' });
        return this._formatarClarificacao(channelStore.listarEmpresasDoCanal(this._channelId));
      }

      const ctx = this._getSenderContext(sender);

      // Para mensagens frescas (sem pendência de seleção de empresa):
      // diálogos conversacionais são respondidos ANTES de pedir escolha de empresa.
      // Saudações, despedidas, perguntas sobre o bot, etc., nunca devem acionar o menu.
      if (!ctx?.pendingText) {
        const dialogRapido = dialogResolver.resolver(texto, this._empresaId);
        if (dialogRapido.matched) {
          this.log(`💬 Diálogo pré-empresa (tipo: ${dialogRapido.tipo})`, 'info');
          this._registrarInterpretacao({
            empresaId: this._empresaId, sender, texto,
            intent: { intencao: 'dialogo_conversacional', periodo: { tipo: 'nenhum' }, filtros: {}, confianca: 1, _provedor: 'dialogo', _dialogo_id: dialogRapido.dialogo_id },
            resultado: { tipo: 'dialogo', mensagem: dialogRapido.resposta },
            resposta: dialogRapido.resposta,
            duracaoMs: Date.now() - _t0,
          });
          return dialogRapido.resposta;
        }
      }

      const resolucao = channelStore.resolverEmpresaDoCanal({
        channelId: this._channelId,
        sender,
        texto,
        sessaoEmpresaId: ctx?.empresaId || null,
        pending: !!ctx?.pendingText,
        usarPadrao: false,
      });

      if (resolucao.status === 'unauthorized') {
        this.log(`Numero nao autorizado em nenhuma empresa do canal ${this._channelName}: ${sender}`, 'warning');
        return messageTemplates.render(this._empresaId, 'numero_nao_autorizado', {
          numero: this._normalizarNumeroWa(sender),
          canal_nome: this._channelName || '',
        });
      }

      if (resolucao.status === 'ambiguous') {
        this._setSenderContext(sender, { pendingText: texto, empresaId: null });
        return this._formatarClarificacao(resolucao.empresas);
      }

      const wasReset = ctx?.pendingText === '__trocar__';

      if (resolucao.status === 'all') {
        if (ctx?.empresaId !== '__all__') this._clearLastIntent(sender);
        this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
        if (wasReset) return `✅ Agora consultando *todas as empresas*.\nPode fazer sua pergunta.`;
        if (ctx?.pendingText) textoExecucao = ctx.pendingText;
        return await this._pipelineAll(textoExecucao, resolucao.empresas, sender);
      }

      const empresasDoSender = channelStore
        .listarEmpresasDoCanal(this._channelId)
        .filter(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender));
      if (this._isPedidoPorEmpresa(textoExecucao) && empresasDoSender.length > 1) {
        if (ctx?.lastIntent && String(ctx.lastIntentChannelId || '') === String(this._channelId || '')) {
          this._saveLastIntent(sender, ctx.lastIntent, '__all__');
        }
        this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
        return await this._pipelineAll(textoExecucao, empresasDoSender, sender);
      }

      empresaId = resolucao.empresaId;
      empresaResolvida = resolucao.empresa;
      if (ctx?.empresaId && String(ctx.empresaId) !== String(empresaId)) {
        this._clearLastIntent(sender);
      }
      this._setSenderContext(sender, { empresaId, pendingText: null });
      this.log(`Empresa resolvida: #${empresaId} (${resolucao.origem})`, 'info');

      if (wasReset) {
        return `✅ Empresa alterada para *${empresaResolvida?.nome || `#${empresaId}`}*.\nPode fazer sua pergunta.`;
      }

      if (ctx?.pendingText) {
        textoExecucao = ctx.pendingText;
      }
    }

    if (!intentService.temConfiguracaoMinima(empresaId)) {
      this.log(`Empresa #${empresaId} sem datasets/intencoes configurados - consulta ignorada sem acionar IA.`, 'warning');
      const resposta = 'Esta empresa ainda nao possui intencoes e datasets configurados para consultas pelo IA Command.';
      this._registrarInterpretacao({
        empresaId,
        sender,
        texto: textoExecucao,
        intent: {
          intencao: 'desconhecido',
          periodo: { tipo: 'nenhum' },
          filtros: {},
          confianca: 0,
          _provedor: 'nenhum',
          _erro: 'Empresa sem intencoes e datasets configurados.',
          _erroTipo: 'sem_configuracao',
        },
        resultado: {
          tipo: 'erro',
          subtipo: 'sem_configuracao',
          mensagem: resposta,
        },
        resposta,
        duracaoMs: Date.now() - _t0,
      });
      return resposta;
    }

    // ── Diálogos conversacionais (verificados ANTES da IA) ─────────────────────
    // Mensagens conversacionais (saudações, despedidas, ajuda…) são resolvidas
    // localmente sem consumir nenhum token de IA externa.
    const dialogAntecipado = dialogResolver.resolver(textoExecucao, empresaId);
    if (dialogAntecipado.matched) {
      this.log(`💬 Diálogo conversacional (pré-IA, tipo: ${dialogAntecipado.tipo})`, 'info');
      this._registrarInterpretacao({
        empresaId, sender, texto: textoExecucao,
        intent: {
          intencao: 'dialogo_conversacional', periodo: { tipo: 'nenhum' }, filtros: {},
          confianca: 1, _provedor: 'dialogo', _dialogo_id: dialogAntecipado.dialogo_id,
        },
        resultado: { tipo: 'dialogo', mensagem: dialogAntecipado.resposta },
        resposta: dialogAntecipado.resposta,
        duracaoMs: Date.now() - _t0,
      });
      return dialogAntecipado.resposta;
    }

    const scopedContexto = this._getScopedLastIntent(sender, empresaId);
    const contextoAnterior = scopedContexto.intent;
    const lastIntentTs     = scopedContexto.ts;

    let intent = await intentService.classificar(textoExecucao, empresaId, { contextoAnterior });
    intent._mensagemOriginal = textoExecucao;
    if (contextoAnterior) {
      intent = intentMerger.mesclar(intent, contextoAnterior, lastIntentTs, textoExecucao, this._configAnaliticaEmpresa(empresaId));
    }
    this._logCaminhoIntent({ intent, contextoAnterior, escopo: 'single' });

    const filtrosStr = Object.keys(intent.filtros || {}).length
      ? ' | filtros: ' + Object.entries(intent.filtros).map(([k,v]) => `${k}="${v}"`).join(', ')
      : '';
    const periodoStr = intent.periodo?.tipo && intent.periodo.tipo !== 'nenhum'
      ? ` | período: ${intent.periodo.tipo}${intent.periodo.dataInicio ? ` (${intent.periodo.dataInicio} → ${intent.periodo.dataFim})` : ''}`
      : '';
    this.log(`🧠 Intenção: "${intent.intencao}" | motor: ${this._rotuloMotor(intent)} | provedor: ${intent._provedor} | confiança: ${(intent.confianca * 100).toFixed(0)}%${periodoStr}${filtrosStr}`, 'info');
    if (intent._provedor === 'nenhum') {
      if (intent._erros?.length) {
        this.log(`❌ IA falhou para empresa #${empresaId}: ${intent._erro}`, 'error');
      } else {
        this.log(`⚠️  Sem chave de IA configurada para empresa #${empresaId} — configure em Configurar IA.`, 'warning');
      }

      // IA falhou e nenhum diálogo bateu — loga para aprendizado e retorna mensagem amigável
      dialogResolver.logarNaoRespondida(textoExecucao, empresaId, sender);
      this.log(`📝 Mensagem sem resposta registrada para aprendizado.`, 'info');
      const respostaFallback = intent._erros?.length
        ? '⚠️ Estou com instabilidade no momento. Pode tentar novamente em instantes?'
        : '⚠️ Ainda não consigo responder a isso. O administrador foi notificado para melhorar minha base de respostas.';
      this._registrarInterpretacao({
        empresaId, sender, texto: textoExecucao,
        intent,
        resultado: { tipo: 'erro', subtipo: 'sem_dialogo', mensagem: respostaFallback },
        resposta: respostaFallback,
        duracaoMs: Date.now() - _t0,
      });
      return respostaFallback;
    }

    const resultado = await intentRouter.rotear(intent, empresaId);
    this.emit('iac-intent', {
      empresaId,
      ...this._metaMonitorIntent(intent),
      intencao:        intent.intencao,
      provedor:        intent._provedor,
      motor:          this._rotuloMotor(intent),
      confianca:       intent.confianca,
      periodo:         intent.periodo   || {},
      filtros:         intent.filtros   || {},
      agrupar_por:     intent.agrupar_por  || null,
      ordenar_por:     intent.ordenar_por  || null,
      limite:          intent.limite        || null,
      dataset_id:      resultado.dataset_id   || null,
      dataset_nome:    resultado.dataset_nome || null,
      resultado_tipo:  resultado.tipo,
      resultado_msg:   resultado.mensagem   || null,
      rows_count:      resultado.rows?.length ?? null,
    });
    const resposta = responseFormatter.formatar(resultado, intent, { empresaId, messageTemplates });

    // Persiste o intent na sessão para uso como contexto no próximo turno.
    // Salva apenas quando a execução produziu um resultado real (não erro ou desconhecido).
    if (resultado.tipo !== 'erro' && resultado.tipo !== 'desconhecido' && intent.intencao !== 'desconhecido') {
      this._saveLastIntent(sender, intent, empresaId);
    }

    if (this._channelId && channelStore.listarEmpresasDoCanal(this._channelId).length > 1 && empresaResolvida?.nome) {
      const respostaFinal = messageTemplates.render(empresaId, 'resposta_empresa_prefixo', {
        empresa_nome: empresaResolvida.nome,
        empresa_id: empresaId,
        resposta,
        canal_nome: this._channelName || '',
      });
      this._registrarInterpretacao({ empresaId, sender, texto: textoExecucao, intent, resultado, resposta: respostaFinal, duracaoMs: Date.now() - _t0 });
      return respostaFinal;
    }
    this._registrarInterpretacao({ empresaId, sender, texto: textoExecucao, intent, resultado, resposta, duracaoMs: Date.now() - _t0 });
    return resposta;
  }

  async _pipelineAll(texto, empresas, sender = null) {
    const _t0 = Date.now();
    // Filtra empresas que têm intenções E datasets cadastrados. Se nenhuma qualificar,
    // usa a lista original para ao menos tentar (garante fallback com mensagem adequada).
    const empresasAptas = empresas.filter(e => intentService.temConfiguracaoMinima(e.empresa_id));
    if (empresasAptas.length && empresasAptas.length < empresas.length) {
      this.log(`ℹ️  _pipelineAll: ${empresas.length - empresasAptas.length} empresa(s) sem datasets/intenções ignorada(s).`, 'info');
    }
    const empresasLoop = empresasAptas.length ? empresasAptas : empresas;

    // Tenta classificar usando cada empresa do canal até encontrar uma com IA configurada.
    // classificar() nunca lança — retorna _provedor='nenhum' quando sem chaves.
    const scopedContextAll = sender ? this._getScopedLastIntent(sender, '__all__') : { intent: null, ts: 0 };
    const contextoAnteriorAll = scopedContextAll.intent;
    const lastIntentTsAll     = scopedContextAll.ts;

    let intent = null;
    let fallbackIntent = null;
    const falhasClassificacao = [];
    for (const emp of empresasLoop) {
      const result = await intentService.classificar(texto, emp.empresa_id, { contextoAnterior: contextoAnteriorAll });
      if (result._provedor !== 'nenhum') {
        intent = result;
        this.log(`🧠 Intenção (all) via empresa #${emp.empresa_id}: "${intent.intencao}" | motor: ${this._rotuloMotor(intent)} | provedor: ${intent._provedor} | confiança: ${(intent.confianca * 100).toFixed(0)}%`, 'info');
        break;
      }
      if (!fallbackIntent) fallbackIntent = result;
      if (result._erros?.length) {
        const falha = `Empresa #${emp.empresa_id}: ${result._erro}`;
        falhasClassificacao.push(falha);
        if (!contextoAnteriorAll) {
          this.log(`❌ ${falha}`, 'error');
        }
      } else {
        this.log(`⚠️  Empresa #${emp.empresa_id} sem chave de IA configurada — tentando próxima.`, 'warning');
      }
    }
    if (!intent) intent = fallbackIntent || { intencao: 'desconhecido', _provedor: 'nenhum', _erro: 'Nenhuma chave de IA configurada.', confianca: 0, periodo: { tipo: 'nenhum' }, filtros: {}, agrupar_por: null, ordenar_por: null, limite: null, precisa_confirmacao: false };
    if (contextoAnteriorAll) {
      intent = intentMerger.mesclar(intent, contextoAnteriorAll, lastIntentTsAll, texto, this._configAnaliticaEmpresa(empresasLoop[0]?.empresa_id || empresas[0]?.empresa_id));
    }
    if (intent._contextoAplicado && falhasClassificacao.length) {
      this.log('ℹ️  IA externa indisponivel, mas a engine interna resolveu pelo contexto da conversa.', 'info');
    }
    this._logCaminhoIntent({ intent, contextoAnterior: contextoAnteriorAll, escopo: 'all' });
    const pedidoPorEmpresa = this._isPedidoPorEmpresa(texto);
    const groupByAll = Array.isArray(intent.group_by) && intent.group_by.length
      ? intent.group_by.map(d => String(d || '').toLowerCase()).filter(Boolean)
      : Array.isArray(intent.agrupar_por_composto) && intent.agrupar_por_composto.length
        ? intent.agrupar_por_composto.map(d => String(d || '').toLowerCase()).filter(Boolean)
        : intent.agrupar_por ? [String(intent.agrupar_por).toLowerCase()] : [];
    const agrupamentoCompostoComEmpresa = pedidoPorEmpresa && groupByAll.includes('empresa') && groupByAll.length >= 2;
    const usarResumoPorEmpresa = pedidoPorEmpresa && !agrupamentoCompostoComEmpresa;
    if (usarResumoPorEmpresa) {
      intent.agrupar_por = 'empresa';
      intent.group_by = ['empresa'];
      intent.agrupar_por_composto = null;
      intent.limite = null;
    }
    const empresaLogId = empresas[0].empresa_id;
    const senderAll = sender || '__all__';

    // Intenção não reconhecida — retorna direto sem tentar as empresas
    if (intent.intencao === 'desconhecido') {
      const resultadoErro = { tipo: 'desconhecido', mensagem: intent._erro || 'Fiquei em duvida sobre qual indicador, periodo ou detalhe voce quer consultar.' };
      this.emit('iac-intent', {
        empresaId:      empresaLogId,
        ...this._metaMonitorIntent(intent),
        intencao:       'desconhecido',
        provedor:       intent._provedor,
        motor:          this._rotuloMotor(intent),
        confianca:      0,
        periodo:        {},
        filtros:        {},
        agrupar_por:    null,
        ordenar_por:    null,
        limite:         null,
        dataset_id:     null,
        dataset_nome:   null,
        resultado_tipo: 'erro',
        resultado_msg:  intent._erro || 'Intenção não reconhecida.',
        rows_count:     null,
      });
      const respostaErro = responseFormatter.formatar(
        resultadoErro,
        intent,
        { empresaId: empresaLogId, messageTemplates }
      );
      this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoErro, resposta: respostaErro, duracaoMs: Date.now() - _t0 });
      return respostaErro;
    }

    const todosRows     = [];
    const rowsPorEmpresa = [];
    const sucessos      = [];
    const semDataset    = [];
    const semDados      = [];
    let ultimoResultado = null;

    for (const emp of empresas) {
      try {
        const intentExecucao = usarResumoPorEmpresa ? this._intentConsultaConsolidada(intent) : intent;
        const resultado = await intentRouter.rotear(intentExecucao, emp.empresa_id);
        if (resultado.tipo === 'erro') {
          if (resultado.subtipo === 'sem_intencao') {
            this.log(`[All] Empresa #${emp.empresa_id} sem intenção configurada — ignorada.`, 'info');
          } else {
            semDataset.push(emp.nome);
            this.log(`[All] Empresa #${emp.empresa_id} erro: ${resultado.mensagem}`, 'warning');
          }
          if (usarResumoPorEmpresa) {
            rowsPorEmpresa.push({ empresa: emp.nome, _semDados: true });
          }
          continue;
        }
        if (!resultado.rows || resultado.rows.length === 0) {
          semDados.push(emp.nome);
          ultimoResultado = ultimoResultado || resultado;
          if (usarResumoPorEmpresa) {
            rowsPorEmpresa.push({ empresa: emp.nome, _semDados: true });
          }
          continue;
        }
        if (usarResumoPorEmpresa) {
          rowsPorEmpresa.push(this._resumirEmpresa(emp, resultado.rows));
        } else {
          todosRows.push(...resultado.rows.map(row => ({ empresa: emp.nome, ...row })));
        }
        sucessos.push(emp.nome);
        ultimoResultado = resultado;
      } catch (err) {
        semDataset.push(emp.nome);
        if (usarResumoPorEmpresa) {
          rowsPorEmpresa.push({ empresa: emp.nome, _semDados: true });
        }
        this.log(`[All] Empresa #${emp.empresa_id} (${emp.nome}): ${err.message}`, 'warning');
      }
    }

    if (usarResumoPorEmpresa) {
      const metricas = this._metricasEmpresa(intent, rowsPorEmpresa);
      const rowsEmpresaCompletos = this._completarMetricasEmpresa(rowsPorEmpresa, metricas);
      const resultadoEmpresas = {
        ...(ultimoResultado || {}),
        tipo: 'sucesso',
        intencao: intent.intencao,
        periodo: intent.periodo,
        rows: rowsEmpresaCompletos,
      };
      this.emit('iac-intent', {
        empresaId:    empresaLogId,
        ...this._metaMonitorIntent(intent),
        intencao:     intent.intencao,
        provedor:     intent._provedor,
        motor:        this._rotuloMotor(intent),
        confianca:    intent.confianca,
        periodo:      intent.periodo   || {},
        filtros:      intent.filtros   || {},
        agrupar_por:  'empresa',
        ordenar_por:  intent.ordenar_por  || null,
        limite:       null,
        dataset_id:   ultimoResultado?.dataset_id   || null,
        dataset_nome: ultimoResultado?.dataset_nome || null,
        resultado_tipo: 'sucesso',
        resultado_msg:  null,
        rows_count:   rowsEmpresaCompletos.length,
      });
      const resposta = responseFormatter.formatar(resultadoEmpresas, intent, {
        empresaId: empresaLogId,
        messageTemplates,
      });

      if (sender && intent.intencao !== 'desconhecido') {
        this._saveLastIntent(sender, intent, '__all__');
      }

      this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoEmpresas, resposta, duracaoMs: Date.now() - _t0 });
      return resposta;
    }

    // Nenhuma empresa trouxe dados
    if (todosRows.length === 0) {
      const partes = [];
      if (semDataset.length) partes.push(`${semDataset.join(', ')} sem dataset configurado`);
      if (semDados.length)   partes.push(`${semDados.join(', ')} sem dados no período`);
      const detalhe = partes.length ? ` (${partes.join(' | ')})` : '';
      const respostaSemDados = `Nenhum dado encontrado para sua consulta${detalhe}.`;
      const resultadoSemDados = {
        ...(ultimoResultado || {}),
        tipo: 'sem_dados',
        mensagem: `Nenhum dado encontrado${detalhe}`,
        rows: [],
      };
      this.emit('iac-intent', {
        empresaId:      empresaLogId,
        ...this._metaMonitorIntent(intent),
        intencao:       intent.intencao,
        provedor:       intent._provedor,
        motor:          this._rotuloMotor(intent),
        confianca:      intent.confianca,
        periodo:        intent.periodo  || {},
        filtros:        intent.filtros  || {},
        agrupar_por:    intent.agrupar_por || null,
        ordenar_por:    intent.ordenar_por || null,
        limite:         intent.limite      || null,
        dataset_id:     ultimoResultado?.dataset_id   || null,
        dataset_nome:   ultimoResultado?.dataset_nome || null,
        resultado_tipo: 'sem_dados',
        resultado_msg:  `Nenhum dado encontrado${detalhe}`,
        rows_count:     0,
      });
      this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoSemDados, resposta: respostaSemDados, duracaoMs: Date.now() - _t0 });
      return respostaSemDados;
    }

    const resultadoCombinado = { ...ultimoResultado, rows: todosRows };
    this.emit('iac-intent', {
      empresaId:    empresaLogId,
      ...this._metaMonitorIntent(intent),
      intencao:     intent.intencao,
      provedor:     intent._provedor,
      motor:          this._rotuloMotor(intent),
      confianca:    intent.confianca,
      periodo:      intent.periodo   || {},
      filtros:      intent.filtros   || {},
      agrupar_por:  intent.agrupar_por  || null,
      ordenar_por:  intent.ordenar_por  || null,
      limite:       intent.limite        || null,
      dataset_id:   ultimoResultado?.dataset_id   || null,
      dataset_nome: ultimoResultado?.dataset_nome || null,
      resultado_tipo: 'sucesso',
      resultado_msg:  null,
      rows_count:   todosRows.length,
    });
    const resposta = responseFormatter.formatar(resultadoCombinado, intent, {
      empresaId: empresaLogId,
      messageTemplates,
    });

    const cabecalho = [`🏭 *${sucessos.join(' + ')}*`];
    if (semDataset.length) cabecalho.push(`⚠️ _Sem dataset: ${semDataset.join(', ')}_`);
    if (semDados.length)   cabecalho.push(`ℹ️ _Sem dados no período: ${semDados.join(', ')}_`);

    const respostaFinal = cabecalho.join('\n') + '\n' + resposta;

    if (sender && intent.intencao !== 'desconhecido') {
      this._saveLastIntent(sender, intent, '__all__');
    }

    this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoCombinado, resposta: respostaFinal, duracaoMs: Date.now() - _t0 });
    return respostaFinal;
  }
}

module.exports = IACWhatsAppService;

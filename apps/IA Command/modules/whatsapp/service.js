const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode               = require('qrcode');
const { EventEmitter }     = require('events');
const path                 = require('path');
const fs                   = require('fs');
const { exec }             = require('child_process');

const intentService       = require('../ai/intent-service');
const intentMerger        = require('../ai/intent-merger');
const contextPreCheck     = require('../ai/context-pre-check');
const transcriptionService = require('../ai/transcription-service');
const intentRouter        = require('../erp/intent-router');
const responseFormatter   = require('../erp/response-formatter');
const { _extrairMes, _extrairAno, detectarDimensaoCategorica } = responseFormatter;
const canonicalWhatsappFormat = require('../erp/canonical-whatsapp-format');
const interpretationLog   = require('../ai/interpretation-log');
const channelStore        = require('./channel-store');
const messageTemplates    = require('./message-templates');
const dialogResolver      = require('../ai/dialog-resolver');
const conversationService = require('../ai/conversation-service');
const crud                = require('../database/crud');
const entitySqlGuard      = require('../erp/entity-sql-guard');
const sx2SqlNormalizer    = require('../erp/sx2-sql-normalizer');
const financeiroEntityCatalog  = require('../erp/financeiro/entity-catalog');
const comprasEntityCatalog     = require('../erp/compras/entity-catalog');
const faturamentoEntityCatalog = require('../erp/faturamento/entity-catalog');
const comissaoEntityCatalog    = require('../erp/comissao/entity-catalog');
const comissaoIAOwnerSpec      = require('../erp/comissao/comissao-ia-owner-spec');

const AUTH_BASE = path.join(__dirname, '..', '..', '..', '..', '.wwebjs_auth');
const TEMP_DIR  = path.join(__dirname, '..', '..', 'temp');
const WHATSAPP_MAX_MESSAGE_CHARS = 3500;
const PIPELINE_TRACE_FILE = path.join(__dirname, '..', '..', '..', '..', 'logs', 'iac-whatsapp-pipeline.log');

function _normalizarTextoEnvioWhatsapp(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  try { return JSON.stringify(valor); } catch (_) { return String(valor); }
}

function _quebrarMensagemWhatsapp(valor, limite = WHATSAPP_MAX_MESSAGE_CHARS) {
  const texto = _normalizarTextoEnvioWhatsapp(valor).trim();
  if (!texto) return ['Nao consegui montar a resposta dessa consulta. Tente novamente.'];
  if (texto.length <= limite) return [texto];

  const partes = [];
  let restante = texto;
  while (restante.length > limite) {
    let corte = restante.lastIndexOf('\n\n', limite);
    if (corte < Math.floor(limite * 0.6)) corte = restante.lastIndexOf('\n', limite);
    if (corte < Math.floor(limite * 0.6)) corte = restante.lastIndexOf(' ', limite);
    if (corte < Math.floor(limite * 0.6)) corte = limite;
    partes.push(restante.slice(0, corte).trim());
    restante = restante.slice(corte).trim();
  }
  if (restante) partes.push(restante);
  return partes;
}

function _tracePipelineWhatsapp(evento, dados = {}) {
  try {
    const mem = process.memoryUsage();
    fs.mkdirSync(path.dirname(PIPELINE_TRACE_FILE), { recursive: true });
    fs.appendFileSync(
      PIPELINE_TRACE_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        evento,
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
        ...dados,
      }) + '\n',
      'utf8',
    );
  } catch (_) {}
}

const PUPPETEER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-default-apps', '--disable-sync', '--mute-audio',
  '--hide-scrollbars', '--metrics-recording-only',
  '--remote-debugging-port=0',  // porta aleatória — evita conflito entre instâncias
  // Redução de footprint de memória — Chrome pode ser encerrado pelo SO (OOM) durante queries longas
  '--disable-hang-monitor',
  '--disable-crash-reporter',
  '--disable-in-process-stack-traces',
  '--disable-features=TranslateUI,BlinkGenPropertyTrees',
  '--js-flags=--max-old-space-size=512',  // limita heap V8 a 512MB
  '--renderer-process-limit=1',
  '--aggressive-cache-discard',
  '--disable-cache',
  '--disk-cache-size=1',
];

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || process.env.CHROME_PATH || null;
}

function _parsearRespostaFilial(texto) {
  const t = String(texto || '').trim();
  if (/^(todas?|all|consolidado|geral)\b/i.test(t)) return 'TODAS';
  const m = t.match(/\b([A-Z0-9]{1,10})\b/i);
  return m ? m[1].toUpperCase() : 'TODAS';
}

function _textoCancelaPendente(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return /^(0|cancelar|cancela|nenhuma|nenhum|nova pergunta|nova consulta|novo tema|outro assunto|recomecar|resetar|reset|limpar contexto)$/.test(t);
}

function _textoResetExplicito(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return /^(reset|\/reset|resetar|reiniciar|reinicia|recomecar|\/recomecar|limpar|limpar conversa|limpar tudo|limpar contexto|limpar cache|esquecer tudo|esqueca tudo|esquece tudo|nova conversa|novo inicio|comecar|comecar de novo|comecar novamente|parar consulta|pare a consulta|pode parar a consulta|cancelar consulta|cancela consulta|abortar consulta|pare|para|parar|\/pare|\/para|\/parar|stop|\/stop|cancelar|cancela|\/cancelar|abortar|\/abortar)$/.test(t);
}

// Reconhece pedido explicito para ver o SQL/consulta tecnica usada na ultima resposta.
// Frase curta e isolada (igual ao padrao de RESET) — evita falso positivo em perguntas
// de negocio que mencionem "sql" ou "consulta" de outro jeito.
function _textoPedeSqlUsado(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return /^(mostre? o sql( usado)?|mostrar o sql( usado)?|ver o sql( usado)?|qual( foi)? o sql( usado)?|qual( foi)? a consulta( usada)?|me mostr[ae] o sql|me mostr[ae] a consulta|mostre? a consulta( usada)?|\/sql)$/.test(t);
}

function _textoPareceNovaConsulta(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!t || /^\d+$/.test(t)) return false;
  return /\b(faturamento|vendas?|compras?|financeiro|comissao|saldo bancario|fluxo de caixa|contas? a pagar|contas? a receber|pedido|fornecedor|cliente|produto|banco|mes|ano)\b/.test(t);
}

function _normalizarBuscaEmpresa(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _tokensEmpresa(valor) {
  const stop = new Set(['empresa', 'companhia', 'grupo', 'sistemas', 'sistema', 'consultoria', 'ltda', 'me', 'eireli', 'sa', 's', 'a', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no']);
  return _normalizarBuscaEmpresa(valor).split(/\s+/).filter(t => t && !stop.has(t));
}

function _scoreEmpresaTexto(termo, empresa) {
  const termoNorm = _normalizarBuscaEmpresa(termo);
  if (!termoNorm) return 0;
  const nomes = [empresa?.nome, ...(String(empresa?.aliases || '').split(',').map(x => x.trim()))].filter(Boolean);
  let melhor = 0;
  for (const nome of nomes) {
    const nomeNorm = _normalizarBuscaEmpresa(nome);
    if (!nomeNorm) continue;
    if (nomeNorm === termoNorm) melhor = Math.max(melhor, 1);
    if (nomeNorm.includes(termoNorm) || termoNorm.includes(nomeNorm)) melhor = Math.max(melhor, 0.95);
    const termoTokens = _tokensEmpresa(termoNorm);
    const nomeTokens = _tokensEmpresa(nomeNorm);
    if (termoTokens.length && nomeTokens.length) {
      const hits = termoTokens.filter(t => nomeTokens.some(n => n === t || n.includes(t) || t.includes(n))).length;
      melhor = Math.max(melhor, hits / termoTokens.length);
    }
  }
  return melhor;
}

// Padrões léxicos de refinamento de consulta — usados pelo fallback de continuidade.
// Fora da classe para evitar referência pelo nome da classe (que pode mudar).
const _SINAIS_CONTINUIDADE = [
  /\bordered(ar?|ando|em|e)\b/i,
  /\bdecrescent[ei]\b/i,
  /\bcrescent[ei]\b/i,
  /\bdo\s+maior\s+para\b/i,
  /\bdo\s+menor\s+para\b/i,
  /\binvert(e|er|endo|a)\b/i,
  /\bclassific(ar?|ando)\b/i,
  /\bfilt(rar?|rando)\b/i,
  /\besse\s+result/i,
  /\besses?\s+dados\b/i,
  /\btop\s+\d+\b/i,
  /\bprimeiros?\s+\d+\b/i,
  /\bagora\s+(ordenar?|classific|filtrar?)\b/i,
  /\bmudar\s+(a\s+)?ordem\b/i,
  /\bexibir\s+(s[oe]mente|apenas)\b/i,
  // Refinamentos de agrupamento/detalhamento (ex: "me detalhe por mes", "quebre por cliente")
  /\bdetalh(e|a|ar|es)\b/i,
  /\bpor\s+(m[eê]s|meses|dia|dias|ano|anos|cliente|clientes|produto|produtos|vendedor|vendedores|fornecedor|fornecedores|empresa|filial)\b/i,
  /\bquebre?\b|\bquebra\b/i,
];
function _ehSinalContinuidade(texto) {
  return _SINAIS_CONTINUIDADE.some(p => p.test(String(texto || '')));
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
    this._startingPromise = null;
    this._msgCount   = 0;
    this._senderContext = new Map();
    this._senderCancelledAt = new Map();
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
    if (this._startingPromise) {
      this.log('Inicializacao do canal ja em andamento. Aguarde concluir.', 'warning');
      return this._startingPromise;
    }

    this._startingPromise = this._start(config);
    try {
      return await this._startingPromise;
    } finally {
      this._startingPromise = null;
    }
  }

  async _start(config) {
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
      return this.log(
        '⚠️ Este canal já está iniciado em outra sessão ou navegador. ' +
        'Apenas uma instância pode estar ativa por vez. ' +
        'Se precisar reiniciar, solicite ao administrador do sistema que pare o serviço primeiro.',
        'warning'
      );
    }

    this._empresaId = Number(empresaId);
    this._channelId = String(channel.id);
    this._channelName = channel.nome || `Canal ${channel.id}`;
    this._authClientId = channel.auth_client_id || `iac_ch_${channel.id}`;
    this.setStatus('starting');
    this._startTime = Date.now();
    this.log(`Iniciando IA Command WhatsApp no canal "${this._channelName}"...`, 'info');

    // Mata processos Chrome órfãos da sessão anterior antes de criar um novo cliente.
    // Evita o erro "The browser is already running for <userDataDir>".
    await this._killChromeForSession(this._authClientId);
    await new Promise(r => setTimeout(r, 6000));

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

    this.client.on('disconnected', (reason) => {
      clearTimers();
      this.setStatus('stopped');
      // reason pode ser: NAVIGATION, CONFLICT, UNLAUNCHED, UNPAIRED, LOGOUT, etc.
      this.log(`WhatsApp desconectado. Motivo: ${reason || 'desconhecido'}`, 'warning');
    });

    this.client.on('message', (msg) => this._handleMessage(msg).catch(err => {
      this.log(`Erro não capturado em _handleMessage: ${err.message}`, 'error');
    }));

    this.client.initialize().catch(async (err) => {
      clearTimers();
      this.client = null;
      this.setStatus('stopped');
      this.log(`Falha ao inicializar: ${err.message}`, 'error');
      await this._killChromeForSession(this._authClientId);
    });
  }

  // Mata processos Chrome e limpa arquivos de lock do userDataDir desta sessão (Windows).
  async _killChromeForSession(clientId) {
    const marker = `session-${String(clientId || '').replace(/['"\\]/g, '')}`;

    // 1. Mata processos Chrome via EncodedCommand (evita escaping no cmd.exe)
    await new Promise((resolve) => {
      const ps = `$cs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${marker}*' }; if ($cs) { $cs | ForEach-Object { & taskkill /PID $_.ProcessId /F /T } }`;
      const encoded = Buffer.from(ps, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, () => resolve());
    });

    // 2. Remove arquivos de lock que Chrome pode ter deixado no userDataDir
    const sessionDir = path.join(AUTH_BASE, marker);
    const lockFiles = [
      path.join(sessionDir, 'SingletonLock'),
      path.join(sessionDir, 'SingletonCookie'),
      path.join(sessionDir, 'SingletonSocket'),
      path.join(sessionDir, 'DevToolsActivePort'),
      path.join(sessionDir, 'Default', 'LOCK'),
    ];
    for (const f of lockFiles) {
      try { fs.unlinkSync(f); this.log(`Lock removido: ${path.basename(f)}`, 'info'); } catch (_) {}
    }
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

  async _sendChatMessageSafe(chat, texto) {
    const partes = _quebrarMensagemWhatsapp(texto);
    for (let i = 0; i < partes.length; i++) {
      const prefixo = partes.length > 1 ? `(${i + 1}/${partes.length})\n` : '';
      await chat.sendMessage(prefixo + partes[i]);
    }
    return partes.length;
  }

  async _sendReplyMessageSafe(chat, sender, texto) {
    const partes = _quebrarMensagemWhatsapp(texto);
    for (let i = 0; i < partes.length; i++) {
      const prefixo = partes.length > 1 ? `(${i + 1}/${partes.length})\n` : '';
      const parte = prefixo + partes[i];
      try {
        await chat.sendMessage(parte);
      } catch (chatErr) {
        if (!this.client) throw chatErr;
        this.log(`Envio pelo chat falhou; tentando envio direto para ${sender}: ${chatErr.message}`, 'warning');
        await this.client.sendMessage(sender, parte);
      }
    }
    return partes.length;
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
    delete ctx.lastIntentSeq;
    delete ctx.lastIntentEmpresaId;
    delete ctx.lastIntentChannelId;
    delete ctx.lastIntentsByScope;
    // Limpa buffers de histórico de todos os escopos
    for (const key of Object.keys(ctx)) {
      if (key.startsWith('_history_')) delete ctx[key];
    }
    this._setSenderContext(sender, ctx);
  }

  // Limpa apenas os campos de lastIntent sem apagar o histórico de consultas.
  // Usado na transição __all__ → empresa específica: o usuário refinando o escopo
  // não deve perder o histórico para o IA-OWNER herdar período e contexto.
  _clearLastIntentSemHistorico(sender) {
    const ctx = this._getSenderContext(sender);
    if (!ctx) return;
    delete ctx.lastIntent;
    delete ctx.lastIntentTs;
    delete ctx.lastIntentSeq;
    delete ctx.lastIntentEmpresaId;
    delete ctx.lastIntentChannelId;
    delete ctx.lastIntentsByScope;
    this._setSenderContext(sender, ctx);
  }

  _intentPermiteFallbackContexto(intent = {}) {
    const nome = String(intent.intencao || '').toLowerCase();
    const acao = String(intent.acao || '').toLowerCase();
    // Fluxos text-to-SQL dinamicos podem continuar contexto em mensagens curtas
    // de refinamento; o merger valida troca de dominio/entidade antes da execucao.
    if (acao === 'ai_text_to_sql') return false;
    return true;
  }

  _isPedidoContinuacaoAnalitica(texto) {
    const normalizado = String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    if (!normalizado) return false;

    const temAgrupamento = /\bpor\s+(dia|dias|mes|meses|ano|anos|cliente|clientes|produto|produtos|vendedor|vendedores|fornecedor|fornecedores|documento|documentos|titulo|titulos|duplicata|duplicatas|empresa|empresas|filial|filiais|loja|lojas|unidade|unidades)\b/.test(normalizado)
      || /\b(dia|mes|ano)\s+a\s+\1\b/.test(normalizado);
    const temAcaoContinuacao = /^(?:me\s+|por\s+favor[\s,]+)?(detalhe|detalha|detalhar|detalhes|quebra|quebre|abrir|abra|mostra|mostre|liste|listar)/.test(normalizado)
      || /^(e\s+|agora\s+|tambem\s+|so\s+|somente\s+|apenas\s+)/.test(normalizado);
    const curtoSomenteAgrupamento = /^por\s+(dia|dias|mes|meses|ano|anos|cliente|clientes|produto|produtos|vendedor|vendedores|fornecedor|fornecedores|documento|documentos|titulo|titulos|duplicata|duplicatas|empresa|empresas|filial|filiais|loja|lojas|unidade|unidades)\b/.test(normalizado);
    const temComparativo = /\b(crescimento|cresceu|cresceram|comparativo|comparar|compare|comparacao|evolucao|variacao|aumento|queda)\b/.test(normalizado)
      && /\b(faturamento|vendas?|receita|mes|meses|ano|anos|periodo)\b/.test(normalizado);

    return temComparativo || (temAgrupamento && (temAcaoContinuacao || curtoSomenteAgrupamento));
  }

  _devePreservarContextoAnalitico(ctx, texto) {
    if (!ctx?.lastIntent) return false;
    if (String(ctx.lastIntentChannelId || '') !== String(this._channelId || '')) return false;
    if (!this._intentPermiteFallbackContexto(ctx.lastIntent)) return false;
    // Intents _dinamico podem ser continuados — o safety valve contra cruzamento de
    // dominio fica no merger (confianca >= 0.85 com intencao diferente -> reset).
    return this._isPedidoContinuacaoAnalitica(texto);
  }

  _getScopedLastIntent(sender, empresaId, opts = {}) {
    const ctx = this._getSenderContext(sender);
    const intent = ctx?.lastIntent || null;
    if (!intent && !ctx?.lastIntentsByScope) return { intent: null, ts: 0 };

    const sameEmpresa = String(ctx.lastIntentEmpresaId || '') === String(empresaId);
    const sameChannel = String(ctx.lastIntentChannelId || '') === String(this._channelId || '');
    if (intent && sameEmpresa && sameChannel) return { intent, ts: ctx.lastIntentTs || 0 };

    if (!opts.allowCompatibleFallback || !this._isPedidoContinuacaoAnalitica(opts.texto)) {
      return { intent: null, ts: 0 };
    }

    const scopesMesmoCanal = Object.values(ctx.lastIntentsByScope || {})
      .filter(entry => entry?.intent && String(entry.channelId || '') === String(this._channelId || ''))
      .sort((a, b) => (b.seq || 0) - (a.seq || 0) || (b.ts || 0) - (a.ts || 0));

    // Para mensagens de continuacao, intents _dinamico sao candidatos validos.
    // O merger tem o safety valve: intencao diferente com confianca >= 0.85 reseta o contexto.
    const ehContinuacao = this._isPedidoContinuacaoAnalitica(opts.texto);
    if (scopesMesmoCanal[0] && !this._intentPermiteFallbackContexto(scopesMesmoCanal[0].intent)) {
      return { intent: null, ts: 0 };
    }

    const target = String(empresaId);
    const scopes = scopesMesmoCanal
      .filter(entry => this._intentPermiteFallbackContexto(entry.intent))
      .sort((a, b) => {
        if (target === '__all__') {
          return (b.seq || 0) - (a.seq || 0) || (b.ts || 0) - (a.ts || 0);
        }
        const scopeA = String(a.empresaId || '');
        const scopeB = String(b.empresaId || '');
        const scoreA = scopeA === '__all__' ? 2 : scopeA === target ? 1 : 0;
        const scoreB = scopeB === '__all__' ? 2 : scopeB === target ? 1 : 0;
        return scoreB - scoreA || (b.seq || 0) - (a.seq || 0) || (b.ts || 0) - (a.ts || 0);
      });

    const candidato = scopes.find(entry => {
      const scope = String(entry.empresaId || '');
      return scope === '__all__' || target === '__all__' || scope === target;
    });

    if (!candidato) return { intent: null, ts: 0 };
    return { intent: candidato.intent, ts: candidato.ts || 0, fallbackEscopo: true, empresaIdOrigem: candidato.empresaId };
  }

  _saveLastIntent(sender, intent, empresaId) {
    const ctx = this._getSenderContext(sender) || {};
    const scope = String(empresaId);
    const seq = (ctx.lastIntentSeq || 0) + 1;
    const ts = Date.now();

    // Rolling buffer: tamanho lido da config; fallback 5 para não guardar menos do que necessário
    const HISTORY_MAX = this._historicoTurnosConfig(empresaId);
    const historyKey = `_history_${scope}`;
    const historicoEscopo = Array.isArray(ctx[historyKey]) ? ctx[historyKey] : [];
    const novaEntrada = {
      ts,
      seq,
      mensagem: intent._mensagemOriginal || '',
      intencao: intent.intencao || 'desconhecido',
      modulo: intent._moduloDinamico || intent._orquestradorContrato?.modulo || null,
      periodo: intent.periodo ? { tipo: intent.periodo.tipo, dataInicio: intent.periodo.dataInicio || intent.periodo.data_inicio, dataFim: intent.periodo.dataFim || intent.periodo.data_fim } : null,
      filtros: intent.filtros || {},
      agrupamento: Array.isArray(intent.group_by) && intent.group_by.length ? intent.group_by : (intent.agrupar_por ? [intent.agrupar_por] : []),
      operacao: intent._orquestradorContrato?.operacao || null,
      carteira: intent._orquestradorContrato?.carteira || null,
      estado: intent._orquestradorContrato?.estado || null,
      fluxoTipo: intent._orquestradorContrato?.fluxoTipo || null,
      contrato_orquestrador: intent._orquestradorContrato || null,
      herdou_contexto: !!intent._orquestradorContrato?.herdou_contexto,
      contexto_usado: intent._orquestradorContrato?.contexto_usado || null,
      ordenar_por: intent.ordenar_por || null,
      limite: intent.limite || null,
      entidades_resolvidas: Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : [],
      entidades_resolvidas_por_empresa: intent._entidadesResolvidasPorEmpresa || null,
    };
    const historicoAtualizado = [...historicoEscopo, novaEntrada].slice(-HISTORY_MAX);

    const lastIntentsByScope = {
      ...(ctx.lastIntentsByScope || {}),
      [scope]: {
        intent,
        ts,
        seq,
        empresaId: scope,
        channelId: this._channelId || null,
      },
    };
    this._setSenderContext(sender, {
      lastIntent: intent,
      lastIntentTs: ts,
      lastIntentSeq: seq,
      lastIntentEmpresaId: empresaId,
      lastIntentChannelId: this._channelId || null,
      lastIntentsByScope,
      [historyKey]: historicoAtualizado,
    });
  }

  _intentComContextoDoResultado(intent, resultado, empresaId = null) {
    const enriquecido = { ...(intent || {}) };
    if (Array.isArray(resultado?._entidadesResolvidas) && resultado._entidadesResolvidas.length) {
      enriquecido._entidadesResolvidas = resultado._entidadesResolvidas;
      if (empresaId != null) {
        enriquecido._entidadesResolvidasPorEmpresa = {
          ...(enriquecido._entidadesResolvidasPorEmpresa || {}),
          [String(empresaId)]: resultado._entidadesResolvidas,
        };
      }
    }
    if (resultado?._contextoIAAnterior) {
      enriquecido._contextoIAAnterior = resultado._contextoIAAnterior;
    }
    // Propaga o SQL canônico para o próximo turno poder herdar a estrutura exata
    // (evita que a IA-OWNER regenere do zero ao receber pedidos de reordenamento/refinamento)
    if (resultado?._sql_canonico_original) {
      enriquecido._sqlCanonicoOriginal = resultado._sql_canonico_original;
    } else if (resultado?._sql_canonico) {
      enriquecido._sqlCanonicoOriginal = resultado._sql_canonico;
    }
    return enriquecido;
  }

  _historicoTurnosConfig(empresaId) {
    try {
      const { getDB } = require('../database');
      const row = getDB().prepare('SELECT historico_turnos FROM ai_config WHERE empresa_id = ? LIMIT 1').get(empresaId);
      const val = parseInt(row?.historico_turnos, 10);
      if (!isNaN(val) && val >= 1 && val <= 10) return val;
    } catch (_) {}
    return 5;
  }

  _buildHistoricoResumido(sender, empresaId, n = 5) {
    const ctx = this._getSenderContext(sender);
    if (!ctx) return [];
    const scope = String(empresaId);
    const historyKey = `_history_${scope}`;
    let historico = Array.isArray(ctx[historyKey]) ? ctx[historyKey] : [];
    // Fallback: se histórico da empresa está vazio, tenta o escopo __all__ (para queries cross-pipeline)
    if (!historico.length && scope !== '__all__') {
      const allHistory = ctx['_history___all__'];
      if (Array.isArray(allHistory) && allHistory.length) historico = allHistory;
    }
    return historico.slice(-n).map((entry, idx) => ({
      turno: idx + 1,
      pergunta: entry.mensagem,
      funcao: entry.intencao,
      modulo: entry.modulo || null,
      periodo: entry.periodo,
      filtros: Object.keys(entry.filtros || {}).length ? entry.filtros : null,
      agrupamento: entry.agrupamento.length ? entry.agrupamento : null,
      operacao: entry.operacao || entry.contrato_orquestrador?.operacao || null,
      carteira: entry.carteira || entry.contrato_orquestrador?.carteira || null,
      estado: entry.estado || entry.contrato_orquestrador?.estado || null,
      fluxoTipo: entry.fluxoTipo || entry.contrato_orquestrador?.fluxoTipo || null,
      contrato_orquestrador: (() => {
        const co = entry.contrato_orquestrador;
        if (!co) return null;
        const { periodo: _p, justificativa: _j, contexto_usado: _cu, ...coLimpo } = co;
        return coLimpo;
      })(),
      herdou_contexto: !!entry.herdou_contexto,
      contexto_usado: entry.contexto_usado || null,
      ordenar_por: entry.ordenar_por || null,
      limite: entry.limite || null,
      entidades_resolvidas: Array.isArray(entry.entidades_resolvidas) && entry.entidades_resolvidas.length ? entry.entidades_resolvidas : null,
      entidades_resolvidas_por_empresa: entry.entidades_resolvidas_por_empresa || null,
    }));
  }

  // Recupera entidades já resolvidas em turnos anteriores do histórico que correspondem
  // aos filtros do intent atual. Evita re-desambiguação quando o orchestrador herda filtros
  // de turnos antigos mas o lastIntent mais recente não tinha entidades resolvidas.
  _recuperarEntidadesDoHistorico(filtros, historico) {
    if (!Array.isArray(historico) || !historico.length) return [];
    const filtrosEntries = Object.entries(filtros || {}).filter(([, v]) => v);
    if (!filtrosEntries.length) return [];
    for (let i = historico.length - 1; i >= 0; i--) {
      const turno = historico[i];
      if (!Array.isArray(turno.entidades_resolvidas) || !turno.entidades_resolvidas.length) continue;
      const filtrosTurno = turno.filtros || {};
      const todosCorrespondem = filtrosEntries.every(([k, v]) => {
        const vTurno = filtrosTurno[k];
        if (!vTurno) return false;
        return String(v).toLowerCase() === String(vTurno).toLowerCase();
      });
      if (todosCorrespondem) return turno.entidades_resolvidas;
    }
    return [];
  }

  _isPedidoPorEmpresa(texto) {
    const normalizado = String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /\bpor\s+empresas?\b/.test(normalizado);
  }

  _isPedidoTodasEmpresas(texto) {
    const normalizado = String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /\b(?:todas?|ambas?|todos|ambos|all)\s+(?:as\s+|os\s+)?(?:empresas?|companhias?|tenants?)\b/.test(normalizado)
      || /\b(?:empresas?|companhias?|tenants?)\s+(?:todas?|ambas?|todos|ambos)\b/.test(normalizado)
      || /\b(?:consolidado|geral)\s+(?:das\s+|de\s+)?(?:empresas?|companhias?|tenants?)\b/.test(normalizado);
  }

  _resolverEmpresaQualificadaNoTexto(texto, empresas = []) {
    const original = String(texto || '');
    const normalizado = _normalizarBuscaEmpresa(original);
    if (!/\bempresas?\b/.test(normalizado)) return null;
    if (/\bclientes?\s+(?:da|de|do|na|no)?\s*empresa\b/.test(normalizado)) return null;

    const m = original.match(/\bempresas?\s+(?:(?:da|de|do|na|no|a|o)\s+)?([A-Za-z0-9][A-Za-z0-9 .&_-]{1,60})/i);
    if (!m) return null;
    let termo = String(m[1] || '')
      .replace(/\b(em|no|na|nos|nas|de|do|da|dos|das|por|com|agrupad[oa]s?|mostrando|mostre|ano|mes|m[eê]s|periodo|per[ií]odo|cliente|clientes)\b[\s\S]*$/i, '')
      .trim();
    if (!termo || termo.length < 2) return null;

    const candidatos = (empresas || [])
      .map(empresa => ({ empresa, score: _scoreEmpresaTexto(termo, empresa) }))
      .filter(x => x.score >= 0.75)
      .sort((a, b) => b.score - a.score);

    if (!candidatos.length) return { status: 'not_found', termo };
    if (candidatos.length > 1 && candidatos[0].score === candidatos[1].score) {
      return {
        status: 'ambiguous',
        termo,
        empresas: candidatos.map(c => c.empresa),
      };
    }
    return {
      status: 'resolved',
      empresa: candidatos[0].empresa,
      empresaId: candidatos[0].empresa.empresa_id,
      termo,
      score: candidatos[0].score,
    };
  }

  // Reconhece a empresa pelo ALIAS curto cadastrado (ex: "J2A", "C3I") como palavra isolada
  // no texto, sem exigir a palavra "empresa" antes (ex: "o valor da J2A veio errado").
  // Restrito a alias (nao ao nome completo) para evitar falso positivo com palavras comuns
  // que poderiam aparecer em nomes completos de empresa.
  _resolverEmpresaPorAliasIsolado(texto, empresas = []) {
    const normalizado = _normalizarBuscaEmpresa(texto);
    if (!normalizado) return null;
    const tokens = new Set(normalizado.split(/\s+/).filter(Boolean));
    const candidatos = (empresas || []).filter(empresa => {
      const aliases = String(empresa?.aliases || '').split(',').map(a => _normalizarBuscaEmpresa(a)).filter(Boolean);
      return aliases.some(alias => tokens.has(alias));
    });
    if (!candidatos.length) return null;
    if (candidatos.length > 1) return { status: 'ambiguous', termo: candidatos.map(e => e.nome || e.empresa_id).join('/'), empresas: candidatos };
    return { status: 'resolved', empresa: candidatos[0], empresaId: candidatos[0].empresa_id, origem: 'alias_isolado' };
  }

  _resolverEmpresasQualificadasNoTexto(texto, empresas = []) {
    const original = String(texto || '');
    const normalizado = _normalizarBuscaEmpresa(original);
    if (!/\bempresas?\b/.test(normalizado)) return null;
    if (/\bclientes?\s+(?:da|de|do|na|no)?\s*empresa\b/.test(normalizado)) return null;

    const m = original.match(/\bempresas?\s+(?:(?:da|de|do|na|no|a|o)\s+)?([A-Za-z0-9][A-Za-z0-9 .,&/_-]{1,120})/i);
    if (!m) return null;

    const trecho = String(m[1] || '')
      .replace(/\b(no\s+ano|na\s+ano|em\s+(?:19|20)\d{2}|ano|mes|m[eê]s|periodo|per[ií]odo|por|com|agrupad[oa]s?|mostrando|mostre|cliente|clientes)\b[\s\S]*$/i, '')
      .trim();
    if (!trecho) return null;

    const termos = trecho
      .split(/\s*(?:,|\/|&|\be\b|\+)\s*/i)
      .map(t => t.trim())
      .filter(t => t.length >= 2);
    if (termos.length < 2) return null;

    const resolvidas = [];
    const naoResolvidos = [];
    const usados = new Set();
    for (const termo of termos) {
      const candidatos = (empresas || [])
        .map(empresa => ({ empresa, score: _scoreEmpresaTexto(termo, empresa) }))
        .filter(x => x.score >= 0.75)
        .sort((a, b) => b.score - a.score);
      if (!candidatos.length || (candidatos.length > 1 && candidatos[0].score === candidatos[1].score)) {
        naoResolvidos.push(termo);
        continue;
      }
      const empresaId = String(candidatos[0].empresa.empresa_id);
      if (usados.has(empresaId)) continue;
      usados.add(empresaId);
      resolvidas.push({
        empresa: candidatos[0].empresa,
        empresaId: candidatos[0].empresa.empresa_id,
        termo,
        score: candidatos[0].score,
      });
    }

    return {
      empresas: resolvidas.map(r => r.empresa),
      resolvidas,
      termos,
      naoResolvidos,
    };
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

  _isIntentAiSqlDinamica(intent = {}) {
    const nome = String(intent.intencao || '').toLowerCase();
    const acao = String(intent.acao || '').toLowerCase();
    return acao === 'ai_text_to_sql' || intent._dynamicAiScope || nome.endsWith('_dinamico');
  }

  // ── Fallback de continuidade ──────────────────────────────────────────────

  // Verifica se o intent pertence a um módulo ERP dinâmico (faturamento, compras, etc.)
  _ehIntentDinamica(intent) {
    if (!intent) return false;
    const modulo = String(intent._moduloDinamico || intent.intencao || '')
      .replace('_dinamico', '').toLowerCase();
    return ['faturamento', 'compras', 'financeiro', 'comissao'].includes(modulo);
  }

  // Constrói um intent de continuidade a partir do contexto anterior + mensagem nova.
  // A IA-OWNER receberá a mensagem atual + histórico e decidirá se é continuidade real.
  _buildIntentContinuidade(contextoAnterior, intentOriginal, mensagemAtual) {
    return {
      ...contextoAnterior,
      _mensagemOriginal: mensagemAtual,
      _herdouContextoOrquestrador: true,
      _tentativaContinuidade: true,
      _nivel_contexto: (contextoAnterior._nivel_contexto || 1) + 1,
      _remetente: intentOriginal._remetente || contextoAnterior._remetente,
      _historicoResumido: intentOriginal._historicoResumido || null,
      _entidadesResolvidas: intentOriginal._entidadesResolvidas || contextoAnterior._entidadesResolvidas || [],
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

  _detectarAgrupamentoTemporalRows(rows) {
    if (!rows || !rows.length) return null;
    if (_extrairMes(rows[0])) return 'mes';
    if (_extrairAno(rows[0])) return 'ano';
    // Quando não há coluna temporal, tenta detectar dimensão categórica (vendedor, fornecedor, etc.)
    return detectarDimensaoCategorica(rows[0]);
  }

  _formatarConsolidadoDinamicoAll(intent, sucessos = [], empresaLogId = null) {
    if (!sucessos || !sucessos.length) return '';

    const _RE_SOMAVEL     = /valor|total|saldo|salatua|juros|multa|desconto|vlr|vl_|brut|liquido|comiss|qtd|quantidade|qt_|fatura|receita|fat_|compra|pedido/i;
    const _RE_QUANTIDADE  = /qtd|quantidade|qt_/i;
    const _RE_MEDIA       = /media|medio|ticket|avg|pct|percent|taxa/i;
    // Inclui ano_mes (AAAAMM do Protheus), aaaa_mm, competencia, referencia, além dos genéricos
    const _RE_DIMENSAO    = /^(ano_mes|aaaamm|aaaa_mm|competencia|competência|referencia|referência|ano|mes|mes_ano|periodo|data|dia|trimestre|semestre|categoria|tipo|grupo|filial|uf)$/i;
    // Subconjunto temporal da dimensão — determina ordenação cronológica e recálculo de crescimento
    const _RE_TEMPORAL    = /^(ano_mes|aaaamm|aaaa_mm|competencia|competência|referencia|referência|mes_ano|periodo|data|dia|mes|ano)$/i;
    // Colunas de crescimento/variação percentual — recalculadas sobre o consolidado, nunca somadas
    const _RE_CRESCIMENTO = /crescimento|variacao|variação|cresc/i;

    const _brl = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const _num = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const _fmt = (col, v) => _RE_QUANTIDADE.test(col) ? _num(v) : _brl(v);
    const _fmtPct = v => {
      if (v == null || isNaN(v)) return 'N/A';
      const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return v >= 0 ? `+${s}%` : `-${s}%`;
    };

    const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const _formatLabel = (v, ehTemporal) => {
      if (!ehTemporal) return String(v || '').trim();
      const s = String(v || '').trim();
      if (/^\d{6}$/.test(s)) {                    // AAAAMM → ex: 202501
        const mes = parseInt(s.slice(4, 6), 10);
        if (mes >= 1 && mes <= 12) return `${MESES_FULL[mes - 1]}/${s.slice(0, 4)}`;
      }
      if (/^\d{4}-\d{2}$/.test(s)) {              // AAAA-MM → ex: 2025-01
        const mes = parseInt(s.slice(5, 7), 10);
        if (mes >= 1 && mes <= 12) return `${MESES_FULL[mes - 1]}/${s.slice(0, 4)}`;
      }
      return s;
    };

    const firstRow = (sucessos[0]?.rows || [])[0] || null;
    if (!firstRow) {
      const total = sucessos.reduce((a, s) => a + (s.rows || []).length, 0);
      if (total === 0) return '';
    }

    // Colunas auxiliares de cálculo (ex: faturamento_ano_anterior) — excluídas do output
    const _RE_SKIP_CALC  = /_anterior$/i;
    const _RE_DOCUMENTO  = /^(documento|doc|nota|nota_fiscal|nf|nfe|titulo|duplicata|f2_doc|d2_doc|e1_num|e2_num)$/i;
    // Colunas de entidade categórica (vendedor, cliente, produto, etc.) — usadas como dimensão de agrupamento
    const _RE_ENTIDADE   = /^(vendedor|fornecedor|cliente|produto|servico|serviço|funcionario|funcionário|unidade|empresa|depto|departamento|cc|centro|nome|descri)/i;
    // Deriva label legível da coluna de entidade para o título do ranking
    const _labelEntidade = col => {
      const k = String(col || '').toLowerCase();
      if (/^vendedor/.test(k))    return 'Vendedor';
      if (/^fornecedor/.test(k))  return 'Fornecedor';
      if (/^cliente/.test(k))     return 'Cliente';
      if (_RE_DOCUMENTO.test(k))  return 'Documento';
      if (/^produto/.test(k))     return 'Produto';
      if (/^servi/.test(k))       return 'Serviço';
      if (/^funciona/.test(k))    return 'Funcionário';
      if (/^empresa/.test(k))     return 'Empresa';
      if (/^(depto|departamento)/.test(k)) return 'Departamento';
      if (/^filial/.test(k))      return 'Filial';
      if (/^unidade/.test(k))     return 'Unidade';
      return col.charAt(0).toUpperCase() + col.slice(1);
    };
    const cols = firstRow ? Object.keys(firstRow) : [];
    const colsDimensao   = cols.filter(k => _RE_DIMENSAO.test(k));
    // Varre até 20 linhas para detectar numéricos (mesma lógica do whatsapp-format-prompt)
    const allRows        = sucessos.flatMap(s => (s.rows || []).slice(0, 20));
    const colsSomaveis   = cols.filter(k => _RE_SOMAVEL.test(k) && !_RE_MEDIA.test(k)
      && !_RE_SKIP_CALC.test(k)
      && !colsDimensao.includes(k)
      && allRows.some(r => typeof r[k] === 'number' || (typeof r[k] === 'string' && r[k] !== '' && !isNaN(parseFloat(r[k])))));
    const colsMediaDisp  = cols.filter(k => _RE_MEDIA.test(k)
      && !_RE_SKIP_CALC.test(k)
      && !colsDimensao.includes(k)
      && allRows.some(r => typeof r[k] === 'number' || (typeof r[k] === 'string' && r[k] !== '' && !isNaN(parseFloat(r[k])))));
    const colsCrescimento = cols.filter(k => _RE_CRESCIMENTO.test(k) && !colsDimensao.includes(k) && !colsSomaveis.includes(k));
    // Colunas de entidade: não numéricas, não dimensão temporal, não skip
    const colsEntidade   = cols.filter(k =>
      (_RE_ENTIDADE.test(k) || _RE_DOCUMENTO.test(k))
      && !_RE_SOMAVEL.test(k)
      && !_RE_SKIP_CALC.test(k)
      && !colsDimensao.includes(k)
      && !colsSomaveis.includes(k)
    );

    // Coluna companheira da entidade principal (ex: unidade de medida "H", "UN")
    // Fundida no rótulo do item como "PRODUTO (UM)"
    const _RE_COMPANION_KEY = /^(unidade|unid|um|medida|un_medida|un_med|unidade_de_medida|un_de_medida|und_medida|unidade_medida|unit|ume)$/i;
    // Fallback por valor: coluna cujos valores são códigos curtos em maiúsculas (H, UN, KG…)
    const _isCompVal = k => {
      const sample = sucessos.flatMap(s => (s.rows || []).slice(0, 10)).map(r => String(r[k] || '').trim()).filter(Boolean);
      return sample.length >= 2 && sample.every(v => /^[A-Z]{1,6}$/.test(v));
    };
    const companionKey = cols.find(k =>
      _RE_COMPANION_KEY.test(k)
      && !colsDimensao.includes(k)
      && !colsSomaveis.includes(k)
      && (colsEntidade.length === 0 || !colsEntidade.slice(0, 1).includes(k))
    ) || cols.find(k =>
      !_RE_DIMENSAO.test(k) && !_RE_ENTIDADE.test(k) && !_RE_DOCUMENTO.test(k) && !colsSomaveis.includes(k) && !colsDimensao.includes(k) && _isCompVal(k)
    ) || null;
    // Helper: monta rótulo com companion quando presente
    const _entLabel = (row, eKey) => {
      const rawEnt  = String(row[eKey] ?? '').trim();
      const rawComp = companionKey ? String(row[companionKey] ?? '').trim() : '';
      return (rawComp && rawComp !== rawEnt) ? `${rawEnt} (${rawComp})` : rawEnt;
    };

    const _subtituloConsolidado = (() => {
      const msg = String(intent._mensagemOriginal || '').trim();
      if (!msg) return null;
      return msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
    })();
    const linhas = ['*Consolidado — Todas as empresas*', _subtituloConsolidado ? `_${_subtituloConsolidado}_` : null].filter(Boolean);

    // Modo dupla dimensão: mes + ano como colunas separadas (ex: "por mês e por ano")
    const _dimMesKey = cols.find(k => /^mes$/i.test(k));
    const _dimAnoKey = cols.find(k => /^ano$/i.test(k));

    const MESES_ORD  = ['janeiro','fevereiro','março','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const _mesOrd    = v => { const s = String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); const idx = MESES_ORD.indexOf(s); if (idx>=0) return idx+1; const n=parseInt(s,10); return (n>=1&&n<=12)?n:99; };
    const _labelMes  = v => { const n=parseInt(String(v||'').trim(),10); return (n>=1&&n<=12) ? MESES_FULL[n-1] : (String(v||'').trim().charAt(0).toUpperCase()+String(v||'').trim().slice(1).toLowerCase()); };

    const _isMediaPeriodo = /\b(media|medio|m[eÃ©]dia|m[eÃ©]dio)\b/i.test(String(intent?._mensagemOriginal || ''))
      || String(intent?.operacao || '').toLowerCase() === 'media'
      || String(intent?.operacao_analitica?.operacao || '').toLowerCase() === 'media';
    const _periodKeyMedia = row => {
      if (_dimMesKey && _dimAnoKey) {
        const ano = String(row[_dimAnoKey] ?? '').trim();
        const mes = String(parseInt(String(row[_dimMesKey] ?? '').trim(), 10)).padStart(2, '0');
        if (/^\d{4}$/.test(ano) && /^\d{2}$/.test(mes)) return `${ano}${mes}`;
      }
      const temporalKey = colsDimensao.find(k => _RE_TEMPORAL.test(k));
      return temporalKey ? String(row[temporalKey] ?? '').trim() : '';
    };
    const _parseMoedaPtBr = valor => {
      const s = String(valor || '').replace(/\s/g, '').replace(/[^\d,.-]/g, '');
      if (!s) return 0;
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    };
    const _extrairItensRespostaEmpresa = resposta => {
      const itens = [];
      for (const linha of String(resposta || '').split(/\r?\n/)) {
        const limpa = linha.trim();
        if (!/^\d+\./.test(limpa)) continue;
        if (/subtotal|total\s+geral/i.test(limpa)) continue;
        const m = limpa.match(/^\d+\.\s+\*?(.+?)\*?\s*[:—-]\s*(?:\*?R\$\s*([\d.\s\u00a0]+,\d{2})\*?)/i);
        if (!m) continue;
        const rotulo = String(m[1] || '').replace(/\*/g, '').trim();
        if (!rotulo || /^geral$/i.test(rotulo)) continue;
        itens.push({ rotulo, valor: _parseMoedaPtBr(m[2]) });
      }
      return itens;
    };
    const _formatarConsolidadoPorItensResposta = () => {
      const porProduto = new Map();
      for (const s of sucessos) {
        for (const item of _extrairItensRespostaEmpresa(s.resposta)) {
          if (!porProduto.has(item.rotulo)) porProduto.set(item.rotulo, { total: 0, empresas: new Map() });
          const grupo = porProduto.get(item.rotulo);
          grupo.total += item.valor;
          grupo.empresas.set(s.nomeEmpresa, (grupo.empresas.get(s.nomeEmpresa) || 0) + item.valor);
        }
      }
      if (!porProduto.size) return null;

      const entradas = [...porProduto.entries()].sort(([, a], [, b]) => b.total - a.total);
      const out = [];
      entradas.slice(0, 50).forEach(([produto, grupo], idx) => {
        out.push(`${idx + 1}. *${produto}*: *${_brl(grupo.total)}*`);
        for (const [empresa, valor] of grupo.empresas) {
          out.push(`   \u{1F3E2} ${empresa}: *${_brl(valor)}*`);
        }
      });
      if (entradas.length > 50) out.push(`... e mais ${entradas.length - 50}`);
      const total = entradas.reduce((acc, [, grupo]) => acc + grupo.total, 0);
      out.push('');
      out.push(`\u{1F9FE} *Total Geral*: *${_brl(total)}*`);
      return out.join('\n');
    };

    if (_isMediaPeriodo && colsEntidade.length > 0 && colsSomaveis.length > 0 && sucessos.some(s => (s.rows || []).some(r => _periodKeyMedia(r)))) {
      // Media consolidada correta: soma empresas por periodo e so depois calcula a media por entidade.
      const entKey = colsEntidade.find(k => /^produto/i.test(k)) || colsEntidade[0];
      const periodos = new Set();
      const porEnt = new Map();
      const totalPorPeriodo = new Map();

      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const ent = _entLabel(row, entKey) || '(outros)';
          const periodo = _periodKeyMedia(row);
          if (!periodo) continue;
          periodos.add(periodo);
          if (!porEnt.has(ent)) porEnt.set(ent, new Map());
          const porPeriodo = porEnt.get(ent);
          if (!porPeriodo.has(periodo)) porPeriodo.set(periodo, {});
          if (!totalPorPeriodo.has(periodo)) totalPorPeriodo.set(periodo, {});
          const grupo = porPeriodo.get(periodo);
          const totalPeriodo = totalPorPeriodo.get(periodo);
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) {
              grupo[col] = (grupo[col] || 0) + v;
              totalPeriodo[col] = (totalPeriodo[col] || 0) + v;
            }
          }
        }
      }

      const periodosOrdenados = [...periodos].sort();
      const divisor = periodosOrdenados.length || 1;
      const primaryCol = colsSomaveis[0];
      const entradas = [...porEnt.entries()].map(([ent, porPeriodo]) => {
        const medias = {};
        for (const col of colsSomaveis) {
          const somaPeriodos = periodosOrdenados.reduce((acc, periodo) => acc + (porPeriodo.get(periodo)?.[col] || 0), 0);
          medias[col] = somaPeriodos / divisor;
        }
        return [ent, medias];
      }).sort(([, a], [, b]) => (b[primaryCol] || 0) - (a[primaryCol] || 0));

      linhas.push(`*Media consolidada por ${_labelEntidade(entKey)}*`);
      entradas.slice(0, 50).forEach(([ent, medias], i) => {
        const vals = colsSomaveis.map(col => `*${_fmt(col, medias[col] || 0)}*`).join(' | ');
        linhas.push(`  ${i + 1}. ${ent}: ${vals}`);
      });
      if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);

      const mediaGeral = {};
      for (const col of colsSomaveis) {
        const somaPeriodos = periodosOrdenados.reduce((acc, periodo) => acc + (totalPorPeriodo.get(periodo)?.[col] || 0), 0);
        mediaGeral[col] = somaPeriodos / divisor;
      }
      const geralStr = colsSomaveis.map(col => `*${_fmt(col, mediaGeral[col] || 0)}*`).join(' | ');
      linhas.push('');
      linhas.push(`Media Geral Consolidada: ${geralStr}`);
      linhas.push(`_Base: ${divisor} periodo(s), somando todas as empresas antes da media._`);

    } else if (_dimMesKey && _dimAnoKey && colsSomaveis.length > 0) {
      // Consolida somando faturamento por (mes, ano) em todas as empresas
      const primaryCol = colsSomaveis[0];
      const porMes = new Map();   // mes → Map<ano, {col: total}>

      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const mesVal = String(row[_dimMesKey] ?? '').trim();
          const anoVal = String(row[_dimAnoKey] ?? '').trim();
          if (!mesVal || !anoVal) continue;
          if (!porMes.has(mesVal)) porMes.set(mesVal, new Map());
          const porAno = porMes.get(mesVal);
          if (!porAno.has(anoVal)) porAno.set(anoVal, {});
          const grupo = porAno.get(anoVal);
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
          }
        }
      }

      // Ordena meses calendário
      const entradasMes  = [...porMes.entries()].sort(([a],[b]) => _mesOrd(a) - _mesOrd(b));
      const totalGeral   = {};
      const totalPorAno  = new Map();   // ano → { col: total } — para o resumo final
      for (const col of colsSomaveis) totalGeral[col] = 0;

      for (const [mesVal, porAno] of entradasMes) {
        const labelMes   = _labelMes(mesVal);
        linhas.push(`🗓 *${labelMes}*`);

        // Ordena anos crescente
        const anosOrdenados = [...porAno.entries()].sort(([a],[b]) => parseInt(a) - parseInt(b));

        let totalMes = {};
        for (const col of colsSomaveis) totalMes[col] = 0;

        anosOrdenados.forEach(([anoVal, grupo], idx) => {
          const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
          let crescStr = '';
          if (idx === 0) {
            crescStr = ' | Crescimento: N/A';
          } else {
            const atual    = grupo[primaryCol]                     || 0;
            const anterior = anosOrdenados[idx - 1][1][primaryCol] || 0;
            const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
            crescStr = ' | Crescimento: ' + _fmtPct(pct);
          }
          linhas.push(`  ${idx + 1}. ${anoVal}: ${vals}${crescStr}`);
          for (const col of colsSomaveis) totalMes[col] = (totalMes[col] || 0) + (grupo[col] || 0);

          // Acumula total global por ano (para o resumo final)
          if (!totalPorAno.has(anoVal)) { const init = {}; for (const c of colsSomaveis) init[c] = 0; totalPorAno.set(anoVal, init); }
          const anoAcc = totalPorAno.get(anoVal);
          for (const col of colsSomaveis) anoAcc[col] = (anoAcc[col] || 0) + (grupo[col] || 0);
        });

        const subStr = colsSomaveis.map(col => `*${_fmt(col, totalMes[col] || 0)}*`).join(' | ');
        linhas.push(`🧾 *Subtotal*: ${subStr}`);
        linhas.push('');

        for (const col of colsSomaveis) totalGeral[col] = (totalGeral[col] || 0) + totalMes[col];
      }

      const totStr = colsSomaveis.map(col => `*${_fmt(col, totalGeral[col] || 0)}*`).join(' | ');
      linhas.push(`*Total Geral*: ${totStr}`);

      // Resumo por ano: totais globais com crescimento calculado (divisão, não soma)
      const anosGlobais = [...totalPorAno.entries()].sort(([a],[b]) => parseInt(a) - parseInt(b));
      if (anosGlobais.length > 1) {
        linhas.push('');
        linhas.push('📊 *Resumo por Ano*');
        anosGlobais.forEach(([anoVal, totaisAno], idx) => {
          const vals = colsSomaveis.map(col => `*${_fmt(col, totaisAno[col] || 0)}*`).join(' | ');
          let crescStr = '';
          if (idx === 0) {
            crescStr = ' | Crescimento: N/A';
          } else {
            const atual    = totaisAno[primaryCol]                    || 0;
            const anterior = anosGlobais[idx - 1][1][primaryCol]      || 0;
            const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
            crescStr = ' | Crescimento: ' + _fmtPct(pct);
          }
          linhas.push(`  ${idx + 1}. ${anoVal}: ${vals}${crescStr}`);
        });
      }

      // Ranking por entidade (ex: vendedor) quando presente na query
      if (colsEntidade.length > 0) {
        const entCol     = colsEntidade[0];
        const primaryCol = colsSomaveis[0];
        const porEnt     = new Map();  // entidade → Map<ano, { col: total }>

        for (const s of sucessos) {
          for (const row of (s.rows || [])) {
            const ent = _entLabel(row, entCol);
            const ano = String(row[_dimAnoKey] ?? '').trim();
            if (!ent || !ano) continue;
            if (!porEnt.has(ent)) porEnt.set(ent, new Map());
            const porAno = porEnt.get(ent);
            if (!porAno.has(ano)) { const init = {}; for (const c of colsSomaveis) init[c] = 0; porAno.set(ano, init); }
            const grupo = porAno.get(ano);
            for (const col of colsSomaveis) {
              const v = parseFloat(row[col]);
              if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
            }
          }
        }

        if (porEnt.size > 0) {
          const entradas = [...porEnt.entries()].sort(([, a], [, b]) => {
            const ta = [...a.values()].reduce((s, g) => s + (g[primaryCol] || 0), 0);
            const tb = [...b.values()].reduce((s, g) => s + (g[primaryCol] || 0), 0);
            return tb - ta;
          });
          linhas.push('');
          linhas.push(`🏆 *Ranking por ${_labelEntidade(entCol)}*`);
          entradas.slice(0, 20).forEach(([ent, porAno], idx) => {
            const anosOrdenados = [...porAno.entries()].sort(([a], [b]) => parseInt(a) - parseInt(b));
            linhas.push(`  ${idx + 1}. *${ent}*`);
            anosOrdenados.forEach(([anoVal, grupo], i) => {
              const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
              const crescStr = i === 0 ? ' | Crescimento: N/A' : (() => {
                const atual    = grupo[primaryCol] || 0;
                const anterior = anosOrdenados[i - 1][1][primaryCol] || 0;
                const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
                return ' | Crescimento: ' + _fmtPct(pct);
              })();
              linhas.push(`     ${anoVal}: ${vals}${crescStr}`);
            });
          });
        }
      }

    } else if (colsDimensao.length > 0 && colsSomaveis.length > 0) {
      // Modo dimensional simples: agrupa por dimensão primária somando todas as empresas
      const dimKey    = colsDimensao[0];
      const ehTemporal = _RE_TEMPORAL.test(dimKey);
      const agrupado  = new Map();

      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const dim = String(row[dimKey] ?? '(outros)').trim();
          if (!agrupado.has(dim)) agrupado.set(dim, {});
          const grupo = agrupado.get(dim);
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
          }
        }
      }

      // Detecta AAAAMM multi-ano → modo mês-a-mês com comparação de anos
      const _dimVals      = [...agrupado.keys()];
      const _isAaaamm     = _dimVals.length > 0 && _dimVals.every(v => /^\d{6}$/.test(v));
      const _anosDistinct = _isAaaamm ? [...new Set(_dimVals.map(v => v.slice(0, 4)))] : [];

      if (_isAaaamm && _anosDistinct.length > 1) {
        // Agrupa por mês (MM) → ano (YYYY) reutilizando dados já somados no `agrupado`
        const MESES_FULL_L = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                              'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const primaryCol   = colsSomaveis[0];
        const porMes       = new Map();   // MM → Map<YYYY, { col: total }>
        const totalPorAno  = new Map();

        for (const [compet, grupo] of agrupado.entries()) {
          const mesKey = compet.slice(4, 6);
          const anoKey = compet.slice(0, 4);
          if (!porMes.has(mesKey)) porMes.set(mesKey, new Map());
          porMes.get(mesKey).set(anoKey, { ...grupo });
        }

        const entradasMes = [...porMes.entries()].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
        const totalGeral  = {};
        for (const col of colsSomaveis) totalGeral[col] = 0;

        for (const [mesKey, porAno] of entradasMes) {
          const mesNum   = parseInt(mesKey, 10);
          const labelMes = (mesNum >= 1 && mesNum <= 12) ? MESES_FULL_L[mesNum - 1] : mesKey;
          linhas.push(`🗓 *${labelMes}*`);

          const anosOrdenados = [...porAno.entries()].sort(([a], [b]) => parseInt(a) - parseInt(b));
          let totalMes = {};
          for (const col of colsSomaveis) totalMes[col] = 0;

          anosOrdenados.forEach(([anoVal, grupo], idx) => {
            const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
            let crescStr = '';
            if (idx === 0) {
              crescStr = ' | Crescimento: N/A';
            } else {
              const atual    = grupo[primaryCol] || 0;
              const anterior = anosOrdenados[idx - 1][1][primaryCol] || 0;
              const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
              crescStr = ' | Crescimento: ' + _fmtPct(pct);
            }
            linhas.push(`  ${idx + 1}. ${anoVal}: ${vals}${crescStr}`);
            for (const col of colsSomaveis) totalMes[col] = (totalMes[col] || 0) + (grupo[col] || 0);

            if (!totalPorAno.has(anoVal)) { const init = {}; for (const c of colsSomaveis) init[c] = 0; totalPorAno.set(anoVal, init); }
            const anoAcc = totalPorAno.get(anoVal);
            for (const col of colsSomaveis) anoAcc[col] = (anoAcc[col] || 0) + (grupo[col] || 0);
          });

          const subStr = colsSomaveis.map(col => `*${_fmt(col, totalMes[col] || 0)}*`).join(' | ');
          linhas.push(`🧾 *Subtotal*: ${subStr}`);
          linhas.push('');
          for (const col of colsSomaveis) totalGeral[col] = (totalGeral[col] || 0) + totalMes[col];
        }

        const totStr = colsSomaveis.map(col => `*${_fmt(col, totalGeral[col] || 0)}*`).join(' | ');
        linhas.push(`*Total Geral*: ${totStr}`);

        // Resumo por ano com crescimento calculado por divisão
        const anosGlobais = [...totalPorAno.entries()].sort(([a], [b]) => parseInt(a) - parseInt(b));
        if (anosGlobais.length > 1) {
          linhas.push('');
          linhas.push('📊 *Resumo por Ano*');
          anosGlobais.forEach(([anoVal, totaisAno], idx) => {
            const vals = colsSomaveis.map(col => `*${_fmt(col, totaisAno[col] || 0)}*`).join(' | ');
            let crescStr = '';
            if (idx === 0) {
              crescStr = ' | Crescimento: N/A';
            } else {
              const atual    = totaisAno[primaryCol] || 0;
              const anterior = anosGlobais[idx - 1][1][primaryCol] || 0;
              const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
              crescStr = ' | Crescimento: ' + _fmtPct(pct);
            }
            linhas.push(`  ${idx + 1}. ${anoVal}: ${vals}${crescStr}`);
          });
        }

        // Ranking por entidade (ex: vendedor) quando presente na query
        if (colsEntidade.length > 0) {
          const entCol     = colsEntidade[0];
          const primaryCol = colsSomaveis[0];
          const porEnt     = new Map();

          for (const s of sucessos) {
            for (const row of (s.rows || [])) {
              const ent    = _entLabel(row, entCol);
              const compet = String(row[dimKey] ?? '').trim();
              if (!ent || !/^\d{6}$/.test(compet)) continue;
              const ano = compet.slice(0, 4);
              if (!porEnt.has(ent)) porEnt.set(ent, new Map());
              const porAno = porEnt.get(ent);
              if (!porAno.has(ano)) { const init = {}; for (const c of colsSomaveis) init[c] = 0; porAno.set(ano, init); }
              const grupo = porAno.get(ano);
              for (const col of colsSomaveis) {
                const v = parseFloat(row[col]);
                if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
              }
            }
          }

          if (porEnt.size > 0) {
            const entradas = [...porEnt.entries()].sort(([, a], [, b]) => {
              const ta = [...a.values()].reduce((s, g) => s + (g[primaryCol] || 0), 0);
              const tb = [...b.values()].reduce((s, g) => s + (g[primaryCol] || 0), 0);
              return tb - ta;
            });
            linhas.push('');
            linhas.push(`🏆 *Ranking por ${_labelEntidade(entCol)}*`);
            entradas.slice(0, 20).forEach(([ent, porAno], idx) => {
              const anosOrdenados = [...porAno.entries()].sort(([a], [b]) => parseInt(a) - parseInt(b));
              linhas.push(`  ${idx + 1}. *${ent}*`);
              anosOrdenados.forEach(([anoVal, grupo], i) => {
                const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
                const crescStr = i === 0 ? ' | Crescimento: N/A' : (() => {
                  const atual    = grupo[primaryCol] || 0;
                  const anterior = anosOrdenados[i - 1][1][primaryCol] || 0;
                  const pct      = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
                  return ' | Crescimento: ' + _fmtPct(pct);
                })();
                linhas.push(`     ${anoVal}: ${vals}${crescStr}`);
              });
            });
          }
        }

      } else {
        // Modo dimensional simples (única dimensão ou não-AAAAMM)
        const entradas = [...agrupado.entries()];
        // Converte DD/MM/YYYY para YYYY-MM-DD para ordenação cronológica correta
        const _toSortKey = v => {
          const s = String(v || '');
          const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
        };
        if (ehTemporal) {
          entradas.sort(([a], [b]) => _toSortKey(a).localeCompare(_toSortKey(b)));
        } else if (colsSomaveis.length) {
          const colOrdem = colsSomaveis[0];
          entradas.sort(([, a], [, b]) => (b[colOrdem] || 0) - (a[colOrdem] || 0));
        }

        const primaryCol = colsSomaveis[0];
        if (colsCrescimento.length && ehTemporal && primaryCol) {
          for (let i = 0; i < entradas.length; i++) {
            const grupo = entradas[i][1];
            if (i === 0) {
              for (const col of colsCrescimento) grupo[col] = null;
            } else {
              const atual    = entradas[i][1][primaryCol]     || 0;
              const anterior = entradas[i - 1][1][primaryCol] || 0;
              for (const col of colsCrescimento) {
                grupo[col] = anterior !== 0 ? ((atual - anterior) / anterior) * 100 : null;
              }
            }
          }
        }

        entradas.forEach(([dim, grupo], i) => {
          const label    = _formatLabel(dim, ehTemporal);
          const vals     = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
          const crescStr = colsCrescimento.length
            ? ' | Crescimento: ' + colsCrescimento.map(col => _fmtPct(grupo[col])).join(' | ')
            : '';
          linhas.push(`  ${i + 1}. ${label}: ${vals}${crescStr}`);
        });

        linhas.push('');
        const totalGeral = {};
        for (const [, grupo] of entradas) {
          for (const col of colsSomaveis) totalGeral[col] = (totalGeral[col] || 0) + (grupo[col] || 0);
        }
        const totStr = colsSomaveis.map(col => `${col}: *${_fmt(col, totalGeral[col] || 0)}*`).join(' | ');
        linhas.push(`*Total geral: ${totStr}*`);
        linhas.push(`_${entradas.length} períodos consolidados_`);

        // Ranking por entidade acumulado (ex: produto) quando há dupla dimensão (temporal + entidade)
        if (colsEntidade.length > 0) {
          const entKey  = colsEntidade[0];
          const porEnt  = new Map();
          for (const s of sucessos) {
            for (const row of (s.rows || [])) {
              const ent = _entLabel(row, entKey);
              if (!ent) continue;
              if (!porEnt.has(ent)) porEnt.set(ent, {});
              const grupo = porEnt.get(ent);
              for (const col of colsSomaveis) {
                const v = parseFloat(row[col]);
                if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
              }
            }
          }
          if (porEnt.size > 0) {
            const primaryEntCol = colsSomaveis[0];
            const entradasEnt   = [...porEnt.entries()].sort(([, a], [, b]) => (b[primaryEntCol] || 0) - (a[primaryEntCol] || 0));
            linhas.push('');
            linhas.push(`📦 *Por ${_labelEntidade(entKey)} (Acumulado)*`);
            entradasEnt.slice(0, 20).forEach(([ent, grupo], idx) => {
              const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
              linhas.push(`  ${idx + 1}. ${ent}: ${vals}`);
            });
            if (entradasEnt.length > 20) linhas.push(`  ... e mais ${entradasEnt.length - 20}`);
            const totalEnt = {};
            for (const [, grupo] of entradasEnt) {
              for (const col of colsSomaveis) totalEnt[col] = (totalEnt[col] || 0) + (grupo[col] || 0);
            }
            const totEntStr = colsSomaveis.map(col => `*${_fmt(col, totalEnt[col] || 0)}*`).join(' | ');
            linhas.push(`🧾 *Total*: ${totEntStr}`);
          }
        }
      }

    } else if (colsEntidade.length > 1 && colsSomaveis.length > 0 && colsEntidade.some(k => _RE_DOCUMENTO.test(k))) {
      // Modo detalhado: preserva entidade + documento/NF (ex: cliente -> nota fiscal)
      const docKey = colsEntidade.find(k => _RE_DOCUMENTO.test(k));
      const entKey = colsEntidade.find(k => k !== docKey && /^(cliente|fornecedor|vendedor|produto|servico|empresa|nome|descri)/i.test(k))
        || colsEntidade.find(k => k !== docKey);
      const agrupado = new Map();

      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const ent = _entLabel(row, entKey) || '(outros)';
          const doc = String(row[docKey] ?? '').trim() || '(sem documento)';
          if (!agrupado.has(ent)) agrupado.set(ent, { total: {}, documentos: new Map() });
          const grupo = agrupado.get(ent);
          if (!grupo.documentos.has(doc)) grupo.documentos.set(doc, {});
          const docGrupo = grupo.documentos.get(doc);
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) {
              grupo.total[col] = (grupo.total[col] || 0) + v;
              docGrupo[col] = (docGrupo[col] || 0) + v;
            }
          }
        }
      }

      const primaryCol = colsSomaveis[0];
      const entradas = [...agrupado.entries()].sort(([, a], [, b]) => (b.total[primaryCol] || 0) - (a.total[primaryCol] || 0));

      entradas.slice(0, 50).forEach(([ent, grupo], i) => {
        const valsEnt = colsSomaveis.map(col => `*${_fmt(col, grupo.total[col] || 0)}*`).join(' | ');
        linhas.push(`  ${i + 1}. *${ent}*: ${valsEnt}`);
        const docs = [...grupo.documentos.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
        docs.slice(0, 50).forEach(([doc, docGrupo], idx) => {
          const valsDoc = colsSomaveis.map(col => `*${_fmt(col, docGrupo[col] || 0)}*`).join(' | ');
          linhas.push(`     ${idx + 1}. Doc. ${doc}: ${valsDoc}`);
        });
        if (docs.length > 50) linhas.push(`     ... e mais ${docs.length - 50} documento(s)`);
      });
      if (entradas.length > 50) linhas.push(`... e mais ${entradas.length - 50}`);

      linhas.push('');
      const totalGeral = {};
      for (const [, grupo] of entradas) {
        for (const col of colsSomaveis) totalGeral[col] = (totalGeral[col] || 0) + (grupo.total[col] || 0);
      }
      const totStr = colsSomaveis.map(col => `*${_fmt(col, totalGeral[col] || 0)}*`).join(' | ');
      linhas.push(`ðŸ§¾ *Total Geral*: ${totStr}`);

    } else if (colsEntidade.length > 0 && colsSomaveis.length > 0) {
      // Modo entidade: agrupa por vendedor/cliente/produto consolidando todas as empresas
      const entKey    = colsEntidade[0];
      const agrupado  = new Map();

      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const ent = _entLabel(row, entKey) || '(outros)';
          if (!agrupado.has(ent)) agrupado.set(ent, {});
          const grupo = agrupado.get(ent);
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) grupo[col] = (grupo[col] || 0) + v;
          }
        }
      }

      const primaryCol = colsSomaveis[0];
      const entradas   = [...agrupado.entries()].sort(([, a], [, b]) => (b[primaryCol] || 0) - (a[primaryCol] || 0));

      entradas.forEach(([ent, grupo], i) => {
        const vals = colsSomaveis.map(col => `*${_fmt(col, grupo[col] || 0)}*`).join(' | ');
        linhas.push(`  ${i + 1}. ${ent}: ${vals}`);
      });

      linhas.push('');
      const totalGeral = {};
      for (const [, grupo] of entradas) {
        for (const col of colsSomaveis) totalGeral[col] = (totalGeral[col] || 0) + (grupo[col] || 0);
      }
      const totStr = colsSomaveis.map(col => `*${_fmt(col, totalGeral[col] || 0)}*`).join(' | ');
      linhas.push(`🧾 *Total Geral*: ${totStr}`);

    } else if (colsSomaveis.length > 0) {
      // Modo simples: subtotal por empresa + total geral
      const _ROTULOS_CAMPO = {
        valor_recebido: 'Recebido', valor_pago: 'Pago',
        saldo_a_receber: 'A receber', saldo_a_pagar: 'A pagar',
        valor_recebido_total: 'Recebido', valor_pago_total: 'Pago',
      };
      const _rotuloCol = col => _ROTULOS_CAMPO[col] || col;
      let totalRegistros = 0;
      const totalGeral = {};
      for (const s of sucessos) {
        const totais = {};
        for (const col of colsSomaveis) {
          totais[col] = (s.rows || []).reduce((acc, r) => acc + (parseFloat(r[col]) || 0), 0);
          totalGeral[col] = (totalGeral[col] || 0) + totais[col];
        }
        const c = (s.rows || []).length;
        totalRegistros += c;
        const vals = colsSomaveis.map(col => `${_rotuloCol(col)}: *${_fmt(col, totais[col])}*`).join(' | ');
        linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${vals} (${c} reg.)`);
      }
      linhas.push('');
      const totStr = colsSomaveis.map(col => `${_rotuloCol(col)}: *${_fmt(col, totalGeral[col])}*`).join(' | ');
      linhas.push(`*Total geral: ${totStr}*`);
      linhas.push(`_${totalRegistros} registros no total_`);

    } else if (colsMediaDisp.length > 0) {
      // Colunas de média (media_mensal, ticket_medio, etc.) — não somáveis; exibe por dimensão e por empresa
      const entKeyMedia = colsEntidade.find(k => /^produto/i.test(k)) || colsEntidade[0] || null;
      const dimKey = colsDimensao.length > 0 ? colsDimensao[0] : entKeyMedia;
      if (!entKeyMedia && !dimKey) {
        const porItensResposta = _formatarConsolidadoPorItensResposta();
        if (porItensResposta) {
          linhas.push(porItensResposta);
          return linhas.join('\n');
        }
      }
      const porDim = new Map();
      for (const s of sucessos) {
        for (const row of (s.rows || [])) {
          const chave = entKeyMedia ? _entLabel(row, entKeyMedia) : (dimKey ? String(row[dimKey] ?? '').trim() : '_geral_');
          if (!chave) continue;
          if (!porDim.has(chave)) porDim.set(chave, []);
          porDim.get(chave).push({ empresa: s.nomeEmpresa, row });
        }
      }
      const ehTemporal = dimKey && !entKeyMedia ? _RE_TEMPORAL.test(dimKey) : false;
      const primaryMediaCol = colsMediaDisp[0];
      const entradas = [...porDim.entries()].sort(([, a], [, b]) => {
        if (entKeyMedia) {
          const ta = a.reduce((acc, item) => acc + (parseFloat(item.row[primaryMediaCol]) || 0), 0);
          const tb = b.reduce((acc, item) => acc + (parseFloat(item.row[primaryMediaCol]) || 0), 0);
          return tb - ta;
        }
        return String(a).localeCompare(String(b));
      });
      entradas.forEach(([dimVal, itens], i) => {
        const label = dimKey || entKeyMedia ? _formatLabel(dimVal, ehTemporal) : 'Geral';
        const totais = {};
        for (const { row } of itens) {
          for (const col of colsMediaDisp) totais[col] = (totais[col] || 0) + (parseFloat(row[col]) || 0);
        }
        const valsTotais = colsMediaDisp.map(col => `*${_fmt(col, totais[col] || 0)}*`).join(' | ');
        linhas.push(`${i + 1}. *${label}*: ${valsTotais}`);
        for (const { empresa, row } of itens.slice(0, 10)) {
          const valsStr = colsMediaDisp.map(col => `*${_fmt(col, parseFloat(row[col]) || 0)}*`).join(' | ');
          linhas.push(`   \u{1F3E2} ${empresa}: ${valsStr}`);
        }
        if (itens.length > 10) linhas.push(`   ... e mais ${itens.length - 10}`);
      });

      // Resumo por empresa: todos os valores de dimensão em uma linha por empresa
      const porEmpresa = new Map();
      for (const [dimVal, itens] of porDim) {
        const label = dimKey || entKeyMedia ? _formatLabel(dimVal, ehTemporal) : 'Geral';
        for (const { empresa, row } of itens) {
          if (!porEmpresa.has(empresa)) porEmpresa.set(empresa, []);
          const valsStr = colsMediaDisp.map(col => `*${_fmt(col, parseFloat(row[col]) || 0)}*`).join(' | ');
          porEmpresa.get(empresa).push(`${label}: ${valsStr}`);
        }
      }
      if (porEmpresa.size > 0) {
        linhas.push('');
        linhas.push('\u{1F4CA} *Resumo por Empresa*');
        for (const [empresa, periodos] of porEmpresa) {
          linhas.push(`\u{1F3E2} ${empresa} — ${periodos.join(' | ')}`);
        }
      }
    } else if (colsSomaveis.length > 0) {
      // Tem colunas somáveis mas sem dimensão temporal/categórica reconhecida:
      // exibe total por empresa + total geral em valores monetários
      const totGeral = {};
      for (const col of colsSomaveis) totGeral[col] = 0;

      linhas.push('\u{1F4CA} *Consolidado — Todas as Empresas*');
      linhas.push('');
      for (const s of sucessos) {
        const totEmpresa = {};
        for (const col of colsSomaveis) totEmpresa[col] = 0;
        for (const row of (s.rows || [])) {
          for (const col of colsSomaveis) {
            const v = parseFloat(row[col]);
            if (!isNaN(v)) {
              totEmpresa[col] = (totEmpresa[col] || 0) + v;
              totGeral[col]   = (totGeral[col]   || 0) + v;
            }
          }
        }
        const totStr = colsSomaveis.map(col => `*${_fmt(col, totEmpresa[col] || 0)}*`).join(' | ');
        linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${totStr}`);
      }

      linhas.push('');
      const totGeralStr = colsSomaveis.map(col => `*${_fmt(col, totGeral[col] || 0)}*`).join(' | ');
      linhas.push(`*Total Geral: ${totGeralStr}*`);
    } else {
      // Sem colunas numéricas: apenas contagem
      let totalRegistros = 0;
      for (const s of sucessos) {
        const c = (s.rows || []).length;
        totalRegistros += c;
        linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${c} registro(s)`);
      }
      linhas.push(`*Total: ${totalRegistros} registros*`);
    }

    return linhas.join('\n');
  }

  _definicoesEntidadePorModulo(modulo) {
    if (modulo === 'financeiro') return financeiroEntityCatalog.DEFINICOES;
    if (modulo === 'compras') return comprasEntityCatalog.DEFINICOES;
    if (modulo === 'faturamento') return faturamentoEntityCatalog.DEFINICOES;
    if (modulo === 'comissao') return comissaoEntityCatalog.DEFINICOES;
    return {};
  }

  _sqlCanonicoParametrizado(resultado = {}, modulo = null) {
    const sql = resultado?._sql_canonico;
    const entidades = Array.isArray(resultado?._entidadesResolvidas) ? resultado._entidadesResolvidas : [];
    if (!sql || !entidades.length) return { sql, parametrizado: false, parametros: [] };
    return entitySqlGuard.parametrizarSqlEntidadesResolvidas(sql, entidades, this._definicoesEntidadePorModulo(modulo));
  }

  _podeReusarSqlCanonicoComEntidades(entidades = [], canonico = {}) {
    // Deduplica por (tipo+codigo+loja) antes de qualquer checagem — entidades identicas
    // acumuladas pelo historico multi-turn nao devem bloquear o reuso do SQL canonico.
    const vistosDedup = new Set();
    const lista = (Array.isArray(entidades) ? entidades : []).filter(e => {
      const chave = `${String(e?.tipo || '').toLowerCase()}|${String(e?.codigo || '')}|${String(e?.loja || '')}`;
      if (vistosDedup.has(chave)) return false;
      vistosDedup.add(chave);
      return true;
    });
    if (!lista.length) return { ok: true, motivo: null };

    const tipos = lista.map(e => String(e?.tipo || '').trim().toLowerCase()).filter(Boolean);
    if (new Set(tipos).size !== tipos.length) {
      return { ok: false, motivo: 'multiplas_entidades_mesmo_tipo' };
    }

    const parametros = Array.isArray(canonico?.parametros) ? canonico.parametros : [];
    if (!canonico?.alterou) return { ok: false, motivo: 'entidade_nao_parametrizada' };

    for (const entidade of lista) {
      const tipo = String(entidade?.tipo || '').trim().toLowerCase();
      if (!tipo || !entidade?.codigo) continue;
      const temCodigo = parametros.some(p => p.tipo === tipo && p.campo === 'codigo');
      const temLoja = !entidade.loja || parametros.some(p => p.tipo === tipo && p.campo === 'loja');
      if (!temCodigo || !temLoja) return { ok: false, motivo: 'parametro_entidade_incompleto' };
    }

    return { ok: true, motivo: null };
  }

  _sqlCanonicoTemParametroEntidade(sql) {
    return /\{\{iac:[a-z0-9_]+:[a-z0-9_]+\}\}/i.test(String(sql || ''));
  }

  _entidadesParaExecucaoAll(intent = {}, empresaId, historico = [], sqlCanonico = null, entidadesCanonico = []) {
    // O SQL canonico representa a pergunta atual. Seus parametros jamais podem
    // ser substituidos por entidades herdadas do historico de outro turno.
    if (
      sqlCanonico
      && this._sqlCanonicoTemParametroEntidade(sqlCanonico)
      && Array.isArray(entidadesCanonico)
      && entidadesCanonico.length
    ) {
      return entidadesCanonico.map(entidade => ({
        ...entidade,
        // _todos: true → usuário escolheu "todos os registros"; código já resolvido,
        // re-lookup por nome causaria ambiguidade (múltiplas lojas) ou falha com "(todos)"
        _resolverNoTenantAtual: entidade?._todos ? false : true,
      }));
    }

    const entidadesEmp = intent._entidadesResolvidasPorEmpresa?.[String(empresaId)] || [];
    const entidadesHistorico = entidadesEmp.length
      ? entidadesEmp
      : this._recuperarEntidadesDoHistorico(intent.filtros, historico);
    if (entidadesHistorico.length) return entidadesHistorico;

    return [];
  }

  _ordenarEmpresasPipelineAll(empresas = []) {
    const principalId = Number(this._empresaId || 0);
    return [...(empresas || [])].sort((a, b) => {
      const aId = Number(a?.empresa_id || 0);
      const bId = Number(b?.empresa_id || 0);
      // 1. padrao do canal: designação intencional de empresa primária (tem precedência total)
      const padraoDiff = Number(b?.padrao || 0) - Number(a?.padrao || 0);
      if (padraoDiff) return padraoDiff;
      // 2. principalId: empresa conectada a este canal de WhatsApp deve liderar o pipeline
      // (gera o SQL via IA e é a referencia do registro/log consolidado).
      if (principalId) {
        if (aId === principalId && bId !== principalId) return -1;
        if (bId === principalId && aId !== principalId) return 1;
      }
      // 3. empresa_id crescente apenas como desempate final entre as demais
      if (aId !== bId) return aId - bId;
      return 0;
    });
  }

  _empresaConsolidadoId(empresasLoop = [], empresas = []) {
    return Number(this._empresaId || 0)
      || Number(empresasLoop?.[0]?.empresa_id || empresas?.[0]?.empresa_id || 0)
      || null;
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
    if (intent._provedor === 'escopo_dinamico') return 'IA Interna (escopo_dinamico)';
    if (intent._motor === 'ia_orquestradora' || intent._orquestradorContrato) return `IA Orquestradora (${intent._provedor})`;
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
    const metricas = this._metricasMonitorIntent(intent);
    return metricas.length ? metricas.join(', ') : 'padrao do dataset';
  }

  _groupByMonitorIntent(intent = {}) {
    if (Array.isArray(intent.group_by) && intent.group_by.length) return intent.group_by;
    if (Array.isArray(intent.agrupar_por_composto) && intent.agrupar_por_composto.length) return intent.agrupar_por_composto;
    if (intent.agrupar_por) return [intent.agrupar_por];
    return [];
  }

  _metricasMonitorIntent(intent = {}) {
    const metricas = [];
    const add = (metrica) => {
      const nome = String(metrica || '').split(':')[0].trim();
      if (nome && !metricas.includes(nome)) metricas.push(nome);
    };

    if (Array.isArray(intent._metricasDetectadas)) {
      intent._metricasDetectadas.forEach(add);
    }
    add(intent.ordenar_por);

    const nomeIntencao = String(intent.intencao || '').toLowerCase();
    if (nomeIntencao.includes('faturamento')) add('faturamento');

    return metricas;
  }

  _moduloMonitorIntent(intent = {}, resultado = null) {
    const conhecidos = new Set(['compras', 'financeiro', 'faturamento', 'comissao']);
    const candidatos = [
      intent._moduloDinamico,
      resultado?.dataset_nome,
      ...(Array.isArray(intent._trace) ? intent._trace.map(t => t?.modulo) : []),
      ...(Array.isArray(resultado?.trace) ? resultado.trace.map(t => t?.modulo) : []),
      String(intent.intencao || '').replace(/_dinamico$/i, ''),
    ].filter(Boolean).map(v => String(v).toLowerCase());
    return candidatos.find(v => conhecidos.has(v)) || null;
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
    if (intent._contextoFallbackEscopo) flags.push(`fallback_escopo=${intent._contextoEmpresaOrigem || 'desconhecido'}`);
    if (intent._herdouIntencao) flags.push('herdou_intencao');
    if (intent._herdouPeriodo) flags.push('herdou_periodo');
    if (intent._periodoMesDoContexto) flags.push('refinou_mes_no_contexto');
    if (intent._agrupamentoCompostoDoContexto) flags.push('drilldown_contexto');
    if (intent._agrupamentoCompostoDetectado) flags.push('group_by_da_mensagem');
    if (intent._dimensaoDetectada) flags.push(`dimensao=${intent._dimensaoDetectada}`);
    if (intent._granularidadeDetectada) flags.push(`granularidade=${intent._granularidadeDetectada}`);

    this.log(`Caminho IA Command: ${partes.join(' | ')}${flags.length ? ` | flags=${flags.join(', ')}` : ''}`, 'info');
  }

  _logResultadoIntent({ intent = {}, resultado = null, escopo = 'single' } = {}) {
    const tipo = resultado?.tipo || 'n/a';
    const subtipo = resultado?.subtipo ? ` | subtipo=${resultado.subtipo}` : '';
    const linhas = Array.isArray(resultado?.rows) ? resultado.rows.length : 'n/a';
    const duracao = resultado?.duracao_ms != null ? `${resultado.duracao_ms}ms` : 'n/a';
    const sql = resultado?.sql_gerado ? 'sim' : 'nao';
    const modulo = this._moduloMonitorIntent(intent, resultado) || 'n/a';
    this.log(`Resultado IA Command: escopo=${escopo} | modulo=${modulo} | tipo=${tipo}${subtipo} | linhas=${linhas} | duracao=${duracao} | sql=${sql}`, tipo === 'erro' ? 'warning' : 'info');
  }

  _formatarRespostaResultado(resultado, intent, { empresaId, messageTemplates, escopo = 'single' } = {}) {
    try {
      const resposta = responseFormatter.formatar(resultado, intent, { empresaId, messageTemplates });
      this.log(`Resposta formatada: escopo=${escopo} | tipo=${resultado?.tipo || 'n/a'} | chars=${String(resposta || '').length}`, 'info');
      return resposta;
    } catch (err) {
      this.log(`Falha ao formatar resposta: escopo=${escopo} | tipo=${resultado?.tipo || 'n/a'} | erro=${err.message}`, 'error');
      if (resultado?.resposta_direta) return resultado.resposta_direta;
      if (Array.isArray(resultado?.rows) && resultado.rows.length) {
        return `Consulta executada com sucesso, mas houve falha ao formatar a resposta. Foram retornada(s) ${resultado.rows.length} linha(s).`;
      }
      if (resultado?.tipo === 'erro') return `Ocorreu um erro ao consultar o ERP:\n${resultado.mensagem || err.message}`;
      return 'Consulta processada, mas houve falha ao formatar a resposta.';
    }
  }

  _normalizarTraceIntent(trace = []) {
    if (!Array.isArray(trace)) return [];
    return trace
      .filter(Boolean)
      .slice(0, 60)
      .map((item, idx) => ({
        ordem: item.ordem ?? idx + 1,
        etapa: item.etapa || 'execucao',
        acao: item.acao || 'registrar',
        motor: item.motor || null,
        modulo: item.modulo || null,
        intencao: item.intencao || null,
        detalhe: item.detalhe || null,
      }));
  }

  _resumoTraceIntent(trace = []) {
    return this._normalizarTraceIntent(trace)
      .map(item => [item.etapa, item.acao, item.modulo || item.motor || item.intencao].filter(Boolean).join(':'))
      .filter(Boolean)
      .join(' -> ');
  }

  _traceInterpretacao({ intent = {}, resultado = null, escopo = null, contextoAnterior = null } = {}) {
    const trace = [];
    const vistos = new Set();
    const add = (item) => {
      if (!item) return;
      const chave = JSON.stringify({
        etapa: item.etapa || null,
        acao: item.acao || null,
        modulo: item.modulo || null,
        motor: item.motor || null,
        intencao: item.intencao || null,
        detalhe: item.detalhe || null,
      });
      if (vistos.has(chave)) return;
      vistos.add(chave);
      trace.push(item);
    };
    (Array.isArray(intent._trace) ? intent._trace : []).forEach(add);
    (Array.isArray(resultado?.trace) ? resultado.trace : []).forEach(add);
    if (contextoAnterior || intent._contextoAplicado) {
      trace.push({
        etapa: 'contexto',
        acao: intent._contextoAplicado ? 'aplicado' : 'disponivel',
        intencao: contextoAnterior?.intencao || intent.intencao || null,
        detalhe: contextoAnterior ? `anterior=${contextoAnterior.intencao || 'desconhecido'}` : null,
      });
    }
    if (resultado?._sql_canonico_origem) {
      trace.push({
        etapa: 'sql_canonico',
        acao: resultado._sql_canonico_origem === 'whatsapp_all_reuso' ? 'reutilizado_adaptado_sx2_sx3' : 'definido_por_ia',
        modulo: this._moduloMonitorIntent(intent, resultado) || null,
        detalhe: `origem=${resultado._sql_canonico_origem}; empresa_origem=${resultado._sql_canonico_empresa_origem || 'n/a'}; escopo=${intent._escopoExecucao || 'single'}; parametros=${Array.isArray(resultado._sql_canonico_parametros) ? resultado._sql_canonico_parametros.length : 0}`,
      });
    }
    if (resultado?._diagnostico_tecnico) {
      const diag = resultado._diagnostico_tecnico;
      trace.push({
        etapa: 'diagnostico',
        acao: diag.codigo || resultado.subtipo || resultado.tipo || 'falha',
        modulo: this._moduloMonitorIntent(intent, resultado) || null,
        detalhe: [diag.titulo, diag.descricao, diag.acao_sistema].filter(Boolean).join(' | '),
      });
    }
    trace.push({
      etapa: 'finalizacao',
      acao: 'resposta',
      intencao: intent.intencao || null,
      detalhe: `escopo=${escopo || 'single'}; tipo=${resultado?.tipo || 'n/a'}; linhas=${Array.isArray(resultado?.rows) ? resultado.rows.length : 'n/a'}`,
    });
    return this._normalizarTraceIntent(trace);
  }

  _metaMonitorIntent(intent = {}, resultado = null) {
    const groupBy = this._groupByMonitorIntent(intent);
    const metricas = this._metricasMonitorIntent(intent);
    const origem = intent._contextoAplicado
      ? 'contexto da conversa'
      : (intent._provedor === 'deterministico' || intent._resolvidoLocalmente)
        ? 'motor local'
        : intent._provedor === 'escopo_dinamico'
          ? 'motor local'
          : intent._provedor === 'nenhum'
            ? 'nao reconhecida'
            : `IA externa (${intent._provedor})`;

    const trace = this._traceInterpretacao({ intent, resultado });
    return {
      origem,
      modulo: this._moduloMonitorIntent(intent, resultado),
      contexto_aplicado: !!intent._contextoAplicado,
      herdou_intencao: !!intent._herdouIntencao,
      herdou_periodo: !!intent._herdouPeriodo,
      herdou_filtros: !!intent._herdouFiltros,
      herdou_metricas: !!intent._herdouMetricas,
      periodo_mes_contexto: !!intent._periodoMesDoContexto,
      dimensao_detectada: intent._dimensaoDetectada || null,
      granularidade_detectada: intent._granularidadeDetectada || null,
      group_by: groupBy.length ? groupBy : null,
      agrupamento_composto: groupBy.length ? groupBy : null,
      agrupamento_composto_contexto: !!intent._agrupamentoCompostoDoContexto,
      metricas,
      trace,
      trace_resumo: this._resumoTraceIntent(trace),
    };
  }

  _registrarInterpretacao({ empresaId, sender, texto, intent, resultado, resposta, duracaoMs, timingJson = null, formatacaoCaminho = null, recebidoEm = null, pipelineMs = null, entregueMs = null }) {
    let logId = null;
    try {
      const trace = this._traceInterpretacao({ intent, resultado });
      const row = interpretationLog.registrar({
        empresa_id: empresaId,
        usuario: sender,
        numero_wa: this._normalizarNumeroWa(sender),
        canal_id: this._channelId,
        texto_original: texto,
        intent,
        resultado,
        resposta_entregue: resposta,
        sql_gerado: resultado?.sql_gerado || null,
        escopo_execucao: resultado?._escopoExecucao || intent?._escopoExecucao || null,
        sql_canonico_origem: resultado?._sql_canonico_origem || null,
        sql_canonico_empresa_origem: resultado?._sql_canonico_empresa_origem || null,
        sql_canonico_original: resultado?._sql_canonico_original || null,
        sql_canonico_adaptado: resultado?._sql_canonico || null,
        sql_auditoria: resultado?._sql_auditoria || null,
        sql_canonico_parametros: resultado?._sql_canonico_parametros || [],
        sql_canonico_parametrizado: !!resultado?._sql_canonico_parametrizado,
        sql_canonico_reuso_motivo: resultado?._sql_canonico_reuso_motivo || null,
        sql_canonico_reuso_permitido: resultado?._sql_canonico_reuso_permitido,
        timing_json: timingJson,
        formatacao_caminho: formatacaoCaminho || intent?._formatacaoCaminho || null,
        duracao_ms: duracaoMs ?? null,
        recebido_em: recebidoEm ?? null,
        pipeline_ms: pipelineMs ?? null,
        entregue_ms: entregueMs ?? null,
        trace,
      });
      logId = row?.id || null;
    } catch (err) {
      this.log(`Falha ao registrar interpretacao: ${err.message}`, 'warning');
    }

    try {
      const { getDB } = require('../database');
      const STATUS_MAP = { sucesso: 'sucesso', erro: 'erro', sem_dados: 'sem_dados', dialogo: 'dialogo', desconhecido: 'desconhecido' };
      const detalhesExecucao = JSON.stringify({
        escopo_execucao: intent?._escopoExecucao || null,
        modulo: this._moduloMonitorIntent(intent, resultado) || null,
        sql_canonico_origem: resultado?._sql_canonico_origem || null,
        sql_canonico_empresa_origem: resultado?._sql_canonico_empresa_origem || null,
        sql_canonico_parametrizado: !!resultado?._sql_canonico_parametrizado,
        sql_canonico_reuso_motivo: resultado?._sql_canonico_reuso_motivo || null,
        sql_canonico_reuso_permitido: resultado?._sql_canonico_reuso_permitido ?? null,
        sql_auditoria: resultado?._sql_auditoria || null,
        rows_count: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
        subtipo: resultado?.subtipo || null,
      });
      getDB().prepare(
        `INSERT OR IGNORE INTO execution_log
           (correlation_id, empresa_id, usuario, numero_wa, intencao, status, duracao_ms, tipo_mensagem, detalhes_json, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        require('crypto').randomUUID(),
        empresaId,
        sender,
        this._normalizarNumeroWa(sender),
        intent?.intencao || 'desconhecido',
        STATUS_MAP[resultado?.tipo] ?? resultado?.tipo ?? 'desconhecido',
        duracaoMs ?? null,
        this._tipoMensagemAtual || 'texto',
        detalhesExecucao,
        new Date().toISOString(),
      );
    } catch (err) {
      this.log(`Falha ao registrar execucao: ${err.message}`, 'warning');
    }
    return logId;
  }

  async _responderDialogoComIA({ empresaId, sender, texto, dialogo, t0 }) {
    let resposta = dialogo.resposta;
    let provedor = 'dialogo';
    let erros = [];

    try {
      const ai = await conversationService.responder(texto, empresaId);
      if (ai.ok && ai.resposta) {
        resposta = ai.resposta;
        provedor = ai.provedor || 'ia_dialogo';
      } else {
        erros = ai.erros || [];
      }
    } catch (err) {
      erros = [{ provedor: 'conversation', erro: err.message }];
    }

    if (erros.length) {
      this.log(`Dialogo IA indisponivel, usando fallback local: ${erros.map(e => `${e.provedor}: ${e.erro}`).join(' | ')}`, 'warning');
    }

    this._registrarInterpretacao({
      empresaId,
      sender,
      texto,
      intent: {
        intencao: 'dialogo_conversacional',
        periodo: { tipo: 'nenhum' },
        filtros: {},
        confianca: provedor === 'dialogo' ? 1 : 0.95,
        _provedor: provedor,
        _dialogo_id: dialogo.dialogo_id,
        _dialogo_ia: provedor !== 'dialogo',
        _erros: erros,
      },
      resultado: { tipo: 'dialogo', mensagem: resposta, provedor },
      resposta,
      duracaoMs: Date.now() - t0,
    });
    return resposta;
  }

  async _responderFilialPendente(sender, texto, empresaIdPadrao, t0) {
    const ctx = this._getSenderContext(sender);
    if (!ctx?._perguntaFilialPendente || !ctx?._intentPendente) return null;

    if (_textoCancelaPendente(texto)) {
      this._setSenderContext(sender, { _perguntaFilialPendente: false, _intentPendente: null, _intentPendenteEmpresaId: null });
      return 'Consulta anterior cancelada. Pode enviar a nova pergunta.';
    }
    if (_textoPareceNovaConsulta(texto)) {
      this._setSenderContext(sender, { _perguntaFilialPendente: false, _intentPendente: null, _intentPendenteEmpresaId: null });
      return null;
    }

    const empresaCandidata = ctx._intentPendenteEmpresaId
      || (ctx.empresaId && ctx.empresaId !== '__all__' ? ctx.empresaId : null)
      || empresaIdPadrao
      || this._empresaId;
    const empresaPendente = Number(empresaCandidata);
    if (!Number.isFinite(empresaPendente) || empresaPendente <= 0) return null;
    const filialParsed = _parsearRespostaFilial(texto);
    const intentPendente = {
      ...ctx._intentPendente,
      filtros: { ...(ctx._intentPendente.filtros || {}), filial: filialParsed },
    };

    this._setSenderContext(sender, {
      _perguntaFilialPendente: false,
      _intentPendente: null,
      _intentPendenteEmpresaId: null,
    });

    const resultadoPendente = await intentRouter.rotear(intentPendente, empresaPendente);
    const respostaFilialFinal = resultadoPendente.resposta_direta
      || 'Não encontrei dados para essa consulta.';

    this._registrarInterpretacao({
      empresaId: empresaPendente,
      sender,
      texto,
      intent: intentPendente,
      resultado: resultadoPendente,
      resposta: respostaFilialFinal,
      duracaoMs: Date.now() - t0,
    });

    return respostaFilialFinal;
  }

  // Responde ao pedido "mostre o SQL usado" buscando a ultima interpretacao com SQL
  // gerado entre as empresas autorizadas para este sender neste canal. Memoriza o id
  // do registro no contexto do sender para servir de ancora ao fluxo de reporte de erro
  // (usuario pode, na sequencia, dizer o que estava errado naquele SQL especifico).
  _responderSqlUsado(sender) {
    const interpretationLog = require('../ai/interpretation-log');
    const numeroWa = this._normalizarNumeroWa(sender);
    const empresasDoSender = this._channelId
      ? channelStore.listarEmpresasDoCanal(this._channelId).filter(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender))
      : [{ empresa_id: this._empresaId }];
    let registro = null;
    for (const emp of empresasDoSender) {
      const candidato = interpretationLog.obterUltimaComSqlPorSender(emp.empresa_id, numeroWa);
      if (candidato && (!registro || candidato.criado_em > registro.criado_em)) registro = candidato;
    }
    if (!registro) {
      return 'Não encontrei nenhuma consulta recente sua com SQL registrado.';
    }
    this._setSenderContext(sender, { _ultimoSqlLogId: registro.id, _ultimoSqlEmpresaId: registro.empresa_id });
    const sql = registro.sql_final_executado || registro.sql_gerado || '(SQL não registrado)';
    const sqlTrim = sql.length > 3000 ? `${sql.slice(0, 3000)}\n... (truncado)` : sql;
    return `📋 *SQL usado na sua última consulta:*\n\n_"${registro.texto_original}"_\n\n\`\`\`${sqlTrim}\`\`\`\n\nSe identificar algo errado, me diga o que deveria ser diferente e eu registro para análise técnica.`;
  }

  // Heuristica curta para detectar que o usuario esta contestando o resultado da
  // ultima consulta (nao pedindo uma nova). So dispara se houver uma interpretacao
  // recente com SQL para ancorar o dialogo — senao segue o fluxo normal.
  _textoPareceReporteDeErro(texto) {
    const t = String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return /\b(esta|veio|ficou|deu)\s+errad[oa]\b|\bnao\s+esta\s+corret[oa]\b|\berro\s+n[ao]\s+(valor|calculo|sql)\b|\bdeveria\s+(ser|considerar|filtrar|trazer)\b|\bacho\s+que\s+(esta|tem)\s+errad[oa]\b/.test(t);
  }

  async _iniciarDialogoFeedback(sender, texto) {
    const interpretationLog = require('../ai/interpretation-log');
    const numeroWa = this._normalizarNumeroWa(sender);
    const ctxAtual = this._getSenderContext(sender) || {};
    let registro = ctxAtual._ultimoSqlLogId ? interpretationLog.obterPorId(ctxAtual._ultimoSqlLogId, ctxAtual._ultimoSqlEmpresaId) : null;
    if (!registro) {
      const empresasDoSender = this._channelId
        ? channelStore.listarEmpresasDoCanal(this._channelId).filter(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender))
        : [{ empresa_id: this._empresaId }];
      for (const emp of empresasDoSender) {
        const candidato = interpretationLog.obterUltimaComSqlPorSender(emp.empresa_id, numeroWa);
        if (candidato && (!registro || candidato.criado_em > registro.criado_em)) registro = candidato;
      }
    }
    if (!registro) return null; // sem consulta recente para ancorar — segue fluxo normal

    const specFeedbackDialog = require('../erp/spec-feedback-dialog');
    const sql = registro.sql_final_executado || registro.sql_gerado || '';
    const historico = [{ papel: 'usuario', texto }];
    let resultado;
    try {
      resultado = await specFeedbackDialog.processarTurno({
        empresaId: registro.empresa_id,
        perguntaOriginal: registro.texto_original,
        sqlGerado: sql,
        modulo: registro.modulo || registro.intencao,
        historico,
      });
    } catch (e) {
      this.log(`[FeedbackDialog] Falha ao iniciar dialogo: ${e.message}`, 'error');
      return null;
    }
    historico.push({ papel: 'ia', texto: resultado.mensagem });
    if (resultado.tipo === 'fechamento') {
      specFeedbackDialog.registrarProposta({
        empresaId: registro.empresa_id,
        numeroWa,
        interpretationLogId: registro.id,
        perguntaOriginal: registro.texto_original,
        sqlGerado: sql,
        observacaoUsuario: texto,
        fragmento: resultado.fragmento,
        diagnostico: resultado.diagnostico,
        textoProposto: resultado.texto_proposto,
        historico,
      });
      return resultado.mensagem;
    }
    this._setSenderContext(sender, {
      _feedbackSession: {
        interpretationLogId: registro.id,
        empresaId: registro.empresa_id,
        numeroWa,
        perguntaOriginal: registro.texto_original,
        sqlGerado: sql,
        modulo: registro.modulo || registro.intencao,
        historico,
      },
    });
    return resultado.mensagem;
  }

  async _conduzirDialogoFeedback(sender, texto, sessao) {
    const specFeedbackDialog = require('../erp/spec-feedback-dialog');
    const historico = [...sessao.historico, { papel: 'usuario', texto }];
    let resultado;
    try {
      resultado = await specFeedbackDialog.processarTurno({
        empresaId: sessao.empresaId,
        perguntaOriginal: sessao.perguntaOriginal,
        sqlGerado: sessao.sqlGerado,
        modulo: sessao.modulo,
        historico,
      });
    } catch (e) {
      this.log(`[FeedbackDialog] Falha ao continuar dialogo: ${e.message}`, 'error');
      this._setSenderContext(sender, { _feedbackSession: null });
      return 'Tive um problema para continuar essa análise. Pode repetir o que estava errado?';
    }
    historico.push({ papel: 'ia', texto: resultado.mensagem });
    if (resultado.tipo === 'fechamento') {
      specFeedbackDialog.registrarProposta({
        empresaId: sessao.empresaId,
        numeroWa: sessao.numeroWa,
        interpretationLogId: sessao.interpretationLogId,
        perguntaOriginal: sessao.perguntaOriginal,
        sqlGerado: sessao.sqlGerado,
        observacaoUsuario: historico.filter(h => h.papel === 'usuario').map(h => h.texto).join(' | '),
        fragmento: resultado.fragmento,
        diagnostico: resultado.diagnostico,
        textoProposto: resultado.texto_proposto,
        historico,
      });
      this._setSenderContext(sender, { _feedbackSession: null });
      return resultado.mensagem;
    }
    this._setSenderContext(sender, { _feedbackSession: { ...sessao, historico } });
    return resultado.mensagem;
  }

  async _responderEntidadePendente(sender, texto, empresaIdPadrao, t0) {
    const ctx = this._getSenderContext(sender);
    if (!ctx?._perguntaEntidadePendente || !ctx?._intentPendente || !Array.isArray(ctx._opcoesEntidade)) return null;

    if (_textoCancelaPendente(texto)) {
      this._setSenderContext(sender, { _perguntaEntidadePendente: false, _opcoesEntidade: null, _intentPendente: null, _intentPendenteEmpresaId: null, _intentPendenteEmpresasAll: null });
      return 'Escolha anterior cancelada. Pode enviar a nova pergunta.';
    }
    if (_textoPareceNovaConsulta(texto)) {
      this._setSenderContext(sender, { _perguntaEntidadePendente: false, _opcoesEntidade: null, _intentPendente: null, _intentPendenteEmpresaId: null, _intentPendenteEmpresasAll: null });
      return null;
    }

    const idx = parseInt(String(texto || '').trim(), 10) - 1;
    const totalOpcoes = ctx._opcoesEntidade.length;
    let escolhida;
    if (idx === totalOpcoes) {
      // Usuário escolheu "Todos" — usa o código base sem loja para consultar todos os registros
      const base = ctx._opcoesEntidade[0];
      escolhida = { ...base, loja: null, _todos: true, nome: `${base.nome} (todos)` };
    } else {
      escolhida = ctx._opcoesEntidade[idx];
    }
    if (!escolhida) {
      const msgOpcaoInvalida = `Não consegui identificar a opção. Responda com um número de 1 a ${totalOpcoes + 1}.`;
      const empresaCandOpcInv = Number(ctx._intentPendenteEmpresaId || (ctx.empresaId && ctx.empresaId !== '__all__' ? ctx.empresaId : null) || empresaIdPadrao || this._empresaId);
      if (Number.isFinite(empresaCandOpcInv) && empresaCandOpcInv > 0) {
        this._registrarInterpretacao({
          empresaId: empresaCandOpcInv,
          sender,
          texto,
          intent: ctx._intentPendente || {},
          resultado: { tipo: 'erro', subtipo: 'opcao_invalida', resposta_direta: msgOpcaoInvalida },
          resposta: msgOpcaoInvalida,
          duracaoMs: Date.now() - t0,
        });
      }
      return msgOpcaoInvalida;
    }

    const empresaCandidata = ctx._intentPendenteEmpresaId
      || (ctx.empresaId && ctx.empresaId !== '__all__' ? ctx.empresaId : null)
      || empresaIdPadrao
      || this._empresaId;
    const empresaPendente = Number(empresaCandidata);
    if (!Number.isFinite(empresaPendente) || empresaPendente <= 0) return null;

    const entidadesPendentes = Array.isArray(ctx._intentPendente._entidadesResolvidas)
      ? ctx._intentPendente._entidadesResolvidas
      : [];
    const tipoEscolhida = String(escolhida?.tipo || '').trim().toLowerCase();
    const entidadesAtualizadas = [
      ...entidadesPendentes.filter(e => !tipoEscolhida || String(e?.tipo || '').trim().toLowerCase() !== tipoEscolhida),
      escolhida,
    ];

    const intentPendente = {
      ...ctx._intentPendente,
      _entidadesResolvidas: entidadesAtualizadas,
      _entidadeEscolhidaManualmente: true,
    };

    this._setSenderContext(sender, {
      _perguntaEntidadePendente: false,
      _opcoesEntidade: null,
      _intentPendente: null,
      _intentPendenteEmpresaId: null,
      _intentPendenteEmpresasAll: null,
    });

    // Multi-empresa: se a disambiguação foi disparada durante _pipelineAll (todas as empresas),
    // reprocessa para cada empresa e combina as respostas — garante que todas as empresas
    // sejam consultadas, não só aquela que disparou a pergunta de entidade.
    const empresasAll = ctx._intentPendenteEmpresasAll;
    if (Array.isArray(empresasAll) && empresasAll.length > 1) {
      const respostasEmpresa = [];
      for (const emp of empresasAll) {
        try {
          const _historicoEmp = this._buildHistoricoResumido(sender, emp.empresa_id, this._historicoTurnosConfig(emp.empresa_id));
          const intentEmpresa = {
            ...intentPendente,
            _mensagemOriginal: intentPendente._mensagemOriginal || texto,
            _remetente: sender,
            _escopoExecucao: 'whatsapp_all',
            _historicoResumido: _historicoEmp,
          };
          const resEmp = await intentRouter.rotear(intentEmpresa, emp.empresa_id);
          this._logResultadoIntent({ intent: intentEmpresa, resultado: resEmp, escopo: 'pendente_all' });
          this._registrarInterpretacao({
            empresaId: emp.empresa_id, sender, texto: intentPendente._mensagemOriginal || texto,
            intent: intentEmpresa, resultado: resEmp,
            resposta: resEmp.resposta_direta || 'Não encontrei dados.',
            duracaoMs: resEmp.duracao_ms ?? (Date.now() - t0),
          });
          if (resEmp.tipo !== 'erro' && resEmp.tipo !== 'desconhecido' && intentEmpresa.intencao !== 'desconhecido') {
            this._saveLastIntent(sender, intentEmpresa, emp.empresa_id);
          }
          if (resEmp.tipo !== 'erro' && resEmp.tipo !== 'pergunta_entidade' && resEmp.resposta_direta) {
            respostasEmpresa.push({
              empresaId: emp.empresa_id,
              nome: emp.nome || `Empresa #${emp.empresa_id}`,
              resposta: resEmp.resposta_direta,
              resultado: resEmp,
              rows: resEmp.rows || [],
            });
          }
        } catch (err) {
          this.log(`[_responderEntidadePendente] Empresa #${emp.empresa_id} falhou: ${err.message}`, 'warning');
        }
      }
      // Salva no escopo __all__ para que o próximo turno (_pipelineAll) encontre
      // _entidadesResolvidasPorEmpresa e substitua o placeholder corretamente em cada empresa.
      if (Array.isArray(intentPendente._entidadesResolvidas) && intentPendente._entidadesResolvidas.length) {
        const entidadesResolvidasPorEmpresa = {};
        for (const emp of empresasAll) {
          entidadesResolvidasPorEmpresa[String(emp.empresa_id)] = intentPendente._entidadesResolvidas;
        }
        const intentAll = {
          ...intentPendente,
          _escopoExecucao: 'whatsapp_all',
          _entidadesResolvidasPorEmpresa: entidadesResolvidasPorEmpresa,
        };
        this._saveLastIntent(sender, intentAll, '__all__');
      }
      if (!respostasEmpresa.length) return 'Não encontrei dados para essa consulta.';
      const respostaFinal = respostasEmpresa.map(r => `*${r.nome}*\n${r.resposta}`).join('\n\n');
      const empresaLogId = this._empresaConsolidadoId(empresasAll, empresasAll);
      const sqlConsolidado = respostasEmpresa
        .filter(r => r.resultado?.sql_gerado)
        .map(r => `-- ${r.nome}\n${r.resultado.sql_gerado}`)
        .join('\n\n') || null;
      const audPrimeiro = respostasEmpresa[0]?.resultado?._sql_auditoria || {};
      this._registrarInterpretacao({
        empresaId: empresaLogId,
        sender,
        texto: intentPendente._mensagemOriginal || texto,
        intent: {
          ...intentPendente,
          _escopoExecucao: 'whatsapp_all',
        },
        resultado: {
          tipo: 'sucesso_ai_sql',
          rows: respostasEmpresa.flatMap(r => r.rows || []),
          sql_gerado: sqlConsolidado,
          _sql_auditoria: {
            handler: 'whatsapp_all',
            origem: 'consolidado_multiempresa_entidade_pendente',
            prompt_system: audPrimeiro.prompt_system || null,
            prompt_user: audPrimeiro.prompt_user || null,
            empresas_tentadas: empresasAll.map(e => e.nome || `Empresa #${e.empresa_id}`),
            empresas: respostasEmpresa.map(r => ({
              empresa_id: r.empresaId,
              empresa_nome: r.nome,
              sql_gerado: r.resultado?.sql_gerado || null,
              sql_ia_bruto: r.resultado?._sql_auditoria?.sql_ia_bruto || null,
              sql_final_executado: r.resultado?._sql_auditoria?.sql_final_executado || r.resultado?.sql_gerado || null,
              sql_canonico_adaptado: r.resultado?._sql_canonico || null,
              rows_count: (r.rows || []).length,
            })),
          },
          _pipeline_origem: 'consolidado_entidade_pendente',
        },
        resposta: respostaFinal,
        duracaoMs: Date.now() - t0,
      });
      return respostaFinal;
    }

    const resultado = await intentRouter.rotear(intentPendente, empresaPendente);
    this._logResultadoIntent({ intent: intentPendente, resultado, escopo: 'pendente' });
    const resposta = resultado.resposta_direta || 'Não encontrei dados para essa consulta.';
    if (resultado.tipo !== 'erro' && resultado.tipo !== 'desconhecido' && intentPendente.intencao !== 'desconhecido') {
      this._saveLastIntent(sender, intentPendente, empresaPendente);
    }
    this._registrarInterpretacao({
      empresaId: empresaPendente,
      sender,
      texto: intentPendente._mensagemOriginal || texto,
      intent: intentPendente,
      resultado,
      resposta,
      duracaoMs: resultado.duracao_ms ?? (Date.now() - t0),
    });
    return resposta;
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
    this.log(`📩 Texto recebido: "${texto}"`, 'received');

    let chat;
    try {
      chat = await msg.getChat();
      await chat.sendMessage(messageTemplates.render(this._empresaId, 'processando', {
        canal_nome: this._channelName || '',
        numero: this._normalizarNumeroWa(sender),
      }));
      this.log(`⏳ Acuse de recebimento enviado — iniciando pipeline...`, 'info');
    } catch (chatErr) {
      this.log(`Falha ao obter chat ou enviar acuse: ${chatErr.message}`, 'error');
      return;
    }

    const t0 = Date.now();
    const _timingCtx = { logId: null, recebidoEm: new Date(t0).toISOString() };

    // Heartbeat: envia mensagem de progresso durante consultas longas para manter o WhatsApp Web ativo.
    const HEARTBEAT_INTERVAL_MS = 20000;
    let heartbeatCount = 0;
    const heartbeatId = setInterval(async () => {
      if ((this._senderCancelledAt.get(this._sessionKey(sender)) || 0) > t0) {
        clearInterval(heartbeatId);
        this.log(`Heartbeat encerrado — conversa foi resetada durante o processamento (${sender})`, 'info');
        return;
      }
      heartbeatCount++;
      try {
        await chat.sendMessage(messageTemplates.render(this._empresaId, 'aguardando_processamento', {}));
        this.log(`⏳ Heartbeat #${heartbeatCount} enviado para ${sender} (${Math.round((Date.now() - t0) / 1000)}s)`, 'info');
      } catch (hbErr) {
        this.log(`Falha ao enviar heartbeat: ${hbErr.message}`, 'error');
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const timeoutMs = 180000;
      let timeoutId = null;
      const timeoutPipeline = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Tempo limite de processamento excedido (${Math.round(timeoutMs / 1000)}s). Tente novamente.`)),
          timeoutMs,
        );
      });
      const resposta = await Promise.race([
        this._pipeline(texto, sender, { _pipelineTs: t0, _recebidoEm: t0, _timingCtx }),
        timeoutPipeline,
      ]).finally(() => { clearTimeout(timeoutId); clearInterval(heartbeatId); });
      if ((this._senderCancelledAt.get(this._sessionKey(sender)) || 0) > t0) {
        this.log(`🚫 Resposta descartada — conversa foi resetada durante o processamento (${sender})`, 'info');
        return;
      }
      try {
        const partesEnviadas = await this._sendReplyMessageSafe(chat, sender, resposta);
        const entregueMs = Date.now() - t0;
        if (partesEnviadas > 1) this.log(`Resposta dividida em ${partesEnviadas} partes para ${sender}.`, 'info');
        this.log(`✅ Resposta enviada para ${sender} (${entregueMs}ms)`, 'success');
        if (_timingCtx.logId) {
          try { interpretationLog.atualizarEntregue(_timingCtx.logId, entregueMs); } catch (_) {}
        }
      } catch (sendErr) {
        this.log(`❌ Falha ao enviar resposta para ${sender} (WhatsApp desconectado?): ${sendErr.message}`, 'error');
      }
    } catch (err) {
      clearInterval(heartbeatId);
      this.log(`❌ Pipeline falhou (${Date.now() - t0}ms): ${err.message}`, 'error');
      const isTimeout = /timeout ao chamar o agente|tempo limite de processamento excedido/i.test(err.message);
      const templateChave = isTimeout ? 'timeout_agente' : 'erro_processamento';
      try {
        await chat.sendMessage(messageTemplates.render(this._empresaId, templateChave, { erro: err.message }));
      } catch (sendErr) {
        this.log(`❌ Falha ao enviar mensagem de erro para ${sender} (WhatsApp desconectado?): ${sendErr.message}`, 'error');
      }
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
        try {
          await chat.sendMessage(messageTemplates.render(this._empresaId, 'erro_transcricao', { erro: transcErr.message }));
        } catch (_) {}
        return;
      }

      const _audioT0 = Date.now();
      const _audioTimingCtx = { logId: null, recebidoEm: new Date(_audioT0).toISOString() };
      try {
        const resposta = await this._pipeline(transcricao, sender, { _pipelineTs: _audioT0, _recebidoEm: _audioT0, _timingCtx: _audioTimingCtx });
        if ((this._senderCancelledAt.get(this._sessionKey(sender)) || 0) > _audioT0) {
          this.log(`🚫 Resposta de áudio descartada — conversa foi resetada durante o processamento (${sender})`, 'info');
          return;
        }
        try {
          await chat.sendMessage(messageTemplates.render(this._empresaId, 'audio_resposta_prefixo', {
            transcricao: `${transcricao.slice(0, 120)}${transcricao.length > 120 ? '...' : ''}`,
            resposta,
          }));
          const _audioEntregueMs = Date.now() - _audioT0;
          this.log(`Resposta de áudio enviada para ${sender} (${_audioEntregueMs}ms)`, 'success');
          if (_audioTimingCtx.logId) {
            try { interpretationLog.atualizarEntregue(_audioTimingCtx.logId, _audioEntregueMs); } catch (_) {}
          }
        } catch (sendErr) {
          this.log(`❌ Falha ao enviar resposta de áudio para ${sender} (WhatsApp desconectado?): ${sendErr.message}`, 'error');
        }
      } catch (err) {
        this.log(`Pipeline (áudio) falhou: ${err.message}`, 'error');
        try {
          await chat.sendMessage(messageTemplates.render(this._empresaId, 'erro_processamento', { erro: err.message }));
        } catch (sendErr) {
          this.log(`❌ Falha ao enviar erro de áudio para ${sender} (WhatsApp desconectado?): ${sendErr.message}`, 'error');
        }
      }

    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        this.log(`Arquivo temporário apagado.`, 'info');
      }
    }
  }

  // ── IA Pipeline: classify → route → format ──────────────────────────────────

  async _pipeline(texto, sender, opts = {}) {
    const _t0 = Date.now();
    const _timings = { inicio: _t0 };
    // _timingCtx é um objeto mutável compartilhado com o handler para registrar entregue_ms após sendMessage
    const _timingCtx = opts._timingCtx || null;
    const _recebidoEm = opts._recebidoEm ? new Date(opts._recebidoEm).toISOString() : null;
    let empresaId = this._empresaId;
    let empresaResolvida = null;
    let textoExecucao = texto;

    if (_textoResetExplicito(textoExecucao)) {
      this._senderCancelledAt.set(this._sessionKey(sender), opts._pipelineTs ?? Date.now());
      this._senderContext.delete(this._sessionKey(sender));
      this.log(`🔄 Conversa resetada para ${sender}`, 'info');
      return '🔄 *Conversa reiniciada!*\n\nTodo o histórico foi apagado. Pode começar uma nova consulta.';
    }

    const ctxFeedback = this._getSenderContext(sender);
    if (ctxFeedback?._feedbackSession) {
      return await this._conduzirDialogoFeedback(sender, textoExecucao, ctxFeedback._feedbackSession);
    }

    if (_textoPedeSqlUsado(textoExecucao)) {
      return this._responderSqlUsado(sender);
    }

    if (this._textoPareceReporteDeErro(textoExecucao)) {
      const iniciado = await this._iniciarDialogoFeedback(sender, textoExecucao);
      if (iniciado) return iniciado;
    }

    const respostaEntidadePendente = await this._responderEntidadePendente(sender, textoExecucao, empresaId, _t0);
    if (respostaEntidadePendente) return respostaEntidadePendente;

    const respostaFilialPendente = await this._responderFilialPendente(sender, textoExecucao, empresaId, _t0);
    if (respostaFilialPendente) return respostaFilialPendente;

    // Reset explícito de conversa — limpa todo o contexto do sender
    {
      const _resetGatilhos = [
        'nova conversa', 'novo inicio', 'novo início', 'recomeçar', 'recomecar',
        'reiniciar', 'reinicia', 'limpar', 'limpar conversa', 'limpar tudo',
        'esquecer tudo', 'esqueça tudo', 'esquece tudo', 'começar de novo',
        'comecar de novo', 'começar novamente', 'comecar novamente',
        'reset', '/reset', '/novo', '/nova', '/reiniciar', '/recomeçar',
      ];
      const textoNormReset = texto.toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      const gatilhosNorm = _resetGatilhos.map(g =>
        g.normalize('NFD').replace(/[̀-ͯ]/g, '')
      );
      if (gatilhosNorm.includes(textoNormReset)) {
        this._senderCancelledAt.set(this._sessionKey(sender), opts._pipelineTs ?? Date.now());
        this._senderContext.delete(this._sessionKey(sender));
        this.log(`🔄 Conversa resetada para ${sender}`, 'info');
        return '🔄 *Conversa reiniciada!*\n\nTodo o histórico foi apagado. Pode começar uma nova consulta.';
      }
    }

    if (this._channelId) {
      // Comandos explícitos de troca — sempre ativam o menu (independente de sessão prévia)
      const _trocaExplicita = [
        'trocar empresa',    'mudar empresa',    'alterar empresa',    'selecionar empresa',
        'alternar empresa',  'escolher empresa',  'trocar de empresa', 'mudar de empresa',
        'alterar de empresa','selecionar de empresa','alternar de empresa',
        'trocar filial',     'mudar filial',     'alterar filial',     'selecionar filial',
        'trocar de filial',  'mudar de filial',  'alterar de filial',
        'change company',    'switch company',
        // abreviações e formas curtas
        'troca',             'troca empresa',    'troca emp',
        'trocar emp',        'mudar emp',        'muda empresa',
        'muda emp',          'muda de empresa',  'alterar emp',
        'selecionar emp',    'sel emp',          'trocar emp',
      ];
      // Palavras genéricas — só ativam quando já há empresa resolvida na sessão (evita falso positivo)
      const _trocaComContexto = ['empresa', 'emp', 'voltar'];
      const textoNorm = texto.toLowerCase().trim();
      const isExplicitaTroca  = _trocaExplicita.some(k => textoNorm === k);
      const isContextoTroca   = _trocaComContexto.some(k => textoNorm === k) && this._getSenderContext(sender)?.empresaId;
      if (isExplicitaTroca || isContextoTroca) {
        // Sentinel '__trocar__': mantém pending=true para aceitar o próximo dígito/nome como seleção
        this._clearLastIntent(sender);
        this._setSenderContext(sender, { empresaId: null, pendingText: '__trocar__' });
        const empresasAptasTroca = channelStore.listarEmpresasDoCanal(this._channelId)
          .filter(e => !e.ocultar_selecao)
          .filter(e => intentService.temConfiguracaoMinima(e.empresa_id));
        return this._formatarClarificacao(empresasAptasTroca);
      }

      const ctx = this._getSenderContext(sender);

      // Para mensagens frescas (sem pendência de seleção de empresa):
      // diálogos conversacionais são respondidos ANTES de pedir escolha de empresa.
      // Saudações, despedidas, perguntas sobre o bot, etc., nunca devem acionar o menu.
      if (!ctx?.pendingText) {
        const dialogRapido = dialogResolver.resolver(texto, this._empresaId);
        if (dialogRapido.matched) {
          this.log(`💬 Diálogo pré-empresa (tipo: ${dialogRapido.tipo})`, 'info');
          return await this._responderDialogoComIA({
            empresaId: this._empresaId,
            sender,
            texto,
            dialogo: dialogRapido,
            t0: _t0,
          });
        }

        // A IA conduz a conversa com histórico completo (chat multi-turn).
        // Retorna texto (conversacional) ou JSON {tipo:"data_request",consulta:"..."}.
        const chatHistory = ctx?._chatHistory || [];
        const roteamento = await conversationService.rotear(textoExecucao, this._empresaId, chatHistory);
        _timings.roteador = Date.now();
        this.log(`🔍 ConversationRouter: ${roteamento.tipo} (${roteamento.provedor || 'fallback'}) hist=${chatHistory.length / 2} turnos | ${_timings.roteador - _t0}ms`, 'info');
        if (roteamento.tipo === 'conversacional') {
          // Hook 1 — Fallback de continuidade: mensagem classificada como conversacional
          // mas com sinais explícitos de refinamento (ordenar, filtrar, top-N, etc.)
          // e contexto dinâmico ativo → tratar como data_request e continuar o pipeline.
          const ctxAtivo = this._getSenderContext(sender);
          const temContextoDinamicoAtivo = ctxAtivo?.lastIntent
            && this._ehIntentDinamica(ctxAtivo.lastIntent)
            && ctxAtivo.lastIntentTs
            && (Date.now() - ctxAtivo.lastIntentTs) < 30 * 60 * 1000;
          if ((_ehSinalContinuidade(textoExecucao) || this._isPedidoContinuacaoAnalitica(textoExecucao)) && temContextoDinamicoAtivo) {
            this.log(`🔄 [Hook1] Fallback continuidade conv→data: "${textoExecucao.slice(0, 60)}"`, 'info');
            // Limpa chatHistory como faria um data_request normal
            this._setSenderContext(sender, { _chatHistory: [] });
            // Não retorna — continua pipeline para empresa resolution e classificação
          } else {
            // Comportamento original: acumula histórico e retorna resposta conversacional
            const novoHistorico = [
              ...chatHistory,
              { role: 'user', content: textoExecucao },
              { role: 'assistant', content: roteamento.resposta },
            ].slice(-20);
            this._setSenderContext(sender, { _chatHistory: novoHistorico });
            this._registrarInterpretacao({
              empresaId: this._empresaId,
              sender,
              texto: textoExecucao,
              intent: {
                intencao: 'dialogo_conversacional',
                periodo: { tipo: 'nenhum' },
                filtros: {},
                confianca: 0.9,
                _provedor: roteamento.provedor || 'conversation_router',
              },
              resultado: { tipo: 'dialogo', mensagem: roteamento.resposta, provedor: roteamento.provedor },
              resposta: roteamento.resposta,
              duracaoMs: Date.now() - _t0,
            });
            return roteamento.resposta;
          }
        }
        // data_request: limpa histórico de chat e usa consulta reformulada pela IA
        this._setSenderContext(sender, { _chatHistory: [] });
        if (roteamento.consulta && roteamento.consulta !== textoExecucao) {
          textoExecucao = roteamento.consulta;
        }
      }

      const empresasDoSender = channelStore
        .listarEmpresasDoCanal(this._channelId)
        .filter(e => !e.ocultar_selecao)
        .filter(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender))
        .filter(e => intentService.temConfiguracaoMinima(e.empresa_id));
      if (this._isPedidoTodasEmpresas(textoExecucao) && empresasDoSender.length > 1) {
        if (ctx?.lastIntent && String(ctx.lastIntentChannelId || '') === String(this._channelId || '')) {
          this._saveLastIntent(sender, ctx.lastIntent, '__all__');
        }
        this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
        return await this._pipelineAll(textoExecucao, empresasDoSender, sender, { _recebidoEm: opts._recebidoEm, _timingCtx });
      }
      const empresasQualificadas = this._resolverEmpresasQualificadasNoTexto(textoExecucao, empresasDoSender);
      if (empresasQualificadas && empresasQualificadas.termos.length >= 2) {
        if (empresasQualificadas.naoResolvidos.length) {
          return `Encontrei pedido para mais de uma empresa, mas nao consegui identificar: *${empresasQualificadas.naoResolvidos.join(', ')}*.\n\nEmpresas disponiveis: ${empresasDoSender.map(e => `*${e.nome || `#${e.empresa_id}`}*`).join(', ')}.`;
        }
        if (empresasQualificadas.empresas.length >= 2) {
          if (ctx?.lastIntent && String(ctx.lastIntentChannelId || '') === String(this._channelId || '')) {
            this._saveLastIntent(sender, ctx.lastIntent, '__all__');
          }
          this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
          this.log(`[resolverEmpresa] lista textual resolvida: ${empresasQualificadas.resolvidas.map(e => `${e.termo}->#${e.empresaId}`).join(', ')}`, 'info');
          return await this._pipelineAll(textoExecucao, empresasQualificadas.empresas, sender, {
            empresasMencionadasTextos: empresasQualificadas.termos,
            empresasMencionadasIds: empresasQualificadas.resolvidas.map(e => e.empresaId),
            _recebidoEm: opts._recebidoEm, _timingCtx,
          });
        }
      }
      const empresaQualificada = this._resolverEmpresaQualificadaNoTexto(textoExecucao, empresasDoSender)
        || this._resolverEmpresaPorAliasIsolado(textoExecucao, empresasDoSender);
      if (empresaQualificada?.status === 'not_found') {
        // "empresa X" mencionado mas X não é um tenant do canal → X é uma entidade cadastral
        // (cliente, fornecedor etc.). Preserva a empresa da sessão atual para não re-rotear
        // para _pipelineAll e perder o filtro de entidade que a IA-OWNER vai resolver.
        this.log(`[resolverEmpresa] empresa explicita nao encontrada no canal (${empresaQualificada.termo}), preservando sessao atual e seguindo fluxo de entidade`, 'info');
        // Contexto já era __all__: segue diretamente para _pipelineAll sem perguntar de novo
        if (ctx?.empresaId === '__all__') {
          return await this._pipelineAll(textoExecucao, empresasDoSender, sender, { _recebidoEm: opts._recebidoEm, _timingCtx });
        }
        const sessaoAtual = ctx?.empresaId ? ctx.empresaId : null;
        const empresaPadrao = sessaoAtual
          ? empresasDoSender.find(e => String(e.empresa_id) === String(sessaoAtual)) || null
          : (empresasDoSender.length === 1 ? empresasDoSender[0] : null);
        if (empresaPadrao) {
          empresaId = empresaPadrao.empresa_id;
          empresaResolvida = empresaPadrao;
          this._setSenderContext(sender, { empresaId, pendingText: null });
          // Segue o fluxo normal de empresa única — sai do bloco de resolução
        } else {
          // Múltiplas empresas sem sessão definida: pergunta qual empresa o usuário quer
          this._setSenderContext(sender, { pendingText: textoExecucao, empresaId: null });
          return this._formatarClarificacao(empresasDoSender);
        }
      } else if (empresaQualificada?.status === 'ambiguous') {
        this.log(`[resolverEmpresa] empresa explicita ambigua no canal: ${empresaQualificada.termo}`, 'warning');
        return `Nao consegui identificar com seguranca a empresa *${empresaQualificada.termo}*.\n\nEmpresas disponiveis: ${empresasDoSender.map(e => `*${e.nome || `#${e.empresa_id}`}*`).join(', ')}.`;
      } else {
      const resolucao = empresaQualificada?.status === 'resolved'
        ? { status: 'resolved', empresaId: empresaQualificada.empresaId, empresa: empresaQualificada.empresa, origem: 'texto_empresa' }
        : channelStore.resolverEmpresaDoCanal({
            channelId: this._channelId,
            sender,
            texto,
            sessaoEmpresaId: ctx?.empresaId || null,
            pending: !!ctx?.pendingText,
            usarPadrao: false,
            empresasDisponiveis: empresasDoSender,
          });
      this.log(`[resolverEmpresa] status=${resolucao.status} empresas=${resolucao.empresas?.length ?? (resolucao.empresaId || '?')} origem=${resolucao.origem || ''} channelId=${this._channelId}`, 'info');

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
        if (ctx?.empresaId !== '__all__' && !this._devePreservarContextoAnalitico(ctx, textoExecucao)) {
          this._clearLastIntent(sender);
        }
        this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
        if (wasReset) return `✅ Agora consultando *todas as empresas*.\nPode fazer sua pergunta.`;
        if (ctx?.pendingText) textoExecucao = ctx.pendingText;
        return await this._pipelineAll(textoExecucao, resolucao.empresas, sender, { _recebidoEm: opts._recebidoEm, _timingCtx });
      }

      if (this._isPedidoPorEmpresa(textoExecucao) && empresasDoSender.length > 1) {
        if (ctx?.lastIntent && String(ctx.lastIntentChannelId || '') === String(this._channelId || '')) {
          this._saveLastIntent(sender, ctx.lastIntent, '__all__');
        }
        this._setSenderContext(sender, { empresaId: '__all__', pendingText: null });
        return await this._pipelineAll(textoExecucao, empresasDoSender, sender, { _recebidoEm: opts._recebidoEm, _timingCtx });
      }

      empresaId = resolucao.empresaId;
      empresaResolvida = resolucao.empresa;
      if (ctx?.empresaId && String(ctx.empresaId) !== String(empresaId) && !this._devePreservarContextoAnalitico(ctx, textoExecucao)) {
        // Troca de tenant: limpa lastIntent mas preserva histórico.
        // O IA-OWNER decide semanticamente se herda período/filtros — não o sistema.
        this._clearLastIntentSemHistorico(sender);
      }
      this._setSenderContext(sender, { empresaId, pendingText: null });
      this.log(`Empresa resolvida: #${empresaId} (${resolucao.origem})`, 'info');

      if (wasReset) {
        return `✅ Empresa alterada para *${empresaResolvida?.nome || `#${empresaId}`}*.\nPode fazer sua pergunta.`;
      }

      if (ctx?.pendingText) {
        textoExecucao = ctx.pendingText;
      }
      } // fecha else (not_found tratado acima; resolved/ambiguous/all tratados aqui)
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

    // ── Resposta a pergunta de filial pendente (Option C multi-filial) ──────────
    const _ctxFilial = this._getSenderContext(sender);
    if (_ctxFilial?._perguntaFilialPendente && _ctxFilial?._intentPendente) {
      const filialParsed   = _parsearRespostaFilial(textoExecucao);
      const intentPendente = {
        ..._ctxFilial._intentPendente,
        filtros: { ...(_ctxFilial._intentPendente.filtros || {}), filial: filialParsed },
      };
      this._setSenderContext(sender, { _perguntaFilialPendente: false, _intentPendente: null, _intentPendenteEmpresaId: null });
      const resultadoPendente   = await intentRouter.rotear(intentPendente, empresaId);
      const respostaFilialFinal = resultadoPendente.resposta_direta
        || 'Não encontrei dados para essa consulta.';
      this._registrarInterpretacao({
        empresaId, sender, texto: textoExecucao,
        intent: intentPendente, resultado: resultadoPendente,
        resposta: respostaFilialFinal, duracaoMs: Date.now() - _t0,
      });
      return respostaFilialFinal;
    }

    // ── Diálogos conversacionais (verificados ANTES da IA) ─────────────────────
    // Mensagens conversacionais (saudações, despedidas, ajuda…) são resolvidas
    // localmente sem consumir nenhum token de IA externa.
    const dialogAntecipado = dialogResolver.resolver(textoExecucao, empresaId);
    if (dialogAntecipado.matched) {
      this.log(`💬 Diálogo conversacional (pré-IA, tipo: ${dialogAntecipado.tipo})`, 'info');
      return await this._responderDialogoComIA({
        empresaId,
        sender,
        texto: textoExecucao,
        dialogo: dialogAntecipado,
        t0: _t0,
      });
    }

    const scopedContexto = this._getScopedLastIntent(sender, empresaId, {
      texto: textoExecucao,
      allowCompatibleFallback: true,
    });
    let contextoAnterior = scopedContexto.intent;
    const lastIntentTs   = scopedContexto.ts;

    // Limite de profundidade conversacional: contexto anterior com nível >= thresholdReset.
    // Limpa contexto + historico e reprocessa a mensagem atual como T1 de nova conversa,
    // prefixando a resposta com uma nota explicativa ao usuário.
    // thresholdReset é desacoplado do buffer de histórico para IA (limiteContexto) para que
    // conversas longas com muitos refinamentos não resetem prematuramente.
    const limiteContexto = this._historicoTurnosConfig(empresaId);
    const thresholdReset = Math.max(limiteContexto * 3, 15);
    let _prefixoReset = null;
    if (contextoAnterior && (contextoAnterior._nivel_contexto || 1) >= thresholdReset) {
      this._clearLastIntent(sender);
      contextoAnterior = null;
      _prefixoReset = `🔄 *Conversa renovada* — atingimos o limite de ${thresholdReset} trocas desta consulta. Processei sua pergunta como início de uma nova consulta.\n\n`;
      this.log(`🔄 Contexto resetado (nível >= ${thresholdReset}); reprocessando mensagem como T1 para sender ${sender}`, 'info');
    }

    // Troca de assunto detectada deterministicamente → descarta contexto antes da IA
    if (contextoAnterior && contextPreCheck.isNewSubject(textoExecucao)) {
      this._clearLastIntent(sender);
      contextoAnterior = null;
      this.log(`🔄 Contexto descartado: novo assunto detectado antes da IA para sender ${sender}`, 'info');
    }

    const empresaQualificadaIntent = empresaResolvida && this._channelId
      ? this._resolverEmpresaQualificadaNoTexto(
          textoExecucao,
          channelStore.listarEmpresasDoCanal(this._channelId)
            .filter(e => !e.ocultar_selecao)
            .filter(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, sender))
        )
      : null;

    let intent = await intentService.classificar(textoExecucao, empresaId, {
      contextoAnterior,
      historicoResumido: this._buildHistoricoResumido(sender, empresaId, this._historicoTurnosConfig(empresaId)),
    });
    _timings.intent = Date.now();
    intent._mensagemOriginal = textoExecucao;
    if (empresaQualificadaIntent && Number(empresaQualificadaIntent.empresaId) === Number(empresaId)) {
      intent._empresaMencionadaTexto = empresaQualificadaIntent.termo;
      intent._empresaMencionadaId = empresaQualificadaIntent.empresaId;
    }
    intent._remetente = sender;
    if (contextoAnterior) {
      intent = intentMerger.mesclar(intent, contextoAnterior, lastIntentTs, textoExecucao, { ...this._configAnaliticaEmpresa(empresaId), limiteContexto: thresholdReset });
      if (empresaQualificadaIntent && Number(empresaQualificadaIntent.empresaId) === Number(empresaId)) {
        intent._empresaMencionadaTexto = empresaQualificadaIntent.termo;
        intent._empresaMencionadaId = empresaQualificadaIntent.empresaId;
      }
      if (scopedContexto.fallbackEscopo) {
        intent._contextoFallbackEscopo = true;
        intent._contextoEmpresaOrigem = scopedContexto.empresaIdOrigem || null;
      }
    }
    // Se filtros.empresa vier do histórico, verifica se é realmente uma empresa do canal antes de proteger
    // contra resolução cadastral. Sem essa verificação, um cliente como "Softexpert" poderia ser
    // bloqueado se o orquestrador o colocasse erroneamente em filtros.empresa.
    if (intent.filtros?.empresa && typeof intent.filtros.empresa === 'string' && !intent._empresaMencionadaTexto && this._channelId) {
      const empresasCanal = channelStore.listarEmpresasDoCanal(this._channelId)
        .filter(e => !e.ocultar_selecao && channelStore.senderAutorizadoEmpresa(e.empresa_id, sender));
      const verificada = this._resolverEmpresaQualificadaNoTexto(intent.filtros.empresa, empresasCanal);
      if (verificada?.status === 'resolved') {
        intent._empresaMencionadaTexto = verificada.termo;
        intent._empresaMencionadaId   = verificada.empresaId;
      } else {
        // Fallback: match direto pelo nome sem exigir a palavra "empresa" no texto.
        // Necessário para contexto herdado onde o valor (ex: "C3I") já foi validado como tenant
        // no turno anterior e foi restaurado pelo merger sem a palavra "empresa" no prefixo.
        const nomeNorm = _normalizarBuscaEmpresa(intent.filtros.empresa);
        if (nomeNorm) {
          const matchDireto = empresasCanal.find(e => _scoreEmpresaTexto(nomeNorm, e) >= 0.75);
          if (matchDireto) {
            intent._empresaMencionadaTexto = intent.filtros.empresa;
            intent._empresaMencionadaId   = matchDireto.empresa_id;
          }
        }
      }
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

    if (this._isIntentAiSqlDinamica(intent)) {
      intentService._garantirIntencoesDinamicasPadrao(empresaId);
      intent._historicoResumido = this._buildHistoricoResumido(sender, empresaId, this._historicoTurnosConfig(empresaId));
      if (!Array.isArray(intent._entidadesResolvidas) || !intent._entidadesResolvidas.length) {
        const recuperadas = this._recuperarEntidadesDoHistorico(intent.filtros, intent._historicoResumido);
        if (recuperadas.length) {
          intent._entidadesResolvidas = recuperadas;
          intent._entidadesRecuperadasDoHistorico = true;
        }
      }
    }
    let resultado = await intentRouter.rotear(intent, empresaId);
    _timings.router = Date.now();
    if (!resultado || typeof resultado !== 'object') {
      this.log(`Roteador retornou resultado inválido (${typeof resultado}) para empresa #${empresaId}. Abortando pipeline.`, 'error');
      return '⚠️ Ocorreu um erro interno ao processar sua consulta. Tente novamente.';
    }

    // Hook 2 — Fallback de continuidade: intent não classificado (desconhecido) +
    // contexto dinâmico ativo → passa mensagem para IA-OWNER como continuidade.
    // A IA-OWNER decide autonomamente se é continuidade real ou nova consulta.
    if (resultado.tipo === 'desconhecido' && contextoAnterior && this._ehIntentDinamica(contextoAnterior)) {
      this.log(`🔄 [Hook2] Fallback continuidade desconhecido→IA-OWNER: "${textoExecucao.slice(0, 60)}" | módulo: ${contextoAnterior._moduloDinamico || contextoAnterior.intencao}`, 'info');
      const intentCont = this._buildIntentContinuidade(contextoAnterior, intent, textoExecucao);
      if (this._isIntentAiSqlDinamica(intentCont)) {
        intentService._garantirIntencoesDinamicasPadrao(empresaId);
        intentCont._historicoResumido = this._buildHistoricoResumido(
          sender, empresaId, this._historicoTurnosConfig(empresaId)
        );
      }
      const resultadoCont = await intentRouter.rotear(intentCont, empresaId);
      if (resultadoCont && resultadoCont.tipo !== 'desconhecido' && resultadoCont.tipo !== 'erro') {
        this.log(`✅ [Hook2] Fallback resolvido: tipo=${resultadoCont.tipo}`, 'info');
        resultado = resultadoCont;
        intent = intentCont;
      } else {
        this.log(`⚠️ [Hook2] Fallback não resolveu (tipo=${resultadoCont?.tipo}), mantendo resposta original`, 'info');
      }
    }

    // Hook 3 — Chat livre: intent ainda desconhecido após todos os fallbacks →
    // passa direto para a IA conversacional sem estrutura de ERP.
    if (resultado.tipo === 'desconhecido') {
      this.log(`💬 [Hook3] Chat livre: "${textoExecucao.slice(0, 60)}"`, 'info');
      try {
        const ai = await conversationService.responder(textoExecucao, empresaId);
        if (ai.ok && ai.resposta) {
          const intentChat = {
            intencao: 'dialogo_conversacional',
            periodo: { tipo: 'nenhum' },
            filtros: {},
            confianca: 1,
            _provedor: ai.provedor || 'ia_chat',
            _mensagemOriginal: textoExecucao,
          };
          this._registrarInterpretacao({
            empresaId, sender, texto: textoExecucao,
            intent: intentChat,
            resultado: { tipo: 'dialogo', resposta_direta: ai.resposta },
            resposta: ai.resposta,
            duracaoMs: Date.now() - _t0,
          });
          // Salva no histórico para que o próximo turno possa herdar a mensagem
          // e a IA-OWNER entender que houve uma troca conversacional antes da consulta
          this._saveLastIntent(sender, intentChat, empresaId);
          return ai.resposta;
        }
      } catch (err) {
        this.log(`[Hook3] Chat livre falhou: ${err.message}`, 'warning');
      }
    }

    this._logResultadoIntent({ intent, resultado, escopo: 'single' });

    // Compras perguntou qual filial — armazena intent pendente e devolve pergunta
    if (resultado.tipo === 'pergunta_filial') {
      const perguntaFilial = resultado.resposta_direta;
      this._setSenderContext(sender, {
        _perguntaFilialPendente: true,
        _intentPendente:         resultado._intentPendente || intent,
        _intentPendenteEmpresaId: empresaId,
      });
      this._registrarInterpretacao({
        empresaId, sender, texto: textoExecucao,
        intent, resultado: { ...resultado, mensagem: perguntaFilial },
        resposta: perguntaFilial, duracaoMs: Date.now() - _t0,
      });
      return perguntaFilial;
    }

    if (resultado.tipo === 'pergunta_entidade') {
      const perguntaEntidade = resultado.resposta_direta;
      this._setSenderContext(sender, {
        _perguntaEntidadePendente: true,
        _opcoesEntidade:          resultado._opcoesEntidade || [],
        _intentPendente:          resultado._intentPendente || intent,
        _intentPendenteEmpresaId: empresaId,
      });
      this._registrarInterpretacao({
        empresaId, sender, texto: textoExecucao,
        intent, resultado: { ...resultado, mensagem: perguntaEntidade },
        resposta: perguntaEntidade, duracaoMs: Date.now() - _t0,
      });
      return perguntaEntidade;
    }

    const intentComPeriodoResolvidoBase = resultado?.periodo_resolvido
      ? { ...intent, periodo: resultado.periodo_resolvido }
      : intent;
    const intentComPeriodoResolvido = this._intentComContextoDoResultado(intentComPeriodoResolvidoBase, resultado, empresaId);

    this.emit('iac-intent', {
      empresaId,
      ...this._metaMonitorIntent(intentComPeriodoResolvido, resultado),
      intencao:        intentComPeriodoResolvido.intencao,
      provedor:        intentComPeriodoResolvido._provedor,
      motor:          this._rotuloMotor(intentComPeriodoResolvido),
      confianca:       intentComPeriodoResolvido.confianca,
      nivel_contexto:  intent._nivel_contexto || 1,
      periodo:         intentComPeriodoResolvido.periodo   || {},
      filtros:         intentComPeriodoResolvido.filtros   || {},
      agrupar_por:     intentComPeriodoResolvido.agrupar_por  || null,
      ordenar_por:     intentComPeriodoResolvido.ordenar_por  || null,
      limite:          intentComPeriodoResolvido.limite        || null,
      dataset_id:      resultado.dataset_id   || null,
      dataset_nome:    resultado.dataset_nome || null,
      resultado_tipo:  resultado.tipo,
      resultado_msg:   resultado.mensagem   || null,
      rows_count:      resultado.rows?.length ?? (resultado.rows === null ? null : resultado.rows?.length ?? null),
      sql_gerado:      resultado.sql_gerado   || null,
      duracao_ms:      resultado.duracao_ms   || null,
    });
    const resposta = this._formatarRespostaResultado(resultado, intentComPeriodoResolvido, {
      empresaId,
      messageTemplates,
      escopo: 'single',
    });

    // Persiste o intent na sessão para uso como contexto no próximo turno.
    // Salva apenas quando a execução produziu um resultado real (não erro ou desconhecido).
    if (resultado.tipo !== 'erro' && resultado.tipo !== 'desconhecido' && intent.intencao !== 'desconhecido') {
      this._saveLastIntent(sender, intentComPeriodoResolvido, empresaId);
    }

    const _now = Date.now();
    const _timingLog = {
      roteador_ms: _timings.roteador ? _timings.roteador - _timings.inicio : null,
      intent_ms:   _timings.intent   ? _timings.intent   - (_timings.roteador || _timings.inicio) : null,
      router_ms:   _timings.router   ? _timings.router   - (_timings.intent   || _timings.roteador || _timings.inicio) : null,
      total_ms:    _now - _timings.inicio,
    };
    const _formatacaoCaminho = intent?._formatacaoCaminho || resultado?._formatacaoCaminho || null;
    // pipeline_ms = do recebimento da mensagem até aqui (inclui tempo de fila antes do _pipeline)
    const _pipelineMs = _recebidoEm ? (_now - new Date(_recebidoEm).getTime()) : (_now - _t0);

    if (this._channelId && channelStore.listarEmpresasDoCanal(this._channelId).length > 1 && empresaResolvida?.nome) {
      const respostaFinal = (_prefixoReset || '') + messageTemplates.render(empresaId, 'resposta_empresa_prefixo', {
        empresa_nome: empresaResolvida.nome,
        empresa_id: empresaId,
        resposta,
        canal_nome: this._channelName || '',
      });
      this.log(`Registrando interpretacao: escopo=single | empresa=${empresaId} | chars=${String(respostaFinal || '').length}`, 'info');
      const _lid = this._registrarInterpretacao({ empresaId, sender, texto: textoExecucao, intent, resultado, resposta: respostaFinal, duracaoMs: _now - _t0, timingJson: _timingLog, formatacaoCaminho: _formatacaoCaminho, recebidoEm: _recebidoEm, pipelineMs: _pipelineMs });
      if (_timingCtx) { _timingCtx.logId = _lid; _timingCtx.recebidoEm = _recebidoEm; }
      this.log(`Interpretacao registrada: escopo=single | empresa=${empresaId}`, 'info');
      return respostaFinal;
    }
    const respostaFinal = (_prefixoReset || '') + resposta;
    this.log(`Registrando interpretacao: escopo=single | empresa=${empresaId} | chars=${String(respostaFinal || '').length}`, 'info');
    const _lid = this._registrarInterpretacao({ empresaId, sender, texto: textoExecucao, intent, resultado, resposta: respostaFinal, duracaoMs: _now - _t0, timingJson: _timingLog, formatacaoCaminho: _formatacaoCaminho, recebidoEm: _recebidoEm, pipelineMs: _pipelineMs });
    if (_timingCtx) { _timingCtx.logId = _lid; _timingCtx.recebidoEm = _recebidoEm; }
    this.log(`Interpretacao registrada: escopo=single | empresa=${empresaId}`, 'info');
    return respostaFinal;
  }

  async _pipelineAll(texto, empresas, sender = null, opts = {}) {
    const _t0 = Date.now();
    const _recebidoEmAll  = opts._recebidoEm ? new Date(opts._recebidoEm).toISOString() : null;
    const _timingCtxAll   = opts._timingCtx || null;
    const empresasOrdenadas = this._ordenarEmpresasPipelineAll(empresas);
    // Garante intenções dinâmicas padrão para TODAS as empresas antes do filtro,
    // evitando que empresas recém-cadastradas sejam descartadas por não terem intenções ainda.
    for (const emp of empresasOrdenadas) intentService._garantirIntencoesDinamicasPadrao(emp.empresa_id);
    // Filtra empresas que têm intenções E datasets cadastrados. Se nenhuma qualificar,
    // usa a lista original para ao menos tentar (garante fallback com mensagem adequada).
    const empresasAptas = empresasOrdenadas.filter(e => intentService.temConfiguracaoMinima(e.empresa_id));
    if (empresasAptas.length && empresasAptas.length < empresas.length) {
      this.log(`ℹ️  _pipelineAll: ${empresas.length - empresasAptas.length} empresa(s) sem datasets/intenções ignorada(s).`, 'info');
    }
    const empresasLoop = empresasAptas.length ? empresasAptas : empresasOrdenadas;

    // Tenta classificar usando cada empresa do canal até encontrar uma com IA configurada.
    // classificar() nunca lança — retorna _provedor='nenhum' quando sem chaves.
    const scopedContextAll = sender ? this._getScopedLastIntent(sender, '__all__', {
      texto,
      allowCompatibleFallback: true,
    }) : { intent: null, ts: 0 };
    let contextoAnteriorAll = scopedContextAll.intent;
    const lastIntentTsAll   = scopedContextAll.ts;

    const limiteContextoAll = empresasLoop[0] ? this._historicoTurnosConfig(empresasLoop[0].empresa_id) : 5;
    const thresholdResetAll = Math.max(limiteContextoAll * 3, 15);
    let _prefixoResetAll = null;
    if (contextoAnteriorAll && (contextoAnteriorAll._nivel_contexto || 1) >= thresholdResetAll) {
      if (sender) this._clearLastIntent(sender);
      contextoAnteriorAll = null;
      _prefixoResetAll = `🔄 *Conversa renovada* — atingimos o limite de ${thresholdResetAll} trocas desta consulta. Processei sua pergunta como início de uma nova consulta.\n\n`;
      this.log(`🔄 Contexto (all) resetado (nível >= ${thresholdResetAll}); reprocessando mensagem como T1 para sender ${sender}`, 'info');
    }

    if (contextoAnteriorAll && contextPreCheck.isNewSubject(texto)) {
      if (sender) this._clearLastIntent(sender);
      contextoAnteriorAll = null;
      this.log(`🔄 Contexto (all) descartado: novo assunto detectado antes da IA para sender ${sender}`, 'info');
    }

    let intent = null;
    let fallbackIntent = null;
    const falhasClassificacao = [];
    for (const emp of empresasLoop) {
      const result = await intentService.classificar(texto, emp.empresa_id, {
        contextoAnterior: contextoAnteriorAll,
        historicoResumido: this._buildHistoricoResumido(sender, emp.empresa_id, this._historicoTurnosConfig(emp.empresa_id)),
      });
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
    intent._mensagemOriginal = texto;
    intent._remetente = sender;
    if (Array.isArray(opts.empresasMencionadasTextos) && opts.empresasMencionadasTextos.length) {
      intent._empresasMencionadasTextos = opts.empresasMencionadasTextos;
      intent._empresasMencionadasIds = Array.isArray(opts.empresasMencionadasIds) ? opts.empresasMencionadasIds : [];
      intent._empresaMencionadaTexto = opts.empresasMencionadasTextos.join(' | ');
    }
    if (contextoAnteriorAll) {
      intent = intentMerger.mesclar(intent, contextoAnteriorAll, lastIntentTsAll, texto, { ...this._configAnaliticaEmpresa(empresasLoop[0]?.empresa_id || empresas[0]?.empresa_id), limiteContexto: thresholdResetAll });
      intent._mensagemOriginal = texto;
      intent._remetente = sender;
      if (Array.isArray(opts.empresasMencionadasTextos) && opts.empresasMencionadasTextos.length) {
        intent._empresasMencionadasTextos = opts.empresasMencionadasTextos;
        intent._empresasMencionadasIds = Array.isArray(opts.empresasMencionadasIds) ? opts.empresasMencionadasIds : [];
        intent._empresaMencionadaTexto = opts.empresasMencionadasTextos.join(' | ');
      }
      if (scopedContextAll.fallbackEscopo) {
        intent._contextoFallbackEscopo = true;
        intent._contextoEmpresaOrigem = scopedContextAll.empresaIdOrigem || null;
      }
    }
    if (intent._contextoAplicado && falhasClassificacao.length) {
      this.log('ℹ️  IA externa indisponivel, mas a engine interna resolveu pelo contexto da conversa.', 'info');
    }
    // Mesmo guard do fluxo single: verifica canal antes de proteger filtros.empresa
    if (intent.filtros?.empresa && typeof intent.filtros.empresa === 'string' && !intent._empresaMencionadaTexto && this._channelId) {
      const empresasCanal = channelStore.listarEmpresasDoCanal(this._channelId)
        .filter(e => !e.ocultar_selecao && channelStore.senderAutorizadoEmpresa(e.empresa_id, sender));
      const verificada = this._resolverEmpresaQualificadaNoTexto(intent.filtros.empresa, empresasCanal);
      if (verificada?.status === 'resolved') {
        intent._empresaMencionadaTexto = verificada.termo;
        intent._empresaMencionadaId   = verificada.empresaId;
      } else {
        const nomeNorm = _normalizarBuscaEmpresa(intent.filtros.empresa);
        if (nomeNorm) {
          const matchDireto = empresasCanal.find(e => _scoreEmpresaTexto(nomeNorm, e) >= 0.75);
          if (matchDireto) {
            intent._empresaMencionadaTexto = intent.filtros.empresa;
            intent._empresaMencionadaId   = matchDireto.empresa_id;
          }
        }
      }
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
    const empresaLogId = this._empresaConsolidadoId(empresasLoop, empresas);
    const senderAll = sender || '__all__';

    // Subtipos cujo resposta_direta é significativa para o usuário (domínio ou IA)
    // — devem ser exibidos diretamente em vez da mensagem genérica de sistema.
    const mensagemInconsistenciaPorSubtipo = (subtipo) => {
      if (/ia_indisponivel|sem_chave|cota_esgotada/.test(subtipo || '')) {
        return 'O servico de IA esta com instabilidade no momento. Aguarde alguns instantes e tente novamente.';
      }
      if (/sem_conexao/.test(subtipo || '')) {
        return 'Esta empresa nao possui conexao com o ERP configurada. Solicite ao administrador do sistema.';
      }
      if (/contrato_query_plan_invalido|contrato_ia_owner_invalido|sql_invalido|contrato_entidade_sql_invalido/.test(subtipo || '')) {
        return 'Nao consegui montar a consulta para essa combinacao de filtros. Tente dividir em duas perguntas separadas ou reformule com mais especificidade.';
      }
      if (/contrato_sx3_invalido|funcao_data_protheus_invalida/.test(subtipo || '')) {
        return 'Encontrei uma inconsistencia tecnica ao gerar a consulta. Tente reformular a pergunta com um periodo ou filtro diferente.';
      }
      if (/periodo_sql_inconsistente|periodo_sql_invalido/.test(subtipo || '')) {
        return 'Nao consegui identificar o periodo corretamente. Tente informar a data de forma explicita, como "junho de 2026" ou "01/06/2026 a 30/06/2026".';
      }
      if (/sql_nao_extraido|sql_bloqueado|sql_parametro_entidade_pendente/.test(subtipo || '')) {
        return 'Nao consegui completar a interpretacao da sua consulta. Reformule a pergunta e tente novamente.';
      }
      return 'Tivemos uma inconsistencia ao interpretar ou executar sua consulta. Por favor, reformule a pergunta e tente novamente.';
    };
    const SUBTIPOS_DOMINIO_DIRETO = new Set([
      'entidade_nao_encontrada', 'entidade_ia_nao_encontrada',
      'entidade_nao_encontrada_tenant', 'entidade_ambigua_tenant', 'sem_resultado',
      'nao_cadastrado', 'erp_id_nao_configurado', 'modulo_nao_autorizado',
      'acesso_negado_vendedor',
    ]);
    const SUBTIPOS_INCONSISTENCIA_INTERNA = new Set([
      'sql_invalido', 'periodo_sql_invalido', 'funcao_data_protheus_invalida',
      'contrato_query_plan_invalido', 'contrato_sx3_invalido', 'contrato_entidade_sql_invalido', 'filtro_vendedor_ausente',
      'contrato_ia_owner_invalido', 'contrato_entidade_invalido', 'periodo_sql_inconsistente', 'sql_bloqueado', 'sql_nao_extraido',
      'sql_parametro_entidade_pendente',
      'ia_indisponivel', 'sem_chave', 'cota_esgotada',
      'sem_conexao',
    ]);

    if (this._isIntentAiSqlDinamica(intent)) {
      let errosDinamicos = [];
      const errosSemDados = []; // erros de domínio com resposta amigável
      let ultimoResultadoDinamico = null;
      let sqlCanonicoDinamico = null;
      let bloqueioReusoCanonicoDinamico = null;
      let entidadesCanonicoDinamico = [];
      let respostaPlanejadaCanonicaDinamico = null;
      let periodoCanonicoDinamico = null;
      // Variável de interrupção: quando uma empresa retorna pergunta_filial/pergunta_entidade,
      // o _pipelineAll deve encerrar imediatamente. Usada para propagar a interrupção
      // do interior de _processarEmpresa (que não é mais o return direto do _pipelineAll).
      let _respostaInterrupcao = null;
      const sucessosDinamicos = [];
      const pendentesRetryCanonico = [];
      const subtiposRetryCanonico = new Set([
        'contrato_entidade_invalido',
        'contrato_ia_owner_invalido',
        'contrato_sx3_invalido',
        'contrato_entidade_sql_invalido',
        'sql_parametro_entidade_pendente',
        'sql_nao_extraido',
      ]);
      const diagnosticoErroEmpresa = ({ emp, resultado, respostaUsuario, retryPendente = false, retryExecutado = false, retrySucesso = false, canonicoOrigem = null }) => {
        const subtipo = resultado?.subtipo || resultado?.tipo || 'erro';
        const nomeEmpresa = emp?.nome || `Empresa #${emp?.empresa_id || 'n/a'}`;
        const sqlErro = resultado?._sql_validacao_erro
          || resultado?._sql_auditoria?.erro
          || resultado?.mensagem
          || resultado?.resposta_direta
          || null;
        const tituloPorSubtipo = {
          contrato_entidade_invalido: 'SQL gerado nao aplicou a entidade resolvida',
          contrato_ia_owner_invalido: 'SQL gerado nao passou no contrato IA-OWNER',
          contrato_sx3_invalido: 'SQL gerado usa campo incompatível com SX3 da empresa',
          contrato_entidade_sql_invalido: 'SQL gerado possui filtro de entidade incompatível',
          sql_parametro_entidade_pendente: 'SQL canonico ficou com parametro de entidade pendente',
          sql_nao_extraido: 'IA nao retornou um SQL executavel',
          entidade_nao_encontrada_tenant: 'Entidade nao encontrada no cadastro da empresa',
          entidade_ambigua_tenant: 'Entidade ambigua no cadastro da empresa',
          resultado_invalido_roteador: 'Roteador retornou resultado invalido',
          resultado_invalido_retry_canonico: 'Retry canonico retornou resultado invalido',
          sql_canonico_reuso_bloqueado: 'Reuso do SQL canonico foi bloqueado',
          resultado_dinamico_nao_tratado: 'Resultado dinamico nao foi tratado pelo pipeline',
          excecao_pipeline_multiempresa: 'Excecao inesperada no pipeline multiempresa',
          excecao_retry_canonico: 'Excecao inesperada no retry canonico',
        };
        const acaoSistema = retrySucesso
          ? `Empresa recuperada com retry canonico usando SQL base da empresa #${canonicoOrigem || 'n/a'}.`
          : retryExecutado
            ? `Retry canonico executado usando SQL base da empresa #${canonicoOrigem || 'n/a'}, mas a empresa ainda retornou erro.`
            : retryPendente
              ? 'Empresa aguardara retry quando outra empresa gerar um SQL canonico reutilizavel.'
              : 'Erro registrado sem retry canonico automatico para preservar a seguranca da consulta.';
        return {
          codigo: subtipo,
          empresa_id: emp?.empresa_id || null,
          empresa_nome: nomeEmpresa,
          titulo: tituloPorSubtipo[subtipo] || 'Falha tecnica ao processar a empresa',
          descricao: respostaUsuario || resultado?.resposta_direta || resultado?.mensagem || 'A consulta nao foi concluida para esta empresa.',
          detalhe: sqlErro,
          sql_gerado: resultado?.sql_gerado || null,
          sql_final_executado: resultado?._sql_auditoria?.sql_final_executado || null,
          retry_pendente: !!retryPendente,
          retry_executado: !!retryExecutado,
          retry_sucesso: !!retrySucesso,
          canonico_empresa_origem: canonicoOrigem || null,
          acao_sistema: acaoSistema,
        };
      };
      const registrarAnomaliaDinamica = ({ emp, intentExecucao = null, subtipo, mensagem, detalhe = null, retryExecutado = false, retrySucesso = false, canonicoOrigem = null }) => {
        const resultadoAnomalia = {
          tipo: 'erro',
          subtipo: subtipo || 'anomalia_multiempresa',
          resposta_direta: mensagem || 'Anomalia tecnica registrada no processamento multiempresa.',
          mensagem: detalhe || mensagem || null,
        };
        resultadoAnomalia._diagnostico_tecnico = diagnosticoErroEmpresa({
          emp,
          resultado: resultadoAnomalia,
          respostaUsuario: mensagem,
          retryExecutado,
          retrySucesso,
          canonicoOrigem,
        });
        this._registrarInterpretacao({
          empresaId: emp?.empresa_id || empresaLogId,
          sender: senderAll,
          texto,
          intent: intentExecucao || { ...intent, _escopoExecucao: 'whatsapp_all' },
          resultado: resultadoAnomalia,
          resposta: mensagem || resultadoAnomalia.resposta_direta,
          duracaoMs: Date.now() - _t0,
        });
        return resultadoAnomalia;
      };
      const registrarSucessoDinamico = (emp, intentExecucao, resultado, respostaAiSql, nomeEmpresa, rows, registrado = true) => {
        const intentExecucaoContextual = this._intentComContextoDoResultado(intentExecucao, resultado, emp.empresa_id);
        sucessosDinamicos.push({
          empresaId: emp.empresa_id,
          intentExecucao: intentExecucaoContextual,
          resultado,
          nomeEmpresa,
          resposta: respostaAiSql,
          rows: rows || [],
          _registrado: registrado,
        });
      };
      const tentarRetryCanonicoPendentes = async () => {
        if (!sqlCanonicoDinamico || bloqueioReusoCanonicoDinamico || !pendentesRetryCanonico.length) return;
        const pendentes = pendentesRetryCanonico.splice(0);
        for (const pendente of pendentes) {
          const empRetry = pendente.emp;
          const nomeEmpresaRetry = empRetry.nome || `Empresa #${empRetry.empresa_id}`;
          try {
            const historicoRetry = this._buildHistoricoResumido(sender, empRetry.empresa_id, this._historicoTurnosConfig(empRetry.empresa_id));
            const entidadesRetry = this._entidadesParaExecucaoAll(
              intent,
              empRetry.empresa_id,
              historicoRetry,
              sqlCanonicoDinamico,
              entidadesCanonicoDinamico
            );
            const intentRetry = {
              ...intent,
              ...(entidadesRetry.length ? { _entidadesResolvidas: entidadesRetry } : {}),
              _mensagemOriginal: texto,
              _remetente: sender,
              _escopoExecucao: 'whatsapp_all',
              _historicoResumido: historicoRetry,
              _usarSqlCanonicoWhatsappAll: true,
              _sqlCanonicoOriginal: sqlCanonicoDinamico,
              _sqlCanonicoEmpresaOrigem: pendente.empresaCanonicoOrigem || sucessosDinamicos[0]?.empresaId || null,
              _respostaPlanejadaCanonica: respostaPlanejadaCanonicaDinamico,
              _periodoCanonicoResolvido: periodoCanonicoDinamico,
            };
            this.log(`[All] Retry canonico para empresa #${empRetry.empresa_id} usando SQL definido pela empresa #${intentRetry._sqlCanonicoEmpresaOrigem || 'n/a'}.`, 'info');
            const resultadoRetry = await intentRouter.rotear(intentRetry, empRetry.empresa_id);
            if (!resultadoRetry || typeof resultadoRetry !== 'object') {
              this.log(`[All] Retry canonico empresa #${empRetry.empresa_id}: resultado invalido (${typeof resultadoRetry}).`, 'error');
              registrarAnomaliaDinamica({
                emp: empRetry,
                intentExecucao: intentRetry,
                subtipo: 'resultado_invalido_retry_canonico',
                mensagem: 'Retry canonico retornou resultado invalido.',
                detalhe: `typeof=${typeof resultadoRetry}`,
                retryExecutado: true,
                canonicoOrigem: intentRetry._sqlCanonicoEmpresaOrigem,
              });
              continue;
            }
            this._logResultadoIntent({ intent: intentRetry, resultado: resultadoRetry, escopo: 'all_retry_canonico' });
            ultimoResultadoDinamico = { empresaId: empRetry.empresa_id, resultado: resultadoRetry };
            if (resultadoRetry.tipo === 'sucesso_ai_sql') {
              errosDinamicos = errosDinamicos.filter(e => e !== pendente.erroMsg);
              const diagnosticoRetry = diagnosticoErroEmpresa({
                emp: empRetry,
                resultado: pendente.resultado,
                respostaUsuario: pendente.respostaUsuario,
                retryExecutado: true,
                retrySucesso: true,
                canonicoOrigem: intentRetry._sqlCanonicoEmpresaOrigem,
              });
              this.emit('iac-intent', {
                empresaId:      empRetry.empresa_id,
                ...this._metaMonitorIntent(intentRetry, resultadoRetry),
                intencao:       intent.intencao,
                provedor:       intent._provedor,
                motor:          this._rotuloMotor(intent),
                confianca:      intent.confianca,
                nivel_contexto: intent._nivel_contexto || 1,
                periodo:        intent.periodo  || {},
                filtros:        intent.filtros  || {},
                agrupar_por:    intent.agrupar_por  || null,
                ordenar_por:    intent.ordenar_por  || null,
                limite:         intent.limite        || null,
                dataset_id:     null,
                dataset_nome:   resultadoRetry.dataset_nome || null,
                resultado_tipo: 'sucesso_ai_sql',
                resultado_msg:  null,
                rows_count:     resultadoRetry.rows?.length || 0,
                sql_gerado:     resultadoRetry.sql_gerado   || null,
                duracao_ms:     resultadoRetry.duracao_ms   || null,
              });
              const respostaRetry = resultadoRetry.resposta_direta || 'NÃ£o encontrei dados para essa consulta.';
              const resultadoRetryRegistrado = {
                ...resultadoRetry,
                _retry_canonico: true,
                _retry_canonico_motivo: pendente.subtipoErro || pendente.resultado?.subtipo || null,
                _diagnostico_tecnico: diagnosticoRetry,
              };
              this._registrarInterpretacao({
                empresaId: empRetry.empresa_id,
                sender: senderAll,
                texto,
                intent: intentRetry,
                resultado: {
                  ...resultadoRetryRegistrado,
                  duracao_ms: resultadoRetry.duracao_ms ?? (Date.now() - _t0),
                },
                resposta: respostaRetry,
                duracaoMs: resultadoRetry.duracao_ms ?? (Date.now() - _t0),
              });
              registrarSucessoDinamico(empRetry, intentRetry, resultadoRetryRegistrado, respostaRetry, nomeEmpresaRetry, resultadoRetry.rows || [], true);
            } else if (resultadoRetry.tipo === 'erro' && resultadoRetry.resposta_direta) {
              const diagnosticoRetryErro = diagnosticoErroEmpresa({
                emp: empRetry,
                resultado: resultadoRetry,
                respostaUsuario: resultadoRetry.resposta_direta,
                retryExecutado: true,
                retrySucesso: false,
                canonicoOrigem: intentRetry._sqlCanonicoEmpresaOrigem,
              });
              this._registrarInterpretacao({
                empresaId: empRetry.empresa_id,
                sender: senderAll,
                texto,
                intent: intentRetry,
                resultado: { ...resultadoRetry, _retry_canonico: true, _diagnostico_tecnico: diagnosticoRetryErro },
                resposta: resultadoRetry.resposta_direta,
                duracaoMs: resultadoRetry.duracao_ms ?? (Date.now() - _t0),
              });
            }
          } catch (err) {
            this.log(`[All] Retry canonico empresa #${empRetry.empresa_id} falhou: ${err.message}`, 'warning');
            registrarAnomaliaDinamica({
              emp: empRetry,
              subtipo: 'excecao_retry_canonico',
              mensagem: 'Retry canonico falhou por excecao inesperada.',
              detalhe: err.message,
              retryExecutado: true,
            });
          }
        }
      };
      for (const emp of empresasLoop) intentService._garantirIntencoesDinamicasPadrao(emp.empresa_id);

      // ── Paralelismo com SQL Canônico ─────────────────────────────────────────
      // Fase A: empresa líder (índice 0) roda sequencialmente para gerar o SQL
      //         canônico via IA. Isso garante que retry da líder seja resolvido
      //         antes de iniciar as seguidoras, evitando retry duplicado em paralelo.
      // Fase B: empresas seguidoras rodam em Promise.all usando o SQL canônico
      //         já validado — sem chamada de IA, apenas adaptação de sufixo SX2.
      //         Se uma seguidora falhar, entra em pendentesRetryCanonico e o retry
      //         usa o canônico existente (nunca chama IA de novo).
      const _processarEmpresa = async (emp) => {
        try {
          _tracePipelineWhatsapp('all_empresa_inicio', {
            empresa_id: emp?.empresa_id,
            empresa_nome: emp?.nome || null,
            intencao: intent?.intencao || null,
            tem_sql_canonico: !!sqlCanonicoDinamico,
          });
          if (bloqueioReusoCanonicoDinamico) {
            const nomeEmpresa = emp.nome || `Empresa #${emp.empresa_id}`;
            const resposta = `O SQL canonico unico nao pode ser adaptado com seguranca para ${nomeEmpresa}: ${bloqueioReusoCanonicoDinamico}.`;
            errosDinamicos.push(`${nomeEmpresa}: ${resposta}`);
            this.log(`[All] ${resposta} Nenhum SQL adicional sera gerado.`, 'warning');
            registrarAnomaliaDinamica({
              emp,
              subtipo: 'sql_canonico_reuso_bloqueado',
              mensagem: resposta,
              detalhe: bloqueioReusoCanonicoDinamico,
            });
            return; // dentro de _processarEmpresa — equivale a continue no loop original
          }
          const _historicoEmp = this._buildHistoricoResumido(sender, emp.empresa_id, this._historicoTurnosConfig(emp.empresa_id));
          let _entidadesEmpFinal = this._entidadesParaExecucaoAll(
            intent,
            emp.empresa_id,
            _historicoEmp,
            sqlCanonicoDinamico,
            entidadesCanonicoDinamico
          );

          // Segurança multiempresa: se o SQL canônico contém placeholder vendedor_fixo_seguranca,
          // resolver o código ERP do remetente para ESTA empresa antes de executar.
          // Cada empresa usa seu próprio cadastro — nunca o código da empresa líder.
          if (sqlCanonicoDinamico && sender && _entidadesEmpFinal.some(e => e?.tipo === 'vendedor_fixo_seguranca')) {
            const resolucao = comissaoIAOwnerSpec.resolverVendedorFixoPorEmpresa(sender, emp.empresa_id);
            if (resolucao.estado === 'nao_cadastrado') {
              // Número não autorizado nesta empresa: bloquear sem expor dados
              const nomeEmpresa = emp.nome || `Empresa #${emp.empresa_id}`;
              this.log(`[All] Segurança: ${sender} não cadastrado na empresa #${emp.empresa_id} para comissão. Execução bloqueada.`, 'warning');
              errosDinamicos.push(`${nomeEmpresa}: número não autorizado para consulta de comissão.`);
              return;
            }
            if (resolucao.estado === 'vendedor_sem_codigo') {
              const nomeEmpresa = emp.nome || `Empresa #${emp.empresa_id}`;
              this.log(`[All] Segurança: ${sender} é vendedor na empresa #${emp.empresa_id} mas sem erp_id. Execução bloqueada.`, 'warning');
              errosDinamicos.push(`${nomeEmpresa}: código ERP do vendedor não configurado.`);
              return;
            }
            if (resolucao.estado === 'gestor') {
              // Gestor: remove o placeholder de segurança — SQL sem filtro de vendedor
              _entidadesEmpFinal = _entidadesEmpFinal.filter(e => e?.tipo !== 'vendedor_fixo_seguranca');
              this.log(`[All] Segurança: ${sender} é gestor na empresa #${emp.empresa_id} — sem filtro de vendedor.`, 'info');
            } else if (resolucao.estado === 'vendedor') {
              // Vendedor: substituir pela entidade com o código correto desta empresa
              _entidadesEmpFinal = _entidadesEmpFinal.map(e =>
                e?.tipo === 'vendedor_fixo_seguranca'
                  ? { ...e, codigo: resolucao.codigo, nome: resolucao.nome }
                  : e
              );
              this.log(`[All] Segurança: ${sender} é vendedor na empresa #${emp.empresa_id} — filtro E3_VEND='${resolucao.codigo}'.`, 'info');
            }
            // sem_restricao / sem_remetente: mantém entidades sem alteração
          }

          const intentExecucao = {
            ...intent,
            ...(_entidadesEmpFinal.length ? { _entidadesResolvidas: _entidadesEmpFinal } : {}),
            _mensagemOriginal: texto,
            _remetente: sender,
            _escopoExecucao: 'whatsapp_all',
            _historicoResumido: _historicoEmp,
            ...(sqlCanonicoDinamico
              ? {
                  _usarSqlCanonicoWhatsappAll: true,
                  _sqlCanonicoOriginal: sqlCanonicoDinamico,
                  _sqlCanonicoEmpresaOrigem: sucessosDinamicos[0]?.empresaId || null,
                  _respostaPlanejadaCanonica: respostaPlanejadaCanonicaDinamico,
                  _periodoCanonicoResolvido: periodoCanonicoDinamico,
                }
              : {}),
          };
          _tracePipelineWhatsapp('all_rotear_inicio', {
            empresa_id: emp?.empresa_id,
            intencao: intentExecucao?.intencao || null,
            reuso_canonico: !!intentExecucao?._usarSqlCanonicoWhatsappAll,
            historico_turnos: Array.isArray(intentExecucao?._historicoResumido) ? intentExecucao._historicoResumido.length : 0,
          });
          let resultado = await intentRouter.rotear(intentExecucao, emp.empresa_id);
          _tracePipelineWhatsapp('all_rotear_fim', {
            empresa_id: emp?.empresa_id,
            tipo: resultado?.tipo || null,
            subtipo: resultado?.subtipo || null,
            rows: Array.isArray(resultado?.rows) ? resultado.rows.length : null,
            duracao_ms: resultado?.duracao_ms ?? null,
            tem_sql: !!resultado?.sql_gerado,
            tem_sql_canonico: !!resultado?._sql_canonico,
          });
          if (!resultado || typeof resultado !== 'object') {
            this.log(`[All] Empresa #${emp.empresa_id}: resultado inválido do roteador (${typeof resultado}). Ignorando.`, 'error');
            const erroMsg = `${emp.nome || `Empresa #${emp.empresa_id}`}: erro interno no roteador.`;
            errosDinamicos.push(erroMsg);
            registrarAnomaliaDinamica({
              emp,
              intentExecucao,
              subtipo: 'resultado_invalido_roteador',
              mensagem: 'Roteador retornou resultado invalido no processamento multiempresa.',
              detalhe: `typeof=${typeof resultado}`,
            });
            return; // dentro de _processarEmpresa — equivale a continue no loop original
          }
          this._logResultadoIntent({ intent: intentExecucao, resultado, escopo: 'all' });
          ultimoResultadoDinamico = { empresaId: emp.empresa_id, resultado };

          if (resultado.tipo === 'sucesso_ai_sql') {
            if (!sqlCanonicoDinamico && resultado._sql_canonico) {
              _tracePipelineWhatsapp('all_canonico_inicio', {
                empresa_id: emp?.empresa_id,
                sql_canonico_chars: String(resultado._sql_canonico || '').length,
                entidades: Array.isArray(resultado._entidadesResolvidas) ? resultado._entidadesResolvidas.length : 0,
              });
              const moduloCanonico = this._moduloMonitorIntent(intentExecucao, resultado);
              const entidadesCanonico = Array.isArray(resultado._entidadesResolvidas) ? resultado._entidadesResolvidas : [];
              const canonico = this._sqlCanonicoParametrizado(resultado, moduloCanonico);
              const reusoCanonico = this._podeReusarSqlCanonicoComEntidades(entidadesCanonico, canonico);
              // Strip any company-specific physical suffixes (e.g. SF2990, SF2020) before storing
              // the canonical SQL. The module-runner applies adaptarSqlCanonicoPorSX2 per-company
              // at execution time, so the stored SQL must be suffix-free to be safely reusable
              // across tenants with different SX2 maps — regardless of SQL origin (ia_owner or not).
              const sqlCanonicoParaReuso = canonico.sql ? sx2SqlNormalizer.sqlParaCanonico(canonico.sql) : canonico.sql;
              _tracePipelineWhatsapp('all_canonico_fim', {
                empresa_id: emp?.empresa_id,
                reuso_ok: !!reusoCanonico?.ok,
                reuso_motivo: reusoCanonico?.motivo || null,
                parametrizado: !!canonico?.alterou,
                sql_reuso_chars: String(sqlCanonicoParaReuso || '').length,
              });
              const reusoPermitido = reusoCanonico.ok;
              resultado._sql_canonico_reuso_tecnico_permitido = !!reusoPermitido;
              resultado._sql_canonico_reuso_permitido = false;
              resultado._sql_canonico_reuso_motivo = reusoCanonico.motivo || 'whatsapp_all_cross_tenant_reuso_desativado';
              const sqlCanonicoAuditavel = sqlCanonicoParaReuso || resultado._sql_canonico_original || resultado._sql_canonico;
              resultado._sql_canonico_original = reusoCanonico.ok
                ? sqlCanonicoAuditavel
                : (resultado._sql_canonico_original || resultado._sql_canonico);
              resultado._sql_canonico_parametros = canonico.parametros || [];
              resultado._sql_canonico_parametrizado = !!canonico.alterou;
              if (reusoPermitido) {
                const veioDaIaOwner = resultado._sql_canonico_origem === 'ia_owner' || !!resultado._ia_owner_plano;
                this.log(`[All] SQL canonico registrado pela empresa #${emp.empresa_id}${veioDaIaOwner ? ' (ia_owner, sufixos normalizados)' : ''}; execucao direta cross-tenant desativada no WhatsApp_all. Proximas empresas usarao execucao completa.`, 'info');
              } else {
                this.log(`[All] SQL canonico da empresa #${emp.empresa_id} registrado apenas para auditoria: ${resultado._sql_canonico_reuso_motivo}. Proximas empresas usarao execucao completa.`, 'warning');
              }
            }
            this.emit('iac-intent', {
              empresaId:      emp.empresa_id,
              ...this._metaMonitorIntent(intentExecucao, resultado),
              intencao:       intent.intencao,
              provedor:       intent._provedor,
              motor:          this._rotuloMotor(intent),
              confianca:      intent.confianca,
              nivel_contexto: intent._nivel_contexto || 1,
              periodo:        intent.periodo  || {},
              filtros:        intent.filtros  || {},
              agrupar_por:    intent.agrupar_por  || null,
              ordenar_por:    intent.ordenar_por  || null,
              limite:         intent.limite        || null,
              dataset_id:     null,
              dataset_nome:   resultado.dataset_nome || null,
              resultado_tipo: 'sucesso_ai_sql',
              resultado_msg:  null,
              rows_count:     resultado.rows?.length || 0,
              sql_gerado:     resultado.sql_gerado   || null,
              duracao_ms:     resultado.duracao_ms   || null,
            });
            const nomeEmpresa = emp.nome || `Empresa #${emp.empresa_id}`;
            const respostaAiSql = resultado.resposta_direta || 'Não encontrei dados para essa consulta.';
            this._registrarInterpretacao({
              empresaId: emp.empresa_id,
              sender: senderAll,
              texto,
              intent: intentExecucao,
              resultado: { ...resultado, duracao_ms: resultado.duracao_ms ?? (Date.now() - _t0) },
              resposta: respostaAiSql,
              duracaoMs: resultado.duracao_ms ?? (Date.now() - _t0),
            });
            registrarSucessoDinamico(emp, intentExecucao, resultado, respostaAiSql, nomeEmpresa, resultado.rows || [], true);
            // Retry canônico pendente: só invoca aqui no caminho sequencial (líder).
            // No caminho paralelo (seguidoras), o retry é consolidado após Promise.all.
            if (!sqlCanonicoDinamico) await tentarRetryCanonicoPendentes();
            return; // dentro de _processarEmpresa — equivale a continue no loop original
          }

          if (resultado.tipo === 'pergunta_filial') {
            const perguntaFilial = resultado.resposta_direta;
            this._setSenderContext(senderAll, {
              _perguntaFilialPendente: true,
              _intentPendente:         resultado._intentPendente || intent,
              _intentPendenteEmpresaId: emp.empresa_id,
            });
            this._registrarInterpretacao({
              empresaId: emp.empresa_id, sender: senderAll, texto, intent: intentExecucao,
              resultado: { ...resultado, mensagem: perguntaFilial },
              resposta: perguntaFilial, duracaoMs: Date.now() - _t0,
            });
            _respostaInterrupcao = perguntaFilial;
            return; // sinaliza interrupção; _pipelineAll verifica _respostaInterrupcao
          }

          if (resultado.tipo === 'pergunta_entidade') {
            const perguntaEntidade = resultado.resposta_direta;
            this._setSenderContext(senderAll, {
              _perguntaEntidadePendente: true,
              _opcoesEntidade:           resultado._opcoesEntidade || [],
              _intentPendente:           resultado._intentPendente || intent,
              _intentPendenteEmpresaId:  emp.empresa_id,
              _intentPendenteEmpresasAll: empresasLoop,
            });
            this._registrarInterpretacao({
              empresaId: emp.empresa_id, sender: senderAll, texto, intent: intentExecucao,
              resultado: { ...resultado, mensagem: perguntaEntidade },
              resposta: perguntaEntidade, duracaoMs: Date.now() - _t0,
            });
            _respostaInterrupcao = perguntaEntidade;
            return; // sinaliza interrupção; _pipelineAll verifica _respostaInterrupcao
          }

          if (resultado.tipo === 'erro' && resultado.resposta_direta) {
            this.log(`[All] Empresa #${emp.empresa_id} dinamica erro: ${resultado.subtipo || resultado.tipo}`, 'info');
            const subtipoErro = resultado.subtipo || resultado.tipo;
            const inconsistenciaInterna = SUBTIPOS_INCONSISTENCIA_INTERNA.has(subtipoErro);
            const respostaUsuario = inconsistenciaInterna ? mensagemInconsistenciaPorSubtipo(subtipoErro) : resultado.resposta_direta;
            const retryElegivel = !sqlCanonicoDinamico && subtiposRetryCanonico.has(subtipoErro);
            const resultadoComDiagnostico = {
              ...resultado,
              _diagnostico_tecnico: diagnosticoErroEmpresa({
                emp,
                resultado,
                respostaUsuario,
                retryPendente: retryElegivel,
              }),
            };
            this._registrarInterpretacao({
              empresaId: emp.empresa_id,
              sender: senderAll,
              texto,
              intent: intentExecucao,
              resultado: resultadoComDiagnostico,
              resposta: respostaUsuario,
              duracaoMs: resultado.duracao_ms ?? (Date.now() - _t0),
            });
            if (SUBTIPOS_DOMINIO_DIRETO.has(subtipoErro)) {
              // Erro de domínio — resposta_direta é significativa para o usuário
              errosSemDados.push({ nomeEmpresa: emp.nome || `Empresa #${emp.empresa_id}`, resposta: respostaUsuario, resultado: resultadoComDiagnostico, emp, _registrado: true });
            } else if (inconsistenciaInterna) {
              const erroMsg = `${emp.nome || `Empresa #${emp.empresa_id}`}: ${respostaUsuario}`;
              errosDinamicos.push(erroMsg);
              if (retryElegivel) {
                pendentesRetryCanonico.push({ emp, intentExecucao, resultado: resultadoComDiagnostico, respostaUsuario, subtipoErro, erroMsg });
                this.log(`[All] Empresa #${emp.empresa_id} aguardara retry com SQL canonico: ${subtipoErro}.`, 'info');
              }
            } else {
              errosDinamicos.push(`${emp.nome || `Empresa #${emp.empresa_id}`}: ${respostaUsuario}`);
            }
            return; // dentro de _processarEmpresa — equivale a continue no loop original
          }

          errosDinamicos.push(`${emp.nome || `Empresa #${emp.empresa_id}`}: ${resultado.mensagem || resultado.subtipo || resultado.tipo}`);
          this.log(`[All] Empresa #${emp.empresa_id} dinamica ignorada: ${resultado.mensagem || resultado.subtipo || resultado.tipo}`, 'info');
          registrarAnomaliaDinamica({
            emp,
            intentExecucao,
            subtipo: resultado.subtipo || resultado.tipo || 'resultado_dinamico_nao_tratado',
            mensagem: 'Resultado dinamico nao foi tratado pelo pipeline multiempresa.',
            detalhe: resultado.mensagem || resultado.subtipo || resultado.tipo || null,
          });
        } catch (err) {
          _tracePipelineWhatsapp('all_empresa_excecao', {
            empresa_id: emp?.empresa_id,
            erro: err?.message || String(err),
            stack: err?.stack || null,
          });
          errosDinamicos.push(`${emp.nome || `Empresa #${emp.empresa_id}`}: ${err.message}`);
          this.log(`[All] Empresa #${emp.empresa_id} dinamica falhou: ${err.message}`, 'warning');
          registrarAnomaliaDinamica({
            emp,
            subtipo: 'excecao_pipeline_multiempresa',
            mensagem: 'Empresa falhou por excecao inesperada no pipeline multiempresa.',
            detalhe: err.message,
          });
        }
      }; // fim _processarEmpresa

      // ── Fase A: empresa líder (sempre sequencial) ────────────────────────────
      // Gera o SQL canônico via IA. Retry da líder é resolvido aqui antes de
      // iniciar as seguidoras, garantindo que elas nunca precisem chamar a IA.
      if (empresasLoop.length > 0) {
        await _processarEmpresa(empresasLoop[0]);
        if (_respostaInterrupcao) return _respostaInterrupcao; // pergunta_filial/entidade
      }

      // ── Fase B: empresas seguidoras em paralelo ──────────────────────────────
      // Só paraleliza se a líder gerou um SQL canônico reutilizável.
      // Sem canônico (líder falhou ou bloqueou reuso), segue sequencial como antes.
      const empresasSeguidoras = empresasLoop.slice(1);
      if (empresasSeguidoras.length > 0) {
        if (sqlCanonicoDinamico && !bloqueioReusoCanonicoDinamico) {
          this.log(`[All] SQL canonico disponivel — processando ${empresasSeguidoras.length} empresa(s) seguidora(s) em paralelo.`, 'info');
          await Promise.all(empresasSeguidoras.map(emp => _processarEmpresa(emp)));
          // Após o paralelo, tenta retry canônico para quaisquer pendentes
          // (seguidoras que falharam mas são elegíveis para retry com o canônico)
          await tentarRetryCanonicoPendentes();
        } else {
          this.log(`[All] Sem SQL canonico reutilizavel — processando ${empresasSeguidoras.length} empresa(s) seguidora(s) sequencialmente.`, 'info');
          for (const emp of empresasSeguidoras) {
            await _processarEmpresa(emp);
            if (_respostaInterrupcao) return _respostaInterrupcao;
          }
          // Após o loop sequencial, tenta retry para pendentes que se tornaram elegíveis
          // porque uma seguidora gerou o SQL canônico durante a execução.
          await tentarRetryCanonicoPendentes();
        }
      }

      // Consolida respostas de todas as empresas que tiveram sucesso
      if (sucessosDinamicos.length) {
        const periodoResolvidoDinamico = sucessosDinamicos.find(s => s?.resultado?.periodo_resolvido)?.resultado?.periodo_resolvido || null;
        const intentDinamicoResolvido = periodoResolvidoDinamico
          ? { ...intent, periodo: periodoResolvidoDinamico }
          : intent;
        const entidadesPorEmpresa = sucessosDinamicos.reduce((acc, s) => {
          if (Array.isArray(s.resultado?._entidadesResolvidas) && s.resultado._entidadesResolvidas.length) {
            acc[String(s.empresaId)] = s.resultado._entidadesResolvidas;
          }
          return acc;
        }, {});
        // Propaga _contextoIAAnterior e _sqlCanonicoOriginal do primeiro sucesso —
        // todos processaram a mesma pergunta, portanto o contexto acumulado é equivalente entre empresas.
        const contextoIAAnteriorDinamico = sucessosDinamicos
          .map(s => s.intentExecucao?._contextoIAAnterior || s.resultado?._contextoIAAnterior)
          .find(Boolean) || null;
        const sqlCanonicoOriginalDinamico = sucessosDinamicos
          .map(s => s.intentExecucao?._sqlCanonicoOriginal || s.resultado?._sql_canonico_original || s.resultado?._sql_canonico)
          .find(Boolean) || null;
        const intentDinamicoContextual = {
          ...intentDinamicoResolvido,
          ...(Object.keys(entidadesPorEmpresa).length ? {
            _entidadesResolvidasPorEmpresa: entidadesPorEmpresa,
            ...(sucessosDinamicos.length === 1 ? { _entidadesResolvidas: Object.values(entidadesPorEmpresa)[0] } : {}),
          } : {}),
          ...(contextoIAAnteriorDinamico ? { _contextoIAAnterior: contextoIAAnteriorDinamico } : {}),
          ...(sqlCanonicoOriginalDinamico ? { _sqlCanonicoOriginal: sqlCanonicoOriginalDinamico } : {}),
        };
        if (sender && intent.intencao !== 'desconhecido') {
          this._saveLastIntent(sender, intentDinamicoContextual, '__all__');
        }
        // Auditoria consolidada: sempre criada, independente de quantas empresas houve
        const sqlConsolidado = sucessosDinamicos
          .filter(s => s.resultado?.sql_gerado)
          .map(s => `-- ${s.nomeEmpresa}\n${s.resultado.sql_gerado}`)
          .join('\n\n') || null;
        const _audPrimeiro = sucessosDinamicos[0]?.resultado?._sql_auditoria || {};
        const sqlAuditoriaConsolidada = {
          handler: 'whatsapp_all',
          origem: 'consolidado_multiempresa',
          // Espelha no nivel raiz os campos de auditoria de SQL da empresa lider (primeira a
          // gerar o SQL via IA), para a tela de detalhe do consolidado (admin-interpretacoes-v2)
          // exibir SQL final/canonico/bruto sem precisar descer em "empresas[]". Os registros
          // individuais de cada empresa (nao-consolidados) ja tem isso no proprio nivel raiz —
          // aqui e so para o registro que representa o canal como um todo.
          sql_canonico_original: sqlCanonicoDinamico || _audPrimeiro.sql_canonico_recebido || null,
          sql_canonico_recebido: _audPrimeiro.sql_canonico_recebido || sqlCanonicoDinamico || null,
          sql_ia_bruto:          _audPrimeiro.sql_ia_bruto || null,
          sql_apos_sx3:          _audPrimeiro.sql_apos_sx3 || null,
          sql_apos_sx2:          _audPrimeiro.sql_apos_sx2 || null,
          sql_apos_parametros:   _audPrimeiro.sql_apos_parametros || null,
          sql_apos_contrato:     _audPrimeiro.sql_apos_contrato || null,
          sql_final_executado:   _audPrimeiro.sql_final_executado || sucessosDinamicos[0]?.resultado?.sql_gerado || null,
          prompt_system: _audPrimeiro.prompt_system || null,
          prompt_user:   _audPrimeiro.prompt_user   || null,
          empresas_tentadas: empresas.map(e => e.nome || `Empresa #${e.empresa_id}`),
          empresas: sucessosDinamicos.map(s => ({
            empresa_id:            s.empresaId,
            empresa_nome:          s.nomeEmpresa,
            sql_gerado:            s.resultado.sql_gerado || null,
            sql_ia_bruto:          s.resultado._sql_auditoria?.sql_ia_bruto || null,
            sql_canonico_recebido: s.resultado._sql_auditoria?.sql_canonico_recebido || null,
            sql_apos_sx3:          s.resultado._sql_auditoria?.sql_apos_sx3 || null,
            sql_apos_sx2:          s.resultado._sql_auditoria?.sql_apos_sx2 || null,
            sql_apos_parametros:   s.resultado._sql_auditoria?.sql_apos_parametros || null,
            sql_apos_contrato:     s.resultado._sql_auditoria?.sql_apos_contrato || null,
            sql_final_executado:   s.resultado._sql_auditoria?.sql_final_executado || s.resultado.sql_gerado || null,
            sql_canonico_adaptado: s.resultado._sql_canonico || null,
            retry_canonico:        !!s.resultado._retry_canonico,
            retry_canonico_motivo: s.resultado._retry_canonico_motivo || null,
            diagnostico_tecnico:   s.resultado._diagnostico_tecnico || null,
            rows_count:            (s.rows || []).length,
          })),
          empresas_sem_dados: errosSemDados.map(sd => ({
            empresa_id:          sd.emp.empresa_id,
            empresa_nome:        sd.nomeEmpresa,
            subtipo:             sd.resultado.subtipo || sd.resultado.tipo,
            sql_gerado:          sd.resultado.sql_gerado || null,
            sql_final_executado: sd.resultado._sql_auditoria?.sql_final_executado || null,
            sql_canonico_adaptado: sd.resultado._sql_canonico || sd.resultado._sql_auditoria?.sql_apos_sx2 || null,
            diagnostico_tecnico: sd.resultado._diagnostico_tecnico || null,
            motivo:              sd.resultado.resposta_direta || null,
          })),
          empresas_com_erro: errosDinamicos,
        };

        if (sucessosDinamicos.length === 1 && empresasLoop.length === 1) {
          const s = sucessosDinamicos[0];
          if (!s._registrado) {
            this._registrarInterpretacao({ empresaId: s.empresaId, sender: senderAll, texto, intent: s.intentExecucao, resultado: { ...s.resultado, duracao_ms: s.resultado.duracao_ms ?? (Date.now() - _t0) }, resposta: s.resposta, duracaoMs: s.resultado.duracao_ms ?? (Date.now() - _t0) });
          }
          // Segundo registro: auditoria consolidada com SQL de todas as empresas do canal
          const _now1 = Date.now();
          const _pm1 = _recebidoEmAll ? (_now1 - new Date(_recebidoEmAll).getTime()) : (_now1 - _t0);
          const _lid1 = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: { tipo: 'sucesso_ai_sql', rows: s.rows, sql_gerado: sqlConsolidado, _sql_auditoria: sqlAuditoriaConsolidada, _pipeline_origem: 'consolidado' }, resposta: s.resposta, duracaoMs: _now1 - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm1 });
          if (_timingCtxAll) { _timingCtxAll.logId = _lid1; _timingCtxAll.recebidoEm = _recebidoEmAll; }
          return (_prefixoResetAll || '') + s.resposta;
        }
        const consolidado = canonicalWhatsappFormat.renderAll(sucessosDinamicos, {
          mensagem: String(texto || '').trim(),
        }) || this._formatarConsolidadoDinamicoAll(intentDinamicoResolvido, sucessosDinamicos, empresaLogId);
        const respostaConsolidada = sucessosDinamicos
          .map(s => `🏢 *${s.nomeEmpresa}*\n${s.resposta}`)
          .join('\n\n');
        const respostaSemDados = errosSemDados.length
          ? errosSemDados.map(e => `*${e.nomeEmpresa}*\n${e.resposta}`).join('\n\n')
          : '';
        const avisos = errosDinamicos.length
          ? `\n\n⚠️ *Nao consegui consultar:*\n${errosDinamicos.map(e => `- ${String(e || '').trim()}`).join('\n')}`
          : '';
        const respostaFinalConsolidada = (_prefixoResetAll || '') + [respostaConsolidada, respostaSemDados, consolidado].filter(Boolean).join('\n\n') + avisos;
        const _now2 = Date.now();
        const _pm2 = _recebidoEmAll ? (_now2 - new Date(_recebidoEmAll).getTime()) : (_now2 - _t0);
        const _lid2 = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: { tipo: 'sucesso_ai_sql', rows: sucessosDinamicos.flatMap(s => s.rows), sql_gerado: sqlConsolidado, _sql_auditoria: sqlAuditoriaConsolidada, _pipeline_origem: 'consolidado' }, resposta: respostaFinalConsolidada, duracaoMs: _now2 - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm2 });
        if (_timingCtxAll) { _timingCtxAll.logId = _lid2; _timingCtxAll.recebidoEm = _recebidoEmAll; }
        return respostaFinalConsolidada;
      }

      // Sem sucessos mas com erros de domínio (entidade sem dados no período) — responde diretamente
      if (errosSemDados.length && !errosDinamicos.length) {
        let respostaDominio = errosSemDados.length === 1
          ? errosSemDados[0].resposta
          : errosSemDados.map(e => `🏢 *${e.nomeEmpresa}*\n${e.resposta}`).join('\n\n');
        const respostasUnicasDominio = [...new Set(errosSemDados.map(e => String(e.resposta || '').trim()).filter(Boolean))];
        if (respostasUnicasDominio.length === 1) respostaDominio = respostasUnicasDominio[0];
        for (const sd of errosSemDados) {
          if (sd._registrado) continue;
          this._registrarInterpretacao({
            empresaId: sd.emp.empresa_id, sender: senderAll, texto, intent,
            resultado: sd.resultado, resposta: sd.resposta, duracaoMs: Date.now() - _t0,
          });
        }
        // Segundo registro: auditoria consolidada mesmo sem dados
        const _audFalhaPrimeiro = errosSemDados[0]?.resultado?._sql_auditoria || {};
        const sqlAuditoriaFalha = {
          handler: 'whatsapp_all',
          origem: 'consolidado_multiempresa_sem_dados',
          sql_canonico_original: sqlCanonicoDinamico || null,
          prompt_system: _audFalhaPrimeiro.prompt_system || null,
          prompt_user:   _audFalhaPrimeiro.prompt_user   || null,
          empresas_tentadas: empresas.map(e => e.nome || `Empresa #${e.empresa_id}`),
          empresas: errosSemDados.map(sd => ({
            empresa_id:          sd.emp.empresa_id,
            empresa_nome:        sd.nomeEmpresa,
            subtipo:             sd.resultado.subtipo || sd.resultado.tipo,
            sql_gerado:          sd.resultado.sql_gerado || null,
            sql_final_executado: sd.resultado._sql_auditoria?.sql_final_executado || null,
            sql_ia_bruto:        sd.resultado._sql_auditoria?.sql_ia_bruto || null,
            sql_canonico_adaptado: sd.resultado._sql_canonico || sd.resultado._sql_auditoria?.sql_apos_sx2 || null,
            diagnostico_tecnico: sd.resultado._diagnostico_tecnico || null,
            motivo:              sd.resultado.resposta_direta || null,
          })),
        };
        const sqlFalha = errosSemDados.find(sd => sd.resultado.sql_gerado)?.resultado.sql_gerado || null;
        const _now3 = Date.now();
        const _pm3 = _recebidoEmAll ? (_now3 - new Date(_recebidoEmAll).getTime()) : (_now3 - _t0);
        const _lid3 = this._registrarInterpretacao({
          empresaId: empresaLogId, sender: senderAll, texto, intent,
          resultado: { tipo: 'sem_dados', sql_gerado: sqlFalha, _sql_auditoria: sqlAuditoriaFalha, _pipeline_origem: 'consolidado' },
          resposta: respostaDominio, duracaoMs: _now3 - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm3,
        });
        if (_timingCtxAll) { _timingCtxAll.logId = _lid3; _timingCtxAll.recebidoEm = _recebidoEmAll; }
        return respostaDominio;
      }

      // Consolidar auditoria de prompts + SQL do último resultado por empresa.
      // Espelha o padrão do caminho de sucesso (linha ~3569) e sem_dados (linha ~3638).
      // Sem isso, o registro consolidado fica com sql_auditoria_json = null — prompts
      // e sql_ia_bruto invisíveis na auditoria mesmo quando a FASE 3b rodou.
      const _audUltimo = ultimoResultadoDinamico?.resultado?._sql_auditoria || {};
      const resultadosErroAuditaveis = [...pendentesRetryCanonico];

      const _subtipoDominante = resultadosErroAuditaveis.length
        ? (resultadosErroAuditaveis[0].subtipoErro || resultadosErroAuditaveis[0].resultado?.subtipo || null)
        : (ultimoResultadoDinamico?.resultado?.subtipo || null);
      const respostaErro = errosDinamicos.length
        ? (SUBTIPOS_DOMINIO_DIRETO.has(_subtipoDominante)
            ? (ultimoResultadoDinamico?.resultado?.resposta_direta || mensagemInconsistenciaPorSubtipo(_subtipoDominante))
            : mensagemInconsistenciaPorSubtipo(_subtipoDominante))
        : 'Nao consegui executar a consulta dinamica nas empresas disponiveis. Verifique se a intencao dinamica, conexao ERP e chaves de IA estao configuradas.';
      if (
        ultimoResultadoDinamico?.resultado
        && !resultadosErroAuditaveis.some(p => p.emp?.empresa_id === ultimoResultadoDinamico.empresaId)
      ) {
        const empUltima = empresas.find(e => e.empresa_id === ultimoResultadoDinamico.empresaId)
          || { empresa_id: ultimoResultadoDinamico.empresaId, nome: `Empresa #${ultimoResultadoDinamico.empresaId}` };
        resultadosErroAuditaveis.push({
          emp: empUltima,
          resultado: ultimoResultadoDinamico.resultado,
          respostaUsuario: ultimoResultadoDinamico.resultado?.resposta_direta || ultimoResultadoDinamico.resultado?.mensagem || null,
        });
      }
      const sqlErroConsolidado = resultadosErroAuditaveis
        .filter(p => p.resultado?.sql_gerado || p.resultado?._sql_auditoria?.sql_ia_bruto)
        .map(p => {
          const nome = p.emp?.nome || `Empresa #${p.emp?.empresa_id || 'n/a'}`;
          const sql = p.resultado.sql_gerado || p.resultado._sql_auditoria?.sql_ia_bruto;
          return `-- ${nome}\n${sql}`;
        })
        .join('\n\n') || ultimoResultadoDinamico?.resultado?.sql_gerado || _audUltimo.sql_ia_bruto || null;
      const _auditoriaErroConsolidada = {
        handler: 'whatsapp_all',
        origem: 'consolidado_multiempresa_erro_total',
        prompt_system: _audUltimo.prompt_system || null,
        prompt_user:   _audUltimo.prompt_user   || null,
        sql_ia_bruto:  _audUltimo.sql_ia_bruto  || null,
        sql_gerado:    sqlErroConsolidado,
        sql_apos_sx3:  _audUltimo.sql_apos_sx3  || null,
        empresas_tentadas: empresas.map(e => e.nome || `Empresa #${e.empresa_id}`),
        empresas_com_erro: errosDinamicos,
        // Detalhe por empresa (disponível quando o subtipo era retry-elegível)
        empresas_detalhes: resultadosErroAuditaveis.map(p => ({
          empresa_id:   p.emp.empresa_id,
          empresa_nome: p.emp.nome || `Empresa #${p.emp.empresa_id}`,
          subtipo:      p.subtipoErro || p.resultado?.subtipo || null,
          sql_gerado:   p.resultado.sql_gerado || null,
          sql_ia_bruto: p.resultado._sql_auditoria?.sql_ia_bruto || null,
          prompt_user:  p.resultado._sql_auditoria?.prompt_user  || null,
        })),
      };

      const resultadoErro = {
        tipo: 'erro',
        subtipo: 'ai_sql_sem_empresa_apta',
        mensagem: respostaErro,
        detalhes: errosDinamicos,
        sql_gerado: sqlErroConsolidado,
        _sql_auditoria: _auditoriaErroConsolidada,
      };
      this.emit('iac-intent', {
        empresaId:      empresaLogId,
        ...this._metaMonitorIntent(intent, resultadoErro),
        intencao:       intent.intencao,
        provedor:       intent._provedor,
        motor:          this._rotuloMotor(intent),
        confianca:      intent.confianca,
        nivel_contexto: intent._nivel_contexto || 1,
        periodo:        intent.periodo || {},
        filtros:        intent.filtros || {},
        agrupar_por:    intent.agrupar_por || null,
        ordenar_por:    intent.ordenar_por || null,
        limite:         intent.limite || null,
        dataset_id:     null,
        dataset_nome:   null,
        resultado_tipo: 'erro',
        resultado_msg:  respostaErro,
        rows_count:     null,
        sql_gerado:     resultadoErro.sql_gerado || null,
      });
      { const _n = Date.now(), _pm = _recebidoEmAll ? (_n - new Date(_recebidoEmAll).getTime()) : (_n - _t0); const _l = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoErro, resposta: respostaErro, duracaoMs: _n - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm }); if (_timingCtxAll) { _timingCtxAll.logId = _l; _timingCtxAll.recebidoEm = _recebidoEmAll; } }
      return respostaErro;
    }

    // Intenção não reconhecida — retorna direto sem tentar as empresas
    if (intent.intencao === 'desconhecido') {
      const resultadoErro = { tipo: 'desconhecido', mensagem: intent._erro || 'Fiquei em duvida sobre qual indicador, periodo ou detalhe voce quer consultar.' };
      this.emit('iac-intent', {
        empresaId:      empresaLogId,
        ...this._metaMonitorIntent(intent, resultadoErro),
        intencao:       'desconhecido',
        provedor:       intent._provedor,
        motor:          this._rotuloMotor(intent),
        confianca:      0,
        nivel_contexto: intent._nivel_contexto || 1,
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
      { const _n = Date.now(), _pm = _recebidoEmAll ? (_n - new Date(_recebidoEmAll).getTime()) : (_n - _t0); const _l = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoErro, resposta: respostaErro, duracaoMs: _n - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm }); if (_timingCtxAll) { _timingCtxAll.logId = _l; _timingCtxAll.recebidoEm = _recebidoEmAll; } }
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
        this._logResultadoIntent({ intent: intentExecucao, resultado, escopo: 'all' });

        // ── Text-to-SQL dinâmico (compras) — resposta já gerada pela IA ─────────
        if (resultado.tipo === 'sucesso_ai_sql') {
          const respostaAiSql = resultado.resposta_direta || 'Não encontrei dados para essa consulta.';
          this.emit('iac-intent', {
            empresaId:      emp.empresa_id,
            ...this._metaMonitorIntent(intent, resultado),
            intencao:       intent.intencao,
            provedor:       intent._provedor,
            motor:          this._rotuloMotor(intent),
            confianca:      intent.confianca,
            nivel_contexto: intent._nivel_contexto || 1,
            periodo:        intent.periodo  || {},
            filtros:        intent.filtros  || {},
            agrupar_por:    intent.agrupar_por  || null,
            ordenar_por:    intent.ordenar_por  || null,
            limite:         intent.limite        || null,
            dataset_id:     null,
            dataset_nome:   resultado.dataset_nome || null,
            resultado_tipo: 'sucesso_ai_sql',
            resultado_msg:  null,
            rows_count:     resultado.rows?.length || 0,
            sql_gerado:     resultado.sql_gerado   || null,
            duracao_ms:     resultado.duracao_ms   || null,
          });
          const respostaAiSqlFinal = (_prefixoResetAll || '') + respostaAiSql;
          this._registrarInterpretacao({ empresaId: emp.empresa_id, sender: senderAll, texto, intent, resultado: { ...resultado, duracao_ms: resultado.duracao_ms ?? (Date.now() - _t0) }, resposta: respostaAiSqlFinal, duracaoMs: resultado.duracao_ms ?? (Date.now() - _t0) });
          return respostaAiSqlFinal;
        }

        // Compras perguntou qual filial (Option C) dentro de _pipelineAll
        if (resultado.tipo === 'pergunta_filial') {
          const perguntaFilial = resultado.resposta_direta;
          this._setSenderContext(senderAll, {
            _perguntaFilialPendente: true,
            _intentPendente:         resultado._intentPendente || intent,
            _intentPendenteEmpresaId: emp.empresa_id,
          });
          this._registrarInterpretacao({
            empresaId: emp.empresa_id, sender: senderAll, texto, intent,
            resultado: { ...resultado, mensagem: perguntaFilial },
            resposta: perguntaFilial, duracaoMs: Date.now() - _t0,
          });
          return perguntaFilial;
        }

        if (resultado.tipo === 'pergunta_entidade') {
          const perguntaEntidade = resultado.resposta_direta;
          this._setSenderContext(senderAll, {
            _perguntaEntidadePendente: true,
            _opcoesEntidade:           resultado._opcoesEntidade || [],
            _intentPendente:           resultado._intentPendente || intent,
            _intentPendenteEmpresaId:  emp.empresa_id,
            _intentPendenteEmpresasAll: empresasLoop,
          });
          this._registrarInterpretacao({
            empresaId: emp.empresa_id, sender: senderAll, texto, intent,
            resultado: { ...resultado, mensagem: perguntaEntidade },
            resposta: perguntaEntidade, duracaoMs: Date.now() - _t0,
          });
          return perguntaEntidade;
        }

        // Erros de IA (quota, chave, etc.) que já têm mensagem amigável
        if (resultado.tipo === 'erro' && resultado.resposta_direta) {
          this._registrarInterpretacao({ empresaId: emp.empresa_id, sender: senderAll, texto, intent, resultado, resposta: resultado.resposta_direta, duracaoMs: Date.now() - _t0 });
          return resultado.resposta_direta;
        }

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
        ...this._metaMonitorIntent(intent, resultadoEmpresas),
        intencao:     intent.intencao,
        provedor:     intent._provedor,
        motor:        this._rotuloMotor(intent),
        confianca:    intent.confianca,
        nivel_contexto: intent._nivel_contexto || 1,
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

      const respostaEmpresas = (_prefixoResetAll || '') + resposta;
      { const _n = Date.now(), _pm = _recebidoEmAll ? (_n - new Date(_recebidoEmAll).getTime()) : (_n - _t0); const _l = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoEmpresas, resposta: respostaEmpresas, duracaoMs: _n - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm }); if (_timingCtxAll) { _timingCtxAll.logId = _l; _timingCtxAll.recebidoEm = _recebidoEmAll; } }
      return respostaEmpresas;
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
        ...this._metaMonitorIntent(intent, resultadoSemDados),
        intencao:       intent.intencao,
        provedor:       intent._provedor,
        motor:          this._rotuloMotor(intent),
        confianca:      intent.confianca,
        nivel_contexto: intent._nivel_contexto || 1,
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
      { const _n = Date.now(), _pm = _recebidoEmAll ? (_n - new Date(_recebidoEmAll).getTime()) : (_n - _t0); const _l = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoSemDados, resposta: respostaSemDados, duracaoMs: _n - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm }); if (_timingCtxAll) { _timingCtxAll.logId = _l; _timingCtxAll.recebidoEm = _recebidoEmAll; } }
      return respostaSemDados;
    }

    const resultadoCombinado = { ...ultimoResultado, rows: todosRows };
    this.emit('iac-intent', {
      empresaId:    empresaLogId,
      ...this._metaMonitorIntent(intent, resultadoCombinado),
      intencao:     intent.intencao,
      provedor:     intent._provedor,
      motor:          this._rotuloMotor(intent),
      confianca:    intent.confianca,
      nivel_contexto: intent._nivel_contexto || 1,
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
    let resposta;
    if (resultadoCombinado.tipo === 'sucesso_ai_sql' && todosRows.length) {
      // IA-owner: formata as rows consolidadas (com coluna 'empresa') usando os mesmos
      // formatters programáticos do runner single — garante estilo uniforme entre empresas.
      const whatsappFmt = require('../erp/whatsapp-format-prompt');
      const runner = require('../erp/ia-owner/runner');
      const _NOME_MOD = { faturamento: 'Faturamento', compras: 'Compras', financeiro: 'Financeiro', comissao: 'Comissão' };
      const nomeModulo = _NOME_MOD[(intent._moduloDinamico || '').replace('_dinamico', '')] || null;
      const _grps = Array.isArray(intent.group_by) ? intent.group_by : (intent.agrupar_por ? [intent.agrupar_por] : []);
      const _iAno = _grps.indexOf('ano');
      const _iMes = _grps.findIndex(g => g === 'mes' || g === 'month');
      const anoFirst = (_iAno >= 0 && _iMes >= 0 && _iAno < _iMes) || (_iAno >= 0 && _iMes < 0)
        || /\bpor\s+ano\s+e\s+m[eê]s\b|\banual.*m[eê]s/i.test(texto || '');
      const periodoResolvido = ultimoResultado?._periodoCanonicoResolvido || null;
      const contextoConsulta = runner._test._buildContextoConsulta(intent, periodoResolvido, texto);
      resposta = whatsappFmt.buildFormatDirect(texto, todosRows, { contextoConsulta, nomeModulo, anoFirst })
        || whatsappFmt.buildFormatAnoMesDireto(todosRows, { contextoConsulta, nomeModulo })
        || whatsappFmt.buildFormatCompetenciaEntidade(todosRows, { contextoConsulta, nomeModulo, anoFirst })
        || whatsappFmt.buildFormatSimplesTemporal(todosRows, { contextoConsulta, nomeModulo, anoFirst })
        || responseFormatter.formatar(resultadoCombinado, intent, { empresaId: empresaLogId, messageTemplates });
    } else {
      resposta = responseFormatter.formatar(resultadoCombinado, intent, {
        empresaId: empresaLogId,
        messageTemplates,
      });
    }

    const cabecalho = [`🏭 *${sucessos.join(' + ')}*`];
    if (semDataset.length) cabecalho.push(`⚠️ _Sem dataset: ${semDataset.join(', ')}_`);
    if (semDados.length)   cabecalho.push(`ℹ️ _Sem dados no período: ${semDados.join(', ')}_`);

    const respostaFinal = (_prefixoResetAll || '') + cabecalho.join('\n') + '\n' + resposta;

    if (sender && intent.intencao !== 'desconhecido') {
      this._saveLastIntent(sender, intent, '__all__');
    }

    { const _n = Date.now(), _pm = _recebidoEmAll ? (_n - new Date(_recebidoEmAll).getTime()) : (_n - _t0); const _l = this._registrarInterpretacao({ empresaId: empresaLogId, sender: senderAll, texto, intent, resultado: resultadoCombinado, resposta: respostaFinal, duracaoMs: _n - _t0, recebidoEm: _recebidoEmAll, pipelineMs: _pm }); if (_timingCtxAll) { _timingCtxAll.logId = _l; _timingCtxAll.recebidoEm = _recebidoEmAll; } }
    return respostaFinal;
  }
}

module.exports = IACWhatsAppService;

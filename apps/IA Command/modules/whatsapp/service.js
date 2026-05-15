const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode               = require('qrcode');
const { EventEmitter }     = require('events');
const path                 = require('path');
const fs                   = require('fs');

const intentService       = require('../ai/intent-service');
const transcriptionService = require('../ai/transcription-service');
const intentRouter        = require('../erp/intent-router');
const responseFormatter   = require('../erp/response-formatter');

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

const MSG_PROCESSANDO = '🤖 *IA Command* recebeu sua mensagem e está processando...';
const MSG_AUDIO       = '🎙️ *IA Command* recebeu seu áudio e está transcrevendo...';

class IACWhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client      = null;
    this.status      = 'stopped';
    this.lastQrUrl   = null;
    this._stopping   = false;
    this._empresaId  = null;
    this._logBuffer  = [];
    this._wired      = false;
    this._msgCount   = 0;
  }

  getStatus()    { return this.status; }
  getQr()        { return this.lastQrUrl; }
  getEmpresaId() { return this._empresaId; }
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
    this.emit('iac-status', { status: s, empresa_id: this._empresaId });
  }

  async start(empresaId) {
    if (!empresaId) return this.log('empresa_id é obrigatório.', 'error');
    if (this._stopping) return this.log('Aguardando parada anterior...', 'warning');
    if (this.status !== 'stopped') {
      if (this._empresaId !== Number(empresaId))
        return this.log(`Serviço já em execução para empresa #${this._empresaId}.`, 'error');
      return this.log('Serviço já está em execução.', 'warning');
    }

    this._empresaId = Number(empresaId);
    this.setStatus('starting');
    this._startTime = Date.now();
    this.log(`Iniciando IA Command WhatsApp para empresa #${this._empresaId}...`, 'info');
    if (process.env.CHROME_PATH) this.log(`Chrome: ${process.env.CHROME_PATH}`, 'info');

    const puppeteerCfg = { headless: true, args: PUPPETEER_ARGS };
    if (process.env.CHROME_PATH) puppeteerCfg.executablePath = process.env.CHROME_PATH;

    // Prefixo 'iac_' evita conflito com sessões do IAHub Recrutamento
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: `iac_${this._empresaId}`, dataPath: AUTH_BASE }),
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

  async stop() {
    if (this._stopping) return;
    this._stopping = true;
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this.lastQrUrl = null;
    await new Promise(r => setTimeout(r, 800));
    this._stopping = false;
    this.setStatus('stopped');
    this.log('Serviço parado.', 'info');
  }

  async sendMessage(numero, texto) {
    if (!this.client || this.status !== 'connected')
      throw new Error('WhatsApp não está conectado.');
    const id = await this.client.getNumberId(numero.replace(/\D/g, ''));
    if (!id) throw new Error(`Número ${numero} não encontrado no WhatsApp.`);
    await this.client.sendMessage(id._serialized, texto);
  }

  // ── Recebimento de mensagens ─────────────────────────────────────────────────

  async _handleMessage(msg) {
    const sender = msg.from;
    const tipo   = msg.type;

    this._msgCount++;
    this.log(`Mensagem recebida — tipo: ${tipo}, de: ${sender}`, 'info');

    this.emit('iac-msg', {
      sender,
      tipo,
      body:      msg.body || '',
      timestamp: new Date().toISOString(),
    });

    try {
      if (tipo === 'chat' || tipo === 'text') {
        await this._handleText(msg);
      } else if (['audio', 'ptt', 'voice'].includes(tipo)) {
        await this._handleAudio(msg);
      } else {
        this.log(`Tipo "${tipo}" ignorado nesta fase.`, 'info');
      }
    } catch (err) {
      this.log(`Erro ao processar mensagem de ${sender}: ${err.message}`, 'error');
    }
  }

  async _handleText(msg) {
    const texto = (msg.body || '').trim();
    this.log(`Texto: "${texto.slice(0, 80)}"`, 'received');

    const chat = await msg.getChat();
    await chat.sendMessage(MSG_PROCESSANDO);

    try {
      const resposta = await this._pipeline(texto);
      await chat.sendMessage(resposta);
      this.log(`Resposta enviada para ${msg.from}`, 'success');
    } catch (err) {
      this.log(`Pipeline falhou: ${err.message}`, 'error');
      await chat.sendMessage(`❌ Não foi possível processar sua consulta.\n_${err.message}_`);
    }
  }

  async _handleAudio(msg) {
    this.log(`Áudio recebido de ${msg.from} (${msg.type}) — baixando...`, 'info');

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
      await chat.sendMessage(MSG_AUDIO);

      let transcricao;
      try {
        transcricao = await transcriptionService.transcrever(tmpPath, this._empresaId);
        this.log(`Transcrição: "${transcricao.slice(0, 100)}"`, 'info');
      } catch (transcErr) {
        this.log(`Transcrição falhou: ${transcErr.message}`, 'error');
        await chat.sendMessage(`❌ Não foi possível transcrever o áudio.\n_${transcErr.message}_`);
        return;
      }

      try {
        const resposta = await this._pipeline(transcricao);
        await chat.sendMessage(`🎙️ _"${transcricao.slice(0, 120)}${transcricao.length > 120 ? '…' : ''}"_\n\n${resposta}`);
        this.log(`Resposta de áudio enviada para ${msg.from}`, 'success');
      } catch (err) {
        this.log(`Pipeline (áudio) falhou: ${err.message}`, 'error');
        await chat.sendMessage(`❌ Não foi possível processar sua consulta.\n_${err.message}_`);
      }

    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        this.log(`Arquivo temporário apagado.`, 'info');
      }
    }
  }

  // ── IA Pipeline: classify → route → format ──────────────────────────────────

  async _pipeline(texto) {
    const intent    = await intentService.classificar(texto, this._empresaId);
    this.log(`Intenção: ${intent.intencao} (${intent._provedor}, conf. ${(intent.confianca * 100).toFixed(0)}%)`, 'info');

    const resultado = await intentRouter.rotear(intent, this._empresaId);
    return responseFormatter.formatar(resultado, intent);
  }
}

module.exports = IACWhatsAppService;

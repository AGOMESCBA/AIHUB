const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode   = require('qrcode');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { EventEmitter } = require('events');
const path = require('path');
const db = require('./database');
const empresasDb = require('../empresas/database');
const ia = require('../ia');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client         = null;
    this.status         = 'stopped';
    this.lastQrUrl      = null;
    this.pendingUpdates = new Map(); // sender → { existingId, dados, pdf_base64, pdf_nome, msgId }
    this._stopping      = false;    // guard: evita start() antes do stop() terminar
    this._empresaId     = null;
    this._empresaNome   = null;
    this._logBuffer     = [];
    this._wired         = false;
  }

  getStatus()      { return this.status; }
  getQr()          { return this.lastQrUrl; }
  getEmpresaId()   { return this._empresaId; }
  getEmpresaNome() { return this._empresaNome || null; }
  getLogBuffer()   { return this._logBuffer; }
  clearBuffer()    { this._logBuffer = []; }

  log(message, type = 'info') {
    const entry = { message, type, timestamp: new Date().toLocaleTimeString('pt-BR') };
    this._logBuffer.push(entry);
    if (this._logBuffer.length > 500) this._logBuffer.shift();
    this.emit('log', entry);
  }

  setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  async start(empresaId, empresaNome) {
    if (!empresaId) {
      this.log('empresa_id é obrigatório para iniciar o serviço WhatsApp.', 'error');
      return;
    }
    if (this._stopping) {
      this.log('Aguardando parada completa do serviço anterior…', 'warning');
      return;
    }
    if (this.status !== 'stopped') {
      if (this._empresaId !== Number(empresaId)) {
        const curLabel = this._empresaNome ? `#${this._empresaId} - ${this._empresaNome}` : `#${this._empresaId}`;
        this.log(`Serviço já em execução para outra empresa (${curLabel}). Pare o serviço primeiro.`, 'error');
        return;
      }
      this.log('Serviço já está em execução.', 'warning');
      return;
    }
    this._empresaId   = Number(empresaId);
    this._empresaNome = empresaNome || empresasDb.buscarPorId(this._empresaId)?.razao_social || null;
    this.setStatus('starting');
    this._startTime = Date.now();
    const empLabel = this._empresaNome
      ? `empresa #${this._empresaId} - ${this._empresaNome}`
      : `empresa #${this._empresaId}`;
    this.log(`Iniciando serviço WhatsApp para ${empLabel}...`, 'info');
    if (process.env.CHROME_PATH) {
      this.log(`Usando Chrome: ${process.env.CHROME_PATH}`, 'info');
    }

    // Restaura confirmações pendentes salvas antes do último restart
    const pendentes = db.listPendingUpdates(this._empresaId);
    if (pendentes.length) {
      pendentes.forEach(p => this.pendingUpdates.set(p.sender, p));
      this.log(`${pendentes.length} confirmação(ões) pendente(s) restaurada(s) do banco.`, 'info');
    }

    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-default-apps',
        '--disable-sync',
        '--mute-audio',
        '--disable-infobars',
        '--disable-translate',
        '--disable-features=TranslateUI',
        '--safebrowsing-disable-auto-update',
        '--hide-scrollbars',
        '--metrics-recording-only',
      ],
    };
    if (process.env.CHROME_PATH) puppeteerConfig.executablePath = process.env.CHROME_PATH;

    // Sessão isolada por empresa
    const authDataPath = path.join(__dirname, '..', '..', '.wwebjs_auth');
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId:  `empresa_${this._empresaId}`,
        dataPath:  authDataPath,
      }),
      puppeteer: puppeteerConfig,
    });

    // Log de progresso a cada 15s enquanto o Chrome ainda está subindo
    let initStep = 0;
    const INIT_MSGS = [
      'Aguardando Chrome iniciar…',
      'Chrome iniciado, carregando WhatsApp Web…',
      'WhatsApp Web carregando, aguardando QR ou sessão…',
      'Ainda carregando… (primeira execução pode levar até 3 minutos)',
      'Aguardando autenticação…',
      'Quase lá, aguarde…',
    ];
    const progressTimer = setInterval(() => {
      if (this.status !== 'starting') { clearInterval(progressTimer); return; }
      const msg = INIT_MSGS[Math.min(initStep, INIT_MSGS.length - 1)];
      this.log(msg, 'info');
      initStep++;
    }, 15000);

    // Timeout de 180s — para automaticamente se nenhum evento disparar
    const initTimeout = setTimeout(() => {
      if (this.status !== 'starting') return;
      clearInterval(progressTimer);
      this.log('Tempo limite de inicialização atingido (180s). O Chrome pode estar travado. Parando serviço…', 'error');
      this.log('Dica: verifique processos chrome.exe no Gerenciador de Tarefas e tente novamente.', 'warning');
      this.stop();
    }, 180000);

    const clearTimers = () => { clearInterval(progressTimer); clearTimeout(initTimeout); };

    this.client.on('qr', async (qr) => {
      clearTimers();
      this.log('QR Code gerado. Escaneie com o WhatsApp.', 'info');
      const dataUrl = await qrcode.toDataURL(qr);
      this.lastQrUrl = dataUrl;
      this.emit('qr', dataUrl);
    });

    this.client.on('ready', () => {
      clearTimers();
      this.lastQrUrl = null;
      this.setStatus('connected');
      const seg = this._startTime ? ((Date.now() - this._startTime) / 1000).toFixed(1) : '—';
      this.log(`WhatsApp conectado! Número: ${this.client.info.wid.user} — tempo de inicialização: ${seg}s`, 'success');
    });

    this.client.on('auth_failure', () => {
      clearTimers();
      this.setStatus('stopped');
      this.log('Falha na autenticação. Delete a pasta .wwebjs_auth e tente novamente.', 'error');
    });

    this.client.on('disconnected', () => {
      clearTimers();
      this.setStatus('stopped');
      this.log('WhatsApp desconectado.', 'warning');
    });

    this.client.on('message', (msg) => this.handleMessage(msg));
    this.client.initialize().catch((err) => {
      clearTimers();
      this.client = null;
      this.setStatus('stopped');
      this.log(`Falha ao inicializar cliente WhatsApp: ${err.message}`, 'error');
    });
  }

  async stop() {
    if (this._stopping) return; // já está parando, ignora chamada duplicada
    this._stopping = true;
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
    this.lastQrUrl = null;
    // Aguarda o Puppeteer terminar completamente antes de liberar novo start()
    await new Promise(r => setTimeout(r, 800));
    this._stopping = false;
    this.setStatus('stopped');
    this.log('Serviço parado.', 'info');
  }

  // ── Processamento principal ──────────────────────────────────────────────────

  async handleMessage(msg) {
    const sender = msg.from;
    this.log(`Mensagem recebida — tipo: ${msg.type}, hasMedia: ${msg.hasMedia}, de: ${sender}`, 'info');

    // Verifica se há uma confirmação de atualização pendente para este remetente
    if (this.pendingUpdates.has(sender) && !msg.hasMedia) {
      await this.handleConfirmationResponse(msg);
      return;
    }

    if (!msg.hasMedia) return;
    if (msg.type !== 'document') {
      this.log(`Mensagem ignorada — tipo não é documento (${msg.type}).`, 'info');
      return;
    }

    // Ignora mensagens já processadas (evita reprocessar ao reiniciar o serviço)
    const msgId = msg.id._serialized;
    if (db.isProcessed(this._empresaId, msgId)) {
      this.log(`Mensagem ${msgId} já processada anteriormente. Ignorando.`, 'info');
      return;
    }

    this.log(`PDF recebido de ${sender}`, 'received');

    let media = null;

    try {
      // Etapa 1: download do arquivo
      this.log(`[1/4] Baixando arquivo de ${sender}...`, 'info');
      media = await msg.downloadMedia();
      this.log(`[1/4] Download OK — mimetype: ${media?.mimetype || 'indefinido'}`, 'info');

      if (!media) {
        this.log(`[1/4] FALHA: downloadMedia() retornou null.`, 'error');
        return;
      }

      if (!media.mimetype?.includes('pdf')) {
        this.log(`[1/4] Arquivo ignorado — não é PDF (${media.mimetype}).`, 'warning');
        const chat = await msg.getChat();
        await chat.sendMessage(db.getConfig(this._empresaId, 'msg_nao_pdf') || '⚠️ Por favor, envie o currículo em formato *PDF*.');
        return;
      }

      // Etapa 2: extração de texto do PDF
      this.log(`[2/4] Extraindo texto do PDF (${Math.round(media.data.length * 0.75 / 1024)} KB)...`, 'info');
      const buffer  = Buffer.from(media.data, 'base64');
      const pdfData = await pdfParse(buffer);
      const texto   = pdfData.text.trim();
      this.log(`[2/4] Texto extraído: ${texto.length} caracteres.`, 'info');

      if (!texto) {
        this.log(`[2/4] FALHA: PDF sem texto legível (protegido ou escaneado).`, 'error');
        const chat = await msg.getChat();
        await chat.sendMessage(db.getConfig(this._empresaId, 'msg_pdf_ilegivel') || '❌ Não consegui ler o PDF. Verifique se não está protegido ou escaneado como imagem.');
        return;
      }

      // Etapa 3: traduz para português se necessário
      const { texto: textoFinal, idioma } = await this.traduzirSeNecessario(texto);
      if (idioma !== 'pt') {
        this.log(`[3/5] Currículo em "${idioma}" — traduzido para português.`, 'info');
      }

      // Etapa 4: verifica se o documento é um currículo
      this.log(`[4/5] Verificando se o documento é um currículo...`, 'info');
      const ehCurriculo = await this.verificarSeCurriculo(textoFinal);
      if (!ehCurriculo) {
        this.log(`[4/5] Documento rejeitado — não identificado como currículo.`, 'warning');
        const chat = await msg.getChat();
        await chat.sendMessage(
          db.getConfig(this._empresaId, 'msg_nao_curriculo') || '😊 Olá! Não foi possível processar o arquivo enviado pois ele não parece ser um currículo.\n\nPor favor, envie seu currículo em formato *PDF* para que possamos analisá-lo. Obrigado!'
        );
        return;
      }

      // Etapa 5: análise IA com tentativas progressivas
      this.log(`[5/5] Enviando para análise IA...`, 'info');
      const dados = await this.analisarComRetry(textoFinal);

      // Verifica duplicata por telefone ou e-mail do currículo
      const existente = db.findByPhoneOrEmail(this._empresaId, dados.telefone, dados.email);
      if (existente) {
        this.log(`Currículo duplicado detectado — ID #${existente.id} (${existente.nome}). Aguardando confirmação do remetente.`, 'warning');
        const pendingData = {
          existingId: existente.id,
          dados,
          pdf_base64: media.data,
          pdf_nome:   msg.body || 'curriculo.pdf',
          msgId,
        };
        this.pendingUpdates.set(sender, pendingData);
        db.savePendingUpdate(this._empresaId, sender, pendingData);
        try {
          const chat = await msg.getChat();
          const tplDuplicata = db.getConfig(this._empresaId, 'msg_duplicata') ||
            '⚠️ Já existe um currículo cadastrado com este telefone ou e-mail ({nome}).\n\nDeseja *atualizar* o registro existente?\n\nResponda *SIM* para atualizar ou *NÃO* para manter o atual.';
          await chat.sendMessage(tplDuplicata.replace('{nome}', existente.nome || ''));
        } catch (e) {
          this.log(`Aviso: não foi possível notificar remetente sobre duplicata: ${e.message}`, 'warning');
        }
        return;
      }

      await this.salvarENotificar({ sender, dados, pdf_base64: media.data, pdf_nome: msg.body || 'curriculo.pdf', msgId, msg });

    } catch (err) {
      const detalhe = err?.stack || err?.message || JSON.stringify(err) || String(err);
      this.log(`ERRO na etapa de processamento de ${sender}: ${detalhe}`, 'error');

      try {
        const chat = await msg.getChat();
        await chat.sendMessage(db.getConfig(this._empresaId, 'msg_erro') || '❌ Ocorreu um erro ao processar seu currículo. Tente novamente.');
      } catch (_) {}
    }
  }

  // ── Salva currículo e notifica destino + remetente ──────────────────────────

  async salvarENotificar({ sender, dados, pdf_base64, pdf_nome, msgId, msg }) {
    const raw           = db.getConfig(this._empresaId, 'numero_destino');
    const numeroDestino = raw ? raw.replace(/\D/g, '') + '@c.us' : null;
    const mensagem      = numeroDestino ? this.formatarParaWhatsApp(dados) : null;

    this.emit('curriculo', { remetente: sender, dados, pdf_base64, pdf_nome, empresaId: this._empresaId, empresaNome: this._empresaNome });
    db.markProcessed(this._empresaId, msgId);

    try {
      const msgConfirmacao = db.getConfig(this._empresaId, 'msg_confirmacao') ||
        '✅ Seu currículo foi recebido e está sendo analisado. Entraremos em contato em breve!';
      const chatRemetente = await msg.getChat();
      await chatRemetente.sendMessage(msgConfirmacao);
    } catch (confirmErr) {
      this.log(`Aviso: não foi possível confirmar recebimento para ${sender}: ${confirmErr.message}`, 'warning');
    }

    if (numeroDestino && mensagem) {
      this.log(`[4/4] Enviando resultado para ${numeroDestino}...`, 'info');
      try {
        await this.enviarMensagemParaNumero(numeroDestino, `✅ *Currículo recebido de ${sender}*\n\n${mensagem}`);
        this.log(`[4/4] Concluído. Currículo de ${sender} enviado para ${numeroDestino}.`, 'success');
      } catch (sendErr) {
        this.log(`[4/4] Currículo salvo, mas falhou ao enviar para ${numeroDestino}: ${sendErr.message}`, 'warning');
      }
    } else {
      this.log(`[4/4] Concluído. Currículo de ${sender} salvo no banco.`, 'success');
    }
  }

  // ── Resposta de confirmação de atualização ───────────────────────────────────

  async handleConfirmationResponse(msg) {
    const sender  = msg.from;
    const pending = this.pendingUpdates.get(sender) || db.getPendingUpdate(this._empresaId, sender);
    const resposta = (msg.body || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    this.log(`Resposta de confirmação recebida de ${sender}: "${msg.body || ''}" → normalizado: "${resposta}"`, 'info');

    if (!pending) {
      this.log(`Aviso: confirmação recebida de ${sender} mas não há registro pendente no banco.`, 'warning');
      return;
    }

    if (resposta === 'SIM') {
      this.log(`Remetente ${sender} confirmou atualização — excluindo currículo ID #${pending.existingId} e salvando novo.`, 'info');
      db.deleteCurriculo(this._empresaId, pending.existingId);
      this.pendingUpdates.delete(sender);
      db.deletePendingUpdate(this._empresaId, sender);
      await this.salvarENotificar({
        sender,
        dados:      pending.dados,
        pdf_base64: pending.pdf_base64,
        pdf_nome:   pending.pdf_nome,
        msgId:      pending.msgId,
        msg,
      });
    } else if (resposta === 'NAO') {
      this.log(`Remetente ${sender} optou por manter o currículo existente. Enviando mensagem de retorno.`, 'info');
      this.pendingUpdates.delete(sender);
      db.deletePendingUpdate(this._empresaId, sender);
      try {
        const chat = await msg.getChat();
        const msgNao = db.getConfig(this._empresaId, 'msg_nao_atualizar') || '😊 Tudo bem! Seu currículo atual permanece em nossos registros. Obrigado!';
        await chat.sendMessage(msgNao);
        this.log(`Mensagem de NÃO atualizar enviada para ${sender}.`, 'success');
      } catch (e) {
        this.log(`Erro ao enviar resposta de NÃO para ${sender}: ${e.message}`, 'error');
      }
    } else {
      this.log(`Resposta não reconhecida de ${sender}: "${resposta}". Aguardando SIM ou NÃO.`, 'warning');
    }
  }

  // ── Envio robusto de mensagem ────────────────────────────────────────────────

  async enviarMensagemParaNumero(destino, texto) {
    const MAX = 3500;
    const partes = [];
    for (let i = 0; i < texto.length; i += MAX) partes.push(texto.slice(i, i + MAX));

    // Resolve o ID correto via getNumberId para evitar erro "No LID for user"
    // quando o contato ainda não tem histórico de chat (protocolo LID do WhatsApp)
    const numero = destino.replace('@c.us', '');
    const numberId = await this.client.getNumberId(numero);
    if (!numberId) throw new Error(`Número ${numero} não encontrado no WhatsApp`);
    const idResolvido = numberId._serialized;

    for (const parte of partes) {
      await this.client.sendMessage(idResolvido, parte);
    }
  }

  // ── IA: delega para módulo ia/ (sem acoplamento ao socket) ─────────────────

  async analisarComRetry(texto)       { return ia.analisarComRetry(texto,       (m,t) => this.log(m,t), this._empresaId); }
  async chamarIA(opts)                { return ia.chamarIA({ ...opts, empresaId: this._empresaId }, (m,t) => this.log(m,t)); }
  async traduzirSeNecessario(texto)   { return ia.traduzirSeNecessario(texto,   (m,t) => this.log(m,t), this._empresaId); }
  async verificarSeCurriculo(texto)   { return ia.verificarSeCurriculo(texto,   (m,t) => this.log(m,t), this._empresaId); }

    // ── Formatar para WhatsApp ───────────────────────────────────────────────────

  formatarParaWhatsApp(d) {
    const partes = [];

    const pessoais = [
      `• Nome: ${d.nome || '—'}`,
      d.telefone ? `• Telefone: ${d.telefone}` : null,
      d.email    ? `• E-mail: ${d.email}`       : null,
      d.endereco ? `• Endereço: ${d.endereco}`  : null,
      d.linkedin ? `• LinkedIn: ${d.linkedin}`  : null,
    ].filter(Boolean).join('\n');
    partes.push(`📋 *DADOS PESSOAIS*\n${pessoais}`);

    if (d.descricao) partes.push(`👤 *DESCRIÇÃO DO CANDIDATO*\n${d.descricao}`);

    if (d.experiencias?.length) {
      partes.push('💼 *EXPERIÊNCIA PROFISSIONAL*');
      d.experiencias.forEach(e => {
        const desc    = e.descricao ? `\n${e.descricao}` : '';
        const ativArr = Array.isArray(e.atividades) ? e.atividades
                      : typeof e.atividades === 'string' && e.atividades ? [e.atividades] : [];
        const ativs   = ativArr.length ? '\n' + ativArr.map(a => `  • ${a}`).join('\n') : '';
        partes.push(`🏢 *${e.empresa}* | ${e.cargo} | ${e.periodo}${desc}${ativs}`);
      });
    }

    if (d.formacao?.length) {
      const items = d.formacao.map(f => `• *${f.instituicao}* — ${f.curso} (${f.periodo})`).join('\n');
      partes.push(`🎓 *FORMAÇÃO ACADÊMICA*\n${items}`);
    }

    if (d.habilidades?.length) {
      partes.push(`🛠️ *HABILIDADES E COMPETÊNCIAS*\n${d.habilidades.map(h => `• ${h}`).join('\n')}`);
    }

    if (d.capacitacoes?.length) {
      partes.push(`🏆 *CAPACITAÇÕES E CERTIFICAÇÕES*\n${d.capacitacoes.map(c => `• ${c}`).join('\n')}`);
    }

    return partes.join('\n\n');
  }
}

module.exports = WhatsAppService;

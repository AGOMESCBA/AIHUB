const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode');
// Importação direta evita bug do pdf-parse que executa testes ao carregar
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const Groq    = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { EventEmitter } = require('events');
const db = require('./database');

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Detecta se o erro é de limite de tokens/rate limit do Groq
function isRateLimit(err) {
  return err?.status === 429 || err?.message?.includes('rate_limit') || err?.message?.includes('Rate limit');
}

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client       = null;
    this.status       = 'stopped';
    this.pendingUpdates = new Map(); // sender → { existingId, dados, pdf_base64, pdf_nome, msgId }
  }

  getStatus() { return this.status; }

  log(message, type = 'info') {
    this.emit('log', { message, type, timestamp: new Date().toLocaleTimeString('pt-BR') });
  }

  setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  async start() {
    if (this.status !== 'stopped') {
      this.log('Serviço já está em execução.', 'warning');
      return;
    }
    this.setStatus('starting');
    this._startTime = Date.now();
    this.log('Iniciando serviço WhatsApp...', 'info');

    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-networking',
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
      },
    });

    this.client.on('qr', async (qr) => {
      this.log('QR Code gerado. Escaneie com o WhatsApp.', 'info');
      const dataUrl = await qrcode.toDataURL(qr);
      this.emit('qr', dataUrl);
    });

    this.client.on('ready', () => {
      this.setStatus('connected');
      const seg = this._startTime ? ((Date.now() - this._startTime) / 1000).toFixed(1) : '—';
      this.log(`WhatsApp conectado! Número: ${this.client.info.wid.user} — tempo de inicialização: ${seg}s`, 'success');
    });

    this.client.on('auth_failure', () => {
      this.setStatus('stopped');
      this.log('Falha na autenticação. Delete a pasta .wwebjs_auth e tente novamente.', 'error');
    });

    this.client.on('disconnected', () => {
      this.setStatus('stopped');
      this.log('WhatsApp desconectado.', 'warning');
    });

    this.client.on('message', (msg) => this.handleMessage(msg));
    this.client.initialize().catch((err) => {
      this.setStatus('stopped');
      this.log(`Falha ao inicializar cliente WhatsApp: ${err.message}`, 'error');
    });
  }

  async stop() {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
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
    if (db.isProcessed(msgId)) {
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
        await chat.sendMessage(db.getConfig('msg_nao_pdf') || '⚠️ Por favor, envie o currículo em formato *PDF*.');
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
        await chat.sendMessage(db.getConfig('msg_pdf_ilegivel') || '❌ Não consegui ler o PDF. Verifique se não está protegido ou escaneado como imagem.');
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
          db.getConfig('msg_nao_curriculo') || '😊 Olá! Não foi possível processar o arquivo enviado pois ele não parece ser um currículo.\n\nPor favor, envie seu currículo em formato *PDF* para que possamos analisá-lo. Obrigado!'
        );
        return;
      }

      // Etapa 5: análise IA com tentativas progressivas
      this.log(`[5/5] Enviando para análise IA...`, 'info');
      const dados = await this.analisarComRetry(textoFinal);

      // Etapa 5: verifica duplicata por telefone OU e-mail
      const existente = db.findByPhoneOrEmail(dados.telefone, dados.email);
      if (existente) {
        this.log(`Currículo duplicado detectado — ID #${existente.id} (${existente.nome}). Aguardando confirmação do remetente.`, 'warning');
        this.pendingUpdates.set(sender, {
          existingId: existente.id,
          dados,
          pdf_base64: media.data,
          pdf_nome:   msg.body || 'curriculo.pdf',
          msgId,
        });
        try {
          const chat = await msg.getChat();
          const tplDuplicata = db.getConfig('msg_duplicata') ||
            '⚠️ Já existe um currículo cadastrado com este telefone ou e-mail ({nome}).\n\nDeseja *atualizar* o registro existente?\n\nResponda *SIM* para atualizar ou *NÃO* para manter o atual.';
          await chat.sendMessage(tplDuplicata.replace('{nome}', existente.nome || ''));
        } catch (e) {
          this.log(`Aviso: não foi possível notificar remetente sobre duplicata: ${e.message}`, 'warning');
        }
        return;
      }

      // Etapa 4: salva no banco e notifica
      await this.salvarENotificar({ sender, dados, pdf_base64: media.data, pdf_nome: msg.body || 'curriculo.pdf', msgId, msg });
      // Etapa 5 concluída via salvarENotificar

    } catch (err) {
      const detalhe = err?.stack || err?.message || JSON.stringify(err) || String(err);
      this.log(`ERRO na etapa de processamento de ${sender}: ${detalhe}`, 'error');

      try {
        const chat = await msg.getChat();
        await chat.sendMessage(db.getConfig('msg_erro') || '❌ Ocorreu um erro ao processar seu currículo. Tente novamente.');
      } catch (_) {}
    }
  }

  // ── Salva currículo e notifica destino + remetente ──────────────────────────

  async salvarENotificar({ sender, dados, pdf_base64, pdf_nome, msgId, msg }) {
    this.emit('curriculo', { remetente: sender, dados, pdf_base64, pdf_nome });
    db.markProcessed(msgId);

    const raw           = db.getConfig('numero_destino');
    const numeroDestino = raw ? raw.replace(/\D/g, '') + '@c.us' : null;
    const mensagem      = this.formatarParaWhatsApp(dados);

    try {
      const msgConfirmacao = db.getConfig('msg_confirmacao') ||
        '✅ Seu currículo foi recebido e está sendo analisado. Entraremos em contato em breve!';
      const chatRemetente = await msg.getChat();
      await chatRemetente.sendMessage(msgConfirmacao);
    } catch (confirmErr) {
      this.log(`Aviso: não foi possível confirmar recebimento para ${sender}: ${confirmErr.message}`, 'warning');
    }

    if (numeroDestino) {
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
    const pending = this.pendingUpdates.get(sender);
    const resposta = (msg.body || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (resposta === 'SIM') {
      this.log(`Remetente ${sender} confirmou atualização do currículo ID #${pending.existingId}.`, 'info');
      db.deleteCurriculo(pending.existingId);
      this.pendingUpdates.delete(sender);
      await this.salvarENotificar({
        sender,
        dados:      pending.dados,
        pdf_base64: pending.pdf_base64,
        pdf_nome:   pending.pdf_nome,
        msgId:      pending.msgId,
        msg,
      });
    } else if (resposta === 'NAO') {
      this.log(`Remetente ${sender} optou por manter o currículo existente.`, 'info');
      this.pendingUpdates.delete(sender);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage(db.getConfig('msg_nao_atualizar') || '😊 Tudo bem! Seu currículo atual permanece em nossos registros. Obrigado!');
      } catch (e) {
        this.log(`Aviso: não foi possível enviar resposta de agradecimento para ${sender}: ${e.message}`, 'warning');
      }
    }
    // Se resposta não for SIM nem NÃO, ignora e mantém pendente
  }

  // ── Envio robusto de mensagem ────────────────────────────────────────────────

  async enviarMensagemParaNumero(destino, texto) {
    const MAX = 3500;
    const partes = [];
    for (let i = 0; i < texto.length; i += MAX) partes.push(texto.slice(i, i + MAX));

    // Tenta encontrar chat existente primeiro (evita erro "No LID for user")
    const chats = await this.client.getChats();
    const chatExistente = chats.find(c => c.id._serialized === destino);

    for (const parte of partes) {
      if (chatExistente) {
        await chatExistente.sendMessage(parte);
      } else {
        await this.client.sendMessage(destino, parte);
      }
    }
  }

  // ── Análise com tentativas progressivas + fallback Gemini ───────────────────

  async analisarComRetry(texto) {
    const SYSTEM_COMPLETO = `Você é um extrator de currículos. Responda SOMENTE com um objeto JSON válido, sem explicações, sem markdown, sem blocos de código.
IMPORTANTE: NÃO resuma, NÃO omita e NÃO abrevie nenhuma informação. Copie as atividades, descrições e demais campos EXATAMENTE como aparecem no currículo.
Para cada experiência: capture o parágrafo descritivo em "descricao" e TODOS os bullets em "atividades" — prefixe itens de sub-projetos com o nome entre colchetes.
Use esta estrutura:
{"nome":null,"telefone":null,"email":null,"endereco":null,"linkedin":null,"descricao":null,"experiencias":[{"empresa":"","cargo":"","periodo":"","descricao":"","atividades":[]}],"formacao":[{"curso":"","instituicao":"","periodo":""}],"capacitacoes":[],"habilidades":[]}`;

    const SYSTEM_SIMPLES = 'Extraia dados do currículo. NÃO resuma nem omita — copie as atividades exatamente. Responda SOMENTE com JSON válido: {"nome":null,"telefone":null,"email":null,"descricao":null,"experiencias":[],"formacao":[],"capacitacoes":[],"habilidades":[]}';

    const limparJson = (txt) => {
      const m = txt.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim().match(/\{[\s\S]*\}/);
      if (!m) throw new Error('JSON não encontrado na resposta');
      return JSON.parse(m[0]);
    };

    // Tentativa 1: Groq modelo completo
    try {
      this.log('Tentativa 1/3: Groq (modelo completo)...', 'info');
      const res = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: 8000,
        messages: [
          { role: 'system', content: SYSTEM_COMPLETO },
          { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 20000)}` },
        ],
      });
      return limparJson(res.choices[0].message.content);
    } catch (e1) {
      this.log(`Tentativa 1 falhou: ${e1.message}.`, 'warning');
    }

    // Tentativa 2: Groq modelo rápido
    try {
      this.log('Tentativa 2/3: Groq (modelo rápido)...', 'info');
      const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant', temperature: 0.1, max_tokens: 5000,
        messages: [
          { role: 'system', content: SYSTEM_SIMPLES },
          { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 12000)}` },
        ],
      });
      return limparJson(res.choices[0].message.content);
    } catch (e2) {
      this.log(`Tentativa 2 falhou: ${e2.message}.`, 'warning');
    }

    // Tentativa 3: Google Gemini (fallback de rate limit)
    if (gemini) {
      try {
        this.log('Tentativa 3/3: Google Gemini (fallback)...', 'info');
        const model  = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(`${SYSTEM_COMPLETO}\n\nCurrículo:\n\n${texto.slice(0, 20000)}`);
        return limparJson(result.response.text());
      } catch (e3) {
        this.log(`Tentativa 3 (Gemini) falhou: ${e3.message}. Usando texto livre...`, 'warning');
      }
    }

    // Tentativa 4: texto livre (último recurso)
    this.log('Tentativa 4/4: extração em texto livre (último recurso)...', 'warning');
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', temperature: 0.2, max_tokens: 1500,
      messages: [
        { role: 'system', content: 'Extraia e organize as informações do currículo em formato legível em português.' },
        { role: 'user',   content: `Currículo:\n\n${texto.slice(0, 4000)}` },
      ],
    });
    return { nome: null, descricao: res.choices[0].message.content };
  }

  // ── Chamada de IA com fallback Groq → Gemini ────────────────────────────────

  async chamarIA({ systemPrompt, userPrompt, maxTokens = 1000, temperatura = 0.1, modeloGroq = 'llama-3.1-8b-instant' }) {
    // Tentativa 1: Groq
    try {
      const res = await groq.chat.completions.create({
        model: modeloGroq,
        temperature: temperatura,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      });
      return res.choices[0].message.content.trim();
    } catch (e) {
      if (!isRateLimit(e)) throw e;
      this.log(`Groq atingiu limite de tokens. Usando Google Gemini como fallback...`, 'warning');
    }

    // Tentativa 2: Gemini (fallback)
    if (!gemini) throw new Error('Groq atingiu o limite e GEMINI_API_KEY não está configurada.');
    const model = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    return result.response.text().trim();
  }

  // ── Detecção de idioma e tradução ───────────────────────────────────────────

  async traduzirSeNecessario(texto) {
    try {
      const idioma = (await this.chamarIA({
        systemPrompt: 'Identifique o idioma do texto. Responda APENAS com o código ISO 639-1 em minúsculas (ex: pt, en, es, fr, de, it, zh, etc).',
        userPrompt:   texto.slice(0, 500),
        maxTokens:    5,
        temperatura:  0,
      })).toLowerCase().slice(0, 2);

      if (idioma === 'pt') return { texto, idioma };

      this.log(`Idioma detectado: "${idioma}". Traduzindo para português...`, 'info');
      const traduzido = await this.chamarIA({
        systemPrompt: 'Traduza o texto a seguir para o português do Brasil. Mantenha toda a estrutura, formatação e informações originais. Não resuma nem omita nada.',
        userPrompt:   texto.slice(0, 20000),
        maxTokens:    8000,
        temperatura:  0.1,
        modeloGroq:   'llama-3.3-70b-versatile',
      });
      return { texto: traduzido, idioma };
    } catch (e) {
      this.log(`Aviso: falha na detecção/tradução de idioma, usando texto original: ${e.message}`, 'warning');
      return { texto, idioma: 'pt' };
    }
  }

  // ── Verificação se documento é currículo ────────────────────────────────────

  async verificarSeCurriculo(texto) {
    try {
      const resposta = await this.chamarIA({
        systemPrompt: 'Você analisa documentos. Responda APENAS com "SIM" se o texto for um currículo/CV profissional, ou "NAO" se for qualquer outro tipo de documento (contrato, nota fiscal, relatório, etc).',
        userPrompt:   `Documento:\n\n${texto.slice(0, 3000)}`,
        maxTokens:    5,
        temperatura:  0,
      });
      return resposta.toUpperCase().startsWith('SIM');
    } catch (e) {
      this.log(`Aviso: falha na verificação de currículo, prosseguindo mesmo assim: ${e.message}`, 'warning');
      return true;
    }
  }

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
        const desc  = e.descricao ? `\n${e.descricao}` : '';
        const ativs = e.atividades?.length
          ? '\n' + e.atividades.map(a => `  • ${a}`).join('\n')
          : '';
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

module.exports = new WhatsAppService();

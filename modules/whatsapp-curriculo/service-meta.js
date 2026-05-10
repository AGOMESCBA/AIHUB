const { EventEmitter } = require('events');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const db = require('./database');
const ia = require('../ia');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

class MetaWhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.status         = 'stopped';
    this._empresaId     = null;
    this._empresaNome   = null;
    this._logBuffer     = [];
    this._wired         = false;
    this.pendingUpdates = new Map();
    this._phoneInfo     = null;
  }

  getStatus()      { return this.status; }
  getQr()          { return null; }
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

  _token()   { return db.getConfig(this._empresaId, 'meta_wa_token')    || ''; }
  _phoneId() { return db.getConfig(this._empresaId, 'meta_wa_phone_id') || ''; }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────────

  async start(empresaId, empresaNome) {
    this._empresaId   = Number(empresaId);
    this._empresaNome = empresaNome || null;

    const token   = this._token();
    const phoneId = this._phoneId();

    if (!token || !phoneId) {
      this.log('Token ou Phone Number ID não configurados. Acesse Configuração → API Oficial Meta.', 'error');
      this.setStatus('stopped');
      return;
    }

    this.setStatus('starting');
    this.log('Verificando credenciais da API Meta…', 'info');

    try {
      const resp = await fetch(
        `${GRAPH_API}/${phoneId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resp.json();

      if (!resp.ok) {
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        this.log(`Falha na autenticação Meta: ${msg}`, 'error');
        this.setStatus('stopped');
        return;
      }

      this._phoneInfo = data;
      this.log(`Meta API conectada! Número: ${data.display_phone_number} — ${data.verified_name}`, 'success');
      this.log('Aguardando mensagens via webhook. Configure o webhook no Meta Developer Console.', 'info');
      this.setStatus('connected');

      const pendentes = db.listPendingUpdates(this._empresaId);
      if (pendentes.length) {
        pendentes.forEach(p => this.pendingUpdates.set(p.sender, p));
        this.log(`${pendentes.length} confirmação(ões) pendente(s) restaurada(s).`, 'info');
      }
    } catch (err) {
      this.log(`Erro ao conectar Meta API: ${err.message}`, 'error');
      this.setStatus('stopped');
    }
  }

  async stop() {
    this.setStatus('stopped');
    this.log('Serviço Meta desativado.', 'info');
  }

  // ── Enviar mensagem ────────────────────────────────────────────────────────────

  async sendMessage(to, text) {
    const token   = this._token();
    const phoneId = this._phoneId();
    const numero  = String(to).replace(/\D/g, '');
    const MAX     = 4096;

    for (let i = 0; i < text.length; i += MAX) {
      const resp = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   numero,
          type: 'text',
          text: { body: text.slice(i, i + MAX) },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Meta send error ${resp.status}: ${err?.error?.message || JSON.stringify(err)}`);
      }
    }
  }

  // ── Download de mídia Meta ─────────────────────────────────────────────────────

  async _downloadMedia(mediaId) {
    const token = this._token();

    const infoResp = await fetch(`${GRAPH_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!infoResp.ok) throw new Error(`Erro ao obter URL da mídia (${infoResp.status})`);
    const info = await infoResp.json();

    const mediaResp = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mediaResp.ok) throw new Error(`Erro ao baixar mídia (${mediaResp.status})`);

    const buffer = Buffer.from(await mediaResp.arrayBuffer());
    return { data: buffer.toString('base64'), mimetype: info.mime_type || 'application/octet-stream' };
  }

  // ── Webhook: entrada de mensagens ──────────────────────────────────────────────

  async handleWebhook(body) {
    if (this.status !== 'connected') return;
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages?.length) return;

    for (const msg of messages) {
      await this._processMessage(msg).catch(err =>
        this.log(`Erro ao processar mensagem ${msg.id}: ${err.message}`, 'error')
      );
    }
  }

  async _processMessage(msg) {
    const sender = msg.from;
    this.log(`Mensagem recebida — tipo: ${msg.type}, de: ${sender}`, 'info');

    if (this.pendingUpdates.has(sender) && msg.type === 'text') {
      await this._handleConfirmationResponse(msg);
      return;
    }

    if (msg.type !== 'document') {
      this.log(`Mensagem ignorada — tipo ${msg.type} não é documento.`, 'info');
      return;
    }

    const msgId = msg.id;
    if (db.isProcessed(this._empresaId, msgId)) {
      this.log(`Mensagem ${msgId} já processada. Ignorando.`, 'info');
      return;
    }

    const doc = msg.document;
    if (!doc?.id) { this.log('Documento sem media_id. Ignorando.', 'warning'); return; }

    this.log(`PDF recebido de ${sender}`, 'received');

    try {
      this.log(`[1/5] Baixando arquivo de ${sender}…`, 'info');
      const media = await this._downloadMedia(doc.id);
      this.log(`[1/5] Download OK — mimetype: ${media.mimetype}`, 'info');

      if (!media.mimetype?.includes('pdf')) {
        this.log(`[1/5] Ignorado — não é PDF (${media.mimetype}).`, 'warning');
        await this.sendMessage(sender, db.getConfig(this._empresaId, 'msg_nao_pdf') ||
          '⚠️ Por favor, envie o currículo em formato *PDF*.');
        return;
      }

      this.log('[2/5] Extraindo texto do PDF…', 'info');
      const buffer  = Buffer.from(media.data, 'base64');
      const pdfData = await pdfParse(buffer);
      const texto   = pdfData.text.trim();
      this.log(`[2/5] Texto extraído: ${texto.length} caracteres.`, 'info');

      if (!texto) {
        this.log('[2/5] FALHA: PDF sem texto legível.', 'error');
        await this.sendMessage(sender, db.getConfig(this._empresaId, 'msg_pdf_ilegivel') ||
          '❌ Não consegui ler o PDF. Verifique se não está protegido ou escaneado como imagem.');
        return;
      }

      const { texto: textoFinal, idioma } = await this.traduzirSeNecessario(texto);
      if (idioma !== 'pt') this.log(`[3/5] Currículo em "${idioma}" — traduzido.`, 'info');

      this.log('[4/5] Verificando se é currículo…', 'info');
      const ehCurriculo = await this.verificarSeCurriculo(textoFinal);
      if (!ehCurriculo) {
        this.log('[4/5] Documento rejeitado — não é currículo.', 'warning');
        await this.sendMessage(sender, db.getConfig(this._empresaId, 'msg_nao_curriculo') ||
          '😊 Olá! O arquivo enviado não parece ser um currículo. Por favor, envie seu currículo em formato *PDF*. Obrigado!');
        return;
      }

      this.log('[5/5] Enviando para análise IA…', 'info');
      const dados = await this.analisarComRetry(textoFinal);

      const existente = db.findByPhoneOrEmail(this._empresaId, dados.telefone, dados.email);
      if (existente) {
        this.log(`Duplicado detectado — ID #${existente.id}. Aguardando confirmação.`, 'warning');
        const pending = {
          existingId: existente.id, dados,
          pdf_base64: media.data, pdf_nome: doc.filename || 'curriculo.pdf', msgId,
        };
        this.pendingUpdates.set(sender, pending);
        db.savePendingUpdate(this._empresaId, sender, pending);
        const tpl = db.getConfig(this._empresaId, 'msg_duplicata') ||
          '⚠️ Já existe um currículo cadastrado com este telefone ou e-mail ({nome}).\n\nDeseja *atualizar* o registro existente?\n\nResponda *SIM* para atualizar ou *NÃO* para manter o atual.';
        await this.sendMessage(sender, tpl.replace('{nome}', existente.nome || ''));
        return;
      }

      await this._salvarENotificar({ sender, dados, pdf_base64: media.data, pdf_nome: doc.filename || 'curriculo.pdf', msgId });

    } catch (err) {
      this.log(`ERRO ao processar ${sender}: ${err.message}`, 'error');
      try {
        await this.sendMessage(sender, db.getConfig(this._empresaId, 'msg_erro') ||
          '❌ Ocorreu um erro ao processar seu currículo. Tente novamente.');
      } catch (_) {}
    }
  }

  async _salvarENotificar({ sender, dados, pdf_base64, pdf_nome, msgId }) {
    const raw           = db.getConfig(this._empresaId, 'numero_destino');
    const numeroDestino = raw ? raw.replace(/\D/g, '') : null;

    this.emit('curriculo', { remetente: sender, dados, pdf_base64, pdf_nome, empresaId: this._empresaId });
    db.markProcessed(this._empresaId, msgId);

    try {
      await this.sendMessage(sender,
        db.getConfig(this._empresaId, 'msg_confirmacao') ||
        '✅ Seu currículo foi recebido e está sendo analisado. Entraremos em contato em breve!');
    } catch (e) {
      this.log(`Aviso: não foi possível confirmar para ${sender}: ${e.message}`, 'warning');
    }

    if (numeroDestino) {
      try {
        const mensagem = this._formatarParaWhatsApp(dados);
        await this.sendMessage(numeroDestino, `✅ *Currículo recebido de ${sender}*\n\n${mensagem}`);
        this.log(`[5/5] Concluído. Currículo de ${sender} enviado para ${numeroDestino}.`, 'success');
      } catch (e) {
        this.log(`[5/5] Currículo salvo, mas falhou ao encaminhar: ${e.message}`, 'warning');
      }
    } else {
      this.log(`[5/5] Concluído. Currículo de ${sender} salvo no banco.`, 'success');
    }
  }

  async _handleConfirmationResponse(msg) {
    const sender  = msg.from;
    const pending = this.pendingUpdates.get(sender) || db.getPendingUpdate(this._empresaId, sender);
    const resposta = (msg.text?.body || '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    this.log(`Confirmação de ${sender}: "${resposta}"`, 'info');

    if (!pending) return;

    if (resposta === 'SIM') {
      db.deleteCurriculo(this._empresaId, pending.existingId);
      this.pendingUpdates.delete(sender);
      db.deletePendingUpdate(this._empresaId, sender);
      await this._salvarENotificar({
        sender, dados: pending.dados,
        pdf_base64: pending.pdf_base64, pdf_nome: pending.pdf_nome, msgId: pending.msgId,
      });
    } else if (resposta === 'NAO') {
      this.pendingUpdates.delete(sender);
      db.deletePendingUpdate(this._empresaId, sender);
      try {
        await this.sendMessage(sender,
          db.getConfig(this._empresaId, 'msg_nao_atualizar') ||
          '😊 Tudo bem! Seu currículo atual permanece em nossos registros. Obrigado!');
      } catch (e) {
        this.log(`Erro ao responder NÃO para ${sender}: ${e.message}`, 'error');
      }
    } else {
      this.log(`Resposta não reconhecida: "${resposta}". Aguardando SIM ou NÃO.`, 'warning');
    }
  }

  // ── Delega IA ──────────────────────────────────────────────────────────────────

  async analisarComRetry(texto)     { return ia.analisarComRetry(texto,     (m, t) => this.log(m, t), this._empresaId); }
  async traduzirSeNecessario(texto) { return ia.traduzirSeNecessario(texto, (m, t) => this.log(m, t), this._empresaId); }
  async verificarSeCurriculo(texto) { return ia.verificarSeCurriculo(texto, (m, t) => this.log(m, t), this._empresaId); }

  _formatarParaWhatsApp(d) {
    const partes = [];
    const pessoais = [
      `• Nome: ${d.nome || '—'}`,
      d.telefone ? `• Telefone: ${d.telefone}` : null,
      d.email    ? `• E-mail: ${d.email}`       : null,
      d.endereco ? `• Endereço: ${d.endereco}`  : null,
      d.linkedin ? `• LinkedIn: ${d.linkedin}`  : null,
    ].filter(Boolean).join('\n');
    partes.push(`📋 *DADOS PESSOAIS*\n${pessoais}`);
    if (d.descricao) partes.push(`👤 *DESCRIÇÃO*\n${d.descricao}`);
    if (d.experiencias?.length) {
      partes.push('💼 *EXPERIÊNCIA PROFISSIONAL*');
      d.experiencias.forEach(e => {
        const ativs = Array.isArray(e.atividades) ? '\n' + e.atividades.map(a => `  • ${a}`).join('\n') : '';
        partes.push(`🏢 *${e.empresa}* | ${e.cargo} | ${e.periodo}${ativs}`);
      });
    }
    if (d.formacao?.length)     partes.push(`🎓 *FORMAÇÃO*\n${d.formacao.map(f => `• ${f.instituicao} — ${f.curso} (${f.periodo})`).join('\n')}`);
    if (d.habilidades?.length)  partes.push(`🛠️ *HABILIDADES*\n${d.habilidades.map(h => `• ${h}`).join('\n')}`);
    if (d.capacitacoes?.length) partes.push(`🏆 *CERTIFICAÇÕES*\n${d.capacitacoes.map(c => `• ${c}`).join('\n')}`);
    return partes.join('\n\n');
  }
}

module.exports = MetaWhatsAppService;

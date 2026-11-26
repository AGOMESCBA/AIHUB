'use strict';

// Provedor WhatsApp Web (whatsapp-web.js — a mesma biblioteca do IA Command,
// mas na cópia corrigida de vendor/whatsapp-web.js: ver o LEIA-ME de lá).
// Roda DENTRO do processo filho do canal (canais/runner.js), nunca no processo
// principal do Talk. Receita de boot copiada do IA Command
// (apps/IA Command/modules/whatsapp/service.js: PUPPETEER_ARGS, LocalAuth,
// resolveChromePath, eventos qr/authenticated/ready/disconnected/message).
//
// Sessão própria do Talk em data/sessoes/ — nunca reutiliza a pasta
// .wwebjs_auth do IA Command. Entra no número como mais um "aparelho conectado".

const fs = require('fs');
const BIBLIOTECA_WWEB = '../../vendor/whatsapp-web.js';
const path = require('path');
const QRCode = require('qrcode');
const { RAIZ_REPO } = require('../config');

// Cache de versões do WhatsApp Web: SEMPRE o mesmo do IA Command (<raiz>/.wwebjs_cache;
// só cópias da página do WhatsApp Web, não é sessão). Sem caminho, a biblioteca usa
// ./.wwebjs_cache relativo à pasta do serviço: o Talk não achava a versão compatível,
// carregava a mais nova e falhava com "Cannot read properties of null (reading 'Socket')".
const DIR_CACHE_VERSOES = path.join(RAIZ_REPO, '.wwebjs_cache');
const { ProvedorBase, ErroProvedor, CAPACIDADES_VAZIAS, validarEnvelope } = require('./interface');

const PUPPETEER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-default-apps', '--disable-sync', '--mute-audio',
  '--hide-scrollbars', '--metrics-recording-only', '--remote-debugging-port=0',
  '--disable-hang-monitor', '--disable-crash-reporter', '--disable-in-process-stack-traces',
  '--disable-features=TranslateUI', '--renderer-process-limit=1',
];

const QR_VALIDADE_MS = 60_000;
const TIPOS_IGNORADOS = new Set(['e2e_notification', 'notification_template', 'protocol', 'gp2', 'call_log', 'revoked', 'ciphertext']);
const TIPO_MENSAGEM = { chat: 'texto', text: 'texto', image: 'imagem', document: 'documento', audio: 'audio', ptt: 'audio', video: 'video' };
const ACK_ESTADO = { 1: 'enviada', 2: 'entregue', 3: 'lida', 4: 'lida' };

const CAPACIDADES = Object.freeze({
  ...CAPACIDADES_VAZIAS,
  texto: true,
  formatacao: 'whatsapp',
  imagem: true,
  documento: true,
  audio: true,
  video: false,
  grupos: true,
  recibos: Object.freeze({ enviada: true, entregue: true, lida: true }),
  qr: true,
  max_midia_bytes: 16 * 1024 * 1024,
  mimes_aceitos: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv', 'text/plain', 'audio/ogg', 'audio/mpeg']),
});

function resolverChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidatos.find(p => fs.existsSync(p)) || null;
}

const digitos = (v) => String(v || '').split('@')[0].replace(/\D/g, '');

// Remetente "@lid" (identificador interno do WhatsApp, não é o telefone): tenta
// 1) client.getContactLidAndPhone (pede o telefone ao próprio WhatsApp Web) e
// 2) como o IA Command (_resolverSender): msg.author, contact.number e contact.id,
// descartando o que for o próprio LID. Devolve null se nenhum telefone aparecer.
async function resolverTelefoneLid(msg, client) {
  const lid = digitos(msg.from);
  const candidatos = [];
  try {
    const [r] = (await client?.getContactLidAndPhone?.([msg.from])) || [];
    candidatos.push(r?.pn);
  } catch (_) { /* segue para o contato */ }
  candidatos.push(msg.author);
  try {
    const contato = await msg.getContact();
    candidatos.push(contato?.id?._serialized, contato?.number);
  } catch (_) { /* sem contato */ }
  for (const c of candidatos) {
    const v = String(c || '');
    if (!v || v.includes('@lid')) continue;
    const d = digitos(v);
    if (d && d !== lid) return d;
  }
  return null;
}

class ProvedorWweb extends ProvedorBase {
  // canal: { id, sessao_id }; dirSessoes: data/sessoes
  constructor({ canal, dirSessoes, log = () => {} }) {
    super({ canal, log });
    this.dirSessoes = dirSessoes;
    this.client = null;
  }

  get codigo() { return 'wweb'; }

  capacidades() { return CAPACIDADES; }

  pastaSessao() { return path.join(this.dirSessoes, `session-${this.canal.sessao_id}`); }

  temSessao() { return fs.existsSync(this.pastaSessao()); }

  async iniciar() {
    const { Client, LocalAuth } = require(BIBLIOTECA_WWEB);
    this._mudarEstado('iniciando');
    fs.mkdirSync(this.dirSessoes, { recursive: true });
    const puppeteer = { headless: true, args: PUPPETEER_ARGS };
    const chrome = resolverChrome();
    if (chrome) puppeteer.executablePath = chrome;
    const versao = String(process.env.IA_TALK_WA_WEB_VERSION || process.env.IAC_WA_WEB_VERSION || '').trim();
    const opcoesVersao = versao
      ? { webVersion: versao, webVersionCache: { type: 'local', path: DIR_CACHE_VERSOES, strict: true } }
      : { webVersionCache: { type: 'local', path: DIR_CACHE_VERSOES } };

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: this.canal.sessao_id, dataPath: this.dirSessoes }),
      puppeteer,
      qrMaxRetries: 8,
      ...opcoesVersao,
    });
    const c = this.client;
    if (chrome) this.log('info', `Chrome: ${chrome}`);
    if (versao) this.log('info', `WhatsApp Web: versão fixada ${versao} (cache do IA Command).`);
    this.log('info', this.temSessao() ? 'Sessão salva encontrada. Conectando ao WhatsApp…' : 'Sem sessão salva: gerando QR Code.');

    c.on('qr', async (qr) => {
      const imagem = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      this._mudarEstado('qr_pendente');
      this.emit('qr', { qr: imagem, expira_em: new Date(Date.now() + QR_VALIDADE_MS).toISOString() });
    });
    c.on('loading_screen', (pct) => this.log('info', `Carregando o WhatsApp (${pct}%)…`));
    c.on('authenticated', () => this.log('success', 'WhatsApp autenticado; aguardando ficar pronto…'));
    c.on('ready', () => {
      // Mensagens antigas que o WhatsApp reenvia ao sincronizar não contam.
      this._aceitarApos = Math.floor(Date.now() / 1000) - 30;
      this.emit('identidade', { numero: digitos(c.info?.wid?.user) });
      this._mudarEstado('conectado');
    });
    c.on('auth_failure', () => this._mudarEstado('erro', 'O WhatsApp recusou a sessão salva. Gere um novo QR Code.'));
    c.on('disconnected', (motivo) => this._mudarEstado('desconectado', `WhatsApp desconectado (${motivo || 'sem motivo informado'}).`));
    c.on('message', (msg) => this._receber(msg).catch(err => this.log('error', `Falha ao ler mensagem recebida: ${err.message}`)));
    c.on('message_ack', (msg, ack) => {
      const estado = ack === -1 ? 'falhou' : ACK_ESTADO[ack];
      if (estado) this.emit('status', { id_provedor: msg.id?._serialized, estado, em: new Date().toISOString() });
    });

    c.initialize().catch((err) => this._mudarEstado('erro', `Falha ao iniciar o WhatsApp: ${err.message}`));
  }

  async _receber(msg) {
    if (msg.fromMe || msg.isStatus || TIPOS_IGNORADOS.has(msg.type)) return;
    if (this._aceitarApos && Number(msg.timestamp || 0) < this._aceitarApos) return;
    const grupo = String(msg.from || '').endsWith('@g.us');
    let valor = digitos(msg.from);
    if (!grupo && String(msg.from || '').includes('@lid')) {
      const tel = await resolverTelefoneLid(msg, this.client);
      // Sem telefone não há como conferir a lista de teste: fica registrado no log.
      if (tel) valor = tel;
      else this.log('warning', `Remetente sem telefone identificável (código interno do WhatsApp ••••${valor.slice(-4)}).`);
    }
    this.emit('mensagem', {
      id_provedor: msg.id?._serialized,
      de: { tipo: grupo ? 'grupo' : 'telefone', valor, autor: grupo ? digitos(msg.author) : undefined },
      tipo: TIPO_MENSAGEM[msg.type] || 'outro',
      texto: msg.body || '',
      em: new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
    });
  }

  async parar() {
    const c = this.client;
    this.client = null;
    if (c) await c.destroy().catch(() => {});
    this._mudarEstado('parado');
  }

  async enviar(envelope) {
    validarEnvelope(envelope, CAPACIDADES);
    if (!this.client || this._estado !== 'conectado') throw new ErroProvedor('temporario', 'canal_desconectado', 'Canal não está conectado.');
    const { MessageMedia } = require(BIBLIOTECA_WWEB);
    let destino;
    if (envelope.destinatario.tipo === 'grupo') destino = envelope.destinatario.valor;
    else {
      const id = await this.client.getNumberId(digitos(envelope.destinatario.valor)).catch(() => null);
      if (!id) throw new ErroProvedor('permanente', 'numero_inexistente', 'Número não encontrado no WhatsApp.');
      destino = id._serialized;
    }
    try {
      const conteudo = envelope.tipo === 'texto'
        ? envelope.texto
        : new MessageMedia(envelope.arquivo.mime, envelope.arquivo.dados.toString('base64'), envelope.arquivo.nome);
      const opcoes = envelope.tipo !== 'texto' && envelope.legenda ? { caption: envelope.legenda } : undefined;
      const r = await this.client.sendMessage(destino, conteudo, opcoes);
      return { id_provedor: r?.id?._serialized || null, aceito_em: new Date().toISOString() };
    } catch (err) {
      // Pode ter saído ou não: não reenviar automaticamente.
      throw new ErroProvedor('desconhecido', 'resultado_desconhecido', `O envio não confirmou: ${err.message}`);
    }
  }

  // Apaga a sessão salva (o celular terá de ler um novo QR). Só com o cliente parado.
  // Sai do WhatsApp (remove este aparelho da lista do celular) e apaga a sessão.
  async desvincular() {
    const c = this.client;
    if (c) await c.logout().catch(err => this.log('warning', `Não consegui sair do WhatsApp (${err.message}). Remova o aparelho pelo celular.`));
    await this.parar();
    fs.rmSync(this.pastaSessao(), { recursive: true, force: true });
  }

  limparSessao() {
    if (this.client) throw new Error('Pare o canal antes de limpar a sessão.');
    fs.rmSync(this.pastaSessao(), { recursive: true, force: true });
  }
}

module.exports = { ProvedorWweb, CAPACIDADES_WWEB: CAPACIDADES, resolverChrome, resolverTelefoneLid };

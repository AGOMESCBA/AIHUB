'use strict';

// Interface comum dos provedores de WhatsApp (WhatsApp Web na Fase 1; Meta
// Cloud API depois, etapa G6). O resto do Talk só conversa com esta
// interface. Regras:
//  - cada provedor declara o que suporta em capacidades(); pedido fora disso é
//    recusado com 'recurso_nao_suportado' (nunca simular nem trocar de
//    provedor sem avisar);
//  - erro de envio sempre diz se é 'temporario', 'permanente' ou
//    'desconhecido' (este último NÃO é reenviado automaticamente).
//
// Eventos emitidos (EventEmitter):
//   'estado'   { estado, detalhe? }                     estado ∈ ESTADOS_CANAL
//   'qr'       { qr: dataURL, expira_em }               só provedores com QR
//   'mensagem' MensagemRecebida (ver abaixo)
//   'status'   { id_provedor, estado, em, erro? }       estado ∈ enviada|entregue|lida|falhou
//
// MensagemRecebida:
//   { id_provedor, de: { tipo: 'telefone'|'grupo', valor, nome? }, tipo,
//     texto?, arquivo?: { nome, mime, dados: Buffer }, legenda?, em, bruto? }

const { EventEmitter } = require('events');
const { erro } = require('../erros');
const { TIPOS_MENSAGEM } = require('../contratos');

const CAPACIDADES_VAZIAS = Object.freeze({
  texto: false,
  formatacao: 'nenhuma',        // 'whatsapp' = *negrito* _itálico_ ~riscado~ ```mono```
  imagem: false,
  documento: false,
  audio: false,
  video: false,
  grupos: false,
  modelos: false,               // templates aprovados (Meta)
  janela_24h: false,            // fora da janela só com modelo (Meta)
  recibos: Object.freeze({ enviada: false, entregue: false, lida: false }),
  qr: false,
  max_midia_bytes: 0,
  mimes_aceitos: Object.freeze([]),
});

class ErroProvedor extends Error {
  constructor(tipo, codigo, mensagem) {
    super(mensagem);
    if (!['temporario', 'permanente', 'desconhecido'].includes(tipo)) throw new Error(`Tipo de erro de provedor inválido: ${tipo}`);
    this.name = 'ErroProvedor';
    this.tipo = tipo;
    this.codigo = codigo;
  }
}

class ProvedorBase extends EventEmitter {
  constructor({ canal, log = () => {} } = {}) {
    super();
    if (new.target === ProvedorBase) throw new Error('ProvedorBase é abstrata.');
    this.canal = canal;
    this.log = log;
    this._estado = 'parado';
  }

  /** @returns {string} 'wweb' | 'meta' | ... */
  get codigo() { throw new Error('Provedor sem código.'); }

  /** @returns {typeof CAPACIDADES_VAZIAS} */
  capacidades() { throw new Error('Provedor sem capacidades().'); }

  estado() { return this._estado; }

  _mudarEstado(estado, detalhe) {
    this._estado = estado;
    this.emit('estado', detalhe === undefined ? { estado } : { estado, detalhe });
  }

  async iniciar() { throw new Error('Provedor sem iniciar().'); }
  async parar() { throw new Error('Provedor sem parar().'); }

  /**
   * @param {Envelope} envelope ver validarEnvelope()
   * @returns {Promise<{ id_provedor: string, aceito_em: string }>}
   * @throws {ErroProvedor}
   */
  async enviar(_envelope) { throw new Error('Provedor sem enviar().'); }

  /**
   * Só provedores com webhook (Meta). Recebe o corpo CRU (Buffer) para validar
   * X-Hub-Signature-256 antes de qualquer JSON.parse.
   * @param {{ cabecalhos: object, rawBody: Buffer }} pedido
   * @returns {Promise<{ aceito: boolean, mensagens: number, status: number }>}
   */
  async processarWebhook(_pedido) {
    throw erro('recurso_nao_suportado', `O provedor ${this.codigo} não recebe webhook.`);
  }
}

/**
 * Envelope de saída (o que o núcleo entrega ao provedor):
 * { id, destinatario: { tipo: 'telefone'|'grupo', valor },
 *   tipo: TIPOS_MENSAGEM, texto?, legenda?,
 *   arquivo?: { nome, mime, dados: Buffer },
 *   modelo?: { nome, idioma, parametros: [] } }   // só se capacidades.modelos
 */
function validarEnvelope(envelope, capacidades) {
  const recusar = (msg) => { throw erro('recurso_nao_suportado', msg); };
  if (!envelope || typeof envelope !== 'object') throw erro('requisicao_invalida', 'Envelope de envio vazio.');
  if (!TIPOS_MENSAGEM.includes(envelope.tipo)) throw erro('requisicao_invalida', `Tipo de mensagem desconhecido: ${envelope.tipo}.`);
  const dest = envelope.destinatario;
  if (!dest || !['telefone', 'grupo'].includes(dest.tipo) || !String(dest.valor || '').trim()) {
    throw erro('requisicao_invalida', 'Destinatário inválido.', { campos: { destinatario: 'obrigatório' } });
  }
  if (dest.tipo === 'grupo' && !capacidades.grupos) recusar('Este canal não envia para grupos.');
  if (envelope.modelo && !capacidades.modelos) recusar('Este canal não usa modelos de mensagem.');
  if (envelope.tipo === 'texto') {
    if (!capacidades.texto) recusar('Este canal não envia texto.');
    if (!String(envelope.texto || '').trim()) throw erro('requisicao_invalida', 'Texto vazio.', { campos: { texto: 'obrigatório' } });
    return true;
  }
  if (!capacidades[envelope.tipo]) recusar(`Este canal não envia ${envelope.tipo}.`);
  const arq = envelope.arquivo;
  if (!arq || !Buffer.isBuffer(arq.dados) || !arq.mime || !arq.nome) {
    throw erro('requisicao_invalida', 'Arquivo incompleto: nome, tipo e conteúdo são obrigatórios.', { campos: { arquivo: 'incompleto' } });
  }
  if (capacidades.max_midia_bytes && arq.dados.length > capacidades.max_midia_bytes) {
    recusar(`Arquivo maior que o limite do canal (${capacidades.max_midia_bytes} bytes).`);
  }
  if (capacidades.mimes_aceitos.length && !capacidades.mimes_aceitos.includes(arq.mime)) {
    recusar(`Tipo de arquivo não aceito pelo canal: ${arq.mime}.`);
  }
  return true;
}

const METODOS_OBRIGATORIOS = ['capacidades', 'iniciar', 'parar', 'enviar', 'estado'];

// Usado nos testes de cada adaptador (simulado, wweb, meta).
function conferirImplementacao(provedor) {
  const faltando = [];
  if (!(provedor instanceof ProvedorBase)) faltando.push('estender ProvedorBase');
  for (const m of METODOS_OBRIGATORIOS) {
    if (typeof provedor[m] !== 'function' || provedor[m] === ProvedorBase.prototype[m] && m !== 'estado') faltando.push(m);
  }
  let caps = null;
  try { caps = provedor.capacidades(); } catch (_) { faltando.push('capacidades() funcionando'); }
  if (caps) {
    for (const chave of Object.keys(CAPACIDADES_VAZIAS)) if (!(chave in caps)) faltando.push(`capacidades.${chave}`);
  }
  try { if (!provedor.codigo) faltando.push('codigo'); } catch (_) { faltando.push('codigo'); }
  return faltando;
}

module.exports = { ProvedorBase, ErroProvedor, CAPACIDADES_VAZIAS, validarEnvelope, conferirImplementacao };

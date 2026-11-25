'use strict';

// Provedor simulado: segue a interface sem tocar no WhatsApp. Usado nos testes
// do núcleo (C2–C4) e no servidor simulado das telas. Nunca envia nada real.

const crypto = require('crypto');
const { ProvedorBase, ErroProvedor, CAPACIDADES_VAZIAS, validarEnvelope } = require('./interface');

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
  mimes_aceitos: Object.freeze(['image/png', 'image/jpeg', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'audio/ogg']),
});

class ProvedorSimulado extends ProvedorBase {
  // falhar: null | 'temporario' | 'permanente' | 'desconhecido' (força erro no próximo envio)
  constructor(opcoes = {}) {
    super(opcoes);
    this.atrasoMs = opcoes.atrasoMs ?? 0;
    this.falhar = null;
    this.enviados = [];
  }

  get codigo() { return 'simulado'; }

  capacidades() { return CAPACIDADES; }

  async iniciar() {
    this._mudarEstado('iniciando');
    this._mudarEstado('qr_pendente');
    this.emit('qr', { qr: 'data:image/png;base64,SIMULADO', expira_em: new Date(Date.now() + 60_000).toISOString() });
  }

  // Equivale a ler o QR com o celular.
  simularLeituraQr() { this._mudarEstado('conectado'); }

  simularQueda(detalhe = 'Conexão perdida (simulação).') { this._mudarEstado('reconectando', detalhe); }

  async parar() { this._mudarEstado('parado'); }

  async enviar(envelope) {
    validarEnvelope(envelope, CAPACIDADES);
    if (this._estado !== 'conectado') throw new ErroProvedor('temporario', 'canal_desconectado', 'Canal não está conectado.');
    if (this.falhar) {
      const tipo = this.falhar;
      this.falhar = null;
      throw new ErroProvedor(tipo, `falha_${tipo}`, `Falha ${tipo} simulada.`);
    }
    const id_provedor = `sim_${crypto.randomBytes(6).toString('hex')}`;
    this.enviados.push({ id_provedor, envelope });
    const emitir = (estado, apos) => setTimeout(() => this.emit('status', { id_provedor, estado, em: new Date().toISOString() }), apos);
    emitir('enviada', this.atrasoMs);
    emitir('entregue', this.atrasoMs * 2);
    emitir('lida', this.atrasoMs * 3);
    return { id_provedor, aceito_em: new Date().toISOString() };
  }

  simularRecebimento({ de = '5565999990000', texto = 'Olá', tipo = 'texto', arquivo } = {}) {
    const msg = {
      id_provedor: `sim_in_${crypto.randomBytes(6).toString('hex')}`,
      de: { tipo: 'telefone', valor: de },
      tipo,
      texto,
      em: new Date().toISOString(),
    };
    if (arquivo) msg.arquivo = arquivo;
    this.emit('mensagem', msg);
    return msg;
  }
}

module.exports = { ProvedorSimulado, CAPACIDADES_SIMULADO: CAPACIDADES };

'use strict';

// Supervisor dos canais (processo principal do Talk). Para cada canal ligado:
// pega a concessão do número (só um processo segura cada canal), sobe o
// processo filho (runner.js), grava estado e log, aplica o modo de teste e
// avisa as telas pelo Socket.IO. Reinicia com espera crescente se o filho cair.
// Padrão de concessão com ficha: igual ao IAHub-Jobs (modules/jobs/repositorio.js).

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const config = require('../config');
const telefone = require('../seguranca/telefone');

const CONCESSAO_MS = 90_000;
const RENOVAR_MS = 30_000;
const ESPERAS_REINICIO_MS = [5_000, 15_000, 60_000, 180_000, 600_000];
const LOG_MAXIMO_POR_CANAL = 500;
const RESUMO_DESCARTADAS_MS = 60_000;

class SupervisorCanais {
  constructor({ db, emitir = () => {}, dirSessoes = path.join(config.DIR_DADOS, 'sessoes'), envFilho = {}, log = console, esperas = ESPERAS_REINICIO_MS } = {}) {
    this.db = db;
    this.emitir = emitir; // (canalId, evento, dados)
    this.dirSessoes = dirSessoes;
    this.envFilho = envFilho;
    this.logger = log;
    this.esperas = esperas;
    this.dono = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
    this.filhos = new Map();   // canalId -> { proc, ficha, encerrando }
    this.qrs = new Map();      // canalId -> { qr, expira_em }
    this.tentativas = new Map();
    this.descartadas = new Map(); // canalId -> quantidade ainda não resumida no log
    this.pendentesEnvio = new Map();
    this._timers = [];
  }

  // ── Concessão ────────────────────────────────────────────────────────────
  _pegarConcessao(canalId) {
    const agora = new Date();
    this.db.prepare('INSERT OR IGNORE INTO canal_concessoes (canal_id) VALUES (?)').run(canalId);
    const r = this.db.prepare(`UPDATE canal_concessoes SET ficha = ficha + 1, dono = @dono, valida_ate = @ate
      WHERE canal_id = @canal AND (valida_ate IS NULL OR valida_ate < @agora OR dono = @dono)`)
      .run({ canal: canalId, dono: this.dono, ate: new Date(agora.getTime() + CONCESSAO_MS).toISOString(), agora: agora.toISOString() });
    if (r.changes !== 1) return null;
    return this.db.prepare('SELECT ficha FROM canal_concessoes WHERE canal_id = ?').get(canalId).ficha;
  }

  _renovarConcessoes() {
    const ate = new Date(Date.now() + CONCESSAO_MS).toISOString();
    for (const [canalId, f] of this.filhos) {
      const r = this.db.prepare('UPDATE canal_concessoes SET valida_ate = ? WHERE canal_id = ? AND dono = ? AND ficha = ?').run(ate, canalId, this.dono, f.ficha);
      if (r.changes !== 1) {
        this._log(canalId, 'error', 'Outro processo assumiu este canal; este processo parou para não duplicar a conexão.');
        this._encerrarFilho(canalId);
      }
    }
  }

  _devolverConcessao(canalId) {
    this.db.prepare('UPDATE canal_concessoes SET valida_ate = NULL, dono = NULL WHERE canal_id = ? AND dono = ?').run(canalId, this.dono);
  }

  // ── Estado, log, avisos ──────────────────────────────────────────────────
  _log(canalId, tipo, mensagem) {
    const em = new Date().toISOString();
    const texto = String(mensagem).slice(0, 500);
    this.db.prepare('INSERT INTO canal_log (canal_id, em, tipo, mensagem) VALUES (?, ?, ?, ?)').run(canalId, em, tipo, texto);
    if (Math.random() < 0.05) {
      this.db.prepare(`DELETE FROM canal_log WHERE canal_id = ? AND id NOT IN (SELECT id FROM canal_log WHERE canal_id = ? ORDER BY id DESC LIMIT ${LOG_MAXIMO_POR_CANAL})`).run(canalId, canalId);
    }
    this.emitir(canalId, 'canal:log', { canal_id: canalId, em, tipo, mensagem: texto });
  }

  _mudarEstado(canalId, estado, detalhe = null) {
    const em = new Date().toISOString();
    this.db.prepare('UPDATE canais SET estado = ?, estado_desde = ?, estado_detalhe = ?, atualizado_em = ? WHERE id = ?').run(estado, em, detalhe, em, canalId);
    if (estado !== 'qr_pendente') this.qrs.delete(canalId);
    this.emitir(canalId, 'canal:estado', { canal_id: canalId, estado, em, ...(detalhe ? { detalhe } : {}) });
    const textos = { conectado: ['success', 'Canal conectado.'], parado: ['system', 'Canal parado.'], qr_pendente: ['info', 'Aguardando leitura do QR Code.'],
      iniciando: ['info', 'Iniciando o WhatsApp…'], reconectando: ['warning', 'Reconectando…'], desconectado: ['warning', detalhe || 'WhatsApp desconectado.'], erro: ['error', detalhe || 'Erro no canal.'] };
    const [tipo, msg] = textos[estado] || ['info', `Estado: ${estado}`];
    this._log(canalId, tipo, msg);
  }

  // Modo de teste: só mensagens dos números da lista entram; das demais fica a contagem.
  _receber(canalId, m) {
    const canal = this.db.prepare('SELECT modo_teste, numeros_teste FROM canais WHERE id = ?').get(canalId);
    if (!canal) return;
    const lista = JSON.parse(canal.numeros_teste || '[]');
    const variantes = new Set(telefone.variantesBrasil(m.de?.valor));
    const permitido = !canal.modo_teste || (m.de?.tipo === 'telefone' && lista.some(n => variantes.has(telefone.normalizar(n))));
    const agora = new Date().toISOString();
    if (!permitido) {
      this.db.prepare('UPDATE canais SET recebidas_descartadas = recebidas_descartadas + 1, ultima_mensagem_em = ? WHERE id = ?').run(agora, canalId);
      this.descartadas.set(canalId, (this.descartadas.get(canalId) || 0) + 1);
      return;
    }
    this.db.prepare('UPDATE canais SET ultima_mensagem_em = ? WHERE id = ?').run(agora, canalId);
    const previa = String(m.texto || '').replace(/\s+/g, ' ').slice(0, 80);
    this._log(canalId, 'received', `Mensagem (${m.tipo}) recebida de ${telefone.mascarar(m.de.valor)}${previa ? `: "${previa}"` : ''}`);
    this.emitir(canalId, 'canal:mensagem', { canal_id: canalId, de_mascarado: telefone.mascarar(m.de.valor), tipo: m.tipo, em: m.em });
  }

  _resumirDescartadas() {
    for (const [canalId, n] of this.descartadas) {
      if (n > 0) this._log(canalId, 'system', `Modo de teste: ${n} mensagem(ns) de outros números ignorada(s) (conteúdo não gravado).`);
    }
    this.descartadas.clear();
  }

  // ── Ciclo de vida dos filhos ─────────────────────────────────────────────
  iniciar(canalId) {
    if (this.filhos.has(canalId)) return true;
    const canal = this.db.prepare('SELECT id, sessao_id, provedor FROM canais WHERE id = ?').get(canalId);
    if (!canal) return false;
    const ficha = this._pegarConcessao(canalId);
    if (ficha === null) {
      this._log(canalId, 'warning', 'Este canal já está conectado em outro processo do IA Talk. Nada foi feito.');
      return false;
    }
    const proc = fork(path.join(__dirname, 'runner.js'), [], { env: { ...process.env, ...this.envFilho }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const f = { proc, ficha, encerrando: false };
    this.filhos.set(canalId, f);
    proc.on('message', (m) => this._doFilho(canalId, m));
    proc.on('exit', (codigo) => this._saiu(canalId, f, codigo));
    proc.send({ cmd: 'iniciar', canal, dirSessoes: this.dirSessoes });
    return true;
  }

  _doFilho(canalId, { evento, dados = {} }) {
    if (evento === 'estado') {
      if (dados.estado === 'conectado') this.tentativas.delete(canalId);
      this._mudarEstado(canalId, dados.estado, dados.detalhe || null);
    } else if (evento === 'qr') {
      this.qrs.set(canalId, dados);
      this.emitir(canalId, 'canal:qr', { canal_id: canalId, ...dados });
    } else if (evento === 'identidade' && dados.numero) {
      this.db.prepare('UPDATE canais SET numero = ? WHERE id = ?').run(dados.numero, canalId);
      this._log(canalId, 'success', `Número conectado: ${telefone.mascarar(dados.numero)}.`);
    } else if (evento === 'mensagem') {
      this._receber(canalId, dados);
    } else if (evento === 'log') {
      this._log(canalId, dados.tipo || 'info', dados.mensagem);
    } else if (evento === 'enviado') {
      const p = this.pendentesEnvio.get(dados.id);
      if (p) { this.pendentesEnvio.delete(dados.id); clearTimeout(p.timer); p.resolver(dados); }
    } else if (evento === 'erro') {
      this._log(canalId, 'error', dados.mensagem || 'Erro no processo do canal.');
    }
  }

  _saiu(canalId, f, codigo) {
    if (this.filhos.get(canalId) === f) this.filhos.delete(canalId);
    this._devolverConcessao(canalId);
    if (f.encerrando) return;
    const canal = this.db.prepare('SELECT ligado FROM canais WHERE id = ?').get(canalId);
    if (!canal?.ligado) return;
    const n = (this.tentativas.get(canalId) || 0) + 1;
    this.tentativas.set(canalId, n);
    if (n > this.esperas.length) {
      this._mudarEstado(canalId, 'erro', `O processo do canal caiu ${n - 1} vezes seguidas. Verifique e clique em Reconectar.`);
      return;
    }
    const espera = this.esperas[n - 1];
    this._mudarEstado(canalId, 'reconectando', `O processo do canal encerrou (código ${codigo}). Nova tentativa em ${Math.round(espera / 1000)} s.`);
    const t = setTimeout(() => {
      const atual = this.db.prepare('SELECT ligado FROM canais WHERE id = ?').get(canalId);
      if (atual?.ligado) this.iniciar(canalId);
    }, espera);
    t.unref?.();
  }

  _encerrarFilho(canalId, cmd = 'parar') {
    const f = this.filhos.get(canalId);
    if (!f) return Promise.resolve(false);
    f.encerrando = true;
    return new Promise((resolve) => {
      const forcar = setTimeout(() => { try { f.proc.kill(); } catch (_) { /* já saiu */ } }, 15_000);
      f.proc.once('exit', () => { clearTimeout(forcar); resolve(true); });
      try { f.proc.send({ cmd }); } catch (_) { f.proc.kill(); }
    });
  }

  async parar(canalId) {
    const tinha = await this._encerrarFilho(canalId);
    if (!tinha) this._mudarEstado(canalId, 'parado');
  }

  async reiniciar(canalId) {
    await this._encerrarFilho(canalId);
    this.tentativas.delete(canalId);
    this._mudarEstado(canalId, 'reconectando', 'Reconexão pedida pelo usuário.');
    this.iniciar(canalId);
  }

  // Apaga a sessão do Talk (não toca na do IA Command). Sobe um filho só para isso se preciso.
  async limparSessao(canalId) {
    if (this.filhos.has(canalId)) await this._encerrarFilho(canalId, 'limpar-sessao');
    const canal = this.db.prepare('SELECT sessao_id FROM canais WHERE id = ?').get(canalId);
    if (canal) require('fs').rmSync(path.join(this.dirSessoes, `session-${canal.sessao_id}`), { recursive: true, force: true });
    this.qrs.delete(canalId);
    this._mudarEstado(canalId, 'parado', 'Sessão limpa. Conecte de novo para gerar um QR Code.');
  }

  enviar(canalId, envelope, { tempoMs = 60_000 } = {}) {
    const f = this.filhos.get(canalId);
    if (!f) return Promise.resolve({ ok: false, tipo: 'temporario', codigo: 'canal_desconectado', mensagem: 'Canal não está conectado.' });
    const id = crypto.randomUUID();
    return new Promise((resolver) => {
      const timer = setTimeout(() => {
        this.pendentesEnvio.delete(id);
        resolver({ ok: false, tipo: 'desconhecido', codigo: 'sem_resposta', mensagem: 'O canal não respondeu a tempo; o envio pode ou não ter saído.' });
      }, tempoMs);
      this.pendentesEnvio.set(id, { resolver, timer });
      f.proc.send({ cmd: 'enviar', id, envelope: { ...envelope, arquivo: envelope.arquivo ? { ...envelope.arquivo, dados: undefined, base64: envelope.arquivo.dados.toString('base64') } : undefined } });
    });
  }

  qrAtual(canalId) { return this.qrs.get(canalId) || null; }

  // Só para testes automáticos (provedor simulado).
  _comandoTeste(canalId, cmd, dados) { this.filhos.get(canalId)?.proc.send({ cmd, dados }); }

  // ── Início e fim do serviço ──────────────────────────────────────────────
  iniciarTodos() {
    for (const c of this.db.prepare('SELECT id FROM canais WHERE ligado = 1').all()) this.iniciar(c.id);
    this._timers.push(setInterval(() => this._renovarConcessoes(), RENOVAR_MS), setInterval(() => this._resumirDescartadas(), RESUMO_DESCARTADAS_MS));
    this._timers.forEach(t => t.unref?.());
  }

  async pararTodos() {
    this._timers.forEach(clearInterval);
    this._resumirDescartadas();
    await Promise.all([...this.filhos.keys()].map(id => this._encerrarFilho(id)));
  }
}

module.exports = { SupervisorCanais, CONCESSAO_MS };

'use strict';

// Despachante da fila de saída (C3). Roda no processo principal do Talk, ao lado
// do supervisor, e só despacha canais cujo processo do WhatsApp está neste
// processo (a concessão do supervisor garante um único dono por número).
//
// Boas práticas de mensageria aplicadas:
//  - outbox: a mensagem já está no banco antes de sair; "encaminhada" é gravada
//    ANTES de entregar ao WhatsApp — se o Talk cair no meio, ao voltar ela vira
//    "desconhecida" (pode ou não ter saído) e NUNCA é reenviada sozinha;
//  - uma mensagem por vez por canal, com intervalo mínimo e variação aleatória
//    (ritmo humano: reduz o risco de o WhatsApp bloquear o número);
//  - erro temporário: nova tentativa com espera crescente; permanente: falhou;
//    desconhecido: "desconhecida" (decisão manual na tela);
//  - recibos do WhatsApp (enviada/entregue/lida) só valem para mensagens deste
//    canal enviadas pelo Talk — o mesmo número também é usado pelo IA Command;
//  - o Talk só envia o que foi pedido (API ou teste na tela): nunca responde sozinho.

const repo = require('./repositorio');
const telefone = require('../seguranca/telefone');
const regras = require('../canais/regras');
const { agora } = require('../ids');

const TICK_MS = 1_000;
const INTERVALO_MINIMO_MS = 3_000;   // entre duas mensagens do mesmo canal
const VARIACAO_MS = 2_000;           // + 0 a 2 s aleatórios
const ESPERAS_NOVA_TENTATIVA_MS = [30_000, 120_000, 600_000, 1_800_000];
const VALIDADE_FILA_MS = 24 * 60 * 60 * 1000; // não sai em 24 h → falhou
const RECIBO_ORFAO_MS = 60_000;      // recibo que chega antes do id do provedor ser gravado

class Despachante {
  constructor({ db, supervisor, emitir = () => {}, intervaloMinimoMs = INTERVALO_MINIMO_MS, variacaoMs = VARIACAO_MS,
    esperas = ESPERAS_NOVA_TENTATIVA_MS, validadeFilaMs = VALIDADE_FILA_MS, tickMs = TICK_MS } = {}) {
    this.db = db;
    this.supervisor = supervisor;
    this.emitir = emitir; // (canalId, evento, dados, { empresaId })
    this.intervaloMinimoMs = intervaloMinimoMs;
    this.variacaoMs = variacaoMs;
    this.esperas = esperas;
    this.validadeFilaMs = validadeFilaMs;
    this.tickMs = tickMs;
    this.ocupados = new Set();        // canais com um envio em andamento
    this.liberadoEm = new Map();      // canalId -> ms a partir do qual pode enviar a próxima
    this.recibosOrfaos = new Map();   // `${canal}|${idProvedor}` -> [{ estado, em, ate }]
    this.timer = null;
    supervisor.aoStatus = (canalId, dados) => this.aoRecibo(canalId, dados);
  }

  iniciar() {
    this._recuperarAposQueda();
    this.timer = setInterval(() => this.acordar(), this.tickMs);
    this.timer.unref?.();
  }

  parar() { clearInterval(this.timer); this.timer = null; }

  // Talk caiu durante um envio: não dá para saber se saiu. Nunca reenvia sozinho.
  _recuperarAposQueda() {
    const presas = this.db.prepare("SELECT id, empresa_id, canal_id FROM mensagens WHERE estado = 'encaminhada' AND id_provedor IS NULL").all();
    for (const m of presas) {
      this._mudar(m, 'desconhecida', { detalhe: 'O IA Talk reiniciou durante o envio: não dá para saber se a mensagem saiu. Confira com o destinatário e reenvie se precisar.' });
    }
  }

  _mudar(m, estado, opcoes = {}) {
    const nova = repo.mudarEstado(this.db, m.id, estado, opcoes);
    if (nova) this.avisar(nova);
    return nova;
  }

  // Avisa as telas (sala do canal e painel da empresa dona da mensagem).
  avisar(m) {
    this.emitir(m.canal_id, 'mensagem:estado', { id: m.id, estado: m.estado, em: m.atualizada_em }, { empresaId: m.empresa_id });
  }

  // Chamado a cada segundo e logo depois de uma mensagem nova entrar na fila.
  acordar() {
    const canais = this.db.prepare(`SELECT DISTINCT c.id, c.estado, c.envio_modo, c.ligado FROM mensagens m JOIN canais c ON c.id = m.canal_id
        WHERE m.estado IN ('aceita', 'aguardando')`).all();
    for (const c of canais) this._cuidarDoCanal(c).catch(() => { /* registrado no próprio envio */ });
  }

  async _cuidarDoCanal(c) {
    this._expirarAntigas(c.id);
    if (this.ocupados.has(c.id)) return;
    const ligado = c.envio_modo !== 'desligado';
    const pronto = c.estado === 'conectado' && ligado && this.supervisor.filhos?.has(c.id);
    if (!pronto) {
      // Aceitas esperando o canal: passam a "aguardando" (a tela mostra que estão na fila).
      for (const m of this.db.prepare("SELECT id, empresa_id, canal_id FROM mensagens WHERE canal_id = ? AND estado = 'aceita'").all(c.id)) {
        this._mudar(m, 'aguardando', { detalhe: ligado ? 'Aguardando o canal conectar.' : 'Aguardando o envio ser ligado neste canal.' });
      }
      return;
    }
    if (Date.now() < (this.liberadoEm.get(c.id) || 0)) return;
    const m = repo.proximaDaFila(this.db, c.id);
    if (!m) return;
    this.ocupados.add(c.id);
    try {
      await this._enviar(c.id, m);
    } finally {
      this.ocupados.delete(c.id);
      this.liberadoEm.set(c.id, Date.now() + this.intervaloMinimoMs + Math.floor(Math.random() * this.variacaoMs));
    }
  }

  _expirarAntigas(canalId) {
    const limite = new Date(Date.now() - this.validadeFilaMs).toISOString();
    const velhas = this.db.prepare("SELECT id, empresa_id, canal_id FROM mensagens WHERE canal_id = ? AND estado IN ('aceita', 'aguardando') AND criada_em < ?").all(canalId, limite);
    for (const m of velhas) this._mudar(m, 'falhou', { detalhe: 'Não foi enviada em 24 h (canal desconectado ou envio desligado). Envie de novo se ainda fizer sentido.' });
  }

  async _enviar(canalId, m) {
    // Regra de envio conferida de novo na hora de sair (regra ou lista podem ter mudado).
    const canal = this.db.prepare('SELECT envio_modo, numeros_teste FROM canais WHERE id = ?').get(canalId);
    if (!regras.podeEnviarPara(canal, m.destino)) {
      this._mudar(m, 'falhou', { detalhe: 'Envio só para números de teste: o destino não está (mais) na lista.' });
      return;
    }
    const encaminhada = this._mudar(m, 'encaminhada', { campos: { tentativas: m.tentativas + 1 }, detalhe: m.tentativas ? `Tentativa ${m.tentativas + 1}.` : null });
    if (!encaminhada) return;
    const r = await this.supervisor.enviar(canalId, { id: m.id, destinatario: { tipo: 'telefone', valor: m.destino }, tipo: m.tipo, texto: m.conteudo });
    const origem = m.origem === 'teste_tela' ? ' (teste pela tela)' : '';
    if (r.ok) {
      this.db.prepare('UPDATE mensagens SET id_provedor = ?, ultimo_erro = NULL WHERE id = ?').run(r.id_provedor || null, m.id);
      this.supervisor.log?.(canalId, 'sent', `Mensagem (${m.tipo}) enviada para ${telefone.mascarar(m.destino)}${origem}.`);
      if (r.id_provedor) this._aplicarRecibosOrfaos(canalId, r.id_provedor, m);
      return;
    }
    const detalhe = r.mensagem || 'Falha no envio.';
    this.db.prepare('UPDATE mensagens SET ultimo_erro = ? WHERE id = ?').run(detalhe, m.id);
    if (r.tipo === 'temporario' && m.tentativas < this.esperas.length) {
      const espera = this.esperas[m.tentativas];
      this._mudar(m, 'aguardando', { nova_tentativa: true, detalhe: `${detalhe} Nova tentativa em ${Math.round(espera / 1000)} s.`,
        campos: { proxima_tentativa_em: new Date(Date.now() + espera).toISOString() } });
      this.supervisor.log?.(canalId, 'warning', `Envio para ${telefone.mascarar(m.destino)} adiado: ${detalhe}`);
    } else if (r.tipo === 'desconhecido') {
      this._mudar(m, 'desconhecida', { detalhe: `${detalhe} Não será reenviada automaticamente.` });
      this.supervisor.log?.(canalId, 'warning', `Envio para ${telefone.mascarar(m.destino)} sem confirmação: ${detalhe}`);
    } else {
      const esgotou = r.tipo === 'temporario' ? ` Esgotou ${m.tentativas + 1} tentativa(s).` : '';
      this._mudar(m, 'falhou', { detalhe: `${detalhe}${esgotou}` });
      this.supervisor.log?.(canalId, 'error', `Envio para ${telefone.mascarar(m.destino)} falhou: ${detalhe}`);
    }
  }

  // Recibo do WhatsApp (ack). Só mensagens enviadas pelo Talk neste canal.
  aoRecibo(canalId, { id_provedor: idProvedor, estado, em } = {}) {
    if (!idProvedor || !estado) return;
    const m = repo.porIdProvedor(this.db, canalId, idProvedor);
    if (!m) {
      // Pode ter chegado antes de o id ser gravado; guarda por 1 min. Senão é de outro sistema no mesmo número.
      const chave = `${canalId}|${idProvedor}`;
      const lista = (this.recibosOrfaos.get(chave) || []).concat({ estado, em, ate: Date.now() + RECIBO_ORFAO_MS });
      this.recibosOrfaos.set(chave, lista);
      if (this.recibosOrfaos.size > 1000) this._limparOrfaos();
      return;
    }
    this._mudar(m, estado, { em: em || agora(), detalhe: estado === 'falhou' ? 'O WhatsApp recusou a mensagem.' : null });
  }

  _aplicarRecibosOrfaos(canalId, idProvedor, m) {
    const chave = `${canalId}|${idProvedor}`;
    const lista = this.recibosOrfaos.get(chave);
    if (!lista) return;
    this.recibosOrfaos.delete(chave);
    for (const r of lista) this._mudar(m, r.estado, { em: r.em || agora() });
  }

  _limparOrfaos() {
    const agoraMs = Date.now();
    for (const [chave, lista] of this.recibosOrfaos) if (lista.every(r => r.ate < agoraMs)) this.recibosOrfaos.delete(chave);
  }
}

module.exports = { Despachante, INTERVALO_MINIMO_MS, ESPERAS_NOVA_TENTATIVA_MS, VALIDADE_FILA_MS };

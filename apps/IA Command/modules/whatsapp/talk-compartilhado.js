'use strict';

// IA Talk — número compartilhado (C9, parte 2). O mesmo número de WhatsApp atende:
//   - o assistente do ERP, para quem é autorizado (como sempre);
//   - o atendimento humano do IA Talk, para quem não é autorizado e para o autorizado
//     que pede "atendente" (até o Talk encerrar ou passarem 4 h sem mensagem).
// Tudo depende da chave do canal whatsapp_channels.repassar_nao_autorizados_talk, que
// nasce DESLIGADA (0): com ela desligada nada aqui muda o comportamento do IA Command.
//
// Regra de segurança: na dúvida o IA Command responde como sempre. Nunca fica mudo por
// defeito. Ele só deixa uma mensagem para o Talk quando, ao mesmo tempo:
//   - a chave do canal está ligada;
//   - o telefone foi resolvido (@c.us): com o código interno do WhatsApp (@lid) o Talk
//     poderia não reconhecer a pessoa;
//   - o Talk deu sinal de vida há pouco (talk_batimento_em, a cada minuto): Talk parado
//     = ninguém atenderia;
//   - e o Talk deu RECIBO desta mensagem (talk_recibos_mensagem, gravado depois de persistir a
//     mensagem). Sem recibo em até 8 s, o IA Command responde como sempre:
//     o sinal de vida não prova que a mensagem chegou (Talk caiu agora, lista de teste…);
//   - e qualquer erro aqui devolve "seguir normal".

const channelStore = require('./channel-store');

const db = () => require('../database').getDB();

const VALIDADE_MS = 4 * 60 * 60 * 1000;
const BATIMENTO_MS = 3 * 60 * 1000;
const RECIBO_ESPERA_MS = 8000;
const RECIBO_PASSO_MS = 400;
// Decisão "assistente" de quem não é autorizado, sem resposta enviada: depois disto o Talk pode assumir.
const RETOMADA_MS = 3 * 60 * 1000;
// Tentativas de gravar o dono quando o banco está ocupado ou falha (além do busy_timeout do SQLite).
const ESPERAS_DONO_MS = [0, 300, 700];
// Palavras fixas (não passam pela IA): a mensagem inteira precisa ser uma delas.
const GATILHOS = new Set([
  'atendente', 'atendimento', 'humano',
  'falar com atendente', 'falar com um atendente', 'falar com o atendente',
  'falar com humano', 'falar com uma pessoa', 'falar com alguem',
  'quero falar com atendente', 'quero falar com um atendente', 'quero falar com uma pessoa',
]);
const VOLTAR = new Set(['voltar ao assistente', 'voltar para o assistente', 'voltar assistente']);
const TEXTOS = Object.freeze({
  passar: 'Certo! Vou te passar para o atendimento. Uma pessoa da equipe vai responder por aqui.\nPara voltar ao assistente, escreva *voltar ao assistente*.',
  voltar: 'Pronto, o assistente voltou. Pode perguntar.',
  indisponivel: 'O atendimento com a equipe não está disponível agora. O assistente continua por aqui; tente de novo em alguns minutos.',
});

function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const pedeAtendimento = (texto) => GATILHOS.has(normalizarTexto(texto));

const telefoneResolvido = (sender) => /^\d{10,15}@c\.us$/.test(String(sender || ''));
const digitos = (sender) => String(sender || '').split('@')[0].replace(/\D/g, '');

function _canal(channelId) {
  if (!channelId) return null;
  return db().prepare('SELECT repassar_nao_autorizados_talk AS chave, talk_batimento_em AS batimento FROM whatsapp_channels WHERE id = ?').get(String(channelId)) || null;
}
const chaveLigada = (c) => Number(c?.chave) === 1;
const talkVivo = (c, agoraMs = Date.now()) => !!c?.batimento && agoraMs - Date.parse(c.batimento) <= BATIMENTO_MS;
function chaveAtiva(channelId) { try { return chaveLigada(_canal(channelId)); } catch (_) { return false; } }

function _linha(channelId, numero) {
  const variantes = channelStore.variantesNumeroBrasil(numero);
  if (!variantes.length) return null;
  return db().prepare(`SELECT channel_id, numero, ultima_atividade_em FROM talk_atendimentos
      WHERE channel_id = ? AND numero IN (${variantes.map(() => '?').join(', ')})`).get(String(channelId), ...variantes) || null;
}

// Em atendimento no Talk e ainda dentro das 4 h sem mensagem (vencido = apaga e volta ao assistente).
function emAtendimento(channelId, numero, agoraMs = Date.now()) {
  const l = _linha(channelId, numero);
  if (!l) return false;
  if (agoraMs - Date.parse(l.ultima_atividade_em) > VALIDADE_MS) {
    encerrar(channelId, numero);
    return false;
  }
  return true;
}

function iniciar(channelId, numero, agoraMs = Date.now()) {
  const t = new Date(agoraMs).toISOString();
  db().prepare(`INSERT INTO talk_atendimentos (channel_id, numero, iniciado_em, ultima_atividade_em) VALUES (?, ?, ?, ?)
      ON CONFLICT (channel_id, numero) DO UPDATE SET ultima_atividade_em = excluded.ultima_atividade_em`).run(String(channelId), numero, t, t);
}

function tocar(channelId, numero, agoraMs = Date.now()) {
  const l = _linha(channelId, numero);
  if (l) db().prepare('UPDATE talk_atendimentos SET ultima_atividade_em = ? WHERE channel_id = ? AND numero = ?').run(new Date(agoraMs).toISOString(), l.channel_id, l.numero);
}

function encerrar(channelId, numero) {
  const variantes = channelStore.variantesNumeroBrasil(numero);
  if (!variantes.length) return 0;
  return db().prepare(`DELETE FROM talk_atendimentos WHERE channel_id = ? AND numero IN (${variantes.map(() => '?').join(', ')})`)
    .run(String(channelId), ...variantes).changes;
}

// ── Usado na entrada da mensagem (service.js _handleMessage) ────────────────
// Quem NÃO é autorizado: true = ficar em silêncio (o atendimento do Talk responde).
function repassarNaoAutorizado(channelId, sender, agoraMs = Date.now()) {
  try {
    if (!telefoneResolvido(sender)) return false;
    const c = _canal(channelId);
    return chaveLigada(c) && talkVivo(c, agoraMs);
  } catch (_) {
    return false;
  }
}

// Quem É autorizado: null = seguir normal (assistente). Senão { resposta, motivo, desfazer }:
// resposta = texto fixo para mandar (ou null = silêncio, a mensagem fica com o atendente);
// desfazer = a passagem foi feita agora e deve ser desfeita se o aviso não puder ser enviado.
function desvioAutorizado(channelId, sender, texto, agoraMs = Date.now()) {
  try {
    if (!telefoneResolvido(sender)) return null;
    const c = _canal(channelId);
    if (!chaveLigada(c)) return null;
    const numero = digitos(sender);
    const t = normalizarTexto(texto);
    if (emAtendimento(channelId, numero, agoraMs)) {
      // Talk parado no meio do atendimento: a pessoa volta para o assistente (ninguém responderia).
      if (!talkVivo(c, agoraMs)) { encerrar(channelId, numero); return null; }
      if (VOLTAR.has(t)) {
        encerrar(channelId, numero);
        db().prepare('INSERT OR REPLACE INTO talk_retorno_assistente (channel_id, numero, em) VALUES (?, ?, ?)').run(String(channelId), numero, new Date(agoraMs).toISOString());
        return { resposta: TEXTOS.voltar, motivo: 'voltou ao assistente' };
      }
      tocar(channelId, numero, agoraMs);
      // Já em atendimento (inclusive marcado pelo Talk, que recebeu a cópia primeiro): o aviso de
      // passagem sai do mesmo jeito, mas uma falha nele NÃO desfaz o atendimento que já existia.
      if (GATILHOS.has(t)) return { resposta: TEXTOS.passar, motivo: 'pediu atendimento', desfazer: false };
      // Silêncio só com o recibo do Talk (quem chama espera por ele; sem recibo, assistente).
      return { resposta: null, motivo: 'em atendimento no IA Talk', aguardarRecibo: true };
    }
    if (GATILHOS.has(t)) {
      if (!talkVivo(c, agoraMs)) return { resposta: TEXTOS.indisponivel, motivo: 'pediu atendimento, mas o IA Talk está fora do ar' };
      iniciar(channelId, numero, agoraMs);
      return { resposta: TEXTOS.passar, motivo: 'pediu atendimento', desfazer: true };
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Aguarda a decisão da mensagem identificada pelo provedor.
let esperaReciboMs = RECIBO_ESPERA_MS; // os testes encurtam
function numeroDaDecisao(sender) {
  const variantes = channelStore.variantesNumeroBrasil(digitos(sender));
  return variantes.find(v => v.startsWith('55') && v.length === 12) || variantes[0] || '';
}

function escolherDono(channelId, sender, mensagemId, desejado, { naoAutorizado = false } = {}) {
  const numero = numeroDaDecisao(sender);
  if (!channelId || !numero || !mensagemId || !['talk', 'assistente'].includes(desejado)) return null;
  const banco = db();
  return banco.transaction(() => {
    banco.prepare('INSERT OR IGNORE INTO talk_decisoes_mensagem (channel_id, numero, mensagem_id, dono, criado_em, nao_autorizado) VALUES (?, ?, ?, ?, ?, ?)')
      .run(String(channelId), numero, String(mensagemId), desejado, new Date().toISOString(), naoAutorizado ? 1 : 0);
    return banco.prepare('SELECT dono FROM talk_decisoes_mensagem WHERE channel_id = ? AND numero = ? AND mensagem_id = ?')
      .get(String(channelId), numero, String(mensagemId))?.dono || null;
  })();
}

// Grava o dono com novas tentativas (banco ocupado/falha passageira). { dono } ou { dono: null, erro }.
// Sem conseguir gravar, quem chama responde como sempre (nunca fica mudo) e registra o erro: é o único
// caso em que a mesma mensagem pode ser atendida pelos dois (falha de banco; nunca mensagem perdida).
async function registrarDono(channelId, sender, mensagemId, desejado, opcoes = {}) {
  let erro = null;
  for (const espera of ESPERAS_DONO_MS) {
    if (espera) await new Promise(r => setTimeout(r, espera));
    try {
      const dono = escolherDono(channelId, sender, mensagemId, desejado, opcoes);
      if (dono) return { dono };
    } catch (e) { erro = e; }
  }
  return { dono: null, erro: erro || new Error('decisão não gravada') };
}

// A resposta do assistente a quem não é autorizado saiu: o Talk não assume mais esta mensagem.
function marcarRespondida(channelId, sender, mensagemId) {
  try {
    const numero = numeroDaDecisao(sender);
    if (!numero || !mensagemId) return false;
    return db().prepare(`UPDATE talk_decisoes_mensagem SET respondida_em = ? WHERE channel_id = ? AND numero = ? AND mensagem_id = ?
        AND dono = 'assistente' AND respondida_em IS NULL`).run(new Date().toISOString(), String(channelId), numero, String(mensagemId)).changes > 0;
  } catch (_) { return false; }
}

async function aguardarRecibo(channelId, sender, mensagemId, { esperaMs = esperaReciboMs, passoMs = RECIBO_PASSO_MS, naoAutorizado = false, aoFalhar = null } = {}) {
  try {
    const numero = numeroDaDecisao(sender);
    if (!numero || !mensagemId) return false;
    const consulta = db().prepare('SELECT dono FROM talk_decisoes_mensagem WHERE channel_id = ? AND numero = ? AND mensagem_id = ?');
    const fim = Date.now() + esperaMs;
    for (;;) {
      const dono = consulta.get(String(channelId), numero, String(mensagemId))?.dono;
      if (dono) return dono === 'talk';
      if (Date.now() >= fim) {
        const r = await registrarDono(channelId, sender, mensagemId, 'assistente', { naoAutorizado });
        if (!r.dono && aoFalhar) aoFalhar(r.erro);
        return r.dono === 'talk';
      }
      await new Promise(r => setTimeout(r, passoMs));
    }
  } catch (_) { return false; }
}

// O aviso de passagem não saiu: desfaz, e a pessoa continua com o assistente.
function desfazerPassagem(channelId, sender) {
  try { return encerrar(channelId, digitos(sender)); } catch (_) { return 0; }
}

// ── Usado pelas rotas internas que o IA Talk chama (servico-externo-routes.js) ──
function canalPorNumero(numeroCanal) {
  const variantes = channelStore.variantesNumeroBrasil(numeroCanal);
  if (!variantes.length) return null;
  return db().prepare(`SELECT id, repassar_nao_autorizados_talk AS chave, talk_batimento_em AS batimento FROM whatsapp_channels
      WHERE ativo = 1 AND numero IN (${variantes.map(() => '?').join(', ')}) ORDER BY criado_em LIMIT 1`).get(...variantes) || null;
}

function _estado(canal, numero, agoraMs) {
  const autorizado = channelStore.listarEmpresasDoCanal(canal.id).some(e => channelStore.senderAutorizadoEmpresa(e.empresa_id, numero));
  return { canal_encontrado: true, repassar_ligado: chaveLigada(canal), autorizado, em_atendimento: emAtendimento(canal.id, digitos(numero), agoraMs) };
}

// Uma decisão só, tomada aqui, para cada mensagem que o Talk recebeu no número compartilhado.
// Vale nas duas ordens de chegada (o Talk pode receber a cópia antes ou depois do IA Command):
// se a pessoa autorizada pediu atendimento, a passagem é marcada aqui mesmo.
function mensagemNoTalk(numeroCanal, numero, texto, { recibo = true, agoraMs = Date.now(), mensagemEm = null } = {}) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, repassar_ligado: false, autorizado: false, em_atendimento: false };
  const e = _estado(canal, numero, agoraMs);
  if (recibo && e.repassar_ligado && e.autorizado && !e.em_atendimento && pedeAtendimento(texto) && talkVivo(canal, agoraMs)) {
    e.em_atendimento = true;
  }
  return e;
}

function decidirMensagem(numeroCanal, numero, mensagemId, texto) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, repassar_ligado: false, dono: null };
  if (!chaveLigada(canal)) return { canal_encontrado: true, repassar_ligado: false, dono: null };
  const estado = mensagemNoTalk(numeroCanal, numero, texto);
  const desejado = VOLTAR.has(normalizarTexto(texto)) ? 'assistente' : (!estado.autorizado || estado.em_atendimento ? 'talk' : 'assistente');
  let dono = escolherDono(canal.id, numero, mensagemId, desejado, { naoAutorizado: !estado.autorizado });
  if (dono === 'talk' && estado.autorizado && !emAtendimento(canal.id, digitos(numero)) && pedeAtendimento(texto)) iniciar(canal.id, digitos(numero));
  // O assistente ficou com a mensagem de quem NÃO é autorizado e ainda não respondeu: o Talk espera
  // (aguardar) e, passados alguns minutos sem resposta (IA Command caiu), assume — essa pessoa só
  // receberia o aviso de "não autorizado". Pergunta de usuário do ERP nunca é assumida pelo Talk.
  if (dono === 'assistente') {
    const d = db().prepare('SELECT nao_autorizado, respondida_em, criado_em FROM talk_decisoes_mensagem WHERE channel_id = ? AND numero = ? AND mensagem_id = ?')
      .get(canal.id, numeroDaDecisao(numero), String(mensagemId));
    if (d && Number(d.nao_autorizado) === 1 && !d.respondida_em) {
      if (Date.now() - Date.parse(d.criado_em) < RETOMADA_MS) return { canal_encontrado: true, repassar_ligado: true, dono, aguardar: true };
      const r = db().prepare(`UPDATE talk_decisoes_mensagem SET dono = 'talk' WHERE channel_id = ? AND numero = ? AND mensagem_id = ?
          AND dono = 'assistente' AND respondida_em IS NULL`).run(canal.id, numeroDaDecisao(numero), String(mensagemId));
      if (r.changes) dono = 'talk';
      return { canal_encontrado: true, repassar_ligado: true, dono, retomada: dono === 'talk' };
    }
  }
  return { canal_encontrado: true, repassar_ligado: true, dono };
}

function estadoDoNumero(numeroCanal, numero, agoraMs = Date.now()) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, repassar_ligado: false, autorizado: false, em_atendimento: false };
  return _estado(canal, numero, agoraMs);
}

// "Estou vivo" do Talk para este número (a cada minuto, só com o canal conectado lá).
function registrarBatimento(numeroCanal, agoraMs = Date.now()) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, repassar_ligado: false };
  db().prepare('UPDATE whatsapp_channels SET talk_batimento_em = ? WHERE id = ?').run(new Date(agoraMs).toISOString(), canal.id);
  return { canal_encontrado: true, repassar_ligado: chaveLigada(canal) };
}

// O IA Talk abriu ou respondeu uma conversa (chamado do sistema de origem, resposta do atendente):
// se a pessoa é autorizada aqui, a resposta dela precisa ir para o atendente, não para o assistente.
function iniciarPorNumero(numeroCanal, numero, agoraMs = Date.now(), atividadeEm = null, reconciliacao = false) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, repassar_ligado: false };
  // Chave desligada: não grava nada (senão ligar a chave depois desviaria esta pessoa sem ela pedir).
  if (!chaveLigada(canal)) return { canal_encontrado: true, repassar_ligado: false };
  const variantes = channelStore.variantesNumeroBrasil(numero);
  const retorno = variantes.length && db().prepare(`SELECT em FROM talk_retorno_assistente WHERE channel_id = ? AND numero IN (${variantes.map(() => '?').join(', ')}) ORDER BY em DESC LIMIT 1`).get(canal.id, ...variantes);
  const atividade = atividadeEm ? Date.parse(atividadeEm) : agoraMs;
  if (!Number.isFinite(atividade) || (retorno && (reconciliacao || Date.parse(retorno.em) >= atividade))) return { canal_encontrado: true, repassar_ligado: true, ignorado: true };
  if (retorno && !reconciliacao) db().prepare(`DELETE FROM talk_retorno_assistente WHERE channel_id = ? AND numero IN (${variantes.map(() => '?').join(', ')})`).run(canal.id, ...variantes);
  const existente = _linha(canal.id, numero);
  if (!existente || Date.parse(existente.ultima_atividade_em) < atividade) iniciar(canal.id, existente?.numero || digitos(numero), atividade);
  return { canal_encontrado: true, repassar_ligado: true };
}

// O IA Talk encerrou a conversa: a pessoa volta para o assistente.
function encerrarPorNumero(numeroCanal, numero) {
  const canal = canalPorNumero(numeroCanal);
  if (!canal) return { canal_encontrado: false, encerrados: 0 };
  return { canal_encontrado: true, encerrados: encerrar(canal.id, digitos(numero)) };
}

module.exports = {
  VALIDADE_MS, BATIMENTO_MS, TEXTOS, normalizarTexto, pedeAtendimento,
  repassarNaoAutorizado, desvioAutorizado, desfazerPassagem, aguardarRecibo, escolherDono, registrarDono, marcarRespondida, chaveAtiva, RETOMADA_MS,
  mensagemNoTalk, decidirMensagem, estadoDoNumero, registrarBatimento, iniciarPorNumero, encerrarPorNumero,
  _test: { emAtendimento, iniciar, encerrar, canalPorNumero, definirEsperaRecibo: (ms) => { esperaReciboMs = ms; } },
};

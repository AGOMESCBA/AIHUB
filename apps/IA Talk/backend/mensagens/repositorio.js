'use strict';

// Mensagens de saída (C3). Contrato: docs/contratos.md §2 (estados), §4/§5 (tela) e §6 (API v1).
// Regras de estado num ponto só (fila, recibos do WhatsApp e ações manuais):
//  - o estado só avança (recibo atrasado não faz "lida" voltar para "entregue");
//  - "desconhecida" nunca é reenviada sozinha, mas um recibo do WhatsApp (prova de
//    que saiu) a corrige para enviada/entregue/lida;
//  - "lida" e "falhou" são finais (falhou só reabre por reenvio manual).

const { novoId, agora } = require('../ids');
const telefone = require('../seguranca/telefone');

const ORDEM = Object.freeze({ aceita: 0, aguardando: 1, encaminhada: 2, enviada: 3, entregue: 4, lida: 5 });
const PROVA_DE_ENVIO = new Set(['enviada', 'entregue', 'lida']);

function podeIr(atual, novo, { nova_tentativa = false } = {}) {
  if (atual === novo) return false;
  if (atual === 'lida' || atual === 'falhou') return false;
  if (atual === 'desconhecida') return PROVA_DE_ENVIO.has(novo) || novo === 'falhou';
  if (novo === 'falhou' || novo === 'desconhecida') return true;
  // Erro temporário: volta para a fila (aguardando) para tentar de novo.
  if (nova_tentativa && novo === 'aguardando' && atual === 'encaminhada') return true;
  return ORDEM[novo] > ORDEM[atual];
}

const previaDe = (texto) => String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 80);

function criar(db, { empresaId, canalId, aplicacaoId = null, usuarioId = null, origem, destino, tipo = 'texto', conteudo, correlacaoId = null, metadados = {}, detalhe = null }) {
  const id = novoId('mensagem');
  const t = agora();
  db.prepare(`INSERT INTO mensagens (id, empresa_id, canal_id, aplicacao_id, usuario_id, origem, destino, tipo, conteudo, previa, estado,
      correlacao_id, metadados, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aceita', ?, ?, ?, ?)`)
    .run(id, empresaId, canalId, aplicacaoId, usuarioId, origem, destino, tipo, conteudo, previaDe(conteudo), correlacaoId, JSON.stringify(metadados || {}), t, t);
  db.prepare('INSERT INTO mensagem_estados (mensagem_id, estado, em, detalhe) VALUES (?, ?, ?, ?)').run(id, 'aceita', t, detalhe);
  return buscar(db, id);
}

// Devolve a linha nova ou null se a transição não vale (fica como estava).
function mudarEstado(db, id, novo, { detalhe = null, em = agora(), campos = {}, nova_tentativa = false } = {}) {
  return db.transaction(() => {
    const m = db.prepare('SELECT estado FROM mensagens WHERE id = ?').get(id);
    if (!m || !podeIr(m.estado, novo, { nova_tentativa })) return null;
    const extras = Object.keys(campos);
    db.prepare(`UPDATE mensagens SET estado = @estado, atualizada_em = @em${extras.map(c => `, ${c} = @${c}`).join('')} WHERE id = @id`)
      .run({ id, estado: novo, em, ...campos });
    db.prepare('INSERT INTO mensagem_estados (mensagem_id, estado, em, detalhe) VALUES (?, ?, ?, ?)').run(id, novo, em, detalhe);
    return buscar(db, id);
  })();
}

// Reenvio manual (só falhou/desconhecida): volta para o começo da fila.
function reabrir(db, id, detalhe) {
  return db.transaction(() => {
    const m = db.prepare('SELECT estado FROM mensagens WHERE id = ?').get(id);
    if (!m || !['falhou', 'desconhecida'].includes(m.estado)) return null;
    const t = agora();
    db.prepare(`UPDATE mensagens SET estado = 'aceita', tentativas = 0, proxima_tentativa_em = NULL, id_provedor = NULL, ultimo_erro = NULL, atualizada_em = ? WHERE id = ?`).run(t, id);
    db.prepare('INSERT INTO mensagem_estados (mensagem_id, estado, em, detalhe) VALUES (?, ?, ?, ?)').run(id, 'aceita', t, detalhe);
    return buscar(db, id);
  })();
}

function buscar(db, id) {
  return db.prepare(`SELECT m.*, c.nome AS canal_nome, a.nome AS aplicacao_nome
      FROM mensagens m JOIN canais c ON c.id = m.canal_id LEFT JOIN aplicacoes a ON a.id = m.aplicacao_id WHERE m.id = ?`).get(id) || null;
}

function porIdProvedor(db, canalId, idProvedor) {
  return db.prepare('SELECT * FROM mensagens WHERE canal_id = ? AND id_provedor = ?').get(canalId, idProvedor) || null;
}

function historico(db, id) {
  return db.prepare('SELECT estado, em, detalhe FROM mensagem_estados WHERE mensagem_id = ? ORDER BY id').all(id);
}

// Próxima da fila do canal: a mais antiga ainda não encaminhada cuja hora de tentar chegou.
function proximaDaFila(db, canalId, agoraIso = agora()) {
  return db.prepare(`SELECT * FROM mensagens WHERE canal_id = ? AND estado IN ('aceita', 'aguardando')
      AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= ?) ORDER BY criada_em, id LIMIT 1`).get(canalId, agoraIso) || null;
}

function contarFila(db, canalId) {
  return db.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE canal_id = ? AND estado IN ('aceita', 'aguardando')").get(canalId).n;
}

// ── Formas de resposta (contratos.md FORMAS) ────────────────────────────────
const aplicacaoDe = (m) => (m.aplicacao_id ? { id: m.aplicacao_id, nome: m.aplicacao_nome } : null);

function paraResumo(m) {
  return {
    id: m.id, direcao: m.direcao, canal: { id: m.canal_id, nome: m.canal_nome }, aplicacao: aplicacaoDe(m), origem: m.origem,
    contato_mascarado: telefone.mascarar(m.destino), tipo: m.tipo, previa: m.previa, estado: m.estado,
    correlacao_id: m.correlacao_id, criada_em: m.criada_em, atualizada_em: m.atualizada_em,
  };
}

function paraDetalhe(db, m) {
  // texto completo só no detalhe (rota restrita à empresa dona); a lista leva só a prévia.
  return { ...paraResumo(m), texto: m.conteudo, historico_estados: historico(db, m.id), metadados: JSON.parse(m.metadados || '{}'), anexos: [], ultimo_erro: m.ultimo_erro };
}

function paraV1(db, m) {
  return {
    id: m.id, estado: m.estado, canal: m.canal_id, para_mascarado: telefone.mascarar(m.destino), tipo: m.tipo,
    correlacao_id: m.correlacao_id, criada_em: m.criada_em, atualizada_em: m.atualizada_em, historico_estados: historico(db, m.id),
  };
}

module.exports = {
  ORDEM, podeIr, criar, mudarEstado, reabrir, buscar, porIdProvedor, historico, proximaDaFila, contarFila,
  paraResumo, paraDetalhe, paraV1,
};

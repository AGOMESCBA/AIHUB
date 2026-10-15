const crypto = require('crypto');
const { getDB } = require('../database');

function registrarTentativa({ empresaId, chamadoId, consultorId, origemIdentidade, usuarioId, chave, hash, quantidadeAnexos }) {
  const db = getDB();
  return db.transaction(() => {
    const existente = db.prepare('SELECT * FROM retornos_softexpert WHERE empresa_id = ? AND consultor_id = ? AND chamado_id = ? AND chave_idempotencia = ?')
      .get(Number(empresaId), consultorId, chamadoId, chave);
    if (existente) {
      if (existente.payload_hash !== hash) throw Object.assign(new Error('Identificador de envio já utilizado com outro conteúdo.'), { status: 409 });
      return existente.id;
    }
    const pendente = db.prepare(`SELECT id FROM retornos_softexpert WHERE empresa_id = ? AND consultor_id = ? AND chamado_id = ?
      AND (em_processamento = 1 OR status_posicionamento IN ('enviando', 'indeterminado')
        OR (status_posicionamento = 'registrado' AND ((quantidade_anexos > 0 AND status_anexos NOT IN ('registrados', 'sem_anexos')) OR status_historico IN ('pendente', 'enviando', 'indeterminado', 'falhou')))) LIMIT 1`)
      .get(Number(empresaId), consultorId, chamadoId);
    if (pendente) throw Object.assign(new Error('Existe uma tentativa pendente para este chamado. Consulte e retome a tentativa anterior antes de criar outro retorno.'), { status: 409 });
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO retornos_softexpert
      (id, empresa_id, chamado_id, consultor_id, origem_identidade, usuario_id, chave_idempotencia, payload_hash, quantidade_anexos, status_posicionamento, status_anexos, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'bloqueado_configuracao', 'nao_enviados', ?)`)
      .run(id, Number(empresaId), chamadoId, consultorId, origemIdentidade, String(usuarioId), chave, hash, quantidadeAnexos, new Date().toISOString());
    return id;
  })();
}

function obter(id) {
  const db = getDB();
  const row = db.prepare('SELECT * FROM retornos_softexpert WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, anexos: db.prepare('SELECT * FROM retorno_softexpert_anexos WHERE retorno_id = ? ORDER BY indice').all(id) };
}
function obterPorChave(empresaId, consultorId, chamadoId, chave) {
  const row = getDB().prepare('SELECT id FROM retornos_softexpert WHERE empresa_id = ? AND consultor_id = ? AND chamado_id = ? AND chave_idempotencia = ?')
    .get(Number(empresaId), consultorId, chamadoId, chave);
  return row ? obter(row.id) : null;
}

function evento(id, etapa, status) {
  getDB().prepare('INSERT INTO retorno_softexpert_eventos (id, retorno_id, etapa, status, criado_em) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), id, etapa, status, new Date().toISOString());
}

const COLUNAS = new Set(['fonte_id', 'numero_chamado', 'posicionamento_chave', 'posicionamento_oid', 'status_posicionamento', 'status_anexos', 'status_historico', 'sincronizacao_status', 'contrato_hash']);
function atualizar(id, patch) {
  const entries = Object.entries(patch);
  if (!entries.length || entries.some(([k]) => !COLUNAS.has(k))) throw new Error('Atualização local de retorno inválida.');
  getDB().prepare(`UPDATE retornos_softexpert SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE id = ?`)
    .run(...entries.map(([, v]) => v), new Date().toISOString(), id);
}

function adquirir(id, contratoHash, arquivos) {
  const db = getDB();
  db.transaction(() => {
    const row = obter(id);
    if (!row || row.em_processamento) throw Object.assign(new Error('Retorno em processamento. Aguarde antes de tentar novamente.'), { status: 409 });
    if (row.contrato_hash && row.contrato_hash !== contratoHash) throw Object.assign(new Error('O contrato mudou. Reconcilie a tentativa existente antes de continuar.'), { status: 409 });
    db.prepare('UPDATE retornos_softexpert SET em_processamento = 1, contrato_hash = ? WHERE id = ?').run(contratoHash, id);
    for (let indice = 0; indice < arquivos.length; indice++) {
      const file = arquivos[indice];
      db.prepare('INSERT OR IGNORE INTO retorno_softexpert_anexos (id, retorno_id, indice, arquivo_hash, nome, tamanho) VALUES (?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), id, indice, file.hash, file.nome, file.tamanho);
    }
  })();
  return obter(id);
}

function liberar(id) { getDB().prepare('UPDATE retornos_softexpert SET em_processamento = 0 WHERE id = ?').run(id); }
function atualizarAnexo(id, status, registroId = null) {
  getDB().prepare('UPDATE retorno_softexpert_anexos SET status = ?, registro_id = COALESCE(?, registro_id) WHERE id = ?').run(status, registroId, id);
}

module.exports = { registrarTentativa, obter, obterPorChave, evento, atualizar, adquirir, liberar, atualizarAnexo };

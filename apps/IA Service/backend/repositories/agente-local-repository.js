// Unico ponto de acesso SQL as tabelas `agente_local_config` e
// `fontes_historicas`. Segredos (token, senha SQL Server) chegam aqui já
// criptografados pelo service — este repository nunca criptografa/descriptografa,
// apenas persiste e lê o que recebe.

const crypto = require('crypto');
const { getDB } = require('../database');

function _configParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    url: row.url,
    tokenEnc: row.token_enc,
    cryptoKeyEnc: row.crypto_key_enc,
    cryptoAtivo: !!row.crypto_ativo,
    ultimoTesteEm: row.ultimo_teste_em,
    ultimoTesteOk: row.ultimo_teste_ok === null ? null : !!row.ultimo_teste_ok,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function getConfig(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _configParaDominio(db.prepare(`SELECT * FROM agente_local_config WHERE empresa_id = ?`).get(Number(empresaId)));
}

function salvarConfig(empresaId, { url, tokenEnc, cryptoKeyEnc, cryptoAtivo }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = getConfig(empresaId);

  if (existente) {
    db.prepare(`
      UPDATE agente_local_config
         SET url = ?, token_enc = COALESCE(?, token_enc), crypto_key_enc = COALESCE(?, crypto_key_enc),
             crypto_ativo = ?, atualizado_em = ?
       WHERE empresa_id = ?
    `).run(
      url ?? existente.url,
      tokenEnc ?? null,
      cryptoKeyEnc ?? null,
      cryptoAtivo === undefined ? (existente.cryptoAtivo ? 1 : 0) : (cryptoAtivo ? 1 : 0),
      agora,
      Number(empresaId)
    );
  } else {
    db.prepare(`
      INSERT INTO agente_local_config (empresa_id, url, token_enc, crypto_key_enc, crypto_ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(Number(empresaId), url ?? null, tokenEnc ?? null, cryptoKeyEnc ?? null, cryptoAtivo ? 1 : 0, agora, agora);
  }

  return getConfig(empresaId);
}

function registrarTeste(empresaId, ok) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  db.prepare(`
    UPDATE agente_local_config SET ultimo_teste_em = ?, ultimo_teste_ok = ? WHERE empresa_id = ?
  `).run(agora, ok ? 1 : 0, Number(empresaId));
  return getConfig(empresaId);
}

// ── Fontes históricas ──────────────────────────────────────────────────────

// db_host/db_port/db_name/db_user/db_pass_enc/db_driver/sincronizada_agente_em
// continuam existindo na TABELA (dados legados de quando a fonte tentava
// reenviar credencial ao agente — removido em 2026-09) mas não são mais
// lidos/gravados por este repository: connectionKey já é suficiente, a
// conexão real fica cadastrada manualmente no Agente Local (mesmo padrão do
// IA Command, ver comentário em agente-local-service.criarFonte). Sem
// DROP COLUMN de propósito — evita perder dado já gravado em produção sem
// necessidade, e uma coluna não lida não tem custo funcional.
function _fonteParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    connectionKey: row.connection_key,
    nome: row.nome,
    sistemaOrigem: row.sistema_origem,
    adapter: row.adapter,
    ativo: !!row.ativo,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function criarFonte(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO fontes_historicas (
      id, empresa_id, connection_key, nome, sistema_origem, adapter, ativo,
      criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.connectionKey, dados.nome, dados.sistemaOrigem, dados.adapter,
    dados.ativo === false ? 0 : 1,
    agora, agora
  );

  return getFonte(empresaId, id);
}

function atualizarFonte(empresaId, fonteId, patch) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const atual = getFonte(empresaId, fonteId);
  if (!atual) return null;
  const agora = new Date().toISOString();

  db.prepare(`
    UPDATE fontes_historicas
       SET nome = ?, connection_key = ?, ativo = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(
    patch.nome ?? atual.nome,
    patch.connectionKey ?? atual.connectionKey,
    patch.ativo === undefined ? (atual.ativo ? 1 : 0) : (patch.ativo ? 1 : 0),
    agora,
    fonteId,
    Number(empresaId)
  );

  return getFonte(empresaId, fonteId);
}

function getFonte(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _fonteParaDominio(db.prepare(`SELECT * FROM fontes_historicas WHERE id = ? AND empresa_id = ?`).get(fonteId, Number(empresaId)));
}

function listarFontes(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.ativo !== undefined) {
    condicoes.push('ativo = ?');
    params.push(filtros.ativo ? 1 : 0);
  }
  const rows = db.prepare(`
    SELECT *
      FROM fontes_historicas
     WHERE ${condicoes.join(' AND ')}
     ORDER BY datetime(atualizado_em) DESC, datetime(criado_em) DESC, nome ASC
  `).all(...params);
  return rows.map(_fonteParaDominio);
}

/**
 * Exclusão SEMPRE apaga em cascata (ON DELETE CASCADE, migrations.js) todo o
 * histórico de chamados/posicionamentos/atendimentos/importações vinculado a
 * esta fonte — decisão explícita do usuário (2026-09): depois de importar, a
 * fonte não tem mais valor de rastreabilidade, só serve para reimportar; se o
 * usuário pediu para excluir, ele já sabe que o histórico vai junto. A UI
 * confirma isso claramente antes de chamar esta rota (ver base-historica.html).
 */
function excluirFonte(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const fonte = getFonte(empresaId, fonteId);
  if (!fonte) return { excluida: false };
  const excluir = db.transaction(() => {
    const limpeza = _zerarBaseDaFonte(db, empresaId, fonteId);
    const resultado = db.prepare(`DELETE FROM fontes_historicas WHERE id = ? AND empresa_id = ?`).run(fonteId, Number(empresaId));
    return { excluida: resultado.changes > 0, ...limpeza };
  });
  return excluir();
}

// IDs de atendimento capturados ANTES do DELETE — depois de apagado o
// registro, não há mais como saber quais diretórios de anexos em disco
// (data/anexos/<empresa>/<atendimento_id>/) pertenciam a ele (ver
// armazenamento-anexos.limparDiretoriosOrfaos, chamada por quem invoca
// este repository).
function _atendimentoIdsDaFonte(db, empresaId, fonteId) {
  return db.prepare(`
    SELECT atendimentos.id AS id
      FROM atendimentos
     WHERE atendimentos.empresa_id = ?
       AND EXISTS (
        SELECT 1
          FROM chamados c
         WHERE c.empresa_id = atendimentos.empresa_id
           AND c.fonte_id = ?
           AND c.sistema_origem = atendimentos.origem
           AND c.numero = atendimentos.referencia_externa
      )
  `).all(Number(empresaId), fonteId).map(r => r.id);
}

/**
 * Reset RADICAL de uma fonte sem excluí-la (connection_key/nome preservados):
 * apaga `chamados` (cascata automática para `posicionamentos`, FK
 * ON DELETE CASCADE), `atendimentos` (objetos de chat/Radar — sem FK direta
 * para chamados, precisa de DELETE explícito) e `importações`. Decisão
 * explícita do usuário (2026-10): "Zerar Base" existe separado de
 * "Reimportar do zero" para permitir limpar tudo sem disparar uma nova
 * importação automática em seguida.
 */
function _zerarBaseDaFonte(db, empresaId, fonteId) {
  const empresa = Number(empresaId);
  const atendimentoIdsRemovidos = _atendimentoIdsDaFonte(db, empresa, fonteId);

  const atendimentosRemovidos = db.prepare(`
    DELETE FROM atendimentos
    WHERE empresa_id = ?
      AND EXISTS (
        SELECT 1
          FROM chamados c
         WHERE c.empresa_id = atendimentos.empresa_id
           AND c.fonte_id = ?
           AND c.sistema_origem = atendimentos.origem
           AND c.numero = atendimentos.referencia_externa
      )
  `).run(empresa, fonteId).changes;

  const chamadosRemovidos = db.prepare(`DELETE FROM chamados WHERE empresa_id = ? AND fonte_id = ?`).run(empresa, fonteId).changes;

  const importacoesRemovidas = db.prepare(`
    SELECT COUNT(*) AS total FROM importacoes WHERE empresa_id = ? AND fonte_id = ?
  `).get(empresa, fonteId)?.total || 0;
  db.prepare(`DELETE FROM importacoes WHERE empresa_id = ? AND fonte_id = ?`).run(empresa, fonteId);

  return { atendimentosRemovidos, chamadosRemovidos, importacoesRemovidas, atendimentoIdsRemovidos };
}

function zerarBaseFonte(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const fonte = getFonte(empresaId, fonteId);
  if (!fonte) return { zerada: false };
  const zerar = db.transaction(() => _zerarBaseDaFonte(db, empresaId, fonteId));
  return { zerada: true, ...zerar() };
}

/**
 * "Limpar Log" — apaga SÓ o log de execuções (`importações`: status,
 * contadores, tempo). Não toca em `atendimentos`, `chamados`,
 * `posicionamentos` nem `anexos`. Decisão explícita do usuário (2026-10):
 * antes esta função também apagava `atendimentos` (zerando o chat/
 * investigação da IA), o que surpreendia o usuário ao ver a tela
 * "Atendimentos" esvaziar mesmo sem pedir isso — separado agora do reset
 * radical (ver zerarBaseFonte acima).
 */
function limparHistoricoFonte(empresaId, fonteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const fonte = getFonte(empresaId, fonteId);
  if (!fonte) return { limpa: false };
  const empresa = Number(empresaId);
  const limpar = db.transaction(() => {
    const importacoesRemovidas = db.prepare(`
      SELECT COUNT(*) AS total FROM importacoes WHERE empresa_id = ? AND fonte_id = ?
    `).get(empresa, fonteId)?.total || 0;
    db.prepare(`DELETE FROM importacoes WHERE empresa_id = ? AND fonte_id = ?`).run(empresa, fonteId);
    return { importacoesRemovidas };
  });
  return { limpa: true, ...limpar() };
}

module.exports = {
  getConfig,
  salvarConfig,
  registrarTeste,
  criarFonte,
  atualizarFonte,
  getFonte,
  listarFontes,
  excluirFonte,
  limparHistoricoFonte,
  zerarBaseFonte,
};

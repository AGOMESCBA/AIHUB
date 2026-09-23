// Unico ponto de acesso SQL a tabela `atendimentos`.
// Toda operacao exige empresaId explicito — nunca confiar em empresa_id vindo
// do corpo/query da request sem que o service/route ja tenha validado contra
// req.session (ver apps/IA Service/backend/services/empresa-context.js).

const crypto = require('crypto');
const { getDB } = require('../database');

function _proximoCodigo(db) {
  // MAX do sufixo numerico (nao COUNT) para nao reutilizar codigo apos exclusao.
  // better-sqlite3 e sincrono e a chamada ocorre dentro de db.transaction(), que
  // em SQLite serializa escritores — seguro contra corrida entre duas criacoes.
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(codigo, 4) AS INTEGER)) AS max_seq
    FROM atendimentos
    WHERE codigo LIKE 'AI-%'
  `).get();
  const proximo = (row?.max_seq || 0) + 1;
  return `AI-${String(proximo).padStart(6, '0')}`;
}

// Insercao pura do atendimento (sem transacao propria) — usada tanto por
// criarAtendimento() quanto por criarAtendimentoComPrimeiraMensagem(), para
// que a segunda possa envolver atendimento+mensagem numa unica transacao.
function _inserirAtendimento(db, empresaId, dados) {
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  const codigo = _proximoCodigo(db);

  db.prepare(`
    INSERT INTO atendimentos (
      id, codigo, empresa_id, origem, canal_entrada, referencia_externa, conteudo_bruto,
      contexto_estruturado_json, contexto_origem, precisa_revisao, status,
      criado_por_usuario_id, criado_por_integracao, consultor_id,
      criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    codigo,
    Number(empresaId),
    dados.origem || 'manual',
    dados.canalEntrada || 'web',
    dados.referenciaExterna ?? null,
    dados.conteudoBruto,
    dados.contextoEstruturado ? JSON.stringify(dados.contextoEstruturado) : null,
    dados.contextoOrigem || 'ia',
    dados.precisaRevisao ? 1 : 0,
    dados.status || 'NOVO',
    dados.criadoPorUsuarioId ?? null,
    dados.criadoPorIntegracao ?? null,
    dados.consultorId ?? null,
    agora,
    agora
  );

  return id;
}

// Insercao pura da mensagem, reaproveitada dentro da transacao abaixo — nao
// faz a checagem de "atendimento pertence a empresa" porque, dentro desta
// transacao, o atendimento acabou de ser criado na mesma empresa.
function _inserirMensagem(db, empresaId, atendimentoId, dados) {
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO mensagens (id, empresa_id, atendimento_id, papel, conteudo, usuario_id, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, Number(empresaId), atendimentoId, dados.papel, dados.conteudo, dados.usuarioId ?? null, agora);
  return id;
}

function criarAtendimento(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const criar = db.transaction(() => _inserirAtendimento(db, empresaId, dados));
  const id = criar();
  return getAtendimento(empresaId, id);
}

/**
 * Cria o atendimento e sua primeira mensagem numa unica transacao SQLite
 * (BEGIN...COMMIT via db.transaction do better-sqlite3). Se a insercao da
 * mensagem falhar por qualquer motivo, a transacao inteira sofre ROLLBACK —
 * o atendimento nao fica gravado orfao sem sua mensagem inicial.
 *
 * Continua sendo SQL puro dentro da camada Repository — o Service so chama
 * esta funcao, nunca monta SQL.
 */
function criarAtendimentoComPrimeiraMensagem(empresaId, dadosAtendimento, dadosMensagem) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const criarTudo = db.transaction(() => {
    const atendimentoId = _inserirAtendimento(db, empresaId, dadosAtendimento);
    const mensagemId = _inserirMensagem(db, empresaId, atendimentoId, dadosMensagem);
    return { atendimentoId, mensagemId };
  });

  const { atendimentoId } = criarTudo();
  return getAtendimento(empresaId, atendimentoId);
}

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo,
    empresaId: row.empresa_id,
    origem: row.origem,
    canalEntrada: row.canal_entrada,
    referenciaExterna: row.referencia_externa,
    conteudoBruto: row.conteudo_bruto,
    contextoEstruturado: row.contexto_estruturado_json ? JSON.parse(row.contexto_estruturado_json) : null,
    contextoOrigem: row.contexto_origem,
    precisaRevisao: !!row.precisa_revisao,
    status: row.status,
    criadoPorUsuarioId: row.criado_por_usuario_id,
    criadoPorIntegracao: row.criado_por_integracao,
    consultorId: row.consultor_id,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function getAtendimento(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM atendimentos WHERE id = ? AND empresa_id = ?
  `).get(atendimentoId, Number(empresaId));
  return _rowParaDominio(row);
}

function getAtendimentoPorCodigo(empresaId, codigo) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM atendimentos WHERE codigo = ? AND empresa_id = ?
  `).get(codigo, Number(empresaId));
  return _rowParaDominio(row);
}

function listarAtendimentos(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];

  if (filtros.status) {
    condicoes.push('status = ?');
    params.push(filtros.status);
  }
  if (filtros.consultorId) {
    condicoes.push('consultor_id = ?');
    params.push(filtros.consultorId);
  }

  const limite = Math.min(Number(filtros.limite) || 50, 200);

  const rows = db.prepare(`
    SELECT * FROM atendimentos
    WHERE ${condicoes.join(' AND ')}
    ORDER BY criado_em DESC
    LIMIT ?
  `).all(...params, limite);

  return rows.map(_rowParaDominio);
}

function atualizarStatus(empresaId, atendimentoId, status) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const info = db.prepare(`
    UPDATE atendimentos SET status = ?, atualizado_em = ?
    WHERE id = ? AND empresa_id = ?
  `).run(status, agora, atendimentoId, Number(empresaId));
  if (info.changes === 0) return null;
  return getAtendimento(empresaId, atendimentoId);
}

function atualizarContexto(empresaId, atendimentoId, { contextoEstruturado, contextoOrigem, precisaRevisao }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const agora = new Date().toISOString();
  const info = db.prepare(`
    UPDATE atendimentos
       SET contexto_estruturado_json = ?, contexto_origem = ?, precisa_revisao = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(
    contextoEstruturado ? JSON.stringify(contextoEstruturado) : null,
    contextoOrigem || 'ia',
    precisaRevisao ? 1 : 0,
    agora,
    atendimentoId,
    Number(empresaId)
  );
  if (info.changes === 0) return null;
  return getAtendimento(empresaId, atendimentoId);
}

module.exports = {
  criarAtendimento,
  criarAtendimentoComPrimeiraMensagem,
  getAtendimento,
  getAtendimentoPorCodigo,
  listarAtendimentos,
  atualizarStatus,
  atualizarContexto,
};

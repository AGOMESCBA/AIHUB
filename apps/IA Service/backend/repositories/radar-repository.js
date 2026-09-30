// Fila de chamados aguardando ação do analista ("radar") — consulta só o
// SQLite local (nunca bate no Agente Local em tempo de tela), reaproveitando
// os dados já normalizados por chamados/posicionamentos. A regra de negócio
// (aguardando_retorno = true no ÚLTIMO posicionamento, chamado não encerrado)
// foi validada com dados reais e o usuário em 2026-09 — ver comentários em
// historical-import-service.js (_mapearPosicionamento) e
// softexpert-sqlserver-adapter.js (SQL_STATUS_CHAMADO/SQL_SLA_PRAZO).

const { getDB } = require('../database');

function _chamadoFilaParaDominio(row) {
  return {
    id: row.id,
    numero: row.numero,
    titulo: row.titulo,
    assunto: row.assunto,
    breveDescricao: row.breve_descricao,
    descricao: row.descricao,
    servico: row.servico,
    tipoChamado: row.tipo_chamado,
    tipoChamadoFinal: row.tipo_chamado_final,
    natureza: row.natureza,
    nivel: row.nivel,
    solucaoAplicada: row.solucao_aplicada,
    avaliacao: row.avaliacao,
    totalHoras: row.total_horas,
    produto: row.produto,
    familia: row.familia,
    modulo: row.modulo,
    clienteId: row.cliente_id,
    clienteNome: row.cliente_nome,
    dataAbertura: row.data_abertura,
    statusEncerramento: row.status_encerramento,
    sla: row.sla,
    slaHoras: row.sla_horas,
    slaStatus: row.sla_status,
    slaStatusFinal: row.sla_status_final,
    slaInicial: row.sla_inicial,
    slaAnterior: row.sla_anterior,
    slaPrazo: row.sla_prazo,
    solicitanteId: row.solicitante_id,
    solicitanteNome: row.solicitante_nome,
    solicitanteEmail: row.solicitante_email,
    tecnicoResponsavelId: row.tecnico_responsavel_id,
    tecnicoResponsavelNome: row.tecnico_responsavel_nome,
    ultimoPosicionamentoEm: row.ultimo_posicionamento_em,
    ultimoPosicionamentoAssunto: row.ultimo_posicionamento_assunto,
    situacaoRetorno: row.situacao_retorno,
  };
}

function _filtroRiscoParaCondicao(filtroRisco) {
  if (filtroRisco === 'em_atraso') return "c.sla_prazo = 'Em atraso'";
  if (filtroRisco === 'proximo') return "c.sla_prazo = 'Proxima do vencimento'";
  return "c.sla_prazo IN ('Em atraso', 'Proxima do vencimento')";
}

/**
 * `filtroSla`: 'todos' (padrão) | 'em_atraso' | 'em_dia' — decisão do
 * usuário: a tela deve poder filtrar por qualquer um dos três, não só
 * "prioritário" como booleano. Usa `chamados.sla_prazo` (cálculo DINÂMICO via
 * WFPROCESS, recalculado a cada importação/sincronização — não
 * `sla_status_final`, que é o desfecho histórico de como o chamado foi
 * encerrado, confirmado pelo usuário como um campo diferente). 'em_dia'
 * inclui também 'Proxima do vencimento' — não é um quarto filtro separado
 * nesta v1, só "em_atraso" tem tratamento dedicado.
 *
 * Ordenação: número do chamado mais antigo primeiro (decisão do usuário) —
 * `numero` é o IDPROCESS do SoftExpert, string zero-padded, então a
 * ordenação alfabética coincide com a numérica/cronológica de criação.
 */
function listarFila(empresaId, { tecnicoId, filtroSla = 'todos', limite = 200 } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const condicoes = ['c.empresa_id = ?', "(c.status_encerramento IS NULL OR c.status_encerramento != 'Encerrado')", 'ultimo.aguardando_retorno = 1'];
  const params = [Number(empresaId)];

  if (tecnicoId) {
    condicoes.push('c.tecnico_responsavel_id = ?');
    params.push(tecnicoId);
  }
  if (filtroSla === 'em_atraso') {
    condicoes.push("c.sla_prazo = 'Em atraso'");
  } else if (filtroSla === 'em_dia') {
    condicoes.push("(c.sla_prazo != 'Em atraso' OR c.sla_prazo IS NULL)");
  }

  const limiteSeguro = Math.min(Number(limite) || 200, 1000);

  const rows = db.prepare(`
    WITH ultimo_posicionamento AS (
      SELECT
        p.*,
        ROW_NUMBER() OVER (PARTITION BY p.chamado_id ORDER BY p.data_posicionamento DESC) AS rn
      FROM posicionamentos p
      WHERE p.empresa_id = ?
    )
    SELECT
      c.id, c.numero, c.titulo, c.assunto, c.breve_descricao, c.descricao,
      c.servico, c.tipo_chamado, c.tipo_chamado_final, c.natureza, c.nivel,
      c.solucao_aplicada, c.avaliacao, c.total_horas,
      c.produto, c.familia, c.modulo,
      c.cliente_id, cl.nome AS cliente_nome, c.data_abertura,
      c.status_encerramento, c.sla, c.sla_horas, c.sla_status, c.sla_status_final,
      c.sla_inicial, c.sla_anterior, c.sla_prazo,
      c.solicitante_id, uc.nome AS solicitante_nome, uc.email AS solicitante_email,
      c.tecnico_responsavel_id, t.nome AS tecnico_responsavel_nome,
      ultimo.data_posicionamento AS ultimo_posicionamento_em,
      ultimo.assunto AS ultimo_posicionamento_assunto,
      ultimo.situacao_retorno AS situacao_retorno
    FROM chamados c
    INNER JOIN ultimo_posicionamento ultimo ON ultimo.chamado_id = c.id AND ultimo.rn = 1
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN usuarios_cliente uc ON uc.id = c.solicitante_id
    LEFT JOIN tecnicos t ON t.id = c.tecnico_responsavel_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY c.numero ASC
    LIMIT ?
  `).all(Number(empresaId), ...params, limiteSeguro);

  return rows.map(_chamadoFilaParaDominio);
}

function listarRiscoSla(empresaId, { tecnicoId, filtroRisco = 'todos', limite = 1000 } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const condicoes = [
    'c.empresa_id = ?',
    "(c.status_encerramento IS NULL OR c.status_encerramento != 'Encerrado')",
    'ultimo.aguardando_retorno = 1',
    _filtroRiscoParaCondicao(filtroRisco),
  ];
  const params = [Number(empresaId)];

  if (tecnicoId) {
    condicoes.push('c.tecnico_responsavel_id = ?');
    params.push(tecnicoId);
  }

  const limiteSeguro = Math.min(Number(limite) || 1000, 2000);

  const rows = db.prepare(`
    WITH ultimo_posicionamento AS (
      SELECT
        p.*,
        ROW_NUMBER() OVER (PARTITION BY p.chamado_id ORDER BY p.data_posicionamento DESC) AS rn
      FROM posicionamentos p
      WHERE p.empresa_id = ?
    )
    SELECT
      c.id, c.numero, c.titulo, c.assunto, c.breve_descricao, c.descricao,
      c.servico, c.tipo_chamado, c.tipo_chamado_final, c.natureza, c.nivel,
      c.solucao_aplicada, c.avaliacao, c.total_horas,
      c.produto, c.familia, c.modulo,
      c.cliente_id, cl.nome AS cliente_nome, c.data_abertura,
      c.status_encerramento, c.sla, c.sla_horas, c.sla_status, c.sla_status_final,
      c.sla_inicial, c.sla_anterior, c.sla_prazo,
      c.solicitante_id, uc.nome AS solicitante_nome, uc.email AS solicitante_email,
      c.tecnico_responsavel_id, t.nome AS tecnico_responsavel_nome,
      ultimo.data_posicionamento AS ultimo_posicionamento_em,
      ultimo.assunto AS ultimo_posicionamento_assunto,
      ultimo.situacao_retorno AS situacao_retorno
    FROM chamados c
    INNER JOIN ultimo_posicionamento ultimo ON ultimo.chamado_id = c.id AND ultimo.rn = 1
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN usuarios_cliente uc ON uc.id = c.solicitante_id
    LEFT JOIN tecnicos t ON t.id = c.tecnico_responsavel_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY
      CASE c.sla_prazo WHEN 'Em atraso' THEN 0 WHEN 'Proxima do vencimento' THEN 1 ELSE 2 END,
      COALESCE(t.nome, 'Sem consultor') ASC,
      c.numero ASC
    LIMIT ?
  `).all(Number(empresaId), ...params, limiteSeguro);

  const chamados = rows.map(_chamadoFilaParaDominio);
  const porConsultor = new Map();
  for (const chamado of chamados) {
    const id = chamado.tecnicoResponsavelId || '__sem_consultor__';
    const atual = porConsultor.get(id) || {
      id,
      nome: chamado.tecnicoResponsavelNome || 'Sem consultor',
      total: 0,
      emAtraso: 0,
      proximo: 0,
    };
    atual.total += 1;
    if (chamado.slaPrazo === 'Em atraso') atual.emAtraso += 1;
    if (chamado.slaPrazo === 'Proxima do vencimento') atual.proximo += 1;
    porConsultor.set(id, atual);
  }

  const consultores = Array.from(porConsultor.values()).sort((a, b) => {
    if (b.emAtraso !== a.emAtraso) return b.emAtraso - a.emAtraso;
    if (b.proximo !== a.proximo) return b.proximo - a.proximo;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return { consultores, chamados };
}

module.exports = { listarFila, listarRiscoSla };

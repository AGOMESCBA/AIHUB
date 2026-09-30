// Adapter de origem: SQL Server do SoftExpert (tabelas DYNITSM/DYNITSMGRIDREGISTR).
//
// MAPEAMENTO VALIDADO CONTRA DADOS REAIS em 2026-09 (conexão
// softexpert_chamados via Agente Local, amostra de 50 registros de DYNITSM).
// Divergências encontradas frente à especificação original do prompt da
// Etapa 2 (seções 5/6), já corrigidas nesta implementação:
//   - DT é datetime real ('YYYY-MM-DD HH:MM:SS'), não string 'YYYYMMDD'.
//     O filtro de período abaixo converte os limites YYYYMMDD (interface
//     pública mantida) para datetime dentro do SQL.
//   - TITULOCHAMADO vem vazio na maioria dos registros (7/50 preenchidos);
//     TITULOWF preenchido com mais frequência (18/50) — usado como fallback
//     em _mapearChamado (historical-import-service.js).
//   - TEXTO31 é o campo de fato preenchido para descrição breve (43/50);
//     BREVEDESCRICAO e DESCRICAO01 vieram sempre vazios (0/50) na amostra.
//   - CNPJCPF confirmado como campo correto (44/50 preenchidos); CNPJ
//     sempre vazio (0/50) — mapeamento original já estava certo aqui.
//
// Implementa a interface que HistoricalImportService espera de qualquer
// adapter: listarChamadosPeriodo(fonte, {inicio, fim}, {offset, limit}) e
// listarPosicionamentosDoChamado(fonte, idProcess).

const agenteLocalService = require('../agente-local-service');

const SISTEMA_ORIGEM = 'softexpert';

// Colunas de DYNITSM relevantes (seção 5 do prompt) — SELECT explícito, nunca
// `SELECT *`, para que qualquer coluna nova na origem não quebre o parsing e
// para que o RAW capture exatamente o que foi pedido (rastreável).
const COLUNAS_DYNITSM = [
  'OID', 'IDPROCESS', 'DT', 'CNPJCPF', 'DP',
  'CDUSER', 'IDUSER', 'NMSOLICITANTE', 'EMAIL', 'TELERAMAL',
  'CDUSERANA', 'NOMEANALISTARES', 'EMAILANALISTA',
  'PRODUTO', 'FAMILIA', 'MD', 'SERVICOS',
  'TIPODECHAMADO', 'TIPODECHAMADOSE', 'TIPODOCHAMADO', 'NATUREZADOCHAMAD', 'NIVELCHAMADO',
  'TITULOCHAMADO', 'TITULOWF', 'TEXTO31', 'BREVEDESCRICAO', 'DESCRICAO01', 'PARAGRAFO3', 'INFO', 'OBS',
  'IDSLA', 'SLAHORAS', 'SLASTATUS', 'SLAFINALSTATUS', 'IDSLAINICIAL', 'IDSLAANTERIOR',
  'SOLUCAOAPLICADA', 'AVALIACAO', 'TOTALHORAS',
  'NCHAMADOREF',
  'OIDARQUIVO1', 'OIDARQUIVO2', 'RECORDIDANEXO',
];

// Status de encerramento — VALIDADO CONTRA DADOS REAIS em 2026-09 (fórmula e
// nomes de tabela/campo fornecidos pelo usuário, confirmados contra
// INFORMATION_SCHEMA.COLUMNS e testados com JOIN real: 51 'Andamento' + 109
// 'Encerrado' = 160, bate exatamente com o total de chamados do período —
// sem perda no INNER JOIN). Calculado no próprio SQL (não em JS) porque
// depende de WFPROCESS, tabela que o pipeline não importa separadamente —
// só usada aqui para produzir um campo já pronto em cada linha de DYNITSM.
// 'Pendente' (FGSTATUS=1 com RESPONSAVEL nulo) não apareceu na amostra
// testada — comportamento aceito como esperado (responsável costuma ser
// atribuído rapidamente), não indica erro na fórmula.
//
// FGSTATUS=3 é tratado como 'Encerrado' na fórmula por fidelidade à regra
// original, mas na prática NUNCA é alcançado: o JOIN_WFPROCESS abaixo já
// exclui FGSTATUS=3 do resultado (confirmado intencional com o usuário —
// esse valor representa um estado que não deve nem aparecer na lista de
// chamados do radar, ex. cancelado/inválido/duplicado).
const SQL_STATUS_CHAMADO = `
  CASE
    WHEN W.FGSTATUS = 1 THEN (CASE WHEN D.RESPONSAVEL IS NULL THEN 'Pendente' ELSE 'Andamento' END)
    WHEN W.FGSTATUS IN (2, 3, 4, 5) THEN 'Encerrado'
    ELSE NULL
  END
`;

// SLA_PRAZO — VALIDADO CONTRA DADOS REAIS em 2026-09 (fórmula fornecida pelo
// usuário, confirmada contra INFORMATION_SCHEMA.COLUMNS e testada com JOIN
// real: 18 'Em atraso' + 102 'Em dia' + 2 'Proxima do vencimento' = 122, bate
// com o total de chamados do período). Cálculo DINÂMICO (depende de GETDATE()
// no momento da consulta) — é o critério correto de "está atrasado agora".
// chamados.sla_status_final (campo estático de DYNITSM) NÃO é equivalente:
// conforme confirmado pelo usuário, ele representa o status de COMO o
// chamado foi ENCERRADO (metadado histórico do desfecho), não se está em
// atraso no momento atual — por isso a amostra mostrava só 8 registros
// preenchidos com valor de atraso (associados a chamados já concluídos),
// não os 18 reais em aberto. sla_status_final continua importado como
// referência histórica, mas o filtro "em atraso"/"em dia" da fila do radar
// usa exclusivamente SLA_PRAZO.
const SQL_SLA_PRAZO = `
  CASE
    WHEN W.FGCONCLUDEDSTATUS IS NOT NULL THEN (CASE WHEN W.FGCONCLUDEDSTATUS = 1 THEN 'Em dia' WHEN W.FGCONCLUDEDSTATUS = 2 THEN 'Em atraso' END)
    ELSE (CASE
      WHEN ((W.DTESTIMATEDFINISH > (DATEADD(dd, DATEDIFF(dd, 0, GETDATE()), 0) + 1)) OR (W.DTESTIMATEDFINISH IS NULL)) THEN 'Em dia'
      WHEN ((W.DTESTIMATEDFINISH = DATEADD(dd, DATEDIFF(dd, 0, GETDATE()), 0) AND W.NRTIMEESTFINISH >= (DATEPART(MINUTE, GETDATE()) + DATEPART(HOUR, GETDATE()) * 60)) OR (W.DTESTIMATEDFINISH = (DATEADD(dd, DATEDIFF(dd, 0, GETDATE()), 0) + 1))) THEN 'Proxima do vencimento'
      ELSE 'Em atraso'
    END)
  END
`;

const JOIN_WFPROCESS = `
  INNER JOIN WFPROCESS W
    ON D.FGENABLED = 1 AND D.IDPROCESS = W.IDPROCESS
   AND W.CDPRODAUTOMATION IS NOT NULL AND W.CDPRODAUTOMATION NOT IN (160, 202, 275)
   AND W.CDPROCESSMODEL = 1759 AND W.FGWFGROUP = 1 AND W.FGSTATUS NOT IN (3)
`;

const COLUNAS_POSICIONAMENTO = [
  'OID', 'CHAMADO', 'DATAATUAL', 'EMPRESA', 'COLABCLIENTE',
  'SITUACAOCHAMADO', 'ANALISTAJ2A', 'CDUSERANA',
  'TIPOPOSICIONAME', 'MOTIVOAPONTAMEN', 'ASSUNTO', 'DESCRICAO', 'RESULTADO',
  'HORAINI', 'HORAFIM', 'HORAINT', 'HORATOTALNUM', 'AGUARDANRETORNO',
  'OIDARQUIVO1', 'OIDARQUIVO2',
];

/**
 * Lista chamados de DYNITSM dentro do período [inicio, fim), paginado.
 * `inicio`/`fim` chegam como 'YYYYMMDD' (interface pública mantida —
 * historical-sync-service.js e o painel dependem desse formato). DT na
 * origem é datetime real (confirmado em amostra: '2026-09-24 00:00:00',
 * podendo ser NULL) — CONVERT(datetime, @param, 112) traduz o parâmetro
 * YYYYMMDD (estilo 112) para datetime antes de comparar, mantendo a
 * comparação sargable (conversão aplicada no literal/parâmetro, não na
 * coluna DT).
 *
 * TRAZ chamados de qualquer status, inclusive 'Encerrado' (2026-09,
 * decisão explícita do usuário: revertida a exclusão anterior, que
 * impedia o histórico de chamados já resolvidos — com solução aplicada —
 * de virar base de conhecimento para correlação/pesquisa técnica. Seguro
 * fazer isso porque a fila do Radar tem seu PRÓPRIO filtro independente
 * em radar-repository.js:56 (`status_encerramento != 'Encerrado'`) —
 * trazer o dado pra cá não faz chamado encerrado aparecer na fila.
 */
async function listarChamadosPeriodo(empresaId, fonte, { inicio, fim }, { offset = 0, limit = 500 } = {}) {
  const colunasD = COLUNAS_DYNITSM.map(c => `D.${c}`).join(', ');
  const sql = `
    SELECT ${colunasD}, ${SQL_STATUS_CHAMADO} AS STATUS_ENCERRAMENTO, ${SQL_SLA_PRAZO} AS SLA_PRAZO
    FROM DYNITSM D
    ${JOIN_WFPROCESS}
    WHERE D.DT >= CONVERT(datetime, @inicio, 112) AND D.DT < CONVERT(datetime, @fim, 112)
    ORDER BY D.OID
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `;
  const rows = await agenteLocalService.executarSelectNaFonte(empresaId, fonte.id, {
    sql,
    params: { inicio, fim, offset, limit },
    limit,
  });
  return rows;
}

async function contarChamadosPeriodo(empresaId, fonte, { inicio, fim }) {
  const sql = `
    SELECT COUNT(*) AS total
    FROM DYNITSM D
    ${JOIN_WFPROCESS}
    WHERE D.DT >= CONVERT(datetime, @inicio, 112) AND D.DT < CONVERT(datetime, @fim, 112)
  `;
  const rows = await agenteLocalService.executarSelectNaFonte(empresaId, fonte.id, {
    sql, params: { inicio, fim }, limit: 1,
  });
  return Number(rows?.[0]?.total || 0);
}

/**
 * Lista TODOS os posicionamentos de um chamado (via IDPROCESS), sem filtrar
 * por data do posicionamento — seção 46 do prompt: um posicionamento de
 * janeiro/2027 pertence a um chamado aberto em dezembro/2026 selecionado, e
 * deve ser importado junto.
 */
async function listarPosicionamentosDoChamado(empresaId, fonte, idProcess) {
  const sql = `
    SELECT ${COLUNAS_POSICIONAMENTO.join(', ')}
    FROM DYNITSMGRIDREGISTR
    WHERE CHAMADO = @idProcess
    ORDER BY DATAATUAL
  `;
  return agenteLocalService.executarSelectNaFonte(empresaId, fonte.id, {
    sql, params: { idProcess }, limit: 5000,
  });
}

/**
 * Lista os anexos reais do chamado no SoftExpert (não os uploads feitos pelo
 * próprio analista no IA Service — esses já existem via armazenamento-anexos.js).
 * Componente "CONTAINER" do formulário SE não é uma coluna simples — o
 * binário fica em SEBLOB (OID, NMNAME, IDEXTENSION, NRSIZE, FLDATA), referenciado
 * a partir de três fontes distintas, cada chamado podendo ter 0..N no total
 * (VALIDADO CONTRA DADOS REAIS em 2026-09, cobertura 100% em todas as três
 * amostras testadas):
 *   1. DYNITSM.OIDARQUIVO2 → SEBLOB.OID — anexo único "principal" do chamado
 *      (OIDARQUIVO1 do próprio DYNITSM fica sempre vazio, não usar).
 *   2. DYNITSMGRIDREGISTR.OIDARQUIVO2 → SEBLOB.OID — anexo de um posicionamento
 *      específico (analista anexou algo ao responder).
 *   3. DYNITSMGRIDANEXO (grid de múltiplos anexos) → SEBLOB.OID via
 *      OIDARQUIVO1. O vínculo com o chamado NÃO é OIDREVISIONFORM (isso é
 *      metadado de estrutura do formulário "GridAnexos", igual para todo
 *      anexo do sistema, testado e descartado) — é OIDABC58815SXW3N8D, um
 *      nome de coluna gerado automaticamente pelo motor de atributo
 *      customizado do SE, confirmado por JOIN real contra DYNITSM.OID
 *      (8144/8144 casos bateram).
 *
 * FLDATA vem do agente já em base64 (erp_executor.py converte bytes/bytearray
 * antes de serializar a resposta JSON — sem essa conversão o agente quebraria
 * ao tentar devolver uma coluna `image` do SQL Server). Cada linha aqui já
 * inclui `origem` para o chamador saber de qual das três fontes veio.
 */
async function listarAnexosDoChamado(empresaId, fonte, idProcess) {
  const sql = `
    SELECT 'chamado' AS origem, D.OID AS OID_REFERENCIA, D.DT AS DATA_REFERENCIA, D.NMSOLICITANTE AS AUTOR_REFERENCIA,
           B.OID, B.NMNAME, B.IDEXTENSION, B.NRSIZE, B.FLDATA
    FROM DYNITSM D
    INNER JOIN SEBLOB B ON B.OID = D.OIDARQUIVO2
    WHERE D.IDPROCESS = @idProcess

    UNION ALL

    SELECT 'posicionamento' AS origem, P.OID AS OID_REFERENCIA, P.DATAATUAL AS DATA_REFERENCIA, P.ANALISTAJ2A AS AUTOR_REFERENCIA,
           B.OID, B.NMNAME, B.IDEXTENSION, B.NRSIZE, B.FLDATA
    FROM DYNITSMGRIDREGISTR P
    INNER JOIN SEBLOB B ON B.OID = P.OIDARQUIVO2
    WHERE P.CHAMADO = @idProcess

    UNION ALL

    SELECT 'anexo' AS origem, D.OID AS OID_REFERENCIA, D.DT AS DATA_REFERENCIA, D.NMSOLICITANTE AS AUTOR_REFERENCIA,
           B.OID, B.NMNAME, B.IDEXTENSION, B.NRSIZE, B.FLDATA
    FROM DYNITSM D
    INNER JOIN DYNITSMGRIDANEXO A ON A.OIDABC58815SXW3N8D = D.OID
    INNER JOIN SEBLOB B ON B.OID = A.OIDARQUIVO1
    WHERE D.IDPROCESS = @idProcess
  `;
  return agenteLocalService.executarSelectNaFonte(empresaId, fonte.id, {
    sql, params: { idProcess }, limit: 100,
  });
}

module.exports = {
  SISTEMA_ORIGEM,
  COLUNAS_DYNITSM,
  COLUNAS_POSICIONAMENTO,
  listarChamadosPeriodo,
  contarChamadosPeriodo,
  listarPosicionamentosDoChamado,
  listarAnexosDoChamado,
};

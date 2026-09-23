'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runner = require(path.join(ROOT, 'modules/erp/core/semantic-dataset-ai-runner'));

const camposPermitidos = ['F2_EMISSAO', 'D2_TOTAL', 'A1_NOME'];
const camposChamados = [
  { coluna: 'chamado', tipo: 'identificador', descricao: 'Numero do chamado.' },
  { coluna: 'empresa_cliente', tipo: 'dimensao', descricao: 'Cliente.', agrupavel: 1 },
  { coluna: 'aguardando_retorno', tipo: 'dimensao', descricao: 'Status de aguardando retorno.', agrupavel: 1 },
  { coluna: 'nome_analista', tipo: 'dimensao', descricao: 'Analista.', agrupavel: 1 },
  { coluna: 'dias_duracao_chamado', tipo: 'metrica', descricao: 'Tempo total em dias.' },
  { coluna: 'horas_duracao_chamado', tipo: 'metrica', descricao: 'Tempo total em horas.' },
  { coluna: 'dias_duracao_com_suporte', tipo: 'metrica', descricao: 'Tempo em dias com suporte.' },
  { coluna: 'dias_duracao_com_fsw', tipo: 'metrica', descricao: 'Tempo em dias com desenvolvimento.' },
  { coluna: 'dias_duracao_com_fabricante', tipo: 'metrica', descricao: 'Tempo em dias com fabricante.' },
  { coluna: 'dias_duracao_com_cliente', tipo: 'metrica', descricao: 'Tempo em dias com usuario do cliente.' },
  { coluna: 'dias_duracao_com_TIcliente', tipo: 'metrica', descricao: 'Tempo em dias com TI do cliente.' },
  { coluna: 'sla_horas_pa_chamado', tipo: 'metrica', descricao: 'SLA PA em horas.' },
  { coluna: 'sla_padrao_horas_chamado', tipo: 'metrica', descricao: 'SLA padrao em horas.' },
  { coluna: 'sla_situacao_atual_chamado', tipo: 'status', descricao: 'Situacao atual do SLA.' },
  { coluna: 'sla_situacao_final_chamado', tipo: 'status', descricao: 'Situacao final do SLA.' },
  { coluna: 'id_status_sla', tipo: 'status', descricao: 'Status operacional do SLA.' },
];

const sqlModeloUnion = `
SET ROWCOUNT 10000;
SELECT '202506' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2020 SF2
JOIN SD2020 SD2 ON SD2.D2_DOC = SF2.F2_DOC
WHERE SF2.F2_EMISSAO BETWEEN '20250601' AND '20250630'
UNION ALL
SELECT '202507' AS competencia, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2020 SF2
JOIN SD2020 SD2 ON SD2.D2_DOC = SF2.F2_DOC
WHERE SF2.F2_EMISSAO BETWEEN '20250701' AND '20250731';
`;

assert.strictEqual(runner._test._temUnionTopLevel(sqlModeloUnion), true, 'dataset deve detectar UNION no SQL modelo');

const sqlDataset = `
SELECT TOP 10000 SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const estrutura = runner._test._aplicarEstruturaSqlModelo(sqlDataset, sqlModeloUnion, camposPermitidos);
assert.strictEqual(estrutura.aplicado, false, 'dataset nao deve aplicar estrutura de modelo com UNION');
assert.strictEqual(estrutura.motivo, 'modelo_union_nao_aplicado_dataset');
assert.strictEqual(estrutura.sql, sqlDataset);

const intentComparativo = {
  _mensagemOriginal: 'Compare esse resultado com julho do ano passado.',
  periodo: { tipo: 'mes', dataInicio: '20250701', dataFim: '20250731' },
  _contextoUsadoOrquestrador: {
    periodo: { tipo: 'mes', dataInicio: '20250601', dataFim: '20250630' },
  },
};

const sqlComparativoIncompleto = `
SELECT TOP 10000 '202506' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const validacaoIncompleta = runner._test._validarPeriodoDataset(sqlComparativoIncompleto, 'F2_EMISSAO', intentComparativo, {});
assert.strictEqual(validacaoIncompleta.ok, false, 'dataset deve rejeitar comparativo que nao filtra periodo_base');
assert(validacaoIncompleta.erros.join(' ').includes('20250601'), 'erro deve citar periodo_base faltante');
assert(validacaoIncompleta.erros.join(' ').includes('Competencia literal 202506'), 'erro deve citar competencia literal divergente');

const sqlComparativoCorreto = `
SELECT TOP 10000 '202506' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250601' AND '20250630'
UNION ALL
SELECT '202507' AS competencia, SUM(D2_TOTAL) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
`;
const validacaoCorreta = runner._test._validarPeriodoDataset(sqlComparativoCorreto, 'F2_EMISSAO', intentComparativo, {});
assert.strictEqual(validacaoCorreta.ok, true, `dataset deve aceitar comparativo correto: ${validacaoCorreta.erros.join(' | ')}`);

const sqlDatasetGroupByQuebrado = `
SELECT TOP 10000 SUBSTRING(F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(D2_TOTAL), 0) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250601' AND '20250630'
GROUP BY SUBSTRING(F2_EMISSAO, 1, 6 UNION ALL
SELECT SUBSTRING(F2_EMISSAO, 1, 6) AS competencia, COALESCE(SUM(D2_TOTAL), 0) AS faturamento_total
FROM base
WHERE F2_EMISSAO BETWEEN '20250701' AND '20250731'
GROUP BY SUBSTRING(F2_EMISSAO, 1, 6
`;
const sqlDatasetGroupByCorrigido = runner._test._corrigirGroupBySubstringIncompleto(sqlDatasetGroupByQuebrado);
assert(sqlDatasetGroupByCorrigido.includes('GROUP BY SUBSTRING(F2_EMISSAO, 1, 6) UNION ALL'), 'dataset deve fechar SUBSTRING antes do UNION');
assert(sqlDatasetGroupByCorrigido.trim().endsWith('GROUP BY SUBSTRING(F2_EMISSAO, 1, 6)'), 'dataset deve fechar SUBSTRING no ultimo SELECT');
const validacaoSintaxeCorrigida = runner._test._validarSintaxeBasicaSqlDataset(sqlDatasetGroupByCorrigido);
assert.strictEqual(validacaoSintaxeCorrigida.ok, true, `dataset corrigido deve ter sintaxe valida: ${validacaoSintaxeCorrigida.erros.join(' | ')}`);

const promptChamados = runner._test._buildSystemPrompt(
  { nome: 'softexpert_chamados', erp: 'SoftExpert', view_nome: 'ITSM_CHAMADOS' },
  { campos: camposChamados, metricas: [], campoData: 'data_abertura_chamado' },
);
assert(promptChamados.includes('PROIBIDO usar total_* para COUNT'), 'prompt deve proibir total_* em COUNT');
assert(promptChamados.includes('COUNT(chamado) AS qtd_chamados'), 'prompt deve orientar qtd_* para chamados');
assert(promptChamados.includes('Nao transforme em Sim/Nao'), 'prompt deve preservar categorias reais de aguardando retorno');
assert(promptChamados.includes('dias_duracao_com_suporte'), 'prompt deve mapear SLA por area para suporte/empresa IA Command');
assert(promptChamados.includes('dias_duracao_com_TIcliente'), 'prompt deve mapear SLA por area para TI do cliente');
assert(promptChamados.includes('sla_horas_pa_chamado = horas PREVISTAS para primeiro atendimento'), 'prompt deve diferenciar SLA previsto de primeiro atendimento');
assert(promptChamados.includes('sla_padrao_horas_chamado = horas PREVISTAS para o atendimento total'), 'prompt deve diferenciar SLA previsto total');
assert(promptChamados.includes('id_status_sla = status operacional do SLA'), 'prompt deve orientar SLA pausado/em atendimento');

const sqlCountTotal = `
SELECT TOP 10000 empresa_cliente, nome_analista, COUNT(chamado) AS total_chamados, COUNT(DISTINCT empresa_cliente) AS total_clientes, COUNT(*) AS total
FROM base
GROUP BY empresa_cliente, nome_analista
`;
const sqlCountNormalizado = runner._test._sanitizarSqlSelectDataset(
  sqlCountTotal,
  { sql_base: '', erp: 'SoftExpert' },
  'data_abertura_chamado',
  ['empresa_cliente', 'nome_analista', 'chamado'],
  'Chamados em atraso agrupados por cliente e analista',
  camposChamados,
);
assert(sqlCountNormalizado.includes('COUNT(chamado) AS qtd_chamados'), sqlCountNormalizado);
assert(sqlCountNormalizado.includes('COUNT(DISTINCT empresa_cliente) AS qtd_clientes'), sqlCountNormalizado);
assert(sqlCountNormalizado.includes('COUNT(*) AS qtd_registros'), sqlCountNormalizado);
assert(!/AS\s+total(?:_|\b)/i.test(sqlCountNormalizado), sqlCountNormalizado);

const sqlSemAguardandoNoGroupBy = `
SELECT TOP 10000 empresa_cliente, nome_analista, COUNT(*) AS qtd_chamados
FROM base
WHERE status_chamado IN ('Pendente', 'Andamento')
  AND sla_situacao_atual_chamado = 'Em atraso'
  AND aguardando_retorno IS NOT NULL
GROUP BY empresa_cliente, nome_analista
`;
const sqlAguardandoForcado = runner._test._sanitizarSqlSelectDataset(
  sqlSemAguardandoNoGroupBy,
  { sql_base: '', erp: 'SoftExpert' },
  'data_abertura_chamado',
  ['empresa_cliente', 'aguardando_retorno', 'nome_analista', 'chamado', 'status_chamado', 'sla_situacao_atual_chamado'],
  'Chamados em atraso aguardando retorno agrupados por cliente e por analista',
  camposChamados,
);
assert(/SELECT TOP 10000\s+aguardando_retorno,\s+empresa_cliente,\s+nome_analista,\s+COUNT\(\*\) AS qtd_chamados/i.test(sqlAguardandoForcado), sqlAguardandoForcado);
assert(/GROUP BY\s+aguardando_retorno,\s+empresa_cliente,\s+nome_analista/i.test(sqlAguardandoForcado), sqlAguardandoForcado);

const sqlSemAnalistaNoGroupBy = `
SELECT TOP 10000 empresa_cliente, aguardando_retorno, COUNT(*) AS qtd_chamados
FROM base
WHERE status_chamado IN ('Pendente', 'Andamento')
  AND sla_situacao_atual_chamado = 'Em atraso'
  AND aguardando_retorno IS NOT NULL
GROUP BY empresa_cliente, aguardando_retorno
`;
[
  'me liste apenas os chamados em aberto e em atraso aguardando retorno do atendente',
  'me liste apenas os chamados em aberto e em atraso aguardando retorno do consultor',
  'Agora me liste apenas os chamados em aberto e em atraso aguardando retorno do analista',
  'Agora me liste apenas os chamados em aberto e em atraso aguardando retorno do atendente agrupado por cliente',
].forEach(mensagem => {
  const sqlAnalistaForcado = runner._test._sanitizarSqlSelectDataset(
    sqlSemAnalistaNoGroupBy,
    { sql_base: '', erp: 'SoftExpert' },
    'data_abertura_chamado',
    ['empresa_cliente', 'aguardando_retorno', 'nome_analista', 'chamado', 'status_chamado', 'sla_situacao_atual_chamado'],
    mensagem,
    camposChamados,
  );
  assert(/\bnome_analista\b/i.test(sqlAnalistaForcado), `${mensagem}\n${sqlAnalistaForcado}`);
  assert(/SELECT TOP 10000\s+nome_analista,\s+empresa_cliente,\s+aguardando_retorno,\s+COUNT\(\*\) AS qtd_chamados/i.test(sqlAnalistaForcado), sqlAnalistaForcado);
  assert(/GROUP BY\s+nome_analista,\s+empresa_cliente,\s+aguardando_retorno/i.test(sqlAnalistaForcado), sqlAnalistaForcado);
});

const camposPermitidosChamadosSla = [
  'chamado',
  'empresa_cliente',
  'dias_duracao_chamado',
  'horas_duracao_chamado',
  'dias_duracao_com_suporte',
  'dias_duracao_com_fsw',
  'dias_duracao_com_fabricante',
  'dias_duracao_com_cliente',
  'dias_duracao_com_TIcliente',
  'sla_horas_pa_chamado',
];
const sqlDuracaoGenerica = `
SELECT TOP 10000 empresa_cliente, AVG(dias_duracao_chamado) AS media_dias
FROM base
GROUP BY empresa_cliente
`;
[
  ['quanto tempo o chamado ficou com o cliente', 'dias_duracao_com_cliente'],
  ['qual o tempo medio que os chamados ficaram em testes com o usuario do cliente', 'dias_duracao_com_cliente'],
  ['tempo medio que o chamado ficou com a TI do cliente', 'dias_duracao_com_TIcliente'],
  ['SLA por tempo com a area de tecnologia do cliente', 'dias_duracao_com_TIcliente'],
  ['tempo medio dos chamados com o fabricante Protheus', 'dias_duracao_com_fabricante'],
  ['tempo que o chamado ficou com a Softexpert fabricante', 'dias_duracao_com_fabricante'],
  ['tempo dos chamados com desenvolvimento FSW', 'dias_duracao_com_fsw'],
  ['tempo que os chamados ficaram com a empresa J2A', 'dias_duracao_com_suporte'],
  ['tempo com suporte da C3I', 'dias_duracao_com_suporte'],
  ['duracao total em horas do chamado', 'horas_duracao_chamado'],
].forEach(([mensagem, colunaEsperada]) => {
  const sqlSlaArea = runner._test._sanitizarSqlSelectDataset(
    sqlDuracaoGenerica,
    { sql_base: '', erp: 'SoftExpert' },
    'data_abertura_chamado',
    camposPermitidosChamadosSla,
    mensagem,
    camposChamados,
  );
  assert(sqlSlaArea.includes(`AVG(${colunaEsperada}) AS media_dias`), `${mensagem}\n${sqlSlaArea}`);
});

console.log('faturamento-dataset-semantico.test.js: ok');

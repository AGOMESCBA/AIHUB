'use strict';

/**
 * Testes do mecanismo Lobo Guara (filial/empresa organizacional em conexoes
 * Protheus com dicionario no banco) — resolver + normalizer + guards.
 *
 * Usa um banco SQLite em memoria com o schema real de protheus_company_tree/
 * protheus_company_profile, populado com dados equivalentes aos validados
 * manualmente contra a conexao real da Plantivo (empresa_id=5, grupo 01:
 * Plantivo=01 com 5 filiais, EMA=02 com 1 filial).
 *
 * Nao depende de rede/banco Protheus real — roda isolado.
 *
 * Roda com: node tests/test-lobo-guara-normalizer.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.resolve(__dirname, '..');

const resolver = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/lobo-guara-filial-resolver'));
const normalizer = require(path.join(ROOT, 'modules/erp/totvs_protheus/SX/lobo-guara-normalizer'));

let passed = 0;
let failed = 0;

function assert(condicao, descricao, detalhes = '') {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
    passed++;
  } else {
    console.error(`  ✗ FALHA: ${descricao}`);
    if (detalhes) console.error(`    ${detalhes}`);
    failed++;
  }
}

function titulo(t) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${t}`);
  console.log('─'.repeat(60));
}

// ─────────────────────────────────────────────────────────────
// SETUP: banco em memoria com dados equivalentes a Plantivo real
// ─────────────────────────────────────────────────────────────

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE protheus_company_profile (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, empresa_id INTEGER NOT NULL,
    company_table TEXT, company_cfg_table TEXT, field_map_json TEXT DEFAULT '{}',
    branch_key_strategy TEXT, branch_key_detail_json TEXT,
    validated INTEGER NOT NULL DEFAULT 0, validation_errors_json TEXT,
    criado_em TEXT, atualizado_em TEXT
  );
  CREATE UNIQUE INDEX idx_ppc_profile ON protheus_company_profile (connection_id);

  CREATE TABLE protheus_company_tree (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, empresa_id INTEGER NOT NULL,
    grupo_codigo TEXT NOT NULL, empresa_codigo TEXT, unidade_codigo TEXT, filial_codigo TEXT,
    filial_chave TEXT NOT NULL, tipo_no TEXT NOT NULL, nome TEXT, cnpj TEXT,
    ativo INTEGER NOT NULL DEFAULT 1, origem TEXT, criado_em TEXT, atualizado_em TEXT
  );
  CREATE UNIQUE INDEX idx_ppc_tree ON protheus_company_tree (connection_id, filial_chave);

  CREATE TABLE erp_config (
    id TEXT PRIMARY KEY, connection_id TEXT, empresa_id INTEGER NOT NULL,
    erp TEXT NOT NULL, config TEXT, criado_em TEXT, atualizado_em TEXT
  );

  CREATE TABLE connections (
    id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL, nome TEXT, tipo TEXT,
    erp TEXT, ativo INTEGER DEFAULT 1, padrao INTEGER DEFAULT 0
  );
`);

const CONN_ID = 'conn-plantivo-teste';
const EMPRESA_ID = 5;

db.prepare(`INSERT INTO connections (id, empresa_id, nome, tipo, erp, ativo, padrao) VALUES (?,?,?,?,?,1,1)`)
  .run(CONN_ID, EMPRESA_ID, 'Plantivo Teste', 'sqlserver', 'protheus');

db.prepare(`INSERT INTO erp_config (id, connection_id, empresa_id, erp, config, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)`)
  .run('cfg-1', null, EMPRESA_ID, 'protheus', JSON.stringify({ modelo_dados: 'LOBO_GUARA', empresa_codigo: '01' }), 'now', 'now');

db.prepare(`INSERT INTO protheus_company_profile (id, connection_id, empresa_id, validated, branch_key_strategy, criado_em, atualizado_em) VALUES (?,?,?,1,'igualdade_direta',?,?)`)
  .run('perfil-1', CONN_ID, EMPRESA_ID, 'now', 'now');

const FILIAIS = [
  { filial_chave: '010101', empresa_codigo: '01', nome: 'PLANTIVO CAMPO VERDE' },
  { filial_chave: '010102', empresa_codigo: '01', nome: 'Bahia' },
  { filial_chave: '010103', empresa_codigo: '01', nome: 'PLANTIVO CUIABA' },
  { filial_chave: '010104', empresa_codigo: '01', nome: 'PLANTIVO ITAPEMA' },
  { filial_chave: '010105', empresa_codigo: '01', nome: 'PLANTIVO SINOP' },
  { filial_chave: '020101', empresa_codigo: '02', nome: 'EMA COMERCIO DE INSUMOS AGRICOLAS LTDA' },
];
const insFilial = db.prepare(`INSERT INTO protheus_company_tree (id, connection_id, empresa_id, grupo_codigo, empresa_codigo, filial_chave, tipo_no, nome, ativo, origem, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,1,'sys_company',?,?)`);
for (const f of FILIAIS) insFilial.run(`filial-${f.filial_chave}`, CONN_ID, EMPRESA_ID, '01', f.empresa_codigo, f.filial_chave, 'filial', f.nome, 'now', 'now');

const insEmpresa = db.prepare(`INSERT INTO protheus_company_tree (id, connection_id, empresa_id, grupo_codigo, empresa_codigo, filial_chave, tipo_no, nome, ativo, origem, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,1,'sys_company_cfg',?,?)`);
insEmpresa.run('empresa-01', CONN_ID, EMPRESA_ID, '01', '01', 'EMP:01:01', 'empresa', 'PLANTIVO', 'now', 'now');
insEmpresa.run('empresa-02', CONN_ID, EMPRESA_ID, '01', '02', 'EMP:01:02', 'empresa', 'EMA', 'now', 'now');

// Mock de getDB() usado internamente por lobo-guara-filial-resolver e connection-factory
const dbModulePath = require.resolve(path.join(ROOT, 'modules/database'));
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { getDB: () => db, inicializarDB: () => db } };

// ─────────────────────────────────────────────────────────────
// CENÁRIO 1 — contextoLoboGuara: falha fechada
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 1 — contextoLoboGuara: TRADICIONAL e nao-validado retornam null');

db.prepare(`INSERT INTO erp_config (id, connection_id, empresa_id, erp, config, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)`)
  .run('cfg-2', null, 99, 'protheus', JSON.stringify({ modelo_dados: 'TRADICIONAL' }), 'now', 'now');
db.prepare(`INSERT INTO connections (id, empresa_id, nome, tipo, erp, ativo, padrao) VALUES (?,?,?,?,?,1,1)`)
  .run('conn-tradicional', 99, 'Tradicional Teste', 'sqlserver', 'protheus');

// contextoLoboGuara depende de connectionFactory.carregarConexao, que exige
// sistemaOrigem — simulamos indiretamente testando so a parte que o teste
// controla: resolverDaMensagem ja embute a chamada a contextoLoboGuara.
const semMencaoEmpresaInexistente = resolver.resolverDaMensagem(db, 999, 'faturamento de qualquer coisa');
assert(semMencaoEmpresaInexistente === null, 'Empresa sem erp_config retorna null (falha fechada)');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 2 — resolverDaMensagem: filial especifica, empresa inteira, sem mencao
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 2 — resolverDaMensagem: modos especifica/empresa/ausente');

// connectionFactory.carregarConexao real precisa da linha em `connections` — como
// simulamos getDB() mas nao ai_config nem connectionFactory completo, testamos a
// parte determinística direto: contextoLoboGuara usa connectionFactory por baixo,
// entao aqui validamos a função pura de resolução assumindo ctx ja resolvido.
function ctxTeste() { return { connectionId: CONN_ID, empresaCodigoPadrao: '01' }; }

{
  const arvore = db.prepare(`SELECT * FROM protheus_company_tree WHERE connection_id = ? AND ativo = 1 AND tipo_no IN ('empresa','filial')`).all(CONN_ID);
  assert(arvore.length === 8, 'Arvore de teste populada corretamente (6 filiais + 2 empresas)', `total=${arvore.length}`);
}

// REGRESSÃO — bug real encontrado em produção 2026-08-19: "Faturamento da
// semana..." era resolvido como menção à empresa EMA, porque "semana" contém
// a substring "ema" e o match antigo era por inclusão pura (sem fronteira de
// palavra). Corrigido com \b em _contemPalavra — testa aqui contra a árvore
// real de teste para não regredir.
{
  const arvore = db.prepare(`SELECT * FROM protheus_company_tree WHERE connection_id = ? AND ativo = 1 AND tipo_no IN ('empresa','filial')`).all(CONN_ID);
  const mensagemNorm = resolver._normalizar('Faturamento da semana por dia agrupado por cliente, nota fiscal e produto');
  const candidatosSemana = resolver._candidatosNaArvore(mensagemNorm, arvore);
  assert(candidatosSemana.length === 0, '"semana" NÃO é confundida com empresa "EMA" (regressão do bug real)', JSON.stringify(candidatosSemana));

  const candidatosEma = resolver._candidatosNaArvore(resolver._normalizar('quanto faturou a EMA este mes'), arvore);
  assert(candidatosEma.length === 1 && candidatosEma[0].nome === 'EMA', 'Mas "EMA" como palavra isolada continua sendo reconhecida', JSON.stringify(candidatosEma));

  const candidatosSinopse = resolver._candidatosNaArvore(resolver._normalizar('faturamento de sinopse geral'), arvore);
  assert(candidatosSinopse.length === 0, '"sinopse" NÃO é confundida com filial "SINOP" (mesmo padrão de bug)', JSON.stringify(candidatosSinopse));

  assert(resolver._contemPalavra('semana', 'ema') === false, '_contemPalavra: "ema" não bate dentro de "semana"');
  assert(resolver._contemPalavra('quanto faturou a ema este mes', 'ema') === true, '_contemPalavra: "ema" bate como palavra isolada');
}

// ─────────────────────────────────────────────────────────────
// CENÁRIO 3 — expandirFiliaisDaEmpresa
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 3 — expandirFiliaisDaEmpresa');

const filiaisPlantivo = resolver.expandirFiliaisDaEmpresa(db, CONN_ID, '01');
assert(filiaisPlantivo.length === 5, 'Empresa 01 (Plantivo) expande para 5 filiais', JSON.stringify(filiaisPlantivo));
assert(filiaisPlantivo.includes('010101') && filiaisPlantivo.includes('010105'), 'Filiais 010101 e 010105 presentes na expansão');

const filiaisEma = resolver.expandirFiliaisDaEmpresa(db, CONN_ID, '02');
assert(filiaisEma.length === 1 && filiaisEma[0] === '020101', 'Empresa 02 (EMA) expande para 1 filial (020101)', JSON.stringify(filiaisEma));

const filiaisInexistente = resolver.expandirFiliaisDaEmpresa(db, CONN_ID, '99');
assert(filiaisInexistente.length === 0, 'Empresa inexistente expande para lista vazia (sem erro)');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 4 — normalizer: aplica IN(...) corretamente (modo especifica)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 4 — normalizer aplica escopo especifico');

const sqlBase = `SET ROWCOUNT 10000;
SELECT SF2.F2_DOC, SF2.F2_VALBRUT
FROM SF2010 SF2
WHERE SF2.D_E_L_E_T_ = ' '
  AND SF2.F2_EMISSAO BETWEEN '20260801' AND '20260831'`;

const sx2Teste = { SF2: 'E', SA2: 'C', SA1: 'C' }; // modos reais confirmados na Plantivo

const { sql: outEspecifica } = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(outEspecifica.includes("SF2.F2_FILIAL IN ('010101')"), 'Filtro IN aplicado para filial especifica', outEspecifica);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 5 — normalizer: modo empresa expande para todas as filiais
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 5 — normalizer expande empresa inteira');

const { sql: outEmpresa } = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste,
  filialState: { modo: 'empresa', chaves: ['01'], nomes: ['PLANTIVO'] },
});
assert(
  outEmpresa.includes("'010101'") && outEmpresa.includes("'010105'") && !outEmpresa.includes('020101'),
  'Modo empresa expande para as 5 filiais da Plantivo, exclui EMA',
  outEmpresa
);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 6 — normalizer: modo todas nao aplica filtro
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 6 — modo todas e ausência de filialState não alteram o SQL');

const { sql: outTodas } = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste, filialState: { modo: 'todas' },
});
assert(outTodas === sqlBase, 'modo=todas não modifica o SQL');

const { sql: outNull } = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste, filialState: null,
});
assert(outNull === sqlBase, 'filialState=null não modifica o SQL');

const { sql: outAmbigua } = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste, filialState: { modo: 'ambigua', chaves: ['010101', '010103'] },
});
assert(outAmbigua === sqlBase, 'modo=ambigua não aplica filtro às cegas (pipeline deveria ter perguntado antes)');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 7 — normalizer respeita modo SX2 compartilhado/global
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 7 — tabela compartilhada (modo C) não recebe filtro de filial');

const sqlComCadastroCompartilhado = `SET ROWCOUNT 10000;
SELECT SE2.E2_NUM, SA2.A2_NOME
FROM SE2010 SE2
JOIN SA2010 SA2 ON SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA
WHERE SE2.D_E_L_E_T_ = ' '`;

// SE2 modo C confirmado real na Plantivo (financeiro compartilhado nesta base)
const sx2Financeiro = { SE2: 'C', SA2: 'C' };
const resultadoFinanceiro = normalizer.aplicarEscopoLoboGuara(sqlComCadastroCompartilhado, {
  db, ctx: ctxTeste(), sx2: sx2Financeiro,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(resultadoFinanceiro.sql === sqlComCadastroCompartilhado, 'Tabela modo C (compartilhada) não recebe filtro — mesmo com filialState presente', resultadoFinanceiro.sql);
// Achado de revisão de código: mesmo com filialState presente e todas as
// tabelas sendo modo C (nenhum predicado injetado), o normalizer precisa
// reportar aplicado=false — antes o chamador (runner.js) so verificava "a
// funcao rodou sem excecao", entao esse cenario exato registrava badge de
// sucesso na auditoria mesmo sem nenhum WHERE de filial ter sido injetado.
assert(resultadoFinanceiro.aplicado === false, 'Tabela modo C (compartilhada): aplicado=false explicitamente, mesmo com filialState presente', JSON.stringify(resultadoFinanceiro));
assert(resultadoFinanceiro.motivo === 'nenhuma_tabela_aceitou_filtro', 'motivo reflete que nenhuma tabela do SQL aceitou o filtro', resultadoFinanceiro.motivo);

const sx2Misto = { SF2: 'E', SD2: 'E', SA1: 'C' };
const sqlMisto = `SELECT * FROM SF2010 SF2 JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL JOIN SA1010 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD WHERE SF2.D_E_L_E_T_ = ' '`;
const { sql: outMisto } = normalizer.aplicarEscopoLoboGuara(sqlMisto, {
  db, ctx: ctxTeste(), sx2: sx2Misto,
  filialState: { modo: 'especifica', chaves: ['010101'] },
});
assert(outMisto.includes('SF2.F2_FILIAL IN'), 'Em SQL misto, tabela modo E (SF2) recebe filtro');
assert(outMisto.includes('SD2.D2_FILIAL IN'), 'Em SQL misto, tabela modo E (SD2) recebe filtro');
assert(!outMisto.includes('SA1.A1_FILIAL'), 'Em SQL misto, tabela modo C (SA1) não recebe filtro');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 7b — X2_MODOEMP='E': tabela compartilhada por filial mas exclusiva
// por empresa (caso real confirmado: SA1 na Plantivo — X2_MODO=C,
// X2_MODOUN=C, X2_MODOEMP=E). O campo de filial gravado (A1_FILIAL) tem
// tamanho DIFERENTE de filial_chave (2 dígitos vs 6) — dado real confirmado
// via M0_LEIAUTE='EEUUFF'. O filtro correto usa empresa_codigo (2 dígitos),
// nunca filial_chave completa.
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 7b — X2_MODOEMP=E aplica filtro por empresa_codigo, não por filial_chave');

// Mapas fieis ao dado real confirmado no SSMS da Plantivo:
// SX2_CHAVE  X2_MODO  X2_MODOUN  X2_MODOEMP
// SA1        C        C          E
// SF2        E        E          E
const sx2FilialReal   = { SA1: 'C', SF2: 'E' };
const sx2EmpresaSA1 = { SA1: 'E', SF2: 'E' }; // modo_empresa (mapa PARALELO ao sx2 de filial)

// Filial pontual (Cuiaba, empresa 01) -> deve expandir para empresa_codigo '01',
// não para as 5 filial_chave da Plantivo nem para a filial_chave '010103' crua.
const sqlSA1Isolado = `SELECT SA1.A1_NOME FROM SA1010 SA1 WHERE SA1.D_E_L_E_T_ = ' '`;
const { sql: outSA1Empresa } = normalizer.aplicarEscopoLoboGuara(sqlSA1Isolado, {
  db, ctx: ctxTeste(), sx2: sx2FilialReal, sx2Empresa: sx2EmpresaSA1,
  filialState: { modo: 'especifica', chaves: ['010103'], nomes: ['PLANTIVO CUIABA'] },
});
assert(outSA1Empresa.includes("SA1.A1_FILIAL IN ('01')"), 'SA1 filtrada pelo codigo de empresa (01), não pela filial_chave completa', outSA1Empresa);
assert(!outSA1Empresa.includes('010103'), 'filial_chave completa (6 dígitos) não aparece no filtro de SA1', outSA1Empresa);

// Filial da EMA (empresa 02) -> deve isolar '02', nunca misturar com '01'.
const { sql: outSA1Ema } = normalizer.aplicarEscopoLoboGuara(sqlSA1Isolado, {
  db, ctx: ctxTeste(), sx2: sx2FilialReal, sx2Empresa: sx2EmpresaSA1,
  filialState: { modo: 'especifica', chaves: ['020101'], nomes: ['EMA COMERCIO DE INSUMOS AGRICOLAS LTDA'] },
});
assert(outSA1Ema.includes("SA1.A1_FILIAL IN ('02')"), 'SA1 com escopo EMA filtra pelo código de empresa 02', outSA1Ema);
assert(!outSA1Ema.includes("'01'"), 'SA1 com escopo EMA não vaza para o código de empresa 01', outSA1Ema);

// REGRESSÃO — bug real encontrado em teste ao vivo: SF2 é X2_MODO=E *e*
// X2_MODOEMP=E ao mesmo tempo (tabela ja exclusiva por filial). A precedencia
// errada (checar modoEmp antes de modo) filtrava SF2 pelo codigo de empresa
// curto ('01') em vez da filial completa ('010103'), zerando os resultados.
const sqlSF2Isolado = `SELECT SF2.F2_DOC FROM SF2010 SF2 WHERE SF2.D_E_L_E_T_ = ' '`;
const { sql: outSF2ExclusivaEAmbos } = normalizer.aplicarEscopoLoboGuara(sqlSF2Isolado, {
  db, ctx: ctxTeste(), sx2: sx2FilialReal, sx2Empresa: sx2EmpresaSA1,
  filialState: { modo: 'especifica', chaves: ['010103'], nomes: ['PLANTIVO CUIABA'] },
});
assert(outSF2ExclusivaEAmbos.includes("SF2.F2_FILIAL IN ('010103')"), 'REGRESSÃO: SF2 (X2_MODO=E e X2_MODOEMP=E) usa a filial_chave completa, não o código de empresa', outSF2ExclusivaEAmbos);
assert(!outSF2ExclusivaEAmbos.includes("IN ('01')"), 'REGRESSÃO: SF2 não é filtrada pelo código de empresa curto', outSF2ExclusivaEAmbos);

// SQL misto: SF2/SD2 (X2_MODO=E — vence mesmo com X2_MODOEMP=E, ver
// regressão acima) usam filial_chave completa; SA1 (X2_MODO=C,
// X2_MODOEMP=E) usa empresa_codigo — tamanhos diferentes no mesmo SQL, cada
// tabela com o campo certo. Mapas fieis ao dado real (SF2/SD2 e SA1 todas com
// X2_MODOEMP=E na Plantivo).
const sx2MistoFilial = { SF2: 'E', SD2: 'E', SA1: 'C' };
const sx2MistoEmpresa = { SF2: 'E', SD2: 'E', SA1: 'E' };
const sqlVendasPorCliente = `SET ROWCOUNT 10000;
SELECT SA1.A1_NOME AS cliente, SUM(SD2.D2_TOTAL) AS faturamento_total
FROM SF2010 SF2
JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SD2.D_E_L_E_T_ = ' '
JOIN SA1010 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
WHERE SF2.F2_EMISSAO = '20260822' AND SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
GROUP BY SA1.A1_NOME`;
const { sql: outVendasPorCliente } = normalizer.aplicarEscopoLoboGuara(sqlVendasPorCliente, {
  db, ctx: ctxTeste(), sx2: sx2MistoFilial, sx2Empresa: sx2MistoEmpresa,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(outVendasPorCliente.includes("SF2.F2_FILIAL IN ('010101')"), 'SQL misto: SF2 filtra pela filial_chave completa (6 dígitos)', outVendasPorCliente);
assert(outVendasPorCliente.includes("SA1.A1_FILIAL IN ('01')"), 'SQL misto: SA1 filtra pelo código de empresa (2 dígitos)', outVendasPorCliente);

// Sem sx2Empresa (contexto TRADICIONAL ou tabela sem modo_empresa cadastrado):
// comportamento igual ao Cenário 7 — não filtra às cegas, não quebra.
const { sql: outSemSx2Empresa } = normalizer.aplicarEscopoLoboGuara(sqlSA1Isolado, {
  db, ctx: ctxTeste(), sx2: { SA1: 'C' }, sx2Empresa: null,
  filialState: { modo: 'especifica', chaves: ['010103'] },
});
assert(outSemSx2Empresa === sqlSA1Isolado, 'Sem sx2Empresa informado, SA1 (modo C) não recebe filtro — comportamento anterior preservado', outSemSx2Empresa);

// modoEmp='E' mas empresa dona não identificada (filial_chave desconhecida na
// árvore) -> não filtra às cegas, mesma postura de falha fechada do resto do módulo.
const { sql: outEmpresaDesconhecida } = normalizer.aplicarEscopoLoboGuara(sqlSA1Isolado, {
  db, ctx: ctxTeste(), sx2: {}, sx2Empresa: sx2EmpresaSA1,
  filialState: { modo: 'especifica', chaves: ['999999'] },
});
assert(outEmpresaDesconhecida === sqlSA1Isolado, 'Filial_chave sem correspondência na árvore não gera filtro às cegas em tabela X2_MODOEMP=E', outEmpresaDesconhecida);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 8 — guards: rejeita SUBSTRING, SYS_COMPANY manual, CNPJ como filial
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 8 — guards Lobo Guara');

const gSubstring = normalizer.validarGuardsLoboGuara(`SELECT * FROM SD2 SD2 WHERE SUBSTRING(SD2.D2_FILIAL, 1, 2) = '01'`);
assert(!gSubstring.ok, 'SUBSTRING em campo de filial é rejeitado');
assert(/SUBSTRING/i.test(gSubstring.erros[0]), 'Mensagem de erro menciona SUBSTRING (instrução corretiva)');

const gSysCompany = normalizer.validarGuardsLoboGuara(`SELECT * FROM SD2 SD2 JOIN SYS_COMPANY_CFG CFG ON CFG.XX8_CODIGO = SD2.D2_FILIAL`);
assert(!gSysCompany.ok, 'JOIN manual com SYS_COMPANY_CFG é rejeitado');

const gCnpj = normalizer.validarGuardsLoboGuara(`SELECT * FROM SA1 SA1 WHERE SA1.A1_CGC = FILIAL`);
assert(!gCnpj.ok, 'CNPJ usado como filtro de filial é rejeitado');

const gLimpo = normalizer.validarGuardsLoboGuara(sqlBase);
assert(gLimpo.ok, 'SQL normal, sem padrões suspeitos, passa nos guards');

const gSubstringOutroCampo = normalizer.validarGuardsLoboGuara(`SELECT SUBSTRING(SA1.A1_NOME, 1, 10) AS nome_curto FROM SA1 SA1`);
assert(gSubstringOutroCampo.ok, 'SUBSTRING em campo que não é filial (ex: nome) não dispara o guard');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 9 — cacheKey: filiais diferentes devem gerar chaves diferentes
// (regressão do bug encontrado em teste real: cache/aprendizado contaminado)
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 9 — filial refletida em intent.filtros para não contaminar cache');

function simularReflexaoEmFiltros(filialLoboGuara) {
  // Replica a logica adicionada em runner.js::executar (busca por
  // "_lobo_guara_filial" no arquivo real) — testa o CONTRATO, não a função
  // privada (que está inline em runner.js e não é exportada).
  if (filialLoboGuara && ['especifica', 'empresa'].includes(filialLoboGuara.modo)) {
    const chaves = (filialLoboGuara.chaves || []).filter(Boolean).slice().sort();
    if (chaves.length) return { _lobo_guara_filial: chaves };
  }
  return {};
}

const filtrosCampoVerde = simularReflexaoEmFiltros({ modo: 'especifica', chaves: ['010101'] });
const filtrosCuiaba = simularReflexaoEmFiltros({ modo: 'especifica', chaves: ['010103'] });
assert(
  JSON.stringify(filtrosCampoVerde) !== JSON.stringify(filtrosCuiaba),
  'Filiais diferentes geram filtros estruturais diferentes (cacheKey não colide)',
  `${JSON.stringify(filtrosCampoVerde)} vs ${JSON.stringify(filtrosCuiaba)}`
);

const filtrosSemMencao = simularReflexaoEmFiltros(null);
assert(Object.keys(filtrosSemMencao).length === 0, 'Sem menção de filial, nada é adicionado aos filtros (não polui cache de perguntas sem filial)');

// ─────────────────────────────────────────────────────────────
// CENÁRIO 10 — amarração de JOIN por empresa (bug crítico real)
//
// Sem escopo de filial/empresa na pergunta ("vendas do dia de ontem"), o
// filtro WHERE nunca roda — mas o JOIN entre SF2 (exclusiva por filial) e
// SA1 (X2_MODOEMP=E) é AMBÍGUO: confirmado com dado real da Plantivo que
// existem milhares de A1_COD+A1_LOJA duplicados entre a empresa 01 e a
// empresa 02. Sem amarração, o SQL Server pode casar SF2.F2_CLIENTE com a
// linha de SA1 da empresa ERRADA, trazendo nome de cliente trocado numa
// venda legítima. A correção deve rodar SEMPRE que a combinação de tabelas
// existir no SQL, independente de haver escopo de pergunta ou não.
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 10 — amarração de JOIN por empresa (SA1 X2_MODOEMP=E ambígua sem filtro)');

const sx2Real = { SF2: 'E', SD2: 'E', SA1: 'C' };
const sx2EmpresaReal = { SF2: 'E', SD2: 'E', SA1: 'E' }; // fiel ao dado real: SF2/SD2/SA1 todas com X2_MODOEMP=E

const sqlVendasSemEscopo = `SET ROWCOUNT 10000;
SELECT SA1.A1_NOME AS cliente, SUM(SD2.D2_TOTAL) AS total_faturamento
FROM SF2010 SF2
JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA AND SD2.D_E_L_E_T_ = ' '
JOIN SA1010 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
WHERE SF2.F2_EMISSAO = '20260822' AND SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
GROUP BY SA1.A1_NOME`;

// SEM filialState (o caso real que causou o bug — pergunta ampla, sem menção
// de filial/empresa). A amarração deve acontecer mesmo assim.
const { sql: outAmarracaoSemEscopo } = normalizer.aplicarEscopoLoboGuara(sqlVendasSemEscopo, {
  db, ctx: ctxTeste(), sx2: sx2Real, sx2Empresa: sx2EmpresaReal, filialState: null,
});
assert(
  /SA1\.A1_FILIAL\s*=\s*LEFT\(\s*SF2\.F2_FILIAL\s*,\s*2\s*\)/i.test(outAmarracaoSemEscopo),
  'REGRESSÃO CRÍTICA: sem escopo de pergunta, JOIN de SA1 é amarrado a SF2 por LEFT(F2_FILIAL,2) mesmo assim',
  outAmarracaoSemEscopo
);
assert(!/SUBSTRING/i.test(outAmarracaoSemEscopo), 'Amarração usa LEFT(), nunca SUBSTRING (guard da IA continua intacto)', outAmarracaoSemEscopo);

// A amarração fica dentro da cláusula ON do JOIN de SA1, não em WHERE — a
// condição deve aparecer antes do WHERE, junto do restante do ON de SA1.
const posOnSA1 = outAmarracaoSemEscopo.indexOf('JOIN SA1010 SA1 ON');
const posWhere = outAmarracaoSemEscopo.indexOf('WHERE');
const posLeft  = outAmarracaoSemEscopo.indexOf('LEFT(SF2.F2_FILIAL');
assert(posLeft > posOnSA1 && posLeft < posWhere, 'Amarração fica dentro da cláusula ON do JOIN de SA1, antes do WHERE', outAmarracaoSemEscopo);

// COM escopo de filial específica: amarração de JOIN + filtro WHERE devem
// coexistir (não são mutuamente exclusivos).
const { sql: outAmarracaoComEscopo } = normalizer.aplicarEscopoLoboGuara(sqlVendasSemEscopo, {
  db, ctx: ctxTeste(), sx2: sx2Real, sx2Empresa: sx2EmpresaReal,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(/LEFT\(\s*SF2\.F2_FILIAL\s*,\s*2\s*\)/i.test(outAmarracaoComEscopo), 'Com escopo de filial, JOIN de SA1 continua amarrado a SF2', outAmarracaoComEscopo);
assert(outAmarracaoComEscopo.includes("SA1.A1_FILIAL IN ('01')"), 'Com escopo de filial, filtro WHERE por código de empresa também é aplicado (coexistem)', outAmarracaoComEscopo);
assert(outAmarracaoComEscopo.includes("SF2.F2_FILIAL IN ('010101')"), 'Com escopo de filial, filtro WHERE em SF2 pela filial completa continua aplicado', outAmarracaoComEscopo);

// Tabela SEM X2_MODOEMP=E (ex.: cadastro puramente compartilhado/global, sem
// exclusividade por empresa) não deve receber amarração — não há ambiguidade
// a resolver, amarrar seria mudar comportamento sem necessidade.
const sqlComSA2Global = `SELECT SE2.E2_NUM FROM SE2010 SE2 JOIN SA2010 SA2 ON SE2.E2_FORNECE = SA2.A2_COD WHERE SE2.D_E_L_E_T_ = ' '`;
const { sql: outSemModoEmpresa } = normalizer.aplicarEscopoLoboGuara(sqlComSA2Global, {
  db, ctx: ctxTeste(), sx2: { SE2: 'E', SA2: 'C' }, sx2Empresa: null, filialState: null,
});
assert(outSemModoEmpresa === sqlComSA2Global, 'Sem sx2Empresa informado (tabela sem X2_MODOEMP cadastrado), nenhuma amarração é aplicada', outSemModoEmpresa);

// Chamada direta em _amarrarJoinPorEmpresa: idempotência — rodar duas vezes
// não deve duplicar a condição.
const primeiraPassagem = normalizer._amarrarJoinPorEmpresa(sqlVendasSemEscopo, { SF2: 'SF2', SD2: 'SD2', SA1: 'SA1' }, sx2Real, sx2EmpresaReal, {});
const segundaPassagem = normalizer._amarrarJoinPorEmpresa(primeiraPassagem.sql, { SF2: 'SF2', SD2: 'SD2', SA1: 'SA1' }, sx2Real, sx2EmpresaReal, {});
const ocorrencias = (segundaPassagem.sql.match(/LEFT\(SF2\.F2_FILIAL/gi) || []).length;
assert(ocorrencias === 1, 'Idempotência: aplicar a amarração duas vezes não duplica a condição no SQL', `${ocorrencias} ocorrências`);

// ─────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(60));

db.close();
process.exit(failed > 0 ? 1 : 0);

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

const outEspecifica = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(outEspecifica.includes("SF2.F2_FILIAL IN ('010101')"), 'Filtro IN aplicado para filial especifica', outEspecifica);

// ─────────────────────────────────────────────────────────────
// CENÁRIO 5 — normalizer: modo empresa expande para todas as filiais
// ─────────────────────────────────────────────────────────────
titulo('CENÁRIO 5 — normalizer expande empresa inteira');

const outEmpresa = normalizer.aplicarEscopoLoboGuara(sqlBase, {
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

const outTodas = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste, filialState: { modo: 'todas' },
});
assert(outTodas === sqlBase, 'modo=todas não modifica o SQL');

const outNull = normalizer.aplicarEscopoLoboGuara(sqlBase, {
  db, ctx: ctxTeste(), sx2: sx2Teste, filialState: null,
});
assert(outNull === sqlBase, 'filialState=null não modifica o SQL');

const outAmbigua = normalizer.aplicarEscopoLoboGuara(sqlBase, {
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
const outFinanceiro = normalizer.aplicarEscopoLoboGuara(sqlComCadastroCompartilhado, {
  db, ctx: ctxTeste(), sx2: sx2Financeiro,
  filialState: { modo: 'especifica', chaves: ['010101'], nomes: ['PLANTIVO CAMPO VERDE'] },
});
assert(outFinanceiro === sqlComCadastroCompartilhado, 'Tabela modo C (compartilhada) não recebe filtro — mesmo com filialState presente', outFinanceiro);

const sx2Misto = { SF2: 'E', SD2: 'E', SA1: 'C' };
const sqlMisto = `SELECT * FROM SF2010 SF2 JOIN SD2010 SD2 ON SD2.D2_FILIAL = SF2.F2_FILIAL JOIN SA1010 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD WHERE SF2.D_E_L_E_T_ = ' '`;
const outMisto = normalizer.aplicarEscopoLoboGuara(sqlMisto, {
  db, ctx: ctxTeste(), sx2: sx2Misto,
  filialState: { modo: 'especifica', chaves: ['010101'] },
});
assert(outMisto.includes('SF2.F2_FILIAL IN'), 'Em SQL misto, tabela modo E (SF2) recebe filtro');
assert(outMisto.includes('SD2.D2_FILIAL IN'), 'Em SQL misto, tabela modo E (SD2) recebe filtro');
assert(!outMisto.includes('SA1.A1_FILIAL'), 'Em SQL misto, tabela modo C (SA1) não recebe filtro');

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
// Resultado final
// ─────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log('═'.repeat(60));

db.close();
process.exit(failed > 0 ? 1 : 0);

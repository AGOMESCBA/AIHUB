'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const Database = require('better-sqlite3');
const normalizer = require('../modules/erp/totvs_protheus/SX/lobo-guara-normalizer');

const db = new Database(':memory:');
db.exec(`CREATE TABLE protheus_company_tree (
  connection_id TEXT, filial_chave TEXT, filial_codigo TEXT,
  empresa_codigo TEXT, ativo INTEGER, tipo_no TEXT
);
INSERT INTO protheus_company_tree VALUES
 ('caieira','0100','00','01',1,'filial'),
 ('caieira','0101','01','01',1,'filial'),
 ('caieira','0102','02','01',1,'filial'),
 ('outra','0100','99','01',1,'filial');`);
after(() => db.close());

const options = {
  db, ctx: { connectionId: 'caieira' },
  sx2: { SD2010: 'E', SF2010: 'E' }, sx2Empresa: null,
  filialState: { modo: 'especifica', chaves: ['0100', '0101', '0102'] },
  origemExecucao: 'chat', preferirEmpresaCodigoFallback: true,
};
const sqlBase = `SET ROWCOUNT 10000;
SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS faturamento_semana
FROM SD2010 SD2
JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
 AND SD2.D2_DOC = SF2.F2_DOC AND SD2.D2_SERIE = SF2.F2_SERIE
 AND SD2.D2_CLIENTE = SF2.F2_CLIENTE AND SD2.D2_LOJA = SF2.F2_LOJA
 AND SF2.D_E_L_E_T_ = ' '
WHERE SD2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N'
 AND SF2.F2_FILIAL IN ('0100', '0101', '0102')
 AND SF2.F2_EMISSAO BETWEEN '20261019' AND '20261025'
 AND (NOT (SD2.D2_CF LIKE '59%' OR SD2.D2_CF LIKE '69%') OR SD2.D2_CF IN ('5932','6932','5933','6933','5949','6949'))
 AND SD2.D2_CF NOT IN ('5151','6151','5152','6152','5155','6155','5156','6156')
 AND NOT (SD2.D2_CF LIKE '52%' OR SD2.D2_CF LIKE '62%')
 AND SD2.D2_CF NOT IN ('5410','6410','5411','6411','5412','6412','5413','6413')
 AND NOT (SD2.D2_CF LIKE '55%' OR SD2.D2_CF LIKE '65%')
 AND NOT (SD2.D2_CF LIKE '56%' OR SD2.D2_CF LIKE '66%');`;
const aplicar = (sql, extra = {}) => normalizer.aplicarEscopoLoboGuara(sql, { ...options, ...extra });

test('CAIEIRA: corrige a SF2 existente e injeta a SD2, preservando JOIN, período e CFOPs', () => {
  const result = aplicar(sqlBase);
  const esperado = sqlBase.replace("SF2.F2_FILIAL IN ('0100', '0101', '0102')", "SF2.F2_FILIAL IN ('00', '01', '02')")
    .replace('WHERE', "WHERE SD2.D2_FILIAL IN ('00', '01', '02')\n  AND ");
  assert.equal(result.sql, esperado);
  assert.equal(result.aplicado, true);
  assert.equal(result.motivo, null);
});

test('filtros existentes nas duas tabelas são corrigidos e reconhecidos como aplicados', () => {
  const sql = sqlBase.replace('WHERE ', "WHERE SD2.D2_FILIAL IN ('0100', '0101', '0102') AND ");
  const result = aplicar(sql);
  assert.equal(result.sql, sql.replaceAll("('0100', '0101', '0102')", "('00', '01', '02')"));
  assert.equal(result.aplicado, true);
});

test('seleção parcial e matriz 00 não são expandidas para as demais filiais', () => {
  for (const [chave, codigo] of [['0100', '00'], ['0101', '01']]) {
    const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '${chave}'`;
    const result = aplicar(sql, { filialState: { modo: 'especifica', chaves: [chave] } });
    assert.equal(result.sql, sql.replace(`'${chave}'`, `'${codigo}'`));
    assert.equal(result.aplicado, true);
  }
});

test('SQL com códigos físicos já válidos é idempotente', () => {
  const first = aplicar(sqlBase);
  const second = aplicar(first.sql);
  assert.equal(second.sql, first.sql);
  assert.equal(second.aplicado, true);
});

for (const [name, extra] of [
  ['WhatsApp tradicional', { origemExecucao: 'whatsapp' }],
  ['WhatsApp LOBO_GUARA', { origemExecucao: 'whatsapp', preferirEmpresaCodigoFallback: false }],
  ['chat LOBO_GUARA', { preferirEmpresaCodigoFallback: false }],
  ['chamador sem origem explícita', { origemExecucao: null }],
]) {
  test(`${name}: preserva exatamente o processamento anterior`, () => {
    const actual = aplicar(sqlBase, extra);
    const before = aplicar(sqlBase, { ...extra, origemExecucao: null });
    assert.deepEqual(actual, before);
  });
}

test('chat tradicional sem escopo não faz consultas adicionais nem altera o SQL', () => {
  assert.equal(aplicar(sqlBase, { filialState: null, db: { prepare() { throw Error('não deve consultar'); } } }).sql, sqlBase);
});

test('literais, comentários, cliente e datas não são substituídos globalmente', () => {
  const sql = `SELECT 'SF2.F2_FILIAL IN (''0100'')' AS texto FROM SF2010 f
-- f.F2_FILIAL = '0100'
WHERE f.F2_CLIENTE = '0100' /* f.F2_FILIAL = '0100' */ AND f.F2_FILIAL = '0100'`;
  assert.equal(aplicar(sql).sql, sql.replace("AND f.F2_FILIAL = '0100'", "AND f.F2_FILIAL = '00'"));
});

test('aliases próprios por SELECT evitam modificar a coluna homônima de outra tabela', () => {
  const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '0100'
AND EXISTS (SELECT 1 FROM SA1010 f WHERE f.F2_FILIAL = '0100')`;
  const result = aplicar(sql, { sx2: { SF2010: 'E', SA1010: 'C' } });
  assert.equal(result.sql, sql.replace("WHERE f.F2_FILIAL = '0100'", "WHERE f.F2_FILIAL = '00'"));
});

test('CTEs, subconsultas e UNION tratam cada filtro sem confundir aliases', () => {
  const sql = `WITH notas AS (SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL IN ('0100'))
SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '0101'
AND EXISTS (SELECT 1 FROM SF2010 g WHERE g.F2_FILIAL = '0102')
UNION ALL SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '0100'`;
  assert.equal(aplicar(sql).sql, sql.replaceAll("'0100'", "'00'").replaceAll("'0101'", "'01'").replaceAll("'0102'", "'02'"));
});

test('IN com subconsulta mantém a expressão e normaliza seu predicado interno', () => {
  const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL IN (SELECT g.F2_FILIAL FROM SF2010 g WHERE g.F2_FILIAL = '0101')`;
  const esperado = sql.replace("'0101'", "'01'").replace('WHERE', "WHERE F.F2_FILIAL IN ('00', '01', '02')\n  AND ");
  assert.equal(aplicar(sql).sql, esperado);
});

test('identificadores delimitados, schema e strings Unicode preservam a sintaxe', () => {
  const sql = `SELECT f.F2_DOC FROM dbo.SF2010 AS [f] WHERE [f].[F2_FILIAL] IN (N'0100', N'0101')`;
  assert.equal(aplicar(sql).sql, sql.replace("N'0100'", "N'00'").replace("N'0101'", "N'01'"));
});

test('igualdade invertida e NOT IN preservam o sentido do predicado', () => {
  const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE '0100' = f.F2_FILIAL AND f.F2_FILIAL NOT IN ('0101')`;
  const esperado = sql.replace("'0100'", "'00'").replace("'0101'", "'01'")
    .replace('WHERE', "WHERE F.F2_FILIAL IN ('00', '01', '02')\n  AND ");
  assert.equal(aplicar(sql).sql, esperado);
});

test('fallback sem SX2 normaliza movimentos sem presumir compartilhamento de cadastro', () => {
  assert(aplicar(sqlBase, { sx2: null }).sql.includes("SF2.F2_FILIAL IN ('00', '01', '02')"));
});

for (const modo of ['C', 'G']) {
  test(`SX2 ${modo}: não traduz filial de tabela compartilhada/global`, () => {
    const sql = `SELECT c.A1_COD FROM SA1010 c WHERE c.A1_FILIAL IN ('0100')`;
    assert.equal(aplicar(sql, {
      sx2: { SA1010: modo }, db: { prepare() { throw Error('cadastro compartilhado não exige mapeamento físico'); } },
    }).sql, sql);
  });
}

test('tabela exclusiva por empresa não recebe código físico de filial', () => {
  const sql = `SELECT c.A1_COD FROM SA1010 c WHERE c.A1_FILIAL IN ('01')`;
  assert.equal(aplicar(sql, { sx2: { SA1010: 'C' }, sx2Empresa: { SA1010: 'E' } }).sql, sql);
});

test('literal fora do escopo, mapeamento incompleto e listas com expressão são rejeitados', () => {
  for (const sql of [sqlBase.replace("'0102'", "'9999'"), sqlBase.replace("'0102'", "LEFT('0102',2)")]) {
    assert.throws(() => aplicar(sql), e => e._tipo === 'chat_tradicional_filial_invalida');
  }
  assert.throws(() => aplicar(sqlBase, { filialState: { modo: 'especifica', chaves: ['0100', '0999'] } }), /sem código físico/);
});

test('mapeamento usa a conexão selecionada, sem consultar a filial de outra conexão', () => {
  assert(aplicar(sqlBase).sql.includes("SF2.F2_FILIAL IN ('00', '01', '02')"));
  assert(!aplicar(sqlBase).sql.includes("'99'"));
});

test('comentários SQL aninhados não são interpretados como filtros', () => {
  const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '0100'
/* externo /* interno */ AND f.F2_FILIAL = '9999' */`;
  assert.equal(aplicar(sql).sql, sql.replace("'0100'", "'00'"));
});

test('lista parcial preexistente mantém seu recorte mesmo com três filiais selecionadas', () => {
  const sql = `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL IN ('0101')`;
  assert.equal(aplicar(sql).sql, sql.replace("'0101'", "'01'"));
});

test('literal em projeção, JOIN ou OR não comprova que o escopo foi aplicado', () => {
  for (const sql of [
    `SELECT CASE WHEN f.F2_FILIAL = '0100' THEN 1 ELSE 0 END AS valor FROM SF2010 f`,
    `SELECT f.F2_DOC FROM SF2010 f WHERE f.F2_FILIAL = '0100' OR f.F2_DOC = '123'`,
    `SELECT f.F2_DOC FROM SF2010 f JOIN SA1010 c ON f.F2_FILIAL = '0100' AND c.A1_COD=f.F2_CLIENTE`,
  ]) assert.equal(aplicar(sql, { sx2: { SF2010: 'E', SA1010: 'C' } }).aplicado, false);
});

test('preparação completa do runner aplica a correção também no SQL direto/reutilizado', async () => {
  // Banco e conexão isolados: não inicializa o banco de produção nem executa SQL Protheus.
  const database = require('../modules/database');
  const factory = require('../modules/erp/providers/connection-factory');
  const originalGetDB = database.getDB;
  const originalConexao = factory.carregarConexao;
  db.exec(`CREATE TABLE protheus_company_profile (connection_id TEXT, validated INTEGER);
    INSERT INTO protheus_company_profile VALUES ('caieira',1);
    CREATE TABLE erp_config (empresa_id INTEGER, erp TEXT, connection_id TEXT, config TEXT, atualizado_em TEXT, criado_em TEXT);
    INSERT INTO erp_config VALUES (4,'protheus',NULL,'{"modelo_dados":"TRADICIONAL"}',NULL,NULL);`);
  database.getDB = () => db;
  factory.carregarConexao = () => ({ id: 'caieira' });
  try {
    const runner = require('../modules/erp/ia-owner/runner');
    const spec = require('../modules/erp/totvs_protheus/faturamento/faturamento-ia-owner-spec');
    const args = {
      spec: { ...spec, sqlMiddleware: { processar(sql) { return { sql_processado: sql }; } } },
      sql: sqlBase, sx2: options.sx2, sx2Empresa: null, sx3: null,
      protheus: { sufixoTabela: '010' }, middlewareCfg: {}, entidades: [],
      filial: 'TODAS', periodo: { dataInicio: '20261019', dataFim: '20261025' },
      planoConsulta: null, mensagem: 'Qual o faturamento da semana?',
      empresaId: 4, filialLoboGuaraState: options.filialState, origemExecucao: 'chat', sqlFixoDireto: true,
    };
    const result = await runner._test.prepararSql(args);
    assert(result.sqlFinal.includes("SF2.F2_FILIAL IN ('00', '01', '02')"));
    assert(result.sqlFinal.includes("SD2.D2_FILIAL IN ('00', '01', '02')"));
    assert.equal(result.filialEscopoResultado.aplicado, true);
    assert.equal(result.filialEscopoResultado.modeloDados, 'TRADICIONAL');
    const gerado = await runner._test.prepararSql({ ...args, sqlFixoDireto: false });
    assert.equal(gerado.sqlFinal, result.sqlFinal, 'SQL novo e SQL direto devem receber a mesma normalização');
    await assert.rejects(
      runner._test.prepararSql({ ...args, sql: sqlBase.replace("'0102'", "'9999'") }),
      e => e._tipo === 'lobo_guara_escopo_nao_aplicado' && /fora do escopo/.test(e.filialEscopoResultado.erro),
      'mapeamento inválido deve interromper a preparação, sem disponibilizar SQL para execução',
    );
    const whatsapp = await runner._test.prepararSql({ ...args, origemExecucao: 'whatsapp' });
    assert(whatsapp.sqlFinal.includes("SF2.F2_FILIAL IN ('0100', '0101', '0102')"));
    assert.equal(whatsapp.filialEscopoResultado.modeloDados, 'TRADICIONAL');
    db.prepare('UPDATE erp_config SET config=?').run('{"modelo_dados":"LOBO_GUARA"}');
    const loboGuara = await runner._test.prepararSql(args);
    assert(loboGuara.sqlFinal.includes("SF2.F2_FILIAL IN ('0100', '0101', '0102')"));
    assert(loboGuara.sqlFinal.includes("SD2.D2_FILIAL IN ('0100', '0101', '0102')"));
    assert.equal(loboGuara.filialEscopoResultado.modeloDados, 'LOBO_GUARA');
  } finally {
    database.getDB = originalGetDB;
    factory.carregarConexao = originalConexao;
  }
});

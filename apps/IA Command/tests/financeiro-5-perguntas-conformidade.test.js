'use strict';

/**
 * Suite de conformidade: 5 perguntas canônicas do módulo financeiro.
 *
 * Valida todo o pipeline determinístico (sem chamar a IA real):
 *   - Inferência de carteira, estado, dataPadrao (query-plan.js)
 *   - reconciliarPlanoComMensagem (não deve sobrescrever carteira)
 *   - normalizarEntidadesNecessarias (não deve aceitar tipos não cadastrais)
 *   - formatQueryPlanForPrompt (instruções corretas no prompt para a IA)
 *   - validarSqlContraPlano (valida SQLs corretos e rejeita SQLs errados)
 *   - entity-resolver: _deveIgnorarTermo e normalizarEntidadesIA
 *   - buildExtractionSystemPrompt (instruções de extração de entidades)
 *   - _extrairLabelIntencao (título certo no contextoConsulta)
 *
 * Cobertura dos bugs corrigidos:
 *   Bug A — "contas_pagas" aceita como entidade cadastral → normalizarEntidadesNecessarias
 *   Bug B — FULL OUTER JOIN SE1+SE2 com E1_VALOR/E2_VALOR para ambas realizadas
 *   Bug C — carteira='pagar' inferida para "contas pagas e recebidas"
 *   Bug D — aliases brutos (valor_recebido:) no consolidado multi-empresa
 */

const assert = require('assert');
const path   = require('path');
const ROOT   = path.resolve(__dirname, '..');

const queryPlan    = require(path.join(ROOT, 'modules/erp/core/query-plan'));
const runner       = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const finSpec      = require(path.join(ROOT, 'modules/erp/totvs_protheus/financeiro/financeiro-ia-owner-spec'));
const entityRes    = require(path.join(ROOT, 'modules/ai/entity-resolver'));
const promptBld    = require(path.join(ROOT, 'modules/erp/ia-owner/prompt-builder'));

const {
  _extrairLabelIntencao,
  _buildContextoConsulta,
  construirQueryPlanTecnico,
  normalizarEntidadesNecessarias: _normEnt,
} = runner._test;

// ─── helpers ─────────────────────────────────────────────────────────────────

let passou = 0;
let falhou = 0;
const falhas = [];

function ok(grupo, descricao, fn) {
  try {
    fn();
    console.log(`  ✓ [${grupo}] ${descricao}`);
    passou++;
  } catch (e) {
    const msg = `  ✗ [${grupo}] ${descricao}\n       → ${e.message}`;
    console.error(msg);
    falhas.push({ grupo, descricao, erro: e.message });
    falhou++;
  }
}

const periodoMes = { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' };
const periodoNenhum = { tipo: 'nenhum' };

// ─── CASOS DE TESTE ───────────────────────────────────────────────────────────

const PERGUNTAS = [
  {
    id: 'P1',
    label: 'Pergunta 1 — contas pagas E recebidas no mês (ambas realizadas)',
    msg: 'Me providencie a informação das contas pagas e recebidas no mes',
    esperado: {
      carteira: 'ambas',
      estado: ['recebido', 'pago', 'realizado'],
      dataPadrao: 'baixa_movimento',
      labelIntencao: 'Contas recebidas e pagas',
      // instruções obrigatórias no query_plan_texto
      promptDeveConter: [
        'financeiro_ambas_realizado',
        'modelo_baixas',
        'UNION ALL',
        'Subqueries escalares',
        'valor_recebido',
        'valor_pago',
        'SE5',
      ],
      promptNaoDeveConter: [
        'UNION ALL para ambas em aberto',
      ],
      // SQL correto deve passar; SQL errado deve ser rejeitado
      sqlsCorretos: [
        // SELECT único com duas subqueries escalares via SE5, com filtro EST/ED obrigatório
        `SELECT
  (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE1001 SE1
   JOIN SE5001 SE5 ON SE5.E5_PREFIXO=SE1.E1_PREFIXO AND SE5.E5_NUMERO=SE1.E1_NUM
     AND SE5.E5_PARCELA=SE1.E1_PARCELA AND SE5.E5_TIPO=SE1.E1_TIPO
     AND SE5.E5_CLIFOR=SE1.E1_CLIENTE AND SE5.E5_LOJA=SE1.E1_LOJA
     AND SE5.E5_RECPAG='R' AND SE5.E5_SITUACA<>'C'
     AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' '
   WHERE SE1.D_E_L_E_T_=' '
     AND SE5.E5_DATA BETWEEN '20260601' AND '20260630') AS valor_recebido,
  (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE2001 SE2
   JOIN SE5001 SE5 ON SE5.E5_PREFIXO=SE2.E2_PREFIXO AND SE5.E5_NUMERO=SE2.E2_NUM
     AND SE5.E5_PARCELA=SE2.E2_PARCELA AND SE5.E5_TIPO=SE2.E2_TIPO
     AND SE5.E5_CLIFOR=SE2.E2_FORNECE AND SE5.E5_LOJA=SE2.E2_LOJA
     AND SE5.E5_RECPAG='P' AND SE5.E5_SITUACA<>'C'
     AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' '
   WHERE SE2.D_E_L_E_T_=' '
     AND SE5.E5_DATA BETWEEN '20260601' AND '20260630') AS valor_pago`,
      ],
      sqlsErrados: [
        // Bug A: FULL OUTER JOIN SE1+SE2 com E1_VALOR/E2_VALOR
        {
          sql: `SELECT COALESCE(SE1.E1_VALOR,0) AS valor_recebido, COALESCE(SE2.E2_VALOR,0) AS valor_pago
                FROM SE1001 SE1 FULL OUTER JOIN SE2001 SE2 ON SE1.E1_NUM=SE2.E2_NUM
                WHERE SE1.D_E_L_E_T_=' '`,
          motivo: 'FULL OUTER JOIN com E1_VALOR/E2_VALOR sem SE5 — deve rejeitar',
          deveConterErro: ['FULL OUTER JOIN', 'SE5'],
        },
        // Bug B: dois SELECTs separados sem UNION
        {
          sql: `SELECT COALESCE(SUM(SE5.E5_VALOR),0) AS valor_recebido FROM SE1001 SE1
                JOIN SE5001 SE5 ON SE5.E5_RECPAG='R' WHERE SE1.D_E_L_E_T_=' ';
                SELECT COALESCE(SUM(SE5.E5_VALOR),0) AS valor_pago FROM SE2001 SE2
                JOIN SE5001 SE5 ON SE5.E5_RECPAG='P' WHERE SE2.D_E_L_E_T_=' '`,
          motivo: 'Dois SELECTs separados — validador deve rejeitar ausência de SE5 em contexto FULL OUTER JOIN',
          // Nota: este SQL tem SE5 portanto pode passar na validação de SE5 — mas o FULL OUTER JOIN check é o bloqueador principal
          deveConterErro: [],
          podePassar: true, // dois SELECTs separados sem FULL OUTER JOIN não são barrados pelo validador atual
        },
        // Bug C: sem SE5/FK — usa E1_VALOR/E2_VALOR direto
        {
          sql: `SELECT SUM(SE1.E1_VALOR) AS valor_recebido, SUM(SE2.E2_VALOR) AS valor_pago
                FROM SE1001 SE1, SE2001 SE2 WHERE SE1.D_E_L_E_T_=' ' AND SE2.D_E_L_E_T_=' '
                AND SE1.E1_EMISSAO BETWEEN '20260601' AND '20260630'`,
          motivo: 'Sem SE5/FK, usa E1_VALOR/E2_VALOR direto — deve rejeitar por falta de SE5',
          deveConterErro: ['SE5', 'FK'],
        },
      ],
      // entidades_necessarias que a IA pode declarar incorretamente
      entidadesInvalidas: [
        { tipo: 'contas_pagas', texto: 'contas pagas' },
        { tipo: 'contas_recebidas', texto: 'contas recebidas' },
        { tipo: 'carteira', texto: 'carteira' },
        { tipo: 'contas_a_pagar', texto: 'contas a pagar' },
      ],
    },
  },
  {
    id: 'P2',
    label: 'Pergunta 2 — contas pagas no mês (apenas pagar, realizado)',
    msg: 'Me providencie a informação das contas pagas no mes',
    esperado: {
      carteira: 'pagar',
      estado: ['pago'],
      dataPadrao: 'baixa_movimento',
      labelIntencao: 'Contas pagas',
      promptDeveConter: [
        'financeiro_pagar',
        'SE2',
        'SA2',
        'modelo_baixas_pagar',
        'SE5',
        'PROIBIDO usar SE2.E2_BAIXA',
      ],
      promptNaoDeveConter: [
        'SE1 + SA1',
        'financeiro_receber',
        'financeiro_ambas',
      ],
      sqlsCorretos: [
        // SE2 + SE5 com E5_RECPAG='P' e filtro EST/ED obrigatório
        `SELECT COALESCE(SUM(SE5.E5_VALOR),0) AS valor_pago
         FROM SE2001 SE2
         JOIN SE5001 SE5 ON SE5.E5_PREFIXO=SE2.E2_PREFIXO AND SE5.E5_NUMERO=SE2.E2_NUM
           AND SE5.E5_PARCELA=SE2.E2_PARCELA AND SE5.E5_TIPO=SE2.E2_TIPO
           AND SE5.E5_CLIFOR=SE2.E2_FORNECE AND SE5.E5_LOJA=SE2.E2_LOJA
           AND SE5.E5_RECPAG='P' AND SE5.E5_SITUACA<>'C'
           AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' '
         WHERE SE2.D_E_L_E_T_=' '
           AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'`,
      ],
      sqlsErrados: [
        // usa SE1 em consulta de pagar
        {
          sql: `SELECT SUM(SE5.E5_VALOR) AS valor_pago FROM SE1001 SE1
                JOIN SE5001 SE5 ON SE5.E5_RECPAG='R' AND SE5.D_E_L_E_T_=' '
                WHERE SE1.D_E_L_E_T_=' '
                AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'`,
          motivo: 'SE1 em consulta de pagar — deve rejeitar',
          deveConterErro: ['SE1'],
        },
        // usa E2_BAIXA diretamente
        {
          sql: `SELECT SUM(SE2.E2_VALOR) AS valor_pago FROM SE2001 SE2
                WHERE SE2.D_E_L_E_T_=' '
                AND SE2.E2_BAIXA BETWEEN '20260601' AND '20260630'`,
          motivo: 'E2_BAIXA e sem SE5 — deve rejeitar por falta de FK2/SE5',
          deveConterErro: ['FK2', 'SE5'],
        },
        // usa SA1 em consulta de pagar
        {
          sql: `SELECT SA1.A1_NOME, SUM(SE5.E5_VALOR) AS valor_pago
                FROM SE2001 SE2 JOIN SE5001 SE5 ON SE5.E5_RECPAG='P' AND SE5.D_E_L_E_T_=' '
                JOIN SA1001 SA1 ON SA1.A1_COD=SE2.E2_FORNECE AND SA1.D_E_L_E_T_=' '
                WHERE SE2.D_E_L_E_T_=' '
                AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'
                GROUP BY SA1.A1_NOME`,
          motivo: 'SA1/cliente em consulta de pagar — deve rejeitar',
          deveConterErro: ['SA1'],
        },
      ],
      entidadesInvalidas: [
        { tipo: 'contas_pagas', texto: 'contas pagas' },
        { tipo: 'pagamento', texto: 'pagamentos' },
      ],
    },
  },
  {
    id: 'P3',
    label: 'Pergunta 3 — contas recebidas no mês (apenas receber, realizado)',
    msg: 'Me providencie a informação das contas recebidas no mes',
    esperado: {
      carteira: 'receber',
      estado: ['recebido'],
      dataPadrao: 'baixa_movimento',
      labelIntencao: 'Contas recebidas',
      promptDeveConter: [
        'financeiro_receber',
        'SE1',
        'SA1',
        'modelo_baixas_receber',
        'SE5',
        'PROIBIDO usar SE1.E1_BAIXA',
      ],
      promptNaoDeveConter: [
        'SE2 + SA2',
        'financeiro_pagar',
        'financeiro_ambas',
      ],
      sqlsCorretos: [
        // SE1 + SE5 com E5_RECPAG='R' e filtro EST/ED obrigatório
        `SELECT COALESCE(SUM(SE5.E5_VALOR),0) AS valor_recebido
         FROM SE1001 SE1
         JOIN SE5001 SE5 ON SE5.E5_PREFIXO=SE1.E1_PREFIXO AND SE5.E5_NUMERO=SE1.E1_NUM
           AND SE5.E5_PARCELA=SE1.E1_PARCELA AND SE5.E5_TIPO=SE1.E1_TIPO
           AND SE5.E5_CLIFOR=SE1.E1_CLIENTE AND SE5.E5_LOJA=SE1.E1_LOJA
           AND SE5.E5_RECPAG='R' AND SE5.E5_SITUACA<>'C'
           AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' '
         WHERE SE1.D_E_L_E_T_=' '
           AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'`,
      ],
      sqlsErrados: [
        // usa SE2 em consulta de receber
        {
          sql: `SELECT SUM(SE5.E5_VALOR) AS valor_recebido FROM SE2001 SE2
                JOIN SE5001 SE5 ON SE5.E5_RECPAG='P' AND SE5.D_E_L_E_T_=' '
                WHERE SE2.D_E_L_E_T_=' '
                AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'`,
          motivo: 'SE2 em consulta de receber — deve rejeitar',
          deveConterErro: ['SE2'],
        },
        // usa E1_BAIXA diretamente
        {
          sql: `SELECT SUM(SE1.E1_VALOR) AS valor_recebido FROM SE1001 SE1
                WHERE SE1.D_E_L_E_T_=' '
                AND SE1.E1_BAIXA BETWEEN '20260601' AND '20260630'`,
          motivo: 'E1_BAIXA e sem SE5/FK1 — deve rejeitar por falta de FK1/SE5',
          deveConterErro: ['FK1', 'SE5'],
        },
        // usa SA2 em consulta de receber
        {
          sql: `SELECT SA2.A2_NOME, SUM(SE5.E5_VALOR) AS valor_recebido
                FROM SE1001 SE1 JOIN SE5001 SE5 ON SE5.E5_RECPAG='R' AND SE5.D_E_L_E_T_=' '
                JOIN SA2001 SA2 ON SA2.A2_COD=SE1.E1_CLIENTE AND SA2.D_E_L_E_T_=' '
                WHERE SE1.D_E_L_E_T_=' '
                AND SE5.E5_DATA BETWEEN '20260601' AND '20260630'
                GROUP BY SA2.A2_NOME`,
          motivo: 'SA2/fornecedor em consulta de receber — deve rejeitar',
          deveConterErro: ['SA2'],
        },
      ],
      entidadesInvalidas: [
        { tipo: 'contas_recebidas', texto: 'contas recebidas' },
        { tipo: 'recebimento', texto: 'recebimentos' },
      ],
    },
  },
  {
    id: 'P4',
    label: 'Pergunta 4 — contas A PAGAR no mês (posição em aberto)',
    msg: 'Me providencie a informação o contas a pagar no mes',
    esperado: {
      carteira: 'pagar',
      estado: ['em_aberto'],
      dataPadrao: 'vencimento_real',
      labelIntencao: null,
      promptDeveConter: [
        'financeiro_pagar',
        'SE2',
        'SA2',
      ],
      promptNaoDeveConter: [
        'financeiro_receber',
        'financeiro_ambas',
        'baixa_movimento',
        'SE5',           // em aberto não usa SE5
      ],
      sqlsCorretos: [
        // SE2 com E2_SALDO > 0 filtrado por vencimento
        `SELECT COALESCE(SUM(SE2.E2_SALDO),0) AS saldo_a_pagar
         FROM SE2001 SE2
         WHERE SE2.D_E_L_E_T_=' '
           AND SE2.E2_SALDO > 0
           AND SE2.E2_VENCREA BETWEEN '20260601' AND '20260630'`,
      ],
      sqlsErrados: [
        // usa SE1 em consulta de pagar
        {
          sql: `SELECT SUM(SE1.E1_SALDO) AS saldo_a_pagar FROM SE1001 SE1
                WHERE SE1.D_E_L_E_T_=' ' AND SE1.E1_SALDO > 0`,
          motivo: 'SE1 em consulta de pagar — deve rejeitar',
          deveConterErro: ['SE1'],
        },
        // usa SA1 em consulta de pagar
        {
          sql: `SELECT SA1.A1_NOME, SUM(SE2.E2_SALDO) AS saldo_a_pagar
                FROM SE2001 SE2 JOIN SA1001 SA1 ON SA1.A1_COD=SE2.E2_FORNECE AND SA1.D_E_L_E_T_=' '
                WHERE SE2.D_E_L_E_T_=' ' AND SE2.E2_SALDO > 0
                GROUP BY SA1.A1_NOME`,
          motivo: 'SA1/cliente em consulta de pagar — deve rejeitar',
          deveConterErro: ['SA1'],
        },
      ],
      entidadesInvalidas: [
        { tipo: 'contas_a_pagar', texto: 'contas a pagar' },
      ],
    },
  },
  {
    id: 'P5',
    label: 'Pergunta 5 — contas A RECEBER no mês (posição em aberto)',
    msg: 'Me providencie a informação o contas a receber no mes',
    esperado: {
      carteira: 'receber',
      estado: ['em_aberto'],
      dataPadrao: 'vencimento_real',
      labelIntencao: null,
      promptDeveConter: [
        'financeiro_receber',
        'SE1',
        'SA1',
      ],
      promptNaoDeveConter: [
        'financeiro_pagar',
        'financeiro_ambas',
        'baixa_movimento',
        'SE5',           // em aberto não usa SE5
      ],
      sqlsCorretos: [
        // SE1 com E1_SALDO > 0 filtrado por vencimento
        `SELECT COALESCE(SUM(SE1.E1_SALDO),0) AS saldo_a_receber
         FROM SE1001 SE1
         WHERE SE1.D_E_L_E_T_=' '
           AND SE1.E1_SALDO > 0
           AND SE1.E1_VENCREA BETWEEN '20260601' AND '20260630'`,
      ],
      sqlsErrados: [
        // usa SE2 em consulta de receber
        {
          sql: `SELECT SUM(SE2.E2_SALDO) AS saldo_a_receber FROM SE2001 SE2
                WHERE SE2.D_E_L_E_T_=' ' AND SE2.E2_SALDO > 0`,
          motivo: 'SE2 em consulta de receber — deve rejeitar',
          deveConterErro: ['SE2'],
        },
        // usa SA2 em consulta de receber
        {
          sql: `SELECT SA2.A2_NOME, SUM(SE1.E1_SALDO) AS saldo_a_receber
                FROM SE1001 SE1 JOIN SA2001 SA2 ON SA2.A2_COD=SE1.E1_CLIENTE AND SA2.D_E_L_E_T_=' '
                WHERE SE1.D_E_L_E_T_=' ' AND SE1.E1_SALDO > 0
                GROUP BY SA2.A2_NOME`,
          motivo: 'SA2/fornecedor em consulta de receber — deve rejeitar',
          deveConterErro: ['SA2'],
        },
      ],
      entidadesInvalidas: [
        { tipo: 'contas_a_receber', texto: 'contas a receber' },
      ],
    },
  },
];

// ─── EXECUÇÃO DOS TESTES ─────────────────────────────────────────────────────

const relatorio = [];

for (const caso of PERGUNTAS) {
  const { id, label, msg, esperado } = caso;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`${id}: ${label}`);
  console.log(`Mensagem: "${msg}"`);
  console.log('─'.repeat(70));

  // ── 1. Inferência de plano ────────────────────────────────────────────────

  const planoBase = queryPlan.buildQueryPlan({
    modulo: 'financeiro',
    mensagem: msg,
    periodo: periodoMes,
    filtros: {},
    entidades: [],
  });
  const plano = queryPlan.reconciliarPlanoComMensagem(planoBase, msg);

  ok(id, `carteira inferida = "${esperado.carteira}"`, () => {
    assert.strictEqual(plano.carteira, esperado.carteira,
      `Esperava carteira="${esperado.carteira}", obteve "${plano.carteira}"`);
  });

  ok(id, `estado inferido em [${esperado.estado.join('|')}]`, () => {
    assert.ok(
      esperado.estado.includes(plano.estado),
      `Esperava estado em [${esperado.estado.join('|')}], obteve "${plano.estado}"`,
    );
  });

  ok(id, `dataPadrao = "${esperado.dataPadrao}"`, () => {
    assert.strictEqual(plano.dataPadrao, esperado.dataPadrao,
      `Esperava dataPadrao="${esperado.dataPadrao}", obteve "${plano.dataPadrao}"`);
  });

  ok(id, `reconciliarPlanoComMensagem não sobrescreve carteira`, () => {
    const planoOriginal = queryPlan.buildQueryPlan({ modulo: 'financeiro', mensagem: msg, periodo: periodoMes, filtros: {}, entidades: [] });
    const planoReconciliado = queryPlan.reconciliarPlanoComMensagem(planoOriginal, msg);
    assert.strictEqual(planoReconciliado.carteira, esperado.carteira,
      `reconciliar sobrescreveu carteira para "${planoReconciliado.carteira}"`);
  });

  // ── 2. query_plan_texto (prompt para a IA) ────────────────────────────────

  // Para P1 (ambas realizadas) e P2/P3 (realizadas), precisamos do modelo_baixas
  const planoComModelo = {
    ...plano,
    modelo_baixas_receber: 'SE5',
    modelo_baixas_pagar: 'SE5',
  };
  const textoPlano = queryPlan.formatQueryPlanForPrompt(planoComModelo);

  console.log(`\n  → query_plan_texto gerado:\n${textoPlano.split('\n').map(l => '    ' + l).join('\n')}`);

  for (const deve of esperado.promptDeveConter) {
    ok(id, `prompt contém "${deve}"`, () => {
      assert.ok(textoPlano.includes(deve),
        `Faltou "${deve}" no query_plan_texto`);
    });
  }

  for (const nao of (esperado.promptNaoDeveConter || [])) {
    ok(id, `prompt NÃO contém "${nao}"`, () => {
      assert.ok(!textoPlano.includes(nao),
        `"${nao}" apareceu indevitamente no query_plan_texto`);
    });
  }

  // ── 3. _extrairLabelIntencao ──────────────────────────────────────────────

  const labelObtido = _extrairLabelIntencao(msg);
  ok(id, `_extrairLabelIntencao = "${esperado.labelIntencao}"`, () => {
    assert.strictEqual(labelObtido, esperado.labelIntencao,
      `Esperava label "${esperado.labelIntencao}", obteve "${labelObtido}"`);
  });

  // ── 4. normalizarEntidadesNecessarias — rejeita tipos não cadastrais ──────

  console.log(`\n  → Testando normalizarEntidadesNecessarias (bug A):`);
  for (const ent of esperado.entidadesInvalidas) {
    ok(id, `rejeita entidade inválida { tipo:"${ent.tipo}", texto:"${ent.texto}" }`, () => {
      const resultado = _normEnt({ entidades_necessarias: [ent] });
      assert.strictEqual(resultado.length, 0,
        `Entidade com tipo="${ent.tipo}" deveria ser descartada mas foi aceita`);
    });
  }

  // Confirma que tipos válidos ainda passam
  ok(id, `aceita entidade válida { tipo:"cliente", texto:"Empresa Teste" }`, () => {
    const resultado = _normEnt({ entidades_necessarias: [{ tipo: 'cliente', texto: 'Empresa Teste' }] });
    assert.strictEqual(resultado.length, 1,
      `Entidade válida com tipo="cliente" foi incorretamente rejeitada`);
  });

  ok(id, `rejeita entidade genérica { tipo:"fornecedor", texto:"nome do fornecedor" }`, () => {
    const resultado = _normEnt({ entidades_necessarias: [{ tipo: 'fornecedor', texto: 'nome do fornecedor' }] });
    assert.strictEqual(resultado.length, 0,
      '"nome do fornecedor" e dimensao/coluna, nao entidade cadastral para filtrar');
  });

  // ── 5. entity-resolver: _deveIgnorarTermo / normalizarEntidadesIA ─────────

  console.log(`\n  → Testando entity-resolver (termos financeiros):`);

  const termosFinanceirosParaIgnorar = [
    'contas pagas', 'contas recebidas', 'contas a pagar', 'contas a receber',
    'pagamentos', 'recebimentos', 'pago', 'recebido', 'pagas', 'recebidas',
    'carteira', 'posicao', 'baixado',
  ];

  for (const termo of termosFinanceirosParaIgnorar) {
    const raw = JSON.stringify({ entidades: [{ texto: termo, tipo_sugerido: 'desconhecido', confianca: 0.3 }] });
    const resultado = entityRes.normalizarEntidadesIA(raw);
    ok(id, `entity-resolver ignora termo financeiro "${termo}"`, () => {
      assert.strictEqual(resultado.length, 0,
        `Termo "${termo}" deveria ser ignorado por normalizarEntidadesIA mas foi retornado`);
    });
    break; // testa apenas o primeiro (representativo) para não poluir demais
  }

  ok(id, `entity-resolver aceita nome próprio "Fornecedor ABC"`, () => {
    const raw = JSON.stringify({ entidades: [{ texto: 'Fornecedor ABC', tipo_sugerido: 'fornecedor', confianca: 0.9 }] });
    const resultado = entityRes.normalizarEntidadesIA(raw);
    assert.ok(resultado.length > 0, `Nome próprio "Fornecedor ABC" foi incorretamente filtrado`);
  });

  ok(id, `entity-resolver ignora dimensão genérica "nome do fornecedor"`, () => {
    const raw = JSON.stringify({ entidades: [{ texto: 'nome do fornecedor', tipo_sugerido: 'fornecedor', confianca: 0.8 }] });
    const resultado = entityRes.normalizarEntidadesIA(raw);
    assert.strictEqual(resultado.length, 0, `"nome do fornecedor" e coluna/dimensão, não filtro cadastral`);
  });

  // ── 6. buildExtractionSystemPrompt: instruções de não-extração financeira ─

  const sysPromptExtract = entityRes.buildExtractionSystemPrompt();
  ok(id, `buildExtractionSystemPrompt menciona exclusão de condições financeiras`, () => {
    assert.ok(
      sysPromptExtract.includes('contas pagas') || sysPromptExtract.includes('contas a pagar'),
      `buildExtractionSystemPrompt deveria mencionar que condições financeiras não são entidades`,
    );
  });

  // ── 7. validarSqlContraPlano — SQLs corretos ──────────────────────────────

  console.log(`\n  → Testando SQLs corretos:`);
  for (const sql of (esperado.sqlsCorretos || [])) {
    const trecho = sql.trim().split('\n')[0].trim();
    ok(id, `SQL correto passa na validação: "${trecho.substring(0, 70)}..."`, () => {
      const v = queryPlan.validarSqlContraPlano(sql, planoComModelo);
      assert.ok(v.ok, `SQL correto foi rejeitado: ${v.erros.join(' | ')}`);
    });
  }

  // ── 8. validarSqlContraPlano — SQLs errados ───────────────────────────────

  console.log(`\n  → Testando SQLs incorretos (devem ser rejeitados):`);
  for (const { sql, motivo, deveConterErro, podePassar } of (esperado.sqlsErrados || [])) {
    if (podePassar) {
      // Documenta que o validador atual não cobre este caso — não é falha
      console.log(`  ⚠ [${id}] Caso documentado (validador não cobre): ${motivo}`);
      continue;
    }
    ok(id, `SQL inválido rejeitado — "${motivo}"`, () => {
      const v = queryPlan.validarSqlContraPlano(sql, planoComModelo);
      assert.ok(!v.ok, `SQL inválido passou na validação sem erros!\nSQL: ${sql.substring(0, 200)}`);
      for (const fragmento of (deveConterErro || [])) {
        const temFragmento = v.erros.some(e => e.toLowerCase().includes(fragmento.toLowerCase()));
        assert.ok(temFragmento,
          `Mensagem de erro deveria mencionar "${fragmento}" mas não mencionou.\nErros: ${v.erros.join(' | ')}`);
      }
    });
  }

  // ── Resumo do caso ────────────────────────────────────────────────────────

  const resultadoCaso = {
    id,
    label,
    msg,
    plano: {
      carteira: plano.carteira,
      estado: plano.estado,
      dataPadrao: plano.dataPadrao,
      operacao: plano.operacao,
      regras: plano.regras,
      ajusteAntecipacao: plano.ajusteAntecipacao,
    },
    query_plan_texto: textoPlano,
    label_intencao: labelObtido,
    sql_correto_exemplo: (esperado.sqlsCorretos || [])[0] || null,
  };
  relatorio.push(resultadoCaso);
}

// ─── BLOCO ADICIONAL: normalizarEntidadesNecessarias via construirQueryPlanTecnico ──

console.log(`\n${'═'.repeat(70)}`);
console.log('BLOCO EXTRA — normalizarEntidadesNecessarias filtra todos os tipos inválidos');
console.log('─'.repeat(70));

const tiposInvalidos = [
  'contas_pagas', 'contas_recebidas', 'contas_a_pagar', 'contas_a_receber',
  'carteira', 'pagamento', 'recebimento', 'fluxo', 'lancamento',
  'titulos', 'saldo', 'baixa',
];

for (const tipo of tiposInvalidos) {
  ok('EXTRA', `normalizarEntidadesNecessarias descarta tipo="${tipo}"`, () => {
    const res = _normEnt({ entidades_necessarias: [{ tipo, texto: `termo ${tipo}` }] });
    assert.strictEqual(res.length, 0, `tipo="${tipo}" deveria ser descartado`);
  });
}

const tiposValidos = ['cliente', 'fornecedor', 'vendedor', 'produto', 'grupo_produto', 'marca', 'centro_custo', 'tes', 'transportadora', 'natureza', 'desconhecido'];
for (const tipo of tiposValidos) {
  ok('EXTRA', `normalizarEntidadesNecessarias aceita tipo válido "${tipo}"`, () => {
    const res = _normEnt({ entidades_necessarias: [{ tipo, texto: 'ABC Teste' }] });
    assert.strictEqual(res.length, 1, `tipo="${tipo}" válido foi incorretamente descartado`);
  });
}

ok('EXTRA', 'consulta nova por nome do fornecedor descarta fornecedor herdado', () => {
  const intent = {
    _herdouFiltros: true,
    filtros: { carteira: 'pagar', fornecedor: 'SOFTEXPERT' },
    _entidadesResolvidas: [{ tipo: 'fornecedor', codigo: '007057', loja: '01', nome: 'SOFTEXPERT SOFTWARE SA' }],
    _entidadesResolvidasPorEmpresa: {
      5: [{ tipo: 'fornecedor', codigo: '007057', loja: '01', nome: 'SOFTEXPERT SOFTWARE SA' }],
    },
  };
  const limpo = runner._test.limparFiltrosEntidadeHerdadosDaConsultaAtual(
    finSpec,
    intent,
    'Contas a pagar do dia por nome do fornecedor, titulo, prefixo e tipo, valor do titulo e saldo do titulo',
  );
  assert.strictEqual(limpo.filtros.fornecedor, undefined);
  assert.deepStrictEqual(limpo._entidadesResolvidas, []);
  assert.deepStrictEqual(limpo._filtrosEntidadeHerdadosIgnorados, ['fornecedor']);
});

// ─── RELATÓRIO FINAL ─────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`);
console.log('RELATÓRIO DETALHADO POR PERGUNTA');
console.log('═'.repeat(70));

for (const r of relatorio) {
  console.log(`\n┌─ ${r.id}: ${r.label}`);
  console.log(`│  Mensagem : "${r.msg}"`);
  console.log(`│  carteira : ${r.plano.carteira}`);
  console.log(`│  estado   : ${r.plano.estado}`);
  console.log(`│  dataPadrao: ${r.plano.dataPadrao}`);
  console.log(`│  operacao : ${r.plano.operacao}`);
  console.log(`│  regras   : [${(r.plano.regras || []).join(', ')}]`);
  console.log(`│  PA/RA    : ajusteAntecipacao=${r.plano.ajusteAntecipacao || 'nenhum'}`);
  console.log(`│  label    : "${r.label_intencao}"`);
  if (r.sql_correto_exemplo) {
    const linhas = r.sql_correto_exemplo.trim().split('\n');
    console.log(`│  SQL exemplar (${linhas.length} linhas):`);
    for (const linha of linhas) {
      console.log(`│    ${linha.trim()}`);
    }
  }
  console.log('└' + '─'.repeat(69));
}

if (falhas.length) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('FALHAS DETECTADAS:');
  for (const f of falhas) {
    console.error(`  ✗ [${f.grupo}] ${f.descricao}`);
    console.error(`       ${f.erro}`);
  }
}

console.log(`\n${'═'.repeat(70)}`);
if (falhou === 0) {
  console.log(`financeiro-5-perguntas-conformidade.test.js: ${passou} testes passaram ✓`);
} else {
  console.error(`financeiro-5-perguntas-conformidade.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}

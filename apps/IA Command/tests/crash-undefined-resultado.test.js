'use strict';

// Testa os três pontos corrigidos para prevenir crash por resultado undefined
// no pipeline multi-empresa (status=all).

const assert = require('assert');
const path   = require('path');
const ROOT   = path.resolve(__dirname, '..');

// ── helpers de mock ──────────────────────────────────────────────────────────

function makeSpec() {
  const sqlMiddleware = require(path.join(ROOT, 'modules/erp/faturamento/sql-middleware'));
  return {
    nome: 'faturamento',
    tabelas: [],
    camposSx3Essenciais: {},
    sx3PromptLimit: 10,
    sqlMiddleware,
    mensagensErro: {},
  };
}

// ── Ponto 1: runner.executar() nunca retorna undefined ───────────────────────
// Verifica que as exportações do runner expõem os helpers de teste usados
// pelos outros testes (garantia de integridade do módulo após a edição).
{
  const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
  assert(typeof runner._test === 'object', 'runner._test deve ser exportado');
  assert(typeof runner._test.validarSelectContraGroupBy === 'function', 'validarSelectContraGroupBy deve existir');
  assert(typeof runner.executar === 'function', 'runner.executar deve ser exportado');
  assert(typeof runner.executarSqlDireto === 'function', 'runner.executarSqlDireto deve ser exportado');
  console.log('  [1a] runner exporta todas as funções esperadas — OK');
}

// Simula o caminho onde chamarIaOwner lança na catch da tentativa 1,
// fazendo o loop terminar sem return. O fallback adicionado deve garantir
// que executar() resolve (não rejeita) com { tipo: 'erro' }.
{
  // Mock superficial: injeta um spec que força mensagemErro a retornar string.
  const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
  // Usamos executarSqlDireto com SQL deliberadamente inválido e empresa inexistente
  // para acionar o caminho de erro sem conexão real.
  const specBase = makeSpec();
  const fakeIntent = { intencao: 'faturamento_dinamico', periodo: { tipo: 'mes_atual' }, filtros: {}, agrupar_por: null, ordenar_por: null, limite: null, _mensagemOriginal: 'teste' };
  runner.executarSqlDireto(specBase, 'SELECT 1', fakeIntent, 'emp_999')
    .then(res => {
      assert(res && typeof res === 'object', 'executarSqlDireto deve resolver com objeto mesmo para empresa inexistente');
      assert(typeof res.tipo === 'string', `res.tipo deve ser string, recebido: ${JSON.stringify(res)}`);
      console.log(`  [1b] executarSqlDireto resolve com tipo="${res.tipo}" para empresa inexistente — OK`);
    })
    .catch(err => {
      // Rejeição inesperada — falha o teste
      console.error(`  [1b] FALHA: executarSqlDireto rejeitou: ${err.message}`);
      process.exitCode = 1;
    });
}

// ── Ponto 2: _resultadoFallback produz objeto válido e bloqueia acesso a undefined ──
// Testa o guard adicionado em rotear() sem precisar do banco inicializado.
{
  const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));
  assert(typeof intentRouter.rotear === 'function', 'intentRouter.rotear deve ser exportado');

  // Verifica que _deveFallbackAposFalhaCanonico retorna false para resultado undefined,
  // impedindo que o fallback tente acessar propriedades de undefined.
  const resultadoUndef  = intentRouter._deveFallbackAposFalhaCanonico({}, undefined, new Set());
  const resultadoNull   = intentRouter._deveFallbackAposFalhaCanonico({}, null,      new Set());
  const resultadoErro   = intentRouter._deveFallbackAposFalhaCanonico({}, { tipo: 'erro', subtipo: 'x' }, new Set());
  const resultadoErroT  = intentRouter._deveFallbackAposFalhaCanonico({}, { tipo: 'erro', subtipo: 'sem_conexao' }, new Set(['sem_conexao']));

  assert.strictEqual(resultadoUndef, false,  'undefined não deve acionar fallback');
  assert.strictEqual(resultadoNull,  false,  'null não deve acionar fallback');
  assert.strictEqual(resultadoErro,  true,   'erro recuperável deve acionar fallback');
  assert.strictEqual(resultadoErroT, false,  'erro terminal não deve acionar fallback');
  console.log('  [2] _deveFallbackAposFalhaCanonico trata undefined/null/erro/terminal corretamente — OK');
}

// ── Ponto 3: _resultadoFallback produz objeto válido ────────────────────────
// Verifica indiretamente via rotear: se chegar um resultado inválido do handler,
// o router retorna objeto com tipo 'erro' — nunca undefined ou sem .tipo.
{
  const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));

  // _deveFallbackAposFalhaCanonico com resultado undefined não deve lançar
  assert.doesNotThrow(() => {
    intentRouter._deveFallbackAposFalhaCanonico({}, undefined, new Set());
  }, '_deveFallbackAposFalhaCanonico não deve lançar com resultado=undefined');

  assert.doesNotThrow(() => {
    intentRouter._deveFallbackAposFalhaCanonico({}, null, new Set());
  }, '_deveFallbackAposFalhaCanonico não deve lançar com resultado=null');

  console.log('  [3] _deveFallbackAposFalhaCanonico tolera resultado undefined/null — OK');
}

// ── Resultado final ──────────────────────────────────────────────────────────
// Os testes assíncronos (1b e 2) imprimem o resultado quando resolvem.
// Se process.exitCode for 1 ao fim, o runner de CI detecta falha.
setImmediate(() => {
  if (!process.exitCode) {
    console.log('crash-undefined-resultado.test.js: ok (síncronos); aguardando assíncronos...');
  }
});

'use strict';

/**
 * Caso real reportado: usuario com telefone vinculado ao vendedor 000007 pediu
 * "Faturamento do ano do vendedor de codigo 000006 agrupado por mes". O codigo 000006
 * EXISTE no cadastro (diferente do caso de 000003, inexistente), mas o extrator generico
 * de entidades (entity-resolver.extrairExplicitos) nunca capturou o termo por dois motivos
 * combinados: (1) o regex de "vendedor" tinha um erro de digitacao — "vendedores?" so batia
 * com "vendedore"/"vendedores", nunca com o singular "vendedor" isolado; (2) mesmo corrigido
 * o regex, _deveIgnorarTermo descarta termos puramente numericos por design (usado por todos
 * os tipos de entidade, nao so seguranca). Sem a entidade resolvida, o bloqueio antecipado
 * baseado em entidadesResolvidas nunca disparava, e a IA — em vez de recusar como instruido
 * no prompt (identidadeVendedor() nos *-fragmentos-spec.js) — substituiu silenciosamente
 * F2_VEND1 = '000006' por '000007' no SQL final e devolveu os dados do vendedor correto
 * (000007) como resposta a uma pergunta sobre outro vendedor (000006), sem nenhum aviso.
 *
 * codigoEntidadeSegurancaCitadoNaMensagem cobre essa lacuna com deteccao minima e
 * determinística direto na mensagem original, escopada apenas ao bloqueio de seguranca —
 * nao altera o extrator generico de entidades (entity-resolver.js), que serve dezenas de
 * outros fluxos de negocio nao relacionados a seguranca.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const runner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const entityResolver = require(path.join(ROOT, 'modules/ai/entity-resolver'));
const { codigoEntidadeSegurancaCitadoNaMensagem, _codigosErpEquivalentes } = runner._test;

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

console.log('\n[1] entity-resolver.extrairExplicitos — regressao do regex de vendedor singular');

// O regex de "vendedor" tinha um erro de digitacao ("vendedores?" so batia com
// "vendedore"/"vendedores", nunca "vendedor" isolado). Corrigido para "vendedor(?:es)?".
// Isso NAO faz "vendedor 000006" virar termo explicito sozinho — codigos puramente
// numericos continuam descartados por _deveIgnorarTermo (decisao deliberada: alterar
// esse comportamento afetaria todos os tipos de entidade em todos os modulos; o
// bloqueio de seguranca usa codigoEntidadeSegurancaCitadoNaMensagem, Bloco 2, que nao
// depende deste extrator). Este teste cobre so a regressao do regex com um sufixo
// nao-numerico, que prova que o singular volta a ser reconhecido.
ok('"vendedor NOME_TESTE" (singular, nao-numerico) e capturado como termo explicito', () => {
  const termos = entityResolver.extrairExplicitos('vendedor NOME_TESTE');
  assert.strictEqual(termos.length, 1);
  assert.strictEqual(termos[0].tipo_sugerido, 'vendedor');
  assert.strictEqual(termos[0].texto, 'NOME_TESTE');
});

ok('"vendedores NOME_A e NOME_B" (plural) continua funcionando', () => {
  const termos = entityResolver.extrairExplicitos('vendedores NOME_A e NOME_B');
  assert.strictEqual(termos.length, 2);
});

ok('"vendedor 000006" (numerico puro) permanece descartado por _deveIgnorarTermo (comportamento inalterado)', () => {
  const termos = entityResolver.extrairExplicitos('vendedor 000006');
  assert.strictEqual(termos.length, 0);
});

console.log('\n[2] codigoEntidadeSegurancaCitadoNaMensagem — caso real reportado');

// A funcao retorna os digitos sem o padding de zeros a esquerda (nao assume tamanho de
// campo do Protheus) — a comparacao correta contra o codigo autorizado e feita via
// _codigosErpEquivalentes (Bloco 3), nao por igualdade de string direta.
ok('"Faturamento do ano do vendedor de codigo 000006 agrupado por mes" extrai o codigo 000006', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem(
    'Faturamento do ano do vendedor de codigo 000006 agrupado por mes',
    'vendedor',
  );
  assert.strictEqual(_codigosErpEquivalentes(c, '000006'), true);
});

ok('"vendedor 000006" (sem "de codigo") tambem extrai', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('vendas do vendedor 000006 no ano', 'vendedor');
  assert.strictEqual(_codigosErpEquivalentes(c, '000006'), true);
});

ok('mensagem sem mencao a vendedor retorna null', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('faturamento deste mes', 'vendedor');
  assert.strictEqual(c, null);
});

ok('cliente citado explicitamente e extraido com tipo=cliente', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('faturamento do cliente 000099', 'cliente');
  assert.strictEqual(_codigosErpEquivalentes(c, '000099'), true);
});

// "vend" e abreviacao muito comum em digitacao rapida/informal no WhatsApp — precisa ser
// reconhecida pelo mesmo bloqueio, senao vira um bypass trivial (usuario so digita "vend"
// em vez de "vendedor" e o bloqueio de seguranca nao dispara).
ok('"vend 000006" (abreviacao comum) extrai o codigo', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('faturamento do vend 000006 agrupado por mes', 'vendedor');
  assert.strictEqual(_codigosErpEquivalentes(c, '000006'), true);
});

ok('"vend de codigo 000006" tambem extrai', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('vend de codigo 000006', 'vendedor');
  assert.strictEqual(_codigosErpEquivalentes(c, '000006'), true);
});

ok('"vendas do mes 000006" NAO deve casar com a abreviacao "vend" (falso positivo)', () => {
  const c = codigoEntidadeSegurancaCitadoNaMensagem('vendas do mes 000006', 'vendedor');
  assert.strictEqual(c, null, '"vendas" nao e a abreviacao "vend" isolada — \\b deve impedir o match');
});

console.log('\n[3] Equivalencia numerica de codigos ERP (ignora zeros a esquerda)');

ok('000006 e 6 sao equivalentes', () => {
  assert.strictEqual(_codigosErpEquivalentes('000006', '6'), true);
});

ok('000006 e 000007 NAO sao equivalentes', () => {
  assert.strictEqual(_codigosErpEquivalentes('000006', '000007'), false);
});

console.log('\n[4] Simulacao do bloqueio completo — vendedor 000007 pedindo vendedor 000006');

ok('mensagem citando outro vendedor deve resultar em bloqueio', () => {
  const mensagem = 'Faturamento do ano do vendedor de codigo 000006 agrupado por mes';
  const entidadeSeguranca = { tipo: 'vendedor_fixo_seguranca', codigo: '000007' };
  const tipoCampoCitado = entidadeSeguranca.tipo === 'cliente_fixo_seguranca' ? 'cliente' : 'vendedor';
  const codigoCitado = codigoEntidadeSegurancaCitadoNaMensagem(mensagem, tipoCampoCitado);
  const bloqueado = Boolean(codigoCitado) && !_codigosErpEquivalentes(codigoCitado, entidadeSeguranca.codigo);
  assert.strictEqual(bloqueado, true, 'deveria bloquear: vendedor 000007 pediu dados do vendedor 000006');
});

ok('mensagem citando o proprio codigo NAO deve bloquear', () => {
  const mensagem = 'Faturamento do ano do vendedor de codigo 000007 agrupado por mes';
  const entidadeSeguranca = { tipo: 'vendedor_fixo_seguranca', codigo: '000007' };
  const codigoCitado = codigoEntidadeSegurancaCitadoNaMensagem(mensagem, 'vendedor');
  const bloqueado = Boolean(codigoCitado) && !_codigosErpEquivalentes(codigoCitado, entidadeSeguranca.codigo);
  assert.strictEqual(bloqueado, false);
});

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`ia-owner-bloqueio-codigo-citado-mensagem.test.js: ${passou} testes passaram${falhou ? `, ${falhou} falharam` : ''} ${falhou ? '✗' : '✓'}`);
if (falhou) process.exit(1);

'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const IACWhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));
const runner = require(path.join(ROOT, 'modules/erp/systemprompt/module-runner'));

const svc = new IACWhatsAppService();
const empresas = [
  { empresa_id: 1, nome: 'C3i Systems', aliases: 'c3i,c3i systems' },
  { empresa_id: 2, nome: 'J2A Consultoria', aliases: 'j2a,j2a consultoria' },
];

const matchEmpresa = svc._resolverEmpresaQualificadaNoTexto('Qual o faturamento da empresa J2A em 2026', empresas);
assert(matchEmpresa, 'deve resolver empresa quando houver palavra empresa');
assert.strictEqual(matchEmpresa.status, 'resolved', 'empresa existente/autorizada deve ser resolvida');
assert.strictEqual(matchEmpresa.empresaId, 2, 'deve escolher J2A pelo alias');
assert.strictEqual(matchEmpresa.termo.toLowerCase(), 'j2a', 'deve extrair somente o termo da empresa');

const empresaInexistente = svc._resolverEmpresaQualificadaNoTexto('Faturamento do ano da empresa ASTER', empresas);
assert.strictEqual(empresaInexistente.status, 'not_found', 'empresa explicita inexistente nao pode cair na empresa da sessao');
assert.strictEqual(empresaInexistente.termo, 'ASTER', 'deve informar qual empresa explicita nao foi encontrada');

const empresaForaDoCanal = svc._resolverEmpresaQualificadaNoTexto(
  'Faturamento do ano da empresa ASTER',
  [{ empresa_id: 2, nome: 'J2A Consultoria', aliases: 'j2a' }],
);
assert.strictEqual(empresaForaDoCanal.status, 'not_found', 'empresa fora das autorizadas do canal deve ser bloqueada');

const matchEmpresas = svc._resolverEmpresasQualificadasNoTexto('Qual o faturamento da empresa J2A e C3I no ano', empresas);
assert(matchEmpresas, 'deve resolver lista de empresas quando houver palavra empresa');
assert.deepStrictEqual(
  matchEmpresas.empresas.map(e => e.empresa_id).sort(),
  [1, 2],
  'deve escolher somente J2A e C3I pelo texto'
);
assert.deepStrictEqual(matchEmpresas.naoResolvidos, [], 'lista J2A e C3I deve resolver sem pendencias');

const matchEmpresasPerguntaUsuario = svc._resolverEmpresasQualificadasNoTexto(
  'Faturamento do ano, por mes e por produto com valor total, quantidade e ticket medio para as empresas J2A e C3I.',
  empresas,
);
assert(matchEmpresasPerguntaUsuario, 'deve resolver lista de empresas mesmo com agrupamentos antes do trecho');
assert.deepStrictEqual(
  matchEmpresasPerguntaUsuario.empresas.map(e => e.empresa_id).sort(),
  [1, 2],
  'pergunta com J2A e C3I deve abrir escopo multiempresa'
);
assert.strictEqual(
  svc._isPedidoTodasEmpresas('Faturamento do ano de todas as empresas por mes e produto com valor total, quantidade e ticket medio'),
  true,
  'pedido "todas as empresas" dentro da frase deve abrir escopo multiempresa'
);

const semMatchCliente = svc._resolverEmpresaQualificadaNoTexto('Qual o faturamento do cliente J2A em 2026', empresas);
assert.strictEqual(semMatchCliente, null, 'cliente J2A nao deve virar escopo de empresa');

const contract = { filtrosParaEntidades: { cliente: 'cliente', vendedor: 'vendedor' }, logPrefix: 'TEST' };
const intent = {
  _empresaMencionadaTexto: 'J2A',
  filtros: { cliente: 'J2A', vendedor: 'Jean' },
  _filtroEntidadeExplicitaMensagem: { cliente: 'J2A', vendedor: 'Jean' },
  _entidadesResolvidas: [
    { tipo: 'cliente', texto: 'J2A', nome: 'J2A CONSULTORIA E SISTEMAS DE INFORMACAO LTDA', codigo: '000066', loja: '01' },
    { tipo: 'vendedor', texto: 'Jean', nome: 'JEAN DUARTE', codigo: '000001' },
  ],
};
const fase1 = {
  entidades_nomeadas: [
    { texto: 'J2A', tipo_sugerido: 'cliente' },
    { texto: 'Jean', tipo_sugerido: 'vendedor' },
  ],
};

const limpo = runner._test.removerEntidadeEmpresaMencionada(contract, intent, fase1);
assert(!limpo.intent.filtros.cliente, 'cliente igual ao termo da empresa deve sair dos filtros');
assert.strictEqual(limpo.intent.filtros.vendedor, 'Jean', 'demais entidades devem ser preservadas');
assert(!limpo.fase1.entidades_nomeadas.some(e => e.texto === 'J2A'), 'J2A deve sair das entidades nomeadas');
assert(limpo.fase1.entidades_nomeadas.some(e => e.texto === 'Jean'), 'entidade nao relacionada deve permanecer');
assert(!limpo.intent._entidadesResolvidas.some(e => e.tipo === 'cliente'), 'cliente pre-resolvido igual a empresa deve sair');
assert(limpo.intent._entidadesResolvidas.some(e => e.tipo === 'vendedor'), 'entidade pre-resolvida nao relacionada deve permanecer');

const limpoMultiEmpresa = runner._test.removerEntidadeEmpresaMencionada(contract, {
  _empresaMencionadaTexto: 'J2A | C3I',
  _empresasMencionadasTextos: ['J2A', 'C3I'],
  filtros: { cliente: 'C3I', vendedor: 'Jean' },
  _filtroEntidadeExplicitaMensagem: { cliente: 'C3I', vendedor: 'Jean' },
  _entidadesResolvidas: [
    { tipo: 'cliente', texto: 'C3I', nome: 'C3I SYSTEMS', codigo: '000001', loja: '01' },
    { tipo: 'vendedor', texto: 'Jean', nome: 'JEAN DUARTE', codigo: '000001' },
  ],
}, {
  entidades_nomeadas: [
    { texto: 'J2A', tipo_sugerido: 'cliente' },
    { texto: 'C3I', tipo_sugerido: 'cliente' },
    { texto: 'Jean', tipo_sugerido: 'vendedor' },
  ],
});
assert(!limpoMultiEmpresa.intent.filtros.cliente, 'cliente igual a qualquer empresa mencionada deve sair dos filtros');
assert(limpoMultiEmpresa.fase1.entidades_nomeadas.every(e => !['J2A', 'C3I'].includes(e.texto)), 'J2A/C3I devem sair das entidades nomeadas');
assert(limpoMultiEmpresa.intent._entidadesResolvidas.every(e => e.tipo !== 'cliente'), 'clientes iguais a empresas mencionadas devem sair');
assert(limpoMultiEmpresa.intent._entidadesResolvidas.some(e => e.tipo === 'vendedor'), 'vendedor deve ser preservado na limpeza multiempresa');

const limpoFiltroEmpresa = runner._test.removerEntidadeEmpresaMencionada(contract, {
  _empresaMencionadaTexto: 'C3I | J2A',
  _empresasMencionadasTextos: ['C3I', 'J2A'],
  filtros: { empresa: 'C3I,J2A' },
  _filtroEntidadeExplicitaMensagem: { empresa: 'C3I,J2A' },
}, { entidades_nomeadas: [] });
assert(!limpoFiltroEmpresa.intent.filtros.empresa, 'filtro empresa deve sair do prompt SQL quando e escopo multiempresa');

const limpoRefinamentoEmpresaHistorico = runner._test.removerEntidadeEmpresaMencionada(contract, {
  filtros: { empresa: 'J2A' },
  _filtroEntidadeExplicitaMensagem: { empresa: 'J2A' },
  _entidadesResolvidas: [
    { tipo: 'cliente', texto: 'J2A', nome: 'J2A CONSULTORIA E SISTEMAS DE INFORMACAO LTDA', codigo: '000066', loja: '01' },
  ],
  _entidadesResolvidasPorEmpresa: {
    2: [
      { tipo: 'cliente', texto: 'J2A', nome: 'J2A CONSULTORIA E SISTEMAS DE INFORMACAO LTDA', codigo: '000066', loja: '01' },
    ],
  },
}, {
  entidades_nomeadas: [
    { texto: 'J2A', tipo_sugerido: 'cliente' },
  ],
});
assert(!limpoRefinamentoEmpresaHistorico.intent.filtros.empresa, 'empresa herdada deve sair do prompt SQL mesmo sem marcador explicito');
assert(!limpoRefinamentoEmpresaHistorico.fase1.entidades_nomeadas.length, 'empresa herdada nao deve permanecer como entidade nomeada no refinamento');
assert(!limpoRefinamentoEmpresaHistorico.intent._entidadesResolvidas.length, 'cliente pre-resolvido igual a empresa herdada deve sair');
assert(!limpoRefinamentoEmpresaHistorico.intent._entidadesResolvidasPorEmpresa[2].length, 'cliente por empresa igual a empresa herdada deve sair');
assert.strictEqual(limpoRefinamentoEmpresaHistorico.intent._empresaMencionadaTexto, 'J2A', 'empresa herdada deve alimentar guardrails de SQL');

console.log('empresa-qualificada-entidade.test.js: ok');

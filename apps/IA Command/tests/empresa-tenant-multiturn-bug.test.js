'use strict';

/**
 * Teste de regressão — bug C3I virou filtro de cliente no turno 4.
 *
 * Sequência exata relatada pelo usuário:
 *   T1: "Qual o faturamento GERAL?"
 *   T2: "E O faturamento SOMENTE da empresa J2A?"
 *   T3: "E O faturamento SOMENTE da empresa C3I?"
 *   T4: "E o maior mes de faturamento?"   ← BUG: C3I virava F2_CLIENTE='000073'
 *
 * Raiz do bug: _resolverEmpresaQualificadaNoTexto exige a palavra "empresa"
 * antes do nome; no turno 4 a mensagem não menciona empresa, então "C3I" herdado
 * de filtros.empresa não era validado como tenant → normalizarFiltroEmpresaComoEntidade
 * o convertia para filtros.cliente.
 *
 * Fix:
 *   1. service.js: fallback de match direto por nome via _scoreEmpresaTexto >= 0.75
 *      (valida "C3I" como tenant mesmo sem a palavra "empresa" na mensagem herdada).
 *   2. runner.js: normalizarFiltroEmpresaComoEntidade respeita _herdouContextoOrquestrador
 *      como segunda camada de proteção.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const iaOwnerRunner = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const intentMerger  = require(path.join(ROOT, 'modules/ai/intent-merger'));
const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Empresas registradas no canal (como listarEmpresasDoCanal retornaria)
const EMPRESAS_CANAL = [
  { empresa_id: 10, nome: 'C3I Systems',     aliases: 'c3i,c3i systems' },
  { empresa_id: 20, nome: 'J2A Consultoria', aliases: 'j2a,j2a consultoria' },
];

// Spec mínimo de faturamento para normalizarFiltroEmpresaComoEntidade
const specFaturamento = {
  nome: 'faturamento',
  entityCatalog: {
    DEFINICOES:      { cliente: { tabelaBase: 'SA1' } },
    TIPOS_POR_CONTEXTO: ['cliente'],
  },
};

// ─── Utilidades ──────────────────────────────────────────────────────────────

let passou = 0;
let falhou = 0;

function ok(desc, cond, detalhe = '') {
  if (cond) {
    console.log(`  ✅ ${desc}`);
    passou++;
  } else {
    console.log(`  ❌ FALHOU: ${desc}${detalhe ? ' — ' + detalhe : ''}`);
    falhou++;
  }
}

function secao(titulo) {
  console.log(`\n${'─'.repeat(66)}`);
  console.log(`  ${titulo}`);
  console.log('─'.repeat(66));
}

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function mkIntent(overrides = {}) {
  return {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0.9,
    precisa_confirmacao: false,
    _dynamicAiScope: true,
    _moduloDinamico: 'faturamento',
    _nivel_contexto: 1,
    ...overrides,
  };
}

// ─── Turno 1 — faturamento geral ─────────────────────────────────────────────

secao('T1: "Qual o faturamento GERAL?" — sem empresa, sem contexto anterior');

const ctxT1 = mkIntent({
  _mensagemOriginal: 'Qual o faturamento GERAL?',
  filtros: {},
});

ok('T1: filtros.empresa vazio', !ctxT1.filtros.empresa);
ok('T1: filtros.cliente vazio', !ctxT1.filtros.cliente);
ok('T1: sem _empresaMencionadaTexto', !ctxT1._empresaMencionadaTexto);

// ─── Turno 2 — empresa J2A ────────────────────────────────────────────────────

secao('T2: "E O faturamento SOMENTE da empresa J2A?" — J2A validada como tenant');

{
  const svc = new WhatsAppService();
  const match = svc._resolverEmpresaQualificadaNoTexto(
    'E O faturamento SOMENTE da empresa J2A?',
    EMPRESAS_CANAL,
  );
  ok('T2: _resolverEmpresaQualificadaNoTexto encontra J2A com prefixo "empresa"', match?.status === 'resolved' && match?.empresaId === 20, JSON.stringify(match));
}

const ctxT2 = mkIntent({
  _mensagemOriginal: 'E O faturamento SOMENTE da empresa J2A?',
  filtros: { empresa: 'J2A' },
  _empresaMencionadaTexto: 'J2A',
  _empresaMencionadaId: 20,
});

// normalizarFiltroEmpresaComoEntidade NÃO deve converter J2A → cliente (temTenantValidado=true)
const t2Norm = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
  specFaturamento,
  ctxT2,
  'E O faturamento SOMENTE da empresa J2A?',
);
ok('T2: filtros.empresa="J2A" preservado (tenant validado)', t2Norm.filtros?.empresa === 'J2A', JSON.stringify(t2Norm.filtros));
ok('T2: filtros.cliente NÃO criado', !t2Norm.filtros?.cliente);

// ─── Turno 3 — empresa C3I ────────────────────────────────────────────────────

secao('T3: "E O faturamento SOMENTE da empresa C3I?" — C3I validada como tenant');

{
  const svc = new WhatsAppService();
  const match = svc._resolverEmpresaQualificadaNoTexto(
    'E O faturamento SOMENTE da empresa C3I?',
    EMPRESAS_CANAL,
  );
  ok('T3: _resolverEmpresaQualificadaNoTexto encontra C3I com prefixo "empresa"', match?.status === 'resolved' && match?.empresaId === 10, JSON.stringify(match));
}

const ctxT3 = mkIntent({
  _mensagemOriginal: 'E O faturamento SOMENTE da empresa C3I?',
  filtros: { empresa: 'C3I' },
  _empresaMencionadaTexto: 'C3I',
  _empresaMencionadaId: 10,
});

const t3Norm = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
  specFaturamento,
  ctxT3,
  'E O faturamento SOMENTE da empresa C3I?',
);
ok('T3: filtros.empresa="C3I" preservado (tenant validado)', t3Norm.filtros?.empresa === 'C3I', JSON.stringify(t3Norm.filtros));
ok('T3: filtros.cliente NÃO criado', !t3Norm.filtros?.cliente);

// ─── Turno 4 — maior mês (sem menção de empresa) ─────────────────────────────

secao('T4: "E o maior mes de faturamento?" — BUG original aqui');

// Intent que a IA retorna para T4 (sem empresa na mensagem)
const intentBrutoT4 = mkIntent({
  _mensagemOriginal: 'E o maior mes de faturamento?',
  filtros: {},
  agrupar_por: 'mes',
  ordenar_por: { campo: 'total', direcao: 'DESC' },
  limite: 1,
  periodo: { tipo: 'nenhum' },
  _nivel_contexto: undefined,
});

// 1. Merger herda filtros.empresa="C3I" do contexto do T3
const mergedT4 = intentMerger.mesclar(intentBrutoT4, ctxT3, Date.now(), 'E o maior mes de faturamento?');

ok('T4 (merger): filtros.empresa="C3I" herdado do T3', mergedT4.filtros?.empresa === 'C3I', `filtros=${JSON.stringify(mergedT4.filtros)}`);
ok('T4 (merger): filtros.cliente NÃO setado pelo merger', !mergedT4.filtros?.cliente, `filtros.cliente=${mergedT4.filtros?.cliente}`);
ok('T4 (merger): _herdouFiltros=true', mergedT4._herdouFiltros === true);

// 2. Orquestrador marca _herdouContextoOrquestrador (como contratoParaIntent faria)
const intentT4ComFlag = { ...mergedT4, _herdouContextoOrquestrador: true };

// 3. normalizarFiltroEmpresaComoEntidade — FIX: deve respeitar _herdouContextoOrquestrador
const t4Norm = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
  specFaturamento,
  intentT4ComFlag,
  'E o maior mes de faturamento?',
);

ok(
  'T4 (FIX): filtros.empresa="C3I" preservado após normalizarFiltroEmpresaComoEntidade',
  t4Norm.filtros?.empresa === 'C3I',
  `filtros=${JSON.stringify(t4Norm.filtros)}`,
);
ok(
  'T4 (FIX): filtros.cliente NÃO criado — bug corrigido',
  !t4Norm.filtros?.cliente,
  `filtros.cliente=${t4Norm.filtros?.cliente}`,
);
ok(
  'T4 (FIX): _filtroEmpresaReclassificadoComoEntidade NÃO setado',
  !t4Norm._filtroEmpresaReclassificadoComoEntidade,
);

// ─── Turno 4 — reprodução do BUG sem a correção ──────────────────────────────

secao('T4 (reprodução do BUG): sem _herdouContextoOrquestrador e sem _empresaMencionadaTexto');

// Simula o estado antes do fix: sem markers de tenant e sem flag de herança
const intentT4SemFix = {
  ...mergedT4,
  _herdouContextoOrquestrador: false,   // sem flag
  _empresaMencionadaTexto: undefined,    // sem validação de tenant
  _empresaMencionadaId: undefined,
};

const t4SemFix = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
  specFaturamento,
  intentT4SemFix,
  'E o maior mes de faturamento?',  // mensagem sem palavra "empresa"
);

ok(
  'BUG reproduzido: sem guards, filtros.cliente é criado com valor "C3I"',
  t4SemFix.filtros?.cliente === 'C3I',
  `filtros=${JSON.stringify(t4SemFix.filtros)}`,
);
ok(
  'BUG reproduzido: _filtroEmpresaReclassificadoComoEntidade setado',
  !!t4SemFix._filtroEmpresaReclassificadoComoEntidade,
  JSON.stringify(t4SemFix._filtroEmpresaReclassificadoComoEntidade),
);

// ─── Turno 6 — volta para empresa J2A após contexto C3I ──────────────────────

secao('T6: "E o menor mes de faturamento da empresa J2A?" — bug F2_CLIENTE=\'1\'');

// T6: buildEstadoAnterior NÃO deve incluir empresas_iahub_mencionadas_ids
// (IDs internos IAHub como [1] eram confundidos pela IA como código Protheus)
{
  const intentT6 = mkIntent({
    _mensagemOriginal: 'E o menor mes de faturamento da empresa J2A?',
    filtros: { empresa: 'J2A' },
    _empresaMencionadaTexto: 'J2A',
    _empresaMencionadaId: 1,   // empresa_id IAHub da J2A
    agrupar_por: 'mes',
    ordenar_por: { campo: 'faturamento', direcao: 'ASC' },
    limite: 1,
    periodo: { tipo: 'nenhum' },
  });

  const estado = iaOwnerRunner._test.buildEstadoAnterior(intentT6);

  ok(
    'T6 (FIX): empresas_iahub_mencionadas_ids NÃO presente no estado enviado à IA',
    !('empresas_iahub_mencionadas_ids' in estado),
    `campo presente: ${JSON.stringify(Object.keys(estado))}`,
  );
  ok(
    'T6: empresas_iahub_mencionadas contém "J2A" (nome, não ID)',
    Array.isArray(estado.empresas_iahub_mencionadas) && estado.empresas_iahub_mencionadas.includes('J2A'),
    JSON.stringify(estado.empresas_iahub_mencionadas),
  );
  ok(
    'T6: filtros do estado NÃO contém campo empresa (removido por buildEstadoAnterior)',
    !estado.filtros?.empresa,
    JSON.stringify(estado.filtros),
  );
  ok(
    'T6: aviso_empresas_iahub presente para orientar a IA',
    typeof estado.aviso_empresas_iahub === 'string' && estado.aviso_empresas_iahub.length > 0,
  );

  // Verifica que o inteiro 1 (empresa_id IAHub) não aparece em nenhum valor primitivo do estado
  const estadoJson = JSON.stringify(estado);
  // O padrão problemático seria "ids":[1] ou similar com o inteiro solto
  ok(
    'T6: estado serializado NÃO contém "empresas_iahub_mencionadas_ids"',
    !estadoJson.includes('empresas_iahub_mencionadas_ids'),
  );
}

// ─── Resultado ───────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(66)}`);
if (falhou === 0) {
  console.log(`  empresa-tenant-multiturn-bug.test.js: ok (${passou} assertivas)`);
} else {
  console.log(`  empresa-tenant-multiturn-bug.test.js: ${falhou} FALHA(S) / ${passou} ok`);
  process.exit(1);
}

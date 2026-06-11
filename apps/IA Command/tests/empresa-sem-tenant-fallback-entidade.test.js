'use strict';

/**
 * Fallback "empresa X" → entidade quando X não existe no tenant IAHub.
 *
 * Cenário: usuário escreve "empresa Softexpert" (ou qualquer nome não cadastrado
 * como tenant), esperando filtrar um cliente/fornecedor no ERP — não uma empresa
 * do tenant IAHub.
 *
 * Comportamento esperado:
 *   - WhatsApp service devolve status='not_found' para o nome não cadastrado
 *   - normalizarFiltroEmpresaComoEntidade reclassifica filtros.empresa → entidade
 *     padrão do módulo (cliente em faturamento, fornecedor em compras)
 *   - Nomes que SÃO tenants válidos continuam preservados como escopo de tenant
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const iaOwnerRunner  = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));

const EMPRESAS_CANAL = [
  { empresa_id: 10, nome: 'C3I Systems',     aliases: 'c3i,c3i systems' },
  { empresa_id: 20, nome: 'J2A Consultoria', aliases: 'j2a,j2a consultoria' },
];

const specFaturamento = {
  nome: 'faturamento',
  entityCatalog: {
    DEFINICOES: { cliente: { tabelaBase: 'SA1' } },
    TIPOS_POR_CONTEXTO: ['cliente'],
  },
};

const specCompras = {
  nome: 'compras',
  entityCatalog: {
    DEFINICOES: { fornecedor: { tabelaBase: 'SA2' } },
    TIPOS_POR_CONTEXTO: ['fornecedor'],
  },
};

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
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${titulo}`);
  console.log('─'.repeat(70));
}

// ─── 1. WhatsApp service detecta corretamente nome não-tenant ─────────────────

secao('1. WhatsApp service — detecção de empresa não-tenant');

{
  const svc = new WhatsAppService();
  const result = svc._resolverEmpresaQualificadaNoTexto(
    'faturamento da empresa Softexpert em 2024',
    EMPRESAS_CANAL,
  );
  ok(
    'empresa não cadastrada retorna status not_found',
    result?.status === 'not_found',
    JSON.stringify(result),
  );
  ok(
    'termo "Softexpert" é preservado no retorno not_found',
    result?.termo === 'Softexpert',
    JSON.stringify(result),
  );
}

{
  const svc = new WhatsAppService();
  const result = svc._resolverEmpresaQualificadaNoTexto(
    'faturamento da empresa C3I em 2024',
    EMPRESAS_CANAL,
  );
  ok(
    'empresa cadastrada (C3I) retorna status resolved',
    result?.status === 'resolved',
    JSON.stringify(result),
  );
}

// ─── 2. Fallback faturamento: empresa inexistente → filtros.cliente ───────────

secao('2. Módulo faturamento — "empresa Softexpert" → filtros.cliente');

{
  const intent = {
    filtros: { empresa: 'Softexpert' },
    // sem _empresaMencionadaId nem _empresaMencionadaTexto (tenant não validado)
    // sem _herdouContextoOrquestrador
  };

  const resultado = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
    specFaturamento,
    intent,
    'faturamento da empresa Softexpert em 2024',
  );

  ok(
    'filtros.empresa removido (não é tenant válido)',
    !resultado.filtros?.empresa,
    JSON.stringify(resultado.filtros),
  );
  ok(
    'filtros.cliente criado com o nome digitado',
    resultado.filtros?.cliente === 'Softexpert',
    JSON.stringify(resultado.filtros),
  );
  ok(
    '_filtroEmpresaReclassificadoComoEntidade indica reclassificação',
    resultado._filtroEmpresaReclassificadoComoEntidade?.tipo === 'cliente',
    JSON.stringify(resultado._filtroEmpresaReclassificadoComoEntidade),
  );
}

// ─── 3. Fallback compras: empresa inexistente → filtros.fornecedor ────────────

secao('3. Módulo compras — "empresa XPTO" → filtros.fornecedor');

{
  const intent = {
    filtros: { empresa: 'XPTO Materiais' },
  };

  const resultado = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
    specCompras,
    intent,
    'compras da empresa XPTO Materiais no ano',
  );

  ok(
    'filtros.empresa removido',
    !resultado.filtros?.empresa,
    JSON.stringify(resultado.filtros),
  );
  ok(
    'filtros.fornecedor criado com o nome digitado',
    resultado.filtros?.fornecedor === 'XPTO Materiais',
    JSON.stringify(resultado.filtros),
  );
}

// ─── 4. Tenant válido: preservado como escopo de tenant ──────────────────────

secao('4. Tenant válido (C3I) — NÃO deve ser reclassificado');

{
  const intent = {
    filtros: { empresa: 'C3I' },
    _empresaMencionadaTexto: 'C3I',
    _empresaMencionadaId: 10,
  };

  const resultado = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
    specFaturamento,
    intent,
    'faturamento da empresa C3I em 2024',
  );

  ok(
    'filtros.empresa="C3I" preservado (tenant validado)',
    resultado.filtros?.empresa === 'C3I',
    JSON.stringify(resultado.filtros),
  );
  ok(
    'filtros.cliente NÃO criado',
    !resultado.filtros?.cliente,
  );
}

// ─── 5. Contexto herdado: preservado como escopo de tenant ───────────────────

secao('5. Contexto herdado (_herdouContextoOrquestrador) — NÃO reclassificar');

{
  const intent = {
    filtros: { empresa: 'C3I' },
    _herdouContextoOrquestrador: true,
    // sem _empresaMencionadaId (herdado de turno anterior, não validado novamente)
  };

  const resultado = iaOwnerRunner._test.normalizarFiltroEmpresaComoEntidade(
    specFaturamento,
    intent,
    'e o maior mes?',  // mensagem sem palavra "empresa"
  );

  ok(
    'filtros.empresa="C3I" preservado via _herdouContextoOrquestrador',
    resultado.filtros?.empresa === 'C3I',
    JSON.stringify(resultado.filtros),
  );
  ok(
    'filtros.cliente NÃO criado',
    !resultado.filtros?.cliente,
  );
}

// ─── Resultado ────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`);
if (falhou === 0) {
  console.log(`  empresa-sem-tenant-fallback-entidade.test.js: ok (${passou} assertivas)`);
} else {
  console.log(`  empresa-sem-tenant-fallback-entidade.test.js: ${falhou} FALHA(S) / ${passou} ok`);
  process.exit(1);
}

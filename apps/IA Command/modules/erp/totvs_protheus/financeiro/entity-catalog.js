'use strict';

const DEFINICOES = {
  // Tipo de segurança: código ERP do remetente resolvido por empresa pelo sistema.
  // SE1 (contas a receber) permite rateio entre até 5 vendedores (E1_VEND1..E1_VEND5);
  // qualquer um deles que contenha o código do vendedor autorizado satisfaz a presença.
  // SE2 (contas a pagar) não tem campo de vendedor — bloqueado integralmente para vendedor
  // via sqlPatternsProibidos (ver financeiro-ia-owner-spec.js).
  vendedor_fixo_seguranca: {
    tipo: 'vendedor_fixo_seguranca',
    rotuloTipo: 'vendedor_fixo_seguranca',
    tabelaBase: 'SE1',
    codigoCampo: 'E1_VEND1',
    nomeCampos: [],
  },
  cliente: {
    tipo: 'cliente',
    rotuloTipo: 'cliente',
    tabelaBase: 'SA1',
    codigoCampo: 'A1_COD',
    lojaCampo: 'A1_LOJA',
    nomeCampos: ['A1_NOME', 'A1_NREDUZ'],
    joinHint: 'SE1.E1_CLIENTE = SA1.A1_COD AND SE1.E1_LOJA = SA1.A1_LOJA',
  },
  fornecedor: {
    tipo: 'fornecedor',
    rotuloTipo: 'fornecedor',
    tabelaBase: 'SA2',
    codigoCampo: 'A2_COD',
    lojaCampo: 'A2_LOJA',
    nomeCampos: ['A2_NOME', 'A2_NREDUZ'],
    joinHint: 'SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA',
  },
  vendedor: {
    tipo: 'vendedor',
    rotuloTipo: 'vendedor',
    tabelaBase: 'SA3',
    codigoCampo: 'A3_COD',
    nomeCampos: ['A3_NOME', 'A3_COD'],
    joinHint: 'SE1.E1_VEND1..E1_VEND5 = SA3.A3_COD',
  },
  natureza: {
    tipo: 'natureza',
    rotuloTipo: 'natureza financeira',
    tabelaBase: 'SED',
    codigoCampo: 'ED_CODIGO',
    nomeCampos: ['ED_DESCRIC', 'ED_CODIGO'],
    joinHint: 'SE1.E1_NATUREZ = SED.ED_CODIGO OR SE2.E2_NATUREZ = SED.ED_CODIGO',
  },
};

const TIPOS_POR_CONTEXTO = ['cliente', 'fornecedor', 'vendedor', 'natureza'];

function tiposParaTermo(termo) {
  const tipo = String(termo?.tipo_sugerido || '').trim();
  return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado', 'inferido_carteira', 'inferido_carteira_ambas'].includes(termo?.origem)
    ? [tipo]
    : TIPOS_POR_CONTEXTO;
}

module.exports = {
  DEFINICOES,
  TIPOS_POR_CONTEXTO,
  tiposParaTermo,
};

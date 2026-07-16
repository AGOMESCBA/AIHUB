'use strict';

const DEFINICOES = {
  // Tipo de segurança: código ERP do remetente resolvido por empresa pelo sistema.
  // SF2 permite rateio entre até 5 vendedores (F2_VEND1..F2_VEND5); qualquer um deles
  // que contenha o código do vendedor autorizado satisfaz o filtro de presença.
  vendedor_fixo_seguranca: {
    tipo: 'vendedor_fixo_seguranca',
    rotuloTipo: 'vendedor_fixo_seguranca',
    tabelaBase: 'SF2',
    codigoCampo: 'F2_VEND1',
    nomeCampos: [],
  },
  cliente: {
    tipo: 'cliente',
    rotuloTipo: 'cliente',
    tabelaBase: 'SA1',
    codigoCampo: 'A1_COD',
    lojaCampo: 'A1_LOJA',
    nomeCampos: ['A1_NOME', 'A1_NREDUZ'],
    joinHint: 'SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA',
  },
  produto: {
    tipo: 'produto',
    rotuloTipo: 'produto',
    tabelaBase: 'SB1',
    codigoCampo: 'B1_COD',
    nomeCampos: ['B1_DESC', 'B1_COD'],
    joinHint: 'SD2.D2_COD = SB1.B1_COD',
  },
  grupo_produto: {
    tipo: 'grupo_produto',
    rotuloTipo: 'grupo de produto',
    tabelaBase: 'SBM',
    codigoCampo: 'BM_GRUPO',
    nomeCampos: ['BM_DESC', 'BM_GRUPO'],
    joinHint: 'SB1.B1_GRUPO = SBM.BM_GRUPO',
  },
  vendedor: {
    tipo: 'vendedor',
    rotuloTipo: 'vendedor',
    tabelaBase: 'SA3',
    codigoCampo: 'A3_COD',
    nomeCampos: ['A3_NOME', 'A3_COD'],
    joinHint: 'SF2.F2_VEND1 = SA3.A3_COD',
  },
  centro_custo: {
    tipo: 'centro_custo',
    rotuloTipo: 'centro de custo',
    tabelaBase: 'CTT',
    codigoCampo: 'CTT_CUSTO',
    nomeCampos: ['CTT_DESC01', 'CTT_CUSTO'],
    joinHint: 'SD2.D2_CCUSTO = CTT.CTT_CUSTO',
  },
  tes: {
    tipo: 'tes',
    rotuloTipo: 'TES',
    tabelaBase: 'SF4',
    codigoCampo: 'F4_CODIGO',
    nomeCampos: ['F4_TEXTO', 'F4_CODIGO'],
    joinHint: 'SD2.D2_TES = SF4.F4_CODIGO',
  },
};

const TIPOS_POR_CONTEXTO = ['cliente', 'produto', 'grupo_produto', 'vendedor', 'centro_custo', 'tes'];

function tiposParaTermo(termo) {
  const tipo = String(termo?.tipo_sugerido || '').trim();
  return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado'].includes(termo?.origem)
    ? [tipo]
    : TIPOS_POR_CONTEXTO;
}

module.exports = {
  DEFINICOES,
  TIPOS_POR_CONTEXTO,
  tiposParaTermo,
};

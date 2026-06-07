'use strict';

const DEFINICOES = {
  fornecedor: {
    tipo: 'fornecedor',
    rotuloTipo: 'fornecedor',
    tabelaBase: 'SA2',
    codigoCampo: 'A2_COD',
    lojaCampo: 'A2_LOJA',
    nomeCampos: ['A2_NOME', 'A2_NREDUZ'],
    joinHint: "SF1.F1_FORNECE = SA2.A2_COD AND SF1.F1_LOJA = SA2.A2_LOJA",
  },
  produto: {
    tipo: 'produto',
    rotuloTipo: 'produto',
    tabelaBase: 'SB1',
    codigoCampo: 'B1_COD',
    nomeCampos: ['B1_DESC', 'B1_COD'],
    joinHint: 'SD1.D1_COD = SB1.B1_COD',
  },
  grupo_produto: {
    tipo: 'grupo_produto',
    rotuloTipo: 'grupo de produto',
    tabelaBase: 'SBM',
    codigoCampo: 'BM_GRUPO',
    nomeCampos: ['BM_DESC', 'BM_GRUPO'],
    joinHint: 'SB1.B1_GRUPO = SBM.BM_GRUPO',
  },
  centro_custo: {
    tipo: 'centro_custo',
    rotuloTipo: 'centro de custo',
    tabelaBase: 'CTT',
    codigoCampo: 'CTT_CUSTO',
    nomeCampos: ['CTT_DESC01', 'CTT_CUSTO'],
    joinHint: 'SD1.D1_CC = CTT.CTT_CUSTO',
  },
  natureza: {
    tipo: 'natureza',
    rotuloTipo: 'natureza',
    tabelaBase: 'SED',
    codigoCampo: 'ED_CODIGO',
    nomeCampos: ['ED_DESCRIC', 'ED_CODIGO'],
    joinHint: 'SD1.D1_NATUREZ = SED.ED_CODIGO',
  },
  tes: {
    tipo: 'tes',
    rotuloTipo: 'TES',
    tabelaBase: 'SF4',
    codigoCampo: 'F4_CODIGO',
    nomeCampos: ['F4_TEXTO', 'F4_CODIGO'],
    joinHint: 'SD1.D1_TES = SF4.F4_CODIGO',
  },
};

const TIPOS_POR_CONTEXTO = ['fornecedor', 'produto', 'grupo_produto', 'centro_custo', 'natureza', 'tes'];

function tiposParaTermo(termo) {
  const tipo = String(termo?.tipo_sugerido || termo?.tipo || '').trim();
  return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado'].includes(termo?.origem)
    ? [tipo]
    : TIPOS_POR_CONTEXTO;
}

module.exports = { DEFINICOES, TIPOS_POR_CONTEXTO, tiposParaTermo };

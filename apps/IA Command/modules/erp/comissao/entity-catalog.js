'use strict';

const DEFINICOES = {
  vendedor: {
    tipo: 'vendedor',
    rotuloTipo: 'vendedor',
    tabelaBase: 'SA3',
    codigoCampo: 'A3_COD',
    nomeCampos: ['A3_NOME'],
    joinHint: 'SE3.E3_VEND = SA3.A3_COD',
  },
  cliente: {
    tipo: 'cliente',
    rotuloTipo: 'cliente',
    tabelaBase: 'SA1',
    codigoCampo: 'A1_COD',
    lojaCampo: 'A1_LOJA',
    nomeCampos: ['A1_NOME', 'A1_NREDUZ'],
    joinHint: 'SE3.E3_CLIENT = SA1.A1_COD AND SE3.E3_LOJA = SA1.A1_LOJA',
  },
};

const TIPOS_POR_CONTEXTO = ['vendedor', 'cliente'];

function tiposParaTermo(termo) {
  const tipo = String(termo?.tipo_sugerido || '').trim();
  return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado'].includes(termo?.origem)
    ? [tipo]
    : TIPOS_POR_CONTEXTO;
}

module.exports = { DEFINICOES, TIPOS_POR_CONTEXTO, tiposParaTermo };

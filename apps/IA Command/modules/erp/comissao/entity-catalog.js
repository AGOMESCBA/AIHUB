'use strict';

const DEFINICOES = {
  // Tipo de segurança: código ERP do remetente resolvido por empresa pelo sistema.
  // Campos intencionalmente restritos a E3_VEND/E3_VENDED — nunca A3_COD (cadastro).
  // Isso garante que apenas o filtro da tabela fato (SE3) seja parametrizado,
  // sem risco de substituição indevida em JOINs com SA3.
  vendedor_fixo_seguranca: {
    tipo: 'vendedor_fixo_seguranca',
    rotuloTipo: 'vendedor_fixo_seguranca',
    tabelaBase: 'SE3',
    codigoCampo: 'E3_VEND',
    nomeCampos: [],
  },
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

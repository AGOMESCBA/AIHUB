// Relatorio agregado de homologacao da IA (avaliacao humana das respostas
// investigativas). Responsabilidade de "visao" -- cruza avaliacoes_investigacao
// com investigacao_execucoes (provider/model/quality_gate) e chamados
// (produto), por isso vive separado do CRUD individual em
// avaliacao-investigacao-service.js.

const avaliacaoRepo = require('../repositories/avaliacao-investigacao-repository');

function _arredondar(numero, casas = 2) {
  const fator = 10 ** casas;
  return Math.round(numero * fator) / fator;
}

function obterRelatorioAgregado(empresaId, { provider = null, model = null, produto = null } = {}) {
  const resumo = avaliacaoRepo.obterResumoAgregado(empresaId, { provider, model, produto });
  return {
    total: resumo.total,
    mediaGeral: _arredondar(resumo.mediaGeral),
    distribuicaoFaixas: resumo.distribuicaoFaixas,
    porProvider: resumo.porProvider.map(g => ({ ...g, media: _arredondar(g.media) })),
    porModel: resumo.porModel.map(g => ({ ...g, media: _arredondar(g.media) })),
    porProduto: resumo.porProduto.map(g => ({ ...g, media: _arredondar(g.media) })),
    qgAprovadoMasMalAvaliadas: resumo.qgAprovadoMasMalAvaliadas,
    erroTecnicoCriticoSinalizado: resumo.erroTecnicoCriticoSinalizado,
  };
}

module.exports = { obterRelatorioAgregado };

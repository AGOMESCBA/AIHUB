// Sincronizacao incremental da base historica.
//
// A estrategia continua sendo reconsultar uma janela de datas com sobreposicao:
// ela reaproveita o mesmo UPSERT do full load e nao depende de cursor externo
// ainda nao validado na origem.

const historicalImportService = require('./historical-import-service');
const importacaoRepo = require('../../repositories/importacao-repository');

const JANELA_PADRAO_DIAS = 7;

function _formatarYyyymmdd(data) {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(data.getUTCDate()).padStart(2, '0');
  return `${ano}${mes}${dia}`;
}

function _calcularPeriodoIncremental(empresaId, fonteId, { janelaDias = JANELA_PADRAO_DIAS, ateData } = {}) {
  const importacoesAnteriores = importacaoRepo.listarImportacoes(empresaId, { fonteId, limite: 50 });
  const ultimaConcluida = importacoesAnteriores.find(i => i.status === 'concluido');

  const fimRef = ateData ? new Date(ateData) : new Date();
  const fim = _formatarYyyymmdd(new Date(fimRef.getTime() + 24 * 60 * 60 * 1000));

  let inicioRef;
  if (ultimaConcluida?.periodoFim) {
    const fimAnteriorMs = Date.parse(
      `${ultimaConcluida.periodoFim.slice(0, 4)}-${ultimaConcluida.periodoFim.slice(4, 6)}-${ultimaConcluida.periodoFim.slice(6, 8)}`
    );
    inicioRef = new Date(fimAnteriorMs - janelaDias * 24 * 60 * 60 * 1000);
  } else {
    inicioRef = new Date(fimRef.getTime() - janelaDias * 24 * 60 * 60 * 1000);
  }

  return { inicio: _formatarYyyymmdd(inicioRef), fim };
}

function iniciarIncremental(empresaId, fonteId, { janelaDias = JANELA_PADRAO_DIAS, ateData } = {}) {
  const { inicio, fim } = _calcularPeriodoIncremental(empresaId, fonteId, { janelaDias, ateData });
  const importacaoInicial = importacaoRepo.criarImportacao(empresaId, {
    fonteId,
    tipo: 'incremental',
    periodoInicio: inicio,
    periodoFim: fim,
  });

  const promise = historicalImportService.executarFullLoad(empresaId, fonteId, {
    periodoInicio: inicio,
    periodoFim: fim,
    tamanhoLote: historicalImportService.TAMANHO_LOTE_PADRAO,
    importacaoExistenteId: importacaoInicial.id,
  });

  return { importacao: importacaoInicial, promise };
}

async function executarIncremental(empresaId, fonteId, opts = {}) {
  const { promise } = iniciarIncremental(empresaId, fonteId, opts);
  return promise;
}

module.exports = { executarIncremental, iniciarIncremental, JANELA_PADRAO_DIAS };

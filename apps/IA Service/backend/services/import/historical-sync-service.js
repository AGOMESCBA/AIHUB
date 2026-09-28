// Sincronização incremental — Checkpoint 6.
//
// DECISÃO DOCUMENTADA (seção 21 do prompt: "antes de usar BNUPDATED/NRVERSION
// como cursor, analisar comportamento real; não assumir sem evidência"):
// esta sessão não teve acesso ao SQL Server real para validar se BNUPDATED
// (ou NRVERSION) refletem de fato "última modificação" de forma confiável em
// DYNITSM/DYNITSMGRIDREGISTR. Sem essa validação, a estratégia adotada é:
//
//   1. Reconsultar uma JANELA DE DATAS configurável (padrão: últimos N dias
//      por DT, sobrepondo a última sincronização por segurança) — usa o MESMO
//      filtro de índice (DT >= / DT <) já validado no full load, não depende
//      de nenhum campo de controle não confirmado.
//   2. Dentro dessa janela, o UPSERT já existente decide se é INSERT, UPDATE
//      ou "sem alteração" via hash_conteudo (mesmo mecanismo do full load —
//      nenhuma lógica nova de detecção de mudança, reaproveita 100% o
//      pipeline de _processarChamado).
//
// Isso é deliberadamente mais caro em I/O do que um cursor incremental real
// (reprocessa uma janela sobreposta a cada execução), mas é CORRETO sem
// depender de suposição não validada. Quando BNUPDATED/NRVERSION forem
// confirmados como confiáveis (comparando contra uma amostra real), a janela
// pode ser trocada por um filtro `BNUPDATED > @ultimaSincronizacao` sem mudar
// a interface pública deste módulo — só a query do adapter.

const historicalImportService = require('./historical-import-service');
const importacaoRepo = require('../../repositories/importacao-repository');

const JANELA_PADRAO_DIAS = 7; // sobreposição de segurança sobre a última sincronização

function _formatarYyyymmdd(data) {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(data.getUTCDate()).padStart(2, '0');
  return `${ano}${mes}${dia}`;
}

/**
 * Executa sincronização incremental: busca a última importação bem-sucedida
 * (full ou incremental) desta fonte para saber até onde os dados foram
 * cobertos, e reprocessa uma janela retroativa a partir dali — nunca "desde
 * sempre" (isso seria um full load), nunca "só hoje" (arriscado sem cursor
 * confiável validado).
 */
async function executarIncremental(empresaId, fonteId, { janelaDias = JANELA_PADRAO_DIAS, ateData } = {}) {
  const importacoesAnteriores = importacaoRepo.listarImportacoes(empresaId, { fonteId, limite: 50 });
  const ultimaConcluida = importacoesAnteriores.find(i => i.status === 'concluido');

  const fimRef = ateData ? new Date(ateData) : new Date();
  const fim = _formatarYyyymmdd(new Date(fimRef.getTime() + 24 * 60 * 60 * 1000)); // exclusivo, seção 46: DT < fim

  let inicioRef;
  if (ultimaConcluida?.periodoFim) {
    // Retrocede JANELA_PADRAO_DIAS a partir do fim da última cobertura conhecida —
    // cobre o período "novo" mais uma margem de segurança contra atrasos de
    // gravação na origem.
    const fimAnteriorMs = Date.parse(
      `${ultimaConcluida.periodoFim.slice(0, 4)}-${ultimaConcluida.periodoFim.slice(4, 6)}-${ultimaConcluida.periodoFim.slice(6, 8)}`
    );
    inicioRef = new Date(fimAnteriorMs - janelaDias * 24 * 60 * 60 * 1000);
  } else {
    // Sem histórico de importação — incremental sem full load prévio não faz
    // sentido conceitualmente, mas em vez de falhar silenciosamente, cobre
    // só a janela recente (o operador deve rodar full load antes, é um alerta
    // a ser mostrado no painel, não um erro bloqueante aqui).
    inicioRef = new Date(fimRef.getTime() - janelaDias * 24 * 60 * 60 * 1000);
  }

  const inicio = _formatarYyyymmdd(inicioRef);

  return historicalImportService.executarFullLoad(empresaId, fonteId, {
    periodoInicio: inicio,
    periodoFim: fim,
    tamanhoLote: historicalImportService.TAMANHO_LOTE_PADRAO,
  }).then(async (importacao) => {
    // Marca esta importação como tipo 'incremental' (executarFullLoad sempre
    // cria como 'full' quando não há importacaoExistenteId) — corrige o tipo
    // após a criação para refletir a natureza real desta chamada, sem
    // duplicar toda a lógica de execução em batches.
    const db = require('../../database').getDB();
    db.prepare(`UPDATE importacoes SET tipo = 'incremental' WHERE id = ?`).run(importacao.id);
    return importacaoRepo.getImportacao(empresaId, importacao.id);
  });
}

module.exports = { executarIncremental, JANELA_PADRAO_DIAS };

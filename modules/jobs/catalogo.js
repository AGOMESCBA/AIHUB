// Catálogo dos jobs do serviço IAHub-Jobs. Todo job novo entra aqui e precisa
// cumprir o contrato (validarDefinicao) — sem isso o serviço nem sobe.
//
// Contrato de um job:
//   id           'app.nome' (minúsculas, números, ponto e hífen)
//   descricao    texto para tela e log
//   idempotente  true, obrigatório: o job PODE rodar duas vezes para o mesmo
//                trabalho (queda no meio, retomada) sem duplicar efeito
//                externo. Quem não garante isso não entra.
//   timeoutMs    tempo máximo de uma execução; passou, o processo é encerrado
//   preparar()   opcional e SÍNCRONO: abre bancos etc. Roda no supervisor (a
//                cada ciclo, tem que ser barato) e no processo filho; lançar
//                erro adia o job (ex.: migração pendente)
//   instancias(agora) → [{ instancia, devida }]: o que existe para rodar e se
//                já está na hora. Roda no supervisor: tem que ser leve.
//   instanciaValida(instancia) → boolean (pedido vindo da tela)
//   executar(instancia, { origem }) → { resultado: 'ok'|'vazio'|'aviso', resumo }
//                roda no processo filho
//   aoInterromper(instancia, { origem, motivo }) opcional: limpeza quando a
//                execução morre no meio (timeout, queda, parada do serviço)
//
// Opcionais para a tela Jobs:
//   nome                     rótulo curto ("Jaade · Primeiro Atendimento")
//   empresaDaInstancia(i)    → empresaId (filtro por empresa no histórico)
//   descreverInstancia(i)    → { empresaId, empresa, rotulo }
//   instancias() pode trazer devidaDesde (fila justa: mais atrasado primeiro)
//   e proximaEm (ISO, coluna "Próxima" da tela)
//
// O sistema do job é o prefixo do id ('ia-service.jade-pa' → 'ia-service'):
// é por ele que a tela dentro de cada sistema filtra os seus jobs.
const ID_VALIDO = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function validarDefinicao(def) {
  const erros = [];
  if (!def || typeof def !== 'object') return ['definição ausente'];
  if (typeof def.id !== 'string' || !ID_VALIDO.test(def.id)) erros.push('id inválido (use app.nome)');
  if (typeof def.descricao !== 'string' || !def.descricao.trim()) erros.push('descricao obrigatória');
  if (def.idempotente !== true) erros.push('idempotente: true obrigatório');
  if (!Number.isInteger(def.timeoutMs) || def.timeoutMs < 1000) erros.push('timeoutMs inteiro >= 1000');
  for (const fn of ['instancias', 'instanciaValida', 'executar']) {
    if (typeof def[fn] !== 'function') erros.push(`${fn}() obrigatório`);
  }
  for (const fn of ['preparar', 'aoInterromper', 'empresaDaInstancia', 'descreverInstancia']) {
    if (def[fn] !== undefined && typeof def[fn] !== 'function') erros.push(`${fn} precisa ser função`);
  }
  return erros;
}

function montar(definicoes) {
  const mapa = new Map();
  for (const def of definicoes) {
    const erros = validarDefinicao(def);
    if (erros.length) throw new Error(`[Jobs] Job "${def?.id ?? '?'}" fora do contrato: ${erros.join('; ')}`);
    if (mapa.has(def.id)) throw new Error(`[Jobs] Job duplicado: ${def.id}`);
    mapa.set(def.id, def);
  }
  return {
    listar: () => [...mapa.values()],
    obter: (id) => mapa.get(id) || null,
  };
}

/** 'ia-service.jade-pa' → 'ia-service'. */
function sistemaDoJob(jobId) {
  return String(jobId).split('.')[0];
}

let _padrao = null;
/** Catálogo real, carregado sob demanda (os módulos dos jobs são pesados). */
function padrao() {
  if (!_padrao) {
    _padrao = montar([
      require('../../apps/IA Service/backend/jobs/jade-pa-job'),
    ]);
  }
  return _padrao;
}

module.exports = { validarDefinicao, montar, padrao, sistemaDoJob };

// Situação dos jobs para a tela Jobs (roda no site; lê o banco do serviço e o
// catálogo). `sistema` filtra os jobs do sistema onde a tela foi aberta.
const repo = require('./repositorio');
const catalogo = require('./catalogo');
const modo = require('./modo');

function definicoes(sistema = null) {
  return catalogo.padrao().listar().filter(d => !sistema || catalogo.sistemaDoJob(d.id) === sistema);
}

function _descrever(def, instancia) {
  try {
    return def.descreverInstancia?.(instancia) || null;
  } catch (_) {
    return null;
  }
}

/** Rótulo legível de uma instância ("J2A Consultoria · SE ITSM"). */
function rotuloInstancia(jobId, instancia) {
  const def = catalogo.padrao().obter(jobId);
  return (def && _descrever(def, instancia)?.rotulo) || instancia;
}

function montarPainel({ sistema = null, agora = new Date() } = {}) {
  const cfg = repo.getConfigJobs();
  const servico = repo.estadoServico({ agora });
  const noComando = modo.servicoNoComando({ agora });
  const controles = repo.listarControles();
  const ctrl = (jobId, instancia) => controles.find(c => c.jobId === jobId && c.instancia === instancia) || null;
  const concessoes = new Map(repo.listarConcessoes().map(c => [`${c.jobId}|${c.instancia}`, c]));
  const abertas = repo.listarExecucoesAbertas();
  const pedidos = repo.listarPedidosAbertos();
  const resumo24 = new Map(repo.resumoExecucoes(new Date(agora.getTime() - 86400000).toISOString()).map(r => [r.jobId, r]));
  const agoraIso = agora.toISOString();

  const jobs = definicoes(sistema).map((def) => {
    let instancias = [];
    let erroInstancias = null;
    try {
      if (def.preparar) def.preparar();
      instancias = [...(def.instancias(agora) || [])];
    } catch (err) {
      erroInstancias = err.message;
    }
    // Execução em andamento de uma instância que saiu da lista (ex.: job desligado no meio).
    const listadas = new Set(instancias.map(i => i.instancia));
    for (const e of abertas) {
      if (e.jobId === def.id && !listadas.has(e.instancia)) instancias.push({ instancia: e.instancia, devida: false, proximaEm: null, inativa: true });
    }
    const cj = ctrl(def.id, repo.TODAS);
    const linhas = instancias.map((i) => {
      const conc = concessoes.get(`${def.id}|${i.instancia}`);
      const aberta = abertas.find(e => e.jobId === def.id && e.instancia === i.instancia) || null;
      const ci = ctrl(def.id, i.instancia);
      const desc = _descrever(def, i.instancia);
      const pausada = !!(cj?.pausado || ci?.pausado);
      const aguardarAte = conc?.aguardarAte && conc.aguardarAte > agoraIso ? conc.aguardarAte : null;
      let situacao = 'agendada';
      if (aberta) situacao = 'executando';
      else if (pausada) situacao = 'pausada';
      else if (aguardarAte) situacao = 'retentativa';
      else if (i.devida) situacao = noComando ? 'na_fila' : 'no_site';
      const ultima = repo.ultimaExecucaoConcluida(def.id, i.instancia);
      return {
        instancia: i.instancia,
        rotulo: desc?.rotulo || i.instancia,
        empresa: desc?.empresa || null,
        empresaId: desc?.empresaId ?? null,
        devida: !!i.devida,
        proximaEm: i.proximaEm || null,
        inativa: !!i.inativa,
        pausada,
        pausaPropria: !!ci?.pausado,
        pausaPor: ci?.pausado ? ci.atualizadoPor : cj?.pausado ? cj.atualizadoPor : null,
        execucaoAberta: aberta && { id: aberta.id, inicio: aberta.inicio, origem: aberta.origem },
        ultima,
        falhasSeguidas: conc?.falhasSeguidas || 0,
        aguardarAte,
        pedidoPendente: pedidos.some(p => p.tipo === 'executar' && p.jobId === def.id && p.instancia === i.instancia),
        situacao,
      };
    });
    const r24 = resumo24.get(def.id);
    return {
      id: def.id,
      nome: def.nome || def.id,
      descricao: def.descricao,
      sistema: catalogo.sistemaDoJob(def.id),
      timeoutMs: def.timeoutMs,
      pausado: !!cj?.pausado,
      pausaPor: cj?.pausado ? cj.atualizadoPor : null,
      limite: cj?.limite || null,
      erroInstancias,
      emExecucao: linhas.filter(l => l.situacao === 'executando').length,
      execucoes24h: r24?.total || 0,
      falhas24h: r24?.falhas || 0,
      instancias: linhas,
    };
  });

  const todas = jobs.flatMap(j => j.instancias);
  return {
    agora: agoraIso,
    sistema,
    modo: cfg.modo,
    servico,
    servicoNoComando: noComando,
    config: cfg,
    // "Voltou ao normal" esperando reenvio não é problema em aberto.
    alertasAbertos: repo.listarAlertasAbertos().filter(a => !a.chave.endsWith(':ok')),
    resumo: {
      emExecucao: todas.filter(l => l.situacao === 'executando').length,
      naFila: todas.filter(l => l.situacao === 'na_fila').length,
      pausadas: todas.filter(l => l.pausada).length,
      falhando: todas.filter(l => l.falhasSeguidas > 0).length,
      execucoes24h: jobs.reduce((s, j) => s + j.execucoes24h, 0),
      falhas24h: jobs.reduce((s, j) => s + j.falhas24h, 0),
      limite: cfg.maxSimultaneos,
    },
    jobs,
  };
}

module.exports = { montarPainel, definicoes, rotuloInstancia };

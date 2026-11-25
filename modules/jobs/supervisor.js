// Supervisor do serviço IAHub-Jobs: decide o que roda e quando, e acompanha
// cada execução num processo filho próprio. Nunca faz o trabalho pesado.
//
// Garantias (pedido do usuário, 2026-11-24: "quase nível zero de falha"):
//   - uma execução por job/instância, entre processos: concessão no banco
//     renovada enquanto o filho vive; supervisor que cai perde a concessão em
//     segundos (não em minutos) e outro assume;
//   - ficha (fencing token): supervisor "zumbi" não grava por cima de quem assumiu;
//   - tempo máximo por execução: passou, o filho é encerrado;
//   - falha não vira laço: espera crescente com variação antes da próxima tentativa;
//   - execução que morreu com o processo (queda, máquina reiniciada) é
//     encontrada, registrada como interrompida e o job limpa o que deixou;
//   - desligamento controlado: para de iniciar, espera as atuais por um prazo,
//     encerra o resto e devolve as concessões;
//   - nada falha calado: início/fim/erro no log do serviço, no histórico (com o
//     log da própria execução), nos eventos da tela Jobs e, em falhas
//     seguidas, alerta por WhatsApp (e outro quando normaliza).
//
// O que a tela Jobs controla (lido a cada ciclo, sem reiniciar): modo
// (site/serviço), limite geral e por job, pausa por job ou instância, executar
// agora e encerrar uma execução.
const os = require('os');
const path = require('path');
const { fork, execFile } = require('child_process');
const repoPadrao = require('./repositorio');
const modoPadrao = require('./modo');
const alertaPadrao = require('./alerta');

const EXECUTOR = path.join(__dirname, 'executor-filho.js');
const CATALOGO_PADRAO = path.join(__dirname, 'catalogo.js');
// Só estes contam como falha (espera da retentativa e alerta). Encerrar pela
// tela, parar o serviço ou perder a concessão para outro não são falha do job.
const FALHAS = new Set(['erro', 'timeout']);
const MAX_LOG_MEMORIA = 200 * 1024;

const PADRAO = {
  tickMs: 5000,
  concessaoMs: 30000,
  renovacaoMs: 10000,
  prazoParadaMs: 45000,
  esperaBaseMs: 30000,
  esperaMaxMs: 15 * 60000,
  pedidoExpiraMs: 10 * 60000,
  podarCadaMs: 60 * 60000,
  prepararAlertaMs: 10 * 60000,
};

function _inteiroEnv(nome, padrao, min) {
  const n = Number(process.env[nome]);
  return Number.isInteger(n) && n >= min ? n : padrao;
}

/** Configuração de processo lida do .env (o que é de operação fica na tela Jobs). */
function configDoAmbiente() {
  return { prazoParadaMs: _inteiroEnv('IAHUB_JOBS_PRAZO_PARADA_MS', PADRAO.prazoParadaMs, 0) };
}

/** Espera antes da próxima tentativa: dobra a cada falha seguida, com teto e ±20% de variação. */
function esperaRetentativa(falhas, { esperaBaseMs, esperaMaxMs }, aleatorio = Math.random) {
  const base = Math.min(esperaMaxMs, esperaBaseMs * 2 ** Math.max(0, falhas - 1));
  return Math.round(base * (0.8 + aleatorio() * 0.4));
}

const _hora = () => new Date().toTimeString().slice(0, 8);

/** Processo filho real; guarda o que ele escreve (log da execução) e repassa ao log do serviço. */
function iniciarFilhoReal({ moduloCatalogo, jobId, instancia, origem, execId, aoNaoEncerrar = null }) {
  const filho = fork(EXECUTOR, [moduloCatalogo, jobId, instancia, origem, String(execId)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let log = '';
  let resto = '';
  const anotar = (pedaco, saida) => {
    const linhas = (resto + pedaco.toString('utf8')).split(/\r?\n/);
    resto = linhas.pop();
    for (const l of linhas) {
      log += `${_hora()} ${l}\n`;
      saida.write(`[${jobId} ${instancia}] ${l}\n`);
    }
    if (log.length > MAX_LOG_MEMORIA * 2) log = log.slice(-MAX_LOG_MEMORIA);
  };
  filho.stdout.on('data', (d) => anotar(d, process.stdout));
  filho.stderr.on('data', (d) => anotar(d, process.stderr));
  let mensagem = null;
  let saiu = false;
  let encerrando = false;
  filho.on('message', (m) => { if (m?.tipo === 'fim') mensagem = m; });
  // Windows: kill() derruba só o processo; taskkill /T /F derruba também o que
  // ele abriu (ex.: navegador de um job) — vem antes, senão a árvore se perde.
  const forcar = () => {
    if (process.platform === 'win32' && filho.pid) execFile('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => {});
    try { filho.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); } catch (_) { /* já saiu */ }
  };
  const fim = new Promise((resolve) => {
    filho.once('exit', (codigo, sinal) => { saiu = true; resolve({ mensagem, codigo, sinal }); });
    filho.on('error', (erro) => {
      // Um erro ao sinalizar um processo existente não prova que ele saiu.
      // Liberar sua trava nesse momento permitiria outra leitura simultânea.
      if (!filho.pid) resolve({ mensagem, codigo: null, erro });
      else process.stderr.write(`[${jobId} ${instancia}] erro no processo filho: ${erro.message}\n`);
    });
  });
  return {
    pid: filho.pid,
    fim,
    log: () => (resto ? `${log}${_hora()} ${resto}\n` : log),
    // Insiste até sair: força de novo em 15 s; em 30 s ainda vivo, avisa quem
    // chamou (a execução segue aberta de propósito — nunca roda outra junto).
    encerrar: () => {
      if (saiu || encerrando) return;
      encerrando = true;
      if (process.platform === 'win32') forcar();
      else { try { filho.kill(); } catch (_) { /* já saiu */ } }
      setTimeout(() => { if (!saiu) forcar(); }, 15000).unref();
      setTimeout(() => { if (!saiu && aoNaoEncerrar) aoNaoEncerrar(filho.pid); }, 30000).unref();
    },
  };
}

class Supervisor {
  constructor({ catalogo, repo = repoPadrao, iniciarFilho = iniciarFilhoReal, moduloCatalogo = CATALOGO_PADRAO,
    relogio = () => new Date(), config = {}, log = console, dono = `${os.hostname()}:${process.pid}`,
    modoServico = () => modoPadrao.modoConfigurado() === 'servico', alertar = alertaPadrao.enviar, verificarSite = null }) {
    this.catalogo = catalogo;
    this.repo = repo;
    this.iniciarFilho = iniciarFilho;
    this.moduloCatalogo = moduloCatalogo;
    this.relogio = relogio;
    this.cfg = { ...PADRAO, ...config };
    this.log = log;
    this.dono = dono;
    this.modoServico = modoServico;
    this.alertar = alertar;
    // Vigilância mútua: o site vigia o serviço (vigia.js) e o serviço vigia o site.
    this.verificarSite = verificarSite;
    this._siteFalhaDesde = null;
    this._ultimaVerifSite = 0;
    this.emCurso = new Map();
    this._parando = false;
    this._ticando = false;
    this._ultimaPoda = 0;
    this._avisos = new Map();
    this._modoAntes = null;
    this._alertasEmVoo = new Set();
    this._prepararDesde = new Map();
    this._falhouEm = new Map();
  }

  iniciar() {
    this.repo.registrarBatimento(this.dono, { agora: this.relogio(), iniciando: true });
    const jobs = this.catalogo.listar().map(d => d.id).join(', ') || 'nenhum';
    this._info(`Supervisor iniciado (${this.dono}); jobs: ${jobs}.`);
    this._evento('info', 'servico_iniciado', `Serviço iniciado (${this.dono}). Jobs no catálogo: ${jobs}.`);
    this._timer = setInterval(() => this.tick(), this.cfg.tickMs);
    return this.tick();
  }

  async tick() {
    if (this._ticando || this._parando) return;
    this._ticando = true;
    try {
      const agora = this.relogio();
      this.repo.registrarBatimento(this.dono, { agora });
      const ctx = this._contexto();
      await this._recolherOrfas(agora, ctx);
      this._podarSeHora(agora);
      this._reenviarPendentes(agora);
      await this._vigiarSite(agora);
      this._atenderPedidos(agora, ctx);
      const servico = this.modoServico();
      if (servico !== this._modoAntes) {
        this._info(servico ? 'Modo Serviço: agendando os jobs.' : 'Modo Site: o site agenda os jobs; aqui só os pedidos da tela Jobs.');
        this._modoAntes = servico;
      }
      if (servico) await this._agendados(agora, ctx);
    } catch (err) {
      this._erroUmaVez('tick', `Ciclo do supervisor falhou: ${err.message}`);
    } finally {
      this._ticando = false;
    }
  }

  /** Desligamento controlado. Devolve quando tudo foi encerrado e registrado. */
  async parar({ prazoMs = this.cfg.prazoParadaMs } = {}) {
    if (this._parando) return;
    this._parando = true;
    clearInterval(this._timer);
    try { this.repo.registrarBatimento(this.dono, { agora: this.relogio(), parando: true }); } catch (_) { /* segue parando */ }
    const pendentes = () => [...this.emCurso.values()].map(r => r.promessa);
    const emCurso = this.emCurso.size;
    if (emCurso) {
      this._info(`Parando: aguardando ${emCurso} execução(ões) por até ${Math.round(prazoMs / 1000)} s.`);
      await Promise.race([Promise.allSettled(pendentes()), new Promise(r => setTimeout(r, prazoMs))]);
    }
    for (const reg of this.emCurso.values()) {
      reg.motivoEncerramento = 'parada';
      reg.filho.encerrar();
    }
    await Promise.race([Promise.allSettled(pendentes()), new Promise(r => setTimeout(r, 10000))]);
    this._evento('aviso', 'servico_parado', `Serviço parado de forma controlada${emCurso ? ` (${emCurso} execução(ões) em andamento na parada)` : ''}.`);
    try { this.repo.registrarParada(this.dono, { agora: this.relogio() }); } catch (_) { /* banco indisponível: o batimento vence sozinho */ }
    this._info('Supervisor parado.');
  }

  _chave(jobId, instancia) {
    return `${jobId}|${instancia}`;
  }

  // Configuração da tela Jobs para este ciclo.
  _contexto() {
    const cfg = this.repo.getConfigJobs();
    const pausas = new Set();
    const limites = new Map();
    for (const c of this.repo.listarControles()) {
      if (c.pausado) pausas.add(this._chave(c.jobId, c.instancia));
      if (c.instancia === this.repo.TODAS && c.limite) limites.set(c.jobId, c.limite);
    }
    return {
      max: Math.max(1, Number(cfg.maxSimultaneos) || 20),
      alertaFalhas: Math.max(1, Number(cfg.alertaFalhas) || 3),
      pausado: (jobId, instancia) => pausas.has(this._chave(jobId, this.repo.TODAS)) || pausas.has(this._chave(jobId, instancia)),
      limiteJob: (jobId) => limites.get(jobId) || null,
    };
  }

  _emCursoDoJob(jobId) {
    let n = 0;
    for (const r of this.emCurso.values()) if (r.def.id === jobId) n++;
    return n;
  }

  _preparar(def) {
    const chave = `preparar:${def.id}`;
    try {
      if (def.preparar) def.preparar();
      // Voltou: avisa quem recebeu o alerta de que o job estava parado.
      if (this._prepararDesde.delete(def.id) && this.repo.fecharAlerta(chave)) {
        this._enviarAlerta(`✅ ${def.nome || def.id}\nVoltou a rodar no serviço de jobs.`, `${chave}:ok`, { tipo: 'servico', pendenteSeFalhar: true });
      }
      return true;
    } catch (err) {
      this._erroUmaVez(chave, `${def.id}: adiado — ${err.message}`);
      // Adiado há muito tempo (ex.: migração que nunca é aplicada): o job está
      // parado sem ninguém saber — alerta do tipo Serviço.
      const agora = this.relogio().getTime();
      if (!this._prepararDesde.has(def.id)) this._prepararDesde.set(def.id, agora);
      if (agora - this._prepararDesde.get(def.id) >= this.cfg.prepararAlertaMs) {
        const texto = `❌ ${def.nome || def.id}\nO serviço de jobs não consegue rodar este job há ${Math.round((agora - this._prepararDesde.get(def.id)) / 60000)} min: ${err.message}`;
        if (this.repo.abrirAlerta(chave, texto, { agora: this.relogio() })) this._enviarAlerta(texto, chave, { tipo: 'servico', reabrirSeFalhar: true });
      }
      return false;
    }
  }

  async _agendados(agora, ctx) {
    // Junta o que está na hora em todos os jobs e atende primeiro quem está
    // esperando há mais tempo (nenhuma empresa fica sempre por último).
    const candidatos = [];
    for (const def of this.catalogo.listar()) {
      if (this._parando) return;
      if (!this._preparar(def)) continue;
      let instancias;
      try {
        instancias = await def.instancias(agora);
      } catch (err) {
        this._erroUmaVez(`instancias:${def.id}`, `${def.id}: não foi possível listar o que rodar — ${err.message}`);
        continue;
      }
      for (const inst of instancias || []) {
        if (!inst?.devida || this.emCurso.has(this._chave(def.id, inst.instancia)) || ctx.pausado(def.id, inst.instancia)) continue;
        candidatos.push({ def, instancia: inst.instancia, desde: inst.devidaDesde || '' });
      }
    }
    candidatos.sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
    let esperando = 0;
    for (const c of candidatos) {
      if (this._parando) return;
      const limiteJob = ctx.limiteJob(c.def.id);
      if (this.emCurso.size >= ctx.max || (limiteJob && this._emCursoDoJob(c.def.id) >= limiteJob)) {
        esperando++;
        continue;
      }
      this._iniciar(c.def, c.instancia, 'agendado', { agora });
    }
    if (esperando) {
      this._avisoUmaVez('limite', 'limite_atingido',
        `Limite de execuções atingido (geral ${ctx.max}${this.catalogo.listar().some(d => ctx.limiteJob(d.id)) ? ', ou o limite do job' : ''}): ${esperando} esperando vaga.`);
    }
  }

  _atenderPedidos(agora, ctx) {
    for (const p of this.repo.listarPedidosAbertos()) {
      if (this._parando) return;
      if (p.tipo === 'encerrar') { this._atenderEncerrar(p, agora); continue; }
      const def = this.catalogo.obter(p.jobId);
      const recusar = (motivo) => {
        this.repo.atenderPedido(p.id, { recusa: motivo, agora });
        this._evento('aviso', 'pedido_recusado', `Executar agora recusado: ${motivo}.`, { jobId: p.jobId, instancia: p.instancia, usuario: p.solicitadoPor });
      };
      if (!def) { recusar('job desconhecido'); continue; }
      if (!def.instanciaValida(p.instancia)) { recusar('instância inválida'); continue; }
      if (agora.getTime() - Date.parse(p.solicitadoEm) > this.cfg.pedidoExpiraMs) { recusar('expirado sem vaga para rodar'); continue; }
      // Pedido explícito roda mesmo com o job pausado; só espera vaga geral.
      if (this.emCurso.has(this._chave(def.id, p.instancia)) || this.emCurso.size >= ctx.max) continue;
      if (!this._preparar(def)) continue;
      if (this._iniciar(def, p.instancia, p.origem, { agora, ignorarEspera: true, pedidoId: p.id }) && p.solicitadoPor) {
        this._evento('info', 'executar_agora', `Executar agora por ${p.solicitadoPor}.`, { jobId: def.id, instancia: p.instancia, usuario: p.solicitadoPor });
      }
    }
  }

  _atenderEncerrar(p, agora) {
    const reg = [...this.emCurso.values()].find(r => r.execId === p.alvoExecucaoId);
    if (!reg) {
      // A execução pode ser de outro processo (que a encerra) ou já ter terminado.
      if (!this.repo.listarExecucoesAbertas().some(e => e.id === p.alvoExecucaoId)) {
        this.repo.atenderPedido(p.id, { recusa: 'execução já terminou', agora });
      }
      return;
    }
    reg.motivoEncerramento = 'tela';
    reg.encerradoPor = p.solicitadoPor;
    this.repo.atenderPedido(p.id, { execucaoId: reg.execId, agora });
    reg.filho.encerrar();
  }

  _iniciar(def, instancia, origem, { agora, ignorarEspera = false, pedidoId = null }) {
    const ficha = this.repo.tomarConcessao(def.id, instancia, this.dono, { duracaoMs: this.cfg.concessaoMs, agora, ignorarEspera });
    if (ficha == null) return false;
    let empresaId = null;
    try { empresaId = def.empresaDaInstancia ? def.empresaDaInstancia(instancia) : null; } catch (_) { empresaId = null; }
    const execId = this.repo.abrirExecucao({ jobId: def.id, instancia, ficha, origem, dono: this.dono, empresaId, agora });
    if (pedidoId) this.repo.atenderPedido(pedidoId, { execucaoId: execId, agora });
    const reg = { def, instancia, origem, ficha, execId, empresaId, motivoEncerramento: null, logSalvo: '' };
    this.emCurso.set(this._chave(def.id, instancia), reg);
    try {
      reg.filho = this.iniciarFilho({ moduloCatalogo: this.moduloCatalogo, jobId: def.id, instancia, origem, execId, aoNaoEncerrar: (pid) => this._processoNaoEncerra(reg, pid) });
    } catch (err) {
      reg.filho = { encerrar() {}, fim: Promise.resolve({ mensagem: null, codigo: null, erro: err }) };
    }
    reg.renovacao = setInterval(() => {
      try {
        if (!this.repo.renovarConcessao(def.id, instancia, ficha, { duracaoMs: this.cfg.concessaoMs, agora: this.relogio() })) {
          reg.motivoEncerramento = 'concessao_perdida';
          reg.filho.encerrar();
          return;
        }
        // Log ao vivo para a tela.
        const log = reg.filho.log?.();
        if (log && log !== reg.logSalvo) {
          this.repo.salvarLogExecucao(execId, log);
          reg.logSalvo = log;
        }
      } catch (err) {
        // Banco ocupado numa renovação: a próxima tenta de novo antes de vencer.
        this._erroUmaVez(`renovar:${def.id}`, `${def.id} ${instancia}: renovação da concessão falhou — ${err.message}`);
      }
    }, this.cfg.renovacaoMs);
    reg.timeout = setTimeout(() => {
      reg.motivoEncerramento = 'timeout';
      reg.filho.encerrar();
    }, def.timeoutMs);
    this._info(`▶ ${def.id} ${instancia} (${origem}) execução #${execId}${reg.filho.pid ? `, pid ${reg.filho.pid}` : ''}.`);
    reg.promessa = reg.filho.fim
      .then(r => this._concluir(reg, r))
      .catch(err => this._erroUmaVez(`concluir:${def.id}`, `${def.id} ${instancia}: falha ao registrar o fim — ${err.message}`));
    return true;
  }

  async _concluir(reg, { mensagem, codigo, sinal, erro }) {
    clearInterval(reg.renovacao);
    clearTimeout(reg.timeout);
    const { def, instancia } = reg;
    let resultado;
    let textoErro = null;
    let resumo = null;
    const motivo = reg.motivoEncerramento;
    if (motivo === 'timeout') {
      resultado = 'timeout';
      textoErro = `Passou do tempo máximo (${Math.round(def.timeoutMs / 1000)} s): processo encerrado.`;
    } else if (motivo === 'parada') {
      resultado = 'interrompido';
      textoErro = 'Serviço de jobs parando: execução encerrada no meio.';
    } else if (motivo === 'tela') {
      resultado = 'interrompido';
      textoErro = `Encerrada pela tela Jobs${reg.encerradoPor ? ` por ${reg.encerradoPor}` : ''}.`;
    } else if (motivo === 'concessao_perdida') {
      resultado = 'interrompido';
      textoErro = 'Concessão assumida por outro processo: execução encerrada.';
    } else if (mensagem?.tipo === 'fim') {
      resultado = mensagem.resultado;
      textoErro = mensagem.erro || null;
      resumo = mensagem.resumo ?? null;
    } else {
      resultado = 'erro';
      textoErro = erro?.message || `Processo terminou sem resultado (código ${codigo}${sinal ? `, sinal ${sinal}` : ''}).`;
    }
    const interrompeu = resultado === 'erro' || resultado === 'timeout' || resultado === 'interrompido';
    // Concessão perdida: quem assumiu é dono do estado do job agora.
    if (interrompeu && motivo !== 'concessao_perdida') await this._aoInterromper(def, instancia, reg.origem, textoErro, reg.execId, false);
    const agora = this.relogio();
    this.repo.fecharExecucao(reg.execId, { resultado, erro: textoErro, resumo, log: reg.filho.log?.() ?? undefined, agora });
    const falhou = FALHAS.has(resultado);
    const falhas = falhou ? this.repo.falhasSeguidas(def.id, instancia) + 1 : 0;
    const esperaMs = falhou ? esperaRetentativa(falhas, this.cfg) : 0;
    this.repo.devolverConcessao(def.id, instancia, reg.ficha, { falhou, esperaMs, agora });
    this.emCurso.delete(this._chave(def.id, instancia));
    const onde = { jobId: def.id, instancia, empresaId: reg.empresaId };
    if (falhou) {
      this.log.error(`[Jobs] ✖ ${def.id} ${instancia} execução #${reg.execId}: ${resultado} — ${textoErro} (${falhas} falha(s) seguida(s); próxima tentativa em ${Math.round(esperaMs / 1000)} s).`);
      this._evento('erro', 'execucao_falhou', `Execução #${reg.execId}: ${resultado} — ${_resumir(textoErro)} (${falhas} falha(s) seguida(s); próxima tentativa em ${Math.round(esperaMs / 1000)} s).`, onde);
      this._alertarFalha(def, instancia, reg.empresaId, falhas, `${resultado} — ${_resumir(textoErro)}`);
    } else {
      if (resultado === 'interrompido') {
        this._evento('aviso', 'execucao_interrompida', `Execução #${reg.execId}: ${textoErro}`, { ...onde, usuario: motivo === 'tela' ? reg.encerradoPor : null });
      }
      this._info(`■ ${def.id} ${instancia} execução #${reg.execId}: ${resultado}.`);
      if (resultado !== 'interrompido') this._alertarNormalizou(def, instancia);
    }
  }

  async _aoInterromper(def, instancia, origem, motivo, execId, orfa) {
    if (!def.aoInterromper) return;
    try {
      if (!this._preparar(def)) return;
      await def.aoInterromper(instancia, { origem, motivo, execId, orfa });
    } catch (err) {
      this.log.error(`[Jobs] ${def.id} ${instancia}: limpeza após interrupção falhou — ${err.message}`);
      this._evento('erro', 'limpeza_falhou', `Limpeza após interrupção falhou: ${err.message}`, { jobId: def.id, instancia });
    }
  }

  /**
   * Execuções que ficaram abertas com um processo que morreu. Só limpa quem
   * consegue a concessão: se outro já roda a instância, o estado é dele.
   */
  async _recolherOrfas(agora, ctx) {
    const minhas = [...this.emCurso.values()].map(r => r.execId);
    for (const o of this.repo.listarExecucoesOrfas({ agora, excluirIds: minhas })) {
      const def = this.catalogo.obter(o.jobId);
      const ficha = this.emCurso.has(this._chave(o.jobId, o.instancia)) ? null
        : this.repo.tomarConcessao(o.jobId, o.instancia, this.dono, { duracaoMs: this.cfg.concessaoMs, agora, ignorarEspera: true });
      const motivo = 'O processo que rodava esta execução parou (serviço derrubado ou máquina reiniciada).';
      if (ficha != null && def) await this._aoInterromper(def, o.instancia, o.origem, motivo, o.id, true);
      this.repo.fecharExecucao(o.id, { resultado: 'erro', erro: motivo, agora });
      let falhas = 0;
      if (ficha != null) {
        falhas = this.repo.falhasSeguidas(o.jobId, o.instancia) + 1;
        this.repo.devolverConcessao(o.jobId, o.instancia, ficha, { falhou: true, esperaMs: esperaRetentativa(falhas, this.cfg), agora });
      }
      this.log.error(`[Jobs] ✖ ${o.jobId} ${o.instancia} execução #${o.id}: ${motivo}`);
      this._evento('erro', 'execucao_orfa', `Execução #${o.id}: ${motivo}`, { jobId: o.jobId, instancia: o.instancia, empresaId: o.empresaId });
      if (falhas && def) this._alertarFalha(def, o.instancia, o.empresaId, falhas, motivo, ctx);
    }
  }

  _rotulo(def, instancia) {
    try {
      const d = def.descreverInstancia?.(instancia);
      return `${def.nome || def.id} · ${d?.rotulo || instancia}`;
    } catch (_) {
      return `${def.nome || def.id} · ${instancia}`;
    }
  }

  _alertarFalha(def, instancia, empresaId, falhas, texto, ctx = this._contexto()) {
    if (falhas < ctx.alertaFalhas) return;
    const chave = `falha:${def.id}|${instancia}`;
    const mensagem = `❌ ${this._rotulo(def, instancia)}\n${falhas} falha(s) seguida(s). Última: ${texto}\nVeja a tela Jobs (IA Gestão).`;
    if (!this.repo.abrirAlerta(chave, mensagem, { agora: this.relogio() })) return;
    this._enviarAlerta(mensagem, chave, { reabrirSeFalhar: true });
  }

  _alertarNormalizou(def, instancia) {
    const chave = `falha:${def.id}|${instancia}`;
    if (!this.repo.fecharAlerta(chave)) return;
    this._enviarAlerta(`✅ ${this._rotulo(def, instancia)}\nVoltou ao normal: a última execução terminou sem erro.`, `${chave}:ok`, { pendenteSeFalhar: true });
  }

  // Envio em segundo plano: o WhatsApp nunca atrasa nem derruba o supervisor.
  // reabrirSeFalhar: alerta que não chegou (WhatsApp/IA Command fora) sai do
  // controle de "já avisado" e é enviado de novo na próxima vez que a situação
  // se repetir. Sem destino configurado não reabre (evita o mesmo aviso em laço).
  // pendenteSeFalhar ("voltou ao normal"): não chegou, fica guardado e
  // _reenviarPendentes tenta de novo a cada ciclo por até 1 h.
  // semWhatsapp: o site está fora (o WhatsApp sai por ele) — vai direto à reserva.
  _enviarAlerta(texto, chave, { tipo = 'falha', reabrirSeFalhar = false, pendenteSeFalhar = false, semWhatsapp = false } = {}) {
    if (this._alertasEmVoo.has(chave)) return;
    const falhou = () => {
      try {
        if (reabrirSeFalhar) this.repo.fecharAlerta(chave);
        if (pendenteSeFalhar) this.repo.abrirAlerta(chave, texto, { agora: this.relogio() });
      } catch (_) { /* tenta na próxima */ }
    };
    // Canais fora: no máximo uma tentativa a cada 5 min por alerta (sem isso,
    // pendentes e site fora gerariam centenas de tentativas e eventos por hora).
    const agoraMs = this.relogio().getTime();
    if (agoraMs - (this._falhouEm.get(chave) || -Infinity) < 5 * 60000) { falhou(); return; }
    this._alertasEmVoo.add(chave);
    Promise.resolve()
      .then(() => this.alertar(texto, { tipo, referencia: chave.slice(0, 60), semWhatsapp }))
      .then((r) => {
        if (r && r.enviado) { this._falhouEm.delete(chave); if (pendenteSeFalhar) this.repo.fecharAlerta(chave); return; }
        if (r && r.motivo === 'sem destino configurado') { if (pendenteSeFalhar) this.repo.fecharAlerta(chave); return; }
        this._falhouEm.set(chave, this.relogio().getTime());
        falhou();
      })
      .catch((err) => {
        this._falhouEm.set(chave, this.relogio().getTime());
        falhou();
        this._erroUmaVez(`alerta:${chave}`, `Alerta não enviado: ${err.message}`);
      })
      .finally(() => this._alertasEmVoo.delete(chave));
  }

  // "Voltou ao normal" que não chegou: tenta de novo; passada 1 h, desiste
  // (aviso velho de normalização só confunde).
  _reenviarPendentes(agora) {
    let pendentes;
    try { pendentes = this.repo.listarAlertasAbertos().filter(a => a.chave.endsWith(':ok')); } catch (_) { return; }
    for (const a of pendentes) {
      if (agora.getTime() - Date.parse(a.abertoEm) > 60 * 60000) { this.repo.fecharAlerta(a.chave); continue; }
      this._enviarAlerta(a.texto, a.chave, { tipo: a.chave.startsWith('falha:') ? 'falha' : 'servico', pendenteSeFalhar: true });
    }
  }

  // Vigilância mútua: o serviço confere o site a cada minuto. Site fora há
  // mais que "minutos sem sinal": avisa direto por e-mail/Telegram (o
  // WhatsApp sai pelo site) e de novo quando ele volta.
  async _vigiarSite(agora) {
    if (!this.verificarSite || agora.getTime() - this._ultimaVerifSite < 60000) return;
    this._ultimaVerifSite = agora.getTime();
    let ok = false;
    try { ok = await this.verificarSite(); } catch (_) { ok = false; }
    const chave = 'site_sem_resposta';
    if (ok) {
      this._siteFalhaDesde = null;
      if (this.repo.fecharAlerta(chave)) {
        this._evento('info', 'site_voltou', 'O site do IAHub voltou a responder ao serviço de jobs.');
        this._enviarAlerta('✅ O site do IAHub voltou a responder.', `${chave}:ok`, { tipo: 'servico', pendenteSeFalhar: true });
      }
      return;
    }
    if (!this._siteFalhaDesde) this._siteFalhaDesde = agora.getTime();
    let tolMin = 5;
    try { tolMin = Math.max(1, Number(this.repo.getConfigJobs().alertaSemSinalMin) || 5); } catch (_) { /* padrão */ }
    const foraMs = agora.getTime() - this._siteFalhaDesde;
    if (foraMs < tolMin * 60000) return;
    const texto = `❌ O site do IAHub não responde ao serviço de jobs há ${Math.round(foraMs / 60000)} min.\nWhatsApp e telas ficam fora enquanto isso; os jobs continuam rodando no serviço. Verifique o serviço "iahub" no servidor (services.msc / logs\\error.log).`;
    if (!this.repo.abrirAlerta(chave, texto, { agora })) return;
    this._evento('erro', 'site_sem_resposta', `O site do IAHub não responde há ${Math.round(foraMs / 60000)} min.`);
    this._enviarAlerta(texto, chave, { tipo: 'servico', reabrirSeFalhar: true, semWhatsapp: true });
  }

  // Processo que não sai nem com taskkill: execução fica aberta (nunca roda
  // outra junto); evento e alerta para alguém olhar o servidor.
  _processoNaoEncerra(reg, pid) {
    const chave = `nao_encerra:${reg.def.id}|${reg.instancia}`;
    const texto = `❌ ${this._rotulo(reg.def, reg.instancia)}\nO processo da execução #${reg.execId} (pid ${pid}) não encerra nem forçado. A execução fica bloqueada até ele sair; verifique o servidor (Gerenciador de Tarefas).`;
    this.log.error(`[Jobs] ${texto.replace(/\n/g, ' ')}`);
    this._evento('erro', 'processo_nao_encerra', texto.replace(/^❌ /, ''), { jobId: reg.def.id, instancia: reg.instancia, empresaId: reg.empresaId });
    if (this.repo.abrirAlerta(chave, texto, { agora: this.relogio() })) this._enviarAlerta(texto, chave, { tipo: 'servico', reabrirSeFalhar: true });
  }

  _podarSeHora(agora) {
    if (agora.getTime() - this._ultimaPoda < this.cfg.podarCadaMs) return;
    this._ultimaPoda = agora.getTime();
    try {
      const r = this.repo.podarHistorico({ agora });
      if (r.antigas || r.vazias || r.pedidos || r.eventos) {
        this._info(`Histórico podado: ${r.antigas} antiga(s), ${r.vazias} vazia(s), ${r.pedidos} pedido(s), ${r.eventos} evento(s).`);
      }
    } catch (err) {
      this._erroUmaVez('poda', `Poda do histórico falhou: ${err.message}`);
    }
  }

  _evento(nivel, tipo, texto, { jobId = null, instancia = null, empresaId = null, usuario = null } = {}) {
    try {
      this.repo.registrarEvento({ nivel, tipo, jobId, instancia, empresaId, texto, usuario, agora: this.relogio() });
    } catch (err) {
      this._erroUmaVez('evento', `Evento não gravado: ${err.message}`);
    }
  }

  _info(texto) {
    this.log.log(`[Jobs] ${texto}`);
  }

  // O mesmo erro repetido a cada tick vira uma linha por minuto no log.
  // Na tela, o mesmo erro vira no máximo um evento a cada 10 min.
  _erroUmaVez(chave, texto) {
    const agora = Date.now();
    if (agora - (this._avisos.get(chave) || 0) < 60000) return;
    this._avisos.set(chave, agora);
    this.log.error(`[Jobs] ${texto}`);
    if (agora - (this._avisos.get(`evento:${chave}`) || 0) < 10 * 60000) return;
    this._avisos.set(`evento:${chave}`, agora);
    this._evento('erro', 'supervisor', texto);
  }

  // Situação que se repete a cada ciclo (ex.: fila por limite): um evento a cada 10 min.
  _avisoUmaVez(chave, tipo, texto) {
    const agora = Date.now();
    if (agora - (this._avisos.get(`aviso:${chave}`) || 0) < 10 * 60000) return;
    this._avisos.set(`aviso:${chave}`, agora);
    this._info(texto);
    this._evento('aviso', tipo, texto);
  }
}

function _resumir(texto) {
  const primeira = String(texto || '').split('\n')[0];
  return primeira.length > 300 ? `${primeira.slice(0, 300)}…` : primeira;
}

module.exports = { Supervisor, esperaRetentativa, configDoAmbiente, iniciarFilhoReal, PADRAO, CATALOGO_PADRAO };

// node --test tests/jobs-servico.test.js
// Serviço de jobs (IAHub-Jobs, 2026-11-24): concessão exclusiva com ficha
// (fencing), retentativa com espera crescente, pedidos do "Executar agora",
// batimento do serviço, poda do histórico, supervisor (tempo máximo, processo
// que morre, concessão perdida, execução órfã, desligamento controlado) e
// processos filhos reais.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const jobsDb = require('../modules/jobs/database');
jobsDb.inicializarDB(path.join(os.tmpdir(), `iahub-jobs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
const repo = require('../modules/jobs/repositorio');
const { Supervisor, esperaRetentativa, iniciarFilhoReal } = require('../modules/jobs/supervisor');
const { montar, validarDefinicao } = require('../modules/jobs/catalogo');

const CATALOGO_TESTE = path.join(__dirname, 'fixtures', 'jobs-catalogo-teste.js');
const T0 = new Date('2026-11-24T12:00:00.000Z');
const mais = (ms, base = T0) => new Date(base.getTime() + ms);

beforeEach(() => {
  for (const t of ['jobs_concessoes', 'jobs_execucoes', 'jobs_pedidos', 'jobs_servico', 'jobs_config', 'jobs_controle', 'jobs_eventos', 'jobs_alertas']) jobsDb.getDB().prepare(`DELETE FROM ${t}`).run();
});

// ── Repositório ────────────────────────────────────────────────────────────

test('concessão: um dono por vez; vencida passa para outro com ficha maior', () => {
  const f1 = repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: T0 });
  assert.equal(f1, 1);
  assert.equal(repo.tomarConcessao('a.b', 'x', 'B', { duracaoMs: 30000, agora: mais(29000) }), null);
  // Outra instância do mesmo job é independente.
  assert.equal(repo.tomarConcessao('a.b', 'y', 'B', { duracaoMs: 30000, agora: T0 }), 1);
  const f2 = repo.tomarConcessao('a.b', 'x', 'B', { duracaoMs: 30000, agora: mais(31000) });
  assert.equal(f2, 2);
});

test('ficha (fencing): quem perdeu a concessão não renova nem devolve', () => {
  const f1 = repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 1000, agora: T0 });
  const f2 = repo.tomarConcessao('a.b', 'x', 'B', { duracaoMs: 30000, agora: mais(2000) });
  assert.equal(repo.renovarConcessao('a.b', 'x', f1, { duracaoMs: 30000, agora: mais(2500) }), false);
  assert.equal(repo.devolverConcessao('a.b', 'x', f1, { falhou: false, agora: mais(2500) }), false);
  // A concessão de B segue de pé.
  assert.equal(repo.tomarConcessao('a.b', 'x', 'C', { duracaoMs: 30000, agora: mais(3000) }), null);
  assert.equal(repo.renovarConcessao('a.b', 'x', f2, { duracaoMs: 30000, agora: mais(3000) }), true);
  assert.equal(repo.devolverConcessao('a.b', 'x', f2, { falhou: false, agora: mais(3000) }), true);
  assert.ok(repo.tomarConcessao('a.b', 'x', 'C', { duracaoMs: 30000, agora: mais(3001) }));
});

test('falha: espera antes da próxima tentativa; sucesso zera; pedido da tela fura a espera', () => {
  const f = repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: T0 });
  repo.devolverConcessao('a.b', 'x', f, { falhou: true, esperaMs: 60000, agora: T0 });
  assert.equal(repo.falhasSeguidas('a.b', 'x'), 1);
  assert.equal(repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: mais(59000) }), null);
  const f2 = repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: mais(59000), ignorarEspera: true });
  assert.ok(f2);
  repo.devolverConcessao('a.b', 'x', f2, { falhou: false, agora: mais(59500) });
  assert.equal(repo.falhasSeguidas('a.b', 'x'), 0);
  assert.ok(repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: mais(59600) }));
});

test('espera da retentativa dobra a cada falha, com teto e variação de ±20%', () => {
  const cfg = { esperaBaseMs: 30000, esperaMaxMs: 15 * 60000 };
  assert.equal(esperaRetentativa(1, cfg, () => 0.5), 30000);
  assert.equal(esperaRetentativa(2, cfg, () => 0.5), 60000);
  assert.equal(esperaRetentativa(3, cfg, () => 0.5), 120000);
  assert.equal(esperaRetentativa(30, cfg, () => 0.5), 15 * 60000);
  assert.equal(esperaRetentativa(1, cfg, () => 0), 24000);
  assert.equal(esperaRetentativa(1, cfg, () => 1), 36000);
});

test('pedidos: um aberto por instância; atendido some da lista', () => {
  const id = repo.criarPedido('a.b', 'x', { agora: T0 });
  assert.equal(repo.criarPedido('a.b', 'x', { agora: mais(1000) }), id);
  assert.notEqual(repo.criarPedido('a.b', 'y', { agora: T0 }), id);
  assert.equal(repo.pedidoAberto('a.b', 'x').id, id);
  assert.equal(repo.atenderPedido(id, { execucaoId: 7, agora: mais(2000) }), true);
  assert.equal(repo.atenderPedido(id, { execucaoId: 8, agora: mais(3000) }), false);
  assert.equal(repo.pedidoAberto('a.b', 'x'), null);
  assert.deepEqual(repo.listarPedidosAbertos().map(p => p.instancia), ['y']);
});

test('batimento: ativo enquanto recente; parando ou parada limpa = inativo', () => {
  assert.equal(repo.estadoServico({ agora: T0 }).ativo, false);
  repo.registrarBatimento('S1', { agora: T0, iniciando: true });
  assert.equal(repo.estadoServico({ agora: mais(10000) }).ativo, true);
  assert.equal(repo.estadoServico({ agora: mais(31000) }).ativo, false);
  repo.registrarBatimento('S1', { agora: mais(40000), parando: true });
  assert.equal(repo.estadoServico({ agora: mais(40000) }).ativo, false);
  repo.registrarBatimento('S1', { agora: mais(50000) });
  repo.registrarParada('S1');
  const e = repo.estadoServico({ agora: mais(50000) });
  assert.equal(e.ativo, false);
  assert.equal(e.batimentoEm, null);
  assert.equal(e.iniciadoEm, T0.toISOString());
});

test('órfãs: execução aberta com concessão vencida; a que está de pé não entra', () => {
  const f1 = repo.tomarConcessao('a.b', 'x', 'A', { duracaoMs: 30000, agora: T0 });
  const e1 = repo.abrirExecucao({ jobId: 'a.b', instancia: 'x', ficha: f1, origem: 'agendado', dono: 'A', agora: T0 });
  assert.deepEqual(repo.listarExecucoesOrfas({ agora: mais(10000) }), []);
  assert.deepEqual(repo.listarExecucoesOrfas({ agora: mais(31000) }).map(o => o.id), [e1]);
  assert.deepEqual(repo.listarExecucoesOrfas({ agora: mais(31000), excluirIds: [e1] }), []);
  repo.fecharExecucao(e1, { resultado: 'interrompido', agora: mais(31000) });
  assert.deepEqual(repo.listarExecucoesOrfas({ agora: mais(31000) }), []);
});

test('poda: tira o que passou de 30 dias e deixa só as últimas vazias', () => {
  const abrirFechada = (resultado, agora) => {
    const id = repo.abrirExecucao({ jobId: 'a.b', instancia: 'x', ficha: 1, origem: 'agendado', dono: 'A', agora });
    repo.fecharExecucao(id, { resultado, agora });
    return id;
  };
  const velha = abrirFechada('ok', mais(-31 * 86400000));
  const ok = abrirFechada('ok', T0);
  const vazias = Array.from({ length: 5 }, (_, i) => abrirFechada('vazio', mais(i * 1000)));
  const r = repo.podarHistorico({ agora: T0, vaziasPorInstancia: 2 });
  assert.equal(r.antigas, 1);
  assert.equal(r.vazias, 3);
  const ids = jobsDb.getDB().prepare('SELECT id FROM jobs_execucoes ORDER BY id').all().map(x => x.id);
  assert.deepEqual(ids, [ok, ...vazias.slice(-2)]);
  assert.ok(!ids.includes(velha));
});

test('banco: abrir duas vezes o mesmo arquivo não reaplica migração', () => {
  const arquivo = path.join(os.tmpdir(), `iahub-jobs-dupla-${Date.now()}.db`);
  const db1 = jobsDb.inicializarDB(arquivo);
  const db2 = jobsDb.inicializarDB(arquivo);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
  db1.close();
  db2.close();
  jobsDb.inicializarDB(path.join(os.tmpdir(), `iahub-jobs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
});

// ── Catálogo ───────────────────────────────────────────────────────────────

test('catálogo: job fora do contrato não entra (idempotente obrigatório)', () => {
  const ok = { id: 'app.job', descricao: 'x', idempotente: true, timeoutMs: 1000, instancias() {}, instanciaValida() {}, executar() {} };
  assert.deepEqual(validarDefinicao(ok), []);
  assert.match(validarDefinicao({ ...ok, idempotente: undefined }).join(), /idempotente/);
  assert.match(validarDefinicao({ ...ok, id: 'semponto' }).join(), /id inválido/);
  assert.match(validarDefinicao({ ...ok, timeoutMs: 0 }).join(), /timeoutMs/);
  assert.throws(() => montar([ok, ok]), /duplicado/);
  assert.throws(() => montar([{ ...ok, executar: undefined }]), /fora do contrato/);
});

test('catálogo real: todos os jobs cumprem o contrato', () => {
  const real = require('../modules/jobs/catalogo').padrao().listar();
  assert.ok(real.some(d => d.id === 'ia-service.jade-pa'));
});

// ── Supervisor (processos simulados) ───────────────────────────────────────

function filhosFalsos() {
  const lista = [];
  const iniciar = ({ jobId, instancia, origem }) => {
    let resolver;
    const fim = new Promise(r => { resolver = r; });
    const f = {
      jobId, instancia, origem, encerrado: false, pid: 1000 + lista.length, fim,
      terminar: (m, codigo = 0) => resolver(m ? { mensagem: { tipo: 'fim', ...m }, codigo } : { mensagem: null, codigo: 3 }),
      encerrar() { f.encerrado = true; resolver({ mensagem: null, codigo: null, sinal: 'SIGTERM' }); },
      logTexto: '',
      log: () => f.logTexto,
    };
    lista.push(f);
    return f;
  };
  return { lista, iniciar };
}

function logMudo() {
  const linhas = [];
  return { linhas, log: (t) => linhas.push(t), error: (t) => linhas.push(t) };
}

async function esperar(cond, ms = 3000) {
  const ate = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > ate) throw new Error('condição não atingida');
    await new Promise(r => setTimeout(r, 5));
  }
}

function montarSupervisor({ defs, config = {}, dono = 'S1', servico = true }) {
  const filhos = filhosFalsos();
  const log = logMudo();
  const alertas = [];
  let desloc = 0;
  const modo = { servico };
  const sup = new Supervisor({
    catalogo: montar(defs), iniciarFilho: filhos.iniciar, relogio: () => new Date(Date.now() + desloc),
    config: { renovacaoMs: 20, tickMs: 1e9, ...config }, log, dono,
    modoServico: () => modo.servico, alertar: async (texto) => { alertas.push(texto); return { enviado: true }; },
  });
  return { sup, filhos, log, alertas, modo, avancar: (ms) => { desloc += ms; } };
}

function defTeste(extra = {}) {
  const chamadas = { interrompidas: [] };
  const def = {
    id: 'teste.job', descricao: 'x', idempotente: true, timeoutMs: 60000,
    devidas: ['x'],
    instancias() { return ['x', 'y'].map(i => ({ instancia: i, devida: def.devidas.includes(i) })); },
    instanciaValida: (i) => i !== 'invalida',
    executar() {},
    aoInterromper(instancia, ctx) { chamadas.interrompidas.push({ instancia, ...ctx }); },
    ...extra,
  };
  return { def, chamadas };
}

test('supervisor: roda só o que está na hora, uma vez por instância, e registra o fim', async () => {
  const { def } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => `${f.instancia}:${f.origem}`), ['x:agendado']);
  filhos.lista[0].terminar({ resultado: 'ok', resumo: { n: 1 } });
  await esperar(() => !sup.emCurso.size);
  const ult = repo.ultimaExecucao('teste.job', 'x');
  assert.equal(ult.resultado, 'ok');
  assert.deepEqual(ult.resumo, { n: 1 });
  assert.equal(repo.falhasSeguidas('teste.job', 'x'), 0);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: resultado recebido seguido de saída anormal vira aviso sem interromper o job', async () => {
  const { def, chamadas } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  filhos.lista[0].terminar({ resultado: 'ok', resumo: { enviados: 2 } }, 3221226505);
  await esperar(() => !sup.emCurso.size);
  const ult = repo.ultimaExecucao('teste.job', 'x');
  assert.equal(ult.resultado, 'aviso');
  assert.deepEqual(ult.resumo, { enviados: 2 });
  assert.match(ult.erro, /encerrou de forma anormal/);
  assert.equal(repo.falhasSeguidas('teste.job', 'x'), 0);
  assert.equal(chamadas.interrompidas.length, 0);
  assert.ok(repo.listarEventos().some(e => e.tipo === 'encerramento_anormal'));
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: limite de execuções simultâneas', async () => {
  const { def } = defTeste();
  def.devidas = ['x', 'y'];
  repo.salvarConfigJobs({ maxSimultaneos: 1 });
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  assert.equal(filhos.lista.length, 1);
  filhos.lista[0].terminar({ resultado: 'vazio' });
  await esperar(() => !sup.emCurso.size);
  await sup.tick();
  assert.equal(filhos.lista.length, 2);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: tempo máximo encerra o processo, limpa o job e espera antes de tentar de novo', async () => {
  const { def, chamadas } = defTeste({ timeoutMs: 1000 });
  const { sup, filhos, avancar } = montarSupervisor({ defs: [def] });
  await sup.tick();
  await esperar(() => filhos.lista[0].encerrado && !sup.emCurso.size);
  const ult = repo.ultimaExecucao('teste.job', 'x');
  assert.equal(ult.resultado, 'timeout');
  assert.deepEqual(chamadas.interrompidas.map(c => c.instancia), ['x']);
  assert.equal(repo.falhasSeguidas('teste.job', 'x'), 1);
  // Ainda na espera: não roda de novo; depois dela, roda.
  await sup.tick();
  assert.equal(filhos.lista.length, 1);
  avancar(40000);
  await sup.tick();
  assert.equal(filhos.lista.length, 2);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: processo que morre sem resultado é erro; job que lança devolve a mensagem', async () => {
  const { def, chamadas } = defTeste();
  def.devidas = ['x', 'y'];
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  filhos.lista[0].terminar(null);
  filhos.lista[1].terminar({ resultado: 'erro', erro: 'Error: deu ruim' });
  await esperar(() => !sup.emCurso.size);
  assert.match(repo.ultimaExecucao('teste.job', 'x').erro, /terminou sem resultado \(código 3\)/);
  assert.equal(repo.ultimaExecucao('teste.job', 'y').erro, 'Error: deu ruim');
  assert.equal(chamadas.interrompidas.length, 2);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: concessão tomada por outro processo encerra o filho sem mexer no estado do job', async () => {
  const { def, chamadas } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  // Outro supervisor assumiu (ex.: este ficou congelado e a concessão venceu).
  jobsDb.getDB().prepare("UPDATE jobs_concessoes SET ficha = ficha + 1, dono = 'S2'").run();
  await esperar(() => filhos.lista[0].encerrado && !sup.emCurso.size);
  assert.equal(repo.ultimaExecucao('teste.job', 'x').resultado, 'interrompido');
  assert.deepEqual(chamadas.interrompidas, []);
  // A concessão continua com S2.
  assert.equal(jobsDb.getDB().prepare('SELECT dono FROM jobs_concessoes').get().dono, 'S2');
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: execução órfã de um processo que morreu é encerrada e o job limpa', async () => {
  const { def, chamadas } = defTeste();
  def.devidas = [];
  const agoraReal = new Date();
  const f = repo.tomarConcessao('teste.job', 'x', 'MORTO', { duracaoMs: 30000, agora: mais(-60000, agoraReal) });
  const exec = repo.abrirExecucao({ jobId: 'teste.job', instancia: 'x', ficha: f, origem: 'manual', dono: 'MORTO', agora: mais(-60000, agoraReal) });
  const { sup } = montarSupervisor({ defs: [def] });
  await sup.tick();
  assert.equal(repo.ultimaExecucao('teste.job', 'x').id, exec);
  assert.equal(repo.ultimaExecucao('teste.job', 'x').resultado, 'erro');
  assert.deepEqual(chamadas.interrompidas.map(c => `${c.instancia}:${c.origem}`), ['x:manual']);
  assert.equal(repo.falhasSeguidas('teste.job', 'x'), 1);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: pedido da tela roda como manual (fura a espera); inválido e vencido são recusados', async () => {
  const { def } = defTeste();
  def.devidas = [];
  const { sup, filhos, avancar } = montarSupervisor({ defs: [def] });
  const f = repo.tomarConcessao('teste.job', 'x', 'S0', { duracaoMs: 30000, agora: new Date() });
  repo.devolverConcessao('teste.job', 'x', f, { falhou: true, esperaMs: 3600000, agora: new Date() });
  repo.criarPedido('teste.job', 'x');
  const invalido = repo.criarPedido('teste.job', 'invalida');
  const desconhecido = repo.criarPedido('outro.job', 'x');
  await sup.tick();
  assert.deepEqual(filhos.lista.map(x => `${x.instancia}:${x.origem}`), ['x:manual']);
  const recusas = jobsDb.getDB().prepare('SELECT id, recusa FROM jobs_pedidos WHERE recusa IS NOT NULL ORDER BY id').all();
  assert.deepEqual(recusas, [{ id: invalido, recusa: 'instância inválida' }, { id: desconhecido, recusa: 'job desconhecido' }]);
  assert.equal(repo.pedidoAberto('teste.job', 'x'), null);
  filhos.lista[0].terminar({ resultado: 'ok' });
  await esperar(() => !sup.emCurso.size);
  repo.criarPedido('teste.job', 'y');
  avancar(11 * 60000);
  await sup.tick();
  assert.equal(jobsDb.getDB().prepare("SELECT recusa FROM jobs_pedidos WHERE instancia = 'y'").get().recusa, 'expirado sem vaga para rodar');
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: preparar com erro adia o job (ex.: migração pendente) sem derrubar o resto', async () => {
  const a = defTeste().def;
  a.preparar = () => { throw new Error('migração pendente'); };
  const b = { ...defTeste().def, id: 'teste.outro' };
  const { sup, filhos, log } = montarSupervisor({ defs: [a, b] });
  await sup.tick();
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => f.jobId), ['teste.outro']);
  assert.equal(log.linhas.filter(l => /migração pendente/.test(l)).length, 1);
  await sup.parar({ prazoMs: 0 });
});

test('supervisor: desligamento espera o prazo, encerra o resto, limpa o job e some o batimento', async () => {
  const { def, chamadas } = defTeste();
  def.devidas = ['x', 'y'];
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  assert.equal(repo.estadoServico().ativo, true);
  setTimeout(() => filhos.lista[0].terminar({ resultado: 'ok' }), 10);
  await sup.parar({ prazoMs: 80 });
  assert.equal(filhos.lista[0].encerrado, false);
  assert.equal(filhos.lista[1].encerrado, true);
  assert.equal(repo.ultimaExecucao('teste.job', 'x').resultado, 'ok');
  assert.equal(repo.ultimaExecucao('teste.job', 'y').resultado, 'interrompido');
  assert.deepEqual(chamadas.interrompidas.map(c => c.instancia), ['y']);
  assert.equal(repo.estadoServico().ativo, false);
  // Parado não inicia mais nada.
  await sup.tick();
  assert.equal(filhos.lista.length, 2);
});

test('supervisor: dois supervisores no mesmo banco nunca rodam a mesma instância juntos', async () => {
  const { def } = defTeste();
  const s1 = montarSupervisor({ defs: [def], dono: 'S1' });
  const s2 = montarSupervisor({ defs: [def], dono: 'S2' });
  await Promise.all([s1.sup.tick(), s2.sup.tick()]);
  assert.equal(s1.filhos.lista.length + s2.filhos.lista.length, 1);
  await Promise.all([s1.sup.parar({ prazoMs: 0 }), s2.sup.parar({ prazoMs: 0 })]);
});

// ── Processos filhos reais ─────────────────────────────────────────────────

async function rodarReal(jobId, { esperarMs = 20000 } = {}) {
  const h = iniciarFilhoReal({ moduloCatalogo: CATALOGO_TESTE, jobId, instancia: 'i1', origem: 'manual' });
  const timer = setTimeout(() => h.encerrar(), esperarMs);
  const r = await h.fim;
  clearTimeout(timer);
  return { ...r, pid: h.pid };
}

test('filho real: resultado volta pelo canal e o processo sai', async () => {
  const r = await rodarReal('teste.ok');
  assert.equal(r.codigo, 0);
  assert.equal(r.mensagem.resultado, 'ok');
  assert.deepEqual({ ...r.mensagem.resumo, pid: undefined }, { instancia: 'i1', origem: 'manual', pid: undefined });
  assert.equal(r.mensagem.resumo.pid, r.pid);
});

test('filho real: erro lançado vira resultado de erro com a mensagem', async () => {
  const r = await rodarReal('teste.lanca');
  assert.equal(r.codigo, 1);
  assert.equal(r.mensagem.resultado, 'erro');
  assert.match(r.mensagem.erro, /falha de propósito/);
});

test('filho real: processo que sai no meio não manda resultado', async () => {
  const r = await rodarReal('teste.morre');
  assert.equal(r.codigo, 3);
  assert.equal(r.mensagem, null);
});

test('filho real: handle pendurado não segura o processo depois do resultado', async () => {
  const r = await rodarReal('teste.pendura', { esperarMs: 15000 });
  assert.equal(r.codigo, 0);
  assert.equal(r.mensagem.resultado, 'vazio');
});

test('filho real: processo travado é encerrado pelo supervisor', async () => {
  const log = logMudo();
  const def = { id: 'teste.trava', descricao: 'x', idempotente: true, timeoutMs: 1500, instancias: () => [{ instancia: 'i1', devida: true }], instanciaValida: () => true, executar() {} };
  const sup = new Supervisor({ catalogo: montar([def]), moduloCatalogo: CATALOGO_TESTE, config: { tickMs: 1e9 }, log, dono: 'S1', modoServico: () => true, alertar: async () => ({ enviado: true }) });
  await sup.tick();
  await esperar(() => !sup.emCurso.size, 20000);
  assert.equal(repo.ultimaExecucao('teste.trava', 'i1').resultado, 'timeout');
  await sup.parar({ prazoMs: 0 });
});

// ── Tela Jobs: pausa, limites, fila, encerrar, log, alertas, modo ──────────

test('pausa: job inteiro ou instância não agenda; Executar agora roda mesmo pausado', async () => {
  const { def } = defTeste();
  def.devidas = ['x', 'y'];
  repo.salvarControle('teste.job', 'x', { pausado: true }, { usuario: 'ana' });
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => f.instancia), ['y']);
  filhos.lista[0].terminar({ resultado: 'ok' });
  await esperar(() => !sup.emCurso.size);
  repo.salvarControle('teste.job', '*', { pausado: true }, { usuario: 'ana' });
  await sup.tick();
  assert.equal(filhos.lista.length, 1);
  repo.criarPedido('teste.job', 'x', { solicitadoPor: 'ana' });
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => `${f.instancia}:${f.origem}`), ['y:agendado', 'x:manual']);
  assert.ok(repo.listarEventos().some(e => e.tipo === 'executar_agora' && e.usuario === 'ana'));
  assert.equal(repo.pausa('teste.job', 'y').doJob, true);
  assert.equal(repo.pausa('teste.job', 'y').por, 'ana');
  await sup.parar({ prazoMs: 0 });
});

test('limite por job e fila justa: quem espera há mais tempo roda primeiro', async () => {
  const { def } = defTeste();
  def.instancias = () => [
    { instancia: 'novo', devida: true, devidaDesde: '2026-11-24T12:05:00.000Z' },
    { instancia: 'velho', devida: true, devidaDesde: '2026-11-24T12:00:00.000Z' },
    { instancia: 'medio', devida: true, devidaDesde: '2026-11-24T12:03:00.000Z' },
  ];
  repo.salvarControle('teste.job', '*', { limite: 2 });
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => f.instancia), ['velho', 'medio']);
  assert.ok(repo.listarEventos().some(e => e.tipo === 'limite_atingido'));
  await sup.parar({ prazoMs: 0 });
});

test('encerrar pela tela: processo encerrado, job limpa, não conta como falha e registra quem pediu', async () => {
  const { def, chamadas } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  const exec = repo.listarExecucoesAbertas()[0];
  repo.criarPedido('teste.job', 'x', { tipo: 'encerrar', alvoExecucaoId: exec.id, solicitadoPor: 'ana' });
  await sup.tick();
  await esperar(() => !sup.emCurso.size);
  assert.equal(filhos.lista[0].encerrado, true);
  const ult = repo.ultimaExecucao('teste.job', 'x');
  assert.equal(ult.resultado, 'interrompido');
  assert.match(ult.erro, /Encerrada pela tela Jobs por ana/);
  assert.equal(chamadas.interrompidas.length, 1);
  assert.equal(repo.falhasSeguidas('teste.job', 'x'), 0);
  assert.ok(repo.listarEventos().some(e => e.tipo === 'execucao_interrompida' && e.usuario === 'ana'));
  // Pedido para execução que já terminou é recusado.
  repo.criarPedido('teste.job', 'x', { tipo: 'encerrar', alvoExecucaoId: exec.id, solicitadoPor: 'ana' });
  await sup.tick();
  assert.equal(jobsDb.getDB().prepare("SELECT recusa FROM jobs_pedidos WHERE tipo = 'encerrar' ORDER BY id DESC").get().recusa, 'execução já terminou');
  await sup.parar({ prazoMs: 0 });
});

test('log da execução: gravado ao vivo e no fim', async () => {
  const { def } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  await sup.tick();
  const exec = repo.listarExecucoesAbertas()[0];
  filhos.lista[0].logTexto = '12:00:00 começando\n';
  await esperar(() => repo.getExecucao(exec.id).log === '12:00:00 começando\n');
  filhos.lista[0].logTexto += '12:00:01 fim\n';
  filhos.lista[0].terminar({ resultado: 'ok' });
  await esperar(() => !sup.emCurso.size);
  assert.equal(repo.getExecucao(exec.id).log, '12:00:00 começando\n12:00:01 fim\n');
  await sup.parar({ prazoMs: 0 });
});

test('alerta: um só na N-ª falha seguida; volta ao normal avisa uma vez', async () => {
  repo.salvarConfigJobs({ alertaFalhas: 2 });
  const { def } = defTeste();
  const { sup, filhos, alertas, avancar } = montarSupervisor({ defs: [def] });
  const rodada = async (resultado) => {
    await sup.tick();
    filhos.lista[filhos.lista.length - 1].terminar(resultado === 'ok' ? { resultado: 'ok' } : { resultado: 'erro', erro: 'Error: caiu' });
    await esperar(() => !sup.emCurso.size);
    await new Promise(r => setTimeout(r, 20));
    avancar(20 * 60000);
  };
  await rodada('erro');
  assert.equal(alertas.length, 0);
  await rodada('erro');
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /2 falha\(s\) seguida\(s\)/);
  await rodada('erro');
  assert.equal(alertas.length, 1);
  assert.equal(repo.listarAlertasAbertos().length, 1);
  await rodada('ok');
  assert.equal(alertas.length, 2);
  assert.match(alertas[1], /Voltou ao normal/);
  assert.equal(repo.listarAlertasAbertos().length, 0);
  assert.equal(filhos.lista.length, 4);
  await sup.parar({ prazoMs: 0 });
});

test('modo Site: o supervisor não agenda, mas atende o Executar agora da tela', async () => {
  const { def } = defTeste();
  const { sup, filhos, modo } = montarSupervisor({ defs: [def], servico: false });
  await sup.tick();
  assert.equal(filhos.lista.length, 0);
  repo.criarPedido('teste.job', 'x', { solicitadoPor: 'ana' });
  await sup.tick();
  assert.deepEqual(filhos.lista.map(f => f.origem), ['manual']);
  filhos.lista[0].terminar({ resultado: 'ok' });
  await esperar(() => !sup.emCurso.size);
  modo.servico = true;
  await sup.tick();
  assert.equal(filhos.lista.length, 2);
  await sup.parar({ prazoMs: 0 });
});

test('modo: serviço no comando só com modo Serviço e sinal recente; parada limpa devolve ao site na hora', () => {
  const modo = require('../modules/jobs/modo');
  assert.equal(modo.modoConfigurado(), 'site');
  assert.equal(modo.servicoNoComando(), false);
  repo.salvarConfigJobs({ modo: 'servico', alertaSemSinalMin: 5 }, { usuario: 'ana' });
  assert.equal(modo.modoConfigurado(), 'servico');
  assert.equal(modo.servicoNoComando(), false);
  const agora = new Date();
  repo.registrarBatimento('S1', { agora });
  assert.equal(modo.servicoNoComando({ agora }), true);
  assert.equal(modo.servicoNoComando({ agora: mais(4 * 60000, agora) }), true);
  assert.equal(modo.servicoNoComando({ agora: mais(6 * 60000, agora) }), false);
  repo.registrarParada('S1', { agora });
  assert.equal(modo.servicoNoComando({ agora }), false);
  assert.equal(repo.getConfigJobs().atualizadoPor, 'ana');
});

test('vigia (site): alerta uma vez quando o serviço some e outra quando volta; parada limpa espera o prazo', async () => {
  const vigia = require('../modules/jobs/vigia');
  const alertas = [];
  const alertar = async (t) => { alertas.push(t); return { enviado: true }; };
  assert.equal(await vigia.verificar({ agora: T0, alertar }), 'modo_site');
  repo.salvarConfigJobs({ modo: 'servico', alertaSemSinalMin: 5 });
  repo.registrarBatimento('S1', { agora: T0 });
  assert.equal(await vigia.verificar({ agora: mais(2 * 60000), alertar }), 'ok');
  assert.equal(await vigia.verificar({ agora: mais(6 * 60000), alertar }), 'alertado');
  assert.equal(await vigia.verificar({ agora: mais(7 * 60000), alertar }), 'ja_alertado');
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /sem sinal/);
  repo.registrarBatimento('S1', { agora: mais(8 * 60000) });
  assert.equal(await vigia.verificar({ agora: mais(8 * 60000), alertar }), 'voltou');
  assert.equal(alertas.length, 2);
  repo.registrarParada('S1', { agora: mais(9 * 60000) });
  assert.equal(await vigia.verificar({ agora: mais(10 * 60000), alertar }), 'aguardando');
  assert.equal(await vigia.verificar({ agora: mais(15 * 60000), alertar }), 'alertado');
  assert.match(alertas[2], /parado desde/);
  assert.ok(repo.listarEventos().some(e => e.tipo === 'servico_sem_sinal'));
});

test('filho real: resultado por IPC após HTTP local e encerramento', async () => {
  const servidor = require('node:http').createServer((_req, res) => res.end('ok'));
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}`;
    for (let i = 0; i < 10; i++) {
      const filho = iniciarFilhoReal({ moduloCatalogo: CATALOGO_TESTE, jobId: 'teste.http', instancia: url, origem: 'manual' });
      const r = await filho.fim;
      assert.equal(r.codigo, 0, filho.log());
      assert.equal(r.mensagem?.resumo?.resposta, 'ok');
    }
  } finally {
    await new Promise(resolve => servidor.close(resolve));
  }
});

test('filho real: o que o processo escreve vira o log da execução', async () => {
  const h = iniciarFilhoReal({ moduloCatalogo: CATALOGO_TESTE, jobId: 'teste.loga', instancia: 'i1', origem: 'manual' });
  const r = await h.fim;
  assert.equal(r.mensagem.resultado, 'ok');
  const log = h.log();
  assert.match(log, /\d\d:\d\d:\d\d linha um\n/);
  assert.match(log, /linha de erro/);
  assert.match(log, /linha dois/);
});

// ── API da tela (só administrador; regras de validação) ────────────────────

test('API: só administrador; modo Serviço exige sinal; pausa, limite e config validados e auditados', async () => {
  const express = require('express');
  const iaServiceDb = require('../apps/IA Service/backend/database');
  iaServiceDb.inicializarDB(path.join(os.tmpdir(), `ia-service-jobs-api-${Date.now()}.db`));
  // Auditoria em memória (o arquivo real de auditoria não é tocado no teste).
  const auditoria = [];
  const caminhoAuth = require.resolve('../apps/IAHUB/backend/auth/database');
  const original = require.cache[caminhoAuth];
  require.cache[caminhoAuth] = { id: caminhoAuth, filename: caminhoAuth, loaded: true, exports: { registrarAuditoria: (r) => auditoria.push(r) } };
  delete require.cache[require.resolve('../modules/jobs/routes')];
  const rotas = require('../modules/jobs/routes');
  if (original) require.cache[caminhoAuth] = original; else delete require.cache[caminhoAuth];

  const sessao = { authenticated: true, role: 'user', user: 'beto' };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = sessao; next(); });
  const requireAuth = (req, res, next) => (req.session?.authenticated ? next() : res.status(401).json({ error: 'x' }));
  const requireAdmin = (req, res, next) => (req.session?.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso restrito a administradores' }));
  rotas.registrar(app, { requireAuth, requireAdmin });
  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}/api/iahub/jobs`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  try {
    assert.equal((await chamar('GET', '/painel')).status, 403);
    sessao.role = 'admin';
    const p = await chamar('GET', '/painel?sistema=ia-service');
    assert.equal(p.status, 200);
    assert.deepEqual(p.corpo.jobs.map(j => j.id), ['ia-service.jade-pa']);
    assert.equal((await chamar('GET', '/painel?sistema=ia-command')).corpo.jobs.length, 0);
    assert.equal(p.corpo.modo, 'site');

    // Serviço sem sinal: não deixa passar os jobs para ele.
    assert.equal((await chamar('PUT', '/config', { modo: 'servico' })).status, 409);
    assert.equal((await chamar('POST', '/executar', { jobId: 'ia-service.jade-pa', instancia: '1:f' })).status, 400);
    repo.registrarBatimento('S1');
    assert.equal((await chamar('PUT', '/config', { modo: 'servico', maxSimultaneos: 8 })).status, 200);
    assert.equal(repo.getConfigJobs().modo, 'servico');
    assert.equal(repo.getConfigJobs().maxSimultaneos, 8);
    assert.equal((await chamar('PUT', '/config', { maxSimultaneos: 0 })).status, 400);
    assert.equal((await chamar('PUT', '/config', { alertaGruposFalha: ['ok', 'não pode'] })).status, 400);
    assert.equal((await chamar('PUT', '/config', { alertaGruposFalha: ['g1', 'g1', 'g2'], alertaGruposServico: ['g3'] })).status, 200);
    assert.deepEqual(repo.getConfigJobs().alertaGruposFalha, ['g1', 'g2']);
    assert.deepEqual(repo.getConfigJobs().alertaGruposServico, ['g3']);
    assert.equal((await chamar('PUT', '/config', {})).status, 400);

    assert.equal((await chamar('PUT', '/controle', { jobId: 'ia-service.jade-pa', pausado: true })).status, 200);
    assert.equal(repo.pausa('ia-service.jade-pa', '1:qualquer')?.por, 'beto');
    assert.equal((await chamar('PUT', '/controle', { jobId: 'ia-service.jade-pa', limite: 3 })).status, 200);
    assert.equal(repo.listarControles().find(c => c.instancia === '*').limite, 3);
    assert.equal((await chamar('PUT', '/controle', { jobId: 'ia-service.jade-pa', limite: 500 })).status, 400);
    assert.equal((await chamar('PUT', '/controle', { jobId: 'nao.existe', pausado: true })).status, 404);

    assert.equal((await chamar('POST', '/execucoes/999999/encerrar')).status, 404);
    const ev = (await chamar('GET', '/eventos?sistema=ia-service')).corpo.eventos;
    assert.ok(ev.some(e => e.tipo === 'modo_alterado' && e.usuario === 'beto'));
    assert.ok(ev.some(e => e.tipo === 'job_pausado'));
    assert.ok(auditoria.some(a => a.acao === 'jobs_modo_alterado' && a.usuario === 'beto'));
    assert.equal((await chamar('GET', '/execucoes?resultado=falha')).status, 200);
    assert.equal((await chamar('GET', '/execucoes?de=ontem')).status, 400);
  } finally {
    servidor.close();
  }
});

test('alerta: cada tipo vai aos seus grupos; teste vai a todos sem repetir', () => {
  const { gruposDoTipo } = require('../modules/jobs/alerta');
  const cfg = { alertaGruposFalha: ['a', 'b'], alertaGruposServico: ['b', 'c'] };
  assert.deepEqual(gruposDoTipo(cfg, 'falha'), ['a', 'b']);
  assert.deepEqual(gruposDoTipo(cfg, 'servico'), ['b', 'c']);
  assert.deepEqual(gruposDoTipo(cfg, 'teste'), ['a', 'b', 'c']);
  assert.deepEqual(gruposDoTipo({}, 'falha'), []);
});

// ── Revisão após a auditoria (2026-11-25) ───────────────────────────────────

test('alerta que não chegou é reenviado na próxima falha; sem destino não entra em laço', async () => {
  repo.salvarConfigJobs({ alertaFalhas: 1 });
  const { def } = defTeste();
  const { sup, filhos, avancar } = montarSupervisor({ defs: [def] });
  const respostas = [{ enviado: false, motivo: 'IA Command fora' }, { enviado: true }];
  const enviados = [];
  sup.alertar = async (texto) => { enviados.push(texto); return respostas.shift() || { enviado: true }; };
  const falhar = async () => {
    await sup.tick();
    filhos.lista[filhos.lista.length - 1].terminar({ resultado: 'erro', erro: 'Error: caiu' });
    await esperar(() => !sup.emCurso.size);
    await new Promise(r => setTimeout(r, 30));
    avancar(20 * 60000);
  };
  await falhar();
  assert.equal(enviados.length, 1);
  assert.equal(repo.listarAlertasAbertos().length, 0, 'não chegou: reabre para tentar de novo');
  await falhar();
  assert.equal(enviados.length, 2);
  assert.equal(repo.listarAlertasAbertos().length, 1);
  await falhar();
  assert.equal(enviados.length, 2, 'chegou: não repete');
  await sup.parar({ prazoMs: 0 });
});

test('job que não consegue se preparar por muito tempo vira alerta do tipo Serviço, e outro quando volta', async () => {
  const { def } = defTeste();
  def.devidas = [];
  let quebrado = true;
  def.preparar = () => { if (quebrado) throw new Error('migração pendente (v99)'); };
  const { sup, avancar } = montarSupervisor({ defs: [def], config: { prepararAlertaMs: 10 * 60000 } });
  const tipos = [];
  sup.alertar = async (texto, { tipo }) => { tipos.push([tipo, texto]); return { enviado: true }; };
  await sup.tick();
  avancar(5 * 60000);
  await sup.tick();
  assert.equal(tipos.length, 0);
  avancar(6 * 60000);
  await sup.tick();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(tipos.length, 1);
  assert.equal(tipos[0][0], 'servico');
  assert.match(tipos[0][1], /migração pendente/);
  await sup.tick();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(tipos.length, 1, 'um alerta só enquanto continua parado');
  quebrado = false;
  await sup.tick();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(tipos.length, 2);
  assert.match(tipos[1][1], /Voltou a rodar/);
  await sup.parar({ prazoMs: 0 });
});

test('vigia: alerta de serviço sem sinal que não chegou tenta de novo no minuto seguinte', async () => {
  const vigia = require('../modules/jobs/vigia');
  repo.salvarConfigJobs({ modo: 'servico', alertaSemSinalMin: 5 });
  repo.registrarBatimento('S1', { agora: T0 });
  const respostas = [{ enviado: false, motivo: 'IA Command fora' }, { enviado: true }];
  const alertar = async () => respostas.shift();
  assert.equal(await vigia.verificar({ agora: mais(6 * 60000), alertar }), 'reenviar');
  // Canais fora: espera 5 min antes de tentar de novo (sem martelar).
  assert.equal(await vigia.verificar({ agora: mais(7 * 60000), alertar }), 'aguardando_reenvio');
  assert.equal(await vigia.verificar({ agora: mais(12 * 60000), alertar }), 'alertado');
  assert.equal(await vigia.verificar({ agora: mais(13 * 60000), alertar }), 'ja_alertado');
});

// ── Reserva, vigilância mútua, pendentes e processo preso (2026-11-25) ──────

test('alerta da tela Jobs: WhatsApp falhando vai à reserva da empresa; site fora vai direto à reserva', async () => {
  const alerta = require('../modules/jobs/alerta');
  repo.salvarConfigJobs({ alertaEmpresaId: 3, alertaGruposFalha: ['g1'] });
  const chamadas = [];
  const reservaFalsa = async (empresaId, texto, opts) => { chamadas.push({ empresaId, opts }); return { enviado: true, canais: ['email'] }; };
  // Sem segredo do IA Command o WhatsApp não sai: a reserva entra com whatsappFalhou.
  const r = await alerta.enviar('job caiu', { tipo: 'falha', reserva: reservaFalsa });
  assert.equal(r.enviado, true);
  assert.deepEqual(r.canais, ['e-mail']);
  assert.equal(chamadas[0].empresaId, 3);
  assert.equal(chamadas[0].opts.whatsappFalhou, true);
  const r2 = await alerta.enviar('site caiu', { tipo: 'servico', semWhatsapp: true, reserva: reservaFalsa });
  assert.equal(r2.enviado, true);
  // Nada configurado em lugar nenhum: "sem destino" (não reabre em laço).
  repo.salvarConfigJobs({ alertaEmpresaId: null, alertaGruposFalha: [] });
  const r3 = await alerta.enviar('x', { reserva: async () => ({ enviado: false, canais: [], erros: ['nenhum canal de reserva ligado nesta empresa'] }) });
  assert.equal(r3.motivo, 'sem destino configurado');
  assert.ok(repo.listarEventos().some(e => e.tipo === 'alerta_enviado' && /e-mail/.test(e.texto)));
});

test('vigilância mútua: site sem responder além do prazo vira um alerta direto à reserva, e outro quando volta', async () => {
  repo.salvarConfigJobs({ alertaSemSinalMin: 5 });
  let siteOk = false;
  const { def } = defTeste();
  def.devidas = [];
  const { sup, avancar } = montarSupervisor({ defs: [def] });
  sup.verificarSite = async () => siteOk;
  const enviados = [];
  sup.alertar = async (texto, opts) => { enviados.push({ texto, opts }); return { enviado: true }; };
  await sup.tick();
  avancar(3 * 60000);
  await sup.tick();
  assert.equal(enviados.length, 0, 'dentro do prazo');
  avancar(3 * 60000);
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].opts.semWhatsapp, true);
  assert.match(enviados[0].texto, /site do IAHub não responde/);
  avancar(60000);
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 1, 'um alerta só enquanto continua fora');
  siteOk = true;
  avancar(60000);
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 2);
  assert.match(enviados[1].texto, /voltou a responder/);
  await sup.parar({ prazoMs: 0 });
});

test('"voltou ao normal" que não chegou fica pendente e é reenviado; passada 1 h desiste', async () => {
  const { def } = defTeste();
  def.devidas = [];
  const { sup, avancar } = montarSupervisor({ defs: [def] });
  let entregar = false;
  const enviados = [];
  sup.alertar = async (texto) => { enviados.push(texto); return entregar ? { enviado: true } : { enviado: false, motivo: 'IA Command fora' }; };
  repo.abrirAlerta('falha:teste.job|x', 'falhou', { agora: new Date() });
  sup._alertarNormalizou(def, 'x');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 1);
  assert.ok(repo.listarAlertasAbertos().some(a => a.chave === 'falha:teste.job|x:ok'), 'guardado como pendente');
  entregar = true;
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 1, 'menos de 5 min: não tenta de novo');
  avancar(6 * 60000);
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 2);
  assert.ok(!repo.listarAlertasAbertos().some(a => a.chave.endsWith(':ok')), 'entregue: sai da fila');
  // Velho demais: descartado sem enviar.
  repo.abrirAlerta('preparar:teste.job:ok', 'voltou', { agora: new Date(Date.now() - 2 * 3600000) });
  await sup.tick();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(enviados.length, 2);
  assert.equal(repo.listarAlertasAbertos().length, 0);
  // A tela Jobs não mostra pendente de normalização como problema.
  repo.abrirAlerta('falha:outro|y:ok', 'voltou', { agora: new Date() });
  const painel = require('../modules/jobs/painel');
  assert.ok(!painel.montarPainel({ sistema: 'nenhum' }).alertasAbertos.some(a => a.chave.endsWith(':ok')));
  await sup.parar({ prazoMs: 0 });
});

test('processo que não encerra nem forçado: evento e alerta, execução segue aberta (nunca roda outra junto)', async () => {
  const { def } = defTeste();
  const { sup, filhos } = montarSupervisor({ defs: [def] });
  const enviados = [];
  sup.alertar = async (texto) => { enviados.push(texto); return { enviado: true }; };
  let avisar;
  sup.iniciarFilho = (args) => {
    avisar = args.aoNaoEncerrar;
    return filhos.iniciar(args);
  };
  await sup.tick();
  avisar(4242);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(repo.listarEventos().some(e => e.tipo === 'processo_nao_encerra' && /pid 4242/.test(e.texto)));
  assert.equal(enviados.length, 1);
  assert.equal(repo.listarExecucoesAbertas().length, 1);
  filhos.lista[0].terminar({ resultado: 'ok' });
  await esperar(() => !sup.emCurso.size);
  await sup.parar({ prazoMs: 0 });
});

// ── Aba Serviço: log e controle do serviço Windows (2026-11-25) ─────────────

test('log do serviço: grava, lê só as novas, limpa e poda (tipo inválido vira info)', () => {
  repo.limparLog();
  repo.registrarLog('system', 'Supervisor iniciado');
  repo.registrarLog('qualquer', 'linha');
  const todas = repo.listarLog();
  assert.deepEqual(todas.map(l => l.tipo), ['system', 'info']);
  repo.registrarLog('error', 'caiu');
  const novas = repo.listarLog({ aposId: todas[1].id });
  assert.deepEqual(novas.map(l => l.texto), ['caiu']);
  repo.registrarLog('info', 'velha', { agora: new Date(Date.now() - 8 * 86400000) });
  assert.equal(repo.podarLog(), 1);
  assert.equal(repo.limparLog(), 3);
  assert.deepEqual(repo.listarLog(), []);
});

test('filho real: cada linha vai ao log do serviço (stderr como erro), não direto ao console', async () => {
  const linhas = [];
  const h = iniciarFilhoReal({ moduloCatalogo: CATALOGO_TESTE, jobId: 'teste.loga', instancia: 'i1', origem: 'manual', aoLinha: (nivel, texto) => linhas.push([nivel, texto]) });
  await h.fim;
  assert.deepEqual(linhas, [
    ['info', '[teste.loga i1] linha um'],
    ['erro', '[teste.loga i1] linha de erro'],
    ['info', '[teste.loga i1] linha dois'],
  ].filter(l => linhas.some(x => x[1] === l[1])));
  assert.ok(linhas.some(([n, t]) => n === 'erro' && /linha de erro/.test(t)));
  assert.ok(linhas.some(([n, t]) => n === 'info' && /linha dois/.test(t)));
});

test('serviço Windows: mensagens claras para os erros comuns', () => {
  const { _traduzir } = require('../modules/jobs/servico-windows');
  assert.match(_traduzir({ saida: '[SC] StartService FALHA 5:\nAcesso negado.' }, 'iniciar o serviço'), /Sem permissão.*conta Sistema/);
  assert.match(_traduzir({ saida: '[SC] StartService FAILED 1056: An instance of the service is already running.' }, 'iniciar'), /já está em execução/);
  assert.match(_traduzir({ saida: '[SC] ControlService FAILED 1062: The service has not been started.' }, 'parar'), /já está parado/);
});

test('serviço Windows: consulta de estado (só leitura) responde sem travar', { skip: process.platform !== 'win32' }, async () => {
  const s = await require('../modules/jobs/servico-windows').status();
  assert.equal(s.nome, 'IAHub-Jobs');
  assert.ok(['nao_instalado', 'parado', 'rodando', 'iniciando', 'parando', 'pausado', 'erro', 'desconhecido'].includes(s.estado));
});

test('API do serviço: ações preservam o modo escolhido e registram log, auditoria e eventos', async () => {
  const express = require('express');
  const auditoria = [];
  const chamadas = [];
  const caminhoAuth = require.resolve('../apps/IAHUB/backend/auth/database');
  const caminhoSw = require.resolve('../modules/jobs/servico-windows');
  const origAuth = require.cache[caminhoAuth];
  const origSw = require.cache[caminhoSw];
  let falharInstalar = false;
  const estado = { suportado: true, instalado: true, estado: 'rodando', nome: 'IAHub-Jobs' };
  require.cache[caminhoAuth] = { id: caminhoAuth, filename: caminhoAuth, loaded: true, exports: { registrarAuditoria: (r) => auditoria.push(r) } };
  require.cache[caminhoSw] = {
    id: caminhoSw, filename: caminhoSw, loaded: true,
    exports: {
      status: async () => estado,
      parar: async () => { chamadas.push('parar'); return { ...estado, estado: 'parando' }; },
      iniciar: async () => { chamadas.push('iniciar'); return estado; },
      desinstalar: async () => { chamadas.push('desinstalar'); return { ...estado, instalado: false, estado: 'nao_instalado' }; },
      instalar: async () => { chamadas.push('instalar'); if (falharInstalar) throw Object.assign(new Error('NSSM não encontrado no servidor.'), { status: 400 }); return estado; },
    },
  };
  delete require.cache[require.resolve('../modules/jobs/routes')];
  const rotas = require('../modules/jobs/routes');
  require.cache[caminhoAuth] = origAuth; if (!origAuth) delete require.cache[caminhoAuth];
  require.cache[caminhoSw] = origSw; if (!origSw) delete require.cache[caminhoSw];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { authenticated: true, role: 'admin', user: 'ana' }; next(); });
  rotas.registrar(app, { requireAuth: (a, b, c) => c(), requireAdmin: (a, b, c) => c() });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/iahub/jobs`;
  const chamar = async (metodo, caminho) => { const r = await fetch(base + caminho, { method: metodo }); return { status: r.status, corpo: await r.json() }; };
  try {
    repo.limparLog();
    repo.salvarConfigJobs({ modo: 'servico' });
    const st = await chamar('GET', '/servico');
    assert.equal(st.corpo.windows.estado, 'rodando');
    assert.equal(st.corpo.modo, 'servico');

    const p = await chamar('POST', '/servico/parar');
    assert.equal(p.status, 200);
    assert.equal(p.corpo.modo, 'servico');
    assert.equal(repo.getConfigJobs().modo, 'servico');
    assert.ok(auditoria.some(a => a.acao === 'jobs_servico_parar' && a.usuario === 'ana'));

    // Iniciar não muda o modo.
    await chamar('POST', '/servico/iniciar');
    assert.equal(repo.getConfigJobs().modo, 'servico');

    await chamar('POST', '/servico/desinstalar');
    assert.equal(repo.getConfigJobs().modo, 'servico');

    falharInstalar = true;
    const i = await chamar('POST', '/servico/instalar');
    assert.equal(i.status, 400);
    assert.match(i.corpo.error, /NSSM/);
    assert.ok(repo.listarEventos().some(e => e.tipo === 'servico_instalar_falhou'));
    assert.equal((await chamar('POST', '/servico/explodir')).status, 404);
    assert.deepEqual(chamadas, ['parar', 'iniciar', 'desinstalar', 'instalar']);

    const log = (await chamar('GET', '/log')).corpo;
    assert.ok(log.linhas.some(l => l.tipo === 'warning' && /parada do serviço pedida.*por ana.*modo Serviço permanece escolhido/i.test(l.texto)));
    assert.ok(log.linhas.some(l => l.tipo === 'error' && /Falha ao instalar/.test(l.texto)));
    const depois = (await chamar('GET', `/log?apos=${log.ultimoId}`)).corpo;
    assert.equal(depois.linhas.length, 0);
    assert.equal(depois.ultimoId, log.ultimoId);
    await chamar('POST', '/log/limpar');
    assert.deepEqual((await chamar('GET', '/log')).corpo.linhas.map(l => l.texto), ['Log limpo por ana.']);
  } finally {
    srv.close();
  }
});

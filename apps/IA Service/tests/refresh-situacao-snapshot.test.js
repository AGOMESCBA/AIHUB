// Refresh por ID + snapshot compartilhado da situação (2026-10, caso #036752).
// Cobre: snapshot (TTL, single-flight, falha, truncamento, isolamento), seleção
// de candidatos nos dois sentidos, posicionamento novo sem mudança de situação,
// chamado ocupado intocado, ausência no snapshot != encerramento, reconstrução
// de mensagens sem duplicar/perder, resultado parcial e isolamento multiempresa.
// Não usa origem nem provider reais.
// Executar: node "apps/IA Service/tests/refresh-situacao-snapshot.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

process.env.IA_SERVICE_REFRESH_DURACOES = '0';
const dbTmpPath = path.join(os.tmpdir(), `ia-service-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

// ── Origem simulada (mock do adapter) ───────────────────────────────────────
const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
const ORIGEM = {
  // por empresa não importa: o mock é por fonte única; empresas usam números distintos
  abertos: new Map(),      // numero -> { aguardando, responsavel, ultTransicao, nPos, ultPos }
  chamados: new Map(),     // numero -> row bruta
  posicionamentos: new Map(), // numero -> [rows]
  snapshotLanca: false,
  snapshotTruncado: false,
  atrasoJanelaMs: 0,
  janelaLanca: false,
  chamadasJanela: 0,
  opcoesPorIds: [],
  chamadasSnapshot: 0,
  chamadasPorIds: 0,
  idsConsultados: [],
};
function linhaChamado(numero, { aguardando = 'RETORNO - CLIENTE', status = 'Andamento' } = {}) {
  return {
    OID: `OID-${numero}`, IDPROCESS: numero, DT: '20261009', CNPJCPF: '04.476.442/0001-60', DP: 'Cliente A',
    CDUSER: 'SOL-1', NMSOLICITANTE: 'Solicitante', EMAIL: 's@c.com', CDUSERANA: 'TEC-1', NOMEANALISTARES: 'Tecnico',
    TITULOCHAMADO: `Chamado ${numero}`, DESCRICAO01: `Descricao ${numero}`,
    STATUS_ENCERRAMENTO: status, AGUARDANDO: aguardando, DIAS_DUR: 5, HR_DUR: 40,
  };
}
function linhaPos(numero, i) {
  return {
    OID: `POS-${numero}-${i}`, CHAMADO: numero, DATAATUAL: '20261010', HORAATUAL: 1760000000 + i * 60,
    DESCRICAO: `Posicionamento ${i} do ${numero}`, CDUSERANA: 'TEC-1', ANALISTAJ2A: 'Tecnico',
    AGUARDANRETORNO: 'RETORNO - CLIENTE',
  };
}
function definirChamado(numero, { aguardando = 'RETORNO - CLIENTE', nPos = 1, status = 'Andamento', noSnapshot = true, transicao = 'T1', anexos = null } = {}) {
  ORIGEM.chamados.set(numero, linhaChamado(numero, { aguardando, status }));
  ORIGEM.posicionamentos.set(numero, Array.from({ length: nPos }, (_, i) => linhaPos(numero, i)));
  if (noSnapshot) ORIGEM.abertos.set(numero, { aguardando, responsavel: 'TEC-1', ultTransicao: transicao, nPos, ultPos: 1760000000 + (nPos - 1) * 60, anexos });
  else ORIGEM.abertos.delete(numero);
}

require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() {
      ORIGEM.chamadasJanela++;
      if (ORIGEM.atrasoJanelaMs) await new Promise(r => setTimeout(r, ORIGEM.atrasoJanelaMs));
      if (ORIGEM.janelaLanca) throw new Error('origem recusou a janela');
      return [];
    },
    async contarChamadosPeriodo() { return 0; },
    async listarPosicionamentosDoChamado(_e, _f, id) { return ORIGEM.posicionamentos.get(id) || []; },
    async listarPosicionamentosDoLote(_e, _f, ids) {
      const m = new Map();
      for (const id of ids) m.set(String(id), ORIGEM.posicionamentos.get(String(id)) || []);
      return m;
    },
    async listarChamadosPorIds(_e, _f, ids, opcoes = {}) {
      ORIGEM.chamadasPorIds++;
      ORIGEM.opcoesPorIds.push({ ids: ids.map(String), leve: !!opcoes.leve });
      ORIGEM.idsConsultados.push(...ids.map(String));
      return ids.map(String).filter(i => ORIGEM.chamados.has(i)).map((i) => {
        const row = { ...ORIGEM.chamados.get(i) };
        if (opcoes.leve) { delete row.DIAS_DUR; delete row.HR_DUR; } // modo leve nao traz as duracoes
        return row;
      });
    },
    async listarSnapshotAbertos() {
      ORIGEM.chamadasSnapshot++;
      if (ORIGEM.snapshotLanca) throw new Error('origem fora do ar');
      const linhas = [...ORIGEM.abertos.entries()].map(([n, v]) => ({
        NUM: n, AGUARDANDO: v.aguardando, RESPONSAVEL: v.responsavel, ULT_TRANSICAO: v.ultTransicao, N_POS: v.nPos, ULT_POS: v.ultPos,
        ...(v.anexos ? { N_ANEXOS_GRID: v.anexos.grid, ULT_ANEXO_GRID: v.anexos.ultGrid, N_ANEXOS_POS: v.anexos.pos, N_ANEXO_CHAMADO: v.anexos.chamado } : {}),
      }));
      return { linhas, truncado: ORIGEM.snapshotTruncado };
    },
  },
};

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const snapshotService = require('../backend/services/situacao-snapshot-service');
const refreshService = require('../backend/services/radar-refresh-service');
const radarService = require('../backend/services/radar-service');
const turnoLock = require('../backend/services/turno-lock-service');
const anexosSoftExpertService = require('../backend/services/anexos-softexpert-service');
const anexoRepo = require('../backend/repositories/anexo-repository');
const gate = require('../backend/services/pendencia-externa-gate');
const situacaoOrigemService = require('../backend/services/situacao-origem-service');

const EMPRESA = 99401;
const EMPRESA_B = 99402;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}
function novaFonte(empresaId, nome) {
  return agenteRepo.criarFonte(empresaId, {
    connectionKey: `fonte-${nome}`, nome, sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter',
  });
}
function reiniciarEstado() {
  snapshotService._resetarParaTeste();
  refreshService._resetarParaTeste();
  ORIGEM.snapshotLanca = false; ORIGEM.snapshotTruncado = false; ORIGEM.janelaLanca = false;
  ORIGEM.chamadasJanela = 0;
  ORIGEM.chamadasSnapshot = 0; ORIGEM.chamadasPorIds = 0; ORIGEM.idsConsultados = [];
}

const testes = [];
function teste(nome, fn) { testes.push({ nome, fn }); }

// ── 1. snapshot service ─────────────────────────────────────────────────────
function loaderFixo(linhas, { atraso = 0, falha = false, contador } = {}) {
  return async () => {
    if (contador) contador.n++;
    if (atraso) await new Promise(r => setTimeout(r, atraso));
    if (falha) throw new Error('falha simulada');
    return { linhas, truncado: false };
  };
}

teste('snapshot: cache dentro do TTL, force reconsulta, single-flight com N concorrentes', async () => {
  snapshotService._resetarParaTeste();
  const c = { n: 0 };
  const linhas = [{ NUM: '1', AGUARDANDO: 'RETORNO - CLIENTE' }];
  const opts = { carregar: loaderFixo(linhas, { atraso: 30, contador: c }) };
  const todas = await Promise.all(Array.from({ length: 8 }, () => snapshotService.obterSnapshot(1, 'f1', opts)));
  assert.strictEqual(c.n, 1, '8 chamadas concorrentes = 1 consulta (single-flight)');
  assert.ok(todas.every(s => s.ok && s.mapa.get('1').aguardando === 'RETORNO - CLIENTE'));
  const cache = await snapshotService.obterSnapshot(1, 'f1', opts);
  assert.strictEqual(cache.origem, 'cache');
  assert.strictEqual(c.n, 1, 'dentro do TTL nao reconsulta');
  await snapshotService.obterSnapshot(1, 'f1', { ...opts, force: true });
  assert.strictEqual(c.n, 2, 'force reconsulta');
});

teste('snapshot: TTL expirado reconsulta; falha usa ultimo bom (cache_antigo) ou ok:false', async () => {
  snapshotService._resetarParaTeste();
  const c = { n: 0 };
  let agora = 1_000_000;
  const clock = () => agora;
  const ok = { carregar: loaderFixo([{ NUM: '1', AGUARDANDO: 'RETORNO - CLIENTE' }], { contador: c }), agora: clock };
  await snapshotService.obterSnapshot(1, 'f2', ok);
  agora += snapshotService.TTL_PADRAO_MS + 1;
  await snapshotService.obterSnapshot(1, 'f2', ok);
  assert.strictEqual(c.n, 2, 'TTL expirado reconsulta');
  agora += snapshotService.TTL_PADRAO_MS + 1;
  const falha = await snapshotService.obterSnapshot(1, 'f2', { carregar: loaderFixo([], { falha: true }), agora: clock });
  assert.strictEqual(falha.ok, true);
  assert.strictEqual(falha.origem, 'cache_antigo');
  assert.match(falha.erro, /falha simulada/);
  agora += snapshotService.MAX_IDADE_FALLBACK_MS + 1;
  const semFallback = await snapshotService.obterSnapshot(1, 'f2', { carregar: loaderFixo([], { falha: true }), agora: clock });
  assert.strictEqual(semFallback.ok, false);
  const nunca = await snapshotService.obterSnapshot(1, 'f-novo', { carregar: loaderFixo([], { falha: true }) });
  assert.strictEqual(nunca.ok, false);
});

teste('snapshot: isolamento por empresa e fonte (chaves distintas)', async () => {
  snapshotService._resetarParaTeste();
  const a = await snapshotService.obterSnapshot(1, 'fx', { carregar: loaderFixo([{ NUM: '1', AGUARDANDO: 'A' }]) });
  const b = await snapshotService.obterSnapshot(2, 'fx', { carregar: loaderFixo([{ NUM: '1', AGUARDANDO: 'B' }]) });
  const c = await snapshotService.obterSnapshot(1, 'fy', { carregar: loaderFixo([{ NUM: '1', AGUARDANDO: 'C' }]) });
  assert.strictEqual(a.mapa.get('1').aguardando, 'A');
  assert.strictEqual(b.mapa.get('1').aguardando, 'B');
  assert.strictEqual(c.mapa.get('1').aguardando, 'C');
});

// ── 2. gate usa o snapshot nos dois sentidos ────────────────────────────────
teste('gate: local ATENDENTE + snapshot CLIENTE => pendencia externa (caso #036752); ausencia nao confirma', async () => {
  const snap = async () => ({ ok: true, origem: 'fresco', idadeMs: 0, truncado: false, mapa: new Map([['036752', { aguardando: 'RETORNO - CLIENTE' }]]) });
  const consulta = (numero) => () => situacaoOrigemService.consultarSituacaoAtual(1, { fonteId: 'f', numero }, { obterSnapshot: snap });
  const p = await gate.avaliarPendencia({ chamado: { aguardandoConsolidado: 'RETORNO - ATENDENTE' }, consultarSituacaoOrigem: consulta('036752') });
  assert.strictEqual(p.externa, true);
  assert.strictEqual(p.responsavel, 'cliente');
  assert.strictEqual(p.fonteSituacao, 'origem_divergiu_do_local');
  const ausente = await gate.avaliarPendencia({ chamado: { aguardandoConsolidado: 'RETORNO - CLIENTE' }, consultarSituacaoOrigem: consulta('999999') });
  assert.strictEqual(ausente.externa, true, 'ausente do snapshot: mantem o local, nao assume encerramento');
  assert.strictEqual(ausente.fonteSituacao, 'local_nao_confirmada_na_origem');
  assert.match(ausente.motivoConsultaOrigem, /ausente_do_snapshot/);
});

// ── 3. Refresh por ID (integração com banco) ────────────────────────────────
const ctx = {};

teste('refresh: primeira carga traz chamados novos; marcas semeadas evitam releitura desnecessaria', async () => {
  reiniciarEstado();
  ctx.fonte = novaFonte(EMPRESA, 'A');
  definirChamado('200001', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  definirChamado('200002', { aguardando: 'RETORNO - ATENDENTE', nPos: 1 });
  definirChamado('200003', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  definirChamado('200004', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  const r1 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r1.snapshot.ok, true);
  assert.strictEqual(r1.candidatos.novo_na_base, 4);
  assert.strictEqual(r1.atualizados, 4);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200002', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  // segundo ciclo sem mudancas: nada a reler
  ORIGEM.chamadasPorIds = 0;
  const r2 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r2.atualizados, 0);
  assert.strictEqual(ORIGEM.chamadasPorIds, 0, 'sem candidatos: nenhuma releitura por ID');
  assert.strictEqual(r2.parcial, false);
});

teste('refresh: chamados da tela sao relidos mesmo sem mudanca (qualquer idade)', async () => {
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200001', 'softexpert');
  ORIGEM.idsConsultados = [];
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [c.id] });
  assert.strictEqual(r.candidatos.na_tela, 1);
  assert.deepStrictEqual(ORIGEM.idsConsultados, ['200001']);
});

teste('refresh: local ATENDENTE com origem ja em CLIENTE e corrigido (sentido ATENDENTE->externo)', async () => {
  definirChamado('200002', { aguardando: 'RETORNO - CLIENTE', nPos: 1, transicao: 'T2' });
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r.candidatos.situacao_divergente, 1);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200002', 'softexpert').aguardandoConsolidado, 'RETORNO - CLIENTE');
});

teste('refresh: posicionamento NOVO sem mudar situacao nem responsavel e detectado (nPos/ultPos)', async () => {
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200003', 'softexpert');
  assert.strictEqual(chamadoRepo.contarPosicionamentosDoChamado(EMPRESA, c.id), 1);
  definirChamado('200003', { aguardando: 'RETORNO - CLIENTE', nPos: 2, transicao: 'T1' }); // mesma situacao/responsavel/transicao
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r.candidatos.marca_alterada, 1);
  assert.strictEqual(chamadoRepo.contarPosicionamentosDoChamado(EMPRESA, c.id), 2);
});

teste('refresh: reconstrucao de mensagens preserva analista/IA, nao duplica e e idempotente', async () => {
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200003', 'softexpert');
  const { atendimento } = radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'user', conteudo: 'Pergunta do analista', usuarioId: 1, origemAcao: 'texto_livre' });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'assistant', conteudo: 'Resposta da IA', usuarioId: null });
  const contar = () => {
    const todas = mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 500 });
    return {
      importadas: todas.filter(m => m.origemSistema === 'softexpert').length,
      analista: todas.filter(m => m.conteudo === 'Pergunta do analista').length,
      ia: todas.filter(m => m.conteudo === 'Resposta da IA').length,
    };
  };
  const antes = contar();
  assert.strictEqual(antes.importadas, 3, 'abertura + 2 posicionamentos');
  // novo posicionamento na origem
  definirChamado('200003', { aguardando: 'RETORNO - CLIENTE', nPos: 3, transicao: 'T1' });
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r.reconstruidos, 1);
  const depois = contar();
  assert.strictEqual(depois.importadas, 4, 'abertura + 3 posicionamentos, sem duplicar');
  assert.strictEqual(depois.analista, 1);
  assert.strictEqual(depois.ia, 1);
  // rodar de novo sem mudanca nao altera nada
  const r2 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r2.reconstruidos, 0);
  assert.deepStrictEqual(contar(), depois);
  // a mensagem do analista manteve a origem explicita
  const msgAnalista = mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 500 }).find(m => m.conteudo === 'Pergunta do analista');
  assert.strictEqual(msgAnalista.origemAcao, 'texto_livre');
});

teste('refresh: chamado com turno de IA em andamento NAO e modificado; e retentado depois', async () => {
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200004', 'softexpert');
  const { atendimento } = radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  definirChamado('200004', { aguardando: 'RETORNO - ATENDENTE', nPos: 2, transicao: 'T9' });
  assert.ok(turnoLock.tentarAdquirir(EMPRESA, atendimento.id));
  try {
    const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [c.id] });
    assert.deepStrictEqual(r.ignoradosOcupados, ['200004']);
    assert.strictEqual(r.parcial, true, 'resultado parcial sinalizado');
    const depois = chamadoRepo.getChamadoPorNumero(EMPRESA, '200004', 'softexpert');
    assert.strictEqual(depois.aguardandoConsolidado, 'RETORNO - CLIENTE', 'chamado ocupado intocado');
    assert.strictEqual(chamadoRepo.contarPosicionamentosDoChamado(EMPRESA, c.id), 1);
  } finally {
    turnoLock.liberar(EMPRESA, atendimento.id);
  }
  const r2 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r2.ignoradosOcupados.length, 0);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200004', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
});

teste('refresh: ausente do snapshot e verificado por ID — encerrado vira Encerrado; nao encontrado NAO e tratado como encerrado', async () => {
  definirChamado('200005', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  definirChamado('200006', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200006', 'softexpert').statusEncerramento, 'Andamento');
  // 200005 encerrou na origem (sai do snapshot, volta com status Encerrado por ID)
  definirChamado('200005', { aguardando: 'RETORNO - CLIENTE', nPos: 1, status: 'Encerrado', noSnapshot: false });
  // 200006 some do snapshot E nao volta por ID (ex.: cancelado/fora do modelo)
  ORIGEM.abertos.delete('200006'); ORIGEM.chamados.delete('200006');
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r.candidatos.ausente_do_snapshot, 2);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200005', 'softexpert').statusEncerramento, 'Encerrado');
  assert.deepStrictEqual(r.naoEncontradosNaOrigem, ['200006']);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200006', 'softexpert').statusEncerramento, 'Andamento', 'ausencia nao e prova de encerramento');
});

teste('refresh: snapshot truncado => nao verifica ausentes e sinaliza parcial', async () => {
  definirChamado('200007', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  ORIGEM.snapshotTruncado = true;
  ORIGEM.idsConsultados = [];
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r.snapshot.truncado, true);
  assert.strictEqual(r.parcial, true);
  assert.strictEqual(r.candidatos.ausente_do_snapshot, undefined);
  ORIGEM.snapshotTruncado = false;
});

teste('refresh: origem fora do ar => snapshot ok:false, parcial, mas a tela ainda e relida por ID', async () => {
  snapshotService._resetarParaTeste();
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200001', 'softexpert');
  ORIGEM.snapshotLanca = true;
  ORIGEM.idsConsultados = [];
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [c.id] });
  ORIGEM.snapshotLanca = false;
  assert.strictEqual(r.snapshot.ok, false);
  assert.strictEqual(r.parcial, true);
  assert.deepStrictEqual(ORIGEM.idsConsultados, ['200001']);
});

teste('refresh: isolamento multiempresa — refresh da empresa A nao altera a B', async () => {
  reiniciarEstado();
  const fonteB = novaFonte(EMPRESA_B, 'B');
  // B ja tem chamado com mesmo numero de A (200002) e situacao propria
  definirChamado('200002', { aguardando: 'RETORNO - FORNECEDOR', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA_B, fonteB, { chamadoIds: [] });
  const b0 = chamadoRepo.getChamadoPorNumero(EMPRESA_B, '200002', 'softexpert');
  assert.strictEqual(b0.aguardandoConsolidado, 'RETORNO - FORNECEDOR');
  // A muda; roda so o refresh de A
  definirChamado('200002', { aguardando: 'RETORNO - ATENDENTE', nPos: 1, transicao: 'T7' });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200002', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA_B, '200002', 'softexpert').id, b0.id);
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA_B, '200002', 'softexpert').aguardandoConsolidado, 'RETORNO - FORNECEDOR', 'empresa B intocada');
});

teste('sincronizarAntesDaFila: mesmo caminho do botao e do auto; concluido -> recente com resultado e ids atualizados', async () => {
  reiniciarEstado();
  definirChamado('200001', { aguardando: 'RETORNO - ATENDENTE', nPos: 1, transicao: 'T20' });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200001', 'softexpert');
  const r1 = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [c.id] });
  assert.strictEqual(r1.status, 'concluido');
  assert.ok(r1.resultado.chamadoIdsAtualizados.includes(c.id));
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200001', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  const r2 = await refreshService.sincronizarAntesDaFila(EMPRESA, { aguardarMs: 0 });
  assert.strictEqual(r2.status, 'recente');
  assert.ok(r2.resultado && Array.isArray(r2.resultado.chamadoIdsAtualizados), 'resultado do ultimo ciclo fica disponivel para a tela');
});

teste('modo leve: tela ja lida por completo vai leve e preserva as duracoes gravadas', async () => {
  reiniciarEstado();
  definirChamado('200020', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  const r1 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.strictEqual(r1.candidatos.novo_na_base >= 1, true);
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200020', 'softexpert');
  assert.strictEqual(c.diasDur, 5, 'novo na base vem completo (com duracoes)');
  assert.ok(ORIGEM.opcoesPorIds.some(o => o.ids.includes('200020') && !o.leve));
  ORIGEM.opcoesPorIds = [];
  // mudanca de situacao + tela: leitura LEVE (leitura completa foi ha instantes)
  definirChamado('200020', { aguardando: 'RETORNO - ATENDENTE', nPos: 1, transicao: 'T3' });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [c.id] });
  const leitura = ORIGEM.opcoesPorIds.find(o => o.ids.includes('200020'));
  assert.strictEqual(leitura.leve, true, 'sem leitura completa desnecessaria');
  const depois = chamadoRepo.getChamadoPorNumero(EMPRESA, '200020', 'softexpert');
  assert.strictEqual(depois.aguardandoConsolidado, 'RETORNO - ATENDENTE');
  assert.strictEqual(depois.diasDur, 5, 'duracao preservada no modo leve');
  assert.strictEqual(depois.hrDur, 40);
});

teste('chat de chamado atualizado FORA do por-ID (ex.: pela janela) e reconciliado com os posicionamentos', async () => {
  reiniciarEstado();
  definirChamado('200030', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200030', 'softexpert');
  const { atendimento } = radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  assert.strictEqual(radarService.historicoImportadoDesatualizado(EMPRESA, c.id), false);
  // simula a importacao por janela gravando um posicionamento novo direto no banco
  chamadoRepo.upsertPosicionamento(EMPRESA, {
    fonteId: ctx.fonte.id, oidOrigem: 'POS-200030-JANELA', chamadoId: c.id, dataPosicionamento: '2026-10-12T10:00:00.000Z',
    tecnicoNomeOrigem: 'Tecnico', descricao: 'Posicionamento trazido pela janela', aguardandoRetorno: false,
  });
  assert.strictEqual(radarService.historicoImportadoDesatualizado(EMPRESA, c.id), true);
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.ok(r.reconstruidos >= 1);
  assert.strictEqual(radarService.historicoImportadoDesatualizado(EMPRESA, c.id), false);
  const importadas = mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 500 }).filter(m => m.origemSistema === 'softexpert');
  assert.ok(importadas.some(m => /Posicionamento trazido pela janela/.test(m.conteudo)));
});

teste('progresso em etapas: a tela fica atualizada antes da janela terminar (sem marcar como concluido)', async () => {
  reiniciarEstado();
  definirChamado('200040', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200040', 'softexpert');
  definirChamado('200040', { aguardando: 'RETORNO - ATENDENTE', nPos: 1, transicao: 'T5' });
  ORIGEM.atrasoJanelaMs = 600; // janela lenta
  const t0 = Date.now();
  const r0 = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 0, chamadoIds: [c.id] });
  assert.strictEqual(r0.status, 'em_andamento');
  assert.ok(Date.now() - t0 < 150, 'a rota responde na hora, sem esperar a sincronizacao');
  let vista = null;
  for (let i = 0; i < 40 && !vista; i++) {
    await new Promise(r => setTimeout(r, 25));
    const s = await refreshService.sincronizarAntesDaFila(EMPRESA, { aguardarMs: 0 });
    if (s.status === 'em_andamento' && s.progresso?.etapa === 'tela_atualizada') vista = s;
  }
  ORIGEM.atrasoJanelaMs = 0;
  assert.ok(vista, 'progresso da tela publicado enquanto a janela ainda roda');
  assert.strictEqual(vista.progresso.parcial, true, 'progresso nunca e apresentado como concluido');
  assert.ok(vista.progresso.chamadoIdsAtualizados.includes(c.id));
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200040', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  const final = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: false, aguardarMs: 5000 });
  assert.ok(['concluido', 'recente'].includes(final.status));
});

// ── Anexos: metadados leves (sem baixar binarios a cada Refresh) ────────────
async function comAnexosStub(fn) {
  const original = anexosSoftExpertService.sincronizarAnexosParaAtendimento;
  const chamadas = [];
  let falhar = false;
  anexosSoftExpertService.sincronizarAnexosParaAtendimento = async (empresaId, chamadoId, atendimentoId) => {
    chamadas.push({ chamadoId, atendimentoId });
    if (falhar) throw new Error('download falhou');
    return [{ id: 'a1' }];
  };
  try {
    return await fn({ chamadas, falhar: (v) => { falhar = v; } });
  } finally {
    anexosSoftExpertService.sincronizarAnexosParaAtendimento = original;
  }
}

teste('anexos: anexo NOVO sem mudar situacao/responsavel/posicionamentos e detectado por metadados; sem mudanca nao baixa', async () => {
  reiniciarEstado();
  definirChamado('200050', { aguardando: 'RETORNO - CLIENTE', nPos: 1, anexos: { grid: 1, ultGrid: 100, pos: 0, chamado: 0 } });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200050', 'softexpert');
  radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  await comAnexosStub(async ({ chamadas }) => {
    // 1a observacao: chat tem 0 anexos da origem < 1 informado => baixa uma vez
    await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(chamadas.length, 1);
    // ciclos sem mudanca: nenhum download
    await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(chamadas.length, 1, 'sem mudanca nos metadados: nao baixa binarios');
    // anexo novo no grid: MESMA situacao, MESMO responsavel, MESMA transicao, MESMOS posicionamentos
    definirChamado('200050', { aguardando: 'RETORNO - CLIENTE', nPos: 1, anexos: { grid: 2, ultGrid: 200, pos: 0, chamado: 0 } });
    const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(chamadas.length, 2, 'anexo novo detectado pelos metadados');
    assert.strictEqual(r.anexosSincronizados.length, 1);
    assert.strictEqual(r.candidatos.marca_alterada, undefined, 'nenhuma releitura do chamado foi necessaria');
    // substituicao de anexo (mesma contagem, BNCREATED novo) tambem e detectada
    definirChamado('200050', { aguardando: 'RETORNO - CLIENTE', nPos: 1, anexos: { grid: 2, ultGrid: 300, pos: 0, chamado: 0 } });
    await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(chamadas.length, 3);
  });
});

teste('anexos: chamado ocupado ou com falha nao marca como sincronizado (retenta) e sinaliza parcial; sem chat nao baixa', async () => {
  reiniciarEstado();
  definirChamado('200051', { aguardando: 'RETORNO - CLIENTE', nPos: 1, anexos: { grid: 1, ultGrid: 1, pos: 0, chamado: 0 } });
  definirChamado('200052', { aguardando: 'RETORNO - CLIENTE', nPos: 1, anexos: { grid: 1, ultGrid: 1, pos: 0, chamado: 0 } });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200051', 'softexpert');
  const { atendimento } = radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  await comAnexosStub(async ({ chamadas, falhar }) => {
    assert.ok(turnoLock.tentarAdquirir(EMPRESA, atendimento.id));
    try {
      const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
      assert.strictEqual(chamadas.length, 0, 'ocupado: nao baixa');
      assert.strictEqual(r.parcial, true);
    } finally { turnoLock.liberar(EMPRESA, atendimento.id); }
    falhar(true);
    const r2 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(r2.parcial, true);
    assert.ok(r2.erros.some(e => /sincronizacao_anexos/.test(e.erro)));
    falhar(false);
    const r3 = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
    assert.strictEqual(r3.anexosSincronizados.length, 1, 'retentado e concluido');
    assert.ok(chamadas.every(x => x.atendimentoId === atendimento.id), '200052 (sem chat) nunca baixou');
  });
});

// ── Concorrencia: manual + automatico ───────────────────────────────────────
teste('concorrencia: refresh manual e automatico simultaneos = 1 execucao; telas dos dois entram (sem duplicar trabalho)', async () => {
  reiniciarEstado();
  definirChamado('200060', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  definirChamado('200061', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const a = chamadoRepo.getChamadoPorNumero(EMPRESA, '200060', 'softexpert');
  const b = chamadoRepo.getChamadoPorNumero(EMPRESA, '200061', 'softexpert');
  radarService.iniciarAnalise(EMPRESA, a.id, { preAnaliseAutomatica: false });
  ORIGEM.atrasoJanelaMs = 150;
  ORIGEM.chamadasJanela = 0; ORIGEM.chamadasSnapshot = 0; ORIGEM.idsConsultados = [];
  definirChamado('200060', { aguardando: 'RETORNO - ATENDENTE', nPos: 2, transicao: 'T8' });
  definirChamado('200061', { aguardando: 'RETORNO - ATENDENTE', nPos: 1, transicao: 'T8' });
  const [manual, automatico, manual2] = await Promise.all([
    refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [a.id] }),
    refreshService.sincronizarAntesDaFila(EMPRESA, { force: false, aguardarMs: 5000, chamadoIds: [b.id] }),
    refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [a.id, b.id] }),
  ]);
  ORIGEM.atrasoJanelaMs = 0;
  assert.strictEqual(ORIGEM.chamadasJanela, 1, 'uma unica importacao por janela');
  assert.ok([manual, automatico, manual2].every(r => r.status === 'concluido'));
  assert.strictEqual(manual.resultado, automatico.resultado, 'todos compartilham a mesma execucao');
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200060', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  assert.strictEqual(chamadoRepo.getChamadoPorNumero(EMPRESA, '200061', 'softexpert').aguardandoConsolidado, 'RETORNO - ATENDENTE');
  // sem mensagens importadas duplicadas no chat que estava aberto
  const at = atendimentoRepo.getAtendimentoPorReferencia(EMPRESA, { origem: 'softexpert', referenciaExterna: '200060' });
  const importadas = mensagemRepo.listarMensagens(EMPRESA, at.id, { limite: 500 }).filter(m => m.origemSistema === 'softexpert');
  assert.strictEqual(importadas.length, 3, 'abertura + 2 posicionamentos, sem duplicar');
});

// ── Falha / parcial nunca apresentados como sucesso ─────────────────────────
teste('semantica de resultado: sucesso so quando nada ficou parcial; falha da janela e falha total sao explicitas', async () => {
  reiniciarEstado();
  const ok = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [] });
  assert.strictEqual(ok.resultado.sucesso, true);
  assert.strictEqual(ok.resultado.parcial, false);
  assert.strictEqual(ok.resultado.falhou, false);

  ORIGEM.janelaLanca = true;
  const janelaFalhou = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [] });
  ORIGEM.janelaLanca = false;
  assert.strictEqual(janelaFalhou.resultado.sucesso, false, 'falha da janela nao e sucesso');
  assert.strictEqual(janelaFalhou.resultado.parcial, true);

  const originalFontes = snapshotService.fontesElegiveis;
  snapshotService.fontesElegiveis = () => { throw new Error('banco indisponivel'); };
  try {
    const total = await refreshService.sincronizarAntesDaFila(EMPRESA, { force: true, aguardarMs: 5000, chamadoIds: [] });
    assert.strictEqual(total.status, 'concluido');
    assert.strictEqual(total.resultado.falhou, true);
    assert.strictEqual(total.resultado.sucesso, false);
    // a consulta seguinte (polling da tela) NAO herda o sucesso anterior
    const depois = await refreshService.sincronizarAntesDaFila(EMPRESA, { aguardarMs: 0 });
    assert.strictEqual(depois.status, 'recente');
    assert.strictEqual(depois.resultado.falhou, true);
    assert.strictEqual(depois.resultado.sucesso, false);
  } finally {
    snapshotService.fontesElegiveis = originalFontes;
  }
});

teste('snapshot em cache antigo (origem fora do ar) nao conta como sucesso', async () => {
  reiniciarEstado();
  definirChamado('200070', { aguardando: 'RETORNO - CLIENTE', nPos: 1 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] }); // snapshot bom
  ORIGEM.snapshotLanca = true;
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  ORIGEM.snapshotLanca = false;
  assert.strictEqual(r.snapshot.origem, 'cache_antigo');
  assert.strictEqual(r.parcial, true);
});

// ── Reconstrucao preserva tudo que nao e historico importado ────────────────
teste('reconstrucao: preserva analista, IA, anexos (inclusive da origem), dossie e trilha — nenhuma tabela filha perde linhas', async () => {
  reiniciarEstado();
  const db = database.getDB();
  definirChamado('200080', { aguardando: 'RETORNO - CLIENTE', nPos: 2 });
  await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  const c = chamadoRepo.getChamadoPorNumero(EMPRESA, '200080', 'softexpert');
  const { atendimento } = radarService.iniciarAnalise(EMPRESA, c.id, { preAnaliseAutomatica: false });
  const msgAnalista = mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'user', conteudo: 'Analise o anexo', usuarioId: 1, origemAcao: 'texto_livre' });
  const msgIa = mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'assistant', conteudo: 'Resposta da IA', usuarioId: null });
  // anexos: um enviado pelo analista (ligado a mensagem) e um da origem
  const anexoAnalista = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: 'log.txt', nomeInterno: 'log-int-1', mimeType: 'text/plain', tamanho: 10, caminhoRelativo: '1/a/log.txt',
  });
  anexoRepo.vincularMensagem(EMPRESA, anexoAnalista.id, msgAnalista.id);
  anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: 'origem.pdf', nomeInterno: 'origem-int-1', mimeType: 'application/pdf', tamanho: 20, caminhoRelativo: '1/a/origem.pdf',
    origemSistema: 'softexpert', origemOid: 'BLOB-1', origemTipo: 'anexo', origemReferenciaOid: 'OID-200080',
  });
  // execucao (trilha) e validacao de solucao (ligada a mensagem da IA)
  db.prepare(`INSERT INTO investigacao_execucoes (id, empresa_id, atendimento_id, mensagem_id, status, criado_em)
              VALUES ('exec-1', ?, ?, ?, 'concluida', ?)`).run(EMPRESA, atendimento.id, msgIa.id, new Date().toISOString());

  const tabelasComAtendimento = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()
    .map(t => t.name)
    .filter(n => !['mensagens', 'atendimentos'].includes(n))
    .filter(n => db.prepare(`PRAGMA table_info(${n})`).all().some(col => col.name === 'atendimento_id'));
  const contar = () => Object.fromEntries(tabelasComAtendimento.map(n =>
    [n, db.prepare(`SELECT COUNT(*) AS n FROM ${n} WHERE atendimento_id = ?`).get(atendimento.id).n]));
  const antes = contar();
  assert.ok(antes.anexos >= 2 && antes.investigacao_execucoes >= 1, 'dados de apoio criados');

  definirChamado('200080', { aguardando: 'RETORNO - CLIENTE', nPos: 3 });
  const r = await refreshService.atualizarPorSnapshot(EMPRESA, ctx.fonte, { chamadoIds: [] });
  assert.ok(r.reconstruidos >= 1);

  assert.deepStrictEqual(contar(), antes, 'nenhuma tabela ligada ao atendimento perdeu ou ganhou linhas');
  const mensagens = mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 500 });
  assert.ok(mensagens.some(m => m.id === msgAnalista.id), 'mensagem do analista preservada (mesmo id)');
  assert.ok(mensagens.some(m => m.id === msgIa.id), 'resposta da IA preservada (mesmo id)');
  assert.strictEqual(mensagens.filter(m => m.origemSistema === 'softexpert').length, 4, 'abertura + 3 posicionamentos, sem duplicar');
  const anexoDepois = anexoRepo.getAnexo(EMPRESA, anexoAnalista.id);
  assert.strictEqual(anexoDepois.mensagemId, msgAnalista.id, 'vinculo do anexo com a mensagem do analista preservado');
  const exec = db.prepare(`SELECT mensagem_id FROM investigacao_execucoes WHERE id = 'exec-1'`).get();
  assert.strictEqual(exec.mensagem_id, msgIa.id, 'trilha continua ligada a resposta da IA');
});

teste('importacoes tipo refresh nao entram na janela incremental nem na listagem padrao', async () => {
  const importacaoRepo = require('../backend/repositories/importacao-repository');
  const todas = importacaoRepo.listarImportacoes(EMPRESA, {});
  assert.ok(todas.every(i => i.tipo !== 'refresh'));
  assert.ok(importacaoRepo.listarImportacoes(EMPRESA, { incluirRefresh: true }).some(i => i.tipo === 'refresh'));
});

async function main() {
  let falhas = 0;
  for (const t of testes) {
    try { await t.fn(); console.log(`  ok  ${t.nome}`); } catch (err) {
      falhas++;
      console.error(`  FALHOU  ${t.nome}\n    ${err.stack || err.message}`);
    }
  }
  limparEDesligar();
  console.log(falhas ? `\n${falhas} teste(s) falharam.` : `\n${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
}
main().catch(err => { console.error(err); limparEDesligar(); process.exit(1); });

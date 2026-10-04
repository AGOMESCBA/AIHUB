// Testes do HistoricalImportService (Checkpoints 4-6) — usa um MOCK do
// softexpert-sqlserver-adapter (require.cache override) para simular o SQL
// Server sem depender de credenciais reais. Valida: full load em batches,
// idempotência (testes A-F do prompt), retomada por checkpoint, e o recorte
// de período (piloto 2026) sem hardcode de ano no orquestrador.
//
// Executar: node "apps/IA Service/tests/base-historica-import.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = require('crypto').randomBytes(32).toString('base64');

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const clienteRepo = require('../backend/repositories/cliente-repository');
const importacaoRepo = require('../backend/repositories/importacao-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');

const EMPRESA = 9701;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

// ── Mock do adapter SoftExpert: substitui o require real por dados sintéticos
const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
const MOCK_CHAMADOS = [];
for (let i = 1; i <= 7; i++) {
  MOCK_CHAMADOS.push({
    OID: `OID-${i}`,
    IDPROCESS: String(100000 + i),
    DT: '20260315',
    CNPJCPF: i <= 3 ? '04.476.442/0001-60' : '11.222.333/0001-81', // primeiros 3 chamados do mesmo cliente
    DP: i <= 3 ? 'Cliente A' : 'Cliente B',
    CDUSER: `SOL-${i}`,
    NMSOLICITANTE: `Solicitante ${i}`,
    EMAIL: `solicitante${i}@cliente.com`,
    CDUSERANA: 'TEC-1',
    NOMEANALISTARES: 'Tecnico Responsavel',
    PRODUTO: 'SoftExpert', FAMILIA: 'Workflow', MD: 'Aprovacao',
    TITULOCHAMADO: `Chamado de teste ${i}`,
    DESCRICAO01: `Descricao do chamado ${i}`,
    SOLUCAOAPLICADA: null,
  });
}
MOCK_CHAMADOS.push({ OID: 'OID-8', IDPROCESS: '100008', DT: '20260315', CNPJCPF: null, DP: null, TITULOCHAMADO: 'Sem CNPJ' });
MOCK_CHAMADOS.push({ OID: 'OID-9', IDPROCESS: '100009', DT: '20260315', CNPJCPF: '04.476.442/0001-60', CDUSERANA: 'TEC-A', NOMEANALISTARES: 'Tecnico A', TITULOCHAMADO: 'Chamado com posicionamento de outro tecnico' });

const MOCK_POSICIONAMENTOS = {
  '100001': Array.from({ length: 10 }, (_, i) => ({ OID: `POS-1-${i}`, CHAMADO: '100001', DATAATUAL: '20260316', DESCRICAO: `Posicionamento ${i}`, CDUSERANA: 'TEC-1', ANALISTAJ2A: 'Tecnico Responsavel' })),
  '100009': [{ OID: 'POS-9-1', CHAMADO: '100009', DATAATUAL: '20270102', DESCRICAO: 'Posicionamento tardio de outro tecnico', CDUSERANA: 'TEC-B', ANALISTAJ2A: 'Tecnico B' }],
};

require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo(empresaId, fonte, periodo, { offset = 0, limit = 500 } = {}) {
      return MOCK_CHAMADOS.slice(offset, offset + limit);
    },
    async contarChamadosPeriodo() {
      return MOCK_CHAMADOS.length;
    },
    async listarPosicionamentosDoChamado(empresaId, fonte, idProcess) {
      return MOCK_POSICIONAMENTOS[idProcess] || [];
    },
  },
};

const historicalImportService = require('../backend/services/import/historical-import-service');

async function main() {
  const fonte = agenteRepo.criarFonte(EMPRESA, {
    connectionKey: 'softexpert-teste', nome: 'SoftExpert Teste', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter',
  });

  // ── Full load com período PARAMETRIZADO (não hardcoded) — piloto 2026 ────
  const PERIODO_INICIO = '20260101';
  const PERIODO_FIM = '20270101';
  assert.doesNotMatch(
    historicalImportService.executarFullLoad.toString(),
    /20260101|20270101/,
    'orquestrador não deve ter o ano de 2026 hardcoded em lugar nenhum do código'
  );

  const importacao = await historicalImportService.executarFullLoad(EMPRESA, fonte.id, {
    periodoInicio: PERIODO_INICIO, periodoFim: PERIODO_FIM, tamanhoLote: 3, // lote pequeno para forçar múltiplos batches
  });

  assert.strictEqual(importacao.status, 'concluido');
  assert.strictEqual(importacao.registrosLidos, MOCK_CHAMADOS.length, 'deve ler todos os 9 chamados mockados');
  assert.strictEqual(importacao.registrosInseridos, MOCK_CHAMADOS.length, 'primeira carga: todos inseridos');

  // ── TESTE A: chamados com mesmo CNPJ → 1 cliente ────────────────────────
  assert.strictEqual(clienteRepo.contarClientes(EMPRESA), 2, 'devem existir 2 clientes distintos (Cliente A e Cliente B) — CNPJ ausente do OID-8 não cria terceiro');
  const clienteA = clienteRepo.getClientePorCnpj(EMPRESA, '04476442000160');
  assert.ok(clienteA);
  const chamadosClienteA = [1, 2, 3, 9].map(i => chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, `OID-${i}`));
  for (const c of chamadosClienteA) assert.strictEqual(c.clienteId, clienteA.id, 'todos os chamados com o mesmo CNPJ devem apontar para o mesmo cliente');

  // ── TESTE C: chamado 1 deve ter 10 posicionamentos ──────────────────────
  const chamado1 = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'OID-1');
  assert.strictEqual(chamadoRepo.listarPosicionamentosDoChamado(EMPRESA, chamado1.id).length, 10);

  // ── TESTE D: responsável atual != técnico do posicionamento ─────────────
  const chamado9 = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'OID-9');
  const posDoChamado9 = chamadoRepo.listarPosicionamentosDoChamado(EMPRESA, chamado9.id);
  assert.strictEqual(posDoChamado9.length, 1, 'posicionamento de 2027 deve ser importado mesmo com chamado aberto em 2026 (seção 46 do prompt)');
  assert.notStrictEqual(chamado9.tecnicoResponsavelId, posDoChamado9[0].tecnicoId, 'técnico responsável do chamado deve ser diferente do técnico que fez o posicionamento');

  // ── Inconsistência: CNPJ ausente no OID-8, registrada sem bloquear a carga
  const chamado8 = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'OID-8');
  assert.ok(chamado8, 'chamado sem CNPJ ainda deve ser importado (RAW+chamado preservados)');
  assert.strictEqual(chamado8.clienteId, null);
  const inconsistencias = importacaoRepo.listarInconsistencias(EMPRESA, importacao.id);
  assert.ok(inconsistencias.some(i => i.tipoInconsistencia === 'cnpj_ausente' && i.oidOrigem === 'OID-8'), 'inconsistência de CNPJ ausente deve estar registrada');

  // ── TESTE B: reimportação não duplica ─────────────────────────────────────
  const totalChamadosAntes = chamadoRepo.contarChamados(EMPRESA);
  const totalClientesAntes = clienteRepo.contarClientes(EMPRESA);
  const segundaImportacao = await historicalImportService.executarFullLoad(EMPRESA, fonte.id, {
    periodoInicio: PERIODO_INICIO, periodoFim: PERIODO_FIM, tamanhoLote: 3,
  });
  assert.strictEqual(segundaImportacao.registrosInseridos, 0, 'reimportação idêntica não deve inserir nada novo');
  assert.strictEqual(segundaImportacao.registrosAtualizados, 0, 'reimportação idêntica não deve marcar nada como atualizado (hash igual)');
  assert.strictEqual(chamadoRepo.contarChamados(EMPRESA), totalChamadosAntes, 'total de chamados não deve mudar');
  assert.strictEqual(clienteRepo.contarClientes(EMPRESA), totalClientesAntes, 'total de clientes não deve mudar');

  // ── TESTE F: alteração real gera UPDATE ───────────────────────────────────
  MOCK_CHAMADOS[0].TITULOCHAMADO = 'Chamado de teste 1 — TÍTULO ALTERADO';
  const terceiraImportacao = await historicalImportService.executarFullLoad(EMPRESA, fonte.id, {
    periodoInicio: PERIODO_INICIO, periodoFim: PERIODO_FIM, tamanhoLote: 3,
  });
  assert.strictEqual(terceiraImportacao.registrosAtualizados, 1, 'apenas o chamado alterado deve ser marcado como atualizado');
  assert.strictEqual(terceiraImportacao.registrosInseridos, 0);
  const chamado1Atualizado = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'OID-1');
  assert.match(chamado1Atualizado.titulo, /TÍTULO ALTERADO/);
  assert.strictEqual(chamado1Atualizado.precisaIndexacao, true, 'chamado alterado deve ficar marcado para reindexação');

  // ── TESTE E (retomada): simula interrupção a meio de uma importação ──────
  const chamadosGrandeLote = [];
  for (let i = 1; i <= 20; i++) {
    chamadosGrandeLote.push({ OID: `RETOMADA-${i}`, IDPROCESS: String(200000 + i), DT: '20260601', CNPJCPF: '99.999.999/0001-99', DP: 'Cliente Retomada', TITULOCHAMADO: `Chamado retomada ${i}` });
  }
  require.cache[adapterPath].exports.listarChamadosPeriodo = async (empresaId, fonte, periodo, { offset = 0, limit = 500 } = {}) => chamadosGrandeLote.slice(offset, offset + limit);
  require.cache[adapterPath].exports.listarPosicionamentosDoChamado = async () => [];

  const importacaoParcial = importacaoRepo.criarImportacao(EMPRESA, { fonteId: fonte.id, tipo: 'full', periodoInicio: '20260601', periodoFim: '20260602' });
  // Simula 1 lote já processado (5 de 20) antes de "cair":
  importacaoRepo.atualizarImportacao(EMPRESA, importacaoParcial.id, {
    checkpoint: { offset: 5 }, registrosLidos: 5, registrosInseridos: 5, status: 'executando', inicioEm: new Date().toISOString(),
  });
  for (const row of chamadosGrandeLote.slice(0, 5)) {
    await historicalImportService._processarChamado(EMPRESA, fonte, require.cache[adapterPath].exports, importacaoParcial.id, row);
  }

  const retomada = await historicalImportService.executarFullLoad(EMPRESA, fonte.id, {
    periodoInicio: '20260601', periodoFim: '20260602', tamanhoLote: 5, importacaoExistenteId: importacaoParcial.id,
  });
  assert.strictEqual(retomada.status, 'concluido');
  assert.strictEqual(retomada.registrosLidos, 20, 'retomada deve completar os 20 registros totais (5 já processados + 15 retomados), sem processar os 5 primeiros de novo');
  for (let i = 1; i <= 20; i++) {
    const c = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, `RETOMADA-${i}`);
    assert.ok(c, `chamado RETOMADA-${i} deve existir após retomada completa`);
  }

  // ── Mapeamento de titulo/descricao validado contra dados reais (2026-09):
  // titulo segue a ordem TITULOWF → TITULOCHAMADO → TEXTO31 (ordem
  // confirmada explicitamente pelo usuário — TITULOWF é o preferido quando
  // preenchido, mesmo com TITULOCHAMADO também preenchido); breveDescricao
  // cai para TEXTO31 quando BREVEDESCRICAO for nulo/vazio — ver cabeçalho
  // de _mapearChamado.
  const mapeadoComFallback = historicalImportService._mapearChamado({
    OID: 'OID-FALLBACK', IDPROCESS: '999999', DT: '2026-09-24 00:00:00',
    TITULOCHAMADO: null, TITULOWF: 'Titulo vindo do workflow',
    BREVEDESCRICAO: null, TEXTO31: 'Descricao breve vinda do TEXTO31',
    DESCRICAO01: null, CNPJCPF: '04.476.442/0001-60',
  });
  assert.strictEqual(mapeadoComFallback.titulo, 'Titulo vindo do workflow', 'titulo deve cair para TITULOWF quando TITULOCHAMADO for nulo');
  assert.strictEqual(mapeadoComFallback.breveDescricao, 'Descricao breve vinda do TEXTO31', 'breveDescricao deve cair para TEXTO31 quando BREVEDESCRICAO for nulo');

  const mapeadoComAmbosPreenchidos = historicalImportService._mapearChamado({
    OID: 'OID-AMBOS', IDPROCESS: '999998', DT: '2026-09-24 00:00:00',
    TITULOCHAMADO: 'Nao deveria aparecer', TITULOWF: 'Titulo preferido',
    BREVEDESCRICAO: 'Breve descricao direta', TEXTO31: 'Nao deveria aparecer',
    DESCRICAO01: null, CNPJCPF: '04.476.442/0001-60',
  });
  assert.strictEqual(mapeadoComAmbosPreenchidos.titulo, 'Titulo preferido', 'TITULOWF preenchido deve ganhar de TITULOCHAMADO mesmo quando os dois existem');
  assert.strictEqual(mapeadoComAmbosPreenchidos.breveDescricao, 'Breve descricao direta', 'BREVEDESCRICAO preenchido nao deve ser sobrescrito pelo fallback');

  const mapeadoSoComTitulochamado = historicalImportService._mapearChamado({
    OID: 'OID-SO-TITULOCHAMADO', IDPROCESS: '999997', DT: '2026-09-24 00:00:00',
    TITULOCHAMADO: 'Titulo direto', TITULOWF: null,
    DESCRICAO01: null, CNPJCPF: '04.476.442/0001-60',
  });
  assert.strictEqual(mapeadoSoComTitulochamado.titulo, 'Titulo direto', 'titulo deve cair para TITULOCHAMADO quando TITULOWF for nulo');

  // ── Sem fallback de técnico do posicionamento a partir do chamado pai
  // (tentativa revertida em 2026-09: piloto real mostrou que herdar o ID
  // do chamado enquanto mantém o nome do próprio posicionamento produzia
  // registros com ID de uma pessoa e nome de outra — pior que não vincular).
  const posSemCduserana = historicalImportService._mapearPosicionamento(
    { OID: 'POS-1', CHAMADO: '888888', DATAATUAL: '2026-09-24 00:00:00', CDUSERANA: null, ANALISTAJ2A: 'Tecnico do Posicionamento' }
  );
  assert.strictEqual(posSemCduserana.tecnicoIdOrigem, null, 'sem CDUSERANA proprio, tecnicoIdOrigem deve ficar null (sem herdar do chamado pai)');
  assert.strictEqual(posSemCduserana.tecnicoNomeOrigem, 'Tecnico do Posicionamento', 'nome do proprio posicionamento (ANALISTAJ2A) deve ser preservado mesmo sem tecnicoIdOrigem');

  // ── aguardandoRetorno: bug corrigido em 2026-09 (campo de origem e texto
  // categorico, nao numerico — !!Number(...) sempre resultava em false).
  // Valores reais confirmados via SELECT DISTINCT contra DYNITSMGRIDREGISTR:
  // so 'RETORNO - ATENDENTE' (exato) sinaliza a fila do analista; demais
  // variantes (inclusive 'Retorno Analista', decisao explicita do usuario de
  // NAO tratar como equivalente) devem resultar em false.
  const posAguardandoAtendente = historicalImportService._mapearPosicionamento(
    { OID: 'POS-AGD-1', CHAMADO: '888888', DATAATUAL: '2026-09-24 00:00:00', AGUARDANRETORNO: 'RETORNO - ATENDENTE' }
  );
  assert.strictEqual(posAguardandoAtendente.aguardandoRetorno, true, "AGUARDANRETORNO='RETORNO - ATENDENTE' deve mapear para true");

  const posAguardandoCliente = historicalImportService._mapearPosicionamento(
    { OID: 'POS-AGD-2', CHAMADO: '888888', DATAATUAL: '2026-09-24 00:00:00', AGUARDANRETORNO: 'RETORNO - CLIENTE' }
  );
  assert.strictEqual(posAguardandoCliente.aguardandoRetorno, false, "AGUARDANRETORNO='RETORNO - CLIENTE' deve mapear para false (nao e a fila do analista)");

  const posAguardandoGrafiaAlternativa = historicalImportService._mapearPosicionamento(
    { OID: 'POS-AGD-3', CHAMADO: '888888', DATAATUAL: '2026-09-24 00:00:00', AGUARDANRETORNO: 'Retorno Analista' }
  );
  assert.strictEqual(posAguardandoGrafiaAlternativa.aguardandoRetorno, false, "'Retorno Analista' (grafia alternativa) deve mapear para false por decisao explicita do usuario (comparacao exata, so 'RETORNO - ATENDENTE')");

  const posAguardandoNulo = historicalImportService._mapearPosicionamento(
    { OID: 'POS-AGD-4', CHAMADO: '888888', DATAATUAL: '2026-09-24 00:00:00', AGUARDANRETORNO: null }
  );
  assert.strictEqual(posAguardandoNulo.aguardandoRetorno, null, 'AGUARDANRETORNO nulo deve mapear para null, nao false');

  // Reset de testes precisa apagar tambem os atendimentos do Radar derivados
  // da fonte. Eles ficam em `atendimentos`, fora da cascata de importacoes.
  const chamadoParaReset = chamadoRepo.getChamadoPorOid(EMPRESA, fonte.id, 'OID-1');
  const atendimentoRadar = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: chamadoParaReset.sistemaOrigem,
    canalEntrada: 'radar',
    referenciaExterna: chamadoParaReset.numero,
    conteudoBruto: 'Atendimento do Radar gerado a partir da base historica',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimentoRadar.id, {
    papel: 'assistant',
    conteudo: 'Resposta antiga da IA que nao pode sobreviver ao reset da fonte.',
  });
  const limpeza = agenteRepo.limparHistoricoFonte(EMPRESA, fonte.id);
  assert.strictEqual(limpeza.limpa, true, 'limpeza da fonte deve confirmar execucao');
  assert.ok(limpeza.importacoesRemovidas >= 1, 'reset deve remover importacoes da fonte');
  assert.ok(limpeza.atendimentosRemovidos >= 1, 'reset deve remover atendimentos do Radar vinculados aos chamados da fonte');
  assert.strictEqual(atendimentoRepo.getAtendimento(EMPRESA, atendimentoRadar.id), null, 'atendimento do Radar e suas respostas antigas da IA devem ser removidos no reset');

  console.log('base-historica-import.test.js: ok (todos os asserts passaram)');
}

main()
  .then(() => { limparEDesligar(); process.exit(0); })
  .catch((err) => { limparEDesligar(); console.error(err); process.exit(1); });

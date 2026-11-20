// node --test "apps/IA Service/tests/jade-pa.test.js"
// Jade no Primeiro Atendimento.
// Fase 1 (simulação): uma ação por chamado, trava entre processos, intervalo e
// limite diário, descarte quando a triagem chega antes, devolução desligada
// vira resposta, texto que cita outro chamado é recusado, 3 falhas = alerta.
// Fases 2/3 (publicar/devolver): grava na grade com a marca da Jade, nunca
// duplica (envio não confirmado é conferido antes de reenviar), devolve só
// pela ATV-02/ação 1, confere a chegada na ATV-06 e respeita a lista de
// chamados permitidos.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-jade-pa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

function stub(relativo, exports) {
  const p = require.resolve(relativo);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// SoftExpert simulado: situação de cada chamado e usuário da Jade.
const origem = { chamados: new Map(), usuarioAtivo: true };
function chamadoNaOrigem(numero, dados = {}) {
  origem.chamados.set(numero, { aberto: true, comResp: false, posJade: 0, posOutros: 0, ativas: ['ATV-02'], ...dados });
}
function elegivel(c) {
  return c.aberto && c.ativas.includes('ATV-02') && !c.comResp && c.posJade + c.posOutros === 0;
}
stub('../backend/services/agente-local-service', {
  async executarSelectNaFonte(_empresaId, _fonteId, { sql, params }) {
    if (sql.includes('FROM ADUSER')) {
      return params.cdUser === '995' ? [{ CDUSER: 995, NMUSER: 'Jade', IDUSER: '10677535000155', FGUSERENABLED: origem.usuarioAtivo ? 1 : 0 }] : [];
    }
    if (sql.includes('LEFT JOIN WFSTRUCT')) {
      const c = origem.chamados.get(params.numero);
      if (!c) return [];
      const base = { PROC_STATUS: c.aberto ? 1 : 2, COM_RESP: c.comResp ? 1 : 0, POS_JADE: c.posJade, POS_OUTROS: c.posOutros };
      return (c.ativas.length ? c.ativas : [null]).map(a => ({ ...base, ATIVA: a }));
    }
    const lista = [...origem.chamados].filter(([, c]) => elegivel(c)).map(([n]) => n);
    return (params.numero ? lista.filter(n => n === params.numero) : lista).map(n => ({ NUM: n }));
  },
});
stub('../backend/services/import/historical-import-service', {
  async atualizarChamadosPorIds(_e, _f, numeros) { return { erros: [], atualizados: numeros.map(n => ({ numero: n })) }; },
});
stub('../backend/services/radar-service', {
  iniciarAnalise(_e, chamadoId) { return { atendimento: { id: `at-${chamadoId}` } }; },
});
stub('../backend/services/anexos-softexpert-service', { async sincronizarAnexosParaAtendimento() { return []; } });
const turnos = [];
const simultaneos = { agora: 0, maximo: 0 };
stub('../backend/services/investigacao-service', {
  async processarTurno(empresaId, atendimentoId, opts) {
    turnos.push({ atendimentoId, opts });
    simultaneos.agora++;
    simultaneos.maximo = Math.max(simultaneos.maximo, simultaneos.agora);
    await new Promise(r => setTimeout(r, 15));
    simultaneos.agora--;
    return { id: `msg-${atendimentoId}`, papel: 'assistant', conteudo: 'Análise técnica: verificar parâmetro MV_XYZ.', diagnostico: {} };
  },
});
stub('../backend/services/ai-config-service', { resolverKeysEOrdem() { return { keys: {}, cfg: {} }; } });
let respostasIA = [];
stub('../backend/services/ai-provider-client', {
  async chamarIA() {
    const r = respostasIA.length ? respostasIA.shift() : null;
    if (!r) throw new Error('IA sem resposta programada');
    return { texto: typeof r === 'string' ? r : JSON.stringify(r), provider: 'teste', model: 'teste' };
  },
});

// Contrato de escrita com a Jade (995) autorizada; mapearCampos é o real.
const retornoConfigReal = require('../backend/services/retorno-softexpert-config');
const CONTRATO = {
  mainEntityId: 'itsm', childRelationshipId: 'relagridregistr',
  campos: {
    DESCRICAO: { id: 'descricao', tipo: 'texto' },
    SITUACAOCHAMADO: { id: 'situacaochamado', tipo: 'texto', opcoes: [{ valor: 'Primeiro Atendimento', rotulo: 'Primeiro Atendimento' }] },
    TIPOPOSICIONAME: { id: 'tipoposicioname', tipo: 'texto', opcoes: [{ valor: 'N', rotulo: 'N' }] },
    AGUARDANRETORNO: { id: 'aguardanretorno', tipo: 'texto', opcoes: [{ valor: 'RETORNO - ATENDENTE', rotulo: 'Atendente' }] },
    HORAINI: { id: 'horaini', tipo: 'hora' }, HORAFIM: { id: 'horafim', tipo: 'hora' }, HORAINT: { id: 'horaint', tipo: 'hora' },
    HORAINICONV: { id: 'horainiconv', tipo: 'decimal' }, HORAFIMCONV: { id: 'horafimconv', tipo: 'decimal' },
    HORAINTCONV: { id: 'horaintconv', tipo: 'decimal' }, HORATOTALNUM: { id: 'horatotalnum', tipo: 'decimal' },
  },
};
let contratoDisponivel = true;
retornoConfigReal.resolver = ({ consultor }) => (contratoDisponivel && consultor.idSoftexpert === '995'
  ? { disponivel: true, contrato: CONTRATO, transporte: { origem: 'https://se.teste', apiKey: 'x', authorizationMode: 'bearer', encoding: 'latin1' }, userId: '10677535000155' }
  : { disponivel: false, motivo: 'analista sem autorização' });

// Envio SOAP simulado sobre o cliente real (os XMLs são montados de verdade).
const soapReal = require('../backend/services/softexpert-soap-client');
const envios = [];
let comportamentoEnvio = 'ok';
soapReal.enviarOperacao = async ({ xml, operacao }) => {
  envios.push({ operacao, xml });
  const numero = /<urn:WorkflowID>([^<]+)</.exec(xml)[1];
  const c = origem.chamados.get(numero);
  if (comportamentoEnvio === 'recusa') return { Status: 'FAILURE', Code: '0', Detail: 'campo obrigatório' };
  if (operacao === 'newChildEntityRecord') c.posJade++;
  if (operacao === 'executeActivity') c.ativas = ['ATV-06'];
  if (comportamentoEnvio === 'cai_depois_de_gravar') throw Object.assign(new Error('timeout'), { resultadoIndeterminado: true });
  return { Status: 'SUCCESS', Code: '1' };
};

const chamadoRepo = require('../backend/repositories/chamado-repository');
chamadoRepo.getChamadoPorNumero = (_e, numero) => ({ id: `ch-${numero}`, numero, oidOrigem: `oid-${numero}`, titulo: 'Erro ao gerar pedido', descricao: 'Ao confirmar o pedido aparece erro.' });

const { getDB } = require('../backend/database');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const repo = require('../backend/repositories/jade-pa-repository');
const jade = require('../backend/services/jade-pa-service');

const EMPRESA = 1;
const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'se', nome: 'SE ITSM', sistemaOrigem: 'softexpert', adapter: 'softexpert-sqlserver', ativo: true });
const RESPOSTA_OK = { decisao: 'responder', motivo: 'há descrição e rotina', texto: 'Olá! Em breve seu chamado será direcionado a um atendente. Abaixo segue uma análise preliminar feita pela Jade.\n- Verifique o parâmetro.\nJade, assistente virtual' };
const DEVOLVER = { decisao: 'devolver', motivo: 'sem anexo e descrição vaga', texto: 'Olá! Para analisarmos, envie o print da tela.\nJade, assistente virtual' };

beforeEach(() => {
  getDB().prepare('DELETE FROM jade_pa_lotes').run();
  getDB().prepare('DELETE FROM jade_pa_execucoes').run();
  getDB().prepare('DELETE FROM jade_pa_config').run();
  origem.chamados = new Map();
  origem.usuarioAtivo = true;
  turnos.length = 0;
  envios.length = 0;
  respostasIA = [];
  comportamentoEnvio = 'ok';
  contratoDisponivel = true;
});

// Inicia o job e deixa a contagem vencida, para a próxima leitura do teste rodar já.
async function ligar(dados = {}) {
  await jade.salvarConfig(EMPRESA, fonte.id, { ativo: true, ...dados });
  getDB().prepare('UPDATE jade_pa_config SET proximo_ciclo_em = ?').run(new Date(0).toISOString());
  return jade.getConfig(EMPRESA, fonte.id);
}

// Executar agora não espera a leitura: aguarda o lote avulso terminar.
async function aguardarLeitura() {
  for (let i = 0; i < 200 && repo.loteEmAndamento(EMPRESA, fonte.id); i++) await new Promise(r => setTimeout(r, 10));
}
const execs = () => jade.listarExecucoes(EMPRESA);

test('configuração: padrão desligada; valida intervalo, lista e só publica com a Jade autorizada', async () => {
  const cfg = jade.getConfig(EMPRESA, fonte.id);
  assert.equal(cfg.ativo, false);
  assert.equal(cfg.modo, 'simulacao');
  assert.deepEqual(cfg.somenteChamados, []);
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { intervaloMinutos: 0 }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { intervaloMinutos: 61 }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { somenteChamados: '037100, abc' }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { modo: 'publicar' }), /usuário da Jade/);
  origem.usuarioAtivo = false;
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { modo: 'publicar', usuarioSoftexpert: '995' }), /desabilitado/);
  origem.usuarioAtivo = true;
  contratoDisponivel = false;
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { modo: 'publicar', usuarioSoftexpert: '995' }), /Escrita no SoftExpert indisponível/);
  contratoDisponivel = true;
  const salvo = await ligar({ modo: 'publicar', usuarioSoftexpert: '995', somenteChamados: '037100; 037100, 037101', intervaloMinutos: 10 });
  assert.equal(salvo.modo, 'publicar');
  assert.deepEqual(salvo.somenteChamados, ['037100', '037101']);
});

test('desligada não roda; ligada em simulação trata cada chamado uma vez e não envia nada', async () => {
  chamadoNaOrigem('037100');
  chamadoNaOrigem('037101');
  assert.equal(await jade.executarCiclo(EMPRESA, fonte.id), null);

  await ligar();
  respostasIA = [RESPOSTA_OK, RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(resumo.novos, 2);
  assert.deepEqual(execs().map(e => e.estado), ['simulado', 'simulado']);
  assert.ok(execs().every(e => e.decisao === 'responder' && e.mensagemAnaliseId));
  assert.ok(turnos.every(t => t.opts.automatico === true && t.opts.usuarioId === null));

  const segundo = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(segundo.novos, 0);
  assert.equal(turnos.length, 2);
  assert.equal(envios.length, 0);
});

test('intervalo e trava entre processos', async () => {
  await ligar();
  assert.ok(await jade.executarCiclo(EMPRESA, fonte.id));
  assert.equal(await jade.executarCiclo(EMPRESA, fonte.id), null);
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, forcar: true }), true);
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, forcar: true }), false);
  assert.throws(() => jade.executarAgora(EMPRESA, fonte.id), { status: 409 });
});

test('lotes: leitura que tratou chamado vira lote numerado; leitura vazia não é gravada', async () => {
  await ligar();
  chamadoNaOrigem('037150');
  respostasIA = [RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.ok(resumo.loteId);
  assert.equal(resumo.origem, 'agendado');
  assert.equal(resumo.loteGravado, true);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  const lote = painel.lotes.find(l => l.id === resumo.loteId);
  assert.ok(lote.fim);
  assert.equal(lote.chamados.length, 1);
  assert.equal(lote.chamados[0].execucao.numeroChamado, '037150');
  assert.equal(lote.chamados[0].situacao, 'ok');
  assert.ok(jade.getAuditoria(EMPRESA, fonte.id, lote.chamados[0].execucaoId).eventos.every(e => e.loteId === resumo.loteId));
  assert.equal(painel.loteEmAndamento, null);

  const vazio = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(vazio.origem, 'agendado');
  assert.equal(vazio.loteGravado, false);
  assert.ok(!jade.getPainel(EMPRESA, fonte.id).lotes.some(l => l.id === vazio.loteId));
});

test('limpar logs: período apaga lotes, auditoria e libera o chamado sem retorno no SoftExpert; nada é enviado ao SoftExpert', async () => {
  await ligar();
  chamadoNaOrigem('037160');
  respostasIA = [RESPOSTA_OK];
  const r1 = await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs().find(e => e.numeroChamado === '037160');
  const enviosAntes = envios.length;

  // Período que não cobre o lote: nada muda.
  const fora = jade.limparLogs(EMPRESA, fonte.id, { de: '2020-01-01T00:00:00.000Z', ate: '2020-01-02T00:00:00.000Z' });
  assert.deepEqual(fora, { lotesRemovidos: 0, registrosRemovidos: 0, chamadosLiberados: 0 });

  const hoje = new Date();
  const r = jade.limparLogs(EMPRESA, fonte.id, { de: new Date(hoje.getTime() - 3600000).toISOString(), ate: new Date(hoje.getTime() + 3600000).toISOString() });
  assert.equal(r.lotesRemovidos, 1);
  assert.ok(r.registrosRemovidos > 0);
  assert.equal(r.chamadosLiberados, 1);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  assert.ok(!painel.lotes.some(l => l.id === r1.loteId));
  assert.ok(!painel.semLote.some(e => e.id === exec.id));
  assert.equal(repo.getExecucao(exec.id), null);
  // Sem posicionamento no SoftExpert (simulação): volta a ser analisado.
  respostasIA = [RESPOSTA_OK];
  const de = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(de.novos, 1);
  assert.equal(envios.length, enviosAntes);

  assert.throws(() => jade.limparLogs(EMPRESA, fonte.id, { de: 'x', ate: 'y' }), { status: 400 });
  assert.throws(() => jade.limparLogs(EMPRESA, fonte.id, { de: '2026-02-01T00:00:00Z', ate: '2026-01-01T00:00:00Z' }), { status: 400 });
});

test('limpar logs: tudo; bloqueado durante uma leitura', async () => {
  await ligar();
  chamadoNaOrigem('037170');
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, forcar: true });
  repo.criarLote(EMPRESA, fonte.id, 'manual');
  assert.throws(() => jade.limparLogs(EMPRESA, fonte.id, { tudo: true }), { status: 409 });
  repo.liberarCiclo(EMPRESA, fonte.id, {});
  const r = jade.limparLogs(EMPRESA, fonte.id, { tudo: true });
  assert.ok(r.lotesRemovidos >= 1);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.lotes.length, 0);
  assert.equal(painel.semLote.length, 0);
  assert.ok(!execs().some(e => e.numeroChamado === '037170'));
});

test('limpar tudo apaga tudo (inclusive "devolvendo"); chamado com retorno da Jade no SoftExpert não volta', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037190');
  chamadoNaOrigem('037191');
  respostasIA = [RESPOSTA_OK, RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const devolvendo = execs().find(e => e.numeroChamado === '037191');
  repo.atualizar(devolvendo.id, { estado: 'devolvendo' });
  const enviosAntes = envios.length;
  const r = jade.limparLogs(EMPRESA, fonte.id, { tudo: true });
  assert.equal(r.chamadosLiberados, 2);
  assert.equal(execs().length, 0);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.lotes.length + painel.semLote.length, 0);
  // Os dois já têm o posicionamento da Jade na grade: não são elegíveis, não voltam.
  const depois = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(depois.novos, 0);
  assert.equal(execs().length, 0);
  assert.ok(envios.length >= enviosAntes);
});

test('contador: iniciar o job conta o intervalo inteiro; após a leitura agenda +intervalo; mudar o intervalo recomeça', async () => {
  const iniciada = await jade.salvarConfig(EMPRESA, fonte.id, { ativo: true, intervaloMinutos: 5 });
  assert.ok(Math.abs(Date.parse(iniciada.proximoCicloEm) - (Date.now() + 5 * 60000)) < 2000);
  assert.equal(await jade.executarCiclo(EMPRESA, fonte.id), null);
  getDB().prepare('UPDATE jade_pa_config SET proximo_ciclo_em = ?').run(new Date(0).toISOString());
  const antes = Date.now();
  await jade.executarCiclo(EMPRESA, fonte.id);
  const depois = jade.getConfig(EMPRESA, fonte.id);
  assert.ok(Date.parse(depois.proximoCicloEm) >= antes + 5 * 60000 - 1000);
  assert.equal(await jade.executarCiclo(EMPRESA, fonte.id), null);
  const mudou = await jade.salvarConfig(EMPRESA, fonte.id, { intervaloMinutos: 10 });
  const esperado = Date.now() + 10 * 60000;
  assert.ok(Math.abs(Date.parse(mudou.proximoCicloEm) - esperado) < 2000);
  const igual = await jade.salvarConfig(EMPRESA, fonte.id, { limiteDiario: 50 });
  assert.equal(igual.proximoCicloEm, mudou.proximoCicloEm);
});

test('Executar agora: leitura única mesmo com o job parado; lote sempre gravado; não mexe na contagem', async () => {
  await jade.salvarConfig(EMPRESA, fonte.id, { ativo: false });
  chamadoNaOrigem('037180');
  respostasIA = [RESPOSTA_OK];
  const r = jade.executarAgora(EMPRESA, fonte.id);
  assert.equal(r.iniciado, true);
  assert.ok(r.loteId);
  assert.throws(() => jade.executarAgora(EMPRESA, fonte.id), { status: 409 });
  await aguardarLeitura();
  assert.equal(execs().find(e => e.numeroChamado === '037180').estado, 'simulado');
  const cfg = jade.getConfig(EMPRESA, fonte.id);
  assert.equal(cfg.ativo, false);
  assert.equal(cfg.ultimoCicloResumo.origem, 'manual');

  // Nada novo: o lote do botão fica gravado mesmo vazio; a contagem do job não muda.
  await ligar();
  const marcado = new Date(Date.now() + 3 * 60000).toISOString();
  getDB().prepare('UPDATE jade_pa_config SET proximo_ciclo_em = ?').run(marcado);
  const vazio = jade.executarAgora(EMPRESA, fonte.id);
  await aguardarLeitura();
  const lote = jade.getPainel(EMPRESA, fonte.id).lotes.find(l => l.id === vazio.loteId);
  assert.ok(lote);
  assert.equal(lote.origem, 'manual');
  assert.equal(lote.chamados.length, 0);
  assert.equal(jade.getConfig(EMPRESA, fonte.id).proximoCicloEm, marcado);
});

test('limite diário', async () => {
  await ligar({ limiteDiario: 1 });
  chamadoNaOrigem('037200');
  chamadoNaOrigem('037201');
  respostasIA = [RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(resumo.novos, 1);
  assert.equal(resumo.limiteAtingido, true);
});

test('uma leitura trata todos os chamados da fila, no máximo N ao mesmo tempo', async () => {
  await ligar({ processamentosSimultaneos: 2, limiteDiario: 0 });
  const numeros = ['037220', '037221', '037222', '037223', '037224'];
  numeros.forEach(n => chamadoNaOrigem(n));
  respostasIA = numeros.map(() => RESPOSTA_OK);
  simultaneos.maximo = 0;
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(resumo.processados.length, 5);
  assert.equal(simultaneos.maximo, 2);
  assert.equal(typeof resumo.duracaoMs, 'number');
  assert.equal(resumo.encavalou, false);
  assert.throws(() => repo.salvarConfig(EMPRESA, fonte.id, { processamentosSimultaneos: 11 }));
});

test('limite diário 0 = sem limite; acima de 1.000.000 é recusado', async () => {
  await ligar({ limiteDiario: 0 });
  chamadoNaOrigem('037210');
  chamadoNaOrigem('037211');
  respostasIA = [RESPOSTA_OK, RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(resumo.novos, 2);
  assert.ok(!resumo.limiteAtingido);
  assert.equal(repo.salvarConfig(EMPRESA, fonte.id, { limiteDiario: 1000000 }).limiteDiario, 1000000);
  assert.throws(() => repo.salvarConfig(EMPRESA, fonte.id, { limiteDiario: 1000001 }));
});

test('lista de chamados permitidos: só o chamado de teste é tratado e enviado', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', somenteChamados: '037250' });
  chamadoNaOrigem('037250');
  chamadoNaOrigem('037251');
  respostasIA = [RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(resumo.elegiveis, 1);
  assert.deepEqual(execs().map(e => e.numeroChamado), ['037250']);
  assert.ok(envios.every(e => e.xml.includes('<urn:WorkflowID>037250<')));
  assert.equal(origem.chamados.get('037251').posJade, 0);
});

test('triagem atuou antes da Jade: descartado sem análise', async () => {
  await ligar();
  chamadoNaOrigem('037300');
  repo.registrarDetectado(EMPRESA, fonte.id, '037300');
  origem.chamados.get('037300').comResp = true;
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'descartado');
  assert.equal(turnos.length, 0);
});

test('devolução desligada vira resposta; ligada mantém devolver', async () => {
  await ligar({ devolucaoAtiva: false });
  chamadoNaOrigem('037400');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].decisao, 'responder');
  assert.match(execs()[0].motivo, /devolução desligada/);

  getDB().prepare('DELETE FROM jade_pa_execucoes').run();
  await ligar({ devolucaoAtiva: true });
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].decisao, 'devolver');
});

test('texto que cita outro chamado é reescrito; se insistir, não é aceito; aspas tipográficas são normalizadas', async () => {
  assert.deepEqual(jade.verificarVazamento('Veja o chamado 036999.', '037500'), ['cita o chamado 036999']);
  assert.deepEqual(jade.verificarVazamento('Seu chamado 037500 está em análise.', '037500'), []);
  assert.equal(jade.normalizarTextoSoftExpert('A “mensagem” – ok… • item ✅'), 'A "mensagem" - ok... - item');
  assert.equal(jade.normalizarTextoSoftExpert('## ANÁLISE\n**Causa** e `MV_X`\n\n\n\n* item'), 'ANÁLISE\nCausa e MV_X\n\n- item');

  await ligar();
  chamadoNaOrigem('037500');
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Igual ao chamado 036999.' }, RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].estado, 'simulado');

  getDB().prepare('DELETE FROM jade_pa_execucoes').run();
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Igual ao chamado 036999.' }, { ...RESPOSTA_OK, texto: 'Veja o 036998.' }];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'detectado');
  assert.match(execs()[0].ultimoErro, /cita o chamado/);
});

test('3 falhas de geração: falha com alerta e não volta a ser processado', async () => {
  await ligar();
  chamadoNaOrigem('037600');
  for (let i = 0; i < 4; i++) {
    respostasIA = ['sem json', 'sem json'];
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  }
  const exec = execs()[0];
  assert.equal(exec.estado, 'falha');
  assert.equal(exec.alerta, true);
  assert.equal(exec.tentativasGeracao, 3);
});

test('publicar: grava na grade como Jade, com a marca IA SERVICE, zero horas e os valores combinados', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037700');
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Olá “cliente”.\nJade, assistente virtual' }];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'publicado');
  assert.ok(exec.publicadoEm);
  assert.equal(envios.length, 1);
  const { xml } = envios[0];
  for (const [id, valor] of [['texto4', 'IA SERVICE'], ['cduserana', '995'], ['analistaj2a', 'Jade'], ['situacaochamado', 'Primeiro Atendimento'],
    ['tipoposicioname', 'N'], ['aguardanretorno', 'RETORNO - ATENDENTE'], ['horatotalnum', '0'], ['horaintconv', '0']]) {
    assert.ok(xml.includes(`<urn:EntityAttributeID>${id}</urn:EntityAttributeID><urn:EntityAttributeValue>${valor}</urn:EntityAttributeValue>`), `${id}=${valor}`);
  }
  assert.match(xml, /<urn:EntityAttributeID>horaini<\/urn:EntityAttributeID><urn:EntityAttributeValue>\d\d:(00|30)</);
  assert.ok(xml.includes('Olá &quot;cliente&quot;.'));
  assert.ok(!xml.includes('motivoapontamen'));
  const situacao = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'situacao');
  assert.equal(situacao.situacao, 'ok');
  assert.match(situacao.resumo, /segue em ATV-02 Primeiro Atendimento, aguardando a triagem/);
});

test('envio não confirmado que entrou no SoftExpert: o próximo ciclo reconhece e nunca duplica', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037800');
  respostasIA = [RESPOSTA_OK];
  comportamentoEnvio = 'cai_depois_de_gravar';
  await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].estado, 'publicando');
  comportamentoEnvio = 'ok';
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'publicado');
  assert.equal(envios.length, 1);
  assert.equal(origem.chamados.get('037800').posJade, 1);
});

test('SoftExpert recusando 3 vezes: falha com alerta, sem quarta tentativa', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037900');
  respostasIA = [RESPOSTA_OK];
  comportamentoEnvio = 'recusa';
  for (let i = 0; i < 5; i++) await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  const exec = execs()[0];
  assert.equal(exec.estado, 'falha');
  assert.equal(exec.alerta, true);
  assert.equal(exec.tentativasPublicacao, 3);
  assert.equal(envios.length, 3);
});

test('triagem atua entre a geração e o envio: nada é gravado', async () => {
  await ligar({ modo: 'simulacao' });
  chamadoNaOrigem('038000');
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  repo.atualizar(execs()[0].id, { estado: 'pronto' });
  origem.chamados.get('038000').posOutros = 1;
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'descartado');
  assert.equal(envios.length, 0);
});

test('devolver: grava o pedido, executa só ATV-02 ação 1 com a matrícula da Jade e confirma a chegada na ATV-06', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038100');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'devolvido');
  assert.ok(exec.devolvidoEm);
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'executeActivity']);
  const mov = envios[1].xml;
  assert.match(mov, /<urn:ActivityID>ATV-02<\/urn:ActivityID><urn:ActionSequence>1<\/urn:ActionSequence><urn:UserID>10677535000155<\/urn:UserID>/);
});

test('auditoria: fluxo completo registra cada etapa e o que foi gravado, sem token', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038150');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  const { execucao, eventos } = jade.getAuditoria(EMPRESA, fonte.id, exec.id);
  assert.equal(execucao.numeroChamado, '038150');
  for (const etapa of ['deteccao', 'importacao', 'anexos', 'analise', 'retorno', 'envio', 'devolucao', 'situacao']) {
    assert.ok(eventos.some(e => e.etapa === etapa && e.situacao === 'ok'), `etapa ${etapa} concluída`);
  }
  const envio = eventos.find(e => e.etapa === 'envio' && e.situacao === 'ok');
  assert.equal(envio.detalhes.campos.texto4, 'IA SERVICE');
  assert.equal(envio.detalhes.resposta.Status, 'SUCCESS');
  assert.ok(eventos.find(e => e.etapa === 'retorno').detalhes.texto);
  assert.match(eventos.find(e => e.etapa === 'devolucao' && e.situacao === 'ok').detalhes.acao, /Retornar para cliente/);
  const situacao = eventos.find(e => e.etapa === 'situacao');
  assert.match(situacao.resumo, /Avançou no SoftExpert: chamado em ATV-06 Retorno do Usuário/);
  assert.match(situacao.detalhes.posicionamentoJade, /encontrado na grade/);
  assert.ok(!JSON.stringify(eventos).match(/token|Bearer|soapenv/i));
  assert.throws(() => jade.getAuditoria(EMPRESA + 1, fonte.id, exec.id));
});

test('auditoria: recusa do SoftExpert e falha da IA ficam como erro na etapa certa', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('038160');
  respostasIA = [RESPOSTA_OK];
  comportamentoEnvio = 'recusa';
  await jade.executarCiclo(EMPRESA, fonte.id);
  chamadoNaOrigem('038161');
  respostasIA = [];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  const porNumero = Object.fromEntries(execs().map(e => [e.numeroChamado, e]));
  const recusado = jade.getAuditoria(EMPRESA, fonte.id, porNumero['038160'].id).eventos.find(e => e.etapa === 'envio');
  assert.equal(recusado.situacao, 'erro');
  assert.match(recusado.resumo, /Tentativa 1\/3: o SoftExpert recusou/);
  assert.ok(recusado.detalhes.campos);
  assert.equal(recusado.detalhes.erroTecnico.operacao, 'newChildEntityRecord');
  const semIa = jade.getAuditoria(EMPRESA, fonte.id, porNumero['038161'].id).eventos.find(e => e.etapa === 'retorno');
  assert.equal(semIa.situacao, 'erro');
  assert.match(semIa.resumo, /IA sem resposta programada/);
  assert.equal(semIa.detalhes.erroTecnico.mensagem, 'IA sem resposta programada');
  assert.equal(semIa.detalhes.erroTecnico.etapa, 'retorno');
  assert.ok(semIa.detalhes.erroTecnico.pilha);
});

test('devolver: triagem atuou depois do posicionamento → devolução cancelada', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038200');
  respostasIA = [DEVOLVER];
  comportamentoEnvio = 'ok';
  // Posicionamento entra, mas a triagem assume antes da movimentação.
  const original = soapReal.enviarOperacao;
  soapReal.enviarOperacao = async (args) => {
    const r = await original(args);
    if (args.operacao === 'newChildEntityRecord') origem.chamados.get('038200').comResp = true;
    return r;
  };
  try {
    await jade.executarCiclo(EMPRESA, fonte.id);
  } finally {
    soapReal.enviarOperacao = original;
  }
  const exec = execs()[0];
  assert.equal(exec.estado, 'publicado');
  assert.match(exec.motivo, /devolução cancelada/);
  assert.ok(!envios.some(e => e.operacao === 'executeActivity'));
});

test('texto ao cliente: link só da pesquisa; texto escrito para o analista é recusado', () => {
  const lido = 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/123-Artigo';
  assert.deepEqual(jade.verificarVazamento(`Confira o artigo:\n${lido}.`, '037059', [], [lido]), []);
  assert.match(jade.verificarVazamento('Veja https://tdn.totvs.com/pages/inventado', '037059', [], [lido])[0], /link que não veio da pesquisa/);
  assert.match(jade.verificarVazamento('Veja https://tdn.totvs.com/x', '037059')[0], /link que não veio da pesquisa/);
  for (const t of ['Para avançar, peça ao cliente 3 títulos.', 'Você tem alguém do lado do cliente?', 'O cliente informou que o erro começou ontem.']) {
    assert.match(jade.verificarVazamento(t, '037059')[0], /terceira pessoa/, t);
  }
  assert.deepEqual(jade.verificarVazamento('Nos envie 3 títulos e verifique a rotina MATA110.', '037059'), []);
});

test('nome de outro cliente no texto é recusado; palavra comum e o próprio cliente não', () => {
  const clienteRepo = require('../backend/repositories/cliente-repository');
  const { cliente: proprio } = clienteRepo.upsertCliente(EMPRESA, { cnpj: '11111111000111', nome: 'COOPERGRÃOS' });
  clienteRepo.upsertCliente(EMPRESA, { cnpj: '22222222000122', nome: 'BIPAR (BIMETAL)' });
  clienteRepo.upsertCliente(EMPRESA, { cnpj: '33333333000133', nome: 'SETA' });
  clienteRepo.upsertCliente(EMPRESA, { cnpj: '44444444000144', nome: 'Well Tech Empilhadeiras LTDA' });
  const outros = jade.nomesDeOutrosClientes(EMPRESA, proprio.id);
  assert.ok(outros.includes('bipar') && outros.includes('bimetal') && outros.includes('well tech empilhadeiras'));
  assert.ok(!outros.includes('seta') && !outros.includes('coopergraos'));
  assert.deepEqual(jade.verificarVazamento('Clique na seta e confirme. Na Coopergrãos isso ocorre.', '037000', outros), []);
  assert.deepEqual(jade.verificarVazamento('O mesmo ocorreu na Bimetal.', '037000', outros), ['cita outro cliente (bimetal)']);
});

test('texto "pronto" há mais de 4 horas não é enviado', async () => {
  await ligar({ modo: 'simulacao' });
  chamadoNaOrigem('038400');
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  getDB().prepare("UPDATE jade_pa_execucoes SET estado = 'pronto', gerado_em = ? WHERE numero_chamado = '038400'")
    .run(new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString());
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'descartado');
  assert.match(execs()[0].motivo, /mais de 4 horas/);
  assert.equal(envios.length, 0);
});

test('chat em uso pelo consultor adia sem gastar tentativa', async () => {
  const turnoLock = require('../backend/services/turno-lock-service');
  await ligar();
  chamadoNaOrigem('038500');
  turnoLock.tentarAdquirir(EMPRESA, 'at-ch-038500');
  try {
    await jade.executarCiclo(EMPRESA, fonte.id);
  } finally {
    turnoLock.liberar(EMPRESA, 'at-ch-038500');
  }
  const exec = execs()[0];
  assert.equal(exec.estado, 'detectado');
  assert.equal(exec.tentativasGeracao, 0);
  assert.match(exec.ultimoErro, /em uso/);
});

test('reserva de envio é atômica: registro lido desatualizado não envia', () => {
  repo.registrarDetectado(EMPRESA, fonte.id, '038600');
  const exec = execs()[0];
  repo.atualizar(exec.id, { estado: 'pronto' });
  // Leitura anterior à mudança de estado não reserva.
  assert.equal(repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: 'detectado', tentativasAnteriores: 0 }), null);
  // Dois processos com a mesma leitura: só o primeiro reserva (inclusive em "publicando" → "publicando").
  assert.ok(repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: 'pronto', tentativasAnteriores: 0 }));
  assert.equal(repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: 'pronto', tentativasAnteriores: 0 }), null);
  assert.ok(repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: 'publicando', tentativasAnteriores: 1 }));
  assert.equal(repo.contarTentativa(exec.id, 'publicacao', 'publicando', { estadoAnterior: 'publicando', tentativasAnteriores: 1 }), null);
});

test('transporte: só a movimentação ATV-02 / ação 1 passa pela validação', async () => {
  const ok = soapReal.montarDevolucaoPrimeiroAtendimento({ workflowId: '038300', userId: '1' });
  const outra = ok.replace('<urn:ActivityID>ATV-02</urn:ActivityID>', '<urn:ActivityID>ATV-03</urn:ActivityID>');
  const outraAcao = ok.replace('<urn:ActionSequence>1</urn:ActionSequence>', '<urn:ActionSequence>3</urn:ActionSequence>');
  // enviarOperacao real valida o envelope antes de qualquer rede.
  for (const xml of [outra, outraAcao]) {
    await assert.rejects(enviarReal({ xml }), /Movimentação de workflow não permitida/);
  }
  // O envelope permitido passa da validação e só falha no transporte (host inexistente).
  await assert.rejects(enviarReal({ xml: ok }), (err) => !/Movimentação/.test(err.message));
});

// Cliente SOAP recarregado sem o stub de envio, para validar o envelope real.
function enviarReal({ xml }) {
  const p = require.resolve('../backend/services/softexpert-soap-client');
  const cache = require.cache[p];
  delete require.cache[p];
  const novo = require('../backend/services/softexpert-soap-client');
  require.cache[p] = cache;
  return novo.enviarOperacao({ origem: 'https://se.teste', apiKey: 'x', authorizationMode: 'bearer', encoding: 'utf8', xml, operacao: 'executeActivity', timeoutMs: 1 });
}

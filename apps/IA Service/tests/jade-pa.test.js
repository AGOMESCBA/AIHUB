// node --test "apps/IA Service/tests/jade-pa.test.js"
// Jaade no Primeiro Atendimento.
// Fase 1 (simulação): uma ação por chamado, trava entre processos, intervalo e
// limite diário, descarte quando a triagem chega antes, devolução desligada
// vira resposta, texto que cita outro chamado é recusado, 3 falhas = alerta.
// Fases 2/3 (publicar): grava na grade com o status da decisão no TEXTO4,
// nunca duplica (envio não confirmado é conferido antes de reenviar), abre o
// workflow da Jaade (ITSM-02-I.A-P.A) com o mesmo registro e executa a ATV-01
// — o SoftExpert segue pelo TEXTO4 — sem nunca abrir dois, e respeita a lista
// de chamados permitidos.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-jade-pa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);
// Banco do serviço de jobs também temporário: nunca o apps/IAHUB/data/jobs.db real.
const jobsDb = require('../../../modules/jobs/database');
jobsDb.inicializarDB(path.join(os.tmpdir(), `iahub-jobs-jade-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
const jobsRepo = require('../../../modules/jobs/repositorio');

function stub(relativo, exports) {
  const p = require.resolve(relativo);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// SoftExpert simulado: situação de cada chamado e usuário da Jaade.
const origem = { chamados: new Map(), workflows: new Map(), usuarioAtivo: true, segurarEmpresa: null };
function chamadoNaOrigem(numero, dados = {}) {
  origem.chamados.set(numero, { aberto: true, comResp: false, posJade: 0, posOutros: 0, ativas: [ETAPA_JADE], ...dados });
}
// Etapa em que o chamado espera a Jaade (ITSM-02 ajustado em 2026-11-24; antes era a ATV-02).
const ETAPA_JADE = 'Aguardar Retorno JAADE';
function elegivel(c, etapa) {
  return c.aberto && c.ativas.includes(etapa) && !c.comResp && c.posJade + c.posOutros === 0;
}
stub('../backend/services/agente-local-service', {
  async executarSelectNaFonte(_empresaId, _fonteId, { sql, params }) {
    // SoftExpert lento para uma empresa: segura a leitura dela até soltar.
    if (origem.segurarEmpresa?.empresaId === _empresaId) await origem.segurarEmpresa.promessa;
    if (sql.includes('FROM ADUSER')) {
      return params.cdUser === '995' ? [{ CDUSER: 995, NMUSER: 'Jaade', IDUSER: '10677535000155', FGUSERENABLED: origem.usuarioAtivo ? 1 : 0 }] : [];
    }
    // Workflow da Jaade (ITSM-02-I.A-P.A) já aberto para o chamado, pelo título.
    if (sql.includes('PMACTIVITY')) {
      assert.equal(params.processo, 'ITSM-02-I.A-P.A');
      const w = [...origem.workflows.values()].find(x => x.titulo === params.titulo);
      return w ? [{ IDPROCESS: w.id, ATV01_ATIVA: w.statusAtividade !== undefined ? Number(w.statusAtividade === 2) : Number(w.atv01Ativa), ATV01_EXECUTADA: w.statusAtividade !== undefined ? Number(w.statusAtividade === 3) : Number(!w.atv01Ativa) }] : [];
    }
    if (sql.includes('LEFT JOIN WFSTRUCT')) {
      const c = origem.chamados.get(params.numero);
      if (!c) return [];
      const base = { PROC_STATUS: c.aberto ? 1 : 2, COM_RESP: c.comResp ? 1 : 0, POS_JADE: c.posJade, POS_OUTROS: c.posOutros,
        CAB_EMPRESA: 'APROSOJA', CAB_COLABORADOR: 'kelvyn.ramos@aprosoja.com.br', CAB_ASSUNTO: 'API de solicitacao de compras',
        CAB_EMAIL: 'kelvyn.ramos@aprosoja.com.br', CAB_EMAIL_COPIA: 'emailCopia' in c ? c.emailCopia : 'ti@aprosoja.com.br; compras@aprosoja.com.br' };
      return (c.ativas.length ? c.ativas : [null]).map(a => ({ ...base, ATIVA: a }));
    }
    // A etapa vem da própria consulta: o teste comprova o que é lido no SoftExpert.
    const etapa = (sql.match(/S.IDSTRUCT = '([^']+)'/) || [])[1];
    const lista = [...origem.chamados].filter(([, c]) => elegivel(c, etapa)).map(([n]) => n);
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
const chamadasIA = [];
// Conferência independente do status: por padrão concorda com a última decisão
// escrita; `conferenciaStatus` força uma leitura (ex.: 'orientacao' sempre).
let conferenciaStatus = null;
let ultimaDecisao = null;
const conferencias = [];
stub('../backend/services/ai-provider-client', {
  async chamarIA(...args) {
    if (String(args[2]).startsWith('Você confere o tipo')) {
      conferencias.push(args[3]);
      const tipo = conferenciaStatus || (ultimaDecisao === 'devolver' ? 'pedido_evidencias' : 'orientacao');
      return { texto: JSON.stringify({ tipo, motivo: 'leitura do teste' }), provider: 'teste', model: 'conferencia' };
    }
    chamadasIA.push(args);
    const r = respostasIA.length ? respostasIA.shift() : null;
    if (!r) throw new Error('IA sem resposta programada');
    if (typeof r === 'object') ultimaDecisao = r.decisao;
    return { texto: typeof r === 'string' ? r : JSON.stringify(r), provider: 'teste', model: 'teste' };
  },
});

// Contrato de escrita com a Jaade (995) autorizada; mapearCampos é o real.
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
// Workflow da Jaade: a abertura cria a instância (WFJ-<chamado>); a ATV-01
// executada faz o SoftExpert mover o chamado original pelo TEXTO4
// (IA-RESPONDIDO → atendimento ATV-03; IA-INFORMACAO → cliente ATV-06).
soapReal.enviarOperacao = async ({ xml, operacao }) => {
  envios.push({ operacao, xml });
  if (comportamentoEnvio === 'recusa') return { Status: 'FAILURE', Code: '0', Detail: 'campo obrigatório' };
  let recordId;
  if (operacao === 'newWorkflowEditData') {
    const titulo = /<urn:WorkflowTitle>([^<]+)</.exec(xml)[1];
    const numero = /PA do chamado (\d+)/.exec(titulo)[1];
    const status = /<urn:EntityAttributeID>texto4<\/urn:EntityAttributeID><urn:EntityAttributeValue>([^<]+)</.exec(xml)[1];
    recordId = `WFJ-${numero}`;
    origem.workflows.set(recordId, { id: recordId, titulo, numero, status, atv01Ativa: true });
  } else {
    const workflowId = /<urn:WorkflowID>([^<]+)</.exec(xml)[1];
    if (operacao === 'newChildEntityRecord') origem.chamados.get(workflowId).posJade++;
    if (operacao === 'executeActivity') {
      const w = origem.workflows.get(workflowId);
      w.atv01Ativa = false;
      origem.chamados.get(w.numero).ativas = [w.status === 'IA-INFORMACAO' ? 'ATV-06' : 'ATV-03'];
    }
  }
  if (comportamentoEnvio === 'cai_depois_de_gravar') throw Object.assign(new Error('timeout'), { resultadoIndeterminado: true });
  return { Status: 'SUCCESS', Code: '1', ...(recordId ? { RecordID: recordId } : {}) };
};

// IA Command simulado: cada aviso por WhatsApp que a Jaade mandaria aos grupos.
process.env.SVC_WHATSAPP_OTP_SECRET = 'segredo-teste';
process.env.IA_COMMAND_INTERNAL_URL = 'http://iacommand.teste';
const whats = [];
let falharWhats = null;
const monitor = [];
global.fetch = async (url, opts = {}) => {
  const corpo = opts.body ? JSON.parse(opts.body) : null;
  // Registro no monitor do canal (passos que não enviam): fica separado dos envios.
  if (url.endsWith('/registrar-servico-externo')) {
    monitor.push(corpo);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  whats.push({ url, corpo, segredo: opts.headers?.['x-servico-externo-secret'] });
  if (falharWhats) return { ok: false, status: 500, json: async () => ({ error: falharWhats }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, total: 2, enviados: 2, falhas: [] }) };
};

const chamadoRepo = require('../backend/repositories/chamado-repository');
chamadoRepo.getChamadoPorNumero = (empresa, numero) => ({ id: `ch-${numero}`, numero, fonteId: getDB().prepare('SELECT id FROM fontes_historicas WHERE empresa_id = ? LIMIT 1').get(empresa)?.id, oidOrigem: `oid-${numero}`, titulo: 'Erro ao gerar pedido', descricao: 'Ao confirmar o pedido aparece erro.' });

const { getDB } = require('../backend/database');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const repo = require('../backend/repositories/jade-pa-repository');
const jade = require('../backend/services/jade-pa-service');
const aviso = require('../backend/services/jade-pa-aviso-service');

const EMPRESA = 1;
const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'se', nome: 'SE ITSM', sistemaOrigem: 'softexpert', adapter: 'softexpert-sqlserver', ativo: true });
const RESPOSTA_OK = { decisao: 'responder', motivo: 'há descrição e rotina', texto: 'Olá! Em breve seu chamado será direcionado a um atendente. Abaixo segue uma análise preliminar feita pela Jaade.\n- Verifique o parâmetro.\nJade, assistente virtual' };
const DEVOLVER = { decisao: 'devolver', motivo: 'sem anexo e descrição vaga', texto: 'Olá! Para analisarmos, envie o print da tela.\nJade, assistente virtual' };

beforeEach(() => {
  getDB().prepare('DELETE FROM jade_pa_lotes').run();
  getDB().prepare('DELETE FROM jade_pa_execucoes').run();
  getDB().prepare('DELETE FROM jade_pa_config').run();
  origem.chamados = new Map();
  origem.workflows = new Map();
  origem.usuarioAtivo = true;
  origem.segurarEmpresa = null;
  turnos.length = 0;
  envios.length = 0;
  respostasIA = [];
  chamadasIA.length = 0;
  conferencias.length = 0;
  conferenciaStatus = null;
  ultimaDecisao = null;
  comportamentoEnvio = 'ok';
  contratoDisponivel = true;
  whats.length = 0;
  monitor.length = 0;
  falharWhats = null;
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

test('configuração: padrão desligada; valida intervalo, lista e só publica com a Jaade autorizada', async () => {
  const cfg = jade.getConfig(EMPRESA, fonte.id);
  assert.equal(cfg.ativo, false);
  assert.equal(cfg.modo, 'simulacao');
  assert.deepEqual(cfg.somenteChamados, []);
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { intervaloMinutos: 0 }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { intervaloMinutos: 61 }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { somenteChamados: '037100, abc' }), { status: 400 });
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { modo: 'publicar' }), /usuário da Jaade/);
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
  assert.ok(turnos.every(t => t.opts.escopoPrimeiroAtendimento === true && t.opts.chamadoIdPa && t.atendimentoId === `at-${t.opts.chamadoIdPa}`));

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

test('agendamento multiempresa: empresa lenta não segura as outras e não é disparada de novo', async () => {
  const EMPRESA2 = 2;
  const fonte2 = agenteRepo.criarFonte(EMPRESA2, { connectionKey: 'se2', nome: 'SE ITSM 2', sistemaOrigem: 'softexpert', adapter: 'softexpert-sqlserver', ativo: true });
  await ligar();
  await jade.salvarConfig(EMPRESA2, fonte2.id, { ativo: true });
  getDB().prepare('UPDATE jade_pa_config SET proximo_ciclo_em = ?').run(new Date(0).toISOString());
  let soltar;
  origem.segurarEmpresa = { empresaId: EMPRESA, promessa: new Promise(r => { soltar = r; }) };

  const disparados = jade._test.tick();
  assert.equal(disparados.length, 2);
  for (let i = 0; i < 100 && !jade.getConfig(EMPRESA2, fonte2.id).ultimoCicloEm; i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(jade.getConfig(EMPRESA2, fonte2.id).ultimoCicloEm, 'empresa 2 terminou com a empresa 1 presa');
  assert.equal(jade.getConfig(EMPRESA, fonte.id).ultimoCicloEm, null);
  // Próxima volta do relógio: só a empresa 2 é conferida, e ela não roda antes do horário.
  const fim2 = jade.getConfig(EMPRESA2, fonte2.id).ultimoCicloEm;
  const segunda = jade._test.tick();
  assert.equal(segunda.length, 1, 'empresa 1 em andamento não é disparada de novo');
  await Promise.all(segunda);
  assert.equal(jade.getConfig(EMPRESA2, fonte2.id).ultimoCicloEm, fim2);

  soltar();
  await Promise.all(disparados);
  assert.ok(jade.getConfig(EMPRESA, fonte.id).ultimoCicloEm);
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

test('contador do dia: toda leitura conta, a sem chamados também (mesmo sem lote gravado)', async () => {
  await ligar();
  const antes = jade.getConfig(EMPRESA, fonte.id).leiturasHoje;
  chamadoNaOrigem('037155');
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  origem.chamados.delete('037155');
  const vazio = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(vazio.elegiveis, 0);
  assert.equal(vazio.loteGravado, false);
  const cfg = jade.getConfig(EMPRESA, fonte.id);
  assert.equal(cfg.leiturasHoje.total, antes.total + 2);
  assert.equal(cfg.leiturasHoje.semChamados, antes.semChamados + 1);
  assert.ok(cfg.leiturasAcumuladas.desde);
  assert.ok(cfg.leiturasAcumuladas.total >= 2);

  // Limpar logs (mesmo por período que não cobre nada) recomeça os dois contadores.
  jade.limparLogs(EMPRESA, fonte.id, { de: '2020-01-01T00:00:00.000Z', ate: '2020-01-02T00:00:00.000Z' });
  const limpo = jade.getConfig(EMPRESA, fonte.id);
  assert.deepEqual(limpo.leiturasHoje, { total: 0, semChamados: 0 });
  assert.equal(limpo.leiturasAcumuladas.total, 0);
  assert.equal(limpo.leiturasAcumuladas.semChamados, 0);
  assert.ok(Date.parse(limpo.leiturasAcumuladas.desde) > Date.parse(cfg.leiturasAcumuladas.desde));

  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.deepEqual(jade.getConfig(EMPRESA, fonte.id).leiturasHoje, { total: 1, semChamados: 1 });
  assert.equal(jade.getConfig(EMPRESA, fonte.id).leiturasAcumuladas.total, 1);
});

test('limpar logs: período apaga lotes, auditoria e libera o chamado sem retorno no SoftExpert; nada é enviado ao SoftExpert', async () => {
  await ligar();
  chamadoNaOrigem('037160');
  respostasIA = [RESPOSTA_OK];
  const r1 = await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs().find(e => e.numeroChamado === '037160');
  const enviosAntes = envios.length;

  // Período que não cobre o lote: nada muda (nem os contadores da última leitura).
  const fora = jade.limparLogs(EMPRESA, fonte.id, { de: '2020-01-01T00:00:00.000Z', ate: '2020-01-02T00:00:00.000Z' });
  assert.deepEqual(fora, { lotesRemovidos: 0, registrosRemovidos: 0, chamadosLiberados: 0 });
  assert.ok(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo);

  const hoje = new Date();
  const r = jade.limparLogs(EMPRESA, fonte.id, { de: new Date(hoje.getTime() - 3600000).toISOString(), ate: new Date(hoje.getTime() + 3600000).toISOString() });
  assert.equal(r.lotesRemovidos, 1);
  // Contadores da "Última leitura" saem junto; a data fica para o relógio do job.
  assert.equal(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo, null);
  assert.ok(jade.getConfig(EMPRESA, fonte.id).ultimoCicloEm);
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
  assert.equal(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo, null);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.lotes.length, 0);
  assert.equal(painel.semLote.length, 0);
  assert.ok(!execs().some(e => e.numeroChamado === '037170'));
});

test('limpar tudo apaga tudo (inclusive "devolvendo"); chamado com retorno da Jaade no SoftExpert não volta', async () => {
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
  // Os dois já têm o posicionamento da Jaade na grade: não são elegíveis, não voltam.
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
  assert.ok(envios.every(e => e.xml.includes('037250')));
  assert.equal(origem.chamados.get('037251').posJade, 0);
});

test('só lê chamados em "Aguardar Retorno JAADE" (ATV-02 não entra mais)', async () => {
  await ligar();
  chamadoNaOrigem('037310');
  chamadoNaOrigem('037311', { ativas: ['ATV-02'] });
  respostasIA = [RESPOSTA_OK];
  const resumo = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(resumo.elegiveis, 1);
  assert.deepEqual(execs().map(e => e.numeroChamado), ['037310']);
});

test('chamado que saiu de "Aguardar Retorno JAADE" antes da análise é descartado', async () => {
  await ligar();
  chamadoNaOrigem('037312');
  repo.registrarDetectado(EMPRESA, fonte.id, '037312');
  origem.chamados.get('037312').ativas = ['ATV-02'];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'descartado');
  assert.equal(turnos.length, 0);
});

test('triagem atuou antes da Jaade: descartado sem análise', async () => {
  await ligar();
  chamadoNaOrigem('037300');
  repo.registrarDetectado(EMPRESA, fonte.id, '037300');
  origem.chamados.get('037300').comResp = true;
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'descartado');
  assert.equal(turnos.length, 0);
});

test('pedido de informação desligado vai como IA-RESPONDIDO; ligado mantém devolver', async () => {
  await ligar({ devolucaoAtiva: false });
  chamadoNaOrigem('037400');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].decisao, 'responder');
  assert.match(execs()[0].motivo, /pedido de informação desligado: vai como IA-RESPONDIDO/);

  getDB().prepare('DELETE FROM jade_pa_execucoes').run();
  await ligar({ devolucaoAtiva: true });
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].decisao, 'devolver');
});

test('orientação e pedido de evidências preservam a decisão da IA e o contexto de cada caso', async () => {
  const abertura = 'Olá! Em breve seu chamado será direcionado a um atendente. Enquanto isso, segue abaixo uma análise preliminar feita pela atendente de IA Jaade.';
  respostasIA = [
    { decisao: 'responder', motivo: 'há contexto', texto: `${abertura}\nConfira o parâmetro MV_TESTE e repita o teste em homologação.\nJaade, atendente de IA` },
    { decisao: 'devolver', motivo: 'faltam evidências', texto: `${abertura}\nInforme a mensagem exibida na aprovação para identificarmos a falha.\nJaade, atendente de IA` },
  ];
  const orientacao = await jade.gerarTextoCliente(EMPRESA, { chamado: { numero: '037500', descricao: 'Falha no parâmetro MV_TESTE' }, anexos: [], analise: { conteudo: 'Verificação possível do parâmetro.' } });
  const pedido = await jade.gerarTextoCliente(EMPRESA, { chamado: { numero: '037501', descricao: 'Falha na aprovação' }, anexos: [], analise: { conteudo: 'Mensagem de erro ausente.' } });
  assert.equal(orientacao.decisao, 'responder');
  assert.equal(pedido.decisao, 'devolver');
  assert.ok(orientacao.texto.startsWith(abertura) && pedido.texto.startsWith(abertura));
  assert.match(chamadasIA[0][2], /ORIENTAÇÃO PRELIMINAR/);
  assert.match(chamadasIA[1][2], /PEDIDO DE EVIDÊNCIAS/);
  assert.match(chamadasIA[0][3], /MV_TESTE/);
  assert.match(chamadasIA[1][3], /Falha na aprovação/);
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

test('citação automática permanece suspensa mesmo quando há referência selecionada', async () => {
  await ligar();
  respostasIA = [{ ...RESPOSTA_OK, texto: 'No chamado 036900 houve um caso possivelmente semelhante; confira as condições.' }, { ...RESPOSTA_OK, texto: 'No chamado 036900 houve um caso possivelmente semelhante; confira as condições.' }];
  const dados = { chamado: { numero: '037500' }, anexos: [], analise: { conteudo: 'Análise preliminar' }, referencias: [{ numero: '036900', trechoAtual: 'erro específico', trechoCandidato: 'erro específico' }] };
  await assert.rejects(jade.gerarTextoCliente(EMPRESA, dados), /cita o chamado 036900/);
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Consulte o chamado 036901.' }, { ...RESPOSTA_OK, texto: 'Consulte o chamado 036901.' }];
  await assert.rejects(jade.gerarTextoCliente(EMPRESA, dados), /cita o chamado 036901/);
});

test('simulação fictícia permite à IA selecionar pistas e monta somente números autorizados', async () => {
  const dados = { chamado: { numero: '037500', descricao: 'Falha fictícia no faturamento' }, anexos: [], analise: { conteudo: 'Avaliar configuração do faturamento.' }, referencias: [{ numero: '036900', trechoAtual: 'Falha no faturamento', trechoCandidato: 'Falha no faturamento', trechoProcedimento: 'Revisar configuração em homologação' }] };
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Confira a configuração em homologação e repita o teste.', indicesReferencias: [0] }];
  const r = await jade.gerarTextoCliente(EMPRESA, dados, { simularReferencias: true });
  assert.match(r.texto, /situações semelhantes[\s\S]*\n\n036900$/);
  assert.deepEqual(r.referenciasSelecionadas, ['036900']);
  assert.doesNotMatch(chamadasIA.at(-1)[3], /036900/);
  assert.match(chamadasIA.at(-1)[3], /Índice 0/);
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Confira a configuração.', indicesReferencias: [1] }, { ...RESPOSTA_OK, texto: 'Confira a configuração.', indicesReferencias: [1] }];
  await assert.rejects(jade.gerarTextoCliente(EMPRESA, dados, { simularReferencias: true }), /seleção de referências inválida/);
});

test('ciclo de PA não cita referência e bloqueia retorno antigo com referências mesmo autorizadas', async () => {
  const auditoria = require('../backend/repositories/investigacao-execucao-repository');
  const orig = { identidade: chamadoRepo.identidadeConfirmadaPa, obter: chamadoRepo.obterCandidatosPorIds, numero: chamadoRepo.getChamadoPorNumero, execucoes: auditoria.listarPorAtendimento };
  const candidato = { chamado: { id: 'ch-036900', numero: '036900', descricao: 'Ao confirmar o pedido aparece erro.' }, posicionamentos: [] };
  const avaliacaoIa = { relevancia: 'mesmo_problema', trechoAtual: 'Ao confirmar o pedido aparece erro', origemAtual: { tipo: 'chamado', campo: 'descricao' }, trechoCandidato: 'Ao confirmar o pedido aparece erro', origemCandidato: { tipo: 'chamado', campo: 'descricao' } };
  try {
    chamadoRepo.identidadeConfirmadaPa = () => true;
    chamadoRepo.obterCandidatosPorIds = (_e, _id, _ids, opts) => opts.escopo === 'cliente_pa' ? [candidato] : [];
    chamadoRepo.getChamadoPorNumero = (e, n, ...resto) => n === '036900' ? candidato.chamado : orig.numero(e, n, ...resto);
    auditoria.listarPorAtendimento = (_e, at) => [{ mensagemId: `msg-${at}`, manifesto: { pesquisaExterna: { baseConhecimento: { selecionados: [{ chamadoId: candidato.chamado.id, numero: '036900', avaliacaoIa }] } } } }];
    await ligar({ modo: 'simulacao' });
    chamadoNaOrigem('037502');
    respostasIA = [{ ...RESPOSTA_OK, texto: 'Confira a configuração e repita o teste.', indicesReferencias: [0] }];
    await jade.executarCiclo(EMPRESA, fonte.id);
    assert.doesNotMatch(execs()[0].textoCliente, /036900|Referências para consulta/);
    assert.doesNotMatch(chamadasIA.at(-1)[2], /indicesReferencias/);
    assert.equal(envios.length, 0);
    repo.atualizar(execs()[0].id, { estado: 'pronto', textoCliente: 'Confira a configuração.\n\nReferências para consulta: 036900' });
    await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.equal(execs()[0].estado, 'falha');
    assert.match(execs()[0].ultimoErro, /suspensa/);
    assert.equal(envios.length, 0);
    const rodapeNovo = jade.simularReferenciasNoRodape('Confira a configuração.', '037502', [{ numero: '036900' }], [0]);
    repo.atualizar(execs()[0].id, { estado: 'pronto', textoCliente: rodapeNovo, ultimoErro: null, alerta: false });
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.equal(execs()[0].estado, 'falha');
    assert.match(execs()[0].ultimoErro, /suspensa/);
    assert.equal(envios.length, 0);
    repo.atualizar(execs()[0].id, { estado: 'pronto', textoCliente: 'Confira a configuração e repita o teste.', ultimoErro: null, alerta: false });
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.equal(execs()[0].estado, 'devolvido');
    assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'newWorkflowEditData', 'executeActivity']);
    chamadoNaOrigem('037503');
    respostasIA = [{ ...RESPOSTA_OK, texto: 'Confira a configuração.', indicesReferencias: [0] }];
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    const novo = execs().find(e => e.numeroChamado === '037503');
    assert.equal(novo.estado, 'devolvido');
    assert.doesNotMatch(novo.textoCliente, /036900|Referências para consulta/);
  } finally {
    chamadoRepo.identidadeConfirmadaPa = orig.identidade; chamadoRepo.obterCandidatosPorIds = orig.obter;
    chamadoRepo.getChamadoPorNumero = orig.numero; auditoria.listarPorAtendimento = orig.execucoes;
  }
});

test('simulação fictícia recusa referência disfarçada e registra retorno seguro sem envio', async () => {
  await ligar({ modo: 'simulacao' });
  chamadoNaOrigem('037501');
  const textoSeguro = 'Olá! Verifique a configuração do parâmetro MV_XYZ e teste novamente em homologação. Se o erro persistir, informe a mensagem exibida. Jaade, atendente de IA';
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Consulte o chamado 0 3 6 9 0 0.' }, { ...RESPOSTA_OK, texto: textoSeguro }];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'simulado');
  assert.equal(exec.textoCliente, textoSeguro);
  assert.equal(envios.length, 0);
  const evento = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'retorno');
  assert.equal(evento.situacao, 'aviso');
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

test('status conferido: texto lido como pedido de evidências com decisão "responder" nunca é gravado; 3 divergências = alerta', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('037610');
  // A IA escreve "responder", mas a conferência independente lê pedido de evidências.
  conferenciaStatus = 'pedido_evidencias';
  for (let i = 0; i < 4; i++) {
    respostasIA = [RESPOSTA_OK, RESPOSTA_OK];
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  }
  const exec = execs()[0];
  assert.equal(exec.estado, 'falha');
  assert.equal(exec.alerta, true);
  assert.equal(exec.tentativasGeracao, 3);
  assert.equal(envios.length, 0, 'nada vai ao SoftExpert');
  assert.equal(conferencias.length, 6, '2 versões do texto por tentativa');
  assert.match(conferencias[0], /Texto que será enviado ao cliente:/);
  // A 2ª versão é pedida com o aviso da divergência.
  assert.match(chamadasIA[1][3], /ATENÇÃO: a versão anterior foi marcada como "responder", mas o texto foi lido como pedido de evidências/);
  const erro = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'retorno' && e.situacao === 'erro');
  assert.match(erro.resumo, /Status não confirmado: decisão e texto divergiram nas 2 versões \(Versão 2: escrita como orientação, lida como pedido de evidências/);
  assert.equal(aviso.classificar(exec), 'falha');

  // Concordando, grava e registra a conferência na auditoria.
  conferenciaStatus = null;
  chamadoNaOrigem('037611');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  const ok = execs().find(e => e.numeroChamado === '037611');
  assert.equal(ok.estado, 'devolvido');
  assert.equal(ok.decisao, 'devolver');
  const retorno = jade.getAuditoria(EMPRESA, fonte.id, ok.id).eventos.find(e => e.etapa === 'retorno' && e.situacao === 'ok');
  assert.match(retorno.detalhes.conferenciaStatus, /^pedido_evidencias — /);
  assert.match(retorno.resumo, /status: pedido de informação \(IA-INFORMACAO\), conferido$/);
});

test('status conferido: 1ª versão divergente é reescrita na mesma tentativa, sem refazer a análise', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('037612');
  // 1ª versão: "responder" com texto de pedido (lido como pedido); 2ª: "devolver" coerente.
  conferenciaStatus = 'pedido_evidencias';
  respostasIA = [RESPOSTA_OK, DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'devolvido');
  assert.equal(exec.decisao, 'devolver');
  assert.equal(exec.tentativasGeracao, 1);
  assert.equal(turnos.length, 1, 'análise técnica feita uma vez só');
  assert.ok(envios[0].xml.includes('<urn:EntityAttributeValue>IA-INFORMACAO</urn:EntityAttributeValue>'));
  const retorno = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'retorno');
  assert.equal(retorno.situacao, 'aviso');
  assert.match(retorno.detalhes.recusas[0], /^Versão 1: escrita como orientação, lida como pedido de evidências/);
});

test('publicar: grava na grade como Jaade, com o status IA-RESPONDIDO, zero horas e os valores combinados; o workflow da Jaade leva o mesmo registro', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037700');
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Olá “cliente”.\nJade, assistente virtual' }];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'devolvido');
  assert.ok(exec.publicadoEm);
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'newWorkflowEditData', 'executeActivity']);
  const { xml } = envios[0];
  assert.match(xml, /<urn:WorkflowID>037700<\/urn:WorkflowID><urn:MainEntityID>itsm</);
  for (const [id, valor] of [['texto4', 'IA-RESPONDIDO'], ['cduserana', '995'], ['analistaj2a', 'Jaade'], ['situacaochamado', 'Primeiro Atendimento'],
    ['tipoposicioname', 'N'], ['aguardanretorno', 'RETORNO - ATENDENTE'], ['horatotalnum', '0'], ['horaintconv', '0']]) {
    assert.ok(xml.includes(`<urn:EntityAttributeID>${id}</urn:EntityAttributeID><urn:EntityAttributeValue>${valor}</urn:EntityAttributeValue>`), `${id}=${valor}`);
  }
  assert.match(xml, /<urn:EntityAttributeID>horaini<\/urn:EntityAttributeID><urn:EntityAttributeValue>\d\d:(00|30)</);
  // Campos que a tela do SoftExpert preenche sozinha: chamado (IDPROCESS) e data/hora da integração.
  assert.ok(xml.includes('<urn:EntityAttributeID>chamado</urn:EntityAttributeID><urn:EntityAttributeValue>037700</urn:EntityAttributeValue>'));
  const agora = new Date(exec.publicadoEm);
  const p2 = (n) => String(n).padStart(2, '0');
  assert.ok(xml.includes(`<urn:EntityAttributeID>dataatual</urn:EntityAttributeID><urn:EntityAttributeValue>${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}</urn:EntityAttributeValue>`));
  assert.match(xml, /<urn:EntityAttributeID>horaatual<\/urn:EntityAttributeID><urn:EntityAttributeValue>([01]\d|2[0-3]):[0-5]\d<\/urn:EntityAttributeValue>/);
  // Cabeçalho do chamado (DYNITSM DP / NMSOLICITANTE / TEXTO31), como a tela copia.
  for (const [id, valor] of [['empresa', 'APROSOJA'], ['colabcliente', 'kelvyn.ramos@aprosoja.com.br'], ['assunto', 'API de solicitacao de compras']]) {
    assert.ok(xml.includes(`<urn:EntityAttributeID>${id}</urn:EntityAttributeID><urn:EntityAttributeValue>${valor}</urn:EntityAttributeValue>`), `${id}=${valor}`);
  }
  assert.ok(xml.includes('Olá &quot;cliente&quot;.'));
  assert.ok(!xml.includes('motivoapontamen'));
  // Workflow da Jaade: processo e formulário fixos, mesmo registro da grade, título com o chamado.
  const abertura = envios[1].xml;
  assert.match(abertura, /<urn:ProcessID>ITSM-02-I\.A-P\.A<\/urn:ProcessID><urn:WorkflowTitle>Jaade - PA do chamado 037700 - \d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d<\/urn:WorkflowTitle><urn:UserID>10677535000155<\/urn:UserID>/);
  assert.match(abertura, /<urn:EntityID>itsm02iapa<\/urn:EntityID>/);
  const atributos = (x) => x.match(/<urn:EntityAttribute>.*?<\/urn:EntityAttribute>/g).filter(a => !/<urn:EntityAttributeID>(dataatual|horaatual|horaini|horafim|horainiconv|horafimconv|email|texto32)</.test(a));
  assert.deepEqual(atributos(abertura), atributos(xml), 'mesmo registro da grade (fora data/hora do instante)');
  // E-mails do chamado (DYNITSM EMAIL / TEXTO32) só no workflow: a grade não tem esses campos.
  assert.ok(abertura.includes('<urn:EntityAttributeID>email</urn:EntityAttributeID><urn:EntityAttributeValue>kelvyn.ramos@aprosoja.com.br</urn:EntityAttributeValue>'));
  assert.ok(abertura.includes('<urn:EntityAttributeID>texto32</urn:EntityAttributeID><urn:EntityAttributeValue>ti@aprosoja.com.br; compras@aprosoja.com.br</urn:EntityAttributeValue>'));
  assert.ok(!/<urn:EntityAttributeID>(email|texto32)</.test(xml));
  assert.match(envios[2].xml, /<urn:WorkflowID>WFJ-037700<\/urn:WorkflowID><urn:ActivityID>ATV-01<\/urn:ActivityID><urn:ActionSequence>1<\/urn:ActionSequence><urn:UserID>10677535000155</);
  const situacao = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'situacao');
  assert.equal(situacao.situacao, 'ok');
  assert.match(situacao.resumo, /Chamado em ATV-03 \(o workflow da Jaade segue pelo status IA-RESPONDIDO\)/);
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
  assert.equal(execs()[0].estado, 'devolvido');
  assert.equal(envios.filter(e => e.operacao === 'newChildEntityRecord').length, 1);
  assert.equal(origem.chamados.get('037800').posJade, 1);
});

test('workflow da Jaade com resposta perdida: o próximo ciclo acha a instância pelo título e nunca abre outra', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037810');
  respostasIA = [RESPOSTA_OK];
  const original = soapReal.enviarOperacao;
  // A abertura entra no SoftExpert, mas a resposta se perde.
  soapReal.enviarOperacao = async (args) => {
    const r = await original(args);
    if (args.operacao === 'newWorkflowEditData') throw Object.assign(new Error('timeout'), { resultadoIndeterminado: true });
    return r;
  };
  try {
    await jade.executarCiclo(EMPRESA, fonte.id);
  } finally {
    soapReal.enviarOperacao = original;
  }
  assert.equal(execs()[0].estado, 'devolvendo');
  assert.equal(origem.workflows.size, 1);
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'devolvido');
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'newWorkflowEditData', 'executeActivity']);
  assert.equal(origem.workflows.size, 1, 'uma instância só');
  // Execução já feita: nada é reenviado.
  repo.atualizar(execs()[0].id, { estado: 'devolvendo' });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(envios.length, 3);
  assert.equal(execs()[0].estado, 'devolvido');
});

test('chamado reprocessado: workflow de uma execução anterior não conta, abre um novo e manda o e-mail', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037830');
  // Workflow antigo do mesmo chamado (processamento anterior, antes de "Limpar log"), já executado.
  origem.workflows.set('WFJ-ANTIGO', { id: 'WFJ-ANTIGO', titulo: 'Jaade - PA do chamado 037830 - 20/11/2026 10:00:00', numero: '037830', status: 'IA-RESPONDIDO', atv01Ativa: false });
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].estado, 'devolvido');
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'newWorkflowEditData', 'executeActivity']);
  assert.equal(origem.workflows.size, 2, 'abriu um workflow novo');
  assert.match(envios[1].xml, /<urn:WorkflowTitle>Jaade - PA do chamado 037830 - \d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d</);
  assert.doesNotMatch(envios[1].xml, /20\/11\/2026 10:00:00/);
});

test('workflow existente sem ATV-01 ativa ou executada aguarda, sem abrir outra instância', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037815');
  respostasIA = [RESPOSTA_OK];
  const original = soapReal.enviarOperacao;
  soapReal.enviarOperacao = async (args) => {
    const r = await original(args);
    if (args.operacao === 'newWorkflowEditData') throw new Error('timeout');
    return r;
  };
  try { await jade.executarCiclo(EMPRESA, fonte.id); } finally { soapReal.enviarOperacao = original; }
  const workflow = [...origem.workflows.values()][0];
  for (const status of [1, 0]) {
    workflow.statusAtividade = status;
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.equal(execs()[0].estado, 'devolvendo');
    assert.equal(execs()[0].alerta, true);
    assert.equal(origem.workflows.size, 1);
    assert.equal(envios.filter(e => e.operacao === 'executeActivity').length, 0);
  }
  // A espera é registrada uma vez na auditoria, não a cada ciclo.
  const esperas = jade.getAuditoria(EMPRESA, fonte.id, execs()[0].id).eventos.filter(e => e.etapa === 'workflow' && e.situacao === 'aviso');
  assert.equal(esperas.length, 1);
  workflow.statusAtividade = 2;
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'devolvido');
  assert.equal(execs()[0].alerta, false);
  assert.equal(envios.filter(e => e.operacao === 'executeActivity').length, 1);
});

test('workflow da Jaade sem confirmação em 4 horas da gravação: falha, não aciona o SoftExpert e avisa como PA Não Respondido', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037816');
  // Sobra do fluxo antigo: grade gravada há 5 horas, ainda em "devolvendo".
  repo.registrarDetectado(EMPRESA, fonte.id, '037816');
  repo.atualizar(execs()[0].id, { estado: 'devolvendo', decisao: 'devolver', textoCliente: 'Pedido antigo.', publicadoEm: new Date(Date.now() - 5 * 3600 * 1000).toISOString() });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  const exec = execs()[0];
  assert.equal(exec.estado, 'falha');
  assert.equal(exec.alerta, true);
  assert.match(exec.ultimoErro, /até 4 horas da gravação/);
  assert.equal(envios.length, 0, 'nada é enviado ao SoftExpert');
  assert.equal(aviso.classificar(exec), 'falha');
  assert.match(aviso.linhaDoChamado(EMPRESA, exec, 'falha'), / — PA gravado, mas NÃO transferido p\/ o cliente\.$/);
});

test('workflow da Jaade recusado 3 vezes: falha com alerta e WhatsApp em "PA Não Respondido"', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037820');
  respostasIA = [RESPOSTA_OK];
  const original = soapReal.enviarOperacao;
  soapReal.enviarOperacao = async (args) => {
    if (args.operacao !== 'newWorkflowEditData') return original(args);
    envios.push({ operacao: args.operacao, xml: args.xml });
    return { Status: 'FAILURE', Code: '-20', Detail: 'campo inexistente' };
  };
  try {
    for (let i = 0; i < 5; i++) await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  } finally {
    soapReal.enviarOperacao = original;
  }
  const exec = execs()[0];
  assert.equal(exec.estado, 'falha');
  assert.equal(exec.alerta, true);
  assert.equal(exec.tentativasDevolucao, 3);
  assert.equal(envios.filter(e => e.operacao === 'newWorkflowEditData').length, 3);
  assert.ok(!envios.some(e => e.operacao === 'executeActivity'));
  const erros = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.filter(e => e.etapa === 'workflow' && e.situacao === 'erro');
  assert.match(erros[0].resumo, /Tentativa 1\/3: o SoftExpert recusou a abertura do workflow da Jaade — campo inexistente/);
  assert.equal(aviso.classificar(exec), 'falha');
  assert.match(aviso.linhaDoChamado(EMPRESA, exec, 'falha'), / — PA gravado, mas e-mail NÃO enviado p\/ o cliente\.$/);
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

test('referência não autorizada inserida após geração bloqueia publicação', async () => {
  await ligar({ modo: 'simulacao' });
  chamadoNaOrigem('038001');
  respostasIA = [RESPOSTA_OK];
  await jade.executarCiclo(EMPRESA, fonte.id);
  repo.atualizar(execs()[0].id, { estado: 'pronto', textoCliente: 'Consulte o chamado 036999.' });
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'falha');
  assert.match(execs()[0].ultimoErro, /referência não autorizada/i);
  assert.equal(envios.length, 0);
});

test('pedir informação: grava IA-INFORMACAO na grade e no workflow da Jaade e não movimenta o ITSM-02', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038100', { emailCopia: null });
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'devolvido');
  assert.ok(exec.devolvidoEm);
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord', 'newWorkflowEditData', 'executeActivity']);
  for (const { xml } of envios.slice(0, 2)) assert.ok(xml.includes('<urn:EntityAttributeID>texto4</urn:EntityAttributeID><urn:EntityAttributeValue>IA-INFORMACAO</urn:EntityAttributeValue>'));
  // TEXTO32 vazio no chamado (como em 037067/037068): o campo não vai.
  assert.ok(envios[1].xml.includes('<urn:EntityAttributeID>email</urn:EntityAttributeID>'));
  assert.ok(!envios[1].xml.includes('<urn:EntityAttributeID>texto32<'));
  assert.match(envios[2].xml, /<urn:WorkflowID>WFJ-038100<\/urn:WorkflowID><urn:ActivityID>ATV-01</);
  assert.ok(!envios.some(e => /<urn:WorkflowID>038100<\/urn:WorkflowID><urn:ActivityID>/.test(e.xml)), 'nenhuma ação no ITSM-02');
});

test('auditoria: fluxo completo registra cada etapa e o que foi gravado, sem token', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038150');
  respostasIA = [DEVOLVER];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  const { execucao, eventos } = jade.getAuditoria(EMPRESA, fonte.id, exec.id);
  assert.equal(execucao.numeroChamado, '038150');
  for (const etapa of ['deteccao', 'importacao', 'anexos', 'analise', 'retorno', 'envio', 'workflow', 'situacao']) {
    assert.ok(eventos.some(e => e.etapa === etapa && e.situacao === 'ok'), `etapa ${etapa} concluída`);
  }
  const envio = eventos.find(e => e.etapa === 'envio' && e.situacao === 'ok');
  assert.equal(envio.detalhes.campos.texto4, 'IA-INFORMACAO');
  assert.equal(envio.detalhes.resposta.Status, 'SUCCESS');
  assert.ok(eventos.find(e => e.etapa === 'retorno').detalhes.texto);
  const workflow = eventos.find(e => e.etapa === 'workflow' && e.situacao === 'ok');
  assert.equal(workflow.detalhes.workflow, 'WFJ-038150');
  assert.equal(workflow.detalhes.atividade, 'ATV-01');
  assert.equal(eventos.find(e => e.etapa === 'workflow' && e.situacao === 'info').detalhes.processo, 'ITSM-02-I.A-P.A');
  const situacao = eventos.find(e => e.etapa === 'situacao');
  assert.match(situacao.resumo, /Chamado em ATV-06 Retorno do Usuário/);
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

test('triagem atuou depois do posicionamento → workflow da Jaade não é aberto', async () => {
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
  assert.equal(exec.alerta, false);
  assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord']);
  const ev = jade.getAuditoria(EMPRESA, fonte.id, exec.id).eventos.find(e => e.etapa === 'workflow');
  assert.equal(ev.situacao, 'aviso');
  assert.match(ev.resumo, /a triagem atuou/);
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
  assert.equal(execs()[0].motivoCodigo, 'texto_vencido');
  assert.equal(envios.length, 0);
});

test('aviso WhatsApp: regra pelo resultado no SoftExpert', () => {
  const c = (dados) => aviso.classificar({ alerta: false, ...dados });
  assert.equal(c({ estado: 'publicado', decisao: 'responder' }), 'sucesso');
  assert.equal(c({ estado: 'devolvido', decisao: 'devolver' }), 'sucesso');
  assert.equal(c({ estado: 'publicado', decisao: 'devolver' }), 'sucesso', 'triagem assumiu antes da devolução');
  assert.equal(c({ estado: 'publicado', decisao: 'devolver', alerta: true }), 'falha', 'gravou, mas não chegou ao Retorno do Usuário');
  assert.equal(c({ estado: 'falha' }), 'falha');
  assert.equal(c({ estado: 'descartado', motivoCodigo: 'texto_vencido' }), 'falha');
  assert.equal(c({ estado: 'descartado', motivoCodigo: 'triagem_atuou' }), 'nenhum');
  assert.equal(c({ estado: 'simulado' }), 'sucesso', 'simulação avisa igual, marcada como teste');
  for (const estado of ['detectado', 'gerando', 'pronto', 'publicando', 'devolvendo']) assert.equal(c({ estado }), null, estado);
});

test('aviso WhatsApp: PA gravado que não chegou ao cliente sai numa frase só, sem código técnico', () => {
  const linha = (dados) => aviso.linhaDoChamado(EMPRESA, { numeroChamado: '037058', decisao: 'devolver', publicadoEm: '2026-11-20T10:00:00Z', alerta: true, ...dados }, 'falha');
  const esperado = '• #037058 · Produto não informado - Cliente não identificado — PA gravado, mas NÃO transferido p/ o cliente.';
  // Devolução aceita, mas o chamado foi para outra atividade.
  assert.equal(linha({ estado: 'publicado', ultimoErro: 'A devolução foi aceita, mas o chamado está em ATV-03, não em ATV-06.' }), esperado);
  // Saiu do PA para outra etapa.
  assert.equal(linha({ estado: 'publicado', ultimoErro: 'O chamado saiu do Primeiro Atendimento para ATV-03, não para o cliente.' }), esperado);
  // 3 tentativas sem confirmação.
  assert.equal(linha({ estado: 'falha', ultimoErro: 'O SoftExpert não confirmou a devolução ao cliente após 3 tentativas; o pedido de informação já está na grade. Chamado deixado para a triagem.' }), esperado);
  // Falha antes de gravar o PA continua com o motivo próprio.
  assert.match(aviso.linhaDoChamado(EMPRESA, { numeroChamado: '037059', estado: 'falha', decisao: 'responder', ultimoErro: 'O SoftExpert não confirmou o posicionamento após 3 tentativas. Chamado deixado para a triagem.' }, 'falha'),
    / — O SoftExpert não confirmou o posicionamento após 3 tentativas\.$/);
});

test('aviso WhatsApp: PA pela Jaade vai ao grupo de "com PA" uma única vez, com produto e cliente', async () => {
  const clienteRepo = require('../backend/repositories/cliente-repository');
  const { cliente } = clienteRepo.upsertCliente(EMPRESA, { cnpj: '55555555000155', nome: 'CLIENTE Z LTDA', nomeFantasia: 'Cliente Z' });
  const chamadoOriginal = chamadoRepo.getChamadoPorNumero;
  chamadoRepo.getChamadoPorNumero = (e, n) => ({ ...chamadoOriginal(e, n), produto: 'Protheus', clienteId: cliente.id });
  try {
    await ligar({ modo: 'publicar', usuarioSoftexpert: '995', gruposAvisoFalha: ['g-triagem'], gruposAvisoSucesso: ['g-coord'] });
    chamadoNaOrigem('037118');
    respostasIA = [RESPOSTA_OK];
    const resumo = await jade.executarCiclo(EMPRESA, fonte.id);
    assert.equal(execs()[0].estado, 'devolvido');
    assert.equal(whats.length, 1);
    // O resultado do WhatsApp aparece no lote e na última leitura.
    assert.deepEqual(resumo.avisos.mensagens, ['WhatsApp (PA respondido): 1 chamado(s) avisado(s), entregue a 2 de 2 número(s).']);
    assert.deepEqual(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo.avisos.mensagens, resumo.avisos.mensagens);
    assert.deepEqual(repo.listarLotes(EMPRESA, fonte.id)[0].resumo.avisos.mensagens, resumo.avisos.mensagens);
    assert.equal(whats[0].url, 'http://iacommand.teste/api/ia-command/whatsapp/enviar-grupo-servico-externo');
    assert.equal(whats[0].segredo, 'segredo-teste');
    assert.deepEqual(whats[0].corpo.grupoIds, ['g-coord']);
    assert.match(whats[0].corpo.referencia, /^lote #\d+$/);
    assert.equal(whats[0].corpo.empresaId, EMPRESA);
    // Resultado no cabeçalho da seção; a linha só identifica o chamado.
    assert.equal(whats[0].corpo.texto, '✅ Jaade IA - 1 Chamado(s) - PA Respondido\n• #037118 · Protheus - Cliente Z');
    assert.equal(whats[0].corpo.finalidadeEnvio, 'iaservice_jade_pa_sucesso');
    // Próxima leitura sem novidade: nada é repetido.
    await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.equal(whats.length, 1);
    const ev = jade.getAuditoria(EMPRESA, fonte.id, execs()[0].id).eventos.filter(e => e.etapa === 'aviso');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].situacao, 'ok');
    assert.match(ev[0].resumo, /PA respondido\) enviado a 2 de 2/);
  } finally {
    chamadoRepo.getChamadoPorNumero = chamadoOriginal;
  }
});

test('aviso WhatsApp: sem PA vai ao grupo de falha; WhatsApp fora tenta de novo sem repetir a auditoria', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', gruposAvisoFalha: ['g-triagem'], gruposAvisoSucesso: ['g-coord'] });
  chamadoNaOrigem('037900');
  respostasIA = [RESPOSTA_OK];
  comportamentoEnvio = 'recusa';
  falharWhats = 'WhatsApp nao esta conectado';
  // 3 recusas do SoftExpert e a 4ª leitura vira falha; o aviso não sai (WhatsApp fora).
  let ultimo;
  for (let i = 0; i < 5; i++) ultimo = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(execs()[0].estado, 'falha');
  assert.equal(execs()[0].avisoWhatsappEm, null);
  assert.equal(whats.length, 2);
  assert.equal(ultimo.avisos.situacao, 'erro');
  assert.match(ultimo.avisos.mensagens[0], /PA não respondido\): não enviado, WhatsApp nao esta conectado\. Nova tentativa/);
  falharWhats = null;
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(whats.length, 3);
  assert.deepEqual(whats[2].corpo.grupoIds, ['g-triagem']);
  assert.equal(whats[2].corpo.texto, '⚠️ Jaade IA - 1 Chamado(s) - PA Não Respondido\n'
    + '• #037900 · Produto não informado - Cliente não identificado — O SoftExpert não confirmou o posicionamento após 3 tentativas.\n'
    + 'Precisam de atendimento da triagem.');
  const ev = jade.getAuditoria(EMPRESA, fonte.id, execs()[0].id).eventos.filter(e => e.etapa === 'aviso');
  assert.deepEqual(ev.map(e => e.situacao), ['erro', 'ok']);
  assert.match(ev[0].resumo, /WhatsApp nao esta conectado/);
});

test('aviso WhatsApp: uma mensagem por seção, cada uma à sua coluna; falha de uma não trava nem repete a outra', async () => {
  // g-ambos marcado nas duas; g-triagem só em não respondido; g-coord só em respondido.
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', gruposAvisoFalha: ['g-ambos', 'g-triagem'], gruposAvisoSucesso: ['g-ambos', 'g-coord'] });
  chamadoNaOrigem('039001');
  chamadoNaOrigem('039002');
  respostasIA = [RESPOSTA_OK, RESPOSTA_OK];
  // 039002 é recusado pelo SoftExpert até virar falha; 039001 grava normal.
  const enviarOriginal = soapReal.enviarOperacao;
  soapReal.enviarOperacao = async (args) => (/<urn:WorkflowID>039002</.test(args.xml) ? { Status: 'FAILURE', Code: '0', Detail: 'campo obrigatório' } : enviarOriginal(args));
  try {
    let resumo;
    for (let i = 0; i < 5; i++) resumo = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
    assert.deepEqual(execs().map(e => [e.numeroChamado, e.estado]).sort(), [['039001', 'devolvido'], ['039002', 'falha']]);
    // O publicado sai no 1º ciclo e a falha só no 4º: cada um na sua leitura.
    const porGrupos = Object.fromEntries(whats.map(w => [w.corpo.grupoIds.join(','), w.corpo]));
    assert.equal(porGrupos['g-ambos,g-coord'].texto, '✅ Jaade IA - 1 Chamado(s) - PA Respondido\n• #039001 · Produto não informado - Cliente não identificado');
    assert.match(porGrupos['g-ambos,g-triagem'].texto, /^⚠️ Jaade IA - 1 Chamado\(s\) - PA Não Respondido\n• #039002/);
    assert.ok(resumo);
  } finally {
    soapReal.enviarOperacao = enviarOriginal;
  }

  // Os dois resultados na MESMA leitura: duas mensagens separadas, cada uma à sua coluna
  // (g-ambos recebe as duas). Só a de PA Não Respondido falha: ela volta sozinha.
  getDB().prepare('UPDATE jade_pa_execucoes SET aviso_whatsapp_em = NULL').run();
  whats.length = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => (JSON.parse(opts.body || '{}').finalidadeEnvio === 'iaservice_jade_pa_falha'
    ? { ok: false, status: 500, json: async () => ({ error: 'WhatsApp nao esta conectado' }) }
    : fetchOriginal(url, opts));
  try {
    const r = await aviso.avisarLote(EMPRESA, fonte.id, {});
    assert.equal(r.situacao, 'erro');
    assert.equal(r.sucesso, 1);
    assert.equal(r.falha, 0);
  } finally {
    global.fetch = fetchOriginal;
  }
  assert.equal(whats.length, 1, 'só a de PA Respondido chegou ao IA Command');
  assert.deepEqual(whats[0].corpo.grupoIds, ['g-ambos', 'g-coord']);
  assert.equal(whats[0].corpo.finalidadeEnvio, 'iaservice_jade_pa_sucesso');
  const porNumero = Object.fromEntries(execs().map(e => [e.numeroChamado, e.avisoWhatsappEm]));
  assert.ok(porNumero['039001'], 'respondido: avisado');
  assert.equal(porNumero['039002'], null, 'não respondido: volta para a próxima leitura');

  // Próxima leitura: só a de PA Não Respondido sai; a de Respondido não se repete.
  await aviso.avisarLote(EMPRESA, fonte.id, {});
  assert.equal(whats.length, 2);
  assert.deepEqual(whats[1].corpo.grupoIds, ['g-ambos', 'g-triagem']);
  assert.equal(whats[1].corpo.finalidadeEnvio, 'iaservice_jade_pa_falha');
  assert.match(whats[1].corpo.texto, /^⚠️ Jaade IA - 1 Chamado\(s\) - PA Não Respondido\n• #039002[^\n]*\nPrecisam de atendimento da triagem\.$/);
});

test('aviso WhatsApp: simulação envia marcada como teste; sem grupo escolhido não manda o histórico depois; grupo inválido é recusado', async () => {
  await assert.rejects(jade.salvarConfig(EMPRESA, fonte.id, { gruposAvisoFalha: ['grupo com espaço'] }), { status: 400 });
  await ligar({ gruposAvisoFalha: ['g'], gruposAvisoSucesso: ['g'] });
  chamadoNaOrigem('038500');
  respostasIA = [RESPOSTA_OK];
  const simulado = await jade.executarCiclo(EMPRESA, fonte.id);
  assert.equal(execs()[0].estado, 'simulado');
  assert.ok(execs()[0].avisoWhatsappEm);
  // Simulação só não integra com o SoftExpert: o WhatsApp sai, marcado.
  assert.equal(envios.length, 0);
  assert.equal(whats.length, 1);
  assert.equal(whats[0].corpo.texto, '🧪 SIMULAÇÃO\n'
    + '✅ Jaade IA - 1 Chamado(s) - PA Respondido\n'
    + '• #038500 · Produto não informado - Cliente não identificado\n'
    + '\n'
    + 'Simulação: nada foi gravado no SoftExpert.');
  assert.match(whats[0].corpo.referencia, /^lote #\d+ · simulação$/);
  assert.match(simulado.avisos.mensagens[0], /^WhatsApp \(PA respondido, simulação\): 1 chamado\(s\) avisado\(s\)/);
  // Leitura vazia não manda nada nem escreve no monitor.
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(whats.length, 1);
  assert.equal(monitor.length, 0);

  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', gruposAvisoFalha: [], gruposAvisoSucesso: [] });
  chamadoNaOrigem('038501');
  respostasIA = [RESPOSTA_OK];
  const semGrupo = await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  const publicado = execs().find(e => e.numeroChamado === '038501');
  assert.equal(publicado.estado, 'devolvido');
  assert.ok(publicado.avisoWhatsappEm);
  assert.equal(semGrupo.avisos.situacao, 'aviso');
  assert.deepEqual(semGrupo.avisos.mensagens, ['WhatsApp (PA respondido): 1 chamado(s) sem aviso, nenhum grupo escolhido.']);
  assert.equal(monitor.at(-1).tipo, 'warning');
  assert.match(monitor.at(-1).mensagem, /1 chamado\(s\) com PA respondido sem aviso; nenhum grupo escolhido/);
  const cfg = await ligar({ modo: 'publicar', usuarioSoftexpert: '995', gruposAvisoSucesso: ['g'] });
  assert.deepEqual(cfg.gruposAvisoSucesso, ['g']);
  await jade.executarCiclo(EMPRESA, fonte.id, { forcar: true });
  assert.equal(whats.length, 1);
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

test('transporte: só o processo ITSM-02-I.A-P.A e a ATV-01 / ação 1 passam pela validação', async () => {
  const exec = soapReal.montarExecucaoWorkflowJade({ workflowId: '000123', userId: '1' });
  const abre = soapReal.montarAberturaWorkflowJade({ titulo: 'Jaade - PA do chamado 038300', userId: '1', campos: { texto4: 'IA-RESPONDIDO' } });
  assert.match(exec, /<urn:ActivityID>ATV-01<\/urn:ActivityID><urn:ActionSequence>1<\/urn:ActionSequence>/);
  // enviarOperacao real valida o envelope antes de qualquer rede.
  for (const xml of [exec.replace('ATV-01', 'ATV-02'), exec.replace('<urn:ActionSequence>1<', '<urn:ActionSequence>6<')]) {
    await assert.rejects(enviarReal({ xml }), /Movimentação de workflow não permitida/);
  }
  await assert.rejects(enviarReal({ xml: abre.replace('ITSM-02-I.A-P.A', 'ITSM-02'), operacao: 'newWorkflowEditData' }), /Abertura de workflow não permitida/);
  assert.throws(() => soapReal.montarAberturaWorkflowJade({ titulo: 'x', userId: '1', campos: {} }), /não pode ir vazio/);
  assert.throws(() => jade.montarAtributosPosicionamento({ contrato: CONTRATO, chamado: { numero: '1' }, jade: { codigo: '995', nome: 'J' }, texto: 'x' }), /Decisão da Jaade ausente/);
  // Os envelopes permitidos passam da validação e só falham no transporte (host inexistente).
  await assert.rejects(enviarReal({ xml: exec }), (err) => !/Movimentação/.test(err.message));
  await assert.rejects(enviarReal({ xml: abre, operacao: 'newWorkflowEditData' }), (err) => !/Abertura/.test(err.message));
});

// Cliente SOAP recarregado sem o stub de envio, para validar o envelope real.
function enviarReal({ xml, operacao = 'executeActivity' }) {
  const p = require.resolve('../backend/services/softexpert-soap-client');
  const cache = require.cache[p];
  delete require.cache[p];
  const novo = require('../backend/services/softexpert-soap-client');
  require.cache[p] = cache;
  return novo.enviarOperacao({ origem: 'https://se.teste', apiKey: 'x', authorizationMode: 'bearer', encoding: 'utf8', xml, operacao, timeoutMs: 1 });
}

// ── Serviço de jobs (IAHub-Jobs, 2026-11-24) ────────────────────────────────

test('serviço de jobs: "está na hora" segue a mesma regra da trava do ciclo', async () => {
  const cfg = await ligar();
  const agora = new Date();
  assert.equal(repo.cicloDevido(cfg, agora), true);
  assert.equal(repo.cicloDevido({ ...cfg, ativo: false }, agora), false);
  assert.equal(repo.cicloDevido({ ...cfg, proximoCicloEm: new Date(agora.getTime() + 60000).toISOString() }, agora), false);
  assert.equal(repo.cicloDevido({ ...cfg, cicloTravaAte: new Date(agora.getTime() + 60000).toISOString() }, agora), false);
  assert.equal(repo.cicloDevido({ ...cfg, proximoCicloEm: null, ultimoCicloEm: new Date(agora.getTime() - 1000).toISOString() }, agora), false);
  assert.equal(repo.cicloDevido({ ...cfg, proximoCicloEm: null, ultimoCicloEm: null }, agora), true);
  // Devida pela função = a trava aceita.
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, agora }), true);
  assert.equal(repo.cicloDevido(repo.getConfig(EMPRESA, fonte.id), agora), false);
});

test('serviço de jobs: leitura interrompida fecha o lote com o motivo e solta a trava; sem trava não faz nada', async () => {
  await ligar();
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'x' }), false);
  assert.equal(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo, null);

  repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 20 * 60000 });
  const lote = repo.criarLote(EMPRESA, fonte.id, 'agendado');
  assert.ok(repo.loteEmAndamento(EMPRESA, fonte.id));
  const antes = jade.getConfig(EMPRESA, fonte.id).leiturasHoje.total;
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'Passou do tempo máximo.' }), true);
  const cfg = jade.getConfig(EMPRESA, fonte.id);
  assert.equal(cfg.cicloTravaAte, null);
  assert.equal(repo.loteEmAndamento(EMPRESA, fonte.id), null);
  assert.deepEqual(cfg.ultimoCicloResumo.erros, ['Leitura interrompida: Passou do tempo máximo.']);
  assert.equal(cfg.leiturasHoje.total, antes + 1);
  assert.equal(cfg.leiturasHoje.semChamados, jade.getConfig(EMPRESA, fonte.id).leiturasHoje.semChamados);
  // Agendada: a próxima leitura segue o intervalo (não dispara em laço).
  assert.ok(Date.parse(cfg.proximoCicloEm) > Date.now());
  const l = getDB().prepare('SELECT fim, resumo FROM jade_pa_lotes WHERE id = ?').get(lote);
  assert.ok(l.fim);
  assert.equal(JSON.parse(l.resumo).interrompida, true);
});

test('serviço de jobs: job da Jaade lista a fonte ligada, roda agendada e avulsa e limpa a interrupção', async () => {
  const job = require('../backend/jobs/jade-pa-job');
  job.preparar();
  await ligar();
  const inst = jade.instanciaServico(EMPRESA, fonte.id);
  assert.equal(job.id, jade.JOB_ID_SERVICO);
  const insts = job.instancias(new Date());
  assert.deepEqual(insts.map(i => [i.instancia, i.devida]), [[inst, true]]);
  assert.equal(insts[0].proximaEm, new Date(0).toISOString());
  assert.equal(job.empresaDaInstancia(inst), EMPRESA);
  assert.match(job.descreverInstancia(inst).rotulo, / · SE ITSM$/);
  assert.equal(job.instanciaValida(inst), true);
  assert.equal(job.instanciaValida('1:fonte-que-nao-existe'), false);
  assert.equal(job.instanciaValida('abc'), false);

  chamadoNaOrigem('037201');
  respostasIA = [RESPOSTA_OK];
  const r = await job.executar(inst, { origem: 'agendado' });
  assert.equal(r.resultado, 'ok');
  assert.equal(r.resumo.novos, 1);
  assert.ok(r.resumo.loteId);
  // Fora da hora: a trava da Jaade recusa e o job responde vazio.
  assert.equal((await job.executar(inst, { origem: 'agendado' })).resultado, 'vazio');
  // Avulsa (Executar agora) roda fora da hora e espera o fim.
  origem.chamados.delete('037201');
  const avulsa = await job.executar(inst, { origem: 'manual' });
  assert.equal(avulsa.resultado, 'vazio');
  assert.equal(avulsa.resumo.elegiveis, 0);
  assert.equal(jade.getConfig(EMPRESA, fonte.id).ultimoCicloResumo.origem, 'manual');

  repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'jobs:42' });
  job.aoInterromper(inst, { origem: 'manual', motivo: 'teste', execId: 42 });
  assert.equal(jade.getConfig(EMPRESA, fonte.id).cicloTravaAte, null);
});

test('trava da Jaade: interrupção antiga não libera a leitura de outro dono', async () => {
  await ligar();
  const inst = jade.instanciaServico(EMPRESA, fonte.id);
  const job = require('../backend/jobs/jade-pa-job');
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'site:novo' }), true);
  const lote = repo.criarLote(EMPRESA, fonte.id, 'manual', 'site:novo');
  job.aoInterromper(inst, { origem: 'manual', motivo: 'filho não iniciou', execId: 42 });
  assert.ok(jade.getConfig(EMPRESA, fonte.id).cicloTravaAte);
  assert.equal(getDB().prepare('SELECT fim FROM jade_pa_lotes WHERE id = ?').get(lote).fim, null);
  assert.equal(repo.renovarTrava(EMPRESA, fonte.id, 60000, 'jobs:42'), false);
  assert.equal(repo.liberarCiclo(EMPRESA, fonte.id, {}, { avulsa: true, dono: 'jobs:42' }), false);
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'limpeza', avulsa: true, dono: 'site:novo' }), true);
});

test('trava da Jaade: órfã não antecipa a liberação de filho possivelmente vivo', async () => {
  await ligar();
  const inst = jade.instanciaServico(EMPRESA, fonte.id);
  const job = require('../backend/jobs/jade-pa-job');
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'jobs:43' }), true);
  job.aoInterromper(inst, { origem: 'manual', motivo: 'órfã', execId: 43, orfa: true });
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'site:novo' }), false);
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'fim do teste', avulsa: true, dono: 'jobs:43' }), true);
});

test('trava da Jaade: dono antigo não renova nem libera uma trava que foi substituída', async () => {
  await ligar();
  const passado = new Date(Date.now() - 120000);
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'site:antigo', agora: passado }), true);
  assert.equal(repo.renovarTrava(EMPRESA, fonte.id, 60000, 'site:antigo'), false);
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'site:novo' }), true);
  assert.equal(repo.renovarTrava(EMPRESA, fonte.id, 60000, 'site:antigo'), false);
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'antiga', dono: 'site:antigo' }), false);
  assert.equal(repo.liberarCicloInterrompido(EMPRESA, fonte.id, { motivo: 'fim', avulsa: true, dono: 'site:novo' }), true);
});

test('perda da trava entre operações impede novas gravações no SoftExpert', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995', devolucaoAtiva: true });
  chamadoNaOrigem('038201');
  respostasIA = [DEVOLVER];
  const original = soapReal.enviarOperacao;
  soapReal.enviarOperacao = async args => {
    const resultado = await original(args);
    if (args.operacao === 'newChildEntityRecord') {
      getDB().prepare('UPDATE jade_pa_config SET ciclo_dono = ? WHERE empresa_id = ? AND fonte_id = ?').run('site:outro', EMPRESA, fonte.id);
    }
    return resultado;
  };
  try {
    await jade.executarCiclo(EMPRESA, fonte.id, { dono: 'site:antigo' });
    assert.deepEqual(envios.map(e => e.operacao), ['newChildEntityRecord']);
    assert.equal(getDB().prepare('SELECT ciclo_dono FROM jade_pa_config WHERE empresa_id = ? AND fonte_id = ?').get(EMPRESA, fonte.id).ciclo_dono, 'site:outro');
    // Perder a trava não é falha do SoftExpert: devolução não gasta tentativa
    // e a auditoria não diz "o SoftExpert não confirmou".
    const ex = execs().find(e => e.numeroChamado === '038201');
    assert.equal(ex.estado, 'devolvendo');
    assert.equal(ex.tentativasDevolucao, 0);
    const eventos = jade.getAuditoria(EMPRESA, fonte.id, ex.id).eventos;
    assert.ok(eventos.some(e => e.situacao === 'aviso' && /Envio interrompido/.test(e.resumo)));
    assert.ok(!eventos.some(e => /não confirmou a abertura/.test(e.resumo)));
  } finally {
    soapReal.enviarOperacao = original;
  }
});

test('trava da Jaade: quem pega a trava fecha o lote que a leitura anterior deixou aberto', async () => {
  await ligar();
  const passado = new Date(Date.now() - 120000);
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'jobs:1', agora: passado }), true);
  const antigo = repo.criarLote(EMPRESA, fonte.id, 'agendado', 'jobs:1');
  // O processo morreu sem fechar; a trava venceu e outra leitura assume.
  assert.equal(repo.tentarTravarCiclo(EMPRESA, fonte.id, { travaMs: 60000, avulsa: true, dono: 'jobs:2' }), true);
  const l = getDB().prepare('SELECT fim, resumo FROM jade_pa_lotes WHERE id = ?').get(antigo);
  assert.ok(l.fim);
  assert.equal(JSON.parse(l.resumo).interrompida, true);
  // O lote da leitura nova não é tocado.
  const novo = repo.criarLote(EMPRESA, fonte.id, 'agendado', 'jobs:2');
  assert.equal(getDB().prepare('SELECT fim FROM jade_pa_lotes WHERE id = ?').get(novo).fim, null);
});

function _limparJobs() {
  for (const t of ['jobs_pedidos', 'jobs_execucoes', 'jobs_servico', 'jobs_concessoes', 'jobs_config', 'jobs_controle', 'jobs_eventos', 'jobs_alertas']) jobsDb.getDB().prepare(`DELETE FROM ${t}`).run();
}

test('serviço de jobs: no comando, "Executar agora" vira pedido e a tela acompanha; sem sinal, o próprio site executa', async () => {
  _limparJobs();
  await ligar();
  const inst = jade.instanciaServico(EMPRESA, fonte.id);
  // Modo Site (padrão): nada muda, a tela da Jaade nem vê o serviço.
  assert.equal(jade.getPainel(EMPRESA, fonte.id).servicoJobs, null);

  // Modo Serviço sem sinal: o site reassume — Executar agora roda aqui mesmo.
  jobsRepo.salvarConfigJobs({ modo: 'servico' });
  let painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.servicoJobs.modo, 'servico');
  assert.equal(painel.servicoJobs.noComando, false);
  const local = jade.executarAgora(EMPRESA, fonte.id);
  assert.equal(local.aguardandoServico, undefined);
  assert.equal(jobsRepo.pedidoAberto(jade.JOB_ID_SERVICO, inst), null);
  for (let i = 0; i < 200 && repo.loteEmAndamento(EMPRESA, fonte.id); i++) await new Promise(r => setTimeout(r, 10));

  // Serviço dando sinal: só o pedido; nada roda no site.
  jobsRepo.registrarBatimento('S1');
  const r = jade.executarAgora(EMPRESA, fonte.id);
  assert.deepEqual(r, { iniciado: true, loteId: null, aguardandoServico: true });
  assert.equal(repo.loteEmAndamento(EMPRESA, fonte.id), null);
  assert.ok(jobsRepo.pedidoAberto(jade.JOB_ID_SERVICO, inst));
  painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.servicoJobs.noComando, true);
  assert.equal(painel.loteEmAndamento.aguardandoServico, true);
  assert.equal(painel.loteEmAndamento.origem, 'manual');

  // Serviço atendeu: execução aberta (processo subindo) ainda conta como em andamento.
  const p = jobsRepo.pedidoAberto(jade.JOB_ID_SERVICO, inst);
  const ficha = jobsRepo.tomarConcessao(jade.JOB_ID_SERVICO, inst, 'S1', { duracaoMs: 30000, ignorarEspera: true });
  const exec = jobsRepo.abrirExecucao({ jobId: jade.JOB_ID_SERVICO, instancia: inst, ficha, origem: 'manual', dono: 'S1' });
  jobsRepo.atenderPedido(p.id, { execucaoId: exec });
  assert.ok(jade.getPainel(EMPRESA, fonte.id).loteEmAndamento);
  jobsRepo.fecharExecucao(exec, { resultado: 'vazio' });
  painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.loteEmAndamento, null);
  assert.equal(painel.servicoJobs.ultimaExecucao.resultado, 'vazio');
  _limparJobs();
});

test('serviço de jobs: agendador do site fica em espera com o serviço no comando, reassume sem sinal e respeita a pausa da tela Jobs', async () => {
  _limparJobs();
  await ligar();
  chamadoNaOrigem('037301');
  respostasIA = [RESPOSTA_OK];
  const inst = jade.instanciaServico(EMPRESA, fonte.id);

  jobsRepo.salvarConfigJobs({ modo: 'servico' });
  jobsRepo.registrarBatimento('S1');
  assert.deepEqual(jade._test.tick(), []);

  // Pausa na tela Jobs vale também quando o site agenda.
  jobsRepo.registrarParada('S1');
  jobsRepo.salvarControle(jade.JOB_ID_SERVICO, inst, { pausado: true }, { usuario: 'ana' });
  assert.deepEqual(jade._test.tick(), []);
  const painel = jade.getPainel(EMPRESA, fonte.id);
  assert.equal(painel.servicoJobs.pausa.por, 'ana');
  assert.equal(painel.servicoJobs.pausa.doJob, false);

  // Retomado e serviço parado: o site reassume e lê.
  jobsRepo.salvarControle(jade.JOB_ID_SERVICO, inst, { pausado: false }, { usuario: 'ana' });
  const disparados = jade._test.tick();
  assert.equal(disparados.length, 1);
  await Promise.all(disparados);
  assert.ok(execs().some(e => e.numeroChamado === '037301'));
  _limparJobs();
});

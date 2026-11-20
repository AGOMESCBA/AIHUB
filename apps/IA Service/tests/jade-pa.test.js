// node --test "apps/IA Service/tests/jade-pa.test.js"
// Jaade no Primeiro Atendimento.
// Fase 1 (simulação): uma ação por chamado, trava entre processos, intervalo e
// limite diário, descarte quando a triagem chega antes, devolução desligada
// vira resposta, texto que cita outro chamado é recusado, 3 falhas = alerta.
// Fases 2/3 (publicar/devolver): grava na grade com a marca da Jaade, nunca
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

// SoftExpert simulado: situação de cada chamado e usuário da Jaade.
const origem = { chamados: new Map(), usuarioAtivo: true, segurarEmpresa: null };
function chamadoNaOrigem(numero, dados = {}) {
  origem.chamados.set(numero, { aberto: true, comResp: false, posJade: 0, posOutros: 0, ativas: ['ATV-02'], ...dados });
}
function elegivel(c) {
  return c.aberto && c.ativas.includes('ATV-02') && !c.comResp && c.posJade + c.posOutros === 0;
}
stub('../backend/services/agente-local-service', {
  async executarSelectNaFonte(_empresaId, _fonteId, { sql, params }) {
    // SoftExpert lento para uma empresa: segura a leitura dela até soltar.
    if (origem.segurarEmpresa?.empresaId === _empresaId) await origem.segurarEmpresa.promessa;
    if (sql.includes('FROM ADUSER')) {
      return params.cdUser === '995' ? [{ CDUSER: 995, NMUSER: 'Jaade', IDUSER: '10677535000155', FGUSERENABLED: origem.usuarioAtivo ? 1 : 0 }] : [];
    }
    if (sql.includes('LEFT JOIN WFSTRUCT')) {
      const c = origem.chamados.get(params.numero);
      if (!c) return [];
      const base = { PROC_STATUS: c.aberto ? 1 : 2, COM_RESP: c.comResp ? 1 : 0, POS_JADE: c.posJade, POS_OUTROS: c.posOutros,
        CAB_EMPRESA: 'APROSOJA', CAB_COLABORADOR: 'kelvyn.ramos@aprosoja.com.br', CAB_ASSUNTO: 'API de solicitacao de compras' };
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
chamadoRepo.getChamadoPorNumero = (_e, numero) => ({ id: `ch-${numero}`, numero, oidOrigem: `oid-${numero}`, titulo: 'Erro ao gerar pedido', descricao: 'Ao confirmar o pedido aparece erro.' });

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
  origem.usuarioAtivo = true;
  origem.segurarEmpresa = null;
  turnos.length = 0;
  envios.length = 0;
  respostasIA = [];
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
  assert.ok(envios.every(e => e.xml.includes('<urn:WorkflowID>037250<')));
  assert.equal(origem.chamados.get('037251').posJade, 0);
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

test('publicar: grava na grade como Jaade, com a marca IA SERVICE, zero horas e os valores combinados', async () => {
  await ligar({ modo: 'publicar', usuarioSoftexpert: '995' });
  chamadoNaOrigem('037700');
  respostasIA = [{ ...RESPOSTA_OK, texto: 'Olá “cliente”.\nJade, assistente virtual' }];
  await jade.executarCiclo(EMPRESA, fonte.id);
  const exec = execs()[0];
  assert.equal(exec.estado, 'publicado');
  assert.ok(exec.publicadoEm);
  assert.equal(envios.length, 1);
  const { xml } = envios[0];
  for (const [id, valor] of [['texto4', 'IA SERVICE'], ['cduserana', '995'], ['analistaj2a', 'Jaade'], ['situacaochamado', 'Primeiro Atendimento'],
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

test('devolver: grava o pedido, executa só ATV-02 ação 1 com a matrícula da Jaade e confirma a chegada na ATV-06', async () => {
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
    assert.equal(execs()[0].estado, 'publicado');
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
    assert.deepEqual(execs().map(e => [e.numeroChamado, e.estado]).sort(), [['039001', 'publicado'], ['039002', 'falha']]);
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
  assert.equal(publicado.estado, 'publicado');
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

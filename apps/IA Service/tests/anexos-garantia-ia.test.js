// node --test "apps/IA Service/tests/anexos-garantia-ia.test.js"
// A IA precisa receber os anexos do chamado: confere antes de cada análise, busca
// só o que falta, tenta de novo e informa o que não foi possível obter.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-garantia-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');

const EMPRESA = 99102;
let origem = [];
let chamadas = [];
let falhasRestantes = 0;

const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() { return []; },
    async listarPosicionamentosDoChamado() { return []; },
    async listarAnexosDoChamado(_e, _f, _n, opcoes) {
      chamadas.push(opcoes);
      if (falhasRestantes > 0) { falhasRestantes -= 1; throw new Error('Timeout ao chamar o agente'); }
      const lista = opcoes.oid ? origem.filter((a) => a.OID === opcoes.oid) : origem;
      return lista.map((a) => (opcoes.comConteudo === false ? { ...a, FLDATA: null } : a));
    },
  },
};
const servico = require('../backend/services/anexos-softexpert-service');

const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'k', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
let sequencia = 0;

function novoAtendimento() {
  sequencia += 1;
  const numero = String(90000 + sequencia);
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, {
    fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `OID-${numero}`, numero, titulo: 'Chamado',
  });
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: numero, conteudoBruto: 'Histórico' });
  origem = [];
  chamadas = [];
  falhasRestantes = 0;
  return { chamadoId: chamado.id, atendimentoId: atendimento.id };
}

function bruto(oid, nome, extras = {}) {
  const b = Buffer.from(`conteudo tecnico de ${nome}`, 'utf8');
  return { origem: 'anexo', OID_REFERENCIA: 'R', OID: oid, NMNAME: nome, IDEXTENSION: nome.split('.').pop(), NRSIZE: b.length, FLDATA: b.toString('base64'), CONTEUDO_ACESSIVEL: 1, ...extras };
}
const RAPIDO = { esperaMs: 1 };

after(() => {
  database.fecharDB();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

test('copia o que falta buscando um arquivo por vez, nunca todos', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'log1.txt'), bruto('A2', 'log2.txt')];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(r.verificado, true);
  assert.equal(r.copiados.length, 2);
  assert.deepEqual(r.faltantes, []);
  assert.equal(chamadas[0].comConteudo, false, 'primeiro confere só a lista');
  assert.deepEqual(chamadas.slice(1).map((c) => c.oid), ['A1', 'A2']);
  assert.equal(anexoRepo.listarAnexos(EMPRESA, atendimentoId).length, 2);
});

test('com todas as cópias íntegras faz uma única chamada leve, sem baixar nada', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'log1.txt')];
  await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  chamadas = [];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].comConteudo, false);
  assert.equal(r.copiados.length, 0);
});

test('falha passageira do agente é superada com novas tentativas', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'log1.txt')];
  falhasRestantes = 2;
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(r.verificado, true);
  assert.equal(r.copiados.length, 1);
});

test('agente fora do ar não lança: informa que não foi possível verificar', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  falhasRestantes = 99;
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(r.verificado, false);
  assert.match(r.erro, /Timeout/);
  const avisos = servico.descreverGarantia(r);
  assert.match(avisos.avisoAnalista, /Não foi possível verificar/);
  assert.match(avisos.avisoIA, /Não afirme que o chamado não tem anexos/);
});

test('arquivo fora do banco e tipo não lido viram aviso, sem tentar baixar', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [
    bruto('wf-1', 'Doc1.pdf', { origem: 'workflow', IDEXTENSION: null, FLDATA: null, CONTEUDO_ACESSIVEL: '0' }),
    bruto('A2', 'antigo.xls'),
    bruto('A3', 'log.txt'),
  ];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.deepEqual(r.faltantes, [{ nome: 'Doc1.pdf', motivo: 'somente_softexpert' }, { nome: 'antigo.xls', motivo: 'tipo_nao_lido' }]);
  assert.deepEqual(chamadas.slice(1).map((c) => c.oid), ['A3']);
  const avisos = servico.descreverGarantia(r);
  assert.match(avisos.avisoAnalista, /A IA analisou sem 2 anexos: Doc1\.pdf \(guardado só no SoftExpert\); antigo\.xls/);
  assert.match(avisos.avisoIA, /Não deduza o que eles mostram/);
});

test('arquivo que continua falhando entra em faltantes e os demais são copiados', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'vazio.txt', { FLDATA: null }), bruto('A2', 'log.txt')];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.deepEqual(r.faltantes, [{ nome: 'vazio.txt', motivo: 'falha_copia' }]);
  assert.equal(r.copiados.length, 1);
});

test('anexos do workflow embrulhados em ZIP chegam desembrulhados; Office e ZIP de verdade não', async () => {
  const JSZip = require('jszip');
  const embrulhar = async (nome, conteudo) => {
    const zip = new JSZip();
    zip.file(nome, conteudo);
    return (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');
  };
  const { chamadoId, atendimentoId } = novoAtendimento();
  const office = new JSZip();
  office.file('[Content_Types].xml', '<Types/>');
  office.file('word/document.xml', '<w/>');
  const docx = (await office.generateAsync({ type: 'nodebuffer' })).toString('base64');
  origem = [
    bruto('wf-1', 'Entrega.txt', { origem: 'workflow', FLDATA: await embrulhar('Entrega.txt', 'texto do e-mail original'), NRSIZE: null }),
    bruto('wf-2', 'Contrato.docx', { origem: 'workflow', FLDATA: docx, NRSIZE: null }),
    bruto('wf-3', 'Pacote.zip', { origem: 'workflow', FLDATA: await embrulhar('dentro.txt', 'x'), NRSIZE: null }),
    bruto('A4', 'nao-workflow.txt', { FLDATA: await embrulhar('a.txt', 'y'), NRSIZE: null }),
  ];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.deepEqual(r.faltantes.filter((f) => f.nome !== 'Pacote.zip'), []);
  const locais = Object.fromEntries(anexoRepo.listarAnexos(EMPRESA, atendimentoId).map((a) => [a.nomeOriginal, a]));
  assert.match(locais['Entrega.txt'].conteudoExtraido || '', /texto do e-mail original/);
  assert.equal(locais['Contrato.docx'].tamanho, Buffer.from(docx, 'base64').length, 'docx fica intacto');
  assert.equal(locais['nao-workflow.txt'].tamanho, Buffer.from(origem[3].FLDATA, 'base64').length, 'outras origens ficam intactas');
});

test('cópias simultâneas do mesmo chamado não duplicam o arquivo', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'log.txt'), bruto('A2', 'outro.txt')];
  await Promise.all([
    servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO),
    servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO),
    servico.sincronizarAnexosParaAtendimento(EMPRESA, chamadoId, atendimentoId),
  ]);
  assert.deepEqual(anexoRepo.listarAnexos(EMPRESA, atendimentoId).map((a) => a.nomeOriginal).sort(), ['log.txt', 'outro.txt']);
});

test('abrir o anexo guarda a cópia; o próximo download sai do servidor', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'print.txt')];
  const primeiro = await servico.baixarAnexo(EMPRESA, chamadoId, 'A1');
  assert.match(primeiro.buffer.toString(), /conteudo tecnico de print\.txt/);
  for (let i = 0; i < 50 && !anexoRepo.listarAnexos(EMPRESA, atendimentoId).length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(anexoRepo.listarAnexos(EMPRESA, atendimentoId).length, 1, 'cópia gravada');
  chamadas = [];
  const segundo = await servico.baixarAnexo(EMPRESA, chamadoId, 'A1');
  assert.deepEqual(segundo.buffer, primeiro.buffer);
  assert.equal(chamadas.length, 0, 'não consulta o SoftExpert de novo');
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(r.copiados.length, 0, 'a pesquisa já encontra o arquivo pronto');
});

test('abrir a lista do chamado com chat já adianta as cópias', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'a.txt'), bruto('A2', 'b.txt')];
  const lista = await servico.listarAnexosDoChamado(EMPRESA, chamadoId);
  assert.equal(lista.length, 2);
  for (let i = 0; i < 100 && anexoRepo.listarAnexos(EMPRESA, atendimentoId).length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(anexoRepo.listarAnexos(EMPRESA, atendimentoId).map((a) => a.nomeOriginal).sort(), ['a.txt', 'b.txt']);
  assert.equal(chamadas.filter((c) => c.comConteudo === false).length, 1, 'reaproveita a lista: uma consulta leve só');
});

test('com vários arquivos, copia dois por vez e mantém a ordem dos avisos', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'um.txt'), bruto('X1', 'velho.xls'), bruto('A2', 'dois.txt'), bruto('A3', 'tres.txt'), bruto('X2', 'outro.doc')];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.equal(r.copiados.length, 3);
  assert.deepEqual(r.faltantes.map((f) => f.nome), ['velho.xls', 'outro.doc']);
});

test('vários analistas abrindo o mesmo anexo ao mesmo tempo geram uma leitura só', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'compartilhado.txt')];
  const [a, b, c] = await Promise.all([
    servico.baixarAnexo(EMPRESA, chamadoId, 'A1'),
    servico.baixarAnexo(EMPRESA, chamadoId, 'A1'),
    servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO),
  ]);
  assert.deepEqual(a.buffer, b.buffer);
  assert.equal(chamadas.filter((x) => x.oid === 'A1').length, 1, 'uma leitura do arquivo');
  for (let i = 0; i < 50 && !anexoRepo.listarAnexos(EMPRESA, atendimentoId).length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(anexoRepo.listarAnexos(EMPRESA, atendimentoId).length, 1, 'uma cópia');
  assert.deepEqual(c.faltantes, []);
});

test('tudo certo: nenhum aviso para a IA nem para o analista', async () => {
  const { chamadoId, atendimentoId } = novoAtendimento();
  origem = [bruto('A1', 'log.txt')];
  const r = await servico.garantirAnexosParaIA(EMPRESA, chamadoId, atendimentoId, RAPIDO);
  assert.deepEqual(servico.descreverGarantia(r), { avisoAnalista: null, avisoIA: null });
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localizarErros, analisarBuffer } = require('../backend/services/analise-log-service');
const { mesmoGrupo } = require('../backend/services/analise-log-identidade');
const ler = texto => localizarErros(Buffer.from(texto), 'audit.log');
const thread = (caller = 'U_A', linha = 20) => `THREAD ERROR\nType mismatch\nCalled from FWEXEC(FWEXEC.PRW) line 10\nCalled from ${caller}(${caller}.PRW) line ${linha}\n`;
const deps = (receber, relatorioAnterior) => ({ relatorioAnterior, config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) }, client: { chamarIA: async (_k, _c, system, p) => { receber?.(JSON.parse(p), system); return { texto: '{"analises":[]}' }; } } });

test('THREAD curto não absorve registro ERROR independente ou outro THREAD', () => {
  const r = ler(thread() + '2026-11-05T09:01:00 [ERROR] Falha de conexão\n' + thread('U_B'));
  assert.equal(r.cobertura.ocorrencias, 3);
  assert.equal(r.grupos.length, 3);
  assert.equal(r.grupos[0].pilha.length, 2);
});
test('timestamp em linha própria não toma o lugar da mensagem principal', () => {
  const r = ler('THREAD ERROR\n2026-11-05T09:00:00 11|\nVariable does not exist CTEST on U_TESTE(TESTE.PRW) line 42\n');
  assert.equal(r.cobertura.ocorrencias, 1);
  assert.match(r.grupos[0].titulo, /Variable does not exist CTEST/);
});
test('threads intercaladas mantêm seus próprios frames', () => {
  const r = ler('THREAD ERROR ([11], usuario)\nType mismatch\nTHREAD ERROR ([22], usuario)\nType mismatch\n[ERROR][Thread 11] Called from U_A(A.PRW) line 1\n[ERROR][Thread 22] Called from U_B(B.PRW) line 2\n');
  assert.equal(r.cobertura.ocorrencias, 2);
  assert.equal(r.grupos.length, 2);
  assert.deepEqual(r.grupos.map(g => g.pilha[0].funcao), ['U_A', 'U_B']);
});
test('nível do registro não é confundido com WARN/ERROR citados em SQL e JSON', () => {
  const r = ler('[ERROR] Consulta retornou o texto literal [WARN]\n[INFO] Texto literal "ERROR: SQL"\n[WARN] Texto literal [ERROR]\nWARNING: Aviso\n');
  assert.equal(r.cobertura.ocorrencias, 1);
  assert.equal(r.cobertura.warnings, 2);
});
test('normaliza threads e horários, mas distingue chamadores, fontes e linhas', () => {
  const r = ler('[ERROR][SERVER] [Thread 11] Falha de conexão\n[ERROR][SERVER] [Thread 22] Falha de conexão\n' + thread('U_A') + thread('U_B') + thread('U_A', 21));
  assert.equal(r.cobertura.ocorrencias, 5);
  assert.equal(r.grupos.length, 4);
  assert.equal(r.grupos[0].quantidade, 2);
  assert.ok(r.grupos.every(g => /^[a-f0-9]{64}$/.test(g.assinatura)));
});
test('mensagem principal com referência on não é confundida com uma linha isolada da pilha', () => {
  const r = ler('THREAD ERROR\nVariable does not exist CTEST on U_TESTE(TESTE.PRW) line 42\nTHREAD ERROR\nVariable does not exist OUTRO on U_TESTE(TESTE.PRW) line 42\n');
  assert.equal(r.grupos.length, 2);
  assert.match(r.grupos[0].titulo, /CTEST/);
  assert.equal(r.grupos[0].pilha[0].linha, 42);
});
test('preserva pilha extensa e envia início, customização e fim sem aumentar o limite de saída', async () => {
  let payload; let instrucao;
  const conteudo = 'THREAD ERROR\nType mismatch\n' + Array.from({ length: 60 }, (_, i) => `Called from ${i === 50 ? 'U_RELEVANTE' : `FW${i}`}(F${i}.PRW) line ${i + 1}\n`).join('');
  const r = await analisarBuffer(1, Buffer.from(conteudo), 'audit.log', deps((p, s) => { payload = p; instrucao = s; }));
  assert.equal(r.grupos[0].pilha.length, 60);
  assert.equal(r.grupos[0].pilha[50].customizadaProvavel, true);
  assert.ok(payload.incidentes[0].pilha.some(f => f.funcao === 'U_RELEVANTE'));
  assert.ok(payload.incidentes[0].pilha.some(f => f.funcao === 'FW59'));
  assert.ok(payload.incidentes[0].pilha.length <= 8);
  assert.ok(payload.incidentes[0].evidencia.length <= 10);
  assert.doesNotMatch(instrucao, /Produza também uma visão geral|"visaoGeral"/);
});
test('limite de pilha preserva o fim e a assinatura continua distinguindo frames além do recorte', () => {
  const conteudo = final => 'THREAD ERROR\nType mismatch\n' + Array.from({ length: 300 }, (_, i) => `Called from FW${i}(F${i}.PRW) line ${i === 290 ? final : i + 1}\n`).join('');
  const a = ler(conteudo(1)); const b = ler(conteudo(2));
  assert.equal(a.grupos[0].pilha.length, 256);
  assert.equal(a.grupos[0].pilhaLimitada, true);
  assert.equal(a.grupos[0].pilha.at(-1).funcao, 'FW299');
  assert.notEqual(a.grupos[0].assinatura, b.grupos[0].assinatura);
});
test('fatal após 100 grupos é detalhado e tem prioridade entre os oito', async () => {
  let payload;
  const conteudo = Array.from({ length: 105 }, (_, i) => `ERROR: Falha distinta ${i}\n`).join('') + 'FATAL: Banco indisponível\n';
  const r = await analisarBuffer(1, Buffer.from(conteudo), 'audit.log', deps(p => { payload = p; }));
  assert.equal(r.grupos.length, 100);
  assert.equal(r.cobertura.ocorrencias, 106);
  assert.equal(r.cobertura.ocorrenciasNaoRetidas, 6);
  const fatal = r.grupos.find(g => g.gravidade === 3);
  assert.ok(fatal);
  assert.equal(payload.incidentes[0].id, fatal.id);
  assert.equal(payload.incidentes.length, 8);
});
test('frequência considera repetições do fim do arquivo antes de escolher os 100', () => {
  const r = ler(Array.from({ length: 110 }, (_, i) => `ERROR: Falha distinta ${i}\n`).join('') + 'ERROR: Falha distinta 109\n'.repeat(30));
  assert.equal(r.grupos.find(g => /109$/.test(g.titulo)).quantidade, 31);
  assert.equal(r.cobertura.ocorrencias, 140);
  assert.equal(r.cobertura.ocorrenciasNaoRetidas, 10);
});
test('varredura de arquivo grande libera o event loop para as outras requisições', async () => {
  let liberou = false; let flagNaIA = false;
  const outraRequisicao = new Promise(resolve => setImmediate(() => { liberou = true; resolve(); }));
  const conteudo = 'Informação normal\n'.repeat(10000) + thread();
  await analisarBuffer(1, Buffer.from(conteudo), 'audit.log', deps(() => { flagNaIA = liberou; }));
  await outraRequisicao;
  assert.equal(flagNaIA, true, 'outras requisições podem rodar antes de concluir a análise');
});
test('IDs de diagnósticos novos são preservados por assinatura, não posição', () => {
  const conteudo = 'ERROR: Falha A\nERROR: Falha B\n';
  const anterior = ler(conteudo);
  anterior.grupos[0].id = 'erro-30'; anterior.grupos[0].analise = { explicacao: 'Preservar A' };
  const atual = localizarErros(Buffer.from(conteudo), 'audit.log', anterior);
  assert.equal(atual.grupos.find(g => g.assinatura === anterior.grupos[0].assinatura).id, 'erro-30');
  assert.equal(mesmoGrupo(atual.grupos[0], anterior.grupos[1], 2, 2), false);
  assert.equal(mesmoGrupo({ ...atual.grupos[0], id: anterior.grupos[1].id }, anterior.grupos[1], 2, 2), false);
});
test('seleção dos 100 mantém um grupo já diagnosticado mesmo fora do corte normal', () => {
  const conteudo = Array.from({ length: 110 }, (_, i) => `ERROR: Falha distinta ${i}\n`).join('');
  const anterior = ler('ERROR: Falha distinta 109\n');
  anterior.grupos[0].id = 'erro-7'; anterior.grupos[0].analise = { explicacao: 'Não perder' };
  const r = localizarErros(Buffer.from(conteudo), 'audit.log', anterior);
  assert.equal(r.grupos.length, 100);
  assert.equal(r.grupos.find(g => g.assinatura === anterior.grupos[0].assinatura).id, 'erro-7');
});
test('histórico antigo congela grupos e IDs; complemento não muda o significado do erro', async () => {
  const conteudo = thread('U_A') + thread('U_B');
  const atual = ler(conteudo);
  const legado = { ...atual, parserVersao: undefined, grupos: [{ ...atual.grupos[0], id: 'erro-7', assinatura: undefined, quantidade: 2, linhas: [1, 5], analise: { explicacao: 'Diagnóstico anterior' } }] };
  const r = await analisarBuffer(1, Buffer.from(conteudo), 'audit.log', deps(null, legado), 'erro-7');
  assert.equal(r.parserVersao, 1);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].id, 'erro-7');
  assert.equal(r.grupos[0].analise.explicacao, 'Diagnóstico anterior');
  assert.equal(r.grupos[0].quantidade, 2);
  assert.equal(mesmoGrupo(r.grupos[0], legado.grupos[0], 1, 1), true);
  assert.equal(mesmoGrupo(r.grupos[0], atual.grupos[0], 1, 2), false);
});
test('marca antiga de reconhecimento não autoriza diagnosticar uma ocorrência que não existe na nova leitura', async () => {
  const legado = ler(thread()); legado.parserVersao = 1;
  legado.grupos[0].linhas = [999]; legado.grupos[0].legadoReconhecido = true;
  await assert.rejects(analisarBuffer(1, Buffer.from(thread()), 'audit.log', deps(() => assert.fail('não deve chamar IA'), legado), legado.grupos[0].id), { status: 409 });
});

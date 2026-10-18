'use strict';
// Integração LOCAL: rotas/upload/SQLite/extração/motor/gate/versionamento/download
// reais; autenticação e provider substituídos por fixtures, sem executar fontes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Module = require('module');
const database = require('../backend/database');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-fontes-upload-'));
database.inicializarDB(path.join(tmp, 'teste.db'));
// Executa o armazenamento existente com SOMENTE sua raiz física substituída
// em memória. A constante interna não muda ao atribuir ao export ANEXOS_DIR.
const armazenamentoPath = require.resolve('../backend/services/armazenamento-anexos');
const codigoArmazenamento = fs.readFileSync(armazenamentoPath, 'utf8');
const declaracaoRaiz = "const ANEXOS_DIR = path.join(__dirname, '..', '..', 'data', 'anexos');";
assert.ok(codigoArmazenamento.includes(declaracaoRaiz));
const moduloArmazenamento = new Module(armazenamentoPath, module);
moduloArmazenamento.filename = armazenamentoPath;
moduloArmazenamento.paths = Module._nodeModulePaths(path.dirname(armazenamentoPath));
require.cache[armazenamentoPath] = moduloArmazenamento;
moduloArmazenamento._compile(codigoArmazenamento.replace(declaracaoRaiz, `const ANEXOS_DIR = ${JSON.stringify(path.join(tmp, 'anexos'))};`), armazenamentoPath);
const armazenamento = moduloArmazenamento.exports;
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const provider = require('../backend/services/ai-provider-client');
const config = require('../backend/services/ai-config-service');
const consultores = require('../backend/services/consultor-service');
const login = require('../backend/services/login-externo-service');
const pesquisa = require('../backend/services/technical-research-service');
const dossie = require('../backend/services/investigacao-dossie-atualizador-service');
const contexto = require('../backend/services/context-engine');
const originais = [];
function substituir(obj, key, valor) { originais.push(() => { obj[key] = valor; }); obj[key] = valor; }
let server, base, tecnicas = 0, editoriais = 0, prompts = [], respostaDoProvider;
const original = 'User Function MeuWF()\nreturn cRet';
const corrigido = 'User Function MeuWF()\nLocal cRet := ""\nreturn cRet';
const resposta = `O PRW anexado retorna cRet sem inicializar a variavel. A correcao tecnica e inicializar cRet antes do retorno e validar em homologacao no mesmo fluxo que gerava o erro.\n\n**Fonte corrigido**\n\`\`\`advpl\n${corrigido}\n\`\`\`\n\n**Alterações realizadas**\nInicializacao de cRet antes do retorno.\n\n**Validação**\nValidar em homologacao no mesmo fluxo. A compilacao e a execucao ainda precisam ser realizadas pela equipe.`;
before(async () => {
  substituir(config, 'resolverKeysEOrdem', () => ({ keys: {}, cfg: {} }));
  substituir(consultores, 'getConsultorPorUsuario', () => ({ id: 'consultor-teste' }));
  substituir(consultores, 'obterEstiloResposta', () => 'NATURAL');
  substituir(login, 'validarSessaoExterna', token => token === 'empresa-a' ? { empresaId: 88101, consultorId: 'analista-a' } : token === 'empresa-b' ? { empresaId: 88102, consultorId: 'analista-b' } : null);
  substituir(pesquisa, 'pesquisar', async () => ({ configurado: false, modo: 'nao_pesquisado', resultados: [], paginasLidas: [] }));
  substituir(dossie, 'atualizarAposTurno', async () => ({ aplicado: false }));
  const montar = contexto.montarContextoInvestigacao;
  substituir(contexto, 'montarContextoInvestigacao', args => { const r = montar(args); prompts.push(r.userPrompt); return r; });
  substituir(provider, 'chamarIA', async (_keys, _cfg, system, user) => {
    if (system.includes('especialista em comunicação técnica')) {
      editoriais++;
      const texto = JSON.parse(user).resposta.replace('O PRW anexado retorna', 'No PRW anexado, o retorno usa');
      return { texto, provider: 'fixture-local', model: 'fixture', usage: { total_tokens: 10 } };
    }
    tecnicas++;
    return { texto: respostaDoProvider || resposta, provider: 'fixture-local', model: 'fixture', usage: { total_tokens: 20 } };
  });
  const app = express(); app.use(express.json());
  require('../backend/routes')(app, {
    requireAuth: (req, res, next) => req.headers['x-usuario'] === 'analista' ? (req.session = { user_id: 1 }, next()) : res.sendStatus(401),
    requireIaService: (req, _res, next) => { req.svcEmpresaId = Number(req.headers['x-empresa'] || 88101); next(); },
  });
  require('../backend/routes/externo-routes')(app);
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(r => server.close(r));
  for (const restore of originais.reverse()) restore();
  database.fecharDB();
  // Somente a pasta exclusiva criada por mkdtemp neste teste.
  if (path.dirname(path.resolve(tmp)) !== path.resolve(os.tmpdir()) || !path.basename(tmp).startsWith('ia-fontes-upload-')) throw new Error('Diretório temporário fora do escopo do teste.');
  fs.rmSync(tmp, { recursive: true, force: true });
});
const headers = { 'x-usuario': 'analista' };
function criarAtendimento() { return atendimentoRepo.criarAtendimento(88101, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Corrigir fonte customizado.' }); }
async function upload(at, nome, conteudo, prefixo = 'ia-service', cabecalho = headers) {
  const form = new FormData(); form.set('arquivo', new Blob([conteudo], { type: 'text/plain' }), nome);
  const r = await fetch(`${base}/api/${prefixo}/atendimentos/${at.id}/anexos`, { method: 'POST', headers: cabecalho, body: form });
  assert.equal(r.status, 201, await r.clone().text()); return r.json();
}
test('upload reconhece linguagens, TXT, extensão aberta e conserva bytes do original', async () => {
  const at = criarAtendimento();
  const fixtures = [
    ['fonte.PRW', original, 'advpl'], ['fonte.TLPP', 'User Function Exemplo()\nreturn Nil', 'tlpp'],
    ['calculo.ts', 'const total: number = 1;', 'typescript'],
    ['calculo.py', 'def soma(a,b):\n    return a+b', 'python'], ['consulta.sql', 'SELECT CAMPO FROM TABELA;', 'sql'],
    ['Teste.java', 'class Teste { int soma(int a, int b) { return a+b; } }', 'java'], ['Teste.cs', 'class Teste { int Soma(int a, int b) { return a+b; } }', 'csharp'],
    ['codigo.txt', original, 'advpl'], ['javascript.txt', 'function soma(a,b) { return a+b; }', 'javascript'],
    ['python.txt', 'def soma(a,b):\n    return a+b', 'python'], ['consulta.fonte', 'SELECT CAMPO FROM TABELA;', 'sql'],
  ];
  const proibido = new FormData(); proibido.set('arquivo', new Blob(['function soma(a,b) { return a+b; }'], { type: 'text/plain' }), 'calculo.js');
  const bloqueio = await fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { method: 'POST', headers, body: proibido });
  assert.equal(bloqueio.status, 400); assert.match((await bloqueio.json()).error, /Extensão não permitida/);
  for (const [nome, texto, linguagem] of fixtures) {
    const a = await upload(at, nome, texto);
    assert.equal(a.eCodigo, true, nome); assert.equal(a.linguagemDetectada, linguagem, nome);
    assert.equal(a.conteudoExtraido, texto); assert.equal(a.atendimentoId, at.id);
  }
  const bytes = Buffer.from('// ação\r\n' + original, 'latin1');
  const a = await upload(at, 'acentos.PRW', bytes);
  assert.equal(a.encodingDetectado, 'latin1'); assert.ok(a.conteudoExtraido.includes('ação'));
  const r = await fetch(`${base}/api/ia-service/anexos/${a.id}/download`, { headers });
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
});
test('fonte e log chegam juntos ao motor; versão real é baixável com humanização ativa', async () => {
  const at = criarAtendimento();
  const fonte = await upload(at, 'MeuWorkflow.PRW', original);
  const log = await upload(at, 'erro.log', 'Variable does not exist CRET no retorno de MeuWF.');
  const r = await fetch(`${base}/api/ia-service/atendimentos/${at.id}/investigar`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Corrija o fonte anexado com base no log.', anexoIds: [fonte.id, log.id] }) });
  assert.equal(r.status, 201, await r.clone().text());
  const m = await r.json();
  assert.equal(m.diagnostico.humanizacao.status, 'aplicada');
  assert.equal(m.fontesCorrigidos.length, 1);
  assert.ok(prompts.some(p => p?.includes(original) && p.includes('Variable does not exist CRET')));
  const versao = m.fontesCorrigidos[0].versao;
  assert.equal(versao.mensagemOrigemId, m.id); assert.equal(versao.anexoOriginalId, fonte.id);
  assert.equal(path.extname(versao.nomeOriginal), '.PRW');
  assert.equal(anexoRepo.getAnexo(88101, fonte.id).conteudoExtraido, original);
  for (const [prefixo, cabecalho] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
    const download = await fetch(`${base}/api/${prefixo}/anexos/${versao.id}/download`, { headers: cabecalho });
    assert.equal(download.status, 200); assert.equal(await download.text(), corrigido + '\n');
    const historico = await (await fetch(`${base}/api/${prefixo}/atendimentos/${at.id}/mensagens`, { headers: cabecalho })).json();
    const persistida = historico.find(x => x.id === m.id);
    assert.equal(persistida.diagnostico.humanizacao.respostaOriginal, resposta);
    const anexos = await (await fetch(`${base}/api/${prefixo}/atendimentos/${at.id}/anexos`, { headers: cabecalho })).json();
    assert.ok(anexos.some(a => a.id === versao.id && a.mensagemOrigemId === m.id));
  }
  const antes = tecnicas + editoriais;
  assert.equal(editoriais, 1); assert.equal(tecnicas, 1);
  // Novo anexo em atendimento que já tem investigação e versão corrigida.
  await upload(at, 'novo-log.txt', 'Nova evidência local, sem executar o fonte.');
  assert.equal(tecnicas + editoriais, antes, 'upload e consultas não invocam o provider');
});
test('consulta de mensagem e download preservam escopo da sessão e da empresa', async () => {
  const at = criarAtendimento(), outro = criarAtendimento();
  const a = await upload(at, 'fonte.PRW', original);
  for (const caminho of [`atendimentos/${at.id}/mensagens`, `anexos/${a.id}/download`]) {
    const url = `${base}/api/ia-service-externo/${caminho}`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-sessao-externa': 'invalida' } })).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-sessao-externa': 'empresa-b' } })).status, 404);
  }
  const mensagensOutro = await (await fetch(`${base}/api/ia-service/atendimentos/${outro.id}/mensagens`, { headers })).json();
  assert.deepEqual(mensagensOutro, []);
});

test('correção de outra linguagem aceita fence c# e CRLF, sem compilação alegada', async () => {
  const at = criarAtendimento();
  const codigoOriginal = 'class Calculo { public int Soma(int a, int b) { return a - b; } }';
  const codigoCorrigido = 'class Calculo { public int Soma(int a, int b) { return a + b; } }';
  const fonte = await upload(at, 'Calculo.cs', codigoOriginal);
  respostaDoProvider = `O fonte anexado usa subtracao na funcao Soma, mas o resultado esperado e soma. A correcao proposta troca o operador.\n\n**Fonte corrigido**\n\`\`\`c#\r\n${codigoCorrigido}\r\n\`\`\`\n\n**Alterações realizadas**\nTrocado o operador de subtracao por adicao.\n\n**Validação**\nCompilar e executar os testes em homologacao com os mesmos parametros de entrada. Ainda nao houve compilacao ou execucao.`;
  try {
    const r = await fetch(`${base}/api/ia-service/atendimentos/${at.id}/investigar`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'A funcao Soma deveria somar os parametros, mas esta subtraindo. Corrija o fonte anexado.', anexoIds: [fonte.id] }) });
    assert.equal(r.status, 201, await r.clone().text());
    const m = await r.json();
    assert.equal(m.fontesCorrigidos.length, 1, JSON.stringify(m.avisosFonteCorrigido));
    assert.equal(m.diagnostico.humanizacao.status, 'aplicada');
    const versao = m.fontesCorrigidos[0].versao;
    assert.equal(path.extname(versao.nomeOriginal), '.cs');
    const download = await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`, { headers });
    assert.equal(download.status, 200); assert.equal(await download.text(), codigoCorrigido + '\r\n');
    assert.equal(anexoRepo.getAnexo(88101, fonte.id).conteudoExtraido, codigoOriginal);
  } finally { respostaDoProvider = null; }
});

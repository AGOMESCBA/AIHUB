'use strict';
// Ambiente de teste: exercita o mecanismo de fonte corrigido (desativado por padrão no servidor).
process.env.SVC_ALLOW_FONTE_CORRIGIDO = '1';
// Fontes integrais e correção por alterações ancoradas. Integração LOCAL:
// rotas/upload/SQLite/extração/contexto/gate/humanização/versionamento/download
// reais; autenticação e provider substituídos por fixtures. Nenhum fonte é
// executado ou compilado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Module = require('module');
const database = require('../backend/database');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-fontes-ancoradas-'));
database.inicializarDB(path.join(tmp, 'teste.db'));
// Mesmo isolamento de fontes-upload-humanizacao.test.js: somente a raiz física
// do armazenamento é trocada por uma pasta temporária.
const armazenamentoPath = require.resolve('../backend/services/armazenamento-anexos');
const codigoArmazenamento = fs.readFileSync(armazenamentoPath, 'utf8');
const declaracaoRaiz = "const ANEXOS_DIR = path.join(__dirname, '..', '..', 'data', 'anexos');";
assert.ok(codigoArmazenamento.includes(declaracaoRaiz));
const moduloArmazenamento = new Module(armazenamentoPath, module);
moduloArmazenamento.filename = armazenamentoPath;
moduloArmazenamento.paths = Module._nodeModulePaths(path.dirname(armazenamentoPath));
require.cache[armazenamentoPath] = moduloArmazenamento;
moduloArmazenamento._compile(codigoArmazenamento.replace(declaracaoRaiz, `const ANEXOS_DIR = ${JSON.stringify(path.join(tmp, 'anexos'))};`), armazenamentoPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const provider = require('../backend/services/ai-provider-client');
const config = require('../backend/services/ai-config-service');
const consultores = require('../backend/services/consultor-service');
const login = require('../backend/services/login-externo-service');
const pesquisa = require('../backend/services/technical-research-service');
const dossie = require('../backend/services/investigacao-dossie-atualizador-service');
const contexto = require('../backend/services/context-engine');
const extracao = require('../backend/services/extracao-conteudo');
const { analisarPreservacao } = require('../backend/services/validacao-preservacao-service');
const { _propostaDeCorrecao } = require('../backend/services/quality-gate-service');
const { extrairAlteracoes, aplicarAlteracoes } = require('../backend/services/alteracao-ancorada-service');
const registry = require('../../registry');

const EMPRESA_A = 88301, EMPRESA_B = 88302;
const originais = [];
function substituir(obj, key, valor) { const antigo = obj[key]; originais.push(() => { obj[key] = antigo; }); obj[key] = valor; }
let server, base, modelo = 'claude-sonnet-teste', respostaDoProvider = '', prompts = [], tecnicas = 0, editoriais = 0;
const SEM_CONTRADICAO = '{"contradicao": false, "motivo": "", "evidencia": ""}';
let respostaVerificador = SEM_CONTRADICAO, verificacoes = [];
const headers = { 'x-usuario': 'analista' };

before(async () => {
  substituir(config, 'resolverKeysEOrdem', () => ({ keys: {}, cfg: { provedorPrimario: 'principal', modelos: { principal: modelo } } }));
  substituir(consultores, 'getConsultorPorUsuario', () => ({ id: 'consultor-teste' }));
  substituir(consultores, 'obterEstiloResposta', () => 'NATURAL');
  substituir(login, 'validarSessaoExterna', token => token === 'empresa-a' ? { empresaId: EMPRESA_A, consultorId: 'analista-a' } : token === 'empresa-b' ? { empresaId: EMPRESA_B, consultorId: 'analista-b' } : null);
  substituir(pesquisa, 'pesquisar', async () => ({ configurado: false, modo: 'nao_pesquisado', resultados: [], paginasLidas: [] }));
  substituir(dossie, 'atualizarAposTurno', async () => ({ aplicado: false }));
  const montar = contexto.montarContextoInvestigacao;
  substituir(contexto, 'montarContextoInvestigacao', args => { const r = montar(args); prompts.push(r.userPrompt); return r; });
  substituir(provider, 'chamarIA', async (_keys, _cfg, system, user) => {
    if (system.includes('verificador de consistência')) {
      verificacoes.push(JSON.parse(user));
      if (respostaVerificador instanceof Error) throw respostaVerificador;
      return { texto: respostaVerificador, provider: 'fixture-local', model: 'fixture', usage: { total_tokens: 5 } };
    }
    if (system.includes('especialista em comunicação técnica')) {
      editoriais++;
      const texto = JSON.parse(user).resposta.replace('O fonte anexado retorna', 'No fonte anexado, o retorno usa');
      return { texto, provider: 'fixture-local', model: 'fixture', usage: { total_tokens: 10 } };
    }
    tecnicas++;
    return { texto: respostaDoProvider, provider: 'fixture-local', model: modelo, usage: { total_tokens: 20 } };
  });
  const app = express(); app.use(express.json());
  require('../backend/routes')(app, {
    requireAuth: (req, res, next) => req.headers['x-usuario'] === 'analista' ? (req.session = { user_id: 1 }, next()) : res.sendStatus(401),
    requireIaService: (req, _res, next) => { req.svcEmpresaId = Number(req.headers['x-empresa'] || EMPRESA_A); next(); },
  });
  require('../backend/routes/externo-routes')(app);
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(r => server.close(r));
  for (const restore of originais.reverse()) restore();
  database.fecharDB();
  if (path.dirname(path.resolve(tmp)) !== path.resolve(os.tmpdir()) || !path.basename(tmp).startsWith('ia-fontes-ancoradas-')) throw new Error('Diretório temporário fora do escopo do teste.');
  fs.rmSync(tmp, { recursive: true, force: true });
});

function criarAtendimento(empresaId = EMPRESA_A) {
  return atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Corrigir fonte customizado.' });
}
async function enviar(at, nome, conteudo, tipo = 'text/plain') {
  const form = new FormData(); form.set('arquivo', new Blob([conteudo], { type: tipo }), nome);
  return fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { method: 'POST', headers, body: form });
}
async function upload(at, nome, conteudo, tipo) {
  const r = await enviar(at, nome, conteudo, tipo);
  assert.equal(r.status, 201, `${nome}: ${await r.clone().text()}`);
  return r.json();
}
async function investigar(at, texto, anexoIds) {
  const r = await fetch(`${base}/api/ia-service/atendimentos/${at.id}/investigar`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto, anexoIds }),
  });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
function bloco(arquivo, original, substituto, justificativa = 'inicializa a variavel antes do retorno') {
  return ['```iahub-alteracao', arquivo ? `arquivo: ${arquivo}` : null, `justificativa: ${justificativa}`, '[[ORIGINAL]]', original, '[[SUBSTITUTO]]', substituto, '[[FIM]]', '```']
    .filter(l => l !== null).join('\n');
}
function respostaComBlocos(...blocos) {
  return `O fonte anexado retorna cRet sem inicializar a variavel. A correcao tecnica e inicializar cRet antes do retorno e validar em homologacao no mesmo fluxo que gerava o erro.\n\n**Fonte corrigido**\n${blocos.join('\n\n')}\n\n**Alterações realizadas**\nInicializacao de cRet antes do retorno.\n\n**Validação**\nCompilar e validar em homologacao no mesmo fluxo. A compilacao e a execucao ainda precisam ser realizadas pela equipe.`;
}
// Fonte ADVPL grande, em Windows-1252/latin1 com CRLF e acentos.
function fonteGrande(linhas = 1800) {
  const partes = ['#Include "Protheus.ch"', '', 'User Function MeuWF()', '\tLocal cMsg := "Atenção: integração concluída"'];
  for (let i = 0; i < linhas; i++) partes.push(`\tConOut("Processando item ${i} - situação ok") // linha de log número ${i}`);
  partes.push('Return cRet', '');
  return Buffer.from(partes.join('\r\n'), 'latin1');
}

test('validador recusa hipótese promovida a certeza e pendência dada como concluída', () => {
  const real = 'A última comunicação do fornecedor sugere que a rejeição 1031 pode estar relacionada a configurações inadequadas no `cClassTrib` e nas regras de alíquota. É necessário verificar se o percentual de diferimento está corretamente configurado no campo correspondente.';
  for (const candidata of [
    'A rejeição 1031 está ligada a configurações inadequadas no `cClassTrib` e nas regras de alíquota, segundo o fornecedor. É necessário verificar se o percentual de diferimento está corretamente configurado no campo correspondente.',
    'O fornecedor identificou que a rejeição 1031 vem de configurações inadequadas no `cClassTrib` e nas regras de alíquota. Vale verificar se o percentual de diferimento está certo no campo correspondente.',
  ]) assert.equal(analisarPreservacao(real, candidata).aprovado, false, candidata);
  const casos = [
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002. Verifique o percentual de diferimento.', 'A rejeição 1031 está relacionada ao cClassTrib 510002. Verifique o percentual de diferimento.'],
    ['A rejeição 1031 possivelmente vem do cClassTrib 510002. O fornecedor não respondeu.', 'A rejeição 1031 vem do cClassTrib 510002. O fornecedor não respondeu.'],
    ['Estamos aguardando o retorno da TOTVS no chamado 30422148. Enquanto isso, verifique a SD2.', 'A TOTVS já respondeu o chamado 30422148. Enquanto isso, verifique a SD2.'],
    ['Estamos aguardando o retorno da TOTVS no chamado 30422148.', 'A TOTVS retornou no chamado 30422148.'],
    ['Verifique se o percentual de diferimento está preenchido no cClassTrib 510002.', 'O percentual de diferimento do cClassTrib 510002 está incorreto.'],
  ];
  for (const [original, candidata] of casos) assert.equal(analisarPreservacao(original, candidata).aprovado, false, candidata);
  // Paráfrases legítimas continuam permitidas.
  assert.equal(analisarPreservacao(casos[0][0], 'É possível que a rejeição 1031 tenha relação com o cClassTrib 510002. Vale verificar o percentual de diferimento.').aprovado, true);
  assert.equal(analisarPreservacao(casos[3][0], 'Seguimos aguardando a TOTVS responder o chamado 30422148.').aprovado, true);
  assert.equal(analisarPreservacao(real, 'Pelo último retorno do fornecedor, a rejeição 1031 pode ter relação com configurações inadequadas no `cClassTrib` e nas regras de alíquota. É necessário verificar se o percentual de diferimento está corretamente configurado no campo correspondente.').aprovado, true);
});

test('Quality Gate reconhece prescrições de correção e ignora ações já realizadas', () => {
  for (const frase of ['Verifique e corrija o campo D2_IDTRIB.', 'Sugiro ajustar a regra do cClassTrib 510002.', 'A correção é alterar o percentual de diferimento.',
    'É preciso corrigir o percentual no SIGAFIS.', 'Você pode alterar a fórmula da regra.', 'Recomendamos atualizar o pacote.', 'Para corrigir o erro, ajuste a configuração.'])
    assert.ok(_propostaDeCorrecao(frase), frase);
  for (const frase of ['Realizamos os ajustes nas regras de base de cálculo.', 'Foi necessário ajustar a fórmula na semana passada.', 'O cliente já alterou o parâmetro MV_ESTADO.'])
    assert.equal(_propostaDeCorrecao(frase), undefined, frase);
});

test('classificação distingue logs de JavaScript e fontes de logs', async () => {
  const log = await extracao.extrairConteudo({ buffer: Buffer.from('[2026-09-10 10:00:01] ERROR Rejeicao 1031 => vDif diferente do calculado\n'), nomeOriginal: 'log.txt', mimeDeclarado: 'text/plain' });
  assert.equal(log.linguagemDetectada, 'log'); assert.equal(log.eCodigo, false);
  const js = await extracao.extrairConteudo({ buffer: Buffer.from('const soma = (a, b) => a + b;\n'), nomeOriginal: 'trecho.txt', mimeDeclarado: 'text/plain' });
  assert.equal(js.linguagemDetectada, 'javascript');
  const advpl = 'User Function Valida()\n\tLocal oError := ErrorBlock({|e| UserException(e:Description)})\n' + '\tConOut("stack")\n'.repeat(1500) + 'Return .T.\n';
  const anexo = { nomeOriginal: 'Valida.prw', eCodigo: true, linguagemDetectada: 'advpl', conteudoExtraido: advpl, mimeType: 'text/plain' };
  const preparado = contexto._prepararConteudoAnexo(anexo, ['valida']);
  assert.equal(preparado.parcial, false, 'fonte com palavras error/exception/stack não é recortado como log');
  assert.equal(preparado.texto, advpl);
});

test('alterações ancoradas preservam bytes, encoding e quebras de linha', () => {
  const original = fonteGrande(50);
  const r = aplicarAlteracoes({ buffer: original, encoding: 'latin1', alteracoes: [
    { original: 'Return cRet', substituto: '\tcRet := ""\nReturn cRet' },
    { original: '\tLocal cMsg := "Atenção: integração concluída"', substituto: '\tLocal cMsg := "Atenção: integração concluída"\n\tLocal cRet := ""' },
  ] });
  assert.equal(r.ok, true, JSON.stringify(r.falhas));
  assert.equal(r.quebraDeLinha, 'CRLF');
  assert.ok(r.buffer.includes(Buffer.from('Atenção', 'latin1')), 'acentos continuam em latin1');
  assert.ok(!r.buffer.toString('latin1').replace(/\r\n/g, '').includes('\n'), 'nenhuma quebra LF isolada é introduzida');
  const esperado = Buffer.from(original.toString('latin1')
    .replace('\tLocal cMsg := "Atenção: integração concluída"', '\tLocal cMsg := "Atenção: integração concluída"\r\n\tLocal cRet := ""')
    .replace('Return cRet', '\tcRet := ""\r\nReturn cRet'), 'latin1');
  assert.deepEqual(r.buffer, esperado, 'todo o restante do arquivo permanece idêntico');
  assert.deepEqual(r.aplicadas.map(a => a.linha), [4, 55]);

  const utf8 = Buffer.from('﻿function soma(a, b) {\n  return a - b; // ação\n}\n', 'utf8');
  const u = aplicarAlteracoes({ buffer: utf8, encoding: 'utf-8', alteracoes: [{ original: '  return a - b; // ação', substituto: '  return a + b; // ação' }] });
  assert.equal(u.ok, true); assert.deepEqual(u.buffer, Buffer.from('﻿function soma(a, b) {\n  return a + b; // ação\n}\n', 'utf8'));

  const falha = (alteracoes, buffer = original, encoding = 'latin1') => aplicarAlteracoes({ buffer, encoding, alteracoes }).falhas.map(f => f.codigo);
  assert.deepEqual(falha([{ original: 'Return cRetX', substituto: 'Return' }]), ['ANCORA_AUSENTE']);
  assert.deepEqual(falha([{ original: '\tConOut("Processando item 1', substituto: '\tConOut("Item 1' }]), ['ANCORA_DUPLICADA'], 'item 1 também casa com itens 10..19');
  assert.deepEqual(falha([{ original: 'Return cRet', substituto: 'Return ""' }, { original: 'Return cR', substituto: 'Return x' }]), ['ALTERACOES_CONFLITANTES']);
  assert.deepEqual(falha([{ original: 'Return cRet', substituto: 'Return ""' }, { original: 'Return cRet', substituto: 'Return x' }]), ['ALTERACOES_CONFLITANTES'], 'duas alterações para a mesma âncora');
  assert.deepEqual(falha([{ original: 'Return cRet', substituto: '// ... restante do código permanece igual ...\nReturn cRet' }]), ['TRECHO_INCOMPLETO']);
  assert.deepEqual(falha([{ original: 'Return cRet', substituto: 'Return "✓"' }]), ['CARACTERE_NAO_REPRESENTAVEL']);
  assert.deepEqual(falha([{ original: '   ', substituto: 'x' }]), ['ANCORA_VAZIA']);

  const parse = extrairAlteracoes(['```iahub-alteracao', 'arquivo: A.prw', '[[ORIGINAL]]', 'x', '[[SUBSTITUTO]]', 'y', '[[SUBSTITUTO]]', 'z', '[[FIM]]', '```'].join('\n'));
  assert.equal(parse.alteracoes.length, 0); assert.equal(parse.erros[0].codigo, 'BLOCO_MALFORMADO');
});

test('upload aceita fontes textuais, normaliza MIME e recusa executáveis e binários disfarçados', async () => {
  const at = criarAtendimento();
  const fontes = [
    ['Rotina.prw', 'User Function Rotina()\nReturn Nil', 'advpl'], ['Classe.tlpp', 'User Function Classe()\nReturn Nil', 'tlpp'], ['Defs.ch', '#define LIMITE 10', 'advpl-header'],
    ['app.js', 'function soma(a,b) { return a+b; }', 'javascript', 'text/javascript'], ['mod.mjs', 'export const x = 1;', 'javascript', 'text/javascript'],
    ['mod.cjs', 'module.exports = 1;', 'javascript', 'application/node'], ['tipos.ts', 'const total: number = 1;', 'typescript', 'video/mp2t'],
    ['Tela.jsx', 'const Tela = () => <div/>;', 'javascript', ''], ['Tela.tsx', 'const Tela = (): null => null;', 'typescript', ''],
    ['calculo.py', 'def soma(a,b):\n    return a+b', 'python', 'text/x-python'], ['Teste.cs', 'class Teste { }', 'csharp', ''], ['Teste.java', 'class Teste { }', 'java', 'text/x-java-source'],
    ['index.php', '<?php echo 1;', 'php', 'application/x-php'], ['pagina.html', '<html><script>alert(1)</script></html>', 'html', 'text/html'],
    ['estilo.css', 'body { color: red; }', 'css', 'text/css'], ['Comp.vue', '<template><div/></template>', 'vue', ''],
    ['main.go', 'package main\nfunc main() {}', 'go', ''], ['app.rb', 'puts 1', 'ruby', 'application/x-ruby'], ['App.kt', 'fun main() {}', 'kotlin', ''],
    ['consulta.sql', 'SELECT 1', 'sql', 'application/sql'], ['deploy.sh', 'echo ok', 'shell', 'application/x-sh'], ['deploy.ps1', 'Write-Output ok', 'powershell', ''],
  ];
  for (const [nome, texto, linguagem, tipo = 'text/plain'] of fontes) {
    const a = await upload(at, nome, texto, tipo);
    assert.equal(a.eCodigo, true, nome); assert.equal(a.linguagemDetectada, linguagem, nome);
    assert.equal(a.mimeType, 'text/plain', `${nome}: MIME normalizado`); assert.equal(a.conteudoExtraido, texto, nome);
  }
  for (const nome of ['setup.exe', 'lib.dll', 'run.bat', 'run.cmd', 'pacote.jar', 'macro.vbs', 'inst.msi']) {
    const r = await enviar(at, nome, 'conteudo');
    assert.equal(r.status, 400, nome); assert.match((await r.json()).error, /Extensão não permitida/);
  }
  const binarios = [['falso.js', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])], ['imagem.py', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], ['doc.prw', Buffer.from('%PDF-1.4 conteudo')]];
  for (const [nome, bytes] of binarios) {
    const r = await enviar(at, nome, bytes);
    assert.equal(r.status, 400, nome); assert.match((await r.json()).error, /binário/i, nome);
  }
  const html = (await (await fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { headers })).json()).find(a => a.nomeOriginal === 'pagina.html');
  for (const [prefixo, cab] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
    const d = await fetch(`${base}/api/${prefixo}/anexos/${html.id}/download`, { headers: cab });
    assert.equal(d.status, 200);
    assert.match(d.headers.get('content-type'), /^text\/plain/);
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
    assert.match(d.headers.get('content-disposition'), /^attachment;/);
  }
  assert.equal((await fetch(`${base}/api/ia-service-externo/anexos/${html.id}/download`, { headers: { 'x-sessao-externa': 'empresa-b' } })).status, 404);
  assert.equal((await fetch(`${base}/api/ia-service/anexos/${html.id}/download`, { headers: { ...headers, 'x-empresa': String(EMPRESA_B) } })).status, 404);
});

test('nenhuma rota estática do IA Service expõe o diretório de anexos', () => {
  const anexosDir = path.resolve(__dirname, '..', 'data', 'anexos');
  const dirs = [...(registry.APPS.iaService.staticDirs || []), ...(registry.LEGACY_STATIC_DIRS || [])];
  assert.ok(dirs.length);
  for (const dir of dirs) {
    const rel = path.relative(path.resolve(dir), anexosDir);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `${dir} não pode conter ${anexosDir}`);
  }
});

test('fonte grande chega inteiro e a versão corrigida preserva o restante com humanização ativa', async () => {
  modelo = 'claude-sonnet-teste'; prompts = [];
  const at = criarAtendimento();
  const bytes = fonteGrande();
  assert.ok(bytes.length > 100000, 'fixture maior que o antigo limite de 14 mil caracteres');
  const fonte = await upload(at, 'MeuWF.prw', bytes);
  assert.equal(fonte.encodingDetectado, 'latin1');
  const log = await upload(at, 'erro.log', 'THREAD ERROR Variable does not exist CRET on U_MEUWF(MEUWF.PRW) line 1805');
  respostaDoProvider = respostaComBlocos(bloco('MeuWF.prw', 'Return cRet', '\tcRet := ""\nReturn cRet'));
  const antes = { tecnicas, editoriais };
  const m = await investigar(at, 'Corrija o fonte anexado com base no log.', [fonte.id, log.id]);
  assert.ok(prompts.at(-1).includes(fonte.conteudoExtraido), 'o prompt recebeu o fonte completo');
  assert.ok(prompts.at(-1).includes('[FONTE INTEGRAL'), 'o prompt indica que o arquivo está completo');
  assert.equal(m.diagnostico.humanizacao.status, 'aplicada');
  assert.equal(tecnicas - antes.tecnicas, 1); assert.equal(editoriais - antes.editoriais, 1);
  assert.equal(m.fontesCorrigidos.length, 1, JSON.stringify(m.avisosFonteCorrigido));
  assert.deepEqual(m.avisosFonteCorrigido, [], 'arquivo gerado não exibe aviso');
  const versao = m.fontesCorrigidos[0].versao;
  assert.equal(versao.anexoOriginalId, fonte.id); assert.equal(versao.mensagemOrigemId, m.id);
  assert.equal(versao.encodingDetectado, 'latin1');
  assert.match(versao.explicacaoAlteracao, /linha 1805/);
  const esperado = Buffer.from(bytes.toString('latin1').replace('Return cRet', '\tcRet := ""\r\nReturn cRet'), 'latin1');
  for (const [prefixo, cab] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
    const d = await fetch(`${base}/api/${prefixo}/anexos/${versao.id}/download`, { headers: cab });
    assert.equal(d.status, 200);
    assert.deepEqual(Buffer.from(await d.arrayBuffer()), esperado, 'bytes da versão = original + somente a alteração');
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
  }
  const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
  assert.deepEqual(Buffer.from(await o.arrayBuffer()), bytes, 'original intacto');
  assert.equal((await fetch(`${base}/api/ia-service-externo/anexos/${versao.id}/download`, { headers: { 'x-sessao-externa': 'empresa-b' } })).status, 404);
});

test('contexto insuficiente informa análise parcial e não gera arquivo', async () => {
  modelo = 'openai/gpt-oss-20b'; prompts = [];
  try {
    const at = criarAtendimento();
    const fonte = await upload(at, 'MeuWF.prw', fonteGrande());
    respostaDoProvider = respostaComBlocos(bloco('MeuWF.prw', 'Return cRet', '\tcRet := ""\nReturn cRet'));
    const m = await investigar(at, 'Corrija o fonte anexado.', [fonte.id]);
    assert.ok(prompts.at(-1).includes('[ANALISE PARCIAL'), 'o prompt sinaliza a análise parcial');
    assert.ok(!prompts.at(-1).includes(fonte.conteudoExtraido));
    assert.equal(m.fontesCorrigidos.length, 0);
    assert.ok(m.avisosFonteCorrigido.some(a => /parcial|integralmente/i.test(a)), JSON.stringify(m.avisosFonteCorrigido));
  } finally { modelo = 'claude-sonnet-teste'; }
});

test('múltiplos arquivos exigem alvo inequívoco; fonte reescrito sem âncoras não vira arquivo', async () => {
  // Cada cenário em atendimento próprio: repetir a mesma resposta no mesmo
  // atendimento é reprovado (corretamente) pelo gate de regressão investigativa.
  async function par() {
    const at = criarAtendimento();
    return { at, a: await upload(at, 'A.prw', 'User Function A()\r\nReturn cRet\r\n'), b: await upload(at, 'B.prw', 'User Function B()\r\nReturn cRet\r\n') };
  }
  let c = await par();
  respostaDoProvider = respostaComBlocos(bloco(null, 'Return cRet', 'cRet := ""\nReturn cRet'));
  const semAlvo = await investigar(c.at, 'Corrija os fontes.', [c.a.id, c.b.id]);
  assert.equal(semAlvo.fontesCorrigidos.length, 0);
  assert.ok(semAlvo.avisosFonteCorrigido.some(x => /arquivo-alvo/i.test(x)), JSON.stringify(semAlvo.avisosFonteCorrigido));

  c = await par();
  respostaDoProvider = respostaComBlocos(bloco('B.prw', 'Return cRet', 'cRet := ""\nReturn cRet'), bloco('A.prw', 'User Function A()', 'User Function A() // revisada'));
  const ambos = await investigar(c.at, 'Corrija os dois fontes.', [c.a.id, c.b.id]);
  assert.equal(ambos.fontesCorrigidos.length, 2, JSON.stringify(ambos.avisosFonteCorrigido));
  const porOriginal = Object.fromEntries(ambos.fontesCorrigidos.map(f => [f.original.id, f.versao]));
  assert.equal(porOriginal[c.b.id].conteudoExtraido, 'User Function B()\r\ncRet := ""\r\nReturn cRet\r\n');
  assert.equal(porOriginal[c.a.id].conteudoExtraido, 'User Function A() // revisada\r\nReturn cRet\r\n');

  c = await par();
  respostaDoProvider = respostaComBlocos(bloco('A.prw', 'Return cRet', 'cRet := ""\nReturn cRet'), bloco('A.prw', 'Return cRet', 'Return ""'));
  const conflito = await investigar(c.at, 'Corrija o fonte A.', [c.a.id]);
  assert.equal(conflito.fontesCorrigidos.length, 0);
  assert.ok(conflito.avisosFonteCorrigido.some(x => /ALTERACOES_CONFLITANTES|ANCORA_DUPLICADA/.test(x)), JSON.stringify(conflito.avisosFonteCorrigido));

  c = await par();
  respostaDoProvider = 'O fonte anexado retorna cRet sem inicializar a variavel. A correcao tecnica e inicializar cRet e validar em homologacao.\n\n**Fonte corrigido**\n```advpl\nUser Function A()\nLocal cRet := ""\nReturn cRet\n```\n\n**Validação**\nCompilar e validar em homologacao.';
  const reescrito = await investigar(c.at, 'Corrija o fonte A.', [c.a.id]);
  assert.equal(reescrito.fontesCorrigidos.length, 0);
  assert.equal(reescrito.avisosFonteCorrigido[0], 'Foi apresentada uma proposta de correção, mas não foi possível gerar um arquivo corrigido com segurança. O código original permanece intacto.');
});

test('resposta reprovada pelo Quality Gate (correção sem validação) não gera arquivo corrigido', async () => {
  const at = criarAtendimento();
  const fonte = await upload(at, 'Rotina.prw', 'User Function Rotina()\r\nReturn cRet\r\n');
  respostaDoProvider = 'O fonte anexado retorna cRet sem inicializar a variavel. A correcao tecnica e inicializar cRet antes do retorno.\n\n**Fonte corrigido**\n'
    + bloco('Rotina.prw', 'Return cRet', 'cRet := ""\nReturn cRet') + '\n\n**Alterações realizadas**\nInicializacao de cRet antes do retorno.';
  const m = await investigar(at, 'Corrija o fonte anexado.', [fonte.id]);
  assert.equal(m.fontesCorrigidos.length, 0);
  assert.ok(m.avisosFonteCorrigido.some(a => /Quality Gate/.test(a)), JSON.stringify(m.avisosFonteCorrigido));
  assert.equal(m.diagnostico?.humanizacao?.status, 'ignorada', 'resposta reprovada também não é humanizada');
  const anexos = await (await fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { headers })).json();
  assert.ok(!anexos.some(a => a.anexoOriginalId === fonte.id && a.id !== fonte.id), 'nenhuma versão persistida');
});

test('retorno ao SoftExpert mantém a política anterior; só o upload do IA Service aceita fontes textuais', () => {
  const armazenamento = require('../backend/services/armazenamento-anexos');
  // Mesma chamada usada por retorno-softexpert-service (sem aceitarFontesTextuais).
  for (const [nome, mime] of [['script.js', 'text/javascript'], ['deploy.sh', 'application/x-sh'], ['deploy.ps1', 'application/octet-stream'], ['pagina.html', 'text/html'], ['index.php', 'application/x-php'], ['setup.exe', 'application/octet-stream']]) {
    assert.equal(armazenamento.validarAnexo({ nomeOriginal: nome, mimeType: mime, tamanho: 10 }).ok, false, `retorno: ${nome}`);
  }
  for (const [nome, mime] of [['Rotina.prw', 'application/octet-stream'], ['print.png', 'image/png'], ['log.txt', 'text/plain']]) {
    assert.equal(armazenamento.validarAnexo({ nomeOriginal: nome, mimeType: mime, tamanho: 10 }).ok, true, `retorno: ${nome}`);
  }
  assert.equal(armazenamento.validarAnexo({ nomeOriginal: 'a.js', mimeType: 'text/javascript', tamanho: 3, conteudo: Buffer.from('x=1'), aceitarFontesTextuais: true }).ok, true);
});

const AVISO_PADRAO = 'Foi apresentada uma proposta de correção, mas não foi possível gerar um arquivo corrigido com segurança. O código original permanece intacto.';

test('código corrigido em bloco comum, sem âncoras: aviso padrão, nenhum arquivo, original intacto, com humanização ativa', async () => {
  const at = criarAtendimento();
  const bytes = Buffer.from('User Function Rotina()\r\n\tLocal cUser := M->ZCH_USER\r\n\tIf !SYS_USR->(MsSeek(cUser))\r\n\t\tReturn .F.\r\n\tEndIf\r\nReturn .T.\r\n', 'latin1');
  const fonte = await upload(at, 'Rotina.prw', bytes);
  // Mesmo padrão observado no gpt-4o-mini real: função reescrita em bloco comum.
  respostaDoProvider = 'O fonte anexado executa o MsSeek mesmo com usuario vazio. A correcao proposta adiciona a verificacao antes da busca e deve ser validada em homologacao.\n\nAqui está a correção proposta:\n\n```advpl\nUser Function Rotina()\n\tLocal cUser := M->ZCH_USER\n\tIf Empty(cUser)\n\t\tReturn .F.\n\tEndIf\n\tIf !SYS_USR->(MsSeek(cUser))\n\t\tReturn .F.\n\tEndIf\nReturn .T.\n```\n\nValidação: compilar e testar em homologacao com usuario vazio, valido e inexistente.';
  const m = await investigar(at, 'Corrija o fonte anexado.', [fonte.id]);
  assert.equal(m.fontesCorrigidos.length, 0);
  assert.deepEqual(m.avisosFonteCorrigido, [AVISO_PADRAO]);
  assert.equal(m.diagnostico?.humanizacao?.status, 'aplicada', 'aviso não depende da humanização');
  const persistida = (await (await fetch(`${base}/api/ia-service-externo/atendimentos/${at.id}/mensagens`, { headers: { 'x-sessao-externa': 'empresa-a' } })).json()).find(x => x.id === m.id);
  assert.deepEqual(persistida.avisosFonteCorrigido, [AVISO_PADRAO], 'aviso persiste para o chat externo (J2A)');
  const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
  assert.deepEqual(Buffer.from(await o.arrayBuffer()), bytes, 'original intacto');
  const anexos = await (await fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { headers })).json();
  assert.equal(anexos.filter(a => a.anexoOriginalId === fonte.id && a.id !== fonte.id).length, 0, 'nenhuma versão persistida');
});

test('resposta apenas explicativa, citando o código original, não exibe aviso', async () => {
  const at = criarAtendimento();
  const fonte = await upload(at, 'Rotina.prw', 'User Function Rotina()\r\n\tLocal cUser := M->ZCH_USER\r\nReturn .T.\r\n');
  respostaDoProvider = 'O fonte anexado le o usuario do campo ZCH_USER e retorna verdadeiro. O trecho relevante e:\n\n```advpl\n\tLocal cUser := M->ZCH_USER\n```\n\nNao ha erro evidente nesse trecho; para avancar, envie o log gerado no momento da falha e valide em homologacao o fluxo que apresentou o problema.';
  const m = await investigar(at, 'Explique o que o fonte faz.', [fonte.id]);
  assert.equal(m.fontesCorrigidos.length, 0);
  assert.deepEqual(m.avisosFonteCorrigido, [], JSON.stringify(m.avisosFonteCorrigido));
});

test('premissa falsa contradita pelo fonte não gera arquivo; correção legítima continua gerando', async () => {
  // Fonte que JÁ protege a busca contra valor vazio; o pedido afirma o contrário.
  const original = 'User Function Valida()\r\n\tLocal cCod := M->ZZ_COD\r\n\tLocal lRet := .T.\r\n\tIf !Empty(cCod)\r\n\t\tIf !ZZ1->(MsSeek(cCod))\r\n\t\t\tlRet := .F.\r\n\t\tEndIf\r\n\tEndIf\r\nReturn lRet\r\n';
  const at = criarAtendimento();
  const fonte = await upload(at, 'Valida.prw', Buffer.from(original, 'latin1'));
  respostaDoProvider = respostaComBlocos(bloco('Valida.prw', '\tEndIf\nReturn lRet', '\tElse\n\t\tlRet := .F.\n\tEndIf\nReturn lRet', 'evita a busca quando o código está vazio'));
  respostaVerificador = '{"contradicao": true, "motivo": "o original já não executa a busca quando o código está vazio", "evidencia": "If !Empty(cCod)"}';
  verificacoes = [];
  try {
    const m = await investigar(at, 'A função Valida executa o MsSeek mesmo com código vazio. Corrija.', [fonte.id]);
    assert.equal(verificacoes.length, 1, 'verificação só roda quando um arquivo seria gerado');
    assert.ok(verificacoes[0].pedido.includes('mesmo com código vazio'));
    assert.ok(verificacoes[0].alteracoes[0].contextoDoOriginal.includes('If !Empty(cCod)'), 'verificador recebe o contexto real do trecho');
    assert.equal(m.fontesCorrigidos.length, 0);
    assert.equal(m.avisosFonteCorrigido[0], AVISO_PADRAO);
    assert.ok(m.avisosFonteCorrigido.some(a => /contradiz o fonte original/.test(a) && a.includes('If !Empty(cCod)')), JSON.stringify(m.avisosFonteCorrigido));
    const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await o.arrayBuffer()), Buffer.from(original, 'latin1'), 'original intacto');

    // "Contradição" sem evidência literal no original não bloqueia (inconclusiva).
    const at2 = criarAtendimento();
    const f2 = await upload(at2, 'Valida.prw', Buffer.from(original, 'latin1'));
    respostaVerificador = '{"contradicao": true, "motivo": "parece desnecessário", "evidencia": "If Empty(cCod) .Or. lAlgo"}';
    const m2 = await investigar(at2, 'Rejeite código vazio com erro.', [f2.id]);
    assert.equal(m2.fontesCorrigidos.length, 1, JSON.stringify(m2.avisosFonteCorrigido));
    assert.match(m2.fontesCorrigidos[0].versao.explicacaoAlteracao, /inconclusiva/);

    // Verificador indisponível não bloqueia uma correção legítima.
    const at3 = criarAtendimento();
    const f3 = await upload(at3, 'Valida.prw', Buffer.from(original, 'latin1'));
    respostaVerificador = new Error('provider indisponível');
    const m3 = await investigar(at3, 'Rejeite código vazio com erro.', [f3.id]);
    assert.equal(m3.fontesCorrigidos.length, 1);
    assert.match(m3.fontesCorrigidos[0].versao.explicacaoAlteracao, /indisponível/);
    assert.equal(m3.fontesCorrigidos[0].versao.conteudoExtraido, original.replace('\tEndIf\r\nReturn lRet', '\tElse\r\n\t\tlRet := .F.\r\n\tEndIf\r\nReturn lRet'));
  } finally { respostaVerificador = SEM_CONTRADICAO; }
});

test('geração desativada no servidor (ausente, "0" ou "true"): nenhum arquivo, aviso, análise e original preservados', async () => {
  const AVISO_DESATIVADA = 'A geração do arquivo corrigido está temporariamente indisponível. A proposta de correção, quando houver, está apenas no texto da resposta; o código original permanece intacto.';
  const anterior = process.env.SVC_ALLOW_FONTE_CORRIGIDO;
  try {
    for (const valor of [undefined, '0', 'true']) {
      if (valor === undefined) delete process.env.SVC_ALLOW_FONTE_CORRIGIDO; else process.env.SVC_ALLOW_FONTE_CORRIGIDO = valor;
      modelo = 'claude-sonnet-teste'; prompts = []; verificacoes = [];
      const at = criarAtendimento();
      const bytes = fonteGrande();
      const fonte = await upload(at, 'MeuWF.prw', bytes);
      // Resposta ancorada VÁLIDA: com a geração ativa, viraria arquivo.
      respostaDoProvider = respostaComBlocos(bloco('MeuWF.prw', 'Return cRet', '\tcRet := ""\nReturn cRet'));
      const m = await investigar(at, 'Corrija o fonte anexado.', [fonte.id]);
      assert.ok(prompts.at(-1).includes(fonte.conteudoExtraido), `${valor}: análise integral continua`);
      assert.equal(m.fontesCorrigidos.length, 0, `${valor}: nenhum arquivo`);
      assert.deepEqual(m.avisosFonteCorrigido, [AVISO_DESATIVADA], `${valor}: aviso de indisponibilidade`);
      assert.equal(verificacoes.length, 0, `${valor}: verificador não é chamado`);
      assert.equal(m.diagnostico?.humanizacao?.status, 'aplicada', `${valor}: humanização segue`);
      assert.ok(m.diagnostico.humanizacao.respostaOriginal.includes('```iahub-alteracao'), 'proposta continua no texto técnico');
      const anexos = await (await fetch(`${base}/api/ia-service/atendimentos/${at.id}/anexos`, { headers })).json();
      assert.equal(anexos.filter(a => a.anexoOriginalId === fonte.id && a.id !== fonte.id).length, 0, `${valor}: nenhuma versão persistida`);
      const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
      assert.deepEqual(Buffer.from(await o.arrayBuffer()), bytes, `${valor}: original intacto`);
    }
    // Resposta só explicativa com a geração desativada: sem aviso indevido.
    delete process.env.SVC_ALLOW_FONTE_CORRIGIDO;
    const at = criarAtendimento();
    const fonte = await upload(at, 'Rotina.prw', 'User Function Rotina()\r\n\tLocal cUser := M->ZCH_USER\r\nReturn .T.\r\n');
    respostaDoProvider = 'O fonte anexado le o usuario do campo ZCH_USER e retorna verdadeiro. Nao ha erro evidente; envie o log e valide em homologacao.';
    const m = await investigar(at, 'Explique o fonte.', [fonte.id]);
    assert.deepEqual(m.avisosFonteCorrigido, []);
  } finally {
    process.env.SVC_ALLOW_FONTE_CORRIGIDO = anterior;
  }
});

'use strict';
// Ambiente de teste: exercita o mecanismo de fonte corrigido (desativado por padrão no servidor).
process.env.SVC_ALLOW_FONTE_CORRIGIDO = '1';
// Fontes integrais e correção por alterações ancoradas. Integração LOCAL:
// rotas/upload/SQLite/extração/contexto/gate/humanização/versionamento/download
// reais; autenticação e provider substituídos por fixtures. Nenhum fonte é
// executado ou compilado.
require('./helpers/rotinas-svc-liberadas'); // rotas exigem rotina svc-* (2026-10-28)
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
let criacoesVersao = [];
const evidenciasBloqueios = [];
const headers = { 'x-usuario': 'analista' };

before(async () => {
  const versoes = require('../backend/services/versao-fonte-service');
  const criar = versoes.criarVersaoCorrigida;
  substituir(versoes, 'criarVersaoCorrigida', (...args) => {
    const pendente = require('../backend/repositories/mensagem-repository').getMensagem(args[0], args[1].mensagemOrigemId);
    assert.doesNotMatch(pendente.conteudo, /```|\[\[SUBSTITUTO\]\]/, 'proposta ainda não aprovada não fica legível durante o versionamento');
    const r = criar(...args); criacoesVersao.push(r.id); return r;
  });
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
function assertRespostaSegura(m) {
  assert.match(m.conteudo, /proposta.*bloqueada/i);
  assert.match(m.conteudo, /precisa ser revista/);
  assert.doesNotMatch(m.conteudo, /```|\[\[SUBSTITUTO\]\]|Return \.F\.|Aplique exatamente|correção é segura/);
  assert.doesNotMatch(JSON.stringify(m.respostaOperacional?.detalhes || []), /iahub-alteracao|\[\[SUBSTITUTO\]\]/);
  assert.ok(!m.diagnostico?.['Fonte corrigido']);
  assert.ok(!m.diagnostico?.['Correção proposta']);
  assert.ok(!m.diagnostico?.humanizacao, 'nenhum texto rejeitado no campo que alimenta Detalhes Técnicos');
}

const fonteControleLocal = [
  'User Function ControleLocal()',
  '    Local aArea := FWGetArea()',
  '    Local cCodigo := M->ZZ_COD',
  '    Local lRet := .T.',
  '    // Atenção: preservar contexto e retorno',
  '    If !Empty(cCodigo)',
  '        lRet := .T.',
  '    EndIf',
  '    FWRestArea(aArea)',
  'Return lRet', '',
].join('\n');
function propostaControleLocal(arquivo, original, substituto) {
  return '**Diagnóstico**\nO fonte anexado inicializa lRet com .T. e preserva o contexto com FWRestArea. A nova regra exige retorno falso no caminho solicitado.\n\n**Correção proposta**\n'
    + bloco(arquivo, original, substituto, 'Implementa a nova regra de retorno solicitada.')
    + '\n\n**Validação**\nCompilar e testar em homologação; não há compilação garantida.';
}

test('bloqueios de fonte retiram orientações do chat, histórico e ficha; preservam proposta somente na auditoria', async t => {
  for (const [nome, original, substituto, verificador, codigo, estado] of [
    ['finalização desviada', '    If !Empty(cCodigo)', '    If Empty(cCodigo)\n        Return .F.\n    EndIf\n    If !Empty(cCodigo)', SEM_CONTRADICAO, 'FINALIZACAO_DESVIADA', 'reprovado'],
    ['causalidade inconclusiva', '    Local lRet := .T.', '    Local lRet := .F.', '{"status":"inconclusiva","motivo":"Não foi possível demonstrar a consistência."}', 'CONTRADICAO_NAO_COMPROVADA', 'inconclusivo'],
    ['falha no verificador', '    Local lRet := .T.', '    Local lRet := .F.', new Error('indisponível'), 'FALHA_TECNICA_VERIFICADOR', 'falha_tecnica'],
    ['âncora ausente', '    LinhaInexistente()', '    lRet := .F.', SEM_CONTRADICAO, 'ANCORA_AUSENTE', 'falha_tecnica'],
    ['estrutura inválida', '    EndIf\n    FWRestArea(aArea)', '    FWRestArea(aArea)', SEM_CONTRADICAO, 'ESTRUTURA_ADVPL_INVALIDA', 'reprovado'],
  ]) await t.test(nome, async () => {
    const at = criarAtendimento(), bytes = Buffer.from(fonteControleLocal.replace(/\n/g, '\r\n'));
    const fonte = await upload(at, 'ControleLocal.prw', bytes);
    const bruta = propostaControleLocal('ControleLocal.prw', original, substituto)
      + '\nAplique exatamente o código acima; essa correção é segura.';
    respostaDoProvider = bruta; respostaVerificador = verificador; verificacoes = [];
    const criacoesAntes = criacoesVersao.length, editoriaisAntes = editoriais;
    try {
      const m = await investigar(at, 'Altere a regra de retorno no caminho solicitado, preservando a restauração.', [fonte.id]);
      const d = m.avaliacoesFonteCorrigido[0];
      assert.equal(d.codigo, codigo, JSON.stringify(m.avisosFonteCorrigido)); assert.equal(d.estado, estado);
      assert.match(m.conteudo, new RegExp(codigo)); assertRespostaSegura(m);
      assert.equal(editoriais, editoriaisAntes, 'nenhuma chamada editorial para reescrever bloqueio');
      assert.equal(criacoesVersao.length, criacoesAntes, 'nenhuma chamada de versionamento');
      assert.equal(m.fontesCorrigidos.length, 0); assert.equal(anexoRepo.listarAnexos(EMPRESA_A, at.id).length, 1);
      const salvo = require('../backend/repositories/mensagem-repository').getMensagem(EMPRESA_A, m.id);
      assert.equal(salvo.conteudo, m.conteudo); assertRespostaSegura(salvo);
      assert.throws(() => require('../backend/repositories/mensagem-repository').atualizarResposta(EMPRESA_B, m.id, { conteudo: 'Alteração de outra empresa' }), /Mensagem não encontrada nesta empresa/);
      assert.equal(require('../backend/repositories/mensagem-repository').getMensagem(EMPRESA_A, m.id).conteudo, m.conteudo);
      const auditoria = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(EMPRESA_A, at.id)[0];
      assert.equal(auditoria.qualityGate.validacaoFontes.respostaRejeitada, bruta);
      assert.equal(auditoria.qualityGate.validacaoFontes.avaliacoes[0].codigo, codigo);
      for (const [prefixo, cab] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
        const h = await fetch(`${base}/api/${prefixo}/atendimentos/${at.id}/mensagens`, { headers: cab });
        assert.equal(h.status, 200);
        const historico = await h.json(); assertRespostaSegura(historico.find(x => x.id === m.id));
      }
      const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
      assert.deepEqual(Buffer.from(await o.arrayBuffer()), bytes);
      if (codigo === 'FINALIZACAO_DESVIADA') {
        assert.match(m.conteudo, /fwrestarea\(aarea\)/); assert.match(m.conteudo, /Trilha de execução/);
        assert.equal(d.etapas.ancoras, 'aprovadas'); assert.equal(d.etapas.estrutura, 'aprovada');
        assert.equal(verificacoes.length, 0);
      }
      if (/VERIFICADOR|CONTRADICAO_NAO/.test(codigo)) {
        assert.equal(d.etapas.fluxo.estado, 'aprovado'); assert.equal(verificacoes.length, 1);
      }
      evidenciasBloqueios.push({ nome, codigo, estado, respostaFinal: m.conteudo, propostaBrutaPreservadaNaAuditoria: auditoria.qualityGate.validacaoFontes.respostaRejeitada === bruta, criarVersaoChamadas: criacoesVersao.length-criacoesAntes, chamadasEditoriais: editoriais-editoriaisAntes, novasVersoes: m.fontesCorrigidos.length, originalIntacto: true, historicoInternoEExternoSeguro: true });
    } finally { respostaVerificador = SEM_CONTRADICAO; }
  });
});

test('cadeia positiva LOCAL/SIMULADA: Else preserva finalização, versão, download e bytes em PRW/TLPP', async () => {
  const crypto = require('crypto');
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const evidencias = [];
  for (const [arquivo, encoding, bom, eol] of [
    ['ControleLocal.prw', 'latin1', false, '\r\n'],
    ['ControleLocal.prw', 'utf8', true, '\r\n'],
    ['ControleLocal.tlpp', 'utf8', false, '\r\n'],
    ['ControleLocal.tlpp', 'utf8', true, '\n'],
  ]) {
    const at = criarAtendimento();
    const texto = (bom ? '\uFEFF' : '') + fonteControleLocal.replace(/\n/g, eol);
    const bytes = Buffer.from(texto, encoding), fonte = await upload(at, arquivo, bytes);
    const original = '    EndIf\n    FWRestArea(aArea)';
    const substituto = '    Else\n        lRet := .F.\n    EndIf\n    FWRestArea(aArea)';
    respostaDoProvider = propostaControleLocal(arquivo, original, substituto); verificacoes = [];
    const antes = criacoesVersao.length;
    const m = await investigar(at, 'Nova regra: quando cCodigo estiver vazio, a função deve retornar .F., preservando os demais comportamentos.', [fonte.id]);
    const exec = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(EMPRESA_A, at.id)[0];
    const d = m.avaliacoesFonteCorrigido[0];
    assert.equal(exec.qualityGate.aprovado, true); assert.equal(d.estado, 'aprovado', JSON.stringify(d));
    assert.equal(d.etapas.ancoras, 'aprovadas'); assert.equal(d.etapas.estrutura, 'aprovada');
    assert.equal(d.etapas.fluxo.estado, 'aprovado'); assert.equal(d.etapas.causal, 'consistente');
    assert.equal(criacoesVersao.length, antes + 1); assert.equal(m.fontesCorrigidos.length, 1);
    assert.equal(m.diagnostico?.humanizacao, undefined, 'correção validada é entregue sem reescrita editorial');
    assert.match(m.conteudo, /iahub-alteracao/); assert.match(m.conteudo, /Compilar e testar em homologação/);
    assert.ok(!exec.qualityGate.validacaoFontes?.respostaRejeitada);
    const versao = m.fontesCorrigidos[0].versao;
    assert.equal(versao.mensagemOrigemId, m.id); assert.notEqual(versao.id, fonte.id);
    const esperado = Buffer.from(texto.replace(original.replace(/\n/g, eol), substituto.replace(/\n/g, eol)), encoding);
    const perfil = b => ({ bytes: b.length, sha256: sha(b), BOM: b.subarray(0,3).equals(Buffer.from([239,187,191])), CRLF: (b.toString(encoding).match(/\r\n/g)||[]).length, LFisolado: (b.toString(encoding).match(/(?<!\r)\n/g)||[]).length });
    for (const [prefixo, cab] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
      const download = await fetch(`${base}/api/${prefixo}/anexos/${versao.id}/download`, { headers: cab });
      assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), esperado);
    }
    assert.equal((await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`)).status, 401);
    assert.equal((await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`, { headers: { ...headers, 'x-empresa': String(EMPRESA_B) } })).status, 404);
    const o = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await o.arrayBuffer()), bytes);
    assert.equal(anexoRepo.listarAnexos(EMPRESA_A, at.id).length, 2);
    evidencias.push({ arquivo, encoding: fonte.encodingDetectado, original: perfil(bytes), corrigido: perfil(esperado), versaoId: versao.id, decisao: d, qualityGateAprovado: exec.qualityGate.aprovado, download: 200, semAutenticacao: 401, outraEmpresa: 404, originalIntacto: true, criarVersaoChamadas: criacoesVersao.length-antes, verificacoesIASimuladas: verificacoes.length, diff: ['+    Else', '+        lRet := .F.'] });
  }
  if (process.env.SVC_EVIDENCIAS_FONTE_LOCAL) fs.writeFileSync(process.env.SVC_EVIDENCIAS_FONTE_LOCAL, JSON.stringify({ modo: 'LOCAL/SIMULADO; zero chamadas reais', bloqueios: evidenciasBloqueios, evidencias }, null, 2));
});
// Fonte ADVPL grande, em Windows-1252/latin1 com CRLF e acentos.
function fonteGrande(linhas = 1800) {
  const partes = ['#Include "Protheus.ch"', '', 'User Function MeuWF()', '\tLocal cMsg := "Atenção: integração concluída"'];
  for (let i = 0; i < linhas; i++) partes.push(`\tConOut("Processando item ${i} - situação ok") // linha de log número ${i}`);
  partes.push('Return cRet', '');
  return Buffer.from(partes.join('\r\n'), 'latin1');
}

test('validador registra hipótese promovida a certeza e pendência dada como concluída (aviso no gate final, 2026-10-20)', () => {
  const real = 'A última comunicação do fornecedor sugere que a rejeição 1031 pode estar relacionada a configurações inadequadas no `cClassTrib` e nas regras de alíquota. É necessário verificar se o percentual de diferimento está corretamente configurado no campo correspondente.';
  for (const candidata of [
    'A rejeição 1031 está ligada a configurações inadequadas no `cClassTrib` e nas regras de alíquota, segundo o fornecedor. É necessário verificar se o percentual de diferimento está corretamente configurado no campo correspondente.',
    'O fornecedor identificou que a rejeição 1031 vem de configurações inadequadas no `cClassTrib` e nas regras de alíquota. Vale verificar se o percentual de diferimento está certo no campo correspondente.',
  ]) assert.ok(analisarPreservacao(real, candidata).avisos.length > 0, candidata);
  const casos = [
    ['A rejeição 1031 pode estar relacionada ao cClassTrib 510002. Verifique o percentual de diferimento.', 'A rejeição 1031 está relacionada ao cClassTrib 510002. Verifique o percentual de diferimento.'],
    ['A rejeição 1031 possivelmente vem do cClassTrib 510002. O fornecedor não respondeu.', 'A rejeição 1031 vem do cClassTrib 510002. O fornecedor não respondeu.'],
    ['Estamos aguardando o retorno da TOTVS no chamado 30422148. Enquanto isso, verifique a SD2.', 'A TOTVS já respondeu o chamado 30422148. Enquanto isso, verifique a SD2.'],
    ['Estamos aguardando o retorno da TOTVS no chamado 30422148.', 'A TOTVS retornou no chamado 30422148.'],
    ['Verifique se o percentual de diferimento está preenchido no cClassTrib 510002.', 'O percentual de diferimento do cClassTrib 510002 está incorreto.'],
  ];
  for (const [original, candidata] of casos) assert.ok(analisarPreservacao(original, candidata).avisos.length > 0, candidata);
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

test('fonte grande chega inteiro e a versão corrigida preserva o restante sem reescrita editorial', async () => {
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
  assert.equal(m.diagnostico?.humanizacao, undefined);
  assert.equal(tecnicas - antes.tecnicas, 1); assert.equal(editoriais - antes.editoriais, 0);
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
  assertRespostaSegura(m);
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
  assertRespostaSegura(m);
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
  respostaVerificador = JSON.stringify({ status: 'contradicao', motivo: 'o original já não executa a busca quando o código está vazio', evidencia: 'If !Empty(cCod)', afirmacao: 'evita a busca quando o código está vazio', demonstracao: 'O If !Empty(cCod) engloba o MsSeek: código vazio pula toda a busca. A justificativa alega impedir uma busca que já é impedida.', novaRegraSolicitada: false });
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

    // Sem prova causal, a proposta permanece inconclusiva e não vira arquivo.
    const at2 = criarAtendimento();
    const f2 = await upload(at2, 'Valida.prw', Buffer.from(original, 'latin1'));
    respostaVerificador = '{"contradicao": true, "motivo": "parece desnecessário", "evidencia": "If Empty(cCod) .Or. lAlgo"}';
    const m2 = await investigar(at2, 'Rejeite código vazio com erro.', [f2.id]);
    assert.equal(m2.fontesCorrigidos.length, 0, JSON.stringify(m2.avisosFonteCorrigido));
    assert.equal(m2.avaliacoesFonteCorrigido[0].estado, 'inconclusivo');
    assert.equal(m2.avaliacoesFonteCorrigido[0].etapas.diagnostico, 'aprovado');

    // Verificador indisponível é falha técnica, sem aprovação de arquivo.
    const at3 = criarAtendimento();
    const f3 = await upload(at3, 'Valida.prw', Buffer.from(original, 'latin1'));
    respostaVerificador = new Error('provider indisponível');
    const m3 = await investigar(at3, 'Rejeite código vazio com erro.', [f3.id]);
    assert.equal(m3.fontesCorrigidos.length, 0);
    assert.equal(m3.avaliacoesFonteCorrigido[0].estado, 'falha_tecnica');
    assert.equal(m3.avaliacoesFonteCorrigido[0].disponibilizacao, false);
  } finally { respostaVerificador = SEM_CONTRADICAO; }
});

test('fonte sintético integral: premissa falsa bloqueada com prova causal; nova regra gera download válido', async () => {
  const fixture = require('./fixtures/fontes-advpl-sinteticas');
  const bytes = Buffer.from(fixture.fonteOriginal);
  const encoding = Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes) ? 'utf8' : 'latin1';
  const original = bytes.toString(encoding);
  const lf = original.replace(/\r\n/g, '\n');
  const inicio = lf.indexOf('User Function ValidaReferencia()');
  const fim = lf.indexOf('Return lRet', inicio) + 'Return lRet'.length;
  const rotina = lf.slice(inicio, fim);
  assert.ok(rotina.includes('If !Empty(cUser)') && rotina.includes('FWRestArea(aArea)'));
  const prova = {
    status: 'contradicao', motivo: 'A busca já está protegida contra usuário vazio.',
    afirmacao: 'impede MsSeek com usuário vazio', evidencia: rotina,
    demonstracao: 'O If !Empty(cUser) envolve DbSelectArea e MsSeek. Quando cUser está vazio, o corpo não executa; o pedido apenas alega ausência dessa proteção já existente.',
    novaRegraSolicitada: false,
  };
  const respostaRotina = (substituto, motivo) => `No fonte ValidacaoSintetica.prw, a função ValidaReferencia já protege MsSeek com If !Empty(cUser). Quando o usuário está vazio, lRet permanece verdadeiro. A proposta abaixo deve ser validada em homologação.\n\n**Fonte corrigido**\n${bloco('ValidacaoSintetica.prw', rotina, substituto, motivo)}\n\n**Validação**\nCompilar no Protheus e testar usuário vazio, válido e inexistente. Conferir o retorno lRet e a restauração de contexto. Compilação e execução ainda não realizadas.`;
  try {
    const at = criarAtendimento(), fonte = await upload(at, 'ValidacaoSintetica.prw', bytes);
    respostaDoProvider = respostaComBlocos(bloco('ValidacaoSintetica.prw', rotina, rotina.replace('If !Empty(cUser)', 'If !Empty(Alltrim(cUser))'), prova.afirmacao));
    respostaVerificador = JSON.stringify(prova);
    const a = await investigar(at, 'ValidaReferencia chama MsSeek com usuário vazio; adicione a proteção ausente.', [fonte.id]);
    assert.equal(a.fontesCorrigidos.length, 0);
    assert.ok(a.avisosFonteCorrigido.some(s => /contradiz o fonte original/.test(s)), JSON.stringify(a.avisosFonteCorrigido));
    const originalA = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await originalA.arrayBuffer()), bytes);

    const alterada = rotina.replace('        EndIf\n    EndIf', '        EndIf\n    Else\n        lRet := .F.\n    EndIf');
    assert.notEqual(alterada, rotina);
    respostaDoProvider = respostaRotina(alterada, 'Rejeita usuário vazio; a proteção da busca já existe, mas retorna verdadeiro para vazio.');
    // A mera citação literal não pode bloquear a nova regra solicitada.
    respostaVerificador = JSON.stringify({ contradicao: true, motivo: 'Já há proteção', evidencia: 'If !Empty(cUser)' });
    const atB = criarAtendimento(), fonteB = await upload(atB, 'ValidacaoSintetica.prw', bytes);
    const b = await investigar(atB, 'Mantenha a proteção existente do MsSeek. Quando cUser estiver vazio, a função deve retornar .F.', [fonteB.id]);
    assert.equal(b.fontesCorrigidos.length, 1, JSON.stringify(b.avisosFonteCorrigido));
    assert.equal(b.avaliacoesFonteCorrigido[0].estado, 'aprovado');
    assert.match(b.fontesCorrigidos[0].status, /proposta.*validação/);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const esperado = Buffer.from(original.replace(rotina.replace(/\n/g, eol), alterada.replace(/\n/g, eol)), encoding);
    const versao = b.fontesCorrigidos[0].versao;
    for (const [prefixo, cab] of [['ia-service', headers], ['ia-service-externo', { 'x-sessao-externa': 'empresa-a' }]]) {
      const r = await fetch(`${base}/api/${prefixo}/anexos/${versao.id}/download`, { headers: cab });
      assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), esperado);
    }
    const r = await fetch(`${base}/api/ia-service/anexos/${fonteB.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes, 'original inteiro intacto após A e B');
    assert.equal((await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`)).status, 401);
    assert.equal((await fetch(`${base}/api/ia-service-externo/anexos/${versao.id}/download`, { headers: { 'x-sessao-externa': 'empresa-b' } })).status, 404);

    for (const [codigo, invalida] of [
      ['ESTRUTURA_ADVPL_INVALIDA', alterada.replace('        EndIf\n', '')],
      ['DECLARACAO_REMOVIDA', alterada.replace('    Local lRet  := .T.\n', '')],
      ['RESTAURACAO_CONTEXTO_REMOVIDA', alterada.replace('    FWRestArea(aArea)\n', '')],
    ]) {
      respostaDoProvider = respostaRotina(invalida, 'Rejeita usuário vazio.');
      verificacoes = [];
      const atInvalido = criarAtendimento(), fonteInvalido = await upload(atInvalido, 'ValidacaoSintetica.prw', bytes);
      const m = await investigar(atInvalido, 'Rejeite usuário vazio preservando a rotina.', [fonteInvalido.id]);
      assert.equal(m.fontesCorrigidos.length, 0, codigo);
      assert.ok(m.avisosFonteCorrigido.some(s => s.includes(codigo)), JSON.stringify(m.avisosFonteCorrigido));
      assert.equal(verificacoes.length, 0, 'falha estrutural detectada localmente antes da IA');
    }
  } finally { respostaVerificador = SEM_CONTRADICAO; }
});

test('regressão sintética: motivo semântico no Quality Gate, correção legítima e download exato com IA simulada', async () => {
  const fixture = require('./fixtures/fontes-advpl-sinteticas');
  const bytes = Buffer.from(fixture.fonteOriginal);
  try {
    const a = fixture.cenarios[0], atA = criarAtendimento();
    const fonteA = await upload(atA, 'ValidacaoSintetica.prw', bytes);
    const direta = await require('../backend/services/investigacao-service')._gerarFontesCorrigidos(EMPRESA_A, atA.id, {
      mensagemId: null, textoResposta: a.resposta, pedido: a.pedido, aprovadaQualityGate: true,
      manifesto: { selecionados: [{ tipo: 'anexo', id: fonteA.id, status: 'ANALISADA', cobertura: { percentualIncluido: 100 } }] },
    });
    assert.equal(direta.fontes.length, 0);
    assert.ok(direta.avisos.some(s => s.includes('SOURCE_BEHAVIOR_CONTRADICTION')));
    assert.ok(!direta.avisos.some(s => s.includes('ANCORA_AUSENTE')), 'a geração também faz a prova antes das âncoras');
    respostaDoProvider = a.resposta; verificacoes = [];
    const mA = await investigar(atA, a.pedido, [fonteA.id]);
    const execRepo = require('../backend/repositories/investigacao-execucao-repository');
    const eA = execRepo.listarPorAtendimento(EMPRESA_A, atA.id)[0];
    assert.equal(eA.qualityGate.aprovado, false);
    assert.ok(eA.qualityGate.falhas.some(f => f.codigo === 'SOURCE_BEHAVIOR_CONTRADICTION'), JSON.stringify(eA.qualityGate));
    assert.equal(mA.fontesCorrigidos.length, 0); assert.equal(verificacoes.length, 0);
    assert.ok(!mA.avisosFonteCorrigido.some(s => /ANCORA_AUSENTE/.test(s)), 'A não pode ser aprovado ou rejeitado pelo motivo técnico errado');
    const oA = await fetch(`${base}/api/ia-service/anexos/${fonteA.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await oA.arrayBuffer()), bytes);

    const b = fixture.cenarios[1], atB = criarAtendimento();
    const fonteB = await upload(atB, 'ValidacaoSintetica.prw', bytes);
    respostaDoProvider = b.resposta; respostaVerificador = b.verificador; verificacoes = [];
    const mB = await investigar(atB, b.pedido, [fonteB.id]);
    const eB = execRepo.listarPorAtendimento(EMPRESA_A, atB.id)[0];
    assert.equal(eB.qualityGate.aprovado, true, JSON.stringify(eB.qualityGate));
    assert.equal(mB.fontesCorrigidos.length, 1, JSON.stringify(mB.avisosFonteCorrigido));
    assert.equal(verificacoes.length, 0, 'B deve ser comprovado localmente sem depender do verificador que errou');
    const versao = mB.fontesCorrigidos[0].versao;
    assert.match(versao.explicacaoAlteracao, /sem contradição detectada/);
    assert.doesNotMatch(versao.explicacaoAlteracao, /inconclusiva|indisponível/);
    const { alteracoes } = extrairAlteracoes(b.resposta);
    const aplicado = aplicarAlteracoes({ buffer: bytes, encoding: 'utf-8', arquivo: 'ValidacaoSintetica.prw', alteracoes });
    assert.equal(aplicado.ok, true);
    const d = await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`, { headers });
    assert.equal(d.status, 200); assert.deepEqual(Buffer.from(await d.arrayBuffer()), aplicado.buffer);
    const oB = await fetch(`${base}/api/ia-service/anexos/${fonteB.id}/download`, { headers });
    assert.deepEqual(Buffer.from(await oB.arrayBuffer()), bytes);
    assert.equal((await fetch(`${base}/api/ia-service/anexos/${versao.id}/download`)).status, 401);
    assert.equal((await fetch(`${base}/api/ia-service-externo/anexos/${versao.id}/download`, { headers: { 'x-sessao-externa': 'empresa-b' } })).status, 404);
  } finally { respostaVerificador = SEM_CONTRADICAO; }
});

test('retorno antecipado sintético: diagnóstico e estrutura aprovados não autorizam arquivo com finalização desviada', async () => {
  const fixture = require('./fixtures/fontes-advpl-sinteticas');
  const insegura = fixture.saidaAntecipada;
  const bytes = Buffer.from(fixture.fonteOriginal);
  const at = criarAtendimento(), fonte = await upload(at, 'ValidacaoSintetica.prw', bytes);
  respostaDoProvider = insegura.resposta; verificacoes = [];
  const m = await investigar(at, fixture.cenarios[1].pedido, [fonte.id]);
  const execRepo = require('../backend/repositories/investigacao-execucao-repository');
  assert.equal(execRepo.listarPorAtendimento(EMPRESA_A, at.id)[0].qualityGate.aprovado, true, 'aprovação do diagnóstico é separada da aprovação do arquivo');
  assert.equal(m.fontesCorrigidos.length, 0);
  const decisao = m.avaliacoesFonteCorrigido[0];
  assert.equal(decisao.estado, 'reprovado'); assert.equal(decisao.codigo, 'FINALIZACAO_DESVIADA');
  assert.equal(decisao.etapas.diagnostico, 'aprovado'); assert.equal(decisao.etapas.estrutura, 'aprovada');
  assert.equal(decisao.etapas.fluxo.estado, 'reprovado'); assert.equal(decisao.disponibilizacao, false);
  assert.equal(decisao.etapas.causal, 'nao_avaliada'); assert.equal(verificacoes.length, 0, 'falha local de fluxo não deve chamar a IA');
  const salvo = require('../backend/repositories/mensagem-repository').getMensagem(EMPRESA_A, m.id);
  assert.deepEqual(salvo.diagnostico.validacaoFontes, m.avaliacoesFonteCorrigido);
  assertRespostaSegura(m);
  assert.equal(execRepo.listarPorAtendimento(EMPRESA_A, at.id)[0].qualityGate.validacaoFontes.respostaRejeitada, insegura.resposta, 'proposta bruta preservada na auditoria da execução');
  assert.equal(anexoRepo.listarAnexos(EMPRESA_A, at.id).length, 1, 'nenhuma versão reprovada pode receber ID para download');
  const d = await fetch(`${base}/api/ia-service/anexos/${fonte.id}/download`, { headers });
  assert.equal(d.status, 200); assert.deepEqual(Buffer.from(await d.arrayBuffer()), bytes);
});

test('estados inconclusivo, falha técnica e aprovado permanecem separados e persistidos', async () => {
  const fixture = require('./fixtures/fontes-advpl-sinteticas');
  const bytes = Buffer.from(fixture.fonteOriginal), b = fixture.cenarios[1];
  const { alteracoes } = extrairAlteracoes(b.resposta);
  for (const [tipo, resposta, esperado] of [
    ['fluxo incerto', respostaComBlocos(bloco('ValidacaoSintetica.prw', alteracoes[0].original, alteracoes[0].substituto.replace('\n    Else\n', '\n    Else\n        If &cCondicao\n        EndIf\n'))), 'inconclusivo'],
    ['âncora ausente', respostaComBlocos(bloco('ValidacaoSintetica.prw', 'If trechoInexistente', 'If .T.\nEndIf')), 'falha_tecnica'],
    ['correção comprovada', b.resposta, 'aprovado'],
  ]) {
    const at = criarAtendimento(), fonte = await upload(at, 'ValidacaoSintetica.prw', bytes);
    respostaDoProvider = resposta; verificacoes = [];
    const m = await investigar(at, b.pedido, [fonte.id]);
    const decisao = m.avaliacoesFonteCorrigido[0];
    assert.equal(decisao.estado, esperado, `${tipo}: ${JSON.stringify(m.avisosFonteCorrigido)}`);
    const aprovado = esperado === 'aprovado';
    assert.equal(decisao.disponibilizacao, aprovado); assert.equal(m.fontesCorrigidos.length, aprovado ? 1 : 0);
    const salvo = require('../backend/repositories/mensagem-repository').getMensagem(EMPRESA_A, m.id);
    assert.deepEqual(salvo.diagnostico.validacaoFontes, m.avaliacoesFonteCorrigido);
    assert.equal(anexoRepo.listarAnexos(EMPRESA_A, at.id).length, aprovado ? 2 : 1);
    if (aprovado) {
      assert.equal(decisao.etapas.causal, 'consistente'); assert.equal(decisao.etapas.fluxo.estado, 'aprovado');
      const d = await fetch(`${base}/api/ia-service/anexos/${m.fontesCorrigidos[0].versao.id}/download`, { headers });
      assert.equal(d.status, 200);
      const esperado = aplicarAlteracoes({ buffer: bytes, encoding: 'utf-8', arquivo: 'ValidacaoSintetica.prw', alteracoes });
      assert.deepEqual(Buffer.from(await d.arrayBuffer()), esperado.buffer);
    }
  }
});

test('geração desativada no servidor (ausente, "0" ou "true"): nenhum arquivo, aviso, análise e original preservados', async () => {
  const AVISO_DESATIVADA = 'A geração do arquivo corrigido está temporariamente indisponível. A proposta não está aprovada para aplicação; o código original permanece intacto.';
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
      assertRespostaSegura(m);
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

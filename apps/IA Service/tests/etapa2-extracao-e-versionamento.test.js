// Testes da Etapa 2 — partes determinísticas (sem chamar IA real): extração
// de conteúdo, parsing de seções da resposta estruturada, versionamento de
// fonte com diff, isolamento multiempresa em anexos/config de IA.
// Executar: node "apps/IA Service/tests/etapa2-extracao-e-versionamento.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SVC_DATA_CRYPTO_KEY (criptografia em repouso das chaves de IA, ver
// ai-config-repository.js) precisa estar disponível para o teste de
// isolamento multiempresa de ai_config mais abaixo — carrega o .env real do
// projeto, igual ao restante do sistema faz via require('dotenv').config()
// no bootstrap do servidor (este script standalone não passa por lá).
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-etapa2-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const aiConfigRepo = require('../backend/repositories/ai-config-repository');
const { extrairConteudo } = require('../backend/services/extracao-conteudo');
const { _extrairSecoes, _extrairNivelConfianca, _extrairFonteCorrigido } = require('../backend/services/investigacao-service');
const versaoFonteService = require('../backend/services/versao-fonte-service');

const EMPRESA_A = 9401;
const EMPRESA_B = 9402;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

try {
  // ── Extração de conteúdo: não confiar só na extensão (seção 5 do prompt) ─
  const sqlDisfarcado = extrairConteudo({
    buffer: Buffer.from("SELECT * FROM SA1010 WHERE D_E_L_E_T_ = ''"),
    nomeOriginal: 'consulta.txt',
    mimeDeclarado: 'text/plain',
  });
  assert.strictEqual(sqlDisfarcado.linguagemDetectada, 'sql', 'TXT contendo SQL deve ser identificado como sql, não texto comum');
  assert.strictEqual(sqlDisfarcado.eCodigo, true);

  const imagem = extrairConteudo({
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
    nomeOriginal: 'print.png',
    mimeDeclarado: 'image/png',
  });
  assert.strictEqual(imagem.ehImagem, true);
  assert.strictEqual(imagem.mimeReal, 'image/png');

  const mimeMentiroso = extrairConteudo({
    // Client declara PNG mas o conteúdo é texto puro — o MIME real deve
    // prevalecer sobre o declarado (magic number confirma que não é PNG).
    buffer: Buffer.from('isto nao e uma imagem'),
    nomeOriginal: 'fake.png',
    mimeDeclarado: 'image/png',
  });
  assert.notStrictEqual(mimeMentiroso.mimeReal, 'image/png', 'MIME declarado pelo cliente não deve ser confiado cegamente');

  // ── Setup: atendimento + anexo original de código para testar versionamento
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Erro no workflow apos customizacao.',
  });

  const anexoOriginal = anexoRepo.salvarMetadadosAnexo(EMPRESA_A, atendimento.id, {
    nomeOriginal: 'MeuWorkflow.prw',
    nomeInterno: 'uuid-fake-1.prw',
    mimeType: 'application/octet-stream',
    tamanho: 100,
    caminhoRelativo: `${EMPRESA_A}/${atendimento.id}/uuid-fake-1.prw`,
  });
  anexoRepo.atualizarExtracao(EMPRESA_A, anexoOriginal.id, {
    conteudoExtraido: 'User Function MeuWF()\nreturn .T.',
    linguagemDetectada: 'advpl',
    encodingDetectado: 'utf-8',
    eCodigo: true,
  });

  // ── Parsing de seções da resposta da IA (simulado — sem chamar IA real) ──
  const respostaSimulada = `**Diagnóstico**
O erro ocorre porque a função não valida o retorno nulo.

**Causa provável**
Causa confirmada: a variável cRet não é inicializada antes do uso.

**Evidências**
O log mostra "variable not initialized" na linha 5, que corresponde à chamada de cRet no fonte.

**Correção proposta**
Inicializar cRet como string vazia antes do uso.

**Fonte corrigido**
\`\`\`advpl
User Function MeuWF()
Local cRet := ""
return .T.
\`\`\`

**Alterações realizadas**
Adicionada inicialização de cRet.

**Validação**
Execute a atividade novamente no ambiente de homologação e confirme que o erro não ocorre mais.`;

  const secoes = _extrairSecoes(respostaSimulada);
  assert.ok(secoes, 'deve extrair seções da resposta estruturada');
  assert.match(secoes['Diagnóstico'], /não valida o retorno nulo/);
  assert.match(secoes['Causa provável'], /Causa confirmada/);
  assert.ok(secoes['Fonte corrigido'].includes('User Function MeuWF()'));

  const nivelConfianca = _extrairNivelConfianca(respostaSimulada);
  assert.strictEqual(nivelConfianca, 'causa confirmada');

  const fonteCorrigidoExtraido = _extrairFonteCorrigido(secoes);
  assert.ok(fonteCorrigidoExtraido.includes('Local cRet := ""'), 'deve extrair o bloco de código completo da seção Fonte corrigido');

  // ── Versionamento: original nunca sobrescrito, nova versão criada ────────
  const versaoCorrigida = versaoFonteService.criarVersaoCorrigida(EMPRESA_A, {
    anexoOriginalId: anexoOriginal.id,
    atendimentoId: atendimento.id,
    mensagemOrigemId: null,
    conteudoCorrigido: fonteCorrigidoExtraido,
    explicacaoAlteracao: secoes['Alterações realizadas'],
  });
  assert.notStrictEqual(versaoCorrigida.id, anexoOriginal.id, 'versão corrigida deve ser um novo registro, não sobrescrever o original');
  assert.strictEqual(versaoCorrigida.anexoOriginalId, anexoOriginal.id);

  const originalAposCorrecao = anexoRepo.getAnexo(EMPRESA_A, anexoOriginal.id);
  assert.strictEqual(originalAposCorrecao.conteudoExtraido, 'User Function MeuWF()\nreturn .T.', 'conteúdo original deve permanecer intacto após a correção');

  const versoes = versaoFonteService.listarVersoes(EMPRESA_A, anexoOriginal.id);
  assert.strictEqual(versoes.length, 2, 'deve haver 2 versões: original + corrigida');
  assert.strictEqual(versoes[0].id, anexoOriginal.id);
  assert.strictEqual(versoes[1].id, versaoCorrigida.id);

  const diff = versaoFonteService.calcularDiff(originalAposCorrecao.conteudoExtraido, versaoCorrigida.conteudoExtraido);
  const linhaAdicionada = diff.find(l => l.tipo === 'adicionada' && l.texto.includes('Local cRet'));
  assert.ok(linhaAdicionada, 'diff deve identificar a linha adicionada na correção');

  // ── Isolamento multiempresa: anexo/versão da empresa A não vaza pra B ────
  assert.throws(
    () => versaoFonteService.listarVersoes(EMPRESA_B, anexoOriginal.id),
    /não encontrado/i,
    'empresa B não deve conseguir listar versões de anexo da empresa A'
  );

  // ── ai_config: isolamento multiempresa e nunca expor chaves cruas ────────
  aiConfigRepo.salvarConfig(EMPRESA_A, { groqApiKey: 'chave-fake-empresa-a', provedorPrimario: 'groq' });
  const configA = aiConfigRepo.getConfig(EMPRESA_A);
  assert.strictEqual(configA.groqApiKey, 'chave-fake-empresa-a');
  const configB = aiConfigRepo.getConfig(EMPRESA_B);
  assert.strictEqual(configB, null, 'empresa B não deve ter config vazada da empresa A');

  console.log('etapa2-extracao-e-versionamento.test.js: ok (todos os asserts passaram)');
} finally {
  limparEDesligar();
}

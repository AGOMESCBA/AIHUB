// Ambiente de teste: exercita o mecanismo de fonte corrigido (desativado por padrão no servidor).
process.env.SVC_ALLOW_FONTE_CORRIGIDO = '1';
﻿// Correcoes pos-auditoria Claude Code - A1, M1 e M2.
// Executar: node "apps/IA Service/tests/fase1-fase2-pos-auditoria.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-pos-auditoria-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const investigacaoDossieAtualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const investigacaoService = require('../backend/services/investigacao-service');
const respostaOperacionalService = require('../backend/services/resposta-operacional-service');
const qualityGate = require('../backend/services/quality-gate-service');
const armazenamento = require('../backend/services/armazenamento-anexos');

const EMPRESA = 98201;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function fakeProviderResponse(texto) {
  const res = new Readable({ read() {} });
  res.statusCode = 200;
  res.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    res.emit('data', Buffer.from(JSON.stringify({
      choices: [{ message: { content: texto }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 80 },
    })));
    res.emit('end');
  });
  return res;
}

async function comIAFake(textoResposta, fn) {
  const oldResolver = aiConfigService.resolverKeysEOrdem;
  const oldPesquisar = technicalResearchService.pesquisar;
  const oldFormatar = technicalResearchService.formatarContextoParaPrompt;
  const oldAtualizarDossie = investigacaoDossieAtualizador.atualizarAposTurno;
  const oldRequest = https.request;

  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { groq: 'gsk-test' },
    cfg: { provedorPrimario: 'groq', fallbackOrdem: 'groq', modelos: { groq: 'openai/gpt-oss-20b' } },
  });
  technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'nao_pesquisado', resultados: [], paginasLidas: [] });
  technicalResearchService.formatarContextoParaPrompt = () => '';
  investigacaoDossieAtualizador.atualizarAposTurno = async () => ({ aplicado: false });
  https.request = (options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.write = () => {};
    req.end = () => process.nextTick(() => cb(fakeProviderResponse(textoResposta)));
    return req;
  };

  try {
    return await fn();
  } finally {
    aiConfigService.resolverKeysEOrdem = oldResolver;
    technicalResearchService.pesquisar = oldPesquisar;
    technicalResearchService.formatarContextoParaPrompt = oldFormatar;
    investigacaoDossieAtualizador.atualizarAposTurno = oldAtualizarDossie;
    https.request = oldRequest;
  }
}

function prepararArquivo(empresaId, atendimentoId, nome, conteudo) {
  const dir = path.join(armazenamento.ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dir, { recursive: true });
  const caminho = path.join(dir, nome);
  fs.writeFileSync(caminho, conteudo, 'utf8');
  return path.relative(armazenamento.ANEXOS_DIR, caminho).split(path.sep).join('/');
}

function criarAnexoCodigo(empresaId, atendimentoId, nome, conteudo) {
  const caminhoRelativo = prepararArquivo(empresaId, atendimentoId, nome, conteudo);
  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal: nome,
    nomeInterno: path.basename(caminhoRelativo),
    mimeType: 'text/plain',
    tamanho: Buffer.byteLength(conteudo, 'utf8'),
    caminhoRelativo,
    conteudoExtraido: conteudo,
    linguagemDetectada: 'advpl',
    encodingDetectado: 'utf-8',
    eCodigo: true,
  });
}

function respostaComFonteCorrigido() {
  return `O log mostra array out of bounds na ROTINA_A.PRW e os fontes anexados usam aItens[nPos]. A correcao tecnica e validar o indice antes do acesso ao array e compilar em homologacao reproduzindo a operacao original.

**Fonte corrigido**
\`\`\`iahub-alteracao
justificativa: valida o indice antes do acesso ao array
[[ORIGINAL]]
ConOut(aItens[nPos])
[[SUBSTITUTO]]
If nPos >= 1 .And. nPos <= Len(aItens)
  ConOut(aItens[nPos])
EndIf
[[FIM]]
\`\`\`

**Validacao**
Compilar em homologacao e reproduzir a operacao que gerava o erro.`;
}

function manifestoComEvidencia() {
  return {
    selecionados: [{
      id: 'log-1',
      tipo: 'anexo',
      nome: 'erro.log',
      status: 'ANALISADA',
      trecho: 'ERROR array out of bounds na ROTINA_A.PRW linha 42',
    }],
    omitidos: [],
  };
}

function assertSemFalha(gate, codigo, msg) {
  assert.ok(!(gate.falhas || []).some(f => f.codigo === codigo), msg);
}

async function main() {
  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Erro array out of bounds em rotina ADVPL.',
    });
    const prwA = criarAnexoCodigo(EMPRESA, atendimento.id, 'ROTINA_A.PRW', 'User Function ROTINA_A()\nLocal aItens := {}\nLocal nPos := 1\nConOut(aItens[nPos])\nReturn');
    const prwB = criarAnexoCodigo(EMPRESA, atendimento.id, 'ROTINA_B.PRW', 'User Function ROTINA_B()\nReturn');

    const resposta = await comIAFake(respostaComFonteCorrigido(), () => investigacaoService.processarTurno(EMPRESA, atendimento.id, {
      texto: 'Analise os dois fontes e proponha a correÃ§Ã£o.',
      usuarioId: null,
      anexoIds: [prwA.id, prwB.id],
    }));

    assert.strictEqual(resposta.fontesCorrigidos.length, 0, 'M1: ambiguidade nao deve gerar arquivo arbitrario');
    assert.ok(resposta.avisosFonteCorrigido.some(a => /mais de um fonte/i.test(a)), 'M1: resposta imediata deve trazer aviso');

    const mensagensPersistidas = mensagemRepo.listarMensagens(EMPRESA, atendimento.id);
    const assistenteReaberto = mensagensPersistidas.find(m => m.id === resposta.id);
    assert.ok(assistenteReaberto.avisosFonteCorrigido.some(a => /mais de um fonte/i.test(a)), 'M1: aviso deve sobreviver a listagem/reabertura');

    const viaRota = respostaOperacionalService.anexarFichaOperacional(assistenteReaberto);
    assert.ok(viaRota.avisosFonteCorrigido.some(a => /mais de um fonte/i.test(a)), 'M1: contrato de API deve manter avisos para Atendimento V1/Radar');
    assert.ok(viaRota.respostaOperacional.avisos.some(a => /mais de um fonte/i.test(a)), 'M1: ficha operacional deve receber avisos persistidos');

    const respostasComAcao = [
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Corrija a validaÃ§Ã£o de Ã­ndice e compile em homologaÃ§Ã£o.',
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Corrigir a validaÃ§Ã£o de Ã­ndice e compilar em homologaÃ§Ã£o.',
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Corrige a validaÃ§Ã£o de Ã­ndice e teste em homologaÃ§Ã£o.',
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Fonte corrigido gerado; valide compilando em homologaÃ§Ã£o.',
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Executar o teste de reproduÃ§Ã£o apÃ³s aplicar a correÃ§Ã£o.',
      'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW. Verificar o Ã­ndice antes de acessar o array e validar o fluxo.',
    ];
    for (const texto of respostasComAcao) {
      const gate = qualityGate.avaliarResposta({ textoResposta: texto, manifesto: manifestoComEvidencia() });
      assertSemFalha(gate, 'EVIDENCE_WITHOUT_NEXT_ACTION', `A1: nao deve acusar ausencia de proximo passo em: ${texto}`);
    }

    const semAcao = qualityGate.avaliarResposta({
      textoResposta: 'A evidÃªncia do log mostra array out of bounds na ROTINA.PRW.',
      manifesto: manifestoComEvidencia(),
    });
    assert.ok(semAcao.falhas.some(f => f.codigo === 'EVIDENCE_WITHOUT_NEXT_ACTION'), 'A1: resposta sem acao continua bloqueada');

    const curtaCompleta = qualityGate.avaliarResposta({
      textoResposta: 'Log indica array out of bounds na ROTINA.PRW linha 42. Corrigir validaÃ§Ã£o do Ã­ndice e compilar em homologaÃ§Ã£o reproduzindo o mesmo fluxo.',
      manifesto: manifestoComEvidencia(),
    });
    assertSemFalha(curtaCompleta, 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE', 'M2: resposta curta e tecnica completa nao deve ser tratada como generica');

    const curtaInconclusiva = qualityGate.avaliarResposta({
      textoResposta: 'EvidÃªncia insuficiente: envie o log completo e o fonte ROTINA.PRW para validar a hipÃ³tese.',
      manifesto: manifestoComEvidencia(),
    });
    assertSemFalha(curtaInconclusiva, 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE', 'M2: inconclusiva curta, mas acionavel, deve ser aceita');

    const curtaGenerica = qualityGate.avaliarResposta({
      textoResposta: 'Verifique os logs e envie mais informaÃ§Ãµes.',
      manifesto: manifestoComEvidencia(),
    });
    assert.ok(curtaGenerica.falhas.some(f => f.codigo === 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE'), 'M2: resposta curta generica continua rejeitada');

    console.log('fase1-fase2-pos-auditoria.test.js: ok');
  } finally {
    limparEDesligar();
  }
}

main().catch(err => {
  console.error(err);
  try { limparEDesligar(); } catch (_) {}
  process.exit(1);
});

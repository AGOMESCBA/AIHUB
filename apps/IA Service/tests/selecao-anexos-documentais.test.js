// Selecao de conteudo de anexos TEXTUAIS no Context Engine (2026-10, #036571):
// documentos normativos/funcionais nao podem ser reduzidos por heuristica de
// codigo-fonte; com orcamento entra o texto integral, sem orcamento entram os
// trechos relevantes, e a auditoria registra extraido/incluido/omitido.
// Executar: node "apps/IA Service/tests/selecao-anexos-documentais.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-selecao-docs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA = 9801;
const GROQ = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const OPENAI = { provider: 'openai', model: 'gpt-4o-mini' };

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function anexar(atendimento, nome, conteudo, { mimeType = 'application/pdf', linguagem = 'pdf', eCodigo = false } = {}) {
  const a = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: nome,
    nomeInterno: `${nome}-${Math.random().toString(36).slice(2)}`,
    mimeType,
    tamanho: Buffer.byteLength(conteudo),
    caminhoRelativo: `${EMPRESA}/${atendimento.id}/${nome}`,
  });
  return anexoRepo.atualizarExtracao(EMPRESA, a.id, { conteudoExtraido: conteudo, linguagemDetectada: linguagem, encodingDetectado: 'utf-8', eCodigo });
}

// Documento normativo: ~40k caracteres de texto corrido. Os trechos que
// importam ao chamado ficam no MEIO e em posicoes espalhadas; o resto e texto
// generico — inclusive com palavras que a heuristica de codigo tomaria por
// "estrutura" (selecionado, atualizado, classificacao, funcionalidade).
function criarDocumentoNormativo() {
  const ruido = i => `Paragrafo ${i}. Os valores selecionados devem ser atualizados conforme a classificacao e a funcionalidade descritas no leiaute geral aplicavel aos contribuintes em geral, sem prejuizo de regras especificas. `.repeat(6);
  const partes = ['NOTA TECNICA 012/2026 - ORIENTACAO PARA OS CONTRIBUINTES DE PIS COFINS', ''];
  for (let i = 0; i < 40; i++) {
    partes.push(ruido(i));
    partes.push('');
    if (i === 20) partes.push('4. Registros M220 e M620: os ajustes de contribuicao cumulativa devem ser informados nos registros M220 e M620 com o codigo de ajuste correspondente, mantido o CST original.', '');
    if (i === 28) partes.push('5. Registro C197: o ajuste da escrituracao fiscal deve gerar o registro C197 e o registro E115 conforme a TES 503, 603, 605 e 651 da apuracao.', '');
    if (i === 36) partes.push('6. Procedimento no Protheus: configurar a TES e o parametro da apuracao cumulativa antes de gerar o arquivo da EFD Contribuicoes.', '');
  }
  partes.push('Fim da nota tecnica. Brasilia, 2026.');
  return partes.join('\n');
}

function criarCenario() {
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'manual',
    canalEntrada: 'web',
    conteudoBruto: 'Adequacao do Protheus PIS COFINS regime cumulativo: registros M220 M620 C197 E115 nas TES 503 603 605 651.',
  });
  for (let i = 0; i < 4; i++) {
    mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: i % 2 ? 'assistant' : 'user', conteudo: `Mensagem ${i} sobre a adequacao PIS COFINS.` });
  }
  return atendimento;
}

function montar(atendimento, candidato, { turno = true, extra = {} } = {}) {
  const anexos = anexoRepo.listarAnexos(EMPRESA, atendimento.id);
  return contextEngine.montarContextoInvestigacao({
    atendimento,
    mensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 100 }),
    mensagemAtual: 'Revise todo o historico, anexos e fontes disponiveis e pesquise uma solucao para este chamado.',
    anexosDoTurno: turno ? anexos : [],
    anexosComoContexto: turno,
    pesquisaTecnicaTexto: '',
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { provedorPrimario: candidato.provider, modelos: { [candidato.provider]: candidato.model } },
    candidatoOrcamento: candidato,
    ...extra,
  });
}

const sel = (ctx, nome) => ctx.manifesto.selecionados.find(s => s.nome === nome);

function testarDocumentoIntegralComOrcamento() {
  const at = criarCenario();
  const doc = criarDocumentoNormativo();
  assert.ok(doc.length > 30000 && doc.length < 80000, 'documento de teste deve passar do antigo teto de 14.000 e caber no teto novo');
  anexar(at, 'nota-tecnica.pdf', doc);
  const ctx = montar(at, OPENAI);
  const s = sel(ctx, 'nota-tecnica.pdf');
  assert.strictEqual(s.status, 'ANALISADA');
  assert.strictEqual(s.cobertura.estrategia, 'integral');
  assert.strictEqual(s.cobertura.extraidoChars, doc.length);
  assert.strictEqual(s.cobertura.incluidoChars, doc.length);
  assert.strictEqual(s.cobertura.omitidoChars, 0);
  assert.strictEqual(s.cobertura.percentualIncluido, 100);
  assert.ok(ctx.userPrompt.includes('registro C197 e o registro E115'), 'texto integral deve conter o trecho do meio');
  assert.ok(ctx.userPrompt.includes('Fim da nota tecnica'), 'texto integral deve conter o final');
}

function testarDocumentoReduzidoPreservaReferencias() {
  const at = criarCenario();
  const doc = criarDocumentoNormativo();
  anexar(at, 'nota-tecnica.pdf', doc);
  const ctx = montar(at, GROQ); // orcamento minimo (piso)
  const s = sel(ctx, 'nota-tecnica.pdf');
  assert.strictEqual(s.status, 'PARCIALMENTE_ANALISADA');
  assert.strictEqual(s.cobertura.estrategia, 'trechos_documento');
  assert.strictEqual(s.cobertura.extraidoChars, doc.length);
  assert.ok(s.cobertura.incluidoChars > 0 && s.cobertura.incluidoChars < doc.length);
  assert.strictEqual(s.cobertura.incluidoChars + s.cobertura.omitidoChars, doc.length, 'incluido + omitido deve fechar com o extraido');
  assert.ok(s.cobertura.trechosIncluidos.length > 1, 'trechos nao contiguos devem ser registrados');
  assert.ok(s.cobertura.motivoReducao);
  // Os trechos que carregam as referencias tecnicas do chamado sobrevivem...
  assert.ok(ctx.userPrompt.includes('Registros M220 e M620'), 'trecho M220/M620 deve ser preservado');
  assert.ok(ctx.userPrompt.includes('registro C197 e o registro E115'), 'trecho C197/E115 deve ser preservado');
  assert.ok(ctx.userPrompt.includes('NOTA TECNICA 012/2026'), 'titulo/inicio deve ser preservado');
  // ...e as lacunas sao marcadas explicitamente, com posicao.
  assert.ok(/\[\.\.\.trecho omitido: posicoes \d+-\d+ de \d+ caracteres\.\.\.\]/.test(ctx.userPrompt));
  // Reducao controlada: nao passa da garantia de anexo critico (~3.500 tokens).
  assert.ok(s.tokensEstimados <= 3600, `tokens do documento reduzido: ${s.tokensEstimados}`);
}

function testarDocumentoNaoUsaHeuristicaDeCodigo() {
  // Documento onde SO as linhas "de codigo" (select/update/class...) existem e
  // nenhuma referencia do chamado: a selecao nao deve ser feita por elas.
  const at = criarCenario();
  const linhas = [];
  for (let i = 0; i < 400; i++) {
    linhas.push(`Item ${i}: o valor selecionado e atualizado conforme a classe de classificacao aplicavel ao grupo ${i}.`);
  }
  linhas.splice(300, 0, 'IMPORTANTE: o registro M220 deve ser apurado no regime cumulativo com o codigo de ajuste 01.');
  anexar(at, 'regras.pdf', linhas.join('\n'));
  const ctx = montar(at, GROQ);
  const s = sel(ctx, 'regras.pdf');
  assert.ok(s.cobertura.estrategia === 'trechos_documento' || s.cobertura.estrategia === 'integral');
  assert.ok(ctx.userPrompt.includes('registro M220 deve ser apurado'), 'a referencia do chamado deve vencer o ruido que parece codigo');
  assert.ok(!/^\d+: Item/m.test(ctx.userPrompt), 'nao deve usar o formato de linhas numeradas do codigo-fonte');
}

function testarCodigoELogMantemComportamentoAnterior() {
  const at = criarCenario();
  const codigo = Array.from({ length: 900 }, (_, i) => `Static Function Rotina${i}()\n   cQuery := "SELECT * FROM SC7010 WHERE C7_NUM = '${i}'"\nReturn`).join('\n');
  anexar(at, 'fonte.prw', codigo, { mimeType: 'text/plain', linguagem: 'advpl', eCodigo: true });
  const log = [
    ...Array.from({ length: 900 }, (_, i) => `2026-10-02 INFO linha ${i}`),
    '2026-10-02 ERROR XPTO-900 falha',
    ...Array.from({ length: 900 }, (_, i) => `2026-10-02 INFO depois ${i}`),
  ].join('\n');
  anexar(at, 'erro.log', log, { mimeType: 'text/plain', linguagem: 'log' });
  const ctx = montar(at, OPENAI);
  const f = sel(ctx, 'fonte.prw');
  const l = sel(ctx, 'erro.log');
  assert.strictEqual(f.status, 'PARCIALMENTE_ANALISADA');
  assert.ok(/estruturas de codigo|inicio\/fim/.test(f.motivo + (f.cobertura.motivoReducao || '')) || f.cobertura.estrategia === 'trechos_codigo_ou_log');
  assert.strictEqual(l.status, 'PARCIALMENTE_ANALISADA');
  assert.ok(ctx.userPrompt.includes('XPTO-900 falha'), 'janela do log deve preservar a regiao do erro');
  assert.ok(f.cobertura.extraidoChars === codigo.length && l.cobertura.extraidoChars === log.length, 'auditoria tambem para codigo/log');
}

function testarTextoCorridoTxtEhDocumentoELogContinuaLog() {
  const at = criarCenario();
  const prosa = Array.from({ length: 200 }, (_, i) => `A secao ${i} descreve o procedimento de apuracao cumulativa dos registros M220 e C197 na rotina.`).join('\n');
  anexar(at, 'procedimento.txt', prosa, { mimeType: 'text/plain', linguagem: null });
  const logTxt = Array.from({ length: 800 }, (_, i) => `2026-10-02 10:00:${String(i % 60).padStart(2, '0')} ERROR falha ${i} Exception`).join('\n');
  anexar(at, 'saida.txt', logTxt, { mimeType: 'text/plain', linguagem: null });
  const ctx = montar(at, OPENAI);
  assert.strictEqual(sel(ctx, 'procedimento.txt').cobertura.estrategia, 'integral');
  assert.strictEqual(sel(ctx, 'saida.txt').cobertura.estrategia, 'trechos_codigo_ou_log');
}

function testarAnexoCurtoEOmissaoAuditada() {
  const at = criarCenario();
  anexar(at, 'curto.pdf', 'Documento curto com registro M220.');
  const ctx = montar(at, OPENAI);
  const s = sel(ctx, 'curto.pdf');
  assert.strictEqual(s.cobertura.estrategia, 'integral');
  assert.strictEqual(s.cobertura.percentualIncluido, 100);

  // Documento nao CRITICO (fora do turno), sem espaco no orcamento: omitido
  // com a auditoria de quanto foi extraido e que nada foi incluido.
  const at2 = criarCenario();
  for (let i = 0; i < 6; i++) anexar(at2, `doc-${i}.pdf`, `${criarDocumentoNormativo()}\nDocumento ${i} registro M220 C197.`);
  const ctx2 = montar(at2, GROQ, { turno: false });
  const omitidosDoc = ctx2.manifesto.omitidos.filter(o => o.tipo === 'anexo' && o.cobertura);
  const incluidos = ctx2.manifesto.selecionados.filter(s2 => s2.tipo === 'anexo');
  assert.ok(incluidos.length + omitidosDoc.length >= 1);
  for (const o of omitidosDoc) {
    assert.strictEqual(o.cobertura.incluidoChars, 0);
    assert.strictEqual(o.cobertura.omitidoChars, o.cobertura.extraidoChars);
  }
}

function main() {
  try {
    testarDocumentoIntegralComOrcamento();
    testarDocumentoReduzidoPreservaReferencias();
    testarDocumentoNaoUsaHeuristicaDeCodigo();
    testarCodigoELogMantemComportamentoAnterior();
    testarTextoCorridoTxtEhDocumentoELogContinuaLog();
    testarAnexoCurtoEOmissaoAuditada();
    console.log('selecao-anexos-documentais.test.js: ok (6 cenarios)');
  } finally {
    limparEDesligar();
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}

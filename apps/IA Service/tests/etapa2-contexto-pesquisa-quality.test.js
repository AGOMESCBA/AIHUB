// Testes determinísticos da Etapa 2 — motor de contexto, PDF textual,
// logs grandes, sanitização de pesquisa e Quality Gate. Não chama IA real.
// Executar: node "apps/IA Service/tests/etapa2-contexto-pesquisa-quality.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-etapa2-contexto-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const { extrairConteudo } = require('../backend/services/extracao-conteudo');
const { sanitizarConsultaExterna, pesquisar } = require('../backend/services/technical-research-service');
const qualityGate = require('../backend/services/quality-gate-service');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA = 9501;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function criarPdfBuffer(texto) {
  const safe = String(texto).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const objetos = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objetos) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objetos.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function salvarAnexo(atendimentoId, nomeOriginal, { mimeType = 'text/plain', conteudoExtraido = '', linguagemDetectada = 'log', eCodigo = false } = {}) {
  const anexo = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimentoId, {
    nomeOriginal,
    nomeInterno: `${nomeOriginal}-${Math.random().toString(36).slice(2)}`,
    mimeType,
    tamanho: Math.max(1, Buffer.byteLength(conteudoExtraido || nomeOriginal)),
    caminhoRelativo: `${EMPRESA}/${atendimentoId}/${nomeOriginal}`,
  });
  return anexoRepo.atualizarExtracao(EMPRESA, anexo.id, {
    conteudoExtraido,
    linguagemDetectada,
    encodingDetectado: 'utf-8',
    eCodigo,
  });
}

async function main() {
  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
      origem: 'manual',
      canalEntrada: 'web',
      conteudoBruto: 'Chamado Protheus com erro XPTO-900 no processamento.',
    });

    for (let i = 0; i < 16; i++) {
      mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
        papel: i % 2 ? 'assistant' : 'user',
        conteudo: i === 0
          ? 'Evidência inicial crítica: rotina MATA410 apresenta erro XPTO-900 ao confirmar pedido.'
          : `Mensagem administrativa ${i}`,
      });
    }

    const logGrande = [
      ...Array.from({ length: 900 }, (_, i) => `2026-10-02 INFO linha de ruido ${i}`),
      '2026-10-02 ERROR XPTO-900 falha na rotina MATA410',
      'Stack trace: U_PROCESSA -> FWFORMSTRUCTURE -> DBAccess',
      ...Array.from({ length: 900 }, (_, i) => `2026-10-02 INFO depois do erro ${i}`),
    ].join('\n');
    const logAntigo = salvarAnexo(atendimento.id, 'erro-antigo.log', { conteudoExtraido: logGrande, linguagemDetectada: 'log' });

    for (let i = 0; i < 10; i++) {
      salvarAnexo(atendimento.id, `anexo-${i}.txt`, { conteudoExtraido: `conteudo comum ${i}`, linguagemDetectada: null });
    }

    const imagem = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
      nomeOriginal: 'primeiro-print.png',
      nomeInterno: 'primeiro-print.png',
      mimeType: 'image/png',
      tamanho: 8,
      caminhoRelativo: `${EMPRESA}/${atendimento.id}/primeiro-print.png`,
    });

    const mensagens = mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 100 });
    const contexto = contextEngine.montarContextoInvestigacao({
      atendimento,
      mensagens,
      mensagemAtual: 'Compare o erro XPTO-900 com o erro-antigo.log e veja novamente o primeiro print.',
      anexosDoTurno: [],
      pesquisaTecnicaTexto: '',
      systemPrompt: promptBuilder.SYSTEM_PROMPT,
      cfg: { provedorPrimario: 'openai', modelos: { openai: 'gpt-4o-mini' } },
    });

    assert.ok(contexto.userPrompt.includes('Evidência inicial crítica'), 'mensagem antiga relevante deve ser recuperada');
    assert.ok(contexto.userPrompt.includes('XPTO-900 falha na rotina MATA410'), 'log grande deve preservar região do erro');
    assert.ok(contexto.userPrompt.includes('Stack trace'), 'stack trace do meio do log deve entrar');
    assert.ok(!contexto.userPrompt.includes('linha de ruido 1\n2026-10-02 INFO linha de ruido 2'), 'log grande não deve ser enviado como começo/fim bruto completo');
    assert.ok(contexto.imagensSelecionadas.some(a => a.id === imagem.id), 'imagem histórica referenciada deve ser reenviada');
    assert.ok(contexto.manifesto.omitidos.length > 0, 'manifesto deve registrar evidências omitidas por orçamento/relevância');
    assert.ok(contexto.manifesto.selecionados.some(e => e.id === logAntigo.id && e.status === 'PARCIALMENTE_ANALISADA'), 'log grande deve ser marcado como parcial');

    const contextoAnexosSincronizados = contextEngine.montarContextoInvestigacao({
      atendimento,
      mensagens,
      mensagemAtual: 'Revise todo o historico deste chamado e os anexos sincronizados e pesquise uma nova solucao.',
      anexosDoTurno: [imagem],
      anexosComoContexto: true,
      pesquisaTecnicaTexto: '',
      systemPrompt: promptBuilder.SYSTEM_PROMPT,
      cfg: { provedorPrimario: 'openai', modelos: { openai: 'gpt-4o-mini' } },
    });
    assert.ok(
      contextoAnexosSincronizados.imagensSelecionadas.some(a => a.id === imagem.id),
      'imagem sincronizada enviada como contexto deve ser analisada, nao omitida por baixa relevancia'
    );
    assert.ok(contextoAnexosSincronizados.userPrompt.includes('tom de conversa tecnica humana'), 'prompt final deve pedir conversa tecnica humana');
    assert.ok(!contextoAnexosSincronizados.userPrompt.includes('estruture a resposta conforme especificado'), 'prompt final nao deve puxar a IA para laudo formal');

    const atendimentoCustom = atendimentoRepo.criarAtendimento(EMPRESA, {
      origem: 'softexpert',
      canalEntrada: 'radar',
      conteudoBruto: 'Protheus | Impressao de nota fiscal: informacoes adicionais cortando no DANFE customizado.',
    });
    const prw = salvarAnexo(atendimentoCustom.id, 'danfeii_new.prw', {
      linguagemDetectada: 'advpl',
      eCodigo: true,
      conteudoExtraido: [
        '#INCLUDE "PROTHEUS.CH"',
        'User Function DANFEII_NEW()',
        'Local cTexto := SC5->C5_MENNOTA',
        'oPrn:Say(nLin, nCol, SubStr(cTexto, 1, 60))',
        'Return',
      ].join('\n'),
    });
    const contextoCustom = contextEngine.montarContextoInvestigacao({
      atendimento: atendimentoCustom,
      mensagens: [],
      mensagemAtual: 'Revise os anexos e sugira a correcao para a impressao da NF-e com informacoes adicionais cortando.',
      anexosDoTurno: [],
      anexosComoContexto: true,
      pesquisaTecnicaTexto: '',
      systemPrompt: promptBuilder.SYSTEM_PROMPT,
      cfg: { provedorPrimario: 'openai', modelos: { openai: 'gpt-4o-mini' } },
    });
    const evidenciaPrw = contextoCustom.manifesto.selecionados.find(e => e.id === prw.id);
    assert.ok(evidenciaPrw, 'PRW de customizacao deve entrar no contexto de chamado de impressao');
    assert.strictEqual(evidenciaPrw.prioridade, 'CRITICA', 'PRW de customizacao deve ser evidencia critica nesse tipo de chamado');
    assert.ok(contextoCustom.userPrompt.includes('DANFEII_NEW'), 'prompt deve incluir a rotina do PRW');
    assert.ok(contextoCustom.userPrompt.includes('SubStr(cTexto, 1, 60)'), 'prompt deve incluir o trecho que pode causar truncamento');

    const pdfBuffer = criarPdfBuffer('Manual tecnico: erro PDF-777 resolvido ajustando parametro MV_TESTE.');
    const pdf = await extrairConteudo({ buffer: pdfBuffer, nomeOriginal: 'manual.pdf', mimeDeclarado: 'application/pdf' });
    assert.strictEqual(pdf.linguagemDetectada, 'pdf');
    assert.match(pdf.conteudoExtraido, /PDF-777/);

    const consulta = sanitizarConsultaExterna('Cliente ACME token=abcd123456789 email user@example.com erro HTTP 500 endpoint /api/teste 192.168.0.10');
    assert.ok(!consulta.includes('user@example.com'));
    assert.ok(!consulta.includes('abcd123456789'));
    assert.ok(!consulta.includes('192.168.0.10'));
    assert.ok(consulta.includes('HTTP 500'));

    const oldSerper = process.env.SERPER_API_KEY;
    const oldBing = process.env.BING_SEARCH_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.BING_SEARCH_API_KEY;
    const pesquisaSemChave = await pesquisar({ texto: 'Protheus erro XPTO-900 MATA410' });
    assert.strictEqual(pesquisaSemChave.configurado, false);
    assert.strictEqual(pesquisaSemChave.modo, 'links');
    assert.deepStrictEqual(pesquisaSemChave.resultados, []);
    process.env.SERPER_API_KEY = oldSerper;
    process.env.BING_SEARCH_API_KEY = oldBing;

    const gate = qualityGate.avaliarResposta({
      textoResposta: 'Recomendo verificar os logs e enviar mais informações.',
      manifesto: contexto.manifesto,
      pesquisa: pesquisaSemChave,
      pergunta: 'analise o anexo e o print',
    });
    assert.strictEqual(gate.deveRetry, true);
    assert.ok(gate.falhas.some(f => f.codigo === 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE' || f.legado === 'RESPOSTA_GENERICA_COM_EVIDENCIA_DISPONIVEL'));

    const gatePesquisaReutilizada = qualityGate.avaliarResposta({
      textoResposta: 'Diagnostico: a fonte oficial reutilizada da TOTVS descreve o parametro MV_TPRTDSP e sera usada apenas como apoio externo.',
      manifesto: { selecionados: [], omitidos: [] },
      pesquisa: {
        configurado: true,
        modo: 'web',
        paginasLidas: [{ status: 'reutilizada', url: 'https://centraldeatendimento.totvs.com/hc/pt-br/articles/x', titulo: 'TOTVS' }],
      },
      pergunta: 'pesquise na documentacao oficial',
    });
    assert.ok(!gatePesquisaReutilizada.falhas.some(f => f.codigo === 'RESEARCH_FOUND_BUT_NOT_READ'), 'pagina reutilizada deve contar como fonte lida');
    assert.strictEqual(gatePesquisaReutilizada.criterios.paginasLidas, 1);

    const gateVisualGenerico = qualityGate.avaliarResposta({
      textoResposta: 'As imagens mostram percentuais incorretos e sugerem problema na rotina de rateio.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'imagem (28).png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints anexos',
    });
    assert.ok(gateVisualGenerico.falhas.some(f => f.codigo === 'VISUAL_EVIDENCE_TOO_GENERIC'), 'print analisado exige evidência visual concreta na resposta');

    const gateTemplateRobotico = qualityGate.avaliarResposta({
      textoResposta: [
        '**Diagnostico**',
        'O erro FWWHEN aparece no rateio.',
        '**Causa provavel**',
        'Pode haver atribuicao indevida.',
        '**Evidencias**',
        'Print com % Rateio.',
        '**Correcao proposta**',
        'Analisar melhor a rotina.',
        '**Validacao**',
        'Testar em homologacao.',
        '**Proximos passos**',
        'Agendar uma videochamada.',
      ].join('\n'),
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'reutilizada' }] },
      pergunta: 'pesquise uma nova solucao com base nos anexos',
    });
    assert.ok(gateTemplateRobotico.falhas.some(f => f.codigo === 'ROBOTIC_TEMPLATE_RESPONSE'), 'resposta em laudo formal deve acionar retry conversacional');

    const gateCorrecaoFraca = qualityGate.avaliarResposta({
      textoResposta: 'Olhando os prints, o caso merece uma analise mais detalhada. Sugiro agendar uma videochamada com o cliente para entender melhor o contexto e consultar a documentacao da TOTVS.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'pesquise uma nova solucao com base nos anexos',
    });
    assert.ok(gateCorrecaoFraca.falhas.some(f => f.codigo === 'WEAK_ACTIONABLE_CORRECTION'), 'correcao proposta generica deve ser recusada quando ha evidencias especificas');

    const gateErroEspecificoIgnorado = qualityGate.avaliarResposta({
      textoResposta: 'O ponto principal e a mensagem "Modo edição não respeitado. Valor não pode ser atribuído. (% Rateio)". O primeiro teste tecnico que eu faria agora e conferir os parametros MV_RATDESP e MV_TPRTDSP na documentacao.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'pesquise uma nova solucao com base nos anexos',
    });
    assert.ok(gateErroEspecificoIgnorado.falhas.some(f => f.codigo === 'SPECIFIC_ERROR_NOT_PRIORITIZED'), 'erro especifico de modo de edicao deve guiar a primeira acao antes de parametro generico');

    const historicoOperacional036596 = [
      { papel: 'user', conteudo: 'Abrir Fabrica e acompanhar retorno, esse desenvolvimento e de alta complexidade.' },
      { papel: 'user', conteudo: 'Favor Analista, solicitar uma agenda para video conferencia com o Cliente para analisarmos o problema.' },
      { papel: 'customer', conteudo: 'Foi realizado uma chamada via google meet na data de 28/09/2026, para demonstrar o problema relatado.' },
      { papel: 'user', conteudo: 'Retornando chamado para fabrica' },
    ];
    const gateAcaoOperacionalRedundante = qualityGate.avaliarResposta({
      textoResposta: 'Se o erro persistir depois das verificacoes, recomendo abrir uma solicitacao para a equipe de desenvolvimento e agendar uma videochamada com o cliente.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: historicoOperacional036596,
    });
    assert.ok(gateAcaoOperacionalRedundante.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_ESCALATION'), 'encaminhamento ja feito a Fabrica/desenvolvimento nao deve ser recomendado como se fosse novo');
    assert.ok(gateAcaoOperacionalRedundante.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_MEETING'), 'meet ja realizado nao deve ser recomendado como se fosse novo');
    assert.strictEqual(gateAcaoOperacionalRedundante.deveRetry, true, 'reprovacao operacional media deve acionar retry corretivo normal do Quality Gate');

    const gateAcompanhamentoOperacional = qualityGate.avaliarResposta({
      textoResposta: 'Como o chamado ja foi retornado para Fabrica e a chamada via meet ja foi realizada, eu nao trataria isso como correcao concluida. O proximo passo e acompanhar o retorno da Fabrica e, tecnicamente, revisar o ponto de entrada/validacao que tenta atribuir % Rateio em modo protegido.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: historicoOperacional036596,
    });
    assert.ok(!gateAcompanhamentoOperacional.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_ESCALATION' || f.codigo === 'REDUNDANT_OPERATIONAL_MEETING'), 'reconhecer acao operacional ja feita e acompanhar pendencia deve ser permitido');

    const gateConfirmarFormalizacao = qualityGate.avaliarResposta({
      textoResposta: 'Antes de tratar como em desenvolvimento, eu confirmaria se a demanda foi formalizada com a Fabrica e qual protocolo ficou vinculado. Isso nao repete a abertura: valida a rastreabilidade do encaminhamento.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: [
        { papel: 'user', conteudo: 'Uma fabrica ira ser aberta.' },
      ],
    });
    assert.ok(!gateConfirmarFormalizacao.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_ESCALATION'), 'confirmar formalizacao nao comprovada deve ser permitido');

    const gateNovaReuniaoJustificada = qualityGate.avaliarResposta({
      textoResposta: 'A chamada via meet ja foi realizada, mas apareceu uma evidencia tecnica nova no print: o erro FWWHEN no campo % Rateio. Se o analista precisar reproduzir com o cliente, uma nova reuniao curta deve ser focada somente nesse passo e no log do momento da falha.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: historicoOperacional036596,
    });
    assert.ok(!gateNovaReuniaoJustificada.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_MEETING'), 'nova reuniao com justificativa tecnica nova deve ser permitida');

    const gateSemEncaminhamentoPrevio = qualityGate.avaliarResposta({
      textoResposta: 'Como nao ha indicio de encaminhamento anterior e o print mostra erro FWWHEN no % Rateio, se nao houver fonte/log disponivel eu abriria uma demanda para a Fabrica com os prints e o passo de reproducao.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: [
        { papel: 'customer', conteudo: 'O rateio fica incorreto e aparece erro no percentual.' },
      ],
    });
    assert.ok(!gateSemEncaminhamentoPrevio.falhas.some(f => f.codigo === 'REDUNDANT_OPERATIONAL_ESCALATION'), 'historico sem encaminhamento previo deve permitir recomendar encaminhamento');

    const gateEncaminhamentoNaoResolve = qualityGate.avaliarResposta({
      textoResposta: 'Como o chamado foi retornado para Fabrica, considero o problema solucionado e basta avisar o cliente.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'analise os prints e o historico',
      historicoMensagens: historicoOperacional036596,
    });
    assert.ok(gateEncaminhamentoNaoResolve.falhas.some(f => f.codigo === 'OPERATIONAL_ESCALATION_TREATED_AS_RESOLUTION'), 'encaminhamento sem resolucao comprovada nao pode ser tratado como problema solucionado');

    const gateIdsInternos = qualityGate.avaliarResposta({
      textoResposta: 'Mensagens de log 979745a0-c8f4-4de7-916f-954bd8a6cc72 confirmam que o erro veio do Protheus.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'pesquise uma nova solucao com base nos anexos',
    });
    assert.ok(gateIdsInternos.falhas.some(f => f.codigo === 'INTERNAL_IDS_USED_AS_EVIDENCE'), 'ids internos nao podem virar evidencia/log na resposta');

    const gateDescartaCustomizacao = qualityGate.avaliarResposta({
      textoResposta: 'A mensagem indica que o erro e gerado pelo proprio Protheus, nao por customizacao.',
      manifesto: { selecionados: [{ status: 'ANALISADA', tipo: 'imagem', nome: 'rateio.png' }], omitidos: [] },
      pesquisa: { configurado: true, modo: 'web', paginasLidas: [{ status: 'lida' }] },
      pergunta: 'pesquise uma nova solucao com base nos anexos',
    });
    assert.ok(gateDescartaCustomizacao.falhas.some(f => f.codigo === 'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG'), 'nao deve descartar customizacao sem fonte/log/codigo');

    console.log('etapa2-contexto-pesquisa-quality.test.js: ok');
  } finally {
    limparEDesligar();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

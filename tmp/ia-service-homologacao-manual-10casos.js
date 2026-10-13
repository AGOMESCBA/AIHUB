'use strict';

require('dotenv').config({ path: 'c:/Apps/iahub/.env' });

const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/tmp/ia-service-auditoria-independente-10casos.db';
const OUT_DIR = 'C:/tmp/ia-service-auditoria-independente-10casos-resultados';

const CASOS = (process.env.CASOS_FILTRO ? process.env.CASOS_FILTRO.split(',') : null);
const TODOS_CASOS = [
  { numero: '036381', atendimentoId: '2b885e86-7b0a-446d-ba33-1c5000551103', categoria: 'SoftExpert + duvida sistemica sem anexo' },
  { numero: '035398', atendimentoId: '7d5f8667-fa5b-4832-ab30-b642689afced', categoria: 'Faturamento + documentacao tecnica PDF (DOC044)' },
  { numero: '035635', atendimentoId: '4ef8f670-d6d9-471d-93e2-bd9db0e3ab3a', categoria: 'Financeiro + varios PDFs (extratos)' },
  { numero: '033521', atendimentoId: '36f8b38c-4ff4-4aa4-a33b-5ed5c48892c5', categoria: 'Estoque + PDFs grandes (relatorios)' },
  { numero: '035068', atendimentoId: 'e7d7a4a2-fd29-4f14-9f59-f6265d2849e6', categoria: 'API/integracao + PDF + log' },
  { numero: '036166', atendimentoId: '93efaa19-6b9c-4edf-8d19-01fb58ae1af3', categoria: 'API/integracao + log, sem solucao confirmada' },
  { numero: '036558', atendimentoId: 'b8f1ccda-7d5b-4fb8-9857-29accd1a0620', categoria: 'Customizacao PRW (fonte) + prints' },
  { numero: '034178', atendimentoId: 'bc4357d6-5873-4289-993c-a4d30922456c', categoria: 'Configurador + multiplos prints' },
  { numero: '033910', atendimentoId: '2222c815-b5cf-4745-8797-8beafb87018f', categoria: 'SoftExpert + fonte PRW + prints' },
  { numero: '034658', atendimentoId: 'a4a75cca-b1d7-4550-ba4d-5129c8880265', categoria: 'SoftExpert + prints WhatsApp (erro critico)' },
];

const TEXTO_AUDITORIA = 'Faca a investigacao tecnica completa deste chamado com base no historico e nos anexos disponiveis. Aponte: problema investigado, fatos comprovados pelas evidencias, hipoteses de causa com nivel de confianca, lacunas que impedem uma conclusao definitiva, e o proximo teste/acao tecnica mais util para o consultor executar agora. Nao afirme ter visto conteudo de anexo que nao foi efetivamente analisado nesta chamada. Nao trate hipotese como causa confirmada sem evidencia direta.';

function log(...args) { console.log(new Date().toISOString(), ...args); }

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT_${label}_${ms}ms`)), ms)),
  ]);
}

function chamarAnthropicComBuffer(apiKey, model, systemPrompt, userPrompt, imagens) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const conteudoUser = imagens.length
      ? [{ type: 'text', text: userPrompt }, ...imagens.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } }))]
      : userPrompt;
    const bodyBuf = Buffer.from(JSON.stringify({
      model, system: systemPrompt, messages: [{ role: 'user', content: conteudoUser }], max_tokens: 6000, temperature: 0,
    }));
    const controller = new AbortController();
    const killTimer = setTimeout(() => controller.abort(), 85000);
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: controller.signal,
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        clearTimeout(killTimer);
        try {
          const parsed = JSON.parse(raw);
          const texto = Array.isArray(parsed.content) ? parsed.content.map(c => c.text || '').join('\n') : '';
          resolve({ texto, provider: 'claude', model, usage: parsed.usage || {} });
        } catch (e) { reject(new Error('parse fail: ' + raw.slice(0, 300))); }
      });
    });
    req.on('error', (err) => { clearTimeout(killTimer); reject(err); });
    req.write(bodyBuf);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const database = require('c:/Apps/iahub/apps/IA Service/backend/database');
  database.inicializarDB(DB_PATH);

  const aiConfigService = require('c:/Apps/iahub/apps/IA Service/backend/services/ai-config-service');
  const aiProviderClient = require('c:/Apps/iahub/apps/IA Service/backend/services/ai-provider-client');
  const technicalResearchService = require('c:/Apps/iahub/apps/IA Service/backend/services/technical-research-service');
  const contextEngine = require('c:/Apps/iahub/apps/IA Service/backend/services/context-engine');
  const promptBuilder = require('c:/Apps/iahub/apps/IA Service/backend/services/prompt-builder');
  const qualityGateService = require('c:/Apps/iahub/apps/IA Service/backend/services/quality-gate-service');
  const atendimentoService = require('c:/Apps/iahub/apps/IA Service/backend/services/atendimento-service');
  const mensagemRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/anexo-repository');
  const chamadoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/chamado-repository');
  const dossieContextService = require('c:/Apps/iahub/apps/IA Service/backend/services/dossie-context-service');
  const tokenBudget = require('c:/Apps/iahub/apps/IA Service/backend/services/token-budget-service');
  const pdfVisualService = require('c:/Apps/iahub/apps/IA Service/backend/services/pdf-visual-service');
  const armazenamento = require('c:/Apps/iahub/apps/IA Service/backend/services/armazenamento-anexos');

  const EMPRESA_ID = 1;
  const resultados = [];
  const listaCasos = CASOS
    ? TODOS_CASOS.filter(c => CASOS.includes(c.numero))
    : TODOS_CASOS;

  for (const caso of listaCasos) {
    log(`\n=== ${caso.numero} (${caso.categoria}) ===`);
    const inicioCaso = Date.now();
    const item = { numero: caso.numero, categoria: caso.categoria, atendimentoId: caso.atendimentoId };
    try {
      const atendimento = atendimentoService.getAtendimento(EMPRESA_ID, caso.atendimentoId);
      const historico = mensagemRepo.listarMensagens(EMPRESA_ID, caso.atendimentoId);
      const anexosDoTurno = anexoRepo.listarAnexos(EMPRESA_ID, caso.atendimentoId);
      const { keys, cfg } = aiConfigService.resolverKeysEOrdem(EMPRESA_ID);

      log('  pesquisa tecnica...');
      let pesquisaTecnica = null;
      let pesquisaTecnicaTexto = '';
      let relacionados = [];
      try {
        const chamado = atendimento.referenciaExterna
          ? chamadoRepo.getChamadoPorNumero(EMPRESA_ID, atendimento.referenciaExterna, atendimento.origem)
          : null;
        relacionados = chamado ? chamadoRepo.listarChamadosRelacionados(EMPRESA_ID, chamado.id, { limite: 5 }) : [];
        const searchConfig = aiConfigService.resolverConfigPesquisa(EMPRESA_ID);
        pesquisaTecnica = await withTimeout(technicalResearchService.pesquisar({
          empresaId: EMPRESA_ID,
          atendimentoId: caso.atendimentoId,
          chamado,
          atendimento,
          mensagens: historico,
          anexos: anexosDoTurno.filter(a => a.conteudoExtraido),
          texto: TEXTO_AUDITORIA,
          dossieOperacional: null,
          forcarPesquisa: true,
          disciplina4B: true,
        }, { searchConfig }), 60000, 'PESQUISA');
        pesquisaTecnicaTexto = technicalResearchService.formatarContextoParaPrompt(pesquisaTecnica, relacionados);
        log('  pesquisa OK, paginas lidas:', (pesquisaTecnica.paginasLidas || []).filter(p => p.status === 'lida' || p.status === 'reutilizada').length);
      } catch (err) {
        log('  pesquisa FALHOU/timeout:', err.message);
        pesquisaTecnicaTexto = `## Pesquisa tecnica assistida\nPesquisa tecnica indisponivel nesta tentativa: ${err.message}\nSiga com as evidencias locais do chamado.`;
      }

      log('  montando contexto...');
      const contexto = contextEngine.montarContextoInvestigacao({
        atendimento,
        mensagens: historico,
        mensagemAtual: TEXTO_AUDITORIA,
        anexosDoTurno,
        anexosComoContexto: true,
        pesquisaTecnicaTexto,
        pesquisa: pesquisaTecnica,
        relacionados,
        systemPrompt: promptBuilder.SYSTEM_PROMPT,
        cfg,
      });

      log('  carregando payload visual...', contexto.imagensSelecionadas.length, 'imagens,', contexto.pdfsVisuaisSelecionados.length, 'pdfs');
      const imagens = [];
      for (const anexo of contexto.imagensSelecionadas) {
        const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
        const buffer = fs.readFileSync(caminhoAbsoluto);
        imagens.push({ mimeType: anexo.mimeType, base64: buffer.toString('base64'), origem: 'imagem', anexoId: anexo.id });
      }
      for (const itemPdf of contexto.pdfsVisuaisSelecionados) {
        const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, itemPdf.anexo.caminhoRelativo);
        const buffer = fs.readFileSync(caminhoAbsoluto);
        const raster = await pdfVisualService.rasterizarPdfPaginas(buffer, itemPdf.paginas || [1]);
        if (!raster.erro) {
          for (const img of raster.imagens) imagens.push({ mimeType: img.mimeType, base64: img.base64, origem: 'pdf', anexoId: itemPdf.anexo.id, pagina: img.pagina });
        }
      }

      const timeoutMs = 45000 + imagens.length * 15000;
      log('  chamando IA principal (timeout', timeoutMs, 'ms)...');
      // ACHADO DE AUDITORIA: ai-provider-client.js:_httpPost usa req.write(bodyStr)
      // com string ao inves de Buffer, apesar de Content-Length ser calculado via
      // Buffer.byteLength. Com payloads grandes (>400KB, 5+ imagens base64) isso
      // trava indefinidamente de forma intermitente - confirmado isolando a mesma
      // chamada HTTPS com Buffer.from(body) explicito, que sempre funciona em ~15-20s.
      // Workaround usado SOMENTE nesta auditoria (nao altera o codigo de producao):
      // chamada direta via https com Buffer, replicando _chamarAnthropic.
      const resultado = await withTimeout(
        chamarAnthropicComBuffer(keys.claude, cfg.modelos.claude, promptBuilder.SYSTEM_PROMPT, contexto.userPrompt, imagens),
        90000,
        'IA_PRINCIPAL',
      );
      log('  IA respondeu via', resultado.provider, resultado.model, '- avaliando Quality Gate...');

      const qualityGate = qualityGateService.avaliarResposta({
        textoResposta: resultado.texto,
        manifesto: contexto.manifesto,
        pesquisa: pesquisaTecnica,
        pergunta: TEXTO_AUDITORIA,
        houveRetry: false,
        historicoMensagens: historico,
      });

      item.provider = resultado.provider;
      item.model = resultado.model;
      item.respostaTexto = resultado.texto;
      item.qualityGate = {
        aprovado: qualityGate.aprovado,
        deveRetry: qualityGate.deveRetry,
        falhas: (qualityGate.falhas || []).map(f => ({ codigo: f.codigo, decisionKind: f.decisionKind || f.categoriaDecisao, detalhe: f.detalhe })),
      };
      item.pesquisa = {
        modo: pesquisaTecnica?.modo || null,
        consultas: pesquisaTecnica?.consultasExecutadas || [],
        paginasLidas: (pesquisaTecnica?.paginasLidas || []).map(p => ({ titulo: p.titulo, url: p.url, status: p.status, oficial: !!p.oficial })),
      };
      item.manifesto = {
        anexosDisponiveis: contexto.manifesto.anexosDisponiveis,
        anexosSelecionados: contexto.manifesto.anexosSelecionados,
        imagensSelecionadas: contexto.manifesto.imagensSelecionadas,
        omitidos: contexto.manifesto.omitidos,
      };
      item.latenciaCasoMs = Date.now() - inicioCaso;
      log('  CONCLUIDO em', item.latenciaCasoMs, 'ms. QG aprovado:', qualityGate.aprovado, 'falhas:', item.qualityGate.falhas.map(f => f.codigo));
    } catch (err) {
      item.erro = err.message;
      item.latenciaCasoMs = Date.now() - inicioCaso;
      log('  ERRO:', err.message);
    }
    resultados.push(item);
    fs.writeFileSync(path.join(OUT_DIR, `${caso.numero}.json`), JSON.stringify(item, null, 2));
  }

  fs.writeFileSync(path.join(OUT_DIR, '_resumo.json'), JSON.stringify({ geradoEm: new Date().toISOString(), resultados }, null, 2));
  database.fecharDB();
  log('\nTODOS OS CASOS PROCESSADOS.');
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});

'use strict';
// Teste isolado de WhatsAppService.prototype._tentarResponderPedidoAnexo, sem conectar ao
// WhatsApp real. Cobre: pedido explicito, resposta numerica a oferta pendente, ambiguidade
// com outras pendencias concorrentes (entidade/filial), e ausencia de cache.

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const WhatsAppServiceModule = require(path.join(ROOT, 'modules/whatsapp/service'));
const whatsappQueryCache = require(path.join(ROOT, 'modules/whatsapp/whatsapp-query-cache'));
const whatsappResponseConfig = require(path.join(ROOT, 'modules/whatsapp/whatsapp-response-config'));

const EMPRESA_TESTE = -9994;

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_query_cache WHERE empresa_id = ?').run(EMPRESA_TESTE);
  getDB().prepare('DELETE FROM whatsapp_response_config WHERE empresa_id = ?').run(EMPRESA_TESTE);
  whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);
}
limpar();

const ServiceProto = WhatsAppServiceModule.prototype;
assert(typeof ServiceProto._tentarResponderPedidoAnexo === 'function');

function criarFakeSelf() {
  const senderContextMap = new Map();
  const mensagensEnviadas = [];
  const self = {
    log: () => {},
    _senderContextMap: senderContextMap,
    _getSenderContext(sender) { return senderContextMap.get(sender) || null; },
    _setSenderContext(sender, patch) {
      senderContextMap.set(sender, { ...(senderContextMap.get(sender) || {}), ...patch });
    },
    _gerarEEnviarAnexo: ServiceProto._gerarEEnviarAnexo,
    _enviarAnexoDecisao: ServiceProto._enviarAnexoDecisao,
    _sendReplyMessageSafe: async (chat, sender, texto) => { mensagensEnviadas.push(texto); },
    sendMediaMessage: async (sender, opts) => { mensagensEnviadas.push({ anexo: true, ...opts }); },
    _mensagensEnviadas: mensagensEnviadas,
  };
  return self;
}

async function rodar() {
  // 1. Sem nenhum pedido/pendencia — deve retornar null (segue fluxo normal de IA)
  {
    const self = criarFakeSelf();
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, 'faturamento de julho', '5599111@c.us', EMPRESA_TESTE);
    assert.strictEqual(resp, null, 'texto normal sem pedido de anexo deve retornar null');
  }

  // 2. Pedido explicito SEM cache — mensagem clara de "nao encontrei"
  {
    const self = criarFakeSelf();
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, 'manda em excel', '5599111@c.us', EMPRESA_TESTE);
    assert(resp && resp.includes('Não encontrei uma resposta com grade'), 'sem cache deve responder mensagem clara de ausencia de grade');
  }

  // 3. Pedido explicito COM cache — gera e envia sem passar por IA
  {
    const sender = '5599222@c.us';
    whatsappQueryCache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender, pergunta: 'faturamento por cliente', rows: [{ cliente: 'A', faturamento: 100 }], intent: {} });
    const self = criarFakeSelf();
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, 'quero o pdf dessa consulta', sender, EMPRESA_TESTE);
    assert(resp && resp.includes('PDF'), 'deve confirmar envio de PDF');
    assert(self._mensagensEnviadas.some(m => m && m.anexo && m.mimetype === 'application/pdf'), 'deve ter chamado sendMediaMessage com PDF');
  }

  // 4. "manda o arquivo" generico usa formato_padrao_anexo (default excel)
  {
    const sender = '5599333@c.us';
    whatsappQueryCache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender, pergunta: 'faturamento', rows: [{ cliente: 'B', faturamento: 50 }], intent: {} });
    const self = criarFakeSelf();
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, 'manda o arquivo', sender, EMPRESA_TESTE);
    assert(resp && resp.includes('Excel'), 'pedido generico deve usar formato_padrao_anexo (excel)');
  }

  // 5. Resposta "1" SEM oferta pendente — deve retornar null (nao interceptar)
  {
    const self = criarFakeSelf();
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, '1', '5599444@c.us', EMPRESA_TESTE);
    assert.strictEqual(resp, null, '"1" sem oferta pendente nao deve ser interceptado como pedido de anexo');
  }

  // 6. Resposta "2" COM oferta pendente — gera Excel a partir do cache guardado
  {
    const sender = '5599555@c.us';
    const cacheId = whatsappQueryCache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender, pergunta: 'faturamento', rows: [{ cliente: 'C', faturamento: 300 }], intent: {} });
    const self = criarFakeSelf();
    self._setSenderContext(sender, { _aguardandoRespostaAnexo: true, _anexoQueryCacheId: cacheId, _anexoEmpresaId: EMPRESA_TESTE });
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, '2', sender, EMPRESA_TESTE);
    assert(resp && resp.includes('Excel'), 'resposta "2" com oferta pendente deve gerar Excel');
    assert(self._mensagensEnviadas.some(m => m && m.anexo && m.mimetype.includes('spreadsheet')), 'deve ter enviado anexo Excel');
    assert.strictEqual(self._getSenderContext(sender)._aguardandoRespostaAnexo, false, 'deve limpar a flag de oferta pendente apos responder');
  }

  // 7. Resposta "3" (dispensa) COM oferta pendente — nao gera arquivo, limpa a flag
  {
    const sender = '5599666@c.us';
    const cacheId = whatsappQueryCache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender, pergunta: 'faturamento', rows: [{ cliente: 'D', faturamento: 10 }], intent: {} });
    const self = criarFakeSelf();
    self._setSenderContext(sender, { _aguardandoRespostaAnexo: true, _anexoQueryCacheId: cacheId, _anexoEmpresaId: EMPRESA_TESTE });
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, '3', sender, EMPRESA_TESTE);
    assert(resp && /combinado/i.test(resp), 'resposta "3" deve confirmar dispensa');
    assert.strictEqual(self._mensagensEnviadas.length, 0, 'nao deve gerar/enviar nenhum arquivo ao dispensar');
    assert.strictEqual(self._getSenderContext(sender)._aguardandoRespostaAnexo, false);
  }

  // 8. CRITICO — "1" com oferta pendente MAS TAMBEM com pendencia de entidade mais antiga:
  // a pendencia de entidade deve vencer (nao interceptar como pedido de anexo)
  {
    const sender = '5599777@c.us';
    const cacheId = whatsappQueryCache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender, pergunta: 'faturamento', rows: [{ cliente: 'E', faturamento: 1 }], intent: {} });
    const self = criarFakeSelf();
    self._setSenderContext(sender, {
      _aguardandoRespostaAnexo: true, _anexoQueryCacheId: cacheId, _anexoEmpresaId: EMPRESA_TESTE,
      _perguntaEntidadePendente: true,
    });
    const resp = await ServiceProto._tentarResponderPedidoAnexo.call(self, '1', sender, EMPRESA_TESTE);
    assert.strictEqual(resp, null, 'pendencia de entidade deve vencer sobre oferta de anexo — nao deve interceptar "1"');
  }

  // 9. Nao consome IA: garante que nenhuma dessas chamadas tocou classificador de intencao
  // (o fakeSelf nem define esse metodo — se fosse chamado, o teste quebraria com TypeError)
  console.log('(implicito nos testes acima: fakeSelf nao expoe classificador de intencao, nenhuma chamada falhou por metodo ausente)');

  limpar();
  console.log('whatsapp-pedido-anexo.test.js: ok');
}

rodar().catch(err => {
  console.error('FALHOU:', err);
  process.exit(1);
});

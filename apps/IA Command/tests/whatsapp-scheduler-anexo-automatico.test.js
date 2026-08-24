'use strict';
// Teste isolado de WhatsAppService.prototype.sendScheduledQuestionDelivery com anexo
// automatico, sem conectar ao WhatsApp real (mocka client/sendMessage/sendMediaMessage).

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const WhatsAppServiceModule = require(path.join(ROOT, 'modules/whatsapp/service'));
const whatsappResponseConfig = require(path.join(ROOT, 'modules/whatsapp/whatsapp-response-config'));
const channelStore = require(path.join(ROOT, 'modules/whatsapp/channel-store'));

const EMPRESA_TESTE = -9995;
const NUMERO_TESTE = '5599123456789';

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_response_config WHERE empresa_id = ?').run(EMPRESA_TESTE);
  whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);
}
limpar();

const ServiceProto = WhatsAppServiceModule.prototype;
assert(typeof ServiceProto.sendScheduledQuestionDelivery === 'function');

function criarFakeSelf() {
  const enviosTexto = [];
  const enviosMedia = [];
  return {
    log: () => {},
    client: { connected: true },
    status: 'connected',
    _empresaId: EMPRESA_TESTE,
    _formatScheduledDeliveryMessage: ({ resposta }) => resposta,
    sendMessage: async (numero, texto) => { enviosTexto.push({ numero, texto }); },
    _enviarAnexoDecisao: ServiceProto._enviarAnexoDecisao,
    sendMediaMessage: async (numero, opts) => { enviosMedia.push({ numero, ...opts }); },
    _enviosTexto: enviosTexto,
    _enviosMedia: enviosMedia,
  };
}

// Stub para nao depender de numero cadastrado de fato em whatsapp_allowed_numbers.
const originalSenderAutorizado = channelStore.senderAutorizadoEmpresa;
channelStore.senderAutorizadoEmpresa = () => true;

async function rodar() {
  // 1. Sem rows — comportamento identico ao atual (so texto)
  {
    const self = criarFakeSelf();
    await ServiceProto.sendScheduledQuestionDelivery.call(self, { empresaId: EMPRESA_TESTE, numero: NUMERO_TESTE, resposta: 'Resposta simples', ok: true });
    assert.strictEqual(self._enviosTexto.length, 1);
    assert.strictEqual(self._enviosMedia.length, 0, 'sem rows nao deve gerar nenhum anexo');
  }

  // 2. Com rows mas SEM config de anexo automatico — so texto (comportamento atual preservado)
  {
    const self = criarFakeSelf();
    const rows = [{ cliente: 'A', faturamento: 100 }];
    await ServiceProto.sendScheduledQuestionDelivery.call(self, { empresaId: EMPRESA_TESTE, numero: NUMERO_TESTE, resposta: 'Resposta com rows', ok: true, rows, intent: {} });
    assert.strictEqual(self._enviosTexto.length, 1);
    assert.strictEqual(self._enviosMedia.length, 0, 'sem config de anexo automatico nao deve anexar nada');
  }

  // 3. Com rows E config anexar_excel_automatico_acima_de — deve anexar Excel
  {
    const agora = new Date().toISOString();
    getDB().prepare(`
      INSERT INTO whatsapp_response_config (empresa_id, anexar_excel_automatico_acima_de, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?)
    `).run(EMPRESA_TESTE, 2, agora, agora);
    whatsappResponseConfig.invalidarCache(EMPRESA_TESTE);

    const self = criarFakeSelf();
    const rows = [{ cliente: 'A', faturamento: 100 }, { cliente: 'B', faturamento: 200 }, { cliente: 'C', faturamento: 300 }];
    await ServiceProto.sendScheduledQuestionDelivery.call(self, { empresaId: EMPRESA_TESTE, numero: NUMERO_TESTE, resposta: 'Resposta com anexo automatico', ok: true, rows, intent: { agrupar_por: 'cliente' } });
    assert.strictEqual(self._enviosTexto.length, 1, 'texto deve ser enviado independente do anexo');
    assert.strictEqual(self._enviosMedia.length, 1, 'com 3 rows e limiar=2, deve anexar Excel automaticamente');
    assert(self._enviosMedia[0].mimetype.includes('spreadsheet'));
  }

  // 4. Falha na geracao do anexo nao deve impedir o envio do texto (ja foi enviado antes)
  {
    const self = criarFakeSelf();
    self.sendMediaMessage = async () => { throw new Error('falha simulada de rede'); };
    const rows = [{ cliente: 'A', faturamento: 100 }, { cliente: 'B', faturamento: 200 }, { cliente: 'C', faturamento: 300 }];
    // nao deve lancar excecao
    await ServiceProto.sendScheduledQuestionDelivery.call(self, { empresaId: EMPRESA_TESTE, numero: NUMERO_TESTE, resposta: 'Resposta', ok: true, rows, intent: {} });
    assert.strictEqual(self._enviosTexto.length, 1, 'texto deve ter sido enviado mesmo com falha no anexo');
  }

  limpar();
  channelStore.senderAutorizadoEmpresa = originalSenderAutorizado;
  console.log('whatsapp-scheduler-anexo-automatico.test.js: ok');
}

rodar().catch(err => {
  channelStore.senderAutorizadoEmpresa = originalSenderAutorizado;
  console.error('FALHOU:', err);
  process.exit(1);
});

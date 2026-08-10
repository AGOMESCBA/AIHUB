// Orquestracao de mensagens do canal Protheus WhatsApp.
//
// Reaproveita o mesmo pipeline de IA usado pelo canal WhatsApp real — sem
// duplicar logica de intencao, roteamento ou seguranca. A unica diferenca de
// contrato e que aqui o "contexto anterior" vem da sessao persistida em SQLite
// (session-store.js), nao de estado em memoria, porque este canal e stateless
// por requisicao HTTP.
//
// intent._remetente recebe o celular do usuario Protheus — o MESMO campo que o
// canal WhatsApp usa hoje, entao vendedor-seguranca.js / cliente-seguranca.js e
// a tabela whatsapp_allowed_numbers continuam sendo a unica fonte de permissao,
// sem nenhuma alteracao.

const intentService = require('../ai/intent-service');
const intentMerger = require('../ai/intent-merger');
const intentRouter = require('../erp/core/intent-router');
const responseFormatter = require('../erp/core/response-formatter');
const sessionStore = require('./session-store');

async function processarMensagem({ empresaId, celular, sessaoId, texto }) {
  const contextoAnterior = sessionStore.ultimoIntent({ sessaoId });

  let intent = await intentService.classificar(texto, empresaId, {
    contextoAnterior,
    historicoResumido: null,
    tenantAliases: [],
  });

  intent._remetente = celular;
  intent._mensagemOriginal = texto;

  if (contextoAnterior) {
    intent = intentMerger.mesclar(intent, contextoAnterior, 0, texto, {});
  }

  const resultado = await intentRouter.rotear(intent, empresaId);
  const respostaTexto = responseFormatter.formatar(resultado, intent, { empresaId });

  sessionStore.salvarTurno({
    sessaoId,
    perguntaTexto: texto,
    respostaTexto,
    rows: Array.isArray(resultado?.rows) ? resultado.rows : null,
    tipoResultado: resultado?.tipo || null,
    intent,
  });

  return {
    texto: respostaTexto,
    rows: Array.isArray(resultado?.rows) ? resultado.rows : null,
    tipo: resultado?.tipo || null,
  };
}

module.exports = { processarMensagem };

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
const interpretationLog = require('../ai/interpretation-log');
const { getDB } = require('../database');

// Nome de campo cru do Protheus: prefixo de tabela (letra + ate 2 letras/digitos,
// ex: E2, A1, SB1) + underscore + resto (ex: E2_PREFIXO, A1_NOME, SB1_DESC).
// Prefixos de tabela Protheus tipicamente misturam letra e digito (E2, D2, C5),
// por isso [A-Z][A-Z0-9]{0,2} e nao so letras — regra testada contra os campos
// reais que motivaram esta funcao (E2_PREFIXO, E2_NUM). Sempre maiusculo, o que
// já distingue de alias amigavel gerado pela IA (minusculo, ex: numero_titulo).
const REGEX_CAMPO_CRU_PROTHEUS = /^[A-Z][A-Z0-9]{0,2}_[A-Z0-9]+$/;

// Mesma logica usada pelo canal WhatsApp real para rotular campos sem alias
// (ver labelsSx3ParaFormatacao em modules/erp/ia-owner/runner.js), mas aplicada
// diretamente as chaves de `rows` — la, o mapa so rotula texto ja formatado,
// sem renomear as rows entregues a este canal (que alimentam a grid).
function traduzirNomesCruesViaSx3(rows, empresaId) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const primeira = rows[0];
  const camposCrus = Object.keys(primeira).filter((k) => REGEX_CAMPO_CRU_PROTHEUS.test(k));
  if (!camposCrus.length) return rows;

  let conexao;
  try {
    conexao = getDB().prepare(
      "SELECT id FROM connections WHERE empresa_id = ? AND ativo = 1 AND erp = 'protheus' ORDER BY padrao DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
  } catch (_) {
    return rows;
  }
  if (!conexao) return rows;

  const placeholders = camposCrus.map(() => '?').join(',');
  let titulos;
  try {
    titulos = getDB().prepare(`
      SELECT campo, titulo FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ? AND campo IN (${placeholders})
    `).all(conexao.id, empresaId, ...camposCrus);
  } catch (_) {
    return rows;
  }
  if (!titulos.length) return rows;

  const renomeio = {};
  for (const { campo, titulo } of titulos) {
    if (titulo && titulo.trim()) renomeio[campo] = titulo.trim();
  }
  if (!Object.keys(renomeio).length) return rows;

  return rows.map((row) => {
    const nova = {};
    for (const [chave, valor] of Object.entries(row)) {
      nova[renomeio[chave] || chave] = valor;
    }
    return nova;
  });
}

async function processarMensagem({ empresaId, celular, sessaoId, texto }) {
  const t0 = Date.now();
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

  const rowsBrutas = Array.isArray(resultado?.rows) ? resultado.rows : null;
  const rows = rowsBrutas ? traduzirNomesCruesViaSx3(rowsBrutas, empresaId) : null;

  const mensagemId = sessionStore.salvarTurno({
    sessaoId,
    perguntaTexto: texto,
    respostaTexto,
    rows,
    tipoResultado: resultado?.tipo || null,
    intent,
  });

  // Mesmo registro usado pelo canal WhatsApp (interpretation-log.js) — alimenta
  // as telas de historico/auditoria de interpretacoes (admin-interpretacoes*.html).
  // Sem isso, conversas deste canal ficavam persistidas so em session-store.js
  // (sessao local do chat), invisiveis ao historico administrativo.
  try {
    interpretationLog.registrar({
      empresa_id: empresaId,
      usuario: celular,
      numero_wa: celular,
      texto_original: texto,
      intent,
      resultado,
      resposta_entregue: respostaTexto,
      duracao_ms: Date.now() - t0,
    });
  } catch (_) {
    // Falha ao logar nao pode derrubar a resposta ja calculada ao usuario.
  }

  return {
    mensagemId,
    texto: respostaTexto,
    rows,
    tipo: resultado?.tipo || null,
  };
}

module.exports = { processarMensagem };

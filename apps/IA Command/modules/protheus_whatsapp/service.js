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
const interpretationPipeline = require('../ai/interpretation-pipeline');
const { getDB } = require('../database');

// Nome de campo cru do Protheus: prefixo de tabela (letra + ate 2 letras/digitos,
// ex: E2, A1, SB1) + underscore + resto (ex: E2_PREFIXO, A1_NOME, SB1_DESC).
// Prefixos de tabela Protheus tipicamente misturam letra e digito (E2, D2, C5),
// por isso [A-Z][A-Z0-9]{0,2} e nao so letras — regra testada contra os campos
// reais que motivaram esta funcao (E2_PREFIXO, E2_NUM). Sempre maiusculo, o que
// já distingue de alias amigavel gerado pela IA (minusculo, ex: numero_titulo).
const REGEX_CAMPO_CRU_PROTHEUS = /^[A-Z][A-Z0-9]{0,2}_[A-Z0-9]+$/;
const SX3_LABEL_CACHE_TTL_MS = 5 * 60 * 1000;
const SX3_LABEL_CACHE_MAX = 200;
const sx3LabelCache = new Map();

function sx3CacheGet(key) {
  const item = sx3LabelCache.get(key);
  if (!item) return null;
  if (item.expiraEm <= Date.now()) {
    sx3LabelCache.delete(key);
    return null;
  }
  return item.valor;
}

function sx3CacheSet(key, valor) {
  sx3LabelCache.set(key, { valor, expiraEm: Date.now() + SX3_LABEL_CACHE_TTL_MS });
  if (sx3LabelCache.size > SX3_LABEL_CACHE_MAX) {
    const firstKey = sx3LabelCache.keys().next().value;
    if (firstKey) sx3LabelCache.delete(firstKey);
  }
  return valor;
}

// Mesmo padrao de deteccao de "RESET"/"limpar contexto" usado pelo canal
// WhatsApp real (ver _textoResetExplicito em modules/whatsapp/service.js) —
// copiado (nao importado) porque e uma funcao pequena e autocontida, e o
// arquivo do WhatsApp e critico o bastante para nao ganhar um export novo so
// para isso. Frase precisa ser curta e ISOLADA (^...$) para nao disparar em
// perguntas de negocio que mencionem essas palavras de outro jeito.
function textoResetExplicito(texto) {
  const t = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return /^(reset|\/reset|resetar|reiniciar|reinicia|recomecar|\/recomecar|limpar|limpar conversa|limpar tudo|limpar contexto|limpar cache|esquecer tudo|esqueca tudo|esquece tudo|nova conversa|novo inicio|comecar|comecar de novo|comecar novamente)$/.test(t);
}

// Mesma logica usada pelo canal WhatsApp real para rotular campos sem alias
// (ver labelsSx3ParaFormatacao em modules/erp/ia-owner/runner.js), mas aplicada
// diretamente as chaves de `rows` — la, o mapa so rotula texto ja formatado,
// sem renomear as rows entregues a este canal (que alimentam a grid).
function traduzirNomesCruesViaSx3(rows, empresaId) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const primeira = rows[0];
  const camposCrus = Object.keys(primeira).filter((k) => REGEX_CAMPO_CRU_PROTHEUS.test(k));
  if (!camposCrus.length) return rows;
  const camposOrdenados = camposCrus.slice().sort();
  const cacheKey = `${empresaId}::${camposOrdenados.join(',')}`;
  const renomeioCache = sx3CacheGet(cacheKey);
  if (renomeioCache) {
    if (!Object.keys(renomeioCache).length) return rows;
    return rows.map((row) => {
      const nova = {};
      for (const [chave, valor] of Object.entries(row)) {
        nova[renomeioCache[chave] || chave] = valor;
      }
      return nova;
    });
  }

  let conexao;
  try {
    conexao = getDB().prepare(
      "SELECT id FROM connections WHERE empresa_id = ? AND ativo = 1 AND erp = 'protheus' ORDER BY padrao DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
  } catch (_) {
    sx3CacheSet(cacheKey, {});
    return rows;
  }
  if (!conexao) {
    sx3CacheSet(cacheKey, {});
    return rows;
  }

  const placeholders = camposOrdenados.map(() => '?').join(',');
  let titulos;
  try {
    titulos = getDB().prepare(`
      SELECT campo, titulo FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ? AND campo IN (${placeholders})
    `).all(conexao.id, empresaId, ...camposOrdenados);
  } catch (_) {
    sx3CacheSet(cacheKey, {});
    return rows;
  }
  if (!titulos.length) {
    sx3CacheSet(cacheKey, {});
    return rows;
  }

  const renomeio = {};
  for (const { campo, titulo } of titulos) {
    if (titulo && titulo.trim()) renomeio[campo] = titulo.trim();
  }
  sx3CacheSet(cacheKey, renomeio);
  if (!Object.keys(renomeio).length) return rows;

  return rows.map((row) => {
    const nova = {};
    for (const [chave, valor] of Object.entries(row)) {
      nova[renomeio[chave] || chave] = valor;
    }
    return nova;
  });
}

function registrarInterpretacaoAsync(payload) {
  const executar = () => {
    try {
      interpretationPipeline.registrarInterpretacao(payload);
    } catch (e) {
      console.error('[protheus_whatsapp] Falha ao registrar interpretacao:', e.message);
    }
  };
  if (typeof setImmediate === 'function') setImmediate(executar);
  else setTimeout(executar, 0);
}

async function processarMensagem({ empresaId, celular, sessaoId, texto }) {
  // Comando "RESET"/"limpar contexto" — mesma deteccao do canal WhatsApp
  // real (textoResetExplicito acima), mas SEM apagar mensagens do historico
  // visual: diferente do WhatsApp (onde nao ha tela de conversa persistida),
  // aqui o usuario ve o historico completo na sidebar/chat, entao apagar
  // seria destrutivo e nao foi pedido — so o CONTEXTO (ultimoIntent) precisa
  // esquecer o que veio antes, exatamente o que o botao de reset no
  // cabecalho ja faz (sessionStore.resetarMemoria, ver routes.js). Retorna
  // direto, sem passar pelo pipeline de IA nem gravar interpretation_log —
  // nao e uma pergunta de negocio.
  if (textoResetExplicito(texto)) {
    sessionStore.resetarMemoria({ sessaoId });
    const respostaTextoReset = '🔄 *Contexto reiniciado!*\n\nEsqueci o que conversamos antes. Pode fazer uma nova pergunta.';
    const { perguntaId, respostaId } = sessionStore.salvarTurno({
      sessaoId,
      perguntaTexto: texto,
      respostaTexto: respostaTextoReset,
      rows: null,
      tipoResultado: null,
      intent: null,
    });
    return {
      mensagemId: respostaId,
      perguntaId,
      texto: respostaTextoReset,
      rows: null,
      temDados: false,
      rowsCount: 0,
      tipo: null,
    };
  }

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
  const rowsBrutas = Array.isArray(resultado?.rows) ? resultado.rows : null;
  const rows = rowsBrutas ? traduzirNomesCruesViaSx3(rowsBrutas, empresaId) : null;
  const resultadoFormatacao = rows ? { ...resultado, rows } : resultado;
  const respostaBase = responseFormatter.formatar(resultadoFormatacao, intent, { empresaId });
  const apresentacao = responseFormatter.montarApresentacaoResposta(respostaBase, resultadoFormatacao, intent, {
    empresaId,
    sugerirComparacao: true,
  });
  const respostaTexto = responseFormatter.textoApresentacao(apresentacao, respostaBase);

  const { perguntaId, respostaId } = sessionStore.salvarTurno({
    sessaoId,
    perguntaTexto: texto,
    respostaTexto,
    rows,
    tipoResultado: resultado?.tipo || null,
    intent,
  });

  // [UNIFICADO 13/08/2026] Mesmo pipeline de registro usado pelo canal
  // WhatsApp real (modules/ai/interpretation-pipeline.js, extraido de
  // modules/whatsapp/service.js#_registrarInterpretacao) — antes este canal
  // chamava interpretation-log.js direto com so 7 campos (sem timing, trace,
  // canal_id) e NUNCA gravava em execution_log, ficando invisivel para o
  // cache/aprendizado de SQL canonico que o WhatsApp usa. canalId fica null
  // (este canal nao tem conceito de canal multi-empresa como o WhatsApp).
  try {
    registrarInterpretacaoAsync({
      empresaId,
      sender: celular,
      texto,
      intent,
      resultado,
      resposta: respostaTexto,
      duracaoMs: Date.now() - t0,
      canalId: null,
      tipoMensagem: 'texto',
      onLog: (msg, nivel) => {
        const fn = nivel === 'warning' || nivel === 'warn' ? console.warn : console.log;
        fn('[protheus_whatsapp]', msg);
      },
    });
  } catch (e) {
    // Falha ao logar nao pode derrubar a resposta ja calculada ao usuario, mas precisa ficar
    // visivel — antes esse erro era engolido em silencio, escondendo falhas de gravacao.
    console.error('[protheus_whatsapp] Falha ao registrar interpretacao:', e.message);
  }

  return {
    mensagemId: respostaId,
    perguntaId,
    texto: respostaTexto,
    apresentacao,
    rows: null,
    temDados: Array.isArray(rows) && rows.length > 0,
    rowsCount: Array.isArray(rows) ? rows.length : 0,
    tipo: resultado?.tipo || null,
  };
}

module.exports = { processarMensagem };

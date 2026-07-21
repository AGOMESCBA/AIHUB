'use strict';

const aiProviderClient  = require('../../erp/core/ai-provider-client');
const chatHistory       = require('./chat-history');
const systemPromptBuilder = require('./system-prompt-builder');
const sqlValidator      = require('./sql-validator');

// ── Chat multi-turn com suporte nativo a todos os providers ──────────────────

async function _chamarChat(keys, cfg, messages, opts = {}) {
  const { _normalizarOrdem } = require('../../ai/intent-service');
  const ordem = _normalizarOrdem(cfg);
  const erros = [];

  for (const provedor of ordem) {
    if (!keys?.[provedor]) continue;
    const config = aiProviderClient.PROVIDER_CONFIGS[provedor];
    if (!config) continue;

    try {
      const apiKey    = keys[provedor];
      const maxTokens = opts.maxTokens || 2000;
      const timeout   = opts.timeoutMs || 35000;
      let resposta;

      if (config.tipo === 'openai_compat') {
        // Groq, OpenAI, DeepSeek — interface idêntica OpenAI
        const parsed = await aiProviderClient._httpPost(
          config.hostname,
          config.path,
          { Authorization: `Bearer ${apiKey}` },
          { model: opts.model || config.model, messages, temperature: 0, max_tokens: maxTokens },
          timeout
        );
        resposta = parsed.choices?.[0]?.message?.content;

      } else if (config.tipo === 'anthropic') {
        // Claude — system separado do histórico
        const systemMsg = messages.find(m => m.role === 'system');
        const chatMsgs  = messages.filter(m => m.role !== 'system');
        const parsed = await aiProviderClient._httpPost(
          config.hostname,
          config.path,
          { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          {
            model: opts.model || config.model,
            system: systemMsg?.content || '',
            messages: chatMsgs,
            max_tokens: maxTokens,
            temperature: 0,
          },
          timeout
        );
        resposta = Array.isArray(parsed.content)
          ? parsed.content.map(c => c.text || '').join('\n')
          : parsed.content?.[0]?.text;

      } else if (config.tipo === 'gemini') {
        // Gemini — converte roles: assistant → model
        const systemMsg = messages.find(m => m.role === 'system');
        const chatMsgs  = messages.filter(m => m.role !== 'system');
        const contents  = chatMsgs.map(m => ({
          role:  m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        const path = `/v1beta/models/${opts.model || config.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const parsed = await aiProviderClient._httpPost(
          config.hostname, path, {},
          {
            system_instruction: { parts: [{ text: systemMsg?.content || '' }] },
            contents,
            generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
          },
          timeout
        );
        resposta = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n');
      }

      if (!resposta) throw new Error(`Resposta vazia do ${provedor}.`);
      console.log(`[ChatService] SQL gerado via ${provedor} (${String(resposta).length} chars)`);
      return String(resposta).trim();

    } catch (e) {
      erros.push({ provedor, msg: e.message });
      console.warn(`[ChatService] ${provedor} falhou:`, e.message);
    }
  }

  const msg = erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ') || 'Nenhum provider disponível.';
  throw new Error(msg);
}

// ── Inferência de contexto a partir do SQL gerado ────────────────────────────
// Preenche os equivalentes dos campos do intent-merger para o fluxo chat-service,
// permitindo que _metaMonitorIntent exiba Contexto e Métricas corretamente.

function _inferirContextoChat({ mensagem, chatTurno, sql }) {
  const resultado = {};
  const temHistorico = chatTurno > 1;

  // Detecta referências temporais explícitas na mensagem
  const temDataNaMensagem = /\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:[çc]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?|semana|m[eê]s|ano|hoje|ontem|trimestre|\d{4})\b/i.test(mensagem);

  // Detecta referência ao módulo/assunto na mensagem
  const temModulo = /\b(compras?|faturamento|financeiro|comiss[aã]o|vendas?|notas?\s+fiscais?|nf\b|t[ií]tulos?|duplicatas?|pedidos?|receber|pagar)\b/i.test(mensagem);

  const palavras = mensagem.trim().split(/\s+/).length;

  // Herdou intenção: turno > 1 sem palavra-chave de módulo e mensagem curta (refinamento)
  if (temHistorico && !temModulo && palavras <= 12) {
    resultado._herdouIntencao = true;
  }

  // Herdou período: SQL tem BETWEEN com datas fixas, mas a mensagem não tem referência temporal
  if (temHistorico && !temDataNaMensagem && /BETWEEN\s+'[0-9]{8}'\s+AND\s+'[0-9]{8}'/i.test(sql || '')) {
    resultado._herdouPeriodo = true;
  }

  // Contexto aplicado: pelo menos uma dimensão foi herdada
  if (resultado._herdouIntencao || resultado._herdouPeriodo) {
    resultado._contextoAplicado = true;
  }

  // ── Métricas detectadas — análise dos campos SUM no SELECT ─────────────────
  const metricas = [];
  if (/SUM\s*\([^)]*(?:VALBRUT|VALFAT|D2_TOTAL)/i.test(sql || ''))       metricas.push('faturamento');
  if (/SUM\s*\([^)]*(?:E2_VALOR|E2_SALDO)/i.test(sql || ''))             metricas.push('contas_pagar');
  if (/SUM\s*\([^)]*(?:E1_VALOR|E1_SALDO)/i.test(sql || ''))             metricas.push('contas_receber');
  if (/SUM\s*\([^)]*(?:E3_COMIS|[._]COMIS)/i.test(sql || ''))            metricas.push('comissao');
  if (/SUM\s*\([^)]*(?:C7_TOTAL|D1_TOTAL)/i.test(sql || ''))             metricas.push('compras');
  if (/\/\s*NULLIF\s*\(\s*SUM|AVG\s*\(/i.test(sql || ''))                metricas.push('ticket_medio');
  if (/COUNT\s*\(/i.test(sql || ''))                                       metricas.push('contagem');
  if (metricas.length) resultado._metricasDetectadas = metricas;

  // ── Dimensão e granularidade — análise do GROUP BY ─────────────────────────
  const gbMatch = (sql || '').match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+HAVING|\s*;|\s*$)/i);
  if (gbMatch) {
    const gb = gbMatch[1];

    // Granularidade temporal
    if      (/SUBSTRING\s*\([^,]+,\s*1,\s*6\)/i.test(gb))             resultado._granularidadeDetectada = 'mes';
    else if (/SUBSTRING\s*\([^,]+,\s*1,\s*4\)/i.test(gb) || /\bYEAR\s*\(/i.test(gb)) resultado._granularidadeDetectada = 'ano';
    else if (/\b(?:EMISSAO|VENCTO|DATA)\b/i.test(gb))                  resultado._granularidadeDetectada = 'dia';

    // Dimensão de negócio (primeira encontrada)
    if      (/\bA1_COD\b|\bF2_CLIENTE\b|\bD2_CLIENTE\b|\bE1_CLIENTE\b/i.test(gb))  resultado._dimensaoDetectada = 'cliente';
    else if (/\bA2_COD\b|\bF1_FORNECE\b|\bD1_FORNECE\b|\bE2_FORNECE\b/i.test(gb)) resultado._dimensaoDetectada = 'fornecedor';
    else if (/\bA3_COD\b|\bF2_VEND1\b|\bE3_VEND/i.test(gb))                        resultado._dimensaoDetectada = 'vendedor';
    else if (/\bB1_COD\b|\bD2_COD\b|\bD1_COD\b/i.test(gb))                         resultado._dimensaoDetectada = 'produto';
    else if (/\bBM_GRUPO\b|\bBM_DESC\b/i.test(gb))                                  resultado._dimensaoDetectada = 'grupo_produto';
    else if (/\bCTT_CUSTO\b/i.test(gb))                                              resultado._dimensaoDetectada = 'centro_custo';
    else if (/NATUREZ/i.test(gb))                                                    resultado._dimensaoDetectada = 'natureza';
    else if (/FILIAL/i.test(gb))                                                     resultado._dimensaoDetectada = 'filial';
  }

  return resultado;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Gera SQL a partir de uma mensagem usando modo chat com histórico completo.
 *
 * Fluxo:
 *  1. Carrega histórico de turns do SQLite
 *  2. Constrói system prompt dinâmico (SX2/SX3 da empresa)
 *  3. Monta messages array [system, ...histórico, user]
 *  4. Chama a IA no modo chat
 *  5. Valida que o retorno é um SELECT seguro
 *  6. Persiste o turn no histórico para próximas perguntas
 *
 * @param {object} params
 * @param {string} params.mensagem           - Texto da pergunta do usuário
 * @param {string} params.sender             - Identificador do remetente (ex: número WA)
 * @param {number} params.empresaId          - ID da empresa (tenant)
 * @param {string[]|null} params.modulos     - Módulos ativos (null = todos)
 * @param {object} params.keys               - Chaves de API por provider
 * @param {object} params.cfg                - Configuração de AI (provedor, ordem, etc.)
 *
 * @returns {{ sql: string|null, validacao: object, respostaIA: string }}
 */
async function gerarSql({ mensagem, sender, empresaId, modulos = null, keys, cfg }) {
  const limiteTurnos = Number(cfg?.historico_turnos ?? 5);

  // 1. Histórico de chat
  const historico = chatHistory.carregarHistorico(empresaId, sender, limiteTurnos);
  const chatTurno = Math.floor(historico.length / 2) + 1; // 1 = primeiro turno
  console.log(`[ChatService] empresa=${empresaId} sender=${sender} historico=${historico.length} msgs turno=${chatTurno} modulos=${JSON.stringify(modulos)}`);

  // 2. System prompt dinâmico
  const systemPrompt = systemPromptBuilder.construir(empresaId, { modulos });

  // 3. Monta array de messages para a API
  // Injeta data atual na mensagem para que a IA saiba interpretar "este ano", "este mês", etc.
  // A data é prefixada apenas na chamada à IA — o histórico salva a mensagem limpa.
  const _hoje = new Date();
  const _pad2 = n => String(n).padStart(2, '0');
  const _anoAtual = _hoje.getFullYear();
  const _mesNum   = _hoje.getMonth() + 1;
  const _iniAno   = `${_anoAtual}0101`;
  const _fimAno   = `${_anoAtual}1231`;
  const _iniMes   = `${_anoAtual}${_pad2(_mesNum)}01`;
  const _fimMes   = `${_anoAtual}${_pad2(_mesNum)}${_pad2(new Date(_anoAtual, _mesNum, 0).getDate())}`;
  // Labels sem "mês"/"ano" soltos para evitar confusão com pedidos de agrupamento "por mês"/"por ano"
  const _ctxData  = `[HOJE: ${_pad2(_hoje.getDate())}/${_pad2(_mesNum)}/${_anoAtual} | filtro_ano_corrente=BETWEEN '${_iniAno}' AND '${_fimAno}' | filtro_mes_corrente=BETWEEN '${_iniMes}' AND '${_fimMes}']`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...historico,
    { role: 'user',   content: `${_ctxData}\n${mensagem}` },
  ];

  // 4. Chama a IA em modo chat
  const respostaIA = await _chamarChat(keys, cfg, messages, {
    maxTokens: 2000,
    timeoutMs: 35000,
  });

  // 5. Valida o SQL
  const validacao = sqlValidator.validar(respostaIA, { mensagem });
  if (!validacao.ok) {
    console.warn(`[ChatService] SQL inválido: ${validacao.erro}`);
    return { sql: null, validacao, respostaIA, chat_turno: chatTurno };
  }

  // 6. Persiste turn no histórico (somente se o SQL for válido)
  chatHistory.salvarTurn(empresaId, sender, 'user',      mensagem);
  chatHistory.salvarTurn(empresaId, sender, 'assistant', `\`\`\`sql\n${validacao.sql}\n\`\`\``);

  const _promptUser = messages
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n---\n\n');

  const _contextoChat = _inferirContextoChat({ mensagem, chatTurno, sql: validacao.sql });

  return {
    sql: validacao.sql, validacao, respostaIA, chat_turno: chatTurno,
    _prompt_system: systemPrompt,
    _prompt_user:   _promptUser,
    _contextoChat,
  };
}

/**
 * Limpa o histórico de chat de um sender (ex: quando o usuário troca de empresa).
 */
function limparContexto(empresaId, sender) {
  chatHistory.limparHistorico(empresaId, sender);
}

module.exports = { gerarSql, limparContexto };

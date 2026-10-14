'use strict';

// Motor de IA multi-provider do IA Service — inspirado no PADRÃO do
// apps/IA Command/modules/erp/core/ai-provider-client.js (mesma abstração de
// fallback entre providers, mesma chamada HTTPS crua), mas desacoplado de
// Protheus/usage-db do IA Command e com suporte a anexos de imagem (visão),
// necessário para os cenários A/B do prompt (screenshot + fonte + log).
//
// Corrige deliberadamente o `rejectUnauthorized: false` encontrado no IA
// Command (Etapa 0, seção 9.2 do relatório de análise) — aqui a validação de
// certificado TLS fica ligada (comportamento padrão do Node).

const https = require('https');
const tokenBudget = require('./token-budget-service');

const PROVIDER_CONFIGS = {
  groq: { hostname: 'api.groq.com', path: '/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', tipo: 'openai_compat', suportaImagem: false, usaRaciocinio: true },
  openai: { hostname: 'api.openai.com', path: '/v1/chat/completions', model: 'gpt-4o-mini', tipo: 'openai_compat', suportaImagem: true },
  deepseek: { hostname: 'api.deepseek.com', path: '/chat/completions', model: 'deepseek-chat', tipo: 'openai_compat', suportaImagem: false },
  claude: { hostname: 'api.anthropic.com', path: '/v1/messages', model: 'claude-haiku-4-5-20251001', tipo: 'anthropic', suportaImagem: true },
  gemini: { hostname: 'generativelanguage.googleapis.com', path: null, model: 'gemini-3.5-flash', tipo: 'gemini', suportaImagem: true },
};

// Modelos de raciocínio (ex.: GPT-OSS na Groq) gastam parte do max_tokens
// "pensando" (campo completion_tokens_details.reasoning_tokens) antes de
// escrever a resposta final — com max_tokens baixo, o resultado vem com
// message.content vazio e finish_reason="length" mesmo com a chamada tendo
// sido bem-sucedida (HTTP 200, chave válida, uso contabilizado). Piso alto o
// bastante para sobrar espaço para o texto depois do raciocínio em prompts
// curtos (ex.: teste de conexão, que antes pedia maxTokens: 10 e sempre
// falhava com "Resposta vazia do OpenAI-compat", bug real reportado pelo
// usuário, 2026-10).
const MIN_TOKENS_RACIOCINIO = 300;
const GROQ_TPM_SEGURO_ESTIMADO = 4300;
const DEFAULT_MAX_PROVIDER_ROUNDS = 3;

const DEFAULT_ORDER = ['groq', 'deepseek', 'openai', 'claude', 'gemini'];

// Buffer explícito (não string) no corpo e no Content-Length — achado real,
// auditoria 2026-10: req.write(bodyStr) com string deixa o Node escolher o
// encoding da escrita; em payloads grandes (>400KB, ex. turnos com várias
// imagens em base64) com acentuação em português, um chunk interno de escrita
// pode cortar um caractere UTF-8 multi-byte exatamente na fronteira, gerando
// bytes escritos ligeiramente diferentes do Content-Length declarado via
// Buffer.byteLength(bodyStr). O servidor remoto então espera bytes que nunca
// completam — conexão trava indefinidamente, sem erro, sem nunca disparar o
// fallback para o próximo provider (reproduzido e confirmado na auditoria).
// Buffer.from(bodyStr) elimina essa classe de bug: byteLength e write operam
// sobre os mesmos bytes já materializados, não sobre a string.
//
// AbortController com temporizador próprio (não req.setTimeout) — achado
// real, mesma auditoria: req.setTimeout é um timeout de INATIVIDADE DO
// SOCKET, não de duração total da requisição. Uma conexão TCP que o provider
// mantém "viva" (TCP keepalive) sem nunca enviar os headers de resposta nunca
// dispara esse timeout, mesmo além do timeoutMs configurado. abort() fecha a
// conexão de fato, qualquer que seja o estado do socket.
function _httpPost(hostname, path, headers, body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const bodyBuf = Buffer.from(bodyStr, 'utf8');
    const controller = new AbortController();
    const prazo = setTimeout(() => controller.abort(new Error(`Timeout de ${Math.round(timeoutMs / 1000)}s excedido.`)), timeoutMs);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length,
        ...headers,
      },
      signal: controller.signal,
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        clearTimeout(prazo);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          return reject(new Error(`Resposta inválida do provider: ${raw.slice(0, 200)}`));
        }
        if (parsed.error) {
          const msg = parsed.error?.message || parsed.error?.error?.message || JSON.stringify(parsed.error);
          return reject(new Error(msg));
        }
        resolve(parsed);
      });
    });
    req.on('error', (err) => {
      clearTimeout(prazo);
      reject(controller.signal.aborted ? (controller.signal.reason || err) : err);
    });
    req.write(bodyBuf);
    req.end();
  });
}

function _normalizarTexto(data, providerName) {
  const texto = String(data || '').trim();
  if (!texto) throw new Error(`Resposta vazia do ${providerName}.`);
  return texto;
}

function _estimarTokensPrompt(systemPrompt, userPrompt) {
  const texto = [
    systemPrompt,
    typeof userPrompt === 'string' ? userPrompt : JSON.stringify(userPrompt || ''),
  ].join('\n');
  return Math.ceil(String(texto || '').length / 4);
}

function _maxTokensAjustadoPorProvider(cfg, systemPrompt, userPrompt, maxTokensPedido) {
  if (cfg?.hostname !== 'api.groq.com') return maxTokensPedido;
  const promptEstimado = _estimarTokensPrompt(systemPrompt, userPrompt);
  const disponivel = GROQ_TPM_SEGURO_ESTIMADO - promptEstimado;
  return Math.max(MIN_TOKENS_RACIOCINIO, Math.min(maxTokensPedido, disponivel));
}

// `imagens` é uma lista de { mimeType, base64 } — vazia na maioria das
// chamadas (texto puro), preenchida quando o atendimento tem anexos de imagem.

async function _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokens) {
  const model = opts.model || cfg.model;
  const conteudoUser = imagens.length
    ? [
        { type: 'text', text: userPrompt },
        ...imagens.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
      ]
    : userPrompt;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: conteudoUser },
    ],
    temperature: opts.temperature ?? 0,
    max_tokens: maxTokens,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const parsed = await _httpPost(cfg.hostname, cfg.path, { Authorization: `Bearer ${apiKey}` }, body, opts.timeoutMs);
  const content = parsed.choices?.[0]?.message?.content;
  const finishReason = parsed.choices?.[0]?.finish_reason;
  return { content, usage: parsed.usage || {}, truncado: finishReason === 'length' };
}

async function _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const maxTokensPedido = _maxTokensAjustadoPorProvider(cfg, systemPrompt, userPrompt, opts.maxTokens || 3000);
  const maxTokensInicial = cfg.usaRaciocinio ? Math.max(maxTokensPedido, MIN_TOKENS_RACIOCINIO) : maxTokensPedido;

  let resultado = await _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokensInicial);

  // Modelo de raciocínio pode consumir todo o orçamento "pensando" e deixar
  // message.content vazio mesmo com HTTP 200 — não é falha de credencial/cota,
  // é orçamento de tokens insuficiente para concluir a resposta. Uma única
  // retentativa com o dobro do orçamento resolve o caso real (teste de
  // conexão com maxTokens: 10) sem mascarar erro genuíno de outro provider.
  if (cfg.usaRaciocinio && !String(resultado.content || '').trim() && resultado.truncado) {
    resultado = await _chamarOpenAICompatUmaVez(cfg, apiKey, systemPrompt, userPrompt, imagens, opts, maxTokensInicial * 2);
  }

  return { texto: _normalizarTexto(resultado.content, 'OpenAI-compat'), usage: resultado.usage, truncado: resultado.truncado };
}

async function _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const model = opts.model || cfg.model;
  const conteudoUser = imagens.length
    ? [
        { type: 'text', text: userPrompt },
        ...imagens.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
      ]
    : userPrompt;

  const parsed = await _httpPost(
    cfg.hostname,
    cfg.path,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: conteudoUser }],
      max_tokens: opts.maxTokens || 3000,
      temperature: opts.temperature ?? 0,
    },
    opts.timeoutMs
  );
  const content = Array.isArray(parsed.content) ? parsed.content.map(c => c.text || '').join('\n') : parsed.content?.[0]?.text;
  return { texto: _normalizarTexto(content, 'Anthropic'), usage: parsed.usage || {}, truncado: parsed.stop_reason === 'max_tokens' };
}

async function _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const model = opts.model || cfg.model;
  const path = `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [{ text: userPrompt }, ...imagens.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }))];

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxTokens || 3000 },
  };

  const parsed = await _httpPost(cfg.hostname, path, {}, body, opts.timeoutMs);
  const content = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n');
  return { texto: _normalizarTexto(content, 'Gemini'), usage: parsed.usageMetadata || {}, truncado: parsed.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

async function chamarProvedor(provedor, apiKey, systemPrompt, userPrompt, imagens, opts = {}) {
  const cfg = PROVIDER_CONFIGS[provedor];
  if (!cfg || !apiKey) throw new Error(`Provider ${provedor} sem chave/configuração.`);
  if (imagens.length && !cfg.suportaImagem) throw new Error(`Provider ${provedor} não suporta análise de imagem.`);

  if (cfg.tipo === 'openai_compat') return _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  if (cfg.tipo === 'anthropic') return _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  if (cfg.tipo === 'gemini') return _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, imagens, opts);
  throw new Error(`Tipo de provider não suportado: ${cfg.tipo}`);
}

function _normalizarOrdem({ provedorPrimario, fallbackOrdem } = {}) {
  const fallback = String(fallbackOrdem || '').split(',').map(s => s.trim()).filter(Boolean);
  const ordem = [provedorPrimario, ...fallback, ...DEFAULT_ORDER].filter(Boolean);
  return [...new Set(ordem)].filter(p => PROVIDER_CONFIGS[p]);
}

function _erroCotaOuCredito(msg) {
  return /quota|free_tier|exceeded|credit balance|insufficient.{0,20}(credit|balance|funds)|purchase credits|billing/i.test(msg || '');
}

// Prompt maior que a janela de contexto do modelo: retry no MESMO provider
// nunca resolve (o prompt nao muda de tamanho entre tentativas) — precisa
// pular direto para o proximo candidato, nunca reentrar na mesma rodada.
// Achado real, homologacao 2026-10: classificado antes como "transitorio"
// (bate em nenhuma palavra-chave especifica, caia no catch-all), desperdicando
// uma rodada inteira tentando de novo um prompt que nunca vai caber.
function _erroContextoExcedido(msg) {
  return /maximum context length|context[_ ]length[_ ]exceeded|context window|too many tokens|reduce the length|prompt is too long|input is too long/i.test(msg || '');
}

// Erro de validacao de certificado/handshake TLS — tipicamente ambiental
// (proxy/antivirus interceptando HTTPS, ver IA_SERVICE_AUDITORIA_
// ESTABILIZACAO_PRODUCAO.md secao 1), nao especifico de um provider. Se o
// erro for esse, os demais hosts HTTPS tendem a falhar pelo mesmo motivo —
// sinalizado para o chamador decidir interromper a sequencia de fallback em
// vez de gastar uma tentativa por provider sabendo que todas vao repetir o
// mesmo erro de ambiente.
function _erroTlsGlobal(msg) {
  return /unable to verify the first certificate|self[- ]signed certificate|certificate has expired|unable to get local issuer certificate|cert_|ssl routines|wrong version number/i.test(msg || '');
}

function _erroPermanenteProvider(msg) {
  const m = msg || '';
  // Rate limit (TPM/RPM/429) e SEMPRE transitorio, mesmo quando a mensagem do
  // provider inclui um link de upsell contendo a palavra "billing" (caso real
  // do GROQ: "...Upgrade to Dev Tier today at .../settings/billing" dentro de
  // uma mensagem de "Rate limit reached" — achado real na homologacao 2026-10,
  // o padrao solto de /billing/i classificava rate limit como permanente e
  // impedia o proprio provider de ser retentado em rodada futura).
  if (/rate.?limit|429|tokens per (minute|day)|TPM|TPD/i.test(m)) return false;
  return /api key not valid|invalid api key|incorrect api key|unauthorized|forbidden|\b401\b|\b403\b|credit balance|insufficient.{0,20}(credit|balance|funds)|insufficient_quota|exceeded your current quota|purchase credits|update your billing|model .*not found|does not exist/i.test(m);
}

function _erroTransitorioProvider(msg) {
  if (_erroContextoExcedido(msg) || _erroTlsGlobal(msg)) return false;
  return /econnreset|etimedout|eai_again|socket hang up|network|timeout|timed out|rate.?limit|429|temporar|try again|503|502|504|500|overloaded|capacity/i.test(msg || '');
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chama o motor de IA com fallback entre providers, na ordem configurada pela
 * empresa (ai_config). `imagens` (pode ser []) restringe a ordem aos
 * providers com suporte a visão quando não vazia — Groq é pulado nesse caso.
 *
 * Modelo por provedor (2026-09): `cfg.modelos` (vindo de
 * ai-config-service.resolverKeysEOrdem) tem prioridade sobre `opts.model` —
 * cada provedor tem seu próprio nome de modelo, então um `opts.model` único
 * aplicado ao vencedor do fallback estaria errado na maioria dos casos
 * (ex.: "gpt-4o-mini" não existe na API do Groq). `opts.model` continua
 * funcionando como override GLOBAL para quem não tiver `cfg.modelos` (ex.:
 * chamadas de teste avulsas, ver rota /config/ia/testar).
 */
async function chamarIA(keys, cfg, systemPrompt, userPrompt, imagens = [], opts = {}) {
  const ordem = _normalizarOrdem(cfg);
  const erros = [];
  const tentativas = [];
  let tentados = 0;
  const inicioGeral = Date.now();
  const maxRodadas = Math.max(1, Math.min(Number(opts.maxProviderRounds) || DEFAULT_MAX_PROVIDER_ROUNDS, 5));
  const retryDelayMs = Math.max(0, Number(opts.providerRetryDelayMs) || 1200);
  const providersPermanentes = new Set();
  // Candidatos na ORDEM cadastrada (primario + fallback), com chave e, quando
  // o turno envia imagem, com visao. Nenhum provider e promovido ou removido
  // por preferencia: a unica exclusao por capacidade e a de modalidade.
  const candidatos = candidatosElegiveis(keys, cfg, { exigeImagem: imagens.length > 0 });
  // Guarda de janela: rede de seguranca APOS o preparo por candidato. Com
  // opts.prepararParaCandidato o prompt e reconstruido para o orcamento de
  // cada modelo e a guarda nao deve disparar; sem o callback (ex.: reescrita
  // final do Quality Gate) ela impede reenviar um prompt maior que a janela
  // do modelo, o que so gastaria uma tentativa para ser recusado.
  const ignoradosPorJanela = new Set();
  let ultimoTokensPrompt = 0;

  let tlsGlobalDetectado = false;

  for (let rodada = 1; rodada <= maxRodadas && !tlsGlobalDetectado; rodada++) {
    let houveTransitorioNaRodada = false;

    for (const provedor of candidatos) {
      if (providersPermanentes.has(provedor) || ignoradosPorJanela.has(provedor)) continue;

      const modeloDoProvedor = cfg?.modelos?.[provedor] || opts.model || PROVIDER_CONFIGS[provedor].model;
      let promptTentativa = userPrompt;
      let imagensTentativa = imagens;
      let preparo = null;
      if (typeof opts.prepararParaCandidato === 'function') {
        try {
          const prep = await opts.prepararParaCandidato({
            provider: provedor,
            model: modeloDoProvedor,
            janela: tokenBudget.capacidadeModelo(modeloDoProvedor),
            suportaImagem: !!PROVIDER_CONFIGS[provedor].suportaImagem,
          });
          if (prep) {
            if (typeof prep.userPrompt === 'string') promptTentativa = prep.userPrompt;
            if (Array.isArray(prep.imagens)) imagensTentativa = prep.imagens;
            preparo = prep.registro || null;
          }
        } catch (errPrep) {
          tentados += 1;
          const msgPrep = `Falha ao preparar o contexto para ${provedor}/${modeloDoProvedor}: ${errPrep.message}`;
          erros.push({ provedor, msg: msgPrep, rodada, transitorio: false, permanente: false, contextoExcedido: false, tlsGlobal: false });
          tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'erro', erro: msgPrep, rodada, transitorio: false, permanente: false, etapa: 'preparo_contexto' });
          continue;
        }
      }
      ultimoTokensPrompt = tokenBudget.estimarTokens(systemPrompt) + tokenBudget.estimarTokens(promptTentativa)
        + imagensTentativa.length * tokenBudget.estimarTokensImagem();
      // Janela nominal inteira (sem margem): a guarda so barra o que
      // comprovadamente nao cabe; a folga e responsabilidade do orcamento.
      const limiteJanela = tokenBudget.capacidadeModelo(modeloDoProvedor);
      if (ultimoTokensPrompt > limiteJanela) {
        ignoradosPorJanela.add(provedor);
        tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'ignorado_janela', erro: `Prompt estimado em ${ultimoTokensPrompt} tokens excede a janela utilizavel (${limiteJanela}) do modelo.`, rodada, tokensPromptEstimados: ultimoTokensPrompt, limiteJanela, ...(preparo ? { preparo } : {}) });
        continue;
      }

      tentados += 1;
      const inicioTentativa = Date.now();
      const extraTentativa = { tokensPromptEstimados: ultimoTokensPrompt, ...(preparo ? { preparo } : {}) };
      try {
        const resultado = await chamarProvedor(provedor, keys[provedor], systemPrompt, promptTentativa, imagensTentativa, { ...opts, model: modeloDoProvedor });
        tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'ok', rodada, latenciaMs: Date.now() - inicioTentativa, ...extraTentativa });
        return { ...resultado, provider: provedor, model: modeloDoProvedor, tentativas, latenciaMs: Date.now() - inicioGeral };
      } catch (erro) {
        const msg = erro.message;
        const contextoExcedido = _erroContextoExcedido(msg);
        const tlsGlobal = _erroTlsGlobal(msg);
        const permanente = _erroPermanenteProvider(msg) || contextoExcedido;
        const transitorio = !permanente && _erroTransitorioProvider(msg);
        erros.push({ provedor, msg, rodada, transitorio, permanente, contextoExcedido, tlsGlobal });
        tentativas.push({ provider: provedor, model: modeloDoProvedor, status: 'erro', erro: msg, rodada, transitorio, permanente, contextoExcedido, tlsGlobal, latenciaMs: Date.now() - inicioTentativa, ...extraTentativa });
        // Contexto excedido: nunca retentar o MESMO provider/modelo (o prompt
        // nao muda de tamanho entre tentativas) — pula direto para o proximo
        // candidato na mesma rodada, sem aguardar nem contar como transitorio.
        if (permanente) providersPermanentes.add(provedor);
        if (transitorio) houveTransitorioNaRodada = true;
        // TLS/certificado global: erro de ambiente, nao do provider — os
        // demais hosts HTTPS tendem a falhar pelo mesmo motivo. Interrompe a
        // sequencia de fallback inteira em vez de gastar uma tentativa por
        // provider sabendo que todas vao repetir o mesmo erro (achado real,
        // IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md secao 1).
        if (tlsGlobal) {
          tlsGlobalDetectado = true;
          break;
        }
      }
    }

    if (tlsGlobalDetectado || !houveTransitorioNaRodada || rodada >= maxRodadas) break;
    if (retryDelayMs > 0) {
      await _sleep(retryDelayMs * rodada);
    }
  }

  const semChave = !ordem.some(p => keys?.[p]);
  // Distingue "ninguém foi sequer tentado por falta de suporte a imagem" de
  // "todos tentaram e falharam" — são causas diferentes e exigem ação
  // diferente do analista (configurar um provedor com visão vs. investigar
  // erro de API). Sem essa distinção, o erro genérico "todos falharam"
  // escondia que, na prática, zero chamadas tinham sido feitas (bug real:
  // turno com imagens e só Groq/DeepSeek configurados nunca tentava
  // nenhum provedor, usuário via erro sem entender a causa, 2026-10).
  const semJanelaSuficiente = ignoradosPorJanela.size > 0 && tentados === 0;
  const semProvedorComImagem = imagens.length > 0 && !semChave && tentados === 0 && !semJanelaSuficiente;
  const cotaEsgotada = erros.length > 0 && erros.every(e => _erroCotaOuCredito(e.msg));
  const erroFinal = new Error(
    semChave
      ? 'Nenhum provider de IA configurado para esta empresa.'
      : semJanelaSuficiente
        ? `Nenhum provider elegível comporta o prompt deste turno (~${ultimoTokensPrompt} tokens estimados). Reduza o volume de evidências ou configure um provider com janela de contexto maior.`
      : semProvedorComImagem
        ? `Nenhum provider configurado com chave suporta análise de imagem (necessário para ${imagens.length} anexo(s) deste turno). Configure uma chave para OpenAI, Claude ou Gemini em Configurações do IA Service.`
        : `Todos os providers falharam: ${erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ')}`
  );
  erroFinal._semChave = semChave;
  erroFinal._semProvedorComImagem = semProvedorComImagem;
  erroFinal._semJanelaSuficiente = semJanelaSuficiente;
  erroFinal._cotaEsgotada = cotaEsgotada;
  erroFinal._tentativas = tentativas;
  erroFinal._latenciaMs = Date.now() - inicioGeral;
  throw erroFinal;
}

// Candidatos que PODEM executar um turno: tem chave e, quando o turno envia
// imagem, suportam visao. Fonte unica de elegibilidade — usada tanto pelo
// chamarIA quanto pelo Context Engine (para dimensionar o orcamento pelo
// modelo que de fato vai responder, e nao pelo provedorPrimario cego).
function candidatosElegiveis(keys, cfg, { exigeImagem = false } = {}) {
  return _normalizarOrdem(cfg).filter(provedor => keys?.[provedor] && (!exigeImagem || PROVIDER_CONFIGS[provedor].suportaImagem));
}

function primeiroCandidatoElegivel(keys, cfg, { exigeImagem = false } = {}) {
  const provider = candidatosElegiveis(keys, cfg, { exigeImagem })[0];
  if (!provider) return null;
  return { provider, model: cfg?.modelos?.[provider] || PROVIDER_CONFIGS[provider].model };
}

module.exports = { candidatosElegiveis, primeiroCandidatoElegivel, chamarIA, chamarProvedor, PROVIDER_CONFIGS, _erroTransitorioProvider, _erroPermanenteProvider, _erroContextoExcedido, _erroTlsGlobal };

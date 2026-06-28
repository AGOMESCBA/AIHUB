'use strict';

/**
 * Dialogo de feedback tecnico: quando o usuario reporta que um SQL/valor saiu
 * errado, conduz uma conversa natural com a IA para entender o problema antes
 * de registrar uma proposta de correcao do spec. A IA nunca edita arquivos —
 * so produz texto candidato, que fica pendente de revisao humana (painel admin).
 */

const aiProviderClient = require('./ai-provider-client');
const specFeedbackStore = require('../ai/spec-feedback-store');

const CLASSIFICADORES_POR_MODULO = {
  financeiro: () => require('./financeiro/financeiro-spec-classifier'),
  faturamento: () => require('./faturamento/faturamento-spec-classifier'),
  compras: () => require('./compras/compras-spec-classifier'),
  comissao: () => require('./comissao/comissao-spec-classifier'),
};

const FRAGMENTOS_POR_MODULO = {
  financeiro: () => require('./financeiro/financeiro-fragmentos-spec'),
  faturamento: () => require('./faturamento/faturamento-fragmentos-spec'),
  compras: () => require('./compras/compras-fragmentos-spec'),
  comissao: () => require('./comissao/comissao-fragmentos-spec'),
};

// Localiza o fragmento de spec mais provavelmente responsavel pelo SQL gerado,
// reaproveitando o mesmo classificador usado na geracao real do prompt.
function localizarFragmento(modulo, perguntaOriginal) {
  const chaveModulo = String(modulo || '').replace('_dinamico', '');
  const carregarClassificador = CLASSIFICADORES_POR_MODULO[chaveModulo];
  const carregarFragmentos = FRAGMENTOS_POR_MODULO[chaveModulo];
  if (!carregarClassificador || !carregarFragmentos) return null;
  try {
    const { classificarFragmentos } = carregarClassificador();
    const fragmentosSpec = carregarFragmentos();
    const chaves = classificarFragmentos(perguntaOriginal) || fragmentosSpec.ORDEM_FALLBACK || [];
    const chavePrincipal = chaves.find(c => !fragmentosSpec.FRAGMENTOS[c]?.sempre) || chaves[0];
    if (!chavePrincipal || !fragmentosSpec.FRAGMENTOS[chavePrincipal]) return null;
    return {
      modulo: chaveModulo,
      chave: chavePrincipal,
      texto: fragmentosSpec.FRAGMENTOS[chavePrincipal].texto(),
    };
  } catch (e) {
    console.warn('[SpecFeedbackDialog] Falha ao localizar fragmento:', e.message);
    return null;
  }
}

function buildSystemPrompt({ perguntaOriginal, sqlGerado, fragmento }) {
  return [
'Voce e um analista tecnico senior conversando por WhatsApp com um usuario que suspeita de um erro numa consulta gerada por IA.',
    'Seu objetivo: entender com precisao o que esta errado, fazendo perguntas curtas e naturais quando precisar de mais detalhe — como um colega de trabalho faria, nunca como um formulario.',
    'Nao se desculpe excessivamente, nao repita a pergunta do usuario, nao use linguagem robotica como "Por favor, informe" ou "Selecione uma opcao".',
    'CRITERIO DE FECHAMENTO — feche (tipo="fechamento") assim que voce conseguir articular, em UMA frase, qual regra de negocio do SQL esta errada e qual seria a regra correta. Voce JA TEM o SQL e o spec tecnico nesta mensagem — nao pergunte ao usuario coisas que voce mesmo pode verificar lendo o SQL (ex: "o SQL filtra X?" — olhe o SQL e responda voce mesmo). So pergunte ao usuario o que SOMENTE ele sabe: a intencao de negocio, o resultado esperado, qual exemplo concreto esta errado.',
    'Quando o usuario confirmar ou reformular sua hipotese ("isso mesmo", "exatamente", "e isso"), isso normalmente JA E sinal suficiente para fechar — nao faca mais uma pergunta de confirmacao depois disso.',
    'Se o usuario claramente nao quer continuar ou mudou de assunto, feche mesmo sem diagnostico completo, marcando incerteza no diagnostico.',
    '',
    `Pergunta original do usuario que gerou o SQL: "${perguntaOriginal}"`,
    '',
    `SQL gerado pela IA nessa consulta:\n${sqlGerado}`,
    '',
    fragmento
      ? `Trecho do spec tecnico que provavelmente orientou esse SQL (modulo ${fragmento.modulo}, fragmento "${fragmento.chave}"):\n${fragmento.texto}`
      : 'Nao foi possivel localizar automaticamente o fragmento de spec responsavel — baseie o diagnostico so na conversa com o usuario.',
    '',
    'Retorne SOMENTE JSON valido, sem markdown, no formato:',
    '{',
    '  "tipo": "pergunta" | "fechamento",',
    '  "mensagem": string,',
    '  "diagnostico": string | null,',
    '  "texto_proposto": string | null',
    '}',
    '- "mensagem": o que voce diria ao usuario agora (sempre em portugues, tom natural de conversa).',
    '- Quando tipo="fechamento": "diagnostico" resume o problema real identificado, e "texto_proposto" e o texto candidato de correcao da regra do spec (mesmo estilo do trecho de spec mostrado acima — direto, tecnico, sem floreio). Se nao houver certeza suficiente, "texto_proposto" pode ser null e o diagnostico deve dizer isso.',
    '- Quando tipo="pergunta": "diagnostico" e "texto_proposto" devem ser null.',
  ].filter(Boolean).join('\n');
}

function buildUserPrompt(historico) {
  return historico
    .map(turno => `${turno.papel === 'usuario' ? 'Usuario' : 'Voce'}: ${turno.texto}`)
    .join('\n');
}

// Conduz um turno do dialogo. historico = [{ papel: 'usuario'|'ia', texto }].
// Retorna { tipo, mensagem, diagnostico, texto_proposto }.
async function processarTurno({ empresaId, perguntaOriginal, sqlGerado, modulo, historico }) {
  const { keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId);
  const fragmento = localizarFragmento(modulo, perguntaOriginal);
  const systemPrompt = buildSystemPrompt({ perguntaOriginal, sqlGerado, fragmento });
  const userPrompt = buildUserPrompt(historico);
  const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    json: true,
    maxTokens: 800,
    temperature: 0.3,
    logPrefix: 'SpecFeedbackDialog',
  });
  let obj;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    obj = JSON.parse(match ? match[0] : raw);
  } catch (_) {
    obj = { tipo: 'pergunta', mensagem: 'Pode reformular o que percebeu de errado? Não consegui entender bem.', diagnostico: null, texto_proposto: null };
  }
  return {
    tipo: obj.tipo === 'fechamento' ? 'fechamento' : 'pergunta',
    mensagem: String(obj.mensagem || '').trim() || 'Pode me dar mais detalhes sobre o que está errado?',
    diagnostico: obj.diagnostico || null,
    texto_proposto: obj.texto_proposto || null,
    fragmento,
  };
}

function registrarProposta({ empresaId, numeroWa, interpretationLogId, perguntaOriginal, sqlGerado, observacaoUsuario, fragmento, diagnostico, textoProposto, historico }) {
  return specFeedbackStore.criarProposta({
    empresaId,
    numeroWa,
    interpretationLogId,
    modulo: fragmento?.modulo || null,
    fragmentoAfetado: fragmento?.chave || null,
    perguntaOriginal,
    sqlGerado,
    observacaoUsuario,
    diagnosticoIa: diagnostico,
    textoAtual: fragmento?.texto || null,
    textoProposto,
    historicoDialogo: historico,
  });
}

module.exports = { processarTurno, registrarProposta, localizarFragmento };

'use strict';

/**
 * Dialogo de feedback tecnico: quando o usuario reporta que um SQL/valor saiu
 * errado, conduz uma conversa natural com a IA para entender o problema antes
 * de registrar uma proposta de correcao do spec. A IA nunca edita arquivos —
 * so produz texto candidato, que fica pendente de revisao humana (painel admin).
 */

const aiProviderClient = require('./ai-provider-client');
const specFeedbackStore = require('../../ai/spec-feedback-store');

const CLASSIFICADORES_POR_MODULO = {
  financeiro: () => require('../totvs_protheus/financeiro/financeiro-spec-classifier'),
  faturamento: () => require('../totvs_protheus/faturamento/faturamento-spec-classifier'),
  compras: () => require('../totvs_protheus/compras/compras-spec-classifier'),
  comissao: () => require('../totvs_protheus/comissao/comissao-spec-classifier'),
};

const FRAGMENTOS_POR_MODULO = {
  financeiro: () => require('../totvs_protheus/financeiro/financeiro-fragmentos-spec'),
  faturamento: () => require('../totvs_protheus/faturamento/faturamento-fragmentos-spec'),
  compras: () => require('../totvs_protheus/compras/compras-fragmentos-spec'),
  comissao: () => require('../totvs_protheus/comissao/comissao-fragmentos-spec'),
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
    // classificarFragmentos() retorna null quando nenhuma keyword bateu de verdade
    // (ex: pergunta cross-modulo, ou fora do vocabulario do classificador). Nesse caso
    // NAO usamos ORDEM_FALLBACK para "adivinhar" um fragmento — ORDEM_FALLBACK existe
    // para a geracao real de SQL (injetar todos os fragmentos como contexto completo),
    // nao para apontar culpado no dialogo de feedback. Apontar o primeiro item da lista
    // como se fosse o fragmento responsavel gera falso-positivo sistematico.
    const chaves = classificarFragmentos(perguntaOriginal);
    if (!chaves) return null;
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
    'IMPORTANTE — mudanca de assunto: se a mensagem mais recente do usuario for claramente uma NOVA pergunta de negocio (ex: pedir outro relatorio, outro periodo, outro modulo) e nao uma continuacao do reporte de erro, isso significa que ele abandonou o reporte. Nesse caso use tipo="abandono" — nao invente diagnostico, nao gere texto_proposto.',
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
    '  "tipo": "pergunta" | "fechamento" | "abandono",',
    '  "mensagem": string,',
    '  "diagnostico": string | null,',
    '  "texto_proposto": string | null',
    '}',
    '- "mensagem": o que voce diria ao usuario agora (sempre em portugues, tom natural de conversa). Quando tipo="abandono", deixe "mensagem" vazia ("") — o sistema vai processar a nova pergunta normalmente, sem precisar de uma resposta sua aqui.',
    '- Quando tipo="fechamento": "diagnostico" resume o problema real identificado, e "texto_proposto" e o texto candidato de correcao da regra do spec (mesmo estilo do trecho de spec mostrado acima — direto, tecnico, sem floreio). Se nao houver certeza suficiente mas o usuario quis mesmo assim encerrar o reporte, "texto_proposto" pode ser null e o diagnostico deve dizer isso.',
    '- Quando tipo="pergunta" ou "abandono": "diagnostico" e "texto_proposto" devem ser null.',
  ].filter(Boolean).join('\n');
}

function buildUserPrompt(historico) {
  return historico
    .map(turno => `${turno.papel === 'usuario' ? 'Usuario' : 'Voce'}: ${turno.texto}`)
    .join('\n');
}

function textoConfirmaProposta(texto) {
  const t = String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  return /^(sim|s|isso|isso mesmo|correto|correta|exato|exatamente|perfeito|ok|pode registrar|pode sim|confirmo|confirmado)\b/.test(t);
}

function textoRecusaProposta(texto) {
  const t = String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  return /^(nao|n|negativo|errado|nao e isso|nao esta correto|cancela|cancelar)\b/.test(t);
}

function montarMensagemConfirmacao(resultado) {
  const diagnostico = String(resultado?.diagnostico || '').trim();
  const proposta = String(resultado?.texto_proposto || '').trim();
  const partes = [];
  partes.push(diagnostico
    ? `Entendi o ajuste: ${diagnostico}`
    : (String(resultado?.mensagem || '').trim() || 'Entendi o ajuste que precisa ser revisado.'));
  partes.push(proposta
    ? 'Posso registrar essa correção para revisão técnica do administrador? Responda "sim" para registrar ou explique o que ainda não está correto.'
    : 'Ainda não tenho uma proposta técnica segura para registrar. Pode me dar mais um detalhe do que precisa mudar?');
  return partes.join('\n\n');
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
  const tipo = ['fechamento', 'abandono'].includes(obj.tipo) ? obj.tipo : 'pergunta';
  return {
    tipo,
    mensagem: tipo === 'abandono' ? '' : (String(obj.mensagem || '').trim() || 'Pode me dar mais detalhes sobre o que está errado?'),
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

module.exports = {
  processarTurno,
  registrarProposta,
  localizarFragmento,
  textoConfirmaProposta,
  textoRecusaProposta,
  montarMensagemConfirmacao,
};

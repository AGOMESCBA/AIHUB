// Orquestra o turno de investigação técnica (Etapa 2): monta contexto
// (histórico + anexos do turno), chama o motor de IA, extrai o diagnóstico
// estruturado da resposta, persiste a mensagem do assistente.
//
// routes -> service (este arquivo) -> ai-provider-client / repositories.
// Nenhum SQL aqui — apenas orquestração.

const mensagemService = require('./atendimento-service');
const mensagemRepo = require('../repositories/mensagem-repository');
const anexoRepo = require('../repositories/anexo-repository');
const aiConfigService = require('./ai-config-service');
const aiProviderClient = require('./ai-provider-client');
const promptBuilder = require('./prompt-builder');
const versaoFonteService = require('./versao-fonte-service');

const MAX_TENTATIVAS_TIMEOUT = 2;

/**
 * Extrai as seções estruturadas (Diagnóstico/Causa provável/Evidências/...)
 * do texto de resposta da IA, para exibição amigável no frontend e para
 * gravar em `mensagens.diagnostico_json`. A IA é instruída a usar esses
 * títulos exatos em markdown (**Seção**) — parsing tolerante: se a IA não
 * seguir o formato à risca, o texto completo ainda fica preservado em
 * `mensagem.conteudo`, então nada se perde mesmo se o parsing falhar.
 */
function _extrairSecoes(texto) {
  const SECOES = ['Diagnóstico', 'Causa provável', 'Evidências', 'Correção proposta', 'Fonte corrigido', 'Alterações realizadas', 'Validação'];
  const resultado = {};
  const regexSecoes = new RegExp(`\\*\\*(${SECOES.join('|')})\\*\\*`, 'g');
  const marcadores = [...texto.matchAll(regexSecoes)];

  for (let i = 0; i < marcadores.length; i++) {
    const nome = marcadores[i][1];
    const inicio = marcadores[i].index + marcadores[i][0].length;
    const fim = i + 1 < marcadores.length ? marcadores[i + 1].index : texto.length;
    resultado[nome] = texto.slice(inicio, fim).trim().replace(/^[\s:]+/, '');
  }

  return Object.keys(resultado).length > 0 ? resultado : null;
}

function _extrairNivelConfianca(texto) {
  const termos = ['causa confirmada', 'forte evidência', 'hipótese provável', 'evidência insuficiente'];
  const encontrado = termos.find(t => texto.toLowerCase().includes(t));
  return encontrado || null;
}

function _extrairFonteCorrigido(secoes) {
  if (!secoes?.['Fonte corrigido']) return null;
  const blocoCodigo = secoes['Fonte corrigido'].match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return blocoCodigo ? blocoCodigo[1] : null;
}

/**
 * Processa um turno de investigação: usuário envia texto + (opcionalmente)
 * referências a anexos já persistidos (upload acontece antes, via rota
 * separada — ver services/armazenamento-anexos.js). Retorna a mensagem do
 * assistente já persistida, com diagnóstico estruturado quando aplicável.
 *
 * `automatico: true` (usado pela pré-análise automática do radar, ver
 * processarPreAnalise abaixo): NÃO grava uma mensagem de usuário nova — o
 * conteúdo do chamado já é a primeira mensagem do atendimento (gravada por
 * radar-service.abrirOuCriarAtendimento), então o "turno" aqui é só pedir à
 * IA que analise o que já está no histórico. `texto` vira uma instrução
 * fixa, não uma mensagem do analista.
 */
async function processarTurno(empresaId, atendimentoId, { texto, usuarioId, anexoIds = [], automatico = false }) {
  const atendimento = mensagemService.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado nesta empresa.');

  let historico;
  if (automatico) {
    // Nenhuma mensagem nova de usuário — analisa o histórico já existente
    // (conteúdo do chamado + posicionamentos, gravado na abertura do
    // atendimento) por inteiro.
    historico = mensagemRepo.listarMensagens(empresaId, atendimentoId);
  } else {
    // Persiste a mensagem do usuário primeiro — mesmo que a IA falhe depois,
    // o turno do usuário (texto + anexos) fica registrado no histórico.
    const mensagemUsuario = mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel: 'user',
      conteudo: texto,
      usuarioId,
    });
    historico = mensagemRepo.listarMensagens(empresaId, atendimentoId)
      .filter(m => m.id !== mensagemUsuario.id); // histórico ANTERIOR a este turno
  }

  // Vincula os anexos deste turno à mensagem (eles já existem em `anexos`,
  // criados pela rota de upload — aqui só associamos à mensagem correta).
  const anexosDoTurno = anexoIds
    .map(id => anexoRepo.getAnexo(empresaId, id))
    .filter(Boolean);

  const anexosTextoDoTurno = anexosDoTurno.filter(a => a.conteudoExtraido);
  const anexosImagemDoTurno = anexosDoTurno.filter(a => a.mimeType?.startsWith('image/'));

  const userPrompt = promptBuilder.buildUserPrompt({
    atendimento,
    mensagens: historico,
    anexosTextoDoTurno,
    mensagemAtual: texto,
  });

  const imagens = [];
  for (const anexo of anexosImagemDoTurno) {
    const fs = require('fs');
    const path = require('path');
    const armazenamento = require('./armazenamento-anexos');
    try {
      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      const buffer = fs.readFileSync(caminhoAbsoluto);
      imagens.push({ mimeType: anexo.mimeType, base64: buffer.toString('base64') });
    } catch (err) {
      // Se o arquivo não puder ser lido, segue sem essa imagem — não derruba
      // o turno inteiro por causa de um anexo problemático.
      console.warn('[IA Service] Falha ao ler anexo de imagem para análise:', anexo.id, err.message);
    }
  }

  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);

  let resultado;
  try {
    resultado = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, userPrompt, imagens, {
      maxTokens: 4000,
      timeoutMs: 45000,
    });
  } catch (erro) {
    // Mensagem de erro registrada como turno do assistente, para o analista
    // ver no próprio chat — nunca expõe stack trace, só a causa amigável.
    const mensagemErro = erro._semChave
      ? 'Não há provider de IA configurado para esta empresa. Configure ao menos uma chave em Configurações do IA Service.'
      : `Não foi possível concluir a análise no momento: ${erro.message}`;
    return mensagemRepo.salvarMensagem(empresaId, atendimentoId, { papel: 'assistant', conteudo: mensagemErro, usuarioId: null });
  }

  const secoes = _extrairSecoes(resultado.texto);
  const nivelConfianca = _extrairNivelConfianca(resultado.texto);
  const fonteCorrigidoTexto = _extrairFonteCorrigido(secoes);

  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
    papel: 'assistant',
    conteudo: resultado.texto,
    diagnostico: secoes,
    nivelConfianca,
    provider: resultado.provider,
    model: resultado.model,
  });

  // Se a IA produziu um fonte corrigido E há exatamente um anexo de código
  // neste turno para servir de "original", versiona automaticamente (seção 9
  // do prompt: nunca sobrescrever, sempre nova versão vinculada).
  const anexosCodigoDoTurno = anexosDoTurno.filter(a => a.eCodigo);
  if (fonteCorrigidoTexto && anexosCodigoDoTurno.length === 1) {
    versaoFonteService.criarVersaoCorrigida(empresaId, {
      anexoOriginalId: anexosCodigoDoTurno[0].id,
      atendimentoId,
      mensagemOrigemId: mensagemAssistente.id,
      conteudoCorrigido: fonteCorrigidoTexto,
      explicacaoAlteracao: secoes?.['Alterações realizadas'] || null,
      usuarioId: null,
    });
  }

  return mensagemAssistente;
}

const TEXTO_PRE_ANALISE = 'Este chamado acabou de ser alocado a um analista (primeiro posicionamento com retorno esperado do atendente, sem interação humana ainda além do texto original do chamado). Faça uma pré-análise inicial com base apenas no que está descrito acima — identifique o problema relatado, hipóteses prováveis de causa e uma sugestão de próximo passo. Deixe claro no nível de confiança que esta é uma análise preliminar, sem confirmação humana e sem anexos/prints do chamado (não disponíveis nesta etapa).';

/**
 * Pré-análise automática — disparada pela importação (ver
 * historical-import-service.js) quando um chamado recebe seu PRIMEIRO
 * posicionamento com aguardando_retorno=true (decisão do usuário, 2026-09:
 * o momento exato em que o chamado entra na fila do radar pela primeira
 * vez, ou seja, é alocado a um analista). Não roda de novo para chamados
 * que já tiveram algum posicionamento antes (idas e vindas na fila) — só
 * o primeiro contato. Erros aqui NUNCA devem interromper a importação —
 * quem chama trata a falha como best-effort (log, sem propagar).
 */
async function processarPreAnalise(empresaId, atendimentoId) {
  return processarTurno(empresaId, atendimentoId, { texto: TEXTO_PRE_ANALISE, usuarioId: null, automatico: true });
}

module.exports = { processarTurno, processarPreAnalise, _extrairSecoes, _extrairNivelConfianca, _extrairFonteCorrigido };

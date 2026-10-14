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
const respostaOperacionalService = require('./resposta-operacional-service');
const chamadoRepo = require('../repositories/chamado-repository');
const technicalResearchService = require('./technical-research-service');
const contextEngine = require('./context-engine');
const qualityGateService = require('./quality-gate-service');
const execucaoRepo = require('../repositories/investigacao-execucao-repository');
const tokenBudget = require('./token-budget-service');
const pdfVisualService = require('./pdf-visual-service');
const investigacaoDossieService = require('./investigacao-dossie-service');
const investigacaoDossieAtualizador = require('./investigacao-dossie-atualizador-service');
const dossieContextService = require('./dossie-context-service');
const { redigirValor } = require('./redaction-service');
const planoRespostaRastreavel = require('./plano-resposta-rastreavel-service');

const MAX_TENTATIVAS_TIMEOUT = 2;

function _garantirDossieSeguro(empresaId, atendimentoId, mensagemUsuario) {
  try {
    investigacaoDossieService.obterOuCriarDossie(empresaId, atendimentoId, {
      atualizadoPorMensagemId: mensagemUsuario?.id ?? null,
    });
  } catch (err) {
    console.error('[IA Service] Falha ao inicializar dossie tecnico do atendimento:', err.message);
  }
}

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

function _adicionarInstrucaoObservacaoVisual(userPrompt, contexto) {
  if (String(userPrompt || '').includes('<<<OBSERVACOES_VISUAIS_AUDITORIA>>>')) return userPrompt;
  const imagens = contexto?.manifesto?.selecionados?.filter(e => e.tipo === 'imagem' && e.imagemEnviada) || [];
  if (!imagens.length) return userPrompt;
  const mapa = imagens.map((img, idx) => `- imagem_${idx + 1}: anexoId=${img.id}; nome=${img.nome || img.id}`).join('\n');
  return [
    userPrompt,
    '',
    '## Observacoes visuais para auditoria interna',
    'Como ha imagens/prints nesta chamada, antes da resposta ao analista inclua um bloco JSON delimitado exatamente por <<<OBSERVACOES_VISUAIS_AUDITORIA>>> e <<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>.',
    'Esse bloco e apenas para auditoria e sera removido da resposta final. Nao use nele conclusoes causais; registre somente textos, campos, botoes, rotinas, mensagens ou valores que voce conseguiu observar visualmente.',
    'Formato obrigatorio:',
    '{"observacoesVisuais":[{"anexoId":"...","nome":"...","textosVisiveis":["..."],"campos":["..."],"valores":["..."],"observacao":"observacao curta sem conclusao causal","confiancaVisual":"alta|media|baixa"}]}',
    'Se nao conseguir ler um print, informe textosVisiveis vazio e confiancaVisual baixa.',
    'Imagens disponiveis:',
    mapa,
  ].join('\n');
}

// Remove, do texto exibido ao analista, um objeto JSON que contenha a chave
// informada (com ou sem cerca ```json), usando casamento de chaves — tolera o
// modelo omitir/errar os marcadores <<<...>>> do protocolo de auditoria.
function _removerBlocoJsonComChave(texto, chave) {
  const original = String(texto || '');
  const i = original.indexOf(`"${chave}"`);
  if (i < 0) return { texto: original, bloco: null };
  const ini = original.lastIndexOf('{', i);
  if (ini < 0) return { texto: original, bloco: null };
  let profundidade = 0;
  let emString = false;
  let escape = false;
  let fim = -1;
  for (let k = ini; k < original.length; k++) {
    const ch = original[k];
    if (emString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') emString = false;
      continue;
    }
    if (ch === '"') emString = true;
    else if (ch === '{') profundidade += 1;
    else if (ch === '}') {
      profundidade -= 1;
      if (profundidade === 0) { fim = k; break; }
    }
  }
  if (fim < 0) return { texto: original, bloco: null };
  const cercaAbertura = original.slice(0, ini).match(/```(?:json)?\s*$/i);
  const cercaFechamento = original.slice(fim + 1).match(/^\s*```/);
  const de = ini - (cercaAbertura ? cercaAbertura[0].length : 0);
  const ate = fim + 1 + (cercaFechamento ? cercaFechamento[0].length : 0);
  return { texto: `${original.slice(0, de)}${original.slice(ate)}`, bloco: original.slice(ini, fim + 1) };
}

// Nenhum token do protocolo interno pode chegar ao analista.
function _limparMarcadoresProtocolo(texto) {
  return String(texto || '')
    .replace(/<{0,3}\s*\/?\s*(?:FIM_)?OBSERVACOES_VISUAIS_AUDITORIA\s*>{0,3}/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

function _extrairObservacoesVisuaisDaResposta(texto, contexto) {
  const original = String(texto || '');
  const regex = /<<<OBSERVACOES_VISUAIS_AUDITORIA>>>\s*([\s\S]*?)\s*<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>/i;
  const match = original.match(regex);
  let textoLimpo;
  let bruto = null;
  if (match) {
    textoLimpo = original.replace(regex, '');
    bruto = match[1].trim();
  } else {
    const sem = _removerBlocoJsonComChave(original, 'observacoesVisuais');
    textoLimpo = sem.texto;
    bruto = sem.bloco;
  }
  textoLimpo = _limparMarcadoresProtocolo(textoLimpo).trim();
  if (!bruto) return { textoLimpo, observacoesVisuais: [] };
  let parsed = null;
  try {
    const json = bruto.match(/\{[\s\S]*\}/)?.[0] || bruto;
    parsed = JSON.parse(json);
  } catch (_) {
    return { textoLimpo, observacoesVisuais: [] };
  }
  const observacoes = Array.isArray(parsed) ? parsed : parsed?.observacoesVisuais;
  const imagens = contexto?.manifesto?.selecionados?.filter(e => e.tipo === 'imagem' && e.imagemEnviada) || [];
  const porId = new Map(imagens.map(i => [String(i.id), i]));
  const porNome = new Map(imagens.map(i => [String(i.nome || '').toLowerCase(), i]));
  const normalizadas = (Array.isArray(observacoes) ? observacoes : []).slice(0, 12).map((o, idx) => {
    const id = String(o?.anexoId || o?.id || '').trim();
    const nome = String(o?.nome || '').trim();
    const ref = porId.get(id) || porNome.get(nome.toLowerCase()) || imagens[idx] || null;
    return {
      anexoId: ref?.id || id || null,
      nome: ref?.nome || nome || null,
      textosVisiveis: Array.isArray(o?.textosVisiveis) ? o.textosVisiveis.map(x => String(x).slice(0, 180)).filter(Boolean).slice(0, 20) : [],
      campos: Array.isArray(o?.campos) ? o.campos.map(x => String(x).slice(0, 120)).filter(Boolean).slice(0, 20) : [],
      valores: Array.isArray(o?.valores) ? o.valores.map(x => String(x).slice(0, 80)).filter(Boolean).slice(0, 20) : [],
      observacao: String(o?.observacao || '').slice(0, 500),
      confiancaVisual: ['alta', 'media', 'baixa'].includes(String(o?.confiancaVisual || '').toLowerCase())
        ? String(o.confiancaVisual).toLowerCase()
        : 'baixa',
      origem: 'provider_multimodal_mesma_chamada',
    };
  }).filter(o => o.anexoId || o.nome || o.textosVisiveis.length || o.campos.length || o.valores.length);
  return { textoLimpo, observacoesVisuais: normalizadas };
}

function _aplicarObservacoesVisuais(resultado, contexto) {
  const extraido = _extrairObservacoesVisuaisDaResposta(resultado?.texto, contexto);
  if (extraido.observacoesVisuais.length) {
    contexto.manifesto.observacoesVisuais = extraido.observacoesVisuais;
    contexto.manifesto.observacoesVisuaisOrigem = 'provider_multimodal_mesma_chamada';
    contexto.manifesto.planoRespostaRastreavel = planoRespostaRastreavel.reconciliarObservacoesVisuais(
      contexto.manifesto.planoRespostaRastreavel,
      extraido.observacoesVisuais,
    );
  }
  return {
    ...resultado,
    texto: extraido.textoLimpo,
  };
}

function _limparBastidoresRetryTexto(texto) {
  let s = String(texto || '');
  s = s.replace(/^\s*#{1,4}\s*reescrita[^\r\n]*(?:\r?\n)+/i, '');
  s = s.replace(/^\s*reescrita\s*[-:][^\r\n]*(?:\r?\n)+/i, '');
  s = s.replace(/^\s*(?:entendi|claro|ok)[^\r\n]{0,500}\b(?:reescrev\w*|quality\s+gate|retry|tentativa\s+corretiva|resposta\s+anterior)[^\r\n]*(?:\r?\n)+\s*(?:[-â€”]{3,}\s*(?:\r?\n)+)?/i, '');
  s = s.replace(/^\s*(?:vou\s+)?reescrev\w+\s+(?:a\s+)?(?:resposta|analise|anÃ¡lise)[^\r\n]*(?:\r?\n)+\s*(?:[-â€”]{3,}\s*(?:\r?\n)+)?/i, '');
  s = s.replace(/^\s*(?:entendi|claro|ok)[\s\S]{0,180}\b(?:vou\s+)?reescrev\w*[\s\S]{0,120}(?:\r?\n){2,}/i, '');
  s = s.replace(/^\s*[-—]{3,}\s*(?:\r?\n)+/, '');
  s = s.replace(/^\s*(?:entendi|claro|ok)\s*[—,-]\s*(?:vou\s+)?(?:direto|focar|focando)[^\r\n]*(?:sem\s+template|sem\s+laudo|sem\s+repetir)[^\r\n]*(?:\r?\n){2,}/i, '');
  s = s.replace(/\b(?:vou\s+)?reescrev\w+\s+(?:a\s+)?(?:resposta|analise|análise)[^.\n]*\.?\s*/gi, '');
  s = s.replace(/^\s*#{1,4}\s+/gm, '');
  return s.trim();
}

function _adicionarLimitePesquisaSemPaginaLida(texto, pesquisa) {
  const s = String(texto || '').trim();
  const paginas = Array.isArray(pesquisa?.paginasLidas) ? pesquisa.paginasLidas : [];
  const temConteudo = paginas.some(p => p.status === 'lida' || p.status === 'reutilizada');
  if (pesquisa?.modo !== 'web' || temConteudo || !paginas.length) return s;
  const declaraLimite = /\b(pesquisa|documenta[cÃ§][aÃ£]o|fonte oficial|pagina|p[aÃ¡]gina)\b[\s\S]{0,140}\b(nao foi possivel|nao consegui|nao acessivel|nao acessada|nao lida|nenhuma pagina foi lida|sem conteudo|sem pagina lida|nao retornou conteudo|links sem leitura|limitacao)\b/i.test(s)
    || /\b(nao foi possivel|nao consegui|nao acessivel|nao acessada|nao lida|nenhuma pagina foi lida|sem conteudo|sem pagina lida|nao retornou conteudo|links sem leitura|limitacao)\b[\s\S]{0,140}\b(pesquisa|documenta[cÃ§][aÃ£]o|fonte oficial|pagina|p[aÃ¡]gina)\b/i.test(s);
  if (declaraLimite) return s;
  return `${s}\n\nA pesquisa externa retornou links, mas nenhuma pagina foi lida com conteudo tecnico utilizavel nesta execucao; por isso, a orientacao acima usa as evidencias internas do chamado e nao documentacao externa como confirmacao.`;
}

function _prepararTextoResposta(texto, pesquisa) {
  return _adicionarLimitePesquisaSemPaginaLida(_limparBastidoresRetryTexto(texto), pesquisa);
}

// O retry existe para corrigir atribuicao/certeza, nunca para piorar a analise.
// Se a resposta do retry for uma recusa do provider ("Desculpe, nao posso
// ajudar"), vazia ou muito mais curta que a anterior, ela e descartada e a
// resposta anterior e mantida (com seus alertas registrados).
function _retryDegradouResposta(textoRetry, textoAnterior) {
  const novo = String(textoRetry || '').trim();
  const anterior = String(textoAnterior || '').trim();
  if (!novo) return 'vazia';
  const norm = novo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (novo.length < 240 && /^(desculpe|sinto muito|lamento|nao posso|nao consigo ajudar|i(?:'m| am) sorry|sorry|i can(?:not|'t))/.test(norm)) return 'recusa_do_provider';
  if (anterior.length >= 300 && novo.length < anterior.length * 0.3) return 'muito_mais_curta';
  return null;
}

function _temBloqueioObjetivoQualityGate(qualityGate) {
  return (qualityGate?.falhas || []).some(f => (f.decisionKind || f.categoriaDecisao) === 'bloqueio_objetivo');
}

// M4 (2026-10): apos o retry, so falhas de INTEGRIDADE (atribuicao falsa de
// origem, certeza indevida, dados internos expostos, resposta truncada...)
// podem vetar a entrega. Estilo, qualidade e avisos operacionais geram alerta e
// a resposta do modelo e entregue — o Quality Gate nao substitui a analise.
function _calcularRevisaoNecessariaQualityGate({ qualityGate, retryDeQualityGate }) {
  if (!retryDeQualityGate || !qualityGate || qualityGate.aprovado) return false;
  return qualityGateService.temFalhaDeIntegridade(qualityGate);
}

function _statusFinalQualityGate(qualityGate, retryDeQualityGate) {
  if (qualityGate?.aprovado) return 'concluido';
  return _calcularRevisaoNecessariaQualityGate({ qualityGate, retryDeQualityGate })
    ? 'revisao_necessaria_quality_gate'
    : 'concluido_com_alerta_quality_gate';
}

function _statusFinalExecucao({ qualityGate, retryDeQualityGate, respostaTruncada = false } = {}) {
  if (respostaTruncada) return 'revisao_necessaria_quality_gate';
  return _statusFinalQualityGate(qualityGate, retryDeQualityGate);
}

function _marcarRespostaTruncadaNoGate(qualityGate) {
  const gate = qualityGate || { aprovado: true, falhas: [], decisoes: {} };
  const falhas = gate.falhas || [];
  if (!falhas.some(f => f.codigo === 'TRUNCATED_RESPONSE_INCOMPLETE')) {
    falhas.push({
      codigo: 'TRUNCATED_RESPONSE_INCOMPLETE',
      severidade: 'alta',
      detalhe: 'provider informou que a resposta foi cortada por limite de tokens/tamanho',
      acaoCorretiva: 'gerar_resposta_completa_ou_reduzir_escopo_sem_apresentar_parcial_como_concluida',
      decisionKind: 'bloqueio_objetivo',
      categoriaDecisao: 'bloqueio_objetivo',
    });
  }
  gate.falhas = falhas;
  gate.aprovado = false;
  gate.decisoes = {
    ...(gate.decisoes || {}),
    bloqueiosObjetivos: Math.max(1, gate.decisoes?.bloqueiosObjetivos || 0),
  };
  return gate;
}

function _removerIdsInternosTexto(texto) {
  return String(texto || '')
    .replace(/\baud[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-](?:msg|an|at|ch)[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-][a-z0-9_\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]+\b/gi, '[ID_INTERNO_REMOVIDO]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[UUID_INTERNO_REMOVIDO]');
}

function _resumirEvidenciaSemId(e) {
  const nome = e.nome ? `arquivo "${e.nome}"` : e.tipo === 'mensagem' ? 'mensagem do historico' : `${e.tipo || 'evidencia'} selecionada`;
  return `${nome} (${e.status || 'ANALISADA'}; ${e.motivo || 'sem motivo registrado'})`;
}

function _resumoQualityGate(gate) {
  return {
    aprovado: !!gate?.aprovado,
    falhas: (gate?.falhas || []).map(f => ({
      codigo: f.codigo,
      decisionKind: f.decisionKind || f.categoriaDecisao || null,
      termos: f.termos || [],
      classificacaoContextual: f.classificacaoContextual || null,
    })),
    decisoes: gate?.decisoes || null,
  };
}

async function _carregarPayloadVisual(contexto) {
  const fs = require('fs');
  const path = require('path');
  const armazenamento = require('./armazenamento-anexos');
  const imagens = [];
  const falhasImagem = [];
  const falhasPdfVisual = [];

  for (const anexo of contexto.imagensSelecionadas || []) {
    try {
      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      const buffer = fs.readFileSync(caminhoAbsoluto);
      if (!buffer.length || (anexo.tamanho && buffer.length !== anexo.tamanho)) {
        throw new Error(`Arquivo lido com tamanho inconsistente (esperado ${anexo.tamanho ?? '?'} bytes, lido ${buffer.length} bytes).`);
      }
      imagens.push({ mimeType: anexo.mimeType, base64: buffer.toString('base64'), origem: 'imagem', anexoId: anexo.id });
    } catch (err) {
      console.error('[IA Service] Falha ao ler anexo de imagem para anÃ¡lise:', anexo.id, anexo.nomeOriginal, err.message);
      falhasImagem.push(anexo.nomeOriginal || anexo.id);
    }
  }

  for (const item of contexto.pdfsVisuaisSelecionados || []) {
    const anexo = item.anexo;
    try {
      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      const buffer = fs.readFileSync(caminhoAbsoluto);
      const raster = await pdfVisualService.rasterizarPdfPaginas(buffer, item.paginas || [1]);
      if (raster.erro) throw new Error(raster.erro);
      for (const img of raster.imagens) {
        imagens.push({ mimeType: img.mimeType, base64: img.base64, origem: 'pdf', anexoId: anexo.id, pagina: img.pagina });
      }
    } catch (err) {
      console.error('[IA Service] Falha ao rasterizar PDF para anÃ¡lise visual:', anexo.id, anexo.nomeOriginal, err.message);
      falhasPdfVisual.push({ nome: anexo.nomeOriginal || anexo.id, erro: err.message });
    }
  }

  if (falhasPdfVisual.length > 0) {
    contexto.manifesto.pdfVisualFalhas = falhasPdfVisual.map(f => ({ nome: f.nome, erro: f.erro }));
  }

  return { imagens, falhasImagem, falhasPdfVisual };
}

async function _registrarErroVisual({ empresaId, atendimentoId, mensagemUsuario, contexto, pesquisaTecnica, userPrompt, falhasImagem, falhasPdfVisual }) {
  const falhas = [
    ...falhasImagem.map(nome => ({ codigo: 'IMAGEM_NAO_CARREGADA', severidade: 'alta', detalhe: nome })),
    ...falhasPdfVisual.map(f => ({ codigo: 'PDF_VISUAL_NAO_RASTERIZADO', severidade: 'alta', detalhe: f.erro ? `${f.nome} — ${f.erro}` : f.nome, erro: f.erro })),
  ];
  const nomes = [...falhasImagem, ...falhasPdfVisual.map(f => (f.erro ? `${f.nome}: ${f.erro}` : f.nome))].join(', ');
  const mensagemErro = `NÃ£o foi possÃ­vel carregar ${falhas.length} evidÃªncia(s) visual(is) para anÃ¡lise (${nomes}) â€” a investigaÃ§Ã£o foi interrompida para nÃ£o gerar um diagnÃ³stico sem considerar essas evidÃªncias. Tente novamente; se persistir, reenvie o(s) arquivo(s).`;
  // erroInfraestrutura: true evita que o Context Engine trate esta mensagem como
  // tentativa de diagnostico ao montar o historico do proximo turno.
  const msgErro = mensagemRepo.salvarMensagem(empresaId, atendimentoId, { papel: 'assistant', conteudo: mensagemErro, usuarioId: null, diagnostico: { erroInfraestrutura: true } });
  try {
    execucaoRepo.salvarExecucao(empresaId, {
      atendimentoId,
      mensagemId: msgErro.id,
      mensagemUsuarioId: mensagemUsuario?.id ?? null,
      status: 'erro_imagem',
      manifesto: contexto.manifesto,
      contexto: contexto.contextoResumo,
      pesquisa: pesquisaTecnica,
      qualityGate: {
        aprovado: false,
        deveRetry: false,
        falhas,
      },
      tokensEstimadosPrompt: contexto.contextoResumo.tokensEstimadosPrompt,
      promptChars: userPrompt.length,
    });
  } catch (auditErr) {
    console.error('[IA Service] Falha ao registrar auditoria de erro de imagem da investigaÃ§Ã£o:', auditErr.message);
  }
  return msgErro;
}

// Reaproveita imagens/PDFs ja carregados (e rasterizados) no turno quando o
// contexto reconstruido seleciona o mesmo subconjunto, evitando reler disco e
// reabrir o Chrome a cada candidato. Se faltar qualquer item, carrega tudo.
async function _carregarPayloadVisualReaproveitando(contexto, carregadas = []) {
  const reaproveitadas = [];
  let completo = true;
  for (const anexo of contexto.imagensSelecionadas || []) {
    const achada = carregadas.find(i => i.origem === 'imagem' && i.anexoId === anexo.id);
    if (!achada) { completo = false; break; }
    reaproveitadas.push(achada);
  }
  if (completo) {
    for (const item of contexto.pdfsVisuaisSelecionados || []) {
      const paginas = item.paginas || [1];
      const achadas = carregadas.filter(i => i.origem === 'pdf' && i.anexoId === item.anexo.id && paginas.includes(i.pagina));
      if (achadas.length !== paginas.length) { completo = false; break; }
      reaproveitadas.push(...achadas);
    }
  }
  if (completo) return { imagens: reaproveitadas, falhasImagem: [], falhasPdfVisual: [] };
  return _carregarPayloadVisual(contexto);
}

function _entradaDisponivelDoModelo(modelo) {
  return tokenBudget.criarOrcamento({ modelo, systemPrompt: promptBuilder.SYSTEM_PROMPT }).entradaDisponivel;
}

// Registro por tentativa (vai para tentativas_json da execucao): qual
// provider/modelo, qual orcamento e quais evidencias entraram ou ficaram de fora.
function _registroPreparo(ctx, candidato, reconstruido, qtdImagens) {
  const orc = ctx.manifesto?.orcamento || {};
  return {
    reconstruido,
    orcamento: {
      provider: candidato.provider,
      modelo: candidato.model,
      janela: orc.janela ?? null,
      respostaReservada: orc.respostaReservada ?? null,
      margem: orc.margem ?? null,
      entradaDisponivel: orc.entradaDisponivel ?? null,
      origem: orc.origemReferencia ?? null,
    },
    imagensEnviadas: qtdImagens,
    evidenciasIncluidas: (ctx.manifesto?.selecionados || []).map(s => ({ tipo: s.tipo, id: s.id, statusEnvio: s.statusEnvio || null })),
    evidenciasOmitidas: (ctx.manifesto?.omitidos || []).map(o => ({ tipo: o.tipo, id: o.id, motivo: o.motivo || o.status || null })),
  };
}

/**
 * Preparo do prompt POR CANDIDATO (opcao B, 2026-10). O contexto inicial e
 * dimensionado para o primeiro candidato elegivel da ordem cadastrada. Quando
 * o fallback chega a um modelo com orcamento diferente (janela maior OU
 * menor), o contexto e reconstruido para o orcamento desse modelo, em vez de
 * reenviar um prompt dimensionado para outro. Nenhum candidato e pulado por
 * preferencia nem por janela; a ordem cadastrada e preservada.
 *
 * Retorna { preparar, usadoPor }: `preparar` e o callback do chamarIA;
 * `usadoPor(resultado)` devolve o contexto/prompt/imagens da tentativa
 * vencedora (ou null) para persistencia e Quality Gate.
 */
function _criarPreparadorPorCandidato({ contexto, userPromptAtual, imagensAtuais, candidatoAtual, paramsContexto, evidenciaForcadaIds = [], decorar }) {
  const base = { contexto, userPrompt: userPromptAtual, imagens: [...imagensAtuais] };
  const usados = new Map();
  const reconstruidos = new Map();
  const entradaBase = candidatoAtual ? _entradaDisponivelDoModelo(candidatoAtual.model) : null;

  async function preparar({ provider, model, suportaImagem }) {
    const chave = `${provider}|${model}`;
    const mesmoOrcamento = entradaBase !== null
      && _entradaDisponivelDoModelo(model) === entradaBase
      && (suportaImagem || base.imagens.length === 0);
    if (mesmoOrcamento) {
      usados.set(chave, base);
      return { registro: _registroPreparo(base.contexto, { provider, model }, false, base.imagens.length) };
    }
    const chaveCache = `${chave}|${suportaImagem ? 'v' : 'n'}`;
    let pronto = reconstruidos.get(chaveCache);
    if (!pronto) {
      const novo = contextEngine.montarContextoInvestigacao({
        ...paramsContexto,
        evidenciaForcadaIds,
        candidatoOrcamento: { provider, model },
        permitirImagens: !!suportaImagem,
      });
      const payload = await _carregarPayloadVisualReaproveitando(novo, base.imagens);
      if (payload.falhasImagem.length > 0 || payload.falhasPdfVisual.length > 0) {
        const nomes = [...payload.falhasImagem, ...payload.falhasPdfVisual.map(f => f.nome)].join(', ');
        throw new Error(`evidencia(s) visual(is) nao carregada(s): ${nomes}`);
      }
      pronto = { contexto: novo, userPrompt: decorar(novo, novo.userPrompt), imagens: payload.imagens };
      reconstruidos.set(chaveCache, pronto);
    }
    usados.set(chave, pronto);
    return {
      userPrompt: pronto.userPrompt,
      imagens: pronto.imagens,
      registro: _registroPreparo(pronto.contexto, { provider, model }, true, pronto.imagens.length),
    };
  }

  function usadoPor(resultado) {
    return usados.get(`${resultado?.provider}|${resultado?.model}`) || null;
  }

  return { preparar, usadoPor };
}

const SYSTEM_PROMPT_CLASSIFICACAO_TURNO = `Você classifica uma única mensagem de um analista de suporte técnico dentro de um chat de investigação. Responda APENAS com um JSON: {"tipo": "pergunta_processo" | "fora_de_escopo" | "investigacao"}.

"pergunta_processo": a mensagem é sobre VOCÊ (a IA) ou sobre O PROCESSO administrativo de atendimento — sua capacidade, limites, próximos passos administrativos, prazos, ou se um passo administrativo é necessário. NÃO envolve nenhum conceito técnico do domínio do chamado (regra de negócio, campo, rotina, cálculo, comportamento esperado do sistema). Exemplos: "se eu te enviar o fonte, você consegue corrigir?", "você consegue ver vídeo?", "precisa abrir chamado na TOTVS também?", "em quanto tempo você responde?", "o que você precisa de mim agora?".

"fora_de_escopo": a mensagem é CLARAMENTE alheia ao chamado, ao sistema/ERP e ao atendimento — assunto geral sem nenhuma relação com o trabalho de suporte. Exemplos: "qual a temperatura em Cuiabá agora?", "que dia é hoje?", "me conta uma piada", "quem ganhou o jogo ontem?". Só use quando NÃO houver qualquer ligação plausível com o chamado, com um sistema ou com o atendimento.

"investigacao": a mensagem pergunta sobre o PROBLEMA TÉCNICO em si — isso inclui perguntar sobre uma REGRA DE NEGÓCIO ou COMPORTAMENTO ESPERADO do sistema (ex.: "esse campo deveria somar ou subtrair?", "qual a regra para X?"), trazer evidência técnica nova (erro, log, trecho de código, resultado de teste), ou pedir para investigar/corrigir/pesquisar algo concreto do domínio do chamado. Perguntas sobre REGRA DE NEGÓCIO SEMPRE são "investigacao", mesmo que pareçam pedidos de confirmação ou esclarecimento pontual — elas exigem evidência técnica do caso para responder com segurança, não são sobre o processo de atendimento.

Na dúvida entre os dois, responda "investigacao" (nunca deixe de investigar uma evidência técnica real por classificar errado).`;

/**
 * Classifica a mensagem ATUAL do analista antes de montar o prompt completo
 * de investigação — 2026-10, achado real em produção: perguntas pontuais
 * sobre processo/capacidade ("se eu te enviar o fonte, você consegue
 * corrigir?") recebiam de volta o MESMO diagnóstico técnico já dado antes,
 * ignorando a pergunta. Só pedir no texto do system prompt para "responder a
 * pergunta pontual primeiro" não resolveu (testado contra o caso real: o
 * modelo seguiu reabrindo o diagnóstico) — o prompt principal carrega demais
 * contexto técnico competindo pela atenção do modelo. Esta classificação
 * roda ANTES, isolada, com uma chamada curta e barata, para decidir se vale
 * a pena montar o prompt completo ou responder de forma curta e direta.
 *
 * Falha aberta: qualquer erro na classificação (provider fora, JSON
 * inválido) devolve 'investigacao' — o comportamento padrão já existente,
 * nunca pior do que o que já estava em produção antes desta função existir.
 */
async function _classificarTurno(texto, { keys, cfg }) {
  if (!texto || texto.length > 400) return 'investigacao';
  try {
    const resultado = await aiProviderClient.chamarIA(
      keys, cfg, SYSTEM_PROMPT_CLASSIFICACAO_TURNO, texto, [],
      { maxTokens: 30, timeoutMs: 12000, json: true, maxProviderRounds: 1 },
    );
    const parsed = JSON.parse(resultado.texto.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (parsed.tipo === 'pergunta_processo' || parsed.tipo === 'fora_de_escopo') return parsed.tipo;
    return 'investigacao';
  } catch (err) {
    console.error('[IA Service] Classificação de turno falhou, seguindo como investigação:', err.message);
    return 'investigacao';
  }
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
 * radar-service.iniciarAnalise), então o "turno" aqui é só pedir à
 * IA que analise o que já está no histórico. `texto` vira uma instrução
 * fixa, não uma mensagem do analista.
 */
async function processarTurno(empresaId, atendimentoId, { texto, usuarioId, anexoIds = [], automatico = false, anexosComoContexto = false, forcarPesquisa = false, analistaAtualNome = null }) {
  const atendimento = mensagemService.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado nesta empresa.');

  let historico;
  let mensagemUsuario = null;
  if (automatico) {
    // Nenhuma mensagem nova de usuário — analisa o histórico já existente
    // (conteúdo do chamado + posicionamentos, gravado na abertura do
    // atendimento) por inteiro.
    historico = mensagemRepo.listarMensagens(empresaId, atendimentoId);
  } else {
    // Persiste a mensagem do usuário primeiro — mesmo que a IA falhe depois,
    // o turno do usuário (texto + anexos) fica registrado no histórico.
    mensagemUsuario = mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel: 'user',
      conteudo: texto,
      usuarioId,
      origemAutor: analistaAtualNome || null,
    });
    historico = mensagemRepo.listarMensagens(empresaId, atendimentoId)
      .filter(m => m.id !== mensagemUsuario.id); // histórico ANTERIOR a este turno
  }

  _garantirDossieSeguro(empresaId, atendimentoId, mensagemUsuario);

  // Vincula os anexos deste turno à mensagem (eles já existem em `anexos`,
  // criados pela rota de upload ou pela sincronização automática do
  // SoftExpert — aqui só associamos à mensagem correta). No modo manual, a
  // mensagem do usuário já existe neste ponto; no modo automático (pré-
  // análise do radar) não há mensagem de usuário, então o vínculo é feito
  // mais abaixo, à mensagem do assistente que a IA está prestes a gerar —
  // sem isso, os anexos sincronizados ficavam "soltos" no atendimento,
  // visíveis só no resumo do cabeçalho do chat, nunca dentro da bolha da
  // mensagem que de fato os usou na análise (bug reportado pelo usuário,
  // 2026-09).
  const anexosDoTurno = anexoIds
    .map(id => anexoRepo.getAnexo(empresaId, id))
    .filter(Boolean);

  if (mensagemUsuario && !anexosComoContexto) {
    for (const anexo of anexosDoTurno) {
      anexoRepo.vincularMensagem(empresaId, anexo.id, mensagemUsuario.id);
    }
  }

  const todosAnexosDoAtendimento = anexoRepo.listarAnexos(empresaId, atendimentoId);
  const anexosTextoParaPesquisa = todosAnexosDoAtendimento.filter(a => a.conteudoExtraido);

  // Pergunta de processo/capacidade ("se eu te enviar o fonte, você
  // consegue corrigir?") não passa pelo prompt completo de investigação —
  // ver _classificarTurno acima. Só roda em turno manual, sem forcarPesquisa
  // (o botão "Pesquisar Soluções" sempre quer investigação completa) e sem
  // anexo novo deste turno (anexo novo é, quase sempre, evidência técnica).
  if (!automatico && !forcarPesquisa && anexoIds.length === 0 && mensagemUsuario) {
    const { keys: keysClassificacao, cfg: cfgClassificacao } = aiConfigService.resolverKeysEOrdem(empresaId);
    const tipoTurno = await _classificarTurno(texto, { keys: keysClassificacao, cfg: cfgClassificacao });
    if (tipoTurno === 'pergunta_processo' || tipoTurno === 'fora_de_escopo') {
      // redigirValor: este atalho curto NUNCA passa pelo Context Engine (que
      // aplica a redacao no fluxo principal) — sem isso, CPF/senha/token do
      // historico iam em texto claro para o provider sempre que o turno fosse
      // classificado como pergunta_processo (achado real, homologacao 2026-10).
      const historicoRecente = historico.slice(-8)
        .map(m => `[${m.papel === 'user' ? 'Analista' : 'Você'}]: ${redigirValor(String(m.conteudo || '').slice(0, 600))}`)
        .join('\n');
      // fora_de_escopo: resposta curta que não reabre o chamado (2026-10,
      // pedido do usuário: pergunta de clima/data gerava resposta longa
      // reabrindo o chamado inteiro). Este atalho não grava execução de
      // investigação, então a avaliação humana não é oferecida (ver
      // resposta-operacional-service.execucaoAvaliavel).
      const instrucaoFinal = tipoTurno === 'fora_de_escopo'
        ? 'Esta pergunta não tem relação com o chamado. Responda em no máximo 2 frases: se souber responder com segurança (sem inventar dados em tempo real, que você não tem), responda; caso contrário, diga que não tem como consultar isso aqui. Não reabra, não resuma e não repita nada do chamado; apenas convide o analista a seguir com o chamado quando quiser.'
        : 'Responda SOMENTE essa pergunta, de forma direta e breve (poucas frases). Não reabra nem repita o diagnóstico técnico já dado nas mensagens anteriores.';
      const promptCurto = `## Contexto recente da conversa\n${historicoRecente}\n\n## Pergunta atual do analista\n${redigirValor(texto)}\n\n${instrucaoFinal}`;
      try {
        const resultadoCurto = await aiProviderClient.chamarIA(
          keysClassificacao, cfgClassificacao, promptBuilder.SYSTEM_PROMPT, promptCurto, [],
          { maxTokens: tipoTurno === 'fora_de_escopo' ? 200 : 500, timeoutMs: 20000 },
        );
        return mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
          papel: 'assistant', conteudo: resultadoCurto.texto, usuarioId: null,
          provider: resultadoCurto.provider, model: resultadoCurto.model,
          respostaCurta: tipoTurno,
        });
      } catch (err) {
        console.error('[IA Service] Falha ao responder pergunta de processo curta, seguindo fluxo completo:', err.message);
        // cai para o fluxo normal abaixo — falha aqui não deve bloquear o turno
      }
    }
  }

  let pesquisaTecnicaTexto = '';
  let pesquisaTecnica = null;
  let relacionados = [];
  let dossieOperacionalTurno = null;
  let chamado = null;
  try {
    chamado = atendimento.referenciaExterna
      ? chamadoRepo.getChamadoPorNumero(empresaId, atendimento.referenciaExterna, atendimento.origem)
      : null;
    relacionados = chamado
      ? chamadoRepo.listarChamadosRelacionados(empresaId, chamado.id, { limite: 5 })
      : [];
    const { cfg: cfgPesquisa } = aiConfigService.resolverKeysEOrdem(empresaId);
    const modeloPesquisa = cfgPesquisa?.modelos?.[cfgPesquisa?.provedorPrimario] || Object.values(cfgPesquisa?.modelos || {})[0] || null;
    const orcamentoPesquisa = tokenBudget.criarOrcamento({ modelo: modeloPesquisa, systemPrompt: promptBuilder.SYSTEM_PROMPT });
    try {
      dossieOperacionalTurno = dossieContextService.montarMemoriaOperacional({
        empresaId,
        atendimentoId,
        mensagemAtual: texto,
        orcamentoEntrada: orcamentoPesquisa.entradaDisponivel,
      });
    } catch (dossieErr) {
      dossieOperacionalTurno = {
        texto: '',
        manifesto: { status: 'DEGRADADO', erro: dossieErr.message, selecionados: [], omitidos: [], evidenciasRecuperadas: [], evidenciasIndisponiveis: [] },
        contextoResumo: { tokensEstimados: 0, degraded: true },
      };
    }
    const pesquisa = await technicalResearchService.pesquisar({
      empresaId,
      atendimentoId,
      chamado,
      atendimento,
      mensagens: historico,
      anexos: anexosTextoParaPesquisa,
      texto,
      dossieOperacional: dossieOperacionalTurno,
      // Pedido EXPLICITO do usuario (botão "Pesquisar Soluções" do Radar) —
      // nunca bloqueado por dedup de consulta nem pela disciplina 4B (ver
      // technical-research-service._deduplicarConsultas e
      // investigative-discipline-service.aplicarDisciplinaPesquisa). Só é
      // true quando o caller explicitamente pede reexecução; nunca setado em
      // turnos automáticos.
      forcarPesquisa,
      // Etapa 4B (disciplina investigativa) existia implementada e testada
      // isoladamente, mas nunca conectada ao fluxo real — nenhum atendimento
      // de produção jamais chamou com esse flag (achado real, Caso #001,
      // 2026-10: a resposta real nunca passou pela suficiência/lacuna
      // estruturada, só pelo Quality Gate léxico). Habilitado via env var
      // para permitir desligar rapidamente se um efeito colateral aparecer
      // em produção sem precisar de novo deploy.
      disciplina4B: process.env.IA_SERVICE_DISCIPLINA_4B !== '0',
    }, {
      // Pesquisa Web sem contratar Serper/Bing por .env (decisão do usuário,
      // 2026-10): reutiliza a infraestrutura de providers de IA já
      // configurada na Platform (Serper com credencial própria, Gemini/
      // OpenAI reaproveitando a chave de IA já cadastrada da empresa).
      searchConfig: aiConfigService.resolverConfigPesquisa(empresaId),
    });
    pesquisaTecnica = pesquisa;
    pesquisaTecnicaTexto = technicalResearchService.formatarContextoParaPrompt(pesquisa, relacionados);
  } catch (err) {
    pesquisaTecnicaTexto = [
      '## Pesquisa técnica assistida',
      `Pesquisa técnica indisponível nesta tentativa: ${err.message}`,
      'Siga com as evidências locais do chamado e peça confirmação humana quando necessário.',
    ].join('\n');
  }

  const { keys, cfg } = aiConfigService.resolverKeysEOrdem(empresaId);
  // Parametros de montagem do contexto, reaproveitados nas reconstrucoes por
  // candidato (cada modelo da ordem cadastrada tem seu proprio orcamento).
  const paramsContexto = {
    atendimento,
    mensagens: historico,
    mensagemAtual: texto,
    anexosDoTurno,
    anexosComoContexto,
    pesquisaTecnicaTexto,
    pesquisa: pesquisaTecnica,
    relacionados,
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg,
    keys,
    dossieOperacionalPrecarregado: dossieOperacionalTurno,
    analistaAtualNome,
    chamado,
  };
  // Primeiro candidato da ordem cadastrada (primario + fallback) com chave,
  // SEM exigir visao: so se sabe se ha imagem efetivamente enviada depois que
  // o contexto e montado. Se houver, o candidato com visao e resolvido abaixo.
  let candidatoBase = aiProviderClient.primeiroCandidatoElegivel(keys, cfg, { exigeImagem: false });
  let contexto = contextEngine.montarContextoInvestigacao({
    ...paramsContexto,
    candidatoOrcamento: candidatoBase,
    // Imagens permitidas no 1o build: a regra "anexo de imagem nunca e
    // ignorado" exige detectar se ha imagem efetivamente enviada, mesmo que o
    // candidato-base nao tenha visao (nesse caso troca-se o candidato abaixo).
    permitirImagens: true,
  });
  let userPrompt = contexto.userPrompt;

  // Carrega as imagens do turno do disco. Decisão explícita do usuário,
  // 2026-10: imagem anexada NUNCA pode ser ignorada silenciosamente — antes,
  // uma falha de leitura só gerava um console.warn e o turno seguia como se
  // nada tivesse acontecido, produzindo uma resposta "normal" que na
  // verdade nunca viu a foto (achado real: chamado com 7 fotos de
  // WhatsApp recebeu diagnóstico genérico). Agora: falha de leitura ou
  // buffer corrompido (tamanho gravado ≠ tamanho lido) interrompe o turno
  // ANTES de chamar a IA — nunca gera uma resposta fingindo análise
  // completa. O analista vê o erro e tenta de novo, em vez de confiar
  // silenciosamente numa análise capenga.
  const imagens = [];
  const falhasImagem = [];
  for (const anexo of contexto.imagensSelecionadas) {
    const fs = require('fs');
    const path = require('path');
    const armazenamento = require('./armazenamento-anexos');
    try {
      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      const buffer = fs.readFileSync(caminhoAbsoluto);
      if (!buffer.length || (anexo.tamanho && buffer.length !== anexo.tamanho)) {
        throw new Error(`Arquivo lido com tamanho inconsistente (esperado ${anexo.tamanho ?? '?'} bytes, lido ${buffer.length} bytes).`);
      }
      imagens.push({ mimeType: anexo.mimeType, base64: buffer.toString('base64'), origem: 'imagem', anexoId: anexo.id });
    } catch (err) {
      console.error('[IA Service] Falha ao ler anexo de imagem para análise:', anexo.id, anexo.nomeOriginal, err.message);
      falhasImagem.push(anexo.nomeOriginal || anexo.id);
    }
  }
  const falhasPdfVisual = [];
  for (const item of contexto.pdfsVisuaisSelecionados || []) {
    const fs = require('fs');
    const path = require('path');
    const armazenamento = require('./armazenamento-anexos');
    const anexo = item.anexo;
    try {
      const caminhoAbsoluto = path.join(armazenamento.ANEXOS_DIR, anexo.caminhoRelativo);
      const buffer = fs.readFileSync(caminhoAbsoluto);
      const raster = await pdfVisualService.rasterizarPdfPaginas(buffer, item.paginas || [1]);
      if (raster.erro) throw new Error(raster.erro);
      for (const img of raster.imagens) {
        imagens.push({ mimeType: img.mimeType, base64: img.base64, origem: 'pdf', anexoId: anexo.id, pagina: img.pagina });
      }
    } catch (err) {
      console.error('[IA Service] Falha ao rasterizar PDF para análise visual:', anexo.id, anexo.nomeOriginal, err.message);
      falhasPdfVisual.push({ nome: anexo.nomeOriginal || anexo.id, erro: err.message });
    }
  }
  if (falhasPdfVisual.length > 0) {
    contexto.manifesto.pdfVisualFalhas = falhasPdfVisual.map(f => ({ nome: f.nome, erro: f.erro }));
  }
  if (falhasImagem.length > 0 || falhasPdfVisual.length > 0) {
    const falhas = [
      ...falhasImagem.map(nome => ({ codigo: 'IMAGEM_NAO_CARREGADA', severidade: 'alta', detalhe: nome })),
      ...falhasPdfVisual.map(f => ({ codigo: 'PDF_VISUAL_NAO_RASTERIZADO', severidade: 'alta', detalhe: f.erro ? `${f.nome} — ${f.erro}` : f.nome, erro: f.erro })),
    ];
    const nomes = [...falhasImagem, ...falhasPdfVisual.map(f => (f.erro ? `${f.nome}: ${f.erro}` : f.nome))].join(', ');
    const mensagemErro = `Não foi possível carregar ${falhas.length} evidência(s) visual(is) para análise (${nomes}) — a investigação foi interrompida para não gerar um diagnóstico sem considerar essas evidências. Tente novamente; se persistir, reenvie o(s) arquivo(s).`;
    const msgErro = mensagemRepo.salvarMensagem(empresaId, atendimentoId, { papel: 'assistant', conteudo: mensagemErro, usuarioId: null, diagnostico: { erroInfraestrutura: true } });
    try {
      execucaoRepo.salvarExecucao(empresaId, {
        atendimentoId,
        mensagemId: msgErro.id,
        mensagemUsuarioId: mensagemUsuario?.id ?? null,
        status: 'erro_imagem',
        manifesto: contexto.manifesto,
        contexto: contexto.contextoResumo,
        pesquisa: pesquisaTecnica,
        qualityGate: {
          aprovado: false,
          deveRetry: false,
          falhas,
        },
        tokensEstimadosPrompt: contexto.contextoResumo.tokensEstimadosPrompt,
        promptChars: userPrompt.length,
      });
    } catch (auditErr) {
      console.error('[IA Service] Falha ao registrar auditoria de erro de imagem da investigação:', auditErr.message);
    }
    return msgErro;
  }

  // Modalidade: com imagem efetivamente enviada e candidato-base sem visao,
  // o orcamento passa a ser o do primeiro candidato da ORDEM CADASTRADA que
  // tem visao (mesma regra de elegibilidade do ai-provider-client). Nenhum
  // provider e promovido por preferencia: so se segue a ordem do cadastro.
  if (imagens.length > 0 && candidatoBase && !aiProviderClient.PROVIDER_CONFIGS[candidatoBase.provider]?.suportaImagem) {
    const candidatoVisao = aiProviderClient.primeiroCandidatoElegivel(keys, cfg, { exigeImagem: true });
    if (candidatoVisao) {
      const novoContexto = contextEngine.montarContextoInvestigacao({ ...paramsContexto, candidatoOrcamento: candidatoVisao, permitirImagens: true });
      const payloadNovo = await _carregarPayloadVisualReaproveitando(novoContexto, imagens);
      if (payloadNovo.falhasImagem.length > 0 || payloadNovo.falhasPdfVisual.length > 0) {
        return _registrarErroVisual({
          empresaId,
          atendimentoId,
          mensagemUsuario,
          contexto: novoContexto,
          pesquisaTecnica,
          userPrompt: novoContexto.userPrompt,
          falhasImagem: payloadNovo.falhasImagem,
          falhasPdfVisual: payloadNovo.falhasPdfVisual,
        });
      }
      contexto = novoContexto;
      userPrompt = novoContexto.userPrompt;
      imagens.splice(0, imagens.length, ...payloadNovo.imagens);
      candidatoBase = candidatoVisao;
    }
  }

  // Timeout escalado pelo volume de imagens — payload maior (base64 de N
  // fotos) leva mais tempo de upload + processamento do lado do provedor.
  // Com timeout fixo, turnos com várias imagens (ex.: 7 fotos de WhatsApp)
  // arriscavam estourar o prazo, cair no provedor seguinte do fallback (que
  // pode não suportar imagem) e seguir SEM nunca ter analisado as fotos —
  // silenciosamente, sem erro visível. Decisão do usuário, 2026-10: anexo
  // de imagem nunca pode ser ignorado, então o timeout precisa ser realista
  // para o volume real do turno.
  const timeoutMs = 45000 + imagens.length * 15000;

  let resultado;
  let qualityGate = null;
  let retryDeQualityGate = false;
  let acoesRetry = [];
  let promptUsado = userPrompt;
  const inicioIa = Date.now();
  try {
    userPrompt = _adicionarInstrucaoObservacaoVisual(userPrompt, contexto);
    promptUsado = userPrompt;
    const preparador = _criarPreparadorPorCandidato({
      contexto,
      userPromptAtual: promptUsado,
      imagensAtuais: imagens,
      candidatoAtual: candidatoBase,
      paramsContexto,
      decorar: (ctx, prompt) => _adicionarInstrucaoObservacaoVisual(prompt, ctx),
    });
    resultado = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, promptUsado, imagens, {
      maxTokens: 6000,
      timeoutMs,
      prepararParaCandidato: preparador.preparar,
    });
    // O contexto/manifesto/imagens persistidos e avaliados pelo Quality Gate
    // sao os da tentativa vencedora (podem ter sido reconstruidos para o
    // orcamento do modelo que de fato respondeu).
    const usadoPrincipal = preparador.usadoPor(resultado);
    if (usadoPrincipal) {
      contexto = usadoPrincipal.contexto;
      promptUsado = usadoPrincipal.userPrompt;
      userPrompt = usadoPrincipal.userPrompt;
      imagens.splice(0, imagens.length, ...usadoPrincipal.imagens);
    }
    resultado = _aplicarObservacoesVisuais(resultado, contexto);
    resultado.texto = _prepararTextoResposta(resultado.texto, pesquisaTecnica);
    qualityGate = qualityGateService.avaliarResposta({
      textoResposta: resultado.texto,
      manifesto: contexto.manifesto,
      pesquisa: pesquisaTecnica,
      pergunta: texto,
      houveRetry: false,
      historicoMensagens: historico,
      indiceReferencias: contexto.indiceReferencias,
    });
    if (qualityGate.deveRetry) {
      retryDeQualityGate = true;
      const qualityGateAntesRetry = qualityGate;
      const resultadoAntesRetry = resultado;
      const respostaAntesRetry = String(resultado.texto || '');
      const idsForcados = (qualityGate.falhas || []).map(f => f.evidenciaId).filter(Boolean);
      if (idsForcados.length) {
        contexto = contextEngine.montarContextoInvestigacao({
          ...paramsContexto,
          evidenciaForcadaIds: idsForcados,
          candidatoOrcamento: candidatoBase,
          permitirImagens: true,
        });
        userPrompt = contexto.userPrompt;
        const payloadVisualRetry = await _carregarPayloadVisual(contexto);
        imagens.splice(0, imagens.length, ...payloadVisualRetry.imagens);
        if (payloadVisualRetry.falhasImagem.length > 0 || payloadVisualRetry.falhasPdfVisual.length > 0) {
          return _registrarErroVisual({
            empresaId,
            atendimentoId,
            mensagemUsuario,
            contexto,
            pesquisaTecnica,
            userPrompt,
            falhasImagem: payloadVisualRetry.falhasImagem,
            falhasPdfVisual: payloadVisualRetry.falhasPdfVisual,
          });
        }
        acoesRetry.push({ tipo: 'contexto_reconstruido', evidenciaForcadaIds: idsForcados });
      }
      if ((qualityGate.falhas || []).some(f => f.codigo === 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE')) {
        acoesRetry.push({ tipo: 'reforco_evidencias_especificas' });
      }
      userPrompt = _adicionarInstrucaoObservacaoVisual(userPrompt, contexto);
      promptUsado = `${userPrompt}\n\n## Reprocessamento por Quality Gate\n${qualityGateService.montarInstrucaoRetry(qualityGate, { manifesto: contexto.manifesto })}`;
      // maxProviderRounds:1 — teto global de tentativas por investigacao: a
      // primeira chamada ja varreu todos os providers elegiveis em ate 3
      // rodadas; repetir rodadas completas tambem no retry do Quality Gate
      // multiplicava o pior caso teorico para ~45 tentativas HTTP numa unica
      // investigacao sem nenhum limite agregado (achado real, auditoria do
      // fallback multi-provider 2026-10). Uma rodada aqui ainda tenta TODOS
      // os providers elegiveis uma vez, so nao reinsiste em erro transitorio.
      const contextoRetry = contexto;
      const preparadorRetry = _criarPreparadorPorCandidato({
        contexto: contextoRetry,
        userPromptAtual: promptUsado,
        imagensAtuais: imagens,
        candidatoAtual: candidatoBase,
        paramsContexto,
        evidenciaForcadaIds: idsForcados,
        decorar: (ctx, prompt) => `${_adicionarInstrucaoObservacaoVisual(prompt, ctx)}\n\n## Reprocessamento por Quality Gate\n${qualityGateService.montarInstrucaoRetry(qualityGateAntesRetry, { manifesto: ctx.manifesto })}`,
      });
      resultado = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, promptUsado, imagens, {
        maxTokens: 6000,
        timeoutMs,
        maxProviderRounds: 1,
        prepararParaCandidato: preparadorRetry.preparar,
      });
      const motivoDescarteRetry = _retryDegradouResposta(resultado.texto, respostaAntesRetry);
      if (motivoDescarteRetry) {
        acoesRetry.push({ tipo: 'retry_descartado_resposta_degradada', motivo: motivoDescarteRetry });
        resultado = {
          ...resultadoAntesRetry,
          tentativas: [...(resultadoAntesRetry.tentativas || []), ...(resultado.tentativas || [])],
        };
      }
      const usadoRetry = motivoDescarteRetry ? null : preparadorRetry.usadoPor(resultado);
      if (usadoRetry) {
        contexto = usadoRetry.contexto;
        promptUsado = usadoRetry.userPrompt;
        imagens.splice(0, imagens.length, ...usadoRetry.imagens);
      }
      resultado = _aplicarObservacoesVisuais(resultado, contexto);
      resultado.texto = _prepararTextoResposta(resultado.texto, pesquisaTecnica);
      qualityGate = qualityGateService.avaliarResposta({
        textoResposta: resultado.texto,
        manifesto: contexto.manifesto,
        pesquisa: pesquisaTecnica,
        pergunta: texto,
        houveRetry: true,
        historicoMensagens: historico,
      indiceReferencias: contexto.indiceReferencias,
      });
      const codigosReescritaFinal = new Set([
        'ROBOTIC_TEMPLATE_RESPONSE',
        'WEAK_ACTIONABLE_CORRECTION',
        'SPECIFIC_ERROR_NOT_PRIORITIZED',
        'INTERNAL_IDS_USED_AS_EVIDENCE',
        'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
        'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE',
        'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE',
        'RESEARCH_FOUND_BUT_NOT_READ',
      ]);
      const falhasReescritaFinal = (qualityGate.falhas || []).filter(f => codigosReescritaFinal.has(f.codigo));
      if (falhasReescritaFinal.length > 0 && (qualityGate.falhas || []).every(f => codigosReescritaFinal.has(f.codigo))) {
        acoesRetry.push({ tipo: 'reescrita_final_quality_gate', falhas: falhasReescritaFinal.map(f => f.codigo) });
        const evidenciasResumo = (contexto.manifesto?.selecionados || [])
          .slice(0, 12)
          .map(_resumirEvidenciaSemId)
          .join('\n');
        const fontesResumo = (pesquisaTecnica?.paginasLidas || [])
          .slice(0, 6)
          .map(p => `${p.status || 'fonte'}: ${p.titulo || p.url}`)
          .join('\n');
        promptUsado = [
          '## Reescrita final obrigatoria por Quality Gate',
          qualityGateService.montarInstrucaoRetry(qualityGate, { manifesto: contexto.manifesto }),
          '',
          'A resposta abaixo ja analisou o caso, mas ainda falhou no Quality Gate. Reescreva SEM reinvestigar do zero.',
          '',
          'Regras obrigatorias:',
          '- nao use cabecalhos Markdown;',
          '- nao use checklist de laudo;',
          '- nao mencione Quality Gate, reescrita, retry, resposta anterior ou qualquer bastidor interno;',
          '- nao recomende videochamada;',
          '- comece pelo erro especifico mais forte;',
          '- diga o primeiro teste/ajuste tecnico concreto;',
          '- mantenha evidencias visuais e fontes oficiais que sustentam a analise;',
          '- se mencionar parametros/documentacao, trate como apoio e nao como primeira trilha quando existir erro especifico de tela/log.',
          '- se houver apenas trecho de fonte/codigo, nao apresente declaracao, escopo ou inicializacao de variavel como causa confirmada; trate como hipotese e peca fonte completo + compilacao/execucao controlada;',
          '- em SoftExpert Workflow, se HTTP 200 coexistir com atividade parada, trate HTTP 200 como fato de recebimento/processamento do callback; trate permissao, papel ou responsavel como hipotese ate haver log interno/auditoria/configuracao confirmando;',
          '- se a pesquisa tecnica encontrou links mas nenhuma pagina foi lida/reutilizada, declare essa limitacao em uma frase curta e nao cite a documentacao como fonte consultada;',
          '',
          '## Evidencias selecionadas resumidas',
          evidenciasResumo || 'Sem resumo de evidencias.',
          '',
          '## Fontes tecnicas lidas/reutilizadas',
          fontesResumo || 'Sem fontes tecnicas.',
          '',
          '## Resposta anterior a reescrever',
          _removerIdsInternosTexto(resultado.texto),
        ].join('\n');
        resultado = await aiProviderClient.chamarIA(keys, cfg, promptBuilder.SYSTEM_PROMPT, promptUsado, [], {
          maxTokens: 2200,
          timeoutMs: Math.min(timeoutMs, 60000),
          maxProviderRounds: 1,
        });
        resultado.texto = _prepararTextoResposta(resultado.texto, pesquisaTecnica);
        qualityGate = qualityGateService.avaliarResposta({
          textoResposta: resultado.texto,
          manifesto: contexto.manifesto,
          pesquisa: pesquisaTecnica,
          pergunta: texto,
          houveRetry: true,
          historicoMensagens: historico,
      indiceReferencias: contexto.indiceReferencias,
        });
      }
      if (!qualityGate.aprovado && qualityGateService.temFalhaDeIntegridade(qualityGate)) {
        const respostaSegura = planoRespostaRastreavel.gerarRespostaSeguraDeterministica({
          plano: contexto.manifesto?.planoRespostaRastreavel,
          gate: qualityGate,
        });
        if (respostaSegura?.texto) {
          const qualityGateSeguro = qualityGateService.avaliarResposta({
            textoResposta: respostaSegura.texto,
            manifesto: contexto.manifesto,
            pesquisa: pesquisaTecnica,
            pergunta: texto,
            houveRetry: true,
            historicoMensagens: historico,
      indiceReferencias: contexto.indiceReferencias,
          });
          const bloqueioSeguro = _temBloqueioObjetivoQualityGate(qualityGateSeguro);
          acoesRetry.push({
            tipo: 'resposta_segura_deterministica',
            modo: respostaSegura.modo,
            aplicado: !bloqueioSeguro,
            falhasAntes: (qualityGate.falhas || []).map(f => f.codigo),
            falhasDepois: (qualityGateSeguro.falhas || []).map(f => f.codigo),
          });
          if (!bloqueioSeguro) {
            resultado = { ...resultado, texto: _prepararTextoResposta(respostaSegura.texto, pesquisaTecnica), recuperacaoDeterministica: respostaSegura };
            qualityGate = qualityGateSeguro;
            qualityGate.recuperacaoDeterministica = {
              aplicada: true,
              modo: respostaSegura.modo,
              origem: respostaSegura.origem,
            };
          }
        }
      }
      qualityGate.retryCorretivo = {
        executado: true,
        acoes: acoesRetry,
        antes: {
          qualityGate: _resumoQualityGate(qualityGateAntesRetry),
          respostaResumo: _removerIdsInternosTexto(respostaAntesRetry).slice(0, 2200),
        },
        depois: {
          qualityGate: _resumoQualityGate(qualityGate),
        },
      };
    }
  } catch (erro) {
    // Mensagem de erro registrada como turno do assistente, para o analista
    // ver no próprio chat — nunca expõe stack trace, só a causa amigável.
    const mensagemErro = erro._semChave
      ? 'Não há provider de IA configurado para esta empresa. Configure ao menos uma chave em Configurações do IA Service.'
      : `Não foi possível concluir a análise no momento: ${erro.message}`;
    const msgErro = mensagemRepo.salvarMensagem(empresaId, atendimentoId, { papel: 'assistant', conteudo: mensagemErro, usuarioId: null, diagnostico: { erroInfraestrutura: true } });
    try {
      execucaoRepo.salvarExecucao(empresaId, {
        atendimentoId,
        mensagemId: msgErro.id,
        mensagemUsuarioId: mensagemUsuario?.id ?? null,
        status: 'erro_provider',
        manifesto: contexto.manifesto,
        contexto: contexto.contextoResumo,
        pesquisa: pesquisaTecnica,
        qualityGate,
        tentativas: erro._tentativas || [],
        latenciaMs: erro._latenciaMs || null,
        tokensEstimadosPrompt: contexto.contextoResumo.tokensEstimadosPrompt,
        promptChars: promptUsado.length,
      });
    } catch (auditErr) {
      console.error('[IA Service] Falha ao registrar auditoria de erro da investigação:', auditErr.message);
    }
    return msgErro;
  }

  if (resultado.truncado) {
    qualityGate = _marcarRespostaTruncadaNoGate(qualityGate);
  }
  const revisaoNecessariaQualityGate = !!resultado.truncado || _calcularRevisaoNecessariaQualityGate({ qualityGate, retryDeQualityGate });
  const textoRejeitadoQualityGate = revisaoNecessariaQualityGate ? String(resultado.texto || '') : null;
  if (revisaoNecessariaQualityGate) {
    qualityGate.revisaoNecessaria = {
      motivo: resultado.truncado ? 'resposta_truncada_pelo_provider' : 'resposta_continuou_reprovada_apos_retry_permitido',
      falhas: (qualityGate.falhas || []).map(f => f.codigo),
      respostaRejeitada: textoRejeitadoQualityGate,
      politica: 'nao_apresentar_como_orientacao_tecnica_aprovada',
    };
  }

  // Nenhum dos 3 provedores informa de forma óbvia quando a resposta foi
  // cortada por limite de tamanho (finish_reason='length'/stop_reason=
  // 'max_tokens'/finishReason='MAX_TOKENS', capturado em ai-provider-client.js
  // e devolvido como resultado.truncado) — sem avisar, o analista via uma
  // frase cortada no meio sem explicação (bug real reportado pelo usuário,
  // 2026-10). Aviso anexado ao próprio texto salvo, não só logado, para
  // aparecer na bolha do chat.
  const textoFinal = revisaoNecessariaQualityGate
    ? [
      'A analise da IA foi bloqueada para revisao porque continuou reprovada pelo Quality Gate apos a tentativa corretiva permitida.',
      '',
      `Falhas detectadas: ${(qualityGate.falhas || []).map(f => f.codigo).join(', ') || 'nao especificadas'}.`,
      '',
      'Para evitar orientar o atendimento com uma recomendacao rejeitada pelo proprio controle de qualidade, esta resposta nao deve ser usada como parecer tecnico. Consulte a auditoria da execucao para revisar a resposta rejeitada e as evidencias consideradas.',
    ].join('\n')
    : resultado.truncado
    ? `${resultado.texto}\n\n⚠️ *Resposta cortada pelo limite de tamanho da IA — peça para "continuar" ou reformule de forma mais objetiva.*`
    : resultado.texto;

  const secoes = _extrairSecoes(textoFinal);
  const nivelConfianca = _extrairNivelConfianca(textoFinal);
  const fonteCorrigidoTexto = _extrairFonteCorrigido(secoes);

  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
    papel: 'assistant',
    conteudo: textoFinal,
    diagnostico: secoes,
    nivelConfianca,
    provider: resultado.provider,
    model: resultado.model,
  });

  let execucaoPrincipal = null;
  try {
    execucaoPrincipal = execucaoRepo.salvarExecucao(empresaId, {
      atendimentoId,
      mensagemId: mensagemAssistente.id,
      mensagemUsuarioId: mensagemUsuario?.id ?? null,
      provider: resultado.provider,
      model: resultado.model,
      status: _statusFinalExecucao({ qualityGate, retryDeQualityGate, respostaTruncada: !!resultado.truncado }),
      manifesto: contexto.manifesto,
      contexto: contexto.contextoResumo,
      pesquisa: pesquisaTecnica,
      qualityGate,
      usage: resultado.usage || null,
      tentativas: resultado.tentativas || [],
      tokensEstimadosPrompt: tokenBudget.estimarTokens(promptUsado),
      tokensEstimadosResposta: tokenBudget.estimarTokens(textoFinal),
      promptChars: promptUsado.length,
      respostaChars: textoFinal.length,
      respostaTruncada: !!resultado.truncado,
      latenciaMs: resultado.latenciaMs ?? (Date.now() - inicioIa),
      retryDeQualityGate,
      retryCorretivo: acoesRetry,
    });
  } catch (auditErr) {
    console.error('[IA Service] Falha ao registrar auditoria da investigação:', auditErr.message);
  }

  try {
    await investigacaoDossieAtualizador.atualizarAposTurno(empresaId, atendimentoId, {
      mensagemUsuarioId: mensagemUsuario?.id ?? null,
      mensagemAssistenteId: mensagemAssistente.id,
      execucaoId: execucaoPrincipal?.id ?? null,
      mensagemUsuario: texto,
      respostaAssistente: textoFinal,
      contextoResumo: contexto.contextoResumo,
      manifesto: contexto.manifesto,
      pesquisa: pesquisaTecnica,
      referencias: {
        retryDeQualityGate,
        providerPrincipal: resultado.provider,
        modelPrincipal: resultado.model,
      },
    });
  } catch (dossieErr) {
    console.error('[IA Service] Falha ao atualizar dossie tecnico apos turno:', dossieErr.message);
    try {
      investigacaoDossieService.marcarStale(empresaId, atendimentoId, true, {
        mensagemId: mensagemUsuario?.id ?? mensagemAssistente.id,
        execucaoId: execucaoPrincipal?.id ?? null,
      });
    } catch (staleErr) {
      console.error('[IA Service] Falha ao marcar dossie como stale:', staleErr.message);
    }
  }

  if (!mensagemUsuario && !anexosComoContexto) {
    for (const anexo of anexosDoTurno) {
      anexoRepo.vincularMensagem(empresaId, anexo.id, mensagemAssistente.id);
    }
  }

  // Se a IA produziu um fonte corrigido E há exatamente um anexo de código
  // neste turno para servir de "original", versiona automaticamente (seção 9
  // do prompt: nunca sobrescrever, sempre nova versão vinculada).
  const anexosCodigoDoTurno = anexosDoTurno.filter(a => a.eCodigo);
  mensagemAssistente.fontesCorrigidos = [];
  mensagemAssistente.avisosFonteCorrigido = [];
  if (fonteCorrigidoTexto) {
    const validacaoFonte = versaoFonteService.validarConteudoCorrigido(fonteCorrigidoTexto, {
      respostaTruncada: !!resultado.truncado,
    });

    if (!validacaoFonte.ok) {
      mensagemAssistente.avisosFonteCorrigido.push(validacaoFonte.motivo);
    } else if (anexosCodigoDoTurno.length === 1) {
      const versaoCorrigida = versaoFonteService.criarVersaoCorrigida(empresaId, {
        anexoOriginalId: anexosCodigoDoTurno[0].id,
        atendimentoId,
        mensagemOrigemId: mensagemAssistente.id,
        conteudoCorrigido: fonteCorrigidoTexto,
        explicacaoAlteracao: secoes?.['Alterações realizadas'] || null,
        usuarioId: null,
      });
      mensagemAssistente.fontesCorrigidos.push({
        versao: versaoCorrigida,
        original: anexosCodigoDoTurno[0],
        status: 'Correção proposta — aguardando validação',
      });
    } else if (anexosCodigoDoTurno.length > 1) {
      mensagemAssistente.avisosFonteCorrigido.push('Ha mais de um anexo de codigo no turno; nenhuma versao corrigida foi gerada automaticamente.');
    } else {
      mensagemAssistente.avisosFonteCorrigido.push('A resposta trouxe Fonte corrigido, mas nenhum anexo de codigo do turno foi identificado como original.');
    }
  }
  if (mensagemAssistente.avisosFonteCorrigido.length) {
    mensagemRepo.atualizarAvisosFonteCorrigido(empresaId, mensagemAssistente.id, mensagemAssistente.avisosFonteCorrigido);
  }

  mensagemAssistente.respostaOperacional = respostaOperacionalService.construirFichaOperacional({
    diagnostico: mensagemAssistente.diagnostico,
    nivelConfianca: mensagemAssistente.nivelConfianca,
    conteudo: mensagemAssistente.conteudo,
    fontesCorrigidos: mensagemAssistente.fontesCorrigidos,
    avisosFonteCorrigido: mensagemAssistente.avisosFonteCorrigido,
  });

  return mensagemAssistente;
}

const TEXTO_PRE_ANALISE = 'Este chamado acabou de ser alocado a um analista (primeiro posicionamento com retorno esperado do atendente, sem interação humana ainda além do texto original do chamado). Faça uma pré-análise inicial com base no que está descrito acima e nos anexos sincronizados, quando existirem — identifique o problema relatado, hipóteses prováveis de causa e uma sugestão de próximo passo. Deixe claro no nível de confiança que esta é uma análise preliminar, sem confirmação humana.';

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
async function processarPreAnalise(empresaId, atendimentoId, { anexoIds = [] } = {}) {
  return processarTurno(empresaId, atendimentoId, {
    texto: TEXTO_PRE_ANALISE,
    usuarioId: null,
    anexoIds,
    automatico: true,
  });
}

module.exports = {
  processarTurno,
  processarPreAnalise,
  _criarPreparadorPorCandidato,
  _extrairObservacoesVisuaisDaResposta,
  _retryDegradouResposta,
  _extrairSecoes,
  _extrairNivelConfianca,
  _extrairFonteCorrigido,
  _calcularRevisaoNecessariaQualityGate,
  _statusFinalQualityGate,
  _statusFinalExecucao,
};

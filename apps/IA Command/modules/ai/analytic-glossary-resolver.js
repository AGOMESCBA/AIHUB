'use strict';

/**
 * Reconhece conceitos analiticos nomeados (ex: "analise horizontal", "indice de liquidez")
 * numa pergunta e garante que o sistema NUNCA gera SQL para um conceito que nao entende, nem
 * assume sozinho a qual domínio de dado (financeiro, compras, faturamento...) aplicar esse
 * conceito quando a pergunta nao especifica.
 *
 * Duas camadas resolvidas separadamente:
 * - Conceito (o que "analise vertical" significa, matematicamente): definido uma vez por IA
 *   auxiliar (sem gerar SQL), gravado no glossario, reaproveitado depois sem custo de IA.
 * - Dominio de dado (a quais tabelas/modulo aplicar o conceito): NUNCA inferido pelo sistema.
 *   Se a propria pergunta ja diz o dominio, seguimos; se nao diz, o sistema pergunta ao
 *   usuario ANTES de gerar SQL, reaproveitando o mecanismo de confirmacao ja existente
 *   (intent.precisa_confirmacao, tratado em intent-router.js).
 *
 * A definicao tecnica resolvida e injetada como texto no prompt do gerador de SQL principal
 * (runner.js) — a traducao conceito->SQL continua inteiramente a cargo dessa IA, que ja
 * demonstrou competencia nisso via specs/fragmentos. Este modulo nunca prescreve tabela,
 * join ou estrutura de SQL.
 */

const aiProviderClient = require('../erp/core/ai-provider-client');
const glossaryStore = require('./analytic-glossary-store');

// Padroes deliberadamente restritos: so dispara a checagem (e o eventual custo de chamada de
// IA) quando a pergunta nomeia um conceito analitico explicito, nunca em perguntas comuns de
// dado ("faturamento de hoje", "compras do mes"). Aplicados sobre o texto JA normalizado.
const PADROES_CONCEITO = [
  /\banalise\s+(horizontal|vertical|de\s+tendencia|de\s+sazonalidade|swot|de\s+desempenho)\b/i,
  /\bindice\s+de\s+\w+/i,
  /\bindicador(?:es)?\s+de\s+\w+/i,
];

// Mesmo vocabulario de dominio ja usado em cross-module-detector.js (PADROES_MODULO) e
// intent-router.js (_PALAVRAS_ERP) — nao inventa taxonomia nova. Cada dominio e uma chave
// estavel usada para particionar o glossario (mesmo termo, dominios diferentes = definicoes
// tecnicas potencialmente diferentes, ex: "analise vertical" de financeiro vs de compras).
const PADROES_DOMINIO = [
  { chave: 'faturamento', re: /\b(faturamento|vendas?|receita)\b/i, label: 'Faturamento/Vendas' },
  { chave: 'compras', re: /\b(compras?)\b/i, label: 'Compras' },
  { chave: 'financeiro', re: /\b(financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber)\b/i, label: 'Financeiro (contas a pagar/receber)' },
  { chave: 'fluxo_caixa', re: /\bfluxo\s+de\s+caixa\b/i, label: 'Fluxo de Caixa' },
  { chave: 'comissao', re: /\b(comissao|comissoes)\b/i, label: 'Comissão' },
  { chave: 'estoque', re: /\b(estoque)\b/i, label: 'Estoque' },
];

function _normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Retorna o trecho original (com acentuacao preservada) correspondente ao match encontrado
// no texto normalizado, para manter a definicao/aviso legivel em portugues correto.
function detectarConceitoDesconhecido(mensagem) {
  const original = String(mensagem || '');
  const normalizado = _normalizarTexto(original);
  for (const re of PADROES_CONCEITO) {
    const m = normalizado.match(re);
    if (m) return original.slice(m.index, m.index + m[0].length).trim();
  }
  return null;
}

// Nao tenta adivinhar o dominio — so reconhece quando a PROPRIA pergunta ja contem uma
// palavra de dominio conhecida. Pode reconhecer mais de um (ex: "vendas x compras" ->
// dominio combinado, ordenado de forma estavel para nao depender da ordem de mencao no texto).
function extrairDominioExplicito(mensagem) {
  const normalizado = _normalizarTexto(String(mensagem || ''));
  const encontrados = PADROES_DOMINIO.filter(d => d.re.test(normalizado));
  if (!encontrados.length) return null;
  return {
    chave: encontrados.map(d => d.chave).sort().join('_x_'),
    labels: encontrados.map(d => d.label),
  };
}

function buildSystemPrompt() {
  return [
    'Voce e um especialista tecnico em analise financeira e contabil.',
    'Sua unica tarefa: definir com precisao tecnica um conceito analitico nomeado pelo usuario, de forma OPERACIONAL — nao basta explicar o conceito em teoria, a definicao precisa dizer exatamente COMO estruturar o calculo, para que outra IA (que ja sabe gerar SQL Protheus, mas nao conhece este conceito) consiga aplicar sem reinterpretar do zero.',
    'Voce NAO gera SQL, NAO menciona tabelas de banco de dados, NAO tem acesso a dados do ERP. Fale de estrutura de calculo (quais valores compor, de quais periodos, e a formula), nunca de sintaxe SQL.',
    '',
    'IMPORTANTE — nao confunda analise horizontal com analise vertical:',
    '- Analise horizontal = MESMO indicador, comparado ao longo do TEMPO. Precisa de DOIS valores do MESMO indicador vindos de DOIS periodos distintos (periodo atual e periodo base/anterior) — a definicao deve deixar explicito que sao necessarias duas consultas/somas separadas, uma por periodo, antes de calcular variacao absoluta (atual - base) e percentual ((atual - base) / base × 100).',
    '- Analise vertical = cada componente expresso como percentual de um valor de referencia do MESMO periodo (sem comparacao temporal, um unico periodo, uma soma total e as partes que a compoem).',
    '',
    'REGRA CRITICA para analise vertical: "cada componente" so faz sentido se houver DECOMPOSICAO por alguma dimensao (ex: por produto, por cliente, por vendedor, por categoria/natureza, por filial) — uma unica linha com o total geral NAO e analise vertical, e apenas o proprio total (100% de si mesmo), o que nao entrega nenhuma informacao nova ao usuario. Se a pergunta original NAO especificar por qual dimensao decompor, escolha a dimensao mais natural e relevante para esse dominio de dado (ex: em faturamento/vendas, decompor por produto ou por cliente costuma ser o mais informativo) e declare EXPLICITAMENTE essa escolha na definicao tecnica, deixando claro que o resultado deve ter varias linhas (uma por item da dimensao escolhida) mais o percentual de cada uma sobre o total geral do periodo.',
    '',
    'Retorne SOMENTE JSON valido, sem markdown, no formato:',
    '{ "definicao_tecnica": string }',
    '- "definicao_tecnica" deve ser um texto direto e tecnico (3-6 frases): o que o conceito significa, QUANTOS periodos/agrupamentos sao necessarios e de onde vem cada valor, e a formula exata de calculo — o suficiente para outra IA montar a estrutura da consulta corretamente sem ambiguidade sobre quantos "blocos" de dado ela precisa buscar. Nao mencione tabelas de banco de dados nem sintaxe SQL.',
  ].join('\n');
}

function buildUserPrompt(termo, dominioLabels, mensagemOriginal) {
  return [
    `Termo/conceito a definir: "${termo}"`,
    `Domínio de dado informado pelo usuário: ${dominioLabels.join(' e ')}`,
    `Pergunta original onde o termo apareceu: "${mensagemOriginal}"`,
  ].join('\n');
}

// System prompt para o caminho de FALHA (a IA principal ja tentou gerar SQL e nao conseguiu).
// Diferente de PADROES_CONCEITO (regex fixo, so cobre frases estruturadas tipo "analise X"),
// aqui quem decide se ha um termo tecnico desconhecido e a propria IA, lendo a pergunta livre —
// evita manter uma lista de vocabulario financeiro (markup, ticket medio, margem...) que cresceria
// sem fim. Pode responder que NAO ha termo reconhecivel (fail-safe: no caso mais comum de SQL
// invalido, que e um erro tecnico qualquer, nao um conceito desconhecido).
function buildSystemPromptExtracao() {
  return [
    'Voce e um especialista tecnico em analise financeira e contabil para um sistema de consultas a ERP.',
    'Uma IA tentou traduzir a pergunta do usuario em SQL e falhou. Sua tarefa: julgar se a causa provavel e a pergunta citar um TERMO/CONCEITO TECNICO DE NEGOCIO que essa IA nao conhece (ex: markup, ticket medio, margem de contribuicao, giro de estoque) — nao erros de sintaxe, ambiguidade de periodo ou falta de dado.',
    'Se identificar um termo assim, extraia-o exatamente como aparece na pergunta (preserve acentuacao) e defina-o tecnicamente, do mesmo jeito operacional: quais valores compor, de qual(is) periodo(s), e a formula exata — o suficiente para outra IA (que ja gera SQL Protheus, mas nao conhece esse conceito) aplicar sem reinterpretar.',
    'Se NAO houver termo tecnico de negocio identificavel (a pergunta e comum, ou a falha e por outro motivo), retorne termo_encontrado como null — nao invente um conceito.',
    'Voce NAO gera SQL, NAO menciona tabelas de banco de dados.',
    '',
    'Retorne SOMENTE JSON valido, sem markdown, no formato:',
    '{ "termo_encontrado": string|null, "definicao_tecnica": string|null }',
  ].join('\n');
}

function buildUserPromptExtracao(mensagemOriginal) {
  return `Pergunta que a IA geradora de SQL nao conseguiu traduzir: "${mensagemOriginal}"`;
}

async function _consultarIA(termo, dominioLabels, mensagemOriginal, empresaId) {
  const { keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(termo, dominioLabels, mensagemOriginal);
  const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    json: true,
    maxTokens: 500,
    temperature: 0.1,
    logPrefix: 'AnalyticGlossary',
  });
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  const obj = JSON.parse(match ? match[0] : raw);
  if (typeof obj.definicao_tecnica !== 'string' || !obj.definicao_tecnica.trim()) {
    throw new Error('Resposta da IA sem definicao_tecnica valida.');
  }
  return obj.definicao_tecnica.trim();
}

function _perguntaEsclarecimentoDominio(termo) {
  const opcoes = PADROES_DOMINIO.map(d => d.label).join(', ');
  return `Para fazer a "${termo}" preciso saber sobre qual dado — ${opcoes}? Me diga qual (ou quais) para eu montar a consulta corretamente.`;
}

// Retorna null quando o termo nao e reconhecido como conceito (segue fluxo normal).
// Retorna { precisaConfirmacao: true, perguntaEsclarecimento } quando o conceito e reconhecido
// mas o dominio de dado nao foi especificado — o chamador deve interromper o fluxo ANTES de
// gerar qualquer SQL (nunca adivinhar o dominio).
// Retorna { termo, definicaoTecnica } quando resolvido — pronto para injecao no prompt do
// gerador de SQL principal.
async function resolverConceito(mensagem, empresaId) {
  const termo = detectarConceitoDesconhecido(mensagem);
  if (!termo) return null;

  const dominio = extrairDominioExplicito(mensagem);
  if (!dominio) {
    return { precisaConfirmacao: true, perguntaEsclarecimento: _perguntaEsclarecimentoDominio(termo) };
  }

  const existente = glossaryStore.buscarPorTermo(termo, dominio.chave);
  if (existente) {
    return { termo, definicaoTecnica: existente.definicao_tecnica };
  }

  // Termo+dominio desconhecidos: consulta IA auxiliar (sem gerar SQL), grava no glossario.
  let definicaoTecnica;
  try {
    definicaoTecnica = await _consultarIA(termo, dominio.labels, mensagem, empresaId);
  } catch (e) {
    console.warn('[AnalyticGlossary] Falha ao consultar definicao do conceito:', e.message);
    return null; // fail-open: segue o fluxo normal (roteamento lexico existente)
  }

  glossaryStore.criar({
    termo,
    dominio: dominio.chave,
    definicaoTecnica,
    origem: 'ia_aprendido',
    perguntaOrigem: mensagem,
  });

  return { termo, definicaoTecnica };
}

async function _extrairConceitoPorIA(mensagem, empresaId) {
  const { keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId);
  const systemPrompt = buildSystemPromptExtracao();
  const userPrompt = buildUserPromptExtracao(mensagem);
  const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    json: true,
    maxTokens: 500,
    temperature: 0.1,
    logPrefix: 'AnalyticGlossaryExtracao',
  });
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  const obj = JSON.parse(match ? match[0] : raw);
  return obj;
}

// Segundo caminho de deteccao, usado SO quando a IA principal ja tentou gerar SQL e falhou
// (sql_nao_extraido em runner.js). Ao contrario de resolverConceito() acima — que depende de
// PADROES_CONCEITO (regex fixo, frases estruturadas tipo "analise X") — aqui nao ha lista de
// vocabulario tecnico para manter: a propria IA auxiliar le a pergunta e decide se ha um termo
// de negocio desconhecido (markup, ticket medio, margem...) ou se a falha e de outra natureza.
// Fail-safe em profundidade: erro de rede/parse, ausencia de termo, ou dominio indefinido sem
// palavra de dominio na pergunta — todos retornam null e o chamador mantem a mensagem de erro
// generica atual (nunca bloqueia nem piora a experiencia existente).
// Filtro barato (sem chamada de IA) para nao gastar a extracao em ruido obvio — saudacoes,
// agradecimentos, replies curtos ("oi", "teste", "kkkk", "bom dia", "ok", "valeu", "obrigado"),
// e mensagens comuns de conversa (chat pessoal/status) sem relacao com consulta ao ERP.
// Auditoria (Codex, 3 rodadas) refinou este filtro progressivamente:
// 1) exigir SO estrutura interrogativa formal ("?" ou palavra interrogativa no inicio)
//    descartava perguntas legitimas sem pontuacao/formalidade (ex: "queria saber o markup
//    desse produto");
// 2) aceitar qualquer frase com 3+ palavras e uma palavra de 5+ letras (rodada 1) reabriu a
//    porta para formulas sociais mais longas ("bom dia pessoal", "obrigado pela ajuda");
// 3) apos excluir formulas sociais (rodada 2), sobrou "top" capturando frases legitimas tipo
//    "top produtos por markup" (a palavra "top" tambem e giria de aprovacao — "ta top!" —
//    entao entrava na lista de formula social por engano); e o criterio generico de "3+
//    palavras com uma de 5+ letras" ainda deixava passar frases de conversa comum sem relacao
//    com consulta ("minha internet caiu", "reuniao terminou tarde").
// Solucao final — heuristica PERMISSIVA para "e uma consulta" (aceita qualquer uma das 3):
// (a) estrutura interrogativa formal ("?" ou comeca com qual/quais/quanto/como/...);
// (b) verbo consultivo comum no INICIO da frase (queria saber, me mostra, mostra, preciso
//     saber, quero saber, me diz, calcula, traz, consulta, top seguido de complemento) — cobre
//     o jeito informal mais comum de pedir algo no WhatsApp sem pontuacao de pergunta;
// (c) estrutura de COMPLEMENTO NOMINAL ("o/a/os/as <termo> de/do/da <algo>", "<termo> deste/
//     desse/daquele <algo>") — a forma gramatical tipica de NOMEAR um conceito e liga-lo a um
//     objeto/periodo (ex: "markup DESTE item", "margem DE contribuicao DAS vendas", "giro DE
//     estoque"), sem exigir pontuacao. Isso substitui o criterio antigo (c) de "3+ palavras
//     com substancia", que era estrutural demais e pegava qualquer frase do dia a dia.
// Excecao que roda ANTES de (b)/(c): um vocabulario FECHADO de saudacoes/despedidas/
// agradecimentos do portugues quando a mensagem e SO isso (com ou sem complemento social como
// "pessoal"/"equipe") — finito e estavel, nao e "vocabulario de termos tecnicos de negocio"
// que cresceria a cada conceito novo, e sim o pequeno conjunto de formulas sociais do idioma.
const RE_FORMULA_SOCIAL = /^\s*(oi+|ola|opa|eae|e\s*ai|bom\s*dia|boa\s*tarde|boa\s*noite|obrigad[oa]|obg|valeu|vlw|blz|beleza|ok|okay|certo|entendi|show|legal|otimo|perfeito|de\s*nada|por\s*nada|tchau|ate\s*mais|ate\s*logo|flw|falou|teste|test|kk+|rs+|haha+)\b/i;
const RE_PARECE_PERGUNTA = /\?\s*$|^\s*(qual|quais|quanto|quantos|quantas|como|o\s+que|que|onde|quando|porque|por\s+que)\b/i;
const RE_VERBO_CONSULTIVO = /^\s*(queria|gostaria|quero|preciso|precisava|pode(?:ria)?|me\s+(?:mostra|mostre|diz|diga|passa|passe|manda|mande|traz|traga)|mostra|mostre|traz|traga|calcula|calcule|consulta|consulte|verifica|verifique|informa|informe|top(?=\s+\S))\b/i;
const RE_COMPLEMENTO_NOMINAL = /\b(?:o|a|os|as)\s+\S+\s+(?:de|do|da|dos|das|deste|desse|daquele|desta|dessa|daquela)\b/i;

function _pareceMensagemDeConsulta(mensagem) {
  const texto = String(mensagem || '').trim();
  if (texto.length < 6) return false;
  if (RE_PARECE_PERGUNTA.test(texto) || RE_VERBO_CONSULTIVO.test(texto)) return true;
  // Formula social no INICIO da frase ("obrigado pela ajuda", "bom dia pessoal") continua sendo
  // ruido mesmo com complemento — so deixa de ser filtrada se ja capturada por (a)/(b) acima.
  if (RE_FORMULA_SOCIAL.test(texto)) return false;
  return RE_COMPLEMENTO_NOMINAL.test(texto);
}

async function resolverConceitoPorFalhaSql(mensagem, empresaId) {
  if (!_pareceMensagemDeConsulta(mensagem)) return null;
  let extracao;
  try {
    extracao = await _extrairConceitoPorIA(mensagem, empresaId);
  } catch (e) {
    console.warn('[AnalyticGlossary] Falha ao extrair conceito via IA (fluxo de erro original mantido):', e.message);
    return null;
  }
  const termo = typeof extracao?.termo_encontrado === 'string' ? extracao.termo_encontrado.trim() : '';
  if (!termo) return null;

  const dominio = extrairDominioExplicito(mensagem);
  if (!dominio) {
    // A mesma chamada de IA que achou o termo ja pode ter retornado a definicao tecnica junto
    // (o prompt de extracao pede os dois campos de uma vez) — preserva aqui em vez de descartar,
    // para quando o dominio chegar depois (resposta do usuario a pergunta de esclarecimento) nao
    // seja necessario gastar uma segunda chamada de IA so para redefinir o mesmo termo.
    const definicaoTecnicaPreExtraida = typeof extracao?.definicao_tecnica === 'string' && extracao.definicao_tecnica.trim()
      ? extracao.definicao_tecnica.trim()
      : null;
    return {
      precisaConfirmacao: true,
      perguntaEsclarecimento: _perguntaEsclarecimentoDominio(termo),
      termo,
      definicaoTecnicaPreExtraida,
    };
  }

  const existente = glossaryStore.buscarPorTermo(termo, dominio.chave);
  if (existente) return { termo, definicaoTecnica: existente.definicao_tecnica };

  const definicaoTecnica = typeof extracao?.definicao_tecnica === 'string' ? extracao.definicao_tecnica.trim() : '';
  if (!definicaoTecnica) return null;

  glossaryStore.criar({
    termo,
    dominio: dominio.chave,
    definicaoTecnica,
    origem: 'ia_aprendido',
    perguntaOrigem: mensagem,
  });

  return { termo, definicaoTecnica };
}

// Testa se algum termo JA GRAVADO no glossario aparece como PALAVRA na pergunta (limite de
// palavra, nao substring solta) — consulta SQL simples, sem chamada de IA. Usado como camada
// gratuita antes de decidir se vale a pena gastar a extracao por IA no caminho preventivo.
function _termoGlossarioNaPergunta(mensagem) {
  const texto = _normalizarTexto(String(mensagem || '')).toLowerCase();
  if (!texto) return null;
  const termos = glossaryStore.listar({ limit: 500 });
  for (const row of termos) {
    const termoNorm = String(row.termo || '').trim();
    if (!termoNorm) continue;
    if (new RegExp(`\\b${termoNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(texto)) {
      return row;
    }
  }
  return null;
}

// Caminho PREVENTIVO (roda ANTES de qualquer tentativa de gerar SQL, junto de resolverConceito
// em intent-service.js) — diferente de resolverConceitoPorFalhaSql (que so age DEPOIS que a IA
// principal ja falhou/gerou SQL vazio), este cobre o caso mais perigoso: a IA principal NAO
// falha, ela "adivinha" uma interpretacao errada para um termo tecnico que nao conhece (ex:
// "markup" tratado silenciosamente como "preco medio") e gera SQL valido mas semanticamente
// errado, sem nenhum sinal de erro visivel ao usuario.
//
// Ordem de custo (banco primeiro, IA so se necessario, decisao explicita do usuario nesta
// sessao — "consulta a lista, caso nao tenha consulte a IA gerando custo, depois grava na
// lista"):
// 1) Termo ja gravado no glossario (qualquer dominio) aparece na pergunta -> usa direto, ZERO
//    custo de IA. Cobre reincidencia apos a primeira vez que qualquer termo foi aprendido, seja
//    por este caminho ou pelo caminho de pos-falha (resolverConceitoPorFalhaSql).
// 2) Termo nao gravado: se a pergunta passa no filtro sintatico _pareceMensagemDeConsulta,
//    gasta a extracao por IA (mesmo prompt/funcao de resolverConceitoPorFalhaSql) — aqui SIM ha
//    custo, mas so nas perguntas plausveis de conter consulta, nao em toda mensagem.
// Fail-open em profundidade, igual aos demais caminhos: qualquer falha retorna null e o
// classificador principal segue normalmente, sem bloquear nem piorar o comportamento atual.
async function resolverConceitoPreventivo(mensagem, empresaId) {
  // Tenta primeiro o caminho estruturado (regex PADROES_CONCEITO — ex: "analise horizontal"):
  // mais preciso quando bate, porque detecta o termo com a acentuacao/forma original do texto
  // da pergunta, nao a forma normalizada gravada no banco. So cai para a checagem generica de
  // "termo ja gravado" (que usa o texto do BANCO, normalizado) quando o regex nao reconhece
  // nada — evita retornar o termo sem acentuacao quando o regex estruturado ja teria acertado.
  const porRegexEstruturado = await resolverConceito(mensagem, empresaId);
  if (porRegexEstruturado) return porRegexEstruturado;

  const jaGravado = _termoGlossarioNaPergunta(mensagem);
  if (jaGravado) {
    return { termo: jaGravado.termo, definicaoTecnica: jaGravado.definicao_tecnica };
  }
  return resolverConceitoPorFalhaSql(mensagem, empresaId);
}

// ── Periodo-base para "analise horizontal" sem periodo de comparacao explicito ──────────────
// A definicao textual sozinha nao bastou, em teste real, para fazer a IA geradora de SQL
// comparar dois periodos distintos: sem uma data concreta de "periodo base" no prompt, ela
// interpreta "esta semana" como o UNICO filtro da consulta (comportamento correto quando nao
// ha comparacao pedida) e gera so um bloco de dados. Por isso o periodo-base e calculado aqui,
// como datas EXATAS, e injetado junto da definicao — nao deixado como instrucao textual pura.
const RE_TERMO_HORIZONTAL = /horizontal/i;

function _paraDate(aaaammdd) {
  const s = String(aaaammdd || '');
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function _paraAaaammdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Verdadeiro quando o periodo cobre exatamente do dia 1 ao ultimo dia do MESMO mes/ano — ou
// seja, "o mes inteiro", nao um recorte de dias dentro dele.
function _ehMesCivilCompleto(inicio, fim) {
  if (inicio.getFullYear() !== fim.getFullYear() || inicio.getMonth() !== fim.getMonth()) return false;
  if (inicio.getDate() !== 1) return false;
  const ultimoDiaDoMes = new Date(fim.getFullYear(), fim.getMonth() + 1, 0).getDate();
  return fim.getDate() === ultimoDiaDoMes;
}

// Periodo-base imediatamente anterior. Duas regras, decididas pela FORMA do periodo atual —
// confirmado com o usuario (07/09/2026) que a comparacao esperada depende disso:
// (a) periodo atual = MES CIVIL COMPLETO (ex: "setembro", dia 1 ao ultimo dia) -> base e o MES
//     CIVIL ANTERIOR COMPLETO (ex: agosto inteiro, 01/08 a 31/08). E a leitura natural de "mes
//     anterior" tanto para o usuario quanto para a IA geradora de SQL — usar "30 dias exatos
//     antes" (ex: 02/08 a 31/08) e tecnicamente valido mas nao intuitivo, e a IA geradora as
//     vezes "corrigia" por conta propria para o mes civil, causando divergencia entre o periodo
//     validado pelo backend e o periodo que ela de fato usava no SQL (bug real observado).
// (b) periodo atual = intervalo especifico de dias (ex: "do dia 02 ao dia 10") -> base mantem a
//     MESMA duracao em dias, terminando no dia anterior ao inicio do atual (ex: dia 02 a 10 do
//     mes anterior, se a duracao coincidir) — comportamento original, preservado para esse caso.
function calcularPeriodoBaseAnterior(periodoAtual) {
  const inicio = _paraDate(periodoAtual?.dataInicio);
  const fim = _paraDate(periodoAtual?.dataFim);
  if (!inicio || !fim || fim < inicio) return null;

  if (_ehMesCivilCompleto(inicio, fim)) {
    const inicioBaseMes = new Date(inicio.getFullYear(), inicio.getMonth() - 1, 1);
    const fimBaseMes = new Date(inicio.getFullYear(), inicio.getMonth(), 0);
    return { dataInicio: _paraAaaammdd(inicioBaseMes), dataFim: _paraAaaammdd(fimBaseMes) };
  }

  const duracaoDias = Math.round((fim - inicio) / 86400000) + 1;
  const fimBase = new Date(inicio);
  fimBase.setDate(fimBase.getDate() - 1);
  const inicioBase = new Date(fimBase);
  inicioBase.setDate(inicioBase.getDate() - (duracaoDias - 1));
  return { dataInicio: _paraAaaammdd(inicioBase), dataFim: _paraAaaammdd(fimBase) };
}

// O mes-base da SERIE e sempre 1 UNICO mes civil — o mes imediatamente anterior ao INICIO do
// periodo pedido, independente de quantos meses o periodo pedido cobre. Bug real confirmado em
// producao (08/09/2026): usar calcularPeriodoBaseAnterior aqui (que calcula "mesma duracao"
// quando o periodo nao e 1 mes civil) fazia um periodo de 8 meses (jan-ago) resultar num
// "mes-base" de OUTROS 8 meses (mai/2025-dez/2025) em vez de um unico mes (dez/2025) — a IA
// entao gerava uma serie de 21 linhas em vez das 9 esperadas (dez/2025 + jan-set/2026).
function _mesCivilAnteriorA(dataInicioAaaammdd) {
  const inicio = _paraDate(dataInicioAaaammdd);
  if (!inicio) return null;
  const inicioBaseMes = new Date(inicio.getFullYear(), inicio.getMonth() - 1, 1);
  const fimBaseMes = new Date(inicio.getFullYear(), inicio.getMonth(), 0);
  return { dataInicio: _paraAaaammdd(inicioBaseMes), dataFim: _paraAaaammdd(fimBaseMes) };
}

// Bug real confirmado em producao (08/09/2026): o formato antigo de comparacao unica
// ("Faturamento Atual | Faturamento Base | Variacao Absoluta | Crescimento %" numa unica
// linha, lado a lado) foi avaliado pelo usuario como confuso — nao fica claro visualmente
// qual valor e de qual mes, e o subtotal/total geral somava colunas que nao deveriam ser
// somadas. Unificado (08/09/2026) com o formato de serie mensal (ja validado como claro):
// TODA analise horizontal agora gera uma linha POR COMPETENCIA dentro do periodo pedido.
//
// Segundo bug real confirmado em producao (08/09/2026, empresa CAIEIRA): quando o usuario ja
// pede um periodo de VARIOS meses ("do ano por mes" = jan-set), o sistema buscava um mes-base
// ADICIONAL fora desse periodo (dezembro/2025) so para ter uma referencia de indice 100% —
// mas essa linha extra nao faz parte do periodo pedido, e ao entrar na soma do Subtotal/Total
// Geral distorcia o "faturamento do ano" (somava um mes de 2025 junto). Usuario confirmou
// (08/09/2026): o mes-base NUNCA deve ser buscado fora do periodo pedido — quando o periodo ja
// cobre 2+ meses, o PROPRIO PRIMEIRO MES do periodo pedido e a base (indice 100%, sem
// crescimento), sem buscar nenhum dado de fora. So busca um mes-base externo (mes anterior)
// quando o periodo pedido e um UNICO mes — senao a serie teria 1 linha so, sem nada pra
// comparar (esse caso continua igual: "analise horizontal do mes" = 2 linhas, mes anterior +
// mes atual).
function _ehUnicoMesCivil(periodoAtual) {
  const inicio = _paraDate(periodoAtual?.dataInicio);
  const fim = _paraDate(periodoAtual?.dataFim);
  if (!inicio || !fim) return false;
  return _ehMesCivilCompleto(inicio, fim);
}

function resolverPeriodoBaseSeHorizontal(termo, periodoAtual) {
  if (!RE_TERMO_HORIZONTAL.test(termo || '')) return null;

  if (!_ehUnicoMesCivil(periodoAtual)) {
    // Periodo ja cobre 2+ meses: nao busca nada fora dele. O primeiro mes do PROPRIO periodo
    // pedido e a base visual (indice 100%, crescimento N/A) — nunca um mes anterior externo.
    return {
      serieMode: 'indice_base',
      periodoInicioSerie: periodoAtual?.dataInicio || null,
      avisoTexto: null,
    };
  }

  const base = _mesCivilAnteriorA(periodoAtual?.dataInicio);
  if (!base) return null;
  return {
    serieMode: 'indice_base',
    periodoInicioSerie: base.dataInicio,
    avisoTexto: `Assumindo comparação a partir do mês imediatamente anterior (${base.dataInicio}–${base.dataFim}) como base 100%. Se quiser comparar com outra base (ex: mesmo período do ano passado), me avise.`,
  };
}

module.exports = {
  detectarConceitoDesconhecido,
  extrairDominioExplicito,
  resolverConceito,
  resolverConceitoPorFalhaSql,
  resolverConceitoPreventivo,
  calcularPeriodoBaseAnterior,
  resolverPeriodoBaseSeHorizontal,
};

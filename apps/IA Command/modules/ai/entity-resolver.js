'use strict';

const TIPOS_EXPLICITOS = [
  { tipo: 'fornecedor', re: /\bcontas?\s+a\s+pagar\s+(?:do|da|de|dos|das)\s+(?!(?:ano|anos|mes|meses|dia|dias|semana|semanas|trimestre|trimestres|periodo|periodos|hoje|ontem|agrupando|detalhando|considerando)\b)(.+)$/i },
  { tipo: 'cliente', re: /\bcontas?\s+a\s+receber\s+(?:do|da|de|dos|das)\s+(?!(?:ano|anos|mes|meses|dia|dias|semana|semanas|trimestre|trimestres|periodo|periodos|hoje|ontem|agrupando|detalhando|considerando)\b)(.+)$/i },
  { tipo: 'fornecedor', re: /\bfornecedor(?:es)?\s+(.+)$/i },
  { tipo: 'cliente', re: /\bclientes?\s+(.+)$/i },
  { tipo: 'produto', re: /\b(?:produtos?|itens?)\s+(.+)$/i },
  { tipo: 'grupo_produto', re: /\bgrupos?(?:\s+de\s+produtos?)?\s+(.+)$/i },
  { tipo: 'marca', re: /\bmarcas?\s+(.+)$/i },
  { tipo: 'centro_custo', re: /\bcentros?\s+de\s+custos?\s+(.+)$/i },
  { tipo: 'tes', re: /\btes\s+(.+)$/i },
  { tipo: 'vendedor', re: /\bvendedores?\s+(.+)$/i },
  { tipo: 'transportadora', re: /\btransportadoras?\s+(.+)$/i },
  { tipo: 'natureza', re: /\bnaturezas?(?:\s+financeiras?)?\s+(.+)$/i },
  { tipo: 'desconhecido', re: /\bem\s+aberto\s+(?:do|da|de)\s+(.+?)(?=\s+(?:e\s+)?(?:agrupad[oa]s?\s+)?por\b|\s+agrupad[oa]s?\b|[?.!,;:]|$)/i },
];

const TERMOS_AGRUPAMENTO_OU_METRICA = new Set([
  'dia', 'dias', 'mes', 'meses', 'ano', 'anos',
  'cliente', 'clientes', 'fornecedor', 'fornecedores',
  'produto', 'produtos', 'item', 'itens',
  'vendedor', 'vendedores', 'filial', 'filiais',
  'empresa', 'empresas', 'unidade', 'unidades', 'medida', 'medidas',
  'documento', 'documentos', 'titulo', 'titulos',
  'duplicata', 'duplicatas', 'natureza', 'naturezas',
  'valor', 'faturamento', 'receita', 'quantidade', 'qtd', 'qtde',
  'total', 'totais', 'totalizando', 'totalizado', 'totalizada',
  'soma', 'somando',
  'detalhe', 'detalhes', 'detalhar', 'detalhado', 'detalhada', 'detalhando',
  'agrupando', 'considerando',
  'refinamento', 'refinar', 'quebra', 'quebrar',
]);

function _normalizarToken(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _pareceSomenteAgrupamentoOuMetrica(termo) {
  const normalizado = _normalizarToken(termo);
  if (!normalizado) return true;
  const tokens = normalizado.split(/\s+/).filter(t => !['e', 'por', 'de', 'do', 'da', 'dos', 'das', 'com'].includes(t));
  return tokens.length > 0 && tokens.every(t => TERMOS_AGRUPAMENTO_OU_METRICA.has(t));
}

function _deveIgnorarTermo(termo) {
  const texto = String(termo || '').trim();
  if (!texto || texto.length < 2 || /^\d+$/.test(texto)) return true;
  return _pareceSomenteAgrupamentoOuMetrica(texto);
}

function _limparTermo(raw) {
  return String(raw || '')
    .replace(/^(?:e\s+)?(?:agrupad[oa]s?\s+)?por\s+(?:dia|dias|mes|meses|ano|anos|cliente|clientes|fornecedor|fornecedores|produto|produtos|vendedor|vendedores|filial|filiais|natureza)\b.*$/i, '')
    .replace(/^(?:em|no|na|de|do|da|dos|das)\s+(?:\d{4}|ano|anos|mes|meses|periodo|periodos|semana|semanas)\b.*$/i, '')
    .replace(/\s+(?:e\s+)?(?:agrupad[oa]s?\s+)?por\s+(?:dia|dias|mes|meses|ano|anos|cliente|clientes|fornecedor|fornecedores|produto|produtos|vendedor|vendedores|filial|filiais|natureza)\b.*$/i, '')
    .replace(/^(?:agrupando|agrupad[oa]s?|detalhando|considerando)\b.*$/i, '')
    .replace(/\s+(?:agrupando|agrupad[oa]s?|detalhando|considerando)\b.*$/i, '')
    .replace(/\s+(?:do|da|de|dos|das)\s+(?:ano|anos|mes|meses|periodo|periodos|semana|semanas)\b.*$/i, '')
    .replace(/\s+(?:do|da|de)\s+\d{4}\b.*$/i, '')
    .replace(/\b(?:do|da|de|dos|das|para|por|no|na|em)\b\s*$/i, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim();
}

function extrairExplicitos(mensagem) {
  const texto = String(mensagem || '').trim();
  const termos = [];
  const vistos = new Set();
  for (const regra of TIPOS_EXPLICITOS) {
    const m = texto.match(regra.re);
    if (m?.[1]) {
      // Divide em múltiplos nomes separados por " e " ou ", " (ex: "SESI AM e SENAI AM")
      const partes = m[1].split(/\s*,\s*|\s+e\s+/i);
      for (const parte of partes) {
        const termo = _limparTermo(parte);
        const chave = `${regra.tipo}:${termo}`.toLowerCase();
        if (!_deveIgnorarTermo(termo) && !vistos.has(chave)) {
          vistos.add(chave);
          termos.push({ texto: termo, tipo_sugerido: regra.tipo, confianca: 0.95, origem: 'explicito' });
        }
      }
    }
  }
  return termos;
}

function buildExtractionSystemPrompt() {
  return [
    'Voce extrai entidades citadas pelo usuario antes de gerar SQL.',
    'Retorne apenas JSON no formato {"entidades":[{"texto":"...","tipo_sugerido":"...","confianca":0.0}]}',
    'Tipos permitidos: fornecedor, cliente, produto, grupo_produto, marca, centro_custo, vendedor, transportadora, natureza, tes, desconhecido.',
    'Nao inclua periodos, datas, meses, anos, filiais, metricas ou palavras genericas como total, compras, vendas.',
    'PA e RA sao tipos de titulo do Protheus (E2_TIPO/E1_TIPO), nao sao nomes de fornecedor ou cliente. Nunca extraia PA ou RA como entidade.',
    'Se o usuario indicar explicitamente o tipo, use esse tipo.',
    'Se houver termo solto que pareca cadastro, retorne tipo_sugerido desconhecido ou uma hipotese com baixa confianca.',
  ].join('\n');
}

function buildExtractionUserPrompt(mensagem, contexto = 'compras') {
  return `Contexto: ${contexto}\nMensagem: ${mensagem}`;
}

function normalizarEntidadesIA(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (_) { obj = {}; }
  }
  const lista = Array.isArray(obj?.entidades) ? obj.entidades : [];
  return lista
    .map(e => ({
      texto: _limparTermo(e.texto),
      tipo_sugerido: String(e.tipo_sugerido || e.tipo || 'desconhecido').trim() || 'desconhecido',
      confianca: Number(e.confianca ?? 0.5) || 0.5,
      origem: e.origem || 'ia',
    }))
    .filter(e => !_deveIgnorarTermo(e.texto));
}

function escolherResultado(termo, candidatos) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  if (lista.length === 0) return { status: 'nao_encontrado', termo, candidatos: [] };
  if (lista.length === 1) return { status: 'resolvido', termo, entidade: lista[0], candidatos: lista };
  return { status: 'ambigua', termo, candidatos: lista };
}

function formatarPerguntaAmbiguidade(resultado) {
  const linhas = resultado.candidatos.map((c, i) => {
    const partes = [`${i + 1}. ${c.rotuloTipo || c.tipo}`];
    if (c.codigo) partes.push(`Codigo ${c.codigo}`);
    if (c.loja) partes.push(`Loja ${c.loja}`);
    if (c.nome) partes.push(c.nome);
    return partes.join(' | ');
  });
  return `Encontrei mais de uma possibilidade para *${resultado.termo.texto}*:\n\n${linhas.join('\n')}\n\nResponda com o numero da opcao desejada, ou envie *0* / *cancelar* para encerrar esta escolha e fazer uma nova pergunta.`;
}

module.exports = {
  extrairExplicitos,
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  normalizarEntidadesIA,
  escolherResultado,
  formatarPerguntaAmbiguidade,
  _limparTermo,
  _pareceSomenteAgrupamentoOuMetrica,
};

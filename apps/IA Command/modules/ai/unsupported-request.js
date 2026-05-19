const { normalizarTexto } = require('./text-normalizer');

const AGRUPAMENTOS_INDISPONIVEIS = [
  {
    dimensao: 'nota fiscal',
    re: /\b(?:por|pela|pelas|por\s+numero\s+de|por\s+n[ou]mero\s+da)\s+(?:nota\s+fiscal|notas\s+fiscais|nf|nfs|documento|documentos)\b|\b(?:nota\s+fiscal|notas\s+fiscais|nf|nfs)\b/i,
    suporteRe: /\b(nota\s*fiscal|notas\s*fiscais|nf|nfs|nfe|nro\s*nota|num\s*nota|numero\s*nota|numero\s*nf|doc|documento|documentos|chave\s*nfe|chave\s*nota|serie\s*nota)\b/i,
    mensagem: 'Nao temos informacoes na base de dados (dataset) disponibilizada no IA Command para retornar a consulta por nota fiscal.',
  },
];

function detectarAgrupamentoIndisponivel(mensagem) {
  const texto = normalizarTexto(mensagem);
  if (!texto) return null;
  return AGRUPAMENTOS_INDISPONIVEIS.find(item => item.re.test(texto)) || null;
}

function _textoConfiguracao(intencoes = [], datasets = []) {
  const partes = [];
  for (const i of intencoes || []) {
    partes.push(i.nome, i.descricao, i.frases_exemplo, i.modulo, i.acao);
  }
  for (const d of datasets || []) {
    partes.push(d.nome, d.campo_data, d.colunas_metrica, d.campos, d.agrupamentos, d.sql_base);
  }
  return normalizarTexto(partes.filter(Boolean).join(' '));
}

function temSuporteConfigurado(bloqueio, contexto = {}) {
  if (!bloqueio) return true;
  const texto = _textoConfiguracao(contexto.intencoes, contexto.datasets);
  if (!texto) return false;
  return bloqueio.suporteRe.test(texto);
}

function aplicarBloqueioSeNecessario(intent, mensagem, contexto = {}) {
  const bloqueio = detectarAgrupamentoIndisponivel(mensagem);
  if (!bloqueio) return intent;
  if (temSuporteConfigurado(bloqueio, contexto)) return intent;

  return {
    ...(intent || {}),
    intencao: 'desconhecido',
    periodo: { tipo: 'nenhum' },
    filtros: {},
    group_by: null,
    agrupar_por: null,
    agrupar_por_composto: null,
    ordenar_por: null,
    limite: null,
    confianca: 0,
    precisa_confirmacao: false,
    origem: intent?.origem || 'texto',
    _provedor: intent?._provedor || 'validador',
    _erroTipo: 'dataset_sem_informacao',
    _erro: bloqueio.mensagem,
    _dimensaoIndisponivel: bloqueio.dimensao,
  };
}

module.exports = { detectarAgrupamentoIndisponivel, temSuporteConfigurado, aplicarBloqueioSeNecessario };

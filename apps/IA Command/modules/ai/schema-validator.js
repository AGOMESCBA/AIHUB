const { PERIOD_TYPES, normalizarIntent } = require('./local-intent-resolver');

const FILTROS_PERMITIDOS = new Set(['cliente', 'vendedor', 'fornecedor', 'produto', 'filial', 'status']);
const AGRUPAMENTOS_PERMITIDOS = new Set(['cliente', 'produto', 'vendedor', 'fornecedor', 'empresa']);

// Valida e normaliza o JSON retornado pela IA de classificacao.
// nomesPermitidos: array de nomes validos, carregado do banco + "desconhecido".
function validar(intent, nomesPermitidos) {
  const erros = [];

  if (!intent || typeof intent !== 'object') {
    return { valido: false, erros: ['Resposta da IA nao e um objeto JSON valido'] };
  }

  intent.intencao = typeof intent.intencao === 'string' ? intent.intencao.trim() : '';
  if (!nomesPermitidos.includes(intent.intencao)) {
    erros.push(`Intencao invalida: "${intent.intencao}". Esperado: ${nomesPermitidos.join(', ')}`);
  }

  if (typeof intent.confianca !== 'number' || intent.confianca < 0 || intent.confianca > 1) {
    erros.push('Campo "confianca" deve ser numero entre 0 e 1');
  }

  normalizarIntent(intent);

  if (!PERIOD_TYPES.has(intent.periodo.tipo)) {
    erros.push(`Periodo invalido: "${intent.periodo.tipo}"`);
  }

  if (intent.periodo.tipo === 'ultimos_N_dias' && !intent.periodo.dias) {
    erros.push('Periodo ultimos_N_dias exige campo "dias"');
  }
  if (['comparacao_mesmo_mes', 'comparacao_acumulado_mes'].includes(intent.periodo.tipo) && !intent.periodo.mes) {
    erros.push(`Periodo ${intent.periodo.tipo} exige campo "mes"`);
  }
  if (intent.periodo.tipo === 'personalizado') {
    const ini = intent.periodo.data_inicio;
    const fim = intent.periodo.data_fim || ini;
    if ((ini && !/^\d{8}$/.test(String(ini))) || (fim && !/^\d{8}$/.test(String(fim)))) {
      erros.push('Periodo personalizado exige data_inicio/data_fim no formato YYYYMMDD');
    }
  }

  intent.filtros = intent.filtros && typeof intent.filtros === 'object' ? intent.filtros : {};
  for (const key of Object.keys(intent.filtros)) {
    if (!FILTROS_PERMITIDOS.has(key) || intent.filtros[key] == null || intent.filtros[key] === '') {
      delete intent.filtros[key];
      continue;
    }
    intent.filtros[key] = String(intent.filtros[key]).trim();
  }

  intent.limite = intent.limite == null ? null : Math.min(Math.max(parseInt(intent.limite, 10) || 0, 1), 100);
  if (intent.limite === 0) intent.limite = null;

  intent.agrupar_por = intent.agrupar_por || null;
  if (intent.agrupar_por && !AGRUPAMENTOS_PERMITIDOS.has(intent.agrupar_por)) {
    erros.push(`Agrupamento invalido: "${intent.agrupar_por}"`);
    intent.agrupar_por = null;
  }

  intent.ordenar_por = intent.ordenar_por || null;
  if (intent.ordenar_por && !/^[\w]+:(asc|desc)$/i.test(String(intent.ordenar_por))) {
    erros.push('Campo "ordenar_por" deve seguir o formato coluna:asc ou coluna:desc');
    intent.ordenar_por = null;
  }

  intent.precisa_confirmacao = !!intent.precisa_confirmacao;
  intent.origem = intent.origem || 'texto';

  return { valido: erros.length === 0, erros, intent };
}

module.exports = { validar };

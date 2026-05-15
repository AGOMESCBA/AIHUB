const { INTENCOES } = require('./prompts/intent-classifier');

function validar(intent) {
  const erros = [];

  if (!intent || typeof intent !== 'object') {
    return { valido: false, erros: ['Resposta da IA não é um objeto JSON válido'] };
  }

  if (!INTENCOES.includes(intent.intencao)) {
    erros.push(`Intenção inválida: "${intent.intencao}"`);
  }

  if (typeof intent.confianca !== 'number' || intent.confianca < 0 || intent.confianca > 1) {
    erros.push('Campo "confianca" deve ser número entre 0 e 1');
  }

  // Normaliza campos opcionais
  intent.filtros       = intent.filtros       || {};
  intent.periodo       = intent.periodo       || { tipo: 'nenhum' };
  intent.limite        = intent.limite        || null;
  intent.agrupar_por   = intent.agrupar_por   || null;
  intent.ordenar_por   = intent.ordenar_por   || null;
  intent.precisa_confirmacao = !!intent.precisa_confirmacao;

  return { valido: erros.length === 0, erros, intent };
}

module.exports = { validar };

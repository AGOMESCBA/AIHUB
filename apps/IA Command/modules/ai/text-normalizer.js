const VARIANTES = [
  { re: /\b(compara|compare|comparo|comparam|comparando|comparacao|comparacoes)\b/g, to: 'comparar' },
  { re: /\b(comparativa|comparativas|comparativos)\b/g, to: 'comparativo' },
  { re: /\b(comparada|comparadas|comparados)\b/g, to: 'comparado' },
  { re: /\b(fatura|faturado|faturada|faturados|faturadas|faturou|faturei|faturamos|faturam|faturando)\b/g, to: 'faturamento' },
  { re: /\b(vendeu|vendido|vendida|vendidos|vendidas|vendemos|vendem|vendendo)\b/g, to: 'vendas' },
  { re: /\b(mensalmente)\b/g, to: 'mensal' },
  { re: /\b(ult|ultim|ultima|ultimas|ultimo)\b/g, to: 'ultimo' },
  { re: /\b(melhores)\b/g, to: 'melhor' },
  { re: /\b(maiores)\b/g, to: 'maior' },
  { re: /\b(menores)\b/g, to: 'menor' },
  { re: /\b(piores)\b/g, to: 'pior' },
];

function normalizarBasico(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _aplicarRegrasConfiguraveis(texto, regras = []) {
  const ativas = (regras || [])
    .filter(r => r && r.ativo !== 0 && String(r.camada || '').toLowerCase() === 'normalizacao')
    .map(r => ({
      termo: normalizarBasico(r.termo),
      equivalencia: normalizarBasico(r.equivalencia),
    }))
    .filter(r => r.termo && r.equivalencia && r.termo !== r.equivalencia)
    .sort((a, b) => b.termo.length - a.termo.length);

  for (const regra of ativas) {
    const escaped = regra.termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    texto = texto.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), `$1${regra.equivalencia}`);
  }
  return texto;
}

function normalizarTexto(valor, regras = []) {
  let texto = normalizarBasico(valor);

  for (const v of VARIANTES) texto = texto.replace(v.re, v.to);
  texto = _aplicarRegrasConfiguraveis(texto, regras);
  return texto.replace(/\s+/g, ' ').trim();
}

function extrairRegrasNormalizacao(sinonimos = []) {
  return (sinonimos || []).filter(s => s && s.ativo !== 0 && String(s.camada || '').toLowerCase() === 'normalizacao');
}

module.exports = { normalizarTexto, normalizarBasico, extrairRegrasNormalizacao };

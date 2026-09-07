'use strict';

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const TERMOS_ERP = /\b(faturamento|vendas?|compras?|financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber|estoque|comissao|comissoes|pedido|nota fiscal|cliente|fornecedor|produto)\b/;

const FONTES = [
  ['banco_central', /\b(banco central|bacen|bcb|ptax)\b/],
  ['awesomeapi', /\b(awesome\s*api|awesomeapi)\b/],
  ['coingecko', /\b(coin\s*gecko|coingecko)\b/],
  ['coinmarketcap', /\b(coin\s*market\s*cap|coinmarketcap)\b/],
  ['open_meteo', /\b(open\s*meteo|openmeteo)\b/],
  ['cepea', /\b(cepea|esalq|usp)\b/],
  ['agrodoc', /\b(agro\s*doc|agrodoc)\b/],
  ['noticias_agricolas', /\b(noticias agricolas|noticias agricolas)\b/],
  ['b3', /\bb3\b/],
  ['scot', /\bscot\b/],
];

function detectarFontePreferida(textoNorm) {
  const fonte = FONTES.find(([, re]) => re.test(textoNorm));
  return fonte ? fonte[0] : null;
}

function detectarLocalClima(texto) {
  const original = String(texto || '').trim();
  const m = original.match(/\b(?:em|de|para)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{2,80})\s*[?.!]*$/i);
  if (!m) return null;
  const local = m[1].trim().replace(/\s+/g, ' ');
  const normalizado = normalizar(local);
  if (['hoje', 'amanha', 'agora', 'tempo', 'clima', 'temperatura'].includes(normalizado)) return null;
  return local;
}

function detectarPedidoAcessos(textoNorm) {
  const falaDeAcesso = /\b(acesso|acessar|liberado|liberados|permissao|permissoes|posso consultar|consigo consultar|tenho direito)\b/.test(textoNorm);
  const falaDeModulo = /\b(modulo|modulos|sistema|sistemas|consulta|consultas|rotina|rotinas)\b/.test(textoNorm);
  return falaDeAcesso && falaDeModulo;
}

function detectarExterno(texto, textoNorm) {
  const fontePreferida = detectarFontePreferida(textoNorm);

  if (/\b(clima|tempo|temperatura|previsao do tempo|chuva|chover)\b/.test(textoNorm)) {
    return { tipo: 'externo', categoria: 'clima', fontePreferida, local: detectarLocalClima(texto) };
  }

  if (/\b(bitcoin|btc|ethereum|eth|cripto|criptomoeda|criptomoedas)\b/.test(textoNorm)) {
    return { tipo: 'externo', categoria: 'cripto', ativo: /\beth|ethereum\b/.test(textoNorm) ? 'ethereum' : 'bitcoin', fontePreferida };
  }

  if (/\b(dolar|euro|usd|eur|cambio|cotacao da moeda|cotacao do dolar|cotacao do euro)\b/.test(textoNorm)) {
    if (TERMOS_ERP.test(textoNorm) && !/\b(cotacao|preco|valor|quanto esta|quanto custa|cambio)\b/.test(textoNorm)) return null;
    return { tipo: 'externo', categoria: 'cambio', moeda: /\b(euro|eur)\b/.test(textoNorm) ? 'EUR' : 'USD', fontePreferida };
  }

  const falaPreco = /\b(cotacao|preco|valor|quanto esta|quanto custa|mercado)\b/.test(textoNorm);
  const falaCotacaoAgroImplicita = /\b(arroba\s+do\s+boi|arroba|saca\s+de\s+soja|saca\s+do\s+milho)\b/.test(textoNorm);
  const agro = textoNorm.match(/\b(soja|boi|boi gordo|arroba|milho|bezerro|vaca gorda)\b/);
  if ((falaPreco || falaCotacaoAgroImplicita) && agro) {
    let produto = 'soja';
    if (/\b(boi|arroba)\b/.test(textoNorm)) produto = 'boi';
    else if (/\bmilho\b/.test(textoNorm)) produto = 'milho';
    else if (/\bbezerro\b/.test(textoNorm)) produto = 'bezerro';
    else if (/\bvaca\b/.test(textoNorm)) produto = 'vaca';
    return { tipo: 'externo', categoria: 'agro', produto, fontePreferida };
  }

  return null;
}

function rotear(mensagem) {
  const textoNorm = normalizar(mensagem);
  if (!textoNorm) return { tipo: 'nenhum' };

  if (detectarPedidoAcessos(textoNorm)) {
    return { tipo: 'acessos' };
  }

  const externo = detectarExterno(mensagem, textoNorm);
  if (externo) return externo;

  return { tipo: 'nenhum' };
}

module.exports = {
  rotear,
  normalizar,
  detectarFontePreferida,
  detectarLocalClima,
};

'use strict';

const https = require('https');

const DEFAULT_TIMEOUT_MS = 8000;

function getJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'IACommand/1.0', ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`JSON invalido: ${err.message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function fmtMoeda(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor || '-');
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function fmtNumero(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor || '-');
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function fmtDataHora(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Manaus', dateStyle: 'short', timeStyle: 'short' });
}

function hojeIso() {
  return new Date().toISOString();
}

function bcbPeriodoUrl(moeda) {
  const fim = new Date();
  const ini = new Date(fim.getTime() - 8 * 24 * 60 * 60 * 1000);
  const mdY = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  const endpoint = moeda === 'EUR' ? 'CotacaoMoedaPeriodo' : 'CotacaoDolarPeriodo';
  if (moeda === 'EUR') {
    return `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/${endpoint}(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='EUR'&@dataInicial='${mdY(ini)}'&@dataFinalCotacao='${mdY(fim)}'&$top=100&$format=json`;
  }
  return `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/${endpoint}(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${mdY(ini)}'&@dataFinalCotacao='${mdY(fim)}'&$top=100&$format=json`;
}

async function cambioBancoCentral(req) {
  const moeda = req.moeda || 'USD';
  const data = await getJson(bcbPeriodoUrl(moeda));
  const rows = Array.isArray(data?.value) ? data.value : [];
  const last = rows
    .filter(r => r.cotacaoVenda != null || r.paridadeVenda != null)
    .sort((a, b) => String(a.dataHoraCotacao || '').localeCompare(String(b.dataHoraCotacao || '')))
    .pop();
  if (!last) throw new Error('sem cotacao no periodo');
  const valor = last.cotacaoVenda ?? last.paridadeVenda;
  return {
    titulo: moeda === 'EUR' ? 'Euro comercial' : 'Dolar comercial',
    valor: fmtMoeda(valor),
    detalhe: 'cotacao de venda PTAX',
    fonte: 'Banco Central do Brasil/PTAX',
    fonteId: 'banco_central',
    dataInformacao: fmtDataHora(last.dataHoraCotacao),
    consultadoEm: fmtDataHora(hojeIso()),
    url: 'https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios',
  };
}

async function cambioAwesome(req) {
  const moeda = req.moeda || 'USD';
  const data = await getJson(`https://economia.awesomeapi.com.br/json/last/${moeda}-BRL`);
  const row = data?.[`${moeda}BRL`];
  if (!row?.ask && !row?.bid) throw new Error('resposta sem cotacao');
  return {
    titulo: moeda === 'EUR' ? 'Euro' : 'Dolar',
    valor: fmtMoeda(row.ask || row.bid),
    detalhe: row.ask ? 'venda' : 'compra',
    fonte: 'AwesomeAPI',
    fonteId: 'awesomeapi',
    dataInformacao: fmtDataHora(row.create_date || (row.timestamp ? Number(row.timestamp) * 1000 : null)),
    consultadoEm: fmtDataHora(hojeIso()),
    url: 'https://docs.awesomeapi.com.br/',
  };
}

async function criptoCoinGecko(req) {
  const ativo = req.ativo || 'bitcoin';
  const data = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ativo)}&vs_currencies=brl,usd&include_last_updated_at=true`);
  const row = data?.[ativo];
  if (!row?.brl) throw new Error('resposta sem preco');
  return {
    titulo: ativo === 'ethereum' ? 'Ethereum' : 'Bitcoin',
    valor: fmtMoeda(row.brl),
    detalhe: row.usd ? `USD ${fmtNumero(row.usd, 2)}` : null,
    fonte: 'CoinGecko',
    fonteId: 'coingecko',
    dataInformacao: fmtDataHora(row.last_updated_at ? Number(row.last_updated_at) * 1000 : null),
    consultadoEm: fmtDataHora(hojeIso()),
    url: 'https://docs.coingecko.com/reference/endpoint-overview',
  };
}

async function geocodeOpenMeteo(local) {
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(local)}&count=1&language=pt&format=json`);
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  if (!first) throw new Error('local nao encontrado');
  return first;
}

// Reverse geocoding (coordenadas -> nome de cidade) via Nominatim/OpenStreetMap — a
// Open-Meteo nao tem endpoint de reverse geocoding. Uso pontual (so quando o usuario
// compartilha localizacao pelo WhatsApp, baixo volume), respeitando a exigencia de
// User-Agent identificavel da politica de uso do Nominatim. Falha aqui NAO deve quebrar
// a resposta de temperatura (o dado principal) — quem chama trata erro com fallback.
async function reverseGeocodeNominatim(latitude, longitude) {
  // zoom=16 (nivel de bairro) para obter suburb/neighbourhood, alem de cidade/estado.
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=pt-BR&zoom=16`;
  const data = await getJson(url, { headers: { 'User-Agent': 'IACommand/1.0 (contato: suporte@iahub)' } });
  const addr = data?.address;
  if (!addr) throw new Error('endereco nao encontrado');
  const cidade = addr.city || addr.town || addr.village || addr.municipality || addr.county;
  if (!cidade) throw new Error('cidade nao identificada');
  const bairro = addr.suburb || addr.neighbourhood || addr.city_district || null;
  return [bairro, cidade, addr.state].filter(Boolean).join(', ');
}

// Aceita coordenadas diretas (localizacao compartilhada pelo WhatsApp) OU nome de local
// (geocodificado). Sem nenhum dos dois, lanca erro explicito — SEM fallback de cidade fixa:
// quem chama (conversational-turn-router/whatsapp service) e responsavel por perguntar a
// cidade ao usuario antes de chegar aqui, nunca adivinhar um local.
async function climaOpenMeteo(req) {
  let latitude = req.latitude;
  let longitude = req.longitude;
  let nomeLocal = 'sua localização';

  if (latitude == null || longitude == null) {
    const local = String(req.local || '').trim();
    if (!local) throw new Error('local nao informado');
    const geo = await geocodeOpenMeteo(local);
    latitude = geo.latitude;
    longitude = geo.longitude;
    nomeLocal = [geo.name, geo.admin1, geo.country_code].filter(Boolean).join(', ');
  } else {
    try {
      nomeLocal = await reverseGeocodeNominatim(latitude, longitude);
    } catch (_) {
      // Mantem "sua localização" — a temperatura em si (dado principal) ja foi obtida
      // com as coordenadas corretas, so o nome de exibicao nao pode ser resolvido agora.
    }
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=auto`;
  const data = await getJson(url);
  const atual = data?.current;
  if (!atual || atual.temperature_2m == null) throw new Error('resposta sem temperatura');
  return {
    titulo: `Temperatura em ${nomeLocal}`,
    valor: `${fmtNumero(atual.temperature_2m, 1)} ${data.current_units?.temperature_2m || 'C'}`,
    detalhe: atual.relative_humidity_2m != null ? `umidade ${fmtNumero(atual.relative_humidity_2m, 0)}%` : null,
    fonte: 'Open-Meteo',
    fonteId: 'open_meteo',
    dataInformacao: fmtDataHora(atual.time),
    consultadoEm: fmtDataHora(hojeIso()),
    url: 'https://open-meteo.com/',
  };
}

async function agroAgroDoc(req) {
  const data = await getJson('https://agrodocai.com.br/api/v1/cotacao');
  const produto = req.produto || 'soja';
  const mapa = {
    soja: ['Soja', data.soja, 'R$/sc'],
    milho: ['Milho', data.milho, 'R$/sc'],
    boi: ['Boi gordo', data.boi_gordo_cepea_sp, 'R$/@'],
    bezerro: ['Bezerro MS', data.bezerro_ms, 'R$/cab'],
    vaca: ['Vaca gorda', data.vaca_gorda, 'R$/@'],
  };
  const item = mapa[produto];
  if (!item || item[1] == null) throw new Error('produto sem cotacao');
  return {
    titulo: item[0],
    valor: `${fmtMoeda(item[1])}/${item[2].replace('R$/', '')}`,
    detalhe: produto === 'boi' && data.boi_gordo_praca ? data.boi_gordo_praca : null,
    fonte: data.fonte || 'AgroDoc API / CEPEA',
    fonteId: req.fontePreferida === 'cepea' ? 'cepea' : 'agrodoc',
    dataInformacao: fmtDataHora(data.atualizado),
    consultadoEm: fmtDataHora(hojeIso()),
    url: 'https://agrodocai.com.br/api-docs',
  };
}

const HANDLERS = {
  cambio: [
    ['banco_central', cambioBancoCentral],
    ['awesomeapi', cambioAwesome],
  ],
  cripto: [
    ['coingecko', criptoCoinGecko],
  ],
  clima: [
    ['open_meteo', climaOpenMeteo],
  ],
  agro: [
    ['agrodoc', agroAgroDoc],
    ['cepea', agroAgroDoc],
  ],
};

function ordenarHandlers(categoria, fontePreferida) {
  const handlers = [...(HANDLERS[categoria] || [])];
  if (!fontePreferida) return handlers;
  return handlers.sort((a, b) => (a[0] === fontePreferida ? -1 : 0) - (b[0] === fontePreferida ? -1 : 0));
}

function fonteConhecidaNaCategoria(categoria, fonte) {
  if (!fonte) return false;
  return (HANDLERS[categoria] || []).some(([id]) => id === fonte);
}

function formatarResposta(resultado, req, erros = []) {
  const linhas = [];
  if (req.fontePreferida && resultado.fonteId !== req.fontePreferida) {
    const tentou = erros.find(e => e.fonte === req.fontePreferida);
    if (tentou) linhas.push(`Nao consegui consultar a fonte solicitada agora (${labelFonte(req.fontePreferida)}).`);
    else linhas.push(`Nao consegui acessar automaticamente a fonte solicitada agora (${labelFonte(req.fontePreferida)}).`);
    linhas.push('');
  }

  linhas.push(`*${resultado.titulo}:* ${resultado.valor}`);
  if (resultado.detalhe) linhas.push(String(resultado.detalhe));
  linhas.push('');
  linhas.push(`Fonte usada: ${resultado.fonte}`);
  if (resultado.dataInformacao) linhas.push(`Data/hora da informacao: ${resultado.dataInformacao}`);
  if (resultado.consultadoEm) linhas.push(`Consultado em: ${resultado.consultadoEm}`);
  return linhas.join('\n');
}

function labelFonte(fonte) {
  const labels = {
    banco_central: 'Banco Central/PTAX',
    awesomeapi: 'AwesomeAPI',
    coingecko: 'CoinGecko',
    coinmarketcap: 'CoinMarketCap',
    open_meteo: 'Open-Meteo',
    cepea: 'CEPEA/ESALQ',
    agrodoc: 'AgroDoc',
    noticias_agricolas: 'Noticias Agricolas',
    b3: 'B3',
    scot: 'Scot Consultoria',
  };
  return labels[fonte] || fonte;
}

async function consultar(req = {}) {
  const handlers = ordenarHandlers(req.categoria, req.fontePreferida);
  const erros = [];
  if (!handlers.length) throw new Error(`Categoria externa sem handler: ${req.categoria}`);

  for (const [fonte, fn] of handlers) {
    try {
      const resultado = await fn(req);
      return {
        ok: true,
        resposta: formatarResposta(resultado, req, erros),
        resultado,
        erros,
        fonteSolicitadaSuportada: fonteConhecidaNaCategoria(req.categoria, req.fontePreferida),
      };
    } catch (err) {
      erros.push({ fonte, erro: err.message });
    }
  }

  return {
    ok: false,
    resposta: `Nao consegui consultar uma fonte online confiavel agora. ${erros.map(e => `${labelFonte(e.fonte)}: ${e.erro}`).join(' | ')}`,
    erros,
  };
}

module.exports = {
  consultar,
  _internals: {
    getJson,
    fmtMoeda,
    formatarResposta,
    ordenarHandlers,
    fonteConhecidaNaCategoria,
  },
};

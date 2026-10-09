const Database = require('better-sqlite3');
const db = new Database('C:/Apps/iahub/apps/IA Service/data/ia-service.db', { readonly: true });

const rows = db.prepare(`
  SELECT latencia_ms, status, criado_em, provider, retry_de_quality_gate
  FROM investigacao_execucoes
  ORDER BY criado_em DESC
  LIMIT 100
`).all();

console.log('Total execucoes encontradas:', rows.length);
const comLatencia = rows.filter(r => r.latencia_ms);
const latencias = comLatencia.map(r => r.latencia_ms).sort((a, b) => a - b);

if (latencias.length) {
  const soma = latencias.reduce((a, b) => a + b, 0);
  console.log('--- Latencia das execucoes (ms) ---');
  console.log('min:', latencias[0]);
  console.log('max:', latencias[latencias.length - 1]);
  console.log('media:', Math.round(soma / latencias.length));
  console.log('mediana:', latencias[Math.floor(latencias.length / 2)]);
  console.log('p90:', latencias[Math.floor(latencias.length * 0.9)]);
  console.log('quantas > 19200ms (limite atual do polling):', latencias.filter(l => l > 19200).length, 'de', latencias.length);
  console.log('quantas > 60000ms:', latencias.filter(l => l > 60000).length);
  console.log();
  console.log('--- Amostra das 15 mais recentes (ms, status, provider, retryQG) ---');
  rows.slice(0, 15).forEach(r => console.log(r.latencia_ms, r.status, r.provider, 'retryQG='+r.retry_de_quality_gate, r.criado_em));
} else {
  console.log('Nenhuma execucao com latencia registrada.');
}

db.close();

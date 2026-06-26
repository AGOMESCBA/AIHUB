'use strict';

const fs = require('fs');
const intentRouter = require('../erp/intent-router');

function jsonSeguro(valor) {
  const vistos = new WeakSet();
  return JSON.stringify(valor, (_k, v) => {
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'object' && v !== null) {
      if (vistos.has(v)) return '[Circular]';
      vistos.add(v);
    }
    return v;
  });
}

(async () => {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) throw new Error('Uso: node intent-router-worker.js <input.json> <output.json>');

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const resultado = await intentRouter.rotear(payload.intent, payload.empresaId);
  fs.writeFileSync(outputPath, jsonSeguro({ ok: true, resultado }), 'utf8');
})().catch(err => {
  try {
    const outputPath = process.argv[3];
    if (outputPath) {
      fs.writeFileSync(outputPath, jsonSeguro({
        ok: false,
        erro: err?.message || String(err),
        stack: err?.stack || null,
      }), 'utf8');
    }
  } catch (_) {}
  process.exit(1);
});

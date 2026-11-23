'use strict';
const D = require('better-sqlite3');
const d = new D('apps/IA Service/data/ia-service.db', { readonly: true, fileMustExist: true });
console.log(JSON.stringify(d.prepare('SELECT estado, count(*) n FROM jade_pa_execucoes WHERE texto_cliente IS NOT NULL GROUP BY estado').all()));
if (process.argv.includes('--exemplo')) {
  const { redigirTexto } = require('../apps/IA Service/backend/services/redaction-service');
  const r = d.prepare("SELECT numero_chamado, texto_cliente FROM jade_pa_execucoes WHERE estado = 'simulado' AND texto_cliente IS NOT NULL ORDER BY gerado_em DESC LIMIT 1").get();
  if (r) console.log(JSON.stringify({ numero: r.numero_chamado, texto: redigirTexto(r.texto_cliente).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL REDIGIDO]') }));
}
d.close();

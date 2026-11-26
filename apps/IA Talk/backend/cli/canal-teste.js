'use strict';

// Lista de teste de um canal (homologação). Em modo de teste o Talk só grava as
// mensagens destes números; das demais guarda só a contagem.
//
//   node "apps/IA Talk/backend/cli/canal-teste.js"                       (lista os canais)
//   node "apps/IA Talk/backend/cli/canal-teste.js" --canal "WhatsApp J2A" --numeros 5565999990000[,5565...]
//   node "apps/IA Talk/backend/cli/canal-teste.js" --canal cn_... --modo desligado   (só com autorização: grava tudo)

const path = require('path');
const config = require('../config');
const telefone = require('../seguranca/telefone');

function lerArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return a;
}

function executar(db, { canal, numeros, modo } = {}) {
  if (!canal) {
    return db.prepare('SELECT c.id, c.nome, c.estado, c.modo_teste, c.numeros_teste, e.nome AS empresa FROM canais c JOIN empresas e ON e.id = c.empresa_dona_id ORDER BY c.nome').all()
      .map(c => ({ ...c, numeros_teste: JSON.parse(c.numeros_teste).map(telefone.mascarar) }));
  }
  const c = db.prepare('SELECT * FROM canais WHERE id = ? OR nome = ?').get(canal, canal);
  if (!c) throw new Error(`Canal "${canal}" não encontrado.`);
  const lista = numeros ? String(numeros).split(',').map(telefone.normalizar) : JSON.parse(c.numeros_teste);
  if (lista.some(n => !telefone.valido(n))) throw new Error('Número inválido: use DDI e DDD (ex.: 5565999990000).');
  const modoTeste = modo === undefined ? c.modo_teste : (modo === 'desligado' ? 0 : 1);
  db.prepare('UPDATE canais SET numeros_teste = ?, modo_teste = ?, atualizado_em = ? WHERE id = ?').run(JSON.stringify(lista), modoTeste, new Date().toISOString(), c.id);
  return { id: c.id, nome: c.nome, modo_teste: !!modoTeste, numeros_teste: lista.map(telefone.mascarar) };
}

module.exports = { executar };

if (require.main === module) {
  require('dotenv').config({ path: path.join(config.RAIZ_REPO, '.env') });
  const { abrirBanco } = require('../database');
  const db = abrirBanco();
  try {
    console.log(executar(db, lerArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

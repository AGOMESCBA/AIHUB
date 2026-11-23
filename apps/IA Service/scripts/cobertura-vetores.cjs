'use strict';
// Somente leitura: não executa inicialização nem migrações.
const path = require('path');
const Database = require('better-sqlite3');
const arquivo = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'data', 'ia-service.db');
let db;
try {
  db = new Database(arquivo, { readonly: true, fileMustExist: true });
  const migrada = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chamados_embeddings'").get();
  const empresas = migrada
    ? db.prepare(`SELECT c.empresa_id AS empresa, COUNT(*) AS chamados,
        SUM(CASE WHEN e.modelo = 'text-embedding-3-large' AND e.dimensoes = 3072 THEN 1 ELSE 0 END) AS vetores_compativeis
        FROM chamados c LEFT JOIN chamados_embeddings e ON e.chamado_id = c.id AND e.empresa_id = c.empresa_id
        GROUP BY c.empresa_id ORDER BY c.empresa_id`).all()
    : db.prepare('SELECT empresa_id AS empresa, COUNT(*) AS chamados FROM chamados GROUP BY empresa_id ORDER BY empresa_id').all();
  console.log(JSON.stringify({ indiceExiste: migrada, empresas, observacao: 'Quantidade de chamados com vetor, não cobertura integral do histórico nem qualidade dos resultados.' }, null, 2));
} catch (erro) {
  console.error('Não foi possível ler a cobertura:', erro.message);
  process.exitCode = 1;
} finally { db?.close(); }

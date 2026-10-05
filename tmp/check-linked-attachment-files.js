'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) throw new Error('Informe o caminho do banco.');

const anexosRoot = path.resolve(__dirname, '..', 'apps', 'IA Service', 'data', 'anexos');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const chamados = ['036558', '036596', '036570', '036475'];
const out = [];

for (const numero of chamados) {
  const atendimento = db.prepare(`
    SELECT a.id, a.codigo, c.id AS chamado_id, c.numero, c.titulo, c.oid_origem AS chamado_oid
      FROM atendimentos a
      JOIN chamados c
        ON c.empresa_id = a.empresa_id
       AND c.sistema_origem = a.origem
       AND c.numero = a.referencia_externa
     WHERE a.empresa_id = 1
       AND a.origem = 'softexpert'
       AND a.referencia_externa = ?
     ORDER BY datetime(a.criado_em) DESC
     LIMIT 1
  `).get(numero);

  if (!atendimento) {
    out.push({ numero, encontrado: false });
    continue;
  }

  const anexosMensagem = db.prepare(`
    SELECT
      m.id AS mensagem_id,
      m.origem_referencia,
      p.oid_origem AS posicionamento_oid,
      a.id AS anexo_id,
      a.nome_original,
      a.caminho_relativo,
      a.tamanho,
      a.origem_tipo
    FROM mensagens m
    JOIN posicionamentos p
      ON m.origem_referencia = 'posicionamento:' || p.id
     AND p.empresa_id = m.empresa_id
    JOIN anexos a
      ON a.empresa_id = m.empresa_id
     AND a.atendimento_id = m.atendimento_id
     AND a.origem_referencia_oid = p.oid_origem
   WHERE m.empresa_id = 1
     AND m.atendimento_id = ?
     AND m.origem_sistema = 'softexpert'
   ORDER BY m.criado_em ASC, a.nome_original ASC
  `).all(atendimento.id);

  const anexosAbertura = db.prepare(`
    SELECT
      NULL AS mensagem_id,
      'abertura' AS origem_referencia,
      c.oid_origem AS posicionamento_oid,
      a.id AS anexo_id,
      a.nome_original,
      a.caminho_relativo,
      a.tamanho,
      a.origem_tipo
    FROM anexos a
    JOIN chamados c
      ON c.id = ?
     AND c.empresa_id = a.empresa_id
   WHERE a.empresa_id = 1
     AND a.atendimento_id = ?
     AND a.origem_referencia_oid = c.oid_origem
   ORDER BY a.nome_original ASC
  `).all(atendimento.chamado_id, atendimento.id);

  const todos = [...anexosMensagem, ...anexosAbertura].map(a => {
    const fullPath = path.resolve(anexosRoot, a.caminho_relativo || '');
    const dentroRoot = fullPath.startsWith(`${anexosRoot}${path.sep}`);
    const existe = dentroRoot && fs.existsSync(fullPath);
    const stat = existe ? fs.statSync(fullPath) : null;
    return {
      mensagemId: a.mensagem_id,
      nome: a.nome_original,
      origemTipo: a.origem_tipo,
      caminhoRelativo: a.caminho_relativo,
      tamanhoBanco: a.tamanho,
      existe,
      tamanhoDisco: stat?.size ?? null,
      tamanhoOk: existe && (!a.tamanho || Number(a.tamanho) === stat.size),
    };
  });

  out.push({
    numero,
    atendimento: { id: atendimento.id, codigo: atendimento.codigo, titulo: atendimento.titulo },
    vinculadosMensagem: anexosMensagem.length,
    vinculadosAbertura: anexosAbertura.length,
    arquivos: todos,
    todosExistem: todos.every(a => a.existe),
    todosTamanhoOk: todos.every(a => a.tamanhoOk),
  });
}

console.log(JSON.stringify(out, null, 2));
db.close();

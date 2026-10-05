const Database = require('better-sqlite3');

const dbPath = process.argv[2] || 'C:/tmp/ia-service-prod-check.db';
const numero = process.argv[3] || '036475';
const db = new Database(dbPath, { readonly: true });

const atendimento = db.prepare(`
  SELECT a.id, a.empresa_id
    FROM atendimentos a
    JOIN chamados c
      ON c.numero = a.referencia_externa
     AND c.empresa_id = a.empresa_id
   WHERE c.numero = ?
   ORDER BY a.criado_em DESC
   LIMIT 1
`).get(numero);

console.log('atendimento', atendimento);
if (!atendimento) process.exit(0);

const mensagens = db.prepare(`
  SELECT m.id,
         m.papel,
         m.origem_referencia,
         CASE
           WHEN m.origem_referencia LIKE 'posicionamento:%' THEN (
             SELECT p.oid_origem
               FROM posicionamentos p
              WHERE p.empresa_id = m.empresa_id
                AND p.id = substr(m.origem_referencia, 16)
           )
           WHEN m.origem_referencia LIKE 'chamado:%' THEN (
             SELECT c.oid_origem
               FROM chamados c
              WHERE c.empresa_id = m.empresa_id
                AND c.id = substr(m.origem_referencia, 9)
           )
           ELSE NULL
         END AS origem_referencia_oid,
         substr(replace(m.conteudo, char(10), ' '), 1, 110) AS texto
    FROM mensagens m
   WHERE m.empresa_id = ?
     AND m.atendimento_id = ?
     AND m.origem_sistema = 'softexpert'
   ORDER BY m.criado_em
`).all(atendimento.empresa_id, atendimento.id);

const anexos = db.prepare(`
  SELECT nome_original, origem_tipo, origem_referencia_oid
    FROM anexos
   WHERE empresa_id = ?
     AND atendimento_id = ?
   ORDER BY nome_original
`).all(atendimento.empresa_id, atendimento.id);

for (const m of mensagens) {
  const ref = String(m.origem_referencia || '');
  const tipo = ref.startsWith('posicionamento:') ? 'posicionamento' : ref.startsWith('chamado:') ? 'chamado' : null;
  const aceitos = tipo === 'posicionamento' ? ['posicionamento'] : tipo === 'chamado' ? ['chamado', 'anexo'] : [];
  const linked = anexos
    .filter(a => aceitos.includes(a.origem_tipo))
    .filter(a => a.origem_referencia_oid && String(a.origem_referencia_oid) === String(m.origem_referencia_oid))
    .map(a => a.nome_original);
  console.log(JSON.stringify({
    ref,
    oid: m.origem_referencia_oid,
    qtd: linked.length,
    anexos: linked,
    texto: m.texto,
  }));
}

'use strict';

require('dotenv').config();
const database = require('../apps/IA Service/backend/database');

database.inicializarDB(process.argv[2]);
const db = database.getDB();

const chamados = ['036558', '036596', '036570', '036475'];
const out = [];

for (const numero of chamados) {
  const atendimento = db.prepare(`
    SELECT a.id, a.codigo, a.referencia_externa, c.id AS chamado_id, c.numero, c.titulo
      FROM atendimentos a
      LEFT JOIN chamados c
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

  const mensagens = db.prepare(`
    SELECT id, origem_referencia, origem_data, origem_autor, substr(conteudo, 1, 90) AS texto
      FROM mensagens
     WHERE empresa_id = 1
       AND atendimento_id = ?
       AND origem_sistema = 'softexpert'
     ORDER BY datetime(criado_em) ASC
  `).all(atendimento.id);

  const anexos = db.prepare(`
    SELECT id, nome_original, origem_tipo, origem_oid, origem_referencia_oid
      FROM anexos
     WHERE empresa_id = 1
       AND atendimento_id = ?
     ORDER BY nome_original ASC
  `).all(atendimento.id);

  const vinculosPossiveis = db.prepare(`
    SELECT
      m.id AS mensagem_id,
      m.origem_referencia,
      p.id AS posicionamento_id,
      p.oid_origem AS posicionamento_oid,
      a.id AS anexo_id,
      a.nome_original,
      a.origem_tipo,
      a.origem_referencia_oid
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
    SELECT a.id, a.nome_original, a.origem_tipo, a.origem_referencia_oid, c.oid_origem AS chamado_oid
      FROM anexos a
      JOIN chamados c
        ON c.id = ?
       AND c.empresa_id = a.empresa_id
     WHERE a.empresa_id = 1
       AND a.atendimento_id = ?
       AND a.origem_referencia_oid = c.oid_origem
     ORDER BY a.nome_original ASC
  `).all(atendimento.chamado_id, atendimento.id);

  out.push({
    numero,
    atendimento,
    mensagensOrigem: mensagens.length,
    mensagensComPosicionamentoLocal: mensagens.filter(m => String(m.origem_referencia || '').startsWith('posicionamento:')).length,
    anexos: anexos.length,
    anexosComReferenciaOid: anexos.filter(a => !!a.origem_referencia_oid).length,
    vinculosPossiveis: vinculosPossiveis.length,
    anexosAbertura: anexosAbertura.length,
    exemplosVinculos: vinculosPossiveis.slice(0, 10),
    exemplosAnexosSemVinculo: anexos.filter(a => !vinculosPossiveis.some(v => v.anexo_id === a.id) && !anexosAbertura.some(v => v.id === a.id)).slice(0, 10),
  });
}

console.log(JSON.stringify(out, null, 2));
database.fecharDB();

'use strict';

const crypto = require('crypto');
const { getDB } = require('../database');
const consultores = require('./consultor-service');
const clientes = require('../repositories/cliente-repository');

function tecnicoDaSessao(empresaId, consultorId) {
  const consultor = consultores.getConsultor(empresaId, consultorId);
  return consultor?.idSoftexpert ? clientes.getTecnicoPorOrigem(empresaId, 'softexpert', consultor.idSoftexpert) : null;
}

// O responsável é resolvido em cada consulta, inclusive no momento da gravação.
function listar(empresaId, consultorId) {
  const tecnico = tecnicoDaSessao(empresaId, consultorId);
  if (!tecnico) return { pendencias: [], paraAtualizar: [], semVinculo: true };
  const db = getDB();
  const linhas = db.prepare(`SELECT c.id AS chamado_id, c.numero, c.titulo, a.id AS atendimento_id,
      m.id AS mensagem_id, m.conteudo, e.manifesto_json, e.criado_em
    FROM chamados c
    JOIN atendimentos a ON a.empresa_id = c.empresa_id AND a.referencia_externa = c.numero AND a.origem = c.sistema_origem
    JOIN investigacao_execucoes e ON e.empresa_id = a.empresa_id AND e.atendimento_id = a.id
    JOIN mensagens m ON m.empresa_id = e.empresa_id AND m.id = e.mensagem_id AND m.atendimento_id = a.id AND m.papel = 'assistant'
    WHERE c.empresa_id = ? AND c.tecnico_responsavel_id = ?
      AND (SELECT COUNT(*) FROM chamados c2 WHERE c2.empresa_id = c.empresa_id AND c2.numero = c.numero AND c2.sistema_origem = c.sistema_origem) = 1
      AND m.excluida_em IS NULL AND e.status IN ('concluido', 'concluido_com_alerta_quality_gate')
    ORDER BY e.criado_em DESC`).all(Number(empresaId), tecnico.id);
  const jaAvaliados = db.prepare('SELECT * FROM avaliacoes_base_candidatos WHERE empresa_id = ? AND mensagem_id = ? ORDER BY rowid ASC');
  const obterCandidato = db.prepare('SELECT id, numero, titulo, descricao, breve_descricao FROM chamados WHERE empresa_id = ? AND id = ?');
  const pendencias = [];
  const paraAtualizar = [];
  const vistas = new Set();
  for (const linha of linhas) {
    let manifesto;
    try { manifesto = JSON.parse(linha.manifesto_json || '{}'); } catch (_) { continue; }
    const incluidos = manifesto?.pesquisaExterna?.baseConhecimento?.selecionados;
    if (!Array.isArray(incluidos)) continue;
    const avaliados = new Map(jaAvaliados.all(Number(empresaId), linha.mensagem_id).map(x => [String(x.candidato_id), x]));
    for (const item of incluidos) {
      const id = String(item?.chamadoId || '');
      const chave = `${linha.mensagem_id}:${id}`;
      if (!id || vistas.has(chave)) continue;
      const candidato = obterCandidato.get(Number(empresaId), id);
      if (!candidato || id === linha.chamado_id) continue;
      vistas.add(chave);
      const pendencia = { chamadoId: linha.chamado_id, numero: linha.numero, titulo: linha.titulo, atendimentoId: linha.atendimento_id,
        mensagemId: linha.mensagem_id, resposta: linha.conteudo, data: linha.criado_em,
        candidato: { id: candidato.id, numero: candidato.numero, titulo: candidato.titulo, descricao: candidato.descricao || candidato.breve_descricao || '' } };
      const avaliacao = avaliados.get(id);
      if (!avaliacao && pendencias.length < 30) pendencias.push(pendencia);
      if (avaliacao && ['nao_testada', 'nao_sei'].includes(avaliacao.resultado) && paraAtualizar.length < 30) {
        paraAtualizar.push({ ...pendencia, avaliacao: { mesmoProblema: avaliacao.mesmo_problema, utilidade: avaliacao.utilidade, resultado: avaliacao.resultado } });
      }
    }
  }
  const metricas = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN resultado IN ('sim', 'nao') THEN 1 ELSE 0 END) AS testadas,
      SUM(CASE WHEN resultado = 'sim' THEN 1 ELSE 0 END) AS funcionaram
    FROM (SELECT resultado, ROW_NUMBER() OVER (PARTITION BY mensagem_id, candidato_id ORDER BY rowid DESC) AS ordem
      FROM avaliacoes_base_candidatos WHERE empresa_id = ? AND consultor_id = ?) WHERE ordem = 1`).get(Number(empresaId), consultorId);
  return { pendencias, paraAtualizar, metricas, semVinculo: false, limitada: pendencias.length === 30 };
}

function registrar(empresaId, consultorId, dados) {
  const opcoes = { mesmoProblema: ['sim', 'parcial', 'nao', 'nao_sei'], utilidade: ['sim', 'talvez', 'nao', 'sem_solucao', 'nao_sei'], resultado: ['sim', 'nao', 'nao_testada', 'nao_sei'] };
  for (const [campo, permitidos] of Object.entries(opcoes)) if (!permitidos.includes(dados?.[campo])) throw Object.assign(new Error('Selecione uma opção para cada pergunta.'), { status: 400 });
  const db = getDB();
  return db.transaction(() => {
    const lista = listar(empresaId, consultorId);
    const pendencia = [...lista.pendencias, ...lista.paraAtualizar].find(p => p.mensagemId === dados.mensagemId && p.candidato.id === dados.candidatoId);
    if (!pendencia) throw Object.assign(new Error('Avaliação indisponível ou chamado atribuído a outro consultor.'), { status: 409 });
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO avaliacoes_base_candidatos (id, empresa_id, mensagem_id, candidato_id, consultor_id, mesmo_problema, utilidade, resultado, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, Number(empresaId), pendencia.mensagemId, pendencia.candidato.id, consultorId, dados.mesmoProblema, dados.utilidade, dados.resultado, new Date().toISOString());
    return { id };
  })();
}

function convidar(empresaId, consultorId, agora = new Date()) {
  const lista = listar(empresaId, consultorId);
  if (!lista.pendencias.length) return { mostrar: false, total: 0 };
  const hora = agora.getHours();
  if (hora < 8 || hora >= 18) return { mostrar: false, total: lista.pendencias.length };
  const data = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  const periodo = hora < 12 ? 'manha' : 'tarde';
  const resultado = getDB().prepare('INSERT OR IGNORE INTO avaliacoes_base_convites (empresa_id, consultor_id, data_local, periodo, criado_em) VALUES (?, ?, ?, ?, ?)').run(Number(empresaId), consultorId, data, periodo, agora.toISOString());
  return { mostrar: resultado.changes === 1, total: lista.pendencias.length, limitada: lista.limitada };
}

module.exports = { listar, registrar, convidar };

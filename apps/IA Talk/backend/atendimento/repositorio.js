'use strict';

// Atendimento (C9): acesso ao banco e formas de resposta. Contrato: docs/contratos.md §8.
// Regras (quem pode o quê, avisos) ficam em servico.js; aqui só SQL e montagem.
// Toda leitura de conversa recebe a empresa: registro de outra empresa não existe (404).

const { novoId, agora } = require('../ids');
const telefone = require('../seguranca/telefone');
const config = require('../config');

const json = (texto, padrao) => { try { return JSON.parse(texto); } catch (_) { return padrao; } };
const SEM_NOME = 'Contato sem nome';
const previaDe = (texto) => String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 80);

// ── Setores ─────────────────────────────────────────────────────────────────
function membrosDoSetor(db, setorId) {
  return db.prepare(`SELECT u.id, u.nome FROM setor_membros sm JOIN usuarios u ON u.id = sm.usuario_id
      WHERE sm.setor_id = ? ORDER BY u.nome`).all(setorId);
}

function buscarSetor(db, empresaId, id) {
  return db.prepare('SELECT * FROM setores WHERE id = ? AND empresa_id = ?').get(String(id || ''), empresaId) || null;
}

function setorPorCodigo(db, empresaId, codigo) {
  return db.prepare('SELECT * FROM setores WHERE codigo = ? AND empresa_id = ?').get(String(codigo || ''), empresaId) || null;
}

function setoresDoUsuario(db, empresaId, usuarioId) {
  return db.prepare(`SELECT s.id FROM setor_membros sm JOIN setores s ON s.id = sm.setor_id
      WHERE sm.usuario_id = ? AND s.empresa_id = ?`).all(usuarioId, empresaId).map(r => r.id);
}

function paraSetor(db, s) {
  const contagem = db.prepare(`SELECT COUNT(*) AS abertas, SUM(CASE WHEN responsavel_id IS NULL THEN 1 ELSE 0 END) AS na_fila
      FROM conversas WHERE setor_id = ? AND situacao = 'aberta'`).get(s.id);
  return {
    id: s.id, codigo: s.codigo, nome: s.nome, descricao: s.descricao, situacao: s.situacao, membros: membrosDoSetor(db, s.id),
    horario: json(s.horario, { ligado: false, fuso: 'America/Cuiaba', dias: [] }), fora_horario: json(s.fora_horario, { ligado: false, texto: '' }),
    conversas_abertas: contagem.abertas || 0, na_fila: contagem.na_fila || 0, versao: s.versao, criado_em: s.criado_em, atualizado_em: s.atualizado_em,
  };
}

function trocarMembros(db, setorId, usuarioIds) {
  db.prepare('DELETE FROM setor_membros WHERE setor_id = ?').run(setorId);
  const ins = db.prepare('INSERT INTO setor_membros (setor_id, usuario_id) VALUES (?, ?)');
  for (const u of usuarioIds) ins.run(setorId, u);
}

// ── Contatos ────────────────────────────────────────────────────────────────
// Telefone guardado normalizado; o mesmo número com ou sem o nono dígito é o mesmo contato.
function acharContato(db, empresaId, numero) {
  const variantes = telefone.variantesBrasil(numero);
  if (!variantes.length) return null;
  return db.prepare(`SELECT * FROM contatos WHERE empresa_id = ? AND telefone IN (${variantes.map(() => '?').join(', ')})`)
    .get(empresaId, ...variantes) || null;
}

function acharOuCriarContato(db, empresaId, numero, { nome = null, nomeWhatsapp = null } = {}) {
  const existente = acharContato(db, empresaId, numero);
  if (existente) {
    if (nomeWhatsapp && existente.nome_whatsapp !== nomeWhatsapp) {
      // Contato criado sem nome ganha o nome do WhatsApp; nome editado na Central nunca é trocado.
      const semNome = existente.nome === SEM_NOME;
      db.prepare(`UPDATE contatos SET nome_whatsapp = ?${semNome ? ', nome = ?' : ''}, atualizado_em = ? WHERE id = ?`)
        .run(...[nomeWhatsapp, ...(semNome ? [nomeWhatsapp] : []), agora(), existente.id]);
      return { ...existente, nome: semNome ? nomeWhatsapp : existente.nome, nome_whatsapp: nomeWhatsapp };
    }
    return { ...existente, nome_whatsapp: nomeWhatsapp || existente.nome_whatsapp };
  }
  const c = { id: novoId('contato'), empresa_id: empresaId, telefone: telefone.normalizar(numero),
    nome: String(nome || nomeWhatsapp || '').trim().slice(0, 80) || SEM_NOME, nome_whatsapp: nomeWhatsapp || null, criado_em: agora() };
  db.prepare('INSERT INTO contatos (id, empresa_id, telefone, nome, nome_whatsapp, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, c.empresa_id, c.telefone, c.nome, c.nome_whatsapp, c.criado_em, c.criado_em);
  return c;
}

function buscarContato(db, empresaId, id) {
  return db.prepare('SELECT * FROM contatos WHERE id = ? AND empresa_id = ?').get(String(id || ''), empresaId) || null;
}

function paraContato(db, ct) {
  const r = db.prepare('SELECT COUNT(*) AS n, MIN(aberta_em) AS primeira, MAX(aberta_em) AS ultima FROM conversas WHERE contato_id = ?').get(ct.id);
  return { id: ct.id, nome: ct.nome, nome_whatsapp: ct.nome_whatsapp, telefone_mascarado: telefone.mascarar(ct.telefone),
    conversas_total: r.n, primeira_conversa_em: r.primeira || null, ultima_conversa_em: r.ultima || null };
}

// ── Conversas ───────────────────────────────────────────────────────────────
const SELECT_CONVERSA = `SELECT cv.*, cn.nome AS canal_nome, s.nome AS setor_nome, s.codigo AS setor_codigo,
    u.nome AS responsavel_nome, ct.nome AS contato_nome, ct.telefone AS contato_telefone
  FROM conversas cv JOIN canais cn ON cn.id = cv.canal_id JOIN setores s ON s.id = cv.setor_id
  JOIN contatos ct ON ct.id = cv.contato_id LEFT JOIN usuarios u ON u.id = cv.responsavel_id`;

function buscarConversa(db, empresaId, id) {
  return db.prepare(`${SELECT_CONVERSA} WHERE cv.id = ? AND cv.empresa_id = ?`).get(String(id || ''), empresaId) || null;
}

function conversaAbertaDoContato(db, canalId, contatoId) {
  return db.prepare("SELECT id, empresa_id FROM conversas WHERE canal_id = ? AND contato_id = ? AND situacao = 'aberta'").get(canalId, contatoId) || null;
}

// Protocolo por empresa e ano: 2026-000001, 2026-000002… (só exibição; o id continua aleatório).
function proximoProtocolo(db, empresaId) {
  const ano = new Date().getUTCFullYear();
  db.prepare('INSERT INTO protocolos (empresa_id, ano, ultimo) VALUES (?, ?, 0) ON CONFLICT (empresa_id, ano) DO NOTHING').run(empresaId, ano);
  db.prepare('UPDATE protocolos SET ultimo = ultimo + 1 WHERE empresa_id = ? AND ano = ?').run(empresaId, ano);
  const n = db.prepare('SELECT ultimo FROM protocolos WHERE empresa_id = ? AND ano = ?').get(empresaId, ano).ultimo;
  return `${ano}-${String(n).padStart(6, '0')}`;
}

function criarConversa(db, { empresaId, canalId, contatoId, setorId, prioridade = 'normal' }) {
  const id = novoId('conversa');
  const t = agora();
  db.prepare(`INSERT INTO conversas (id, empresa_id, protocolo, canal_id, contato_id, setor_id, prioridade, aberta_em, atualizada_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, empresaId, proximoProtocolo(db, empresaId), canalId, contatoId, setorId, prioridade, t, t);
  return id;
}

const CAMPOS_CONVERSA = new Set(['setor_id', 'responsavel_id', 'situacao', 'prioridade', 'nao_lidas', 'etiquetas', 'motivo_encerramento',
  'encerrada_em', 'ultimo_aviso_fora_horario_em']);
function atualizarConversa(db, id, campos) {
  const chaves = Object.keys(campos).filter(c => CAMPOS_CONVERSA.has(c));
  db.prepare(`UPDATE conversas SET atualizada_em = @atualizada_em${chaves.map(c => `, ${c} = @${c}`).join('')} WHERE id = @id`)
    .run({ id, atualizada_em: campos.atualizada_em || agora(), ...Object.fromEntries(chaves.map(c => [c, campos[c]])) });
}

// ── Itens ───────────────────────────────────────────────────────────────────
// Estado da saída vem da própria mensagem da fila (uma fonte só da verdade).
// Desempate pela ordem de gravação (rowid): o WhatsApp manda a hora em segundos e o id é aleatório.
const SELECT_ITEM = `SELECT i.*, i.rowid AS ordem, m.estado AS mensagem_estado FROM conversa_itens i LEFT JOIN mensagens m ON m.id = i.mensagem_id`;

function adicionarItem(db, conversaId, { categoria, direcao = null, autor, tipo = null, texto = null, mensagemId = null, idProvedor = null, em = agora() }) {
  const id = novoId('item');
  db.prepare(`INSERT INTO conversa_itens (id, conversa_id, categoria, direcao, autor_tipo, autor_id, autor_nome, tipo, texto, mensagem_id, id_provedor, em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, conversaId, categoria, direcao, autor.tipo, autor.id || null, autor.nome, tipo, texto, mensagemId, idProvedor, em);
  db.prepare('UPDATE conversas SET atualizada_em = ? WHERE id = ?').run(em, conversaId);
  return db.prepare(`${SELECT_ITEM} WHERE i.id = ?`).get(id);
}

function paraItem(i) {
  const estado = i.categoria !== 'mensagem' ? null : i.direcao === 'entrada' ? 'recebida' : (i.mensagem_estado || 'aceita');
  return { id: i.id, categoria: i.categoria, direcao: i.direcao, autor: { tipo: i.autor_tipo, id: i.autor_id, nome: i.autor_nome },
    tipo: i.tipo, texto: i.texto, estado, mensagem_id: i.mensagem_id, em: i.em };
}

function itemDaMensagem(db, mensagemId) {
  return db.prepare(`${SELECT_ITEM} WHERE i.mensagem_id = ?`).get(mensagemId) || null;
}

function listarItens(db, conversaId, { limite, cursor, categorias = [] }) {
  const onde = ['i.conversa_id = @cv'];
  const p = { cv: conversaId };
  if (categorias.length) { onde.push(`i.categoria IN (${categorias.map((_, k) => `@c${k}`).join(', ')})`); categorias.forEach((c, k) => { p[`c${k}`] = c; }); }
  if (cursor) { onde.push('(i.em < @ce OR (i.em = @ce AND i.rowid < @co))'); p.ce = String(cursor.e); p.co = Number(cursor.o) || 0; }
  return db.prepare(`${SELECT_ITEM} WHERE ${onde.join(' AND ')} ORDER BY i.em DESC, i.rowid DESC LIMIT ${limite + 1}`).all(p);
}

// Mensagens do contato depois da última resposta de alguém (as que esperam).
function aguardandoDesde(db, cv) {
  if (cv.situacao !== 'aberta') return null;
  const ultimaSaida = db.prepare(`SELECT em FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem' AND direcao = 'saida'
      ORDER BY em DESC, rowid DESC LIMIT 1`).get(cv.id);
  const primeira = db.prepare(`SELECT MIN(em) AS em FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem' AND direcao = 'entrada'
      AND (? IS NULL OR em > ?)`).get(cv.id, ultimaSaida?.em || null, ultimaSaida?.em || null);
  if (primeira?.em) return primeira.em;
  // Aberta pelo sistema de origem e ninguém respondeu ainda: espera desde a abertura.
  const atendenteRespondeu = db.prepare(`SELECT 1 FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem' AND direcao = 'saida'
      AND autor_tipo = 'atendente' LIMIT 1`).get(cv.id);
  return atendenteRespondeu ? null : cv.aberta_em;
}

// ── Chamados (referências) e retornos ───────────────────────────────────────
function referenciasDaConversa(db, conversaId, aplicacaoId = null) {
  return db.prepare(`SELECT r.sistema, r.ref_id, r.titulo, r.link, r.aplicacao_id, a.nome AS aplicacao_nome
      FROM conversa_referencias r JOIN aplicacoes a ON a.id = r.aplicacao_id
      WHERE r.conversa_id = ? AND (? IS NULL OR r.aplicacao_id = ?) ORDER BY r.criado_em`).all(conversaId, aplicacaoId, aplicacaoId);
}

function ligarReferencia(db, conversaId, aplicacaoId, { sistema, id, titulo = null, link = null }) {
  db.prepare(`INSERT OR IGNORE INTO conversa_referencias (conversa_id, aplicacao_id, sistema, ref_id, titulo, link, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(conversaId, aplicacaoId, sistema, id, titulo, link, agora());
}

function conversaAbertaDoChamado(db, aplicacaoId, sistema, refId) {
  return db.prepare(`SELECT cv.id FROM conversa_referencias r JOIN conversas cv ON cv.id = r.conversa_id
      WHERE r.aplicacao_id = ? AND r.sistema = ? AND r.ref_id = ? AND cv.situacao = 'aberta'`).get(aplicacaoId, sistema, refId) || null;
}

// Retorno sem confirmação por 30 dias vence: fica guardado (rastreio), sai da entrega e vira pendência no Painel.
const VALIDADE_RETORNO_MS = 30 * 24 * 60 * 60 * 1000;

// Um retorno por aplicação que tem chamado ligado à conversa.
function registrarRetornos(db, cv, tipo, dados = {}) {
  const apps = db.prepare('SELECT DISTINCT aplicacao_id FROM conversa_referencias WHERE conversa_id = ?').all(cv.id).map(r => r.aplicacao_id);
  const ins = db.prepare(`INSERT INTO retornos (id, aplicacao_id, empresa_id, tipo, em, conversa_id, conversa_protocolo, conversa_situacao, dados)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const t = agora();
  for (const a of apps) ins.run(novoId('retorno'), a, cv.empresa_id, tipo, t, cv.id, cv.protocolo, cv.situacao, JSON.stringify(dados));
  return apps.length;
}

function paraRetornoV1(db, r) {
  return { id: r.id, tipo: r.tipo, em: r.em, conversa: { id: r.conversa_id, protocolo: r.conversa_protocolo, situacao: r.conversa_situacao },
    referencias: referenciasDaConversa(db, r.conversa_id, r.aplicacao_id).map(refV1), dados: json(r.dados, {}) };
}

const refV1 = (r) => ({ sistema: r.sistema, id: r.ref_id, titulo: r.titulo, link: r.link });
const refAdmin = (r) => ({ ...refV1(r), aplicacao: { id: r.aplicacao_id, nome: r.aplicacao_nome } });

// ── Formas de conversa ──────────────────────────────────────────────────────
function paraConversaResumo(db, cv) {
  const ultima = db.prepare(`SELECT texto, direcao, autor_tipo, em FROM conversa_itens WHERE conversa_id = ? AND categoria = 'mensagem'
      ORDER BY em DESC, rowid DESC LIMIT 1`).get(cv.id);
  return {
    id: cv.id, protocolo: cv.protocolo, canal: { id: cv.canal_id, nome: cv.canal_nome },
    contato: { id: cv.contato_id, nome: cv.contato_nome, telefone_mascarado: telefone.mascarar(cv.contato_telefone) },
    setor: { id: cv.setor_id, nome: cv.setor_nome }, responsavel: cv.responsavel_id ? { id: cv.responsavel_id, nome: cv.responsavel_nome } : null,
    situacao: cv.situacao, na_fila: cv.situacao === 'aberta' && !cv.responsavel_id, nao_lidas: cv.nao_lidas,
    ultima_mensagem: ultima ? { previa: previaDe(ultima.texto), direcao: ultima.direcao, autor_tipo: ultima.autor_tipo, em: ultima.em } : null,
    aguardando_desde: aguardandoDesde(db, cv), etiquetas: json(cv.etiquetas, []), prioridade: cv.prioridade,
    referencias: referenciasDaConversa(db, cv.id).map(refAdmin), aberta_em: cv.aberta_em, atualizada_em: cv.atualizada_em, encerrada_em: cv.encerrada_em,
  };
}

function paraConversaV1(db, cv, aplicacaoId) {
  return {
    id: cv.id, protocolo: cv.protocolo, situacao: cv.situacao, na_fila: cv.situacao === 'aberta' && !cv.responsavel_id, canal: cv.canal_id,
    setor: { codigo: cv.setor_codigo, nome: cv.setor_nome }, responsavel: cv.responsavel_id ? { id: cv.responsavel_id, nome: cv.responsavel_nome } : null,
    prioridade: cv.prioridade, referencias: referenciasDaConversa(db, cv.id, aplicacaoId).map(refV1),
    aberta_em: cv.aberta_em, atualizada_em: cv.atualizada_em, encerrada_em: cv.encerrada_em, motivo_encerramento: cv.motivo_encerramento,
    link: `${config.BASE_PATH}/atendimento.html?conversa=${cv.id}`,
  };
}

// ── Respostas rápidas ───────────────────────────────────────────────────────
function paraResposta(r) {
  return { id: r.id, atalho: r.atalho, titulo: r.titulo, texto: r.texto, setor: r.setor_id ? { id: r.setor_id, nome: r.setor_nome } : null,
    situacao: r.situacao, atualizado_em: r.atualizado_em };
}

module.exports = {
  json, previaDe, VALIDADE_RETORNO_MS,
  membrosDoSetor, buscarSetor, setorPorCodigo, setoresDoUsuario, paraSetor, trocarMembros,
  acharContato, acharOuCriarContato, buscarContato, paraContato,
  SELECT_CONVERSA, buscarConversa, conversaAbertaDoContato, criarConversa, atualizarConversa,
  adicionarItem, paraItem, itemDaMensagem, listarItens, aguardandoDesde,
  referenciasDaConversa, ligarReferencia, conversaAbertaDoChamado, registrarRetornos, paraRetornoV1,
  paraConversaResumo, paraConversaV1, paraResposta,
};

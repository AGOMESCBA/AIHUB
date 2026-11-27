'use strict';

// Rotas da Central de atendimento e do cadastro de setores (C9). Contrato: docs/contratos.md §8.
// talk-atendimento: conversas e contatos; talk-setores: criar/alterar setores e respostas rápidas
// (ler setores e respostas rápidas vale com qualquer uma das duas).

const express = require('express');
const { erro, middlewareErros } = require('../erros');
const { lerPaginacao, montarPagina } = require('../paginacao');
const auditoria = require('../repositorios/auditoria');
const { ROTINAS } = require('../acesso/papeis');
const { ipDe } = require('../acesso/middleware');
const { VISOES_CONVERSA } = require('../contratos');
const { Atendimento } = require('../atendimento/servico');
const repo = require('../atendimento/repositorio');

const escaparLike = (v) => `%${String(v).replace(/[%_\\]/g, '\\$&')}%`;

// 1ª mensagem do contato depois da última resposta; sem nenhuma, a abertura (base da ordem da fila).
const SQL_AGUARDANDO = `COALESCE((SELECT MIN(i.em) FROM conversa_itens i WHERE i.conversa_id = cv.id AND i.categoria = 'mensagem' AND i.direcao = 'entrada'
    AND i.em > COALESCE((SELECT MAX(o.em) FROM conversa_itens o WHERE o.conversa_id = cv.id AND o.categoria = 'mensagem' AND o.direcao = 'saida'), '')), cv.aberta_em)`;

function criarRotasAtendimento({ db, atendimento, log = console }) {
  const r = express.Router();
  const exigirAlguma = (...rotinas) => (req, _res, next) => {
    if (!req.sessao) return next(erro('nao_autenticado', 'Sua sessão terminou. Entre de novo pelo link da sua empresa.'));
    if (!rotinas.some(x => req.rotinas.includes(x))) return next(erro('sem_permissao', 'Você não tem permissão para esta rotina. Fale com o administrador da empresa.'));
    req.contexto.exigirEmpresa();
    req.acesso = Atendimento.acessoDe(req.contexto, req.rotinas);
    next();
  };
  const central = exigirAlguma(ROTINAS.atendimento);
  const cadastro = exigirAlguma(ROTINAS.setores);
  const leitura = exigirAlguma(ROTINAS.atendimento, ROTINAS.setores);
  const auditar = (req, acao, alvoTipo, alvoId, resumo) => auditoria.registrar(db, req.contexto, { acao, alvoTipo, alvoId, resumo, ip: ipDe(req) });
  const detalhe = (req, cv) => atendimento.detalhe(req.acesso, cv);

  // ── Setores ───────────────────────────────────────────────────────────────
  r.get('/setores', leitura, (req, res) => {
    const { limite, cursor } = lerPaginacao(req.query);
    const p = { empresa: req.acesso.empresaId };
    const onde = ['empresa_id = @empresa'];
    if (req.query.situacao) { onde.push('situacao = @situacao'); p.situacao = String(req.query.situacao); }
    if (req.query.busca) { onde.push("(nome LIKE @b ESCAPE '\\' OR descricao LIKE @b ESCAPE '\\')"); p.b = escaparLike(req.query.busca); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM setores WHERE ${onde.join(' AND ')}`).get(p).n;
    if (cursor) { onde.push('(nome > @cn OR (nome = @cn AND id > @ci))'); p.cn = String(cursor.n); p.ci = String(cursor.i); }
    const itens = db.prepare(`SELECT * FROM setores WHERE ${onde.join(' AND ')} ORDER BY nome, id LIMIT ${limite + 1}`).all(p).map(s => repo.paraSetor(db, s));
    res.json(montarPagina(itens, { limite, total, cursorDoUltimo: (u) => ({ n: u.nome, i: u.id }) }));
  });
  r.get('/setores/:id', leitura, (req, res) => {
    const s = repo.buscarSetor(db, req.acesso.empresaId, req.params.id);
    if (!s) throw erro('nao_encontrado', 'Setor não encontrado.');
    res.json(repo.paraSetor(db, s));
  });
  r.post('/setores', cadastro, (req, res) => {
    const s = atendimento.criarSetor(req.acesso, req.body || {});
    auditar(req, 'setor.criado', 'setor', s.id, `Criou o setor ${s.nome}`);
    res.status(201).json(repo.paraSetor(db, s));
  });
  r.put('/setores/:id', cadastro, (req, res) => {
    const s = atendimento.atualizarSetor(req.acesso, req.params.id, req.body || {});
    auditar(req, 'setor.alterado', 'setor', s.id, `Alterou o setor ${s.nome}`);
    res.json(repo.paraSetor(db, s));
  });

  // ── Respostas rápidas ─────────────────────────────────────────────────────
  const SELECT_RR = 'SELECT rr.*, s.nome AS setor_nome FROM respostas_rapidas rr LEFT JOIN setores s ON s.id = rr.setor_id';
  r.get('/respostas-rapidas', leitura, (req, res) => {
    const { limite, cursor } = lerPaginacao(req.query);
    const p = { empresa: req.acesso.empresaId };
    const onde = ['rr.empresa_id = @empresa'];
    if (req.query.situacao) { onde.push('rr.situacao = @situacao'); p.situacao = String(req.query.situacao); }
    // setor_id: as gerais + as daquele setor (o que a Central oferece ao digitar "/").
    if (req.query.setor_id) { onde.push('(rr.setor_id IS NULL OR rr.setor_id = @setor)'); p.setor = String(req.query.setor_id); }
    if (req.query.busca) { onde.push("(rr.atalho LIKE @b ESCAPE '\\' OR rr.titulo LIKE @b ESCAPE '\\' OR rr.texto LIKE @b ESCAPE '\\')"); p.b = escaparLike(req.query.busca); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM respostas_rapidas rr WHERE ${onde.join(' AND ')}`).get(p).n;
    if (cursor) { onde.push('(rr.atalho > @ca)'); p.ca = String(cursor.a); }
    const itens = db.prepare(`${SELECT_RR} WHERE ${onde.join(' AND ')} ORDER BY rr.atalho LIMIT ${limite + 1}`).all(p).map(repo.paraResposta);
    res.json(montarPagina(itens, { limite, total, cursorDoUltimo: (u) => ({ a: u.atalho }) }));
  });
  const respostaPorId = (req, id) => repo.paraResposta(db.prepare(`${SELECT_RR} WHERE rr.id = ? AND rr.empresa_id = ?`).get(id, req.acesso.empresaId));
  r.post('/respostas-rapidas', cadastro, (req, res) => {
    const id = atendimento.criarResposta(req.acesso, req.body || {});
    auditar(req, 'resposta_rapida.criada', 'resposta_rapida', id, `Criou a resposta rápida ${req.body.atalho}`);
    res.status(201).json(respostaPorId(req, id));
  });
  r.put('/respostas-rapidas/:id', cadastro, (req, res) => {
    const id = atendimento.atualizarResposta(req.acesso, req.params.id, req.body || {});
    res.json(respostaPorId(req, id));
  });

  // ── Conversas ─────────────────────────────────────────────────────────────
  r.get('/conversas/contadores', central, (req, res) => res.json(atendimento.contadores(req.acesso)));

  r.get('/conversas', central, (req, res) => {
    const { limite, cursor } = lerPaginacao(req.query);
    const q = req.query;
    const visao = q.visao || 'abertas';
    if (!VISOES_CONVERSA.includes(visao)) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { visao: `Use ${VISOES_CONVERSA.join(', ')}.` } });
    const p = {};
    const onde = [atendimento.filtroVisivel(req.acesso, p)];
    if (visao === 'minhas') { onde.push("cv.situacao = 'aberta' AND cv.responsavel_id = @eu"); p.eu = req.acesso.usuarioId; }
    if (visao === 'fila') onde.push("cv.situacao = 'aberta' AND cv.responsavel_id IS NULL");
    if (visao === 'abertas') onde.push("cv.situacao = 'aberta'");
    if (visao === 'encerradas') onde.push("cv.situacao = 'encerrada'");
    if (q.setor_id) { onde.push('cv.setor_id = @setor'); p.setor = String(q.setor_id); }
    if (q.canal_id) { onde.push('cv.canal_id = @canal'); p.canal = String(q.canal_id); }
    if (q.contato_id) { onde.push('cv.contato_id = @contato'); p.contato = String(q.contato_id); }
    if (q.responsavel_id === 'nenhum') onde.push('cv.responsavel_id IS NULL');
    else if (q.responsavel_id) { onde.push('cv.responsavel_id = @resp'); p.resp = String(q.responsavel_id); }
    if (q.etiqueta) { onde.push('EXISTS (SELECT 1 FROM json_each(cv.etiquetas) WHERE value = @etq)'); p.etq = String(q.etiqueta); }
    if (q.busca) {
      const digitos = String(q.busca).replace(/\D/g, '');
      onde.push(`(ct.nome LIKE @b ESCAPE '\\' OR cv.protocolo LIKE @b ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM conversa_itens bi WHERE bi.conversa_id = cv.id AND bi.categoria = 'mensagem' AND bi.texto LIKE @b ESCAPE '\\')
        ${digitos.length >= 4 ? 'OR ct.telefone LIKE @fim' : ''})`);
      p.b = escaparLike(q.busca);
      if (digitos.length >= 4) p.fim = `%${digitos}`;
    }
    // Fila: prioridade alta primeiro e, dentro dela, quem espera há mais tempo. Demais: atividade mais recente.
    const ordem = visao === 'fila' ? `CASE cv.prioridade WHEN 'alta' THEN 0 ELSE 1 END, ${SQL_AGUARDANDO}, cv.id` : 'cv.atualizada_em DESC, cv.id DESC';
    const base = `${repo.SELECT_CONVERSA} WHERE ${onde.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(p).n;
    const deslocamento = Number(cursor?.o) || 0;
    const linhas = db.prepare(`${base} ORDER BY ${ordem} LIMIT ${limite + 1} OFFSET ${deslocamento}`).all(p);
    const itens = linhas.map(cv => repo.paraConversaResumo(db, cv));
    res.json(montarPagina(itens, { limite, total, cursorDoUltimo: () => ({ o: deslocamento + limite }) }));
  });

  r.get('/conversas/:id', central, (req, res) => res.json(detalhe(req, atendimento.conversa(req.acesso, req.params.id))));
  r.get('/conversas/:id/itens', central, (req, res) => {
    const cv = atendimento.conversa(req.acesso, req.params.id);
    const { limite, cursor } = lerPaginacao(req.query);
    const categorias = req.query.categoria ? String(req.query.categoria).split('|') : [];
    const linhas = repo.listarItens(db, cv.id, { limite, cursor, categorias });
    const pagina = montarPagina(linhas, { limite, cursorDoUltimo: (u) => ({ e: u.em, o: u.ordem }) });
    res.json({ ...pagina, itens: pagina.itens.map(repo.paraItem) });
  });

  r.post('/conversas/:id/assumir', central, (req, res) => res.json(detalhe(req, atendimento.assumir(req.acesso, req.params.id))));
  r.post('/conversas/:id/devolver', central, (req, res) => res.json(detalhe(req, atendimento.devolver(req.acesso, req.params.id))));
  r.post('/conversas/:id/transferir', central, (req, res) => {
    const cv = atendimento.transferir(req.acesso, req.params.id, req.body || {});
    auditar(req, 'conversa.transferida', 'conversa', cv.id, `Transferiu a conversa ${cv.protocolo} para ${cv.responsavel_nome || `o setor ${cv.setor_nome}`}`);
    res.json(detalhe(req, cv));
  });
  r.post('/conversas/:id/encerrar', central, (req, res) => res.json(detalhe(req, atendimento.encerrar(req.acesso, req.params.id, req.body || {}))));
  r.post('/conversas/:id/reabrir', central, (req, res) => res.json(detalhe(req, atendimento.reabrir(req.acesso, req.params.id))));
  r.post('/conversas/:id/marcar-lida', central, (req, res) => res.json(detalhe(req, atendimento.marcarLida(req.acesso, req.params.id))));
  r.put('/conversas/:id/etiquetas', central, (req, res) => res.json(detalhe(req, atendimento.etiquetas(req.acesso, req.params.id, req.body?.etiquetas))));
  r.post('/conversas/:id/notas', central, (req, res) => res.status(201).json(atendimento.nota(req.acesso, req.params.id, req.body?.texto)));
  r.post('/conversas/:id/responder', central, (req, res) => res.status(202).json(atendimento.responder(req.acesso, req.params.id, req.body?.texto)));

  // ── Contatos ──────────────────────────────────────────────────────────────
  r.get('/contatos/:id', central, (req, res) => res.json(repo.paraContato(db, atendimento.contato(req.acesso, req.params.id))));
  r.put('/contatos/:id', central, (req, res) => res.json(repo.paraContato(db, atendimento.renomearContato(req.acesso, req.params.id, req.body?.nome))));

  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasAtendimento };

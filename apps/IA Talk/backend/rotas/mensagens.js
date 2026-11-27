'use strict';

// Rotas de mensagens da tela (rotina talk-mensagens). Contrato: docs/contratos.md §5.
// Só as mensagens da empresa da sessão. Reenviar e dar como falha só em
// "desconhecida"/"falhou" (decisão humana; nunca automático).

const express = require('express');
const { erro, middlewareErros } = require('../erros');
const { lerPaginacao, montarPagina } = require('../paginacao');
const auditoria = require('../repositorios/auditoria');
const { ROTINAS } = require('../acesso/papeis');
const { exigirRotina, ipDe } = require('../acesso/middleware');
const telefone = require('../seguranca/telefone');
const { ESTADOS_COM_ACAO_MANUAL } = require('../contratos');
const repo = require('../mensagens/repositorio');
const config = require('../config');
const { SQL_VISIVEIS } = require('./canais');
const repoAtd = require('../atendimento/repositorio');

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function criarRotasMensagens({ db, despachante = null, log = console }) {
  const r = express.Router();
  const exigir = exigirRotina(ROTINAS.mensagens);
  const auditar = (req, acao, alvoId, resumo) => auditoria.registrar(db, req.contexto, { acao, alvoTipo: 'mensagem', alvoId, resumo, ip: ipDe(req) });

  const SELECT = `SELECT m.*, c.nome AS canal_nome, a.nome AS aplicacao_nome
    FROM mensagens m JOIN canais c ON c.id = m.canal_id LEFT JOIN aplicacoes a ON a.id = m.aplicacao_id`;

  r.get('/mensagens', exigir, (req, res) => {
    const { limite, cursor } = lerPaginacao(req.query);
    const q = req.query;
    const onde = ['m.empresa_id = @empresa'];
    const p = { empresa: req.contexto.exigirEmpresa() };
    if (q.de) { if (!DATA.test(q.de)) throw erro('requisicao_invalida', 'Data inicial inválida.', { campos: { de: 'AAAA-MM-DD' } }); onde.push('m.criada_em >= @de'); p.de = q.de; }
    if (q.ate) { if (!DATA.test(q.ate)) throw erro('requisicao_invalida', 'Data final inválida.', { campos: { ate: 'AAAA-MM-DD' } }); onde.push('substr(m.criada_em, 1, 10) <= @ate'); p.ate = q.ate; }
    if (q.canal_id) { onde.push('m.canal_id = @canal'); p.canal = String(q.canal_id); }
    if (q.aplicacao_id === 'nenhuma') onde.push('m.aplicacao_id IS NULL');
    else if (q.aplicacao_id) { onde.push('m.aplicacao_id = @app'); p.app = String(q.aplicacao_id); }
    if (q.direcao) { onde.push('m.direcao = @direcao'); p.direcao = String(q.direcao); }
    if (q.tipo) { onde.push('m.tipo = @tipo'); p.tipo = String(q.tipo); }
    const estados = q.apenas_falhas === '1' || q.apenas_falhas === 'true' ? [...ESTADOS_COM_ACAO_MANUAL] : (q.estado ? String(q.estado).split('|') : []);
    if (estados.length) { onde.push(`m.estado IN (${estados.map((_, i) => `@e${i}`).join(', ')})`); estados.forEach((e, i) => { p[`e${i}`] = e; }); }
    if (q.correlacao_id) { onde.push("m.correlacao_id LIKE @corr ESCAPE '\\'"); p.corr = `%${String(q.correlacao_id).replace(/[%_\\]/g, '\\$&')}%`; }
    if (q.destinatario) {
      const variantes = telefone.variantesBrasil(q.destinatario);
      if (!variantes.length) throw erro('requisicao_invalida', 'Número inválido.', { campos: { destinatario: 'Use DDI e DDD.' } });
      onde.push(`m.destino IN (${variantes.map((_, i) => `@d${i}`).join(', ')})`); variantes.forEach((v, i) => { p[`d${i}`] = v; });
    }
    if (q.busca) {
      onde.push("(m.previa LIKE @busca ESCAPE '\\' OR m.id = @buscaExata OR m.correlacao_id LIKE @busca ESCAPE '\\')");
      p.busca = `%${String(q.busca).replace(/[%_\\]/g, '\\$&')}%`; p.buscaExata = String(q.busca);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mensagens m WHERE ${onde.join(' AND ')}`).get(p).n;
    if (cursor) { onde.push('(m.criada_em < @cc OR (m.criada_em = @cc AND m.id < @ci))'); p.cc = String(cursor.c); p.ci = String(cursor.i); }
    const itens = db.prepare(`${SELECT} WHERE ${onde.join(' AND ')} ORDER BY m.criada_em DESC, m.id DESC LIMIT ${limite + 1}`).all(p).map(repo.paraResumo);
    res.json(montarPagina(itens, { limite, total, cursorDoUltimo: (u) => ({ c: u.criada_em, i: u.id }) }));
  });

  const acharDaEmpresa = (req) => {
    const m = repo.buscar(db, req.params.id);
    if (!m || m.empresa_id !== req.contexto.empresaId) throw erro('nao_encontrado', 'Mensagem não encontrada.');
    return m;
  };

  r.get('/mensagens/:id', exigir, (req, res) => res.json(repo.paraDetalhe(db, acharDaEmpresa(req))));

  // Reenviar uma "desconhecida" pode duplicar no celular do destinatário: a tela avisa antes.
  r.post('/mensagens/:id/reenviar', exigir, (req, res) => {
    const m = acharDaEmpresa(req);
    if (!ESTADOS_COM_ACAO_MANUAL.includes(m.estado)) throw erro('conflito', 'Só mensagens com resultado desconhecido ou com falha podem ser reenviadas.');
    const nova = repo.reabrir(db, m.id, 'Reenvio pedido manualmente na tela.');
    auditar(req, 'mensagem.reenviada', m.id, `Pediu o reenvio da mensagem para ${telefone.mascarar(m.destino)} (estava ${m.estado})`);
    despachante?.avisar(nova);
    setImmediate(() => despachante?.acordar());
    res.json(repo.paraDetalhe(db, nova));
  });

  r.post('/mensagens/:id/dar-como-falha', exigir, (req, res) => {
    const m = acharDaEmpresa(req);
    if (m.estado !== 'desconhecida') throw erro('conflito', 'Só mensagens com resultado desconhecido podem ser dadas como falha.');
    const nova = repo.mudarEstado(db, m.id, 'falhou', { detalhe: 'Marcada como falha manualmente na tela.' });
    auditar(req, 'mensagem.dada_como_falha', m.id, `Deu como falha a mensagem para ${telefone.mascarar(m.destino)}`);
    despachante?.avisar(nova);
    res.json(repo.paraDetalhe(db, nova));
  });

  // Painel (rotina talk-painel): números do dia e pendências da empresa da sessão.
  r.get('/painel', exigirRotina(ROTINAS.painel), (req, res) => {
    const empresa = req.contexto.exigirEmpresa();
    const hoje = new Date().toISOString().slice(0, 10);
    const retornosVencidos = (empresaId) => db.prepare(`SELECT a.id, a.nome, COUNT(*) AS n FROM retornos r JOIN aplicacoes a ON a.id = r.aplicacao_id
        WHERE r.empresa_id = ? AND r.confirmado_em IS NULL AND r.em < ? GROUP BY a.id, a.nome ORDER BY a.nome`)
      .all(empresaId, new Date(Date.now() - repoAtd.VALIDADE_RETORNO_MS).toISOString());
    const canais = db.prepare(`SELECT * FROM (${SQL_VISIVEIS.replace(/@empresa_id/g, '?')})`).all(empresa, empresa);
    const comProblema = canais.filter(c => !['conectado', 'parado'].includes(c.estado));
    const conta = (sql, ...p) => db.prepare(sql).get(...p).n;
    const doDia = "empresa_id = ? AND substr(criada_em, 1, 10) = ?";
    const idsCanais = canais.map(c => c.id);
    const recebidas = idsCanais.length ? conta(`SELECT COUNT(*) AS n FROM canal_log WHERE tipo = 'received' AND substr(em, 1, 10) = ? AND canal_id IN (${idsCanais.map(() => '?').join(',')})`, hoje, ...idsCanais) : 0;
    const desconhecidas = conta("SELECT COUNT(*) AS n FROM mensagens WHERE empresa_id = ? AND estado = 'desconhecida'", empresa);
    // Tempo médio entre aceitar e o WhatsApp confirmar o envio (mensagens de hoje).
    const tempo = db.prepare(`SELECT AVG((julianday(e.em) - julianday(m.criada_em)) * 86400000) AS ms FROM mensagens m
        JOIN mensagem_estados e ON e.mensagem_id = m.id AND e.estado = 'enviada'
       WHERE m.empresa_id = ? AND substr(m.criada_em, 1, 10) = ?`).get(empresa, hoje).ms;
    const B = config.BASE_PATH;
    const pendencias = [
      ...(desconhecidas ? [{ tipo: 'mensagens_desconhecidas', gravidade: 'alta', mensagem: `${desconhecidas} mensagem(ns) com resultado desconhecido: confira e decida reenviar ou dar como falha.`, link: `${B}/mensagens.html?estado=desconhecida` }] : []),
      ...comProblema.map(c => ({ tipo: 'canal_com_problema', gravidade: c.estado === 'erro' ? 'alta' : 'media',
        mensagem: `O canal ${c.nome} está ${c.estado.replace('_', ' ')}.`, link: `${B}/canais.html?id=${encodeURIComponent(c.id)}` })),
      // C9 §8.9: retorno que o sistema de origem não confirmou em 30 dias vence (fica guardado, não é mais entregue).
      ...retornosVencidos(empresa).map(a => ({ tipo: 'retornos_vencidos', gravidade: 'media',
        mensagem: `${a.n} retorno(s) para ${a.nome} venceram sem confirmação (mais de 30 dias). Confira a integração desse sistema.`,
        link: `${B}/aplicacoes.html?id=${encodeURIComponent(a.id)}` })),
    ];
    res.json({
      canais: { total: canais.length, conectados: canais.filter(c => c.estado === 'conectado').length, com_problema: comProblema.length },
      mensagens_hoje: {
        enviadas: conta(`SELECT COUNT(*) AS n FROM mensagens WHERE ${doDia} AND estado IN ('enviada', 'entregue', 'lida')`, empresa, hoje),
        recebidas,
        falhas: conta(`SELECT COUNT(*) AS n FROM mensagens WHERE ${doDia} AND estado = 'falhou'`, empresa, hoje),
      },
      fila: { aguardando: conta("SELECT COUNT(*) AS n FROM mensagens WHERE empresa_id = ? AND estado IN ('aceita', 'aguardando')", empresa), desconhecidas },
      tempo_medio_envio_ms: tempo === null ? null : Math.round(tempo),
      pendencias,
      atualizado_em: new Date().toISOString(),
    });
  });

  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasMensagens };

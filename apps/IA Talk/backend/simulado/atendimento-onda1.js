'use strict';

// C10 — Onda 1 do atendimento no servidor simulado (docs/contratos.md §9): configuração do setor
// (menu, distribuição, alertas, SLA, pesquisa), status do atendente, alertas, painel ao vivo e
// relatório. As mudanças na conversa (triagem, oferta, SLA, pesquisa) ficam em atendimento.js.
// Rotas só do simulado: POST /simulado/alerta (dispara um alerta para a sessão).

const { erro } = require('../erros');
const { EVENTOS_SOCKET } = require('../contratos');
const { ROTINAS } = require('../acesso/papeis');

const S = EVENTOS_SOCKET.servidor;
const MIN = 60 * 1000;

// Configuração (padrões e validação) vem do servidor real: uma regra só.
const { padroesDoSetor, configDoSetor, configDoMenuDoCanal, slaDaConversa, PERGUNTA_PADRAO, SAUDACAO_PADRAO, inteiro, bool } = require('../atendimento/config-onda1');

function criarOnda1({ dados, at, sessao, novo, agora, listar, emitir, h }) {
  // Status dos atendentes (§9.2). Online no simulado: a sessão e quem está marcado.
  const status = new Map([
    ['usr_ana', { status: 'disponivel', online: true, alertas_whatsapp: false, status_desde: new Date(Date.now() - 50 * MIN).toISOString() }],
    ['usr_bruno', { status: 'disponivel', online: true, alertas_whatsapp: true, status_desde: new Date(Date.now() - 2 * 60 * MIN).toISOString() }],
    ['usr_carla', { status: 'ocupado', online: true, alertas_whatsapp: false, status_desde: new Date(Date.now() - 12 * MIN).toISOString() }],
  ]);
  const alertas = []; // { id, usuario_id, tipo, conversa_id, protocolo, setor, mensagem, em, lido_em }

  const estadoDe = (uid) => status.get(uid) || { status: 'ausente', online: false, alertas_whatsapp: false, status_desde: agora() };
  function paraAtendente(uid) {
    const u = dados.usuarios.find(x => x.id === uid);
    const setores = at.setores.filter(s => s.membros.some(m => m.id === uid));
    const e = estadoDe(uid);
    return {
      usuario: { id: u.id, nome: u.nome }, status: e.status, online: e.online,
      conversas_abertas: at.conversas.filter(c => c.situacao === 'aberta' && c.responsavel?.id === uid).length,
      limite: Math.max(0, ...setores.map(s => s.distribuicao?.limite_por_atendente || 0)) || null,
      setores: setores.map(s => ({ id: s.id, nome: s.nome })), alertas_whatsapp: e.alertas_whatsapp, status_desde: e.status_desde,
    };
  }
  const atendentesDaEmpresa = () => dados.usuarios.filter(u => u.situacao === 'ativo' && at.setores.some(s => s.empresa_id === sessao.empresaId && s.membros.some(m => m.id === u.id)));

  function alertar(uid, { tipo, cv, mensagem }) {
    const a = { id: novo('alr'), usuario_id: uid, tipo, conversa_id: cv?.id || null, protocolo: cv?.protocolo || null,
      setor: cv ? { ...cv.setor } : null, mensagem, em: agora(), lido_em: null };
    alertas.unshift(a);
    const { usuario_id, ...publico } = a; // eslint-disable-line no-unused-vars
    emitir(S.alerta, publico, `usuario:${uid}`);
    return publico;
  }

  function painel() {
    const abertas = at.conversas.filter(c => c.empresa_id === sessao.empresaId && c.situacao === 'aberta');
    const hojeIso = new Date().toISOString().slice(0, 10);
    const respondidas = at.conversas.filter(c => c.pesquisa?.nota);
    return {
      por_setor: at.setores.filter(s => s.empresa_id === sessao.empresaId && s.situacao === 'ativo').map(s => {
        const doSetor = abertas.filter(c => c.setor.id === s.id);
        const esperas = doSetor.filter(c => !c.responsavel && !c.triagem).map(c => Date.now() - Date.parse(h.aguardandoDesde(c) || c.aberta_em));
        return {
          id: s.id, nome: s.nome, na_fila: doSetor.filter(c => !c.responsavel && !c.triagem).length, em_triagem: doSetor.filter(c => c.triagem).length,
          em_atendimento: doSetor.filter(c => c.responsavel).length, maior_espera_ms: esperas.length ? Math.max(...esperas) : null,
          atendentes_online: s.membros.filter(m => estadoDe(m.id).online && estadoDe(m.id).status !== 'ausente').length,
          sla_estourados: doSetor.filter(c => h.sla(c)?.situacao === 'estourado').length,
        };
      }),
      atendentes: atendentesDaEmpresa().map(u => paraAtendente(u.id)),
      hoje: {
        conversas: at.conversas.filter(c => c.aberta_em.startsWith(hojeIso)).length,
        encerradas: at.conversas.filter(c => (c.encerrada_em || '').startsWith(hojeIso)).length,
        primeira_resposta_mediana_ms: 7 * MIN,
        satisfacao_media: respondidas.length ? Math.round(respondidas.reduce((t, c) => t + c.pesquisa.nota, 0) / respondidas.length * 10) / 10 : null,
        respostas_pesquisa: respondidas.length,
      },
      atualizado_em: agora(),
    };
  }

  function rotas(admin) {
    const R = ROTINAS;
    admin.get('/atendentes/eu', (req, res) => { h.exigirRotina(req, R.atendimento); res.json(paraAtendente(h.usuarioId(req))); });
    admin.put('/atendentes/eu', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      const uid = h.usuarioId(req);
      const b = req.body || {};
      const campos = {};
      if (b.status !== undefined && !['disponivel', 'ocupado', 'ausente'].includes(b.status)) campos.status = 'Use disponivel, ocupado ou ausente.';
      if (b.alertas_whatsapp !== undefined && !bool(b.alertas_whatsapp)) campos.alertas_whatsapp = 'Verdadeiro ou falso.';
      if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
      const e = { ...estadoDe(uid), online: true };
      if (b.status !== undefined && b.status !== e.status) { e.status = b.status; e.status_desde = agora(); }
      if (b.alertas_whatsapp !== undefined) e.alertas_whatsapp = b.alertas_whatsapp;
      status.set(uid, e);
      emitir(S.presencaAtualizada, { usuario_id: uid, status: e.status, online: e.online, em: agora() }, 'atendimento');
      res.json(paraAtendente(uid));
    });
    admin.get('/atendentes', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      if (!h.veTudo(req)) throw erro('sem_permissao', 'Só a supervisão vê o status de todos os atendentes.');
      const lista = atendentesDaEmpresa().map(u => paraAtendente(u.id))
        .filter(a => !req.query.setor_id || a.setores.some(s => s.id === req.query.setor_id));
      res.json(listar({ ...req, query: { ...req.query, setor_id: undefined } }, lista, {}));
    });

    admin.get('/alertas', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      const meus = alertas.filter(a => a.usuario_id === h.usuarioId(req)).map(({ usuario_id, ...a }) => a); // eslint-disable-line no-unused-vars
      res.json(listar(req, meus, {}));
    });
    admin.post('/alertas/lidos', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      const b = req.body || {};
      if (b.todos !== true && !(Array.isArray(b.ids) && b.ids.length && b.ids.length <= 200)) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { ids: 'Envie de 1 a 200 ids ou { todos: true }.' } });
      }
      let n = 0;
      for (const a of alertas) {
        if (a.usuario_id !== h.usuarioId(req) || a.lido_em) continue;
        if (b.todos === true || b.ids.includes(a.id)) { a.lido_em = agora(); n++; }
      }
      res.json({ marcados: n });
    });

    admin.get('/atendimento/painel', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      if (!h.veTudo(req)) throw erro('sem_permissao', 'Só a supervisão vê o painel do atendimento.');
      res.json(painel());
    });
    admin.get('/atendimento/relatorio', (req, res) => {
      h.exigirRotina(req, R.atendimento);
      if (!h.veTudo(req)) throw erro('sem_permissao', 'Só a supervisão vê os relatórios do atendimento.');
      const agrupar = req.query.agrupar;
      if (agrupar !== undefined && !['setor', 'responsavel'].includes(agrupar)) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { agrupar: 'Use setor ou responsavel.' } });
      }
      const todas = at.conversas.filter(c => c.empresa_id === sessao.empresaId);
      const notas = todas.map(c => c.pesquisa?.nota).filter(Boolean);
      const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const n of notas) distribuicao[n]++;
      const resumo = (lista) => ({
        total: lista.length, abertas: lista.filter(c => c.situacao === 'aberta').length,
        na_fila: lista.filter(c => c.situacao === 'aberta' && !c.responsavel && !c.triagem).length,
        encerradas: lista.filter(c => c.situacao === 'encerrada').length,
        primeira_resposta: { mediana_ms: 7 * MIN, p90_ms: 22 * MIN, amostras: lista.length },
        espera_atual: { maior_ms: 41 * MIN, mediana_ms: 9 * MIN },
        duracao: { mediana_ms: 38 * MIN, amostras: lista.filter(c => c.situacao === 'encerrada').length },
      });
      const corpo = { periodo: { de: req.query.de || null, ate: req.query.ate || null }, ...resumo(todas),
        satisfacao: { media: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null, respostas: notas.length, distribuicao } };
      if (agrupar) {
        const chave = (c) => (agrupar === 'setor' ? c.setor : c.responsavel || { id: null, nome: 'Sem responsável' });
        const grupos = new Map();
        for (const c of todas) { const k = chave(c); if (!grupos.has(k.id)) grupos.set(k.id, { id: k.id, nome: k.nome, lista: [] }); grupos.get(k.id).lista.push(c); }
        corpo.grupos = [...grupos.values()].map(g => ({ id: g.id, nome: g.nome, ...resumo(g.lista) }));
      }
      res.json(corpo);
    });

    // Só do simulado: dispara um alerta para a sessão (para a tela testar som, notificação e lista).
    admin.post('/simulado/alerta', (req, res) => {
      const cv = at.conversas.find(c => c.id === req.body?.conversa_id) || at.conversas.find(c => c.situacao === 'aberta' && !c.responsavel);
      const tipo = req.body?.tipo || 'nova_na_fila';
      res.status(201).json(alertar(h.usuarioId(req), { tipo, cv, mensagem: `Nova conversa na fila do ${cv.setor.nome} (protocolo ${cv.protocolo}).` }));
    });
  }

  function socket(sock) {
    sock.join(`usuario:${sessao.usuarioId}`);
  }

  return { rotas, socket, alertar, paraAtendente, estadoDe, status, painel };
}

module.exports = { criarOnda1, configDoSetor, configDoMenuDoCanal, padroesDoSetor, slaDaConversa, PERGUNTA_PADRAO, SAUDACAO_PADRAO };

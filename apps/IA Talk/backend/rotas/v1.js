'use strict';

// API oficial v1 (C3) para os sistemas integrados. Contrato: docs/openapi-v1.yaml e
// docs/contratos.md §6. Token de aplicação (Bearer), escopos e canais autorizados
// por aplicação; Idempotency-Key obrigatório no envio (24 h, biblioteca G8).
// "aceita" (202) NÃO é entrega: o estado real vem de GET /mensagens/:id.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { erro, middlewareErros } = require('../erros');
const { agora } = require('../ids');
const tokensAplicacao = require('../acesso/tokens-aplicacao');
const idempotencia = require('../lib/idempotencia');
const repo = require('../mensagens/repositorio');
const { aceitarEnvio } = require('../mensagens/servico');
const { CAPACIDADES_WWEB } = require('../provedores/wweb');

const LIMITE_POR_MINUTO = 120;
const AVISO_ACEITA = 'Aceita para envio. Isto não confirma a entrega: acompanhe pelo estado ou pelo webhook.';

// O que o canal envia HOJE pelo Talk (arquivos chegam na próxima etapa): o integrador
// consulta isto e não recebe 422 de surpresa.
const CAPACIDADES_ENVIO = Object.freeze({ ...CAPACIDADES_WWEB, imagem: false, documento: false, audio: false, video: false });

function criarRotasV1({ db, despachante = null, log = console }) {
  const r = express.Router();

  r.use((req, _res, next) => {
    const cabecalho = String(req.get('authorization') || '');
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    const app = token ? tokensAplicacao.validar(db, token) : null;
    if (!app) return next(erro('nao_autenticado', 'Token de aplicação ausente, inválido ou revogado.'));
    req.aplicacao = app;
    next();
  });

  // Limite por aplicação (não por IP): cabeçalhos X-RateLimit-* e Retry-After no 429.
  r.use(rateLimit({
    windowMs: 60 * 1000,
    limit: LIMITE_POR_MINUTO,
    standardHeaders: false,
    legacyHeaders: true,
    keyGenerator: (req) => req.aplicacao.aplicacaoId,
    validate: false,
    handler: (_req, res) => res.status(429).json({ erro: { codigo: 'limite_excedido', mensagem: `Limite de ${LIMITE_POR_MINUTO} pedidos por minuto. Aguarde o tempo indicado em Retry-After.` } }),
  }));

  const exigirEscopo = (escopo) => (req, _res, next) => (req.aplicacao.escopos.includes(escopo)
    ? next() : next(erro('sem_permissao', `A aplicação não tem o escopo ${escopo}.`)));

  const exigirCanal = (req, canalId) => {
    const ok = db.prepare('SELECT 1 FROM aplicacao_canais WHERE aplicacao_id = ? AND canal_id = ?').get(req.aplicacao.aplicacaoId, String(canalId || ''));
    if (!ok) throw erro('canal_nao_autorizado', 'Este canal não está autorizado para a aplicação.');
  };

  const respostaAceita = (m) => ({ id: m.id, estado: 'aceita', canal: m.canal_id, criada_em: m.criada_em, correlacao_id: m.correlacao_id, aviso: AVISO_ACEITA });

  r.post('/mensagens', exigirEscopo('mensagens:enviar'), (req, res) => {
    const chave = idempotencia.validarChave(req.get('idempotency-key'));
    const corpo = req.body || {};
    exigirCanal(req, corpo.canal);
    const impressao = idempotencia.impressaoDoPedido(corpo);
    const appId = req.aplicacao.aplicacaoId;
    const resultado = db.transaction(() => {
      const registro = db.prepare('SELECT impressao, mensagem_id, criado_em FROM idempotencia WHERE aplicacao_id = ? AND chave = ?').get(appId, chave);
      const veredito = idempotencia.avaliar({ registro, impressao });
      if (veredito === 'conflito') throw erro('idempotencia_conflito', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
      if (veredito === 'repetido') return { repetido: true, m: repo.buscar(db, registro.mensagem_id) };
      if (registro) db.prepare('DELETE FROM idempotencia WHERE aplicacao_id = ? AND chave = ?').run(appId, chave); // venceu (24 h)
      const m = aceitarEnvio(db, {
        empresaId: req.aplicacao.empresaId, canalId: corpo.canal, para: corpo.para, tipo: corpo.tipo || 'texto', texto: corpo.texto,
        origem: 'api', aplicacaoId: appId, correlacaoId: req.get('x-correlation-id') || null, metadados: corpo.metadados ?? {},
      });
      db.prepare('INSERT INTO idempotencia (aplicacao_id, chave, impressao, mensagem_id, criado_em) VALUES (?, ?, ?, ?, ?)').run(appId, chave, impressao, m.id, agora());
      return { repetido: false, m };
    })();
    if (resultado.repetido) res.set('Idempotent-Replayed', 'true');
    else setImmediate(() => despachante?.acordar());
    res.status(202).json(respostaAceita(resultado.m));
  });

  r.get('/mensagens/:id', exigirEscopo('mensagens:ler'), (req, res) => {
    const m = repo.buscar(db, req.params.id);
    if (!m || m.empresa_id !== req.aplicacao.empresaId || m.direcao !== 'saida') throw erro('nao_encontrado', 'Mensagem não encontrada.');
    res.json(repo.paraV1(db, m));
  });

  r.get('/canais/:id/estado', exigirEscopo('canais:ler'), (req, res) => {
    exigirCanal(req, req.params.id);
    const c = db.prepare('SELECT id, estado, estado_desde, envio_modo FROM canais WHERE id = ?').get(req.params.id);
    if (!c) throw erro('nao_encontrado', 'Canal não encontrado.');
    res.json({ id: c.id, estado: c.estado, estado_desde: c.estado_desde, envio_habilitado: c.envio_modo !== 'desligado', envio_modo: c.envio_modo, capacidades: CAPACIDADES_ENVIO });
  });

  r.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasV1, CAPACIDADES_ENVIO, LIMITE_POR_MINUTO };

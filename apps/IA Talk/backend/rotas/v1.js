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
const midia = require('../lib/midia');
const armazem = require('../midias/armazem');
const { lerPaginacao, montarPagina } = require('../paginacao');
const repoAtd = require('../atendimento/repositorio');

const LIMITE_POR_MINUTO = 120;
// Sem "webhook" até a C4 entregar os avisos: hoje o estado se acompanha por GET /mensagens/:id.
const AVISO_ACEITA = 'Aceita para envio. Isto não confirma a entrega: acompanhe o estado em GET /mensagens/{id}.';

// O que o canal envia HOJE pelo Talk (arquivos chegam na próxima etapa): o integrador
// consulta isto e não recebe 422 de surpresa.
// Envio real (§10): imagem, documento e áudio; vídeo fica para depois.
const CAPACIDADES_ENVIO = Object.freeze({ ...CAPACIDADES_WWEB, video: false });
const STATUS_MIDIA = { arquivo_grande: 413, tipo_nao_suportado: 422 };

// Erro da biblioteca de mídia (G4) no formato do contrato.
function erroDaMidia(e) {
  if (e?.name !== 'ErroMidia') return e;
  if (e.codigo === 'arquivo_invalido') return erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { arquivo: e.message } });
  return erro(e.codigo, e.message, { status: STATUS_MIDIA[e.codigo] || 422 });
}

// Arquivo do pedido (§10.5): exatamente um entre base64 e url; baixado e conferido ANTES da transação.
// O tipo declarado tem de ser o tipo real do conteúdo.
async function arquivoDoPedido(corpo) {
  const tipo = corpo.tipo || 'texto';
  if (tipo === 'texto') return null;
  const a = corpo.arquivo;
  const invalido = (msg) => erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { arquivo: msg } });
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw invalido('Envie o arquivo (base64 ou url).');
  if (a.midia_id !== undefined) throw erro('recurso_nao_suportado', 'midia_id ainda não é aceito: envie base64 ou url.');
  const fontes = ['base64', 'url'].filter(k => a[k] !== undefined && a[k] !== null && a[k] !== '');
  if (fontes.length !== 1) throw invalido('Informe exatamente um entre base64 e url.');
  let r;
  try {
    r = fontes[0] === 'base64'
      ? { dados: midia.decodificarBase64Estrito(a.base64, armazem.MAX_BYTES), nome: null }
      : await midia.baixarUrlSegura(String(a.url), { limiteBytes: armazem.MAX_BYTES });
  } catch (e) { throw erroDaMidia(e); }
  const real = armazem.conferirArquivo(r.dados);
  if (real.tipo !== tipo) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { tipo: `O arquivo enviado é ${real.tipo}.` } });
  return { dados: r.dados, nome: armazem.nomeSeguro(a.nome || r.nome) };
}

function criarRotasV1({ db, despachante = null, atendimento = null, log = console }) {
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

  // A biblioteca (G8) usa o código interno 'validacao'; na API vale a tabela do contrato (requisicao_invalida).
  const chaveDoPedido = (req) => {
    try {
      return idempotencia.validarChave(req.get('idempotency-key'));
    } catch (e) {
      if (e.codigo === 'validacao') throw erro('requisicao_invalida', e.message, { campos: e.campos });
      throw e;
    }
  };

  r.post('/mensagens', exigirEscopo('mensagens:enviar'), (req, res, next) => enviarMensagem(req, res).catch(next));
  async function enviarMensagem(req, res) {
    const chave = chaveDoPedido(req);
    const corpo = req.body || {};
    exigirCanal(req, corpo.canal);
    const impressao = idempotencia.impressaoDoPedido(corpo);
    const appId = req.aplicacao.aplicacaoId;
    // Repetição idêntica não baixa o arquivo de novo (a transação confere outra vez).
    const anterior = db.prepare('SELECT impressao, mensagem_id, criado_em FROM idempotencia WHERE aplicacao_id = ? AND chave = ?').get(appId, chave);
    const arquivo = idempotencia.avaliar({ registro: anterior, impressao }) === 'repetido' ? null : await arquivoDoPedido(corpo);
    let guardada = null;
    const resultado = db.transaction(() => {
      const registro = db.prepare('SELECT impressao, mensagem_id, criado_em FROM idempotencia WHERE aplicacao_id = ? AND chave = ?').get(appId, chave);
      const veredito = idempotencia.avaliar({ registro, impressao });
      if (veredito === 'conflito') throw erro('idempotencia_conflito', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
      if (veredito === 'repetido') return { repetido: true, m: repo.buscar(db, registro.mensagem_id) };
      if (registro) db.prepare('DELETE FROM idempotencia WHERE aplicacao_id = ? AND chave = ?').run(appId, chave); // venceu (24 h)
      if (arquivo) guardada = armazem.guardar(db, { empresaId: req.aplicacao.empresaId, canalId: corpo.canal, direcao: 'saida', nome: arquivo.nome, dados: arquivo.dados });
      const m = aceitarEnvio(db, {
        empresaId: req.aplicacao.empresaId, canalId: corpo.canal, para: corpo.para, tipo: corpo.tipo || 'texto',
        texto: arquivo ? corpo.legenda : corpo.texto, midiaId: guardada?.id || null,
        origem: 'api', aplicacaoId: appId, correlacaoId: req.get('x-correlation-id') || null, metadados: corpo.metadados ?? {},
      });
      db.prepare('INSERT INTO idempotencia (aplicacao_id, chave, impressao, mensagem_id, criado_em) VALUES (?, ?, ?, ?, ?)').run(appId, chave, impressao, m.id, agora());
      return { repetido: false, m };
    });
    let saida;
    try { saida = resultado(); } catch (err) { if (guardada) armazem.descartar(guardada); throw err; } // a transação voltou: o arquivo também
    if (saida.repetido) res.set('Idempotent-Replayed', 'true');
    else setImmediate(() => despachante?.acordar());
    res.status(202).json(respostaAceita(saida.m));
  }

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

  // ── Sistema de origem (C9, contratos.md §8.9): chamado vira conversa; retornos até confirmar ──
  if (atendimento) {
    const conversaDaAplicacao = (req, id) => {
      const cv = repoAtd.buscarConversa(db, req.aplicacao.empresaId, id);
      const deles = cv && db.prepare('SELECT 1 FROM conversa_referencias WHERE conversa_id = ? AND aplicacao_id = ?').get(cv.id, req.aplicacao.aplicacaoId);
      if (!deles) throw erro('nao_encontrado', 'Conversa não encontrada.');
      return cv;
    };

    r.post('/conversas', exigirEscopo('conversas:criar'), (req, res) => {
      const { cv, resultado, mensagem_inicial: inicial } = atendimento.abrirPorChamado(req.aplicacao, req.body || {});
      const corpo = { ...repoAtd.paraConversaV1(db, cv, req.aplicacao.aplicacaoId), resultado, mensagem_inicial: inicial };
      if (resultado === 'existente') res.set('Idempotent-Replayed', 'true');
      res.status(resultado === 'criada' ? 201 : 200).json(corpo);
    });

    r.get('/conversas', exigirEscopo('conversas:ler'), (req, res) => {
      const { limite, cursor } = lerPaginacao(req.query);
      const p = { app: req.aplicacao.aplicacaoId, empresa: req.aplicacao.empresaId };
      const onde = ['cv.empresa_id = @empresa', 'EXISTS (SELECT 1 FROM conversa_referencias r WHERE r.conversa_id = cv.id AND r.aplicacao_id = @app'
        + (req.query.referencia ? ' AND r.sistema = @sistema AND r.ref_id = @ref)' : ')')];
      if (req.query.referencia) {
        const [sistema, ...resto] = String(req.query.referencia).split(':');
        p.sistema = sistema; p.ref = resto.join(':');
      }
      if (req.query.situacao) { onde.push('cv.situacao = @situacao'); p.situacao = String(req.query.situacao); }
      if (cursor) { onde.push('(cv.aberta_em < @ca OR (cv.aberta_em = @ca AND cv.id < @ci))'); p.ca = String(cursor.a); p.ci = String(cursor.i); }
      const linhas = db.prepare(`${repoAtd.SELECT_CONVERSA} WHERE ${onde.join(' AND ')} ORDER BY cv.aberta_em DESC, cv.id DESC LIMIT ${limite + 1}`).all(p);
      res.json(montarPagina(linhas.map(cv => repoAtd.paraConversaV1(db, cv, req.aplicacao.aplicacaoId)), {
        limite, cursorDoUltimo: (u) => ({ a: u.aberta_em, i: u.id }),
      }));
    });

    r.get('/conversas/:id', exigirEscopo('conversas:ler'), (req, res) => res.json(repoAtd.paraConversaV1(db, conversaDaAplicacao(req, req.params.id), req.aplicacao.aplicacaoId)));

    // Do mais antigo para o mais novo; o mesmo retorno volta até ser confirmado.
    r.get('/retornos', exigirEscopo('conversas:ler'), (req, res) => {
      const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
      const p = { app: req.aplicacao.aplicacaoId, desde: new Date(Date.now() - repoAtd.VALIDADE_RETORNO_MS).toISOString() };
      const tipo = req.query.tipo ? ' AND tipo = @tipo' : '';
      if (tipo) p.tipo = String(req.query.tipo);
      const linhas = db.prepare(`SELECT * FROM retornos WHERE aplicacao_id = @app AND confirmado_em IS NULL AND em >= @desde${tipo} ORDER BY em, id LIMIT ${limite + 1}`).all(p);
      res.json({ itens: linhas.slice(0, limite).map(x => repoAtd.paraRetornoV1(db, x)), tem_mais: linhas.length > limite });
    });

    r.post('/retornos/confirmar', exigirEscopo('conversas:ler'), (req, res) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(i => typeof i !== 'string')) {
        throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { ids: 'Envie de 1 a 200 ids de retorno.' } });
      }
      const confirmados = [];
      const desconhecidos = [];
      const achar = db.prepare('SELECT id FROM retornos WHERE id = ? AND aplicacao_id = ?');
      const marcar = db.prepare('UPDATE retornos SET confirmado_em = ? WHERE id = ? AND confirmado_em IS NULL');
      db.transaction(() => {
        for (const id of new Set(ids)) {
          if (!achar.get(id, req.aplicacao.aplicacaoId)) { desconhecidos.push(id); continue; }
          marcar.run(agora(), id); // confirmar de novo não muda nada
          confirmados.push(id);
        }
      })();
      res.json({ confirmados, desconhecidos });
    });
  }

  r.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasV1, CAPACIDADES_ENVIO, LIMITE_POR_MINUTO };

'use strict';

// Processo próprio do IA Talk (serviço NSSM "IAHub-Talk" na C7). Independe do
// index.js do IAHub: banco, porta, sessão e ciclo de vida próprios. Em
// produção fica atrás do nginx, que encaminha /app/ia-talk/ para cá.
//
//   node "apps/IA Talk/backend/servidor.js"        (porta IA_TALK_PORT, padrão 3050)
//
// C0 entrega só o esqueleto: telas estáticas, /api/saude e o formato de erro.
// As rotas de cada área entram nas etapas C1–C4 (docs/contratos.md).

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { erro, middlewareErros } = require('./erros');
const { carregarSessao, ipDe } = require('./acesso/middleware');
const { criarTransporteIaCommand, criarTransporteEmail } = require('./acesso/envio-codigo');
const { criarRotasPublicas, paginaDeErro } = require('./rotas/publico');
const { ROTINAS } = require('./acesso/papeis');
const { criarRotasAdmin } = require('./rotas/admin');
const { criarRotasCanais } = require('./rotas/canais');
const { SupervisorCanais } = require('./canais/supervisor');
const { Despachante } = require('./mensagens/despachante');
const { criarRotasMensagens } = require('./rotas/mensagens');
const { criarRotasV1 } = require('./rotas/v1');
const { criarRotasAtendimento } = require('./rotas/atendimento');
const { Atendimento } = require('./atendimento/servico');

const VERSAO = require('../package-versao.json').versao;

const SEM_CACHE = /\.(html|js|css)$/i;

function opcoesEstaticas() {
  return {
    etag: true,
    lastModified: true,
    index: false,
    setHeaders(res, arquivo) {
      if (SEM_CACHE.test(arquivo)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  };
}

function aplicarSegurancaHttp(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // nginx na mesma máquina
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        // Sites autorizados por empresa entram na C1 (mesmo conceito do IAHub).
        'frame-ancestors': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
}

// Telas, componentes visuais compartilhados e (opcional) protótipos.
function montarEstaticos(app, { comPrototipos = false } = {}) {
  const base = config.BASE_PATH;
  app.get([base, `${base}/`], (_req, res) => res.redirect(`${base}/shell.html`));
  app.use(`${base}/ui`, express.static(config.DIR_UI, opcoesEstaticas()));
  if (comPrototipos) app.use(`${base}/prototipos`, express.static(config.DIR_PROTOTIPOS, opcoesEstaticas()));
  app.use(base, express.static(config.DIR_FRONTEND, opcoesEstaticas()));
}

// Sites autorizados da empresa (mesmo conceito do IAHub): libera abrir as telas
// dela dentro de um iframe só nesses endereços. Empresa = do apelido na página
// de entrada ou da sessão; sem empresa identificável, só o próprio site.
function frameAncestorsPorEmpresa(db) {
  return (req, res, next) => {
    let empresaId = req.sessao?.empresa_id || null;
    const m = req.path.match(new RegExp(`^${config.BASE_PATH}/([a-z0-9-]{3,40})(?:/atendimento)?/?$`));
    if (m) empresaId = db.prepare("SELECT id FROM empresas WHERE apelido = ? AND situacao = 'ativa'").get(m[1])?.id || null;
    if (empresaId) {
      const s = db.prepare('SELECT origens FROM sites_autorizados WHERE empresa_id = ?').get(empresaId);
      const origens = s ? JSON.parse(s.origens) : [];
      const csp = res.getHeader('Content-Security-Policy');
      if (origens.length && csp) res.setHeader('Content-Security-Policy', String(csp).replace(/frame-ancestors [^;]*/, `frame-ancestors 'self' ${origens.join(' ')}`));
    }
    next();
  };
}

function montarPaginaEntrada(app, db) {
  // /app/ia-talk/<apelido> → frontend/entrar.html (G1). A tela lê o apelido do endereço.
  app.get(`${config.BASE_PATH}/:apelido([a-z0-9-]{3,40})`, (req, res) => {
    const arquivo = path.join(config.DIR_FRONTEND, 'entrar.html');
    if (!fs.existsSync(arquivo)) return res.status(404).type('text').send('Página de entrada ainda não entregue (etapa G1).');
    res.set('Cache-Control', 'no-cache, must-revalidate').sendFile(arquivo);
  });

  // Portal do atendente (§9.1): /app/ia-talk/<apelido>/atendimento → frontend/portal.html (G15).
  // Sem sessão desta empresa → login com destino de volta ao portal; sem a rotina do atendimento → aviso.
  if (!db) return;
  app.get(`${config.BASE_PATH}/:apelido([a-z0-9-]{3,40})/atendimento`, (req, res) => {
    const empresa = db.prepare("SELECT id, apelido FROM empresas WHERE apelido = ? AND situacao = 'ativa'").get(req.params.apelido);
    if (!empresa) return paginaDeErro(res, erro('nao_encontrado', 'Link de acesso não encontrado. Confira o endereço com a sua empresa.'));
    if (!req.sessao || req.sessao.empresa_id !== empresa.id) return res.redirect(`${config.BASE_PATH}/${empresa.apelido}?destino=atendimento`);
    if (!req.rotinas.includes(ROTINAS.atendimento)) {
      return paginaDeErro(res, erro('sem_permissao', 'Você ainda não tem acesso ao atendimento. Peça ao administrador da empresa para liberar.'));
    }
    const arquivo = path.join(config.DIR_FRONTEND, 'portal.html');
    if (!fs.existsSync(arquivo)) return res.status(404).type('text').send('Portal do atendente ainda não entregue (etapa G15).');
    res.set('Cache-Control', 'no-store').sendFile(arquivo);
  });
}

function criarApp({ db = null, log = console, transportes = null, chavePublicaHub, testarEmail, supervisor = null, despachante = null, atendimento = null } = {}) {
  const app = express();
  aplicarSegurancaHttp(app);
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipDe(req) || 'sem-ip', // sem a porta que o IIS anexa
    validate: { ip: false },
    handler: (_req, res) => res.status(429).json({ erro: { codigo: 'limite_excedido', mensagem: 'Muitas requisições. Tente de novo em instantes.' } }),
  }));
  app.use(express.json({ limit: '20mb' }));
  if (db) {
    app.use(carregarSessao(db));
    app.use(frameAncestorsPorEmpresa(db));
    const trans = transportes || { whatsapp: criarTransporteIaCommand(), email: criarTransporteEmail({ db }) };
    app.use(config.API_PUBLICA, criarRotasPublicas({ db, transportes: trans, log, ...(chavePublicaHub ? { chavePublicaHub } : {}) }));
    const sup = supervisor || new SupervisorCanais({ db, log });
    // Sem despachante (testes de rotas): a fila só grava; ninguém envia.
    const atd = atendimento || new Atendimento({ db, despachante, log });
    app.use(config.API_V1, criarRotasV1({ db, despachante, atendimento: atd, log }));
    app.use(config.API_ADMIN, criarRotasCanais({ db, supervisor: sup, despachante, log }));
    app.use(config.API_ADMIN, criarRotasMensagens({ db, despachante, log }));
    app.use(config.API_ADMIN, criarRotasAtendimento({ db, atendimento: atd, log }));
    app.use(config.API_ADMIN, criarRotasAdmin({ db, log, ...(testarEmail ? { testarEmail } : {}) }));
  }

  const api = express.Router();
  api.get('/saude', (req, res) => {
    let banco = 'nao_configurado';
    if (db) {
      try { db.prepare('SELECT 1').get(); banco = 'ok'; } catch (_) { banco = 'erro'; }
    }
    // Diagnóstico do proxy (IIS/nginx): ele precisa repassar o IP real do visitante em
    // X-Forwarded-For (limites de login e a proteção do envio interno dependem disso).
    // Mostra só o IP de quem está chamando — o próprio visitante.
    const viaProxy = !!req.headers['x-forwarded-for'];
    const ipVisto = ipDe(req) || '';
    const proxy = viaProxy ? 'ok' : (['127.0.0.1', '::1'].includes(ipVisto) ? 'sem_ip_real' : 'direto');
    res.json({ servico: 'ia-talk', versao: VERSAO, banco, proxy, seu_ip: ipVisto, em: new Date().toISOString() });
  });
  api.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  api.use(middlewareErros(log));
  app.use(`${config.BASE_PATH}/api`, api);

  montarEstaticos(app);
  montarPaginaEntrada(app, db);
  return app;
}

function iniciar({ porta = config.porta(), host = '127.0.0.1' } = {}) {
  // Mesmo .env do servidor (porta, chave mestra, segredo do envio interno pelo IA Command).
  require('dotenv').config({ path: path.join(config.RAIZ_REPO, '.env') });
  const { abrirBanco } = require('./database');
  const db = abrirBanco();
  // Canais: o supervisor avisa as telas pelo Socket.IO (criado logo abaixo).
  let emitir = () => {};
  const supervisor = new SupervisorCanais({ db, emitir: (...a) => emitir(...a) });
  // C3: fila de saída. Só envia o que foi pedido (API ou teste na tela); nunca responde sozinho.
  const despachante = new Despachante({ db, supervisor, emitir: (...a) => emitir(...a) });
  // C9: atendimento (conversas). Avisos pelo Socket.IO, só para quem pode ver cada conversa.
  let avisosAtd = null;
  const atendimento = new Atendimento({ db, despachante, iaCommand: require('./atendimento/ia-command').criarClienteIaCommand(),
    aoAviso: (canalId, texto) => supervisor.log(canalId, 'warning', texto),
    aoMudar: (...a) => avisosAtd?.aoMudar(...a), aoItem: (...a) => avisosAtd?.aoItem(...a), aoEstadoItem: (...a) => avisosAtd?.aoEstadoItem(...a) });
  supervisor.aoReceber = (canalId, m) => atendimento.receber(canalId, m);
  despachante.aoAvisar = (m) => atendimento.aoEstadoMensagem(m);
  const app = criarApp({ db, supervisor, despachante, atendimento });
  const servidor = http.createServer(app);
  const { Server } = require('socket.io');
  const io = new Server(servidor, { path: config.SOCKET_PATH });
  const tempoReal = require('./tempo-real');
  emitir = tempoReal.configurarTempoReal(io.of(config.SOCKET_NAMESPACE), { db, supervisor, atendimento });
  avisosAtd = tempoReal.avisosDoAtendimento(io.of(config.SOCKET_NAMESPACE), { db, atendimento });
  servidor.listen(porta, host, () => {
    console.log(`[IA Talk] ${VERSAO} em http://${host}:${porta}${config.BASE_PATH}/`);
    supervisor.iniciarTodos(); // religa os canais que estavam conectados
    despachante.iniciar();
    atendimento.iniciarBatimentos(); // número compartilhado: "estou vivo" para o IA Command
  });
  let saindo = false;
  const sair = async (sinal) => {
    if (saindo) return;
    saindo = true;
    console.log(`[IA Talk] ${sinal} recebido: encerrando (canais primeiro).`);
    setTimeout(() => process.exit(0), 20_000).unref();
    despachante.parar();
    atendimento.pararBatimentos();
    await supervisor.pararTodos().catch(() => {});
    io.close();
    servidor.close(() => { try { db.close(); } catch (_) { /* já fechado */ } process.exit(0); });
  };
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => sair(sinal));
  return { servidor, db };
}

module.exports = { criarApp, montarEstaticos, aplicarSegurancaHttp, opcoesEstaticas, iniciar };

if (require.main === module) iniciar();

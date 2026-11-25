'use strict';

// Processo próprio do IA Talk (serviço NSSM "IAHub-Talk" na C7). Independe do
// index.js do IAHub: banco, porta, sessão e ciclo de vida próprios. Em
// produção fica atrás do nginx, que encaminha /app/ia-talk/ para cá.
//
//   node "apps/IA Talk/backend/servidor.js"        (porta IA_TALK_PORT, padrão 3050)
//
// C0 entrega só o esqueleto: telas estáticas, /api/saude e o formato de erro.
// As rotas de cada área entram nas etapas C1–C4 (docs/contratos.md).

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { erro, middlewareErros } = require('./erros');

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

function criarApp({ db = null, log = console } = {}) {
  const app = express();
  aplicarSegurancaHttp(app);
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ erro: { codigo: 'limite_excedido', mensagem: 'Muitas requisições. Tente de novo em instantes.' } }),
  }));
  app.use(express.json({ limit: '20mb' }));

  const api = express.Router();
  api.get('/saude', (_req, res) => {
    let banco = 'nao_configurado';
    if (db) {
      try { db.prepare('SELECT 1').get(); banco = 'ok'; } catch (_) { banco = 'erro'; }
    }
    res.json({ servico: 'ia-talk', versao: VERSAO, banco, em: new Date().toISOString() });
  });
  api.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  api.use(middlewareErros(log));
  app.use(`${config.BASE_PATH}/api`, api);

  montarEstaticos(app);
  return app;
}

function iniciar({ porta = config.porta(), host = '127.0.0.1' } = {}) {
  const { abrirBanco } = require('./database');
  const db = abrirBanco();
  const app = criarApp({ db });
  const servidor = http.createServer(app);
  servidor.listen(porta, host, () => {
    console.log(`[IA Talk] ${VERSAO} em http://${host}:${porta}${config.BASE_PATH}/`);
  });
  const sair = (sinal) => {
    console.log(`[IA Talk] ${sinal} recebido: encerrando.`);
    servidor.close(() => { try { db.close(); } catch (_) { /* já fechado */ } process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => sair(sinal));
  return { servidor, db };
}

module.exports = { criarApp, montarEstaticos, aplicarSegurancaHttp, opcoesEstaticas, iniciar };

if (require.main === module) iniciar();

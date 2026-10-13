// Servidor de HOMOLOGACAO isolado para a feature de Avaliacao Humana.
// Usa o CODIGO REAL de producao (backend/routes/index.js,
// resposta-operacional-service.js, repositories/services novos, HTML real
// do frontend) servido contra uma COPIA do banco real (nunca o
// ia-service.db original). Stubs de requireAuth/requireIaService seguem
// exatamente o padrao ja usado nos testes automatizados HTTP do projeto
// (fase3-rotas-http.test.js, avaliacao-investigacao-rotas-http.test.js) --
// simula sessao autenticada sem depender do fluxo real de login por
// WhatsApp/senha, que exigiria interacao humana externa.

const path = require('path');
const express = require('express');

const RAIZ_PROJETO = 'c:/Apps/iahub';
const DB_COPIA = 'C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao/ia-service-copia.db';
const FRONTEND_IA_SERVICE_DIR = path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'frontend');
const FRONTEND_UI_CSS_DIR = path.join(RAIZ_PROJETO, 'packages', 'ui', 'frontend');

const database = require(path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'backend', 'database'));
database.inicializarDB(DB_COPIA);

const registrarRotas = require(path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'backend', 'routes'));

const PORT = Number(process.argv[2] || 4987);
const USUARIO_SESSAO_ID = Number(process.argv[3] || 1);
const EMPRESA_ID_PADRAO = Number(process.argv[4] || 1);

const app = express();
app.use(express.json());

// Sessao simulada -- mesmo padrao dos testes HTTP automatizados do projeto.
app.use((req, _res, next) => {
  req.session = { user_id: USUARIO_SESSAO_ID };
  next();
});

registrarRotas(app, {
  requireAuth: (req, _res, next) => next(),
  requireIaService: (req, _res, next) => {
    req.svcEmpresaId = Number(req.query?.empresa_id || 0);
    next();
  },
});

// Stub minimo (NAO o auth.js real -- esse depende de /api/me, /api/empresas/minhas
// etc, que exigem o boot completo do IAHub). So define o sinal que o
// frontend real do IA Service consome.
app.get('/js/auth.js', (_req, res) => {
  res.type('application/javascript').send(`
    window._iahubEmpresa = { id: ${EMPRESA_ID_PADRAO} };
    window._iahubAuthReady = Promise.resolve();
  `);
});

app.use('/css', express.static(path.join(FRONTEND_UI_CSS_DIR, 'css')));
app.use('/app/ia-service', express.static(FRONTEND_IA_SERVICE_DIR));
app.use('/app/ia-service/js', express.static(path.join(FRONTEND_IA_SERVICE_DIR, 'js')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[homologacao] servidor isolado ouvindo em http://127.0.0.1:${PORT} (banco copia: ${DB_COPIA})`);
});

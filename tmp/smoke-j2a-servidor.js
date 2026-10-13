// Servidor de homologacao ISOLADO para smoke test do J2A (Avaliacao Humana +
// Pre-avaliacao por IA + fix de scroll/polling). Usa copia do banco real
// (nunca o ia-service.db original), codigo de producao nao alterado por
// este script. Gera uma sessao externa real (mesmo mecanismo de
// svc_sessoes_externas usado pelo login por WhatsApp) sem depender do envio
// de OTP real.
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const RAIZ_PROJETO = 'C:/Apps/iahub';
const DB_COPIA = 'C:/Users/aless/AppData/Local/Temp/claude/c--Apps-iahub/40f02e42-f232-48d2-961f-359f7e031637/scratchpad/homolog-avaliacao/ia-service-copia2.db';

const database = require(path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'backend', 'database'));
database.inicializarDB(DB_COPIA);

const registrarRotasExterno = require(path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'backend', 'routes', 'externo-routes'));
const consultorRepo = require(path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'backend', 'repositories', 'consultor-repository'));

const PORT = Number(process.argv[2] || 4990);
const EMPRESA_ID = Number(process.argv[3] || 1);

const app = express();
app.use(express.json());

registrarRotasExterno(app);

const FRONTEND_J2A_DIR = path.join(RAIZ_PROJETO, 'apps', 'IA Service', 'frontend', 'j2a');
app.use('/iaservice/j2a/assets', express.static(path.join(FRONTEND_J2A_DIR, 'assets')));
app.get(['/iaservice/j2a', '/iaservice/j2a/acesso', '/iaservice/j2a/radar'], (_req, res) => {
  res.sendFile(path.join(FRONTEND_J2A_DIR, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  const db = database.getDB();
  let consultor = db.prepare('SELECT id FROM consultores WHERE empresa_id = ? LIMIT 1').get(EMPRESA_ID);
  if (!consultor) {
    consultor = consultorRepo.criarConsultor(EMPRESA_ID, { idSoftexpert: 'SMOKE-J2A-1', telefone: '5565999000001' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 4 * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), EMPRESA_ID, consultor.id,
    crypto.createHash('sha256').update(token).digest('hex'),
    expiraEm.toISOString(), agora.toISOString(), agora.toISOString(),
  );
  console.log(`[smoke-j2a] servidor em http://127.0.0.1:${PORT}/iaservice/j2a`);
  console.log(`[smoke-j2a] token de sessao externa: ${token}`);
  console.log(`[smoke-j2a] abrir no navegador e rodar no console: localStorage.setItem('svc_token_externo', '${token}'); location.reload();`);
});

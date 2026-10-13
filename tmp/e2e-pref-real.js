process.env.SVC_WHATSAPP_OTP_SECRET = 'x';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), express = require('express');
const tmpPlat = path.join(os.tmpdir(), 'e2e-plat-' + Date.now() + '.db');
const tmpSvc = path.join(os.tmpdir(), 'e2e-svc-' + Date.now() + '.db');
// Redireciona QUALQUER abertura do iahub-platform.db para um arquivo temporario novo.
const resolved = require.resolve('better-sqlite3');
const Real = require(resolved);
function Fake(p, o) { return new Real(String(p).endsWith('iahub-platform.db') ? tmpPlat : p, o); }
Object.assign(Fake, Real); Fake.prototype = Real.prototype;
require.cache[resolved].exports = Fake;

const database = require('../apps/IA Service/backend/database');
database.inicializarDB(tmpSvc);
const registrarPlatform = require('../apps/IAHUB/backend/platform-routes');
const registrarExterno = require('../apps/IA Service/backend/routes/externo-routes');
const login = require('../apps/IA Service/backend/services/login-externo-service');
const TEL = '5565996677865';
const noop = (_q, _s, n) => n();

(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { role: 'admin', empresa_id: 1, user_id: 1 }; next(); });
  registrarPlatform(app, { requireAuth: noop, requireAdmin: noop });
  registrarExterno(app);
  const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port;
  const api = async (m, u, b, h = {}) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };

  // Exatamente o que salvarIdentidade() do platform-config.html envia:
  const svc = { habilitado: true, papel: 'analista', usuarioIdIahub: null, idSoftexpert: '957', preAnaliseAutomatica: false };
  const p = await api('POST', '/api/iahub/platform/whatsapp-identities', { empresaId: 1, nome: 'Maria Eduarda', numero: TEL, ativo: true, observacoes: '', metadata: { tipo: 'analista', iaService: svc } });
  await api('PUT', `/api/iahub/platform/whatsapp-identities/${p.id}/roles`, { empresaId: 1, roles: [{ sistema: 'ia-service', modulo: 'chat-web', papel: 'analista', codigoIdentidade: '957', liberado: true, metadata: { usuarioIdIahub: null, idSoftexpert: '957', preAnaliseAutomatica: false } }] });

  const ver = async (rotulo, token) => {
    const r = await api('GET', '/api/ia-service-externo/radar/minhas-preferencias', null, { 'x-sessao-externa': token });
    console.log(rotulo, '=>', r.preAnaliseAutomatica === false ? 'MANUAL' : 'AUTOMATICA');
  };
  const entrar = () => { const i = login.iniciarLogin(TEL); const v = login.verificarLogin(i.challengeId, TEL, i.codigo); return v.token || login.escolherEmpresa(TEL, 1).token; };

  let t = entrar(); await ver('1) cadastro Manual, 1o login', t);
  await api('PUT', '/api/ia-service-externo/radar/minhas-preferencias', { preAnaliseAutomatica: true }, { 'x-sessao-externa': t });
  await ver('2) analista liga no chat', t);
  t = entrar(); await ver('3) sair e entrar de novo (cadastro continua Manual)', t);
  srv.close(); database.fecharDB();
  for (const f of [tmpPlat, tmpSvc]) for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {}
})().catch(e => { console.error(e); process.exit(1); });

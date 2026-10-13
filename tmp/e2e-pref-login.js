process.env.SVC_WHATSAPP_OTP_SECRET = 'x';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), express = require('express');
const dbp = path.join(os.tmpdir(), 'e2e-pref-' + Date.now() + '.db');
const database = require('../apps/IA Service/backend/database');
database.inicializarDB(dbp);
const platformStore = require('../apps/IAHUB/backend/platform-store');
const login = require('../apps/IA Service/backend/services/login-externo-service');
const registrar = require('../apps/IA Service/backend/routes/externo-routes');
const TEL = '5565996677865';
const item = (pre, extra = {}) => ({ platformIdentityId: 'ident-1', empresaId: 1, telefone: TEL, ativo: true, usuarioIdIahub: null, idSoftexpert: '957', preAnaliseAutomatica: pre, atualizadoEm: new Date().toISOString(), ...extra });
async function prefs(base, token) {
  const r = await fetch(base + '/api/ia-service-externo/radar/minhas-preferencias', { headers: { 'x-sessao-externa': token } });
  return (await r.json()).preAnaliseAutomatica;
}
(async () => {
  const app = express(); app.use(express.json()); registrar(app);
  const srv = await new Promise(r => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port;
  async function entrar() {
    const ini = login.iniciarLogin(TEL);
    const ver = login.verificarLogin(ini.challengeId, TEL, ini.codigo);
    return ver.token || login.escolherEmpresa(TEL, 1).token;
  }
  const out = [];
  platformStore.listarIaServicePorTelefone = () => [item(false)];
  let t = await entrar(); out.push(['A) Platform Manual, 1 vinculo -> chat', await prefs(base, t)]);
  platformStore.listarIaServicePorTelefone = () => [item(false), item(true, { platformIdentityId: 'ident-1' })];
  t = await entrar(); out.push(['B) Platform com 2 vinculos (Manual + Automatico) -> chat', await prefs(base, t)]);
  platformStore.listarIaServicePorTelefone = () => [item(true), item(false)];
  t = await entrar(); out.push(['B2) mesmos 2 vinculos em outra ordem -> chat', await prefs(base, t)]);
  for (const [k, v] of out) console.log(k, '=>', v === false ? 'MANUAL' : 'AUTOMATICA');
  srv.close(); database.fecharDB(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbp + s); } catch (_) {}
})().catch(e => { console.error(e); process.exit(1); });

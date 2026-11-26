// Entrada no IA Talk pelo card do IAHub. O IA Talk é um processo separado (não
// compartilha a sessão do Hub): aqui o Hub confere a permissão e assina um
// ticket Ed25519 de 60 s, de uso único; o Talk confere com a chave pública e
// cria a própria sessão (apps/IA Talk/backend/acesso/ticket-hub.js).
//
// Par de chaves gerado uma única vez em apps/IAHUB/data/ia-talk/ (fora do git).
// O Talk lê ticket-publica.pem; a privada nunca sai do Hub.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const iahubData = require('./data-paths');
const sistemasDb = require('./sistemas/database');
const usuariosDb = require('./usuarios/database');
const empresasDb = require('./empresas/database');
const permissoesDb = require('./permissoes/database');

const VALIDADE_SEG = 60;

function pastaChaves() {
  return iahubData.appDataDir('ia-talk');
}

function carregarOuCriarChaves(dir = pastaChaves()) {
  const privada = path.join(dir, 'ticket-privada.pem');
  const publica = path.join(dir, 'ticket-publica.pem');
  if (!fs.existsSync(privada) || !fs.existsSync(publica)) {
    fs.mkdirSync(dir, { recursive: true });
    const par = crypto.generateKeyPairSync('ed25519');
    try {
      fs.writeFileSync(privada, par.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(publica, par.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'w' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err; // outro processo criou antes: usa o dele
    }
  }
  return crypto.createPrivateKey(fs.readFileSync(privada, 'utf8'));
}

// rotinas: as rotinas talk-* liberadas na IA Gestão (Usuários › Permissões) para
// este usuário nesta empresa; null = administrador do IAHub (todas).
function assinarTicket({ usuario, empresa, rotinas = null }, { chavePrivada, agoraSeg = Math.floor(Date.now() / 1000) }) {
  const payload = {
    v: 1,
    jti: crypto.randomBytes(16).toString('base64url'),
    iat: agoraSeg,
    exp: agoraSeg + VALIDADE_SEG,
    usuario: { id: String(usuario.id), nome: usuario.nome || usuario.usuario || '', email: usuario.email || null, celular: usuario.celular || null, admin: usuario.role === 'admin' },
    empresa: { id: Number(empresa.id), nome: empresa.razao_social || empresa.nome || '' },
    rotinas: usuario.role === 'admin' ? null : (Array.isArray(rotinas) ? rotinas.filter(r => String(r).startsWith('talk-')) : []),
  };
  const corpo = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${corpo.toString('base64url')}.${crypto.sign(null, corpo, chavePrivada).toString('base64url')}`;
}

// Endereço do IA Talk: em produção o nginx encaminha /app/ia-talk/; em
// desenvolvimento IA_TALK_URL aponta o processo local (ex.: http://127.0.0.1:3050/app/ia-talk/).
function baseTalk() {
  return String(process.env.IA_TALK_URL || '/app/ia-talk/').replace(/\/+$/, '');
}

function registrar(app, { requireAuth }) {
  app.get('/api/ia-talk/entrar', requireAuth, (req, res) => {
    const empresaId = Number(req.session.empresa_id || 0);
    // Mesmo padrão de aviso da tela de sistemas (sessionStorage _iahub_aviso, lido pelo auth.js).
    const voltar = (msg) => res.status(403).type('html').send(
      `<!DOCTYPE html><meta charset="utf-8"><script>sessionStorage.setItem('_iahub_aviso', ${JSON.stringify(msg).replace(/</g, '\\u003c')});location.replace('/iahub.html');</script>`);
    if (!empresaId) return voltar('Selecione uma empresa antes de abrir o IA Talk.');
    if (!sistemasDb.hasUserSystem(req.session.user_id, empresaId, 'ia-talk')) return voltar('O IA Talk não está liberado para você nesta empresa.');
    const usuario = usuariosDb.buscarPorId(req.session.user_id);
    const empresa = empresasDb.buscarPorId(empresaId);
    if (!usuario || !empresa) return voltar('Não foi possível identificar o usuário ou a empresa.');
    const rotinas = permissoesDb.getRotinas(req.session.user_id, empresaId) || [];
    const ticket = assinarTicket({ usuario: { ...usuario, role: req.session.role || usuario.role }, empresa, rotinas }, { chavePrivada: carregarOuCriarChaves() });
    res.set('Cache-Control', 'no-store');
    res.redirect(`${baseTalk()}/api/publico/entrar-hub?ticket=${encodeURIComponent(ticket)}`);
  });
}

module.exports = { registrar, assinarTicket, carregarOuCriarChaves, VALIDADE_SEG };

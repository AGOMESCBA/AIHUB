const WhatsAppService     = require('./service');
const MetaWhatsAppService = require('./service-meta');
const db                  = require('./database');
const { APP_DATA_DIR, ensureAppDataDir } = require('../data-paths');

const instances = new Map(); // empresaId (Number) → service instance

function _create(empresaId) {
  const useMeta = db.getConfig(Number(empresaId), 'meta_wa_ativo') === 'true';
  return useMeta ? new MetaWhatsAppService() : new WhatsAppService();
}

// Se o serviço está parado (ou não existe), recria para pegar config mais recente.
// Se está rodando, retorna a instância atual.
function getOrCreate(empresaId) {
  const id  = Number(empresaId);
  const cur = instances.get(id);
  if (cur && cur.getStatus() !== 'stopped') return cur;
  const svc = _create(id);
  instances.set(id, svc);
  return svc;
}

function get(empresaId) {
  if (!empresaId) return null;
  return instances.get(Number(empresaId)) || null;
}

function getAll() {
  return instances;
}

// Encontra o empresaId cujo phone_number_id Meta bate com o parâmetro.
// Usado para rotear webhooks Meta para a empresa correta.
function findByMetaPhoneId(phoneNumberId) {
  const fs   = require('fs');
  const dir  = APP_DATA_DIR;
  ensureAppDataDir();
  if (!fs.existsSync(dir)) return null;

  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^empresa_(\d+)\.json$/);
    if (!m) continue;
    const eid = Number(m[1]);
    if (db.getConfig(eid, 'meta_wa_phone_id') === String(phoneNumberId)) return eid;
  }
  return null;
}

// Encontra o empresaId que possui o webhook_token informado.
// Usado na verificação do webhook Meta (GET).
function findByMetaWebhookToken(token) {
  const fs   = require('fs');
  const dir  = APP_DATA_DIR;
  ensureAppDataDir();
  if (!fs.existsSync(dir)) return null;

  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^empresa_(\d+)\.json$/);
    if (!m) continue;
    const eid = Number(m[1]);
    if (db.getConfig(eid, 'meta_wa_webhook_token') === String(token)) return eid;
  }
  return null;
}

module.exports = { getOrCreate, get, getAll, findByMetaPhoneId, findByMetaWebhookToken };

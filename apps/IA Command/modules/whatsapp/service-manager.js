const IACWhatsAppService = require('./service');

const instances = new Map(); // empresaId (Number) → IACWhatsAppService

function getOrCreate(empresaId) {
  const id  = Number(empresaId);
  const cur = instances.get(id);
  if (cur && cur.getStatus() !== 'stopped') return cur;
  const svc = new IACWhatsAppService();
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

module.exports = { getOrCreate, get, getAll };

const WhatsAppService = require('./service');

const instances = new Map(); // empresaId (Number) → WhatsAppService

function getOrCreate(empresaId) {
  const id = Number(empresaId);
  if (!instances.has(id)) instances.set(id, new WhatsAppService());
  return instances.get(id);
}

function get(empresaId) {
  if (!empresaId) return null;
  return instances.get(Number(empresaId)) || null;
}

function getAll() {
  return instances;
}

module.exports = { getOrCreate, get, getAll };

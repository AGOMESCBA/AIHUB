const IACWhatsAppService = require('./service');
const channels = require('./channel-store');

const instances = new Map(); // channelId (String) -> IACWhatsAppService

function getOrCreate(channelOrEmpresa) {
  const id  = String(channelOrEmpresa);
  const cur = instances.get(id);
  if (cur && cur.getStatus() !== 'stopped') return cur;
  const svc = new IACWhatsAppService();
  instances.set(id, svc);
  return svc;
}

function get(channelOrEmpresa) {
  if (!channelOrEmpresa) return null;
  const key = String(channelOrEmpresa);
  if (instances.has(key)) return instances.get(key);

  // Compatibilidade: chamadas antigas passam empresa_id.
  const empresaId = Number(channelOrEmpresa);
  if (empresaId) {
    const canal = channels.getDefaultForEmpresa(empresaId);
    if (canal) return instances.get(String(canal.id)) || null;
  }
  return null;
}

function getAll() {
  return instances;
}

module.exports = { getOrCreate, get, getAll };

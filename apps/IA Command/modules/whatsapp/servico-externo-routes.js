// Envio de WhatsApp server-to-server para outros apps do IAHub (ex.: IA
// Service, login externo por telefone/OTP). Arquivo NOVO e ISOLADO — não
// edita whatsapp/routes.js, whatsapp/service.js nem whatsapp/service-manager.js.
//
// IMPORTANTE: precisa ser registrado ANTES do app.use('/api/ia-command',
// requireAuth, ...) em modules/routes.js — mesmo motivo documentado ali para
// protheus_whatsapp/routes.js: é chamado servidor-a-servidor, sem sessão de
// usuário do IAHub. Autenticação própria via segredo compartilhado
// (IAC_WHATSAPP_SERVICO_EXTERNO_SECRET), comparação com timingSafeEqual
// (mesmo padrão de x-protheus-secret em protheus_whatsapp/routes.js).
//
// Só LÊ funções que já existiam antes deste arquivo
// (channels.getDefaultForEmpresa, service-manager.get, svc.sendMessage) —
// nunca as altera.

const crypto = require('crypto');
const channels = require('./channel-store');

let manager;
function getManager() {
  if (!manager) manager = require('./service-manager');
  return manager;
}

module.exports = function registrarRotaServicoExterno(app) {
  app.post('/api/ia-command/whatsapp/enviar-servico-externo', (req, res) => {
    const segredoEsperado = String(process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET || '').trim();
    if (!segredoEsperado) {
      return res.status(503).json({ error: 'Envio server-to-server não configurado.' });
    }
    const informado = Buffer.from(String(req.headers['x-servico-externo-secret'] || ''), 'utf8');
    const esperado = Buffer.from(segredoEsperado, 'utf8');
    const autenticado = informado.length === esperado.length && crypto.timingSafeEqual(informado, esperado);
    if (!autenticado) {
      return res.status(403).json({ error: 'Não autorizado.' });
    }

    const empresaId = Number(req.body?.empresaId || 0);
    const numero = String(req.body?.numero || '').trim();
    const texto = String(req.body?.texto || '').trim();
    if (!empresaId || !numero || !texto) {
      return res.status(400).json({ error: 'empresaId, numero e texto são obrigatórios.' });
    }

    const channel = channels.getDefaultForEmpresa(empresaId);
    if (!channel) return res.status(404).json({ error: 'Nenhum canal WhatsApp vinculado a esta empresa.' });
    const svc = getManager().get(channel.id);
    if (!svc || svc.getStatus() !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp não está conectado para esta empresa.' });
    }

    svc.sendMessage(numero, texto)
      .then(() => res.json({ ok: true }))
      .catch(err => res.status(500).json({ error: err.message }));
  });
};

// Rotas PÚBLICAS de login externo por telefone/WhatsApp — fora de
// requireAuth/requireEmpresaContext, propositalmente (é para quem ainda não
// tem sessão do IA HUB). Modelo replicado de
// apps/IA Command/modules/protheus_whatsapp/routes.js (webLoginRoutes), sem
// depender de nenhum módulo do IA Command em runtime — a única integração
// com o IA Command é uma chamada HTTP para a rota isolada
// POST /api/ia-command/whatsapp/enviar-servico-externo (ver Frente A do
// plano), autenticada por segredo compartilhado.

const rateLimit = require('express-rate-limit');
const crud = require('../../../IAHUB/backend/crud');
const loginExternoService = require('../services/login-externo-service');

// Mesmo padrão de rate-limit reforçado já usado em /api/login (index.js) —
// 15 minutos / 20 tentativas por IP. Rota pública sem sessão, alvo natural
// de força bruta de telefone/código.
const rateLimitLoginExterno = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
});

function _slugify(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _resolverEmpresaPorSlug(slug) {
  const empresas = crud.listar('empresas');
  return empresas.find(e => _slugify(e.razao_social || e.nome) === String(slug || '').toLowerCase()) || null;
}

async function _enviarCodigoViaWhatsApp({ empresaId, numero, codigo }) {
  const secret = process.env.SVC_WHATSAPP_OTP_SECRET;
  if (!secret) throw new Error('Envio de código não configurado (SVC_WHATSAPP_OTP_SECRET ausente).');

  const texto = [
    '🔐 IA Service - acesso ao chat',
    '',
    'Recebemos uma tentativa de entrada usando este WhatsApp.',
    `O código expira em 5 minuto(s).`,
    '',
    '⚠️ Se você não solicitou este acesso, ignore a próxima mensagem.',
    'Nunca compartilhe seu código com terceiros.',
  ].join('\n');

  const base = process.env.IA_COMMAND_INTERNAL_URL || 'http://127.0.0.1:' + (process.env.PORT || 3000);

  const enviar = async (corpo) => {
    const r = await fetch(`${base}/api/ia-command/whatsapp/enviar-servico-externo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-servico-externo-secret': secret },
      body: JSON.stringify({ empresaId, numero, texto: corpo }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `Falha ao enviar código (HTTP ${r.status}).`);
    }
  };

  await enviar(texto);
  await enviar(codigo);
}

module.exports = function registrarRotasLoginExterno(app) {
  // Path '/entrar/:slug' já é usado pelo IA Command (webLoginRoutes em
  // protheus_whatsapp/routes.js, carregado antes do IA Service no bootstrap
  // do IAHub) — colisão real confirmada em teste (a rota do IA Command
  // intercepta primeiro e responde 404 antes de chegar aqui). Usa um
  // namespace próprio para nunca colidir com rotas públicas de outro app.
  app.get('/entrar-servico/:empresaSlug', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const empresa = _resolverEmpresaPorSlug(req.params.empresaSlug);
    if (!empresa) return res.status(404).send('Not found');
    res.sendFile(require('path').join(__dirname, '..', '..', 'frontend', 'entrar.html'));
  });

  // Identidade visual pública (nome + logomarca) para a tela de login
  // externo — reaproveita empresas.login_logo_url, o mesmo campo já usado
  // na tela de login principal do IAHub (apps/IAHUB/frontend/login.html).
  // Só expõe o estritamente necessário para render (nunca dados de
  // usuário/CNPJ/etc.) — rota pública por natureza, sem sessão.
  app.get('/api/ia-service-publico/empresa/:empresaSlug', (req, res) => {
    const empresa = _resolverEmpresaPorSlug(req.params.empresaSlug);
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json({
      nome: empresa.razao_social || empresa.nome || null,
      logoUrl: empresa.login_logo_url || null,
    });
  });

  // Serve radar.html FORA de mountStaticDirs('/app/ia-service', requireIaService, ...)
  // — requireIaService sempre exige req.session.authenticated (ver
  // apps/IAHUB/backend/sistemas/access.js), o que uma sessão externa nunca
  // tem. Servir o HTML aqui não expõe nada sensível por si só: todo dado
  // real (fila, mensagens) só chega pelas chamadas a /api/ia-service-externo/*,
  // que exigem e validam o token x-sessao-externa a cada request.
  app.get('/radar-externo', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(require('path').join(__dirname, '..', '..', 'frontend', 'radar.html'));
  });

  app.post('/api/ia-service-publico/login/iniciar', rateLimitLoginExterno, async (req, res) => {
    let resultado;
    try {
      const empresa = _resolverEmpresaPorSlug(req.body?.empresaSlug);
      if (!empresa) return res.status(404).json({ error: 'Número não encontrado ou sem permissão sincronizada.' });

      // Passo 1 — localizar o consultor pelo telefone: erro aqui SEMPRE
      // genérico (nunca revela se o número existe, mesma cautela do IA
      // Command). Passo 2 (envio do WhatsApp) é tratado em bloco separado
      // abaixo, com mensagem distinta — falha de infraestrutura (ex.:
      // WhatsApp do IA Command desconectado) não é a mesma coisa que
      // "telefone não cadastrado", e confundir as duas mensagens (bug
      // encontrado em 2026-09) faz o consultor achar que digitou o número
      // errado quando na verdade é o WhatsApp do IA Command que está fora
      // do ar — nada que ele possa corrigir sozinho.
      try {
        resultado = loginExternoService.iniciarLogin(empresa.id, req.body?.telefone);
      } catch (err) {
        console.error('[IA Service][login-externo] telefone não localizado:', err.message);
        return res.status(404).json({ error: 'Número não encontrado ou sem permissão sincronizada.' });
      }

      try {
        await _enviarCodigoViaWhatsApp({ empresaId: empresa.id, numero: resultado.telefone, codigo: resultado.codigo });
      } catch (err) {
        console.error('[IA Service][login-externo] envio do código falhou:', err.message);
        return res.status(503).json({ error: 'Não foi possível enviar o código agora — o WhatsApp de atendimento está indisponível. Tente novamente em instantes ou contate o administrador.' });
      }

      res.json({
        ok: true,
        challengeId: resultado.challengeId,
        expiraEm: resultado.expiraEm,
        destino: resultado.telefone.replace(/^(\d{2})(\d{2})(.*)$/, '+$1 $2 *****-$3').slice(0, 24),
      });
    } catch (err) {
      console.error('[IA Service][login-externo] iniciar falhou:', err.message);
      res.status(500).json({ error: 'Não foi possível iniciar o login agora. Tente novamente em instantes.' });
    }
  });

  app.post('/api/ia-service-publico/login/verificar', rateLimitLoginExterno, (req, res) => {
    try {
      const empresa = _resolverEmpresaPorSlug(req.body?.empresaSlug);
      if (!empresa) return res.status(404).json({ error: 'Número não encontrado ou sem permissão sincronizada.' });

      const resultado = loginExternoService.verificarLogin(empresa.id, req.body?.challengeId, req.body?.telefone, req.body?.codigo);
      res.json({ ok: true, token: resultado.token, expiraEm: resultado.expiraEm });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};

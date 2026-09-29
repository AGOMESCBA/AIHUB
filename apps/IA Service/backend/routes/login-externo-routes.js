// Rotas PÚBLICAS de login externo por telefone/WhatsApp — fora de
// requireAuth/requireEmpresaContext, propositalmente (é para quem ainda não
// tem sessão do IA HUB). Modelo replicado de
// apps/IA Command/modules/protheus_whatsapp/routes.js (webLoginRoutes), sem
// depender de nenhum módulo do IA Command em runtime — a única integração
// com o IA Command é uma chamada HTTP para a rota isolada
// POST /api/ia-command/whatsapp/enviar-servico-externo (ver Frente A do
// plano), autenticada por segredo compartilhado.
//
// 2026-09: login deixou de exigir a empresa na URL (/entrar-servico/:slug)
// — agora é só telefone (/entrar-servico), igual à mecânica de
// resolverEmpresaDoCanal() do IA Command: o telefone pode estar vinculado a
// mais de uma empresa, resolvido em login-externo-service.js.

const rateLimit = require('express-rate-limit');
const loginExternoService = require('../services/login-externo-service');
const aiConfigRepo = require('../repositories/ai-config-repository');
const crud = require('../../../IAHUB/backend/crud');

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
  //
  // 2026-09: sem mais :empresaSlug — login é só por telefone (a empresa é
  // descoberta depois do OTP, ver login-externo-service.listarEmpresasDoTelefone).
  // Sem empresa conhecida de antemão, não há mais logomarca fixa nesta tela
  // (removida a rota /api/ia-service-publico/empresa/:slug — sem uso).
  app.get('/entrar-servico', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(require('path').join(__dirname, '..', '..', 'frontend', 'entrar.html'));
  });

  // Apelido de URL por empresa (2026-09, pedido do usuário — mesmo padrão
  // do IA Command, protheus_web_login_path em ai_config): SÓ atalho visual
  // e de identidade (pré-mostra logo/nome da empresa na tela, ver rota
  // /api/ia-service-publico/empresa-por-apelido abaixo) — serve o MESMO
  // entrar.html, o login continua 100% por telefone. Um apelido
  // desconhecido cai no 404 (não existe "empresa errada" aqui, é só uma
  // etiqueta opcional).
  app.get('/entrar-servico/:apelido', (req, res) => {
    const config = aiConfigRepo.getConfigPorApelido(req.params.apelido);
    if (!config) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(require('path').join(__dirname, '..', '..', 'frontend', 'entrar.html'));
  });

  // Identidade visual pública (nome + logomarca) a partir do apelido —
  // reaproveita empresas.login_logo_url, mesmo campo da tela de login
  // principal do IAHub. Só expõe o estritamente necessário para render.
  app.get('/api/ia-service-publico/empresa-por-apelido/:apelido', (req, res) => {
    const config = aiConfigRepo.getConfigPorApelido(req.params.apelido);
    if (!config) return res.status(404).json({ error: 'Apelido não encontrado.' });
    const empresa = crud.buscarPorId('empresas', config.empresaId);
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
      // Passo 1 — localizar o(s) consultor(es) pelo telefone, em QUALQUER
      // empresa: erro aqui SEMPRE genérico (nunca revela se o número
      // existe, mesma cautela do IA Command). Passo 2 (envio do WhatsApp) é
      // tratado em bloco separado abaixo, com mensagem distinta — falha de
      // infraestrutura (ex.: WhatsApp do IA Command desconectado) não é a
      // mesma coisa que "telefone não cadastrado", e confundir as duas
      // mensagens (bug encontrado em 2026-09) faz o consultor achar que
      // digitou o número errado quando na verdade é o WhatsApp do IA
      // Command que está fora do ar — nada que ele possa corrigir sozinho.
      try {
        resultado = loginExternoService.iniciarLogin(req.body?.telefone);
      } catch (err) {
        console.error('[IA Service][login-externo] telefone não localizado:', err.message);
        return res.status(404).json({ error: 'Número não encontrado ou sem permissão sincronizada.' });
      }

      // Qualquer empresa candidata serve para resolver o CANAL remetente do
      // WhatsApp — o destinatário (resultado.telefone) é sempre o mesmo,
      // independente de qual empresa dispara o envio.
      const empresas = loginExternoService.listarEmpresasDoTelefone(resultado.telefone);
      try {
        await _enviarCodigoViaWhatsApp({ empresaId: empresas[0].id, numero: resultado.telefone, codigo: resultado.codigo });
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
      const resultado = loginExternoService.verificarLogin(req.body?.challengeId, req.body?.telefone, req.body?.codigo);
      if (resultado.escolhaEmpresa) {
        return res.json({ ok: true, escolhaEmpresa: true, empresas: resultado.empresas });
      }
      res.json({ ok: true, escolhaEmpresa: false, token: resultado.token, expiraEm: resultado.expiraEm });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Terceiro passo, só quando /verificar retornou escolhaEmpresa:true — o
  // telefone já foi validado pelo OTP, aqui só falta saber qual das N
  // empresas o consultor quer acessar agora (sem pedir novo código).
  app.post('/api/ia-service-publico/login/escolher-empresa', rateLimitLoginExterno, (req, res) => {
    try {
      const resultado = loginExternoService.escolherEmpresa(req.body?.telefone, req.body?.empresaId);
      res.json({ ok: true, token: resultado.token, expiraEm: resultado.expiraEm });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};

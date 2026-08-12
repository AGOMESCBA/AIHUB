// Rotas do canal Protheus WhatsApp.
//
// A rota de emissao de token e chamada pela rotina ADVPL do Protheus (servidor-a-
// servidor, sem sessao de usuario do IAHub) e por isso precisa ser registrada
// ANTES do app.use que aplica requireAuth a todo /api/ia-command/* — mesmo padrao
// ja usado em modules/routes.js para o worker-event do WhatsApp. Autenticacao via
// header de segredo compartilhado (IAC_PROTHEUS_CHAT_SECRET), nao via sessao.
//
// As demais rotas (mensagem, sessoes) sao chamadas pelo navegador embutido
// (TWebEngine) e se autenticam com o token de sessao emitido aqui — tambem sem
// sessao de usuario do IAHub, entao ficam no mesmo grupo "publico" deste arquivo.

const path = require('path');
const tokenService = require('./token-service');
const sessionStore = require('./session-store');
const chatService = require('./service');

const PROTHEUS_SECRET = process.env.IAC_PROTHEUS_CHAT_SECRET || '';

function requireTokenSessao(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const sessao = tokenService.validar(token);
  if (!sessao) return res.status(401).json({ error: 'Sessao invalida ou expirada.' });
  req.protheusChat = sessao;
  next();
}

module.exports = function registrarRotasProtheusWhatsApp(app) {
  // ── Emissao de token (chamada pelo Protheus/ADVPL, sem sessao de usuario) ──
  app.post('/api/ia-command/protheus/token', (req, res) => {
    if (PROTHEUS_SECRET && req.headers['x-protheus-secret'] !== PROTHEUS_SECRET) {
      return res.status(401).json({ error: 'Credencial invalida.' });
    }
    const { empresaId, celular, filial } = req.body || {};
    if (!empresaId || !celular) {
      return res.status(400).json({ error: 'empresaId e celular sao obrigatorios.' });
    }
    try {
      const { token, expiraEm } = tokenService.emitir({ empresaId, celular, filial });
      res.json({ token, expiraEm });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pagina do chat (servida como estatico, sem auth de sessao IAHub) ──
  app.get('/api/ia-command/protheus/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'protheus-chat.html'));
  });

  // ── Envio de mensagem ──
  app.post('/api/ia-command/protheus/mensagem', requireTokenSessao, async (req, res) => {
    const { texto, sessaoId } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(400).json({ error: 'texto obrigatorio.' });
    }
    try {
      const { empresaId, celular } = req.protheusChat;
      const sid = sessaoId || sessionStore.criarSessao({ empresaId, celular });
      const resultado = await chatService.processarMensagem({
        empresaId, celular, sessaoId: sid, texto: String(texto).trim(),
      });
      res.json({ sessaoId: sid, resposta: resultado, criadoEm: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sessoes (sidebar) ──
  app.get('/api/ia-command/protheus/sessoes', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      res.json(sessionStore.listarSessoes({ empresaId, celular }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/sessoes', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      const sessaoId = sessionStore.criarSessao({ empresaId, celular });
      res.json({ sessaoId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ia-command/protheus/sessoes/:id', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      const excluida = sessionStore.excluirSessao({ sessaoId: req.params.id, empresaId, celular });
      if (!excluida) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Exclusao de mensagens especificas (selecao multipla, estilo WhatsApp) ──
  app.post('/api/ia-command/protheus/sessoes/:id/mensagens/excluir', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    const { mensagemIds } = req.body || {};
    if (!Array.isArray(mensagemIds) || !mensagemIds.length) {
      return res.status(400).json({ error: 'mensagemIds e obrigatorio (array nao vazio).' });
    }
    try {
      const removidas = sessionStore.excluirMensagens({
        sessaoId: req.params.id, empresaId, celular, mensagemIds,
      });
      res.json({ ok: true, removidas });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/sessoes/:id/mensagens', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    const cursor = req.query.cursor || null;
    try {
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      res.json(sessionStore.listarMensagens({ sessaoId: req.params.id, cursor }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Ultima resposta tabular da sessao — alimenta a aba Relatorio ──
  app.get('/api/ia-command/protheus/sessoes/:id/relatorio', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const relatorio = sessionStore.ultimaMensagemTabular({ sessaoId: req.params.id });
      res.json(relatorio); // null se nao houver dados tabulares ainda
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Salvar config de grid (agrupamento/filtros) escolhida pelo usuario ──
  app.put('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/grid-config', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const ok = sessionStore.salvarGridConfig({
        mensagemId: req.params.mensagemId,
        sessaoId: req.params.id,
        gridConfig: req.body || {},
      });
      if (!ok) return res.status(404).json({ error: 'Mensagem nao encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Reset de memoria — esquece o contexto da conversa sem apagar o historico ──
  app.post('/api/ia-command/protheus/sessoes/:id/resetar-memoria', requireTokenSessao, (req, res) => {
    const { empresaId, celular } = req.protheusChat;
    try {
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const resetadoEm = sessionStore.resetarMemoria({ sessaoId: req.params.id });
      res.json({ ok: true, resetadoEm });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

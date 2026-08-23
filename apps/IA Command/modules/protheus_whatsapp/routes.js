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
const { getDB } = require('../database');

const PROTHEUS_SECRET = process.env.IAC_PROTHEUS_CHAT_SECRET || '';
const LAUNCH_TICKET_TTL_MS = 5 * 60 * 1000;

function perfLog(etapa, inicio, dados = {}) {
  const duracaoMs = Date.now() - inicio;
  console.log(`[protheus_whatsapp][perf] ${new Date().toISOString()} ${etapa} ${duracaoMs}ms ${JSON.stringify(dados)}`);
}

function garantirTabelaLaunchTickets() {
  getDB().prepare(`
    CREATE TABLE IF NOT EXISTS protheus_chat_launch_tokens (
      ticket TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      expira_em TEXT,
      criado_em INTEGER NOT NULL
    )
  `).run();
}

function limparLaunchTickets() {
  garantirTabelaLaunchTickets();
  getDB().prepare(`
    DELETE FROM protheus_chat_launch_tokens
    WHERE criado_em < ?
  `).run(Date.now() - LAUNCH_TICKET_TTL_MS);
}

function salvarLaunchTicket(ticket, token, expiraEm) {
  garantirTabelaLaunchTickets();
  limparLaunchTickets();
  getDB().prepare(`
    INSERT OR REPLACE INTO protheus_chat_launch_tokens (ticket, token, expira_em, criado_em)
    VALUES (?, ?, ?, ?)
  `).run(ticket, token, expiraEm || null, Date.now());
}

function consumirLaunchTicket(ticket) {
  garantirTabelaLaunchTickets();
  limparLaunchTickets();
  const db = getDB();
  const info = db.prepare(`
    SELECT token, expira_em AS expiraEm
    FROM protheus_chat_launch_tokens
    WHERE ticket = ?
    LIMIT 1
  `).get(ticket);
  if (info) {
    db.prepare('DELETE FROM protheus_chat_launch_tokens WHERE ticket = ?').run(ticket);
  }
  return info || null;
}

function requireTokenSessao(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const sessao = tokenService.validar(token);
  if (!sessao) return res.status(401).json({ error: 'Sessao invalida ou expirada.' });
  req.protheusChat = sessao;
  next();
}

function resolverEmpresaSelecionada(req, res) {
  const sessao = req.protheusChat || {};
  const empresaId = Number(
    req.body?.empresaId ||
    req.body?.empresa_id ||
    req.query?.empresaId ||
    req.query?.empresa_id ||
    sessao.empresaId ||
    0
  );

  if (!tokenService.empresaPermitida(sessao, empresaId)) {
    res.status(403).json({ error: 'Empresa nao permitida para esta sessao.' });
    return null;
  }

  return empresaId;
}

function normalizarListaIds(valor) {
  const fonte = Array.isArray(valor)
    ? valor
    : String(valor || '').split(',');
  const vistos = new Set();
  return fonte
    .map(item => Number(item || 0))
    .filter((id) => {
      if (!id || vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
}

function empresasPermitidasDaSessao(sessao) {
  const empresas = tokenService.normalizarEmpresasPermitidas(sessao?.empresasPermitidas, sessao?.empresaId)
    .map(emp => ({
      ...emp,
      empresa_id: Number(emp.empresaId),
      nome: emp.nomeProtheus || emp.codigoProtheus || `Empresa ${emp.empresaId}`,
    }));

  try {
    const ids = empresas.map(emp => emp.empresa_id).filter(Boolean);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = getDB().prepare(`SELECT id, nome FROM empresas WHERE id IN (${placeholders})`).all(...ids);
      const nomes = new Map((rows || []).map(row => [Number(row.id), String(row.nome || '').trim()]));
      for (const emp of empresas) {
        const nome = nomes.get(emp.empresa_id);
        if (nome) emp.nome = nome;
      }
    }
  } catch (_) {
    // Algumas instalacoes mantem o cadastro de empresas fora deste DB; o codigo
    // Protheus/empresaId ja e suficiente para executar o pipeline.
  }

  return empresas;
}

function resolverEmpresasSelecionadas(req, res) {
  const sessao = req.protheusChat || {};
  const permitidas = empresasPermitidasDaSessao(sessao);
  const permitidasPorId = new Map(permitidas.map(emp => [Number(emp.empresa_id), emp]));
  const idsInformados = [
    ...normalizarListaIds(req.body?.empresaIds || req.body?.empresasIds || req.body?.empresasSelecionadas),
    ...normalizarListaIds(req.query?.empresaIds || req.query?.empresasIds || req.query?.empresasSelecionadas),
  ];
  const ids = idsInformados.length
    ? idsInformados
    : normalizarListaIds(req.body?.empresaId || req.body?.empresa_id || req.query?.empresaId || req.query?.empresa_id || sessao.empresaId);

  const invalidas = ids.filter(id => !permitidasPorId.has(id));
  if (!ids.length || invalidas.length) {
    res.status(403).json({ error: 'Empresa nao permitida para esta sessao.' });
    return null;
  }

  return ids.map(id => permitidasPorId.get(id)).filter(Boolean);
}

function normalizarNumero(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function moduloPermitidoParaCelular({ empresaId, celular, modulo }) {
  const alvo = String(modulo || '').trim().toLowerCase();
  if (!empresaId || !celular || !alvo) return false;
  const numero = normalizarNumero(celular);
  const db = getDB();
  const numeros = db.prepare(`
    SELECT *
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1
  `).all(empresaId);
  const autorizado = (numeros || []).find(row => normalizarNumero(row.numero) === numero);
  if (!autorizado) return false;

  try {
    const dinamico = db.prepare(`
      SELECT liberado
      FROM whatsapp_numero_modulos
      WHERE numero_id = ? AND empresa_id = ? AND erp = 'protheus' AND modulo = ?
      LIMIT 1
    `).get(autorizado.id, empresaId, alvo);
    if (dinamico) return Number(dinamico.liberado || 0) === 1;
  } catch (_) {}

  const legado = {
    financeiro: 'modulo_financeiro',
    compras: 'modulo_compras',
    faturamento: 'modulo_faturamento',
    comissao: 'modulo_comissao',
    estoque: 'modulo_estoque',
  }[alvo];
  return legado ? Number(autorizado[legado] || 0) === 1 : false;
}

function validarModuloFavorito(req, res, favorito) {
  const modulo = String(favorito?.modulo || '').trim().toLowerCase();
  if (!moduloPermitidoParaCelular({
    empresaId: Number(favorito?.empresa_id || favorito?.empresaId || 0),
    celular: req.protheusChat?.celular,
    modulo,
  })) {
    res.status(403).json({ error: `Usuario sem permissao para o modulo ${modulo || 'da pergunta'}.` });
    return false;
  }
  return true;
}

module.exports = function registrarRotasProtheusWhatsApp(app) {
  // ── Emissao de token (chamada pelo Protheus/ADVPL, sem sessao de usuario) ──
  app.post('/api/ia-command/protheus/token', (req, res) => {
    const inicio = Date.now();
    if (PROTHEUS_SECRET && req.headers['x-protheus-secret'] !== PROTHEUS_SECRET) {
      perfLog('POST /token', inicio, { status: 401 });
      return res.status(401).json({ error: 'Credencial invalida.' });
    }
    const { empresaId, celular, filial, empresasPermitidas, launchTicket } = req.body || {};
    if (!empresaId || !celular) {
      perfLog('POST /token', inicio, { status: 400 });
      return res.status(400).json({ error: 'empresaId e celular sao obrigatorios.' });
    }
    try {
      const { token, expiraEm } = tokenService.emitir({ empresaId, celular, filial, empresasPermitidas });
      const ticket = String(launchTicket || '').trim();
      if (ticket) {
        salvarLaunchTicket(ticket, token, expiraEm);
      }
      perfLog('POST /token', inicio, {
        status: 200,
        empresaId: Number(empresaId),
        empresasPermitidas: Array.isArray(empresasPermitidas) ? empresasPermitidas.length : 0,
        launchTicket: ticket ? 1 : 0,
      });
      res.json({ token, expiraEm });
    } catch (err) {
      perfLog('POST /token', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pagina do chat (servida como estatico, sem auth de sessao IAHub) ──
  app.get('/api/ia-command/protheus/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'protheus-chat.html'));
  });

  app.get('/api/ia-command/protheus/launch-token', (req, res) => {
    const inicio = Date.now();
    const ticket = String(req.query.ticket || req.query.launchTicket || '').trim();
    if (!ticket) {
      perfLog('GET /launch-token', inicio, { status: 400 });
      return res.status(400).json({ error: 'ticket obrigatorio.' });
    }
    const info = consumirLaunchTicket(ticket);
    if (!info) {
      perfLog('GET /launch-token', inicio, { status: 200, pending: 1 });
      return res.json({ pending: true });
    }
    perfLog('GET /launch-token', inicio, { status: 200, pending: 0 });
    res.json({ token: info.token, expiraEm: info.expiraEm });
  });

  app.get('/api/ia-command/protheus/empresas', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    const empresas = empresasPermitidasDaSessao(req.protheusChat);
    perfLog('GET /empresas', inicio, {
      status: 200,
      empresaId: Number(req.protheusChat.empresaId),
      empresas: empresas.length,
    });
    res.json({
      empresaId: Number(req.protheusChat.empresaId),
      empresas,
    });
  });

  app.get('/api/ia-command/protheus/bootstrap', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;
    try {
      const empresas = empresasPermitidasDaSessao(req.protheusChat);
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessoes = sessionStore.listarSessoes({ empresaId, celular });
      perfLog('GET /bootstrap', inicio, {
        status: 200,
        empresaId,
        empresas: empresas.length,
        sessoes: sessoes.length,
      });
      res.json({
        empresaId: Number(req.protheusChat.empresaId),
        empresas,
        sessoes,
      });
    } catch (err) {
      perfLog('GET /bootstrap', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/favoritos', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favoritos = sessionStore.listarFavoritos({ empresaId, celular })
        .filter(fav => moduloPermitidoParaCelular({ empresaId, celular, modulo: fav.modulo }));
      perfLog('GET /favoritos', inicio, { status: 200, empresaId, total: favoritos.length });
      res.json({ favoritos });
    } catch (err) {
      perfLog('GET /favoritos', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Envio de mensagem ──
  app.post('/api/ia-command/protheus/mensagem', requireTokenSessao, async (req, res) => {
    const { texto, sessaoId } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(400).json({ error: 'texto obrigatorio.' });
    }
    try {
      const { celular } = req.protheusChat;
      const empresasSelecionadas = resolverEmpresasSelecionadas(req, res);
      if (!empresasSelecionadas) return;
      const empresaId = Number(empresasSelecionadas[0].empresa_id);
      if (sessaoId && !sessionStore.buscarSessao({ id: sessaoId, empresaId, celular })) {
        return res.status(404).json({ error: 'Sessao nao encontrada nesta empresa.' });
      }
      const sid = sessaoId || sessionStore.criarSessao({ empresaId, celular });
      console.log(`[protheus_whatsapp] Mensagem recebida: empresa=${empresasSelecionadas.map(e => e.empresa_id).join(',')} celular=${celular || ''} sessao=${sid} texto="${String(texto).trim().slice(0, 160)}"`);
      const resultado = await chatService.processarMensagem({
        empresaId,
        empresasSelecionadas,
        celular,
        sessaoId: sid,
        texto: String(texto).trim(),
      });
      console.log(`[protheus_whatsapp] Mensagem processada: empresa=${empresaId} sessao=${sid} tipo=${resultado?.tipo || 'n/a'} temDados=${resultado?.temDados ? 1 : 0} rows=${resultado?.rowsCount ?? 'n/a'}`);
      res.json({ sessaoId: sid, resposta: resultado, criadoEm: new Date().toISOString() });
    } catch (err) {
      console.error(`[protheus_whatsapp] Falha ao processar mensagem: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sessoes (sidebar) ──
  app.get('/api/ia-command/protheus/sessoes', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessoes = sessionStore.listarSessoes({ empresaId, celular });
      perfLog('GET /sessoes', inicio, { status: 200, empresaId, total: sessoes.length });
      res.json(sessoes);
    } catch (err) {
      perfLog('GET /sessoes', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/sessoes', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessaoId = sessionStore.criarSessao({ empresaId, celular });
      res.json({ sessaoId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ia-command/protheus/sessoes/:id', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const excluida = sessionStore.excluirSessao({ sessaoId: req.params.id, empresaId, celular });
      if (!excluida) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Renomear conversa ──
  app.put('/api/ia-command/protheus/sessoes/:id', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    const { titulo } = req.body || {};
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'titulo e obrigatorio.' });
    }
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const renomeada = sessionStore.renomearSessao({ sessaoId: req.params.id, empresaId, celular, titulo });
      if (!renomeada) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Exclusao de mensagens especificas (selecao multipla, estilo WhatsApp) ──
  app.post('/api/ia-command/protheus/sessoes/:id/mensagens/excluir', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    const { mensagemIds } = req.body || {};
    if (!Array.isArray(mensagemIds) || !mensagemIds.length) {
      return res.status(400).json({ error: 'mensagemIds e obrigatorio (array nao vazio).' });
    }
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const removidas = sessionStore.excluirMensagens({
        sessaoId: req.params.id, empresaId, celular, mensagemIds,
      });
      res.json({ ok: true, removidas });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── "Limpar Chat" — apaga TODAS as mensagens da conversa, mantem a sessao ──
  app.post('/api/ia-command/protheus/sessoes/:id/mensagens/limpar', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const removidas = sessionStore.limparMensagens({ sessaoId: req.params.id, empresaId, celular });
      res.json({ ok: true, removidas });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/sessoes/:id/mensagens', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    const cursor = req.query.cursor || null;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      res.json(sessionStore.listarMensagens({ sessaoId: req.params.id, cursor }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Ultima resposta tabular da sessao — alimenta a aba Relatorio ──
  app.get('/api/ia-command/protheus/sessoes/:id/relatorio', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const relatorio = sessionStore.ultimaMensagemTabular({ sessaoId: req.params.id });
      res.json(relatorio); // null se nao houver dados tabulares ainda
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Resposta tabular especifica: reabre dados de perguntas antigas sem reprocessar IA/SQL.
  app.get('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/relatorio', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const relatorio = sessionStore.mensagemTabular({
        sessaoId: req.params.id,
        mensagemId: req.params.mensagemId,
      });
      if (!relatorio) return res.status(404).json({ error: 'Mensagem tabular nao encontrada.' });
      res.json(relatorio);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/favorito', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favorito = sessionStore.favoritarMensagem({
        sessaoId: req.params.id,
        empresaId,
        celular,
        mensagemId: req.params.mensagemId,
        titulo: req.body?.titulo || null,
      });
      if (!favorito) return res.status(404).json({ error: 'Mensagem nao encontrada.' });
      if (!validarModuloFavorito(req, res, favorito)) {
        sessionStore.removerFavorito({ favoritoId: favorito.id, empresaId, celular });
        return;
      }
      res.json({ favorito });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete('/api/ia-command/protheus/favoritos/:favoritoId', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const ok = sessionStore.removerFavorito({ favoritoId: req.params.favoritoId, empresaId, celular });
      if (!ok) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/favoritos/:favoritoId/executar', requireTokenSessao, async (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favorito = sessionStore.obterFavorito({ favoritoId: req.params.favoritoId, empresaId, celular });
      if (!favorito) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      if (!validarModuloFavorito(req, res, favorito)) return;

      const sid = req.body?.sessaoId || sessionStore.criarSessao({ empresaId, celular, tituloInicial: favorito.titulo });
      if (req.body?.sessaoId && !sessionStore.buscarSessao({ id: sid, empresaId, celular })) {
        return res.status(404).json({ error: 'Sessao nao encontrada nesta empresa.' });
      }
      const resultado = await chatService.executarFavorito({
        empresaId,
        celular,
        sessaoId: sid,
        favorito,
      });
      res.json({ sessaoId: sid, resposta: resultado, criadoEm: new Date().toISOString() });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Salvar config de grid (agrupamento/filtros) escolhida pelo usuario ──
  app.put('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/grid-config', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
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
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });
      const resetadoEm = sessionStore.resetarMemoria({ sessaoId: req.params.id });
      res.json({ ok: true, resetadoEm });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

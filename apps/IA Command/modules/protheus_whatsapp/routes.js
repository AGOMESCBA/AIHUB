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
const http = require('http');
const crypto = require('crypto');
const tokenService = require('./token-service');
const sessionStore = require('./session-store');
const chatService = require('./service');
const userPermissionsStore = require('./user-permissions-store');
const { getDB } = require('../database');
const whatsappManager = require('../whatsapp/service-manager');
const whatsappChannels = require('../whatsapp/channel-store');
const scheduledQuestionRunner = require('../scheduler/scheduled-question-runner');
const canonicalWhatsappFormat = require('../erp/core/canonical-whatsapp-format');
const loboGuaraFilialResolver = require('../erp/totvs_protheus/SX/lobo-guara-filial-resolver');

const PROTHEUS_SECRET = process.env.IAC_PROTHEUS_CHAT_SECRET || '';
const LAUNCH_TICKET_TTL_MS = 5 * 60 * 1000;
const WEB_LOGIN_TTL_MS = 5 * 60 * 1000;
const WEB_LOGIN_MAX_TENTATIVAS = 5;

function perfLog(etapa, inicio, dados = {}) {
  const duracaoMs = Date.now() - inicio;
  console.log(`[protheus_whatsapp][perf] ${new Date().toISOString()} ${etapa} ${duracaoMs}ms ${JSON.stringify(dados)}`);
}

function forwardDebug(etapa, dados = {}) {
  console.log(`[protheus_whatsapp][forward-debug] ${new Date().toISOString()} ${etapa} ${JSON.stringify(dados)}`);
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

function hashCodigoLogin(celular, codigo, id) {
  return crypto
    .createHash('sha256')
    .update(`${id}:${celular}:${codigo}:${PROTHEUS_SECRET || process.env.SESSION_SECRET || 'iahub'}`)
    .digest('hex');
}

function limparLoginChallenges() {
  getDB().prepare(`
    DELETE FROM protheus_web_login_challenges
     WHERE expira_em < ?
        OR usado_em IS NOT NULL
  `).run(new Date(Date.now() - 60 * 60 * 1000).toISOString());
}

function criarLoginChallenge(req, celular, codigo) {
  limparLoginChallenges();
  const id = crypto.randomUUID();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + WEB_LOGIN_TTL_MS);
  getDB().prepare(`
    INSERT INTO protheus_web_login_challenges
      (id, celular, codigo_hash, expira_em, ip, user_agent, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    celular,
    hashCodigoLogin(celular, codigo, id),
    expiraEm.toISOString(),
    req.ip || req.socket?.remoteAddress || null,
    String(req.headers['user-agent'] || '').slice(0, 500) || null,
    agora.toISOString()
  );
  return { id, expiraEm: expiraEm.toISOString() };
}

function carregarPermissoesWebPorCelular(celular) {
  const rows = userPermissionsStore.listarAtivosPorCelular(celular);
  if (!rows.length) return null;

  const principal = rows[0];
  const empresasPermitidas = [];
  const empresasVistas = new Set();
  const filiaisPorEmpresa = new Map();

  for (const row of rows) {
    for (const emp of row.empresasPermitidas || []) {
      const id = Number(emp.empresaId || emp.empresa_id || emp.id || 0);
      if (!id || empresasVistas.has(id)) continue;
      empresasVistas.add(id);
      empresasPermitidas.push(emp);
    }
    for (const item of row.filiaisPermitidas || []) {
      const codigo = String(item.codigoProtheus || item.codigo_protheus || '').trim();
      if (!codigo) continue;
      if (!filiaisPorEmpresa.has(codigo)) filiaisPorEmpresa.set(codigo, new Set());
      for (const filial of (Array.isArray(item.filiais) ? item.filiais : [])) {
        const valor = String(filial || '').trim();
        if (valor) filiaisPorEmpresa.get(codigo).add(valor);
      }
    }
  }

  const filiaisPermitidas = [...filiaisPorEmpresa.entries()].map(([codigoProtheus, filiais]) => ({
    codigoProtheus,
    filiais: [...filiais],
  }));

  return {
    empresaId: principal.empresa_id,
    celular: principal.celular,
    usuarioNome: principal.usuario_nome || principal.usuario_id || principal.celular,
    filial: principal.filial_atual || null,
    empresasPermitidas,
    filiaisPermitidas,
  };
}

function validarLoginChallenge(challengeId, celular, codigo) {
  const id = String(challengeId || '').trim();
  const numero = tokenService.normalizarCelular(celular);
  const code = String(codigo || '').replace(/\D/g, '');
  if (!id || !numero || code.length !== 6) return { ok: false, error: 'Codigo invalido.' };

  const db = getDB();
  const row = db.prepare(`
    SELECT *
      FROM protheus_web_login_challenges
     WHERE id = ?
       AND celular = ?
     LIMIT 1
  `).get(id, numero);
  if (!row || row.usado_em) return { ok: false, error: 'Codigo expirado ou invalido.' };
  if (new Date(row.expira_em).getTime() < Date.now()) return { ok: false, error: 'Codigo expirado.' };
  if (Number(row.tentativas || 0) >= WEB_LOGIN_MAX_TENTATIVAS) return { ok: false, error: 'Limite de tentativas excedido.' };

  const informado = hashCodigoLogin(numero, code, id);
  if (informado !== row.codigo_hash) {
    db.prepare(`
      UPDATE protheus_web_login_challenges
         SET tentativas = tentativas + 1
       WHERE id = ?
    `).run(id);
    return { ok: false, error: 'Codigo invalido.' };
  }

  db.prepare(`
    UPDATE protheus_web_login_challenges
       SET usado_em = ?
     WHERE id = ?
  `).run(new Date().toISOString(), id);
  return { ok: true };
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

// Normaliza o payload da arvore de selecao de filial (frontend) para o shape
// minimo esperado por resolverEscopoFilialLoboGuara/consolidarEscopoFilial —
// nunca confia no formato vindo do browser (arrays podem vir ausentes, com
// tipos errados, ou nem existir se o cliente for uma versao antiga da tela).
function normalizarFilialSelecaoUi(valor) {
  if (!valor || typeof valor !== 'object') return null;
  const empresasInteiras = Array.isArray(valor.empresasInteiras)
    ? valor.empresasInteiras.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  const filiaisAvulsas = Array.isArray(valor.filiaisAvulsas)
    ? valor.filiaisAvulsas.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  const uiTouched = !!valor.uiTouched;
  if (!uiTouched && !empresasInteiras.length && !filiaisAvulsas.length) return null;
  return { empresasInteiras, filiaisAvulsas, uiTouched };
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

function sqlFavoritoValido(sql) {
  const texto = String(sql || '').trim();
  if (!texto) return { ok: false, error: 'Informe o SQL final executado.' };
  const normalizado = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const consulta = texto.replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '').trim();
  if (!/^(select|with)\b/i.test(consulta)) {
    return { ok: false, error: 'Apenas SQL de consulta iniciado por SELECT, WITH ou SET ROWCOUNT seguido de SELECT/WITH pode ser salvo.' };
  }
  const semPontoFinal = consulta.replace(/;\s*$/, '');
  if (/;\s*\S/.test(semPontoFinal)) {
    return { ok: false, error: 'SQL deve conter apenas uma consulta de leitura.' };
  }
  if (/\b(insert|update|delete|drop|alter|truncate|merge|exec|execute|create|grant|revoke)\b/i.test(normalizado)) {
    return { ok: false, error: 'SQL contem comando nao permitido para favorito.' };
  }
  return { ok: true };
}

function avaliarMacrosFavorito(favorito, empresaId, celular) {
  const sql = String(favorito?.sql_final_executado || favorito?.sqlFinalExecutado || '').trim();
  if (!sql) return { precisaAjuste: false, macrosPendentes: [] };
  try {
    const avaliacao = scheduledQuestionRunner.avaliarMacrosSql(sql, {
      empresa_id: empresaId,
      nome: favorito?.titulo || favorito?.pergunta_texto || favorito?.perguntaTexto || '',
      pergunta: favorito?.pergunta_texto || favorito?.perguntaTexto || '',
      modulo: favorito?.modulo || '',
      sql_fixo: sql,
    }, new Date(), [{ nome: celular, numero: celular }]);
    return {
      precisaAjuste: !avaliacao.ok,
      macrosPendentes: avaliacao.macrosPendentes || [],
    };
  } catch (err) {
    return {
      precisaAjuste: true,
      macrosPendentes: err.macrosPendentes || [],
    };
  }
}

function serializarFavoritoParaChat(favorito, { empresaId, celular, incluirSql = false } = {}) {
  const statusMacro = avaliarMacrosFavorito(favorito, empresaId, celular);
  const out = {
    id: favorito.id,
    empresaId: Number(favorito.empresaId || favorito.empresa_id || empresaId || 0),
    titulo: favorito.titulo,
    perguntaTexto: favorito.perguntaTexto || favorito.pergunta_texto || '',
    respostaMensagemId: favorito.respostaMensagemId || favorito.resposta_mensagem_id || null,
    interpretationLogId: favorito.interpretationLogId || favorito.interpretation_log_id || null,
    modulo: favorito.modulo || null,
    gridConfig: favorito.gridConfig || (favorito.grid_config_json ? JSON.parse(favorito.grid_config_json) : null),
    ultimoUsoEm: favorito.ultimoUsoEm || favorito.ultimo_uso_em || null,
    criadoEm: favorito.criadoEm || favorito.criado_em || null,
    atualizadoEm: favorito.atualizadoEm || favorito.atualizado_em || null,
    precisaAjuste: statusMacro.precisaAjuste,
    macrosPendentes: statusMacro.macrosPendentes,
  };
  if (incluirSql) out.sqlFinalExecutado = favorito.sqlFinalExecutado || favorito.sql_final_executado || '';
  return out;
}

function buscarContatoAutorizado({ empresaId, numeroId }) {
  if (!empresaId || !numeroId) return null;
  return getDB().prepare(`
    SELECT id, nome, numero
    FROM whatsapp_allowed_numbers
    WHERE id = ? AND empresa_id = ? AND COALESCE(ativo, 1) = 1
    LIMIT 1
  `).get(String(numeroId), Number(empresaId)) || null;
}

function buscarContatosAutorizados({ empresaId, numeroIds }) {
  const ids = [...new Set((Array.isArray(numeroIds) ? numeroIds : [numeroIds])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
  return ids.map(numeroId => buscarContatoAutorizado({ empresaId, numeroId })).filter(Boolean);
}

function listarContatosAutorizados(empresaId) {
  return getDB().prepare(`
    SELECT id, nome, numero
    FROM whatsapp_allowed_numbers
    WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1
    ORDER BY nome, numero
  `).all(Number(empresaId));
}

function perguntaDaResposta({ sessaoId, respostaCriadaEm }) {
  const row = getDB().prepare(`
    SELECT texto
    FROM protheus_chat_messages
    WHERE sessao_id = ? AND direcao = 'out' AND criado_em <= ?
    ORDER BY criado_em DESC
    LIMIT 1
  `).get(sessaoId, respostaCriadaEm);
  return String(row?.texto || '').trim();
}

function resumoDaResposta(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const resumo = linhas.find(l => /^Leitura r[áa]pida:/i.test(l));
  if (resumo) return resumo;
  return linhas.slice(0, 3).join('\n').slice(0, 900);
}

function formatarValorGrade(valor) {
  if (valor == null) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

function montarGradeTexto(rows, limiteLinhas = 12) {
  const lista = Array.isArray(rows) ? rows : [];
  if (!lista.length) return 'Sem linhas de grade no snapshot.';
  const colunas = Object.keys(lista[0] || {}).slice(0, 6);
  const linhas = [];
  linhas.push(colunas.join(' | '));
  linhas.push(colunas.map(() => '---').join(' | '));
  for (const row of lista.slice(0, limiteLinhas)) {
    linhas.push(colunas.map(col => formatarValorGrade(row[col]).replace(/\s+/g, ' ').slice(0, 48)).join(' | '));
  }
  if (lista.length > limiteLinhas) {
    linhas.push(`... mais ${lista.length - limiteLinhas} linha(s).`);
  }
  return linhas.join('\n');
}

function montarMensagemEncaminhamento({ pergunta, resumo, rows }) {
  const perguntaTxt = String(pergunta || '(sem pergunta registrada)').trim();
  const rowsLista = Array.isArray(rows) ? rows : [];
  const textoCanonico = rowsLista.length
    ? canonicalWhatsappFormat.renderSingle(rowsLista, {
        contextoConsulta: perguntaTxt,
        nomeModulo: 'IA Command',
      })
    : null;

  if (textoCanonico) {
    return [
      '*Encaminhamento IA Command*',
      '',
      textoCanonico,
    ].join('\n');
  }

  const linhas = [
    '*Encaminhamento IA Command*',
    '',
    '*Pergunta:*',
    perguntaTxt,
    '',
    String(resumo || '(sem resumo registrado)').trim(),
  ];
  return linhas.join('\n');
}

function criarAuditoriaEncaminhamento({ empresaId, sessaoId, mensagemId, remetenteCelular, remetenteUsuario, contato, formato, pergunta, resumo, rowsCount, arquivoNome = null, status = 'pendente', erro = null }) {
  const id = require('crypto').randomUUID();
  const agora = new Date().toISOString();
  getDB().prepare(`
    INSERT INTO protheus_chat_forwardings (
      id, empresa_id, sessao_id, mensagem_id, remetente_celular, remetente_usuario,
      destinatario_numero_id, destinatario_celular, destinatario_nome, formato, status,
      pergunta_snapshot, resumo_snapshot, rows_count, arquivo_nome, erro, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    sessaoId || null,
    mensagemId || null,
    remetenteCelular || null,
    remetenteUsuario || null,
    contato?.id || null,
    contato?.numero || null,
    contato?.nome || null,
    formato || 'texto',
    status,
    pergunta || null,
    resumo || null,
    Number(rowsCount || 0),
    arquivoNome || null,
    erro || null,
    agora,
    agora,
  );
  return id;
}

function atualizarAuditoriaEncaminhamento({ id, empresaId, status, erro = null }) {
  const agora = new Date().toISOString();
  getDB().prepare(`
    UPDATE protheus_chat_forwardings
       SET status = ?,
           erro = ?,
           enviado_em = CASE WHEN ? = 'enviado' THEN ? ELSE enviado_em END,
           atualizado_em = ?
     WHERE id = ? AND empresa_id = ?
  `).run(status, erro || null, status, agora, agora, id, Number(empresaId));
}

function workerJson(workerPort, rota, payload = null, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: workerPort,
        path: rota,
        method: payload ? 'POST' : 'GET',
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let resposta = '';
        res.on('data', d => { resposta += d; });
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(resposta || '{}'); } catch (_) {}
          if (res.statusCode >= 400) {
            return reject(new Error(json.erro || json.error || `Worker WhatsApp retornou HTTP ${res.statusCode}`));
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao comunicar com o worker WhatsApp.')); });
    if (body) req.write(body);
    req.end();
  });
}

function normalizarArquivoEncaminhamento(arquivo) {
  if (!arquivo || typeof arquivo !== 'object') return null;
  const filename = String(arquivo.filename || arquivo.fileName || arquivo.name || '').trim();
  const mimetype = String(arquivo.mimetype || arquivo.mimeType || arquivo.type || 'application/octet-stream').trim();
  let data = String(arquivo.data || arquivo.base64 || '').trim();
  const dataUrl = data.match(/^data:([^;,]+)?;base64,(.*)$/i);
  if (dataUrl) {
    data = dataUrl[2] || '';
  }
  if (!filename || !mimetype || !data) return null;
  return { filename, mimetype, data };
}

async function canalWorkerConectado(canal, workerJsonFn = workerJson) {
  if (!canal?.is_windows_service || !canal?.worker_port) return false;
  try {
    const health = await workerJsonFn(canal.worker_port, '/health', null, 2500);
    const status = String(health?.status || '').toLowerCase();
    forwardDebug('worker-health', {
      canalId: canal.id,
      workerPort: canal.worker_port,
      status,
      pid: health?.pid || null,
    });
    return status === 'connected';
  } catch (err) {
    forwardDebug('worker-health-erro', {
      canalId: canal.id,
      workerPort: canal.worker_port,
      erro: err.message,
    });
    return false;
  }
}

function canalServiceConectado(canal, manager = whatsappManager) {
  const svcDireto = manager.get(canal.id);
  if (svcDireto && svcDireto.getStatus() === 'connected') return svcDireto;

  for (const svc of manager.getAll().values()) {
    if (!svc || svc.getStatus() !== 'connected') continue;
    const channelId = String(svc.getChannelId?.() || '');
    if (channelId && channelId === String(canal.id)) return svc;
  }
  return null;
}

async function primeiroCanalConectado(canais, { manager = whatsappManager, workerJsonFn = workerJson } = {}) {
  for (const canal of canais) {
    const svc = canalServiceConectado(canal, manager);
    if (svc) return { canal, svc };
  }

  for (const canal of canais) {
    if (await canalWorkerConectado(canal, workerJsonFn)) {
      return { canal, svc: null, workerPort: canal.worker_port };
    }
  }

  return null;
}

function canalCandidatoEncaminhamento(canal) {
  if (!canal || canal.ativo === 0) return false;
  if (canal.is_windows_service && canal.worker_port) return true;
  if (String(canal.auth_client_id || '').trim()) return true;
  return false;
}

function canaisGlobaisCandidatos(channelStore = whatsappChannels) {
  const porSessao = typeof channelStore.listarAtivosComSessao === 'function'
    ? channelStore.listarAtivosComSessao()
    : [];
  const todosAtivos = typeof channelStore.listarTodosCanais === 'function'
    ? channelStore.listarTodosCanais().filter(canalCandidatoEncaminhamento)
    : [];
  const porId = new Map();

  for (const canal of [...porSessao, ...todosAtivos]) {
    if (canal?.id && !porId.has(String(canal.id))) porId.set(String(canal.id), canal);
  }

  const canais = [...porId.values()].map(canal => ({
    ...canal,
    empresas: Array.isArray(canal.empresas) ? canal.empresas : channelStore.listarEmpresasDoCanal(canal.id),
  }));
  forwardDebug('canais-globais-candidatos', {
    total: canais.length,
    canais: canais.map(canal => ({
      id: canal.id,
      workerPort: canal.worker_port || null,
      isWindowsService: canal.is_windows_service ? 1 : 0,
      empresas: (canal.empresas || []).map(emp => Number(emp.empresa_id)),
    })),
  });
  return canais;
}

async function canaisGlobaisConectados({ manager = whatsappManager, workerJsonFn = workerJson, channelStore = whatsappChannels } = {}) {
  const canaisAtivos = canaisGlobaisCandidatos(channelStore);
  const conectados = [];

  for (const canal of canaisAtivos) {
    const svc = canalServiceConectado(canal, manager);
    if (svc) {
      conectados.push({ canal, svc });
      continue;
    }
    if (await canalWorkerConectado(canal, workerJsonFn)) {
      conectados.push({ canal, svc: null, workerPort: canal.worker_port });
    }
  }

  return conectados;
}

async function resolverCanalWhatsAppConectado(empresaId, deps = {}) {
  const channelStore = deps.channelStore || whatsappChannels;
  const canaisEmpresa = channelStore.listarPorEmpresa(Number(empresaId));
  const totalCanaisEmpresa = canaisEmpresa.length;
  forwardDebug('resolver-inicio', {
    empresaId: Number(empresaId),
    canaisEmpresa: canaisEmpresa.map(canal => ({
      id: canal.id,
      workerPort: canal.worker_port || null,
      isWindowsService: canal.is_windows_service ? 1 : 0,
      padrao: canal.padrao ? 1 : 0,
    })),
  });
  const conectadoDaEmpresa = await primeiroCanalConectado(canaisEmpresa, deps);
  if (conectadoDaEmpresa) {
    forwardDebug('resolver-escolhido', {
      empresaId: Number(empresaId),
      origem: 'empresa',
      canalId: conectadoDaEmpresa.canal?.id || null,
      workerPort: conectadoDaEmpresa.workerPort || null,
      via: conectadoDaEmpresa.workerPort ? 'worker' : 'service-manager',
    });
    return { ...conectadoDaEmpresa, totalCanais: totalCanaisEmpresa, origem: 'empresa' };
  }

  const globais = await canaisGlobaisConectados(deps);
  const idsEmpresa = new Set(canaisEmpresa.map(canal => String(canal.id)));
  const compartilhados = globais.filter(item => {
    if (idsEmpresa.has(String(item.canal.id))) return true;
    return Array.isArray(item.canal.empresas)
      && item.canal.empresas.some(emp => Number(emp?.empresa_id) === Number(empresaId));
  });

  if (compartilhados.length === 1) {
    forwardDebug('resolver-escolhido', {
      empresaId: Number(empresaId),
      origem: 'compartilhado',
      canalId: compartilhados[0].canal?.id || null,
      workerPort: compartilhados[0].workerPort || null,
      via: compartilhados[0].workerPort ? 'worker' : 'service-manager',
    });
    return { ...compartilhados[0], totalCanais: totalCanaisEmpresa || 1, origem: 'compartilhado' };
  }

  if (globais.length > 1) {
    console.warn('[protheus_whatsapp][forward] Mais de um canal WhatsApp conectado; empresa sem canal inequivoco.', {
      empresaId: Number(empresaId),
      canaisEmpresa: canaisEmpresa.map(c => c.id),
      canaisConectados: globais.map(item => item.canal.id),
    });
  }

  forwardDebug('resolver-sem-canal-conectado', {
    empresaId: Number(empresaId),
    totalCanaisEmpresa,
    totalGlobaisConectados: globais.length,
    totalCompartilhadosConectados: compartilhados.length,
  });
  return { canal: canaisEmpresa[0] || null, svc: null, workerPort: null, totalCanais: totalCanaisEmpresa };
}

async function enviarTextoWhatsApp({ empresaId, numero, texto }) {
  const { canal, svc, workerPort, totalCanais } = await resolverCanalWhatsAppConectado(empresaId);
  if (!canal) throw new Error('Nenhum canal WhatsApp vinculado a esta empresa.');
  if (workerPort) {
    await workerJson(workerPort, '/send-direct-message', { empresaId, numero, texto }, 30000);
    return { canalId: canal.id };
  }
  if (!svc) {
    throw new Error(totalCanais > 1
      ? 'Nenhum dos canais WhatsApp vinculados a esta empresa esta conectado.'
      : 'WhatsApp nao esta conectado para o canal vinculado a esta empresa.');
  }
  await svc.sendMessage(numero, texto);
  return { canalId: canal.id };
}

async function enviarArquivoWhatsApp({ empresaId, numero, texto, arquivo }) {
  const { canal, svc, workerPort, totalCanais } = await resolverCanalWhatsAppConectado(empresaId);
  if (!canal) throw new Error('Nenhum canal WhatsApp vinculado a esta empresa.');
  const arquivoNormalizado = normalizarArquivoEncaminhamento(arquivo);
  if (!arquivoNormalizado) {
    throw new Error('Arquivo invalido para encaminhamento.');
  }
  if (workerPort) {
    try {
      await workerJson(workerPort, '/send-media-message', { empresaId, numero, texto, arquivo: arquivoNormalizado }, 60000);
    } catch (err) {
      if (/nao encontrado|não encontrado|http 404/i.test(String(err.message || ''))) {
        throw new Error('O servico Windows do WhatsApp esta carregado sem suporte a anexos. Atualize os arquivos do worker e reinicie o servico.');
      }
      throw err;
    }
    return { canalId: canal.id };
  }
  if (!svc) {
    throw new Error(totalCanais > 1
      ? 'Nenhum dos canais WhatsApp vinculados a esta empresa esta conectado.'
      : 'WhatsApp nao esta conectado para o canal vinculado a esta empresa.');
  }
  if (typeof svc.sendMediaMessage !== 'function') {
    throw new Error('Motor WhatsApp ainda nao suporta envio de anexos nesta versao carregada.');
  }
  await svc.sendMediaMessage(numero, {
    data: arquivoNormalizado.data,
    mimetype: arquivoNormalizado.mimetype,
    filename: arquivoNormalizado.filename,
    caption: texto,
  });
  return { canalId: canal.id };
}

module.exports = function registrarRotasProtheusWhatsApp(app) {
  // ── Emissao de token (chamada pelo Protheus/ADVPL, sem sessao de usuario) ──
  app.post('/api/ia-command/protheus/token', (req, res) => {
    const inicio = Date.now();
    if (PROTHEUS_SECRET && req.headers['x-protheus-secret'] !== PROTHEUS_SECRET) {
      perfLog('POST /token', inicio, { status: 401 });
      return res.status(401).json({ error: 'Credencial invalida.' });
    }
    const { empresaId, celular, filial, empresasPermitidas, filiaisPermitidas, launchTicket, usuarioId, usuarioNome } = req.body || {};
    if (!empresaId || !celular) {
      perfLog('POST /token', inicio, { status: 400 });
      return res.status(400).json({ error: 'empresaId e celular sao obrigatorios.' });
    }
    try {
      const { token, expiraEm } = tokenService.emitir({ empresaId, celular, filial, empresasPermitidas, filiaisPermitidas });
      try {
        userPermissionsStore.salvarSync({
          empresaId,
          celular,
          filialAtual: filial,
          usuarioId,
          usuarioNome,
          empresasPermitidas,
          filiaisPermitidas,
          origem: 'protheus_token',
        });
      } catch (syncErr) {
        console.warn(`[protheus_whatsapp] Falha ao sincronizar permissoes do usuario: ${syncErr.message}`);
      }
      const ticket = String(launchTicket || '').trim();
      if (ticket) {
        salvarLaunchTicket(ticket, token, expiraEm);
      }
      perfLog('POST /token', inicio, {
        status: 200,
        empresaId: Number(empresaId),
        empresasPermitidas: Array.isArray(empresasPermitidas) ? empresasPermitidas.length : 0,
        filiaisPermitidas: Array.isArray(filiaisPermitidas) ? filiaisPermitidas.length : 0,
        launchTicket: ticket ? 1 : 0,
      });
      res.json({ token, expiraEm });
    } catch (err) {
      perfLog('POST /token', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/user-permissions/sync', (req, res) => {
    const inicio = Date.now();
    if (PROTHEUS_SECRET && req.headers['x-protheus-secret'] !== PROTHEUS_SECRET) {
      perfLog('POST /user-permissions/sync', inicio, { status: 401 });
      return res.status(401).json({ error: 'Credencial invalida.' });
    }
    try {
      const body = req.body || {};
      const usuarios = Array.isArray(body.usuarios) ? body.usuarios : [body];
      const rows = usuarios.map(item => userPermissionsStore.salvarSync({
        empresaId: item.empresaId || item.empresa_id || body.empresaId || body.empresa_id,
        celular: item.celular || item.numero,
        filialAtual: item.filial || item.filialAtual || item.filial_atual || null,
        usuarioId: item.usuarioId || item.usuario_id || item.userId,
        usuarioNome: item.usuarioNome || item.usuario_nome || item.nome,
        empresasPermitidas: item.empresasPermitidas || item.empresas_permitidas || [],
        filiaisPermitidas: item.filiaisPermitidas || item.filiais_permitidas || [],
        origem: 'protheus_sync',
      }));
      perfLog('POST /user-permissions/sync', inicio, { status: 200, total: rows.length });
      res.json({ ok: true, total: rows.length, usuarios: rows });
    } catch (err) {
      perfLog('POST /user-permissions/sync', inicio, { status: 400, erro: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // ── Pagina do chat (servida como estatico, sem auth de sessao IAHub) ──
  app.get('/api/ia-command/protheus/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'protheus-chat.html'));
  });

  app.get('/api/ia-command/protheus/web-login', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'protheus-web-login.html'));
  });

  app.post('/api/ia-command/protheus/web-login/start', async (req, res) => {
    const inicio = Date.now();
    try {
      const celular = tokenService.normalizarCelular(req.body?.celular || req.body?.numero || '');
      if (celular.length < 10 || celular.length > 15) {
        return res.status(400).json({ error: 'Informe o WhatsApp com DDI e DDD.' });
      }

      const permissoes = carregarPermissoesWebPorCelular(celular);
      if (!permissoes) {
        perfLog('POST /web-login/start', inicio, { status: 404, celular });
        return res.status(404).json({ error: 'Numero nao encontrado ou sem permissao sincronizada.' });
      }

      const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const challenge = criarLoginChallenge(req, celular, codigo);
      await enviarTextoWhatsApp({
        empresaId: permissoes.empresaId,
        numero: celular,
        texto: `Seu codigo de acesso ao IA Command e ${codigo}. Ele expira em 5 minutos.`,
      });

      perfLog('POST /web-login/start', inicio, { status: 200, empresaId: permissoes.empresaId, celular });
      res.json({
        ok: true,
        challengeId: challenge.id,
        expiraEm: challenge.expiraEm,
        destino: celular.replace(/^(\d{2})(\d{2})(.*)$/, '+$1 $2 *****-$3').slice(0, 24),
      });
    } catch (err) {
      perfLog('POST /web-login/start', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/web-login/verify', (req, res) => {
    const inicio = Date.now();
    try {
      const celular = tokenService.normalizarCelular(req.body?.celular || req.body?.numero || '');
      const validacao = validarLoginChallenge(req.body?.challengeId || req.body?.challenge_id, celular, req.body?.codigo);
      if (!validacao.ok) {
        perfLog('POST /web-login/verify', inicio, { status: 400, motivo: validacao.error });
        return res.status(400).json({ error: validacao.error });
      }

      const permissoes = carregarPermissoesWebPorCelular(celular);
      if (!permissoes) {
        return res.status(403).json({ error: 'Permissao sincronizada nao encontrada.' });
      }

      const { token, expiraEm } = tokenService.emitir({
        empresaId: permissoes.empresaId,
        celular: permissoes.celular,
        filial: permissoes.filial,
        empresasPermitidas: permissoes.empresasPermitidas,
        filiaisPermitidas: permissoes.filiaisPermitidas,
      });

      perfLog('POST /web-login/verify', inicio, { status: 200, empresaId: permissoes.empresaId, celular });
      res.json({
        ok: true,
        token,
        expiraEm,
        usuario: permissoes.usuarioNome,
        chatUrl: `/api/ia-command/protheus/chat?token=${encodeURIComponent(token)}&usuario=${encodeURIComponent(permissoes.usuarioNome)}&origem=web`,
      });
    } catch (err) {
      perfLog('POST /web-login/verify', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
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

  // ── Arvore de filiais Lobo Guara (selecao manual de escopo no chat) ──
  app.get('/api/ia-command/protheus/filial-tree', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    try {
      const empresasSelecionadas = resolverEmpresasSelecionadas(req, res);
      if (!empresasSelecionadas) return;

      const db = getDB();
      const empresas = [];
      for (const emp of empresasSelecionadas) {
        const ctx = loboGuaraFilialResolver.contextoLoboGuara(db, emp.empresa_id);
        if (!ctx) continue; // nao LOBO_GUARA validada — nao aparece na arvore
        const arvoreEmpresa = loboGuaraFilialResolver.arvoreAgrupadaParaSelecao(db, ctx.connectionId);
        // Filtra pelo acesso real do usuario no ERP (FWUsrEmp/LoadFils,
        // capturado no .prw na abertura do chat) — a arvore cadastrada
        // (protheus_company_tree) representa o universo, nao o que este
        // usuario especifico pode ver. Sem essa informacao na sessao
        // (compatibilidade: .prw anterior a esta mudanca, ou LoadFils falhou
        // para essa empresa), mantem o comportamento anterior (mostra tudo
        // que esta cadastrado).
        for (const empArvore of arvoreEmpresa) {
          const filiaisErp = tokenService.filiaisPermitidasDaEmpresa(req.protheusChat, empArvore.empresaProtheusCodigo);
          if (filiaisErp === null) {
            empresas.push(empArvore);
            continue;
          }
          const filiaisFiltradas = empArvore.filiais.filter(f => filiaisErp.includes(f.filialChave));
          if (filiaisFiltradas.length) {
            empresas.push({ ...empArvore, filiais: filiaisFiltradas });
          }
        }
      }

      perfLog('GET /filial-tree', inicio, { status: 200, empresas: empresas.length });
      if (!empresas.length) return res.json({ disponivel: false });
      res.json({ disponivel: true, empresas });
    } catch (err) {
      perfLog('GET /filial-tree', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
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
      const favoritos = sessionStore.listarFavoritos({ empresaId, celular, incluirSql: true })
        .filter(fav => moduloPermitidoParaCelular({ empresaId, celular, modulo: fav.modulo }))
        .map(fav => serializarFavoritoParaChat(fav, { empresaId, celular }));
      perfLog('GET /favoritos', inicio, { status: 200, empresaId, total: favoritos.length });
      res.json({ favoritos });
    } catch (err) {
      perfLog('GET /favoritos', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/encaminhamentos/contatos', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const contatos = listarContatosAutorizados(empresaId).map(row => ({
        id: row.id,
        nome: row.nome,
        numero: row.numero,
      }));
      perfLog('GET /encaminhamentos/contatos', inicio, { status: 200, empresaId, total: contatos.length });
      res.json({ contatos });
    } catch (err) {
      perfLog('GET /encaminhamentos/contatos', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/encaminhamentos/anexo', requireTokenSessao, async (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;
    const numeroIds = [
      ...(Array.isArray(req.body?.destinatarioNumeroIds) ? req.body.destinatarioNumeroIds : []),
      ...(Array.isArray(req.body?.numeroIds) ? req.body.numeroIds : []),
      req.body?.destinatarioNumeroId,
      req.body?.numeroId,
    ].map(id => String(id || '').trim()).filter(Boolean);
    const arquivo = normalizarArquivoEncaminhamento(req.body?.arquivo);
    const legenda = String(req.body?.legenda || '').trim();

    if (!numeroIds.length) {
      return res.status(400).json({ error: 'Selecione ao menos um contato autorizado para encaminhar.' });
    }
    if (!arquivo) {
      return res.status(400).json({ error: 'Selecione um arquivo para encaminhar.' });
    }
    if (String(arquivo.data).length > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'Arquivo muito grande para encaminhamento pelo WhatsApp. Limite: 10 MB por anexo.' });
    }

    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;

      const contatos = buscarContatosAutorizados({ empresaId, numeroIds });
      if (!contatos.length) return res.status(404).json({ error: 'Nenhum contato autorizado encontrado nesta empresa.' });
      if (contatos.length !== [...new Set(numeroIds)].length) {
        return res.status(404).json({ error: 'Um ou mais contatos selecionados nao estao autorizados nesta empresa.' });
      }

      const pergunta = 'Encaminhamento de anexo local';
      const resumo = legenda || arquivo.filename;
      const texto = legenda || `Anexo enviado pelo IA Command: ${arquivo.filename}`;
      const resultados = [];

      for (const contato of contatos) {
        const auditoriaId = criarAuditoriaEncaminhamento({
          empresaId,
          sessaoId: null,
          mensagemId: null,
          remetenteCelular: celular,
          remetenteUsuario: req.query?.usuario || null,
          contato,
          formato: 'anexo',
          pergunta,
          resumo,
          rowsCount: 0,
          arquivoNome: arquivo.filename,
        });

        try {
          const envio = await enviarArquivoWhatsApp({ empresaId, numero: contato.numero, texto, arquivo });
          atualizarAuditoriaEncaminhamento({ id: auditoriaId, empresaId, status: 'enviado' });
          resultados.push({ id: auditoriaId, contatoId: contato.id, status: 'enviado', canalId: envio.canalId });
        } catch (errEnvio) {
          atualizarAuditoriaEncaminhamento({ id: auditoriaId, empresaId, status: 'erro', erro: errEnvio.message });
          resultados.push({ id: auditoriaId, contatoId: contato.id, status: 'erro', erro: errEnvio.message });
        }
      }

      const enviados = resultados.filter(item => item.status === 'enviado').length;
      perfLog('POST /encaminhamentos/anexo', inicio, { status: enviados ? 200 : 502, empresaId, total: resultados.length, enviados });
      if (!enviados) {
        return res.status(502).json({ error: resultados[0]?.erro || 'Falha ao encaminhar anexo.', resultados, status: 'erro' });
      }
      res.json({ ok: true, status: enviados === resultados.length ? 'enviado' : 'parcial', enviados, total: resultados.length, resultados });
    } catch (err) {
      perfLog('POST /encaminhamentos/anexo', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/whatsapp-preview', requireTokenSessao, async (req, res) => {
    const inicio = Date.now();
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

      const pergunta = perguntaDaResposta({ sessaoId: req.params.id, respostaCriadaEm: relatorio.criadoEm });
      const resumo = resumoDaResposta(relatorio.texto);
      const texto = montarMensagemEncaminhamento({ pergunta, resumo, rows: relatorio.rows });

      perfLog('GET /whatsapp-preview', inicio, { status: 200, empresaId, rows: relatorio.rows?.length || 0 });
      res.json({
        pergunta,
        resumo,
        texto,
        rowsCount: Array.isArray(relatorio.rows) ? relatorio.rows.length : 0,
      });
    } catch (err) {
      perfLog('GET /whatsapp-preview', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/sql', requireTokenSessao, (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;

    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });

      const info = sessionStore.sqlDaMensagem({
        sessaoId: req.params.id,
        mensagemId: req.params.mensagemId,
      });
      if (!info) return res.status(404).json({ error: 'Mensagem nao encontrada.' });
      if (!info.temSql) return res.status(404).json({ error: 'Esta mensagem ainda nao possui SQL auditado.' });

      const pergunta = perguntaDaResposta({ sessaoId: req.params.id, respostaCriadaEm: info.criadoEm });
      perfLog('GET /mensagem/sql', inicio, { status: 200, empresaId, modulo: info.modulo || 'n/a' });
      res.json({
        pergunta,
        sql: info.sql,
        sqlFonte: info.sqlFonte,
        sqlTemplate: info.sqlTemplate,
        modulo: info.modulo,
        interpretationLogId: info.interpretationLogId,
        favoritoId: info.favoritoId,
      });
    } catch (err) {
      perfLog('GET /mensagem/sql', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ia-command/protheus/sessoes/:id/mensagens/:mensagemId/encaminhar', requireTokenSessao, async (req, res) => {
    const inicio = Date.now();
    const { celular } = req.protheusChat;
    const formato = String(req.body?.formato || 'texto').trim().toLowerCase();
    const numeroIds = [
      ...(Array.isArray(req.body?.destinatarioNumeroIds) ? req.body.destinatarioNumeroIds : []),
      ...(Array.isArray(req.body?.numeroIds) ? req.body.numeroIds : []),
      req.body?.destinatarioNumeroId,
      req.body?.numeroId,
    ].map(id => String(id || '').trim()).filter(Boolean);
    const arquivo = normalizarArquivoEncaminhamento(req.body?.arquivo);

    if (!['texto', 'pdf', 'excel'].includes(formato)) {
      return res.status(400).json({ error: 'Formato de encaminhamento invalido.' });
    }
    if (!numeroIds.length) {
      return res.status(400).json({ error: 'Selecione ao menos um contato autorizado para encaminhar.' });
    }
    if (formato !== 'texto') {
      if (!arquivo) {
        return res.status(400).json({ error: 'Arquivo PDF/Excel nao foi gerado para o encaminhamento.' });
      }
      if (String(arquivo.data).length > 15 * 1024 * 1024) {
        return res.status(400).json({ error: 'Arquivo muito grande para encaminhamento pelo WhatsApp. Limite: 10 MB por anexo.' });
      }
    }

    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const sessao = sessionStore.buscarSessao({ id: req.params.id, empresaId, celular });
      if (!sessao) return res.status(404).json({ error: 'Sessao nao encontrada.' });

      const contatos = buscarContatosAutorizados({ empresaId, numeroIds });
      if (!contatos.length) return res.status(404).json({ error: 'Nenhum contato autorizado encontrado nesta empresa.' });
      if (contatos.length !== [...new Set(numeroIds)].length) {
        return res.status(404).json({ error: 'Um ou mais contatos selecionados nao estao autorizados nesta empresa.' });
      }

      const relatorio = sessionStore.mensagemTabular({
        sessaoId: req.params.id,
        mensagemId: req.params.mensagemId,
      });
      if (!relatorio) return res.status(404).json({ error: 'Mensagem tabular nao encontrada.' });

      const pergunta = perguntaDaResposta({ sessaoId: req.params.id, respostaCriadaEm: relatorio.criadoEm });
      const resumo = resumoDaResposta(relatorio.texto);
      const texto = montarMensagemEncaminhamento({ pergunta, resumo, rows: relatorio.rows });

      const resultados = [];
      for (const contato of contatos) {
        const auditoriaId = criarAuditoriaEncaminhamento({
          empresaId,
          sessaoId: req.params.id,
          mensagemId: req.params.mensagemId,
          remetenteCelular: celular,
          remetenteUsuario: req.query?.usuario || null,
          contato,
          formato,
          pergunta,
          resumo,
          rowsCount: relatorio.rowsCount,
          arquivoNome: arquivo?.filename || null,
        });

        try {
          const envio = formato === 'texto'
            ? await enviarTextoWhatsApp({ empresaId, numero: contato.numero, texto })
            : await enviarArquivoWhatsApp({ empresaId, numero: contato.numero, texto, arquivo });
          atualizarAuditoriaEncaminhamento({ id: auditoriaId, empresaId, status: 'enviado' });
          resultados.push({ id: auditoriaId, contatoId: contato.id, status: 'enviado', canalId: envio.canalId });
        } catch (errEnvio) {
          atualizarAuditoriaEncaminhamento({ id: auditoriaId, empresaId, status: 'erro', erro: errEnvio.message });
          resultados.push({ id: auditoriaId, contatoId: contato.id, status: 'erro', erro: errEnvio.message });
        }
      }

      const enviados = resultados.filter(item => item.status === 'enviado').length;
      perfLog('POST /encaminhar', inicio, { status: enviados ? 200 : 502, empresaId, total: resultados.length, enviados });
      if (!enviados) {
        return res.status(502).json({ error: resultados[0]?.erro || 'Falha ao encaminhar.', resultados, status: 'erro' });
      }
      res.json({ ok: true, status: enviados === resultados.length ? 'enviado' : 'parcial', enviados, total: resultados.length, resultados });
    } catch (err) {
      perfLog('POST /encaminhar', inicio, { status: 500, erro: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Envio de mensagem ──
  app.post('/api/ia-command/protheus/mensagem', requireTokenSessao, async (req, res) => {
    const { texto, sessaoId, filialSelecaoUi } = req.body || {};
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
        filialSelecaoUi: normalizarFilialSelecaoUi(filialSelecaoUi),
        filiaisPermitidasSessao: req.protheusChat.filiaisPermitidas || null,
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

  app.get('/api/ia-command/protheus/favoritos/:favoritoId/ajuste', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favorito = sessionStore.obterFavorito({ favoritoId: req.params.favoritoId, empresaId, celular });
      if (!favorito) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      if (!validarModuloFavorito(req, res, favorito)) return;
      res.json({
        favorito: serializarFavoritoParaChat(favorito, { empresaId, celular, incluirSql: true }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/ia-command/protheus/favoritos/:favoritoId', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    const { titulo } = req.body || {};
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'titulo obrigatorio.' });
    }
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favorito = sessionStore.renomearFavorito({ favoritoId: req.params.favoritoId, empresaId, celular, titulo });
      if (!favorito) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      res.json({
        ok: true,
        favorito: serializarFavoritoParaChat(favorito, { empresaId, celular }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/ia-command/protheus/favoritos/:favoritoId/sql', requireTokenSessao, (req, res) => {
    const { celular } = req.protheusChat;
    const sqlFinal = String(req.body?.sql_final_executado || req.body?.sqlFinalExecutado || '').trim();
    const validacao = sqlFavoritoValido(sqlFinal);
    if (!validacao.ok) return res.status(400).json({ error: validacao.error });
    try {
      const empresaId = resolverEmpresaSelecionada(req, res);
      if (!empresaId) return;
      const favoritoAtual = sessionStore.obterFavorito({ favoritoId: req.params.favoritoId, empresaId, celular });
      if (!favoritoAtual) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      if (!validarModuloFavorito(req, res, favoritoAtual)) return;
      const favorito = sessionStore.atualizarSqlFavorito({
        favoritoId: req.params.favoritoId,
        empresaId,
        celular,
        sqlFinal,
      });
      if (!favorito) return res.status(404).json({ error: 'Favorito nao encontrado.' });
      res.json({
        ok: true,
        favorito: serializarFavoritoParaChat(favorito, { empresaId, celular }),
      });
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
      res.status(err.statusCode || 500).json({
        error: err.message,
        macrosPendentes: err.macrosPendentes || [],
        precisaAjuste: Array.isArray(err.macrosPendentes) && err.macrosPendentes.length > 0,
      });
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

module.exports._test = {
  resolverCanalWhatsAppConectado,
  primeiroCanalConectado,
  canaisGlobaisConectados,
};

// API da tela Jobs (IA Gestão e menu dentro dos sistemas). Só administrador
// do IAHub: controla o servidor inteiro (todas as empresas). Toda alteração
// vira evento na tela e linha na Auditoria da IA Gestão, com o usuário.
const repo = require('./repositorio');
const painel = require('./painel');
const catalogo = require('./catalogo');
const alerta = require('./alerta');
const servicoWindows = require('./servico-windows');
const { registrarAuditoria } = require('../../apps/IAHUB/backend/auth/database');
const empresasDb = require('../../apps/IAHUB/backend/empresas/database');

const BASE = '/api/iahub/jobs';
const LIMITE_MAX = 100;

function _erro(status, mensagem) {
  return Object.assign(new Error(mensagem), { status });
}

function _usuario(req) {
  return req.session?.user || 'desconhecido';
}

function _inteiro(valor, min, max, nome) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw _erro(400, `${nome} deve ser um número inteiro entre ${min} e ${max}.`);
  return n;
}

function _jobIdsDoSistema(sistema) {
  return sistema ? painel.definicoes(sistema).map(d => d.id) : null;
}

function _def(jobId) {
  const def = catalogo.padrao().obter(String(jobId || ''));
  if (!def) throw _erro(404, 'Job não encontrado.');
  return def;
}

function _servicoAtivo() {
  if (!repo.estadoServico().ativo) throw _erro(503, 'O serviço de jobs (IAHub-Jobs) está parado ou sem sinal: nada que dependa dele pode ser feito agora.');
}

function _iso(valor) {
  if (!valor) return null;
  const ms = Date.parse(valor);
  if (!Number.isFinite(ms)) throw _erro(400, 'Data inválida no filtro.');
  return new Date(ms).toISOString();
}

function _comRotulos(lista) {
  const cache = new Map();
  return lista.map((e) => {
    if (!e.jobId || !e.instancia) return e;
    const chave = `${e.jobId}|${e.instancia}`;
    if (!cache.has(chave)) cache.set(chave, painel.rotuloInstancia(e.jobId, e.instancia));
    return { ...e, rotulo: cache.get(chave) };
  });
}

function registrar(app, { requireAuth, requireAdmin }) {
  const guarda = [requireAuth, requireAdmin];
  // no-store: o painel acompanha execuções ao vivo; nada de cache do navegador/proxy.
  const semCache = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const rota = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!err.status) console.error('[Jobs] API:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  };
  const registrarAcao = (req, acao, texto, onde = {}) => {
    const usuario = _usuario(req);
    repo.registrarEvento({ nivel: 'info', tipo: acao, texto, usuario, ...onde });
    registrarAuditoria({ usuario, acao: `jobs_${acao}`, ip: req.ip, empresa_id: onde.empresaId ?? null, detalhes: texto });
  };

  app.get(`${BASE}/painel`, guarda, semCache, rota((req) => painel.montarPainel({ sistema: req.query.sistema || null })));

  app.get(`${BASE}/execucoes`, guarda, semCache, rota((req) => {
    const q = req.query;
    return {
      execucoes: _comRotulos(repo.listarExecucoes({
        jobIds: _jobIdsDoSistema(q.sistema), jobId: q.job || null, instancia: q.instancia || null,
        empresaId: q.empresa_id ? Number(q.empresa_id) : null, resultado: q.resultado || null,
        de: _iso(q.de), ate: _iso(q.ate), antesId: q.antes_id || null, limite: q.limite || 100,
      })),
    };
  }));

  app.get(`${BASE}/execucoes/:id`, guarda, semCache, rota((req) => {
    const e = repo.getExecucao(req.params.id);
    if (!e) throw _erro(404, 'Execução não encontrada.');
    return { execucao: _comRotulos([e])[0] };
  }));

  app.get(`${BASE}/eventos`, guarda, semCache, rota((req) => {
    const q = req.query;
    return {
      eventos: _comRotulos(repo.listarEventos({
        jobIds: _jobIdsDoSistema(q.sistema), jobId: q.job || null, nivel: q.nivel || null,
        empresaId: q.empresa_id ? Number(q.empresa_id) : null, de: _iso(q.de), ate: _iso(q.ate),
        antesId: q.antes_id || null, limite: q.limite || 200,
      })),
    };
  }));

  app.get(`${BASE}/empresas`, guarda, semCache, rota(() => ({
    empresas: empresasDb.listar().map(e => ({ id: Number(e.id), nome: e.razao_social || `Empresa ${e.id}` }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  })));

  app.post(`${BASE}/executar`, guarda, rota((req) => {
    const def = _def(req.body?.jobId);
    const instancia = String(req.body?.instancia || '');
    if (!def.instanciaValida(instancia)) throw _erro(400, 'Instância inválida para este job.');
    _servicoAtivo();
    const pedidoId = repo.criarPedido(def.id, instancia, { solicitadoPor: _usuario(req) });
    registrarAcao(req, 'executar_pedido', `Executar agora pedido: ${painel.rotuloInstancia(def.id, instancia)}.`, { jobId: def.id, instancia, empresaId: def.empresaDaInstancia?.(instancia) ?? null });
    return { pedidoId };
  }));

  app.post(`${BASE}/execucoes/:id/encerrar`, guarda, rota((req) => {
    const e = repo.getExecucao(req.params.id);
    if (!e) throw _erro(404, 'Execução não encontrada.');
    if (e.fim) throw _erro(409, 'Esta execução já terminou.');
    _servicoAtivo();
    const pedidoId = repo.criarPedido(e.jobId, e.instancia, { tipo: 'encerrar', alvoExecucaoId: e.id, solicitadoPor: _usuario(req) });
    registrarAcao(req, 'encerrar_pedido', `Encerrar execução #${e.id} pedido: ${painel.rotuloInstancia(e.jobId, e.instancia)}.`, { jobId: e.jobId, instancia: e.instancia, empresaId: e.empresaId });
    return { pedidoId };
  }));

  // Pausar/retomar o job inteiro (instancia '*') ou uma instância; limite por job.
  app.put(`${BASE}/controle`, guarda, rota((req) => {
    const def = _def(req.body?.jobId);
    const instancia = String(req.body?.instancia || repo.TODAS);
    if (instancia !== repo.TODAS && !def.instanciaValida(instancia)) throw _erro(400, 'Instância inválida para este job.');
    const mudanca = {};
    if (req.body?.pausado !== undefined) mudanca.pausado = req.body.pausado === true;
    if (req.body?.limite !== undefined) {
      if (instancia !== repo.TODAS) throw _erro(400, 'O limite é do job inteiro, não de uma instância.');
      mudanca.limite = req.body.limite === null || req.body.limite === '' ? null : _inteiro(req.body.limite, 1, LIMITE_MAX, 'Limite do job');
    }
    if (!Object.keys(mudanca).length) throw _erro(400, 'Nada para alterar.');
    repo.salvarControle(def.id, instancia, mudanca, { usuario: _usuario(req) });
    const alvo = instancia === repo.TODAS ? `${def.nome || def.id} (todas as empresas)` : painel.rotuloInstancia(def.id, instancia);
    const partes = [];
    if (mudanca.pausado !== undefined) partes.push(mudanca.pausado ? 'pausado' : 'retomado');
    if (mudanca.limite !== undefined) partes.push(mudanca.limite ? `limite ${mudanca.limite} execução(ões) juntas` : 'sem limite próprio');
    registrarAcao(req, mudanca.pausado === true ? 'job_pausado' : mudanca.pausado === false ? 'job_retomado' : 'job_limite',
      `${alvo}: ${partes.join(', ')}.`, { jobId: def.id, instancia: instancia === repo.TODAS ? null : instancia, empresaId: instancia === repo.TODAS ? null : (def.empresaDaInstancia?.(instancia) ?? null) });
    return { ok: true };
  }));

  app.put(`${BASE}/config`, guarda, rota((req) => {
    const b = req.body || {};
    const atual = repo.getConfigJobs();
    const mudanca = {};
    if (b.modo !== undefined) {
      if (!['site', 'servico'].includes(b.modo)) throw _erro(400, 'Modo inválido.');
      if (b.modo === 'servico' && atual.modo !== 'servico' && !repo.estadoServico().ativo) {
        throw _erro(409, 'O serviço IAHub-Jobs não está dando sinal: suba o serviço no servidor antes de passar os jobs para ele.');
      }
      mudanca.modo = b.modo;
    }
    if (b.maxSimultaneos !== undefined) mudanca.maxSimultaneos = _inteiro(b.maxSimultaneos, 1, LIMITE_MAX, 'Execuções simultâneas');
    if (b.alertaFalhas !== undefined) mudanca.alertaFalhas = _inteiro(b.alertaFalhas, 1, 20, 'Falhas seguidas para alertar');
    if (b.alertaSemSinalMin !== undefined) mudanca.alertaSemSinalMin = _inteiro(b.alertaSemSinalMin, 1, 60, 'Minutos sem sinal');
    if (b.alertaEmpresaId !== undefined) {
      mudanca.alertaEmpresaId = b.alertaEmpresaId === null || b.alertaEmpresaId === '' ? null : Number(b.alertaEmpresaId);
      if (mudanca.alertaEmpresaId !== null && !empresasDb.buscarPorId(mudanca.alertaEmpresaId)) throw _erro(400, 'Empresa do alerta não encontrada.');
    }
    for (const campo of ['alertaGruposFalha', 'alertaGruposServico']) {
      if (b[campo] === undefined) continue;
      const grupos = (Array.isArray(b[campo]) ? b[campo] : []).map(g => String(g).trim()).filter(Boolean);
      if (grupos.length > 20 || grupos.some(g => !/^[\w-]{1,64}$/.test(g))) throw _erro(400, 'Grupos de alerta inválidos.');
      mudanca[campo] = [...new Set(grupos)];
    }
    if (!Object.keys(mudanca).length) throw _erro(400, 'Nada para alterar.');
    const salvo = repo.salvarConfigJobs(mudanca, { usuario: _usuario(req) });
    const NOMES = { modo: 'onde rodam', maxSimultaneos: 'execuções simultâneas', alertaFalhas: 'falhas para alertar', alertaSemSinalMin: 'minutos sem sinal', alertaEmpresaId: 'empresa do alerta', alertaGruposFalha: 'grupos de falha de job', alertaGruposServico: 'grupos do serviço' };
    const descricao = Object.entries(mudanca).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(atual[k]))
      .map(([k, v]) => `${NOMES[k]}: ${k === 'modo' ? (v === 'servico' ? 'Serviço IAHub-Jobs' : 'Site') : Array.isArray(v) ? `${v.length} grupo(s)` : v ?? '—'}`);
    if (descricao.length) registrarAcao(req, mudanca.modo !== undefined && mudanca.modo !== atual.modo ? 'modo_alterado' : 'config_alterada', `Configuração alterada — ${descricao.join('; ')}.`);
    return { config: salvo };
  }));

  // ── Aba Serviço: controle do serviço Windows e log (modelo do WhatsApp) ──
  app.get(`${BASE}/servico`, guarda, semCache, rota(async () => ({
    windows: await servicoWindows.status(),
    sinal: repo.estadoServico(),
    modo: repo.getConfigJobs().modo,
  })));

  // A escolha do modo só muda pela configuração, nunca por ações no serviço.
  app.post(`${BASE}/servico/:acao`, guarda, rota(async (req) => {
    const acao = req.params.acao;
    const usuario = _usuario(req);
    const acoes = {
      instalar: ['instalar', servicoWindows.instalar, 'Serviço instalado'],
      desinstalar: ['desinstalar', servicoWindows.desinstalar, 'Serviço desinstalado'],
      iniciar: ['iniciar', servicoWindows.iniciar, 'Serviço iniciado'],
      parar: ['parar', servicoWindows.parar, 'Parada do serviço pedida (ele termina as execuções em até 45 s)'],
    };
    if (!acoes[acao]) throw _erro(404, 'Ação desconhecida.');
    const [nome, fn, texto] = acoes[acao];
    const reassumirSite = (acao === 'parar' || acao === 'desinstalar') && repo.getConfigJobs().modo === 'servico';
    try {
      repo.registrarLog('system', `${texto.split(' (')[0]} pela tela por ${usuario}…`);
      const windows = await fn();
      repo.registrarLog(acao === 'parar' || acao === 'desinstalar' ? 'warning' : 'success', `${texto} por ${usuario}.${reassumirSite ? ' O modo Serviço permanece escolhido; o Site reassume enquanto o serviço estiver sem sinal.' : ''}`);
      registrarAcao(req, `servico_${nome}`, `${texto} pela tela.${reassumirSite ? ' Modo Serviço preservado; Site reassume enquanto o serviço estiver sem sinal.' : ''}`);
      return { windows, modo: repo.getConfigJobs().modo };
    } catch (err) {
      repo.registrarLog('error', `Falha ao ${nome} o serviço (${usuario}): ${err.message}`);
      repo.registrarEvento({ nivel: 'erro', tipo: `servico_${nome}_falhou`, texto: `Falha ao ${nome} o serviço: ${err.message}`, usuario });
      throw err.status ? err : _erro(500, err.message);
    }
  }));

  app.get(`${BASE}/log`, guarda, semCache, rota((req) => {
    const linhas = repo.listarLog({ aposId: req.query.apos ?? null, limite: req.query.limite || 500 });
    return { linhas, ultimoId: linhas.length ? linhas[linhas.length - 1].id : (req.query.apos ? Number(req.query.apos) : 0) };
  }));

  app.post(`${BASE}/log/limpar`, guarda, rota((req) => {
    const removidas = repo.limparLog();
    repo.registrarLog('system', `Log limpo por ${_usuario(req)}.`);
    registrarAcao(req, 'log_limpo', `Log do serviço limpo (${removidas} linha(s)).`);
    return { removidas };
  }));

  app.get(`${BASE}/alerta/grupos`, guarda, semCache, rota(async (req) => {
    const empresaId = Number(req.query.empresa_id || 0);
    if (!empresaId) throw _erro(400, 'Informe a empresa.');
    try {
      return await alerta.listarGrupos(empresaId);
    } catch (err) {
      throw _erro(502, `Não foi possível ler os grupos do IA Command: ${err.message}`);
    }
  }));

  app.post(`${BASE}/alerta/testar`, guarda, rota(async (req) => {
    const r = await alerta.enviar(`🧪 Teste de alerta pedido por ${_usuario(req)} na tela Jobs.`, { tipo: 'teste', referencia: 'teste', usuario: _usuario(req) });
    if (!r.enviado) throw _erro(400, `Alerta de teste não enviado: ${r.motivo}.`);
    return { ok: true };
  }));
}

module.exports = { registrar };

const crud = require('./database/crud');
const { getDB } = require('./database');
const { requireRotina, requireAnyRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');
const { normalizarTexto } = require('./ai/local-intent-resolver');
const messageTemplates = require('./whatsapp/message-templates');
const usageDb = require('./ai/usage-db');
const empresasDb = require('../../../modules/empresas/database');
const sistemasDb = require('../../../modules/sistemas/database');
const permissoesDb = require('../../../modules/permissoes/database');

module.exports = function registrarRotasAdmin(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return getEmpresaId(req); }
  const canModulos   = requireRotina('iac-admin-modulos');
  const canNumeros   = requireRotina('iac-admin-numeros-whatsapp');
  const canMensagens = requireRotina('iac-admin-mensagens-whatsapp');
  const canIntencoes = requireRotina('iac-admin-intencoes');
  const canDatasets  = requireRotina('iac-admin-datasets');
  const canExecucoes = requireRotina('iac-admin-execucoes');
  const canAuditoria = requireRotina('iac-admin-auditoria');
  const canSpecFeedback = requireRotina('iac-admin-spec-feedback');
  const canLogsConsultas = requireRotina('iac-admin-logs-consultas');
  const canLerModulos = requireAnyRotina(['iac-admin-modulos', 'iac-admin-intencoes', 'iac-admin-datasets']);
  const canDatasetsEIntencoes = requireAnyRotina(['iac-admin-datasets', 'iac-admin-intencoes']);

  function _audit(req, acao, detalhes) {
    try {
      crud.criar('audit_log', {
        empresa_id: eid(req),
        usuario:    req.session.username || req.session.user || 'sistema',
        acao,
        detalhes:   typeof detalhes === 'object' ? JSON.stringify(detalhes) : String(detalhes),
        ip:         req.ip || req.socket?.remoteAddress || '',
      });
    } catch (_) {}
  }

  function _invalidateIntentCache(empresaId) {
    try {
      require('./ai/intent-service').invalidateCache(empresaId);
    } catch (_) {}
  }

  function _whereLogModuloDinamico(modulo) {
    const intencao = `${modulo}_dinamico`;
    return {
      where: `(
        intencao = ?
        OR intent_json LIKE ?
        OR trace_json LIKE ?
        OR dataset_nome = ?
      )`,
      params: [
        intencao,
        `%"_moduloDinamico":"${modulo}"%`,
        `%"modulo":"${modulo}"%`,
        modulo,
      ],
    };
  }

  function normalizarNumero(numero) {
    return String(numero || '').replace(/\D/g, '');
  }

  function _empresaPermitida(req, empresaId, rotina) {
    const id = Number(empresaId);
    const sess = req.session || {};
    const temEmpresa = sess.role === 'admin' || sess.empresas === 'all' ||
      (Array.isArray(sess.empresas) && sess.empresas.includes(id));
    if (!temEmpresa) return false;
    if (!sistemasDb.hasCompanySystem(id, 'ia-command')) return false;
    if (sess.role === 'admin') return true;
    if (!sistemasDb.hasUserSystem(sess.user_id, id, 'ia-command')) return false;
    const rotinas = permissoesDb.getRotinas(sess.user_id, id);
    return Array.isArray(rotinas) && rotinas.includes(rotina);
  }

  function _empresasPermitidas(req, rotina = 'iac-admin-numeros-whatsapp') {
    const sess = req.session || {};
    const idsBase = sess.role === 'admin' || sess.empresas === 'all'
      ? empresasDb.listar().map(e => Number(e.id))
      : Array.isArray(sess.empresas) ? sess.empresas.map(Number) : [eid(req)];
    const vistos = new Set();
    return idsBase
      .filter(id => id && !vistos.has(id) && (vistos.add(id), true))
      .filter(id => _empresaPermitida(req, id, rotina))
      .map(id => {
        const emp = empresasDb.buscarPorId(id) || {};
        return { id, nome: emp.nome || emp.razao_social || `Empresa #${id}` };
      });
  }

  function _idsEmpresasPermitidas(req, rotina = 'iac-admin-auditoria') {
    const ids = _empresasPermitidas(req, rotina).map(e => Number(e.id)).filter(Boolean);
    if (ids.length) return ids;
    const atual = Number(eid(req));
    return atual ? [atual] : [];
  }

  function _whereEmpresasPermitidas(req, rotina = 'iac-admin-auditoria') {
    const ids = _idsEmpresasPermitidas(req, rotina);
    if (!ids.length) return { where: '1 = 0', params: [], ids };
    return {
      where: `empresa_id IN (${ids.map(() => '?').join(',')})`,
      params: ids,
      ids,
    };
  }

  function _empresasNlsqlDoCanal(req, rotina = 'iac-admin-auditoria') {
    const channelStore = require('./whatsapp/channel-store');
    const empresaAtual = eid(req);
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const channelIdReq = String(src.channel_id || '').trim();
    const numeroWa = String(src.numero_wa || src.numero || '').trim();
    const canal = channelIdReq
      ? channelStore.buscarCanalDaEmpresa(channelIdReq, empresaAtual)
      : (channelStore.getDefaultForEmpresa(empresaAtual) || channelStore.ensureDefaultForEmpresa(empresaAtual));
    const empresasCanal = canal?.id
      ? channelStore.listarEmpresasDoCanal(canal.id)
      : [{ empresa_id: empresaAtual, nome: `Empresa #${empresaAtual}` }];
    const empresas = empresasCanal
      .filter(e => _empresaPermitida(req, Number(e.empresa_id), rotina))
      .filter(e => !numeroWa || channelStore.senderAutorizadoEmpresa(Number(e.empresa_id), numeroWa))
      .map(e => ({ id: Number(e.empresa_id), nome: e.nome || `Empresa #${e.empresa_id}` }));
    const fallback = empresas.length || numeroWa
      ? empresas
      : _empresasPermitidas(req, rotina).filter(e => Number(e.id) === Number(empresaAtual));
    return { canal, empresas: fallback };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MÓDULOS DE INTENÇÃO
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/modulos', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const rows = crud.listar('intention_modules', { empresa_id: eid(req) });
    res.json(rows);
  });

  // Listagem pública (para selects nos formulários de intenção)
  app.get('/api/ia-command/modulos', requireAuth, requireIaCommand, canLerModulos, (req, res) => {
    const rows = crud.listar('intention_modules', { empresa_id: eid(req), ativo: 1 });
    res.json(rows);
  });

  app.get('/api/ia-command/admin/modulos/:id', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const row = crud.buscarPorId('intention_modules', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/modulos', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const { nome, descricao, cor, ativo } = req.body;
    if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome.' });
    const row = crud.criar('intention_modules', {
      empresa_id: eid(req),
      nome:       nome.trim(),
      descricao:  descricao || null,
      cor:        cor       || '#7c3aed',
      ativo:      ativo !== false ? 1 : 0,
    });
    _audit(req, 'criar_modulo', { id: row.id, nome: row.nome });
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/modulos/:id', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const existing = crud.buscarPorId('intention_modules', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'descricao', 'cor', 'ativo'];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    const row = crud.atualizar('intention_modules', req.params.id, campos);
    _audit(req, 'editar_modulo', { id: req.params.id, campos: Object.keys(campos) });
    res.json(row);
  });

  app.delete('/api/ia-command/admin/modulos/:id', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const existing = crud.buscarPorId('intention_modules', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('intention_modules', req.params.id);
    _audit(req, 'excluir_modulo', { id: req.params.id, nome: existing.nome });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // NUMEROS WHATSAPP AUTORIZADOS
  // ---------------------------------------------------------------------------

  app.get('/api/ia-command/admin/numeros-whatsapp', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    // Traz apenas números com acesso ativo nesta empresa — números pré-cadastrados
    // em outras empresas (ativo=0 aqui) não são listados nem editáveis por esta tela.
    const rows = crud.listar('whatsapp_allowed_numbers', { empresa_id: eid(req), ativo: 1 });
    res.json(rows);
  });

  function _listarAcessosNumero(numero, empresas) {
    const ids = empresas.map(e => Number(e.id)).filter(Boolean);
    if (!ids.length) return { numero, empresas: [], acessos: [] };
    const placeholders = ids.map(() => '?').join(',');
    const rows = getDB().prepare(`
      SELECT *
        FROM whatsapp_allowed_numbers
       WHERE numero = ?
         AND empresa_id IN (${placeholders})
       ORDER BY empresa_id, nome
    `).all(numero, ...ids);
    const empresasPorId = new Map(empresas.map(e => [Number(e.id), e]));
    return {
      numero,
      empresas,
      acessos: rows.map(row => ({
        ...row,
        empresa_nome: empresasPorId.get(Number(row.empresa_id))?.nome || `Empresa #${row.empresa_id}`,
      })),
    };
  }

  function _salvarAcessosNumero(req, numero, nomePadrao, empresasPayload) {
    const db = getDB();
    const agora = new Date().toISOString();
    const select = db.prepare('SELECT * FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND numero = ?');
    const insert = db.prepare(`
      INSERT INTO whatsapp_allowed_numbers
        (id, empresa_id, nome, numero, observacoes, ativo, modulo_financeiro, modulo_compras, modulo_faturamento, modulo_comissao, modulo_estoque, erp_tipo, erp_id, cod_aprov_erp, cod_cliente_erp, criado_em, atualizado_em)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = db.prepare(`
      UPDATE whatsapp_allowed_numbers
         SET nome = COALESCE(NULLIF(?, ''), nome),
             observacoes = ?,
             ativo = ?,
             modulo_financeiro = ?,
             modulo_compras = ?,
             modulo_faturamento = ?,
             modulo_comissao = ?,
             modulo_estoque = ?,
             erp_tipo = ?,
             erp_id = ?,
             cod_aprov_erp = ?,
             cod_cliente_erp = ?,
             atualizado_em = ?
       WHERE id = ?
    `);

    const aplicar = db.transaction(() => {
      const atualizados = [];
      for (const item of empresasPayload) {
        const empresaId = Number(item.empresa_id || item.id || 0);
        if (!empresaId) continue;
        if (!_empresaPermitida(req, empresaId, 'iac-admin-numeros-whatsapp')) {
          throw Object.assign(new Error(`Sem permissao para empresa ${empresaId}.`), { statusCode: 403 });
        }
        const existente = select.get(empresaId, numero);
        const autorizado = item.autorizado !== false && Number(item.autorizado) !== 0;
        const campos = _extrairCamposNumeroWa(item);
        const ativo = autorizado ? (campos.ativo !== undefined ? campos.ativo : 1) : 0;
        const nome = String(item.nome || nomePadrao).trim();
        const observacoes = item.observacoes !== undefined ? (item.observacoes || null) : (existente?.observacoes || null);
        // IMPORTANTE: usar "campo in campos" (nao ??) para distinguir "campo ausente do
        // payload" (mantem valor existente) de "campo presente mas vazio" (limpa para
        // null). Com ??, null explicito (usuario apagou o campo) seria confundido com
        // "nao enviado" e o valor antigo nunca seria removido.
        const erpTipo = 'erp_tipo' in campos ? campos.erp_tipo : (existente?.erp_tipo ?? null);
        const erpId = 'erp_id' in campos ? campos.erp_id : (existente?.erp_id ?? null);
        const codAprovErp = 'cod_aprov_erp' in campos ? campos.cod_aprov_erp : (existente?.cod_aprov_erp ?? null);
        const codClienteErp = 'cod_cliente_erp' in campos ? campos.cod_cliente_erp : (existente?.cod_cliente_erp ?? null);
        if (existente) {
          update.run(
            nome,
            observacoes,
            ativo,
            campos.modulo_financeiro ?? existente.modulo_financeiro ?? 0,
            campos.modulo_compras ?? existente.modulo_compras ?? 0,
            campos.modulo_faturamento ?? existente.modulo_faturamento ?? 0,
            campos.modulo_comissao ?? existente.modulo_comissao ?? 0,
            campos.modulo_estoque ?? existente.modulo_estoque ?? 0,
            erpTipo,
            erpId,
            codAprovErp,
            codClienteErp,
            agora,
            existente.id
          );
          atualizados.push(existente.id);
        } else if (autorizado) {
          const id = require('crypto').randomUUID();
          insert.run(
            id,
            empresaId,
            nome,
            numero,
            observacoes,
            ativo,
            campos.modulo_financeiro ?? 0,
            campos.modulo_compras ?? 0,
            campos.modulo_faturamento ?? 0,
            campos.modulo_comissao ?? 0,
            campos.modulo_estoque ?? 0,
            erpTipo,
            erpId,
            codAprovErp,
            codClienteErp,
            agora,
            agora
          );
          atualizados.push(id);
        }
      }
      return atualizados;
    });
    return aplicar();
  }

  app.get('/api/ia-command/admin/numeros-whatsapp/contatos/:numero', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const numero = normalizarNumero(req.params.numero);
    if (!numero) return res.status(400).json({ error: 'Numero invalido.' });
    const empresaId = eid(req);
    if (!_empresaPermitida(req, empresaId, 'iac-admin-numeros-whatsapp')) {
      return res.json({ numero, empresas: [], acessos: [] });
    }
    const emp = empresasDb.buscarPorId(empresaId) || {};
    const empresas = [{ id: empresaId, nome: emp.nome || emp.razao_social || `Empresa #${empresaId}` }];
    res.json(_listarAcessosNumero(numero, empresas));
  });

  app.get('/api/ia-command/admin/numeros-whatsapp/contatos/:numero/empresas-global', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const numero = normalizarNumero(req.params.numero);
    if (!numero) return res.status(400).json({ error: 'Numero invalido.' });
    const empresas = _empresasPermitidas(req, 'iac-admin-numeros-whatsapp');
    res.json(_listarAcessosNumero(numero, empresas));
  });

  app.put('/api/ia-command/admin/numeros-whatsapp/contatos/:numero/empresas', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const numero = normalizarNumero(req.params.numero);
    const nomePadrao = String(req.body?.nome || '').trim() || 'Contato WhatsApp';
    const empresasPayload = Array.isArray(req.body?.empresas) ? req.body.empresas : [];
    if (!numero) return res.status(400).json({ error: 'Numero invalido.' });
    if (!empresasPayload.length) return res.status(400).json({ error: 'Informe ao menos uma empresa.' });
    if (empresasPayload.some(item => Number(item.empresa_id || item.id || 0) !== eid(req))) {
      return res.status(403).json({ error: 'Este cadastro permite alterar apenas a empresa atual.' });
    }

    try {
      const ids = _salvarAcessosNumero(req, numero, nomePadrao, empresasPayload);
      _audit(req, 'editar_acessos_numero_whatsapp', { numero, ids, empresas: empresasPayload.map(e => e.empresa_id || e.id) });
      res.json({ ok: true, atualizados: ids.length });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put('/api/ia-command/admin/numeros-whatsapp/contatos/:numero/empresas-global', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const numero = normalizarNumero(req.params.numero);
    const nomePadrao = String(req.body?.nome || '').trim() || 'Contato WhatsApp';
    const empresasPayload = Array.isArray(req.body?.empresas) ? req.body.empresas : [];
    if (!numero) return res.status(400).json({ error: 'Numero invalido.' });
    if (!empresasPayload.length) return res.status(400).json({ error: 'Informe ao menos uma empresa.' });

    try {
      const ids = _salvarAcessosNumero(req, numero, nomePadrao, empresasPayload);
      _audit(req, 'editar_acessos_globais_numero_whatsapp', { numero, ids, empresas: empresasPayload.map(e => e.empresa_id || e.id) });
      res.json({ ok: true, atualizados: ids.length });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/admin/numeros-whatsapp/:id', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const row = crud.buscarPorId('whatsapp_allowed_numbers', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });
    res.json(row);
  });

  function _extrairCamposNumeroWa(body, opts = {}) {
    const incluirPermissoes = opts.incluirPermissoes !== false;
    const incluirAtivo = opts.incluirAtivo !== false;
    const campos = {};
    if (body.observacoes !== undefined) campos.observacoes = body.observacoes || null;
    if (incluirAtivo && body.ativo !== undefined) campos.ativo = body.ativo !== false && Number(body.ativo) !== 0 ? 1 : 0;
    if (!incluirPermissoes) return campos;
    // Autorizações por módulo
    for (const m of ['financeiro', 'compras', 'faturamento', 'comissao', 'estoque']) {
      const chave = `modulo_${m}`;
      if (body[chave] !== undefined) campos[chave] = body[chave] ? 1 : 0;
    }
    // Codigos ERP — erp_tipo 'usuario' habilita os campos abaixo (codigo de vendedor via
    // erp_id); 'gestor' zera todos os filtros. cod_aprov_erp e cod_cliente_erp sao
    // independentes de erp_tipo — o mesmo numero pode ser usuario (vendedor) E aprovador
    // E cliente simultaneamente, cada um com seu proprio codigo.
    if (body.erp_tipo !== undefined) {
      const tipo = String(body.erp_tipo || '').trim().toLowerCase();
      campos.erp_tipo = ['usuario', 'gestor'].includes(tipo) ? tipo : null;
    }
    if (body.erp_id !== undefined) {
      campos.erp_id = String(body.erp_id || '').trim().toUpperCase() || null;
    }
    // Codigo de aprovador ERP (SCR.CR_APROV/SAK.AK_COD) — independente de erp_tipo/erp_id,
    // permite o mesmo numero ser vendedor E aprovador simultaneamente.
    if (body.cod_aprov_erp !== undefined) {
      campos.cod_aprov_erp = String(body.cod_aprov_erp || '').trim().toUpperCase() || null;
    }
    // Codigo de cliente ERP (E1_CLIENTE/F2_CLIENTE) — independente de erp_tipo/erp_id,
    // restringe faturamento e contas a receber aos proprios dados do cliente.
    if (body.cod_cliente_erp !== undefined) {
      campos.cod_cliente_erp = String(body.cod_cliente_erp || '').trim().toUpperCase() || null;
    }
    return campos;
  }

  app.post('/api/ia-command/admin/numeros-whatsapp', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const { nome, numero } = req.body;
    const numeroNormalizado = normalizarNumero(numero);
    if (!nome) return res.status(400).json({ error: 'Campo obrigatorio: nome.' });
    if (!numeroNormalizado) return res.status(400).json({ error: 'Campo obrigatorio: numero.' });
    if (numeroNormalizado.length < 10 || numeroNormalizado.length > 15) {
      return res.status(400).json({ error: 'Informe o numero com DDI e DDD, contendo entre 10 e 15 digitos.' });
    }

    const camposExtras = _extrairCamposNumeroWa(req.body, { incluirPermissoes: false, incluirAtivo: false });

    // Se este número já tem uma linha para esta empresa (ex.: pré-associado via
    // "Gerenciar em outras empresas" e ainda inativo), reativa em vez de tentar
    // recriar — evita erro 409 e o beco-sem-saída de números invisíveis na grade.
    const existente = getDB()
      .prepare('SELECT * FROM whatsapp_allowed_numbers WHERE empresa_id = ? AND numero = ?')
      .get(eid(req), numeroNormalizado);

    try {
      if (existente) {
        const row = crud.atualizar('whatsapp_allowed_numbers', existente.id, {
          nome: nome.trim(),
          ativo: 1,
          ...camposExtras,
        });
        _audit(req, 'reativar_numero_whatsapp', { id: row.id, nome: row.nome, numero: row.numero });
        return res.status(200).json(row);
      }

      const row = crud.criar('whatsapp_allowed_numbers', {
        empresa_id: eid(req),
        nome:       nome.trim(),
        numero:     numeroNormalizado,
        ativo:      1, // todo número nasce associado e ativo na empresa atual — nunca fica "sem empresa"
        ...camposExtras,
      });
      _audit(req, 'criar_numero_whatsapp', { id: row.id, nome: row.nome, numero: row.numero });
      res.status(201).json(row);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Este numero ja esta cadastrado para esta empresa.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/ia-command/admin/numeros-whatsapp/:id', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const existing = crud.buscarPorId('whatsapp_allowed_numbers', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });

    const campos = {};
    if (req.body.nome !== undefined) {
      if (!String(req.body.nome || '').trim()) return res.status(400).json({ error: 'Campo obrigatorio: nome.' });
      campos.nome = String(req.body.nome).trim();
    }
    if (req.body.numero !== undefined) {
      const numeroNormalizado = normalizarNumero(req.body.numero);
      if (!numeroNormalizado) return res.status(400).json({ error: 'Campo obrigatorio: numero.' });
      if (numeroNormalizado.length < 10 || numeroNormalizado.length > 15) {
        return res.status(400).json({ error: 'Informe o numero com DDI e DDD, contendo entre 10 e 15 digitos.' });
      }
      campos.numero = numeroNormalizado;
    }
    Object.assign(campos, _extrairCamposNumeroWa(req.body, { incluirPermissoes: false, incluirAtivo: false }));

    try {
      const row = crud.atualizar('whatsapp_allowed_numbers', req.params.id, campos);
      _audit(req, 'editar_numero_whatsapp', { id: req.params.id, campos: Object.keys(campos) });
      res.json(row);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Este numero ja esta cadastrado para esta empresa.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ia-command/admin/numeros-whatsapp/:id', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const existing = crud.buscarPorId('whatsapp_allowed_numbers', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });
    crud.excluir('whatsapp_allowed_numbers', req.params.id);
    _audit(req, 'excluir_numero_whatsapp', { id: req.params.id, nome: existing.nome, numero: existing.numero });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // TEMPLATES INTERNOS DE MENSAGENS WHATSAPP
  // ---------------------------------------------------------------------------

  app.get('/api/ia-command/admin/mensagens-whatsapp/padroes', requireAuth, requireIaCommand, canMensagens, (_req, res) => {
    res.json(messageTemplates.listarPadroes());
  });

  app.get('/api/ia-command/admin/mensagens-whatsapp', requireAuth, requireIaCommand, canMensagens, (req, res) => {
    const empId = eid(req);
    const rows = crud.listar('whatsapp_message_templates', { empresa_id: empId });
    const cadastrados = new Map(rows.map(r => [r.chave, r]));
    const lista = messageTemplates.listarPadroes().map(p => {
      const row = cadastrados.get(p.chave);
      return {
        id: row?.id || null,
        empresa_id: empId,
        chave: p.chave,
        titulo: row?.titulo || p.titulo,
        template: row?.template || p.template_padrao,
        template_padrao: p.template_padrao,
        ativo: row?.ativo ?? 1,
        customizado: row ? 1 : 0,
        criado_em: row?.criado_em || null,
        atualizado_em: row?.atualizado_em || null,
      };
    });
    res.json(lista);
  });

  app.get('/api/ia-command/admin/mensagens-whatsapp/:chave', requireAuth, requireIaCommand, canMensagens, (req, res) => {
    const empId = eid(req);
    const chave = String(req.params.chave || '').trim();
    const row = crud.listar('whatsapp_message_templates', { empresa_id: empId, chave })[0] || null;
    const def = messageTemplates.getDefault(chave);
    res.json({
      id: row?.id || null,
      empresa_id: empId,
      chave,
      titulo: row?.titulo || def.titulo,
      template: row?.template || def.template,
      template_padrao: def.template,
      ativo: row?.ativo ?? 1,
      customizado: row ? 1 : 0,
    });
  });

  app.put('/api/ia-command/admin/mensagens-whatsapp/:chave', requireAuth, requireIaCommand, canMensagens, (req, res) => {
    const empId = eid(req);
    const chave = String(req.params.chave || '').trim();
    const def = messageTemplates.getDefault(chave);
    if (!def.template && !req.body.template) return res.status(404).json({ error: 'Template nao encontrado.' });

    const template = String(req.body.template || '').trim();
    if (!template) return res.status(400).json({ error: 'Campo obrigatorio: template.' });

    const existing = crud.listar('whatsapp_message_templates', { empresa_id: empId, chave })[0] || null;
    const payload = {
      empresa_id: empId,
      chave,
      titulo: String(req.body.titulo || def.titulo || chave).trim(),
      template,
      ativo: req.body.ativo !== false && Number(req.body.ativo) !== 0 ? 1 : 0,
    };

    const row = existing
      ? crud.atualizar('whatsapp_message_templates', existing.id, payload)
      : crud.criar('whatsapp_message_templates', payload);
    _audit(req, existing ? 'editar_template_whatsapp' : 'criar_template_whatsapp', { chave, id: row.id });
    res.json(row);
  });

  app.delete('/api/ia-command/admin/mensagens-whatsapp/:chave', requireAuth, requireIaCommand, canMensagens, (req, res) => {
    const empId = eid(req);
    const chave = String(req.params.chave || '').trim();
    const existing = crud.listar('whatsapp_message_templates', { empresa_id: empId, chave })[0] || null;
    if (existing) {
      crud.excluir('whatsapp_message_templates', existing.id);
      _audit(req, 'restaurar_template_whatsapp', { chave, id: existing.id });
    }
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // INTENÇÕES
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/intencoes', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    try { require('./ai/intent-service')._garantirIntencoesDinamicasPadrao(eid(req)); } catch (_) {}
    const rows = crud.listar('intentions', { empresa_id: eid(req) });
    res.json(rows);
  });

  app.get('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    const row = crud.buscarPorId('intentions', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/intencoes', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    const { nome, descricao, modulo, acao, dataset_id, frases_exemplo, ativo, erp } = req.body;
    if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome.' });
    const row = crud.criar('intentions', {
      empresa_id:     eid(req),
      nome:           nome.trim(),
      descricao:      descricao || null,
      modulo:         modulo   || null,
      acao:           acao     || null,
      dataset_id:     dataset_id || null,
      frases_exemplo: frases_exemplo || null,
      ativo:          ativo !== false ? 1 : 0,
      erp:            erp || 'protheus',
    });
    _audit(req, 'criar_intencao', { id: row.id, nome: row.nome });
    _invalidateIntentCache(eid(req));
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    const existing = crud.buscarPorId('intentions', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'descricao', 'modulo', 'acao', 'dataset_id', 'frases_exemplo', 'ativo', 'erp'];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    const row = crud.atualizar('intentions', req.params.id, campos);
    _audit(req, 'editar_intencao', { id: req.params.id, campos: Object.keys(campos) });
    _invalidateIntentCache(eid(req));
    res.json(row);
  });

  app.delete('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    const existing = crud.buscarPorId('intentions', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('intentions', req.params.id);
    _audit(req, 'excluir_intencao', { id: req.params.id, nome: existing.nome });
    _invalidateIntentCache(eid(req));
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // DATASETS
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/datasets', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const rows = crud.listar('datasets', { empresa_id: eid(req) });
    res.json(rows);
  });

  // ── PREVIEW SQL — executa sem salvar, retorna primeiras 100 linhas ──────────
  app.post('/api/ia-command/admin/datasets/preview-sql', requireAuth, requireIaCommand, canDatasets, async (req, res) => {
    const { sql_base, conexao_id } = req.body;
    const tipoDataset = String(req.body?.tipo || 'sql_base').trim().toLowerCase();
    const usarAgenteLocal = tipoDataset === 'view_semantica';
    if (!sql_base?.trim()) return res.status(400).json({ error: 'sql_base é obrigatório.' });

    const factory = require('./erp/providers/connection-factory');
    let conn;
    try {
      if (usarAgenteLocal) {
        conn = factory.carregarConexao(eid(req), { connectionId: conexao_id || null });
        if (String(conn.tipo || '').toLowerCase() !== 'api_proxy') {
          return res.status(400).json({ error: 'View semantica deve ser testada pelo Agente Local. Ative e configure o Agente Local desta empresa antes de executar o preview.' });
        }
        conn._empresa_id = String(eid(req));
      } else if (conexao_id) {
        const crud2 = require('./database/crud');
        conn = crud2.buscarPorId('connections', conexao_id);
        if (!conn || conn.empresa_id !== eid(req)) return res.status(404).json({ error: 'Conexão não encontrada.' });
      } else {
        conn = factory.carregarConexao(eid(req));
      }
    } catch (err) {
      return res.status(400).json({ error: `Sem conexão ERP disponível: ${err.message}` });
    }

    const isPg  = ['postgresql', 'postgres'].includes((conn.tipo || '').toLowerCase());
    const wrapper = isPg
      ? `SELECT * FROM (\n${sql_base}\n) AS _base LIMIT 100`
      : `SELECT TOP 100 *\nFROM (\n${sql_base}\n) AS _base`;

    try {
      const rows    = await factory.executar(conn, wrapper, {});
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const conexaoLabel = usarAgenteLocal
        ? `Agente Local${conn._connection_nome ? ` / ${conn._connection_nome}` : ''}${conn._agente_url ? ` (${conn._agente_url})` : ''}`
        : (conn.nome || conn.id || conn.tipo);
      _audit(req, 'preview_sql', { linhas: rows.length, conexao: conexaoLabel, tipo: tipoDataset });
      res.json({ columns, rows, total: rows.length, conexao: conexaoLabel });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── SUGERIR CAMPOS SEMÂNTICOS COM IA — usa nomes de coluna + amostra do preview já
  // executado para propor tipo/descrição/sinônimos/uso; usuário revisa antes de salvar.
  // Colunas candidatas a "baixa cardinalidade" (status/categoria) dentro da amostra recebida:
  // poucos valores distintos repetidos entre as linhas de exemplo. Não é definitivo (a amostra
  // é pequena), só decide para quais colunas vale a pena consultar os valores reais no banco.
  function _colunasCandidatasADistinct(columns = [], rows = []) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    return columns.filter(col => {
      const valores = rows.map(r => r?.[col]).filter(v => v !== null && v !== undefined && v !== '');
      if (valores.length < 2) return false;
      const distintos = new Set(valores.map(v => String(v)));
      // Repetiu algum valor na amostra pequena e nenhum valor é longo demais para ser categoria.
      return distintos.size < valores.length && [...distintos].every(v => v.length <= 40);
    });
  }

  async function _buscarValoresReais({ empresaId, dataset, conexaoId, colunas }) {
    if (!dataset?.sql_base || !colunas.length) return {};
    const factory = require('./erp/providers/connection-factory');
    let conn;
    try {
      conn = factory.carregarConexao(empresaId, { connectionId: conexaoId || dataset.connection_id || null });
      if (String(conn.tipo || '').toLowerCase() !== 'api_proxy') return {};
    } catch (_) {
      return {};
    }
    const valoresPorColuna = {};
    for (const coluna of colunas.slice(0, 8)) { // limite defensivo: no máx. 8 consultas extras
      try {
        conn._modulo = 'sugestao_valores_distintos';
        conn._operacao = 'debug';
        const sql = `SELECT TOP 20 [${coluna}] AS valor, COUNT(*) AS qtd FROM (\n${dataset.sql_base}\n) AS _base GROUP BY [${coluna}] ORDER BY qtd DESC`;
        const linhas = await factory.executar(conn, sql, {});
        if (Array.isArray(linhas) && linhas.length) {
          valoresPorColuna[coluna] = linhas.map(l => l.valor).filter(v => v !== null && v !== undefined);
        }
      } catch (_) {
        // Falha ao consultar uma coluna não deve travar as demais nem a sugestão como um todo.
      }
    }
    return valoresPorColuna;
  }

  app.post('/api/ia-command/admin/datasets/sugerir-campos-semanticos', requireAuth, requireIaCommand, canDatasets, async (req, res) => {
    const { columns, rows, dataset_id, conexao_id } = req.body || {};
    if (!Array.isArray(columns) || !columns.length) {
      return res.status(400).json({ error: 'Execute o preview do SQL Base antes de pedir sugestão de campos.' });
    }

    const aiProviderClient = require('./erp/core/ai-provider-client');
    let keys, cfg;
    try {
      ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(eid(req)));
    } catch (e) {
      return res.status(400).json({ error: `IA indisponível: ${e.message}` });
    }
    if (!Object.values(keys || {}).some(Boolean)) {
      return res.status(400).json({ error: 'Nenhuma chave de IA configurada para esta empresa (Configurações da IA).' });
    }

    const amostra = (Array.isArray(rows) ? rows.slice(0, 5) : []);

    let valoresReais = {};
    if (dataset_id) {
      const dataset = crud.buscarPorId('datasets', dataset_id);
      if (dataset && dataset.empresa_id === eid(req)) {
        const candidatas = _colunasCandidatasADistinct(columns, amostra);
        if (candidatas.length) {
          valoresReais = await _buscarValoresReais({ empresaId: eid(req), dataset, conexaoId: conexao_id, colunas: candidatas });
        }
      }
    }

    const systemPrompt = [
      'Voce e um especialista em modelagem semantica de dados para um sistema de IA que gera SQL a partir de perguntas em portugues.',
      'Receberá uma lista de colunas de uma consulta SQL, algumas linhas de exemplo dos dados reais, e — quando disponível — a lista COMPLETA dos valores distintos reais de colunas de baixa cardinalidade (ex: status).',
      'Para cada coluna, proponha metadados que ajudem uma IA a entender e usar essa coluna corretamente ao gerar SQL depois.',
      '',
      'Retorne SOMENTE JSON valido (sem markdown), no formato:',
      '{"campos": [{"coluna": string, "tipo": "metrica"|"dimensao"|"data"|"status"|"identificador"|"texto", "descricao": string, "sinonimos": string, "filtravel": 0|1, "agrupavel": 0|1, "ordenavel": 0|1, "regra": string}]}',
      '',
      'Regras de classificação de tipo:',
      '- "identificador": IDs tecnicos internos (ex: id_x, codigo_x) sem valor de negocio direto para o usuario final.',
      '- "metrica": valores numericos agregaveis (SUM, AVG), como horas, dias, valores monetarios, quantidades.',
      '- "data": qualquer coluna que representa uma data ou timestamp, mesmo que o nome nao contenha "data" explicitamente — use os valores de exemplo para confirmar.',
      '- "status": colunas que representam um estado/situacao (aberto, fechado, em atraso, etc).',
      '- "texto": texto livre longo (descricoes, observacoes) — nunca agrupavel.',
      '- "dimensao": os demais campos categorizaveis (nomes, categorias, codigos com significado de negocio).',
      '',
      'Regras de uso:',
      '- "agrupavel" e "filtravel" = 1 apenas quando fizer sentido de negocio (nunca marque texto livre longo como agrupavel).',
      '- "ordenavel" = 1 para metricas e datas, geralmente 0 para dimensões de texto.',
      '- Sinonimos: liste palavras que um usuario poderia usar numa pergunta em portugues para se referir a esse campo, separadas por virgula.',
      '- IMPORTANTE: quando "valores_reais_distintos" trouxer a lista de uma coluna, use EXATAMENTE esses valores (grafia, maiusculas/minusculas) no campo "regra", explicando o que cada valor significa em termos de negocio quando o nome do valor nao for autoexplicativo. Nunca invente um valor que nao esteja nessa lista.',
      '- Quando o nome da coluna for ambiguo ou o significado nao puder ser inferido com confianca a partir do nome e dos dados de exemplo, ainda assim proponha o melhor palpite, mas escreva no campo "regra" o texto "Significado a confirmar: " seguido de uma breve explicacao da incerteza.',
      '- Nao invente colunas que nao estao na lista recebida. Devolva exatamente uma entrada por coluna recebida, na mesma ordem.',
    ].join('\n');

    const userPrompt = JSON.stringify({ colunas: columns, amostra_dados: amostra, valores_reais_distintos: valoresReais });

    try {
      const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
        json: true,
        maxTokens: 4000,
        timeoutMs: 45000,
        logPrefix: 'DatasetCamposSemanticosIA',
      });
      let parsed;
      try {
        const texto = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        parsed = JSON.parse(texto);
      } catch (_) {
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
      }
      const campos = Array.isArray(parsed?.campos) ? parsed.campos : null;
      if (!campos) {
        return res.status(502).json({ error: 'A IA não retornou um JSON válido. Tente novamente.' });
      }
      _audit(req, 'sugerir_campos_semanticos_ia', { total_colunas: columns.length, colunas_com_valores_reais: Object.keys(valoresReais) });
      res.json({ campos, colunas_com_valores_reais: Object.keys(valoresReais) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const row = crud.buscarPorId('datasets', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  // ── SUGERIR INTENÇÃO A PARTIR DE UM DATASET — usa SQL Base + campos semânticos já
  // documentados para propor nome/descrição/frases_exemplo; erp e acao vêm do dataset por
  // regra fixa (nunca por IA). Usuário revisa e confirma no formulário de Intenções.
  app.post('/api/ia-command/admin/datasets/:id/sugerir-intencao', requireAuth, requireIaCommand, canDatasetsEIntencoes, async (req, res) => {
    const dataset = crud.buscarPorId('datasets', req.params.id);
    if (!dataset || dataset.empresa_id !== eid(req)) return res.status(404).json({ error: 'Dataset não encontrado.' });
    if (String(dataset.tipo || '') !== 'view_semantica') {
      return res.status(400).json({ error: 'Só é possível gerar intenção para datasets do tipo "SQL/View semântica".' });
    }
    if (!dataset.ativo_ia_owner) {
      return res.status(400).json({ error: 'Marque "Disponível para IA Owner" no dataset antes de gerar a intenção.' });
    }
    if (!dataset.modulo) {
      return res.status(400).json({ error: 'Preencha o campo Módulo do dataset antes de gerar a intenção.' });
    }

    const jaExiste = crud.listar('intentions', { empresa_id: eid(req) })
      .find(i => String(i.erp || 'protheus').toLowerCase() === String(dataset.erp || 'protheus').toLowerCase()
        && String(i.modulo || '').toLowerCase() === String(dataset.modulo || '').toLowerCase()
        && i.ativo !== 0);
    if (jaExiste) {
      return res.status(409).json({
        error: `Já existe a intenção "${jaExiste.nome}" ativa para o sistema "${dataset.erp || 'protheus'}" + módulo "${dataset.modulo}". Edite-a em vez de criar outra, para não gerar ambiguidade de roteamento.`,
        intencao_existente: { id: jaExiste.id, nome: jaExiste.nome },
      });
    }

    const campos = (() => { try { return JSON.parse(dataset.campos_semanticos_json || '[]'); } catch (_) { return []; } })();
    const aiProviderClient = require('./erp/core/ai-provider-client');
    let keys, cfg;
    try {
      ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(eid(req)));
    } catch (e) {
      return res.status(400).json({ error: `IA indisponível: ${e.message}` });
    }
    if (!Object.values(keys || {}).some(Boolean)) {
      return res.status(400).json({ error: 'Nenhuma chave de IA configurada para esta empresa (Configurações da IA).' });
    }

    const systemPrompt = [
      'Voce e um especialista em interpretacao de perguntas em portugues para um sistema de IA que classifica intencoes de usuarios do WhatsApp.',
      'Vai receber a descricao de um dataset (fonte de dados) com seus campos documentados, e deve propor os metadados de uma "intencao" que reconhece perguntas sobre esse dataset.',
      '',
      'Retorne SOMENTE JSON valido (sem markdown), no formato:',
      '{"nome": string, "descricao": string, "frases_exemplo": string[]}',
      '',
      'Regras:',
      '- "nome": snake_case, curto, unico, terminando com o nome do sistema de origem informado (ex: chamados_softexpert).',
      '- "descricao": uma frase objetiva descrevendo o que essa intencao cobre.',
      '- "frases_exemplo": entre 10 e 20 variações REALISTAS de perguntas que um usuario faria no WhatsApp sobre este dataset, cobrindo: contagens simples, filtro por cada dimensao/status relevante documentada, filtro por periodo, e pelo menos uma pergunta agrupando por uma dimensao.',
      '- Use os nomes de negocio (coluna/descricao/sinonimos/regra) documentados nos campos para gerar frases plausiveis — nao invente conceitos que nao estao documentados.',
      '- Nao inclua explicacoes fora do JSON.',
    ].join('\n');

    const userPrompt = JSON.stringify({
      sistema_origem: dataset.erp || 'protheus',
      modulo: dataset.modulo,
      nome_dataset: dataset.nome,
      descricao_view: dataset.view_descricao || null,
      campos_documentados: campos.map(c => ({
        coluna: c.coluna, tipo: c.tipo, descricao: c.descricao, sinonimos: c.sinonimos, regra: c.regra,
      })),
    });

    try {
      const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
        json: true,
        maxTokens: 2500,
        timeoutMs: 45000,
        logPrefix: 'DatasetSugerirIntencaoIA',
      });
      let parsed;
      try {
        const texto = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        parsed = JSON.parse(texto);
      } catch (_) {
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
      }
      if (!parsed || typeof parsed !== 'object' || !parsed.nome) {
        return res.status(502).json({ error: 'A IA não retornou um JSON válido. Tente novamente.' });
      }
      const sugestao = {
        nome: String(parsed.nome).trim(),
        descricao: String(parsed.descricao || '').trim(),
        frases_exemplo: Array.isArray(parsed.frases_exemplo)
          ? parsed.frases_exemplo.map(f => String(f || '').trim()).filter(Boolean).join('\n')
          : String(parsed.frases_exemplo || '').trim(),
        erp: dataset.erp || 'protheus',
        acao: 'ai_text_to_sql',
        modulo: dataset.modulo,
      };
      _audit(req, 'sugerir_intencao_ia', { dataset_id: dataset.id, dataset_nome: dataset.nome });
      res.json({ sugestao });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  const _datasetSemanticFields = [
    'tipo', 'modulo', 'spec', 'suboperacao', 'ativo_ia_owner', 'prioridade',
    'view_nome', 'view_descricao', 'view_grao', 'campos_semanticos_json',
    'regras_semanticas', 'exemplos_perguntas', 'limitacoes',
  ];

  function _normalizarDatasetPayload(body = {}) {
    const tipo = String(body.tipo || 'sql_base').trim() || 'sql_base';
    const campos = {
      nome:            body.nome ? String(body.nome).trim() : '',
      erp:             body.erp || 'protheus',
      connection_id:   body.connection_id ? String(body.connection_id).trim() : null,
      sql_base:        body.sql_base || null,
      campo_data:      String(body.campo_data || 'data').trim(),
      colunas_metrica: body.colunas_metrica ? String(body.colunas_metrica).trim() : null,
      limite_max:      parseInt(body.limite_max) || 1000,
      tipo,
      modulo:          body.modulo ? String(body.modulo).trim() : null,
      spec:            body.spec ? String(body.spec).trim() : null,
      suboperacao:     body.suboperacao ? String(body.suboperacao).trim() : null,
      ativo_ia_owner:  body.ativo_ia_owner ? 1 : 0,
      prioridade:      parseInt(body.prioridade) || 0,
      view_nome:       body.view_nome ? String(body.view_nome).trim() : null,
      view_descricao:  body.view_descricao ? String(body.view_descricao).trim() : null,
      view_grao:       body.view_grao ? String(body.view_grao).trim() : null,
      regras_semanticas:  body.regras_semanticas ? String(body.regras_semanticas).trim() : null,
      exemplos_perguntas: body.exemplos_perguntas ? String(body.exemplos_perguntas).trim() : null,
      limitacoes:         body.limitacoes ? String(body.limitacoes).trim() : null,
      campos_semanticos_json: body.campos_semanticos_json || null,
    };

    if (Array.isArray(body.campos_semanticos)) {
      campos.campos_semanticos_json = JSON.stringify(body.campos_semanticos);
    } else if (campos.campos_semanticos_json && typeof campos.campos_semanticos_json !== 'string') {
      campos.campos_semanticos_json = JSON.stringify(campos.campos_semanticos_json);
    }
    if (campos.campos_semanticos_json) campos.campos_semanticos_json = String(campos.campos_semanticos_json).trim();
    return campos;
  }

  function _validarDatasetSemantico(campos = {}) {
    const erros = [];
    if (!campos.nome) erros.push('Campo obrigatório: nome.');
    if (!['sql_base', 'view_semantica'].includes(String(campos.tipo || 'sql_base'))) {
      erros.push('Tipo de dataset inválido. Use sql_base ou view_semantica (SQL/View semântica).');
    }
    if (String(campos.tipo || 'sql_base') !== 'view_semantica') return erros;
    if (!campos.view_nome) erros.push('SQL/View semântica exige Nome da Fonte (View/SQL).');
    if (!campos.modulo) erros.push('SQL/View semântica exige Módulo.');
    if (!campos.spec) erros.push('SQL/View semântica exige Spec.');
    if (campos.campos_semanticos_json) {
      try {
        const lista = JSON.parse(campos.campos_semanticos_json);
        if (!Array.isArray(lista)) erros.push('Campos semânticos devem ser uma lista JSON.');
        for (const [idx, campo] of (Array.isArray(lista) ? lista : []).entries()) {
          if (!campo?.coluna) erros.push(`Campo semântico #${idx + 1} está sem coluna.`);
        }
      } catch (_) {
        erros.push('Campos semânticos devem estar em JSON válido.');
      }
    }
    if (campos.ativo_ia_owner && !campos.campos_semanticos_json) {
      erros.push('Para ativar no IA Owner, documente pelo menos um campo semântico.');
    }
    if (campos.ativo_ia_owner && !campos.view_descricao) {
      erros.push('Para ativar no IA Owner, informe a descrição de negócio da view.');
    }
    return erros;
  }

  app.post('/api/ia-command/admin/datasets', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const campos = _normalizarDatasetPayload(req.body);
    const erros = _validarDatasetSemantico(campos);
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const row = crud.criar('datasets', {
      empresa_id:      eid(req),
      ...campos,
    });
    _audit(req, 'criar_dataset', { id: row.id, nome: row.nome });
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const existing = crud.buscarPorId('datasets', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'erp', 'connection_id', 'sql_base', 'campo_data', 'colunas_metrica', 'limite_max', ..._datasetSemanticFields];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    const normalizados = _normalizarDatasetPayload({ ...existing, ...campos });
    for (const k of allowed) {
      if (normalizados[k] !== undefined) campos[k] = normalizados[k];
    }
    const erros = _validarDatasetSemantico({ ...existing, ...campos });
    if (erros.length) return res.status(400).json({ error: erros.join(' ') });
    const row = crud.atualizar('datasets', req.params.id, campos);
    _audit(req, 'editar_dataset', { id: req.params.id, campos: Object.keys(campos) });
    res.json(row);
  });

  app.delete('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const existing = crud.buscarPorId('datasets', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('datasets', req.params.id);
    _audit(req, 'excluir_dataset', { id: req.params.id, nome: existing.nome });
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // LOGS DE EXECUÇÃO (somente leitura)
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/execucoes', requireAuth, requireIaCommand, canExecucoes, (req, res) => {
    const db    = getDB();
    const empId = eid(req);
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const rows  = db.prepare(
      `SELECT * FROM execution_log WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT ?`
    ).all(empId, limit);
    res.json(rows);
  });

  app.post('/api/ia-command/admin/execucoes/limpar', requireAuth, requireIaCommand, canExecucoes, (req, res) => {
    const db      = getDB();
    const empId   = eid(req);
    const modo    = String(req.body?.modo || 'total');
    const inicio  = String(req.body?.data_inicio || '').trim();
    const fim     = String(req.body?.data_fim    || '').trim();

    let info;
    if (modo !== 'total' && inicio && fim) {
      info = db.prepare(
        `DELETE FROM execution_log WHERE empresa_id = ? AND criado_em >= ? AND criado_em <= ?`
      ).run(empId, `${inicio}T00:00:00.000`, `${fim}T23:59:59.999`);
    } else {
      info = db.prepare(`DELETE FROM execution_log WHERE empresa_id = ?`).run(empId);
    }
    _audit(req, 'limpar_execucoes', { modo, data_inicio: inicio || null, data_fim: fim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  app.get('/api/ia-command/admin/consumo-ia/resumo', requireAuth, requireIaCommand, canExecucoes, (req, res) => {
    const empresaId = req.query.empresa_id && _empresaPermitida(req, Number(req.query.empresa_id), 'iac-admin-execucoes')
      ? Number(req.query.empresa_id)
      : eid(req);
    res.json(usageDb.resumir({
      empresaId,
      inicio: req.query.inicio,
      fim: req.query.fim,
      provider: req.query.provider,
      agrupamento: req.query.agrupamento,
    }));
  });

  app.get('/api/ia-command/admin/consumo-ia/eventos', requireAuth, requireIaCommand, canExecucoes, (req, res) => {
    const empresaId = req.query.empresa_id && _empresaPermitida(req, Number(req.query.empresa_id), 'iac-admin-execucoes')
      ? Number(req.query.empresa_id)
      : eid(req);
    res.json(usageDb.listarEventos({
      empresaId,
      inicio: req.query.inicio,
      fim: req.query.fim,
      provider: req.query.provider,
      limit: req.query.limit,
    }));
  });

  app.get('/api/ia-command/admin/consumo-ia/precos', requireAuth, requireIaCommand, canExecucoes, (_req, res) => {
    res.json(usageDb.listarPrecos());
  });

  app.post('/api/ia-command/admin/consumo-ia/precos', requireAuth, requireIaCommand, canExecucoes, (req, res) => {
    try {
      const row = usageDb.salvarPreco(req.body || {});
      _audit(req, 'salvar_preco_consumo_ia', { provider: req.body?.provider, model: req.body?.model });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SINÔNIMOS — dicionário de equivalências por empresa
  // ────────────────────────────────────────────────────────────────────────────

  const canSinonimos = requireRotina('iac-admin-sinonimos');
  const canNormalizacao = requireRotina('iac-admin-normalizacao');
  const canLerSinonimosSistema = requireAnyRotina(['iac-admin-sinonimos', 'iac-admin-normalizacao']);

  function _seedarSistema(empresaId) {
    const { _SINONIMOS_SISTEMA } = require('./ai/intent-service');
    if (crud.listar('synonyms', { empresa_id: empresaId, origem: 'sistema' }).length > 0) return 0;
    let n = 0;
    for (const s of _SINONIMOS_SISTEMA) {
      try {
        crud.criar('synonyms', { empresa_id: empresaId, termo: s.termo, camada: s.camada, equivalencia: s.equivalencia, contexto: null, ativo: 1, origem: 'sistema' });
        n++;
      } catch (_) {}
    }
    return n;
  }

  function _ativoFlag(valor) {
    if (valor === undefined || valor === null) return 1;
    if (valor === false || valor === 0 || valor === '0' || valor === 'false') return 0;
    return 1;
  }

  function _validarSinonimoPayload(empresaId, dados, idAtual = null) {
    const termo = String(dados.termo || '').trim();
    const equivalencia = String(dados.equivalencia || '').trim();
    const camada = String(dados.camada || '').trim().toLowerCase();
    const contexto = dados.contexto == null ? null : String(dados.contexto).trim().toLowerCase() || null;

    if (!termo) return { error: 'Campo obrigatorio: termo.' };
    if (!equivalencia) return { error: 'Campo obrigatorio: equivalencia.' };
    if (!['intencao','filtro','coluna'].includes(camada)) {
      return { error: 'Camada invalida. Use: intencao, filtro ou coluna.' };
    }
    if (camada === 'filtro' && !contexto) {
      return { error: 'Equivalencia de filtro exige contexto: cliente, produto, vendedor, fornecedor, filial ou status.' };
    }
    if (contexto && !['cliente','produto','vendedor','fornecedor','filial','status'].includes(contexto)) {
      return { error: 'Contexto invalido. Use: cliente, produto, vendedor, fornecedor, filial ou status.' };
    }

    const termoNorm = normalizarTexto(termo);
    const eqNorm = normalizarTexto(equivalencia);
    const conflitos = crud.listar('synonyms', { empresa_id: empresaId })
      .filter(s => s.id !== idAtual && s.ativo !== 0)
      .filter(s => normalizarTexto(s.termo) === termoNorm && String(s.camada || '').toLowerCase() === camada)
      .filter(s => (camada !== 'filtro' || String(s.contexto || '').toLowerCase() === String(contexto || '').toLowerCase()));

    const conflitoDiferente = conflitos.find(s => normalizarTexto(s.equivalencia) !== eqNorm);
    if (conflitoDiferente) {
      return {
        error: `Conflito de equivalencia: "${termo}" ja aponta para "${conflitoDiferente.equivalencia}" na camada ${camada}.`,
      };
    }

    const duplicado = conflitos.find(s => normalizarTexto(s.equivalencia) === eqNorm);
    if (duplicado) {
      return { error: `Equivalencia duplicada: "${termo}" ja existe para esta camada.` };
    }

    return { termo, equivalencia, camada, contexto };
  }

  // Padrões do sistema (hardcoded no intent-service) — expostos ao frontend para exibição
  app.get('/api/ia-command/sinonimos/sistema', requireAuth, requireIaCommand, canLerSinonimosSistema, (_req, res) => {
    const { _SINONIMOS_SISTEMA } = require('./ai/intent-service');
    res.json(_SINONIMOS_SISTEMA || []);
  });

  app.get('/api/ia-command/admin/sinonimos', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    _seedarSistema(eid(req));
    res.json(crud.listar('synonyms', { empresa_id: eid(req) }).filter(r => String(r.camada || '').toLowerCase() !== 'normalizacao'));
  });

  app.use('/api/ia-command/admin/sinonimos/:id', requireAuth, requireIaCommand, canSinonimos, (req, res, next) => {
    const row = crud.buscarPorId('synonyms', req.params.id);
    if (row && row.empresa_id === eid(req) && String(row.camada || '').toLowerCase() === 'normalizacao') {
      return res.status(404).json({ error: 'Nao encontrado.' });
    }
    next();
  });

  app.get('/api/ia-command/admin/sinonimos/:id', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    const row = crud.buscarPorId('synonyms', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/sinonimos', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    const validado = _validarSinonimoPayload(eid(req), req.body);
    if (validado.error) return res.status(409).json({ error: validado.error });
    const ativo = _ativoFlag(req.body.ativo);
    const { termo, camada, equivalencia, contexto } = validado;
    const row = crud.criar('synonyms', {
      empresa_id:  eid(req),
      termo,
      camada,
      equivalencia,
      contexto,
      ativo,
      origem:      'usuario',
    });
    _audit(req, 'criar_sinonimo', { id: row.id, termo: row.termo, camada: row.camada });
    _invalidateIntentCache(eid(req));
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/sinonimos/:id', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    const existing = crud.buscarPorId('synonyms', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const campos = {};
    for (const k of ['termo','camada','equivalencia','contexto','ativo']) {
      if (req.body[k] !== undefined) campos[k] = req.body[k];
    }
    if (existing.origem === 'sistema' && Object.keys(campos).some(k => k !== 'ativo')) {
      return res.status(403).json({ error: 'Equivalencias de sistema podem apenas ser ativadas ou inativadas. Crie uma equivalencia da empresa para personalizar o vocabulario.' });
    }
    if (campos.ativo !== undefined) campos.ativo = _ativoFlag(campos.ativo);
    if (existing.origem !== 'sistema') {
      const validado = _validarSinonimoPayload(eid(req), { ...existing, ...campos }, req.params.id);
      if (validado.error) return res.status(409).json({ error: validado.error });
      campos.termo = validado.termo;
      campos.camada = validado.camada;
      campos.equivalencia = validado.equivalencia;
      campos.contexto = validado.contexto;
    }
    if (campos.termo) campos.termo = String(campos.termo).trim();
    if (campos.equivalencia) campos.equivalencia = String(campos.equivalencia).trim();
    const row = crud.atualizar('synonyms', req.params.id, campos);
    _audit(req, 'editar_sinonimo', { id: req.params.id, campos: Object.keys(campos) });
    _invalidateIntentCache(eid(req));
    res.json(row);
  });

  app.delete('/api/ia-command/admin/sinonimos/:id', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    const existing = crud.buscarPorId('synonyms', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    if (existing.origem === 'sistema') {
      return res.status(403).json({ error: 'Equivalencias de sistema nao podem ser excluidas. Inative o registro se nao quiser usa-lo nesta empresa.' });
    }
    crud.excluir('synonyms', req.params.id);
    _audit(req, 'excluir_sinonimo', { id: req.params.id, termo: existing.termo });
    _invalidateIntentCache(eid(req));
    res.json({ ok: true });
  });

  // Restaura os padrões do sistema (re-semeia após exclusão)
  app.post('/api/ia-command/admin/sinonimos/restaurar-sistema', requireAuth, requireIaCommand, canSinonimos, (req, res) => {
    const { _SINONIMOS_SISTEMA } = require('./ai/intent-service');
    const empresaId = eid(req);
    getDB().prepare("DELETE FROM synonyms WHERE empresa_id = ? AND origem = 'sistema'").run(empresaId);
    let n = 0;
    for (const s of _SINONIMOS_SISTEMA) {
      try {
        crud.criar('synonyms', { empresa_id: empresaId, termo: s.termo, camada: s.camada, equivalencia: s.equivalencia, contexto: null, ativo: 1, origem: 'sistema' });
        n++;
      } catch (_) {}
    }
    _audit(req, 'restaurar_sinonimos_sistema', { total: n });
    _invalidateIntentCache(empresaId);
    res.json({ ok: true, restaurados: n });
  });

  // Sugestões de novos termos via IA
  // NORMALIZACAO LINGUISTICA — regras de pre-processamento por empresa
  function _validarNormalizacaoPayload(empresaId, dados, idAtual = null) {
    const termo = String(dados.termo || '').trim();
    const equivalencia = String(dados.equivalencia || '').trim();
    const contexto = dados.contexto == null ? 'geral' : String(dados.contexto).trim().toLowerCase() || 'geral';

    if (!termo) return { error: 'Campo obrigatorio: termo.' };
    if (!equivalencia) return { error: 'Campo obrigatorio: equivalencia.' };
    if (!['geral','correcao','abreviacao','verbo','metrica'].includes(contexto)) {
      return { error: 'Tipo invalido. Use: geral, correcao, abreviacao, verbo ou metrica.' };
    }

    const termoNorm = normalizarTexto(termo);
    const eqNorm = normalizarTexto(equivalencia);
    if (termoNorm === eqNorm) return { error: 'Termo e equivalencia normalizada sao iguais. Nao ha regra para aplicar.' };

    const conflitos = crud.listar('synonyms', { empresa_id: empresaId })
      .filter(s => s.id !== idAtual && s.ativo !== 0)
      .filter(s => String(s.camada || '').toLowerCase() === 'normalizacao')
      .filter(s => normalizarTexto(s.termo) === termoNorm);

    const conflitoDiferente = conflitos.find(s => normalizarTexto(s.equivalencia) !== eqNorm);
    if (conflitoDiferente) return { error: `Conflito de normalizacao: "${termo}" ja aponta para "${conflitoDiferente.equivalencia}".` };
    if (conflitos.find(s => normalizarTexto(s.equivalencia) === eqNorm)) return { error: `Normalizacao duplicada: "${termo}" ja existe.` };

    return { termo, equivalencia, contexto };
  }

  app.get('/api/ia-command/admin/normalizacao', requireAuth, requireIaCommand, canNormalizacao, (req, res) => {
    const rows = crud.listar('synonyms', { empresa_id: eid(req) }).filter(r => String(r.camada || '').toLowerCase() === 'normalizacao');
    res.json(rows);
  });

  app.get('/api/ia-command/admin/normalizacao/:id', requireAuth, requireIaCommand, canNormalizacao, (req, res) => {
    const row = crud.buscarPorId('synonyms', req.params.id);
    if (!row || row.empresa_id !== eid(req) || String(row.camada || '').toLowerCase() !== 'normalizacao') return res.status(404).json({ error: 'Nao encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/normalizacao', requireAuth, requireIaCommand, canNormalizacao, (req, res) => {
    const validado = _validarNormalizacaoPayload(eid(req), req.body);
    if (validado.error) return res.status(409).json({ error: validado.error });
    const row = crud.criar('synonyms', { empresa_id: eid(req), termo: validado.termo, camada: 'normalizacao', equivalencia: validado.equivalencia, contexto: validado.contexto, ativo: _ativoFlag(req.body.ativo), origem: 'usuario' });
    _audit(req, 'criar_normalizacao', { id: row.id, termo: row.termo, equivalencia: row.equivalencia });
    _invalidateIntentCache(eid(req));
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/normalizacao/:id', requireAuth, requireIaCommand, canNormalizacao, (req, res) => {
    const existing = crud.buscarPorId('synonyms', req.params.id);
    if (!existing || existing.empresa_id !== eid(req) || String(existing.camada || '').toLowerCase() !== 'normalizacao') return res.status(404).json({ error: 'Nao encontrado.' });
    const campos = {};
    for (const k of ['termo','equivalencia','contexto','ativo']) if (req.body[k] !== undefined) campos[k] = req.body[k];
    if (campos.ativo !== undefined) campos.ativo = _ativoFlag(campos.ativo);
    const validado = _validarNormalizacaoPayload(eid(req), { ...existing, ...campos }, req.params.id);
    if (validado.error) return res.status(409).json({ error: validado.error });
    campos.termo = validado.termo;
    campos.equivalencia = validado.equivalencia;
    campos.contexto = validado.contexto;
    campos.camada = 'normalizacao';
    const row = crud.atualizar('synonyms', req.params.id, campos);
    _audit(req, 'editar_normalizacao', { id: req.params.id, campos: Object.keys(campos) });
    _invalidateIntentCache(eid(req));
    res.json(row);
  });

  app.delete('/api/ia-command/admin/normalizacao/:id', requireAuth, requireIaCommand, canNormalizacao, (req, res) => {
    const existing = crud.buscarPorId('synonyms', req.params.id);
    if (!existing || existing.empresa_id !== eid(req) || String(existing.camada || '').toLowerCase() !== 'normalizacao') return res.status(404).json({ error: 'Nao encontrado.' });
    crud.excluir('synonyms', req.params.id);
    _audit(req, 'excluir_normalizacao', { id: req.params.id, termo: existing.termo });
    _invalidateIntentCache(eid(req));
    res.json({ ok: true });
  });

  app.post('/api/ia-command/admin/sinonimos/sugerir', requireAuth, requireIaCommand, canSinonimos, async (req, res) => {
    const https = require('https');
    const { _SINONIMOS_SISTEMA, _resolveKeys, _normalizarOrdem } = require('./ai/intent-service');
    const empresaId = eid(req);

    let keys, cfg;
    try { ({ keys, cfg } = await _resolveKeys(empresaId)); } catch (_) { keys = {}; cfg = {}; }

    const ordem = _normalizarOrdem(cfg);
    const provedor = ordem.find(p => keys[p]);
    if (!provedor) return res.status(503).json({ error: 'Nenhuma chave de IA configurada. Configure em "Configurar IA".' });

    const sinonimosEmpresa = crud.listar('synonyms', { empresa_id: empresaId, ativo: 1 });
    const todos = [..._SINONIMOS_SISTEMA, ...sinonimosEmpresa];
    const jaExistem = new Set(todos.map(s => s.termo.toLowerCase()));

    let intencoes = [];
    try { intencoes = getDB().prepare('SELECT nome FROM intentions WHERE empresa_id=? AND ativo=1').all(empresaId).map(r => r.nome); } catch (_) {}

    const listaTermos = todos.map(s => `"${s.termo}" → ${s.equivalencia} [${s.camada}]`).join('\n');
    const listaIntencoes = intencoes.length ? intencoes.join(', ') : '(não configuradas)';

    const prompt = `Você é especialista em Business Intelligence e sistemas ERP para empresas brasileiras.

Objetivo: sugerir NOVOS termos para o dicionário de equivalências de um assistente ERP via WhatsApp.

CAMADAS VÁLIDAS:
- intencao: o usuário usa um nome diferente para uma CONSULTA (ex: "movimento" → "faturamento")
- coluna: o usuário usa um nome diferente para uma MÉTRICA numérica (ex: "tonelada" → "quantidade")
NÃO sugira camada "filtro" — esses são específicos de cada empresa.

INTENÇÕES DESTA EMPRESA: ${listaIntencoes}

TERMOS JÁ CADASTRADOS (não repita nenhum destes):
${listaTermos}

REGRAS:
1. Sugira termos reais que usuários digitam no WhatsApp
2. Inclua: abreviações, siglas, variantes sem acento, gírias de negócio
3. Considere setores: indústria, atacado, varejo, serviços, agronegócio
4. Para "coluna": equivalencias devem ser nomes de métricas (quantidade, faturamento, margem, custo, peso)
5. Para "intencao": equivalencias devem corresponder às intenções listadas acima
6. Sugira entre 20 e 30 termos novos e úteis

Responda SOMENTE com JSON válido, sem markdown:
{"sugestoes":[{"termo":"...","camada":"intencao|coluna","equivalencia":"...","justificativa":"..."}]}`;

    const _callGroq = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      const url = new URL('https://api.groq.com/openai/v1/chat/completions');
      const opts = { hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = '';
        resp.on('data', c => { raw += c; });
        resp.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error) return reject(new Error(p.error.message || 'Groq error'));
            resolve(JSON.parse(p.choices?.[0]?.message?.content));
          } catch (e) { reject(e); }
        });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.')));
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    const _callOpenAI = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', rejectUnauthorized: false,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = '';
        resp.on('data', c => { raw += c; });
        resp.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error) return reject(new Error(p.error.message || 'OpenAI error'));
            resolve(JSON.parse(p.choices?.[0]?.message?.content));
          } catch (e) { reject(e); }
        });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.')));
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    const _callGemini = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });
      const path = `/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
      const opts = { hostname: 'generativelanguage.googleapis.com', path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = '';
        resp.on('data', c => { raw += c; });
        resp.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error) return reject(new Error(p.error.message || 'Gemini error'));
            resolve(JSON.parse(p.candidates?.[0]?.content?.parts?.[0]?.text));
          } catch (e) { reject(e); }
        });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.')));
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    const _callDeepSeek = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      const opts = { hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = '';
        resp.on('data', c => { raw += c; });
        resp.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error) return reject(new Error(p.error.message || 'DeepSeek error'));
            resolve(JSON.parse(p.choices?.[0]?.message?.content));
          } catch (e) { reject(e); }
        });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const _callClaude = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt + '\n\nIMPORTANT: respond only with valid JSON, no markdown.' }],
      });
      const opts = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = '';
        resp.on('data', c => { raw += c; });
        resp.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error) return reject(new Error(p.error.message || 'Claude error'));
            const text = p.content?.[0]?.text || '';
            const match = text.match(/\{[\s\S]*\}/);
            resolve(JSON.parse(match?.[0] || text));
          } catch (e) { reject(e); }
        });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const CALLERS = { groq: _callGroq, openai: _callOpenAI, gemini: _callGemini, deepseek: _callDeepSeek, claude: _callClaude };

    for (const p of ordem) {
      if (!keys[p] || !CALLERS[p]) continue;
      try {
        const data = await CALLERS[p](keys[p]);
        const sugestoes = (data.sugestoes || [])
          .filter(s => s.termo && s.camada && s.equivalencia && ['intencao','coluna'].includes(s.camada))
          .filter(s => !jaExistem.has(s.termo.toLowerCase()));
        _audit(req, 'sugerir_sinonimos', { provedor: p, total: sugestoes.length });
        return res.json({ sugestoes, provedor: p });
      } catch (e) {
        console.warn(`[sugerir_sinonimos] ${p} falhou:`, e.message);
      }
    }
    res.status(502).json({ error: 'Todos os provedores de IA falharam. Tente novamente.' });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // AUDITORIA (somente leitura)
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/auditoria', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const db    = getDB();
    const empId = eid(req);
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const rows  = db.prepare(
      `SELECT * FROM audit_log WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT ?`
    ).all(empId, limit);
    res.json(rows);
  });

  app.get('/api/ia-command/admin/interpretacoes', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const interpretationLog = require('./ai/interpretation-log');
    res.json(interpretationLog.listarResumo(eid(req), {
      limit: req.query.limit,
      fase_execucao: req.query.fase_execucao,
    }));
  });

  app.get('/api/ia-command/admin/interpretacoes/:id', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const interpretationLog = require('./ai/interpretation-log');
    const empresaId = eid(req);
    const row = interpretationLog.obterPorId(req.params.id, empresaId);
    if (!row) return res.status(404).json({ error: `Interpretacao nao encontrada (empresa_id=${empresaId}).` });
    res.json(row);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PROPOSTAS DE CORRECAO DE SPEC (feedback tecnico via WhatsApp)
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/spec-feedback', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    res.json(specFeedbackStore.listar(eid(req), {
      status: req.query.status,
      limit: req.query.limit,
    }));
  });

  app.get('/api/ia-command/admin/spec-feedback/:id', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const empresaId = eid(req);
    const row = specFeedbackStore.obterPorId(req.params.id, empresaId);
    if (!row) return res.status(404).json({ error: `Proposta nao encontrada (empresa_id=${empresaId}).` });
    res.json(row);
  });

  app.post('/api/ia-command/admin/spec-feedback/:id/status', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const empresaId = eid(req);
    const status = String(req.body.status || '').trim();
    const ok = specFeedbackStore.atualizarStatus(req.params.id, empresaId, status, req.session?.username || req.session?.user || null);
    if (!ok) return res.status(404).json({ error: 'Proposta nao encontrada ou status invalido.' });
    _audit(req, 'spec_feedback_status', { id: req.params.id, status });
    res.json({ ok: true });
  });

  app.get('/api/ia-command/admin/spec-feedback/:id/preview-aplicacao', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const specFragmentApplier = require('./ai/spec-fragment-applier');
    const empresaId = eid(req);
    const row = specFeedbackStore.obterPorId(req.params.id, empresaId);
    if (!row) return res.status(404).json({ error: `Proposta nao encontrada (empresa_id=${empresaId}).` });
    if (row.status !== 'aprovado') {
      return res.status(400).json({ error: 'Somente propostas com status "aprovado" podem ser pre-visualizadas para aplicacao.' });
    }
    const avaliacao = specFragmentApplier.avaliar({ modulo: row.modulo, fragmentoAfetado: row.fragmento_afetado, textoProposto: row.texto_proposto });
    res.json({ ...avaliacao, textoProposto: row.texto_proposto || null });
  });

  app.post('/api/ia-command/admin/spec-feedback/:id/aplicar', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const specFragmentApplier = require('./ai/spec-fragment-applier');
    const empresaId = eid(req);
    const row = specFeedbackStore.obterPorId(req.params.id, empresaId);
    if (!row) return res.status(404).json({ error: `Proposta nao encontrada (empresa_id=${empresaId}).` });
    if (row.status !== 'aprovado') {
      return res.status(400).json({ error: 'Somente propostas com status "aprovado" podem ser aplicadas.' });
    }
    const resultado = specFragmentApplier.aplicar({
      modulo: row.modulo,
      fragmentoAfetado: row.fragmento_afetado,
      textoProposto: row.texto_proposto,
    });
    if (!resultado.ok) return res.status(400).json({ error: resultado.motivo || 'Nao foi possivel aplicar a proposta.' });
    specFeedbackStore.marcarAplicado(req.params.id, empresaId, resultado.arquivo);
    _audit(req, 'spec_feedback_aplicado', { id: req.params.id, modulo: row.modulo, fragmento: row.fragmento_afetado, arquivo: resultado.arquivo });
    res.json({ ok: true, arquivo: resultado.arquivo, nomeFuncao: resultado.nomeFuncao });
  });

  app.post('/api/ia-command/admin/spec-feedback/excluir-selecionados', requireAuth, requireIaCommand, canSpecFeedback, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um ID para excluir.' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Máximo de 200 registros por operação.' });
    }
    const removidos = specFeedbackStore.excluirPorIds(eid(req), ids);
    _audit(req, 'excluir_spec_feedback_selecionados', { ids, removidos });
    res.json({ ok: true, removidos });
  });

  // ── COMPRAS — Consultas Text-to-SQL ─────────────────────────────────────────
  const canCompras = requireRotina('iac-admin-compras');

  app.get('/api/ia-command/admin/compras/consultas', requireAuth, requireIaCommand, canCompras, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    // Garante que a intenção compras_dinamico existe para esta empresa (bootstrap automático)
    try { require('./erp/totvs_protheus/compras/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

    const limit  = Math.min(parseInt(req.query.limit  || '500', 10), 2000);
    const inicio = String(req.query.inicio || '').trim();
    const fim    = String(req.query.fim    || '').trim();
    const status = String(req.query.status || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();

    const filtroModulo = _whereLogModuloDinamico('compras');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];

    if (inicio) { wheres.push("criado_em >= ?"); params.push(inicio); }
    if (fim)    { wheres.push("criado_em <= ?"); params.push(fim + 'T23:59:59'); }
    if (status) { wheres.push("resultado_tipo = ?"); params.push(status); }
    if (faseExecucao) { wheres.push("fase_execucao = ?"); params.push(faseExecucao); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue, trace_json,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  // ── FATURAMENTO — Consultas Text-to-SQL ─────────────────────────────────────
  const canFaturamento = requireRotina('iac-admin-faturamento');

  app.get('/api/ia-command/admin/faturamento/consultas', requireAuth, requireIaCommand, canFaturamento, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    try { require('./erp/totvs_protheus/faturamento/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

    const limit  = Math.min(parseInt(req.query.limit  || '500', 10), 2000);
    const inicio = String(req.query.inicio || '').trim();
    const fim    = String(req.query.fim    || '').trim();
    const status = String(req.query.status || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();

    const filtroModulo = _whereLogModuloDinamico('faturamento');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];

    if (inicio) { wheres.push("criado_em >= ?"); params.push(inicio); }
    if (fim)    { wheres.push("criado_em <= ?"); params.push(fim + 'T23:59:59'); }
    if (status) { wheres.push("resultado_tipo = ?"); params.push(status); }
    if (faseExecucao) { wheres.push("fase_execucao = ?"); params.push(faseExecucao); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue, trace_json,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  // ── FINANCEIRO — Consultas Text-to-SQL ──────────────────────────────────────
  const canFinanceiro = requireRotina('iac-admin-financeiro');

  app.get('/api/ia-command/admin/financeiro/consultas', requireAuth, requireIaCommand, canFinanceiro, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    try { require('./erp/totvs_protheus/financeiro/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

    const limit  = Math.min(parseInt(req.query.limit  || '500', 10), 2000);
    const inicio = String(req.query.inicio || '').trim();
    const fim    = String(req.query.fim    || '').trim();
    const status = String(req.query.status || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();

    const filtroModulo = _whereLogModuloDinamico('financeiro');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];

    if (inicio) { wheres.push("criado_em >= ?"); params.push(inicio); }
    if (fim)    { wheres.push("criado_em <= ?"); params.push(fim + 'T23:59:59'); }
    if (status) { wheres.push("resultado_tipo = ?"); params.push(status); }
    if (faseExecucao) { wheres.push("fase_execucao = ?"); params.push(faseExecucao); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue, trace_json,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  // ── COMISSÃO — Consultas Text-to-SQL ────────────────────────────────────────
  const canComissao = requireRotina('iac-admin-comissao');

  app.get('/api/ia-command/admin/comissao/consultas', requireAuth, requireIaCommand, canComissao, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    try { require('./erp/totvs_protheus/comissao/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

    const limit  = Math.min(parseInt(req.query.limit  || '500', 10), 2000);
    const inicio = String(req.query.inicio || '').trim();
    const fim    = String(req.query.fim    || '').trim();
    const status = String(req.query.status || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();

    const filtroModulo = _whereLogModuloDinamico('comissao');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];

    if (inicio) { wheres.push("criado_em >= ?"); params.push(inicio); }
    if (fim)    { wheres.push("criado_em <= ?"); params.push(fim + 'T23:59:59'); }
    if (status) { wheres.push("resultado_tipo = ?"); params.push(status); }
    if (faseExecucao) { wheres.push("fase_execucao = ?"); params.push(faseExecucao); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue, trace_json,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  // ── ESTOQUE — Consultas Text-to-SQL ─────────────────────────────────────────
  const canEstoque = requireRotina('iac-admin-estoque');

  app.get('/api/ia-command/admin/estoque/consultas', requireAuth, requireIaCommand, canEstoque, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    // Garante que a intenção estoque_dinamico existe para esta empresa (bootstrap automático)
    try { require('./erp/totvs_protheus/estoque/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

    const limit  = Math.min(parseInt(req.query.limit  || '500', 10), 2000);
    const inicio = String(req.query.inicio || '').trim();
    const fim    = String(req.query.fim    || '').trim();
    const status = String(req.query.status || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();

    const filtroModulo = _whereLogModuloDinamico('estoque');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];

    if (inicio) { wheres.push("criado_em >= ?"); params.push(inicio); }
    if (fim)    { wheres.push("criado_em <= ?"); params.push(fim + 'T23:59:59'); }
    if (status) { wheres.push("resultado_tipo = ?"); params.push(status); }
    if (faseExecucao) { wheres.push("fase_execucao = ?"); params.push(faseExecucao); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue, trace_json,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  app.post('/api/ia-command/admin/interpretacoes/excluir-selecionados', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const interpretationLog = require('./ai/interpretation-log');
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um ID para excluir.' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Máximo de 200 registros por operação.' });
    }
    const removidos = interpretationLog.excluirPorIds(eid(req), ids);
    _audit(req, 'excluir_interpretacoes_selecionadas', { ids, removidos });
    res.json({ ok: true, removidos });
  });

  app.post('/api/ia-command/admin/interpretacoes/limpar', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const interpretationLog = require('./ai/interpretation-log');
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim = String(req.body?.data_fim || '').trim();

    let inicio = null;
    let fim = null;

    if (modo !== 'total') {
      if (!dataInicio || !dataFim) {
        return res.status(400).json({ error: 'Informe data inicial e data final.' });
      }
      if (dataInicio > dataFim) {
        return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
      }
      inicio = `${dataInicio}T00:00:00.000`;
      fim = `${dataFim}T23:59:59.999`;
    }

    const removidos = interpretationLog.limpar(eid(req), { inicio, fim });
    _audit(req, 'limpar_interpretacoes', { modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos });
    res.json({ ok: true, removidos });
  });

  app.post('/api/ia-command/admin/interpretacoes/:id/feedback', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const interpretationLog = require('./ai/interpretation-log');
    const ok = interpretationLog.registrarFeedback(
      req.params.id,
      eid(req),
      req.body.feedback,
      req.body.observacao
    );
    if (!ok) return res.status(404).json({ error: 'Interpretacao nao encontrada.' });
    _audit(req, 'feedback_interpretacao', { id: req.params.id, feedback: req.body.feedback });
    res.json({ ok: true });
  });

  // ── COMPRAS — Limpar log ────────────────────────────────────────────────────
  app.post('/api/ia-command/admin/compras/consultas/limpar', requireAuth, requireIaCommand, canCompras, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim    = String(req.body?.data_fim    || '').trim();
    if (modo !== 'total') {
      if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe data inicial e data final.' });
      if (dataInicio > dataFim)    return res.status(400).json({ error: 'Data inicial não pode ser maior que a data final.' });
    }
    const filtroModulo = _whereLogModuloDinamico('compras');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];
    if (modo !== 'total') { wheres.push("criado_em >= ?", "criado_em <= ?"); params.push(`${dataInicio}T00:00:00.000`, `${dataFim}T23:59:59.999`); }
    const info = db.prepare(`DELETE FROM interpretation_log WHERE ${wheres.join(' AND ')}`).run(...params);
    _audit(req, 'limpar_log_compras', { modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  // ── FATURAMENTO — Limpar log ─────────────────────────────────────────────────
  app.post('/api/ia-command/admin/faturamento/consultas/limpar', requireAuth, requireIaCommand, canFaturamento, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim    = String(req.body?.data_fim    || '').trim();
    if (modo !== 'total') {
      if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe data inicial e data final.' });
      if (dataInicio > dataFim)    return res.status(400).json({ error: 'Data inicial não pode ser maior que a data final.' });
    }
    const filtroModulo = _whereLogModuloDinamico('faturamento');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];
    if (modo !== 'total') { wheres.push("criado_em >= ?", "criado_em <= ?"); params.push(`${dataInicio}T00:00:00.000`, `${dataFim}T23:59:59.999`); }
    const info = db.prepare(`DELETE FROM interpretation_log WHERE ${wheres.join(' AND ')}`).run(...params);
    _audit(req, 'limpar_log_faturamento', { modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  // ── FINANCEIRO — Limpar log ──────────────────────────────────────────────────
  app.post('/api/ia-command/admin/financeiro/consultas/limpar', requireAuth, requireIaCommand, canFinanceiro, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim    = String(req.body?.data_fim    || '').trim();
    if (modo !== 'total') {
      if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe data inicial e data final.' });
      if (dataInicio > dataFim)    return res.status(400).json({ error: 'Data inicial não pode ser maior que a data final.' });
    }
    const filtroModulo = _whereLogModuloDinamico('financeiro');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];
    if (modo !== 'total') { wheres.push("criado_em >= ?", "criado_em <= ?"); params.push(`${dataInicio}T00:00:00.000`, `${dataFim}T23:59:59.999`); }
    const info = db.prepare(`DELETE FROM interpretation_log WHERE ${wheres.join(' AND ')}`).run(...params);
    _audit(req, 'limpar_log_financeiro', { modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  // ── COMISSÃO — Limpar log ────────────────────────────────────────────────────
  app.post('/api/ia-command/admin/comissao/consultas/limpar', requireAuth, requireIaCommand, canComissao, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim    = String(req.body?.data_fim    || '').trim();
    if (modo !== 'total') {
      if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe data inicial e data final.' });
      if (dataInicio > dataFim)    return res.status(400).json({ error: 'Data inicial não pode ser maior que a data final.' });
    }
    const filtroModulo = _whereLogModuloDinamico('comissao');
    const wheres = ["empresa_id = ?", filtroModulo.where];
    const params = [empresaId, ...filtroModulo.params];
    if (modo !== 'total') { wheres.push("criado_em >= ?", "criado_em <= ?"); params.push(`${dataInicio}T00:00:00.000`, `${dataFim}T23:59:59.999`); }
    const info = db.prepare(`DELETE FROM interpretation_log WHERE ${wheres.join(' AND ')}`).run(...params);
    _audit(req, 'limpar_log_comissao', { modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  // ── LOG UNIFICADO DE CONSULTAS (todos os módulos) ───────────────────────────
  const MODULOS_VALIDOS = new Set(['compras', 'faturamento', 'financeiro', 'comissao']);

  app.get('/api/ia-command/admin/logs/consultas', requireAuth, requireIaCommand, canLogsConsultas, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);

    const limit   = Math.min(parseInt(req.query.limit   || '500', 10), 2000);
    const inicio  = String(req.query.inicio  || '').trim();
    const fim     = String(req.query.fim     || '').trim();
    const status  = String(req.query.status  || '').trim();
    const faseExecucao = String(req.query.fase_execucao || '').trim();
    const provedor = String(req.query.provedor || '').trim();
    const modulo  = String(req.query.modulo  || '').trim().toLowerCase();

    const wheres = ['empresa_id = ?'];
    const params = [empresaId];

    if (modulo && MODULOS_VALIDOS.has(modulo)) {
      wheres.push('modulo = ?');
      params.push(modulo);
    }
    if (inicio)   { wheres.push('criado_em >= ?'); params.push(inicio); }
    if (fim)      { wheres.push('criado_em <= ?'); params.push(fim + 'T23:59:59'); }
    if (status)   { wheres.push('resultado_tipo = ?'); params.push(status); }
    if (faseExecucao) { wheres.push('fase_execucao = ?'); params.push(faseExecucao); }
    if (provedor) { wheres.push('provedor = ?'); params.push(provedor); }

    params.push(limit);
    const rows = db.prepare(`
      SELECT id, criado_em, modulo, texto_original, sql_gerado, rows_count,
             resultado_tipo, provedor, confianca, duracao_ms, resposta_entregue,
             trace_json, intencao, usuario, numero_wa,
             escopo_execucao, sql_canonico_origem, sql_canonico_empresa_origem,
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado,
             intent_canonico_json, intent_canonico_hash, intent_canonico_estrutural_json, chave_cache, sql_template, sql_template_parametros_json,
             sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  app.post('/api/ia-command/admin/logs/consultas/limpar', requireAuth, requireIaCommand, canLogsConsultas, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const modo = String(req.body?.modo || 'periodo');
    const dataInicio = String(req.body?.data_inicio || '').trim();
    const dataFim    = String(req.body?.data_fim    || '').trim();
    const modulo     = String(req.body?.modulo      || '').trim().toLowerCase();

    if (modo !== 'total') {
      if (!dataInicio || !dataFim) return res.status(400).json({ error: 'Informe data inicial e data final.' });
      if (dataInicio > dataFim)    return res.status(400).json({ error: 'Data inicial não pode ser maior que a data final.' });
    }

    const wheres = ['empresa_id = ?'];
    const params = [empresaId];

    if (modulo && MODULOS_VALIDOS.has(modulo)) {
      wheres.push('modulo = ?');
      params.push(modulo);
    }
    if (modo !== 'total') {
      wheres.push('criado_em >= ?', 'criado_em <= ?');
      params.push(`${dataInicio}T00:00:00.000`, `${dataFim}T23:59:59.999`);
    }

    const info = db.prepare(`DELETE FROM interpretation_log WHERE ${wheres.join(' AND ')}`).run(...params);
    _audit(req, 'limpar_log_consultas', { modulo: modulo || 'todos', modo, data_inicio: dataInicio || null, data_fim: dataFim || null, removidos: info.changes });
    res.json({ ok: true, removidos: info.changes });
  });

  const SHADOW_RESULTADOS_VALIDOS = new Set([
    'sem_candidato',
    'template_invalido',
    'match_template_exato',
    'match_sql_aplicado_exato',
    'mismatch',
  ]);
  const SHADOW_CLASSIFICACOES_VALIDAS = new Set([
    'aprovado_automatico',
    'reprovado_automatico',
    'inconclusivo',
    'bloqueado_por_risco',
    'aprovado_usuario',
    'reprovado_usuario',
    'ignorado_usuario',
    'bloqueado_usuario',
  ]);

  function _parseJsonAdmin(valor, fallback = null) {
    if (!valor) return fallback;
    if (typeof valor !== 'string') return valor;
    try { return JSON.parse(valor); } catch (_) { return fallback; }
  }

  function _shadowWhere(req) {
    const inicio = String(req.query.inicio || '').trim();
    const fim = String(req.query.fim || '').trim();
    const modulo = String(req.query.modulo || '').trim().toLowerCase();
    const resultado = String(req.query.resultado || '').trim();
    const elegivel = String(req.query.elegivel || '').trim();
    const classificacao = String(req.query.classificacao || '').trim();
    const escopo = _whereEmpresasPermitidas(req, 'iac-admin-auditoria');
    const wheres = [escopo.where];
    const params = [...escopo.params];

    if (inicio) { wheres.push('criado_em >= ?'); params.push(`${inicio}T00:00:00.000`); }
    if (fim) { wheres.push('criado_em <= ?'); params.push(`${fim}T23:59:59.999`); }
    if (modulo) { wheres.push('module = ?'); params.push(modulo); }
    if (resultado && SHADOW_RESULTADOS_VALIDOS.has(resultado)) {
      wheres.push('comparacao_resultado = ?');
      params.push(resultado);
    }
    if (elegivel === '1' || elegivel === '0') {
      wheres.push('auto_reuse_elegivel = ?');
      params.push(Number(elegivel));
    }
    if (classificacao && SHADOW_CLASSIFICACOES_VALIDAS.has(classificacao)) {
      wheres.push('classificacao_efetiva = ?');
      params.push(classificacao);
    }
    return { wheres, params };
  }

  function _shadowResumo(rows) {
    const total = rows.length;
    const porResultado = {};
    const porModulo = {};
    const porClassificacao = {};
    for (const row of rows) {
      const resultado = row.comparacao_resultado || 'desconhecido';
      const modulo = row.module || 'sem_modulo';
      const classificacao = row.classificacao_efetiva || row.classificacao_auto || 'nao_classificado';
      porResultado[resultado] = (porResultado[resultado] || 0) + 1;
      porModulo[modulo] = (porModulo[modulo] || 0) + 1;
      porClassificacao[classificacao] = (porClassificacao[classificacao] || 0) + 1;
    }
    const matchTemplate = porResultado.match_template_exato || 0;
    const matchAplicado = porResultado.match_sql_aplicado_exato || 0;
    const comCandidato = total - (porResultado.sem_candidato || 0);
    return {
      total,
      com_candidato: comCandidato,
      match_template_exato: matchTemplate,
      match_sql_aplicado_exato: matchAplicado,
      mismatch: porResultado.mismatch || 0,
      template_invalido: porResultado.template_invalido || 0,
      sem_candidato: porResultado.sem_candidato || 0,
      auto_reuse_elegivel: rows.filter(r => Number(r.auto_reuse_elegivel) === 1).length,
      precisao_template: comCandidato ? matchTemplate / comCandidato : null,
      taxa_match_total: total ? (matchTemplate + matchAplicado) / total : null,
      por_resultado: porResultado,
      por_modulo: porModulo,
      por_classificacao: porClassificacao,
    };
  }

  app.get('/api/ia-command/admin/nlsql-shadow', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const db = getDB();
    try {
      const classificacao = require('./erp/nlsql-cache/nlsql-classificacao');
      for (const empresaId of _idsEmpresasPermitidas(req, 'iac-admin-auditoria')) {
        classificacao.reprocessarPendentes({ empresaId, limit: 5000 });
      }
    } catch (_) {}
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '500', 10) || 500, 2000));
    const { wheres, params } = _shadowWhere(req);
    const resumoRows = db.prepare(`
      SELECT module, comparacao_resultado, auto_reuse_elegivel, classificacao_auto, classificacao_efetiva
        FROM nlsql_semantic_shadow_log
       WHERE ${wheres.join(' AND ')}
    `).all(...params);
    const rows = db.prepare(`
      SELECT id, empresa_id, numero_wa, module, intent, intent_canonico_hash, chave_cache,
             candidate_execution_log_id, candidate_score, candidate_sql_template, candidate_sql_aplicado,
             actual_sql_template, actual_sql_canonico, actual_sql_final, template_valido,
             comparacao_resultado, auto_reuse_limiar, auto_reuse_elegivel,
             classificacao_auto, classificacao_auto_motivo, classificacao_auto_em, classificacao_efetiva,
             override_classificacao, override_motivo, override_usuario, override_em,
             detalhes_json,
             servido_em_producao, criado_em
        FROM nlsql_semantic_shadow_log
       WHERE ${wheres.join(' AND ')}
       ORDER BY criado_em DESC
       LIMIT ?
    `).all(...params, limit).map(row => ({
      ...row,
      detalhes: _parseJsonAdmin(row.detalhes_json, null),
    }));
    res.json({ rows, resumo: _shadowResumo(resumoRows) });
  });

  app.get('/api/ia-command/admin/nlsql-shadow/:id', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const db = getDB();
    const escopo = _whereEmpresasPermitidas(req, 'iac-admin-auditoria');
    const row = db.prepare(`
      SELECT *
        FROM nlsql_semantic_shadow_log
       WHERE ${escopo.where}
         AND id = ?
       LIMIT 1
    `).get(...escopo.params, req.params.id);
    if (!row) return res.status(404).json({ error: 'Registro de shadow mode nao encontrado.' });
    res.json({
      ...row,
      detalhes: _parseJsonAdmin(row.detalhes_json, null),
    });
  });

  app.post('/api/ia-command/admin/nlsql-shadow/classificacao/reprocessar', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const classificacao = require('./erp/nlsql-cache/nlsql-classificacao');
    const limit = Math.max(1, Math.min(parseInt(req.body?.limit || '1000', 10) || 1000, 50000));
    const porEmpresa = _idsEmpresasPermitidas(req, 'iac-admin-auditoria')
      .map(empresaId => ({ empresa_id: empresaId, ...classificacao.reprocessarPendentes({ empresaId, limit }) }));
    const resultado = {
      candidatos: porEmpresa.reduce((s, r) => s + Number(r.candidatos || 0), 0),
      atualizados: porEmpresa.reduce((s, r) => s + Number(r.atualizados || 0), 0),
      por_empresa: porEmpresa,
    };
    _audit(req, 'nlsql_shadow_classificacao_reprocessar', resultado);
    res.json({ ok: true, resultado });
  });

  app.post('/api/ia-command/admin/nlsql-shadow/:id/classificacao', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    try {
      const classificacao = require('./erp/nlsql-cache/nlsql-classificacao');
      const escopo = _whereEmpresasPermitidas(req, 'iac-admin-auditoria');
      const row = getDB().prepare(`
        SELECT empresa_id
          FROM nlsql_semantic_shadow_log
         WHERE ${escopo.where}
           AND id = ?
         LIMIT 1
      `).get(...escopo.params, req.params.id);
      if (!row) return res.status(404).json({ error: 'Registro de shadow mode nao encontrado.' });
      const resultado = classificacao.aplicarOverride({
        id: req.params.id,
        empresaId: row.empresa_id,
        classificacao: req.body?.classificacao || null,
        motivo: req.body?.motivo || '',
        usuario: req.session?.username || req.session?.user || 'sistema',
      });
      _audit(req, 'nlsql_shadow_classificacao_override', {
        id: req.params.id,
        classificacao: resultado.override_classificacao,
        efetiva: resultado.classificacao_efetiva,
      });
      res.json({ ok: true, resultado });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Nao foi possivel alterar a classificacao.' });
    }
  });

  function _nlsqlCalibracaoFiltros(req) {
    return {
      empresaId: eid(req),
      inicio: String(req.query.inicio || '').trim(),
      fim: String(req.query.fim || '').trim(),
      modulo: String(req.query.modulo || '').trim().toLowerCase(),
      fonte: String(req.query.fonte || '').trim(),
      limit: Math.max(100, Math.min(parseInt(req.query.limit || '5000', 10) || 5000, 50000)),
    };
  }

  app.get('/api/ia-command/admin/nlsql-calibracao', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const calibracao = require('./erp/nlsql-cache/nlsql-calibracao');
    const filtros = _nlsqlCalibracaoFiltros(req);
    if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) {
      return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
    }
    try {
      const classificacao = require('./erp/nlsql-cache/nlsql-classificacao');
      for (const empresaId of _idsEmpresasPermitidas(req, 'iac-admin-auditoria')) {
        classificacao.reprocessarPendentes({ empresaId, limit: 5000 });
      }
    } catch (_) {}
    const rows = _idsEmpresasPermitidas(req, 'iac-admin-auditoria')
      .flatMap(empresaId => calibracao.carregarRows
        ? calibracao.carregarRows({ ...filtros, empresaId })
        : []);
    if (calibracao.calibrarShadowRows) {
      return res.json({
        filtros: { ...filtros, empresaIds: _idsEmpresasPermitidas(req, 'iac-admin-auditoria'), empresaId: null },
        amostra_lida: rows.length,
        ...calibracao.calibrarShadowRows(rows),
      });
    }
    res.json(calibracao.calibrarShadow(filtros));
  });

  function _nlsqlPoliticasFiltros(req) {
    return {
      empresaId: eid(req),
      inicio: String(req.query.inicio || '').trim(),
      fim: String(req.query.fim || '').trim(),
      modulo: String(req.query.modulo || '').trim().toLowerCase(),
      fonte: String(req.query.fonte || '').trim(),
      limit: Math.max(100, Math.min(parseInt(req.query.limit || '50000', 10) || 50000, 50000)),
    };
  }

  app.get('/api/ia-command/admin/nlsql-politicas', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const politicas = require('./erp/nlsql-cache/nlsql-politicas');
    const filtros = _nlsqlPoliticasFiltros(req);
    if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) {
      return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
    }
    try {
      const classificacao = require('./erp/nlsql-cache/nlsql-classificacao');
      for (const empresaId of _idsEmpresasPermitidas(req, 'iac-admin-auditoria')) {
        classificacao.reprocessarPendentes({ empresaId, limit: 5000 });
      }
    } catch (_) {}
    const escopoNlsql = _empresasNlsqlDoCanal(req, 'iac-admin-auditoria');
    const nomesEmpresasNlsql = new Map(escopoNlsql.empresas.map(e => [Number(e.id), e.nome || `Empresa #${e.id}`]));
    const porEmpresa = escopoNlsql.empresas.map(e => Number(e.id))
      .map(empresaId => {
        try { politicas.autoPromoverPoliticas({ ...filtros, empresaId }); } catch (_) {}
        return politicas.listarPoliticas({ ...filtros, empresaId });
      });
    const rows = porEmpresa.flatMap(p => (p.rows || []).map(r => {
      const empresaId = p.filtros?.empresaId || null;
      return {
        ...r,
        empresa_id: empresaId,
        empresa_nome: nomesEmpresasNlsql.get(Number(empresaId)) || `Empresa #${empresaId}`,
      };
    }));
    res.json({
      filtros: { ...filtros, empresaId: null, empresaIds: porEmpresa.map(p => p.filtros?.empresaId).filter(Boolean) },
      total: rows.length,
      rows,
      resumo: {
        observacao: rows.filter(r => r.status === 'observacao').length,
        elegivel: rows.filter(r => r.status === 'elegivel').length,
        liberado: rows.filter(r => r.status === 'liberado').length,
        bloqueado: rows.filter(r => r.status === 'bloqueado').length,
      },
    });
  });

  app.get('/api/ia-command/admin/nlsql-politicas/settings', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    try {
      const politicas = require('./erp/nlsql-cache/nlsql-politicas');
      const escopoNlsql = _empresasNlsqlDoCanal(req, 'iac-admin-auditoria');
      const empresaIds = escopoNlsql.empresas.map(e => Number(e.id)).filter(Boolean);
      const nomes = new Map(escopoNlsql.empresas.map(e => [Number(e.id), e.nome || `Empresa #${e.id}`]));
      res.json({
        empresa_id_atual: eid(req),
        channel_id: escopoNlsql.canal?.id || null,
        channel_nome: escopoNlsql.canal?.nome || null,
        rows: empresaIds.map(empresaId => ({
          ...politicas.carregarSettings({ empresaId }),
          empresa_nome: nomes.get(Number(empresaId)) || `Empresa #${empresaId}`,
        })),
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Nao foi possivel carregar configuracao NL-SQL.' });
    }
  });

  app.post('/api/ia-command/admin/nlsql-politicas/settings', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    try {
      const empresaId = Number(req.body?.empresa_id || eid(req));
      const escopoNlsql = _empresasNlsqlDoCanal(req, 'iac-admin-auditoria');
      if (!escopoNlsql.empresas.some(e => Number(e.id) === empresaId)) {
        return res.status(403).json({ error: 'Sem permissao para alterar esta empresa.' });
      }
      const politicas = require('./erp/nlsql-cache/nlsql-politicas');
      const resultado = politicas.salvarSettings({
        empresaId,
        shadowEnabled: req.body?.shadow_enabled,
        autoReuseEnabled: req.body?.auto_reuse_enabled,
        autoPolicyEnabled: req.body?.auto_policy_enabled,
        precisionMin: req.body?.precision_min,
        sampleMin: req.body?.sample_min,
        usuario: req.session?.username || req.session?.user || 'sistema',
      });
      _audit(req, 'nlsql_politica_settings', resultado);
      res.json({ ok: true, resultado });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Nao foi possivel salvar configuracao NL-SQL.' });
    }
  });

  app.post('/api/ia-command/admin/nlsql-politicas/status', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    try {
      const politicas = require('./erp/nlsql-cache/nlsql-politicas');
      const empresaId = Number(req.body?.empresa_id || eid(req));
      const escopoNlsql = _empresasNlsqlDoCanal(req, 'iac-admin-auditoria');
      if (!escopoNlsql.empresas.some(e => Number(e.id) === empresaId)) {
        return res.status(403).json({ error: 'Sem permissao para alterar esta empresa.' });
      }
      const resultado = politicas.salvarStatus({
        empresaId,
        module: req.body?.module,
        fonteRanking: req.body?.fonte_ranking,
        minScore: req.body?.min_score,
        status: req.body?.status,
        motivo: req.body?.motivo || '',
        usuario: req.session?.username || req.session?.user || 'sistema',
      });
      _audit(req, 'nlsql_politica_status', resultado);
      res.json({ ok: true, resultado });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Nao foi possivel salvar politica NL-SQL.' });
    }
  });

  function _nlsqlBackfillFiltros(req, origem = 'query') {
    const src = origem === 'body' ? (req.body || {}) : (req.query || {});
    return {
      empresaId: eid(req),
      inicio: String(src.inicio || src.data_inicio || '').trim(),
      fim: String(src.fim || src.data_fim || '').trim(),
      modulo: String(src.modulo || '').trim().toLowerCase(),
      limit: Math.max(1, Math.min(parseInt(src.limit || '200', 10) || 200, 1000)),
    };
  }

  app.get('/api/ia-command/admin/nlsql-backfill/status', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const semanticExamples = require('./erp/nlsql-cache/nlsql-semantic-examples');
    const filtros = _nlsqlBackfillFiltros(req);
    res.json({
      filtros,
      status: semanticExamples.statusBackfill(filtros),
    });
  });

  app.post('/api/ia-command/admin/nlsql-backfill/run', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const semanticExamples = require('./erp/nlsql-cache/nlsql-semantic-examples');
    const filtros = _nlsqlBackfillFiltros(req, 'body');
    if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) {
      return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
    }
    const antes = semanticExamples.statusBackfill(filtros);
    const resultado = semanticExamples.backfillConfiaveis(filtros);
    const depois = semanticExamples.statusBackfill(filtros);
    _audit(req, 'nlsql_backfill_admin', {
      modulo: filtros.modulo || 'todos',
      inicio: filtros.inicio || null,
      fim: filtros.fim || null,
      limit: filtros.limit,
      candidatos: resultado.candidatos,
      inseridos: resultado.inseridos,
      ignorados: resultado.ignorados,
    });
    res.json({ ok: true, filtros, antes, resultado, depois });
  });

  function _nlsqlEmbeddingFiltros(req, origem = 'query') {
    const src = origem === 'body' ? (req.body || {}) : (req.query || {});
    return {
      empresaId: eid(req),
      modulo: String(src.modulo || '').trim().toLowerCase(),
      limit: Math.max(1, Math.min(parseInt(src.limit || '50', 10) || 50, 500)),
      incluirErros: src.incluir_erros === true || src.incluir_erros === '1' || src.incluirErros === true,
    };
  }

  app.get('/api/ia-command/admin/nlsql-embeddings/status', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const embeddings = require('./erp/nlsql-cache/nlsql-embeddings');
    const filtros = _nlsqlEmbeddingFiltros(req);
    res.json({
      filtros,
      provider: process.env.IAC_NLSQL_EMBEDDING_PROVIDER || embeddings.DEFAULT_PROVIDER,
      model: process.env.IAC_NLSQL_EMBEDDING_MODEL || embeddings.DEFAULT_MODEL,
      status: embeddings.statusEmbeddings(filtros),
    });
  });

  app.post('/api/ia-command/admin/nlsql-embeddings/run', requireAuth, requireIaCommand, canAuditoria, async (req, res) => {
    const embeddings = require('./erp/nlsql-cache/nlsql-embeddings');
    const filtros = _nlsqlEmbeddingFiltros(req, 'body');
    try {
      const antes = embeddings.statusEmbeddings(filtros);
      const resultado = await embeddings.processarPendentes(filtros);
      const depois = embeddings.statusEmbeddings(filtros);
      _audit(req, 'nlsql_embeddings_admin', {
        modulo: filtros.modulo || 'todos',
        limit: filtros.limit,
        incluir_erros: filtros.incluirErros,
        candidatos: resultado.candidatos,
        processados: resultado.processados,
        erros: resultado.erros,
        provider: resultado.provider,
        model: resultado.model,
      });
      res.json({ ok: true, filtros, antes, resultado, depois });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Nao foi possivel processar embeddings NL-SQL.' });
    }
  });

  function _nlsqlSaudeFiltros(req) {
    return {
      inicio: String(req.query.inicio || '').trim(),
      fim: String(req.query.fim || '').trim(),
      modulo: String(req.query.modulo || '').trim().toLowerCase(),
      limit: Math.max(20, Math.min(parseInt(req.query.limit || '100', 10) || 100, 500)),
    };
  }

  function _moduloExpr(alias = 'i') {
    return `COALESCE(NULLIF(${alias}.modulo, ''), CASE WHEN ${alias}.intencao LIKE '%_dinamico' THEN replace(${alias}.intencao, '_dinamico', '') ELSE NULLIF(${alias}.intencao, '') END, 'sem_modulo')`;
  }

  function _escopoEmpresasAprendizado(req) {
    const empresas = _empresasPermitidas(req, 'iac-admin-auditoria');
    const ids = empresas.map(e => Number(e.id)).filter(Boolean);
    if (!ids.length) return { where: '1 = 0', params: [], ids, empresas };
    return {
      where: `empresa_id IN (${ids.map(() => '?').join(',')})`,
      params: ids,
      ids,
      empresas,
    };
  }

  function _whereInterpretacoesAprendizado(req, filtros) {
    const escopo = _escopoEmpresasAprendizado(req);
    const wheres = [escopo.where.replace(/\bempresa_id\b/g, 'i.empresa_id')];
    const params = [...escopo.params];
    if (filtros.inicio) { wheres.push('i.criado_em >= ?'); params.push(`${filtros.inicio}T00:00:00.000`); }
    if (filtros.fim) { wheres.push('i.criado_em <= ?'); params.push(`${filtros.fim}T23:59:59.999`); }
    if (filtros.modulo) {
      wheres.push(`(${_moduloExpr('i')} = ? OR i.dataset_nome = ?)`);
      params.push(filtros.modulo, filtros.modulo);
    }
    return { wheres, params, ids: escopo.ids };
  }

  function _whereExecutionAprendizado(req, filtros) {
    const escopo = _escopoEmpresasAprendizado(req);
    const wheres = [escopo.where.replace(/\bempresa_id\b/g, 'e.empresa_id')];
    const params = [...escopo.params];
    if (filtros.inicio) { wheres.push('e.criado_em >= ?'); params.push(`${filtros.inicio}T00:00:00.000`); }
    if (filtros.fim) { wheres.push('e.criado_em <= ?'); params.push(`${filtros.fim}T23:59:59.999`); }
    if (filtros.modulo) {
      wheres.push('(e.intencao = ? OR e.intent_canonico_json LIKE ? OR e.detalhes_json LIKE ?)');
      params.push(`${filtros.modulo}_dinamico`, `%"module":"${filtros.modulo}"%`, `%"modulo":"${filtros.modulo}"%`);
    }
    return { wheres, params, ids: escopo.ids };
  }

  function _whereNlsqlTabela(req, filtros, alias = 'x') {
    const escopo = _escopoEmpresasAprendizado(req);
    const wheres = [escopo.where.replace(/\bempresa_id\b/g, `${alias}.empresa_id`)];
    const params = [...escopo.params];
    if (filtros.inicio) { wheres.push(`${alias}.criado_em >= ?`); params.push(`${filtros.inicio}T00:00:00.000`); }
    if (filtros.fim) { wheres.push(`${alias}.criado_em <= ?`); params.push(`${filtros.fim}T23:59:59.999`); }
    if (filtros.modulo) { wheres.push(`${alias}.module = ?`); params.push(filtros.modulo); }
    return { wheres, params, ids: escopo.ids };
  }

  function _empresaNomeMap(req) {
    return new Map(_escopoEmpresasAprendizado(req).empresas.map(e => [Number(e.id), e.nome]));
  }

  function _pctSeguro(num, den) {
    const d = Number(den || 0);
    return d ? Number(num || 0) / d : null;
  }

  app.get('/api/ia-command/admin/nlsql-saude', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const db = getDB();
    const filtros = _nlsqlSaudeFiltros(req);
    if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) {
      return res.status(400).json({ error: 'Data inicial nao pode ser maior que a data final.' });
    }

    const nomesEmpresas = _empresaNomeMap(req);
    const wi = _whereInterpretacoesAprendizado(req, filtros);
    const we = _whereExecutionAprendizado(req, filtros);
    const wx = _whereNlsqlTabela(req, filtros, 'x');
    const ws = _whereNlsqlTabela(req, filtros, 's');
    const moduloExpr = _moduloExpr('i');
    const origemCase = `
      CASE
        WHEN i.pipeline_origem = 'dataset_semantico' OR i.sql_canonico_origem = 'dataset_semantico' OR i.dataset_id IS NOT NULL THEN 'dataset_semantico'
        WHEN i.sql_canonico_origem = 'cache_deterministico' OR i.cache_hit = 1 THEN 'cache_deterministico'
        WHEN i.sql_canonico_origem IN ('whatsapp_all_reuso', 'ia_owner_reuso') OR i.pipeline_origem = 'canonico_reuso' THEN 'reuso_canonico'
        WHEN i.sql_canonico_origem = 'auto_reuse_semantico' THEN 'auto_reuse_semantico'
        WHEN i.pipeline_origem = 'consolidado' THEN 'consolidado'
        WHEN i.pipeline_origem = 'systemprompt' OR i.sql_canonico_origem IN ('ia_owner', 'ia', 'chat') THEN 'sql_direto_ia'
        ELSE COALESCE(NULLIF(i.pipeline_origem, ''), NULLIF(i.sql_canonico_origem, ''), 'nao_informado')
      END
    `;

    const resumoConsultas = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN i.resultado_tipo IN ('sucesso', 'sucesso_ai_sql') THEN 1 ELSE 0 END) AS sucesso,
             SUM(CASE WHEN i.resultado_tipo = 'erro' THEN 1 ELSE 0 END) AS erro,
             SUM(CASE WHEN i.sql_validacao_erro IS NOT NULL AND i.sql_validacao_erro <> '' THEN 1 ELSE 0 END) AS bloqueios_contrato,
             SUM(CASE WHEN i.pipeline_origem = 'dataset_semantico' OR i.sql_canonico_origem = 'dataset_semantico' OR i.dataset_id IS NOT NULL THEN 1 ELSE 0 END) AS dataset_semantico,
             SUM(CASE WHEN i.pipeline_origem = 'systemprompt' OR i.sql_canonico_origem IN ('ia_owner', 'ia', 'chat') THEN 1 ELSE 0 END) AS sql_direto_ia,
             SUM(CASE WHEN i.sql_canonico_origem = 'cache_deterministico' OR i.cache_hit = 1 THEN 1 ELSE 0 END) AS cache_deterministico,
             SUM(CASE WHEN i.sql_canonico_origem IN ('whatsapp_all_reuso', 'ia_owner_reuso') OR i.pipeline_origem = 'canonico_reuso' THEN 1 ELSE 0 END) AS reuso_canonico,
             SUM(CASE WHEN i.sql_canonico_origem = 'auto_reuse_semantico' THEN 1 ELSE 0 END) AS auto_reuse_semantico,
             SUM(CASE WHEN i.intent_canonico_json IS NOT NULL AND i.intent_canonico_json <> '' THEN 1 ELSE 0 END) AS com_intent_canonico,
             SUM(CASE WHEN i.sql_template IS NOT NULL AND i.sql_template <> '' THEN 1 ELSE 0 END) AS com_template,
             AVG(CASE WHEN i.duracao_ms IS NOT NULL THEN i.duracao_ms END) AS duracao_media_ms
        FROM interpretation_log i
       WHERE ${wi.wheres.join(' AND ')}
    `).get(...wi.params) || {};

    const resumoExecution = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN e.cache_status = 'confiavel' THEN 1 ELSE 0 END) AS confiaveis,
             SUM(CASE WHEN e.cache_status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
             SUM(CASE WHEN e.cache_status LIKE 'bloqueado%' THEN 1 ELSE 0 END) AS bloqueados,
             SUM(CASE WHEN e.chave_cache IS NOT NULL AND e.chave_cache <> '' THEN 1 ELSE 0 END) AS com_chave_cache,
             SUM(CASE WHEN e.sql_template IS NOT NULL AND e.sql_template <> '' THEN 1 ELSE 0 END) AS com_template
        FROM execution_log e
       WHERE ${we.wheres.join(' AND ')}
    `).get(...we.params) || {};

    const resumoExamples = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN x.embedding_status IN ('ok', 'done') THEN 1 ELSE 0 END) AS embedding_ok,
             SUM(CASE WHEN x.embedding_status IN ('pendente', 'pending') THEN 1 ELSE 0 END) AS embedding_pendente,
             SUM(CASE WHEN x.embedding_status IN ('erro', 'error') THEN 1 ELSE 0 END) AS embedding_erro,
             SUM(CASE WHEN x.embedding_json IS NOT NULL AND x.embedding_json <> '' THEN 1 ELSE 0 END) AS com_vetor
        FROM nlsql_semantic_examples x
       WHERE ${wx.wheres.join(' AND ')}
    `).get(...wx.params) || {};

    const resumoShadow = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN s.candidate_execution_log_id IS NOT NULL AND s.candidate_execution_log_id <> '' THEN 1 ELSE 0 END) AS com_candidato,
             SUM(CASE WHEN s.comparacao_resultado = 'match_template_exato' THEN 1 ELSE 0 END) AS match_template,
             SUM(CASE WHEN s.comparacao_resultado = 'match_sql_aplicado_exato' THEN 1 ELSE 0 END) AS match_aplicado,
             SUM(CASE WHEN s.comparacao_resultado = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
             SUM(CASE WHEN s.comparacao_resultado = 'template_invalido' THEN 1 ELSE 0 END) AS template_invalido,
             SUM(CASE WHEN s.comparacao_resultado = 'sem_candidato' THEN 1 ELSE 0 END) AS sem_candidato,
             SUM(CASE WHEN s.auto_reuse_elegivel = 1 THEN 1 ELSE 0 END) AS auto_reuse_elegivel,
             SUM(CASE WHEN s.classificacao_efetiva = 'aprovado_automatico' THEN 1 ELSE 0 END) AS aprovado_auto,
             SUM(CASE WHEN s.servido_em_producao = 1 THEN 1 ELSE 0 END) AS servido_producao
        FROM nlsql_semantic_shadow_log s
       WHERE ${ws.wheres.join(' AND ')}
    `).get(...ws.params) || {};

    const porOrigem = db.prepare(`
      SELECT ${origemCase} AS origem,
             COUNT(*) AS total,
             SUM(CASE WHEN i.resultado_tipo IN ('sucesso', 'sucesso_ai_sql') THEN 1 ELSE 0 END) AS sucesso,
             SUM(CASE WHEN i.resultado_tipo = 'erro' THEN 1 ELSE 0 END) AS erro,
             AVG(CASE WHEN i.duracao_ms IS NOT NULL THEN i.duracao_ms END) AS duracao_media_ms,
             AVG(CASE WHEN i.rows_count IS NOT NULL THEN i.rows_count END) AS rows_media
        FROM interpretation_log i
       WHERE ${wi.wheres.join(' AND ')}
       GROUP BY origem
       ORDER BY total DESC
    `).all(...wi.params);

    const porModulo = db.prepare(`
      SELECT ${moduloExpr} AS modulo,
             COUNT(*) AS total,
             SUM(CASE WHEN i.resultado_tipo IN ('sucesso', 'sucesso_ai_sql') THEN 1 ELSE 0 END) AS sucesso,
             SUM(CASE WHEN i.sql_validacao_erro IS NOT NULL AND i.sql_validacao_erro <> '' THEN 1 ELSE 0 END) AS bloqueios_contrato,
             SUM(CASE WHEN i.pipeline_origem = 'dataset_semantico' OR i.sql_canonico_origem = 'dataset_semantico' OR i.dataset_id IS NOT NULL THEN 1 ELSE 0 END) AS dataset_semantico,
             SUM(CASE WHEN i.sql_canonico_origem = 'cache_deterministico' OR i.cache_hit = 1 THEN 1 ELSE 0 END) AS cache_deterministico,
             SUM(CASE WHEN i.sql_canonico_origem = 'auto_reuse_semantico' THEN 1 ELSE 0 END) AS auto_reuse_semantico,
             AVG(CASE WHEN i.duracao_ms IS NOT NULL THEN i.duracao_ms END) AS duracao_media_ms
        FROM interpretation_log i
       WHERE ${wi.wheres.join(' AND ')}
       GROUP BY modulo
       ORDER BY total DESC
    `).all(...wi.params);

    const porEmpresa = db.prepare(`
      SELECT i.empresa_id,
             COUNT(*) AS total,
             SUM(CASE WHEN i.resultado_tipo IN ('sucesso', 'sucesso_ai_sql') THEN 1 ELSE 0 END) AS sucesso,
             SUM(CASE WHEN i.pipeline_origem = 'dataset_semantico' OR i.sql_canonico_origem = 'dataset_semantico' OR i.dataset_id IS NOT NULL THEN 1 ELSE 0 END) AS dataset_semantico,
             SUM(CASE WHEN i.sql_canonico_origem = 'cache_deterministico' OR i.cache_hit = 1 THEN 1 ELSE 0 END) AS cache_deterministico,
             SUM(CASE WHEN i.sql_canonico_origem = 'auto_reuse_semantico' THEN 1 ELSE 0 END) AS auto_reuse_semantico,
             AVG(CASE WHEN i.duracao_ms IS NOT NULL THEN i.duracao_ms END) AS duracao_media_ms
        FROM interpretation_log i
       WHERE ${wi.wheres.join(' AND ')}
       GROUP BY i.empresa_id
       ORDER BY total DESC
    `).all(...wi.params).map(r => ({ ...r, empresa_nome: nomesEmpresas.get(Number(r.empresa_id)) || `Empresa #${r.empresa_id}` }));

    const recentes = db.prepare(`
      SELECT i.id, i.empresa_id, i.criado_em, i.numero_wa, ${moduloExpr} AS modulo,
             i.texto_original, i.resultado_tipo, i.rows_count, i.duracao_ms,
             i.pipeline_origem, i.sql_canonico_origem, i.cache_hit, i.dataset_nome,
             i.chave_cache, i.sql_validacao_erro
        FROM interpretation_log i
       WHERE ${wi.wheres.join(' AND ')}
       ORDER BY i.criado_em DESC
       LIMIT ?
    `).all(...wi.params, filtros.limit).map(r => ({ ...r, empresa_nome: nomesEmpresas.get(Number(r.empresa_id)) || `Empresa #${r.empresa_id}` }));

    const shadowRecentes = db.prepare(`
      SELECT s.id, s.empresa_id, s.criado_em, s.module, s.intent, s.candidate_score,
             s.comparacao_resultado, s.auto_reuse_elegivel, s.classificacao_efetiva,
             s.classificacao_auto, s.servido_em_producao
        FROM nlsql_semantic_shadow_log s
       WHERE ${ws.wheres.join(' AND ')}
       ORDER BY s.criado_em DESC
       LIMIT ?
    `).all(...ws.params, Math.min(filtros.limit, 100)).map(r => ({ ...r, empresa_nome: nomesEmpresas.get(Number(r.empresa_id)) || `Empresa #${r.empresa_id}` }));

    const totalConsultas = Number(resumoConsultas.total || 0);
    const economiaChamadas = Number(resumoConsultas.cache_deterministico || 0)
      + Number(resumoConsultas.reuso_canonico || 0)
      + Number(resumoConsultas.auto_reuse_semantico || 0);
    const comCandidato = Number(resumoShadow.com_candidato || 0);
    const matchTotal = Number(resumoShadow.match_template || 0) + Number(resumoShadow.match_aplicado || 0);

    res.json({
      filtros: { ...filtros, empresa_ids: wi.ids },
      empresas: [...nomesEmpresas.entries()].map(([id, nome]) => ({ id, nome })),
      resumo: {
        consultas: {
          ...resumoConsultas,
          taxa_sucesso: _pctSeguro(resumoConsultas.sucesso, totalConsultas),
          taxa_dataset: _pctSeguro(resumoConsultas.dataset_semantico, totalConsultas),
          taxa_intent_canonico: _pctSeguro(resumoConsultas.com_intent_canonico, totalConsultas),
          economia_chamadas_llm: economiaChamadas,
          taxa_economia_llm: _pctSeguro(economiaChamadas, totalConsultas),
        },
        cache: {
          ...resumoExecution,
          taxa_confiavel: _pctSeguro(resumoExecution.confiaveis, resumoExecution.total),
          taxa_pendente: _pctSeguro(resumoExecution.pendentes, resumoExecution.total),
        },
        exemplos: {
          ...resumoExamples,
          taxa_embedding_ok: _pctSeguro(resumoExamples.embedding_ok, resumoExamples.total),
        },
        shadow: {
          ...resumoShadow,
          precisao_match_total: _pctSeguro(matchTotal, comCandidato),
          precisao_template: _pctSeguro(resumoShadow.match_template, comCandidato),
          taxa_mismatch: _pctSeguro(resumoShadow.mismatch, comCandidato),
        },
      },
      por_origem: porOrigem,
      por_modulo: porModulo,
      por_empresa: porEmpresa,
      recentes,
      shadow_recentes: shadowRecentes,
    });
  });

  // ---------------------------------------------------------------------------
  // DIÁLOGOS CONVERSACIONAIS
  // ---------------------------------------------------------------------------

  const canDialogos = requireRotina('iac-admin-dialogos');

  app.get('/api/ia-command/admin/dialogos', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    require('./ai/dialog-resolver').semearParaEmpresa(empresaId);
    const rows = db.prepare(`
      SELECT * FROM conversational_dialogs
      WHERE empresa_id = ?
      ORDER BY prioridade DESC, rowid DESC
    `).all(empresaId);
    res.json(rows);
  });

  // Rotas estáticas ANTES da rota dinâmica /:id para evitar conflito no Express
  app.get('/api/ia-command/admin/dialogos/nao-respondidas', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const apenas_pendentes = req.query.apenas_pendentes !== '0';
    const limit = Math.min(parseInt(req.query.limit || '200'), 500);
    const rows = db.prepare(`
      SELECT * FROM unmatched_messages
      WHERE empresa_id = ?
      ${apenas_pendentes ? 'AND promovido = 0' : ''}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(empresaId, limit);
    res.json(rows);
  });

  app.get('/api/ia-command/admin/dialogos/:id', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const row = crud.buscarPorId('conversational_dialogs', req.params.id);
    if (!row || Number(row.empresa_id) !== Number(eid(req))) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/dialogos', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const { tipo, titulo, padroes, resposta, prioridade, ativo } = req.body;
    if (!titulo?.trim()) return res.status(400).json({ error: 'Campo obrigatório: titulo.' });
    if (!resposta?.trim()) return res.status(400).json({ error: 'Campo obrigatório: resposta.' });
    const padroesArr = Array.isArray(padroes) ? padroes : [];
    if (!padroesArr.length) return res.status(400).json({ error: 'Informe ao menos um padrão de disparo.' });
    const row = crud.criar('conversational_dialogs', {
      empresa_id: eid(req),
      tipo:       tipo || 'outro',
      titulo:     titulo.trim(),
      padroes:    JSON.stringify(padroesArr.map(p => String(p).trim()).filter(Boolean)),
      resposta:   resposta.trim(),
      prioridade: Number(prioridade) || 0,
      protegido:  0,
      origem:     'usuario',
      ativo:      ativo !== false && Number(ativo) !== 0 ? 1 : 0,
    });
    _audit(req, 'criar_dialogo', { id: row.id, titulo: row.titulo });
    require('./ai/dialog-resolver').invalidateCache(eid(req));
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/dialogos/:id', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const existing = crud.buscarPorId('conversational_dialogs', req.params.id);
    const empresaId = eid(req);
    if (!existing || Number(existing.empresa_id) !== Number(empresaId)) return res.status(404).json({ error: 'Não encontrado.' });
    const campos = {};
    if (req.body.tipo      !== undefined) campos.tipo      = req.body.tipo;
    if (req.body.titulo    !== undefined) campos.titulo    = String(req.body.titulo).trim();
    if (req.body.resposta  !== undefined) campos.resposta  = String(req.body.resposta).trim();
    if (req.body.padroes   !== undefined) {
      const arr = Array.isArray(req.body.padroes) ? req.body.padroes : [];
      campos.padroes = JSON.stringify(arr.map(p => String(p).trim()).filter(Boolean));
    }
    if (req.body.prioridade !== undefined) campos.prioridade = Number(req.body.prioridade) || 0;
    if (req.body.ativo      !== undefined) campos.ativo      = req.body.ativo !== false && Number(req.body.ativo) !== 0 ? 1 : 0;
    const row = crud.atualizar('conversational_dialogs', req.params.id, campos);
    _audit(req, 'editar_dialogo', { id: req.params.id, campos: Object.keys(campos) });
    require('./ai/dialog-resolver').invalidateCache(empresaId);
    res.json(row);
  });

  app.delete('/api/ia-command/admin/dialogos/:id', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const existing = crud.buscarPorId('conversational_dialogs', req.params.id);
    const empresaId = eid(req);
    if (!existing || Number(existing.empresa_id) !== Number(empresaId)) return res.status(404).json({ error: 'Não encontrado.' });
    if (existing.protegido) return res.status(403).json({ error: 'Este diálogo é protegido pelo sistema e não pode ser excluído. Desative-o se não quiser que seja usado.' });
    crud.excluir('conversational_dialogs', req.params.id);
    _audit(req, 'excluir_dialogo', { id: req.params.id, titulo: existing.titulo });
    require('./ai/dialog-resolver').invalidateCache(empresaId);
    res.json({ ok: true });
  });

  app.post('/api/ia-command/admin/dialogos/restaurar-sistema', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const restaurados = require('./ai/dialog-resolver').restaurarSistema(eid(req));
    _audit(req, 'restaurar_dialogos_sistema', { restaurados });
    res.json({ ok: true, restaurados });
  });

  // ---------------------------------------------------------------------------
  // MENSAGENS NÃO RESPONDIDAS (aprendizado assistido)
  // ---------------------------------------------------------------------------

  app.post('/api/ia-command/admin/dialogos/nao-respondidas/:id/promover', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const db = getDB();
    const empresaId = eid(req);
    const msg = db.prepare('SELECT * FROM unmatched_messages WHERE id = ? AND empresa_id = ?').get(req.params.id, empresaId);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const { tipo, titulo, resposta, prioridade } = req.body;
    if (!resposta?.trim()) return res.status(400).json({ error: 'Informe a resposta para promover.' });

    const row = crud.criar('conversational_dialogs', {
      empresa_id: empresaId,
      tipo:       tipo || 'outro',
      titulo:     (titulo || msg.mensagem).trim().slice(0, 120),
      padroes:    JSON.stringify([msg.mensagem]),
      resposta:   resposta.trim(),
      prioridade: Number(prioridade) || 0,
      protegido:  0,
      origem:     'usuario',
      ativo:      1,
    });

    db.prepare('UPDATE unmatched_messages SET promovido = 1 WHERE id = ?').run(req.params.id);
    _audit(req, 'promover_msg_nao_respondida', { msg_id: req.params.id, dialogo_id: row.id });
    require('./ai/dialog-resolver').invalidateCache(empresaId);
    res.status(201).json({ ok: true, dialogo: row });
  });

  app.delete('/api/ia-command/admin/dialogos/nao-respondidas/:id', requireAuth, requireIaCommand, canDialogos, (req, res) => {
    const db = getDB();
    const info = db.prepare('DELETE FROM unmatched_messages WHERE id = ? AND empresa_id = ?').run(req.params.id, eid(req));
    if (!info.changes) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // SUGESTÃO DE DIÁLOGOS VIA IA
  // ---------------------------------------------------------------------------

  app.post('/api/ia-command/admin/dialogos/sugerir', requireAuth, requireIaCommand, canDialogos, async (req, res) => {
    const https = require('https');
    const { _resolveKeys, _normalizarOrdem } = require('./ai/intent-service');
    const empresaId = eid(req);

    let keys, cfg;
    try { ({ keys, cfg } = await _resolveKeys(empresaId)); } catch (_) { keys = {}; cfg = {}; }

    const ordem = _normalizarOrdem(cfg);
    const provedor = ordem.find(p => keys[p]);
    if (!provedor) return res.status(503).json({ error: 'Nenhuma chave de IA configurada. Configure em "Configurar IA".' });

    // Mensagens não respondidas (máx 50 para não estourar contexto)
    const naoRespondidas = getDB()
      .prepare('SELECT mensagem FROM unmatched_messages WHERE empresa_id = ? AND promovido = 0 ORDER BY criado_em DESC LIMIT 50')
      .all(empresaId).map(r => r.mensagem);

    if (!naoRespondidas.length) return res.json({ sugestoes: [], provedor, aviso: 'Não há mensagens sem resposta para analisar.' });

    // Diálogos já existentes (para não repetir)
    const dialogosExistentes = getDB()
      .prepare('SELECT padroes FROM conversational_dialogs WHERE (empresa_id IS NULL OR empresa_id = ?) AND ativo = 1')
      .all(empresaId);
    const padroesExistentes = new Set();
    dialogosExistentes.forEach(d => {
      try { JSON.parse(d.padroes || '[]').forEach(p => padroesExistentes.add(p.toLowerCase())); } catch (_) {}
    });

    const listaMensagens = naoRespondidas.map((m, i) => `${i + 1}. "${m}"`).join('\n');

    const prompt = `Você é especialista em assistentes conversacionais para sistemas ERP via WhatsApp.

Os clientes enviaram as seguintes mensagens e o sistema não conseguiu responder:
${listaMensagens}

Sua tarefa: agrupar mensagens similares e sugerir NOVOS diálogos conversacionais para o sistema.
Cada diálogo precisa de:
- tipo: saudacao | despedida | agradecimento | ajuda | confusao | outro
- titulo: nome curto para identificar o diálogo (máx 60 chars)
- padroes: lista de palavras/frases que disparam este diálogo (inclua variações)
- resposta: mensagem clara e amigável para enviar ao cliente (pode usar *negrito* e _itálico_ do WhatsApp)
- justificativa: por que esse diálogo é útil (1 linha)

REGRAS:
1. Agrupe mensagens parecidas em um único diálogo
2. Inclua variações nos padrões (com/sem acento, abreviações, erros comuns)
3. As respostas devem mencionar que o sistema consulta dados do ERP via WhatsApp
4. Para perguntas sobre funcionalidades, descreva brevemente o que o sistema faz
5. Seja objetivo e cordial no tom das respostas
6. Sugira entre 3 e 8 diálogos novos e úteis

Responda SOMENTE com JSON válido, sem markdown:
{"sugestoes":[{"tipo":"...","titulo":"...","padroes":["...","..."],"resposta":"...","justificativa":"..."}]}`;

    const _callGroq = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4, max_tokens: 3000,
        response_format: { type: 'json_object' },
      });
      const url = new URL('https://api.groq.com/openai/v1/chat/completions');
      const opts = { hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = ''; resp.on('data', c => { raw += c; });
        resp.on('end', () => { try { const p = JSON.parse(raw); if (p.error) return reject(new Error(p.error.message)); resolve(JSON.parse(p.choices?.[0]?.message?.content)); } catch (e) { reject(e); } });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const _callOpenAI = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      });
      const opts = { hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', rejectUnauthorized: false,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = ''; resp.on('data', c => { raw += c; });
        resp.on('end', () => { try { const p = JSON.parse(raw); if (p.error) return reject(new Error(p.error.message || 'OpenAI error')); resolve(JSON.parse(p.choices?.[0]?.message?.content)); } catch (e) { reject(e); } });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const _callGemini = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 3000, responseMimeType: 'application/json' },
      });
      const path = `/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
      const opts = { hostname: 'generativelanguage.googleapis.com', path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = ''; resp.on('data', c => { raw += c; });
        resp.on('end', () => { try { const p = JSON.parse(raw); if (p.error) return reject(new Error(p.error.message)); resolve(JSON.parse(p.candidates?.[0]?.content?.parts?.[0]?.text)); } catch (e) { reject(e); } });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const _callDeepSeek = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4, max_tokens: 3000,
        response_format: { type: 'json_object' },
      });
      const opts = { hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = ''; resp.on('data', c => { raw += c; });
        resp.on('end', () => { try { const p = JSON.parse(raw); if (p.error) return reject(new Error(p.error.message)); resolve(JSON.parse(p.choices?.[0]?.message?.content)); } catch (e) { reject(e); } });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const _callClaude = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 3000,
        messages: [{ role: 'user', content: prompt + '\n\nIMPORTANT: respond only with valid JSON, no markdown.' }],
      });
      const opts = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
      const r = https.request(opts, (resp) => {
        let raw = ''; resp.on('data', c => { raw += c; });
        resp.on('end', () => { try { const p = JSON.parse(raw); if (p.error) return reject(new Error(p.error.message)); const text = p.content?.[0]?.text || ''; const match = text.match(/\{[\s\S]*\}/); resolve(JSON.parse(match?.[0] || text)); } catch (e) { reject(e); } });
      });
      r.setTimeout(30000, () => r.destroy(new Error('Tempo limite excedido.'))); r.on('error', reject); r.write(body); r.end();
    });

    const CALLERS = { groq: _callGroq, openai: _callOpenAI, gemini: _callGemini, deepseek: _callDeepSeek, claude: _callClaude };
    const TIPOS_VALIDOS = ['saudacao', 'despedida', 'agradecimento', 'ajuda', 'confusao', 'outro'];

    for (const p of ordem) {
      if (!keys[p] || !CALLERS[p]) continue;
      try {
        const data = await CALLERS[p](keys[p]);
        const sugestoes = (data.sugestoes || [])
          .filter(s => s.titulo && s.resposta && Array.isArray(s.padroes) && s.padroes.length)
          .map(s => ({
            tipo:          TIPOS_VALIDOS.includes(s.tipo) ? s.tipo : 'outro',
            titulo:        String(s.titulo).slice(0, 120),
            padroes:       s.padroes.map(pad => String(pad).trim().toLowerCase()).filter(Boolean),
            resposta:      String(s.resposta),
            justificativa: s.justificativa || '',
          }))
          .filter(s => !s.padroes.every(pad => padroesExistentes.has(pad)));
        _audit(req, 'sugerir_dialogos', { provedor: p, total: sugestoes.length, msgs_analisadas: naoRespondidas.length });
        return res.json({ sugestoes, provedor: p, msgs_analisadas: naoRespondidas.length });
      } catch (e) {
        console.warn(`[sugerir_dialogos] ${p} falhou:`, e.message);
      }
    }
    res.status(502).json({ error: 'Todos os provedores de IA falharam. Tente novamente.' });
  });

};


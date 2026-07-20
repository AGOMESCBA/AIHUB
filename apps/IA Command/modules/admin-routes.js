const crud = require('./database/crud');
const { getDB } = require('./database');
const { requireRotina } = require('./permissions');
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

  // ────────────────────────────────────────────────────────────────────────────
  // MÓDULOS DE INTENÇÃO
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/modulos', requireAuth, requireIaCommand, canModulos, (req, res) => {
    const rows = crud.listar('intention_modules', { empresa_id: eid(req) });
    res.json(rows);
  });

  // Listagem pública (para selects nos formulários de intenção)
  app.get('/api/ia-command/modulos', requireAuth, requireIaCommand, (req, res) => {
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
    const rows = crud.listar('whatsapp_allowed_numbers', { empresa_id: eid(req) });
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
        (id, empresa_id, nome, numero, observacoes, ativo, modulo_financeiro, modulo_compras, modulo_faturamento, modulo_comissao, modulo_estoque, erp_tipo, erp_id, criado_em, atualizado_em)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        const erpTipo = campos.erp_tipo ?? existente?.erp_tipo ?? null;
        const erpId = campos.erp_id ?? existente?.erp_id ?? null;
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
    // Gestão de Vendas
    if (body.erp_tipo !== undefined) {
      const tipo = String(body.erp_tipo || '').trim().toLowerCase();
      campos.erp_tipo = ['vendedor', 'gestor'].includes(tipo) ? tipo : null;
    }
    if (body.erp_id !== undefined) {
      campos.erp_id = String(body.erp_id || '').trim().toUpperCase() || null;
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

    try {
      const row = crud.criar('whatsapp_allowed_numbers', {
        empresa_id: eid(req),
        nome:       nome.trim(),
        numero:     numeroNormalizado,
        ativo:      0,
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
    const { nome, descricao, modulo, acao, dataset_id, frases_exemplo, ativo } = req.body;
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
    });
    _audit(req, 'criar_intencao', { id: row.id, nome: row.nome });
    _invalidateIntentCache(eid(req));
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, canIntencoes, (req, res) => {
    const existing = crud.buscarPorId('intentions', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'descricao', 'modulo', 'acao', 'dataset_id', 'frases_exemplo', 'ativo'];
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
        conn = factory.carregarConexao(eid(req));
        if (String(conn.tipo || '').toLowerCase() !== 'api_proxy') {
          return res.status(400).json({ error: 'View semantica deve ser testada pelo Agente Local. Ative e configure o Agente Local desta empresa antes de executar o preview.' });
        }
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
      const conexaoLabel = usarAgenteLocal ? `Agente Local${conn._agente_url ? ` (${conn._agente_url})` : ''}` : (conn.nome || conn.id || conn.tipo);
      _audit(req, 'preview_sql', { linhas: rows.length, conexao: conexaoLabel, tipo: tipoDataset });
      res.json({ columns, rows, total: rows.length, conexao: conexaoLabel });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const row = crud.buscarPorId('datasets', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
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
    const allowed = ['nome', 'erp', 'sql_base', 'campo_data', 'colunas_metrica', 'limite_max', ..._datasetSemanticFields];
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
  app.get('/api/ia-command/sinonimos/sistema', requireAuth, requireIaCommand, (_req, res) => {
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

  app.get('/api/ia-command/admin/spec-feedback', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    res.json(specFeedbackStore.listar(eid(req), {
      status: req.query.status,
      limit: req.query.limit,
    }));
  });

  app.get('/api/ia-command/admin/spec-feedback/:id', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const empresaId = eid(req);
    const row = specFeedbackStore.obterPorId(req.params.id, empresaId);
    if (!row) return res.status(404).json({ error: `Proposta nao encontrada (empresa_id=${empresaId}).` });
    res.json(row);
  });

  app.post('/api/ia-command/admin/spec-feedback/:id/status', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
    const specFeedbackStore = require('./ai/spec-feedback-store');
    const empresaId = eid(req);
    const status = String(req.body.status || '').trim();
    const ok = specFeedbackStore.atualizarStatus(req.params.id, empresaId, status, req.session?.username || req.session?.user || null);
    if (!ok) return res.status(404).json({ error: 'Proposta nao encontrada ou status invalido.' });
    _audit(req, 'spec_feedback_status', { id: req.params.id, status });
    res.json({ ok: true });
  });

  app.get('/api/ia-command/admin/spec-feedback/:id/preview-aplicacao', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
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

  app.post('/api/ia-command/admin/spec-feedback/:id/aplicar', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
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

  app.post('/api/ia-command/admin/spec-feedback/excluir-selecionados', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
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
    try { require('./erp/compras/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
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

    try { require('./erp/faturamento/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
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

    try { require('./erp/financeiro/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
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

    try { require('./erp/comissao/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
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
    try { require('./erp/estoque/ai-sql-handler-v2').garantirIntencao(empresaId); } catch (_) {}

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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
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

  app.get('/api/ia-command/admin/logs/consultas', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
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
             sql_canonico_original, sql_canonico_adaptado, sql_auditoria_json, sql_canonico_parametros_json, sql_canonico_parametrizado, sql_ia_bruto, sql_final_executado, sql_canonico_reuso_motivo, sql_canonico_reuso_permitido, sql_canonico_empresa_atual,
             pipeline_origem, chat_turno, sql_validacao_erro, fase_execucao,
             recebido_em, pipeline_ms, entregue_ms
      FROM interpretation_log
      WHERE ${wheres.join(' AND ')}
      ORDER BY criado_em DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  });

  app.post('/api/ia-command/admin/logs/consultas/limpar', requireAuth, requireIaCommand, canAuditoria, (req, res) => {
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


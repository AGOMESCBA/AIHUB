const crud = require('./database/crud');
const { getDB } = require('./database');
const { requireRotina } = require('./permissions');
const { getEmpresaId } = require('./empresa-context');
const { normalizarTexto } = require('./ai/local-intent-resolver');
const messageTemplates = require('./whatsapp/message-templates');

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

  function normalizarNumero(numero) {
    return String(numero || '').replace(/\D/g, '');
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

  app.get('/api/ia-command/admin/numeros-whatsapp/:id', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const row = crud.buscarPorId('whatsapp_allowed_numbers', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/numeros-whatsapp', requireAuth, requireIaCommand, canNumeros, (req, res) => {
    const { nome, numero, observacoes, ativo } = req.body;
    const numeroNormalizado = normalizarNumero(numero);
    if (!nome) return res.status(400).json({ error: 'Campo obrigatorio: nome.' });
    if (!numeroNormalizado) return res.status(400).json({ error: 'Campo obrigatorio: numero.' });
    if (numeroNormalizado.length < 10 || numeroNormalizado.length > 15) {
      return res.status(400).json({ error: 'Informe o numero com DDI e DDD, contendo entre 10 e 15 digitos.' });
    }

    try {
      const row = crud.criar('whatsapp_allowed_numbers', {
        empresa_id:  eid(req),
        nome:        nome.trim(),
        numero:      numeroNormalizado,
        observacoes: observacoes || null,
        ativo:       ativo !== false && Number(ativo) !== 0 ? 1 : 0,
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
    if (req.body.observacoes !== undefined) campos.observacoes = req.body.observacoes || null;
    if (req.body.ativo !== undefined) campos.ativo = req.body.ativo !== false && Number(req.body.ativo) !== 0 ? 1 : 0;

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
    if (!sql_base?.trim()) return res.status(400).json({ error: 'sql_base é obrigatório.' });

    const factory = require('./erp/providers/connection-factory');
    let conn;
    try {
      if (conexao_id) {
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
      _audit(req, 'preview_sql', { linhas: rows.length, conexao: conn.nome });
      res.json({ columns, rows, total: rows.length, conexao: conn.nome });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const row = crud.buscarPorId('datasets', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/datasets', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const { nome, erp, sql_base, campo_data, colunas_metrica, limite_max } = req.body;
    if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome.' });
    const row = crud.criar('datasets', {
      empresa_id:      eid(req),
      nome:            nome.trim(),
      erp:             erp             || 'protheus',
      sql_base:        sql_base        || null,
      campo_data:      String(campo_data || 'data').trim(),
      colunas_metrica: colunas_metrica ? String(colunas_metrica).trim() : null,
      limite_max:      parseInt(limite_max) || 1000,
    });
    _audit(req, 'criar_dataset', { id: row.id, nome: row.nome });
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, canDatasets, (req, res) => {
    const existing = crud.buscarPorId('datasets', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'erp', 'sql_base', 'campo_data', 'colunas_metrica', 'limite_max'];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    if (campos.campo_data)      campos.campo_data      = String(campos.campo_data).trim();
    if (campos.colunas_metrica) campos.colunas_metrica = String(campos.colunas_metrica).trim();
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

  // ────────────────────────────────────────────────────────────────────────────
  // SINÔNIMOS — dicionário de equivalências por empresa
  // ────────────────────────────────────────────────────────────────────────────

  const canSinonimos = requireRotina('iac-admin-sinonimos');

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
    res.json(crud.listar('synonyms', { empresa_id: eid(req) }));
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

    const _callGemini = (apiKey) => new Promise((resolve, reject) => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });
      const path = `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
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

    const CALLERS = { groq: _callGroq, gemini: _callGemini, deepseek: _callDeepSeek, claude: _callClaude };

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
    res.json(interpretationLog.listar(eid(req), { limit: req.query.limit }));
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

};

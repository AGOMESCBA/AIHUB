const crud = require('./database/crud');
const { getDB } = require('./database');

module.exports = function registrarRotasAdmin(app, { requireAuth, requireIaCommand }) {

  function eid(req) { return req.session.empresa_id; }

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

  // ────────────────────────────────────────────────────────────────────────────
  // INTENÇÕES
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/intencoes', requireAuth, requireIaCommand, (req, res) => {
    const rows = crud.listar('intentions', { empresa_id: eid(req) });
    res.json(rows);
  });

  app.get('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, (req, res) => {
    const row = crud.buscarPorId('intentions', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/intencoes', requireAuth, requireIaCommand, (req, res) => {
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
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('intentions', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'descricao', 'modulo', 'acao', 'dataset_id', 'frases_exemplo', 'ativo'];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    const row = crud.atualizar('intentions', req.params.id, campos);
    _audit(req, 'editar_intencao', { id: req.params.id, campos: Object.keys(campos) });
    res.json(row);
  });

  app.delete('/api/ia-command/admin/intencoes/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('intentions', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('intentions', req.params.id);
    _audit(req, 'excluir_intencao', { id: req.params.id, nome: existing.nome });
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // DATASETS
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/datasets', requireAuth, requireIaCommand, (req, res) => {
    const rows = crud.listar('datasets', { empresa_id: eid(req) });
    res.json(rows);
  });

  app.get('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, (req, res) => {
    const row = crud.buscarPorId('datasets', req.params.id);
    if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/datasets', requireAuth, requireIaCommand, (req, res) => {
    const { nome, erp, tabelas, joins, campos, filtros, agrupamentos, ordenacoes, limite_max } = req.body;
    if (!nome) return res.status(400).json({ error: 'Campo obrigatório: nome.' });
    const row = crud.criar('datasets', {
      empresa_id:   eid(req),
      nome:         nome.trim(),
      erp:          erp          || 'protheus',
      tabelas:      tabelas      || null,
      joins:        joins        || null,
      campos:       campos       || null,
      filtros:      filtros      || null,
      agrupamentos: agrupamentos || null,
      ordenacoes:   ordenacoes   || null,
      limite_max:   parseInt(limite_max) || 1000,
    });
    _audit(req, 'criar_dataset', { id: row.id, nome: row.nome });
    res.status(201).json(row);
  });

  app.put('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('datasets', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    const allowed = ['nome', 'erp', 'tabelas', 'joins', 'campos', 'filtros', 'agrupamentos', 'ordenacoes', 'limite_max'];
    const campos  = {};
    for (const k of allowed) { if (req.body[k] !== undefined) campos[k] = req.body[k]; }
    const row = crud.atualizar('datasets', req.params.id, campos);
    _audit(req, 'editar_dataset', { id: req.params.id, campos: Object.keys(campos) });
    res.json(row);
  });

  app.delete('/api/ia-command/admin/datasets/:id', requireAuth, requireIaCommand, (req, res) => {
    const existing = crud.buscarPorId('datasets', req.params.id);
    if (!existing || existing.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
    crud.excluir('datasets', req.params.id);
    _audit(req, 'excluir_dataset', { id: req.params.id, nome: existing.nome });
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // LOGS DE EXECUÇÃO (somente leitura)
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/execucoes', requireAuth, requireIaCommand, (req, res) => {
    const db    = getDB();
    const empId = eid(req);
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const rows  = db.prepare(
      `SELECT * FROM execution_log WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT ?`
    ).all(empId, limit);
    res.json(rows);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // AUDITORIA (somente leitura)
  // ────────────────────────────────────────────────────────────────────────────

  app.get('/api/ia-command/admin/auditoria', requireAuth, requireIaCommand, (req, res) => {
    const db    = getDB();
    const empId = eid(req);
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const rows  = db.prepare(
      `SELECT * FROM audit_log WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT ?`
    ).all(empId, limit);
    res.json(rows);
  });

};

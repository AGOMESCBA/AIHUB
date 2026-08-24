'use strict';

// CRUD administrativo de whatsapp_response_config — parametros por empresa que controlam
// o formato de resposta do WhatsApp real (limites de tamanho, top destaques, anexo
// automatico de PDF/Excel). Uma linha por empresa (UNIQUE(empresa_id)).

const crud = require('../database/crud');
const { requireRotina } = require('../permissions');
const { getEmpresaId } = require('../empresa-context');
const whatsappResponseConfig = require('./whatsapp-response-config');

const CAMPOS_EDITAVEIS = [
  'limite_parte_whatsapp',
  'limite_pergunta_anexo_caracteres',
  'anexar_pdf_automatico_acima_de',
  'anexar_excel_automatico_acima_de',
  'formato_padrao_anexo',
];

module.exports = function registrarRotasWhatsappResponseConfig(app, { requireAuth, requireIaCommand }) {
  function eid(req) { return getEmpresaId(req); }
  const canConfig = requireRotina('iac-admin-whatsapp-response-config');

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

  function _extrairCampos(body) {
    const campos = {};
    for (const campo of CAMPOS_EDITAVEIS) {
      if (body[campo] === undefined) continue;
      if (campo === 'formato_padrao_anexo') {
        const v = String(body[campo] || '').trim().toLowerCase();
        campos[campo] = ['pdf', 'excel'].includes(v) ? v : null;
      } else {
        const n = Number(body[campo]);
        campos[campo] = Number.isFinite(n) && n >= 0 ? n : null;
      }
    }
    return campos;
  }

  // Lista a config de todas as empresas (visão administrativa) — cada linha ja vem
  // mesclada com os DEFAULTS para exibir o valor efetivo na grade, mesmo quando a
  // empresa nao tem override de um campo especifico.
  app.get('/api/ia-command/admin/whatsapp-response-config', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const rows = crud.listar('whatsapp_response_config');
    res.json(rows.map(row => ({
      ...whatsappResponseConfig.obterConfigWhatsapp(row.empresa_id),
      id: row.id,
      empresa_id: row.empresa_id,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    })));
  });

  app.get('/api/ia-command/admin/whatsapp-response-config/:id', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const row = crud.buscarPorId('whatsapp_response_config', req.params.id);
    if (!row) return res.status(404).json({ error: 'Nao encontrado.' });
    res.json(row);
  });

  app.post('/api/ia-command/admin/whatsapp-response-config', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const empresaId = Number(req.body.empresa_id || eid(req));
    if (!empresaId) return res.status(400).json({ error: 'Campo obrigatorio: empresa_id.' });

    const existente = crud.buscarPor('whatsapp_response_config', 'empresa_id', empresaId);
    if (existente) return res.status(409).json({ error: 'Ja existe configuracao para esta empresa. Edite a existente.' });

    try {
      const row = crud.criar('whatsapp_response_config', {
        empresa_id: empresaId,
        ..._extrairCampos(req.body),
      });
      whatsappResponseConfig.invalidarCache(empresaId);
      _audit(req, 'criar_whatsapp_response_config', { id: row.id, empresa_id: empresaId });
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/ia-command/admin/whatsapp-response-config/:id', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const existing = crud.buscarPorId('whatsapp_response_config', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Nao encontrado.' });

    try {
      const row = crud.atualizar('whatsapp_response_config', req.params.id, _extrairCampos(req.body));
      whatsappResponseConfig.invalidarCache(existing.empresa_id);
      _audit(req, 'editar_whatsapp_response_config', { id: req.params.id, empresa_id: existing.empresa_id, campos: Object.keys(_extrairCampos(req.body)) });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ia-command/admin/whatsapp-response-config/:id', requireAuth, requireIaCommand, canConfig, (req, res) => {
    const existing = crud.buscarPorId('whatsapp_response_config', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Nao encontrado.' });
    crud.excluir('whatsapp_response_config', req.params.id);
    whatsappResponseConfig.invalidarCache(existing.empresa_id);
    _audit(req, 'excluir_whatsapp_response_config', { id: req.params.id, empresa_id: existing.empresa_id });
    res.json({ ok: true });
  });

  // Devolve os defaults do sistema (para a tela mostrar placeholder/dica nos campos vazios).
  app.get('/api/ia-command/admin/whatsapp-response-config-defaults', requireAuth, requireIaCommand, canConfig, (req, res) => {
    res.json(whatsappResponseConfig.DEFAULTS);
  });
};

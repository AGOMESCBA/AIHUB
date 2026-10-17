const multer = require('multer');
const service = require('../services/retorno-softexpert-service');
const armazenamento = require('../services/armazenamento-anexos');

const upload = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: armazenamento.TAMANHO_MAXIMO_BYTES, files: 1, fields: 1, fieldSize: 500000, parts: 2,
} }).array('arquivos', 1);

module.exports = function registrarRotasRetorno(app, prefixo) {
  const path = `${prefixo}/radar/chamados/:chamadoId/retorno`;
  const contexto = (req) => ({ empresaId: req.svcEmpresaId, chamadoId: req.params.chamadoId, consultorId: req.svcConsultorExterno, otpVerificadoEm: req.svcOtpVerificadoEm, usuarioId: req.session?.authenticated ? req.session.user_id : null });
  const responderErro = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível preparar o retorno ao SoftExpert.' });
  app.get(path, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(service.obterFormulario(contexto(req))); } catch (err) { responderErro(res, err); }
  });
  app.post(path, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session?.authenticated && !req.svcConsultorExterno) {
      let mesmaOrigem = false;
      try { mesmaOrigem = new URL(req.headers.origin).host === req.get('host'); } catch (_) {}
      if (!mesmaOrigem) return res.status(403).json({ error: 'Origem da confirmação inválida.' });
    }
    if (Number(req.headers['content-length'] || 0) > 52 * 1024 * 1024) return res.status(413).json({ error: 'Limite total de envio excedido.' });
    try { service.autorizar(contexto(req)); } catch (err) { return responderErro(res, err); }
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: 'Anexos inválidos ou limite de envio excedido.' });
      try {
        let dados;
        try { dados = JSON.parse(req.body?.dados || 'null'); } catch (_) { return res.status(400).json({ error: 'Dados do retorno inválidos.' }); }
        const result = await service.registrar(contexto(req), dados, req.files || []);
        res.status(result.status === 'registrado' ? 201 : result.status === 'bloqueado_configuracao' ? 409 : 200).json(result);
      } catch (error) { responderErro(res, error); }
    });
  });
  app.get(`${path}/:tentativaId`, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(service.consultar(contexto(req), req.params.tentativaId)); } catch (err) { responderErro(res, err); }
  });
  app.get(`${path}/por-chave/:chave`, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(service.consultarPorChave(contexto(req), req.params.chave)); } catch (err) { responderErro(res, err); }
  });
};

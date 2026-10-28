// Números Autorizados pelo menu do IA Service (2026-10-28). Mesmo cadastro da
// Platform que o login por telefone lê, mas restrito ao vínculo do IA Service
// — ver apps/IAHUB/backend/platform-numeros-ia-service.js para as regras.
//
// ORDEM DE REGISTRO IMPORTA: registrar() precisa ser chamado depois de
// app.use('/api/ia-service', requireAuth, requireIaService, requireEmpresaContext)
// — a empresa usada é sempre req.svcEmpresaId, já validada contra o acesso do
// usuário (nunca o empresaId do corpo, como a rota de admin da Platform aceita).

const numeros = require('../../../IAHUB/backend/platform-numeros-ia-service');
const presencaService = require('../services/presenca-service');
const { requireRotinaSvc } = require('../services/rotina-permissao');

const ROTINA = 'svc-numeros-autorizados';

function _handleErro(res, err) {
  const status = err.status || (/obrigatóri|inválid|Informe/i.test(err.message) ? 400 : 500);
  res.status(status).json({ error: status === 500 ? 'Falha ao gravar o número autorizado.' : err.message });
  if (status === 500) console.error('[IA Service] Números Autorizados:', err);
}

function _auditar(req, acao, alvo, detalhe) {
  try {
    presencaService.registrarAuditoria({
      empresaId: req.svcEmpresaId, acao, alvo, usuarioId: Number(req.session?.user_id) || null, detalhe,
    });
  } catch (err) {
    console.warn('[IA Service] Auditoria de Números Autorizados falhou:', err.message);
  }
}

function registrar(app) {
  const pode = requireRotinaSvc(ROTINA);

  app.get('/api/ia-service/numeros-autorizados', pode, (req, res) => {
    try {
      res.json(numeros.listar(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/numeros-autorizados', pode, (req, res) => {
    try {
      const { id, nome, numero, observacoes, idSoftexpert, papel, preAnaliseAutomatica, estiloResposta } = req.body || {};
      const r = numeros.salvar(req.svcEmpresaId, { id, nome, numero, observacoes, idSoftexpert, papel, preAnaliseAutomatica, estiloResposta });
      _auditar(req, r.criado || r.vinculadoAExistente ? 'numero_autorizado_incluir' : 'numero_autorizado_alterar', r.id,
        { numero: String(numero || '').replace(/\D/g, ''), idSoftexpert, papel, preAnaliseAutomatica, estiloResposta });
      res.status(r.criado ? 201 : 200).json(r);
    } catch (err) {
      _handleErro(res, err);
    }
  });

  // Sem exclusão (decisão do usuário): inativar desliga só o acesso ao IA Service.
  app.put('/api/ia-service/numeros-autorizados/:id/liberado', pode, (req, res) => {
    try {
      const liberado = req.body?.liberado === true;
      const r = numeros.definirLiberado(req.svcEmpresaId, req.params.id, liberado);
      _auditar(req, liberado ? 'numero_autorizado_ativar' : 'numero_autorizado_inativar', r.id, { numero: r.numero });
      res.json(r);
    } catch (err) {
      _handleErro(res, err);
    }
  });
}

module.exports = { registrar, ROTINA };

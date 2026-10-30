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
const clienteRepo = require('../repositories/cliente-repository');
const consultorRepo = require('../repositories/consultor-repository');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');
const sistemasDb = require('../../../IAHUB/backend/sistemas/database');
const empresasDb = require('../../../IAHUB/backend/empresas/database');
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

function _erroCom(status, msg) {
  return Object.assign(new Error(msg), { status });
}

const _digitos = (v) => String(v || '').replace(/\D/g, '');

// Só vale para usuário novo no vínculo: quem já estava vinculado não trava a
// edição dos outros campos se perder o acesso depois.
function _conferirUsuarioIahub(empresaId, usuarioId, numero) {
  if (!usuarioId) return;
  if (!sistemasDb.hasUserSystem(Number(usuarioId), Number(empresaId), 'ia-service')) {
    throw _erroCom(400, 'O usuário escolhido não tem acesso ao IA Service nesta empresa.');
  }
  // consultores aceita um só telefone por usuário e empresa: o login do número
  // novo falharia ao gravar o vínculo.
  const consultor = consultorRepo.getConsultorPorUsuario(empresaId, Number(usuarioId));
  if (consultor?.telefone && _digitos(consultor.telefone) !== _digitos(numero)) {
    throw _erroCom(409, 'Este usuário do IAHub já está vinculado a outro telefone nesta empresa.');
  }
}

// Aplica o cadastro no analista na hora, sem esperar o próximo login: o Chat
// interno do Monitor acha o analista pelo usuário do IAHub. O cadastro já foi
// gravado; se falhar aqui, o próximo login refaz o mesmo passo.
function _sincronizarConsultor(empresaId, identityId) {
  try {
    const item = numeros.listar(empresaId).find(i => i.id === identityId);
    if (!item?.idSoftexpert) return;
    const consultor = consultorRepo.upsertConsultorPlatform(empresaId, {
      platformIdentityId: item.id,
      usuarioIdIahub: item.usuarioIdIahub,
      idSoftexpert: item.idSoftexpert,
      telefone: item.numero,
      ativo: item.situacao === 'ativo',
      preAnaliseAutomatica: item.preAnaliseAutomatica,
    });
    if (!item.usuarioIdIahub && consultor?.usuarioIdIahub) consultorRepo.desvincularUsuario(empresaId, consultor.id);
  } catch (err) {
    console.error('[IA Service] Números Autorizados: sincronizar analista falhou:', err.message);
  }
}

function registrar(app) {
  const pode = requireRotinaSvc(ROTINA);

  // Opções do formulário: só o necessário para escolher (sem e-mail, perfil etc.).
  app.get('/api/ia-service/numeros-autorizados/opcoes', pode, (req, res) => {
    try {
      const empresaId = req.svcEmpresaId;
      const empresa = empresasDb.buscarPorId(empresaId);
      const tecnicos = new Map();
      for (const t of clienteRepo.listarTecnicos(empresaId)) {
        if (t.idOrigem && !tecnicos.has(t.idOrigem)) tecnicos.set(t.idOrigem, { idSoftexpert: t.idOrigem, nome: t.nome || '' });
      }
      const usuarios = usuariosDb.listar()
        .filter(u => u.ativo && sistemasDb.hasUserSystem(u.id, empresaId, 'ia-service'))
        .map(u => ({ id: Number(u.id), nome: u.nome || `Usuário #${u.id}` }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      res.json({
        empresa: { id: empresaId, nome: empresa?.nome_fantasia || empresa?.razao_social || empresa?.nome || null },
        linkAcesso: numeros.linkDeAcesso(empresaId),
        tecnicos: [...tecnicos.values()],
        usuarios,
      });
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.get('/api/ia-service/numeros-autorizados', pode, (req, res) => {
    try {
      res.json(numeros.listar(req.svcEmpresaId));
    } catch (err) {
      _handleErro(res, err);
    }
  });

  app.post('/api/ia-service/numeros-autorizados', pode, (req, res) => {
    try {
      const { id, nome, numero, observacoes, idSoftexpert, usuarioIdIahub, papel, preAnaliseAutomatica, estiloResposta, liberado } = req.body || {};
      const antes = id ? numeros.listar(req.svcEmpresaId).find(i => i.id === String(id)) : null;
      if (Number(usuarioIdIahub) !== antes?.usuarioIdIahub) _conferirUsuarioIahub(req.svcEmpresaId, usuarioIdIahub, numero);
      const r = numeros.salvar(req.svcEmpresaId, { id, nome, numero, observacoes, idSoftexpert, usuarioIdIahub, papel, preAnaliseAutomatica, estiloResposta, liberado });
      _sincronizarConsultor(req.svcEmpresaId, r.id);
      _auditar(req, r.criado || r.vinculadoAExistente ? 'numero_autorizado_incluir' : 'numero_autorizado_alterar', r.id,
        { numero: _digitos(numero), idSoftexpert, usuarioIdIahub: usuarioIdIahub || null, papel, preAnaliseAutomatica, estiloResposta, liberado });
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

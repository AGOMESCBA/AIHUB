// Camada de orquestracao do cadastro de Consultores/Tecnicos do IA Service.
//
// IMPORTANTE (seção 14/15 do prompt da Etapa 1): este NÃO é um novo sistema de
// login. Login continua sendo por telefone (login-externo-service.js), nunca
// senha própria aqui.
//
// 2026-09 (decisão explícita do usuário, reverte a exigência original):
// usuarioIdIahub deixou de ser obrigatório — a intenção é cadastrar
// consultores como "analista com telefone", sem precisar vincular/criar um
// usuário de login do IA HUB para cada um (o único caminho de acesso ao
// Radar hoje é por telefone, que nunca depende desse vínculo). Quando
// usuarioIdIahub É informado, continua validado contra o cadastro real do
// IAHub — nunca vincula um ID inexistente silenciosamente.

const consultorRepo = require('../repositories/consultor-repository');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');
const platformStore = require('../../../IAHUB/backend/platform-store');
const { validarEstilo } = require('../../../IAHUB/backend/estilos-resposta');

function obterEstiloResposta(empresaId, consultorId) {
  const consultor = consultorId ? consultorRepo.getConsultor(empresaId, consultorId) : null;
  return consultor?.ativo ? platformStore.obterEstiloResposta(empresaId, consultor.telefone) : 'ORIGINAL';
}

function salvarPreferencias(empresaId, consultorId, patch = {}) {
  const consultor = consultorRepo.getConsultor(empresaId, consultorId);
  if (!consultor?.ativo) throw Object.assign(new Error('Consultor ativo não encontrado nesta empresa.'), { status: 404 });
  if (Object.hasOwn(patch, 'estiloResposta')) validarEstilo(patch.estiloResposta);
  if (Object.hasOwn(patch, 'preAnaliseAutomatica') && patch.preAnaliseAutomatica !== null && typeof patch.preAnaliseAutomatica !== 'boolean') {
    throw Object.assign(new Error('Preferência de pré-análise inválida.'), { status: 400 });
  }
  if (Object.hasOwn(patch, 'estiloResposta')) platformStore.definirEstiloResposta(empresaId, consultor.telefone, patch.estiloResposta);
  if (Object.hasOwn(patch, 'preAnaliseAutomatica')) consultorRepo.definirPreferenciaPessoal(empresaId, consultorId, patch.preAnaliseAutomatica);
  return { ...consultorRepo.getConsultor(empresaId, consultorId), estiloResposta: obterEstiloResposta(empresaId, consultorId) };
}

function criarConsultor(empresaId, dados) {
  if (dados.usuarioIdIahub) {
    const usuario = usuariosDb.buscarPorId(dados.usuarioIdIahub);
    if (!usuario) {
      throw new Error(`Usuário IA HUB não encontrado: ${dados.usuarioIdIahub}`);
    }
    if (!usuario.ativo) {
      throw new Error(`Usuário IA HUB inativo: ${dados.usuarioIdIahub}`);
    }
  }

  return consultorRepo.criarConsultor(empresaId, dados);
}

function getConsultor(empresaId, consultorId) {
  return consultorRepo.getConsultor(empresaId, consultorId);
}

// Resolve o nome de exibição do consultor: SEMPRE o nome do cadastro de
// números autorizados (técnico importado do SoftExpert, via id_softexpert
// — ver nota em consultor-repository.getNomeTecnicoPorIdOrigem), mesmo
// quando há usuarioIdIahub vinculado. Decisão explícita do usuário
// (2026-10): o nome exibido no login por telefone deve refletir sempre o
// cadastro do WhatsApp, não o nome do usuário de login do IAHub — o
// vínculo com usuarioIdIahub existe por outros motivos (ex. permissões),
// não para sobrepor o nome de exibição. Cai para o usuário IAHub só se o
// SoftExpert não tiver nome algum (consultor sem id_softexpert ainda
// visto numa importação).
function getNomeExibicao(empresaId, consultorId) {
  const consultor = consultorRepo.getConsultor(empresaId, consultorId);
  if (!consultor) return null;
  const nomeTecnico = consultorRepo.getNomeTecnicoPorIdOrigem(empresaId, consultor.idSoftexpert);
  if (nomeTecnico) return nomeTecnico;
  if (consultor.usuarioIdIahub) {
    const usuario = usuariosDb.buscarPorId(consultor.usuarioIdIahub);
    if (usuario?.nome) return usuario.nome;
  }
  return null;
}

function getConsultorPorUsuario(empresaId, usuarioIdIahub) {
  return consultorRepo.getConsultorPorUsuario(empresaId, usuarioIdIahub);
}

// Caminho inverso de getNomeExibicao: usado na tela de sessão por cookie
// (analista interno logado com usuário/senha do IAHub), onde já se tem o
// usuarioIdIahub da sessão e nenhum consultorId SoftExpert à mão.
function getNomeExibicaoPorUsuarioIahub(usuarioIdIahub) {
  if (!usuarioIdIahub) return null;
  const usuario = usuariosDb.buscarPorId(usuarioIdIahub);
  return usuario?.nome || null;
}

function listarConsultores(empresaId, filtros) {
  return consultorRepo.listarConsultores(empresaId, filtros);
}

function atualizarConsultor(empresaId, consultorId, patch) {
  return consultorRepo.atualizarConsultor(empresaId, consultorId, patch);
}

function definirPreferenciaPessoal(empresaId, consultorId, valor) {
  return consultorRepo.definirPreferenciaPessoal(empresaId, consultorId, valor);
}

function excluirConsultor(empresaId, consultorId) {
  return consultorRepo.excluirConsultor(empresaId, consultorId);
}

module.exports = {
  obterEstiloResposta,
  salvarPreferencias,
  criarConsultor,
  getConsultor,
  getConsultorPorUsuario,
  getNomeExibicao,
  getNomeExibicaoPorUsuarioIahub,
  listarConsultores,
  atualizarConsultor,
  definirPreferenciaPessoal,
  excluirConsultor,
};

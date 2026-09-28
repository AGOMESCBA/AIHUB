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

function getConsultorPorUsuario(empresaId, usuarioIdIahub) {
  return consultorRepo.getConsultorPorUsuario(empresaId, usuarioIdIahub);
}

function listarConsultores(empresaId, filtros) {
  return consultorRepo.listarConsultores(empresaId, filtros);
}

function atualizarConsultor(empresaId, consultorId, patch) {
  return consultorRepo.atualizarConsultor(empresaId, consultorId, patch);
}

function excluirConsultor(empresaId, consultorId) {
  return consultorRepo.excluirConsultor(empresaId, consultorId);
}

module.exports = {
  criarConsultor,
  getConsultor,
  getConsultorPorUsuario,
  listarConsultores,
  atualizarConsultor,
  excluirConsultor,
};

// Camada de orquestracao do cadastro de Consultores/Tecnicos do IA Service.
//
// IMPORTANTE (seção 14/15 do prompt da Etapa 1): este NÃO é um novo sistema de
// login. O consultor é um perfil complementar a um usuário JÁ existente do
// IA HUB (apps/IAHUB/backend/usuarios) — nunca duplicar autenticação, nunca
// criar usuário/senha próprios aqui.

const consultorRepo = require('../repositories/consultor-repository');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');

function criarConsultor(empresaId, dados) {
  const usuario = usuariosDb.buscarPorId(dados.usuarioIdIahub);
  // Seção 17 do prompt: "usuário IA HUB inexistente não pode ser vinculado
  // silenciosamente" — falha explícita, nunca cria o vínculo sem confirmar
  // que o usuário existe de fato no cadastro real da plataforma.
  if (!usuario) {
    throw new Error(`Usuário IA HUB não encontrado: ${dados.usuarioIdIahub}`);
  }
  if (!usuario.ativo) {
    throw new Error(`Usuário IA HUB inativo: ${dados.usuarioIdIahub}`);
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

module.exports = {
  criarConsultor,
  getConsultor,
  getConsultorPorUsuario,
  listarConsultores,
  atualizarConsultor,
};

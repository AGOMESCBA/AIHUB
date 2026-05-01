const bcrypt = require('bcryptjs');
const crud   = require('../crud');

const ARQUIVO = 'usuarios';

// Nunca expõe o hash de senha
function _semHash(u) {
  if (!u) return null;
  const { senha_hash, ...rest } = u;
  return rest;
}

function listar() {
  return crud.listar(ARQUIVO).map(_semHash);
}

function buscarPorId(id) {
  return _semHash(crud.buscarPorId(ARQUIVO, id));
}

async function criar(dados) {
  const { senha, ...rest } = dados;

  if (!senha) throw new Error('Senha é obrigatória');

  const senha_hash = await bcrypt.hash(senha, 12);
  const criado     = crud.criar(ARQUIVO, { ...rest, senha_hash, ativo: true });
  return _semHash(criado);
}

async function atualizar(id, dados) {
  const patch = { ...dados };

  if (patch.senha) {
    patch.senha_hash = await bcrypt.hash(patch.senha, 12);
  }
  delete patch.senha; // nunca persiste a senha em texto plano

  const atualizado = crud.atualizar(ARQUIVO, id, patch);
  return _semHash(atualizado);
}

function excluir(id) {
  return crud.excluir(ARQUIVO, id);
}

module.exports = { listar, buscarPorId, criar, atualizar, excluir };

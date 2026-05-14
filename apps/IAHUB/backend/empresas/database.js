const crud = require('../crud');

const ARQUIVO = 'empresas';

function listar()        { return crud.listar(ARQUIVO); }
function buscarPorId(id) { return crud.buscarPorId(ARQUIVO, id); }
function criar(dados)    { return crud.criar(ARQUIVO, dados); }
function atualizar(id, dados) { return crud.atualizar(ARQUIVO, id, dados); }
function excluir(id)     { return crud.excluir(ARQUIVO, id); }

module.exports = { listar, buscarPorId, criar, atualizar, excluir };

'use strict';

// Isolamento entre empresas: o contexto (empresa, usuário, aplicação) vem SÓ
// da sessão ou da credencial validada no backend, nunca do corpo ou da URL.
// Toda consulta de dado de empresa passa por `escopo(contexto)`, que exige o
// parâmetro @empresa_id no SQL e o preenche com a empresa do contexto.
// Assim um SQL esquecido sem filtro de empresa falha no teste, em vez de
// devolver dado de outra empresa em produção.

const { erro } = require('../erros');

class Contexto {
  constructor({ empresaId = null, usuarioId = null, aplicacaoId = null, papel = null, plataforma = false } = {}) {
    this.empresaId = empresaId;
    this.usuarioId = usuarioId;
    this.aplicacaoId = aplicacaoId;
    this.papel = papel;
    this.plataforma = Boolean(plataforma);
    Object.freeze(this);
  }

  exigirEmpresa() {
    if (!this.empresaId) throw erro('nao_autenticado', 'Sessão sem empresa selecionada. Entre de novo.');
    return this.empresaId;
  }

  exigirPlataforma() {
    if (!this.plataforma) throw erro('sem_permissao', 'Só a administração da plataforma pode fazer isto.');
  }
}

const MARCA_EMPRESA = /@empresa_id\b/;

function _conferirSql(sql) {
  if (!MARCA_EMPRESA.test(sql)) {
    throw new Error(`SQL de dado de empresa sem filtro @empresa_id: ${String(sql).replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  }
}

function escopo(db, contexto) {
  if (!(contexto instanceof Contexto)) throw new Error('escopo() exige um Contexto.');
  const empresaId = contexto.exigirEmpresa();
  const comEmpresa = (params = {}) => ({ ...params, empresa_id: empresaId });
  return {
    empresaId,
    todos(sql, params) { _conferirSql(sql); return db.prepare(sql).all(comEmpresa(params)); },
    um(sql, params) { _conferirSql(sql); return db.prepare(sql).get(comEmpresa(params)); },
    executar(sql, params) { _conferirSql(sql); return db.prepare(sql).run(comEmpresa(params)); },
  };
}

module.exports = { Contexto, escopo };

'use strict';

// Controle de acesso das rotas administrativas: a sessão vira um Contexto
// (repositorios/base.js), e cada rota declara a rotina que exige.

const sessoes = require('./sessoes');
const { rotinasDe } = require('./papeis');
const { erro } = require('../erros');

function carregarSessao(db) {
  return (req, _res, next) => {
    const token = sessoes.lerCookie(req);
    const s = token ? sessoes.validar(db, token) : null;
    if (s) {
      req.sessao = s;
      req.contexto = sessoes.contextoDaSessao(s);
      req.rotinas = rotinasDe({ papel: s.papel, plataforma: !!s.administrador_plataforma });
    }
    next();
  };
}

function exigirSessao(req, _res, next) {
  if (!req.sessao) return next(erro('nao_autenticado', 'Sua sessão terminou. Entre de novo pelo link da sua empresa.'));
  next();
}

function exigirRotina(rotina) {
  return (req, _res, next) => {
    if (!req.sessao) return next(erro('nao_autenticado', 'Sua sessão terminou. Entre de novo pelo link da sua empresa.'));
    if (!req.rotinas.includes(rotina)) return next(erro('sem_permissao', 'Você não tem permissão para esta rotina. Fale com o administrador da empresa.'));
    next();
  };
}

function exigirPlataforma(req, _res, next) {
  if (!req.sessao) return next(erro('nao_autenticado', 'Sua sessão terminou. Entre de novo pelo link da sua empresa.'));
  if (!req.contexto.plataforma) return next(erro('sem_permissao', 'Só a administração da plataforma pode fazer isto.'));
  next();
}

// Endereço do cliente para auditoria e limites (nginx na mesma máquina = trust proxy loopback).
function ipDe(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
}

module.exports = { carregarSessao, exigirSessao, exigirRotina, exigirPlataforma, ipDe };

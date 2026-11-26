'use strict';

// Controle de acesso das rotas administrativas: a sessão vira um Contexto
// (repositorios/base.js), e cada rota declara a rotina que exige.

const sessoes = require('./sessoes');
const { rotinasDaSessao } = require('./papeis');
const { erro } = require('../erros');

function carregarSessao(db) {
  return (req, _res, next) => {
    const token = sessoes.lerCookie(req);
    const s = token ? sessoes.validar(db, token) : null;
    if (s) {
      req.sessao = s;
      req.contexto = sessoes.contextoDaSessao(s);
      req.rotinas = rotinasDaSessao(s);
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

// O IIS (ARR) pode repassar o IP com a porta ("10.0.0.5:25614" ou "[::1]:25614").
// A porta muda a cada conexão: sem tirá-la, os limites por IP nunca somam.
function normalizarIp(valor) {
  const v = String(valor || '').trim().replace(/^::ffff:/, '');
  const m = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/) || v.match(/^\[([^\]]+)\]:\d+$/);
  return (m ? m[1] : v).replace(/^::ffff:/, '') || null;
}

// Endereço do cliente para auditoria e limites (proxy na mesma máquina = trust proxy loopback).
function ipDe(req) {
  return normalizarIp(req.ip || req.socket?.remoteAddress);
}

module.exports = { carregarSessao, exigirSessao, exigirRotina, exigirPlataforma, ipDe, normalizarIp };

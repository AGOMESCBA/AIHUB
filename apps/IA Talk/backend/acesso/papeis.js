'use strict';

// Catálogo único de papéis e rotinas do IA Talk (servidor real e simulado).
// Rotina = item de menu (mesma ideia do IAHub: "não existe rotina fora de um menu";
// ver frontend/js/talk-sidebar.js).

const ROTINAS = Object.freeze({
  painel: 'talk-painel',
  canais: 'talk-canais',
  mensagens: 'talk-mensagens',
  eventos: 'talk-eventos',
  aplicacoes: 'talk-aplicacoes',
  usuarios: 'talk-usuarios',
  configuracoes: 'talk-configuracoes',
  auditoria: 'talk-auditoria',
  empresas: 'talk-empresas', // só administração da plataforma
});

const R = ROTINAS;
const PAPEIS = Object.freeze([
  { codigo: 'admin_empresa', nome: 'Administrador da empresa', descricao: 'Configura canais, aplicações, usuários e e-mail de envio da própria empresa.',
    rotinas: [R.painel, R.canais, R.mensagens, R.eventos, R.aplicacoes, R.usuarios, R.configuracoes, R.auditoria] },
  { codigo: 'supervisor', nome: 'Supervisor', descricao: 'Acompanha canais, mensagens e eventos. Na Fase 2, gerencia setores e filas.',
    rotinas: [R.painel, R.canais, R.mensagens, R.eventos] },
  { codigo: 'atendente', nome: 'Atendente', descricao: 'Atende conversas dos setores em que está (Fase 2). Na Fase 1, vê o painel.',
    rotinas: [R.painel] },
  { codigo: 'auditor', nome: 'Auditor', descricao: 'Somente leitura de histórico e auditoria.',
    rotinas: [R.painel, R.mensagens, R.eventos, R.auditoria] },
].map(p => Object.freeze({ ...p, rotinas: Object.freeze([...p.rotinas]) })));

function rotinasDe({ papel, plataforma = false }) {
  const doPapel = PAPEIS.find(p => p.codigo === papel)?.rotinas || [];
  if (!plataforma) return [...doPapel];
  // Administração da plataforma: tudo da empresa aberta + cadastro de empresas.
  return [...new Set([...PAPEIS[0].rotinas, R.empresas])];
}

module.exports = { ROTINAS, PAPEIS, rotinasDe };

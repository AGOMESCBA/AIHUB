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
  // Fase 2 (C8): Central de atendimento e cadastro de setores/respostas rápidas.
  atendimento: 'talk-atendimento',
  setores: 'talk-setores',
  empresas: 'talk-empresas', // só administração da plataforma
});

const R = ROTINAS;
const PAPEIS = Object.freeze([
  { codigo: 'admin_empresa', nome: 'Administrador da empresa', descricao: 'Configura canais, aplicações, usuários e e-mail de envio da própria empresa.',
    rotinas: [R.painel, R.atendimento, R.setores, R.canais, R.mensagens, R.eventos, R.aplicacoes, R.usuarios, R.configuracoes, R.auditoria] },
  { codigo: 'supervisor', nome: 'Supervisor', descricao: 'Acompanha canais, mensagens e eventos. Vê todas as conversas e gerencia setores e filas.',
    rotinas: [R.painel, R.atendimento, R.setores, R.canais, R.mensagens, R.eventos] },
  { codigo: 'atendente', nome: 'Atendente', descricao: 'Atende as conversas dos setores em que está.',
    rotinas: [R.painel, R.atendimento] },
  { codigo: 'auditor', nome: 'Auditor', descricao: 'Somente leitura de histórico e auditoria.',
    rotinas: [R.painel, R.mensagens, R.eventos, R.auditoria] },
].map(p => Object.freeze({ ...p, rotinas: Object.freeze([...p.rotinas]) })));

function rotinasDe({ papel, plataforma = false }) {
  const doPapel = PAPEIS.find(p => p.codigo === papel)?.rotinas || [];
  if (!plataforma) return [...doPapel];
  // Administração da plataforma: tudo da empresa aberta + cadastro de empresas.
  return [...new Set([...PAPEIS[0].rotinas, R.empresas])];
}

// Rotinas que valem para a sessão. Entrada pelo IAHub de usuário comum: vale o
// que a IA Gestão liberou (Usuários › Permissões, por usuário e empresa);
// nas demais, o papel do Talk.
function rotinasDaSessao(s) {
  const plataforma = !!s.administrador_plataforma;
  if (s.rotinas_hub && !plataforma) {
    const validas = new Set(Object.values(ROTINAS).filter(r => r !== ROTINAS.empresas));
    try { return JSON.parse(s.rotinas_hub).filter(r => validas.has(r)); } catch (_) { return []; }
  }
  return rotinasDe({ papel: s.papel, plataforma });
}

module.exports = { ROTINAS, PAPEIS, rotinasDe, rotinasDaSessao };

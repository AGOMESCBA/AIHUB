'use strict';

// O que o servidor já executa do atendimento (docs/contratos.md §9.12). As telas mostram "Ainda não ativo"
// no que está false, sem esconder a configuração. Cada etapa liga o seu item aqui quando fica pronta;
// o simulado devolve a mesma lista, para a tela de teste mostrar o que a produção vai mostrar.
const RECURSOS_ATENDIMENTO = Object.freeze({
  menu: true,               // C12
  midia: true,              // P1
  status_atendente: false,  // C13
  rodizio: false,           // C13
  alertas_tela: false,      // C14
  alertas_whatsapp: false,  // C14
  escalonamento: false,     // C14
  pesquisa: false,          // C15
  inatividade: false,       // C18
  sla: false,               // C19
});

module.exports = { RECURSOS_ATENDIMENTO };

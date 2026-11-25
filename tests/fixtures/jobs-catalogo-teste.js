// Catálogo de jobs só para o teste do serviço de jobs com processos filhos reais.
const { montar } = require('../../modules/jobs/catalogo');

const base = { descricao: 'teste', idempotente: true, timeoutMs: 60000, instancias: () => [], instanciaValida: () => true };

module.exports = {
  padrao: () => montar([
    { ...base, id: 'teste.ok', executar: async (instancia, { origem }) => ({ resultado: 'ok', resumo: { instancia, origem, pid: process.pid } }) },
    { ...base, id: 'teste.loga', executar: async () => { console.log('linha um'); console.error('linha de erro'); console.log('linha dois'); return { resultado: 'ok' }; } },
    { ...base, id: 'teste.lanca', executar: async () => { throw new Error('falha de propósito'); } },
    { ...base, id: 'teste.morre', executar: async () => { process.exit(3); } },
    { ...base, id: 'teste.trava', executar: () => new Promise(() => setInterval(() => {}, 1000)) },
    // Conexão aberta (keep-alive) não segura o processo depois do resultado.
    { ...base, id: 'teste.pendura', executar: async () => { setInterval(() => {}, 1000); return { resultado: 'vazio' }; } },
  ]),
};

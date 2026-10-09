const Database = require('better-sqlite3');
const db = new Database('C:/Apps/iahub/apps/IA Service/data/ia-service.db', { readonly: true });

const atendimento = db.prepare(`SELECT * FROM atendimentos WHERE referencia_externa = '036475' ORDER BY criado_em DESC LIMIT 1`).get();
if (!atendimento) {
  console.log('Nenhum atendimento encontrado para #036475.');
  process.exit(0);
}
console.log('Atendimento:', atendimento.id, atendimento.codigo, 'criado_em:', atendimento.criado_em, 'status:', atendimento.status);

const mensagens = db.prepare(`SELECT id, papel, provider, substr(conteudo,1,80) as trecho, criado_em FROM mensagens WHERE atendimento_id = ? ORDER BY criado_em`).all(atendimento.id);
console.log('\n--- Mensagens ---');
mensagens.forEach(m => console.log(m.criado_em, '|', m.papel, '|', m.provider, '|', m.trecho));

const execucoes = db.prepare(`SELECT id, status, provider, latencia_ms, criado_em, mensagem_id FROM investigacao_execucoes WHERE atendimento_id = ? ORDER BY criado_em`).all(atendimento.id);
console.log('\n--- Execucoes ---');
execucoes.forEach(e => console.log(e.criado_em, '|', e.status, '|', e.provider, '|', e.latencia_ms+'ms', '| msg:', e.mensagem_id));

db.close();

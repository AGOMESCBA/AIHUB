// Limpeza das cópias de anexos do SoftExpert em chamados encerrados.
// Sem --apagar, só SIMULA e mostra o que seria apagado.
// Uso (na raiz da instalacao):
//   node deploy/limpar-anexos-encerrados.js               (simula, prazo de 15 dias)
//   node deploy/limpar-anexos-encerrados.js --prazo=20    (simula com outro prazo)
//   node deploy/limpar-anexos-encerrados.js --apagar      (apaga de verdade)
// A rotina diaria do servidor segue SVC_LIMPEZA_ANEXOS_MODO (padrao: simular).
const path = require('path');
const raiz = path.join(__dirname, '..');
require(path.join(raiz, 'node_modules/dotenv')).config({ path: path.join(raiz, '.env'), quiet: true });

const args = process.argv.slice(2);
const apagar = args.includes('--apagar');
const prazo = Number((args.find(a => a.startsWith('--prazo=')) || '').split('=')[1]) || undefined;

const database = require(path.join(raiz, 'apps/IA Service/backend/database'));
database.inicializarDB();
const limpeza = require(path.join(raiz, 'apps/IA Service/backend/services/limpeza-anexos-encerrados-service'));

const resumo = limpeza.executar({ modo: apagar ? 'apagar' : 'simular', ...(prazo ? { prazoDias: prazo } : {}) });
console.log(`\nModo: ${resumo.modo === 'apagar' ? 'APAGAR' : 'SIMULACAO (nada foi apagado)'}`);
console.log(`Prazo: ${resumo.prazoDias} dias (ultima movimentacao antes de ${resumo.corte})`);
console.log(`Anexos: ${resumo.anexos} | Chamados: ${resumo.chamados} | Espaco: ${(resumo.bytes / (1024 * 1024)).toFixed(1)} MB`);
if (resumo.modo === 'apagar') console.log(`Removidos: ${resumo.removidos} | Erros: ${resumo.erros.length}`);
for (const e of resumo.erros.slice(0, 20)) console.log(`  erro chamado ${e.chamado}: ${e.erro}`);
if (resumo.exemplos.length) console.log(`Exemplos:\n  ${resumo.exemplos.join('\n  ')}`);
database.fecharDB();

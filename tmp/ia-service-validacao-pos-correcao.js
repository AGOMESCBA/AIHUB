'use strict';

require('dotenv').config({ path: 'c:/Apps/iahub/.env' });

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.AUDITORIA_DB_PATH || 'C:/tmp/ia-service-auditoria-pos-correcao-v2.db';
const OUT_DIR = process.env.AUDITORIA_OUT_DIR || 'C:/tmp/ia-service-auditoria-pos-correcao-resultados';

const CASOS = (process.env.CASOS_FILTRO ? process.env.CASOS_FILTRO.split(',') : null);
const TODOS_CASOS = [
  { numero: '036381', atendimentoId: '2b885e86-7b0a-446d-ba33-1c5000551103', categoria: 'SoftExpert + duvida sistemica sem anexo' },
  { numero: '035398', atendimentoId: '7d5f8667-fa5b-4832-ab30-b642689afced', categoria: 'Faturamento + documentacao tecnica PDF (DOC044)' },
  { numero: '035635', atendimentoId: '4ef8f670-d6d9-471d-93e2-bd9db0e3ab3a', categoria: 'Financeiro + varios PDFs (extratos)' },
  { numero: '033521', atendimentoId: '36f8b38c-4ff4-4aa4-a33b-5ed5c48892c5', categoria: 'Estoque + PDFs grandes (relatorios)' },
  { numero: '035068', atendimentoId: 'e7d7a4a2-fd29-4f14-9f59-f6265d2849e6', categoria: 'API/integracao + PDF + log' },
  { numero: '036166', atendimentoId: '93efaa19-6b9c-4edf-8d19-01fb58ae1af3', categoria: 'API/integracao + log, sem solucao confirmada' },
  { numero: '036558', atendimentoId: 'b8f1ccda-7d5b-4fb8-9857-29accd1a0620', categoria: 'Customizacao PRW (fonte) + prints' },
  { numero: '034178', atendimentoId: 'bc4357d6-5873-4289-993c-a4d30922456c', categoria: 'Configurador + multiplos prints' },
  { numero: '033910', atendimentoId: '2222c815-b5cf-4745-8797-8beafb87018f', categoria: 'SoftExpert + fonte PRW + prints' },
  { numero: '034658', atendimentoId: 'a4a75cca-b1d7-4550-ba4d-5129c8880265', categoria: 'SoftExpert + prints WhatsApp (erro critico)' },
];

const TEXTO_AUDITORIA = 'Faca a investigacao tecnica completa deste chamado com base no historico e nos anexos disponiveis. Aponte: problema investigado, fatos comprovados pelas evidencias, hipoteses de causa com nivel de confianca, lacunas que impedem uma conclusao definitiva, e o proximo teste/acao tecnica mais util para o consultor executar agora. Nao afirme ter visto conteudo de anexo que nao foi efetivamente analisado nesta chamada. Nao trate hipotese como causa confirmada sem evidencia direta.';

function log(...args) { console.log(new Date().toISOString(), ...args); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const database = require('c:/Apps/iahub/apps/IA Service/backend/database');
  database.inicializarDB(DB_PATH);

  const investigacaoService = require('c:/Apps/iahub/apps/IA Service/backend/services/investigacao-service');
  const execucaoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/investigacao-execucao-repository');
  const anexoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/anexo-repository');

  const EMPRESA_ID = 1;
  const listaCasos = CASOS ? TODOS_CASOS.filter(c => CASOS.includes(c.numero)) : TODOS_CASOS;
  const resultados = [];

  for (const caso of listaCasos) {
    log(`\n=== ${caso.numero} (${caso.categoria}) ===`);
    const inicioCaso = Date.now();
    const item = { numero: caso.numero, categoria: caso.categoria, atendimentoId: caso.atendimentoId };
    try {
      const anexos = anexoRepo.listarAnexos(EMPRESA_ID, caso.atendimentoId).map(a => a.id);
      log(`  ${anexos.length} anexos; chamando processarTurno REAL (com retry automatico do QG)...`);
      const msg = await investigacaoService.processarTurno(EMPRESA_ID, caso.atendimentoId, {
        texto: TEXTO_AUDITORIA,
        usuarioId: null,
        anexoIds: anexos,
        anexosComoContexto: true,
        forcarPesquisa: true,
        analistaAtualNome: 'Validacao pos-correcao',
      });
      const execs = execucaoRepo.listarPorAtendimento(EMPRESA_ID, caso.atendimentoId, { limite: 5 });
      const execucao = execs[0] || null;
      item.respostaTexto = msg.conteudo;
      item.provider = msg.provider;
      item.model = msg.model;
      item.execucaoStatus = execucao?.status || null;
      item.qualityGate = execucao?.qualityGate || null;
      item.retryDeQualityGate = execucao?.retryDeQualityGate || false;
      item.latenciaMs = execucao?.latenciaMs || null;
      item.manifesto = {
        anexosDisponiveis: execucao?.manifesto?.anexosDisponiveis,
        anexosSelecionados: execucao?.manifesto?.anexosSelecionados,
        imagensSelecionadas: execucao?.manifesto?.imagensSelecionadas,
      };
      log(`  CONCLUIDO em ${Date.now() - inicioCaso}ms. status final: ${item.execucaoStatus}. QG aprovado: ${item.qualityGate?.aprovado}. falhas: ${(item.qualityGate?.falhas || []).map(f => f.codigo).join(', ') || 'nenhuma'}`);
    } catch (err) {
      item.erro = err.message;
      log(`  ERRO em ${Date.now() - inicioCaso}ms:`, err.message);
    }
    item.duracaoMs = Date.now() - inicioCaso;
    resultados.push(item);
    fs.writeFileSync(path.join(OUT_DIR, `${caso.numero}.json`), JSON.stringify(item, null, 2));
  }

  fs.writeFileSync(path.join(OUT_DIR, '_resumo.json'), JSON.stringify({ geradoEm: new Date().toISOString(), resultados }, null, 2));
  database.fecharDB();
  log('\nTODOS OS CASOS PROCESSADOS.');
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});

'use strict';

require('dotenv').config({ path: 'c:/Apps/iahub/.env' });

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.AUDITORIA_DB_PATH || 'C:/tmp/ia-service-auditoria-independente-10casos.db';
const OUT_DIR = process.env.AUDITORIA_OUT_DIR || 'C:/tmp/ia-service-auditoria-independente-10casos-resultados';

const CASOS = [
  { numero: '035068', atendimentoId: 'e7d7a4a2-fd29-4f14-9f59-f6265d2849e6', categoria: 'API/integracao + PDF + log' },
  { numero: '036166', atendimentoId: '93efaa19-6b9c-4edf-8d19-01fb58ae1af3', categoria: 'API/integracao + log, sem solucao confirmada' },
  { numero: '036558', atendimentoId: 'b8f1ccda-7d5b-4fb8-9857-29accd1a0620', categoria: 'Customizacao PRW (fonte) + prints' },
  { numero: '034178', atendimentoId: 'bc4357d6-5873-4289-993c-a4d30922456c', categoria: 'Configurador + multiplos prints' },
  { numero: '033521', atendimentoId: '36f8b38c-4ff4-4aa4-a33b-5ed5c48892c5', categoria: 'Estoque + PDFs grandes (relatorios)' },
  { numero: '035635', atendimentoId: '4ef8f670-d6d9-471d-93e2-bd9db0e3ab3a', categoria: 'Financeiro + varios PDFs (extratos)' },
  { numero: '035398', atendimentoId: '7d5f8667-fa5b-4832-ab30-b642689afced', categoria: 'Faturamento + documentacao tecnica PDF (DOC044)' },
  { numero: '033910', atendimentoId: '2222c815-b5cf-4745-8797-8beafb87018f', categoria: 'SoftExpert + fonte PRW + prints' },
  { numero: '034658', atendimentoId: 'a4a75cca-b1d7-4550-ba4d-5129c8880265', categoria: 'SoftExpert + prints WhatsApp (erro critico)' },
  { numero: '036381', atendimentoId: '2b885e86-7b0a-446d-ba33-1c5000551103', categoria: 'SoftExpert + duvida sistemica sem anexo' },
];

function nowIso() { return new Date().toISOString(); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const database = require('c:/Apps/iahub/apps/IA Service/backend/database');
  database.inicializarDB(DB_PATH);

  const aiConfigService = require('c:/Apps/iahub/apps/IA Service/backend/services/ai-config-service');

  const investigacaoService = require('c:/Apps/iahub/apps/IA Service/backend/services/investigacao-service');
  const execucaoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/investigacao-execucao-repository');
  const mensagemRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/anexo-repository');
  const chamadoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/chamado-repository');

  const EMPRESA_ID = 1;
  const TEXTO_AUDITORIA = 'Faca a investigacao tecnica completa deste chamado com base no historico e nos anexos disponiveis. Aponte: problema investigado, fatos comprovados pelas evidencias, hipoteses de causa com nivel de confianca, lacunas que impedem uma conclusao definitiva, e o proximo teste/acao tecnica mais util para o consultor executar agora. Nao afirme ter visto conteudo de anexo que nao foi efetivamente analisado nesta chamada. Nao trate hipotese como causa confirmada sem evidencia direta.';

  const resultados = [];
  try {
    for (const caso of CASOS) {
      console.log(`\n=== Processando ${caso.numero} (${caso.categoria}) ===`);
      const inicio = Date.now();
      let resposta = null;
      let erro = null;
      try {
        console.log(`  [${caso.numero}] listando anexos...`);
        const anexos = anexoRepo.listarAnexos(EMPRESA_ID, caso.atendimentoId).map(a => a.id);
        console.log(`  [${caso.numero}] ${anexos.length} anexos; chamando processarTurno...`);
        const turnoPromise = investigacaoService.processarTurno(EMPRESA_ID, caso.atendimentoId, {
          texto: TEXTO_AUDITORIA,
          usuarioId: null,
          anexoIds: anexos,
          anexosComoContexto: true,
          forcarPesquisa: true,
          analistaAtualNome: 'Auditoria Independente IA (10 casos reais)',
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_CASO_240S')), 240000));
        const msg = await Promise.race([turnoPromise, timeoutPromise]);
        resposta = msg;
        console.log(`  [${caso.numero}] processarTurno concluido.`);
      } catch (err) {
        erro = err && err.stack || String(err);
        console.error('ERRO:', erro);
      }

      const execs = execucaoRepo.listarPorAtendimento(EMPRESA_ID, caso.atendimentoId, { limite: 5 });
      const execucao = execs[0] || null;
      const item = {
        numero: caso.numero,
        categoria: caso.categoria,
        atendimentoId: caso.atendimentoId,
        duracaoRunnerMs: Date.now() - inicio,
        erro,
        respostaTexto: resposta ? resposta.conteudo : null,
        respostaOperacional: resposta ? resposta.respostaOperacional : null,
        diagnostico: resposta ? resposta.diagnostico : null,
        nivelConfianca: resposta ? resposta.nivelConfianca : null,
        provider: resposta ? resposta.provider : null,
        model: resposta ? resposta.model : null,
        execucao,
      };
      resultados.push(item);
      fs.writeFileSync(path.join(OUT_DIR, `${caso.numero}.json`), JSON.stringify(item, null, 2));
      console.log(JSON.stringify({
        numero: caso.numero,
        status: erro ? 'erro' : (execucao?.status || 'desconhecido'),
        provider: execucao?.provider,
        model: execucao?.model,
        qgAprovado: execucao?.qualityGate?.aprovado,
        qgFalhas: (execucao?.qualityGate?.falhas || []).map(f => f.codigo),
        latenciaMs: execucao?.latenciaMs,
      }));
    }
  } finally {
    database.fecharDB();
  }

  fs.writeFileSync(path.join(OUT_DIR, '_resumo.json'), JSON.stringify({ geradoEm: nowIso(), resultados }, null, 2));
  console.log(`\nOK — resultados completos em ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});

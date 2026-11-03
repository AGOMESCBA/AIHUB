'use strict';
// Dossiê em segundo plano (2026-11-02): a atualização do dossiê chama a IA de
// novo (14–24 s em testes reais) e segurava o turno — atendimento travado —
// depois de a resposta já aparecer. Agora o turno termina com a resposta; o
// próximo turno com investigação espera a atualização pendente.
// Sem rede e sem IA: provider, pesquisa e atualizador simulados.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-dossie-segundo-plano-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiProviderClient = require('../backend/services/ai-provider-client');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const dossieContextService = require('../backend/services/dossie-context-service');
const atualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const dossieService = require('../backend/services/investigacao-dossie-service');
const investigacao = require('../backend/services/investigacao-service');

const EMPRESA = 99311;
const originais = {
  chamarIA: aiProviderClient.chamarIA,
  resolver: aiConfigService.resolverKeysEOrdem,
  pesquisar: technicalResearchService.pesquisar,
  memoria: dossieContextService.montarMemoriaOperacional,
  atualizar: atualizador.atualizarAposTurno,
  stale: dossieService.marcarStale,
};
aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'x' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'm' } } });
technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'nao_pesquisado', paginasLidas: [] });
aiProviderClient.chamarIA = async () => ({ texto: 'Análise técnica do caso, com o próximo passo concreto.', provider: 'openai', model: 'm' });

after(() => {
  Object.assign(aiProviderClient, { chamarIA: originais.chamarIA });
  aiConfigService.resolverKeysEOrdem = originais.resolver;
  technicalResearchService.pesquisar = originais.pesquisar;
  dossieContextService.montarMemoriaOperacional = originais.memoria;
  atualizador.atualizarAposTurno = originais.atualizar;
  dossieService.marcarStale = originais.stale;
  try { database.getDB().close(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

const esperar = ms => new Promise(r => setTimeout(r, ms));
function novoAtendimento() {
  const at = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'manual', canalEntrada: 'chat', conteudoBruto: 'Erro no MATA103.' });
  mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'user', conteudo: 'Erro no MATA103.' });
  return at;
}
const turno = (at, texto = 'Pesquise uma solução') =>
  investigacao.processarTurno(EMPRESA, at.id, { texto, usuarioId: null, anexoIds: [], forcarPesquisa: true, origemAcao: 'botao_pesquisar' });

test('o turno termina com a resposta, sem esperar a atualização do dossiê', async () => {
  const at = novoAtendimento();
  let terminou = false;
  atualizador.atualizarAposTurno = async () => { await esperar(300); terminou = true; };
  const inicio = Date.now();
  const msg = await turno(at);
  assert.equal(msg.papel, 'assistant');
  assert.equal(terminou, false, 'resposta devolvida antes do dossiê');
  assert.ok(Date.now() - inicio < 300, 'turno não esperou os 300 ms do dossiê');
  assert.equal(await investigacao.aguardarDossiePendente(EMPRESA, at.id), true);
  assert.equal(terminou, true);
});

test('o turno seguinte espera a atualização pendente antes de ler o dossiê', async () => {
  const at = novoAtendimento();
  const ordem = [];
  atualizador.atualizarAposTurno = async () => { ordem.push('dossie-inicio'); await esperar(250); ordem.push('dossie-fim'); };
  dossieContextService.montarMemoriaOperacional = (...args) => { ordem.push('leitura-dossie'); return originais.memoria(...args); };
  await turno(at);
  ordem.length = 0; // só interessa a ordem a partir do 2º turno
  ordem.push('segundo-turno');
  await turno(at, 'Pesquise de novo');
  const leitura = ordem.indexOf('leitura-dossie');
  assert.ok(leitura > ordem.indexOf('dossie-fim'), `leitura depois da atualização anterior: ${ordem.join(' > ')}`);
  await investigacao.aguardarDossiePendente(EMPRESA, at.id);
  dossieContextService.montarMemoriaOperacional = originais.memoria;
});

test('falha na atualização em segundo plano marca o dossiê como desatualizado, sem derrubar nada', async () => {
  const at = novoAtendimento();
  const marcados = [];
  atualizador.atualizarAposTurno = async () => { await esperar(20); throw new Error('provider fora'); };
  dossieService.marcarStale = (empresaId, atendimentoId, stale) => { marcados.push([atendimentoId, stale]); };
  const msg = await turno(at);
  assert.equal(msg.papel, 'assistant');
  assert.equal(await investigacao.aguardarDossiePendente(EMPRESA, at.id), true);
  assert.deepEqual(marcados, [[at.id, true]]);
  dossieService.marcarStale = originais.stale;
});

test('espera pelo dossiê pendente tem tempo máximo', async () => {
  const at = novoAtendimento();
  let liberar;
  atualizador.atualizarAposTurno = () => new Promise(r => { liberar = r; });
  await turno(at);
  assert.equal(await investigacao.aguardarDossiePendente(EMPRESA, at.id, 50), false, 'tempo esgotado devolve false');
  liberar();
  assert.equal(await investigacao.aguardarDossiePendente(EMPRESA, at.id), true);
  assert.equal(await investigacao.aguardarDossiePendente(EMPRESA, 'sem-pendencia'), true, 'sem pendência não espera');
});

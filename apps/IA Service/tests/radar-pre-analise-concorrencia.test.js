// Regressao do bug real de producao (2026-10, chamado #035988/COABRA):
// duas requisicoes POST /iniciar-analise quase simultaneas (ex. duplo-clique
// no item da fila) cada uma lia "ja tem resposta da IA?" do banco ANTES de
// qualquer uma ter disparado a pre-analise -- as duas viam "nao" e as duas
// disparavam, gerando duas investigacoes reais (duas chamadas de IA, duas
// mensagens assistant) para o MESMO atendimento. Confirmado com evidencia
// real: investigacao_execucoes do #035988 tinha 2 linhas com criado_em a
// 6.4s de diferenca (menor que a latencia da propria 1a execucao).
//
// Corrigido movendo a checagem "ja tem resposta?" para DENTRO da secao
// sincrona protegida pelo lock em memoria (radar-service.js:
// _tentarDispararPreAnaliseEmBackground), antes so era marcado DEPOIS da
// leitura.
// Executar: node "apps/IA Service/tests/radar-pre-analise-concorrencia.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-radar-concorrencia-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const investigacaoService = require('../backend/services/investigacao-service');
const anexosSoftExpertService = require('../backend/services/anexos-softexpert-service');
const radarService = require('../backend/services/radar-service');

const EMPRESA_A = 98801;

function criarChamadoReal(numero) {
  const fonte = agenteRepo.criarFonte(EMPRESA_A, {
    connectionKey: `softexpert-concorrencia-${numero}`,
    nome: 'SoftExpert Concorrencia',
    sistemaOrigem: 'softexpert',
    adapter: 'SoftExpertSqlServerAdapter',
  });
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA_A, {
    fonteId: fonte.id,
    sistemaOrigem: 'softexpert',
    oidOrigem: `OID-${numero}`,
    numero,
    titulo: `Chamado de teste ${numero}`,
    statusEncerramento: 'Andamento',
  });
  return chamado;
}

async function main() {
  const originalPreAnalise = investigacaoService.processarPreAnalise;
  const originalSincronizar = anexosSoftExpertService.sincronizarAnexosParaAtendimento;
  let chamadasPreAnalise = 0;

  // Mock com atraso artificial -- simula o tempo real que a IA leva
  // (segundos), para dar espaco a uma segunda chamada "concorrente" tentar
  // disparar antes da primeira terminar (exatamente o cenario do bug real).
  investigacaoService.processarPreAnalise = async () => {
    chamadasPreAnalise += 1;
    await new Promise(r => setTimeout(r, 50));
    return { id: 'msg-fake', conteudo: 'resposta de teste' };
  };
  anexosSoftExpertService.sincronizarAnexosParaAtendimento = async () => [];

  try {
    // 1) Duas chamadas CONCORRENTES de iniciarAnalise para o MESMO chamado
    // (atendimento ainda nao existe -- primeira cria, segunda "reabre")
    // devem resultar em UMA SO pre-analise disparada, nunca duas.
    {
      const chamado = criarChamadoReal('CONC-NOVO-1');
      const [r1, r2] = await Promise.all([
        Promise.resolve(radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true })),
        Promise.resolve(radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true })),
      ]);
      // Mesmo atendimento resolvido pelas duas chamadas concorrentes
      // (buscarOuCriarAtendimentoPorReferencia ja garantia isso antes).
      assert.strictEqual(r1.atendimento.id, r2.atendimento.id, 'as duas chamadas devem resolver para o MESMO atendimento');
      // Exatamente UMA das duas deve ter disparado a pre-analise -- nunca as duas, nunca nenhuma.
      const totalDisparadas = (r1.preAnaliseDisparada ? 1 : 0) + (r2.preAnaliseDisparada ? 1 : 0);
      assert.strictEqual(totalDisparadas, 1, `exatamente 1 das 2 chamadas concorrentes deve disparar a pre-analise, obtido ${totalDisparadas}`);
      await new Promise(r => setTimeout(r, 100)); // aguarda o .then() assincrono do disparo terminar
      assert.strictEqual(chamadasPreAnalise, 1, 'processarPreAnalise deve ter sido chamado exatamente 1 vez, nunca 2 (bug real do #035988)');
    }
    console.log('[1/3] Duas chamadas concorrentes em atendimento NOVO disparam pre-analise so 1 vez: ok');

    // 2) Mesmo cenario, mas em atendimento JA EXISTENTE sem resposta ainda
    // (branch "reaberto" -- era o branch exato do bug real reportado).
    {
      chamadasPreAnalise = 0;
      const chamado = criarChamadoReal('CONC-REABRE-1');
      // Primeira chamada cria o atendimento (sem aguardar a pre-analise terminar).
      await radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true });
      // Enquanto a pre-analise da primeira ainda esta "rodando" (50ms de
      // atraso no mock), duas novas chamadas concorrentes chegam para o
      // MESMO atendimento -- simula exatamente duplo-clique durante o
      // processamento. Nenhuma delas deve disparar nova pre-analise,
      // porque o lock em memoria ainda esta ativo.
      const [r1, r2] = await Promise.all([
        Promise.resolve(radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true })),
        Promise.resolve(radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true })),
      ]);
      assert.strictEqual(r1.preAnaliseDisparada, false, 'reclique durante pre-analise em andamento nao deve disparar nova');
      assert.strictEqual(r2.preAnaliseDisparada, false, 'reclique durante pre-analise em andamento nao deve disparar nova');
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(chamadasPreAnalise, 1, 'processarPreAnalise deve ter sido chamado exatamente 1 vez no total (a da criacao), nunca mais');
    }
    console.log('[2/3] Reclique durante pre-analise em andamento (atendimento ja existente) nunca duplica: ok');

    // 3) Apos a pre-analise de fato terminar e a resposta estar persistida,
    // uma NOVA selecao do mesmo chamado (ex. reabrir depois) NAO deve
    // disparar pre-analise de novo -- comportamento ja existente preservado.
    {
      chamadasPreAnalise = 0;
      const chamado = criarChamadoReal('CONC-JA-TEM-RESPOSTA-1');
      const r1 = await radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true });
      assert.strictEqual(r1.preAnaliseDisparada, true);
      await new Promise(r => setTimeout(r, 100)); // aguarda a pre-analise "terminar" e persistir a mensagem assistant

      const mensagemRepo = require('../backend/repositories/mensagem-repository');
      mensagemRepo.salvarMensagem(EMPRESA_A, r1.atendimento.id, { papel: 'assistant', conteudo: 'resposta ja existente' });

      const r2 = await radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true });
      assert.strictEqual(r2.preAnaliseDisparada, false, 'atendimento que ja tem resposta assistant nao deve disparar nova pre-analise');
    }
    console.log('[3/3] Atendimento que ja tem resposta assistant nunca redispara (comportamento preservado): ok');

    // 4) Bug real de producao (2026-10, chamado #036475): processarPreAnalise
    // rejeita ANTES de conseguir persistir qualquer mensagem/execucao (ex.
    // excecao sincrona bem no inicio do turno, fora de qualquer try interno)
    // -- sem rede de seguranca, o guard "ja tem resposta?" nunca encontra
    // nada e CADA reabertura do chamado dispara uma nova tentativa
    // indefinidamente (reportado pelo usuario: "voltou a disparar a pesquisa
    // novamente sem necessidade", indicador "Aguardando pre-analise..."
    // preso no frontend a cada reabertura). O fallback em
    // _tentarDispararPreAnaliseEmBackground deve gravar uma mensagem de erro
    // minima quando processarPreAnalise falha sem deixar rastro, para que a
    // proxima reabertura pare de tentar.
    {
      chamadasPreAnalise = 0;
      investigacaoService.processarPreAnalise = async () => {
        chamadasPreAnalise += 1;
        throw new Error('falha sintetica antes de qualquer persistencia (simula #036475)');
      };
      const chamado = criarChamadoReal('CONC-FALHA-SEM-RASTRO-1');
      const r1 = await radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true });
      assert.strictEqual(r1.preAnaliseDisparada, true);
      await new Promise(r => setTimeout(r, 100)); // aguarda o .catch() do disparo em background terminar

      const mensagemRepo = require('../backend/repositories/mensagem-repository');
      const mensagens = mensagemRepo.listarMensagens(EMPRESA_A, r1.atendimento.id, { limite: 500 });
      assert.ok(
        mensagens.some(m => m.papel === 'assistant'),
        'falha sem rastro deve gravar uma mensagem assistant de fallback, senao o guard nunca para de redisparar',
      );

      // Reabertura seguinte: o guard deve agora encontrar a mensagem de
      // fallback e NAO disparar de novo -- mesmo a pre-analise continuando a
      // falhar sempre, o ciclo nao deve se repetir a cada reabertura.
      const r2 = await radarService.iniciarAnalise(EMPRESA_A, chamado.id, { usuarioIdIahub: 1, preAnaliseAutomatica: true });
      assert.strictEqual(r2.preAnaliseDisparada, false, 'apos o fallback persistir uma mensagem, reabertura seguinte nao deve redisparar');
      assert.strictEqual(chamadasPreAnalise, 1, 'processarPreAnalise nao deve ser chamado de novo apos o fallback persistir rastro');
    }
    console.log('[4/4] Falha sem rastro grava fallback e impede redisparo infinito a cada reabertura (#036475): ok');

    console.log('radar-pre-analise-concorrencia.test.js: ok (4/4 cenarios validados)');
  } finally {
    investigacaoService.processarPreAnalise = originalPreAnalise;
    anexosSoftExpertService.sincronizarAnexosParaAtendimento = originalSincronizar;
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  });

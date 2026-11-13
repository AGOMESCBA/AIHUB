'use strict';

// Uso (na raiz do repositório):
//   node "apps/IA Service/tests/replay/executar-replay.js" --simulado --execucoes 1
//   node --env-file=<arquivo com REPLAY_OPENAI_API_KEY> "apps/IA Service/tests/replay/executar-replay.js" \
//        --modelo gpt-5.4 --conjunto desenvolvimento --execucoes 3
//
// Opções:
//   --modelo <nome>          modelo OpenAI do replay (obrigatório fora do --simulado)
//   --modelo-avaliador <n>   modelo da IA avaliadora (padrão: o mesmo do replay)
//   --simulado               IA simulada: valida o replay, sem rede e sem custo
//   --conjunto <c>           desenvolvimento | validacao | todos (padrão: desenvolvimento)
//   --casos <id,id>          só estes casos
//   --execucoes <n>          execuções por caso e variante (padrão: 3)
//   --variantes <v,v>        com4B,sem4B (padrão: as duas)
//   --sem-avaliacao          não chama a IA avaliadora
//   --saida <dir>            pasta do relatório (padrão: tests/replay/relatorios/<data>-<modelo>)
//   --chave-platform <id>    usa a chave OpenAI cadastrada na Platform para a
//                            empresa <id> (IAHub Platform > OpenAI / GPT), em vez
//                            do ambiente. A chave só existe em memória: não é
//                            impressa nem gravada no relatório.
//   --retomar                continua a rodada gravada em --saida, pulando as
//                            execuções já concluídas (mesmo modelo e rubrica)
//   --inicio <n>             primeira execução a rodar (ex.: --inicio 2 --execucoes 3
//                            roda só as repetições 2 e 3)

const fs = require('fs');
const path = require('path');

// Os módulos do motor são carregados só depois da leitura da chave: o
// replay-runner substitui platform-store por um stub ao ser carregado.
function _modulos() {
  return {
    runner: require('./replay-runner'),
    aiProviderClient: require('../../backend/services/ai-provider-client'),
    ...require('./avaliador'),
    ...require('./agregador'),
    ...require('./ia-simulada'),
    ...require('./relatorio'),
  };
}

function lerChaveDaPlatform(empresaId) {
  const platformStore = require('../../../IAHUB/backend/platform-store');
  const config = platformStore.getAiConfig(empresaId);
  if (!config) throw new Error(`Platform sem configuração de IA ativa para a empresa ${empresaId} (ou o replay-runner já foi carregado neste processo).`);
  if (!config.openaiApiKey) throw new Error(`Platform sem chave OpenAI para a empresa ${empresaId}.`);
  return config.openaiApiKey;
}

function lerArgs(argv) {
  const a = { conjunto: 'desenvolvimento', execucoes: 3, variantes: ['com4B', 'sem4B'], avaliar: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--modelo': a.modelo = v; i++; break;
      case '--modelo-avaliador': a.modeloAvaliador = v; i++; break;
      case '--simulado': a.simulado = true; break;
      case '--conjunto': a.conjunto = v; i++; break;
      case '--casos': a.casos = v.split(','); i++; break;
      case '--execucoes': a.execucoes = Number(v); i++; break;
      case '--variantes': a.variantes = v.split(','); i++; break;
      case '--sem-avaliacao': a.avaliar = false; break;
      case '--saida': a.saida = v; i++; break;
      case '--chave-platform': a.chavePlatform = Number(v); i++; break;
      case '--retomar': a.retomar = true; break;
      case '--inicio': a.inicio = Number(v); i++; break;
      default: throw new Error(`Opção desconhecida: ${argv[i]}`);
    }
  }
  return a;
}

function carregarCasos({ conjunto, casos }) {
  const dir = path.join(__dirname, 'casos');
  const conjuntos = conjunto === 'todos' ? ['desenvolvimento', 'validacao'] : [conjunto];
  const todos = conjuntos.flatMap(c => JSON.parse(fs.readFileSync(path.join(dir, `${c}.json`), 'utf8')).casos.map(caso => ({ ...caso, conjunto: c })));
  return casos ? todos.filter(c => casos.includes(c.id)) : todos;
}

async function executar(args) {
  let chave = 'simulado';
  if (!args.simulado) {
    if (!args.modelo) throw new Error('Informe --modelo (ex.: --modelo gpt-5.4).');
    chave = args.chavePlatform
      ? lerChaveDaPlatform(args.chavePlatform)
      : (process.env.REPLAY_OPENAI_API_KEY || process.env.SVC_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    if (!chave) throw new Error('Use --chave-platform <empresaId> ou defina REPLAY_OPENAI_API_KEY no ambiente.');
  }
  const { runner, aiProviderClient, avaliarTurno, RUBRICA_VERSAO, agregar, criarIASimulada, gerarResumo } = _modulos();
  const chamarIAReal = aiProviderClient.chamarIA;
  const modelo = args.simulado ? 'simulado' : args.modelo;
  const chamarIA = args.simulado ? criarIASimulada() : chamarIAReal;
  const casos = carregarCasos(args);
  if (!casos.length) throw new Error('Nenhum caso selecionado.');

  const modeloAvaliador = args.modeloAvaliador || modelo;
  const keysAval = { openai: chave };
  const cfgAval = { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: modeloAvaliador } };

  const data = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const saida = args.saida || path.join(__dirname, 'relatorios', `${data}-${modelo}`);
  fs.mkdirSync(saida, { recursive: true });
  const meta = { data: new Date().toISOString(), modelo, modeloAvaliador, rubrica: RUBRICA_VERSAO, simulado: !!args.simulado, execucoesPorCaso: args.execucoes, variantes: args.variantes, casos: casos.map(c => c.id) };
  const arquivoExecucoes = path.join(saida, 'execucoes.json');

  // Cada execução concluída é gravada na hora: uma interrupção (crédito,
  // queda) não perde o que já foi pago, e --retomar continua de onde parou.
  let execucoes = [];
  if (args.retomar && fs.existsSync(arquivoExecucoes)) {
    const anterior = JSON.parse(fs.readFileSync(arquivoExecucoes, 'utf8'));
    if (anterior.meta.modelo !== modelo || anterior.meta.rubrica !== RUBRICA_VERSAO) {
      throw new Error(`--retomar: a rodada em ${saida} usou ${anterior.meta.modelo}/${anterior.meta.rubrica}, diferente de ${modelo}/${RUBRICA_VERSAO}.`);
    }
    execucoes = anterior.execucoes;
    console.log(`Retomando: ${execucoes.length} execuções já gravadas.`);
  }
  const feita = (casoId, disciplina4B, n) => execucoes.some(e => e.casoId === casoId && e.disciplina4B === disciplina4B && e.execucao === n);

  for (const caso of casos) {
    for (const variante of args.variantes) {
      for (let n = args.inicio || 1; n <= args.execucoes; n++) {
        if (feita(caso.id, variante === 'com4B', n)) continue;
        process.stdout.write(`${caso.id} ${variante} #${n}... `);
        const exec = await runner.executarCaso(caso, { modelo, chave, chamarIA, disciplina4B: variante === 'com4B', execucao: n });
        // Crédito/chave/permissão não se resolvem tentando de novo: para tudo,
        // em vez de gravar uma linha de base feita de mensagens de erro. A
        // execução que falhou não é gravada; as anteriores ficam para --retomar.
        const permanente = exec.turnos.find(t => t.falhaProvider && /credit|quota|billing|api key|unauthorized|forbidden|\b40[13]\b/i.test(t.erro));
        if (permanente) throw new Error(`Replay interrompido: o provider recusou a chamada (${permanente.erro}). ${execucoes.length} execuções gravadas em ${arquivoExecucoes}; continue com --retomar --saida "${saida}".`);
        if (args.avaliar) {
          for (let i = 0; i < exec.turnos.length; i++) {
            exec.turnos[i].avaliacao = await avaliarTurno({ caso, indiceTurno: i, turnosExecutados: exec.turnos, chamarIA, keys: keysAval, cfg: cfgAval });
          }
          const avalPermanente = exec.turnos.find(t => !t.avaliacao?.ok && /credit|quota|billing|api key|unauthorized|forbidden|\b40[13]\b/i.test(t.avaliacao?.erro || ''));
          if (avalPermanente) throw new Error(`Replay interrompido na avaliação: o provider recusou a chamada (${avalPermanente.avaliacao.erro}). ${execucoes.length} execuções gravadas em ${arquivoExecucoes}; continue com --retomar --saida "${saida}".`);
        }
        execucoes.push(exec);
        fs.writeFileSync(arquivoExecucoes, JSON.stringify({ meta, execucoes }, null, 2));
        const tokens = exec.turnos.flatMap(t => [...t.chamadasIA, t.avaliacao?.usage || {}]);
        const entrada = tokens.reduce((s, c) => s + (c.tokensEntrada || c.prompt_tokens || 0), 0);
        const saida = tokens.reduce((s, c) => s + (c.tokensSaida || c.completion_tokens || 0), 0);
        console.log(`${Math.round(exec.duracaoMs / 1000)} s · tokens ${entrada}/${saida}${exec.seguranca?.vazou ? ' [VAZAMENTO]' : ''}`);
      }
    }
  }

  // A pasta retomada pode ter casos de outras rodadas: o arquivo guarda
  // todos, o agregado só os desta seleção.
  const agregado = agregar(casos, execucoes.filter(e => casos.some(c => c.id === e.casoId)));
  fs.writeFileSync(path.join(saida, 'agregado.json'), JSON.stringify({ meta, ...agregado }, null, 2));
  fs.writeFileSync(path.join(saida, 'resumo.md'), gerarResumo({ meta, ...agregado }));
  console.log(`Relatório: ${saida}`);
  return { saida, execucoes, agregado };
}

if (require.main === module) {
  executar(lerArgs(process.argv.slice(2))).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { executar, lerArgs, carregarCasos };

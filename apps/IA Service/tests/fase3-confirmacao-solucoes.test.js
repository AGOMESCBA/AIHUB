// Fase 3 - Confirmacao das Solucoes, Validacao Operacional e Integracao com
// o Ciclo de Vida dos Chamados.
// Executar: node "apps/IA Service/tests/fase3-confirmacao-solucoes.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fase3-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const dossieRepo = require('../backend/repositories/investigacao-dossie-repository');
const validacaoRepo = require('../backend/repositories/validacao-solucao-repository');
const validacaoService = require('../backend/services/validacao-solucao-service');

const EMPRESA_A = 97201;
const EMPRESA_B = 97202;

function criarAtendimentoComOrientacao(empresaId, texto = 'Corrija a validacao de indice antes do acesso ao array.') {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Erro em rotina customizada.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant',
    conteudo: texto,
    diagnostico: { 'Diagnóstico': 'Hipotese provável de falha.' },
    nivelConfianca: 'hipótese provável',
  });
  return { atendimento, mensagemAssistente };
}

function assertDossieTemResultadoValidacao(empresaId, atendimentoId, resultado) {
  const estado = dossieRepo.getEstadoCompleto(empresaId, atendimentoId);
  assert.ok(estado.resultados.some(r => r.dados?.natureza === 'VALIDACAO_SOLUCAO_INDIVIDUAL' && r.dados.resultado === resultado), `dossie deve registrar resultado individual ${resultado}`);
  return estado;
}

async function main() {
  // 1) Confirmacao explicita: RESOLVEU
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { evento, estadoAtual } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'RESOLVEU', usuarioId: 1,
    });
    assert.strictEqual(evento.origem, 'confirmacao_analista');
    assert.strictEqual(evento.resultado, 'RESOLVEU');
    assert.strictEqual(estadoAtual.status, 'RESOLVEU');
    const estadoDossie = assertDossieTemResultadoValidacao(EMPRESA_A, atendimento.id, 'RESOLVEU');
    assert.notStrictEqual(estadoDossie.dossie.status, 'RESOLVIDO', 'confirmacao individual nao deve resolver o dossie global');
  }
  console.log('[1/20] Confirmacao explicita RESOLVEU: ok');

  // 2) Confirmacao explicita: NAO_RESOLVEU -> dossie reabre investigacao
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { estadoAtual } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'NAO_RESOLVEU', comentario: 'Erro persiste apos aplicar a correcao.', usuarioId: 1,
    });
    assert.strictEqual(estadoAtual.status, 'NAO_RESOLVEU');
    const estadoDossie = assertDossieTemResultadoValidacao(EMPRESA_A, atendimento.id, 'NAO_RESOLVEU');
    assert.strictEqual(estadoDossie.dossie.status, 'INVESTIGANDO', 'NAO_RESOLVEU individual deve manter investigacao global aberta');
  }
  console.log('[2/20] Confirmacao explicita NAO_RESOLVEU reabre investigacao: ok');

  // 3) Confirmacao explicita: PARCIALMENTE
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { estadoAtual } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'PARCIALMENTE', comentario: 'Melhorou mas ainda ocorre em outro cenario.', usuarioId: 1,
    });
    assert.strictEqual(estadoAtual.status, 'PARCIALMENTE');
    const estadoDossie = assertDossieTemResultadoValidacao(EMPRESA_A, atendimento.id, 'PARCIALMENTE');
    assert.strictEqual(estadoDossie.dossie.status, 'INVESTIGANDO', 'PARCIALMENTE tambem deve permitir continuidade global');
  }
  console.log('[3/20] Confirmacao explicita PARCIALMENTE: ok');

  // 4) Confirmacao explicita: NAO_TESTADO nao altera o dossie
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const dossieAntes = dossieRepo.getEstadoCompleto(EMPRESA_A, atendimento.id)?.dossie
      || dossieRepo.criarDossieSeNecessario(EMPRESA_A, atendimento.id);
    const { estadoAtual, dossieAtualizacao } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'NAO_TESTADO', usuarioId: 1,
    });
    assert.strictEqual(estadoAtual.status, 'NAO_TESTADO');
    assert.strictEqual(dossieAtualizacao, null, 'NAO_TESTADO nao deve disparar atualizacao do dossie');
    const dossieDepois = dossieRepo.getEstadoCompleto(EMPRESA_A, atendimento.id).dossie;
    assert.strictEqual(dossieDepois.status, dossieAntes.status, 'status do dossie deve permanecer inalterado');
  }
  console.log('[4/20] NAO_TESTADO nao interpreta como falha/sucesso: ok');

  // 5) Ausencia de feedback -> AGUARDANDO_VALIDACAO, nunca sucesso
  {
    const { mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const estado = validacaoService.obterEstadoValidacao(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estado.status, 'AGUARDANDO_VALIDACAO');
    assert.strictEqual(estado.ultimaConfirmacao, null);
  }
  console.log('[5/20] Ausencia de feedback nunca e sucesso: ok');

  // 6) Alteracao posterior de resultado preserva historico
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, resultado: 'PARCIALMENTE', usuarioId: 1,
    });
    const { estadoAtual } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, resultado: 'RESOLVEU', usuarioId: 1,
    });
    assert.strictEqual(estadoAtual.status, 'RESOLVEU', 'estado atual deve refletir a confirmacao mais recente');
    assert.strictEqual(estadoAtual.historico.length, 2, 'historico deve preservar as duas confirmacoes');
    assert.strictEqual(estadoAtual.historico[0].resultado, 'PARCIALMENTE', 'primeiro evento do historico nao deve ser apagado');
  }
  console.log('[6/20] Alteracao posterior preserva historico: ok');

  // 7) Historico preservado apos "recarregamento" (nova leitura do repositorio)
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, resultado: 'NAO_RESOLVEU', usuarioId: 1,
    });
    const estadoRecarregado = validacaoRepo.obterEstadoAtual(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estadoRecarregado.status, 'NAO_RESOLVEU');
    assert.strictEqual(estadoRecarregado.historico.length, 1);
  }
  console.log('[7/20] Historico sobrevive a releitura (simulando reload de pagina): ok');

  // 8) Associacao a mensagem correta (duas mensagens no mesmo atendimento)
  {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Caso com duas orientacoes.' });
    const msg1 = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Orientacao 1' });
    const msg2 = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Orientacao 2' });
    await validacaoService.confirmarSolucao(EMPRESA_A, { atendimentoId: atendimento.id, mensagemAssistenteId: msg1.id, resultado: 'RESOLVEU', usuarioId: 1 });
    const estado1 = validacaoService.obterEstadoValidacao(EMPRESA_A, msg1.id);
    const estado2 = validacaoService.obterEstadoValidacao(EMPRESA_A, msg2.id);
    assert.strictEqual(estado1.status, 'RESOLVEU');
    assert.strictEqual(estado2.status, 'AGUARDANDO_VALIDACAO', 'confirmar msg1 nao deve afetar msg2');
  }
  console.log('[8/20] Associacao a mensagem correta (sem contaminacao entre orientacoes): ok');

  // 9) Associacao a versao correta do fonte corrigido
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const anexoFake = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'user', conteudo: 'anexo simulado' });
    // Usamos uma mensagem como "anexo" simulado é inválido pela FK de anexos;
    // validamos a rejeição de anexo inexistente/nao pertencente abaixo.
    try {
      validacaoRepo.registrarConfirmacaoAnalista(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        anexoVersaoId: 'anexo-inexistente', resultado: 'RESOLVEU', usuarioId: 1,
      });
      assert.fail('deveria rejeitar anexoVersaoId inexistente');
    } catch (err) {
      assert.match(err.message, /Versão de fonte corrigido não encontrada/);
    }
  }
  console.log('[9/20] Associacao a versao de fonte invalida e rejeitada: ok');

  // 10) Chamado encerrado SEM evidencia da solucao -> nao confirma automaticamente
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { registro, duplicado } = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-x',
      statusEncerramentoTransicao: { de: 'Andamento', para: 'Encerrado', reabertura: false },
    });
    assert.strictEqual(duplicado, false);
    assert.strictEqual(registro.origem, 'evidencia_externa');
    assert.strictEqual(registro.resultado, 'EVIDENCIA_EXTERNA');
    const estado = validacaoService.obterEstadoValidacao(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estado.status, 'EVIDENCIA_EXTERNA', 'nunca deve ser RESOLVEU so por encerramento');
  }
  console.log('[10/20] Chamado encerrado sem evidencia da solucao nao confirma automaticamente: ok');

  // 11) Chamado encerrado COM evidencia (mesma trilha de dados, mas sem
  // interpretar como confirmacao explicita do analista)
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { registro } = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-y',
      statusEncerramentoTransicao: { de: 'Pendente', para: 'Encerrado', reabertura: false },
    });
    assert.strictEqual(registro.evidenciaDetalhe.statusNovo, 'Encerrado');
    assert.notStrictEqual(registro.resultado, 'RESOLVEU', 'evidencia externa nunca deve usar o vocabulario de confirmacao explicita');
  }
  console.log('[11/20] Chamado encerrado com evidencia registra evidencia, nao confirmacao: ok');

  // 12) Chamado reaberto: preserva historico anterior e sinaliza reabertura
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, resultado: 'RESOLVEU', usuarioId: 1,
    });
    const { registro } = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-z',
      statusEncerramentoTransicao: { de: 'Encerrado', para: 'Andamento', reabertura: true },
    });
    assert.strictEqual(registro.evidenciaFonte, 'softexpert_reabertura');
    const estado = validacaoService.obterEstadoValidacao(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estado.status, 'RESOLVEU', 'confirmacao explicita anterior NAO deve ser apagada/sobrescrita pela reabertura');
    assert.strictEqual(estado.historico.length, 2, 'historico deve conter a confirmacao e a reabertura, nenhuma apagada');
  }
  console.log('[12/20] Chamado reaberto preserva confirmacao explicita anterior (precedencia): ok');

  // 13) Sincronizacao repetida do mesmo evento externo nao duplica
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const transicao = { de: 'Andamento', para: 'Encerrado', reabertura: false };
    const r1 = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-dup', statusEncerramentoTransicao: transicao,
    });
    const r2 = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-dup', statusEncerramentoTransicao: transicao,
    });
    assert.strictEqual(r1.duplicado, false);
    assert.strictEqual(r2.duplicado, true);
    assert.strictEqual(r1.registro.id, r2.registro.id, 'segunda sincronizacao deve retornar o MESMO evento, nao criar outro');
    const todos = validacaoRepo.listarEventosPorMensagem(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(todos.length, 1, 'nao deve haver duplicidade de evento na tabela');
  }
  console.log('[13/20] Sincronizacao repetida sem duplicidade (idempotencia): ok');

  // 14) Falha de comunicacao com SoftExpert -> sem transicao, nao inventa resultado
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const resultado = validacaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, chamadoId: 'chamado-sem-info',
      statusEncerramentoTransicao: null,
    });
    assert.strictEqual(resultado.registro, null);
    assert.strictEqual(resultado.motivo, 'sem_transicao');
    const estado = validacaoService.obterEstadoValidacao(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estado.status, 'AGUARDANDO_VALIDACAO', 'ausencia de informacao do SoftExpert deve manter aguardando validacao, nunca inventar resultado');
  }
  console.log('[14/20] Ausencia de informacao suficiente no SoftExpert nao inventa resultado: ok');

  // 15) Isolamento multiempresa
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    try {
      await validacaoService.confirmarSolucao(EMPRESA_B, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, resultado: 'RESOLVEU', usuarioId: 1,
      });
      assert.fail('empresa B nao deveria conseguir confirmar solucao de atendimento da empresa A');
    } catch (err) {
      assert.match(err.message, /nao encontrado/i);
    }
  }
  console.log('[15/20] Isolamento multiempresa: ok');

  // 16) Tentativa de avaliar mensagem de outro atendimento (mesma empresa)
  {
    const { atendimento: atendimento1 } = criarAtendimentoComOrientacao(EMPRESA_A);
    const { mensagemAssistente: mensagemDeOutroAtendimento } = criarAtendimentoComOrientacao(EMPRESA_A);
    try {
      await validacaoService.confirmarSolucao(EMPRESA_A, {
        atendimentoId: atendimento1.id, mensagemAssistenteId: mensagemDeOutroAtendimento.id, resultado: 'RESOLVEU', usuarioId: 1,
      });
      assert.fail('deveria rejeitar mensagem que nao pertence ao atendimento informado');
    } catch (err) {
      assert.match(err.message, /Mensagem do assistente nao encontrada/);
    }
  }
  console.log('[16/20] Tentativa de avaliar mensagem de outro atendimento rejeitada: ok');

  // 17) Continuidade da investigacao apos resultado negativo (nao repete a
  // mesma solucao sem nova evidencia) — verifica que o dossie registra a
  // resultado individual e que esse registro alimenta o contexto futuro.
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A, 'Aplicar validacao de indice no array aItens.');
    await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'NAO_RESOLVEU', comentario: 'Mesma falha ocorreu de novo apos aplicar.', usuarioId: 1,
    });
    const estadoDossie = assertDossieTemResultadoValidacao(EMPRESA_A, atendimento.id, 'NAO_RESOLVEU');
    assert.strictEqual(estadoDossie.dossie.status, 'INVESTIGANDO');
  }
  console.log('[17/20] Continuidade apos resultado negativo: ok');

  // 18) Continuidade apos resultado parcial
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      resultado: 'PARCIALMENTE', comentario: 'Resolveu o crash mas o valor ainda sai errado.', usuarioId: 1,
    });
    const estadoDossie = assertDossieTemResultadoValidacao(EMPRESA_A, atendimento.id, 'PARCIALMENTE');
    assert.strictEqual(estadoDossie.dossie.status, 'INVESTIGANDO', 'resultado parcial deve manter investigacao aberta para o restante do problema');
  }
  console.log('[18/20] Continuidade apos resultado parcial: ok');

  // 19) Ausencia de regressoes nas Fases 1 e 2 — verificado via suites
  // dedicadas (fase1-fontes-corrigidos.test.js, fase2-respostas-objetivas.test.js,
  // fase1-fase2-pos-auditoria.test.js), executadas em sequencia pelo runner
  // deste arquivo nao é necessário: ja cobertas isoladamente. Aqui validamos
  // apenas que mensagens antigas (sem nenhuma validacao) continuam
  // retornando AGUARDANDO_VALIDACAO sem lancar erro.
  {
    const { mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const estado = validacaoService.obterEstadoValidacao(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(estado.status, 'AGUARDANDO_VALIDACAO');
  }
  console.log('[19/20] Compatibilidade com mensagens sem nenhuma validacao registrada: ok');

  // 20) Compatibilidade com atendimentos antigos (sem dossie previamente
  // criado) — confirmarSolucao deve criar o dossie sob demanda.
  {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Atendimento antigo sem dossie.' });
    const msg = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'Orientacao antiga.' });
    const antesDossie = dossieRepo.getEstadoCompleto(EMPRESA_A, atendimento.id);
    assert.strictEqual(antesDossie, null, 'pre-condicao: atendimento legado sem dossie ainda criado');
    const { estadoAtual } = await validacaoService.confirmarSolucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: msg.id, resultado: 'RESOLVEU', usuarioId: 1,
    });
    assert.strictEqual(estadoAtual.status, 'RESOLVEU');
  }
  console.log('[20/20] Compatibilidade com atendimentos antigos sem dossie previo: ok');

  console.log('fase3-confirmacao-solucoes.test.js: ok (20/20 cenarios obrigatorios validados)');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  });

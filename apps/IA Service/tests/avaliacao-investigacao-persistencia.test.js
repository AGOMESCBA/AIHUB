// Avaliacao humana das investigacoes -- persistencia (append-only).
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-persistencia.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-persist-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const investigacaoExecucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const avaliacaoRepo = require('../backend/repositories/avaliacao-investigacao-repository');

const EMPRESA_A = 98301;
const EMPRESA_B = 98302;

function criarAtendimentoComOrientacao(empresaId, texto = 'Hipotese provavel de falha na rotina customizada.') {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Chamado de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: texto,
  });
  return { atendimento, mensagemAssistente };
}

function notasBase(overrides = {}) {
  return {
    compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4,
    orientacaoPratica: 4, confiabilidadeTecnica: 4, ...overrides,
  };
}

async function main() {
  // 1) Registro basico: INSERT, nota total e faixa corretos
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const evento = avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase(), usuarioId: 1,
    });
    assert.strictEqual(evento.notaTotal, 20);
    assert.strictEqual(evento.faixa, 'BOA');
    assert.strictEqual(evento.usuarioId, 1);
    assert.strictEqual(evento.execucaoId, null, 'sem execucao auditada, execucaoId deve ser null');
  }
  console.log('[1/10] Registro basico com nota total/faixa corretos: ok');

  // 2) "Atualizar" = novo evento -- historico com 2 linhas, estado atual = mais recente
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase({ profundidadeTecnica: 1 }), usuarioId: 1,
    });
    const segundo = avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase({ profundidadeTecnica: 5 }), usuarioId: 1,
    });
    const atual = avaliacaoRepo.obterAvaliacaoAtualDoUsuario(EMPRESA_A, mensagemAssistente.id, 1);
    assert.strictEqual(atual.id, segundo.id, 'estado atual deve ser o evento mais recente');
    const historico = avaliacaoRepo.listarHistoricoDoUsuario(EMPRESA_A, mensagemAssistente.id, 1);
    assert.strictEqual(historico.length, 2, 'historico deve preservar as duas avaliacoes, nunca apagar a anterior');
    assert.strictEqual(historico[0].notas.profundidadeTecnica, 1, 'primeiro evento do historico nao deve ser alterado');
  }
  console.log('[2/10] Reavaliacao cria evento novo, preserva historico: ok');

  // 3) Dois consultores avaliando a mesma mensagem -> 2 avaliacoes atuais distintas
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase({ compreensaoProblema: 5 }), usuarioId: 1,
    });
    avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase({ compreensaoProblema: 0 }), usuarioId: 2,
    });
    const todas = avaliacaoRepo.listarAvaliacoesAtuaisDaMensagem(EMPRESA_A, mensagemAssistente.id);
    assert.strictEqual(todas.length, 2, 'cada consultor deve ter sua propria avaliacao atual');
    const usuarios = todas.map(a => a.usuarioId).sort();
    assert.deepStrictEqual(usuarios, [1, 2]);
  }
  console.log('[3/10] Dois consultores coexistem com avaliacoes atuais distintas: ok');

  // 4) Flag erro tecnico critico persistida corretamente
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const evento = avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase(), erroTecnicoCritico: true, observacoes: 'Citou tabela inexistente.', usuarioId: 1,
    });
    assert.strictEqual(evento.erroTecnicoCritico, true);
    assert.strictEqual(evento.observacoes, 'Citou tabela inexistente.');
  }
  console.log('[4/10] Flag erro_tecnico_critico e observacoes persistidas: ok');

  // 5) Resolucao automatica de execucaoId quando existe investigacao_execucoes
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const execucao = investigacaoExecucaoRepo.salvarExecucao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemId: mensagemAssistente.id,
      provider: 'groq', model: 'llama-x', status: 'concluido',
      qualityGate: { aprovado: true },
    });
    const evento = avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
      atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      notas: notasBase(), usuarioId: 1,
    });
    assert.strictEqual(evento.execucaoId, execucao.id, 'execucaoId deve ser resolvido automaticamente pela mensagem_id');
  }
  console.log('[5/10] Resolucao automatica de execucaoId: ok');

  // 6) Notas fora da faixa 0-5 sao rejeitadas
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    try {
      avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        notas: notasBase({ profundidadeTecnica: 6 }), usuarioId: 1,
      });
      assert.fail('deveria rejeitar nota fora de 0-5');
    } catch (err) {
      assert.match(err.message, /profundidadeTecnica.*inválida/);
    }
  }
  console.log('[6/10] Nota fora de 0-5 rejeitada: ok');

  // 7) usuarioId ausente e sempre rejeitado
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    try {
      avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        notas: notasBase(), usuarioId: null,
      });
      assert.fail('deveria rejeitar usuarioId ausente');
    } catch (err) {
      assert.match(err.message, /usuarioId é obrigatório/);
    }
  }
  console.log('[7/10] usuarioId ausente rejeitado (avaliacao e sempre evento humano explicito): ok');

  // 8) Mensagem que nao e do assistente e rejeitada
  {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Caso.' });
    const msgUsuario = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'user', conteudo: 'Pergunta do cliente.' });
    try {
      avaliacaoRepo.registrarAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: msgUsuario.id, notas: notasBase(), usuarioId: 1,
      });
      assert.fail('deveria rejeitar avaliacao de mensagem que nao e do assistente');
    } catch (err) {
      assert.match(err.message, /Mensagem do assistente não encontrada/);
    }
  }
  console.log('[8/10] Avaliacao de mensagem nao-assistente rejeitada: ok');

  // 9) Isolamento multiempresa
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    try {
      avaliacaoRepo.registrarAvaliacao(EMPRESA_B, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id, notas: notasBase(), usuarioId: 1,
      });
      assert.fail('empresa B nao deveria conseguir avaliar atendimento da empresa A');
    } catch (err) {
      assert.match(err.message, /não encontrado/i);
    }
  }
  console.log('[9/10] Isolamento multiempresa: ok');

  // 10) Ausencia de avaliacao retorna null, nunca inventa estado
  {
    const { mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const atual = avaliacaoRepo.obterAvaliacaoAtualDoUsuario(EMPRESA_A, mensagemAssistente.id, 999);
    assert.strictEqual(atual, null);
  }
  console.log('[10/10] Ausencia de avaliacao retorna null: ok');

  console.log('avaliacao-investigacao-persistencia.test.js: ok (10/10 cenarios validados)');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  });

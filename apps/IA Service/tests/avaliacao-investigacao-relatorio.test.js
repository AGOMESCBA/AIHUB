// Avaliacao humana das investigacoes -- relatorio agregado de homologacao
// (total, media, distribuicao por faixa, agrupamento por provider/model,
// cruzamento com Quality Gate aprovado).
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-relatorio.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-relatorio-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const investigacaoExecucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const avaliacaoRepo = require('../backend/repositories/avaliacao-investigacao-repository');
const homologacaoService = require('../backend/services/homologacao-service');

const EMPRESA_A = 98501;

function criarCasoAvaliado(empresaId, { notas, provider = null, model = null, qgAprovado = null, erroTecnicoCritico = false, usuarioId = 1 }) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Caso de teste.' });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, { papel: 'assistant', conteudo: 'Resposta de teste.' });
  if (provider || model || qgAprovado !== null) {
    investigacaoExecucaoRepo.salvarExecucao(empresaId, {
      atendimentoId: atendimento.id, mensagemId: mensagemAssistente.id,
      provider, model, status: 'concluido',
      qualityGate: qgAprovado !== null ? { aprovado: qgAprovado } : null,
    });
  }
  return avaliacaoRepo.registrarAvaliacao(empresaId, {
    atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
    notas, erroTecnicoCritico, usuarioId,
  });
}

async function main() {
  // 1) Faixas de borda exatas: 22=Excelente, 21=Boa, 18=Boa, 17=Parcial, 13=Parcial, 12=Insatisfatoria
  {
    assert.strictEqual(avaliacaoRepo.faixaDeNota(25), 'EXCELENTE');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(22), 'EXCELENTE');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(21), 'BOA');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(18), 'BOA');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(17), 'PARCIAL');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(13), 'PARCIAL');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(12), 'INSATISFATORIA');
    assert.strictEqual(avaliacaoRepo.faixaDeNota(0), 'INSATISFATORIA');
  }
  console.log('[1/6] Limites exatos das faixas (22/21/18/17/13/12): ok');

  // 2) Total, media geral e distribuicao por faixa
  {
    criarCasoAvaliado(EMPRESA_A, { notas: { compreensaoProblema: 5, aproveitamentoEvidencias: 5, profundidadeTecnica: 5, orientacaoPratica: 5, confiabilidadeTecnica: 5 } }); // 25 EXCELENTE
    criarCasoAvaliado(EMPRESA_A, { notas: { compreensaoProblema: 1, aproveitamentoEvidencias: 1, profundidadeTecnica: 1, orientacaoPratica: 1, confiabilidadeTecnica: 1 } }); // 5 INSATISFATORIA

    const relatorio = await homologacaoService.obterRelatorioAgregado(EMPRESA_A);
    assert.strictEqual(relatorio.total, 2);
    assert.strictEqual(relatorio.mediaGeral, 15, 'media de 25 e 5 deve ser 15');
    assert.strictEqual(relatorio.distribuicaoFaixas.EXCELENTE, 1);
    assert.strictEqual(relatorio.distribuicaoFaixas.INSATISFATORIA, 1);
    assert.strictEqual(relatorio.distribuicaoFaixas.BOA, 0);
  }
  console.log('[2/6] Total, media geral e distribuicao por faixa: ok');

  // 3) Agrupamento por provider e model
  {
    const empresa = 98502;
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4, orientacaoPratica: 4, confiabilidadeTecnica: 4 },
      provider: 'groq', model: 'llama-x',
    });
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 2, aproveitamentoEvidencias: 2, profundidadeTecnica: 2, orientacaoPratica: 2, confiabilidadeTecnica: 2 },
      provider: 'openai', model: 'gpt-y',
    });
    const relatorio = await homologacaoService.obterRelatorioAgregado(empresa);
    const grupoGroq = relatorio.porProvider.find(g => g.valor === 'groq');
    const grupoOpenai = relatorio.porProvider.find(g => g.valor === 'openai');
    assert.strictEqual(grupoGroq.total, 1);
    assert.strictEqual(grupoGroq.media, 20);
    assert.strictEqual(grupoOpenai.media, 10);
  }
  console.log('[3/6] Agrupamento por provider/model: ok');

  // 4) Cruzamento "aprovado pelo Quality Gate mas mal avaliado"
  {
    const empresa = 98503;
    // Aprovado no QG, nota baixa (Parcial) -> deve aparecer no alerta
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 3, aproveitamentoEvidencias: 3, profundidadeTecnica: 3, orientacaoPratica: 3, confiabilidadeTecnica: 3 },
      provider: 'groq', qgAprovado: true,
    });
    // Aprovado no QG, nota alta -> nao deve aparecer
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 5, aproveitamentoEvidencias: 5, profundidadeTecnica: 5, orientacaoPratica: 5, confiabilidadeTecnica: 5 },
      provider: 'groq', qgAprovado: true,
    });
    // Reprovado no QG, nota baixa -> nao deve aparecer (nao foi aprovado)
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 2, aproveitamentoEvidencias: 2, profundidadeTecnica: 2, orientacaoPratica: 2, confiabilidadeTecnica: 2 },
      provider: 'groq', qgAprovado: false,
    });
    const relatorio = await homologacaoService.obterRelatorioAgregado(empresa);
    assert.strictEqual(relatorio.qgAprovadoMasMalAvaliadas.length, 1, 'so o caso aprovado+nota baixa (15=PARCIAL) deve aparecer');
    assert.strictEqual(relatorio.qgAprovadoMasMalAvaliadas[0].notaTotal, 15);
  }
  console.log('[4/6] Cruzamento aprovado-no-QG-mas-mal-avaliado: ok');

  // 5) Erro tecnico critico sinalizado aparece na lista
  {
    const empresa = 98504;
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4, orientacaoPratica: 4, confiabilidadeTecnica: 4 },
      erroTecnicoCritico: true,
    });
    criarCasoAvaliado(empresa, {
      notas: { compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4, orientacaoPratica: 4, confiabilidadeTecnica: 4 },
      erroTecnicoCritico: false,
    });
    const relatorio = await homologacaoService.obterRelatorioAgregado(empresa);
    assert.strictEqual(relatorio.erroTecnicoCriticoSinalizado.length, 1);
  }
  console.log('[5/6] Erro tecnico critico sinalizado aparece isoladamente: ok');

  // 6) Reavaliacao do mesmo usuario nao duplica no relatorio
  {
    const empresa = 98505;
    const atendimento = atendimentoRepo.criarAtendimento(empresa, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Caso.' });
    const msg = mensagemRepo.salvarMensagem(empresa, atendimento.id, { papel: 'assistant', conteudo: 'Resposta.' });
    avaliacaoRepo.registrarAvaliacao(empresa, {
      atendimentoId: atendimento.id, mensagemAssistenteId: msg.id,
      notas: { compreensaoProblema: 1, aproveitamentoEvidencias: 1, profundidadeTecnica: 1, orientacaoPratica: 1, confiabilidadeTecnica: 1 }, usuarioId: 1,
    });
    avaliacaoRepo.registrarAvaliacao(empresa, {
      atendimentoId: atendimento.id, mensagemAssistenteId: msg.id,
      notas: { compreensaoProblema: 5, aproveitamentoEvidencias: 5, profundidadeTecnica: 5, orientacaoPratica: 5, confiabilidadeTecnica: 5 }, usuarioId: 1,
    });
    const relatorio = await homologacaoService.obterRelatorioAgregado(empresa);
    assert.strictEqual(relatorio.total, 1, 'reavaliacao do mesmo usuario deve contar 1 vez (a mais recente), nunca duplicar');
    assert.strictEqual(relatorio.mediaGeral, 25);
  }
  console.log('[6/6] Reavaliacao do mesmo usuario nao duplica no relatorio: ok');

  console.log('avaliacao-investigacao-relatorio.test.js: ok (6/6 cenarios validados)');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  });

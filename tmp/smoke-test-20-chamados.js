// Smoke test tecnico do pipeline Avaliacao Humana + Pre-avaliacao por IA
// contra 20 chamados REAIS da base de desenvolvimento (ja importados do
// SoftExpert de producao via Agente Local). Gera investigacao real (motor
// intocado -- mesma funcao usada pela rota HTTP real) + pre-avaliacao real.
// NAO E teste automatizado de regressao (nao faz parte da suite tests/),
// nao e commitado, roda contra o banco de desenvolvimento DIRETO (nao uma
// copia) por pedido explicito do usuario -- cria atendimentos reais, nao
// efemeros.
//
// NOTA HISTORICA (resolvida): numa tentativa anterior, resolverKeysEOrdem
// propagava excecao nao tratada porque a config de IA cifrada no
// platform-store nao decifrava ("Unsupported state or unable to
// authenticate data"). O usuario resalvou a config pela tela real
// (IAHub Platform > OpenAI/GPT), o que re-cifrou os dados corretamente --
// resolverKeysEOrdem(1) agora funciona sem erro, usando o caminho real de
// producao (sem stub/contorno).
//
// Executar: node tmp/smoke-test-20-chamados.js

require('dotenv').config();
const path = require('path');

const database = require(path.join(__dirname, '..', 'apps', 'IA Service', 'backend', 'database'));
database.inicializarDB();

const chamadoRepo = require(path.join(__dirname, '..', 'apps', 'IA Service', 'backend', 'repositories', 'chamado-repository'));
const atendimentoService = require(path.join(__dirname, '..', 'apps', 'IA Service', 'backend', 'services', 'atendimento-service'));
const investigacaoService = require(path.join(__dirname, '..', 'apps', 'IA Service', 'backend', 'services', 'investigacao-service'));
const preAvaliacaoIaService = require(path.join(__dirname, '..', 'apps', 'IA Service', 'backend', 'services', 'pre-avaliacao-ia-service'));

const EMPRESA_ID = 1;
const QTD_CASOS = Number(process.env.SMOKE_QTD || 20);

async function main() {
  const resultados = [];

  const db = database.getDB();
  const candidatos = db.prepare(`
    SELECT c.id, c.numero, c.titulo, c.breve_descricao, c.descricao
      FROM chamados c
     WHERE c.empresa_id = ?
       AND NOT EXISTS (SELECT 1 FROM atendimentos a WHERE a.empresa_id = c.empresa_id AND a.referencia_externa = c.numero)
       AND TRIM(COALESCE(c.descricao, c.breve_descricao, '')) <> ''
     ORDER BY c.criado_em DESC
     LIMIT ?
  `).all(EMPRESA_ID, QTD_CASOS);

  console.log(`[smoke-test] ${candidatos.length} chamados reais selecionados (empresa ${EMPRESA_ID}).`);

  for (const [i, chamado] of candidatos.entries()) {
    const linha = { numero: chamado.numero, investigacaoOk: false, preAvaliacaoOk: false, notaTotal: null, erro: null, latenciaInvestigacaoMs: null, latenciaPreAvaliacaoMs: null };
    const textoProblema = [chamado.titulo, chamado.breve_descricao, chamado.descricao].filter(Boolean).join('\n\n');

    try {
      const t0 = Date.now();
      const atendimento = atendimentoService.criarAtendimentoDeEntradaCanonica({
        origem: 'softexpert', canalEntrada: 'importacao', referenciaExterna: chamado.numero,
        empresaId: EMPRESA_ID, conteudoBruto: textoProblema,
        metadados: { criadoPorIntegracao: 'smoke-test-20-chamados' },
      });

      const mensagemAssistente = await investigacaoService.processarTurno(EMPRESA_ID, atendimento.id, {
        texto: textoProblema, usuarioId: null, automatico: true,
      });
      linha.latenciaInvestigacaoMs = Date.now() - t0;
      linha.investigacaoOk = !!mensagemAssistente?.conteudo;
      linha.atendimentoId = atendimento.id;
      linha.mensagemId = mensagemAssistente?.id;

      if (linha.investigacaoOk) {
        const t1 = Date.now();
        const preAval = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_ID, {
          atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        });
        linha.latenciaPreAvaliacaoMs = Date.now() - t1;
        linha.preAvaliacaoOk = preAval.sucesso;
        if (preAval.sucesso) {
          const n = preAval.sugestao.notas;
          linha.notaTotal = n.compreensaoProblema + n.aproveitamentoEvidencias + n.profundidadeTecnica + n.orientacaoPratica + n.confiabilidadeTecnica;
          linha.observacoesSugestao = preAval.sugestao.observacoes;
        }
      }
    } catch (err) {
      linha.erro = err.message;
    }

    resultados.push(linha);
    console.log(`[${i + 1}/${candidatos.length}] #${chamado.numero} -> investigacao:${linha.investigacaoOk ? 'OK' : 'FALHA'} preAvaliacao:${linha.preAvaliacaoOk ? 'OK nota=' + linha.notaTotal : 'FALHA'}${linha.erro ? ' erro=' + linha.erro : ''}`);
  }

  const investigacoesOk = resultados.filter(r => r.investigacaoOk).length;
  const preAvaliacoesOk = resultados.filter(r => r.preAvaliacaoOk).length;
  const notas = resultados.filter(r => r.notaTotal !== null).map(r => r.notaTotal);
  const mediaNotas = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : 'n/a';

  console.log('\n=== RESUMO DO SMOKE TEST ===');
  console.log(`Total de casos: ${resultados.length}`);
  console.log(`Investigacoes geradas com sucesso: ${investigacoesOk}/${resultados.length}`);
  console.log(`Pre-avaliacoes geradas com sucesso: ${preAvaliacoesOk}/${investigacoesOk || 1}`);
  console.log(`Media das notas totais sugeridas (0-25): ${mediaNotas}`);
  console.log(`Distribuicao: ${JSON.stringify(notas)}`);
  const falhas = resultados.filter(r => r.erro || !r.investigacaoOk || !r.preAvaliacaoOk);
  if (falhas.length) {
    console.log('\nCasos com falha:');
    for (const f of falhas) console.log(`  #${f.numero}: investigacao=${f.investigacaoOk} preAvaliacao=${f.preAvaliacaoOk} erro=${f.erro || '-'}`);
  }

  require('fs').writeFileSync(
    path.join(__dirname, 'smoke-test-20-chamados-resultado.json'),
    JSON.stringify(resultados, null, 2), 'utf-8'
  );
  console.log('\nResultado detalhado salvo em tmp/smoke-test-20-chamados-resultado.json');

  database.fecharDB();
}

main().catch(err => { console.error('[smoke-test] erro fatal:', err); process.exitCode = 1; });

// Anexo do proprio caso no Context Engine (achado real #036974, 2026-11-18): o unico
// anexo do chamado (PDF com os prints do erro) ficava com score 0 e era omitido por
// "baixa relevancia", porque os termos de pontuacao se esgotavam na pergunta e nos
// rotulos do cabecalho. Regra "evidencia primeiro" (decisao do usuario, 2026-11-18):
// todo anexo do chamado vai para a IA (imagens e Word so com prints inclusive); o
// score so ordena e quem corta e o orcamento de tokens.
// Executar: node "apps/IA Service/tests/anexo-do-caso-contexto.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-anexo-caso-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const contextEngine = require('../backend/services/context-engine');
const promptBuilder = require('../backend/services/prompt-builder');

const EMPRESA = 9802;
const OPENAI = { provider: 'openai', model: 'gpt-4o-mini' };
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PERGUNTA_GENERICA = 'Pesquise a causa e a solução deste chamado.';

// Cabecalho real do #036974: rotulos e metadados ocupam os termos de pontuacao.
const CONTEUDO_BRUTO = [
  'Chamado SoftExpert #036974', 'Produto: Protheus', 'Família: Controladoria', 'Módulo: Financeiro',
  'Serviço: Ajuste/Correção de Customização', 'Tipo: Em Análise', 'Natureza: Em Análise', 'Nível: Nível 1',
  'Título: CAIEIRA | Protheus | Erro nas vendas de cartão',
  'Descrição completa: Vendas cartão que estão errados, pois no tipo esta NF e era para esta como CC ou CD com CRT, como no anexo',
].join('\n');
const TEXTO_PDF = '[PDF extraido textualmente]\nPaginas: 1\n\nA venda cartão tem que ser assim, como na imagem abaixo.\nVendas cartão que estão errados, pois no tipo esta NF e era para esta como CC ou CD com CRT, como na imagem acima.';

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

function anexar(atendimento, nome, conteudo, { mimeType = 'application/pdf', linguagem = 'pdf' } = {}) {
  const a = anexoRepo.salvarMetadadosAnexo(EMPRESA, atendimento.id, {
    nomeOriginal: nome,
    nomeInterno: `${nome}-${Math.random().toString(36).slice(2)}`,
    mimeType,
    tamanho: Buffer.byteLength(conteudo || 'x'),
    caminhoRelativo: `${EMPRESA}/${atendimento.id}/${nome}`,
  });
  if (!conteudo) return a;
  return anexoRepo.atualizarExtracao(EMPRESA, a.id, { conteudoExtraido: conteudo, linguagemDetectada: linguagem, encodingDetectado: 'utf-8', eCodigo: false });
}

function criarAtendimento() {
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'manual', canalEntrada: 'web', conteudoBruto: CONTEUDO_BRUTO });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, { papel: 'user', conteudo: 'Abrindo fabrica para tratativa do ocorrido.' });
  return atendimento;
}

function montar(atendimento, mensagemAtual, { permitirImagens } = {}) {
  return contextEngine.montarContextoInvestigacao({
    atendimento,
    mensagens: mensagemRepo.listarMensagens(EMPRESA, atendimento.id, { limite: 100 }),
    mensagemAtual,
    anexosDoTurno: [],
    anexosComoContexto: false,
    pesquisaTecnicaTexto: '',
    systemPrompt: promptBuilder.SYSTEM_PROMPT,
    cfg: { provedorPrimario: OPENAI.provider, modelos: { [OPENAI.provider]: OPENAI.model } },
    candidatoOrcamento: OPENAI,
    ...(permitirImagens === undefined ? {} : { permitirImagens }),
  });
}

const selecionado = (ctx, nome) => ctx.manifesto.selecionados.some(s => s.nome === nome);
const omitido = (ctx, nome) => ctx.manifesto.omitidos.some(o => o.nome === nome);

try {
  {
    const at = criarAtendimento();
    anexar(at, 'Venda cartão.pdf', TEXTO_PDF);
    const ctx = montar(at, PERGUNTA_GENERICA);
    assert.ok(selecionado(ctx, 'Venda cartão.pdf'), 'unico anexo do chamado deve ir para a IA mesmo com pergunta generica');
  }
  {
    const at = criarAtendimento();
    for (let i = 1; i <= 4; i++) anexar(at, `outro-${i}.pdf`, `Relatorio diverso ${i} sem relacao.`);
    const ctx = montar(at, PERGUNTA_GENERICA);
    for (let i = 1; i <= 4; i++) assert.ok(selecionado(ctx, `outro-${i}.pdf`), 'com muitos anexos e pergunta generica, todo anexo do chamado vai para a IA');
  }
  {
    const at = criarAtendimento();
    anexar(at, 'erro transmissão da nf.jpg', '', { mimeType: 'image/jpeg', linguagem: null });
    const ctx = montar(at, PERGUNTA_GENERICA, { permitirImagens: true });
    assert.ok(ctx.imagensSelecionadas.some(i => i.nomeOriginal === 'erro transmissão da nf.jpg'), 'print do chamado deve ir como imagem mesmo sem a pergunta citar imagem');
  }
  {
    const at = criarAtendimento();
    anexar(at, 'Transmissao nf 020104.docx', '', { mimeType: MIME_DOCX, linguagem: null });
    const ctx = montar(at, PERGUNTA_GENERICA, { permitirImagens: true });
    const s = ctx.manifesto.selecionados.find(x => x.nome === 'Transmissao nf 020104.docx');
    assert.ok(s && s.statusEnvio === 'ENVIADA_COMO_IMAGEM', 'Word so com prints deve ir como imagem');
    const semImagens = montar(at, PERGUNTA_GENERICA, { permitirImagens: false });
    assert.ok(omitido(semImagens, 'Transmissao nf 020104.docx'), 'sem permissao de imagem, Word sem texto segue como antes (nao suportado)');
  }
  console.log('anexo-do-caso-contexto.test.js: ok (selecao)');
} catch (err) {
  limparEDesligar();
  throw err;
}

// Evidencia visual que so entrou pela regra nova nao pode derrubar o turno se o arquivo
// nao carregar; a obrigatoria (do turno/citada/forcada) continua interrompendo.
(async () => {
  try {
    const investigacao = require('../backend/services/investigacao-service');
    const contexto = {
      imagensSelecionadas: [
        { id: 'img-antiga', nomeOriginal: 'print-antigo.png', caminhoRelativo: 'nao-existe/print-antigo.png', mimeType: 'image/png' },
        { id: 'img-do-turno', nomeOriginal: 'print-agora.png', caminhoRelativo: 'nao-existe/print-agora.png', mimeType: 'image/png' },
      ],
      pdfsVisuaisSelecionados: [],
      visuaisComplementaresIds: ['img-antiga'],
      manifesto: { omitidos: [] },
    };
    const r = await investigacao._carregarPayloadVisual(contexto);
    assert.deepStrictEqual(r.falhasImagem, ['print-agora.png'], 'so a imagem obrigatoria conta como falha que interrompe');
    assert.deepStrictEqual(contexto.falhasVisuaisComplementares, ['print-antigo.png'], 'imagem complementar com falha fica registrada para aviso');
    assert.ok(contexto.manifesto.omitidos.some(o => o.nome === 'print-antigo.png' && /nao foi possivel carregar/.test(o.motivo) && /após 3 tentativas/.test(o.motivo)), 'falha complementar vai para o manifesto com motivo, depois de 3 tentativas');
    console.log('anexo-do-caso-contexto.test.js: ok (falha visual complementar)');

    // Oscilacao: o arquivo so fica disponivel depois da 1a tentativa e precisa ser lido.
    const armazenamento = require('../backend/services/armazenamento-anexos');
    const pastaTeste = `teste-oscilacao-${Date.now()}`;
    const caminhoRelativo = `${pastaTeste}/print.png`;
    const conteudo = Buffer.from('png-de-teste');
    setTimeout(() => {
      fs.mkdirSync(path.join(armazenamento.ANEXOS_DIR, pastaTeste), { recursive: true });
      fs.writeFileSync(path.join(armazenamento.ANEXOS_DIR, caminhoRelativo), conteudo);
    }, 200);
    try {
      const ctxOscila = { imagensSelecionadas: [{ id: 'img-oscila', nomeOriginal: 'print.png', caminhoRelativo, mimeType: 'image/png', tamanho: conteudo.length }], pdfsVisuaisSelecionados: [], visuaisComplementaresIds: [], manifesto: { omitidos: [] } };
      const lido = await investigacao._carregarPayloadVisual(ctxOscila);
      assert.deepStrictEqual(lido.falhasImagem, [], 'arquivo que aparece na 2a tentativa nao pode ser dado como falha');
      assert.strictEqual(lido.imagens.length, 1, 'imagem lida na nova tentativa deve ir para a IA');
      console.log('anexo-do-caso-contexto.test.js: ok (nova tentativa apos oscilacao)');
    } finally {
      fs.rmSync(path.join(armazenamento.ANEXOS_DIR, pastaTeste), { recursive: true, force: true });
    }
  } finally {
    limparEDesligar();
  }
})().catch((err) => { console.error(err); process.exit(1); });

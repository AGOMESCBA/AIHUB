'use strict';
// Objetiva: síntese controlada, perda de estrutura e botão Copiar. Sem rede.
// A Técnica abaixo é uma RECONSTRUÇÃO do cenário caso sintético a partir do relatório
// de 18/10/2026 (o texto real só existe na produção).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiProvider = require('../backend/services/ai-provider-client');
const aiConfig = require('../backend/services/ai-config-service');
const { analisarPreservacao } = require('../backend/services/validacao-preservacao-service');
const { humanizar } = require('../backend/services/resposta-humanizada-service');

const OPC = { permitirSintese: true, exigirEstrutura: true };
const tecnica = [
  'Vou ser direto: o documento de entrada não fecha com os itens D1_TOTAL e D1_VALICM.',
  '',
  'O procedimento oficial do fabricante (tipo da nota "Devolução") já foi seguido e o problema persiste.',
  '',
  'Passos:',
  '1. Revise os pontos de entrada MT103FIM e MT103OK.',
  '2. Confira se MATA103 grava o campo D1_TOTAL antes da validação.',
  '3. Se MT103ANT alterar D1_VALICM, desative-o em homologação e refaça o teste.',
  '',
  'A pesquisa na documentação oficial não retornou resultado sobre esse comportamento.',
  '',
  'A hipótese principal é que o ponto de entrada MT103OK possa estar alterando o total.',
].join('\n');
const objetiva = [
  'O documento de entrada não fecha com os itens D1_TOTAL e D1_VALICM. O procedimento oficial do fabricante (tipo da nota "Devolução") já foi seguido e o problema persiste.',
  '',
  'O que fazer agora:',
  '1. Revise os pontos de entrada MT103FIM e MT103OK.',
  '2. Confira se MATA103 grava o campo D1_TOTAL antes da validação.',
  '3. Se MT103ANT alterar D1_VALICM, desative-o em homologação e refaça o teste.',
  '',
  'A pesquisa na documentação oficial não retornou resultado sobre esse comportamento.',
  '',
  'A hipótese principal é que o ponto de entrada MT103OK possa estar alterando o total.',
].join('\n');

test('síntese autorizada: omite só o meta-comentário inicial, mantendo a estrutura', () => {
  assert.equal(analisarPreservacao(tecnica, objetiva, OPC).aprovado, true, JSON.stringify(analisarPreservacao(tecnica, objetiva, OPC).falhas));
});

test('gate mínimo: omitir uma frase isolada sem referência técnica é aviso, não bloqueio', () => {
  const r = analisarPreservacao(tecnica, objetiva.replace(/A pesquisa na documentação[^\n]*\n\n/, ''), OPC);
  assert.equal(r.aprovado, true);
  assert.ok(codigosDe(r).includes('CONTEUDO_ESSENCIAL_OMITIDO'), 'a omissão fica registrada na auditoria');
});

test('ação, ponto de entrada e pendência continuam obrigatórios', () => {
  const semPasso = objetiva.replace('1. Revise os pontos de entrada MT103FIM e MT103OK.\n', '');
  assert.equal(analisarPreservacao(tecnica, semPasso, OPC).aprovado, false);
});

test('gate mínimo: passos emendados são aviso (o conteúdo técnico foi mantido)', () => {
  const emendada = 'O documento de entrada não fecha com os itens D1_TOTAL e D1_VALICM. O procedimento oficial do fabricante (tipo da nota "Devolução") já foi seguido e o problema persiste. Revise os pontos de entrada MT103FIM e MT103OK. Confira se MATA103 grava o campo D1_TOTAL antes da validação. Se MT103ANT alterar D1_VALICM, desative-o em homologação e refaça o teste. A pesquisa na documentação oficial não retornou resultado sobre esse comportamento. A hipótese principal é que o ponto de entrada MT103OK possa estar alterando o total.';
  const r = analisarPreservacao(tecnica, emendada, OPC);
  assert.equal(r.aprovado, true);
  assert.ok(codigosDe(r).includes('ESTRUTURA_PERDIDA'));
});

test('opção A: hipótese de causa virando certeza confirmada bloqueia', () => {
  const forte = analisarPreservacao(tecnica, objetiva.replace('possa estar alterando o total', 'está alterando o total, confirmado'), OPC);
  assert.equal(forte.aprovado, false);
});

test('gate mínimo: frase nova sem dado técnico é aviso; dado técnico novo bloqueia', () => {
  const nova = analisarPreservacao(tecnica, objetiva + '\n\nIsso resolve em minutos e pode piorar o cenário se ignorado.', OPC);
  assert.equal(nova.aprovado, true);
  assert.ok(codigosDe(nova).includes('AFIRMACAO_SEM_LASTRO'));
  const comDado = analisarPreservacao(tecnica, objetiva + '\n\nAjuste também o parâmetro MV_INVENTADO.', OPC);
  assert.ok(bloqueiosDe(comDado).includes('REFERENCIA_TECNICA_NOVA'));
});

test('humanizar: emendada vai para fallback; estruturada é aplicada', async () => {
  const orig = { resolverKeysEOrdem: aiConfig.resolverKeysEOrdem, chamarIA: aiProvider.chamarIA };
  aiConfig.resolverKeysEOrdem = () => ({ keys: {}, cfg: {} });
  try {
    aiProvider.chamarIA = async () => ({ texto: objetiva.replace(/\n/g, ' '), provider: 'x', model: 'y' });
    const ruim = await humanizar({ empresaId: 1, respostaOriginal: tecnica, estilo: 'NATURAL' });
    assert.equal(ruim.status, 'fallback');
    assert.equal(ruim.respostaFinal, tecnica);
    aiProvider.chamarIA = async () => ({ texto: objetiva, provider: 'x', model: 'y' });
    const boa = await humanizar({ empresaId: 1, respostaOriginal: tecnica, estilo: 'NATURAL' });
    assert.equal(boa.status, 'aplicada');
    assert.equal(boa.respostaFinal, objetiva);
  } finally { Object.assign(aiConfig, { resolverKeysEOrdem: orig.resolverKeysEOrdem }); aiProvider.chamarIA = orig.chamarIA; }
});

test('prompt base não induz conversa de WhatsApp e exige manter quebras', () => {
  const src = fs.readFileSync(path.join(__dirname, '../backend/services/resposta-humanizada-service.js'), 'utf8');
  assert.ok(!/WhatsApp/i.test(src));
  assert.match(src, /quebras de linha/);
});

test('botão Copiar: usa alternativa sem contexto seguro (HTTP)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../frontend/j2a/assets/detalhes-tecnicos.js'), 'utf8');
  assert.match(src, /data-technical-copy/);
  assert.match(src, /isSecureContext/);
  assert.match(src, /execCommand\('copy'\)/);
});

// ── Frase introdutória sem conteúdo próprio ────────────────────────────────
const ITENS = '1. O usuário tentou devolver a nota pela rotina Retornar e também manualmente.\n2. O analista Alfa confirmou que o sistema não gera o documento.';
const semIntro = ITENS;
// Detectado = bloqueio ou aviso (gate mínimo: só o erro técnico objetivo bloqueia).
const codigosDe = r => [...r.falhas, ...(r.avisos || [])].map(f => f.codigo);
const bloqueiosDe = r => r.falhas.map(f => f.codigo);

test('introdução genérica de lista é omissível quando todo o conteúdo anunciado é mantido', () => {
  for (const intro of ['A partir do histórico, algumas evidências e ações já foram tentadas:', 'Segue o resumo das principais ações já realizadas até agora no histórico:']) {
    const r = analisarPreservacao(`${intro}\n\n${ITENS}`, semIntro, OPC);
    assert.equal(r.aprovado, true, intro + JSON.stringify(r.falhas));
  }
});

test('introdução neutra é isenta nos dois modos (regra única, sem exceção paralela por tamanho)', () => {
  const orig = `A partir do histórico, algumas evidências e ações já foram tentadas:\n\n${ITENS}`;
  assert.equal(analisarPreservacao(orig, semIntro).aprovado, true);
  assert.equal(analisarPreservacao(orig, semIntro, OPC).aprovado, true);
  const fonte = fs.readFileSync(path.join(__dirname, '../backend/services/validacao-preservacao-service.js'), 'utf8');
  assert.ok(!fonte.includes('{1,55}'), 'a exceção antiga de 55 caracteres não pode existir');
});

test('introdução NÃO é omissível com data, referência, hipótese, pendência, ressalva ou termo fora do vocabulário', () => {
  const casos = {
    data: 'A partir do histórico, em 26/02 algumas ações já foram tentadas:',
    referencia: 'A partir do histórico, as ações no MATA103 já foram tentadas:',
    hipotese: 'A partir do histórico, possivelmente algumas ações já foram tentadas:',
    pendencia: 'A partir do histórico, ainda falta anexar o log e algumas ações já foram tentadas:',
    ressalva: 'A partir do histórico, sem sucesso, algumas ações já foram tentadas:',
    pedido: 'A partir do histórico, verifique os itens abaixo para continuar a análise:',
    foraDoVocabulario: 'A partir do histórico, a migração do ambiente foi concluída por completo:',
    pesquisa: 'A partir do histórico, a pesquisa externa não retornou resultado, segue o que foi feito:',
  };
  for (const [nome, intro] of Object.entries(casos)) {
    const r = analisarPreservacao(`${intro}\n\n${ITENS}`, semIntro, OPC);
    // Data e referência são conteúdo técnico verificável: bloqueiam. O resto é aviso registrado.
    if (['data', 'referencia'].includes(nome)) assert.ok(bloqueiosDe(r).includes('REFERENCIA_TECNICA_REMOVIDA'), nome);
    else assert.ok(r.aprovado && codigosDe(r).length > 0, nome);
  }
});

test('introdução NÃO é omissível sem os dois-pontos, ou sem conteúdo posterior', () => {
  // Gate mínimo: não são isentas, mas omiti-las é aviso registrado, não bloqueio.
  assert.ok(codigosDe(analisarPreservacao(`A partir do histórico, algumas evidências e ações já foram tentadas.\n\n${ITENS}`, semIntro, OPC)).length > 0);
  const final = 'O usuário tentou devolver a nota pela rotina Retornar.\n\nA partir do histórico, algumas evidências e ações já foram tentadas:';
  assert.ok(codigosDe(analisarPreservacao(final, 'O usuário tentou devolver a nota pela rotina Retornar.', OPC)).length > 0);
});

test('omitir a introdução não autoriza omitir itens que ela anuncia', () => {
  const r = analisarPreservacao(`A partir do histórico, algumas ações já foram tentadas:\n\n${ITENS}`, '1. O usuário tentou devolver a nota pela rotina Retornar e também manualmente.', OPC);
  assert.ok(codigosDe(r).includes('CONTEUDO_ESSENCIAL_OMITIDO'), 'o item omitido fica registrado');
});

test('data associada a evidência continua bloqueada', () => {
  const orig = 'O analista Alfa confirmou em 26/02 que o sistema não gera o documento de entrada.\n\n1. Consulte o SD1.\n2. Anexe o log.';
  const cand = 'O analista Alfa confirmou que o sistema não gera o documento de entrada.\n\n1. Consulte o SD1.\n2. Anexe o log.';
  const r = analisarPreservacao(orig, cand, OPC);
  assert.equal(r.aprovado, false);
  assert.ok(codigosDe(r).includes('REFERENCIA_TECNICA_REMOVIDA'));
});

test('"tente seguir" -> "siga" com rótulo removido deixa de cair em certeza', () => {
  const mk = (verbo, rotulo) => `Próximos passos:\n\n- ${rotulo}Se as atualizações estiverem em dia, sugerir que o usuário Beta ${verbo} o procedimento alternativo mencionado, garantindo que todos os campos estejam preenchidos, especialmente os relacionados à nota fiscal de saída.`;
  for (const [verbo] of [['siga'], ['tente seguir']]) {
    const r = analisarPreservacao(mk('tente seguir', '**Testar**: '), mk(verbo, ''), OPC);
    assert.ok(!codigosDe(r).includes('ESTADO_OU_CERTEZA_ALTERADO'), JSON.stringify(r.falhas));
  }
});

// ── Força da orientação ────────────────────────────────────────────────────
const { forcaOrientacao } = require('../backend/services/validacao-preservacao-service');

test('forcaOrientacao: níveis por construção da frase', () => {
  const casos = [
    ['Tente verificar o log.', 1], ['Considere consultar a tabela SD1.', 1], ['Pode validar o parâmetro.', 1],
    ['Recomendo validar o parâmetro.', 2], ['Recomenda-se validar o parâmetro.', 2],
    ['Verifique o log.', 3], ['Consulte a tabela SD1.', 3], ['Verificar as atualizações.', 3], ['- Confirmar se as atualizações foram feitas.', 3],
    ['Deve validar o parâmetro.', 4], ['É necessário validar o parâmetro.', 4], ['Não deve executar em produção.', 4], ['Não executar em produção.', 4],
    ['O sistema não gera o documento.', 0], ['A rotina pode estar abortando antes de gravar.', 0], ['Falta o log de 07/03.', 0], ['O analista confirmou o teste.', 0],
  ];
  for (const [frase, nivel] of casos) assert.equal(forcaOrientacao(frase), nivel, frase);
});

test('mudança de força da orientação é detectada, para cima e para baixo', () => {
  const pares = [
    ['Tente verificar o parâmetro MV_ESTADO.', 'Verifique o parâmetro MV_ESTADO.'],
    ['Considere consultar a tabela SD1.', 'Consulte a tabela SD1.'],
    ['Recomendo validar o parâmetro MV_ESTADO.', 'Deve validar o parâmetro MV_ESTADO.'],
    ['Deve validar o parâmetro MV_ESTADO.', 'Pode validar o parâmetro MV_ESTADO.'],
    ['Não deve executar o reprocessamento.', 'Pode executar o reprocessamento.'],
  ];
  for (const [o, c] of pares) assert.ok(codigosDe(analisarPreservacao(o, c, OPC)).includes('FORCA_ORIENTACAO_ALTERADA'), o + ' -> ' + c);
});

test('paráfrases dentro do mesmo nível de orientação continuam permitidas', () => {
  const pares = [
    ['Verifique o parâmetro MV_ESTADO.', 'Confira o parâmetro MV_ESTADO.'],
    ['É necessário validar o parâmetro MV_ESTADO.', 'Deve validar o parâmetro MV_ESTADO.'],
    ['Tente verificar o parâmetro MV_ESTADO.', 'Considere verificar o parâmetro MV_ESTADO.'],
    ['Verificar o parâmetro MV_ESTADO.', 'Verifique o parâmetro MV_ESTADO.'],
  ];
  for (const [o, c] of pares) assert.equal(analisarPreservacao(o, c, OPC).aprovado, true, o + ' -> ' + c + JSON.stringify(analisarPreservacao(o, c, OPC).falhas));
});

test('classificar orientação não esconde certeza: causa confirmada é detectada (aviso no gate mínimo)', () => {
  const r = analisarPreservacao('A causa provável é o parâmetro MV_ESTADO, a confirmar. Verifique o parâmetro.', 'O parâmetro MV_ESTADO é a causa confirmada. Verifique o parâmetro.', OPC);
  assert.ok(codigosDe(r).some(c => ['FORCA_AFIRMACAO_ALTERADA', 'ESTADO_OU_CERTEZA_ALTERADO', 'INCERTEZA_REMOVIDA'].includes(c)));
});

// ── Títulos terminados em ":" (sem exceção por tamanho) ────────────────────
const ITENS_T = '1. O log do servidor foi coletado ontem.\n2. A tabela de parâmetros foi revisada pelo analista.';
test('títulos neutros podem ser omitidos, qualquer que seja o tamanho', () => {
  for (const t of ['Próximos passos:', 'Passos:', 'Evidências:', 'O que fazer agora:']) {
    assert.equal(analisarPreservacao(`${t}\n\n${ITENS_T}`, ITENS_T, OPC).aprovado, true, t);
  }
});

test('títulos com hipótese, risco, negação, pendência, referência, data, estado ou orientação não somem', () => {
  const titulos = ['Possivelmente há pendência:', 'Risco identificado:', 'Não executar em produção:', 'Hipótese principal:', 'Pendências:',
    'Rotina MATA103:', 'Testes de 07/03:', 'Problema resolvido:', 'Verifique antes de aplicar:'];
  for (const t of titulos) {
    const r = analisarPreservacao(`${t}\n\n${ITENS_T}`, ITENS_T, OPC);
    // Título com referência ou data bloqueia; os demais ficam registrados como aviso.
    if (/MATA103|07\/03/.test(t)) assert.ok(bloqueiosDe(r).includes('REFERENCIA_TECNICA_REMOVIDA'), t);
    else assert.ok(codigosDe(r).length > 0, t);
  }
});

test('título com conteúdo mantido ou parafraseado é aceito', () => {
  assert.equal(analisarPreservacao(`Risco identificado:\n\n${ITENS_T}`, `Risco identificado:\n\n${ITENS_T}`, OPC).aprovado, true);
  assert.equal(analisarPreservacao(`Verifique antes de aplicar:\n\n${ITENS_T}`, `Confira antes de aplicar:\n\n${ITENS_T}`, OPC).aprovado, true);
});

// ── Marcadores rígidos × identificadores simples ───────────────────────────
const { proteger } = require('../backend/services/resposta-humanizada-service');
// Normaliza o fim de linha: no Windows o checkout pode converter os fixtures
// para CRLF, e os cortes do teste trabalham com \n.
const lerFixture = nome => fs.readFileSync(path.join(__dirname, 'fixtures', nome), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
const TECNICA_REAL = lerFixture('tecnica-sintetica.md');
const OBJETIVA_REF = lerFixture('objetiva-sintetica-referencia.md');

test('proteger: identificadores simples não viram marcador; código, comandos e dado sensível continuam rígidos', () => {
  assert.equal(proteger(TECNICA_REAL).trechos.length, 0, 'Return, MsgStop, MT103FIM, MT103OK, MT103ANT e MATA103 não são marcadores');
  const r = proteger('Rode `SELECT * FROM SD1 WHERE D1_DOC = 1` e depois\n```advpl\nReturn .T.\n```\nSELECT D1_DOC FROM SD1\nUse `MATA103` e `a = b + 1`.');
  const rigidos = r.trechos.map(t => t.replace(/\s+/g, ' '));
  assert.ok(rigidos.some(t => t.includes('SELECT * FROM SD1')), 'expressão com espaço');
  assert.ok(rigidos.some(t => t.includes('```advpl')), 'bloco de código');
  assert.ok(rigidos.some(t => t.startsWith('SELECT D1_DOC')), 'comando em linha própria');
  assert.ok(rigidos.some(t => t === '`a = b + 1`'), 'expressão de código');
  assert.ok(r.protegido.includes('`MATA103`'), 'identificador simples segue no texto');
});

test('identificador simples pode mudar de posição e de formatação, mas não some, muda ou surge', () => {
  const orig = 'Revise `MT103FIM` e depois `MATA103`; confira D1_DOC no SD1.';
  assert.equal(analisarPreservacao(orig, 'Confira D1_DOC no SD1 e revise MATA103 e MT103FIM.', OPC).aprovado, true);
  const sem = analisarPreservacao(orig, 'Revise `MT103FIM`; confira D1_DOC no SD1.', OPC);
  assert.ok(codigosDe(sem).includes('REFERENCIA_TECNICA_REMOVIDA'));
  const troca = analisarPreservacao(orig, 'Revise `MT103FIM` e depois `MATA104`; confira D1_DOC no SD1.', OPC);
  assert.ok(codigosDe(troca).includes('REFERENCIA_TECNICA_REMOVIDA') && codigosDe(troca).includes('REFERENCIA_TECNICA_NOVA'));
  const nova = analisarPreservacao(orig, 'Revise `MT103FIM` e depois `MATA103`; confira D1_DOC no SD1 e `Return`.', OPC);
  assert.ok(codigosDe(nova).includes('REFERENCIA_TECNICA_NOVA'));
  const caixa = analisarPreservacao('A rotina termina com `Return` antes de gravar.', 'A rotina termina com `return` antes de gravar.', OPC);
  assert.ok(codigosDe(caixa).includes('REFERENCIA_TECNICA_REMOVIDA'));
});

test('código real continua rígido: expressão com espaço alterada é rejeitada', () => {
  const r = analisarPreservacao('Execute `SELECT * FROM SD1` agora.', 'Execute `SELECT * FROM SD2` agora.', OPC);
  assert.ok(codigosDe(r).includes('CODIGO_OU_COMANDO_ALTERADO'));
});

// ── caso sintético real: a Técnica e uma Objetiva de referência ───────────────────
test('caso sintético: a própria Técnica, e uma Objetiva fiel e reorganizada, são aprovadas', () => {
  assert.equal(analisarPreservacao(TECNICA_REAL, TECNICA_REAL, OPC).aprovado, true);
  const r = analisarPreservacao(TECNICA_REAL, OBJETIVA_REF, OPC);
  assert.equal(r.aprovado, true, JSON.stringify(r.falhas.map(f => [f.codigo, (f.informacoes || []).map(x => x.slice(0, 80))])));
});

test('caso sintético: resultado da investigação, hipóteses, campos e pontos de entrada não podem sumir', () => {
  const sem = (re) => OBJETIVA_REF.replace(re, '');
  const cortes = {
    'pesquisa externa inteira': /Pesquisa externa:[^\n]*\n\n/,
    'retorno 403 e artigo oficial': /Pesquisa externa:[^\n]*\n\n/,
    'hipóteses de Return/validação silenciosa/exceção': /Hipóteses abertas[^\n]*\n\n(?:- [^\n]*\n){3}\n/,
    'campos D1_*': / \(D1_DOC\/D1_SERIE\/D1_FORNECE\/D1_LOJA referenciando o cliente da NF de saída\)/,
  };
  for (const [nome, re] of Object.entries(cortes)) {
    const cand = sem(re);
    assert.notEqual(cand, OBJETIVA_REF, 'o corte "' + nome + '" não removeu nada');
    assert.equal(analisarPreservacao(TECNICA_REAL, cand, OPC).aprovado, false, nome);
  }
  // Pedido isolado sem referência técnica não bloqueia (gate mínimo). A omissão
  // pode nem ser detectada: é o limite de granularidade já documentado.
  assert.equal(analisarPreservacao(TECNICA_REAL, sem(/\n- Versão exata do Protheus[^\n]*/), OPC).aprovado, true);
});

// ── Frases híbridas: fato + orientação ─────────────────────────────────────
const hibrida = (o, c) => analisarPreservacao(o, c, OPC);
const O1 = 'O log confirmou o erro no parâmetro MV_ESTADO; verifique a tabela SD1.';
test('híbrida: força da afirmação e da orientação são protegidas de forma independente', () => {
  assert.ok(codigosDe(hibrida(O1, 'O erro no parâmetro MV_ESTADO pode existir; verifique a tabela SD1.')).includes('FORCA_AFIRMACAO_ALTERADA'));
  assert.ok(codigosDe(hibrida(O1, 'O log confirmou o erro no parâmetro MV_ESTADO; tente verificar a tabela SD1.')).includes('FORCA_ORIENTACAO_ALTERADA'));
  assert.equal(hibrida(O1, 'O log comprovou o erro no parâmetro MV_ESTADO; confira a tabela SD1.').aprovado, true);
  const o2 = 'A causa foi confirmada; consulte SD1 antes de alterar o parâmetro MV_ESTADO.';
  assert.ok(codigosDe(hibrida(o2, 'A causa talvez seja o parâmetro; consulte SD1 antes de alterar o parâmetro MV_ESTADO.')).includes('FORCA_AFIRMACAO_ALTERADA'));
  const o3 = 'Possivelmente o parâmetro MV_ESTADO causa o erro; verifique a tabela SD1.';
  assert.ok(codigosDe(hibrida(o3, 'O parâmetro MV_ESTADO causa o erro, confirmado; verifique a tabela SD1.')).includes('FORCA_AFIRMACAO_ALTERADA'));
  assert.ok(codigosDe(hibrida('Possivelmente ocorre o erro no parâmetro MV_ESTADO; tente verificar a tabela SD1.', 'Possivelmente ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.')).includes('FORCA_ORIENTACAO_ALTERADA'));
  assert.ok(codigosDe(hibrida('Não há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.', 'Não há evidência do erro no parâmetro MV_ESTADO; pode alterar a tabela SD1.')).includes('FORCA_ORIENTACAO_ALTERADA'));
});

// PONTOS CEGOS CONFIRMADOS (pendentes de decisão): os testes abaixo descrevem o
// comportamento correto e hoje falham; ficam como "todo" para não mascarar o problema.
test('híbrida: orientação com objeto sem artigo ("consulte SD1") é medida', () => {
  const o = 'A causa foi confirmada; consulte SD1 antes de alterar o parâmetro MV_ESTADO.';
  assert.ok(codigosDe(hibrida(o, 'A causa foi confirmada; considere consultar SD1 antes de alterar o parâmetro MV_ESTADO.')).includes('FORCA_ORIENTACAO_ALTERADA'));
});
test('híbrida: hipótese promovida a fato é detectada mesmo com pedido na mesma frase (aviso no gate mínimo)', () => {
  const r = hibrida('Possivelmente ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.', 'Ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.');
  assert.ok(codigosDe(r).includes('INCERTEZA_REMOVIDA'));
});
test('híbrida: negação do fato removida é detectada mesmo com outra negação (aviso no gate mínimo)', () => {
  assert.ok(codigosDe(hibrida('Não há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.', 'Há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.')).includes('RESSALVA_REMOVIDA'));
});
test('híbrida [LIMITAÇÃO CONHECIDA, falso positivo seguro]: paráfrase "não altere" -> "não modifique" não deve ser rejeitada', { todo: true }, () => {
  assert.equal(hibrida('Não há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.', 'Não existe evidência do erro no parâmetro MV_ESTADO; não modifique a tabela SD1.').aprovado, true);
});

test('caso sintético [LIMITE DE GRANULARIDADE]: ressalva dentro de frase longa ("não há certeza do nome exato... confirmar no help") é exigida', { todo: true }, () => {
  const cand = OBJETIVA_REF.replace(' Não há certeza do nome exato sem ver a versão, então confirmar no dicionário/help da rotina.', '');
  assert.notEqual(cand, OBJETIVA_REF);
  assert.equal(analisarPreservacao(TECNICA_REAL, cand, OPC).aprovado, false);
});

test('caso sintético [LIMITE DE GRANULARIDADE]: ramo pós-gravação ("se existe registro em SD1 mas não aparece...") não pode ser removido', { todo: true }, () => {
  const cand = OBJETIVA_REF.replace(/\n {3}- Se existe registro em SD1 mas não aparece[^\n]*/, '');
  assert.notEqual(cand, OBJETIVA_REF);
  assert.equal(analisarPreservacao(TECNICA_REAL, cand, OPC).aprovado, false);
});

// ── Correção 1: hipótese × fato na oração factual ──────────────────────────
const HIP = 'Possivelmente ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.';
test('híbrida/hipótese: hipótese→fato e fato→hipótese são rejeitados; equivalentes são aceitos', () => {
  assert.ok(codigosDe(hibrida(HIP, 'Ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.')).includes('INCERTEZA_REMOVIDA'));
  assert.ok(codigosDe(hibrida('Ocorre o erro no parâmetro MV_ESTADO; verifique a tabela SD1.', HIP)).includes('FORCA_AFIRMACAO_ALTERADA'));
  assert.equal(hibrida(HIP, 'Talvez ocorra o erro no parâmetro MV_ESTADO; verifique a tabela SD1.').aprovado, true);
  assert.equal(hibrida(HIP, 'Possivelmente ocorre o erro no parâmetro MV_ESTADO; confira a tabela SD1.').aprovado, true);
});
test('híbrida/hipótese mantida: a força da orientação é aplicada nos dois sentidos', () => {
  const fraca = 'Possivelmente ocorre o erro no parâmetro MV_ESTADO; tente verificar a tabela SD1.';
  assert.ok(codigosDe(hibrida(fraca, HIP)).includes('FORCA_ORIENTACAO_ALTERADA'));
  assert.ok(codigosDe(hibrida(HIP, fraca)).includes('FORCA_ORIENTACAO_ALTERADA'));
});
test('híbrida com orações separadas por vírgula também separa fato e orientação', () => {
  assert.ok(codigosDe(hibrida('Possivelmente ocorre o erro no parâmetro MV_ESTADO, verifique a tabela SD1.', 'Ocorre o erro no parâmetro MV_ESTADO, verifique a tabela SD1.')).includes('INCERTEZA_REMOVIDA'));
});

// ── Correção 2: negação factual × proibição ───────────────────────────────
const NEG = 'Não há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.';
const POS = 'Há evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.';
test('híbrida/negação: removida e adicionada são rejeitadas; paráfrase e preservação são aceitas', () => {
  assert.ok(codigosDe(hibrida(NEG, POS)).includes('RESSALVA_REMOVIDA'));
  assert.ok(codigosDe(hibrida(POS, NEG)).includes('NEGACAO_FACTUAL_ADICIONADA'));
  assert.equal(hibrida(NEG, 'Não existe evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.').aprovado, true);
  assert.equal(hibrida(NEG, NEG).aprovado, true);
});
test('híbrida/negação: fato positivo + proibição — a proibição não é lida como negação do fato', () => {
  assert.equal(hibrida(POS, 'Existe evidência do erro no parâmetro MV_ESTADO; não altere a tabela SD1.').aprovado, true);
  assert.equal(hibrida(POS, POS).aprovado, true);
  assert.ok(codigosDe(hibrida(POS, 'Há evidência do erro no parâmetro MV_ESTADO; altere a tabela SD1.')).includes('FORCA_ORIENTACAO_ALTERADA'));
});

// ── Correção 3: verbo seguido de identificador técnico ────────────────────
test('forcaOrientacao: verbo + identificador é instrução; fatos com identificador não são', () => {
  for (const f of ['Consulte SD1.', 'Verifique SD2.', 'Valide D1_DOC.', 'Confira MATA103.']) assert.equal(forcaOrientacao(f), 3, f);
  for (const f of ['Não grava SD1.', 'Não gera o documento.', 'Não aparece na tela.', 'O sistema grava SD1.', 'Falta SD1 no relatório.', 'Consulte documento.']) assert.equal(forcaOrientacao(f), 0, f);
  assert.ok(codigosDe(hibrida('Consulte SD1 antes de alterar o parâmetro MV_ESTADO.', 'Considere consultar SD1 antes de alterar o parâmetro MV_ESTADO.')).includes('FORCA_ORIENTACAO_ALTERADA'));
  assert.equal(hibrida('Consulte SD1 antes de alterar o parâmetro MV_ESTADO.', 'Confira SD1 antes de alterar o parâmetro MV_ESTADO.').aprovado, true);
});

test('robustez: caracteres especiais depois de um verbo não derrubam o validador', () => {
  for (const f of ['Consulte [abc', 'Verifique +x', 'Valide a?b', 'Confira (sd1', 'Use \\x']) assert.doesNotThrow(() => forcaOrientacao(f), f);
  assert.doesNotThrow(() => analisarPreservacao('Consulte SD1 agora.', 'Consulte [abc agora.', OPC));
});

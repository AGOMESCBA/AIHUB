// Quadro investigativo com tentativas anteriores (2026-10; caso #036413,
// historico anonimizado). O quadro deve entregar ao modelo o CONTEUDO das acoes
// ja executadas (nao so rotulos), com vinculo a mensagem de origem, e nao pode
// orientar a repetir o que o historico ja registra. Nao classifica resultado
// (sem "sintoma_persiste"): quem interpreta o que funcionou e a IA.
// Executar: node "apps/IA Service/tests/contexto-tentativas-anteriores.test.js"

const assert = require('assert');
const ce = require('../backend/services/context-engine');

const HIST = [
  { papel: 'customer', criadoEm: '2026-09-08T04:00:00.000Z', conteudo: 'Abertura do chamado por solicitante não identificado\n\nConseguimos transmitir 3 notas fiscais, depois nenhuma outra foi autorizada.\nNF 1001: Rejeição 1062 – Valor do Diferimento da CBS diferente do calculado.\nNF 1002: Rejeição 1031 – Valor do Diferimento da UF diferente do calculado.' },
  { papel: 'user', criadoEm: '2026-09-08T04:00:01.000Z', conteudo: '[2026-09-08] Analista A\n\nEncaminhado' },
  { papel: 'user', criadoEm: '2026-09-09T04:00:02.000Z', conteudo: '[2026-09-09] Analista B\n\nRealizamos testes e validações nas regras do calculo do IBS/CBS com diferimento, ao transmitir o documento fiscal a rejeição 1031 permanece, realizamos a abertura de chamado junto a totvs 99999999, estamos acompanhando o retorno.' },
  { papel: 'user', criadoEm: '2026-09-09T04:00:03.000Z', conteudo: '[2026-09-09] Analista B\n\nForam transmitidas e aprovadas as 03 notas informadas, favor realizar a impressão e validação das informações.' },
  { papel: 'user', criadoEm: '2026-09-10T04:00:04.000Z', conteudo: '[2026-09-10] Analista B\n\nConforme solicitado pelo analista totvs, encaminhamos as tabelas e arquivos para analise.' },
  { papel: 'user', criadoEm: '2026-09-14T04:00:05.000Z', conteudo: '[2026-09-14] Analista B\n\nRealizamos os ajustes nas regras de base calculo do IBS/CBS, deixando todas como formula manual e ajustando a formula de acordo com as documentações totvs. Também foi realizado as atualizações de pacotes conforme o analista da totvs solicitou. Foi encaminhado para ele as informações das notas (tabelas, inspetor de objetos) pois a rejeição 1031 ainda esta ocorrendo.' },
];

function quadro(mensagens, extra = {}) {
  return ce._montarQuadroInvestigativo({
    atendimento: { referenciaExterna: '000001', conteudoBruto: mensagens[0].conteudo },
    mensagens, mensagemAtual: '', selecionadosEfetivos: [], omitidos: [], pesquisaSelecionada: null, pendenciaConsolidada: null, ...extra,
  });
}

const testes = [];
function teste(nome, fn) { testes.push({ nome, fn }); }

teste('"realizamos a abertura de chamado" conta como encaminhamento executado (nao "solicitada")', () => {
  const q = quadro(HIST);
  const msg3 = q.eventosOperacionais.filter(a => a.origem === 'mensagem:3' && a.tipo === 'encaminhamento_terceiro');
  assert.strictEqual(msg3.length, 1);
  assert.strictEqual(msg3[0].status, 'executada_ou_em_andamento');
});

teste('rotulo "Abertura do chamado por ...", futuro e negacao nao contam como abertura executada', () => {
  for (const conteudo of [
    'Abertura do chamado por Fulano\n\nPrecisamos de chamado na TOTVS para este erro.',
    'Vamos realizar a abertura de chamado na TOTVS amanha.',
    'Ainda nao realizamos a abertura de chamado na TOTVS.',
  ]) {
    const q = quadro([{ papel: 'user', conteudo }]);
    const enc = q.eventosOperacionais.filter(a => a.tipo === 'encaminhamento_terceiro');
    assert.ok(enc.every(a => a.status === 'solicitada'), `${conteudo} => ${JSON.stringify(enc.map(a => a.status))}`);
  }
  const passiva = quadro([{ papel: 'user', conteudo: 'A abertura do chamado na TOTVS foi realizada hoje.' }]);
  assert.ok(passiva.eventosOperacionais.some(a => a.tipo === 'encaminhamento_terceiro' && a.status === 'executada_ou_em_andamento'));
});

teste('quadro formatado traz o trecho original de cada acao executada, com origem e data', () => {
  const txt = ce._formatarQuadroInvestigativo(quadro(HIST));
  assert.match(txt, /- mensagem:6 \| 2026-09-14T04:00:05\.000Z \[[^\]]*correcao_aplicada[^\]]*\]: "[^"]*formula manual[^"]*atualizações de pacotes[^"]*1031 ainda esta ocorrendo/);
  assert.match(txt, /- mensagem:5 \| 2026-09-10[^\n]*encaminhamos as tabelas e arquivos/);
  assert.match(txt, /- mensagem:3 \| 2026-09-09[^\n]*rejeição 1031 permanece/);
  // Uma linha por mensagem de origem, mesmo com varias acoes nela.
  assert.strictEqual((txt.match(/- mensagem:6 \|/g) || []).length, 1);
  // Acao executada em andamento nao reaparece como pendente.
  assert.ok(!/Acoes solicitadas\/planejadas\/pendentes:[^\n]*mensagem:3/.test(txt), txt);
});

teste('orientacao: considerar tentativas e resultados; repeticao so com justificativa; historico e fonte principal', () => {
  const txt = ce._formatarQuadroInvestigativo(quadro(HIST));
  assert.match(txt, /o que ja foi tentado, o que funcionou e o que continua pendente/);
  assert.match(txt, /se a repeticao for necessaria, explique qual informacao nova ou hipotese a justifica/);
  assert.match(txt, /historico original e a fonte principal; este quadro e auxiliar/);
  assert.match(txt, /lista parcial/);
  // Sem classificacao deterministica de resultado.
  assert.ok(!/sintoma_persiste/.test(txt));
});

teste('acoes candidatas nao induzem a revisar de novo o que ja foi configurado', () => {
  const sel = HIST.map((m, i) => ({ tipo: 'mensagem', id: `m${i}`, score: 20, texto: m.conteudo, ref: m }));
  sel.push({ tipo: 'imagem', id: 'i1', score: 130, texto: '[Imagem: erro-cbs.png]', ref: { nomeOriginal: 'erro-cbs.png', mimeType: 'image/png' }, enviarImagem: true, atual: true });
  const comPendencia = quadro(HIST, { selecionadosEfetivos: sel, pendenciaConsolidada: ce._interpretarPendenciaConsolidada('RETORNO - FORNECEDOR') });
  assert.strictEqual(comPendencia.estadoOperacional, 'aguardando_retorno_externo');
  assert.match(comPendencia.acoesParaReduzirIncerteza[0], /^Verificar internamente/);
  assert.match(comPendencia.acoesParaReduzirIncerteza[0], /pontos que as tentativas ja registradas no historico nao cobriram/);
  assert.ok(!/o que foi configurado ou gerado no ambiente/.test(comPendencia.acoesParaReduzirIncerteza.join(' ')));
  const semPendencia = quadro(HIST);
  assert.match(semPendencia.acoesParaReduzirIncerteza[0], /Verificar no historico se a correcao aplicada ja foi testada e com qual resultado/);
});

teste('pendencia consolidada: distribuidor e "AGUARDANDO X" reconhecidos como no gate', () => {
  const p = ce._interpretarPendenciaConsolidada;
  assert.deepStrictEqual(p('RETORNO - DISTRIBUIDOR'), { responsavel: 'distribuidor', bloqueante: true, textoOriginal: 'RETORNO - DISTRIBUIDOR' });
  assert.strictEqual(p('AGUARDANDO FORNECEDOR').bloqueante, true);
  assert.strictEqual(p('AGUARDANDO CLIENTE').responsavel, 'cliente');
  assert.strictEqual(p('RETORNO - CLIENTE').bloqueante, false);
  assert.strictEqual(p('RETORNO - ATENDENTE').responsavel, 'atendente');
  assert.strictEqual(p('CRM - DOC044'), null);
});

(async () => {
  let falhas = 0;
  for (const t of testes) {
    try { await t.fn(); console.log(`  ok  ${t.nome}`); } catch (err) { falhas++; console.error(`  FALHOU  ${t.nome}\n    ${err.stack || err.message}`); }
  }
  console.log(falhas ? `\n${falhas} teste(s) falharam.` : `\n${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
})();

'use strict';

const { redigirTexto } = require('./redaction-service');
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const semNumeracao = texto => texto.replace(/^\s*(?:[-*]\s*)?\d+[.)]\s+/gm, '');
const CODIGO = /```[^]*?```|`[^`\r\n]+`|^\s*(?:SELECT|UPDATE|DELETE|INSERT|ALTER|DROP|EXEC|curl|sudo|npm|node|git|powershell|Remove-Item)\b[^\r\n]*/gim;

function referencias(texto) {
  const s = semNumeracao(texto);
  return new Set([
    ...(s.match(/https?:\/\/[^\s<>"')]+|\b\d+(?:[.,:/-]\d+)*\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\b[A-Z][A-Z0-9]{1,}(?:\/[A-Z0-9]+)*\b|\b[A-Za-z]+\d+[A-Za-z0-9]*\b|(?:\/[\w.-]+){2,}|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g) || []),
    ...(s.match(/\b[\w-]+\.[A-Za-z][A-Za-z0-9]{0,9}\b/g) || []),
  ]);
}

// Âncoras de conteúdo para comparar a mesma proposição mesmo com outra
// redação. Não classifica a validade da investigação, só compara as versões.
const GRAMATICA = new Set('para pelo pela pelos pelas sobre entre como quando onde quais qual isto isso esse essa esses essas voce voces nos nosso nossa mesmo mesma mais muito uma umas uns com sem que dos das ao aos do da de os as por no na nos nas se ser foi foram seja sao esta estao estar ter tem temos teria sera suas seus sua seu cujo ainda ja tambem apenas so mas ate entao assim outro outra porque antes depois necessario importante essencial forma maneira favor gentileza informacao informacoes especifico especificas especificos verificar verificacao analisar analise entender precisamos preciso poderemos possamos recomendo proximo passo avancar seguir continuar'.split(' '));
function palavras(texto) {
  return new Set((normalizar(texto).match(/[a-z][a-z0-9_]{2,}/g) || [])
    .filter(p => !GRAMATICA.has(p))
    .map(p => p.replace(/(?:amentos|imentos|amento|imento|acoes|acao|coes|cao|ados|adas|idos|idas|ando|endo|indo|aram|eram|iram|mente|oes|es|s)$/, ''))
    .filter(p => p.length >= 3));
}
function conceitos(texto) {
  const s = normalizar(texto);
  const incerta = /\b(hipotes\w*|possivel|possivelmente|pode|podem|poderia\w*|talvez|provavel|provavelmente|sugere|parece|suspeit\w*|indicio\w*|a confirmar|quem sabe)\b/.test(s);
  const negativa = /\b(nao|sem|falt\w*|ausen\w*|indispon\w*)\b/.test(s);
  const solicitada = /\b(solicit\w*|peca|pedir|envie|forneca|fornecer|fornecesse|fornecam|colet\w*|obtenha|obter|precis\w*|necessari\w*|verifi\w*|confira|conferir|confirmar|confirme|revis\w*|desabilite|reinicie|aplique|ajuste|altere|corrija|configure|atualize|substitua|remova|instale|habilite|acesse|veja|consulte|filtre|cheque|checar|valide|validar|teste|testar|execute|documente|registre)\b/.test(s);
  // "Já fizemos os ajustes, mas o erro não foi resolvido" contém uma ação
  // concluída e uma resolução negada; a segunda não apaga a primeira.
  const clausula = s.split(/\b(?:mas|porem|no entanto)\b/)[0];
  const concluida = !incerta && !solicitada && !/\b(nao|sem|se)\b/.test(clausula)
    && (/\b(?:ja\s+\w+[\s\S]{0,45}|foi|foram|realizamos|efetuamos|fizemos)\b[\s\S]{0,70}\b(?:feit\w*|realizad\w*|aplicad\w*|atualizad\w*|enviad\w*|encaminhad\w*|abert\w*|adicionad\w*|modificad\w*|ajustad\w*)\b/.test(clausula) || /\bja tentamos\b/.test(clausula)
      // Pretérito de terceiros ("a TOTVS já respondeu") também encerra uma pendência.
      || /\b(?:respondeu|responderam|retornou|retornaram|enviou|enviaram|entregou|entregaram|forneceu|forneceram|concluiu|concluiram|liberou|liberaram|aprovou|aprovaram|corrigiu|corrigiram|ajustou|ajustaram|resolveu|resolveram)\b/.test(clausula));
  const resolvida = !negativa && !incerta && !solicitada && /\b(resolvid\w*|solucionad\w*|corrigid\w*|normalizad\w*|encerrad\w*|restabelecid\w*)\b/.test(s);
  // Formas afirmativas de causalidade: sem marca de incerteza na frase,
  // "está ligada a", "vem de" ou "identificou que" afirmam a causa.
  const confirmada = !negativa && !incerta && !solicitada && (/\b(confirmad\w*|comprovad\w*|garantid\w*|a causa e|causad\w* (?:por|pel[oa]s?)|ocorre porque|(?:log|evidencia|teste)\w* (?:confirma|comprova))\b|\b(?:erro|falha|problema)\b.{0,35}\b(?:e|esta|vem|decorre)\s+(?:no|na|do|da|por)\b/.test(s)
    || /\b(?:identific\w* que|constat\w*|(?:ligad|relacionad|associad)\w* (?:a|ao|aos|as|com)\b|vem d[eoa]s?|vem de|decorre\w* d[eoa]s?|se deve a|(?:esta|estao) (?:incorret|errad|invalid|mal configurad)\w*|a causa (?:da|do|de)\b[^.]{0,60}\be\b)/.test(s));
  const pendente = /\b(aguard\w*|pend\w*|espera\w*|depende\w*|acompanh\w*|falta\w*|precis\w*|fique de olho)\b/.test(s);
  const ausenciaProblema = /\bnao\b[\s\S]{0,35}\b(ocorre|acontece|apresenta)\b|\b(funciona|comporta)\b[\s\S]{0,35}\b(corretamente|normalmente|esperado)\b/.test(s);
  return { incerta, negativa, solicitada, concluida, resolvida, confirmada, pendente, ausenciaProblema };
}
function unidades(texto) {
  return semNumeracao(texto.replace(CODIGO, '')).replace(/\*\*/g, '').split(/\n\s*\n/).flatMap(paragrafo =>
    paragrafo.split(/\n+|(?<=[.!?;])\s+(?=[A-ZÀ-Ú0-9])/).map(s => s.trim()).filter(Boolean)
      .filter(s => !(/^[^.!?\n]{1,55}:$/.test(s) && !conceitos(s).solicitada))
      .map(texto => {
        const estado = conceitos(texto), contexto = conceitos(paragrafo);
        // Em listas de informações solicitadas, "funções que foram modificadas"
        // descreve o objeto do pedido, sem afirmar que os dados foram entregues.
        // Uma ação independente ("Os ajustes já foram feitos") segue protegida.
        if (contexto.solicitada && !estado.solicitada && /^[^.!?;]{1,100}\bque\s+(?:foi|foram)\b/.test(normalizar(texto))) estado.concluida = false;
        return { texto, paragrafo, palavras: palavras(texto), refs: referencias(texto), conceitos: estado, contexto };
      }))
    .filter(u => !(/^(?:com (?:essas|estas) informa[cç][oõ]es|essas informa[cç][oõ]es|dessa forma|assim que tivermos)/i.test(u.texto)
      && /\b(para|poderemos|vamos|permit|conseguir|vis[aã]o|importantes|cruciais)\b/i.test(u.texto)
      && !/\b(desabilite|reinicie|aplique|ajuste|altere|corrija|configure|envie|solicite|obtenha)\b/i.test(u.texto)
      && !u.conceitos.concluida && !u.conceitos.resolvida && !u.conceitos.confirmada));
}
function similaridade(a, b) {
  const comuns = [...a.palavras].filter(p => b.palavras.has(p)).length;
  const ancoras = [...a.refs].filter(r => b.refs.has(r)).length;
  return comuns / Math.max(1, Math.sqrt(a.palavras.size * b.palavras.size))
    + 0.35 * ancoras / Math.max(1, a.refs.size, b.refs.size);
}
function correspondente(unidade, alternativas) {
  const melhor = alternativas.map(u => ({ unidade: u, score: similaridade(unidade, u) })).sort((a, b) => b.score - a.score)[0];
  // Frases anafóricas de ligação ("Essa resposta é importante...") dependem
  // do parágrafo anterior, sem constituir uma nova proposição técnica.
  const c = unidade.conceitos;
  if ((!melhor || melhor.score < 0.2) && !unidade.refs.size && !c.concluida && !c.confirmada && !c.resolvida && !c.incerta && !c.solicitada
    && /^(essa|esse|essas|esses|isso|isto)\b/i.test(unidade.texto) && /\b(importante|crucial)\b/i.test(unidade.texto)) {
    return alternativas.map(u => ({ unidade: u, score: similaridade(
      { ...unidade, palavras: palavras(unidade.paragrafo) }, { ...u, palavras: palavras(u.paragrafo) }) }))
      .sort((a, b) => b.score - a.score)[0];
  }
  return melhor;
}

function analisarPreservacao(original, candidata) {
  const falhas = [];
  const falhar = (codigo, detalhe, informacoes = []) => falhas.push({ codigo, detalhe, informacoes: informacoes.map(redigirTexto) });
  if (typeof candidata !== 'string' || !candidata.trim() || candidata.length > original.length * 2 + 500) {
    falhar('CONTEUDO_INVALIDO', 'Resposta candidata vazia ou com tamanho incompatível.');
    return { aprovado: false, falhas };
  }
  const antes = referencias(original), depois = referencias(candidata);
  const removidas = [...antes].filter(r => !depois.has(r)), novas = [...depois].filter(r => !antes.has(r));
  if (removidas.length) falhar('REFERENCIA_TECNICA_REMOVIDA', 'Identificadores ou valores técnicos removidos.', removidas);
  if (novas.length) falhar('REFERENCIA_TECNICA_NOVA', 'Identificadores ou valores técnicos acrescentados.', novas);
  if (JSON.stringify((original.match(CODIGO) || []).sort()) !== JSON.stringify((candidata.match(CODIGO) || []).sort())) {
    falhar('CODIGO_OU_COMANDO_ALTERADO', 'Código ou comando foi removido, acrescentado ou alterado.');
  }
  for (const ambiente of ['homologacao', 'producao']) {
    if (normalizar(original).includes(ambiente) !== normalizar(candidata).includes(ambiente)) {
      falhar('AMBIENTE_ALTERADO', 'Ambiente técnico removido ou acrescentado.', [ambiente]);
    }
  }
  const origem = unidades(original), destino = unidades(candidata);
  for (const u of destino) {
    if (u.palavras.size < 3 && !u.refs.size && !Object.values(u.conceitos).some(Boolean)) continue;
    const par = correspondente(u, origem);
    if (!par || par.score < 0.2) {
      falhar('AFIRMACAO_SEM_LASTRO', 'Trecho candidato sem correspondência de conteúdo na resposta original.', [u.texto]);
      continue;
    }
    const a = par.unidade.conceitos, b = u.conceitos;
    for (const estado of ['concluida', 'resolvida', 'confirmada']) {
      if (b[estado] && !a[estado]) falhar('ESTADO_OU_CERTEZA_ALTERADO', 'Pedido, hipótese ou pendência promovido a fato concluído ou confirmado.', [par.unidade.texto, u.texto]);
    }
  }
  for (const [indice, u] of origem.entries()) {
    if (u.palavras.size < 3 && !u.refs.size && !Object.values(u.conceitos).some(Boolean)) continue;
    const par = correspondente(u, destino);
    if (!par || par.score < 0.2) {
      falhar('CONTEUDO_ESSENCIAL_OMITIDO', 'Informação da resposta original sem correspondência na reescrita.', [u.texto]);
      continue;
    }
    // Duas frases do mesmo parágrafo podem dividir a ressalva e sua ação
    // ("Se conseguir, obtenha..."). Isso não exige repetir a palavra exata.
    const a = u.conceitos, b = par.unidade.contexto, f = par.unidade.conceitos;
    if (a.concluida && !par.unidade.conceitos.concluida && !b.concluida) falhar('ACAO_REALIZADA_PERDIDA', 'Ação já realizada passou a ser omitida ou apresentada como pendente.', [u.texto, par.unidade.texto]);
    // Incerteza e pendência são avaliadas na frase correspondente. Um pedido
    // ou um "não" em outra frase do parágrafo não preserva a hipótese; o
    // parágrafo só conta se a própria frase não afirmar certeza ou conclusão.
    const fraseAfirma = f.confirmada || f.concluida || f.resolvida;
    // Frase anafórica ("Essa pendência é crucial...") retoma a frase
    // anterior; seu estado é conferido na reescrita dessa frase.
    const anterior = origem[indice - 1];
    const anaforica = anterior?.paragrafo === u.paragrafo && /^(essa|esse|essas|esses|isso|isto)\b/i.test(u.texto) && !a.confirmada && !a.concluida && !a.resolvida;
    const parAnterior = anaforica ? correspondente(anterior, destino) : null;
    const contextoAnaforico = parAnterior?.score >= 0.2 ? parAnterior.unidade.conceitos : null;
    if (a.incerta && !f.incerta && !f.negativa && !f.solicitada && !(b.incerta && !fraseAfirma) && !contextoAnaforico?.incerta) falhar('INCERTEZA_REMOVIDA', 'Hipótese perdeu o caráter de incerteza.', [u.texto, par.unidade.texto]);
    if (a.negativa && !b.negativa && !b.pendente && !(a.ausenciaProblema && b.ausenciaProblema)) falhar('RESSALVA_REMOVIDA', 'Negação ou ausência relevante deixou de estar representada.', [u.texto, par.unidade.texto]);
    if (a.pendente && !f.pendente && !f.solicitada && !(b.pendente && !fraseAfirma) && !contextoAnaforico?.pendente) falhar('PENDENCIA_REMOVIDA', 'Espera ou dependência deixou de estar representada.', [u.texto, par.unidade.texto]);
    if (a.solicitada && !b.solicitada && !b.pendente && b.concluida) falhar('ACAO_SOLICITADA_VIROU_CONCLUIDA', 'Ação solicitada passou a ser descrita como realizada.', [u.texto, par.unidade.texto]);
    else if (a.solicitada && !b.solicitada && !b.pendente) falhar('ACAO_ESSENCIAL_OMITIDA', 'Próxima ação necessária deixou de estar representada.', [u.texto, par.unidade.texto]);
  }
  return { aprovado: falhas.length === 0, falhas };
}

module.exports = { analisarPreservacao, referencias };

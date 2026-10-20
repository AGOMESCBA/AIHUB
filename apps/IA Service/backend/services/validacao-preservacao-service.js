'use strict';

const { redigirTexto } = require('./redaction-service');
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Numeração de lista é editorial, inclusive de subitens ("2.1.").
const semNumeracao = texto => texto.replace(/^\s*(?:[-*]\s*)?\d+(?:\.\d+)*[.)]\s+/gm, '');
const CODIGO = /```[^]*?```|`[^`\r\n]+`|^\s*(?:SELECT|UPDATE|DELETE|INSERT|ALTER|DROP|EXEC|curl|sudo|npm|node|git|powershell|Remove-Item)\b[^\r\n]*/gim;

// Identificador técnico simples entre crases (rotina, ponto de entrada, tabela,
// campo, palavra-chave): pode mudar de posição e de formatação, mas o validador
// exige que continue presente, idêntico e sem substituto ou acréscimo. Código
// real (blocos, comandos, expressões com espaço, operador ou parênteses) segue
// protegido de forma rígida.
const ehIdentificadorSimples = t => /^[A-Za-z_][A-Za-z0-9_]*(?:[./:-][A-Za-z0-9_]+)*$/.test(String(t || '')) && String(t).length <= 40;
const ehSpanIdentificador = c => c.length > 2 && c.startsWith('\x60') && !c.startsWith('\x60\x60\x60') && c.endsWith('\x60') && ehIdentificadorSimples(c.slice(1, -1));
const codigosRigidos = texto => (String(texto).match(CODIGO) || []).filter(c => !ehSpanIdentificador(c));
const identificadoresSimples = texto => new Set((String(texto).match(CODIGO) || []).filter(ehSpanIdentificador).map(c => c.slice(1, -1)));
const escapar = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contemIdentificador = (texto, id) => new RegExp('(?<![A-Za-z0-9_])' + escapar(id) + '(?![A-Za-z0-9_])').test(texto);

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
  const solicitada = forcaOrientacao(texto, { semModais: true }) > 0 || /\b(solicit\w*|peca|pedir|envie|forneca|fornecer|fornecesse|fornecam|colet\w*|obtenha|obter|precis\w*|necessari\w*|verifi\w*|confira|conferir|confirmar|confirme|revis\w*|desabilite|reinicie|aplique|ajuste|altere|corrija|configure|atualize|substitua|remova|instale|habilite|acesse|veja|consulte|filtre|cheque|checar|valide|validar|teste|testar|execute|documente|registre)\b/.test(s);
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

// Força da afirmação sobre a relação entre fatos: 1 associação ("relacionada
// a"), 2 causalidade ("causada por"), 3 certeza ("confirmado"). A hipótese é
// tratada à parte (conceitos().incerta), pois pode acompanhar qualquer nível.
function forcaAfirmacao(texto) {
  const s = normalizar(texto);
  if (/\b(confirmad\w*|confirmou|confirmaram|comprovad\w*|comprovou|comprovaram|garantid\w*|certamente|com certeza|sem duvida|definitivamente|(?:e|foi) a causa)\b/.test(s)) return 3;
  if (/\b(causad\w*|causa|causam|causar|causando|provoc\w*|originad\w*|tem origem|decorre\w*|resulta(?:m|do|da)? de|devido (?:a|ao|aos|as)|por causa d\w*|em razao d\w*|ocorre porque|se deve a|vem d[eoa]s?|leva a|levam a|levar a|levou a|levando a|acarret\w*|ocasion\w*|faz com que|fazem com que)\b/.test(s)) return 2;
  if (/\b(relacionad\w*|ligad\w*|associad\w*|envolv\w*|tem relacao|relacao com|conexao com|correlac\w*)\b/.test(s)) return 1;
  return 0;
}

// Força da orientação ao leitor: 1 tentativa/sugestão, 2 recomendação,
// 3 instrução, 4 obrigatoriedade/proibição. Decidida pela construção da frase
// (verbo no início da oração, moldura "sugerir que", modal "deve"), não por uma
// lista de verbos. "pode estar/ser" é hipótese e não entra aqui.
const DECLARATIVOS = new Set('esse essa esses essas este esta estes estas isso isto mesmo mesma como onde porque antes depois mais muito quase sempre apenas somente falta faltam fica ficam resta restam existe existem consta constam depende dependem parece parecem ocorre ocorrem segue seguem vale trata tem temos ha foi fez gera gerou aparece funciona persiste'.split(' '));
const DET_APOS_VERBO = /^(?:o|a|os|as|um|uma|uns|umas|se|que|de|do|da|dos|das|no|na|nos|nas|em|para|com|ao|aos|ate|todos|todas|isso|isto|esse|essa|este|esta|tambem|antes|depois|primeiro|novamente|ainda)$/;
const FORMA_VERBAL = /^[a-z]{3,}(?:ar|er|ir|or|e|a|ue|que|gue|ca|ce|ja|nha)$/;
const NAO_VERBAL = /(?:ia|ada|ida|ncia|agem|ade|ente|ante|oria)$/;
const PROIBICAO_IMPERATIVA = /^nao\s+(?:execute|faca|use|altere|apague|delete|rode|aplique|remova|reinicie|prossiga|continue|ignore|publique|migre)\b/;
function forcaOrientacao(texto, { semModais = false } = {}) {
  const bruto = String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let s = normalizar(texto).replace(/\*\*/g, '').replace(/^[\s\-*•\d.)]+/, '');
  // Objeto que é identificador técnico: tem dígito ou sublinhado, ou aparece em maiúsculas no texto.
  const ehIdentificador = w => /[0-9_]/.test(w) || (w.length >= 2 && new RegExp('(?<![A-Za-z0-9_])' + w.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])').test(bruto));
  // Rótulo de item ("Testar o procedimento: ...") não é a orientação em si.
  s = s.replace(/^[^:.!?]{1,80}:\s+(?=\S)/, '');
  let nivel = 0;
  for (const seg of s.split(/[,;:.!?]\s*|\s+(?:e|ou|mas|entao|porem)\s+/).map(x => x.trim()).filter(Boolean)) {
    const t = seg.split(/\s+/);
    let n = 0;
    if (!semModais && (/\b(?:deve|devem|devemos|devera|deverao|tem que|tenho que|temos que|obrigatori\w*|imprescindiv\w*|indispensav\w*|nunca|jamais|proibid\w*|vedad\w*)\b/.test(seg)
      || /\b(?:e|sao|sera)\s+(?:\w+\s+)?(?:necessari\w*|preciso|essencial|obrigatori\w*)\b/.test(seg)
      || /\bprecisa(?:m|mos)?\s+(?:\w+\s+){0,2}\w+(?:ar|er|ir)\b/.test(seg)
      || PROIBICAO_IMPERATIVA.test(seg) || /^nao\s+[a-z]{3,}(?:ar|er|ir|or)\b/.test(seg))) n = 4;
    else if (/\b(?:recomend\w*|aconselh\w*|convem|deveria\w*|seria (?:bom|ideal|melhor|interessante|recomendavel|prudente)|vale a pena|prefer\w*)\b/.test(seg)) n = 2;
    else if (/\b(?:tente\w*|tentar|tentem|considere\w*|considerar|avalie\w*|avaliar|sugiro|sugerimos|sugerir|sugira\w*|se possivel|caso queira)\b/.test(seg)
      || (!semModais && /^(?:(?:voce|analista|usuario|cliente|equipe)\s+)?(?:pode|podem|podera|poderia\w*|poderao)\b/.test(seg))) n = 1;
    else if (t.length >= 2 && FORMA_VERBAL.test(t[0]) && !DECLARATIVOS.has(t[0]) && !NAO_VERBAL.test(t[0]) && ((t.length >= 3 && DET_APOS_VERBO.test(t[1])) || ehIdentificador(t[1]))) n = 3;
    nivel = Math.max(nivel, n);
  }
  return nivel;
}

// Separa a frase em orações factuais e orações de orientação, para que um pedido
// ou uma proibição ("verifique Y", "não altere Y") não neutralize nem satisfaça a
// hipótese ou a negação da oração factual ("possivelmente ocorre X", "não há
// evidência de X"). Modais epistêmicos ("pode estar", "deve ser") não são orientação.
const HEDGE_EXPLICITO = /\b(possivelmente|talvez|provavelmente|hipotes\w*|suspeit\w*|parece\w*|poderia\w*|sugere|indicio\w*)\b/;
const VERBO_EPISTEMICO = '(?!estar|ser|haver|ter|existir|ocorrer|causar|gerar|indicar|ficar|vir|decorrer)';
function ehOracaoDiretiva(trecho) {
  const n = normalizar(trecho).replace(/\*\*/g, '').replace(/^[\s\-*•\d.)]+/, '').replace(/^[^:.!?]{1,80}:\s+(?=\S)/, '');
  return forcaOrientacao(trecho, { semModais: true }) > 0 || PROIBICAO_IMPERATIVA.test(n) || /^nao\s+[a-z]{3,}(?:ar|er|ir|or)\b/.test(n)
    || new RegExp('^(?:nao\\s+)?(?:deve|devem|pode|podem)\\s+' + VERBO_EPISTEMICO + '[a-z]+(?:ar|er|ir|or)\\b').test(n);
}
function particaoFatoOrientacao(texto) {
  const grupos = [];
  for (const parte of String(texto).split(/\s*[;:()]\s*|\s+[—–-]\s+/).map(x => x.trim()).filter(Boolean)) {
    let atual = null;
    for (const pedaco of parte.split(/,\s+/)) {
      const dir = ehOracaoDiretiva(pedaco);
      if (!atual || dir) { atual = { texto: pedaco, dir }; grupos.push(atual); }
      else atual.texto += ', ' + pedaco;
    }
  }
  const fatos = grupos.filter(g => !g.dir);
  return { fato: fatos.length ? fatos.map(g => g.texto).join('; ') : null, hibrido: fatos.length > 0 && grupos.some(g => g.dir) };
}

// Conclusão de cortesia ou previsão genérica de resultado ("Essas ações devem
// ajudar...", "Fico à disposição"). Só é genérica se não tiver referência
// técnica nem termo de ressalva, risco, pendência ou validação.
const CONCLUSAO_GENERICA = [
  /^(?:e\s+)?(?:com\s+)?(?:todas\s+)?(?:essas|estas|tais)\s+(?:acoes|medidas|verificacoes|etapas|orientacoes|recomendacoes|passos|sugestoes|analises|informacoes)\b[^.!?]{0,40}?\b(?:devem|deve|podem|pode|vao|irao)\s+(?:nos\s+|te\s+)?(?:ajudar|contribuir|auxiliar|facilitar)\b/,
  /^(?:espero (?:ter ajudado|que (?:isso|essas informacoes) (?:ajude|ajudem))|fico a disposicao|estou a disposicao|qualquer (?:duvida|coisa)|se precisar de (?:mais )?(?:algo|ajuda|alguma coisa|algum detalhe|detalhes|informac\w*|esclareciment\w*))/,
  // Fecho de cortesia no fim da frase ("..., estou à disposição.").
  /\b(?:estou|fico|ficamos|estamos|seguimos) a disposicao\b[^.!?]{0,40}[.!?]?$/,
];
const TERMO_RELEVANTE = /\b(nao|nunca|sem|risco\w*|atencao|cuidado|antes de|producao|homologacao|backup|aguard\w*|pend\w*|depend\w*|exceto|desde que|caso|enquanto|confirm\w*|valid\w*|test\w*|evite|somente|apenas|obrigat\w*|importante|crucial|urgente|impacto|perda|bloque\w*)\b/;
function ehConclusaoGenerica(frase) {
  const texto = String(frase || '').trim();
  const s = normalizar(texto);
  if (!texto || texto.length > 240 || /`/.test(texto) || referencias(texto).size) return false;
  return CONCLUSAO_GENERICA.some(re => re.test(s)) && !TERMO_RELEVANTE.test(s);
}

/**
 * Remove, de forma conservadora, até duas frases genéricas no FINAL do texto.
 * Frases no meio do texto nunca são removidas. O resultado deve passar
 * novamente pelo validador de preservação.
 */
function limparConclusaoGenerica(texto) {
  let resultado = String(texto || '').replace(/\s+$/, '');
  const removidas = [];
  for (let i = 0; i < 2; i++) {
    const inicioParagrafo = resultado.lastIndexOf('\n') + 1;
    const paragrafo = resultado.slice(inicioParagrafo);
    const frases = paragrafo.split(/(?<=[.!?])\s+/);
    const ultima = frases[frases.length - 1];
    if (!ehConclusaoGenerica(ultima)) break;
    const restante = (resultado.slice(0, inicioParagrafo) + frases.slice(0, -1).join(' ')).replace(/\s+$/, '');
    if (!restante.trim()) break; // nunca esvazia a resposta
    removidas.push(ultima.trim());
    resultado = restante;
  }
  return { texto: removidas.length ? resultado : String(texto || ''), removidas };
}

function unidades(texto) {
  return semNumeracao(texto.replace(CODIGO, c => ehSpanIdentificador(c) ? c.slice(1, -1) : '')).replace(/\*\*/g, '').split(/\n\s*\n/).flatMap(paragrafo =>
    paragrafo.split(/\n+|(?<=[.!?;])\s+(?=[A-ZÀ-Ú0-9])/).map(s => s.trim()).filter(Boolean)
      .filter(s => !tituloNeutro(s, texto))
      .map(texto => {
        const estado = conceitos(texto), contexto = conceitos(paragrafo);
        // Em listas de informações solicitadas, "funções que foram modificadas"
        // descreve o objeto do pedido, sem afirmar que os dados foram entregues.
        // Uma ação independente ("Os ajustes já foram feitos") segue protegida.
        if (contexto.solicitada && !estado.solicitada && /^[^.!?;]{1,100}\bque\s+(?:foi|foram)\b/.test(normalizar(texto))) estado.concluida = false;
        return { texto, paragrafo, palavras: palavras(texto), refs: referencias(texto), conceitos: estado, contexto, titulo: /:$/.test(texto.trim()) };
      }))
    .filter(u => !(/^(?:com (?:essas|estas) informa[cç][oõ]es|essas informa[cç][oõ]es|dessa forma|assim que tivermos)/i.test(u.texto)
      && /\b(para|poderemos|vamos|permit|conseguir|vis[aã]o|importantes|cruciais)\b/i.test(u.texto)
      && !/\b(desabilite|reinicie|aplique|ajuste|altere|corrija|configure|envie|solicite|obtenha)\b/i.test(u.texto)
      && !u.conceitos.concluida && !u.conceitos.resolvida && !u.conceitos.confirmada))
    // Conclusão genérica (mesma regra da limpeza) não é proposição técnica:
    // não exige correspondência em nenhum dos dois lados.
    .filter(u => !ehConclusaoGenerica(u.texto));
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

// Omissões autorizadas na síntese da Objetiva: introdução burocrática,
// meta-comentário e registro narrativo de auditoria. Só vale para frase sem
// referência técnica, código, ação, estado, ressalva, pendência ou hipótese;
// pesquisa sem resultado nunca é omissível.
const OMISSIVEL = [
  /^(?:vou ser direto|vou direto ao ponto|vamos la|ola|bom dia|boa tarde|boa noite|prezad[oa]s?|segue (?:a )?(?:analise|resposta|avaliacao)|a seguir|abaixo (?:segue|estao)|conforme solicitado|apos (?:analisar|analise|revisar|revisao) (?:o|a|os|as) )/,
  /^(?:esta (?:resposta|analise) (?:foi|e|se baseia|considera)|(?:essa|esta) (?:analise|resposta) (?:foi gerada|foi elaborada|considera|se baseia)|(?:a )?(?:investigacao|analise) (?:foi|esta) (?:realizada|concluida|baseada)|foram (?:consultad[oa]s|analisad[oa]s|revisad[oa]s) (?:os |as |o |a )?(?:anexos?|fontes?|historico|registros?|mensagens?))/,
];
const NAO_OMISSIVEL = /\b(pesquisa\w*|busca\w*|encontr\w*|resultado\w*|retorn\w*)\b/;
// Título/apresentação terminado em ":" só é descartável (nos dois lados da
// comparação) quando não carrega conteúdo próprio: vocabulário neutro, sem
// referência, data, número, hipótese, negação, pendência, risco, estado ou
// orientação, e com conteúdo posterior no documento. Não existe mais exceção
// por tamanho: título curto com conteúdo ("Risco identificado:") é exigido.
const VOCABULO_APRESENTACAO = /^(?:historic\w*|evidenc\w*|acao|acoes|tentad\w*|realizad\w*|feit\w*|executad\w*|analis\w*|pontos?|principais|algum\w*|seguintes?|segue\w*|abaixo|itens?|resumo|contexto|situacao|informac\w*|registrad\w*|observad\w*|identificad\w*|apresentad\w*|encontrad\w*|partir|passos?|etapas?|detalhes?|ate|agora|aqui|hoje|fazer|atual|atuais|proxim\w*|concret\w*)$/;
function conteudoPosterior(frase, documento) {
  const alvo = normalizar(frase);
  const texto = normalizar(semNumeracao(documento).replace(/\*\*/g, ''));
  const i = texto.indexOf(alvo);
  return i >= 0 && texto.slice(i + alvo.length).trim().length > 0;
}
function tituloNeutro(frase, documento) {
  const t = String(frase || '').trim();
  if (!t.endsWith(':') || t.length > 120 || /[.!?;]\s*\S/.test(t) || /\d|\x60/.test(t) || referencias(t).size) return false;
  const c = conceitos(t);
  if (c.incerta || c.negativa || c.pendente || c.solicitada || c.resolvida || c.confirmada || c.ausenciaProblema) return false;
  const s = normalizar(t);
  if (NAO_OMISSIVEL.test(s) || TERMO_RELEVANTE.test(s)) return false;
  const palavrasT = s.match(/[a-z]{2,}/g) || [];
  if (!palavrasT.length || !palavrasT.every(w => GRAMATICA.has(w) || VOCABULO_APRESENTACAO.test(w))) return false;
  return conteudoPosterior(t, documento);
}
function omissivel(u) {
  if (u.refs.size || u.texto.length > 200) return false;
  if (Object.values(u.conceitos).some(Boolean)) return false;
  const s = normalizar(u.texto);
  return !NAO_OMISSIVEL.test(s) && OMISSIVEL.some(re => re.test(s));
}

// Itens de lista numerados ou com marcador; usado para detectar perda de estrutura.
const ITEM_LISTA = /^\s*(?:\d+[.)]|[-*•])\s+\S/gm;
function perdeuEstrutura(original, candidata) {
  const itensOriginal = (original.match(ITEM_LISTA) || []).length;
  const itensCandidata = (candidata.match(ITEM_LISTA) || []).length;
  const linhas = t => t.split(/\n/).filter(l => l.trim()).length;
  if (itensOriginal >= 2 && itensCandidata < Math.min(itensOriginal, 2)) return true;
  // Texto com várias linhas/parágrafos que chega emendado em uma só.
  return linhas(original) >= 4 && linhas(candidata) <= 1;
}

// Gate mínimo (decisão de produto, 2026-10-19). Fluxo: a Técnica já passou pelo
// Quality Gate; a IA a reescreve de forma objetiva; aqui só se trava o mínimo
// do mínimo, o que é erro técnico objetivo. Redação, estilo e força de
// linguagem não bloqueiam ("o gate não é professor de português"), e o botão
// Detalhes Técnicos mostra a Técnica integral em toda resposta.
//  - Bloqueia (falhas) só o verificável mecanicamente: referência técnica
//    (rotina, campo, tabela, número, data, link) removida, trocada ou inventada;
//    código ou comando alterado; ambiente trocado; resposta vazia; e perda
//    grande de conteúdo técnico (3+ trechos). "Vamos confiar na IA."
//    E dois casos de fato errado (opção A, 2026-10-20), só com pareamento forte:
//    pendência/pedido virou feito, resolvido ou diagnóstico; hipótese de causa
//    virou fato ou certeza.
//  - Avisa (avisos, só auditoria): todo o resto (força da orientação,
//    suavização sem afirmar causa, ressalva reescrita, estrutura, títulos,
//    frases novas sem dado técnico, omissões isoladas).
const PAREAMENTO_FORTE = 0.5;
const CERTEZA_EXPLICITA = /\b(?:confirmad\w*|confirma|confirmou|comprovad\w*|comprova|comprovou|garantid\w*|a causa e|e a causa|(?:esta|estao) (?:incorret|errad|invalid|mal configurad)\w*)\b/;
const LIMITE_PERDA_CONTEUDO = 3;
// Frase omitida que é conteúdo técnico: tem referência, fala de pesquisa ou
// resultado, carrega hipótese ou limitação, ou é longa. Título, introdução e
// fecho de cortesia não contam.
function conteudoTecnicoSubstantivo(u) {
  if (u.titulo || ehConclusaoGenerica(u.texto)) return false;
  return u.refs.size > 0 || u.palavras.size >= 8 || NAO_OMISSIVEL.test(normalizar(u.texto)) || u.conceitos.incerta || u.conceitos.negativa;
}

function analisarPreservacao(original, candidata, { permitirSintese = false, exigirEstrutura = false } = {}) {
  const falhas = [], avisos = [];
  const falhar = (codigo, detalhe, informacoes = [], bloqueia = true) => (bloqueia ? falhas : avisos).push({ codigo, detalhe, informacoes: informacoes.map(redigirTexto) });
  const avisar = (codigo, detalhe, informacoes = []) => falhar(codigo, detalhe, informacoes, false);
  if (typeof candidata !== 'string' || !candidata.trim() || candidata.length > original.length * 2 + 500) {
    falhar('CONTEUDO_INVALIDO', 'Resposta candidata vazia ou com tamanho incompatível.');
    return { aprovado: false, falhas, avisos };
  }
  if (exigirEstrutura && perdeuEstrutura(original, candidata)) avisar('ESTRUTURA_PERDIDA', 'Procedimento ou lista da resposta original perdeu a organização (passos ou quebras de linha).');
  const antes = referencias(original), depois = referencias(candidata);
  const removidas = [...antes].filter(r => !depois.has(r)), novas = [...depois].filter(r => !antes.has(r));
  for (const id of identificadoresSimples(original)) if (!contemIdentificador(candidata, id) && !removidas.includes(id)) removidas.push(id);
  for (const id of identificadoresSimples(candidata)) if (!contemIdentificador(original, id) && !novas.includes(id)) novas.push(id);
  if (removidas.length) falhar('REFERENCIA_TECNICA_REMOVIDA', 'Identificadores ou valores técnicos removidos.', removidas);
  if (novas.length) falhar('REFERENCIA_TECNICA_NOVA', 'Identificadores ou valores técnicos acrescentados.', novas);
  if (JSON.stringify(codigosRigidos(original).sort()) !== JSON.stringify(codigosRigidos(candidata).sort())) {
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
      // Frase nova é aviso. Dado técnico novo já é barrado por
      // REFERENCIA_TECNICA_NOVA; só bloqueia afirmar algo como feito/resolvido.
      const c = u.conceitos;
      falhar('AFIRMACAO_SEM_LASTRO', 'Trecho candidato sem correspondência de conteúdo na resposta original.', [u.texto], false);
      continue;
    }
    const a = par.unidade.conceitos, b = u.conceitos;
    // Só bloqueia quando a frase correspondente da Técnica não fala de nada
    // realizado ou resolvido: se ela já diz "foram realizadas", a candidata
    // dizer o mesmo com outra ordem não é fato novo.
    const tecnicaFalaDisso = {
      concluida: /\b(?:feit|realizad|aplicad|executad|ajustad|atualizad|enviad|alterad|corrigid|testad|configurad)\w*/.test(normalizar(par.unidade.texto)),
      resolvida: /\b(?:resolvid|solucionad|corrigid|normalizad|restabelecid)\w*/.test(normalizar(par.unidade.texto)),
    };
    for (const estado of ['concluida', 'resolvida', 'confirmada']) {
      // Fato errado (opção A, 2026-10-20), só com pareamento forte: pendência ou
      // pedido virou feito/resolvido ("aguardando" -> "já respondeu", "não foi
      // resolvido" -> "foi resolvido"); pedido ou hipótese virou diagnóstico
      // ("verifique se" -> "está incorreto"). O resto é aviso.
      if (!b[estado] || a[estado]) continue;
      // Diagnóstico exige certeza explícita: "relacionado a" sozinho é descritivo.
      const bloqueia = par.score >= PAREAMENTO_FORTE && (estado === 'confirmada'
        ? (a.solicitada || a.incerta) && CERTEZA_EXPLICITA.test(normalizar(u.texto))
        : !(tecnicaFalaDisso[estado] && !a.negativa));
      falhar('ESTADO_OU_CERTEZA_ALTERADO', 'Pedido, hipótese ou pendência promovido a fato concluído ou confirmado.', [par.unidade.texto, u.texto], bloqueia);
    }
  }
  const omitidosTecnicos = [];
  for (const [indice, u] of origem.entries()) {
    if (u.titulo) {
      // Título com conteúdo próprio: todas as suas palavras e marcas (hipótese,
      // negação, pendência, pedido) precisam existir na candidata.
      const todas = new Set(destino.flatMap(d => [...d.palavras]));
      const marcadas = ['incerta', 'negativa', 'pendente', 'solicitada'].filter(m => u.conceitos[m]);
      const marcas = marcadas.every(m => destino.some(d => d.conceitos[m]));
      const presentes = [...u.palavras].filter(w => todas.has(w)).length;
      // Com marca (pedido, hipótese...), a paráfrase do verbo é aceita: exige a marca e metade das palavras. Sem marca, todas.
      const palavrasOk = marcadas.length ? presentes * 2 >= u.palavras.size : presentes === u.palavras.size;
      // Título com referência técnica já é coberto por REFERENCIA_TECNICA_REMOVIDA.
      if (!palavrasOk || !marcas) avisar('CONTEUDO_ESSENCIAL_OMITIDO', 'Título com conteúdo próprio deixou de estar representado.', [u.texto]);
      continue;
    }
    if (u.palavras.size < 3 && !u.refs.size && !Object.values(u.conceitos).some(Boolean)) continue;
    const par = correspondente(u, destino);
    if (!par || par.score < 0.2) {
      if (permitirSintese && omissivel(u)) continue;
      // Cada omissão é aviso; perda grande (3+ trechos técnicos) bloqueia abaixo.
      avisar('CONTEUDO_ESSENCIAL_OMITIDO', 'Informação da resposta original sem correspondência na reescrita.', [u.texto]);
      if (conteudoTecnicoSubstantivo(u)) omitidosTecnicos.push(u.texto);
      continue;
    }
    const forte = par.score >= PAREAMENTO_FORTE;
    // Duas frases do mesmo parágrafo podem dividir a ressalva e sua ação
    // ("Se conseguir, obtenha..."). Isso não exige repetir a palavra exata.
    const a = u.conceitos, b = par.unidade.contexto, f = par.unidade.conceitos;
    // Ação já feita apresentada como pendente faz o analista repetir trabalho.
    if (a.concluida && !par.unidade.conceitos.concluida && !b.concluida) avisar('ACAO_REALIZADA_PERDIDA', 'Ação já realizada passou a ser omitida ou apresentada como pendente.', [u.texto, par.unidade.texto]);
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
    if (a.incerta && !f.incerta && !f.negativa && !f.solicitada && !(b.incerta && !fraseAfirma) && !contextoAnaforico?.incerta) {
      // Hipótese de causa/relação virou fato ("possivelmente vem do X" -> "vem do X",
      // "pode estar relacionada" -> "está relacionada"): bloqueia com pareamento
      // forte. Suavização sem afirmar causa ("pode confirmar" -> "confirmará") é aviso.
      falhar('INCERTEZA_REMOVIDA', 'Hipótese perdeu o caráter de incerteza.', [u.texto, par.unidade.texto],
        forte && (forcaAfirmacao(par.unidade.texto) >= 1 || f.confirmada));
    }
    // Negação perdida só bloqueia quando a frase correspondente afirma o
    // contrário (não é um pedido nem pendência) e o pareamento é forte.
    if (a.negativa && !b.negativa && !b.pendente && !(a.ausenciaProblema && b.ausenciaProblema)) falhar('RESSALVA_REMOVIDA', 'Negação ou ausência relevante deixou de estar representada.', [u.texto, par.unidade.texto], false);
    if (a.pendente && !f.pendente && !f.solicitada && !(b.pendente && !fraseAfirma) && !contextoAnaforico?.pendente) avisar('PENDENCIA_REMOVIDA', 'Espera ou dependência deixou de estar representada.', [u.texto, par.unidade.texto]);
    // Força da afirmação: associação ou hipótese não pode virar causalidade
    // ou certeza, e uma certeza não pode virar hipótese. Mesmo nível é
    // paráfrase aceita ("relacionada a" -> "ligada a").
    const forcaOriginal = forcaAfirmacao(u.texto), forcaCandidata = forcaAfirmacao(par.unidade.texto);
    // Só "virou certeza/causa confirmada" muda o fato; os demais níveis são linguagem.
    if (forcaCandidata >= 2 && forcaCandidata > forcaOriginal) falhar('FORCA_AFIRMACAO_ALTERADA', 'Associação ou hipótese promovida a causalidade ou certeza.', [u.texto, par.unidade.texto], forcaCandidata === 3 && forte);
    else if (forcaOriginal === 3 && !a.incerta && f.incerta) avisar('FORCA_AFIRMACAO_ALTERADA', 'Certeza rebaixada a hipótese.', [u.texto, par.unidade.texto]);
    const orientOriginal = forcaOrientacao(u.texto), orientCandidata = forcaOrientacao(par.unidade.texto);
    if (orientOriginal > 0 && orientCandidata > 0 && orientOriginal !== orientCandidata) avisar('FORCA_ORIENTACAO_ALTERADA', orientCandidata > orientOriginal ? 'Orientação reforçada (tentativa, recomendação, instrução ou obrigatoriedade).' : 'Orientação enfraquecida (tentativa, recomendação, instrução ou obrigatoriedade).', [u.texto, par.unidade.texto]);
    // Frase híbrida (fato + orientação): hipótese e negação da oração factual são
    // avaliadas sem o efeito do pedido ou da proibição da mesma frase.
    const pO = particaoFatoOrientacao(u.texto), pC = particaoFatoOrientacao(par.unidade.texto);
    if (pO.hibrido && pC.hibrido && pO.fato && pC.fato) {
      const co = conceitos(pO.fato), cc = conceitos(pC.fato);
      if (co.incerta && !cc.incerta) avisar('INCERTEZA_REMOVIDA', 'Hipótese da oração factual passou a ser apresentada como fato.', [u.texto, par.unidade.texto]);
      else if (!co.incerta && HEDGE_EXPLICITO.test(normalizar(pC.fato)) && !HEDGE_EXPLICITO.test(normalizar(pO.fato))) avisar('FORCA_AFIRMACAO_ALTERADA', 'Fato da oração factual foi rebaixado a hipótese.', [u.texto, par.unidade.texto]);
      // Fato invertido (negação removida ou acrescentada na oração factual) muda o conteúdo.
      if (co.negativa && !cc.negativa && !cc.pendente && !(co.ausenciaProblema && cc.ausenciaProblema)) falhar('RESSALVA_REMOVIDA', 'Negação da oração factual deixou de estar representada.', [u.texto, par.unidade.texto], false);
      else if (!co.negativa && cc.negativa) falhar('NEGACAO_FACTUAL_ADICIONADA', 'Negação acrescentada à oração factual.', [u.texto, par.unidade.texto], false);
    }
    if (a.solicitada && !b.solicitada && !b.pendente && b.concluida) falhar('ACAO_SOLICITADA_VIROU_CONCLUIDA', 'Ação solicitada passou a ser descrita como realizada.', [u.texto, par.unidade.texto],
      // Bloqueia só quando a PRÓPRIA frase afirma que foi feito; numa lista "Já feito"
      // o parágrafo inteiro parece concluído, e isso não prova a troca.
      forte && f.concluida && !f.solicitada);
    else if (a.solicitada && !b.solicitada && !b.pendente) avisar('ACAO_ESSENCIAL_OMITIDA', 'Próxima ação necessária deixou de estar representada.', [u.texto, par.unidade.texto]);
  }
  if (omitidosTecnicos.length >= LIMITE_PERDA_CONTEUDO) {
    falhar('PERDA_DE_CONTEUDO_TECNICO', `A reescrita deixou de fora ${omitidosTecnicos.length} trechos técnicos da resposta original.`, omitidosTecnicos);
  }
  return { aprovado: falhas.length === 0, falhas, avisos };
}

module.exports = { analisarPreservacao, referencias, limparConclusaoGenerica, ehConclusaoGenerica, forcaAfirmacao, forcaOrientacao, ehIdentificadorSimples };

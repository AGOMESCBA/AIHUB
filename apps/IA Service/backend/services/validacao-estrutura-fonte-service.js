'use strict';

// Verificação conservadora de regressões ADVPL/TLPP, não um compilador.
// Strings, comentários e corpos SQL/TEXT não são instruções ADVPL.
function linhasDeCodigo(texto, preservarLiterais = false) {
  let comentario = false, literal = null, corpo = null;
  return String(texto).replace(/\r\n/g, '\n').split('\n').map(linha => {
    if (corpo) {
      if (new RegExp(`^\\s*${corpo}\\b`, 'i').test(linha)) corpo = null;
      return '';
    }
    if (!comentario && !literal && /^\s*\*/.test(linha)) return '';
    let codigo = '';
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i], prox = linha[i + 1];
      if (comentario) {
        if (c === '*' && prox === '/') { comentario = false; i++; }
      } else if (literal) {
        if (preservarLiterais) codigo += c;
        if (c === literal) {
          if (prox === literal) { if (preservarLiterais) codigo += prox; i++; } else literal = null;
        }
      } else if (c === '/' && prox === '*') { comentario = true; i++; codigo += ' '; }
      else if ((c === '/' && prox === '/') || (c === '&' && prox === '&')) break;
      else if (c === '"' || c === "'") { literal = c; codigo += preservarLiterais ? c : ' '; }
      else codigo += c;
    }
    // Literais ADVPL comuns não atravessam linhas sem continuação.
    if (!/;\s*$/.test(linha)) literal = null;
    if (/^\s*\*/.test(codigo)) return '';
    if (/^\s*BeginSql\b/i.test(codigo)) { corpo = 'EndSql'; return ''; }
    if (/^\s*Text\b/i.test(codigo)) { corpo = 'EndText'; return ''; }
    return codigo;
  });
}

const ROTINA = /^\s*(?:(?:User|Static)\s+)?(?:Function|Method)\s+([\w:]+)\s*\(/i;

function rotinas(texto) {
  const linhas = linhasDeCodigo(texto);
  const resultado = [];
  let atual = { nome: '<arquivo>', linhas: [], inicio: 1 };
  resultado.push(atual);
  linhas.forEach((linha, i) => {
    const m = linha.match(ROTINA);
    if (m) { atual = { nome: m[1].toLowerCase(), linhas: [], inicio: i + 1 }; resultado.push(atual); }
    atual.linhas.push(linha);
  });
  return resultado;
}

function estrutura(rotina) {
  // Ramos de pré-processamento podem conter fechamentos alternativos válidos.
  // Não presumir uma configuração de compilação que o atendimento não forneceu.
  if (rotina.linhas.some(l => /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/i.test(l))) return null;
  const pilha = [], erros = [];
  const abrir = tipo => pilha.push(tipo);
  const fechar = (tipo, linha) => {
    if (pilha.at(-1) === tipo) pilha.pop();
    else erros.push(`${tipo}: fechamento incompatível na linha ${linha}`);
  };
  let continuacao = false;
  rotina.linhas.forEach((codigo, i) => {
    const anterior = continuacao;
    continuacao = /;\s*$/.test(codigo);
    if (anterior || /^\s*#/.test(codigo)) return;
    const linha = rotina.inicio + i;
    if (/^\s*If\b/i.test(codigo)) abrir('IF');
    else if (/^\s*End\s*If\b/i.test(codigo)) fechar('IF', linha);
    else if (/^\s*(?:ElseIf|Else)\b/i.test(codigo) && pilha.at(-1) !== 'IF') erros.push(`IF: ramo sem If na linha ${linha}`);
    else if (/^\s*For\b/i.test(codigo)) abrir('FOR');
    else if (/^\s*Next\b/i.test(codigo)) fechar('FOR', linha);
    else if (/^\s*Do\s+Case\b/i.test(codigo)) abrir('CASE');
    else if (/^\s*End\s*Case\b/i.test(codigo)) fechar('CASE', linha);
    else if (/^\s*(?:Case\b|Otherwise\b)/i.test(codigo) && pilha.at(-1) !== 'CASE') erros.push(`CASE: ramo sem Do Case na linha ${linha}`);
    else if (/^\s*(?:Do\s+While|While)\b/i.test(codigo)) abrir('WHILE');
    else if (/^\s*End\s*Do\b/i.test(codigo)) fechar('WHILE', linha);
    else if (/^\s*Begin\s+Sequence\b/i.test(codigo)) abrir('SEQUENCE');
    else if (/^\s*End\s*Sequence\b/i.test(codigo)) fechar('SEQUENCE', linha);
    else if (/^\s*Try\b/i.test(codigo)) abrir('TRY');
    else if (/^\s*End\s*Try\b/i.test(codigo)) fechar('TRY', linha);
  });
  return [...erros, ...pilha.map(tipo => `${tipo}: bloco sem fechamento`)];
}

function declaracoes(linhas) {
  const nomes = new Set();
  const logicas = linhas.join('\n').replace(/;\s*\n/g, ' ').split('\n');
  for (const linha of logicas) {
    const inicio = linha.match(/^\s*(?:Local|Private|Public|Static)\s+(?!Function\b)(.*)/i);
    if (!inicio) continue;
    const conteudo = inicio[1];
    // Vírgulas internas de chamadas/arrays não iniciam declarações.
    let nivel = 0, parte = '';
    const registrar = () => { const m = parte.match(/^\s*(\w+)/); if (m) nomes.add(m[1].toLowerCase()); parte = ''; };
    for (const c of conteudo) {
      if ('({['.includes(c)) nivel++;
      if (')}]'.includes(c)) nivel--;
      if (c === ',' && nivel === 0) registrar(); else parte += c;
    }
    registrar();
  }
  return nomes;
}

function validarEstruturaFonte({ arquivo, original, corrigido }) {
  if (!/\.(?:prw|prx|tlpp|aph)$/i.test(String(arquivo || ''))) return { ok: true, avisos: [] };
  const antes = rotinas(original), depois = rotinas(corrigido);
  const falhas = [], avisos = [];
  const falhar = (codigo, rotina, detalhe) => falhas.push({ codigo, detalhe: `${rotina.nome}: ${detalhe}` });
  // Não impedir inclusão legítima de uma função auxiliar; preservar as
  // rotinas anteriores e sua multiplicidade, sem confundir métodos homônimos.
  const pares = [];
  let cursor = 0;
  for (const a of antes) {
    while (cursor < depois.length && depois[cursor].nome !== a.nome) cursor++;
    if (cursor === depois.length) {
      return { ok: false, falhas: [{ codigo: 'ROTINAS_ALTERADAS', detalhe: `A proposta remove, renomeia ou reordena a rotina ${a.nome}.` }] };
    }
    pares.push([a, depois[cursor++]]);
  }
  for (const b of depois.filter(r => !pares.some(p => p[1] === r))) {
    const erros = estrutura(b);
    if (erros?.length) falhar('ESTRUTURA_ADVPL_INVALIDA', b, erros.join('; '));
    if (erros === null) avisos.push(`${b.nome}: estrutura inconclusiva por diretivas condicionais de compilação.`);
  }
  pares.forEach(([a, b]) => {
    if (a.linhas.join('\n') === b.linhas.join('\n')) return;
    const errosAntes = estrutura(a), errosDepois = estrutura(b);
    if (errosAntes === null || errosDepois === null) avisos.push(`${a.nome}: estrutura inconclusiva por diretivas condicionais de compilação.`);
    else if (errosDepois.length && (!errosAntes.length || errosDepois.length > errosAntes.length)) {
      falhar('ESTRUTURA_ADVPL_INVALIDA', b, errosDepois.join('; '));
    } else if (errosDepois.length) avisos.push(`${a.nome}: estrutura original já possui ambiguidades; requer compilação.`);
    const textoAntes = a.linhas.join('\n'), textoDepois = b.linhas.join('\n');
    const restauracoes = s => (s.match(/\bFWRestArea\s*\(/gi) || []).length;
    if (restauracoes(textoDepois) < restauracoes(textoAntes)) falhar('RESTAURACAO_CONTEXTO_REMOVIDA', b, 'A proposta elimina chamada existente a FWRestArea.');
    const nomesDepois = declaracoes(b.linhas);
    for (const nome of declaracoes(a.linhas)) {
      if (!nomesDepois.has(nome)) falhar('DECLARACAO_REMOVIDA', b, `A proposta elimina a declaração de ${nome}.`);
    }
  });
  return { ok: falhas.length === 0, falhas, avisos };
}

module.exports = { validarEstruturaFonte, rotinasDeCodigo: rotinas, linhasDeCodigo };

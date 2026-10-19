'use strict';

// Comparação conservadora dos caminhos de rotinas alteradas. Não compila
// ADVPL: construções fora do subconjunto analisado ficam inconclusivas.
const { linhasDeCodigo, rotinasDeCodigo } = require('./validacao-estrutura-fonte-service');
const MAX_CAMINHOS = 256;
const limpar = s => (String(s).match(/"(?:[^"]|"")*"|'(?:[^']|'')*'|[^\s"']+/g) || []).map(t => /^["']/.test(t) ? t : t.toLowerCase()).join('');
const FINAIS_CONHECIDOS = /^(?:FWRestArea|RestArea|FClose|DbCloseArea|DbUnlock|MsUnlock|Close|Dispose|Release|Unlock)$/i;
const chamada = s => {
  const alias = s.match(/^\s*(\w+)\s*->\s*\(\s*(\w+)\s*\((.*)\)\s*\)\s*$/i);
  return alias ? [alias[0], `${alias[1]}->${alias[2]}`, alias[3]] : s.match(/^\s*((?:\w+\s*(?::|->)\s*)?\w+)\s*\((.*)\)\s*$/i);
};
const assinatura = s => { const m = chamada(s); return m ? limpar(`${m[1]}(${m[2]})`) : null; };

function analisarRotina(texto, rotina) {
  const todas = rotinasDeCodigo(texto), indice = todas.findIndex(r => r === rotina);
  // Os objetos podem vir de outra leitura: posição inicial é estável.
  const pos = indice < 0 ? todas.findIndex(r => r.inicio === rotina.inicio) : indice;
  const fim = todas[pos + 1]?.inicio - 1 || String(texto).split('\n').length;
  const linhas = linhasDeCodigo(texto, true).slice(rotina.inicio - 1, fim);
  const logicas = [], motivosDinamicos = [];
  let pendente = null;
  linhas.forEach((l, i) => {
    const linha = rotina.inicio + i;
    if (/^\s*(?:(?:User|Static)\s+)?(?:Function|Method)\b/i.test(l)) return;
    const codigo = l.trim();
    if (!codigo) return;
    const semLiteral = codigo.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '');
    if (/&|\{\s*\|/.test(semLiteral)) motivosDinamicos.push(`Macro ou codeblock não resolvido na linha ${linha}.`);
    const item = pendente || { codigo: '', linha };
    item.codigo += ' ' + codigo.replace(/;\s*$/, '');
    if (/;\s*$/.test(codigo)) pendente = item;
    else { logicas.push(item); pendente = null; }
  });
  const motivos = [...motivosDinamicos];
  if (pendente) motivos.push('Continuação de instrução incompleta.');
  if (linhas.some(l => /^\s*#\s*(?:if|else|elif|endif)/i.test(l))) motivos.push('Diretivas condicionais de compilação.');
  let cursor = 0, profundidade = 0;
  function sequencia(parar = /$^/) {
    if (++profundidade > 64) throw new Error('Limite de profundidade de blocos atingido.');
    const nos = [];
    while (cursor < logicas.length && !parar.test(logicas[cursor].codigo.trim())) {
      const item = logicas[cursor++], s = item.codigo.trim();
      if (/^If\b/i.test(s)) {
        const ramos = [{ condicao: s.replace(/^If\s+/i, ''), nos: sequencia(/^(?:ElseIf|Else|End\s*If)\b/i) }];
        while (/^ElseIf\b/i.test(logicas[cursor]?.codigo.trim() || '')) {
          const c = logicas[cursor++].codigo.trim().replace(/^ElseIf\s+/i, '');
          ramos.push({ condicao: c, nos: sequencia(/^(?:ElseIf|Else|End\s*If)\b/i) });
        }
        let senao = [];
        if (/^Else\b/i.test(logicas[cursor]?.codigo.trim() || '')) { cursor++; senao = sequencia(/^End\s*If\b/i); }
        if (!/^End\s*If\b/i.test(logicas[cursor++]?.codigo.trim() || '')) motivos.push('If sem fechamento reconhecível.');
        nos.push({ tipo: 'if', ramos, senao, linha: item.linha });
      } else if (/^(?:For|While|Do\s+While)\b/i.test(s)) {
        const corpo = sequencia(/^(?:Next|End\s*Do)\b/i);
        const fechamento = logicas[cursor++]?.codigo.trim() || '';
        const m = s.match(/^For\s+(\w+)\s*:?=\s*(-?\d+)\s+To\s+(-?\d+)(?:\s+Step\s+(-?\d+))?\s*$/i);
        let valores = null;
        if (m && /^Next\b/i.test(fechamento)) {
          const ini = +m[2], fim = +m[3], passo = +(m[4] || 1);
          if (passo && Math.abs((fim - ini) / passo) <= 8) {
            valores = []; for (let v = ini; passo > 0 ? v <= fim : v >= fim; v += passo) valores.push(v);
          }
        }
        if (!valores) motivos.push(`Laço não limitado estaticamente na linha ${item.linha}.`);
        nos.push({ tipo: 'for', corpo, variavel: m?.[1].toLowerCase(), valores, linha: item.linha });
      } else {
        const semLiterais = s.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '');
        if (/^(?:Begin\s+(?:Sequence|Transaction)|Recover|Always|End\s+(?:Sequence|Transaction)|Try|Catch|Finally|EndTry|Do\s+Case|Case|Otherwise|EndCase|Goto|Throw|Retry|Quit|Break)\b/i.test(s)
          || /&|;|\{\s*\|/.test(semLiterais) || /^(?:Private|Public|Static)\b/i.test(s)) motivos.push(`Transferência ou construção não resolvida na linha ${item.linha}: ${s.slice(0, 70)}`);
        nos.push({ tipo: /^Return\b/i.test(s) ? 'return' : /^Exit\s*$/i.test(s) ? 'exit' : /^Loop\s*$/i.test(s) ? 'loop' : 'stmt', codigo: s, linha: item.linha });
      }
    }
    profundidade--; return nos;
  }
  const ast = sequencia();
  return { ast, motivos, linhas: logicas };
}

function finalizacoes(ast) {
  const finais = new Set();
  function visitar(nos, raiz = false) {
    nos.forEach((n, i) => {
      if (n.tipo === 'if') { n.ramos.forEach(r => visitar(r.nos)); visitar(n.senao); }
      else if (n.tipo === 'for') visitar(n.corpo);
      const m = n.codigo && chamada(n.codigo);
      if (m && FINAIS_CONHECIDOS.test(m[1].split(/:|->/).at(-1))) finais.add(assinatura(n.codigo));
      if (n.tipo === 'return' || (raiz && i === nos.length - 1)) {
        // Chamadas do epílogo original são obrigações observadas desse fluxo;
        // não presumimos o contrato de uma função customizada pelo seu nome.
        const anterior = nos[n.tipo === 'return' ? i - 1 : i];
        if (anterior?.tipo === 'stmt' && chamada(anterior.codigo)) finais.add(assinatura(anterior.codigo));
      }
    });
  }
  visitar(ast, true); return finais;
}

const clonar = p => ({ ...p, variaveis: { ...p.variaveis }, condicoes: { ...p.condicoes }, chamadas: { ...p.chamadas }, trilha: [...p.trilha] });
function condicao(texto, p) {
  let s = limpar(texto), negada = false;
  while (s.startsWith('!') || s.startsWith('.not.')) { negada = !negada; s = s.replace(/^(?:!|\.not\.)/, ''); }
  const valor = p.variaveis[s] ?? s;
  if (valor === '.t.' || valor === '.f.') return { constante: (valor === '.t.') !== negada };
  const vazio = s.match(/^empty\((\w+)\)$/);
  if (vazio) {
    const v = p.variaveis[vazio[1]];
    if (v === '.t.' || v === '.f.' || /^-?\d+$/.test(v || '') || /^["'].*["']$/.test(v || '')) {
      const e = v === '.f.' || v === '0' || (/^["']/.test(v) && !v.slice(1, -1).trim());
      return { constante: e !== negada };
    }
  }
  let simples = /^(?:\w+|empty\(\w+\))$/.test(s);
  const refs = [...s.matchAll(/\b[a-z_]\w*\b/g)].map(m => m[0]).filter(v => p.variaveis[v] !== undefined);
  if (refs.some(v => !/^(?:\.t\.|\.f\.|-?\d+|"(?:[^"]|"")*"|'(?:[^']|'')*'|m->\w+\[\])$/.test(p.variaveis[v]))) simples = false;
  const estado = [...new Set(refs)].sort().map(v => `${v}=${p.variaveis[v]}`).join(';');
  return { chave: s + '|' + estado, negada, simples };
}
function ramificar(p, expr, valor) {
  const c = condicao(expr, p);
  if ('constante' in c) return c.constante === valor ? [clonar(p)] : [];
  const requerido = valor !== c.negada;
  if (c.chave in p.condicoes && p.condicoes[c.chave] !== requerido) return [];
  const q = clonar(p); q.condicoes[c.chave] = requerido; q.certo = q.certo && c.simples; return [q];
}
function caminhos(ast, obrigacoes) {
  function executar(nos, entradas) {
    let ps = entradas;
    for (const n of nos) {
      const saidas = [];
      for (const p of ps) {
        if (p.saida) { saidas.push(p); continue; }
        if (n.tipo === 'if') {
          let restantes = [p];
          for (const ramo of n.ramos) {
            saidas.push(...executar(ramo.nos, restantes.flatMap(q => ramificar(q, ramo.condicao, true))));
            restantes = restantes.flatMap(q => ramificar(q, ramo.condicao, false));
          }
          saidas.push(...executar(n.senao, restantes));
        } else if (n.tipo === 'for') {
          if (!n.valores) throw new Error('Laço não comprovado.');
          let ativos = [clonar(p)]; const encerrados = [];
          for (const v of n.valores) {
            ativos.forEach(q => { q.variaveis[n.variavel] = String(v); });
            ativos = executar(n.corpo, ativos);
            encerrados.push(...ativos.filter(q => q.saida === 'return' || q.saida === 'exit').map(q => { const copia = clonar(q); if (copia.saida === 'exit') copia.saida = null; return copia; }));
            ativos = ativos.filter(q => !q.saida || q.saida === 'loop').map(q => { q.saida = null; return q; });
          }
          saidas.push(...ativos, ...encerrados);
        } else {
          const q = clonar(p), sig = n.codigo && assinatura(n.codigo);
          if (sig && obrigacoes.has(sig)) q.chamadas[sig] = (q.chamadas[sig] || 0) + 1;
          const m = n.codigo?.match(/^(?:Local\s+)?(\w+)\s*:=\s*(.+)$/i);
          if (m) {
            const v = m[1].toLowerCase(), expr = limpar(m[2]);
            q.variaveis[v] = q.variaveis[expr] ?? (/^(?:\.t\.|\.f\.|-?\d+|"(?:[^"]|"")*"|'(?:[^']|'')*')$/.test(expr) ? expr : `${expr}[${Object.entries(q.variaveis).filter(([k]) => new RegExp(`\\b${k}\\b`, 'i').test(expr)).map(([k, val]) => `${k}=${val}`).join(';')}]`);
          }
          q.trilha.push(n.linha);
          if (n.tipo !== 'stmt') { q.saida = n.tipo; q.linhaSaida = n.linha; }
          saidas.push(q);
        }
      }
      if (saidas.length > MAX_CAMINHOS) throw new Error(`Mais de ${MAX_CAMINHOS} caminhos simbólicos.`);
      ps = saidas;
    }
    return ps;
  }
  return executar(ast, [{ variaveis: {}, condicoes: {}, chamadas: {}, trilha: [], certo: true, saida: null }]);
}
const compativeis = (a, b) => Object.entries(a.condicoes).every(([k, v]) => !(k in b.condicoes) || b.condicoes[k] === v);

function validarFluxoFonte({ arquivo, original, corrigido, operacoesObrigatorias = [] }) {
  if (!/\.(?:prw|prx|tlpp|aph)$/i.test(String(arquivo || ''))) return { estado: 'aprovado', codigo: 'FLUXO_NAO_ADVPL', motivos: ['Sem análise específica ADVPL/TLPP; demais controles continuam obrigatórios.'] };
  const antes = rotinasDeCodigo(original), depois = rotinasDeCodigo(corrigido);
  const evidencias = [], duvidas = [];
  if (antes.map(r => r.nome).join('|') !== depois.map(r => r.nome).join('|')) return { estado: 'inconclusivo', codigo: 'ESCOPO_FLUXO_ALTERADO', motivos: ['Conjunto de rotinas alterado; não há correspondência comprovada dos fluxos.'] };
  for (let i = 0; i < antes.length; i++) {
    let a, b;
    try { a = analisarRotina(original, antes[i]); b = analisarRotina(corrigido, depois[i]); }
    catch (err) { duvidas.push(err.message); continue; }
    if (JSON.stringify(a.linhas.map(l => l.codigo)) === JSON.stringify(b.linhas.map(l => l.codigo))) continue;
    const obrigacoes = finalizacoes(a.ast);
    const comprovadas = new Set([...obrigacoes].filter(op => FINAIS_CONHECIDOS.test(chamada(op)?.[1].split(/:|->/).at(-1)) || operacoesObrigatorias.some(o => limpar(o) === op)));
    const transferencias = x => x.linhas.filter(l => /\b(?:Return|Exit|Loop|Break|Goto|Throw|Quit|Retry)\b/i.test(l.codigo)).map(l => limpar(l.codigo)).join('|');
    if (!obrigacoes.size && transferencias(a) === transferencias(b)) continue;
    const recursos = [...obrigacoes].flatMap(op => (op.slice(op.indexOf('(') + 1).replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '').match(/\b[a-z_]\w*\b/g) || []));
    const vinculos = x => x.linhas.filter(l => /:=|[+*/%-]=|\+\+|--/.test(l.codigo) && recursos.some(v => new RegExp(`\\b${v}\\b`, 'i').test(l.codigo))).map(l => limpar(l.codigo)).join('|');
    if (vinculos(a) !== vinculos(b)) { duvidas.push('Vínculo ou mutação de recurso de finalização alterado; equivalência não comprovada.'); continue; }
    if (a.motivos.length || b.motivos.length) { duvidas.push(...a.motivos, ...b.motivos); continue; }
    try {
      const originais = caminhos(a.ast, obrigacoes), propostas = caminhos(b.ast, obrigacoes);
      for (const p of propostas) {
        if (p.saida === 'exit' || p.saida === 'loop') { duvidas.push('Transferência fora de laço reconhecido.'); continue; }
        const correspondentes = originais.filter(o => compativeis(o, p));
        if (!correspondentes.length) { duvidas.push('Caminho proposto sem correspondente original comprovado.'); continue; }
        for (const op of obrigacoes) {
          const contagens = correspondentes.map(o => o.chamadas[op] || 0), realizadas = p.chamadas[op] || 0;
          if (realizadas < Math.min(...contagens)) {
            const detalhe = `${antes[i].nome}: saída na linha ${p.linhaSaida || 'final'} evita ${op}, executada nos caminhos originais compatíveis.`;
            if (p.certo && comprovadas.has(op)) evidencias.push({ detalhe, operacao: op, linha: p.linhaSaida, condicoes: p.condicoes, trilha: p.trilha });
            else duvidas.push(detalhe + (comprovadas.has(op) ? ' A viabilidade da condição exige avaliação externa.' : ' O contrato dessa operação do epílogo não foi comprovado.'));
          } else if (realizadas < Math.max(...contagens)) duvidas.push(`Preservação de ${op} não demonstrada em todos os caminhos compatíveis.`);
        }
      }
    } catch (err) { duvidas.push(err.message); }
  }
  if (evidencias.length) return { estado: 'reprovado', codigo: 'FINALIZACAO_DESVIADA', evidencias, motivos: evidencias.map(e => e.detalhe) };
  if (duvidas.length) return { estado: 'inconclusivo', codigo: 'FLUXO_NAO_COMPROVADO', motivos: [...new Set(duvidas)] };
  return { estado: 'aprovado', codigo: 'FLUXO_PRESERVADO', motivos: ['Operações de finalização preservadas nos caminhos comparados.'] };
}

module.exports = { validarFluxoFonte };

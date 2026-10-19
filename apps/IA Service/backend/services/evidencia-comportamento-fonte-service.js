'use strict';

// Provas locais restritas a fluxo explícito. Não interpreta macros, contratos
// de funções ou linguagem natural livre como se fossem um compilador.
const { rotinasDeCodigo } = require('./validacao-estrutura-fonte-service');
const { redigirTexto } = require('./redaction-service');
const normalizar = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const prosa = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/`/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const suportado = arquivo => /\.(?:prw|prx|tlpp|aph)$/i.test(String(arquivo || ''));

function localizarRotina(textoOriginal, original) {
  const ancora = normalizar(rotinasDeCodigo(original).flatMap(r => r.linhas).join('\n'));
  if (!ancora) return null;
  // Flexibilidade usada SOMENTE para localizar evidência semântica. Nunca
  // aplica uma âncora aproximada nem altera a correspondência byte a byte.
  const candidatas = rotinasDeCodigo(textoOriginal).filter(r => normalizar(r.linhas.join('\n')).includes(ancora));
  return candidatas.length === 1 ? candidatas[0] : null;
}

function guardasDaRotina(r) {
  if (r.linhas.some(l => /^\s*#\s*(?:if|else|elif|endif)/i.test(l) || /&|\b(?:ExecScript|MacroRun)\s*\(/i.test(l))) return [];
  const guardas = [];
  r.linhas.forEach((linha, inicio) => {
    const m = linha.match(/^\s*If\s+(?:!|\.Not\.)\s*Empty\s*\(\s*(\w+)\s*\)\s*$/i);
    if (!m) return;
    let nivel = 1, fim = -1, ramo = -1;
    for (let i = inicio + 1; i < r.linhas.length; i++) {
      const l = r.linhas[i];
      if (/^\s*If\b/i.test(l)) nivel++;
      if (/^\s*End\s*If\b/i.test(l) && --nivel === 0) { fim = i; break; }
      if (nivel === 1 && /^\s*(?:Else|ElseIf)\b/i.test(l) && ramo < 0) ramo = i;
    }
    if (fim < 0) return;
    const corpo = r.linhas.slice(inicio + 1, ramo < 0 ? fim : ramo).join('\n');
    const variavel = m[1];
    if (!new RegExp(`^\\s*Local\\s+${variavel}\\b`, 'im').test(r.linhas.slice(0, inicio).join('\n'))) return;
    if (new RegExp(`\\b${variavel}\\s*(?::=|=(?!=)|[+*/%-]=|\\+\\+|--)|(?:@|\\+\\+|--)\\s*${variavel}\\b`, 'i').test(corpo)) return;
    const chamadas = [...corpo.matchAll(/\b(\w+)\s*\(/g)].map(c => c[1]).filter(c => !/^(?:If|Empty|Type)$/i.test(c));
    guardas.push({ variavel, inicio, fim, ramo, chamadas: [...new Set(chamadas)] });
  });
  return guardas;
}

function provaDeProtecao({ arquivo, textoOriginal, diagnostico, alteracoes = [] }) {
  if (!suportado(arquivo)) return null;
  const afirmacoes = prosa(diagnostico).split(/\n\s*\n/);
  const todas = rotinasDeCodigo(textoOriginal).filter(r => r.nome !== '<arquivo>');
  const escopo = alteracoes.length ? alteracoes.map(a => localizarRotina(textoOriginal, a.original))
    : todas.filter(r => todas.length === 1 || prosa(diagnostico).includes(r.nome));
  for (const r of escopo) {
    if (!r) continue;
    for (const g of guardasDaRotina(r)) {
      for (const chamada of g.chamadas) {
        // Uma mesma chamada fora da guarda invalida a prova de proteção
        // integral: não bloquear diagnósticos sobre outro caminho da rotina.
        const fora = r.linhas.slice(0, g.inicio).concat(r.linhas.slice(g.fim + 1), g.ramo < 0 ? [] : r.linhas.slice(g.ramo, g.fim)).join('\n');
        if (new RegExp(`\\b${chamada}\\s*\\(`, 'i').test(fora)) continue;
        const afirmacao = afirmacoes.find(s => s.includes(chamada.toLowerCase()) && s.includes(g.variavel.toLowerCase())
          && !/\b(?:alega\w*|premissa|hipotese|segundo|relat\w*|incorret\w*|fals[oa])\b/.test(s) && (
          /\b(?:nao existe|ausencia de|sem)\s+(?:a\s+|uma\s+)?(?:protec\w*|verifica\w*)[^.!?]{0,120}\bvazi\w*/.test(s)
          || s.split(/(?<=[.!?])\s+/).some(frase => /\b(?:executa\w*|chama\w*|busca\w*)[^.!?]{0,100}\b(?:mesmo|com|um)\b[^.!?]{0,80}\bvazi\w*/.test(frase)
            && !/\bnao\b[^.!?]{0,80}\b(?:executa\w*|chama\w*|busca\w*)/.test(frase))
        ));
        if (!afirmacao) continue;
        const linhas = String(textoOriginal).replace(/\r\n/g, '\n').split('\n');
        return { status: 'contradicao', origem: 'evidencia_local', motivo: `A chamada ${chamada} já está subordinada à condição !Empty(${g.variavel}).`,
          afirmacao, evidencia: redigirTexto(linhas.slice(r.inicio + g.inicio - 1, r.inicio + g.fim).join('\n')),
          demonstracao: `Na rotina ${r.nome}, ${g.variavel} vazio torna a condição falsa e não alcança ${chamada}; não há outra chamada ${chamada} fora dessa guarda nem reatribuição explícita da variável no corpo analisado.` };
      }
    }
  }
  return null;
}

function provaDeNovaRegra({ arquivo, textoOriginal, pedido, alteracoes = [] }) {
  if (!suportado(arquivo) || alteracoes.length !== 1) return null;
  const a = alteracoes[0], r = localizarRotina(textoOriginal, a.original);
  if (!r) return null;
  const requisicao = prosa(pedido);
  if (!/\bretorn\w*[^\n]{0,60}\.f\./.test(requisicao) || !/\bvazi\w*/.test(requisicao)) return null;
  const retorno = r.linhas.join('\n').match(/\bReturn\s+(\w+)\s*$/i)?.[1];
  if (!retorno) return null;
  // Aplicação exata somente para a prova positiva; âncora ausente ou ambígua
  // permanece uma falha técnica, nunca recebe um parecer de consistência.
  const lf = String(textoOriginal).replace(/\r\n/g, '\n'), ancora = a.original.replace(/\r\n/g, '\n');
  if (!ancora || lf.indexOf(ancora) < 0 || lf.indexOf(ancora) !== lf.lastIndexOf(ancora)) return null;
  const candidato = lf.replace(ancora, () => a.substituto.replace(/\r\n/g, '\n'));
  for (const g of guardasDaRotina(r)) {
    if (g.ramo >= 0 || !requisicao.includes(g.variavel.toLowerCase())) continue;
    if (!new RegExp(`\\b${g.variavel}\\s+(?:estiver|esta|for|ficar)\\s+vazi\\w*[^\\n.!?]{0,140}\\bretorn\\w*\\s+\\.f\\.`, 'i').test(requisicao)) continue;
    const prefixo = r.linhas.slice(0, g.inicio).join('\n');
    const sufixo = r.linhas.slice(g.fim + 1).join('\n');
    // Caminho vazio: inicialização booleana explícita e nenhuma atribuição,
    // retorno antecipado ou chamada depois do If além da restauração de área.
    const declaracao = new RegExp(`^\\s*Local\\s+${retorno}\\s*:=\\s*\\.T\\.\\s*$`, 'im');
    if (!declaracao.test(prefixo) || /\b(?:If|Else|For|While|Return)\b/i.test(prefixo)) continue;
    if (new RegExp(`\\b${retorno}\\s*(?::=|=(?!=))`, 'i').test(prefixo.replace(declaracao, ''))) continue;
    if (sufixo.split('\n').some(l => l.trim() && !/^\s*(?:FWRestArea\s*\(\s*\w+\s*\)|Return\s+\w+)\s*$/i.test(l))) continue;
    // Comparar também os literais: o lexer sozinho não detectaria mudança
    // de uma mensagem, argumento ou constante em um caminho preservado.
    const antes = lf.split('\n'), depois = candidato.split('\n');
    const posicao = r.inicio + g.fim - 1;
    if (depois.length !== antes.length + 2) continue;
    if (antes.some((l, i) => l !== depois[i < posicao ? i : i + 2])) continue;
    const novas = rotinasDeCodigo(depois.slice(posicao, posicao + 2).join('\n'))[0].linhas;
    if (normalizar(novas.join('\n')) !== normalizar(`Else ${retorno} := .F.`)) continue;
    return { status: 'consistente', origem: 'evidencia_local', motivo: 'Nova regra de retorno demonstrada no caminho vazio, com os demais caminhos preservados.',
      evidencia: `If !Empty(${g.variavel}) / Else / ${retorno} := .F. / EndIf`,
      demonstracao: `Antes, o caminho vazio preservava ${retorno}=.T.; agora o Else atribui .F. e mantém o mesmo retorno e restauração. O corpo para valor não vazio não mudou.` };
  }
  return null;
}

function avaliarEvidencias(args) {
  return provaDeProtecao(args) || provaDeNovaRegra(args);
}

module.exports = { avaliarEvidencias };

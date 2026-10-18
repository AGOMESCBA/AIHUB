'use strict';

// Correção de fonte por alterações ancoradas: a IA descreve trechos exatos a
// substituir e o servidor os aplica sobre os bytes do arquivo original. O
// fonte nunca é reescrito pela IA, então nenhuma linha fora das alterações
// pode ser perdida, e codificação/quebras de linha do original são mantidas.
// Qualquer âncora ausente, duplicada, conflitante ou insegura impede a geração.

const BLOCO = /```iahub-alteracao[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g;
const INICIO = '[[ORIGINAL]]';
const SEPARADOR = '[[SUBSTITUTO]]';
const FIM = '[[FIM]]';
const MAX_ALTERACOES = 40;
// Marcadores de omissão: indicam um trecho que não foi escrito por completo.
const ELISAO = [
  /\b(?:restante|resto)\b[^\n]{0,40}\b(?:c[oó]digo|fonte|fun[cç](?:[aã]o|[oõ]es)|linhas?|arquivo)\b/i,
  /\b(?:c[oó]digo|fonte|linhas?|demais fun[cç][oõ]es)\b[^\n]{0,30}\b(?:permanece\w*|continua\w*|inalterad\w*|sem altera[cç][aã]o|igual|existente\w*)\b/i,
  /^\s*(?:\/\/|#|--|;|\*|\/\*|<!--)?\s*(?:\.{3}|…)\s*(?:\*\/|-->)?\s*$/m,
];

function _linhas(texto) {
  return texto.split('\n');
}

/**
 * Lê os blocos ```iahub-alteracao``` da resposta técnica. Cada bloco tem:
 *   arquivo: Nome.prw
 *   justificativa: motivo técnico
 *   [[ORIGINAL]] / trecho exato / [[SUBSTITUTO]] / substituto / [[FIM]]
 */
function extrairAlteracoes(texto) {
  const alteracoes = [];
  const erros = [];
  for (const m of String(texto || '').matchAll(BLOCO)) {
    const corpo = m[1].replace(/\r\n/g, '\n');
    const linhas = _linhas(corpo);
    const iInicio = linhas.findIndex(l => l.trimEnd() === INICIO);
    const iSep = linhas.map((l, i) => (l.trimEnd() === SEPARADOR && i > iInicio ? i : -1)).filter(i => i >= 0);
    const iFim = linhas.map((l, i) => (l.trimEnd() === FIM ? i : -1)).filter(i => i >= 0);
    const cabecalho = linhas.slice(0, Math.max(0, iInicio)).join('\n');
    const arquivo = (cabecalho.match(/^\s*arquivo\s*:\s*(.+?)\s*$/mi) || [])[1] || null;
    const justificativa = (cabecalho.match(/^\s*justificativa\s*:\s*(.+?)\s*$/mi) || [])[1] || null;
    if (iInicio < 0 || iSep.length !== 1 || iFim.length !== 1 || !(iInicio < iSep[0] && iSep[0] < iFim[0])) {
      erros.push({ codigo: 'BLOCO_MALFORMADO', arquivo, detalhe: 'Bloco de alteração sem os marcadores [[ORIGINAL]], [[SUBSTITUTO]] e [[FIM]] na ordem esperada.' });
      continue;
    }
    alteracoes.push({
      arquivo,
      justificativa,
      original: linhas.slice(iInicio + 1, iSep[0]).join('\n'),
      substituto: linhas.slice(iSep[0] + 1, iFim[0]).join('\n'),
    });
  }
  return { alteracoes, erros };
}

function _ocorrencias(texto, trecho) {
  const posicoes = [];
  if (!trecho) return posicoes;
  for (let i = texto.indexOf(trecho); i >= 0; i = texto.indexOf(trecho, i + 1)) posicoes.push(i);
  return posicoes;
}

function _quebraDeLinha(texto) {
  const crlf = (texto.match(/\r\n/g) || []).length;
  const lf = (texto.match(/(?:^|[^\r])\n/g) || []).length;
  if (crlf && lf) return 'misto';
  return crlf ? '\r\n' : '\n';
}

function _validarAlteracao(a) {
  if (!a.original.trim()) return 'ANCORA_VAZIA';
  if (a.original === a.substituto) return 'ALTERACAO_SEM_EFEITO';
  if ([INICIO, SEPARADOR, FIM, '__IAHUB_PROTEGIDO_'].some(m => a.substituto.includes(m))) return 'MARCADOR_NO_SUBSTITUTO';
  // Omissão só é rejeitada quando é nova: um comentário "..." já existente
  // na âncora não torna o substituto incompleto.
  if (ELISAO.some(re => re.test(a.substituto) && !re.test(a.original))) return 'TRECHO_INCOMPLETO';
  return null;
}

/**
 * Aplica as alterações sobre o buffer original. Valida todas antes de aplicar
 * qualquer uma; se uma falhar, nada é gerado.
 */
function aplicarAlteracoes({ buffer, encoding, alteracoes }) {
  const enc = encoding === 'utf-8' ? 'utf8' : 'latin1';
  const falhas = [];
  const falhar = (codigo, indice, detalhe) => falhas.push({ codigo, alteracao: indice + 1, detalhe });
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, falhas: [{ codigo: 'ORIGINAL_INDISPONIVEL', detalhe: 'Arquivo original vazio ou indisponível.' }] };
  if (!alteracoes?.length) return { ok: false, falhas: [{ codigo: 'SEM_ALTERACOES', detalhe: 'Nenhuma alteração ancorada informada.' }] };
  if (alteracoes.length > MAX_ALTERACOES) return { ok: false, falhas: [{ codigo: 'ALTERACOES_EXCESSIVAS', detalhe: `Mais de ${MAX_ALTERACOES} alterações em um único arquivo.` }] };

  const texto = buffer.toString(enc);
  // UTF-8 inválido não volta aos mesmos bytes; aplicar sobre ele alteraria
  // partes que a IA não tocou.
  if (!Buffer.from(texto, enc).equals(buffer)) return { ok: false, falhas: [{ codigo: 'ENCODING_NAO_REVERSIVEL', detalhe: 'O original não pode ser decodificado sem perda de bytes.' }] };
  const eol = _quebraDeLinha(texto);

  const faixas = [];
  alteracoes.forEach((a, i) => {
    const motivo = _validarAlteracao(a);
    if (motivo) return falhar(motivo, i, 'Alteração vazia, sem efeito, incompleta ou com marcadores internos.');
    const variantes = eol === 'misto' ? [a.original, a.original.replace(/\n/g, '\r\n')]
      : [eol === '\r\n' ? a.original.replace(/\n/g, '\r\n') : a.original];
    const unicas = [...new Set(variantes)];
    const achados = unicas.flatMap(v => _ocorrencias(texto, v).map(ini => ({ ini, fim: ini + v.length, crlf: v.includes('\r\n') })));
    if (!achados.length) return falhar('ANCORA_AUSENTE', i, 'Trecho original não encontrado exatamente no arquivo.');
    if (achados.length > 1) return falhar('ANCORA_DUPLICADA', i, `Trecho original encontrado ${achados.length} vezes; a posição não é inequívoca.`);
    const { ini, fim } = achados[0];
    // Em âncora de uma linha, segue a quebra da própria linha do arquivo.
    const quebra = achados[0].crlf || (eol === '\r\n') || (eol === 'misto' && texto.slice(fim, fim + 2) === '\r\n') ? '\r\n' : '\n';
    const substituto = a.substituto.replace(/\n/g, quebra);
    if (enc === 'latin1' && /[^\u0000-ÿ]/.test(substituto)) {
      return falhar('CARACTERE_NAO_REPRESENTAVEL', i, 'O substituto tem caracteres que não existem na codificação do original.');
    }
    faixas.push({ ini, fim, substituto, indice: i, linha: texto.slice(0, ini).split('\n').length, justificativa: a.justificativa || null });
  });

  faixas.sort((x, y) => x.ini - y.ini);
  for (let k = 1; k < faixas.length; k++) {
    if (faixas[k].ini < faixas[k - 1].fim) falhar('ALTERACOES_CONFLITANTES', faixas[k].indice, `Sobrepõe a alteração ${faixas[k - 1].indice + 1}.`);
  }
  if (falhas.length) return { ok: false, falhas };

  let resultado = '';
  let cursor = 0;
  for (const f of faixas) {
    resultado += texto.slice(cursor, f.ini) + f.substituto;
    cursor = f.fim;
  }
  resultado += texto.slice(cursor);
  const bufferCorrigido = Buffer.from(resultado, enc);

  // Conferência final: tudo fora das faixas alteradas continua byte a byte.
  let pos = 0;
  let deslocamento = 0;
  for (const f of faixas) {
    const antes = Buffer.from(texto.slice(pos, f.ini), enc);
    const inicioNoResultado = Buffer.byteLength(texto.slice(0, f.ini), enc) + deslocamento;
    if (!bufferCorrigido.subarray(inicioNoResultado - antes.length, inicioNoResultado).equals(antes)) {
      return { ok: false, falhas: [{ codigo: 'PRESERVACAO_FALHOU', detalhe: 'Conferência byte a byte das partes não alteradas falhou.' }] };
    }
    deslocamento += Buffer.byteLength(f.substituto, enc) - Buffer.byteLength(texto.slice(f.ini, f.fim), enc);
    pos = f.fim;
  }
  if (!bufferCorrigido.subarray(bufferCorrigido.length - Buffer.byteLength(texto.slice(pos), enc)).equals(Buffer.from(texto.slice(pos), enc))) {
    return { ok: false, falhas: [{ codigo: 'PRESERVACAO_FALHOU', detalhe: 'Conferência do final do arquivo falhou.' }] };
  }

  return {
    ok: true,
    buffer: bufferCorrigido,
    texto: resultado,
    quebraDeLinha: eol === '\r\n' ? 'CRLF' : eol === '\n' ? 'LF' : 'misto',
    aplicadas: faixas.map(f => ({ alteracao: f.indice + 1, linha: f.linha, justificativa: f.justificativa })),
  };
}

module.exports = { extrairAlteracoes, aplicarAlteracoes, MAX_ALTERACOES };

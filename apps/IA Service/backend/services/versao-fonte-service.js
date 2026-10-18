// Versionamento de fonte (seção 9/10 do prompt da Etapa 2): o arquivo
// original nunca é sobrescrito. Uma correção gerada pela IA cria uma nova
// linha em `anexos`, salva em disco como um novo arquivo, referenciando o
// original via anexo_original_id.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const anexoRepo = require('../repositories/anexo-repository');
const armazenamento = require('./armazenamento-anexos');

function _nomeCorrigido(nomeOriginal) {
  const ext = path.extname(nomeOriginal || '');
  const base = ext ? String(nomeOriginal).slice(0, -ext.length) : String(nomeOriginal || 'fonte');
  return `${base} (corrigido)${ext || '.txt'}`;
}

function validarConteudoCorrigido(conteudoCorrigido, { respostaTruncada = false } = {}) {
  const texto = String(conteudoCorrigido || '');
  const trimmed = texto.trim();
  if (respostaTruncada) {
    return { ok: false, motivo: 'A resposta da IA foi truncada; o fonte corrigido pode estar incompleto.' };
  }
  if (!trimmed) {
    return { ok: false, motivo: 'A secao Fonte corrigido esta vazia.' };
  }
  if (trimmed.length < 8) {
    return { ok: false, motivo: 'A secao Fonte corrigido e curta demais para ser entregue como arquivo.' };
  }
  if (/resposta cortada|conte[uú]do truncado|continua(?:r)?$/i.test(trimmed)
    || /\b(?:restante|resto)\b[^\n]{0,40}\b(?:c[oó]digo|fonte|fun[cç](?:[aã]o|[oõ]es))\b[^\n]{0,30}\b(?:permanece\w*|continua\w*|inalterad\w*|igual|sem altera[cç][aã]o)/i.test(trimmed)) {
    return { ok: false, motivo: 'Ha indicios de que o fonte corrigido nao esta completo.' };
  }
  return { ok: true, motivo: null };
}

/**
 * Cria uma nova versão corrigida de um anexo de código já existente. O
 * conteúdo corrigido é gravado em disco como um novo arquivo (mesmo diretório
 * do atendimento), e os metadados apontam para o original — nunca sobrescreve
 * o arquivo físico nem a linha original em `anexos`.
 */
function criarVersaoCorrigida(empresaId, { anexoOriginalId, atendimentoId, mensagemOrigemId, conteudoCorrigido, conteudoBuffer = null, explicacaoAlteracao, usuarioId }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const original = anexoRepo.getAnexo(empresaId, anexoOriginalId);
  if (!original) throw new Error('Anexo original não encontrado nesta empresa.');
  if (!original.eCodigo) throw new Error('Só é possível versionar anexos identificados como código.');
  if (String(original.atendimentoId) !== String(atendimentoId)) throw new Error('Anexo original não pertence a este atendimento.');

  // Com conteudoBuffer (alterações ancoradas), os bytes já estão na
  // codificação e nas quebras de linha do original e são gravados como estão.
  const encodingOriginal = original.encodingDetectado === 'latin1' ? 'latin1' : 'utf-8';
  const bytes = Buffer.isBuffer(conteudoBuffer) ? conteudoBuffer : Buffer.from(String(conteudoCorrigido ?? ''), 'utf8');
  const texto = Buffer.isBuffer(conteudoBuffer) ? conteudoBuffer.toString(encodingOriginal === 'latin1' ? 'latin1' : 'utf8') : conteudoCorrigido;
  const validacao = validarConteudoCorrigido(texto);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const nomeInterno = `${crypto.randomUUID()}${path.extname(original.nomeOriginal) || '.txt'}`;
  const dirEmpresaAtendimento = path.join(armazenamento.ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dirEmpresaAtendimento, { recursive: true });

  const caminhoAbsoluto = path.join(dirEmpresaAtendimento, nomeInterno);
  fs.writeFileSync(caminhoAbsoluto, bytes);
  const caminhoRelativo = path.relative(armazenamento.ANEXOS_DIR, caminhoAbsoluto).split(path.sep).join('/');

  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal: _nomeCorrigido(original.nomeOriginal),
    nomeInterno,
    mimeType: original.mimeType,
    tamanho: bytes.length,
    caminhoRelativo,
    usuarioId,
    conteudoExtraido: texto,
    linguagemDetectada: original.linguagemDetectada,
    encodingDetectado: Buffer.isBuffer(conteudoBuffer) ? encodingOriginal : 'utf-8',
    eCodigo: true,
    anexoOriginalId: original.anexoOriginalId || original.id, // sempre aponta pra versão 1
    mensagemOrigemId,
    explicacaoAlteracao,
  });
}

function listarVersoes(empresaId, anexoOriginalId) {
  return anexoRepo.listarVersoes(empresaId, anexoOriginalId);
}

/**
 * Diff linha-a-linha simples (LCS clássico), suficiente para o critério do
 * prompt ("destacar linhas adicionadas/removidas/modificadas" sem exigir um
 * editor visual avançado — seção 10: "não bloquear a entrega por um DIFF
 * visual avançado aumentar a complexidade").
 */
function calcularDiff(textoOriginal, textoCorrigido) {
  const todasA = String(textoOriginal || '').split('\n');
  const todasB = String(textoCorrigido || '').split('\n');
  // Fontes grandes com poucas alterações: prefixo e sufixo comuns saem do
  // LCS, que fica restrito ao miolo alterado.
  let ini = 0;
  while (ini < todasA.length && ini < todasB.length && todasA[ini] === todasB[ini]) ini++;
  let fimA = todasA.length, fimB = todasB.length;
  while (fimA > ini && fimB > ini && todasA[fimA - 1] === todasB[fimB - 1]) { fimA--; fimB--; }
  const prefixo = todasA.slice(0, ini).map(texto => ({ tipo: 'igual', texto }));
  const sufixo = todasA.slice(fimA).map(texto => ({ tipo: 'igual', texto }));
  const a = todasA.slice(ini, fimA);
  const b = todasB.slice(ini, fimB);
  const n = a.length, m = b.length;
  // Teto de memória: miolo grande demais vira bloco removido/adicionado.
  if (n * m > 4000000) {
    return [...prefixo, ...a.map(texto => ({ tipo: 'removida', texto })), ...b.map(texto => ({ tipo: 'adicionada', texto })), ...sufixo];
  }

  // Tabela de LCS (programação dinâmica) — O(n*m) somente sobre o miolo.
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const linhas = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      linhas.push({ tipo: 'igual', texto: a[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      linhas.push({ tipo: 'removida', texto: a[i] });
      i++;
    } else {
      linhas.push({ tipo: 'adicionada', texto: b[j] });
      j++;
    }
  }
  while (i < n) { linhas.push({ tipo: 'removida', texto: a[i] }); i++; }
  while (j < m) { linhas.push({ tipo: 'adicionada', texto: b[j] }); j++; }

  return [...prefixo, ...linhas, ...sufixo];
}

module.exports = { criarVersaoCorrigida, listarVersoes, calcularDiff, validarConteudoCorrigido };

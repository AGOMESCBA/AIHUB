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
  if (/resposta cortada|conte[uú]do truncado|continua(?:r)?$/i.test(trimmed)) {
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
function criarVersaoCorrigida(empresaId, { anexoOriginalId, atendimentoId, mensagemOrigemId, conteudoCorrigido, explicacaoAlteracao, usuarioId }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const original = anexoRepo.getAnexo(empresaId, anexoOriginalId);
  if (!original) throw new Error('Anexo original não encontrado nesta empresa.');
  if (!original.eCodigo) throw new Error('Só é possível versionar anexos identificados como código.');
  if (String(original.atendimentoId) !== String(atendimentoId)) throw new Error('Anexo original não pertence a este atendimento.');

  const validacao = validarConteudoCorrigido(conteudoCorrigido);
  if (!validacao.ok) throw new Error(validacao.motivo);

  const nomeInterno = `${crypto.randomUUID()}${path.extname(original.nomeOriginal) || '.txt'}`;
  const dirEmpresaAtendimento = path.join(armazenamento.ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dirEmpresaAtendimento, { recursive: true });

  const caminhoAbsoluto = path.join(dirEmpresaAtendimento, nomeInterno);
  fs.writeFileSync(caminhoAbsoluto, conteudoCorrigido, 'utf8');
  const caminhoRelativo = path.relative(armazenamento.ANEXOS_DIR, caminhoAbsoluto).split(path.sep).join('/');

  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal: _nomeCorrigido(original.nomeOriginal),
    nomeInterno,
    mimeType: original.mimeType,
    tamanho: Buffer.byteLength(conteudoCorrigido, 'utf8'),
    caminhoRelativo,
    usuarioId,
    conteudoExtraido: conteudoCorrigido,
    linguagemDetectada: original.linguagemDetectada,
    encodingDetectado: 'utf-8',
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
  const a = String(textoOriginal || '').split('\n');
  const b = String(textoCorrigido || '').split('\n');
  const n = a.length, m = b.length;

  // Tabela de LCS (programação dinâmica) — O(n*m), aceitável para arquivos de
  // customização (tipicamente algumas centenas de linhas, não milhões).
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

  return linhas;
}

module.exports = { criarVersaoCorrigida, listarVersoes, calcularDiff, validarConteudoCorrigido };

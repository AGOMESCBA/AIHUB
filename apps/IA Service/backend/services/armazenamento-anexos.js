// Fundacao de armazenamento de anexos (Etapa 1 — só metadados/estrutura de disco;
// a UX completa de upload/drag&drop/preview fica para a Etapa 2, conforme
// escopo definido no prompt).
//
// Binario NUNCA vai para o SQLite — fica em disco, em
// apps/IA Service/data/anexos/<empresa_id>/<atendimento_id>/<nome_interno>.
// O nome enviado pelo cliente nunca é usado como nome de arquivo em disco —
// sempre um UUID gerado no servidor, eliminando risco de path traversal.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const anexoRepo = require('../repositories/anexo-repository');

const ANEXOS_DIR = path.join(__dirname, '..', '..', 'data', 'anexos');

// Allowlist inicial — "todos os formatos úteis ao atendimento técnico", mas
// nunca formatos executáveis (seção 13 do prompt). Extensível sem migration
// (é só uma constante em código), então não é uma limitação estrutural.
const MIME_PERMITIDOS = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/json',
  'application/xml', 'text/xml',
  'application/octet-stream', // .log e .prw/.tlpp costumam chegar como octet-stream
]);

const EXTENSOES_PROIBIDAS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.com', '.scr', '.vbs', '.js', '.jar', '.dll',
]);

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024; // 20 MB — configurável, ver seção 13 do prompt

function _extensaoSegura(nomeOriginal) {
  const ext = path.extname(String(nomeOriginal || '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

function validarAnexo({ nomeOriginal, mimeType, tamanho }) {
  const ext = _extensaoSegura(nomeOriginal);
  if (EXTENSOES_PROIBIDAS.has(ext)) {
    return { ok: false, erro: `Extensão não permitida: ${ext}` };
  }
  if (!MIME_PERMITIDOS.has(mimeType)) {
    return { ok: false, erro: `Tipo de arquivo não permitido: ${mimeType}` };
  }
  if (!tamanho || tamanho <= 0) {
    return { ok: false, erro: 'Arquivo vazio.' };
  }
  if (tamanho > TAMANHO_MAXIMO_BYTES) {
    return { ok: false, erro: `Arquivo excede o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024}MB.` };
  }
  return { ok: true, extensao: ext };
}

/**
 * Persiste o binário em disco (fora do SQLite) e grava os metadados via
 * anexo-repository. `bufferOuConteudo` é o conteúdo bruto do arquivo — a Etapa 2
 * decide o transporte real (multipart/base64/etc.), esta função só recebe bytes.
 */
function salvarAnexo(empresaId, atendimentoId, { nomeOriginal, mimeType, tamanho, conteudo, mensagemId, usuarioId }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const validacao = validarAnexo({ nomeOriginal, mimeType, tamanho });
  if (!validacao.ok) throw new Error(validacao.erro);

  const nomeInterno = `${crypto.randomUUID()}${validacao.extensao}`;
  const dirEmpresaAtendimento = path.join(ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dirEmpresaAtendimento, { recursive: true });

  const caminhoAbsoluto = path.join(dirEmpresaAtendimento, nomeInterno);
  fs.writeFileSync(caminhoAbsoluto, conteudo);

  const caminhoRelativo = path.relative(ANEXOS_DIR, caminhoAbsoluto).split(path.sep).join('/');

  return anexoRepo.salvarMetadadosAnexo(empresaId, atendimentoId, {
    nomeOriginal,
    nomeInterno,
    mimeType,
    tamanho,
    caminhoRelativo,
    mensagemId,
    usuarioId,
  });
}

module.exports = {
  ANEXOS_DIR,
  MIME_PERMITIDOS,
  EXTENSOES_PROIBIDAS,
  TAMANHO_MAXIMO_BYTES,
  validarAnexo,
  salvarAnexo,
};

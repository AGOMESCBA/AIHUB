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
function salvarAnexo(empresaId, atendimentoId, {
  nomeOriginal,
  mimeType,
  tamanho,
  conteudo,
  mensagemId,
  usuarioId,
  origemSistema,
  origemOid,
  origemTipo,
  origemReferenciaOid,
}) {
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
    origemSistema,
    origemOid,
    origemTipo,
    origemReferenciaOid,
  });
}

function substituirArquivoAnexo(empresaId, atendimentoId, anexoExistente, {
  nomeOriginal,
  mimeType,
  tamanho,
  conteudo,
  conteudoExtraido,
  linguagemDetectada,
  encodingDetectado,
  eCodigo,
}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!anexoExistente?.id) throw new Error('anexoExistente é obrigatório.');

  const validacao = validarAnexo({ nomeOriginal, mimeType, tamanho });
  if (!validacao.ok) throw new Error(validacao.erro);

  const nomeInterno = `${crypto.randomUUID()}${validacao.extensao}`;
  const dirEmpresaAtendimento = path.join(ANEXOS_DIR, String(empresaId), String(atendimentoId));
  fs.mkdirSync(dirEmpresaAtendimento, { recursive: true });

  const caminhoAbsoluto = path.join(dirEmpresaAtendimento, nomeInterno);
  fs.writeFileSync(caminhoAbsoluto, conteudo);

  const caminhoRelativo = path.relative(ANEXOS_DIR, caminhoAbsoluto).split(path.sep).join('/');

  const atualizado = anexoRepo.atualizarArquivoSincronizado(empresaId, anexoExistente.id, {
    nomeOriginal,
    nomeInterno,
    mimeType,
    tamanho,
    caminhoRelativo,
    conteudoExtraido,
    linguagemDetectada,
    encodingDetectado,
    eCodigo,
  });

  const caminhoAntigo = anexoExistente.caminhoRelativo
    ? path.join(ANEXOS_DIR, anexoExistente.caminhoRelativo)
    : null;
  if (caminhoAntigo && caminhoAntigo !== caminhoAbsoluto) {
    try { fs.unlinkSync(caminhoAntigo); } catch (_) {}
  }

  return atualizado;
}

function removerDiretorioAtendimento(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');

  const dirEmpresa = path.resolve(ANEXOS_DIR, String(empresaId));
  const dirEmpresaAtendimento = path.resolve(dirEmpresa, String(atendimentoId));
  if (!dirEmpresaAtendimento.startsWith(`${dirEmpresa}${path.sep}`)) {
    throw new Error('Diretório de anexos inválido para remoção.');
  }
  if (!fs.existsSync(dirEmpresaAtendimento)) return false;
  fs.rmSync(dirEmpresaAtendimento, { recursive: true, force: true });
  return true;
}

/**
 * Varredura por exclusão: apaga QUALQUER subpasta de
 * data/anexos/<empresaId>/ cujo nome (= atendimentoId) não está mais em
 * `atendimentoIdsValidos` — usada depois de "reimportar do zero"/excluir
 * fonte para garantir zero resquício físico, sem depender de uma lista
 * de IDs previamente capturada por JOIN (que exige acertar toda consulta
 * de captura; aqui não sobra margem para erro: o que não existe mais no
 * banco, não pode continuar em disco). Decisão explícita do usuário:
 * "reimportar do zero é sumir com o que tem" — nenhum anexo de execução
 * anterior pode sobreviver à limpeza, nem os que já eram órfãos antes dela.
 *
 * Assíncrona (fs.promises) de propósito — achado real em produção (2026-10):
 * a versão síncrona original (fs.readdirSync/rmSync) bloqueava o event loop
 * inteiro do Node durante a varredura, travando TODAS as rotas do servidor
 * (não só esta) até terminar. Com milhares de diretórios/arquivos acumulados
 * ou disco mais lento que o ambiente de teste local, isso trava o processo
 * de forma indistinguível de um deadlock — só reiniciar o serviço "resolvia"
 * até a próxima execução da mesma rotina.
 */
async function limparDiretoriosOrfaos(empresaId, atendimentoIdsValidos) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const dirEmpresa = path.resolve(ANEXOS_DIR, String(empresaId));
  if (!(await fs.promises.access(dirEmpresa).then(() => true, () => false))) return { removidos: 0 };

  const validos = new Set(atendimentoIdsValidos || []);
  const nomes = await fs.promises.readdir(dirEmpresa);
  let removidos = 0;
  for (const nome of nomes) {
    if (validos.has(nome)) continue;
    const alvo = path.resolve(dirEmpresa, nome);
    if (!alvo.startsWith(`${dirEmpresa}${path.sep}`)) continue; // nunca deveria acontecer (nome vem do próprio readdir), defesa extra
    try {
      await fs.promises.rm(alvo, { recursive: true, force: true });
      removidos += 1;
    } catch (_) {}
  }
  return { removidos };
}

module.exports = {
  ANEXOS_DIR,
  MIME_PERMITIDOS,
  EXTENSOES_PROIBIDAS,
  TAMANHO_MAXIMO_BYTES,
  validarAnexo,
  salvarAnexo,
  substituirArquivoAnexo,
  removerDiretorioAtendimento,
  limparDiretoriosOrfaos,
};

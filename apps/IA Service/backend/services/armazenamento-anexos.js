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
  // Word e Excel modernos (2026-10-21): texto extraído em extracao-conteudo.js.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Executáveis e binários continuam proibidos. Scripts textuais (.js, .sh,
// .ps1) são aceitos como fonte: o IA Service nunca executa nem compila anexos.
const EXTENSOES_PROIBIDAS = new Set([
  '.exe', '.bat', '.cmd', '.msi', '.com', '.scr', '.vbs', '.jar', '.dll',
]);

// Fontes textuais: aceitas pela extensão, com conteúdo obrigatoriamente
// textual, e sempre gravadas/servidas como text/plain. O MIME declarado pelo
// navegador varia por sistema (.ts chega como video/mp2t no Windows) e não
// decide o tratamento.
const FONTES_TEXTUAIS = new Set([
  '.prw', '.tlpp', '.ch',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.cs', '.java', '.php',
  '.html', '.css', '.vue',
  '.go', '.rb', '.kt',
  '.sql', '.sh', '.ps1',
]);

function ehFonteTextual(nomeOriginal) {
  return FONTES_TEXTUAIS.has(_extensaoSegura(nomeOriginal));
}

// Caminho físico de um anexo, sempre dentro de ANEXOS_DIR.
function resolverCaminhoSeguro(caminhoRelativo) {
  const base = path.resolve(ANEXOS_DIR);
  const destino = path.resolve(base, String(caminhoRelativo || ''));
  if (destino === base || !destino.startsWith(base + path.sep)) throw new Error('Caminho de anexo invalido.');
  return destino;
}

// Bytes nulos ou assinatura de formato binário conhecido (PE/ELF/ZIP/PDF/
// imagens) indicam conteúdo que não é fonte textual.
function _pareceBinario(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const inicio = buffer.subarray(0, 8);
  const assinaturas = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x50, 0x4b, 0x03, 0x04], [0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0xca, 0xfe, 0xba, 0xbe]];
  if (assinaturas.some(a => a.every((b, i) => inicio[i] === b))) return true;
  return buffer.includes(0x00);
}

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024; // 20 MB — configurável, ver seção 13 do prompt

function _extensaoSegura(nomeOriginal) {
  const ext = path.extname(String(nomeOriginal || '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

// Bloqueio anterior à política de fontes textuais. Continua valendo para quem
// não a ativa explicitamente (ex.: anexo de retorno ao SoftExpert).
const EXTENSOES_PROIBIDAS_SEM_FONTES = new Set([...EXTENSOES_PROIBIDAS, '.js', '.sh', '.ps1']);

function validarAnexo({ nomeOriginal, mimeType, tamanho, conteudo, aceitarFontesTextuais = false }) {
  const ext = _extensaoSegura(nomeOriginal);
  if ((aceitarFontesTextuais ? EXTENSOES_PROIBIDAS : EXTENSOES_PROIBIDAS_SEM_FONTES).has(ext)) {
    return { ok: false, erro: `Extensão não permitida: ${ext}` };
  }
  const fonteTextual = aceitarFontesTextuais && FONTES_TEXTUAIS.has(ext);
  if (fonteTextual && _pareceBinario(conteudo)) {
    return { ok: false, erro: `Conteúdo binário não permitido como fonte textual (${ext}).` };
  }
  if (!fonteTextual && !MIME_PERMITIDOS.has(mimeType)) {
    return { ok: false, erro: `Tipo de arquivo não permitido: ${mimeType}` };
  }
  if (!tamanho || tamanho <= 0) {
    return { ok: false, erro: 'Arquivo vazio.' };
  }
  if (tamanho > TAMANHO_MAXIMO_BYTES) {
    return { ok: false, erro: `Arquivo excede o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024}MB.` };
  }
  return { ok: true, extensao: ext, mimeType: fonteTextual ? 'text/plain' : mimeType };
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

  const validacao = validarAnexo({ nomeOriginal, mimeType, tamanho, conteudo, aceitarFontesTextuais: true });
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
    mimeType: validacao.mimeType,
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

  const validacao = validarAnexo({ nomeOriginal, mimeType, tamanho, conteudo, aceitarFontesTextuais: true });
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
    mimeType: validacao.mimeType,
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
  FONTES_TEXTUAIS,
  TAMANHO_MAXIMO_BYTES,
  ehFonteTextual,
  resolverCaminhoSeguro,
  validarAnexo,
  salvarAnexo,
  substituirArquivoAnexo,
  removerDiretorioAtendimento,
  limparDiretoriosOrfaos,
};

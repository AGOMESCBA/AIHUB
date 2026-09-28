// Extração de conteúdo de anexos (Etapa 2, seção 4/5 do prompt): não confiar
// apenas na extensão do arquivo — detectar MIME real, extrair texto quando
// aplicável, detectar linguagem/formato de código, e o encoding do texto.
//
// Escopo desta etapa: heurísticas leves, sem dependências novas de parsing
// pesado (nenhum parser de AST, nenhuma lib de detecção de linguagem por ML).
// Suficiente para alimentar o prompt da IA com contexto estruturado; a IA
// (não este módulo) faz a análise semântica do código.

const path = require('path');

// MIME types tratados como "texto legível" — seu conteúdo é extraído como
// string e enviado para a IA. Imagens e PDFs seguem caminhos diferentes
// (visão multimodal / extração de texto de PDF, ver seção "PDF" abaixo).
const MIME_TEXTO = new Set([
  'text/plain', 'text/csv', 'application/json', 'application/xml', 'text/xml',
  'application/octet-stream', // .log, .prw, .tlpp, .sql costumam chegar assim
]);

const MIME_IMAGEM = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Extensão → linguagem/formato, para os casos em que o MIME sozinho não diz
// nada (ex.: .prw e .sql chegam como application/octet-stream ou text/plain).
const LINGUAGEM_POR_EXTENSAO = {
  '.prw': 'advpl', '.tlpp': 'tlpp', '.ch': 'advpl-header',
  '.sql': 'sql', '.json': 'json', '.xml': 'xml', '.log': 'log',
  '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.java': 'java',
  '.cs': 'csharp', '.php': 'php', '.html': 'html', '.css': 'css',
  '.sh': 'shell', '.ps1': 'powershell', '.yml': 'yaml', '.yaml': 'yaml',
  '.ini': 'ini', '.cfg': 'config', '.conf': 'config', '.csv': 'csv',
  '.txt': null, // .txt é ambíguo por natureza — decidido por conteúdo, ver _detectarPorConteudo
};

// Extensões/linguagens tratadas como "código" para fins de e_codigo (seção 5
// do prompt: "um TXT poderá conter código, log, SQL, XML ou configuração").
const LINGUAGENS_CODIGO = new Set([
  'advpl', 'tlpp', 'advpl-header', 'sql', 'javascript', 'typescript', 'python',
  'java', 'csharp', 'php', 'shell', 'powershell',
]);

function _detectarEncoding(buffer) {
  // Heurística simples: se o buffer é UTF-8 válido, assume utf-8. Caso
  // contrário, assume latin1 (windows-1252/ISO-8859-1) — cobre a esmagadora
  // maioria dos arquivos de log/fonte gerados por ferramentas Windows/Protheus.
  try {
    const decodedUtf8 = buffer.toString('utf8');
    const reencoded = Buffer.from(decodedUtf8, 'utf8');
    if (reencoded.equals(buffer)) return 'utf-8';
  } catch (_) { /* cai no fallback */ }
  return 'latin1';
}

// Assinaturas (magic numbers) mínimas para confirmar o tipo real do arquivo,
// independente do MIME declarado pelo cliente (nunca confiável sozinho).
function _detectarMimeReal(buffer, mimeDeclarado, nomeOriginal) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') {
    return 'application/pdf';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6) === 'GIF89a') {
    return 'image/gif';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // Sem assinatura binária reconhecida: NUNCA confiar no MIME declarado pelo
  // cliente quando ele afirma ser um formato binário com assinatura conhecida
  // (imagem/PDF) — se a assinatura não bate, o dado não é o que foi
  // declarado. Cai para texto puro, que é o tratamento mais seguro (extração
  // de texto não executa nada, só lê como string).
  const declaraBinarioComAssinatura = MIME_IMAGEM.has(mimeDeclarado) || mimeDeclarado === 'application/pdf' || mimeDeclarado === 'image/gif' || mimeDeclarado === 'image/webp';
  if (declaraBinarioComAssinatura) return 'text/plain';

  return mimeDeclarado || 'text/plain';
}

function _detectarLinguagemPorConteudo(texto) {
  const amostra = texto.slice(0, 2000);
  if (/^\s*(select|insert|update|delete|create\s+table|alter\s+table)\b/i.test(amostra)) return 'sql';
  if (/^\s*[\{\[]/.test(amostra.trim())) {
    try { JSON.parse(texto); return 'json'; } catch (_) { /* não é JSON válido, segue tentando outros formatos */ }
  }
  if (/^\s*<\?xml|^\s*<[a-zA-Z]/.test(amostra)) return 'xml';
  if (/\bFUNCTION\b|\bSTATIC\s+FUNCTION\b|::New\(\)/i.test(amostra)) return 'advpl';
  if (/^\s*\[\d{4}-\d{2}-\d{2}|^\s*\d{2}\/\d{2}\/\d{4}.*ERROR|EXCEPTION/im.test(amostra)) return 'log';
  return null;
}

/**
 * Extrai o conteúdo de um anexo já salvo em disco. Retorna metadados prontos
 * para gravar via anexoRepo.atualizarExtracao — não decide se o anexo "faz
 * parte da análise", isso é responsabilidade do service de investigação.
 */
function extrairConteudo({ buffer, nomeOriginal, mimeDeclarado }) {
  const mimeReal = _detectarMimeReal(buffer, mimeDeclarado, nomeOriginal);
  const ext = path.extname(nomeOriginal || '').toLowerCase();

  if (MIME_IMAGEM.has(mimeReal)) {
    return { mimeReal, ehTexto: false, ehImagem: true, conteudoExtraido: null, linguagemDetectada: null, encodingDetectado: null, eCodigo: false };
  }

  if (mimeReal === 'application/pdf') {
    // Extração de texto de PDF fica fora do escopo desta etapa (exigiria lib
    // de parsing de PDF, dependência nova não avaliada) — o PDF é preservado
    // como anexo e citado no contexto, mas seu conteúdo textual não é extraído
    // automaticamente. Documentado como pendência conhecida.
    return { mimeReal, ehTexto: false, ehImagem: false, conteudoExtraido: null, linguagemDetectada: null, encodingDetectado: null, eCodigo: false };
  }

  // Texto: decodifica, detecta linguagem por extensão OU conteúdo (nunca só
  // pela extensão isolada — seção 5 do prompt).
  const encoding = _detectarEncoding(buffer);
  const conteudo = buffer.toString(encoding === 'utf-8' ? 'utf8' : 'latin1');

  let linguagem = LINGUAGEM_POR_EXTENSAO[ext];
  if (linguagem === undefined) linguagem = null; // extensão não mapeada
  if (!linguagem) linguagem = _detectarLinguagemPorConteudo(conteudo);

  const eCodigo = linguagem ? LINGUAGENS_CODIGO.has(linguagem) || linguagem === 'json' || linguagem === 'xml' : false;

  return {
    mimeReal,
    ehTexto: true,
    ehImagem: false,
    conteudoExtraido: conteudo,
    linguagemDetectada: linguagem,
    encodingDetectado: encoding,
    eCodigo,
  };
}

module.exports = { extrairConteudo, MIME_TEXTO, MIME_IMAGEM, LINGUAGENS_CODIGO };

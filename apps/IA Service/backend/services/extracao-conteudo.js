// Extração de conteúdo de anexos (Etapa 2, seção 4/5 do prompt): não confiar
// apenas na extensão do arquivo — detectar MIME real, extrair texto quando
// aplicável, detectar linguagem/formato de código, e o encoding do texto.
//
// Escopo desta etapa: heurísticas leves, sem dependências novas de parsing
// pesado (nenhum parser de AST, nenhuma lib de detecção de linguagem por ML).
// Suficiente para alimentar o prompt da IA com contexto estruturado; a IA
// (não este módulo) faz a análise semântica do código.

const path = require('path');
const pdfParse = require('pdf-parse');
const { ehFonteTextual } = require('./armazenamento-anexos');

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
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.java': 'java',
  '.cs': 'csharp', '.php': 'php', '.html': 'html', '.css': 'css', '.vue': 'vue',
  '.go': 'go', '.rb': 'ruby', '.kt': 'kotlin',
  '.sh': 'shell', '.ps1': 'powershell', '.yml': 'yaml', '.yaml': 'yaml',
  '.ini': 'ini', '.cfg': 'config', '.conf': 'config', '.csv': 'csv',
  '.txt': null, // .txt é ambíguo por natureza — decidido por conteúdo, ver _detectarPorConteudo
};

// Extensões/linguagens tratadas como "código" para fins de e_codigo (seção 5
// do prompt: "um TXT poderá conter código, log, SQL, XML ou configuração").
const LINGUAGENS_CODIGO = new Set([
  'advpl', 'tlpp', 'advpl-header', 'sql', 'javascript', 'typescript', 'python',
  'java', 'csharp', 'php', 'shell', 'powershell',
  'html', 'css', 'vue', 'go', 'ruby', 'kotlin',
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
  // Fonte textual: o MIME do navegador/Windows não decide (ex.: .ts como
  // video/mp2t, .js como text/javascript). Sempre tratado como texto puro.
  if (ehFonteTextual(nomeOriginal)) return 'text/plain';

  return mimeDeclarado || 'text/plain';
}

function _detectarLinguagemPorConteudo(texto) {
  const amostra = texto.slice(0, 2000);
  if (/^\s*(select|insert|update|delete|create\s+table|alter\s+table)\b/i.test(amostra)) return 'sql';
  if (/^\s*[\{\[]/.test(amostra.trim())) {
    try { JSON.parse(texto); return 'json'; } catch (_) { /* não é JSON válido, segue tentando outros formatos */ }
  }
  if (/^\s*<\?xml|^\s*<[a-zA-Z]/.test(amostra)) return 'xml';
  // Log com carimbo de data/hora vem antes das linguagens: "=>" ou "function"
  // dentro de uma linha de log não fazem dele um fonte.
  if (/^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|^\s*\d{2}\/\d{2}\/\d{4}.*\b(?:ERROR|WARN)|^\s*THREAD ERROR\b/im.test(amostra)) return 'log';
  // TXT e extensões desconhecidas também passam por conteúdo. "function"
  // isolado não distingue JavaScript de ADVPL, e "=>" sozinho não prova JS.
  if (/^\s*(?:(?:export|default|async)\s+)*function\s+\w*\s*\([^)]*\)\s*\{|^\s*(?:const|let|var)\s+\w+\s*=|^\s*(?:import\s.+\sfrom\s|module\.exports\s*=|export\s+(?:default|const|function|class)\b)/m.test(amostra)) return 'javascript';
  if (/^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:/m.test(amostra)) return 'python';
  if (/\bFUNCTION\b|\bSTATIC\s+FUNCTION\b|::New\(\)/i.test(amostra)) return 'advpl';
  if (/^\s*\[\d{4}-\d{2}-\d{2}|^\s*\d{2}\/\d{2}\/\d{4}.*ERROR|EXCEPTION/im.test(amostra)) return 'log';
  return null;
}

/**
 * Extrai o conteúdo de um anexo já salvo em disco. Retorna metadados prontos
 * para gravar via anexoRepo.atualizarExtracao — não decide se o anexo "faz
 * parte da análise", isso é responsabilidade do service de investigação.
 */
function _limitarExtracaoPersistida(texto, max = 250000) {
  const s = String(texto || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[...conteudo textual extraido truncado para persistencia; arquivo original preservado em disco...]`;
}

function _extrairTextoPdfBruto(buffer) {
  const bruto = buffer.toString('latin1');
  const trechos = [];
  const reStream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  while ((streamMatch = reStream.exec(bruto))) {
    const conteudo = streamMatch[1];
    const reTexto = /\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g;
    let textoMatch;
    while ((textoMatch = reTexto.exec(conteudo))) {
      trechos.push(textoMatch[1]
        .replace(/\\([\\()])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t'));
    }
  }
  const texto = trechos.join('\n').replace(/[^\x09\x0a\x0d\x20-\x7eÀ-ÿ]/g, ' ').replace(/\s+/g, ' ').trim();
  const imprimiveis = texto.replace(/[^\x20-\x7eÀ-ÿ]/g, '').length;
  const ratio = texto.length ? imprimiveis / texto.length : 0;
  if (texto.length < 30 || ratio < 0.85) return '';
  return _limitarExtracaoPersistida(texto);
}

async function _extrairPdf(buffer) {
  let data;
  try {
    data = await pdfParse(buffer);
  } catch (err) {
    const textoBruto = _extrairTextoPdfBruto(buffer);
    if (textoBruto) {
      return [
        '[PDF extraido textualmente - fallback bruto]',
        'Observacao: o parser principal nao conseguiu interpretar a estrutura completa do PDF; texto simples foi recuperado de streams nao comprimidos.',
        'Imagens, prints, graficos e diagramas internos do PDF nao foram extraidos nesta etapa; o arquivo original permanece preservado.',
        '',
        textoBruto,
      ].join('\n');
    }
    const detalhe = err?.message ? ` (${err.message})` : '';
    return [
      '[PDF detectado]',
      `Observacao: nao foi possivel extrair texto automaticamente deste PDF${detalhe}.`,
      'Imagens, prints, graficos e diagramas internos do PDF nao foram extraidos nesta etapa; o arquivo original permanece preservado.',
    ].join('\n');
  }
  const texto = _limitarExtracaoPersistida(data.text || '');
  const paginas = data.numpages || data.numrender || null;
  const cabecalho = [
    '[PDF extraido textualmente]',
    paginas ? `Paginas: ${paginas}` : null,
    'Observacao: imagens, prints, graficos e diagramas internos do PDF nao foram extraidos nesta etapa; o arquivo original permanece preservado.',
  ].filter(Boolean).join('\n');
  return texto ? `${cabecalho}\n\n${texto}` : cabecalho;
}

// Word (.docx) e Excel (.xlsx) — pedido do usuário, 2026-10-21 (antes ficavam
// só para download). Sem dependência nova: .docx é um zip com XML (jszip, que
// já vem com o exceljs) e .xlsx é lido pelo exceljs (dependência declarada).
// Formatos antigos (.doc/.xls) e .zip continuam fora.
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_LINHAS_PLANILHA = 3000;

function _ehZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function _decodificarXml(texto) {
  return texto.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

async function _extrairDocx(buffer) {
  try {
    const zip = await require('jszip').loadAsync(buffer);
    const partes = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
    const textos = [];
    for (const nome of partes) {
      const xml = await zip.file(nome).async('string');
      const texto = _decodificarXml(xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>|<\/w:p>/g, '\n')
        .replace(/<\/w:tc>/g, ' | ')
        .replace(/<[^>]+>/g, ''))
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (texto) textos.push(texto);
    }
    const texto = _limitarExtracaoPersistida(textos.join('\n\n'));
    return texto ? `[Word extraido textualmente]\nObservacao: imagens internas do documento nao foram extraidas; o arquivo original permanece preservado.\n\n${texto}` : '';
  } catch (_) {
    return '';
  }
}

async function _extrairXlsx(buffer) {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const linhas = [];
    let total = 0;
    wb.eachSheet((ws) => {
      if (total >= MAX_LINHAS_PLANILHA) return;
      linhas.push(`## Planilha: ${ws.name}`);
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        if (total >= MAX_LINHAS_PLANILHA) return;
        const valores = (row.values || []).slice(1).map(v => (v && typeof v === 'object' ? (v.text ?? v.result ?? v.richText?.map(r => r.text).join('') ?? (v instanceof Date ? v.toISOString().slice(0, 10) : '')) : v ?? '')).map(v => String(v).trim());
        if (valores.some(Boolean)) { linhas.push(`${n}: ${valores.join(' | ')}`); total += 1; }
      });
    });
    if (total >= MAX_LINHAS_PLANILHA) linhas.push(`[...planilha truncada em ${MAX_LINHAS_PLANILHA} linhas; arquivo original preservado...]`);
    const texto = _limitarExtracaoPersistida(linhas.join('\n'));
    return total ? `[Excel extraido textualmente]\n\n${texto}` : '';
  } catch (_) {
    return '';
  }
}

async function extrairConteudo({ buffer, nomeOriginal, mimeDeclarado }) {
  const ext = path.extname(nomeOriginal || '').toLowerCase();
  // Office só pela extensão + assinatura zip (nunca pelo MIME declarado sozinho).
  if (_ehZip(buffer) && (ext === '.docx' || ext === '.xlsx')) {
    const ehDocx = ext === '.docx';
    const conteudoExtraido = ehDocx ? await _extrairDocx(buffer) : await _extrairXlsx(buffer);
    return { mimeReal: ehDocx ? MIME_DOCX : MIME_XLSX, ehTexto: !!conteudoExtraido, ehImagem: false, conteudoExtraido: conteudoExtraido || null, linguagemDetectada: ehDocx ? 'docx' : 'xlsx', encodingDetectado: null, eCodigo: false };
  }
  const mimeReal = _detectarMimeReal(buffer, mimeDeclarado, nomeOriginal);

  if (MIME_IMAGEM.has(mimeReal)) {
    return { mimeReal, ehTexto: false, ehImagem: true, conteudoExtraido: null, linguagemDetectada: null, encodingDetectado: null, eCodigo: false };
  }

  if (mimeReal === 'application/pdf') {
    const conteudoExtraido = await _extrairPdf(buffer);
    return { mimeReal, ehTexto: !!conteudoExtraido, ehImagem: false, conteudoExtraido, linguagemDetectada: 'pdf', encodingDetectado: null, eCodigo: false };
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

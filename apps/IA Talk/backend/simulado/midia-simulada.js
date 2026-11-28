'use strict';

// P1 (docs/contratos.md §10) no servidor simulado: mídia guardada em memória, ver/baixar
// (GET /midias/:id) e anexar na Central (POST /conversas/:id/anexos, corpo binário). O tipo real é
// conferido pela mesma biblioteca do servidor real (lib/midia, G4). Os arquivos de exemplo da semente
// (imagem, PDF e áudio) são gerados aqui, sem arquivos no repositório.

const zlib = require('zlib');
const express = require('express');
const { erro } = require('../erros');

// Mesmas regras do servidor real (tipo pelo conteúdo, 16 MB, tipos aceitos): midias/armazem.js.
const arm = require('../midias/armazem');
const { tipoDoMime, previaDaMidia } = arm;
const ABRE_NO_NAVEGADOR = /^(image\/|audio\/|application\/pdf$)/;
const LEGENDA_MAXIMA = 1024;

// ── Arquivos de exemplo ────────────────────────────────────────────────────────
function png(largura, altura, [r, g, b]) {
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x++) linha.set([r, g, b], 1 + x * 3);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, dados])) >>> 0);
    return Buffer.concat([tam, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}

function pdf(texto) {
  const conteudo = `BT /F1 18 Tf 30 70 Td (${texto}) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${conteudo.length}>>stream\n${conteudo}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let corpo = '%PDF-1.4\n';
  const posicoes = objs.map((o, i) => { const p = corpo.length; corpo += `${i + 1} 0 obj${o}endobj\n`; return p; });
  const xref = corpo.length;
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${posicoes.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  corpo += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}

// Tom de 1,5 s (WAV PCM 8 kHz, 8 bits) — só para o player da tela tocar algo no simulado.
function wav(segundos = 1.5) {
  const taxa = 8000;
  const n = Math.floor(taxa * segundos);
  const dados = Buffer.alloc(n);
  for (let i = 0; i < n; i++) dados[i] = 128 + Math.round(60 * Math.sin(2 * Math.PI * 440 * i / taxa) * Math.min(1, (n - i) / 800));
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + n, 4); cab.write('WAVE', 8); cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22); cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa, 28); cab.writeUInt16LE(1, 32); cab.writeUInt16LE(8, 34); cab.write('data', 36); cab.writeUInt32LE(n, 40);
  return Buffer.concat([cab, dados]);
}

const AMOSTRAS = {
  imagem: () => ({ nome: 'erro-relatorio.png', mime: 'image/png', dados: png(320, 200, [214, 69, 65]) }),
  pdf: () => ({ nome: 'comprovante-pagamento.pdf', mime: 'application/pdf', dados: pdf('Comprovante de pagamento') }),
  // No WhatsApp a voz é OGG/Opus; no simulado é WAV (o player do navegador toca os dois).
  voz: () => ({ nome: 'audio.wav', mime: 'audio/wav', dados: wav(), voz: true }),
};

function criarMidiaSimulada({ novo, agora, diasGuarda = 180 }) {
  const midias = new Map(); // id → { ...publica, empresa_id, conversa_id, dados }

  function guardar({ empresaId, conversaId, nome, mime, dados, voz = false, expirada = false }) {
    const id = novo('md');
    const expira = expirada ? new Date(Date.now() - 60_000) : new Date(Date.now() + diasGuarda * 86_400_000);
    const m = { id, empresa_id: empresaId, conversa_id: conversaId, nome, mime, tamanho: dados.length, voz, dados: expirada ? null : dados,
      expira_em: expira.toISOString(), criada_em: agora() };
    midias.set(id, m);
    return publica(m);
  }

  function publica(m) {
    const expirado = !m.dados || Date.parse(m.expira_em) <= Date.now();
    return { id: m.id, nome: m.nome, mime: m.mime, tamanho: m.tamanho, voz: !!m.voz, disponivel: !expirado, motivo: expirado ? 'expirado' : null, expira_em: m.expira_em };
  }

  const amostra = (qual, empresaId, conversaId, opcoes = {}) => guardar({ empresaId, conversaId, ...AMOSTRAS[qual](), ...opcoes });

  const conferir = arm.conferirArquivo;

  // Rotas: ver/baixar e anexar. podeVerMidia(req, conversaId) e anexar(req, conversaId, arquivo) vêm do atendimento.
  function rotas(admin, { exigirRotina, R, sessao, podeVerMidia, anexar }) {
    admin.get('/midias/:id', (req, res) => {
      exigirRotina(req, R.atendimento, R.mensagens);
      const m = midias.get(req.params.id);
      if (!m || m.empresa_id !== sessao.empresaId || !podeVerMidia(req, m.conversa_id)) throw erro('nao_encontrado', 'Arquivo não encontrado.');
      if (!publica(m).disponivel) throw erro('midia_expirada', 'Este arquivo passou do prazo de guarda e foi apagado.', { status: 410 });
      const inline = ABRE_NO_NAVEGADOR.test(m.mime) && req.query.baixar !== '1';
      res.set({
        'Content-Type': m.mime, 'Content-Length': String(m.dados.length), 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(m.nome)}`,
      }).send(m.dados);
    });

    // Corpo binário até 16 MB (+1 byte para perceber o excesso e responder no formato do contrato).
    const binario = express.raw({ type: 'application/octet-stream', limit: arm.MAX_BYTES + 1 });
    admin.post('/conversas/:id/anexos', (req, res, next) => binario(req, res, (err) => {
      if (err) return next(err.type === 'entity.too.large' ? erro('arquivo_grande', 'O arquivo passa de 16 MB.', { status: 413 }) : err);
      next();
    }), (req, res) => {
      exigirRotina(req, R.atendimento); // o simulado aceita sempre; a tela usa GET /atendimento/recursos (midia) para o selo
      const legenda = req.query.legenda === undefined ? null : String(req.query.legenda).trim() || null;
      if (legenda && legenda.length > LEGENDA_MAXIMA) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { legenda: `Use no máximo ${LEGENDA_MAXIMA} caracteres.` } });
      const { mime, tipo } = conferir(req.body);
      const nome = String(req.query.nome || 'arquivo').replace(/[\\/\r\n"]/g, '_').trim().slice(0, 120) || 'arquivo';
      res.status(202).json(anexar(req, req.params.id, { nome, mime, tipo, dados: req.body, legenda }));
    });
  }

  return { guardar, amostra, publica, conferir, rotas, tipoDoMime, previaDaMidia, midias };
}

module.exports = { criarMidiaSimulada, tipoDoMime, previaDaMidia, AMOSTRAS };

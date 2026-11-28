'use strict';

// P1 (docs/contratos.md §10): guarda de mídia. O arquivo vai cifrado (AES-256-GCM, chave mestra) para
// <dados>/midias/<empresa>/<AAAA-MM>/<id>.bin; no banco só a descrição. O tipo vale pelo CONTEÚDO
// (lib/midia, G4), nunca pelo nome ou pelo que o remetente declarou. Sem caminho = não guardado
// (motivo: grande, recusado, falhou) ou apagado pelo prazo de guarda.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { novoId, agora } = require('../ids');
const { erro } = require('../erros');
const { cifrarBytes, decifrarBytes } = require('../seguranca/cifra');
const { detectarMime } = require('../lib/midia');
const { CAPACIDADES_WWEB } = require('../provedores/wweb');

const MAX_BYTES = CAPACIDADES_WWEB.max_midia_bytes;
const MIMES_ACEITOS = new Set(CAPACIDADES_WWEB.mimes_aceitos);
const DIAS_GUARDA_PADRAO = 180; // por empresa nos Parâmetros da IA Gestão a partir do P4

const tipoDoMime = (mime) => (String(mime).startsWith('image/') ? 'imagem' : String(mime).startsWith('audio/') ? 'audio' : 'documento');
const previaDaMidia = (tipo) => ({ imagem: '📎 Imagem', audio: '🎤 Áudio', documento: '📎 Documento', video: '📎 Vídeo' }[tipo] || '📎 Arquivo');
const nomeSeguro = (nome, padrao = 'arquivo') => String(nome || '').replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').trim().slice(0, 120) || padrao;
const dirMidias = () => path.join(config.DIR_DADOS, 'midias');

// Confere tamanho e tipo real. Devolve { mime, tipo } ou lança 413/422 no formato do contrato.
function conferirArquivo(dados) {
  if (!Buffer.isBuffer(dados) || !dados.length) throw erro('requisicao_invalida', 'Envie o arquivo.', { campos: { arquivo: 'Arquivo vazio.' } });
  if (dados.length > MAX_BYTES) throw erro('arquivo_grande', 'O arquivo passa de 16 MB.', { status: 413 });
  const mime = detectarMime(dados);
  if (!mime || !MIMES_ACEITOS.has(mime)) throw erro('tipo_nao_suportado', 'Este tipo de arquivo não pode ser enviado pelo WhatsApp do IA Talk.', { status: 422 });
  return { mime, tipo: tipoDoMime(mime) };
}

// Guarda um arquivo já conferido (ou confere aqui). Devolve a linha gravada.
function guardar(db, { empresaId, canalId = null, conversaId = null, direcao, nome, dados, voz = false, diasGuarda = DIAS_GUARDA_PADRAO, agoraMs = Date.now() }) {
  const { mime } = conferirArquivo(dados);
  const id = novoId('midia');
  const relativo = path.join(empresaId, new Date(agoraMs).toISOString().slice(0, 7), `${id}.bin`);
  const absoluto = path.join(dirMidias(), relativo);
  fs.mkdirSync(path.dirname(absoluto), { recursive: true });
  fs.writeFileSync(absoluto, cifrarBytes(dados), { flag: 'wx' });
  try {
    db.prepare(`INSERT INTO midias (id, empresa_id, canal_id, conversa_id, direcao, nome, mime, tamanho, voz, sha256, caminho, criada_em, expira_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, empresaId, canalId, conversaId, direcao, nomeSeguro(nome), mime, dados.length, voz ? 1 : 0,
      crypto.createHash('sha256').update(dados).digest('hex'), relativo.split(path.sep).join('/'), new Date(agoraMs).toISOString(),
      new Date(agoraMs + diasGuarda * 86_400_000).toISOString());
  } catch (err) {
    fs.rmSync(absoluto, { force: true }); // sem linha no banco, o arquivo não fica órfão
    throw err;
  }
  return buscar(db, empresaId, id);
}

// Mídia que não foi guardada (grande, recusada, falhou): a mensagem aparece com a explicação.
function registrarIndisponivel(db, { empresaId, canalId = null, conversaId = null, direcao = 'entrada', nome, mime = null, tamanho = 0, voz = false, motivo }) {
  const id = novoId('midia');
  const t = agora();
  db.prepare(`INSERT INTO midias (id, empresa_id, canal_id, conversa_id, direcao, nome, mime, tamanho, voz, motivo, criada_em, expira_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, empresaId, canalId, conversaId, direcao, nomeSeguro(nome), mime, tamanho, voz ? 1 : 0, motivo, t, t);
  return buscar(db, empresaId, id);
}

function buscar(db, empresaId, id) {
  return db.prepare('SELECT * FROM midias WHERE id = ? AND empresa_id = ?').get(String(id || ''), empresaId) || null;
}

const disponivel = (m, agoraMs = Date.now()) => !!m?.caminho && !m.apagada_em && Date.parse(m.expira_em) > agoraMs;

// Forma pública (§10.2).
function paraMidia(m, agoraMs = Date.now()) {
  if (!m) return null;
  const ok = disponivel(m, agoraMs);
  return { id: m.id, nome: m.nome, mime: m.mime, tamanho: m.tamanho, voz: !!m.voz, disponivel: ok,
    motivo: ok ? null : (m.motivo || 'expirado'), expira_em: m.motivo ? null : m.expira_em };
}

// Conteúdo decifrado, ou null se não está disponível.
function ler(m) {
  if (!disponivel(m)) return null;
  return decifrarBytes(fs.readFileSync(path.join(dirMidias(), m.caminho)));
}

// Tira o arquivo do disco quando a gravação da mensagem não aconteceu (a linha voltou com a transação).
function descartar(m) {
  if (m?.caminho) fs.rmSync(path.join(dirMidias(), m.caminho), { force: true });
}

// Apaga os arquivos que passaram do prazo (a descrição fica: "Arquivo expirado"). Rotina do P4.
function apagarVencidas(db, agoraMs = Date.now()) {
  const vencidas = db.prepare('SELECT id, caminho FROM midias WHERE caminho IS NOT NULL AND apagada_em IS NULL AND expira_em <= ?').all(new Date(agoraMs).toISOString());
  for (const m of vencidas) {
    fs.rmSync(path.join(dirMidias(), m.caminho), { force: true });
    db.prepare('UPDATE midias SET apagada_em = ? WHERE id = ?').run(agora(), m.id);
  }
  return vencidas.length;
}

module.exports = {
  MAX_BYTES, MIMES_ACEITOS, DIAS_GUARDA_PADRAO, conferirArquivo, guardar, registrarIndisponivel, buscar, paraMidia, ler,
  apagarVencidas, descartar, tipoDoMime, previaDaMidia, nomeSeguro, disponivel,
};

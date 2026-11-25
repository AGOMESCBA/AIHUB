'use strict';

// Token interno entre o processo principal e os workers do WhatsApp (serviços
// Windows): autentica o POST /worker-event no hub e as chamadas do hub às
// rotas HTTP locais do worker.
//
// Origem: IAC_HUB_INTERNAL_TOKEN do .env quando definido; senão um token
// aleatório gerado uma única vez em apps/IA Command/data/ (pasta fora do git).
// Hub e worker leem o mesmo arquivo, então não é preciso reinstalar serviços
// nem cadastrar nada. Antes, sem a variável, o worker-event ficava aberto.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARQUIVO_PADRAO = path.join(__dirname, '..', '..', '..', 'data', '.iac-internal-token');

let _cache = null;

function _lerArquivo(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function _lerOuCriar(arquivo) {
  const existente = _lerArquivo(arquivo);
  if (existente) return existente;

  const novo = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  try {
    // 'wx': hub e worker podem subir juntos; quem chegar depois lê o do primeiro.
    fs.writeFileSync(arquivo, novo, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return novo;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const outro = _lerArquivo(arquivo);
    if (!outro) throw new Error('Token interno do WhatsApp vazio em disco.');
    return outro;
  }
}

function obterToken({ env = process.env, arquivo = null } = {}) {
  const doEnv = String(env.IAC_HUB_INTERNAL_TOKEN || '').trim();
  if (doEnv) return doEnv;
  if (arquivo) return _lerOuCriar(arquivo);
  if (!_cache) _cache = _lerOuCriar(ARQUIVO_PADRAO);
  return _cache;
}

function tokenConfere(informado, esperado = obterToken()) {
  const a = Buffer.from(String(informado || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Cabeçalhos das chamadas do hub ao worker local.
function cabecalhosWorker(extra = {}) {
  return { ...extra, 'X-Worker-Token': obterToken() };
}

module.exports = { obterToken, tokenConfere, cabecalhosWorker };
module.exports._test = { _lerOuCriar, limparCache: () => { _cache = null; } };

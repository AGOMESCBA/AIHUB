'use strict';

// Cifra de segredos guardados no banco do Talk (senha do e-mail de envio,
// segredo de webhook, credenciais de provedor): AES-256-GCM, mesmo formato de
// envelope dos outros produtos (ver apps/IA Service/backend/services/crypto-envelope.js).
// Hash com "pimenta" (HMAC) para tokens que só precisam ser conferidos.
//
// Chave mestra: IA_TALK_CHAVE_MESTRA (32 bytes em base64) quando definida; senão
// gerada uma única vez em data/.chave-mestra (pasta fora do git). Perder a chave
// = perder os segredos cifrados (o backup de data/ precisa incluir o arquivo).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const PREFIXO = 'v1';
let _chave = null;

function _lerOuCriarArquivo(arquivo) {
  try {
    const salvo = fs.readFileSync(arquivo, 'utf8').trim();
    if (salvo) return salvo;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const nova = crypto.randomBytes(32).toString('base64');
  try {
    fs.writeFileSync(arquivo, nova, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return nova;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return fs.readFileSync(arquivo, 'utf8').trim();
  }
}

function carregarChave({ env = process.env, arquivo = path.join(config.DIR_DADOS, '.chave-mestra') } = {}) {
  const texto = String(env.IA_TALK_CHAVE_MESTRA || '').trim() || _lerOuCriarArquivo(arquivo);
  const chave = Buffer.from(texto, 'base64');
  if (chave.length !== 32) throw new Error('Chave mestra do IA Talk inválida: precisa ter 32 bytes em base64.');
  return chave;
}

function chave() {
  if (!_chave) _chave = carregarChave();
  return _chave;
}

// Só para testes: usar uma chave conhecida.
function definirChaveParaTeste(buffer) { _chave = buffer; }

function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [PREFIXO, iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

function decifrar(envelope) {
  if (!envelope) return null;
  const [versao, iv, tag, dados] = String(envelope).split(':');
  if (versao !== PREFIXO || !iv || !tag || dados === undefined) throw new Error('Segredo cifrado em formato desconhecido.');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

// Hash conferível de token/código: HMAC-SHA256 com subchave derivada da mestra.
function hashSecreto(texto, finalidade = 'token') {
  const sub = crypto.createHmac('sha256', chave()).update(`ia-talk:${finalidade}`).digest();
  return crypto.createHmac('sha256', sub).update(String(texto)).digest('hex');
}

function iguaisTempoConstante(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { cifrar, decifrar, hashSecreto, iguaisTempoConstante, carregarChave, definirChaveParaTeste };

'use strict';
const crypto = require('node:crypto');
const { redigirTexto } = require('./redaction-service');
const TECNICO = /\b(?:exception|access violation|stack overflow|variable does not exist|type mismatch|invalid field name|argument error|array out of bounds|deadlock victim)\b/i;
const NEGOCIO = /\berro\s+(?:ao|na|no|em|de)\b/i;
const DATA = /^\s*(?:\d{4}-\d\d-\d\d[T ][\d:.,]+(?:Z|[-+]\d\d:?\d\d)?|\d\d\/\d\d\/\d{4}\s+[\d:.,]+)(?:\s+\d+\|?)?\s*/;
const MAX_PILHA = 256;

function registro(linha) {
  let thread = linha.match(/\s(\d+)\|\s*$/)?.[1] || null;
  let texto = linha.replace(DATA, ''); let nivel = null;
  // Somente o cabeçalho do registro define o nível: marcadores citados
  // depois da mensagem (SQL/JSON/texto) não mudam ERROR para WARN.
  for (let i = 0; i < 8; i++) {
    const token = texto.match(/^\s*\[([^\]]+)\]\s*/);
    if (!token) break;
    thread = token[1].match(/^Thread\s+(\d+)\s*$/i)?.[1] || thread;
    if (!nivel && /^(?:ERROR|ERRO|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\s*$/i.test(token[1])) nivel = token[1].trim().toUpperCase();
    texto = texto.slice(token[0].length);
  }
  const simples = texto.match(/^\s*(ERROR|ERRO|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\s*[:\-]\s*/i);
  if (!nivel && simples) { nivel = simples[1].toUpperCase(); texto = texto.slice(simples[0].length); }
  if (!nivel && /^FATAL(?:\s+ERROR)?\b/i.test(texto)) nivel = 'FATAL';
  thread = texto.match(/^\s*THREAD ERROR\s*\(\[?(\d+)/i)?.[1] || thread;
  return { texto: texto.trim(), nivel, thread, datado: DATA.test(linha) };
}
function frame(texto, linhaLog) {
  const m = texto.match(/(?:\bcalled from\s+|\bon\s+|^)([\w.$:]+)\(([^)]+\.(?:prw|prx|tlpp))\)/i);
  if (!m) return null;
  const depois = texto.slice(m.index + m[0].length);
  const linha = depois.match(/\b(?:line|linha)\s*:?\s*(\d+)/i) || depois.match(/^\s*:?\s*(\d+)(?:\s|$)/);
  return { funcao: redigirTexto(m[1]), fonte: redigirTexto(m[2]), linha: linha ? Number(linha[1]) : null, linhaLog, customizadaProvavel: /^U_/i.test(m[1]) };
}
function normalizar(texto) {
  return redigirTexto(texto).replace(DATA, '')
    .replace(/\b\d{4}-\d\d-\d\d[T ][\d:.,]+(?:Z|[-+]\d\d:?\d\d)?/g, '[data]')
    .replace(/\b\d\d\/\d\d\/\d{4}\b/g, '[data]').replace(/\b\d\d:\d\d:\d\d(?:\.\d+)?\b/g, '[hora]').replace(/\s+/g, ' ').trim();
}

// Uma passagem linear mantém apenas incidentes ativos. A cadeia inteira
// contribui à assinatura; até 256 frames ficam disponíveis para consulta.
function* percorrer(linhas, receber) {
  const ativos = new Map(); let atual = null; let warnings = 0; let ocorrencias = 0;
  function fechar(chave) {
    const item = ativos.get(chave); if (!item) return;
    ativos.delete(chave);
    if (!item.mensagem) item.mensagem = linhas[item.inicio];
    const assinatura = crypto.createHash('sha256').update(`${item.gravidade}|${normalizar(item.mensagem)}|${item.hashPilha.digest('hex')}`).digest('hex');
    receber({ ...item, assinatura, hashPilha: undefined }); ocorrencias++;
  }
  function acrescentar(item, texto, i) {
    const f = frame(texto, i + 1);
    if (f) {
      item.hashPilha.update(`${f.funcao.toUpperCase()}|${f.fonte.toUpperCase()}|${f.linha ?? ''}\n`);
      if (item.pilha.length < MAX_PILHA) item.pilha.push(f);
      else { item.pilha.splice(MAX_PILHA - 3, 1); item.pilha.push(f); item.pilhaLimitada = true; }
    }
    const somenteFrame = /^(?:called from\s+|on\s+|[\w.$:]+\([^)]*\.(?:prw|prx|tlpp)\))/i.test(texto);
    if (!item.mensagem && texto && (!f || !somenteFrame) && !/^[-=*\s]+$/.test(texto) && !/^\d{4}-\d\d-\d\d/.test(texto) && !/^(?:environment|build|version)\s*:/i.test(texto)) item.mensagem = texto;
    if (item.indices.length < 24) item.indices.push(i);
  }
  for (let i = 0; i < linhas.length; i++) {
    if (i && i % 2048 === 0) yield;
    const r = registro(linhas[i]); const chave = r.thread || atual || '_';
    if (r.datado && !r.texto) continue;
    let item = ativos.get(chave);
    const thread = /^THREAD ERROR\b/i.test(r.texto);
    const warning = r.nivel === 'WARN' || r.nivel === 'WARNING';
    if (warning) { warnings++; continue; }
    const chamada = /^(?:called from\s+|on\s+|[\w.$:]+\([^)]*\.(?:prw|prx|tlpp)\))/i.test(r.texto);
    if (item && chamada) { acrescentar(item, r.texto, i); continue; }
    if (item?.thread && !item.mensagem && !r.datado && ['ERROR', 'ERRO'].includes(r.nivel)) { acrescentar(item, r.texto, i); continue; }
    const explicito = ['ERROR', 'ERRO', 'FATAL'].includes(r.nivel);
    const negocio = NEGOCIO.test(r.texto) && (r.nivel == null || r.nivel === 'INFO');
    const tecnico = TECNICO.test(r.texto) && r.nivel == null;
    const novo = thread || explicito || negocio || (tecnico && !item?.thread);
    if (novo) {
      fechar(chave);
      if (ativos.size >= 256) { const antigo = ativos.keys().next().value; ativos.get(antigo).pilhaLimitada = true; fechar(antigo); }
      const gravidade = r.nivel === 'FATAL' || /^FATAL\b/i.test(r.texto) ? 3 : thread || tecnico ? 2 : 1;
      item = { inicio: i, thread, gravidade, mensagem: thread ? '' : r.texto, pilha: [], pilhaLimitada: false, indices: [], hashPilha: crypto.createHash('sha256') };
      ativos.set(chave, item); atual = chave;
      if (thread) { item.indices.push(i); item.mensagem = r.texto.match(/^THREAD ERROR\s*:\s*(.+)$/i)?.[1] || ''; }
      else acrescentar(item, r.texto, i);
    } else if (item && !r.nivel && !r.datado) acrescentar(item, r.texto, i);
    else if (r.nivel || r.datado) fechar(chave);
  }
  for (const chave of [...ativos.keys()]) fechar(chave);
  return { ocorrencias, warnings };
}

module.exports = { percorrer, registro, normalizar };

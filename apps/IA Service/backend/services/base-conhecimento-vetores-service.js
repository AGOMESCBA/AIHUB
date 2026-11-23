'use strict';

// Índice local: chamadas de embedding sempre partem de uma empresa específica.
// A indexação é opcional e deve ser habilitada em apenas um processo.
const crypto = require('crypto');
const https = require('https');
const { getDB } = require('../database');
const chamados = require('../repositories/chamado-repository');
const aiConfig = require('./ai-config-service');
const { redigirTexto } = require('./redaction-service');
const MODELO = 'text-embedding-3-large';
const DIMENSOES = 3072;

function _material(empresaId, chamadoId) {
  const chamado = chamados.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado nesta empresa.');
  const pos = chamados.listarPosicionamentosDoChamado(empresaId, chamadoId);
  // Reservar parte do limite para o histórico e o resultado, mesmo quando o
  // relato inicial é longo. O índice não pretende cobrir todos os registros.
  const cabecalho = redigirTexto([chamado.titulo, chamado.assunto, chamado.breveDescricao, chamado.descricao, chamado.informacoesAdicionais, chamado.observacoes].filter(Boolean).join('\n')).slice(0, 6000);
  const historico = redigirTexto(pos.slice(-8).flatMap(p => [p.assunto, p.descricao, p.resultado]).filter(Boolean).join('\n')).slice(0, 6000);
  const texto = [cabecalho, historico].filter(Boolean).join('\n').trim();
  return { chamado, texto, hash: crypto.createHash('sha256').update(texto).digest('hex') };
}

function _vetorBuffer(vetor, dimensoes) {
  if (!Array.isArray(vetor) || vetor.length !== dimensoes || vetor.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Vetor inválido.');
  const b = Buffer.alloc(dimensoes * 4);
  vetor.forEach((n, i) => b.writeFloatLE(n, i * 4));
  return b;
}

function _similaridade(a, b, dimensoes) {
  if (!Buffer.isBuffer(b) || b.length !== dimensoes * 4 || a.length !== dimensoes) return null;
  let produto = 0, normaA = 0, normaB = 0;
  for (let i = 0; i < dimensoes; i++) {
    const x = a[i], y = b.readFloatLE(i * 4);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    produto += x * y; normaA += x * x; normaB += y * y;
  }
  return normaA && normaB ? produto / Math.sqrt(normaA * normaB) : null;
}

function _embeddingOpenAI(texto, chave, { modelo = MODELO, timeoutMs = 15000 } = {}) {
  if (!chave) return Promise.reject(new Error('Provedor de embeddings indisponível.'));
  return new Promise((resolve, reject) => {
    const corpo = JSON.stringify({ model: modelo, input: texto, encoding_format: 'float' });
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/embeddings', method: 'POST', headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } }, res => {
      let dados = '';
      res.setEncoding('utf8');
      res.on('data', parte => { dados += parte; if (dados.length > 4 * 1024 * 1024) req.destroy(new Error('Resposta de embeddings excedeu o limite.')); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Provedor de embeddings retornou HTTP ${res.statusCode}.`));
        try { resolve(JSON.parse(dados).data?.[0]?.embedding); } catch (_) { reject(new Error('Resposta de embeddings inválida.')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Tempo limite de embeddings excedido.')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject); req.end(corpo);
  });
}

async function indexarChamado(empresaId, chamadoId, { embedder = _embeddingOpenAI, resolverConfig = aiConfig.resolverKeysEOrdem, modelo = MODELO, dimensoes = DIMENSOES } = {}) {
  if (!empresaId || !chamadoId) throw new Error('Empresa e chamado são obrigatórios.');
  const db = getDB();
  const antes = _material(empresaId, chamadoId);
  if (!antes.texto) return { estado: 'sem_texto' };
  const existente = db.prepare('SELECT hash_conteudo, modelo, dimensoes FROM chamados_embeddings WHERE empresa_id = ? AND chamado_id = ?').get(Number(empresaId), chamadoId);
  if (existente?.hash_conteudo === antes.hash && existente.modelo === modelo && existente.dimensoes === dimensoes) return { estado: 'atualizado' };
  const { keys } = resolverConfig(empresaId);
  const vetor = await embedder(antes.texto, keys.openai, { modelo });
  const buffer = _vetorBuffer(vetor, dimensoes);
  return db.transaction(() => {
    const atual = _material(empresaId, chamadoId);
    if (atual.hash !== antes.hash) return { estado: 'alterado_durante_indexacao' };
    db.prepare(`INSERT INTO chamados_embeddings (chamado_id, empresa_id, modelo, dimensoes, hash_conteudo, vetor, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chamado_id) DO UPDATE SET empresa_id=excluded.empresa_id, modelo=excluded.modelo, dimensoes=excluded.dimensoes, hash_conteudo=excluded.hash_conteudo, vetor=excluded.vetor, criado_em=excluded.criado_em`)
      .run(chamadoId, Number(empresaId), modelo, dimensoes, antes.hash, buffer, new Date().toISOString());
    return { estado: 'indexado' };
  })();
}

async function buscar(empresaId, chamadoId, { escopo = 'empresa', limite = 15, textoContexto = '', comDiagnostico = false, embedder = _embeddingOpenAI, resolverConfig = aiConfig.resolverKeysEOrdem, modelo = MODELO, dimensoes = DIMENSOES } = {}) {
  if (!['empresa', 'cliente_pa'].includes(escopo)) throw new Error('Escopo inválido.');
  const retorno = (resultados, estado) => comDiagnostico ? { resultados, estado } : resultados;
  const db = getDB();
  const atual = _material(empresaId, chamadoId);
  if (!atual.texto && !textoContexto) return retorno([], 'sem_contexto');
  const clienteId = escopo === 'cliente_pa' && chamados.identidadeConfirmadaPa(empresaId, chamadoId) ? atual.chamado.clienteId : null;
  if (escopo === 'cliente_pa' && !clienteId) return retorno([], 'identidade_nao_confirmada');
  const params = [Number(empresaId), modelo, dimensoes, chamadoId, ...(clienteId ? [clienteId] : [])];
  const filtro = `FROM chamados_embeddings e JOIN chamados c ON c.id = e.chamado_id AND c.empresa_id = e.empresa_id
    WHERE e.empresa_id = ? AND e.modelo = ? AND e.dimensoes = ? AND c.id != ? ${clienteId ? 'AND c.cliente_id = ?' : ''}`;
  if (!db.prepare(`SELECT 1 ${filtro} LIMIT 1`).get(...params)) return retorno([], 'indice_sem_vetores_elegiveis');
  const { keys } = resolverConfig(empresaId);
  const consulta = await embedder(redigirTexto([textoContexto, atual.texto].filter(Boolean).join('\n')).slice(0, 12000), keys.openai, { modelo });
  _vetorBuffer(consulta, dimensoes);
  const rows = db.prepare(`SELECT e.chamado_id, e.vetor ${filtro}`).iterate(...params);
  const resultados = [];
  for (const row of rows) {
    if (clienteId && !chamados.identidadeConfirmadaPa(empresaId, row.chamado_id)) continue;
    const score = _similaridade(consulta, row.vetor, dimensoes);
    if (score !== null) resultados.push({ chamadoId: row.chamado_id, similaridade: score });
  }
  return retorno(resultados.sort((a, b) => b.similaridade - a.similaridade || a.chamadoId.localeCompare(b.chamadoId)).slice(0, Math.max(1, Math.min(Number(limite) || 15, 50))), resultados.length ? 'disponivel' : 'sem_candidatos_validos');
}

async function indexarLote(empresaId, { apos = '', limite = 5, ...opts } = {}) {
  if (!empresaId) throw new Error('Empresa é obrigatória.');
  const modelo = opts.modelo || MODELO;
  const rows = getDB().prepare(`SELECT c.id FROM chamados c LEFT JOIN chamados_embeddings e ON e.chamado_id = c.id AND e.empresa_id = c.empresa_id
    WHERE c.empresa_id = ? AND c.id > ? AND (e.chamado_id IS NULL OR e.modelo != ? OR e.dimensoes != ?) ORDER BY c.id LIMIT ?`)
    .all(Number(empresaId), String(apos), modelo, opts.dimensoes || DIMENSOES, Math.max(1, Math.min(Number(limite) || 5, 20)));
  let cursor = apos, indexados = 0, semTexto = 0;
  for (const row of rows) {
    const r = await indexarChamado(empresaId, row.id, opts);
    cursor = row.id;
    if (r.estado === 'indexado') indexados++;
    if (r.estado === 'sem_texto') semTexto++;
  }
  return { cursor, examinados: rows.length, indexados, semTexto, fim: rows.length === 0 };
}

function iniciarIndexacao() {
  if (process.env.IA_SERVICE_VETORES_ATIVO !== '1' || process.env.IA_SERVICE_INDEXADOR_VETORES !== '1') return;
  const cursores = new Map();
  let rodando = false;
  async function tick() {
    if (rodando) return;
    rodando = true;
    try {
      const empresas = getDB().prepare('SELECT DISTINCT empresa_id FROM chamados ORDER BY empresa_id').all();
      for (const { empresa_id: empresaId } of empresas) {
        try {
          const resultado = await indexarLote(empresaId, { apos: cursores.get(empresaId) || '' });
          cursores.set(empresaId, resultado.fim ? '' : resultado.cursor);
        } catch (err) {
          console.warn('[IA Service] Indexação vetorial indisponível para empresa', empresaId, ':', redigirTexto(err.message));
        }
      }
    } finally { rodando = false; }
  }
  const primeiro = setTimeout(() => { tick().catch(() => {}); const timer = setInterval(() => tick().catch(() => {}), 60000); timer.unref?.(); }, 30000);
  primeiro.unref?.();
}

module.exports = { indexarChamado, indexarLote, iniciarIndexacao, buscar, MODELO, DIMENSOES, _similaridade };

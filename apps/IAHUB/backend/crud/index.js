const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function _filePath(arquivo) {
  return path.join(DATA_DIR, `${arquivo}.json`);
}

function _ler(arquivo) {
  const fp = _filePath(arquivo);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; }
  catch { return []; }
}

function _salvar(arquivo, dados) {
  fs.writeFileSync(_filePath(arquivo), JSON.stringify(dados, null, 2), 'utf8');
}

function _proximoId(lista) {
  if (!lista.length) return 1;
  return Math.max(...lista.map(i => i.id || 0)) + 1;
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna todos os registros, filtrando por campo=valor quando informado.
 * Assinatura compatível com futura migração para SQL (WHERE clause).
 */
function listar(arquivo, filtros = {}) {
  let dados = _ler(arquivo);
  for (const [campo, valor] of Object.entries(filtros)) {
    dados = dados.filter(item => item[campo] === valor);
  }
  return dados;
}

/** Retorna um registro pelo id numérico, ou null se não encontrar. */
function buscarPorId(arquivo, id) {
  return _ler(arquivo).find(item => item.id === Number(id)) ?? null;
}

/** Retorna o primeiro registro onde campo === valor, ou null. */
function buscarPor(arquivo, campo, valor) {
  return _ler(arquivo).find(item => item[campo] === valor) ?? null;
}

/** Insere novo registro com id automático e criado_em. */
function criar(arquivo, dados) {
  const lista = _ler(arquivo);
  const novo  = { id: _proximoId(lista), ...dados, criado_em: new Date().toISOString() };
  lista.push(novo);
  _salvar(arquivo, lista);
  return novo;
}

/** Atualiza registro pelo id. Retorna registro atualizado ou null. */
function atualizar(arquivo, id, dados) {
  const lista = _ler(arquivo);
  const idx   = lista.findIndex(item => item.id === Number(id));
  if (idx === -1) return null;
  // Protege campos imutáveis
  const { id: _id, criado_em: _c, ...patch } = dados;
  lista[idx] = { ...lista[idx], ...patch, atualizado_em: new Date().toISOString() };
  _salvar(arquivo, lista);
  return lista[idx];
}

/** Remove registro pelo id. Retorna true se removido, false se não encontrado. */
function excluir(arquivo, id) {
  const lista = _ler(arquivo);
  const idx   = lista.findIndex(item => item.id === Number(id));
  if (idx === -1) return false;
  lista.splice(idx, 1);
  _salvar(arquivo, lista);
  return true;
}

module.exports = { listar, buscarPorId, buscarPor, criar, atualizar, excluir };

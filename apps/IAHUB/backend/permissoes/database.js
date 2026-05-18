const fs   = require('fs');
const { appDataFile } = require('../data-paths');

const FILE = appDataFile('permissoes.json');

function _ler() {
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch { return []; }
}

function _salvar(dados) {
  fs.writeFileSync(FILE, JSON.stringify(dados, null, 2), 'utf8');
}

/** Retorna todas as entradas de permissão de um usuário (uma por empresa). */
function getByUsuario(usuario_id) {
  return _ler().filter(p => p.usuario_id === Number(usuario_id));
}

/**
 * Retorna as rotinas permitidas para um usuário em uma empresa específica.
 * Retorna null quando não há registro (= sem permissão configurada → bloquear tudo).
 */
function getRotinas(usuario_id, empresa_id) {
  const reg = _ler().find(
    p => p.usuario_id === Number(usuario_id) && p.empresa_id === Number(empresa_id)
  );
  return reg ? reg.rotinas : null;
}

/**
 * Substitui todas as permissões de um usuário.
 * permissoes = [{ empresa_id, rotinas: [] }, ...]
 */
function salvar(usuario_id, permissoes) {
  const uid   = Number(usuario_id);
  const todos  = _ler().filter(p => p.usuario_id !== uid);
  const agora  = new Date().toISOString();
  permissoes.forEach(p => {
    todos.push({
      usuario_id:   uid,
      empresa_id:   Number(p.empresa_id),
      rotinas:      Array.isArray(p.rotinas) ? p.rotinas : [],
      atualizado_em: agora,
    });
  });
  _salvar(todos);
}

/** Remove todas as permissões de um usuário (útil ao excluir usuário). */
function excluirPorUsuario(usuario_id) {
  const uid = Number(usuario_id);
  _salvar(_ler().filter(p => p.usuario_id !== uid));
}

module.exports = { getByUsuario, getRotinas, salvar, excluirPorUsuario };

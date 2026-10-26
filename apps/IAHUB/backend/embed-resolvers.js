// Liga uma rota pública de chat à empresa dona dela, para a incorporação
// (iframe) por empresa. Só leitura. Qualquer falha devolve null — e null
// significa "não libera" (mantém X-Frame-Options: SAMEORIGIN).
const RE_LOGIN_IA_COMMAND = /^\/(?:entrar|acesso)\/[A-Za-z0-9_-]{3,80}$/;

function criarResolvers({ getPlatformDB, getIaCommandDB, buscarEmpresa }) {
  function empresaPorApelido(apelido) {
    if (!apelido) return null;
    const row = getPlatformDB().prepare(`
      SELECT empresa_id FROM platform_ai_configs WHERE login_externo_apelido = ?
    `).get(String(apelido).toLowerCase());
    return row ? Number(row.empresa_id) : null;
  }

  // Mesma regra do login do IA Command: só rota ativa; rota duplicada entre
  // empresas é ambígua e não libera nada.
  function empresaPorLoginPath(loginPath) {
    if (!RE_LOGIN_IA_COMMAND.test(String(loginPath || ''))) return null;
    const rows = getIaCommandDB().prepare(`
      SELECT empresa_id FROM ai_config
       WHERE protheus_web_login_path = ? AND COALESCE(protheus_web_login_ativo, 1) = 1
    `).all(loginPath);
    return rows.length === 1 ? Number(rows[0].empresa_id) : null;
  }

  function contextoEmpresa(empresaId) {
    const ctx = { nome: null, linkIaService: null, linkIaCommand: null };
    try {
      const empresa = buscarEmpresa(empresaId);
      ctx.nome = empresa?.nome_fantasia || empresa?.razao_social || empresa?.nome || null;
    } catch (_) { /* nome é só visual */ }
    try {
      const row = getPlatformDB().prepare('SELECT login_externo_apelido FROM platform_ai_configs WHERE empresa_id = ?').get(Number(empresaId));
      if (row?.login_externo_apelido) ctx.linkIaService = '/iaservice/' + row.login_externo_apelido;
    } catch (_) { /* sem apelido */ }
    try {
      const row = getIaCommandDB().prepare(`
        SELECT protheus_web_login_path AS path FROM ai_config
         WHERE empresa_id = ? AND COALESCE(protheus_web_login_ativo, 1) = 1
      `).get(Number(empresaId));
      if (row && RE_LOGIN_IA_COMMAND.test(String(row.path || ''))) ctx.linkIaCommand = row.path;
    } catch (_) { /* IA Command indisponível ou sem rota mascarada */ }
    return ctx;
  }

  return { empresaPorApelido, empresaPorLoginPath, contextoEmpresa };
}

module.exports = { criarResolvers };

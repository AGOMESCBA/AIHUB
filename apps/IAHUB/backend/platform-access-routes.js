// O endereço público gera links; nunca redireciona ou desativa o acesso atual.
function normalizarUrlPublica(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Informe um endereço HTTP ou HTTPS válido.');
  if (!value.trim()) return null;
  let url;
  try {
    if (!/^https?:\/\//i.test(value.trim())) throw new Error();
    url = new URL(value.trim());
  } catch (_) { throw new Error('Informe um endereço completo, começando com http:// ou https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use somente o endereço HTTP ou HTTPS e a porta opcional, sem caminho, credenciais ou parâmetros.');
  }
  return url.origin;
}

function lerConfig(db) {
  const row = db.prepare('SELECT url_publica, versao, atualizado_em FROM platform_access_config WHERE id = 1').get();
  return { urlPublica: row?.url_publica || null, versao: row?.versao || 0, atualizadoEm: row?.atualizado_em || null };
}

function registrarRotas(app, { requireAuth, requireAdmin, getDB }) {
  app.get('/api/iahub/platform/access-config', requireAuth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(lerConfig(getDB()));
  });
  app.post('/api/iahub/platform/access-config', requireAuth, requireAdmin, (req, res) => {
    let url;
    try { url = normalizarUrlPublica(req.body?.urlPublica); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'urlPublica')) {
      return res.status(400).json({ error: 'Informe o endereço público ou deixe-o vazio para remover a configuração.' });
    }
    const db = getDB();
    const resultado = db.transaction(() => {
      const atual = lerConfig(db);
      if (req.body.versao !== atual.versao) return null;
      db.prepare(`INSERT INTO platform_access_config (id, url_publica, versao, atualizado_em)
        VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        url_publica = excluded.url_publica, versao = excluded.versao, atualizado_em = excluded.atualizado_em`)
        .run(url, atual.versao + 1, new Date().toISOString());
      return lerConfig(db);
    }).immediate();
    if (!resultado) return res.status(409).json({ error: 'O endereço público foi alterado em outra sessão. Recarregue os dados antes de salvar.' });
    res.json(resultado);
  });
}

module.exports = { registrarRotas, normalizarUrlPublica, lerConfig };

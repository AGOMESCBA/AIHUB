'use strict';

const { getDB }          = require('../../database');
const { requireRotina }  = require('../../permissions');
const { getEmpresaId }   = require('../../empresa-context');
const connectionFactory  = require('../providers/connection-factory');

function _invalidarMetaSX3(empresaId) {
  try { require('../ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
}

module.exports = function registrar(app, { requireAuth, requireIaCommand }) {
  const canSX3 = requireRotina('iac-admin-protheus-sx3');
  const eid    = req => getEmpresaId(req);

  app.get('/api/ia-command/protheus/sx3',
    requireAuth, requireIaCommand, canSX3,
    (req, res) => {
      try {
        const { conexao_id, tabela } = req.query;
        const empresaId = eid(req);
        const filtros = ['empresa_id = ?'];
        const args = [empresaId];
        if (conexao_id) { filtros.push('connection_id = ?'); args.push(conexao_id); }
        if (tabela) { filtros.push('tabela = ?'); args.push(String(tabela).toUpperCase().trim()); }
        const rows = getDB().prepare(`
          SELECT * FROM protheus_sx3
          WHERE ${filtros.join(' AND ')}
          ORDER BY connection_id, tabela, ordem, campo
        `).all(...args);
        res.json(rows);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.get('/api/ia-command/protheus/sx3/tabelas-disponiveis',
    requireAuth, requireIaCommand, canSX3,
    async (req, res) => {
      const { conexao_id } = req.query;
      if (!conexao_id) return res.status(400).json({ error: 'Informe conexao_id.' });

      const conn = _verificarConexao(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexao nao encontrada.' });
      if (conn.tipo === 'api_proxy') {
        return res.status(400).json({ error: 'Conexao via API Proxy nao permite listar tabelas. Use arquivo DBF.' });
      }

      try {
        const rows = await connectionFactory.executar(conn, _sqlListarTabelasSX3(conn.tipo), {});
        const tabelas = rows.map(r => r.TABLE_NAME || r.table_name || r.name || Object.values(r)[0]).filter(Boolean);
        res.json(tabelas);
      } catch (e) {
        res.status(502).json({ error: `Erro ao listar tabelas: ${e.message}` });
      }
    }
  );

  app.post('/api/ia-command/protheus/sx3/reload',
    requireAuth, requireIaCommand, canSX3,
    async (req, res) => {
      const { conexao_id, tabela, limpar = true } = req.body || {};
      if (!conexao_id || !tabela) return res.status(400).json({ error: 'Informe conexao_id e tabela.' });

      const conn = _verificarConexao(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexao nao encontrada.' });

      let rows;
      try {
        rows = await connectionFactory.executar(conn, `SELECT * FROM ${tabela}`, {});
      } catch (e) {
        return res.status(502).json({ error: `Falha ao consultar ${tabela}: ${e.message}` });
      }

      const total = _salvarRegistros(conexao_id, eid(req), (rows || []).map(_normalizarRegistroSX3), limpar !== false);
      _invalidarMetaSX3(eid(req));
      res.json({ importados: total });
    }
  );

  app.post('/api/ia-command/protheus/sx3/import',
    requireAuth, requireIaCommand, canSX3,
    (req, res) => {
      try {
        const { conexao_id, registros, limpar = true } = req.body || {};
        if (!conexao_id || !Array.isArray(registros)) {
          return res.status(400).json({ error: 'Informe conexao_id e registros (array).' });
        }
        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexao nao encontrada.' });

        const total = _salvarRegistros(conexao_id, eid(req), registros, limpar !== false);
        _invalidarMetaSX3(eid(req));
        res.json({ importados: total });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.post('/api/ia-command/protheus/sx3',
    requireAuth, requireIaCommand, canSX3,
    (req, res) => {
      try {
        const { conexao_id, tabela, campo, tipo, tamanho, decimal, titulo, descricao, usado, ordem } = req.body || {};
        if (!conexao_id || !tabela || !campo) return res.status(400).json({ error: 'conexao_id, tabela e campo sao obrigatorios.' });
        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexao nao encontrada.' });

        const db = getDB();
        const agora = new Date().toISOString();
        const rec = _normalizarRegistroSX3({ tabela, campo, tipo, tamanho, decimal, titulo, descricao, usado, ordem });
        if (db.prepare('SELECT id FROM protheus_sx3 WHERE connection_id = ? AND tabela = ? AND campo = ?').get(conexao_id, rec.tabela, rec.campo)) {
          return res.status(409).json({ error: `Campo "${rec.campo}" ja existe para a tabela "${rec.tabela}" nesta conexao.` });
        }
        const info = db.prepare(`
          INSERT INTO protheus_sx3
            (connection_id, empresa_id, tabela, campo, tipo, tamanho, decimal, titulo, descricao, usado, ordem, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(conexao_id, eid(req), rec.tabela, rec.campo, rec.tipo, rec.tamanho, rec.decimal, rec.titulo, rec.descricao, rec.usado, rec.ordem, agora, agora);
        _invalidarMetaSX3(eid(req));
        res.status(201).json(db.prepare('SELECT * FROM protheus_sx3 WHERE id = ?').get(info.lastInsertRowid));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.put('/api/ia-command/protheus/sx3/:id',
    requireAuth, requireIaCommand, canSX3,
    (req, res) => {
      try {
        const db = getDB();
        const row = db.prepare('SELECT * FROM protheus_sx3 WHERE id = ?').get(req.params.id);
        if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });
        const rec = _normalizarRegistroSX3({ ...row, ...(req.body || {}) });
        const agora = new Date().toISOString();
        db.prepare(`
          UPDATE protheus_sx3
          SET tabela=?, campo=?, tipo=?, tamanho=?, decimal=?, titulo=?, descricao=?, usado=?, ordem=?, atualizado_em=?
          WHERE id=?
        `).run(rec.tabela, rec.campo, rec.tipo, rec.tamanho, rec.decimal, rec.titulo, rec.descricao, rec.usado, rec.ordem, agora, row.id);
        _invalidarMetaSX3(eid(req));
        res.json(db.prepare('SELECT * FROM protheus_sx3 WHERE id = ?').get(row.id));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.delete('/api/ia-command/protheus/sx3/:id',
    requireAuth, requireIaCommand, canSX3,
    (req, res) => {
      try {
        const db = getDB();
        const row = db.prepare('SELECT * FROM protheus_sx3 WHERE id = ?').get(req.params.id);
        if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Nao encontrado.' });
        db.prepare('DELETE FROM protheus_sx3 WHERE id = ?').run(row.id);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );
};

function _verificarConexao(conexaoId, empresaId) {
  const row = getDB().prepare('SELECT * FROM connections WHERE id = ?').get(conexaoId);
  return row && row.empresa_id === empresaId ? row : null;
}

function _sqlListarTabelasSX3(tipo) {
  if (tipo === 'sqlite') {
    return "SELECT name AS TABLE_NAME FROM sqlite_master WHERE type='table' AND name LIKE 'SX3%' ORDER BY name";
  }
  if (tipo === 'postgresql' || tipo === 'postgres') {
    return "SELECT table_name AS TABLE_NAME FROM information_schema.tables WHERE table_name LIKE 'sx3%' AND table_type='BASE TABLE' ORDER BY table_name";
  }
  return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'SX3%' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME";
}

function _normalizarRegistroSX3(r = {}) {
  return {
    tabela: String(r.tabela || r.X3_ARQUIVO || r.x3_arquivo || '').trim().toUpperCase(),
    campo: String(r.campo || r.X3_CAMPO || r.x3_campo || '').trim().toUpperCase(),
    tipo: String(r.tipo || r.X3_TIPO || r.x3_tipo || '').trim().toUpperCase(),
    tamanho: Number(r.tamanho ?? r.X3_TAMANHO ?? r.x3_tamanho ?? r.X3_SIZE ?? r.x3_size ?? 0) || 0,
    decimal: Number(r.decimal ?? r.X3_DECIMAL ?? r.x3_decimal ?? 0) || 0,
    titulo: String(r.titulo || r.X3_TITULO || r.x3_titulo || '').trim(),
    descricao: String(r.descricao || r.X3_DESCRIC || r.x3_descric || r.X3_DESC || r.x3_desc || '').trim(),
    usado: String(r.usado || r.X3_USADO || r.x3_usado || '').trim(),
    ordem: Number(r.ordem ?? r.R_E_C_N_O_ ?? r.r_e_c_n_o_ ?? 0) || 0,
  };
}

function _salvarRegistros(conexaoId, empresaId, registros, limpar = true) {
  const db = getDB();
  const agora = new Date().toISOString();
  const del = db.prepare('DELETE FROM protheus_sx3 WHERE connection_id = ?');
  const ins = limpar
    ? db.prepare(`INSERT INTO protheus_sx3
        (connection_id, empresa_id, tabela, campo, tipo, tamanho, decimal, titulo, descricao, usado, ordem, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    : db.prepare(`INSERT INTO protheus_sx3
        (connection_id, empresa_id, tabela, campo, tipo, tamanho, decimal, titulo, descricao, usado, ordem, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(connection_id, tabela, campo) DO UPDATE SET
          tipo=excluded.tipo, tamanho=excluded.tamanho, decimal=excluded.decimal,
          titulo=excluded.titulo, descricao=excluded.descricao, usado=excluded.usado,
          ordem=excluded.ordem, atualizado_em=excluded.atualizado_em`);

  db.transaction((recs) => {
    if (limpar) del.run(conexaoId);
    for (const raw of recs) {
      const r = _normalizarRegistroSX3(raw);
      if (!r.tabela || !r.campo) continue;
      ins.run(conexaoId, empresaId, r.tabela, r.campo, r.tipo, r.tamanho, r.decimal, r.titulo, r.descricao, r.usado, r.ordem, agora, agora);
    }
  })(registros);

  return db.prepare('SELECT COUNT(*) AS n FROM protheus_sx3 WHERE connection_id = ?').get(conexaoId).n;
}

module.exports._normalizarRegistroSX3 = _normalizarRegistroSX3;

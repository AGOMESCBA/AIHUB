'use strict';

const { getDB }          = require('../../database');
const { requireRotina }  = require('../../permissions');
const { getEmpresaId }   = require('../../empresa-context');
const connectionFactory  = require('../providers/connection-factory');

function _invalidarMetaSX2(empresaId) {
  try { require('../ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
}

module.exports = function registrar(app, { requireAuth, requireIaCommand }) {
  const canSX2 = requireRotina('iac-admin-protheus-sx2');
  const eid    = req => getEmpresaId(req);

  // ── LIST (empresa inteira, conexao_id opcional) ───────────────────────────
  app.get('/api/ia-command/protheus/sx2',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      try {
        const { conexao_id } = req.query;
        const empresaId = eid(req);
        const rows = conexao_id
          ? getDB().prepare('SELECT * FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ? ORDER BY chave ASC').all(conexao_id, empresaId)
          : getDB().prepare('SELECT * FROM protheus_sx2 WHERE empresa_id = ? ORDER BY connection_id, chave ASC').all(empresaId);
        res.json(rows);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── LISTAR TABELAS SX2* DO BANCO ─────────────────────────────────────────
  app.get('/api/ia-command/protheus/sx2/tabelas-disponiveis',
    requireAuth, requireIaCommand, canSX2,
    async (req, res) => {
      const { conexao_id } = req.query;
      if (!conexao_id) return res.status(400).json({ error: 'Informe conexao_id.' });

      const conn = _verificarConexao(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });
      if (conn.tipo === 'api_proxy') {
        return res.status(400).json({ error: 'Conexão via API Proxy não permite listar tabelas. Use a opção de arquivo DBF.' });
      }

      const sql = _sqlListarTabelasSX2(conn.tipo);
      try {
        const rows = await connectionFactory.executar(conn, sql, {});
        const tabelas = rows.map(r => r.TABLE_NAME || r.table_name || r.name || Object.values(r)[0]).filter(Boolean);
        res.json(tabelas);
      } catch (e) {
        res.status(502).json({ error: `Erro ao listar tabelas: ${e.message}` });
      }
    }
  );

  // ── RELOAD DO BANCO (tabela selecionada) ──────────────────────────────────
  app.post('/api/ia-command/protheus/sx2/reload',
    requireAuth, requireIaCommand, canSX2,
    async (req, res) => {
      const { conexao_id, tabela, limpar = true } = req.body || {};
      if (!conexao_id || !tabela) return res.status(400).json({ error: 'Informe conexao_id e tabela.' });

      const conn = _verificarConexao(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

      let rows;
      try {
        rows = await connectionFactory.executar(conn, `SELECT * FROM ${tabela}`, {});
      } catch (e) {
        return res.status(502).json({ error: `Falha ao consultar ${tabela}: ${e.message}` });
      }

      if (!rows || rows.length === 0) {
        return res.json({ importados: 0, aviso: `A tabela ${tabela} não retornou registros.` });
      }

      const total = _salvarRegistros(conexao_id, eid(req), rows.map(r => ({
        chave:    (r.X2_CHAVE   || r.x2_chave   || '').toString().trim(),
        arquivo:  (r.X2_ARQUIVO || r.x2_arquivo || r.X2_CHAVE || r.x2_chave || '').toString().trim(),
        modo:     (r.X2_MODO    || r.x2_modo    || 'E').toString().trim() || 'E',
        descricao:(r.X2_NOME    || r.x2_nome    || r.X2_DESCRI || r.x2_descri || '').toString().trim(),
      })), limpar !== false);

      _invalidarMetaSX2(eid(req));
      res.json({ importados: total });
    }
  );

  // ── IMPORTAR DE ARQUIVO SDB (SQLite exportado pelo Protheus) ─────────────
  app.post('/api/ia-command/protheus/sx2/import-sdb',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      const fs   = require('fs');
      const path = require('path');
      const os   = require('os');
      const { pipeline } = require('stream/promises');

      const conexaoId = req.query.conexao_id;
      const limpar    = req.query.limpar !== 'false';
      const tmp       = path.join(os.tmpdir(), `sx2_import_${Date.now()}.sdb`);

      if (!conexaoId) return res.status(400).json({ error: 'Informe conexao_id.' });
      const conn = _verificarConexao(conexaoId, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

      const out = fs.createWriteStream(tmp);
      pipeline(req, out)
        .then(() => {
          const sdb = new (require('better-sqlite3'))(tmp, { readonly: true });
          let rows;
          try {
            rows = sdb.prepare("SELECT * FROM localfile WHERE D_E_L_E_T_ != '*'").all();
          } finally {
            sdb.close();
          }
          if (!rows || rows.length === 0) {
            return res.json({ importados: 0, aviso: 'O arquivo SDB não contém registros na tabela localfile.' });
          }
          const registros = rows.map(r => ({
            chave:    (r.X2_CHAVE   || '').toString().trim(),
            arquivo:  (r.X2_ARQUIVO || r.X2_CHAVE || '').toString().trim(),
            modo:     (r.X2_MODO    || 'E').toString().trim() || 'E',
            descricao:(r.X2_NOME    || '').toString().trim(),
          }));
          const total = _salvarRegistros(conexaoId, eid(req), registros, limpar);
          _invalidarMetaSX2(eid(req));
          res.json({ importados: total });
        })
        .catch(e => res.status(500).json({ error: e.message }))
        .finally(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
    }
  );

  // ── IMPORTAR DO CLIENTE (DBF parseado no browser) ─────────────────────────
  app.post('/api/ia-command/protheus/sx2/import',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      try {
        const { conexao_id, registros, limpar = true } = req.body || {};
        if (!conexao_id || !Array.isArray(registros)) {
          return res.status(400).json({ error: 'Informe conexao_id e registros (array).' });
        }
        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

        const total = _salvarRegistros(conexao_id, eid(req), registros, limpar !== false);
        _invalidarMetaSX2(eid(req));
        res.json({ importados: total });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.post('/api/ia-command/protheus/sx2',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      try {
        const { conexao_id, chave, arquivo, modo, descricao } = req.body || {};
        if (!conexao_id || !chave) return res.status(400).json({ error: 'conexao_id e chave são obrigatórios.' });

        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

        const chaveFmt   = chave.toUpperCase().trim();
        const arquivoFmt = (arquivo || chave).toUpperCase().trim();
        const db = getDB();
        const agora = new Date().toISOString();

        if (db.prepare('SELECT id FROM protheus_sx2 WHERE connection_id = ? AND chave = ?').get(conexao_id, chaveFmt)) {
          return res.status(409).json({ error: `Tabela "${chaveFmt}" já existe nesta conexão.` });
        }

        const info = db.prepare(
          'INSERT INTO protheus_sx2 (connection_id, empresa_id, chave, arquivo, modo, descricao, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)'
        ).run(conexao_id, eid(req), chaveFmt, arquivoFmt, (modo || 'E').trim(), descricao || '', agora, agora);

        _invalidarMetaSX2(eid(req));
        res.status(201).json(db.prepare('SELECT * FROM protheus_sx2 WHERE id = ?').get(info.lastInsertRowid));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── UPDATE ────────────────────────────────────────────────────────────────
  app.put('/api/ia-command/protheus/sx2/:id',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      try {
        const db  = getDB();
        const row = db.prepare('SELECT * FROM protheus_sx2 WHERE id = ?').get(req.params.id);
        if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });

        const { chave, arquivo, modo, descricao } = req.body || {};
        const agora      = new Date().toISOString();
        const chaveFmt   = (chave   || row.chave).toUpperCase().trim();
        const arquivoFmt = (arquivo || row.arquivo || chaveFmt).toUpperCase().trim();
        db.prepare('UPDATE protheus_sx2 SET chave=?, arquivo=?, modo=?, descricao=?, atualizado_em=? WHERE id=?').run(
          chaveFmt, arquivoFmt,
          (modo || row.modo).trim(),
          descricao !== undefined ? descricao : row.descricao,
          agora, row.id
        );
        _invalidarMetaSX2(eid(req));
        res.json(db.prepare('SELECT * FROM protheus_sx2 WHERE id = ?').get(row.id));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── DELETE ────────────────────────────────────────────────────────────────
  app.delete('/api/ia-command/protheus/sx2/:id',
    requireAuth, requireIaCommand, canSX2,
    (req, res) => {
      try {
        const db  = getDB();
        const row = db.prepare('SELECT * FROM protheus_sx2 WHERE id = ?').get(req.params.id);
        if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
        db.prepare('DELETE FROM protheus_sx2 WHERE id = ?').run(row.id);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _verificarConexao(conexaoId, empresaId) {
  const row = getDB().prepare('SELECT * FROM connections WHERE id = ?').get(conexaoId);
  return row && row.empresa_id === empresaId ? row : null;
}

function _sqlListarTabelasSX2(tipo) {
  if (tipo === 'sqlite') {
    return "SELECT name AS TABLE_NAME FROM sqlite_master WHERE type='table' AND name LIKE 'SX2%' ORDER BY name";
  }
  if (tipo === 'postgresql' || tipo === 'postgres') {
    return "SELECT table_name AS TABLE_NAME FROM information_schema.tables WHERE table_name LIKE 'sx2%' AND table_type='BASE TABLE' ORDER BY table_name";
  }
  return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'SX2%' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME";
}

function _salvarRegistros(conexaoId, empresaId, registros, limpar = true) {
  const db    = getDB();
  const agora = new Date().toISOString();
  const del   = db.prepare('DELETE FROM protheus_sx2 WHERE connection_id = ?');
  const ins   = limpar
    ? db.prepare('INSERT OR IGNORE INTO protheus_sx2 (connection_id, empresa_id, chave, arquivo, modo, descricao, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)')
    : db.prepare(`INSERT INTO protheus_sx2 (connection_id, empresa_id, chave, arquivo, modo, descricao, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(connection_id, chave) DO UPDATE SET
          arquivo=excluded.arquivo, modo=excluded.modo, descricao=excluded.descricao, atualizado_em=excluded.atualizado_em`);

  db.transaction((recs) => {
    if (limpar) del.run(conexaoId);
    for (const r of recs) {
      const chave   = (r.chave   || '').toString().trim().toUpperCase();
      const arquivo = (r.arquivo || chave).toString().trim().toUpperCase();
      const modo    = (r.modo    || 'E').toString().trim() || 'E';
      const desc    = (r.descricao || '').toString().trim();
      if (!chave) continue;
      ins.run(conexaoId, empresaId, chave, arquivo, modo, desc, agora, agora);
    }
  })(registros);

  return db.prepare('SELECT COUNT(*) as n FROM protheus_sx2 WHERE connection_id = ?').get(conexaoId).n;
}

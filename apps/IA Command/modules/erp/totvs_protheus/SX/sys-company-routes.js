'use strict';

// Dicionario SYS_COMPANY do Protheus — cadastro de filiais para instalacoes com
// dicionario no banco (grupos onde mais de uma empresa juridica compartilha as
// mesmas tabelas fisicas). Espelha exatamente o padrao de sx2-routes.js.
//
// So habilitado quando a empresa esta configurada como LOBO_GUARA no Middleware
// SQL — em TRADICIONAL essa tabela normalmente nem existe na base.

const { getDB }          = require('../../../database');
const { requireRotina }  = require('../../../permissions');
const { getEmpresaId }   = require('../../../empresa-context');
const connectionFactory  = require('../../providers/connection-factory');

function _invalidarMetaSX2(empresaId) {
  try { require('../../ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
}

function _modeloDadosEmpresa(empresaId) {
  try {
    const row = getDB().prepare(
      "SELECT config FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
    const cfg = row?.config ? JSON.parse(row.config) : {};
    return cfg.modelo_dados || 'TRADICIONAL';
  } catch (_) {
    return 'TRADICIONAL';
  }
}

function _exigirLoboGuara(req, res, next) {
  const empresaId = getEmpresaId(req);
  if (_modeloDadosEmpresa(empresaId) !== 'LOBO_GUARA') {
    return res.status(400).json({ error: 'Esta rotina só está disponível quando a empresa está configurada como LOBO_GUARA (Middleware SQL Protheus).' });
  }
  next();
}

// Resolve a conexão de forma EXECUTÁVEL — diferente de ler a linha crua de
// `connections` (_verificarConexao), que não monta a URL real do Agente Local
// quando a conexão é do tipo api_proxy (o campo `host` da tabela é só um label,
// ex: "agente-local" — a URL real vem de ai_config.agente_local_url e só é
// montada por connectionFactory.carregarConexao/_montarApiProxy). Usar a linha
// crua nesse caso gera "Invalid URL" ao chamar o agente.
function _conexaoExecutavel(conexaoId, empresaId) {
  const row = getDB().prepare('SELECT * FROM connections WHERE id = ?').get(conexaoId);
  if (!row || row.empresa_id !== empresaId) return null;
  return connectionFactory.carregarConexao(empresaId, { sistemaOrigem: 'protheus' });
}

module.exports = function registrar(app, { requireAuth, requireIaCommand }) {
  const canCompany = requireRotina('iac-admin-protheus-sys-company');
  const eid = req => getEmpresaId(req);

  // ── LIST (empresa inteira, conexao_id opcional) ───────────────────────────
  app.get('/api/ia-command/protheus/sys-company',
    requireAuth, requireIaCommand, canCompany,
    (req, res) => {
      try {
        const { conexao_id } = req.query;
        const empresaId = eid(req);
        const rows = conexao_id
          ? getDB().prepare('SELECT * FROM protheus_company_tree WHERE connection_id = ? AND empresa_id = ? ORDER BY grupo_codigo, filial_chave').all(conexao_id, empresaId)
          : getDB().prepare('SELECT * FROM protheus_company_tree WHERE empresa_id = ? ORDER BY connection_id, grupo_codigo, filial_chave').all(empresaId);
        res.json(rows);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── LISTAR TABELAS SYS_COMPANY* DO BANCO ─────────────────────────────────
  app.get('/api/ia-command/protheus/sys-company/tabelas-disponiveis',
    requireAuth, requireIaCommand, canCompany, _exigirLoboGuara,
    async (req, res) => {
      const { conexao_id } = req.query;
      if (!conexao_id) return res.status(400).json({ error: 'Informe conexao_id.' });

      const conn = _conexaoExecutavel(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });
      if (conn.tipo === 'api_proxy') {
        return res.status(400).json({ error: 'Conexão via API Proxy não permite listar tabelas. Use a opção de arquivo DBF/SDB.' });
      }

      const sql = _sqlListarTabelas(conn.tipo);
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
  app.post('/api/ia-command/protheus/sys-company/reload',
    requireAuth, requireIaCommand, canCompany, _exigirLoboGuara,
    async (req, res) => {
      const { conexao_id, tabela, grupo_codigo, limpar = true } = req.body || {};
      if (!conexao_id || !tabela || !grupo_codigo) return res.status(400).json({ error: 'Informe conexao_id, tabela e grupo_codigo.' });

      const conn = _conexaoExecutavel(conexao_id, eid(req));
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

      const registros = rows.map(r => _normalizarLinha(r, grupo_codigo)).filter(Boolean);
      const total = _salvarRegistros(conexao_id, eid(req), registros, limpar !== false);
      _invalidarMetaSX2(eid(req));
      res.json({ importados: total });
    }
  );

  // ── IMPORTAR DE ARQUIVO SDB (SQLite exportado pelo Protheus) ─────────────
  app.post('/api/ia-command/protheus/sys-company/import-sdb',
    requireAuth, requireIaCommand, canCompany, _exigirLoboGuara,
    (req, res) => {
      const fs   = require('fs');
      const path = require('path');
      const os   = require('os');
      const { pipeline } = require('stream/promises');

      const conexaoId  = req.query.conexao_id;
      const grupoCodigo = req.query.grupo_codigo;
      const limpar     = req.query.limpar !== 'false';
      const tmp        = path.join(os.tmpdir(), `sys_company_import_${Date.now()}.sdb`);

      if (!conexaoId || !grupoCodigo) return res.status(400).json({ error: 'Informe conexao_id e grupo_codigo.' });
      const conn = _verificarConexao(conexaoId, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

      const out = fs.createWriteStream(tmp);
      pipeline(req, out)
        .then(() => {
          const sdb = new (require('better-sqlite3'))(tmp, { readonly: true });
          let rows;
          try {
            rows = sdb.prepare("SELECT * FROM localfile WHERE COALESCE(D_E_L_E_T_,'') != '*'").all();
          } finally {
            sdb.close();
          }
          if (!rows || rows.length === 0) {
            return res.json({ importados: 0, aviso: 'O arquivo SDB não contém registros na tabela localfile.' });
          }
          const registros = rows.map(r => _normalizarLinha(r, grupoCodigo)).filter(Boolean);
          const total = _salvarRegistros(conexaoId, eid(req), registros, limpar);
          _invalidarMetaSX2(eid(req));
          res.json({ importados: total });
        })
        .catch(e => { if (!res.headersSent) res.status(500).json({ error: e.message }); })
        .finally(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
    }
  );

  // ── IMPORTAR DO CLIENTE (DBF parseado no browser) ─────────────────────────
  app.post('/api/ia-command/protheus/sys-company/import',
    requireAuth, requireIaCommand, canCompany, _exigirLoboGuara,
    (req, res) => {
      try {
        const { conexao_id, grupo_codigo, registros, limpar = true } = req.body || {};
        if (!conexao_id || !grupo_codigo || !Array.isArray(registros)) {
          return res.status(400).json({ error: 'Informe conexao_id, grupo_codigo e registros (array).' });
        }
        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

        const normalizados = registros.map(r => _normalizarLinha(r, grupo_codigo)).filter(Boolean);
        const total = _salvarRegistros(conexao_id, eid(req), normalizados, limpar !== false);
        _invalidarMetaSX2(eid(req));
        res.json({ importados: total });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── DELETE (um registro) ───────────────────────────────────────────────────
  app.delete('/api/ia-command/protheus/sys-company/:id',
    requireAuth, requireIaCommand, canCompany,
    (req, res) => {
      try {
        const db  = getDB();
        const row = db.prepare('SELECT * FROM protheus_company_tree WHERE id = ?').get(req.params.id);
        if (!row || row.empresa_id !== eid(req)) return res.status(404).json({ error: 'Não encontrado.' });
        db.prepare('DELETE FROM protheus_company_tree WHERE id = ?').run(row.id);
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

function _sqlListarTabelas(tipo) {
  if (tipo === 'sqlite') {
    return "SELECT name AS TABLE_NAME FROM sqlite_master WHERE type='table' AND name LIKE 'SYS_COMPANY%' ORDER BY name";
  }
  if (tipo === 'postgresql' || tipo === 'postgres') {
    return "SELECT table_name AS TABLE_NAME FROM information_schema.tables WHERE table_name ILIKE 'sys_company%' AND table_type='BASE TABLE' ORDER BY table_name";
  }
  return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'SYS_COMPANY%' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME";
}

// SYS_COMPANY (M0_*) so descreve filiais — nao tem tipo de no explicito.
// Confirmado com dado real da Plantivo: M0_CODFIL e o codigo completo que bate
// com o campo de filial das tabelas de negocio (ex: D2_FILIAL).
function _normalizarLinha(r = {}, grupoCodigo) {
  const m0CodFil = String(r.M0_CODFIL || r.m0_codfil || '').trim();
  return {
    grupo_codigo: grupoCodigo,
    filial_chave: m0CodFil,
    nome: String(r.M0_FILIAL || r.m0_filial || '').trim(),
    cnpj: String(r.M0_CGC || r.m0_cgc || '').trim(),
  };
}

function _uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function _salvarRegistros(conexaoId, empresaId, registros, limpar = true) {
  const db    = getDB();
  const agora = new Date().toISOString();
  // Apaga so os registros de ORIGEM SYS_COMPANY desta conexao — preserva os que
  // vieram de SYS_COMPANY_CFG (tela dedicada), que tem hierarquia mais completa.
  const del = db.prepare("DELETE FROM protheus_company_tree WHERE connection_id = ? AND origem = 'sys_company'");
  const ins = db.prepare(`
    INSERT INTO protheus_company_tree
      (id, connection_id, empresa_id, grupo_codigo, empresa_codigo, unidade_codigo,
       filial_codigo, filial_chave, tipo_no, nome, cnpj, ativo, origem, criado_em, atualizado_em)
    VALUES (?,?,?,?,NULL,NULL,?,?,'filial',?,?,1,'sys_company',?,?)
    ON CONFLICT(connection_id, filial_chave) DO UPDATE SET
      grupo_codigo=excluded.grupo_codigo, filial_codigo=excluded.filial_codigo,
      nome=excluded.nome, cnpj=excluded.cnpj, atualizado_em=excluded.atualizado_em
  `);

  db.transaction((recs) => {
    if (limpar) del.run(conexaoId);
    for (const r of recs) {
      if (!r.filial_chave) continue;
      ins.run(_uuid(), conexaoId, empresaId, r.grupo_codigo, r.filial_chave, r.filial_chave, r.nome || null, r.cnpj || null, agora, agora);
    }
  })(registros);

  return db.prepare("SELECT COUNT(*) as n FROM protheus_company_tree WHERE connection_id = ? AND origem = 'sys_company'").get(conexaoId).n;
}

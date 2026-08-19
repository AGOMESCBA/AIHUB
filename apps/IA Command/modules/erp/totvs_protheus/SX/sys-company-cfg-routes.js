'use strict';

// Dicionario SYS_COMPANY_CFG do Protheus — hierarquia completa (Grupo/Empresa/
// Unidade/Filial via XX8_TIPO) para instalacoes com dicionario no banco.
// Espelha exatamente o padrao de sx3-routes.js.
//
// Nomes de campo (XX8_*) e valores de XX8_TIPO por nivel variam por instalacao
// — nunca assumir, sempre confirmar contra o schema real antes de importar.
// So habilitado quando a empresa esta configurada como LOBO_GUARA.

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
  const canCompanyCfg = requireRotina('iac-admin-protheus-sys-company-cfg');
  const eid = req => getEmpresaId(req);

  app.get('/api/ia-command/protheus/sys-company-cfg',
    requireAuth, requireIaCommand, canCompanyCfg,
    (req, res) => {
      try {
        const { conexao_id } = req.query;
        const empresaId = eid(req);
        const rows = conexao_id
          ? getDB().prepare("SELECT * FROM protheus_company_tree WHERE connection_id = ? AND empresa_id = ? AND origem = 'sys_company_cfg' ORDER BY grupo_codigo, empresa_codigo, unidade_codigo, filial_codigo").all(conexao_id, empresaId)
          : getDB().prepare("SELECT * FROM protheus_company_tree WHERE empresa_id = ? AND origem = 'sys_company_cfg' ORDER BY connection_id, grupo_codigo, empresa_codigo, unidade_codigo, filial_codigo").all(empresaId);
        res.json(rows);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── Perfil de campos (nomes XX8_* desta instalação) ─────────────────────────
  app.get('/api/ia-command/protheus/sys-company-cfg/perfil',
    requireAuth, requireIaCommand, canCompanyCfg,
    (req, res) => {
      try {
        const { conexao_id } = req.query;
        if (!conexao_id) return res.status(400).json({ error: 'Informe conexao_id.' });
        const perfil = getDB().prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(conexao_id);
        res.json(perfil || null);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.put('/api/ia-command/protheus/sys-company-cfg/perfil',
    requireAuth, requireIaCommand, canCompanyCfg,
    (req, res) => {
      try {
        const empresaId = eid(req);
        const { conexao_id, field_map } = req.body || {};
        if (!conexao_id) return res.status(400).json({ error: 'Informe conexao_id.' });
        const conn = _verificarConexao(conexao_id, empresaId);
        if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

        const perfil = _salvarPerfil(conexao_id, empresaId, field_map || {});
        res.json(perfil);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── LISTAR TABELAS SYS_COMPANY_CFG* DO BANCO ────────────────────────────────
  app.get('/api/ia-command/protheus/sys-company-cfg/tabelas-disponiveis',
    requireAuth, requireIaCommand, canCompanyCfg, _exigirLoboGuara,
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
  app.post('/api/ia-command/protheus/sys-company-cfg/reload',
    requireAuth, requireIaCommand, canCompanyCfg, _exigirLoboGuara,
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

      const perfil = getDB().prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(conexao_id);
      const fieldMap = perfil?.field_map_json ? JSON.parse(perfil.field_map_json) : {};

      const registros = rows.map(r => _normalizarLinha(r, fieldMap, grupo_codigo)).filter(Boolean);
      const total = _salvarRegistros(conexao_id, eid(req), registros, limpar !== false);
      _invalidarMetaSX2(eid(req));
      res.json({ importados: total });
    }
  );

  // ── IMPORTAR DE ARQUIVO SDB ────────────────────────────────────────────────
  app.post('/api/ia-command/protheus/sys-company-cfg/import-sdb',
    requireAuth, requireIaCommand, canCompanyCfg, _exigirLoboGuara,
    (req, res) => {
      const fs   = require('fs');
      const path = require('path');
      const os   = require('os');
      const { pipeline } = require('stream/promises');

      const conexaoId   = req.query.conexao_id;
      const grupoCodigo = req.query.grupo_codigo;
      const limpar      = req.query.limpar !== 'false';
      const tmp         = path.join(os.tmpdir(), `sys_company_cfg_import_${Date.now()}.sdb`);

      if (!conexaoId || !grupoCodigo) return res.status(400).json({ error: 'Informe conexao_id e grupo_codigo.' });
      const conn = _verificarConexao(conexaoId, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

      const perfil = getDB().prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(conexaoId);
      const fieldMap = perfil?.field_map_json ? JSON.parse(perfil.field_map_json) : {};

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
          const registros = rows.map(r => _normalizarLinha(r, fieldMap, grupoCodigo)).filter(Boolean);
          const total = _salvarRegistros(conexaoId, eid(req), registros, limpar);
          _invalidarMetaSX2(eid(req));
          res.json({ importados: total });
        })
        .catch(e => { if (!res.headersSent) res.status(500).json({ error: e.message }); })
        .finally(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
    }
  );

  // ── IMPORTAR DO CLIENTE (DBF parseado no browser) ─────────────────────────
  app.post('/api/ia-command/protheus/sys-company-cfg/import',
    requireAuth, requireIaCommand, canCompanyCfg, _exigirLoboGuara,
    (req, res) => {
      try {
        const { conexao_id, grupo_codigo, registros, limpar = true } = req.body || {};
        if (!conexao_id || !grupo_codigo || !Array.isArray(registros)) {
          return res.status(400).json({ error: 'Informe conexao_id, grupo_codigo e registros (array).' });
        }
        const conn = _verificarConexao(conexao_id, eid(req));
        if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

        const perfil = getDB().prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(conexao_id);
        const fieldMap = perfil?.field_map_json ? JSON.parse(perfil.field_map_json) : {};

        const normalizados = registros.map(r => _normalizarLinha(r, fieldMap, grupo_codigo)).filter(Boolean);
        const total = _salvarRegistros(conexao_id, eid(req), normalizados, limpar !== false);
        _invalidarMetaSX2(eid(req));
        res.json({ importados: total });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.delete('/api/ia-command/protheus/sys-company-cfg/:id',
    requireAuth, requireIaCommand, canCompanyCfg,
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

  // ── VALIDAR — Fase 0.5/3 do plano: so libera uso automatico se 100% limpo ──
  app.post('/api/ia-command/protheus/sys-company-cfg/validar',
    requireAuth, requireIaCommand, canCompanyCfg, _exigirLoboGuara,
    async (req, res) => {
      const { conexao_id, grupo_codigo, tabela_negocio, campo_filial } = req.body || {};
      if (!conexao_id || !grupo_codigo || !tabela_negocio || !campo_filial) {
        return res.status(400).json({ error: 'Informe conexao_id, grupo_codigo, tabela_negocio e campo_filial.' });
      }
      const conn = _conexaoExecutavel(conexao_id, eid(req));
      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada.' });

      const db = getDB();
      const erros = [];

      const duplicadas = db.prepare(`
        SELECT filial_chave, COUNT(*) AS n FROM protheus_company_tree
         WHERE connection_id = ? AND grupo_codigo = ? AND tipo_no = 'filial'
         GROUP BY filial_chave HAVING COUNT(*) > 1
      `).all(conexao_id, grupo_codigo);
      if (duplicadas.length) erros.push(`filial_chave duplicada dentro do grupo: ${duplicadas.map(d => d.filial_chave).join(', ')}`);

      let valoresNegocio = [];
      try {
        const rows = await connectionFactory.executar(conn, `SELECT DISTINCT ${campo_filial} AS v FROM ${tabela_negocio}`, {});
        valoresNegocio = rows.map(r => String(r.v || '').trim()).filter(Boolean);
      } catch (e) {
        return res.status(502).json({ error: `Falha ao consultar ${tabela_negocio}: ${e.message}` });
      }

      const chavesArvore = new Set(
        db.prepare(`SELECT filial_chave FROM protheus_company_tree WHERE connection_id = ? AND grupo_codigo = ? AND tipo_no = 'filial'`)
          .all(conexao_id, grupo_codigo).map(r => r.filial_chave)
      );
      const semCorrespondencia = valoresNegocio.filter(v => !chavesArvore.has(v));
      if (semCorrespondencia.length) erros.push(`Valores de ${campo_filial} sem correspondência: ${semCorrespondencia.join(', ')}`);

      const validated = erros.length === 0;
      const agora = new Date().toISOString();
      // Upsert: a linha de perfil pode não existir ainda (ex.: nomes de campo
      // padrão XX8_* bateram sem precisar abrir "Perfil de campos" para editar
      // manualmente) — UPDATE sozinho não criava a linha nesse caso, fazendo a
      // validação "passar" na tela sem nunca persistir validated=true.
      const existente = db.prepare('SELECT id FROM protheus_company_profile WHERE connection_id = ?').get(conexao_id);
      if (existente) {
        db.prepare(`
          UPDATE protheus_company_profile
             SET validated = ?, validation_errors_json = ?, branch_key_strategy = ?, atualizado_em = ?
           WHERE connection_id = ?
        `).run(validated ? 1 : 0, erros.length ? JSON.stringify(erros) : null, validated ? 'igualdade_direta' : 'nao_descoberta', agora, conexao_id);
      } else {
        db.prepare(`
          INSERT INTO protheus_company_profile
            (id, connection_id, empresa_id, company_table, company_cfg_table, field_map_json,
             branch_key_strategy, validated, validation_errors_json, criado_em, atualizado_em)
          VALUES (?,?,?, 'SYS_COMPANY', 'SYS_COMPANY_CFG', '{}', ?, ?, ?, ?, ?)
        `).run(
          _uuid(), conexao_id, eid(req),
          validated ? 'igualdade_direta' : 'nao_descoberta',
          validated ? 1 : 0,
          erros.length ? JSON.stringify(erros) : null,
          agora, agora
        );
      }

      res.json({ validated, erros, total_valores_negocio: valoresNegocio.length, total_filiais_arvore: chavesArvore.size });
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
    return "SELECT name AS TABLE_NAME FROM sqlite_master WHERE type='table' AND name LIKE 'SYS_COMPANY_CFG%' ORDER BY name";
  }
  if (tipo === 'postgresql' || tipo === 'postgres') {
    return "SELECT table_name AS TABLE_NAME FROM information_schema.tables WHERE table_name ILIKE 'sys_company_cfg%' AND table_type='BASE TABLE' ORDER BY table_name";
  }
  return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'SYS_COMPANY_CFG%' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME";
}

function _uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function _salvarPerfil(connectionId, empresaId, fieldMap) {
  const db = getDB();
  const agora = new Date().toISOString();
  const existente = db.prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(connectionId);
  const fieldMapJson = JSON.stringify(fieldMap || {});

  if (existente) {
    db.prepare('UPDATE protheus_company_profile SET field_map_json = ?, atualizado_em = ? WHERE id = ?')
      .run(fieldMapJson, agora, existente.id);
  } else {
    db.prepare(`
      INSERT INTO protheus_company_profile
        (id, connection_id, empresa_id, company_table, company_cfg_table, field_map_json, branch_key_strategy, validated, criado_em, atualizado_em)
      VALUES (?,?,?, 'SYS_COMPANY', 'SYS_COMPANY_CFG', ?, 'nao_descoberta', 0, ?, ?)
    `).run(_uuid(), connectionId, empresaId, fieldMapJson, agora, agora);
  }
  return db.prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(connectionId);
}

// Mapeia linhas de SYS_COMPANY_CFG (XX8_*) respeitando o field_map configurado.
// Nomes de campo e valores de tipo de no confirmados como variaveis por
// instalacao — nunca assumir XX8_* como universal (ver historico de fontes
// externas descartadas em memoria: duas fontes se contradisseram sobre isso).
function _normalizarLinha(row, fieldMap, grupoCodigo) {
  const f = fieldMap || {};
  const campoTipo   = f.campo_tipo_no    || 'XX8_TIPO';
  const campoEmpr   = f.campo_empresa    || 'XX8_EMPR';
  const campoUnid   = f.campo_unidade    || 'XX8_UNID';
  const campoFilial = f.campo_filial     || 'XX8_CODIGO';
  const campoDescr  = f.campo_descricao  || 'XX8_DESCRI';
  const tipoNoFilial  = String(f.tipo_no_filial  ?? '3').trim();
  const tipoNoEmpresa = String(f.tipo_no_empresa ?? '1').trim();
  const tipoNoUnidade = String(f.tipo_no_unidade ?? '2').trim();

  const tipo = String(row[campoTipo] ?? '').trim();
  const empr = String(row[campoEmpr] ?? '').trim();
  const unid = String(row[campoUnid] ?? '').trim();
  const cod  = String(row[campoFilial] ?? '').trim();
  const descricao = String(row[campoDescr] ?? '').trim() || null;

  if (tipo === tipoNoFilial) {
    if (!empr || !unid || !cod) return null;
    return { grupo_codigo: grupoCodigo, empresa_codigo: empr, unidade_codigo: unid, filial_codigo: cod, filial_chave: `${empr}${unid}${cod}`, tipo_no: 'filial', nome: descricao };
  }
  if (tipo === tipoNoEmpresa) {
    if (!cod) return null;
    return { grupo_codigo: grupoCodigo, empresa_codigo: cod, unidade_codigo: null, filial_codigo: null, filial_chave: `EMP:${grupoCodigo}:${cod}`, tipo_no: 'empresa', nome: descricao };
  }
  if (tipo === tipoNoUnidade) {
    if (!empr || !cod) return null;
    return { grupo_codigo: grupoCodigo, empresa_codigo: empr, unidade_codigo: cod, filial_codigo: null, filial_chave: `UNI:${grupoCodigo}:${empr}:${cod}`, tipo_no: 'unidade', nome: descricao };
  }
  return null; // tipo 0 (grupo) ou desconhecido
}

function _salvarRegistros(conexaoId, empresaId, registros, limpar = true) {
  const db = getDB();
  const agora = new Date().toISOString();
  const del = db.prepare("DELETE FROM protheus_company_tree WHERE connection_id = ? AND origem = 'sys_company_cfg'");
  const ins = db.prepare(`
    INSERT INTO protheus_company_tree
      (id, connection_id, empresa_id, grupo_codigo, empresa_codigo, unidade_codigo,
       filial_codigo, filial_chave, tipo_no, nome, cnpj, ativo, origem, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,NULL,1,'sys_company_cfg',?,?)
    ON CONFLICT(connection_id, filial_chave) DO UPDATE SET
      grupo_codigo=excluded.grupo_codigo, empresa_codigo=excluded.empresa_codigo,
      unidade_codigo=excluded.unidade_codigo, filial_codigo=excluded.filial_codigo,
      tipo_no=excluded.tipo_no, nome=excluded.nome, atualizado_em=excluded.atualizado_em
  `);

  db.transaction((recs) => {
    if (limpar) del.run(conexaoId);
    for (const r of recs) {
      if (!r || !r.filial_chave) continue;
      ins.run(_uuid(), conexaoId, empresaId, r.grupo_codigo, r.empresa_codigo, r.unidade_codigo, r.filial_codigo, r.filial_chave, r.tipo_no, r.nome, agora, agora);
    }
  })(registros);

  return db.prepare("SELECT COUNT(*) as n FROM protheus_company_tree WHERE connection_id = ? AND origem = 'sys_company_cfg'").get(conexaoId).n;
}

'use strict';

// Dicionario SYS_COMPANY_CFG do Protheus — hierarquia completa (Grupo/Empresa/
// Unidade/Filial via XX8_TIPO) para instalacoes com dicionario no banco.
// Espelha exatamente o padrao de sx3-routes.js.
//
// Nomes de campo (XX8_*) e valores de XX8_TIPO por nivel variam por instalacao
// — nunca assumir, sempre confirmar contra o schema real antes de importar.
//
// Cadastro oficial do ERP (empresas/filiais), disponivel independente do
// modelo_dados (TRADICIONAL ou LOBO_GUARA) da empresa: importar/validar aqui
// nao ativa nenhum filtro de SQL sozinho — isso so acontece quando
// modelo_dados=LOBO_GUARA E protheus_company_profile.validated=1
// simultaneamente (gate em lobo-guara-filial-resolver.js:contextoLoboGuara).

const { getDB }          = require('../../../database');
const { requireRotina }  = require('../../../permissions');
const { getEmpresaId }   = require('../../../empresa-context');
const connectionFactory  = require('../../providers/connection-factory');

function _invalidarMetaSX2(empresaId) {
  try { require('../../ia-owner/runner').invalidarMetaCache(empresaId); } catch (_) {}
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
    requireAuth, requireIaCommand, canCompanyCfg,
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

  // ── DETECTAR MAPEAMENTO — heuristica sobre os dados brutos, so sugere ──────
  // (nunca grava; front decide se aceita e clica "Salvar" no Perfil de campos)
  app.post('/api/ia-command/protheus/sys-company-cfg/detectar-mapeamento',
    requireAuth, requireIaCommand, canCompanyCfg,
    (req, res) => {
      try {
        const { registros } = req.body || {};
        if (!Array.isArray(registros) || !registros.length) {
          return res.status(400).json({ error: 'Informe registros (array) para detectar o mapeamento.' });
        }
        const deteccao = _detectarMapeamento(registros);
        res.json(deteccao);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ── RELOAD DO BANCO (tabela selecionada) ──────────────────────────────────
  app.post('/api/ia-command/protheus/sys-company-cfg/reload',
    requireAuth, requireIaCommand, canCompanyCfg,
    async (req, res) => {
      const { conexao_id, tabela, grupo_codigo, limpar = true, apenas_detectar } = req.body || {};
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

      if (apenas_detectar) {
        return res.json(_detectarMapeamento(rows));
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
    requireAuth, requireIaCommand, canCompanyCfg,
    (req, res) => {
      const fs   = require('fs');
      const path = require('path');
      const os   = require('os');
      const { pipeline } = require('stream/promises');

      const conexaoId      = req.query.conexao_id;
      const grupoCodigo    = req.query.grupo_codigo;
      const limpar         = req.query.limpar !== 'false';
      const apenasDetectar = req.query.apenas_detectar === 'true';
      const tmp            = path.join(os.tmpdir(), `sys_company_cfg_import_${Date.now()}.sdb`);

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
          if (apenasDetectar) {
            return res.json(_detectarMapeamento(rows));
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
    requireAuth, requireIaCommand, canCompanyCfg,
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
  // validated=1 sozinho nao ativa filtro de SQL: so tem efeito combinado com
  // modelo_dados=LOBO_GUARA (ver contextoLoboGuara em lobo-guara-filial-resolver.js).
  app.post('/api/ia-command/protheus/sys-company-cfg/validar',
    requireAuth, requireIaCommand, canCompanyCfg,
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

// Heuristica de deteccao do field_map a partir dos dados brutos exportados.
// So SUGERE — nunca grava. Necessaria porque XX8_TIPO/XX8_EMPR/XX8_GRPEMP tem
// papel fixo no dicionario Protheus (SX3), mas o DADO real de cada instalacao
// varia (nivel de unidade presente ou nao, vinculo por XX8_EMPR ou XX8_GRPEMP,
// codigo numerico do tipo variando por instalacao) — ver comentario de
// _normalizarLinha logo abaixo.
const CAMPOS_TIPO_CANDIDATOS   = ['XX8_TIPO'];
const CAMPOS_VINCULO_CANDIDATOS = ['XX8_EMPR', 'XX8_GRPEMP'];
const CAMPOS_UNIDADE_CANDIDATOS = ['XX8_UNID'];
const CAMPO_CODIGO   = 'XX8_CODIGO';
const CAMPO_DESCR    = 'XX8_DESCRI';

function _detectarMapeamento(registros) {
  const campoTipo = CAMPOS_TIPO_CANDIDATOS.find(c => registros.some(r => r[c] != null)) || 'XX8_TIPO';

  const tiposDistintos = [...new Set(registros.map(r => String(r[campoTipo] ?? '').trim()).filter(Boolean))];
  if (!tiposDistintos.length) {
    return { confianca: 'baixa', motivo: 'Nenhum valor de XX8_TIPO encontrado nos dados.', field_map: null };
  }

  // Nivel "raiz" (empresa): tipo cujas linhas tem TODOS os campos de vinculo
  // conhecidos vazios (nao aponta para ninguem).
  const semVinculoPorTipo = new Map();
  for (const tipo of tiposDistintos) {
    const linhas = registros.filter(r => String(r[campoTipo] ?? '').trim() === tipo);
    const semVinculo = linhas.filter(r =>
      [...CAMPOS_VINCULO_CANDIDATOS, ...CAMPOS_UNIDADE_CANDIDATOS].every(c => !String(r[c] ?? '').trim())
    ).length;
    semVinculoPorTipo.set(tipo, { total: linhas.length, semVinculo });
  }
  let tipoNoEmpresa = null;
  let melhorTaxaRaiz = 0;
  for (const [tipo, g] of semVinculoPorTipo) {
    const taxa = g.semVinculo / g.total;
    if (taxa >= 0.9 && taxa > melhorTaxaRaiz) { melhorTaxaRaiz = taxa; tipoNoEmpresa = tipo; }
  }
  if (!tipoNoEmpresa) {
    return { confianca: 'baixa', motivo: 'Nao foi possivel identificar um nivel de empresa consistente (nenhum valor de XX8_TIPO tem linhas sem vinculo).', field_map: null };
  }

  // Constroi o grafo por CAMADAS DE TIPO (nao por linha solta): codigos
  // Protheus se repetem entre niveis (ex: "01" existe como empresa, como
  // unidade E como filial ao mesmo tempo — sao namespaces distintos por
  // XX8_TIPO). Testar um valor de vinculo contra "qualquer codigo ja visto"
  // sem separar por tipo causa falso-positivo quando codigos colidem entre
  // niveis. A resolucao correta e' por camada: todo o TIPO inteiro so pode
  // pertencer a uma unica profundidade, resolvida testando contra os tipos
  // ja resolvidos na camada anterior (nunca contra "todos os codigos").
  const nos = registros.map(r => ({
    tipo: String(r[campoTipo] ?? '').trim(),
    codigo: String(r[CAMPO_CODIGO] ?? '').trim(),
    row: r,
  })).filter(n => n.tipo && n.codigo);

  const CAMPOS_VINCULO_TODOS = [...CAMPOS_VINCULO_CANDIDATOS, ...CAMPOS_UNIDADE_CANDIDATOS];
  const codigosPorTipoResolvido = new Map([[tipoNoEmpresa, new Set(nos.filter(n => n.tipo === tipoNoEmpresa).map(n => n.codigo))]]);
  if (!codigosPorTipoResolvido.get(tipoNoEmpresa).size) {
    return { confianca: 'baixa', motivo: 'Nivel de empresa identificado, mas sem codigos validos para cruzar com os demais niveis.', field_map: null };
  }

  const profundidadePorTipo = new Map([[tipoNoEmpresa, 0]]);
  const campoUsadoPorTipo = new Map();
  const tiposPendentes = new Set(tiposDistintos.filter(t => t !== tipoNoEmpresa));

  let mudou = true;
  let profundidadeAtual = 0;
  while (mudou && tiposPendentes.size) {
    mudou = false;
    // Codigos conhecidos ate agora, agrupados por profundidade <= atual —
    // um tipo da proxima camada deve apontar 100% para uma UNICA camada
    // ja resolvida (nao pode misturar avo e pai no mesmo tipo).
    for (const tipoCandidato of [...tiposPendentes]) {
      const linhasDoTipo = nos.filter(n => n.tipo === tipoCandidato);
      for (const campo of CAMPOS_VINCULO_TODOS) {
        const comValor = linhasDoTipo.filter(n => String(n.row[campo] ?? '').trim());
        if (comValor.length / linhasDoTipo.length < 0.9) continue;
        // testa contra cada profundidade ja resolvida isoladamente — precisa
        // bater 100% (>=90%) contra UMA UNICA profundidade, nao misturado.
        for (const [tipoPai, prof] of profundidadePorTipo) {
          const codigosPai = codigosPorTipoResolvido.get(tipoPai);
          const acertos = comValor.filter(n => codigosPai.has(String(n.row[campo]).trim())).length;
          if (acertos / linhasDoTipo.length >= 0.9) {
            profundidadePorTipo.set(tipoCandidato, prof + 1);
            campoUsadoPorTipo.set(tipoCandidato, campo);
            codigosPorTipoResolvido.set(tipoCandidato, new Set(linhasDoTipo.map(n => n.codigo)));
            tiposPendentes.delete(tipoCandidato);
            mudou = true;
            break;
          }
        }
        if (!tiposPendentes.has(tipoCandidato)) break;
      }
    }
    profundidadeAtual++;
    if (profundidadeAtual > 10) break;
  }

  // Adapta para o formato usado pelo restante da funcao (por-no).
  const profundidadePorNo = new Map();
  const campoUsadoPorNo = new Map();
  for (const n of nos) {
    const k = `${n.tipo}::${n.codigo}`;
    if (profundidadePorTipo.has(n.tipo)) profundidadePorNo.set(k, profundidadePorTipo.get(n.tipo));
    if (campoUsadoPorTipo.has(n.tipo)) campoUsadoPorNo.set(k, campoUsadoPorTipo.get(n.tipo));
  }

  // Taxa de resolucao por tipo: quantas linhas de cada tipo restante tiveram
  // profundidade resolvida (ou seja, um vinculo valido ate a raiz).
  const naoRaiz = tiposDistintos.filter(t => t !== tipoNoEmpresa);
  const statsPorTipo = new Map();
  for (const tipo of naoRaiz) {
    const nosDoTipo = nos.filter(n => n.tipo === tipo);
    const resolvidos = nosDoTipo.filter(n => profundidadePorNo.has(`${n.tipo}::${n.codigo}`));
    const profundidades = new Set(resolvidos.map(n => profundidadePorNo.get(`${n.tipo}::${n.codigo}`)));
    const camposUsados = new Set(resolvidos.map(n => campoUsadoPorNo.get(`${n.tipo}::${n.codigo}`)));
    statsPorTipo.set(tipo, {
      total: nosDoTipo.length,
      resolvidos: resolvidos.length,
      taxa: nosDoTipo.length ? resolvidos.length / nosDoTipo.length : 0,
      // profundidade/campo devem ser consistentes dentro do mesmo tipo —
      // senao o tipo mistura niveis diferentes (dado inconsistente).
      profundidadeUnica: profundidades.size === 1 ? [...profundidades][0] : null,
      campoUnico: camposUsados.size === 1 ? [...camposUsados][0] : null,
    });
  }

  const tiposValidos = naoRaiz.filter(t => {
    const s = statsPorTipo.get(t);
    return s.taxa >= 0.9 && s.profundidadeUnica != null;
  });
  if (!naoRaiz.length) {
    return { confianca: 'baixa', motivo: 'So ha linhas de empresa nos dados — nenhuma filial para importar.', field_map: null };
  }
  if (!tiposValidos.length) {
    return { confianca: 'baixa', motivo: 'Nao foi possivel resolver uma cadeia de vinculos consistente ate a raiz para nenhum tipo de no restante.', field_map: null };
  }

  // Diferenciar FILIAL de UNIDADE entre os tipos validos (ambos costumam
  // apontar DIRETO pra empresa em 1 salto no Protheus real — profundidade de
  // grafo nao diferencia os dois papeis aqui). Sinal correto: _normalizarLinha
  // exige que toda linha de filial tenha empresa+codigo preenchidos direto
  // nela (nao aceita cadeia indireta filial->unidade->empresa) — ou seja,
  // quem tem XX8_UNID consistentemente PREENCHIDO e' a FILIAL (referencia a
  // unidade mesmo sem precisar dela pra resolver a empresa); quem tem
  // XX8_UNID vazio e' a UNIDADE (ela PROPRIA e' o nivel intermediario).
  if (tiposValidos.length > 2) {
    return { confianca: 'baixa', motivo: `Mais de 2 tipos de no (XX8_TIPO) validos alem da empresa (${tiposValidos.join(', ')}) — hierarquia com mais niveis do que o suportado, requer configuracao manual.`, field_map: null };
  }

  const campoUnidPreenchidoPorTipo = new Map(tiposValidos.map(t => {
    const linhasDoTipo = nos.filter(n => n.tipo === t);
    const comUnid = linhasDoTipo.filter(n => CAMPOS_UNIDADE_CANDIDATOS.some(c => String(n.row[c] ?? '').trim()));
    return [t, linhasDoTipo.length ? comUnid.length / linhasDoTipo.length : 0];
  }));

  let tipoNoFilial, tipoNoUnidade = null;
  if (tiposValidos.length === 1) {
    tipoNoFilial = tiposValidos[0];
  } else {
    const [a, b] = tiposValidos;
    const taxaA = campoUnidPreenchidoPorTipo.get(a);
    const taxaB = campoUnidPreenchidoPorTipo.get(b);
    if (taxaA >= 0.9 && taxaB < 0.9) { tipoNoFilial = a; tipoNoUnidade = b; }
    else if (taxaB >= 0.9 && taxaA < 0.9) { tipoNoFilial = b; tipoNoUnidade = a; }
    else {
      return { confianca: 'baixa', motivo: `Nao foi possivel diferenciar qual dos tipos (${a}, ${b}) e' filial e qual e' unidade — ambiguo, requer configuracao manual.`, field_map: null };
    }
  }

  const campoEmpresa = statsPorTipo.get(tipoNoFilial).campoUnico;
  const campoUnidade = tipoNoUnidade
    ? (CAMPOS_UNIDADE_CANDIDATOS.find(c => nos.some(n => n.tipo === tipoNoFilial && String(n.row[c] ?? '').trim())) || 'XX8_UNID')
    : null;

  const fieldMap = {
    campo_tipo_no: campoTipo,
    campo_empresa: campoEmpresa,
    campo_unidade: campoUnidade || 'XX8_UNID',
    campo_filial: CAMPO_CODIGO,
    campo_descricao: CAMPO_DESCR,
    tipo_no_empresa: tipoNoEmpresa,
    tipo_no_filial: tipoNoFilial,
    tipo_no_unidade: tipoNoUnidade || '2',
  };

  const previa = registros.map(r => _normalizarLinha(r, fieldMap, '__preview__')).filter(Boolean);

  return {
    confianca: tipoNoUnidade ? 'alta' : 'media',
    motivo: tipoNoUnidade
      ? null
      : 'Nenhum nivel de unidade detectado — hierarquia tratada como empresa->filial direto (sem nivel intermediario).',
    field_map: fieldMap,
    preview: {
      total_linhas: registros.length,
      reconhecidos: previa.length,
      empresas: previa.filter(r => r.tipo_no === 'empresa').length,
      unidades: previa.filter(r => r.tipo_no === 'unidade').length,
      filiais: previa.filter(r => r.tipo_no === 'filial').length,
    },
  };
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
    // unidade e opcional: instalacoes sem esse nivel intermediario (hierarquia
    // achatada empresa->filial, ex: XX8_UNID sempre vazio) tambem sao validas.
    if (!empr || !cod) return null;
    const filialChave = unid ? `${empr}${unid}${cod}` : `${empr}${cod}`;
    return { grupo_codigo: grupoCodigo, empresa_codigo: empr, unidade_codigo: unid || null, filial_codigo: cod, filial_chave: filialChave, tipo_no: 'filial', nome: descricao };
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

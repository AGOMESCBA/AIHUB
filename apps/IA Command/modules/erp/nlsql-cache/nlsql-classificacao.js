'use strict';

const CLASSIFICACOES_AUTO = new Set([
  'aprovado_automatico',
  'reprovado_automatico',
  'inconclusivo',
  'bloqueado_por_risco',
]);

const OVERRIDES_VALIDOS = new Set([
  'aprovado_usuario',
  'reprovado_usuario',
  'ignorado_usuario',
  'bloqueado_usuario',
  '',
  null,
]);

const SCORE_TEMPLATE_APROVACAO = 0.98;
const SCORE_APLICADO_APROVACAO = 0.995;

function now() {
  return new Date().toISOString();
}

function numero(valor, fallback = null) {
  if (valor === null || valor === undefined || valor === '') return fallback;
  const n = Number(valor);
  return Number.isFinite(n) ? n : fallback;
}

function normalizarOverride(valor) {
  const v = valor === null || valor === undefined ? null : String(valor).trim();
  if (!OVERRIDES_VALIDOS.has(v)) throw new Error(`Classificacao de override invalida: ${v}`);
  return v || null;
}

function classificarShadowRow(row = {}, opts = {}) {
  const score = numero(row.candidate_score, null);
  const resultado = String(row.comparacao_resultado || '').trim();
  const templateValido = Number(row.template_valido || 0) === 1;
  const templateThreshold = numero(opts.scoreTemplateAprovacao, SCORE_TEMPLATE_APROVACAO);
  const aplicadoThreshold = numero(opts.scoreAplicadoAprovacao, SCORE_APLICADO_APROVACAO);

  if (resultado === 'template_invalido' || (row.candidate_sql_template && !templateValido)) {
    return {
      classificacao: 'bloqueado_por_risco',
      motivo: 'template_invalido_ou_nao_aplicavel',
      score,
    };
  }

  if (resultado === 'mismatch') {
    return {
      classificacao: 'reprovado_automatico',
      motivo: 'candidato_divergiu_do_sql_real',
      score,
    };
  }

  if (resultado === 'sem_candidato' || !row.candidate_execution_log_id) {
    return {
      classificacao: 'inconclusivo',
      motivo: 'sem_candidato_semantico_para_avaliar',
      score,
    };
  }

  if (resultado === 'match_template_exato') {
    if (score !== null && score >= templateThreshold) {
      return {
        classificacao: 'aprovado_automatico',
        motivo: `match_template_exato_score_${score.toFixed(3)}_gte_${templateThreshold}`,
        score,
      };
    }
    return {
      classificacao: 'inconclusivo',
      motivo: `match_template_exato_score_abaixo_${templateThreshold}`,
      score,
    };
  }

  if (resultado === 'match_sql_aplicado_exato') {
    if (score !== null && score >= aplicadoThreshold) {
      return {
        classificacao: 'aprovado_automatico',
        motivo: `match_sql_aplicado_exato_score_${score.toFixed(3)}_gte_${aplicadoThreshold}`,
        score,
      };
    }
    return {
      classificacao: 'inconclusivo',
      motivo: `match_sql_aplicado_exato_exige_score_${aplicadoThreshold}`,
      score,
    };
  }

  return {
    classificacao: 'inconclusivo',
    motivo: 'resultado_shadow_nao_classificado',
    score,
  };
}

function classificacaoEfetiva(row = {}, auto = null) {
  const override = row.override_classificacao || null;
  return override || auto || row.classificacao_auto || 'inconclusivo';
}

function aplicarClassificacaoRow(row = {}, opts = {}) {
  const auto = classificarShadowRow(row, opts);
  const efetiva = classificacaoEfetiva(row, auto.classificacao);
  return {
    classificacao_auto: auto.classificacao,
    classificacao_auto_motivo: auto.motivo,
    classificacao_efetiva: efetiva,
    classificacao_auto_em: opts.agora || now(),
  };
}

function reprocessarPendentes({ empresaId, limit = 1000, db = null } = {}) {
  const database = db || require('../../database').getDB();
  const rows = database.prepare(`
    SELECT *
      FROM nlsql_semantic_shadow_log
     WHERE empresa_id = ?
       AND (classificacao_auto IS NULL OR classificacao_auto = '')
     ORDER BY criado_em DESC
     LIMIT ?
  `).all(Number(empresaId), Math.max(1, Math.min(Number(limit) || 1000, 50000)));
  const upd = database.prepare(`
    UPDATE nlsql_semantic_shadow_log
       SET classificacao_auto = ?,
           classificacao_auto_motivo = ?,
           classificacao_auto_em = ?,
           classificacao_efetiva = CASE
             WHEN override_classificacao IS NOT NULL AND override_classificacao <> '' THEN override_classificacao
             ELSE ?
           END
     WHERE id = ?
  `);
  let atualizados = 0;
  for (const row of rows) {
    const c = aplicarClassificacaoRow(row);
    upd.run(c.classificacao_auto, c.classificacao_auto_motivo, c.classificacao_auto_em, c.classificacao_efetiva, row.id);
    atualizados += 1;
  }
  return { candidatos: rows.length, atualizados };
}

function aplicarOverride({ id, empresaId, classificacao, motivo = '', usuario = 'sistema', db = null } = {}) {
  const database = db || require('../../database').getDB();
  const override = normalizarOverride(classificacao);
  const row = database.prepare(`
    SELECT id, classificacao_auto
      FROM nlsql_semantic_shadow_log
     WHERE empresa_id = ?
       AND id = ?
     LIMIT 1
  `).get(Number(empresaId), id);
  if (!row) throw new Error('Registro de shadow mode nao encontrado.');

  const efetiva = override || row.classificacao_auto || 'inconclusivo';
  database.prepare(`
    UPDATE nlsql_semantic_shadow_log
       SET override_classificacao = ?,
           override_motivo = ?,
           override_usuario = ?,
           override_em = ?,
           classificacao_efetiva = ?
     WHERE empresa_id = ?
       AND id = ?
  `).run(
    override,
    override ? String(motivo || '').slice(0, 1000) : null,
    override ? String(usuario || 'sistema').slice(0, 120) : null,
    override ? now() : null,
    efetiva,
    Number(empresaId),
    id,
  );
  return { id, override_classificacao: override, classificacao_efetiva: efetiva };
}

module.exports = {
  CLASSIFICACOES_AUTO,
  OVERRIDES_VALIDOS,
  SCORE_TEMPLATE_APROVACAO,
  SCORE_APLICADO_APROVACAO,
  classificarShadowRow,
  aplicarClassificacaoRow,
  classificacaoEfetiva,
  reprocessarPendentes,
  aplicarOverride,
  _test: {
    numero,
    normalizarOverride,
  },
};

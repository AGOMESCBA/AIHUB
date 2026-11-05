'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { getDB } = require('../database');
const { mesmoGrupo } = require('../services/analise-log-identidade');
const { redigirTexto, redigirValor } = require('../services/redaction-service');
const MAX_RESULTADO = 8 * 1024 * 1024;

function metadados(row) {
  if (!row) return null;
  return { id: row.id, chamadoId: row.chamado_id, numero: row.numero_chamado, nome: redigirTexto(row.nome_arquivo), tipo: row.origem_tipo,
    ocorrencias: row.ocorrencias, grupos: row.grupos, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
    bytesHistorico: row.bytes_resultado,
    autor: row.criador_id ? { tipo: row.criador_tipo, id: row.criador_id } : null,
    atualizadoPor: row.editor_id ? { tipo: row.editor_tipo, id: row.editor_id } : null };
}
function obter(empresaId, id) {
  const row = getDB().prepare('SELECT * FROM analises_logs WHERE empresa_id = ? AND id = ?').get(Number(empresaId), String(id));
  if (!row) return null;
  return { ...metadados(row), hashArquivo: row.hash_arquivo,
    resultado: redigirValor(JSON.parse(zlib.gunzipSync(row.resultado_gzip, { maxOutputLength: MAX_RESULTADO }).toString('utf8'))) };
}
function listar(empresaId, { chamadoId = null, avulsos = false } = {}) {
  const filtro = chamadoId ? ' AND chamado_id = ?' : avulsos ? " AND origem_tipo = 'avulso'" : '';
  const valores = chamadoId ? [Number(empresaId), String(chamadoId)] : [Number(empresaId)];
  return getDB().prepare(`SELECT id, chamado_id, numero_chamado, nome_arquivo, origem_tipo, ocorrencias, grupos, bytes_resultado, criado_em, atualizado_em, criador_tipo, criador_id, editor_tipo, editor_id FROM analises_logs WHERE empresa_id = ?${filtro} ORDER BY atualizado_em DESC LIMIT 50`).all(...valores).map(metadados);
}
function salvar(empresaId, { resultado, hashArquivo, historicoId = null, autor = null }) {
  return getDB().transaction(() => {
    if (resultado.origem?.chamadoId && !getDB().prepare('SELECT 1 FROM chamados WHERE id = ? AND empresa_id = ?').get(String(resultado.origem.chamadoId), Number(empresaId))) {
      throw Object.assign(new Error('Chamado não encontrado nesta empresa.'), { status: 404 });
    }
    let anterior;
    if (historicoId) {
      anterior = obter(empresaId, historicoId);
      if (!anterior) throw Object.assign(new Error('Análise não encontrada nesta empresa.'), { status: 404 });
      if (anterior.hashArquivo !== hashArquivo) throw Object.assign(new Error('O arquivo é diferente do utilizado nesta análise. Inicie uma nova análise.'), { status: 409 });
      if (['tipo', 'chamadoId', 'arquivoId'].some(c => String(anterior.resultado.origem?.[c] || '') !== String(resultado.origem?.[c] || ''))) throw Object.assign(new Error('A origem difere da análise salva.'), { status: 409 });
      if ((resultado.parserVersao || 1) !== (anterior.resultado.parserVersao || 1)) throw Object.assign(new Error('A versão do agrupamento difere da análise salva. Inicie uma nova análise.'), { status: 409 });
      if (anterior.resultado.grupos.some(a => a.analise && !resultado.grupos.some(g => mesmoGrupo(g, a, resultado.parserVersao || 1, anterior.resultado.parserVersao || 1)))) throw Object.assign(new Error('A nova leitura não preserva todos os diagnósticos anteriores. Inicie uma nova análise.'), { status: 409 });
      for (const g of resultado.grupos) if (!g.analise) g.analise = anterior.resultado.grupos.find(a => mesmoGrupo(g, a, resultado.parserVersao || 1, anterior.resultado.parserVersao || 1))?.analise;
      if (anterior.resultado.visaoGeral) resultado.visaoGeral = anterior.resultado.visaoGeral;
      resultado.ia = { ...resultado.ia, gruposAnalisados: resultado.grupos.filter(g => g.analise).length };
    }
    const copia = redigirValor({ ...resultado }); delete copia.historico;
    const texto = JSON.stringify(copia);
    if (Buffer.byteLength(texto) > MAX_RESULTADO) throw new Error('Relatório excede o tamanho máximo do histórico.');
    const comprimido = zlib.gzipSync(Buffer.from(texto));
    const id = anterior?.id || crypto.randomUUID(); const agora = new Date().toISOString();
    getDB().prepare(`INSERT INTO analises_logs (id, empresa_id, chamado_id, numero_chamado, nome_arquivo, hash_arquivo, origem_tipo, ocorrencias, grupos, resultado_gzip, bytes_resultado, criado_em, atualizado_em, criador_tipo, criador_id, editor_tipo, editor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET resultado_gzip=excluded.resultado_gzip, bytes_resultado=excluded.bytes_resultado, atualizado_em=excluded.atualizado_em, ocorrencias=excluded.ocorrencias, grupos=excluded.grupos, editor_tipo=excluded.editor_tipo, editor_id=excluded.editor_id`).run(
      id, Number(empresaId), resultado.origem?.chamadoId || null, resultado.origem?.numero || null, resultado.arquivo.nome, hashArquivo, resultado.origem?.tipo || 'avulso', resultado.cobertura.ocorrencias,
      resultado.grupos.length, comprimido, comprimido.length, anterior?.criadoEm || agora, agora,
      autor?.tipo || null, autor?.id == null ? null : String(autor.id), autor?.tipo || null, autor?.id == null ? null : String(autor.id));
    return { id, salvo: true, criadoEm: anterior?.criadoEm || agora, atualizadoEm: agora, bytesHistorico: comprimido.length,
      autor: anterior ? anterior.autor : autor, atualizadoPor: autor };
  })();
}
function excluir(empresaId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id))) {
    throw Object.assign(new Error('Selecione de 1 a 50 análises válidas para excluir.'), { status: 400 });
  }
  const selecionadas = [...new Set(ids)];
  const marcadores = selecionadas.map(() => '?').join(',');
  return getDB().transaction(() => {
    const quantidade = getDB().prepare(`SELECT COUNT(*) AS total FROM analises_logs WHERE empresa_id = ? AND id IN (${marcadores})`).get(Number(empresaId), ...selecionadas).total;
    if (quantidade !== selecionadas.length) throw Object.assign(new Error('Uma das análises não foi encontrada nesta empresa. Atualize o histórico.'), { status: 404 });
    return getDB().prepare(`DELETE FROM analises_logs WHERE empresa_id = ? AND id IN (${marcadores})`).run(Number(empresaId), ...selecionadas).changes;
  })();
}
module.exports = { obter, listar, salvar, excluir };

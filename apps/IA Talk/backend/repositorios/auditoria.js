'use strict';

// Registro de auditoria. "resumo" é texto curto para a tela, sem dado
// sensível: nada de token, texto de mensagem ou número completo.

const { novoId, agora } = require('../ids');
const { escopo } = require('./base');
const { lerPaginacao, montarPagina } = require('../paginacao');

function registrar(db, contexto, { acao, alvoTipo = null, alvoId = null, resumo = null, ip = null }) {
  if (!acao) throw new Error('Auditoria sem ação.');
  const item = {
    id: novoId('auditoria'),
    empresa_id: contexto.empresaId || null,
    em: agora(),
    usuario_id: contexto.usuarioId || null,
    aplicacao_id: contexto.aplicacaoId || null,
    acao,
    alvo_tipo: alvoTipo,
    alvo_id: alvoId,
    resumo: resumo ? String(resumo).slice(0, 300) : null,
    ip,
  };
  db.prepare(`INSERT INTO auditoria (id, empresa_id, em, usuario_id, aplicacao_id, acao, alvo_tipo, alvo_id, resumo, ip)
    VALUES (@id, @empresa_id, @em, @usuario_id, @aplicacao_id, @acao, @alvo_tipo, @alvo_id, @resumo, @ip)`).run(item);
  return item;
}

function listar(db, contexto, query = {}) {
  const { limite, cursor } = lerPaginacao(query);
  const linhas = escopo(db, contexto).todos(`
    SELECT id, em, usuario_id, aplicacao_id, acao, alvo_tipo, alvo_id, resumo, ip
      FROM auditoria
     WHERE empresa_id = @empresa_id
       AND (@antes_em IS NULL OR em < @antes_em OR (em = @antes_em AND id < @antes_id))
     ORDER BY em DESC, id DESC
     LIMIT @limite`, { antes_em: cursor?.em ?? null, antes_id: cursor?.id ?? null, limite: limite + 1 });
  return montarPagina(linhas, { limite, cursorDoUltimo: (l) => ({ em: l.em, id: l.id }) });
}

module.exports = { registrar, listar };

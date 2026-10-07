// Repository de `chamados` e `posicionamentos` — entidades centrais da base
// histórica. Idempotência via chave natural (empresa, fonte, oid_origem) +
// hash_conteudo para decidir se um UPDATE é necessário (seção 21 do prompt).

const crypto = require('crypto');
const { getDB } = require('../database');

function hashConteudo(objeto) {
  const json = JSON.stringify(objeto, Object.keys(objeto).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

function _chamadoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, sistemaOrigem: row.sistema_origem,
    oidOrigem: row.oid_origem, numero: row.numero, clienteId: row.cliente_id,
    solicitanteId: row.solicitante_id, tecnicoResponsavelId: row.tecnico_responsavel_id,
    dataAbertura: row.data_abertura,
    produto: row.produto, familia: row.familia, modulo: row.modulo, servico: row.servico,
    tipoChamado: row.tipo_chamado, tipoChamadoSe: row.tipo_chamado_se, tipoChamadoFinal: row.tipo_chamado_final,
    natureza: row.natureza, nivel: row.nivel,
    titulo: row.titulo, assunto: row.assunto, breveDescricao: row.breve_descricao, descricao: row.descricao,
    informacoesAdicionais: row.informacoes_adicionais, observacoes: row.observacoes,
    sla: row.sla, slaHoras: row.sla_horas, slaStatus: row.sla_status, slaStatusFinal: row.sla_status_final,
    slaInicial: row.sla_inicial, slaAnterior: row.sla_anterior,
    solucaoAplicada: row.solucao_aplicada, avaliacao: row.avaliacao, totalHoras: row.total_horas,
    chamadoReferencia: row.chamado_referencia, statusEncerramento: row.status_encerramento, slaPrazo: row.sla_prazo,
    slaDataPrevFim: row.sla_data_prev_fim,
    kanbanId: row.kanban_id, kanbanKey: row.kanban_key, kanbanAtributos: row.kanban_atributos, kanbanDataInicio: row.kanban_data_inicio,
    diasDur: row.dias_dur, hrDur: row.hr_dur, diasDurSup: row.dias_dur_sup, diasDurFsw: row.dias_dur_fsw,
    diasDurDist: row.dias_dur_dist, diasDurCli: row.dias_dur_cli, diasDurTicli: row.dias_dur_ticli,
    aguardandoConsolidado: row.aguardando_consolidado,
    hashConteudo: row.hash_conteudo, precisaIndexacao: !!row.precisa_indexacao, indexadoEm: row.indexado_em,
    atualizadoOrigemEm: row.atualizado_origem_em, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

const CAMPOS_CHAMADO = [
  'produto', 'familia', 'modulo', 'servico', 'tipoChamado', 'tipoChamadoSe', 'tipoChamadoFinal',
  'natureza', 'nivel', 'titulo', 'assunto', 'breveDescricao', 'descricao', 'informacoesAdicionais',
  'observacoes', 'sla', 'slaHoras', 'slaStatus', 'slaStatusFinal', 'slaInicial', 'slaAnterior',
  'solucaoAplicada', 'avaliacao', 'totalHoras', 'chamadoReferencia', 'statusEncerramento', 'slaPrazo',
  'slaDataPrevFim', 'kanbanId', 'kanbanKey', 'kanbanAtributos', 'kanbanDataInicio',
  'diasDur', 'hrDur', 'diasDurSup', 'diasDurFsw', 'diasDurDist', 'diasDurCli', 'diasDurTicli',
  'aguardandoConsolidado',
];

const COLUNA_POR_CAMPO = {
  produto: 'produto', familia: 'familia', modulo: 'modulo', servico: 'servico',
  tipoChamado: 'tipo_chamado', tipoChamadoSe: 'tipo_chamado_se', tipoChamadoFinal: 'tipo_chamado_final',
  natureza: 'natureza', nivel: 'nivel', titulo: 'titulo', assunto: 'assunto',
  breveDescricao: 'breve_descricao', descricao: 'descricao', informacoesAdicionais: 'informacoes_adicionais',
  observacoes: 'observacoes', sla: 'sla', slaHoras: 'sla_horas', slaStatus: 'sla_status',
  slaStatusFinal: 'sla_status_final', slaInicial: 'sla_inicial', slaAnterior: 'sla_anterior',
  solucaoAplicada: 'solucao_aplicada', avaliacao: 'avaliacao', totalHoras: 'total_horas',
  chamadoReferencia: 'chamado_referencia', statusEncerramento: 'status_encerramento', slaPrazo: 'sla_prazo',
  slaDataPrevFim: 'sla_data_prev_fim',
  kanbanId: 'kanban_id', kanbanKey: 'kanban_key', kanbanAtributos: 'kanban_atributos', kanbanDataInicio: 'kanban_data_inicio',
  diasDur: 'dias_dur', hrDur: 'hr_dur', diasDurSup: 'dias_dur_sup', diasDurFsw: 'dias_dur_fsw',
  diasDurDist: 'dias_dur_dist', diasDurCli: 'dias_dur_cli', diasDurTicli: 'dias_dur_ticli',
  aguardandoConsolidado: 'aguardando_consolidado',
};

/**
 * Upsert por (empresa, fonte, oid_origem). Compara hash_conteudo do payload
 * normalizado contra o hash já armazenado — só grava UPDATE se algo mudou de
 * fato (idempotência real, não apenas "não duplica linha").
 * Retorna { chamado, resultado: 'inserido'|'atualizado'|'sem_alteracao' }.
 */
function upsertChamado(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados.fonteId) throw new Error('fonteId é obrigatório.');
  if (!dados.oidOrigem) throw new Error('oidOrigem é obrigatório.');
  if (!dados.numero) throw new Error('numero (IDPROCESS) é obrigatório.');

  const db = getDB();
  const agora = new Date().toISOString();

  const hashAtual = hashConteudo(Object.fromEntries(CAMPOS_CHAMADO.map(c => [c, dados[c] ?? null])));

  const existente = db.prepare(`
    SELECT * FROM chamados WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?
  `).get(Number(empresaId), dados.fonteId, dados.oidOrigem);

  if (existente) {
    if (existente.hash_conteudo === hashAtual) {
      return { chamado: _chamadoParaDominio(existente), resultado: 'sem_alteracao' };
    }

    const sets = CAMPOS_CHAMADO.map(c => `${COLUNA_POR_CAMPO[c]} = ?`).join(', ');
    const valores = CAMPOS_CHAMADO.map(c => dados[c] ?? null);
    db.prepare(`
      UPDATE chamados
         SET ${sets}, cliente_id = ?, solicitante_id = ?, tecnico_responsavel_id = ?,
             data_abertura = ?, hash_conteudo = ?, precisa_indexacao = 1,
             atualizado_origem_em = ?, atualizado_em = ?
       WHERE id = ?
    `).run(...valores, dados.clienteId ?? null, dados.solicitanteId ?? null, dados.tecnicoResponsavelId ?? null,
      dados.dataAbertura ?? null, hashAtual, dados.atualizadoOrigemEm ?? agora, agora, existente.id);

    return { chamado: _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ?`).get(existente.id)), resultado: 'atualizado' };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO chamados (
      id, empresa_id, fonte_id, sistema_origem, oid_origem, numero,
      cliente_id, solicitante_id, tecnico_responsavel_id, data_abertura,
      produto, familia, modulo, servico, tipo_chamado, tipo_chamado_se, tipo_chamado_final, natureza, nivel,
      titulo, assunto, breve_descricao, descricao, informacoes_adicionais, observacoes,
      sla, sla_horas, sla_status, sla_status_final, sla_inicial, sla_anterior,
      solucao_aplicada, avaliacao, total_horas, chamado_referencia, status_encerramento, sla_prazo, sla_data_prev_fim,
      kanban_id, kanban_key, kanban_atributos, kanban_data_inicio,
      dias_dur, hr_dur, dias_dur_sup, dias_dur_fsw, dias_dur_dist, dias_dur_cli, dias_dur_ticli,
      aguardando_consolidado,
      hash_conteudo, precisa_indexacao, atualizado_origem_em, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.fonteId, dados.sistemaOrigem, dados.oidOrigem, dados.numero,
    dados.clienteId ?? null, dados.solicitanteId ?? null, dados.tecnicoResponsavelId ?? null, dados.dataAbertura ?? null,
    dados.produto ?? null, dados.familia ?? null, dados.modulo ?? null, dados.servico ?? null,
    dados.tipoChamado ?? null, dados.tipoChamadoSe ?? null, dados.tipoChamadoFinal ?? null, dados.natureza ?? null, dados.nivel ?? null,
    dados.titulo ?? null, dados.assunto ?? null, dados.breveDescricao ?? null, dados.descricao ?? null,
    dados.informacoesAdicionais ?? null, dados.observacoes ?? null,
    dados.sla ?? null, dados.slaHoras ?? null, dados.slaStatus ?? null, dados.slaStatusFinal ?? null,
    dados.slaInicial ?? null, dados.slaAnterior ?? null,
    dados.solucaoAplicada ?? null, dados.avaliacao ?? null, dados.totalHoras ?? null, dados.chamadoReferencia ?? null,
    dados.statusEncerramento ?? null, dados.slaPrazo ?? null, dados.slaDataPrevFim ?? null,
    dados.kanbanId ?? null, dados.kanbanKey ?? null, dados.kanbanAtributos ?? null, dados.kanbanDataInicio ?? null,
    dados.diasDur ?? null, dados.hrDur ?? null, dados.diasDurSup ?? null, dados.diasDurFsw ?? null,
    dados.diasDurDist ?? null, dados.diasDurCli ?? null, dados.diasDurTicli ?? null,
    dados.aguardandoConsolidado ?? null,
    hashAtual, dados.atualizadoOrigemEm ?? agora, agora, agora
  );

  return { chamado: _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ?`).get(id)), resultado: 'inserido' };
}

function getChamadoPorOid(empresaId, fonteId, oidOrigem) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?`).get(Number(empresaId), fonteId, oidOrigem));
}

function getChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ? AND empresa_id = ?`).get(chamadoId, Number(empresaId)));
}

function getChamadoPorNumero(empresaId, numero, sistemaOrigem) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!numero) return null;
  const db = getDB();
  const params = [Number(empresaId), String(numero)];
  const condicoes = ['empresa_id = ?', 'numero = ?'];
  if (sistemaOrigem) {
    condicoes.push('sistema_origem = ?');
    params.push(sistemaOrigem);
  }
  const row = db.prepare(`
    SELECT * FROM chamados
     WHERE ${condicoes.join(' AND ')}
     ORDER BY data_abertura DESC
     LIMIT 1
  `).get(...params);
  return _chamadoParaDominio(row);
}

function listarChamados(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.precisaIndexacao !== undefined) {
    condicoes.push('precisa_indexacao = ?');
    params.push(filtros.precisaIndexacao ? 1 : 0);
  }
  const limite = Math.min(Number(filtros.limite) || 100, 5000);
  const rows = db.prepare(`SELECT * FROM chamados WHERE ${condicoes.join(' AND ')} ORDER BY data_abertura DESC LIMIT ?`).all(...params, limite);
  return rows.map(_chamadoParaDominio);
}

function contarChamados(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  return db.prepare(`SELECT COUNT(*) AS total FROM chamados WHERE ${condicoes.join(' AND ')}`).get(...params).total;
}

// ── Posicionamentos ─────────────────────────────────────────────────────

function _posicionamentoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, oidOrigem: row.oid_origem,
    chamadoId: row.chamado_id, dataPosicionamento: row.data_posicionamento,
    tecnicoId: row.tecnico_id, tecnicoNomeOrigem: row.tecnico_nome_origem, usuarioClienteId: row.usuario_cliente_id,
    situacao: row.situacao, tipo: row.tipo, motivo: row.motivo,
    assunto: row.assunto, descricao: row.descricao, resultado: row.resultado,
    horaInicio: row.hora_inicio, horaFim: row.hora_fim, horaIntervalo: row.hora_intervalo, totalHoras: row.total_horas,
    aguardandoRetorno: row.aguardando_retorno === null ? null : !!row.aguardando_retorno,
    situacaoRetorno: row.situacao_retorno,
    oidArquivo1: row.oid_arquivo1, oidArquivo2: row.oid_arquivo2,
    hashConteudo: row.hash_conteudo, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

const CAMPOS_POSICIONAMENTO = ['situacao', 'tipo', 'motivo', 'assunto', 'descricao', 'resultado', 'horaInicio', 'horaFim', 'horaIntervalo', 'totalHoras', 'aguardandoRetorno', 'situacaoRetorno'];
const COLUNA_POR_CAMPO_POS = {
  situacao: 'situacao', tipo: 'tipo', motivo: 'motivo', assunto: 'assunto', descricao: 'descricao',
  resultado: 'resultado', horaInicio: 'hora_inicio', horaFim: 'hora_fim', horaIntervalo: 'hora_intervalo',
  totalHoras: 'total_horas', aguardandoRetorno: 'aguardando_retorno', situacaoRetorno: 'situacao_retorno',
};
// dataPosicionamento é setado à parte no UPDATE (fora do loop de CAMPOS_POSICIONAMENTO,
// já que tecnicoId/tecnicoNomeOrigem/usuarioClienteId também são) — mas PRECISA entrar
// no hash de comparação, senão uma correção só na hora (ex.: HORAATUAL passando a ser
// coletado da origem) nunca é persistida: os outros 12 campos continuam idênticos, o
// hash bate com o anterior, e o UPDATE inteiro (incluindo data_posicionamento) é pulado
// por resultado='sem_alteracao'. Bug real encontrado em produção (2026-10): reimportar
// um chamado já existente não atualizava data_posicionamento mesmo após o fix de
// HORAATUAL em softexpert-sqlserver-adapter.js.
const CAMPOS_HASH_POSICIONAMENTO = [...CAMPOS_POSICIONAMENTO, 'dataPosicionamento'];

function upsertPosicionamento(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados.fonteId) throw new Error('fonteId é obrigatório.');
  if (!dados.oidOrigem) throw new Error('oidOrigem é obrigatório.');
  if (!dados.chamadoId) throw new Error('chamadoId é obrigatório.');

  const db = getDB();
  const agora = new Date().toISOString();
  const hashAtual = hashConteudo(Object.fromEntries(CAMPOS_HASH_POSICIONAMENTO.map(c => [c, dados[c] ?? null])));

  const existente = db.prepare(`
    SELECT * FROM posicionamentos WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?
  `).get(Number(empresaId), dados.fonteId, dados.oidOrigem);

  if (existente) {
    if (existente.hash_conteudo === hashAtual) {
      return { posicionamento: _posicionamentoParaDominio(existente), resultado: 'sem_alteracao' };
    }
    const sets = CAMPOS_POSICIONAMENTO.map(c => `${COLUNA_POR_CAMPO_POS[c]} = ?`).join(', ');
    const valores = CAMPOS_POSICIONAMENTO.map(c => dados[c] === undefined ? null : (typeof dados[c] === 'boolean' ? (dados[c] ? 1 : 0) : dados[c]));
    db.prepare(`
      UPDATE posicionamentos SET ${sets}, tecnico_id = ?, tecnico_nome_origem = ?, usuario_cliente_id = ?,
        data_posicionamento = ?, hash_conteudo = ?, atualizado_em = ?
      WHERE id = ?
    `).run(...valores, dados.tecnicoId ?? null, dados.tecnicoNomeOrigem ?? null, dados.usuarioClienteId ?? null,
      dados.dataPosicionamento ?? null, hashAtual, agora, existente.id);

    // Posicionamento alterado → chamado-pai precisa reindexação (conteúdo mudou).
    db.prepare(`UPDATE chamados SET precisa_indexacao = 1, atualizado_em = ? WHERE id = ?`).run(agora, dados.chamadoId);

    return { posicionamento: _posicionamentoParaDominio(db.prepare(`SELECT * FROM posicionamentos WHERE id = ?`).get(existente.id)), resultado: 'atualizado' };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO posicionamentos (
      id, empresa_id, fonte_id, oid_origem, chamado_id, data_posicionamento,
      tecnico_id, tecnico_nome_origem, usuario_cliente_id,
      situacao, tipo, motivo, assunto, descricao, resultado,
      hora_inicio, hora_fim, hora_intervalo, total_horas, aguardando_retorno, situacao_retorno,
      oid_arquivo1, oid_arquivo2, hash_conteudo, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.fonteId, dados.oidOrigem, dados.chamadoId, dados.dataPosicionamento ?? null,
    dados.tecnicoId ?? null, dados.tecnicoNomeOrigem ?? null, dados.usuarioClienteId ?? null,
    dados.situacao ?? null, dados.tipo ?? null, dados.motivo ?? null, dados.assunto ?? null, dados.descricao ?? null, dados.resultado ?? null,
    dados.horaInicio ?? null, dados.horaFim ?? null, dados.horaIntervalo ?? null, dados.totalHoras ?? null,
    dados.aguardandoRetorno === undefined || dados.aguardandoRetorno === null ? null : (dados.aguardandoRetorno ? 1 : 0),
    dados.situacaoRetorno ?? null,
    dados.oidArquivo1 ?? null, dados.oidArquivo2 ?? null, hashAtual, agora, agora
  );

  db.prepare(`UPDATE chamados SET precisa_indexacao = 1, atualizado_em = ? WHERE id = ?`).run(agora, dados.chamadoId);

  return { posicionamento: _posicionamentoParaDominio(db.prepare(`SELECT * FROM posicionamentos WHERE id = ?`).get(id)), resultado: 'inserido' };
}

function listarPosicionamentosDoChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM posicionamentos WHERE empresa_id = ? AND chamado_id = ? ORDER BY data_posicionamento ASC
  `).all(Number(empresaId), chamadoId);
  return rows.map(_posicionamentoParaDominio);
}

function _textoBuscaChamado(chamado, posicionamentos = []) {
  return [
    chamado.numero, chamado.produto, chamado.familia, chamado.modulo, chamado.servico,
    chamado.tipoChamado, chamado.tipoChamadoSe, chamado.tipoChamadoFinal, chamado.natureza, chamado.nivel,
    chamado.titulo, chamado.assunto, chamado.breveDescricao, chamado.descricao,
    chamado.informacoesAdicionais, chamado.observacoes, chamado.solucaoAplicada,
    ...posicionamentos.flatMap(p => [p.assunto, p.descricao, p.resultado, p.situacao, p.tipo, p.motivo]),
  ].filter(Boolean).join(' ').toLowerCase();
}

// Tokens extraídos SÓ do conteúdo específico do problema (assunto/
// breveDescricao/descricao, e a parte do TÍTULO após o padrão
// "CLIENTE | Produto | ..." quando existir) — categoria estrutural
// (produto/módulo/etc.) é tratada à parte como match exato, não entra
// aqui. Revisão 2026-10 (achado real testando contra dados de produção):
// o título inteiro incluía nome do CLIENTE (ex.: "FUNDAÇÃO MT") e nome
// do PRODUTO (ex.: "Protheus") como tokens — nome de cliente é ruído puro
// (aparece em todo chamado daquele cliente, não indica problema parecido)
// e produto já é comparado separadamente em _pontuarSimilaridade, usá-lo
// de novo aqui infla score de texto sem sinal real. _tituloSemPrefixo
// extrai só a parte útil do título (ex.: "Erro na aprovação de pedido de
// compras pelo sistema"), descartando cliente/produto do prefixo.
// Stopword list expandida com conectores genéricos de texto livre
// (mensagem, segue, anexo, logo, sequencia, mostra, pelo, favor, etc.) e
// os dois produtos do domínio (protheus, softexpert) — confirmado
// contra dados reais que esses termos apareciam em "X termo(s) em comum"
// mesmo entre chamados de problemas completamente diferentes.
function _tituloSemPrefixo(titulo) {
  if (!titulo) return '';
  const partes = titulo.split('|');
  return partes.length >= 3 ? partes.slice(2).join('|').trim() : titulo;
}

const STOPWORDS_BUSCA = new Set([
  'para', 'com', 'sem', 'erro', 'chamado', 'problema', 'sistema', 'cliente',
  'usuario', 'usuarios', 'tela', 'processo', 'protheus', 'softexpert',
  'pelo', 'pela', 'pelos', 'pelas', 'esta', 'estao', 'sendo', 'pode', 'podem',
  'favor', 'segue', 'anexo', 'anexos', 'logo', 'sequencia', 'mostra', 'mensagem',
  'bom', 'dia', 'tarde', 'noite', 'gostaria', 'poderia', 'obrigado', 'atenciosamente',
]);

function _tokensDeBusca(chamado) {
  const texto = [
    _tituloSemPrefixo(chamado.titulo), chamado.assunto, chamado.breveDescricao, chamado.descricao,
  ].filter(Boolean).join(' ').toLowerCase();

  return [...new Set(texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4)
    .filter(t => !STOPWORDS_BUSCA.has(t))
  )].slice(0, 24);
}

/**
 * Score de similaridade entre chamados — revisado 2026-10 a pedido do
 * usuário, após auditoria encontrar dois problemas reais com dados de
 * produção (não hipotéticos):
 *
 * 1) BUG: `if (candidato.solucaoAplicada)` tratava a string como truthy
 *    sempre que não-vazia — mas o campo é categórico 'Sim'/'Não' vindo do
 *    SoftExpert, não o texto da solução. Confirmado contra o banco real:
 *    1634 chamados, 1402 com o campo = 'Não' e só 232 = 'Sim' — o bônus
 *    estava sendo dado a 86% dos chamados que o SoftExpert explicitamente
 *    marca como SEM solução aplicada. Corrigido para comparar o valor
 *    exato 'Sim'.
 *
 * 2) PESO DESBALANCEADO: produto+família+módulo+serviço+tipo somavam até
 *    70 pontos SÓ por categoria estrutural igual, contra até 30 pontos de
 *    correspondência real de texto do problema — na prática, qualquer
 *    chamado da mesma categoria (ex.: todo chamado de Compras/Protheus)
 *    já entrava com score alto antes de qualquer sinal sobre o PROBLEMA
 *    em si. Rebalanceado: estrutural cai para até 25 pontos (serve de
 *    desempate/contexto, não de critério dominante), texto sobe para até
 *    60 pontos (passa a ser o fator decisivo, como pedido pelo usuário:
 *    "chamados com o mesmo problema técnico").
 *
 * 3) CORTE MÍNIMO: antes, score > 0 bastava para entrar na lista — um
 *    candidato podia aparecer só por "está encerrado" (+6), sem nenhuma
 *    correspondência real de categoria OU texto. Agora exige pelo menos 1
 *    token de texto em comum OU (módulo E serviço) iguais — nunca entra só
 *    por ser um chamado genérico encerrado com solução.
 */
function _pontuarSimilaridade(atual, candidato, tokens, textoCandidato) {
  let scoreEstrutural = 0;
  let scoreTexto = 0;
  const motivos = [];

  if (atual.modulo && candidato.modulo === atual.modulo) { scoreEstrutural += 8; motivos.push(`Módulo: ${candidato.modulo}`); }
  if (atual.servico && candidato.servico === atual.servico) { scoreEstrutural += 6; motivos.push(`Serviço: ${candidato.servico}`); }
  if (atual.produto && candidato.produto === atual.produto) { scoreEstrutural += 5; motivos.push(`Produto: ${candidato.produto}`); }
  if (atual.familia && candidato.familia === atual.familia) { scoreEstrutural += 4; motivos.push(`Família: ${candidato.familia}`); }
  if (atual.tipoChamadoFinal && candidato.tipoChamadoFinal === atual.tipoChamadoFinal) { scoreEstrutural += 2; motivos.push(`Tipo: ${candidato.tipoChamadoFinal}`); }

  let tokensEncontrados = 0;
  for (const token of tokens) {
    if (textoCandidato.includes(token)) tokensEncontrados++;
  }
  if (tokensEncontrados) {
    scoreTexto += Math.min(tokensEncontrados * 6, 60);
    motivos.push(`${tokensEncontrados} termo(s) do problema em comum`);
  }

  const matchModuloEServico = atual.modulo && atual.servico && candidato.modulo === atual.modulo && candidato.servico === atual.servico;
  const elegivel = tokensEncontrados > 0 || matchModuloEServico;
  if (!elegivel) return null;

  const temSolucaoAplicada = candidato.solucaoAplicada === 'Sim';
  if (temSolucaoAplicada) motivos.push('Possui solução aplicada');
  if (candidato.statusEncerramento === 'Encerrado') { scoreEstrutural += 3; motivos.push('Chamado encerrado'); }

  return { score: scoreEstrutural + scoreTexto, temSolucaoAplicada, motivos };
}

function listarChamadosRelacionados(empresaId, chamadoId, { limite = 8 } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');

  const atual = getChamado(empresaId, chamadoId);
  if (!atual) throw new Error('Chamado não encontrado.');

  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM chamados
     WHERE empresa_id = ? AND id != ?
     ORDER BY data_abertura DESC
     LIMIT 1200
  `).all(Number(empresaId), chamadoId).map(_chamadoParaDominio);

  const tokens = _tokensDeBusca(atual);
  const limiteSeguro = Math.min(Number(limite) || 8, 20);
  const pontuados = [];

  for (const candidato of rows) {
    const posicionamentos = listarPosicionamentosDoChamado(empresaId, candidato.id);
    const texto = _textoBuscaChamado(candidato, posicionamentos)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const resultado = _pontuarSimilaridade(atual, candidato, tokens, texto);
    if (!resultado) continue;

    pontuados.push({
      chamado: candidato,
      score: resultado.score,
      temSolucaoAplicada: resultado.temSolucaoAplicada,
      motivos: resultado.motivos.slice(0, 5),
      posicionamentos: posicionamentos.slice(-8),
    });
  }

  return pontuados
    .sort((a, b) => b.score - a.score || String(b.chamado.dataAbertura || '').localeCompare(String(a.chamado.dataAbertura || '')))
    .slice(0, limiteSeguro);
}

function contarPosicionamentos(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  return db.prepare(`SELECT COUNT(*) AS total FROM posicionamentos WHERE ${condicoes.join(' AND ')}`).get(...params).total;
}

module.exports = {
  hashConteudo,
  upsertChamado, getChamadoPorOid, getChamado, getChamadoPorNumero, listarChamados, contarChamados,
  upsertPosicionamento, listarPosicionamentosDoChamado, listarChamadosRelacionados, contarPosicionamentos,
};

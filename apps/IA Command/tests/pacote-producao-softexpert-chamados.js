// Pacote de dados para levar o dataset "softexpert_chamados" (J2A) para producao.
//
// O QUE ESTE SCRIPT FAZ:
//   1. Cria/atualiza a conexao "Softexpert - Tickets" (tipo Agente Local, connection_key
//      "softexpert_chamados") — SEM senha; a senha do banco fica so no Agente Local.
//   2. Cria/atualiza o dataset "softexpert_chamados" (SQL Base + 45 campos semanticos
//      documentados, com as regras de negocio de status/SLA confirmadas nesta sessao).
//   3. Cria/atualiza a intencao "chamados_softexpert" (erp=SoftExpert, acao=ai_text_to_sql).
//
// O QUE ESTE SCRIPT NAO FAZ (precisa ser feito manualmente, fora daqui):
//   - Nao mexe na tabela ai_config (URL/token do Agente Local) — isso e por ambiente.
//   - Nao configura a senha do banco SoftExpert no Agente Local — isso fica no agente,
//     nao no IA Command (ver aba "Conexoes adicionais" do dashboard do agente-local).
//   - Nao roda nenhuma migracao de schema — as colunas novas (erp em intentions,
//     connection_key/connection_id em connections/datasets) ja fazem parte do codigo
//     commitado e sao criadas automaticamente ao subir o servidor Node em producao.
//
// COMO USAR:
//   1. Ajuste EMPRESA_ID abaixo para o empresa_id da J2A em producao.
//   2. Rode com o servidor de producao PARADO (evita duas conexoes escrevendo ao mesmo
//      tempo) ou, se preferir manter no ar, saiba que o SQLite usa modo WAL e suporta
//      escrita concorrente com seguranca.
//   3. node "apps/IA Command/tests/pacote-producao-softexpert-chamados.js"
//   4. Reinicie o servidor Node de producao (o codigo do MultiDataset precisa estar
//      publicado e o processo reiniciado para reconhecer os dados novos).
//   5. Configure a conexao SoftExpert no Agente Local de producao (aba "Conexoes
//      adicionais" do dashboard, connection_key = softexpert_chamados) com host/usuario/
//      senha reais do banco de producao.
//
// Idempotente: pode rodar mais de uma vez sem duplicar — usa upsert por chave natural
// (connection_key para conexao, nome para dataset, nome para intencao).

const EMPRESA_ID = 1; // <<< AJUSTAR para o empresa_id da J2A em producao antes de rodar

const path = require('path');
const crypto = require('crypto');
const BASE = path.join(__dirname, '..');
const { inicializarDB } = require(path.join(BASE, 'modules/database'));
const db = inicializarDB();

function _agora() { return new Date().toISOString(); }

// ── 1. Conexao ──────────────────────────────────────────────────────────────
function upsertConexao() {
  const existente = db.prepare(
    'SELECT id FROM connections WHERE empresa_id = ? AND connection_key = ?'
  ).get(EMPRESA_ID, 'softexpert_chamados');

  if (existente) {
    db.prepare(`
      UPDATE connections SET
        nome = ?, tipo = 'api_proxy', host = 'agente-local', database = '/',
        erp = ?, ativo = 1, atualizado_em = ?
      WHERE id = ?
    `).run('Softexpert - Tickets', 'SoftExpert', _agora(), existente.id);
    console.log(`[conexao] atualizada: id=${existente.id}`);
    return existente.id;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO connections
      (id, empresa_id, nome, tipo, host, database, erp, connection_key, ativo, padrao, criado_em, atualizado_em)
    VALUES (?, ?, ?, 'api_proxy', 'agente-local', '/', ?, ?, 1, 1, ?, ?)
  `).run(id, EMPRESA_ID, 'Softexpert - Tickets', 'SoftExpert', 'softexpert_chamados', _agora(), _agora());
  console.log(`[conexao] criada: id=${id}`);
  return id;
}

// ── 2. Dataset ───────────────────────────────────────────────────────────────
const SQL_BASE = `SELECT

    -- Identificação do chamado
    CHAMADO                    AS chamado,
    NCHAMADOREF                AS chamado_referencia,

    -- Status e workflow
    STATUS                      AS status_chamado,
    NMATIVATUAL                  AS etapa_atual_chamado,
    TKT_ENCAUT                  AS encerramento_automatico_chamado,
    AGUARDANDO                  AS aguardando_retorno,

    -- Analista responsável
    MATR_ANA                    AS matricula_analista,
    CDUSERANA                    AS codigo_analista,
    ANALISTA                    AS nome_analista,
    CDUSERANATRF                AS codigo_analista_transferencia,

    -- Empresa / cliente
    IDEMPRESA                    AS id_cliente,
    CNPJ                          AS cnpj_cliente,
    EMPRESA                      AS empresa_cliente,

    -- Solicitante / usuário cliente
    CDUSER                        AS codigo_solicitante_cliente,
    IDUSER                        AS matricula_solicitante_cliente,
    FUNCAO                        AS funcao_solicitante_cliente,
    ADM                            AS administrador_cliente,
    NMSOLICITANTE                AS solicitante_cliente,
    EMAIL                          AS email_solicitante_cliente,
    PAPELFUNCIONAL              AS papel_funcional_cliente,

    -- Classificação do chamado
    CATEGORIA                    AS categoria_chamado,
    TIPODECHAMADOSE              AS tipo_chamado,
    PRODUTO                      AS produto_chamado,
    COMPONENTE                    AS componente_chamado,
    ASSUNTO                      AS assunto_chamado,
    DESCRICAO                    AS descricao_chamado,
    COMPLEXIDADE                  AS complexidade_chamado,

    -- Datas
    DATA_INICIO_PROC              AS data_abertura_chamado,
    DATA_FIM_PROC                  AS data_fim_atendimento_chamado,
    SLA_DATA_PREV_FIM              AS data_prevista_fim_atendimento_chamado,

    -- SLA (Prazo do Primeiro Atendimento)
    SLA_PA_HORAS                    AS sla_horas_chamado,
    SLA_PADRAO_HORAS                AS sla_padrao_horas_chamado,
    SLA_PRAZO                        AS sla_situacao_atual_chamado,
    SLAFINAL                          AS sla_situacao_final_chamado,
    SLA_DIAS                          AS data_prevista_primeiro_atendimento_chamado,
    SLA_HRMIN                        AS sla_horas_minutos,
    IDSLASTATUS                      AS id_status_sla,
    CDSLACONTROL                    AS codigo_controle_sla,

    -- Duração
    DIAS_DUR                        AS dias_duracao_chamado,
    HR_DUR                            AS horas_duracao_chamado,
    DIAS_DUR_SUP                    AS dias_duracao_com_suporte,
    DIAS_DUR_FSW                    AS dias_duracao_com_fsw,
    DIAS_DUR_DIST                    AS dias_duracao_com_fabricante,
    DIAS_DUR_CLI                    AS dias_duracao_com_cliente,
    DIAS_DUR_TICLI                    AS dias_duracao_com_TIcliente


FROM ITSM_CHAMADOS`;

const CAMPOS_SEMANTICOS = [
  { coluna: 'chamado', tipo: 'identificador', descricao: 'Número/código do chamado no SoftExpert.', sinonimos: 'numero do chamado, codigo do chamado, ticket', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: 'Use para localizar um chamado específico pelo número.' },
  { coluna: 'chamado_referencia', tipo: 'dimensao', descricao: 'Chamado de referência/vinculado a este chamado.', sinonimos: 'chamado vinculado, chamado relacionado', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'status_chamado', tipo: 'status', descricao: 'Status geral do chamado no SoftExpert. Valores reais (exatos): Pendente, Andamento, Encerrado.', sinonimos: 'status, situacao, situacao do chamado', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Chamados "abertos"/"em aberto" = status_chamado IN (\'Pendente\',\'Andamento\'). Chamados "fechados"/"encerrados" = status_chamado = \'Encerrado\'.' },
  { coluna: 'etapa_atual_chamado', tipo: 'dimensao', descricao: 'Nome da etapa/atividade atual do chamado dentro do fluxo do SoftExpert.', sinonimos: 'etapa, atividade atual, fase do processo', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Diferente de status_chamado: representa a etapa do workflow, não o status geral.' },
  { coluna: 'encerramento_automatico_chamado', tipo: 'dimensao', descricao: 'Indica se o chamado foi encerrado automaticamente pelo sistema.', sinonimos: 'encerramento automatico, fechado automaticamente', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'aguardando_retorno', tipo: 'dimensao', descricao: 'Indica o que o chamado está aguardando (ex: retorno do cliente).', sinonimos: 'aguardando, pendente de retorno', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'matricula_analista', tipo: 'dimensao', descricao: 'Matrícula do analista responsável atual pelo chamado.', sinonimos: 'matricula do analista', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'codigo_analista', tipo: 'identificador', descricao: 'Código interno do analista responsável atual.', sinonimos: 'codigo do analista', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'nome_analista', tipo: 'dimensao', descricao: 'Nome do analista responsável atual pelo chamado.', sinonimos: 'analista, responsavel, atendente, quem esta atendendo', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use para "chamados do analista X", "chamados atendidos por X".' },
  { coluna: 'codigo_analista_transferencia', tipo: 'identificador', descricao: 'Código do analista para quem o chamado foi transferido (mudança de fila/responsável).', sinonimos: 'analista de transferencia, transferido para', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: 'Diferente de nome_analista: representa o destino de uma transferência, não o responsável atual.' },
  { coluna: 'id_cliente', tipo: 'identificador', descricao: 'Identificador interno da empresa cliente.', sinonimos: 'id da empresa, codigo da empresa', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'cnpj_cliente', tipo: 'dimensao', descricao: 'CNPJ da empresa cliente.', sinonimos: 'cnpj', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'empresa_cliente', tipo: 'dimensao', descricao: 'Nome da empresa cliente que abriu o chamado.', sinonimos: 'cliente, empresa, nome do cliente', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use para "chamados da empresa X", "chamados do cliente X".' },
  { coluna: 'codigo_solicitante_cliente', tipo: 'identificador', descricao: 'Código do usuário solicitante (pessoa do cliente que abriu o chamado).', sinonimos: 'codigo do solicitante', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'matricula_solicitante_cliente', tipo: 'identificador', descricao: 'Matrícula/id técnico do solicitante do cliente.', sinonimos: 'matricula do solicitante', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'funcao_solicitante_cliente', tipo: 'dimensao', descricao: 'Função/cargo do solicitante do cliente.', sinonimos: 'cargo do solicitante, funcao', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'administrador_cliente', tipo: 'dimensao', descricao: 'Indica se o solicitante do cliente é administrador do sistema.', sinonimos: 'administrador, admin', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'solicitante_cliente', tipo: 'dimensao', descricao: 'Nome da pessoa do cliente que abriu o chamado.', sinonimos: 'solicitante, quem abriu o chamado, quem pediu', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use para "chamados abertos por fulano", "chamados solicitados por fulano".' },
  { coluna: 'email_solicitante_cliente', tipo: 'dimensao', descricao: 'E-mail do solicitante do cliente.', sinonimos: 'email do solicitante, e-mail', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'papel_funcional_cliente', tipo: 'dimensao', descricao: 'Papel/perfil funcional do solicitante dentro da empresa cliente.', sinonimos: 'papel funcional, perfil', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'categoria_chamado', tipo: 'dimensao', descricao: 'Categoria de classificação do chamado.', sinonimos: 'categoria', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use para "chamados da categoria X", "quantos chamados por categoria".' },
  { coluna: 'tipo_chamado', tipo: 'dimensao', descricao: 'Tipo do chamado no SoftExpert (classificação diferente de categoria).', sinonimos: 'tipo de chamado, tipo', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Diferente de categoria_chamado: representa o tipo de solicitação, não a categoria de negócio.' },
  { coluna: 'produto_chamado', tipo: 'dimensao', descricao: 'Produto relacionado ao chamado.', sinonimos: 'produto', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'componente_chamado', tipo: 'dimensao', descricao: 'Componente/módulo do produto relacionado ao chamado.', sinonimos: 'componente, modulo', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'assunto_chamado', tipo: 'texto', descricao: 'Assunto/título resumido do chamado.', sinonimos: 'assunto, titulo', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: 'Texto curto; não usar em GROUP BY.' },
  { coluna: 'descricao_chamado', tipo: 'texto', descricao: 'Descrição detalhada do chamado.', sinonimos: 'descricao, detalhes', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: 'Texto livre; não agrupável nem recomendado para filtro exato.' },
  { coluna: 'complexidade_chamado', tipo: 'dimensao', descricao: 'Nível de complexidade atribuído ao chamado.', sinonimos: 'complexidade', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: '' },
  { coluna: 'data_abertura_chamado', tipo: 'data', descricao: 'Data em que o chamado foi aberto/iniciado.', sinonimos: 'data de abertura, quando foi aberto, data do chamado', filtravel: 1, agrupavel: 1, ordenavel: 1, regra: 'Campo de data principal — usado pelo motor de período (filtro de mês/ano/intervalo).' },
  { coluna: 'data_fim_atendimento_chamado', tipo: 'data', descricao: 'Data de encerramento/fim do atendimento do chamado.', sinonimos: 'data de fechamento, data de encerramento, quando foi fechado', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'data_prevista_fim_atendimento_chamado', tipo: 'data', descricao: 'Data prevista de conclusão do chamado conforme o SLA contratado.', sinonimos: 'prazo previsto, data prevista, prazo do sla', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: 'Chamados "proximos de ficar em atraso" (ou "quase vencendo"): status_chamado IN (\'Pendente\',\'Andamento\') AND data_prevista_fim_atendimento_chamado BETWEEN GETDATE() AND DATEADD(HOUR, 24, GETDATE()) — janela das PROXIMAS 24 horas a partir de agora (futuro), nunca no passado. Diferente de "em atraso" (que usa sla_situacao_atual_chamado = Em atraso, prazo ja vencido, data no passado).' },
  { coluna: 'sla_horas_chamado', tipo: 'metrica', descricao: 'SLA em horas do Prazo do Primeiro Atendimento (PA) — tempo real de primeiro atendimento.', sinonimos: 'sla em horas, tempo de primeiro atendimento', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: 'Campo oficial de SLA para perguntas sobre prazo de primeiro atendimento.' },
  { coluna: 'sla_padrao_horas_chamado', tipo: 'metrica', descricao: 'SLA padrão contratual em horas (meta), para comparação com o SLA realizado.', sinonimos: 'sla contratado, meta de sla, sla padrao', filtravel: 1, agrupavel: 0, ordenavel: 0, regra: 'Comparar com sla_horas_chamado para saber se o chamado está dentro ou fora do prazo contratado.' },
  { coluna: 'sla_situacao_atual_chamado', tipo: 'status', descricao: 'Situação atual do chamado em relação ao SLA, enquanto ainda está em andamento. Valores reais (exatos, sensiveis a maiuscula/minuscula): "Em dia", "Em atraso".', sinonimos: 'sla em dia, sla atrasado, situacao do sla, esta atrasado', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use os valores EXATOS: sla_situacao_atual_chamado = \'Em dia\' ou sla_situacao_atual_chamado = \'Em atraso\'. IMPORTANTE: esta coluna sozinha NAO diferencia chamados abertos de encerrados — \'Em dia\' e \'Em atraso\' tambem aparecem em chamados ja encerrados. REGRA PADRAO: quando o usuario perguntar "chamados no prazo" ou "chamados em atraso" SEM mencionar "encerrado"/"fechado" explicitamente, SEMPRE considere apenas chamados ABERTOS: status_chamado IN (\'Pendente\',\'Andamento\') AND sla_situacao_atual_chamado = \'Em dia\'|\'Em atraso\'. Se o usuario pedir explicitamente "chamados ENCERRADOS em atraso" ou similar, use sla_situacao_final_chamado (nao esta coluna) combinado com status_chamado = \'Encerrado\'.' },
  { coluna: 'sla_situacao_final_chamado', tipo: 'status', descricao: 'Situação final do chamado em relação ao SLA no momento do encerramento. Valores reais (exatos): "No Prazo", "Em Atraso".', sinonimos: 'sla cumprido, sla estourado, encerrado no prazo, encerrado em atraso', filtravel: 1, agrupavel: 1, ordenavel: 0, regra: 'Use os valores EXATOS: sla_situacao_final_chamado = \'No Prazo\' ou sla_situacao_final_chamado = \'Em Atraso\'. Use esta coluna SOMENTE quando o usuario pedir explicitamente por chamados ENCERRADOS/FECHADOS (ex: "chamados encerrados em atraso", "chamados fechados fora do prazo") — nesse caso combine com status_chamado = \'Encerrado\'. Para perguntas genericas "chamados em atraso"/"no prazo" sem mencionar encerramento, use sla_situacao_atual_chamado (nao esta coluna), que por padrao considera so chamados abertos.' },
  { coluna: 'data_prevista_primeiro_atendimento_chamado', tipo: 'data', descricao: 'Data prevista para o primeiro atendimento do chamado (PA), conforme o SLA contratado.', sinonimos: 'prazo do primeiro atendimento, data prevista de atendimento', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: 'Diferente de data_prevista_fim_atendimento_chamado: este é o prazo do PRIMEIRO atendimento, o outro é o prazo de CONCLUSÃO do chamado.' },
  { coluna: 'sla_horas_minutos', tipo: 'texto', descricao: 'SLA formatado como texto no padrão horas:minutos.', sinonimos: 'sla hh:mm', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: 'Formato texto (HH:MM) — não usar em cálculo agregado; usar sla_horas_chamado para métricas.' },
  { coluna: 'id_status_sla', tipo: 'identificador', descricao: 'Identificador técnico do status de SLA.', sinonimos: '', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'codigo_controle_sla', tipo: 'identificador', descricao: 'Código de controle interno do SLA.', sinonimos: '', filtravel: 0, agrupavel: 0, ordenavel: 0, regra: '' },
  { coluna: 'dias_duracao_chamado', tipo: 'metrica', descricao: 'Duração total do chamado em dias, do início ao fim.', sinonimos: 'duracao em dias, dias de duracao, tempo total em dias', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: 'Use para "quanto tempo demorou", "chamados com maior duração".' },
  { coluna: 'horas_duracao_chamado', tipo: 'metrica', descricao: 'Duração total do chamado em horas, do início ao fim.', sinonimos: 'duracao em horas, horas de duracao', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'dias_duracao_com_suporte', tipo: 'metrica', descricao: 'Dias que o chamado ficou parado com a equipe/fila de suporte.', sinonimos: 'dias com suporte, tempo com suporte', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'dias_duracao_com_fsw', tipo: 'metrica', descricao: 'Dias que o chamado ficou parado com a área de desenvolvimento (FSW — Fábrica de Software).', sinonimos: 'dias com FSW, dias com desenvolvimento, dias com fabrica de software', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'dias_duracao_com_fabricante', tipo: 'metrica', descricao: 'Dias que o chamado ficou parado aguardando o fabricante/distribuidor.', sinonimos: 'dias com fabricante, tempo com fabricante', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'dias_duracao_com_cliente', tipo: 'metrica', descricao: 'Dias que o chamado ficou parado aguardando retorno do cliente.', sinonimos: 'dias com cliente, tempo aguardando cliente', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
  { coluna: 'dias_duracao_com_TIcliente', tipo: 'metrica', descricao: 'Dias que o chamado ficou parado aguardando a equipe de TI do cliente.', sinonimos: 'dias com TI do cliente, tempo com TI cliente', filtravel: 1, agrupavel: 0, ordenavel: 1, regra: '' },
];

function upsertDataset(connectionId) {
  const existente = db.prepare(
    'SELECT id FROM datasets WHERE empresa_id = ? AND nome = ?'
  ).get(EMPRESA_ID, 'softexpert_chamados');

  const campos = {
    erp: 'SoftExpert',
    sql_base: SQL_BASE,
    campo_data: 'data_abertura_chamado',
    limite_max: 100000,
    tipo: 'view_semantica',
    modulo: 'chamados',
    spec: 'chamados',
    ativo_ia_owner: 1,
    prioridade: 0,
    view_nome: 'ITSM_CHAMADOS',
    view_descricao: 'Chamados',
    campos_semanticos_json: JSON.stringify(CAMPOS_SEMANTICOS),
    connection_id: connectionId,
  };

  if (existente) {
    const sets = Object.keys(campos).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE datasets SET ${sets}, atualizado_em = ? WHERE id = ?`)
      .run(...Object.values(campos), _agora(), existente.id);
    console.log(`[dataset] atualizado: id=${existente.id}`);
    return existente.id;
  }

  const id = crypto.randomUUID();
  const cols = ['id', 'empresa_id', 'nome', ...Object.keys(campos), 'criado_em', 'atualizado_em'];
  const vals = [id, EMPRESA_ID, 'softexpert_chamados', ...Object.values(campos), _agora(), _agora()];
  db.prepare(`INSERT INTO datasets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  console.log(`[dataset] criado: id=${id}`);
  return id;
}

// ── 3. Intenção ────────────────────────────────────────────────────────────
const FRASES_EXEMPLO = [
  'chamados abertos', 'chamados fechados', 'quantos chamados o analista X tem',
  'chamados do analista', 'chamados atrasados', 'chamados com sla estourado',
  'chamados dentro do prazo', 'chamados da empresa Y este mes', 'chamados por status',
  'chamados por categoria', 'chamados por analista', 'chamados abertos por fulano',
  'tempo medio de atendimento dos chamados', 'chamados em aberto no mes',
].join('\n');

function upsertIntencao() {
  const existente = db.prepare(
    'SELECT id FROM intentions WHERE empresa_id = ? AND nome = ?'
  ).get(EMPRESA_ID, 'chamados_softexpert');

  if (existente) {
    db.prepare(`
      UPDATE intentions SET
        descricao = ?, modulo = 'chamados', acao = 'ai_text_to_sql', erp = 'SoftExpert',
        frases_exemplo = ?, ativo = 1, atualizado_em = ?
      WHERE id = ?
    `).run('Consultas dinamicas de chamados do SoftExpert via IA (Text-to-SQL)', FRASES_EXEMPLO, _agora(), existente.id);
    console.log(`[intencao] atualizada: id=${existente.id}`);
    return existente.id;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO intentions
      (id, empresa_id, nome, descricao, modulo, acao, dataset_id, frases_exemplo, ativo, erp, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'chamados', 'ai_text_to_sql', NULL, ?, 1, 'SoftExpert', ?, ?)
  `).run(id, EMPRESA_ID, 'chamados_softexpert', 'Consultas dinamicas de chamados do SoftExpert via IA (Text-to-SQL)', FRASES_EXEMPLO, _agora(), _agora());
  console.log(`[intencao] criada: id=${id}`);
  return id;
}

// ── Execução ──────────────────────────────────────────────────────────────
console.log(`Aplicando pacote softexpert_chamados para empresa_id=${EMPRESA_ID}...`);
const connectionId = upsertConexao();
const datasetId = upsertDataset(connectionId);
const intentionId = upsertIntencao();
console.log('\nConcluído. IDs finais:');
console.log({ connectionId, datasetId, intentionId });
console.log('\nLEMBRETE: configure a senha do banco SoftExpert no Agente Local (aba "Conexoes');
console.log('adicionais", connection_key = softexpert_chamados) antes de testar em producao.');

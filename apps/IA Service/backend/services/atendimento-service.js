// Camada de orquestracao/regras de negocio do IA Service.
// routes -> service (este arquivo) -> repository -> SQLite.
// Nenhum SQL aqui — apenas chamadas aos repositories e validacao de domínio.

const atendimentoRepo = require('../repositories/atendimento-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const anexoRepo = require('../repositories/anexo-repository');

// ORIGEM = de onde o atendimento se origina no negócio (quem/o quê é a fonte
// do problema relatado). CANAL_ENTRADA = por onde o dado chegou tecnicamente
// ao IA Service. São dimensões independentes — ex.: origem=softexpert pode
// chegar tanto por canal_entrada=web (analista copia/cola) quanto por
// canal_entrada=api (integração futura). "api" NUNCA é origem, só canal.
const ORIGENS_VALIDAS = new Set(['manual', 'softexpert', 'outro']);
const CANAIS_ENTRADA_VALIDOS = new Set(['web', 'api', 'importacao']);
const STATUS_VALIDOS = ['NOVO', 'EM_DIAGNOSTICO', 'AGUARDANDO_RETORNO', 'SOLUCAO_ENCONTRADA', 'RESOLVIDO'];

/**
 * Contrato canônico de entrada (seção 19/22 da análise da Etapa 0, revisado
 * nos ajustes finais da Etapa 1 — origem e canal_entrada separados):
 * {
 *   origem, canalEntrada, referenciaExterna, empresaId, conteudoBruto,
 *   contextoEstruturado, anexos, metadados: { criadoPorUsuarioId, criadoPorIntegracao }
 * }
 *
 * Nesta etapa só existe o adapter manual (origem=manual, canalEntrada=web) —
 * mas toda entrada (manual ou futura API) deve passar por esta mesma função
 * `criarAtendimentoDeEntradaCanonica`, nunca escrever direto no repository a
 * partir da rota.
 */
function _normalizarEntradaCanonica(entrada) {
  const origem = entrada.origem || 'manual';
  if (!ORIGENS_VALIDAS.has(origem)) {
    throw new Error(`origem inválida: ${origem}`);
  }

  const canalEntrada = entrada.canalEntrada || 'web';
  if (!CANAIS_ENTRADA_VALIDOS.has(canalEntrada)) {
    throw new Error(`canalEntrada inválido: ${canalEntrada}`);
  }

  if (!entrada.empresaId) {
    throw new Error('empresaId é obrigatório na entrada canônica.');
  }
  if (!entrada.conteudoBruto || !String(entrada.conteudoBruto).trim()) {
    throw new Error('conteudoBruto é obrigatório na entrada canônica.');
  }

  return {
    origem,
    canalEntrada,
    referenciaExterna: entrada.referenciaExterna ?? null,
    empresaId: Number(entrada.empresaId),
    conteudoBruto: String(entrada.conteudoBruto).trim(),
    contextoEstruturado: entrada.contextoEstruturado ?? null,
    // Nesta etapa não há extração automática por IA (fora de escopo — seção 23
    // do prompt da Etapa 1). contextoOrigem fica registrado como 'nao_processado'
    // até o motor de IA da etapa futura preencher contextoEstruturado de fato.
    contextoOrigem: entrada.contextoEstruturado ? (entrada.contextoOrigem || 'ia') : 'nao_processado',
    precisaRevisao: !!entrada.precisaRevisao,
    criadoPorUsuarioId: entrada.metadados?.criadoPorUsuarioId ?? null,
    criadoPorIntegracao: entrada.metadados?.criadoPorIntegracao ?? null,
    consultorId: entrada.consultorId ?? null,
  };
}

/**
 * Cria um atendimento a partir da entrada canônica e persiste a primeira
 * mensagem (o próprio conteúdo colado) como turno inicial da conversa, numa
 * única transação SQLite (ver atendimento-repository.criarAtendimentoComPrimeiraMensagem).
 * Se a gravação da mensagem falhar, a transação inteira sofre ROLLBACK — o
 * atendimento não fica gravado órfão sem sua mensagem inicial.
 */
function criarAtendimentoDeEntradaCanonica(entrada) {
  const dados = _normalizarEntradaCanonica(entrada);

  return atendimentoRepo.criarAtendimentoComPrimeiraMensagem(
    dados.empresaId,
    dados,
    {
      papel: 'user',
      conteudo: dados.conteudoBruto,
      usuarioId: dados.criadoPorUsuarioId,
    }
  );
}

function getAtendimento(empresaId, atendimentoId) {
  return atendimentoRepo.getAtendimento(empresaId, atendimentoId);
}

function listarAtendimentos(empresaId, filtros) {
  return atendimentoRepo.listarAtendimentos(empresaId, filtros);
}

function atualizarStatus(empresaId, atendimentoId, status) {
  if (!STATUS_VALIDOS.includes(status)) {
    throw new Error(`status inválido: ${status}. Use um de: ${STATUS_VALIDOS.join(', ')}`);
  }
  return atendimentoRepo.atualizarStatus(empresaId, atendimentoId, status);
}

function adicionarMensagem(empresaId, atendimentoId, { papel, conteudo, usuarioId }) {
  const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado nesta empresa.');
  return mensagemRepo.salvarMensagem(empresaId, atendimentoId, { papel, conteudo, usuarioId });
}

function listarMensagens(empresaId, atendimentoId) {
  const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado nesta empresa.');
  return mensagemRepo.listarMensagens(empresaId, atendimentoId);
}

function listarAnexos(empresaId, atendimentoId) {
  const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado nesta empresa.');
  return anexoRepo.listarAnexos(empresaId, atendimentoId);
}

module.exports = {
  STATUS_VALIDOS,
  ORIGENS_VALIDAS,
  CANAIS_ENTRADA_VALIDOS,
  criarAtendimentoDeEntradaCanonica,
  getAtendimento,
  listarAtendimentos,
  atualizarStatus,
  adicionarMensagem,
  listarMensagens,
  listarAnexos,
};

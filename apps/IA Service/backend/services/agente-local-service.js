// Orquestra config do Agente Local + fontes históricas do IA Service.
// Segredos (token, senha) nunca saem daqui em texto claro para o frontend —
// só booleanos "está configurado" e nunca aparecem em log.

const agenteRepo = require('../repositories/agente-local-repository');
const cryptoEnvelope = require('./crypto-envelope');
const provider = require('./agente-local-provider');
const platformStore = require('../../../IAHUB/backend/platform-store');
const armazenamentoAnexos = require('./armazenamento-anexos');
const atendimentoRepo = require('../repositories/atendimento-repository');

// Depois de "reimportar do zero"/excluir fonte, varre data/anexos/<empresa>/
// inteiro e apaga qualquer subpasta cujo atendimentoId não existe mais na
// tabela `atendimentos` — por EXCLUSÃO, não por uma lista de "quem eu sei
// que apaguei" (essa segunda abordagem dependeria da query de captura
// acertar todo caso, incluindo atendimentos que já estivessem órfãos antes
// desta limpeza). Decisão explícita do usuário: "reimportar do zero é sumir
// com o que tem" — zero resquício físico de qualquer execução anterior,
// mesmo os 169 diretórios órfãos (3.56 MB) de limpezas passadas antes deste
// fix existir. Best-effort: uma falha ao apagar um diretório não aborta o
// restante nem a limpeza do banco, que já aconteceu antes desta chamada.
async function _limparAnexosOrfaosDaEmpresa(empresaId) {
  try {
    const atendimentoIdsValidos = atendimentoRepo.listarIdsPorEmpresa(empresaId);
    return await armazenamentoAnexos.limparDiretoriosOrfaos(empresaId, atendimentoIdsValidos);
  } catch (_) {
    return { removidos: 0 };
  }
}

function permitirConfigLegada() {
  return process.env.SVC_ALLOW_LEGACY_CONFIG === '1';
}

/**
 * Resolve a config do Agente Local com a mesma cascata já usada para
 * chaves de IA (ver ai-config-service.resolverKeysEOrdem): Platform
 * primeiro, legado (agente_local_config do próprio IA Service) só como
 * fallback explícito (2026-10, mesma migração das outras 5 abas de
 * Configuração de IA — Platform agora também guarda URL/Token/Crypto Key
 * do Agente Local em platform_agent_configs). Devolve sempre no formato
 * "token/cryptoKey já decifrados em texto puro" — quem chama nunca precisa
 * saber se veio da Platform (decrypt próprio) ou do legado (cryptoEnvelope).
 */
function _resolverConfig(empresaId) {
  const platform = platformStore.getAgentConfig(empresaId);
  if (platform) {
    return {
      empresaId: platform.empresaId,
      url: platform.url,
      token: platform.token || null,
      cryptoKey: platform.cryptoKey || null,
      cryptoAtivo: platform.cryptoAtivo,
      ultimoTesteEm: null,
      ultimoTesteOk: null,
      tokenConfigurado: !!platform.token,
      cryptoKeyConfigurada: !!platform.cryptoKey,
    };
  }
  if (!permitirConfigLegada()) return null;
  const legado = agenteRepo.getConfig(empresaId);
  if (!legado) return null;
  return {
    empresaId: legado.empresaId,
    url: legado.url,
    token: legado.tokenEnc ? cryptoEnvelope.decryptSecret(legado.tokenEnc) : null,
    cryptoKey: legado.cryptoKeyEnc ? cryptoEnvelope.decryptSecret(legado.cryptoKeyEnc) : null,
    cryptoAtivo: legado.cryptoAtivo,
    ultimoTesteEm: legado.ultimoTesteEm,
    ultimoTesteOk: legado.ultimoTesteOk,
    tokenConfigurado: !!legado.tokenEnc,
    cryptoKeyConfigurada: !!legado.cryptoKeyEnc,
  };
}

function getConfig(empresaId) {
  const config = _resolverConfig(empresaId);
  if (!config) return { empresaId, configurado: false };
  return {
    empresaId: config.empresaId,
    url: config.url,
    tokenConfigurado: config.tokenConfigurado,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKeyConfigurada: config.cryptoKeyConfigurada,
    ultimoTesteEm: config.ultimoTesteEm,
    ultimoTesteOk: config.ultimoTesteOk,
    configurado: !!(config.url && config.token),
  };
}

function salvarConfig(empresaId, dados) {
  if (process.env.SVC_ALLOW_LEGACY_CONFIG_WRITE !== '1') {
    throw new Error('Configuração de Agente Local isolada. Use IAHub Platform → Configurar IA → Agente Local.');
  }
  const { url, token, cryptoKey, cryptoAtivo } = dados;
  const legado = { url, cryptoAtivo };
  if (token) legado.tokenEnc = cryptoEnvelope.encryptSecret(token);
  if (cryptoKey) legado.cryptoKeyEnc = cryptoEnvelope.encryptSecret(cryptoKey);
  agenteRepo.salvarConfig(empresaId, legado);
  return getConfig(empresaId);
}

/**
 * Decifra e devolve o token JÁ SALVO em texto puro — pedido explícito do
 * usuário (2026-09) para o botão "olhinho" da tela poder revelar o valor
 * salvo, não só o que foi digitado na sessão atual. Muda o padrão de
 * segurança usado no resto do IA Service (nenhum outro segredo é reexibido
 * assim, ver ai-config-repository.js/config-ia.html) — decisão explícita e
 * restrita a esta rota, chamada só sob clique do usuário, nunca junto do
 * carregamento normal da tela (getConfig acima nunca inclui o valor cru).
 */
function getTokenRevelado(empresaId) {
  const config = _resolverConfig(empresaId);
  return config?.token || null;
}

/**
 * Mesma lógica de getTokenRevelado, para a CRYPTO_KEY (AES-256-GCM) usada
 * quando o Agente Local está com "Exigir criptografia" ativo — precisa ser
 * IDÊNTICA à chave configurada na tela local do agente (painel "Criptografia
 * AES-256-GCM"), copiada manualmente pelo usuário.
 */
function getCryptoKeyRevelada(empresaId) {
  const config = _resolverConfig(empresaId);
  return config?.cryptoKey || null;
}

async function testarConexao(empresaId) {
  const config = _resolverConfig(empresaId);
  if (!config?.url) throw new Error('URL do Agente Local não configurada.');
  if (!config?.token) throw new Error('Token do Agente Local não configurado.');

  try {
    await provider.testarAgente(config.url, config.token);
    agenteRepo.registrarTeste(empresaId, true);
    return { ok: true, mensagem: 'Conexão com o Agente Local estabelecida com sucesso.' };
  } catch (err) {
    agenteRepo.registrarTeste(empresaId, false);
    throw err;
  }
}

/**
 * Lista as conexões já cadastradas no Agente Local — usado pela tela de
 * Fontes Históricas para o usuário ESCOLHER a connection_key num dropdown
 * (2026-09, pedido do usuário: evitar risco de digitar um nome diferente
 * do que está de fato cadastrado no agente). Requer GET /api/conexoes-listar
 * do agente (rota nova, Bearer Token) — se o agente ainda não tiver essa
 * rota (versão antiga não atualizada), o erro sobe para a UI cair no
 * fallback de digitar manualmente.
 */
async function listarConexoesDoAgente(empresaId) {
  const config = _resolverConfig(empresaId);
  if (!config?.url || !config?.token) throw new Error('Configure o Agente Local (URL + token) antes de listar conexões.');
  return provider.listarConexoes(config.url, config.token, { empresaId });
}

/**
 * Fonte histórica no IA Service é SÓ uma referência a uma conexão que já
 * existe no Agente Local — mesmo padrão do IA Command (connections-routes.js/
 * connection-factory.js: connection_key aponta para uma conexão cadastrada
 * manualmente no agente, o consumidor nunca cadastra/reenvia credencial).
 * 2026-09, correção de design a pedido do usuário: antes, esta tela pedia
 * host/porta/usuário/senha e os REENVIAVA para o agente via
 * /api/empresas/sync (sincronizarESincronizarFonte, removida) — duas fontes
 * de verdade da mesma credencial, podendo divergir. Agora, se o
 * connectionKey não existir no Agente Local, testarFonte/executarSelectNaFonte
 * simplesmente falham com o erro que o agente já retorna (conexão
 * desconhecida) — sem lógica de sincronização aqui.
 */
function criarFonte(empresaId, { connectionKey, nome, sistemaOrigem, adapter }) {
  if (!connectionKey) throw new Error('connectionKey é obrigatório.');
  if (!sistemaOrigem) throw new Error('sistemaOrigem é obrigatório.');
  if (!adapter) throw new Error('adapter é obrigatório.');

  return agenteRepo.criarFonte(empresaId, {
    connectionKey,
    nome: nome || connectionKey,
    sistemaOrigem,
    adapter,
  });
}

function atualizarFonte(empresaId, fonteId, patch) {
  return agenteRepo.atualizarFonte(empresaId, fonteId, patch);
}

function getFonte(empresaId, fonteId) {
  return agenteRepo.getFonte(empresaId, fonteId);
}

/**
 * Exclusão SEMPRE apaga em cascata (ON DELETE CASCADE) todo o histórico de
 * importações/chamados/posicionamentos vinculado — decisão explícita do
 * usuário (2026-09): depois de importado, o vínculo com a fonte não tem
 * valor, só serve pra reimportar. Sem trava aqui — a confirmação/aviso fica
 * na UI (base-historica.html), não no backend.
 */
async function excluirFonte(empresaId, fonteId) {
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  const resultado = agenteRepo.excluirFonte(empresaId, fonteId);
  const { removidos } = await _limparAnexosOrfaosDaEmpresa(empresaId);
  return { ...resultado, diretoriosAnexosRemovidos: removidos };
}

// "Limpar Log" — só apaga o log de importações, nunca toca em atendimentos/
// anexos (ver agenteRepo.limparHistoricoFonte), então não há diretório de
// disco para varrer aqui.
async function limparHistoricoFonte(empresaId, fonteId) {
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  return agenteRepo.limparHistoricoFonte(empresaId, fonteId);
}

// "Zerar Base" — reset radical da fonte (chamados/posicionamentos/
// atendimentos/importações), sem disparar reimportação em seguida (isso é
// decisão explícita do usuário no frontend, separado de "Reimportar do zero").
async function zerarBaseFonte(empresaId, fonteId) {
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  const resultado = agenteRepo.zerarBaseFonte(empresaId, fonteId);
  const { removidos } = await _limparAnexosOrfaosDaEmpresa(empresaId);
  return { ...resultado, diretoriosAnexosRemovidos: removidos };
}

function listarFontes(empresaId, filtros) {
  return agenteRepo.listarFontes(empresaId, filtros);
}

async function testarFonte(empresaId, fonteId) {
  const config = _resolverConfig(empresaId);
  if (!config?.url || !config?.token) throw new Error('Configure o Agente Local (URL + token) antes de testar a fonte.');
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');

  const rows = await provider.executarSelect(config.url, config.token, {
    sql: 'SELECT 1 AS ok',
    limit: 1,
    connectionKey: fonte.connectionKey,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKey: config.cryptoKey,
    empresaId,
  });
  return { ok: true, rows };
}

/**
 * Executa um SELECT na fonte histórica via agente — usado pelo importador
 * (Checkpoint 4 em diante). Encapsula a resolução de config/senha para que o
 * importador nunca lide com segredos diretamente.
 */
async function executarSelectNaFonte(empresaId, fonteId, { sql, params, limit }) {
  const config = _resolverConfig(empresaId);
  if (!config?.url || !config?.token) throw new Error('Agente Local não configurado para esta empresa.');
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  if (!fonte.ativo) throw new Error('Fonte histórica inativa.');

  return provider.executarSelect(config.url, config.token, {
    sql, params, limit,
    connectionKey: fonte.connectionKey,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKey: config.cryptoKey,
    empresaId,
  });
}

module.exports = {
  getConfig,
  salvarConfig,
  getTokenRevelado,
  getCryptoKeyRevelada,
  testarConexao,
  listarConexoesDoAgente,
  criarFonte,
  atualizarFonte,
  getFonte,
  listarFontes,
  excluirFonte,
  limparHistoricoFonte,
  testarFonte,
  executarSelectNaFonte,
};

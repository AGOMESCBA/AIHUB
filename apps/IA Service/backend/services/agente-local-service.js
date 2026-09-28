// Orquestra config do Agente Local + fontes históricas do IA Service.
// Segredos (token, senha) nunca saem daqui em texto claro para o frontend —
// só booleanos "está configurado" e nunca aparecem em log.

const agenteRepo = require('../repositories/agente-local-repository');
const cryptoEnvelope = require('./crypto-envelope');
const provider = require('./agente-local-provider');

function getConfig(empresaId) {
  const config = agenteRepo.getConfig(empresaId);
  if (!config) return { empresaId, configurado: false };
  return {
    empresaId: config.empresaId,
    url: config.url,
    tokenConfigurado: !!config.tokenEnc,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKeyConfigurada: !!config.cryptoKeyEnc,
    ultimoTesteEm: config.ultimoTesteEm,
    ultimoTesteOk: config.ultimoTesteOk,
    configurado: !!(config.url && config.tokenEnc),
  };
}

function salvarConfig(empresaId, { url, token, cryptoKey, cryptoAtivo }) {
  const dados = { url, cryptoAtivo };
  if (token) dados.tokenEnc = cryptoEnvelope.encryptSecret(token);
  if (cryptoKey) dados.cryptoKeyEnc = cryptoEnvelope.encryptSecret(cryptoKey);
  agenteRepo.salvarConfig(empresaId, dados);
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
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.tokenEnc) return null;
  return cryptoEnvelope.decryptSecret(config.tokenEnc);
}

/**
 * Mesma lógica de getTokenRevelado, para a CRYPTO_KEY (AES-256-GCM) usada
 * quando o Agente Local está com "Exigir criptografia" ativo — precisa ser
 * IDÊNTICA à chave configurada na tela local do agente (painel "Criptografia
 * AES-256-GCM"), copiada manualmente pelo usuário.
 */
function getCryptoKeyRevelada(empresaId) {
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.cryptoKeyEnc) return null;
  return cryptoEnvelope.decryptSecret(config.cryptoKeyEnc);
}

async function testarConexao(empresaId) {
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.url) throw new Error('URL do Agente Local não configurada.');
  if (!config?.tokenEnc) throw new Error('Token do Agente Local não configurado.');

  const token = cryptoEnvelope.decryptSecret(config.tokenEnc);
  try {
    await provider.testarAgente(config.url, token);
    agenteRepo.registrarTeste(empresaId, true);
    return { ok: true, mensagem: 'Conexão com o Agente Local estabelecida com sucesso.' };
  } catch (err) {
    agenteRepo.registrarTeste(empresaId, false);
    throw err;
  }
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

function listarFontes(empresaId, filtros) {
  return agenteRepo.listarFontes(empresaId, filtros);
}

async function testarFonte(empresaId, fonteId) {
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.url || !config?.tokenEnc) throw new Error('Configure o Agente Local (URL + token) antes de testar a fonte.');
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');

  const token = cryptoEnvelope.decryptSecret(config.tokenEnc);
  const cryptoKey = config.cryptoKeyEnc ? cryptoEnvelope.decryptSecret(config.cryptoKeyEnc) : null;

  const rows = await provider.executarSelect(config.url, token, {
    sql: 'SELECT 1 AS ok',
    limit: 1,
    connectionKey: fonte.connectionKey,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKey,
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
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.url || !config?.tokenEnc) throw new Error('Agente Local não configurado para esta empresa.');
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  if (!fonte.ativo) throw new Error('Fonte histórica inativa.');

  const token = cryptoEnvelope.decryptSecret(config.tokenEnc);
  const cryptoKey = config.cryptoKeyEnc ? cryptoEnvelope.decryptSecret(config.cryptoKeyEnc) : null;

  return provider.executarSelect(config.url, token, {
    sql, params, limit,
    connectionKey: fonte.connectionKey,
    cryptoAtivo: config.cryptoAtivo,
    cryptoKey,
    empresaId,
  });
}

module.exports = {
  getConfig,
  salvarConfig,
  getTokenRevelado,
  getCryptoKeyRevelada,
  testarConexao,
  criarFonte,
  atualizarFonte,
  getFonte,
  listarFontes,
  testarFonte,
  executarSelectNaFonte,
};

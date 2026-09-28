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

function criarFonte(empresaId, { connectionKey, nome, sistemaOrigem, adapter, dbHost, dbPort, dbName, dbUser, senha, dbDriver }) {
  if (!connectionKey) throw new Error('connectionKey é obrigatório.');
  if (!sistemaOrigem) throw new Error('sistemaOrigem é obrigatório.');
  if (!adapter) throw new Error('adapter é obrigatório.');

  const fonte = agenteRepo.criarFonte(empresaId, {
    connectionKey,
    nome: nome || connectionKey,
    sistemaOrigem,
    adapter,
    dbHost,
    dbPort,
    dbName,
    dbUser,
    dbPassEnc: senha ? cryptoEnvelope.encryptSecret(senha) : null,
    dbDriver: dbDriver || 'ODBC Driver 17 for SQL Server',
  });
  return _semSegredo(fonte);
}

function atualizarFonte(empresaId, fonteId, patch) {
  const dados = { ...patch };
  if (patch.senha) {
    dados.dbPassEnc = cryptoEnvelope.encryptSecret(patch.senha);
  }
  delete dados.senha;
  const fonte = agenteRepo.atualizarFonte(empresaId, fonteId, dados);
  return _semSegredo(fonte);
}

function _semSegredo(fonte) {
  if (!fonte) return null;
  const { dbPassEnc, ...resto } = fonte;
  return { ...resto, senhaConfigurada: !!dbPassEnc };
}

function getFonte(empresaId, fonteId) {
  return _semSegredo(agenteRepo.getFonte(empresaId, fonteId));
}

function listarFontes(empresaId, filtros) {
  return agenteRepo.listarFontes(empresaId, filtros).map(_semSegredo);
}

/**
 * Sincroniza a fonte com o Agente Local (registra a connection_key lá) e
 * testa a conexão real ao SQL Server através do agente. A senha só é
 * descriptografada em memória durante esta chamada — nunca persistida em
 * claro, nunca logada.
 */
async function sincronizarESincronizarFonte(empresaId, fonteId, { empresaNome } = {}) {
  const config = agenteRepo.getConfig(empresaId);
  if (!config?.url || !config?.tokenEnc) throw new Error('Configure o Agente Local (URL + token) antes de sincronizar fontes.');

  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');

  const token = cryptoEnvelope.decryptSecret(config.tokenEnc);
  const senhaPlana = fonte.dbPassEnc ? cryptoEnvelope.decryptSecret(fonte.dbPassEnc) : '';

  await provider.sincronizarFonte(config.url, token, { empresaId, empresaNome, fonte, senhaPlana });
  agenteRepo.marcarSincronizadaNoAgente(empresaId, fonteId);
  return getFonte(empresaId, fonteId);
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
  testarConexao,
  criarFonte,
  atualizarFonte,
  getFonte,
  listarFontes,
  sincronizarESincronizarFonte,
  testarFonte,
  executarSelectNaFonte,
};

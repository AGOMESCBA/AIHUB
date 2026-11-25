'use strict';

// Configuração de processo do IA Talk. Só o que é do processo (porta, pastas)
// vem do ambiente; o que é por empresa fica no banco do Talk.

const path = require('path');

const RAIZ_TALK = path.join(__dirname, '..');
const RAIZ_REPO = path.join(RAIZ_TALK, '..', '..');

// Mesmo padrão dos outros sistemas: https://app.c3isystems.com.br/app/ia-talk/
// O nginx encaminha este prefixo inteiro (telas, API e Socket.IO) para o Talk.
const BASE_PATH = '/app/ia-talk';

function numeroDoAmbiente(nome, padrao) {
  const valor = Number(process.env[nome]);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

module.exports = {
  BASE_PATH,
  API_ADMIN: `${BASE_PATH}/api/admin`,
  API_PUBLICA: `${BASE_PATH}/api/publico`,
  API_V1: `${BASE_PATH}/api/v1`,
  SOCKET_PATH: `${BASE_PATH}/socket.io`,
  SOCKET_NAMESPACE: '/talk',
  RAIZ_TALK,
  RAIZ_REPO,
  DIR_FRONTEND: path.join(RAIZ_TALK, 'frontend'),
  DIR_PROTOTIPOS: path.join(RAIZ_TALK, 'prototipos'),
  DIR_UI: path.join(RAIZ_REPO, 'packages', 'ui', 'frontend'),
  DIR_DADOS: process.env.IA_TALK_DATA_DIR || path.join(RAIZ_TALK, 'data'),
  // 3000 = IAHub; 3101+ = workers do WhatsApp do IA Command.
  porta: () => numeroDoAmbiente('IA_TALK_PORT', 3050),
  portaSimulada: () => numeroDoAmbiente('IA_TALK_SIMULADO_PORT', 3051),
};

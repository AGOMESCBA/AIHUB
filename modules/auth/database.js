const path   = require('path');
const fs     = require('fs');
const bcrypt = require('bcryptjs');
const crud   = require('../crud');

const ARQUIVO  = 'usuarios';
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const AUDIT_FILE = path.join(LOG_DIR, 'auditoria.log');

// ── Bootstrap: cria o admin a partir do .env se ainda não houver usuários ──

async function inicializarAdmin() {
  const existentes = crud.listar(ARQUIVO);
  if (existentes.length > 0) return;

  const senhaPlana = process.env.ADMIN_PASS || 'iahub@2024';
  const senhaHash  = await bcrypt.hash(senhaPlana, 12);

  crud.criar(ARQUIVO, {
    nome:       'Administrador',
    usuario:    process.env.ADMIN_USER || 'admin',
    senha_hash: senhaHash,
    role:       'admin',
    empresas:   'all',   // 'all' = acesso irrestrito a todas as empresas
    celular:    '',
    email:      '',
    ativo:      true,
  });

  console.log('   [auth] Usuário admin inicializado a partir do .env');
}

// ── Leitura ──────────────────────────────────────────────────────────────────

function getUsuarios() {
  return crud.listar(ARQUIVO);
}

function getUsuarioPorLogin(usuario) {
  return crud.buscarPor(ARQUIVO, 'usuario', usuario);
}

// ── Auditoria ────────────────────────────────────────────────────────────────

function registrarAuditoria({ usuario, acao, ip, empresa_id = null, detalhes = '' }) {
  const linha = JSON.stringify({
    ts:         new Date().toISOString(),
    usuario,
    acao,
    ip,
    empresa_id,
    detalhes,
  });
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, linha + '\n', 'utf8');
  } catch (_) {}
}

module.exports = { inicializarAdmin, getUsuarios, getUsuarioPorLogin, registrarAuditoria };

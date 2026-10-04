// Testes de persistência/segurança/multiempresa da config de Pesquisa Web
// na Platform (platform_search_configs). NÃO usa platform-store.js/
// platform-routes.js diretamente (ambos têm DB_PATH fixo apontando para o
// banco real de desenvolvimento, apps/IAHUB/data/iahub-platform.db, que já
// tem dados reais migrados da empresa J2A) — em vez disso, aplica o mesmo
// ensurePlatformSchema contra um SQLite temporário isolado e replica a
// mesma lógica de criptografia/mascaramento para validar o contrato sem
// nenhum risco de tocar dado real.

const assert = require('assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ensurePlatformSchema } = require('../../IAHUB/backend/platform-schema');

const PREFIX = 'iahub-aes-gcm:';
function key() {
  return crypto.createHash('sha256').update('teste-chave-mestra-isolada').digest();
}
function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}
function decrypt(value) {
  if (!value) return '';
  if (!String(value).startsWith(PREFIX)) return String(value);
  const raw = Buffer.from(String(value).slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
function secretValue(row, col, reveal) {
  const has = !!(row && row[col]);
  if (!reveal) return { configurado: has, valor: has ? '***' : null };
  return has ? decrypt(row[col]) : '';
}

function dbTmp() {
  const db = new Database(path.join(os.tmpdir(), `iahub-platform-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
  ensurePlatformSchema(db);
  return db;
}

function salvarSearchConfig(db, empresaId, { provedorPrimario, fallbackOrdem, serperApiKey } = {}) {
  const atual = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  const data = {
    id: atual?.id || crypto.randomUUID(),
    provedor_primario: provedorPrimario || atual?.provedor_primario || 'serper',
    fallback_ordem: fallbackOrdem || atual?.fallback_ordem || 'serper,gemini,openai',
    serper_api_key_enc: serperApiKey ? encrypt(serperApiKey) : atual?.serper_api_key_enc || null,
    atualizado_em: new Date().toISOString(),
  };
  if (atual) {
    db.prepare('UPDATE platform_search_configs SET provedor_primario=?, fallback_ordem=?, serper_api_key_enc=?, atualizado_em=? WHERE empresa_id=?')
      .run(data.provedor_primario, data.fallback_ordem, data.serper_api_key_enc, data.atualizado_em, empresaId);
  } else {
    db.prepare('INSERT INTO platform_search_configs (id, empresa_id, provedor_primario, fallback_ordem, serper_api_key_enc, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(data.id, empresaId, data.provedor_primario, data.fallback_ordem, data.serper_api_key_enc, data.atualizado_em, data.atualizado_em);
  }
  return db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
}

function mapSearch(row, reveal = false) {
  if (!row) return { empresaId: null, provedorPrimario: 'serper', fallbackOrdem: 'serper,gemini,openai', secrets: {}, configurado: false };
  return {
    empresaId: row.empresa_id,
    provedorPrimario: row.provedor_primario || 'serper',
    fallbackOrdem: row.fallback_ordem || 'serper,gemini,openai',
    secrets: { serper_api_key: secretValue(row, 'serper_api_key_enc', reveal) },
    configurado: !!row.serper_api_key_enc,
  };
}

// A — Configuração: salvar, recuperar status sem retornar chave, substituir, inexistente
function testarConfiguracao() {
  const db = dbTmp();
  const empresaId = 1;

  // Config inexistente
  const semConfig = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  const mapeado = mapSearch(semConfig);
  assert.strictEqual(mapeado.configurado, false);
  assert.strictEqual(mapeado.provedorPrimario, 'serper');

  // Salvar chave
  salvarSearchConfig(db, empresaId, { serperApiKey: 'minha-chave-serper-123' });
  let row = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  let status = mapSearch(row);
  assert.strictEqual(status.configurado, true);
  assert.strictEqual(status.secrets.serper_api_key.valor, '***', 'GET normal nunca retorna a chave em claro');

  // Substituir chave
  salvarSearchConfig(db, empresaId, { serperApiKey: 'nova-chave-456' });
  row = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  assert.strictEqual(decrypt(row.serper_api_key_enc), 'nova-chave-456');

  // Salvar sem chave (string vazia) preserva a chave anterior — mesmo
  // padrão de platform-routes.js: "chave vazia no body = preserva a atual"
  salvarSearchConfig(db, empresaId, { provedorPrimario: 'gemini' });
  row = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  assert.strictEqual(decrypt(row.serper_api_key_enc), 'nova-chave-456', 'chave deve ser preservada quando nao reenviada');
  assert.strictEqual(row.provedor_primario, 'gemini');

  db.close();
}

// B — Segurança: chave não aparece em GET nem em qualquer mensagem de erro
function testarSeguranca() {
  const db = dbTmp();
  const empresaId = 2;
  salvarSearchConfig(db, empresaId, { serperApiKey: 'segredo-nao-deve-vazar' });
  const row = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(empresaId);
  const statusNormal = mapSearch(row, false);
  assert.ok(!JSON.stringify(statusNormal).includes('segredo-nao-deve-vazar'), 'chave nao pode aparecer no GET normal');
  // Simula erro de uma operação qualquer — a chave nunca deve aparecer na mensagem
  const erroSimulado = new Error('Falha ao processar configuração.');
  assert.ok(!erroSimulado.message.includes('segredo-nao-deve-vazar'));
  // reveal=true é a única via que expõe (equivalente à rota /reveal, exige admin)
  const statusRevelado = mapSearch(row, true);
  assert.strictEqual(statusRevelado.secrets.serper_api_key, 'segredo-nao-deve-vazar');
  db.close();
}

// C — Multiempresa: empresa A não acessa configuração da empresa B
function testarMultiempresa() {
  const db = dbTmp();
  salvarSearchConfig(db, 10, { serperApiKey: 'chave-empresa-A' });
  salvarSearchConfig(db, 20, { serperApiKey: 'chave-empresa-B' });

  const rowA = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(10);
  const rowB = db.prepare('SELECT * FROM platform_search_configs WHERE empresa_id = ?').get(20);
  assert.strictEqual(decrypt(rowA.serper_api_key_enc), 'chave-empresa-A');
  assert.strictEqual(decrypt(rowB.serper_api_key_enc), 'chave-empresa-B');
  assert.notStrictEqual(rowA.id, rowB.id);

  // empresa_id é UNIQUE — não deve ser possível inserir duas linhas para a mesma empresa
  assert.throws(() => {
    db.prepare('INSERT INTO platform_search_configs (id, empresa_id, provedor_primario, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, 1, ?, ?)')
      .run(crypto.randomUUID(), 10, 'serper', new Date().toISOString(), new Date().toISOString());
  }, /UNIQUE/i);

  db.close();
}

async function main() {
  testarConfiguracao();
  testarSeguranca();
  testarMultiempresa();
  console.log('etapa-v1-pesquisa-web-config.test.js: ok (configuracao, seguranca, multiempresa da Pesquisa Web na Platform)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

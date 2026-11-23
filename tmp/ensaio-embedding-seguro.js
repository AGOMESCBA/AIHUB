'use strict';
require('dotenv').config({ quiet: true });
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
async function main() {
  const origem = new Database(path.join('apps', 'IA Service', 'data', 'ia-service.db'), { readonly: true, fileMustExist: true });
  const copia = path.join(os.tmpdir(), `iahub-vetores-${crypto.randomUUID()}.db`);
  await origem.backup(copia); origem.close();
  const database = require('../apps/IA Service/backend/database');
  const log = console.log; console.log = () => {}; try { database.inicializarDB(copia); } finally { console.log = log; }
  const caso = database.getDB().prepare('SELECT id, empresa_id FROM chamados WHERE descricao IS NOT NULL LIMIT 1').get();
  const plataforma = new Database(path.join('apps', 'IAHUB', 'data', 'iahub-platform.db'), { readonly: true, fileMustExist: true });
  const cfg = plataforma.prepare('SELECT openai_api_key_enc FROM platform_ai_configs WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1').get(caso.empresa_id); plataforma.close();
  let key = cfg?.openai_api_key_enc;
  if (key && String(key).startsWith('iahub-aes-gcm:')) {
    const dados = Buffer.from(String(key).slice('iahub-aes-gcm:'.length), 'base64');
    const chave = crypto.createHash('sha256').update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key').digest();
    const d = crypto.createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12)); d.setAuthTag(dados.subarray(12, 28));
    key = Buffer.concat([d.update(dados.subarray(28)), d.final()]).toString('utf8');
  }
  if (!key) throw new Error('Chave OpenAI ausente');
  const inicio = Date.now();
  const resultado = await require('../apps/IA Service/backend/services/base-conhecimento-vetores-service').indexarChamado(caso.empresa_id, caso.id, { resolverConfig: () => ({ keys: { openai: key } }) });
  console.log(JSON.stringify({ estado: resultado.estado, duracaoMs: Date.now() - inicio, ambiente: 'cópia temporária' }));
  database.fecharDB();
  for (const sufixo of ['', '-wal', '-shm']) { try { fs.unlinkSync(copia + sufixo); } catch (_) {} }
}
main().catch(e => { console.log(JSON.stringify({ estado: 'erro', tipo: /tempo limite|timeout/i.test(e.message) ? 'timeout' : /HTTP \d+/.exec(e.message)?.[0] || e.code || 'outro' })); process.exitCode = 1; });

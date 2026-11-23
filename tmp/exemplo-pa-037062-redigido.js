'use strict';
// Ensaio sem SoftExpert: resumo manual redigido do caso 037062.
require('dotenv').config({ quiet: true });
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
async function main() {
  const platform = new Database('apps/IAHUB/data/iahub-platform.db', { readonly: true, fileMustExist: true });
  const cfg = platform.prepare('SELECT openai_api_key_enc, openai_modelo FROM platform_ai_configs WHERE empresa_id = 1 AND COALESCE(ativo,1)=1').get(); platform.close();
  let key = cfg?.openai_api_key_enc;
  if (key && String(key).startsWith('iahub-aes-gcm:')) {
    const dados = Buffer.from(String(key).slice('iahub-aes-gcm:'.length), 'base64');
    const chave = crypto.createHash('sha256').update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key').digest();
    const d = crypto.createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12)); d.setAuthTag(dados.subarray(12, 28));
    key = Buffer.concat([d.update(dados.subarray(28)), d.final()]).toString('utf8');
  }
  if (!key) throw new Error('Configuração de IA indisponível.');
  const database = require('../apps/IA Service/backend/database');
  const log = console.log; console.log = () => {}; try { database.inicializarDB(':memory:'); } finally { console.log = log; }
  const config = require('../apps/IA Service/backend/services/ai-config-service');
  config.resolverKeysEOrdem = () => ({ keys: { openai: key }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: cfg.openai_modelo || 'gpt-4o' } } });
  // Dados factuais já redigidos; sem nomes, credenciais, documentos ou histórico de terceiros.
  const dados = { chamado: { numero: '037062', descricao: 'Solicitação de liberação de acesso ao menu Configurador no Protheus.' }, anexos: [],
    analise: { conteudo: 'Pode envolver permissão no perfil, grupo ou vínculo do menu. Faltam confirmação da autorização de acesso, comportamento observado ao acessar e ambiente. Essas hipóteses ainda não foram confirmadas.' }, fontes: [], referencias: [] };
  const gerado = await require('../apps/IA Service/backend/services/jade-pa-service').gerarTextoCliente(1, dados);
  const { redigirTexto } = require('../apps/IA Service/backend/services/redaction-service');
  fs.writeFileSync('tmp/exemplo-pa-037062-redigido.json', JSON.stringify({ caso: '037062', entrada: 'Resumo manual redigido de caso real, sem anexos nem consulta ao histórico; não é uma execução completa do PA.', decisao: gerado.decisao, texto: redigirTexto(gerado.texto), provider: gerado.provider, model: gerado.model }, null, 2));
  database.fecharDB();
  console.log('Exemplo gerado localmente; nenhuma mensagem foi publicada.');
}
main().catch(() => { console.error('Não foi possível gerar o exemplo redigido.'); process.exitCode = 1; });

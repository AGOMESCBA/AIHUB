'use strict';
// Gera uma única resposta de exemplo em cópia; não chama o SoftExpert nem publica.
require('dotenv').config({ quiet: true });
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const Database = require('better-sqlite3');
async function main() {
  const origem = new Database(path.join('apps', 'IA Service', 'data', 'ia-service.db'), { readonly: true, fileMustExist: true });
  const destino = path.join(os.tmpdir(), `iahub-exemplo-pa-${crypto.randomUUID()}.db`);
  await origem.backup(destino); origem.close();
  const dbService = require('../apps/IA Service/backend/database');
  const log = console.log; console.log = () => {}; try { dbService.inicializarDB(destino); } finally { console.log = log; }
  const db = dbService.getDB();
  const caso = db.prepare(`SELECT a.empresa_id, a.referencia_externa, a.id AS atendimento_id, m.id AS mensagem_id, m.conteudo
    FROM atendimentos a JOIN mensagens m ON m.atendimento_id = a.id AND m.empresa_id = a.empresa_id
    WHERE a.empresa_id = 1 AND m.papel = 'assistant' AND m.excluida_em IS NULL AND a.referencia_externa = '037058'
    ORDER BY m.criado_em DESC LIMIT 1`).get();
  if (!caso) throw new Error('Chamado não possui análise anterior disponível.');
  const platform = new Database(path.join('apps', 'IAHUB', 'data', 'iahub-platform.db'), { readonly: true, fileMustExist: true });
  const cfg = platform.prepare('SELECT openai_api_key_enc, openai_modelo FROM platform_ai_configs WHERE empresa_id = ? AND COALESCE(ativo,1) = 1').get(caso.empresa_id); platform.close();
  let key = cfg?.openai_api_key_enc;
  if (key && String(key).startsWith('iahub-aes-gcm:')) {
    const dados = Buffer.from(String(key).slice('iahub-aes-gcm:'.length), 'base64');
    const chave = crypto.createHash('sha256').update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key').digest();
    const d = crypto.createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12)); d.setAuthTag(dados.subarray(12, 28)); key = Buffer.concat([d.update(dados.subarray(28)), d.final()]).toString('utf8');
  }
  if (!key) throw new Error('Chave indisponível.');
  const config = require('../apps/IA Service/backend/services/ai-config-service');
  config.resolverKeysEOrdem = () => ({ keys: { openai: key }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: cfg.openai_modelo || 'gpt-4o' } } });
  const chamadoRepo = require('../apps/IA Service/backend/repositories/chamado-repository');
  const chamado = chamadoRepo.getChamadoPorNumero(caso.empresa_id, caso.referencia_externa, 'softexpert', { exigirUnico: true });
  const jade = require('../apps/IA Service/backend/services/jade-pa-service');
  const { redigirTexto } = require('../apps/IA Service/backend/services/redaction-service');
  const retorno = await jade.gerarTextoCliente(caso.empresa_id, { chamado, anexos: [], analise: { conteudo: caso.conteudo }, fontes: [], referencias: [] });
  fs.writeFileSync('tmp/exemplo-pa-real-simulado.json', JSON.stringify({ chamado: caso.referencia_externa, observacao: 'Gerado sobre análise anterior existente, sem anexos, sem referências históricas autorizadas, sem pesquisa nova, em cópia; não publicado.', decisao: retorno.decisao, texto: redigirTexto(retorno.texto) }, null, 2));
  dbService.fecharDB(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(destino + s); } catch (_) {}
  console.log('Exemplo gerado em tmp/exemplo-pa-real-simulado.json; não publicado.');
}
main().catch(() => { console.error('Não foi possível gerar exemplo real em simulação.'); process.exitCode = 1; });

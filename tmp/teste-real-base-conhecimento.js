'use strict';
// Ensaio local: banco de IA Service em cópia temporária, Platform somente leitura.
// Não publica respostas nem grava credenciais no relatório.
require('dotenv').config({ quiet: true });
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const origem = new Database(path.join('apps', 'IA Service', 'data', 'ia-service.db'), { readonly: true, fileMustExist: true });
const destino = path.join(os.tmpdir(), `iahub-ensaio-${crypto.randomUUID()}.db`);
function descriptografar(valor) {
  if (!valor) return null;
  if (!String(valor).startsWith('iahub-aes-gcm:')) return String(valor);
  const dados = Buffer.from(String(valor).slice('iahub-aes-gcm:'.length), 'base64');
  const chave = crypto.createHash('sha256').update(process.env.IAHUB_PLATFORM_CRYPTO_KEY || process.env.SVC_DATA_CRYPTO_KEY || process.env.SESSION_SECRET || 'iahub-platform-dev-key').digest();
  const d = crypto.createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12));
  d.setAuthTag(dados.subarray(12, 28));
  return Buffer.concat([d.update(dados.subarray(28)), d.final()]).toString('utf8');
}
async function main() {
  await origem.backup(destino); origem.close();
  const database = require('../apps/IA Service/backend/database');
  const logOriginal = console.log; console.log = () => {};
  try { database.inicializarDB(destino); } finally { console.log = logOriginal; }
  const repo = require('../apps/IA Service/backend/repositories/chamado-repository');
  const avaliador = require('../apps/IA Service/backend/services/base-conhecimento-avaliacao-service');
  const plataforma = new Database(path.join('apps', 'IAHUB', 'data', 'iahub-platform.db'), { readonly: true, fileMustExist: true });
  const casos = database.getDB().prepare('SELECT id, numero, empresa_id FROM chamados WHERE descricao IS NOT NULL ORDER BY data_abertura DESC, id ASC LIMIT 5').all();
  const resultado = [];
  for (const caso of casos.slice(0, Number(process.env.IAHUB_ENSAIO_CASOS) || casos.length)) {
    const conf = plataforma.prepare('SELECT * FROM platform_ai_configs WHERE empresa_id = ? AND COALESCE(ativo, 1) = 1').get(caso.empresa_id);
    if (!conf) throw new Error('Configuração de IA não encontrada para empresa da amostra.');
    const provider = process.env.IAHUB_ENSAIO_PROVIDER || conf.provedor_primario || conf.provider || 'groq';
    const key = descriptografar(conf[`${provider}_api_key_enc`]);
    if (!key) throw new Error('Provedor principal sem chave disponível.');
    const resolverConfig = () => ({ keys: { [provider]: key }, cfg: { provedorPrimario: provider, fallbackOrdem: '', modelos: { [provider]: conf[`${provider}_modelo`] || undefined } } });
    for (const escopo of ['empresa', 'cliente_pa']) {
      const inicio = Date.now();
      const chamado = repo.getChamado(caso.empresa_id, caso.id);
      const chamarIA = async (...args) => {
        if (process.env.IAHUB_ENSAIO_TIMEOUT_LONGO === '1') args[5] = { ...args[5], timeoutMs: 45000, totalTimeoutMs: 50000 };
        try {
          const resposta = await require('../apps/IA Service/backend/services/ai-provider-client').chamarIA(...args);
          let jsonValido = false; try { JSON.parse(String(resposta.texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); jsonValido = true; } catch (_) {}
          console.log(JSON.stringify({ fase: args[2].startsWith('Extraia') ? 'expansao' : 'avaliacao', provider: resposta.provider, truncado: !!resposta.truncado, jsonValido, caracteres: String(resposta.texto || '').length, duracaoMs: resposta.latenciaMs }));
          return resposta;
        }
        catch (erro) {
          const msg = String(erro.message || '');
          console.log(`Diagnóstico do provedor: ${erro._semChave ? 'sem_chave' : erro._cotaEsgotada ? 'cota' : /401|unauthorized|invalid.*key/i.test(msg) ? 'autenticacao' : /429|rate.limit/i.test(msg) ? 'limite' : /fetch failed|ENOTFOUND|ECONN|timeout/i.test(msg) ? 'rede' : 'outro'}`);
          console.log(JSON.stringify({ tentativas: (erro._tentativas || []).map(t => ({ status: t.status, permanente: !!t.permanente, transitorio: !!t.transitorio, contextoExcedido: !!t.contextoExcedido, tlsGlobal: !!t.tlsGlobal, http: String(t.erro || '').match(/\b[45]\d\d\b/)?.[0] || null, tipo: /timeout|timed out|abort/i.test(String(t.erro || '')) ? 'timeout' : /ECONNRESET/i.test(String(t.erro || '')) ? 'conexao_reiniciada' : /fetch failed/i.test(String(t.erro || '')) ? 'fetch_failed' : 'outro' })) }));
          throw erro;
        }
      };
      const expansao = process.env.IAHUB_ENSAIO_SO_BUSCA === '1' ? { termos: [], estado: 'nao_executada' } : await avaliador.expandirBusca(caso.empresa_id, chamado, { resolverConfig, chamarIA });
      const inicioTextual = Date.now();
      let candidatos = repo.listarChamadosRelacionados(caso.empresa_id, caso.id, { limite: 15, escopo, termosExpandidos: expansao.termos });
      const duracaoTextualMs = Date.now() - inicioTextual;
      let estadoVetorial = 'nao_executada';
      let duracaoVetorialMs = null, indexadosAmostra = 0;
      if (process.env.IAHUB_ENSAIO_VETORES === '1') {
        const vetores = require('../apps/IA Service/backend/services/base-conhecimento-vetores-service');
        const config = require('../apps/IA Service/backend/services/ai-config-service');
        const anterior = config.resolverKeysEOrdem;
        const buscaOriginal = vetores.buscar;
        try {
          config.resolverKeysEOrdem = resolverConfig;
          for (const item of candidatos.slice(0, 5)) { const r = await vetores.indexarChamado(caso.empresa_id, item.chamado.id, { resolverConfig }); if (r.estado === 'indexado') indexadosAmostra++; }
          vetores.buscar = async (...args) => { const inicioVetor = Date.now(); try { return await buscaOriginal(...args); } finally { duracaoVetorialMs = Date.now() - inicioVetor; } };
          const h = await require('../apps/IA Service/backend/services/base-conhecimento-hibrida-service').combinar(caso.empresa_id, caso.id, candidatos, { escopo });
          candidatos = h.candidatos; estadoVetorial = h.estadoVetorial;
        } finally { config.resolverKeysEOrdem = anterior; vetores.buscar = buscaOriginal; }
      }
      const r = process.env.IAHUB_ENSAIO_SO_BUSCA === '1'
        ? { candidatos, estado: 'avaliacao_ia_nao_executada' }
        : (expansao.etapaFalha === 'provedor' || expansao.etapaFalha === 'configuracao')
          ? { candidatos, estado: 'avaliacao_indisponivel', etapaFalha: expansao.etapaFalha }
        : await avaliador.avaliar(caso.empresa_id, chamado, candidatos, { resolverConfig, chamarIA });
      resultado.push({ chamado: caso.numero, escopo, identidadeConfirmada: repo.identidadeConfirmadaPa(caso.empresa_id, caso.id), expansao: expansao.estado, estadoVetorial, duracaoTextualMs, duracaoVetorialMs, indexadosAmostra, candidatos: candidatos.length, estado: r.estado, etapaFalha: r.etapaFalha || null, avaliados: r.avaliados || 0, duracaoMs: Date.now() - inicio, primeiros: r.candidatos.slice(0, 5).map(c => ({ numero: c.chamado.numero, avaliacao: c.avaliacaoIa?.relevancia || 'nao_avaliada' })) });
      console.log(`Ensaio concluído: ${resultado.length}/10`);
    }
  }
  plataforma.close(); database.fecharDB();
  for (const sufixo of ['', '-wal', '-shm']) { try { fs.unlinkSync(destino + sufixo); } catch (_) {} }
  const arquivo = path.join('tmp', `resultado-busca-real-${crypto.randomUUID()}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ observacao: process.env.IAHUB_ENSAIO_SO_BUSCA === '1' ? 'Somente recuperação local; IA não executada, sem julgamento de consultor ou envio a clientes.' : 'Ensaio da avaliação preliminar da IA, sem julgamento de consultor ou envio a clientes.', resultado }, null, 2));
  console.log(`Relatório: ${arquivo}`);
}
main().catch(() => { console.error('O ensaio não pôde ser concluído; nenhuma credencial foi exibida.'); process.exitCode = 1; });

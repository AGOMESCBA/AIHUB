'use strict';

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = 'C:/tmp/ia-service-etapa3-1-groq.db';
const PAYLOAD_DIR = 'C:/tmp/ia-service-etapa3-1-prep/outbound-groq';
const OUT_DIR = 'C:/tmp/ia-service-etapa3-1-results';

function nowIso() {
  return new Date().toISOString();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function insertRow(db, table, row) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const data = Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...cols.map(c => data[c]));
}

function textoCaso(payload) {
  const partes = [];
  partes.push(`Caso anonimizado: ${payload.idAnon}`);
  partes.push(`Sistema/modulo: ${payload.sistema || ''} / ${payload.modulo || ''}`);
  partes.push(`Servico: ${payload.servico || ''}`);
  partes.push(`Titulo: ${payload.titulo || ''}`);
  partes.push(`Assunto: ${payload.assunto || ''}`);
  partes.push(`Status operacional: ${JSON.stringify(payload.statusOperacional || {})}`);
  if (payload.chamado?.descricao) partes.push(`Descricao: ${payload.chamado.descricao}`);
  if (payload.chamado?.informacoesAdicionais) partes.push(`Informacoes adicionais: ${payload.chamado.informacoesAdicionais}`);
  if (payload.chamado?.observacoes) partes.push(`Observacoes: ${payload.chamado.observacoes}`);
  const omitidos = (payload.anexos || []).filter(a => /omitido/i.test(a.tipo || '') || /omitido/i.test(a.limitacao || ''));
  if (omitidos.length) {
    partes.push('Anexos omitidos por seguranca/privacidade:');
    for (const a of omitidos) partes.push(`- ${a.tipo}: ${a.limitacao || 'omitido'}`);
  }
  return partes.join('\n');
}

function prepararBanco(payloads) {
  const database = require('../apps/IA Service/backend/database');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
  }
  database.inicializarDB(DB_PATH);
  const db = database.getDB();

  const fonteId = 'etapa3-1-fonte-anon';
  insertRow(db, 'fontes_historicas', {
    id: fonteId,
    empresa_id: 1,
    connection_key: 'etapa3_1_anon',
    nome: 'Etapa 3.1 - carga anonimizada',
    sistema_origem: 'etapa3_1_anon',
    adapter: 'AnonPayload',
    ativo: 1,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  const prepared = [];
  for (const payload of payloads) {
    const atId = `etapa31-at-${payload.idAnon}`;
    const chId = `etapa31-ch-${payload.idAnon}`;
    const baseText = textoCaso(payload);

    insertRow(db, 'chamados', {
      id: chId,
      empresa_id: 1,
      fonte_id: fonteId,
      sistema_origem: 'etapa3_1_anon',
      oid_origem: chId,
      numero: payload.idAnon,
      produto: payload.sistema,
      familia: payload.familia,
      modulo: payload.modulo,
      servico: payload.servico,
      natureza: payload.natureza,
      nivel: payload.nivel,
      titulo: payload.titulo,
      assunto: payload.assunto,
      descricao: payload.chamado?.descricao || null,
      informacoes_adicionais: payload.chamado?.informacoesAdicionais || null,
      observacoes: payload.chamado?.observacoes || null,
      status_encerramento: payload.statusOperacional?.statusEncerramento || 'Andamento',
      sla_prazo: payload.statusOperacional?.slaPrazo || null,
      aguardando_consolidado: payload.statusOperacional?.aguardando || null,
      data_abertura: payload.statusOperacional?.dataAbertura || nowIso(),
      hash_conteudo: payload.idAnon,
      precisa_indexacao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    insertRow(db, 'atendimentos', {
      id: atId,
      empresa_id: 1,
      origem: 'etapa3_1_anon',
      canal_entrada: 'auditoria',
      codigo: payload.idAnon,
      referencia_externa: payload.idAnon,
      conteudo_bruto: baseText,
      contexto_origem: 'etapa3_1_homologacao',
      status: 'NOVO',
      precisa_revisao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    insertRow(db, 'mensagens', {
      id: `etapa31-msg-${payload.idAnon}-abertura`,
      empresa_id: 1,
      atendimento_id: atId,
      papel: 'customer',
      conteudo: baseText,
      criado_em: nowIso(),
    });

    let idx = 1;
    for (const p of payload.posicionamentos || []) {
      insertRow(db, 'mensagens', {
        id: `etapa31-msg-${payload.idAnon}-pos-${idx++}`,
        empresa_id: 1,
        atendimento_id: atId,
        papel: 'user',
        conteudo: [
          `Posicionamento em ${p.data || ''}`,
          `Situacao: ${p.situacao || ''}`,
          `Assunto: ${p.assunto || ''}`,
          p.descricao ? `Descricao: ${p.descricao}` : '',
          p.resultado ? `Resultado: ${p.resultado}` : '',
        ].filter(Boolean).join('\n'),
        criado_em: p.data || nowIso(),
      });
    }

    for (const m of payload.mensagens || []) {
      insertRow(db, 'mensagens', {
        id: `etapa31-msg-${payload.idAnon}-hist-${idx++}`,
        empresa_id: 1,
        atendimento_id: atId,
        papel: m.papel === 'assistant' ? 'assistant' : 'user',
        conteudo: m.conteudo || '',
        criado_em: m.criadoEm || nowIso(),
      });
    }

    let anIdx = 1;
    for (const a of payload.anexos || []) {
      if (!a.conteudoExtraidoAnonimizado) continue;
      insertRow(db, 'anexos', {
        id: `etapa31-an-${payload.idAnon}-${anIdx}`,
        empresa_id: 1,
        atendimento_id: atId,
        nome_original: a.nome || `anexo-${anIdx}.txt`,
        nome_interno: `${payload.idAnon}-${anIdx}.txt`,
        mime_type: 'text/plain',
        tamanho: Buffer.byteLength(a.conteudoExtraidoAnonimizado),
        caminho_relativo: null,
        conteudo_extraido: a.conteudoExtraidoAnonimizado,
        linguagem_detectada: a.tipo || 'txt',
        e_codigo: 0,
        criado_em: nowIso(),
      });
      anIdx += 1;
    }

    prepared.push({ idAnon: payload.idAnon, atendimentoId: atId });
  }
  return { database, prepared };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payloads = fs.readdirSync(PAYLOAD_DIR)
    .filter(f => /^CH-\d+\.json$/.test(f))
    .sort()
    .map(f => readJson(path.join(PAYLOAD_DIR, f)));

  const { database, prepared } = prepararBanco(payloads);

  const aiConfigService = require('../apps/IA Service/backend/services/ai-config-service');
  const originalResolver = aiConfigService.resolverKeysEOrdem;
  const originalSearch = aiConfigService.resolverConfigPesquisa;
  aiConfigService.resolverKeysEOrdem = (empresaId) => {
    const resolved = originalResolver(empresaId);
    if (!resolved.keys?.groq) throw new Error('Groq nao resolvido no ambiente atual.');
    return {
      keys: { groq: resolved.keys.groq },
      cfg: {
        ...resolved.cfg,
        provedorPrimario: 'groq',
        fallbackOrdem: 'groq',
        modelos: { groq: 'openai/gpt-oss-20b' },
      },
    };
  };
  aiConfigService.resolverConfigPesquisa = () => ({
    provedorPrimario: 'desabilitado_homologacao',
    fallbackOrdem: '',
    serperApiKey: null,
    geminiApiKey: null,
    openaiApiKey: null,
  });

  const investigacaoService = require('../apps/IA Service/backend/services/investigacao-service');
  const execucaoRepo = require('../apps/IA Service/backend/repositories/investigacao-execucao-repository');
  const mensagemRepo = require('../apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('../apps/IA Service/backend/repositories/anexo-repository');

  const resultados = [];
  try {
    for (const c of prepared) {
      const anexos = anexoRepo.listarAnexos(1, c.atendimentoId).map(a => a.id);
      const inicio = Date.now();
      let resposta = null;
      let erro = null;
      try {
        const msg = await investigacaoService.processarTurno(1, c.atendimentoId, {
          texto: 'Execute a investigacao controlada deste caso anonimizado. Responda ao analista: o que ja foi feito, quais evidencias realmente importam, quais hipoteses sao sustentadas, quais lacunas impedem conclusao e qual o proximo passo tecnico mais util. Nao afirme ter lido anexos omitidos.',
          usuarioId: null,
          anexoIds: anexos,
          anexosComoContexto: true,
          automatico: true,
          forcarPesquisa: false,
          analistaAtualNome: 'Auditoria Etapa 3.1',
        });
        resposta = msg.conteudo;
      } catch (err) {
        erro = err.message;
      }
      const execs = execucaoRepo.listarPorAtendimento(1, c.atendimentoId, { limite: 20 });
      const mensagens = mensagemRepo.listarMensagens(1, c.atendimentoId);
      resultados.push({
        caso: c.idAnon,
        statusRunner: erro ? 'erro' : 'ok',
        erro,
        duracaoRunnerMs: Date.now() - inicio,
        resposta,
        execucao: execs[0] || null,
        mensagens: mensagens.map(m => ({ id: m.id, papel: m.papel, conteudo: m.conteudo, provider: m.provider, model: m.model, criadoEm: m.criadoEm })),
        anexos: anexoRepo.listarAnexos(1, c.atendimentoId),
      });
      fs.writeFileSync(path.join(OUT_DIR, `${c.idAnon}.json`), JSON.stringify(resultados[resultados.length - 1], null, 2));
      console.log(JSON.stringify({
        caso: c.idAnon,
        status: erro ? 'erro' : 'ok',
        provider: execs[0]?.provider || null,
        model: execs[0]?.model || null,
        final: execs[0]?.status || null,
        latenciaMs: execs[0]?.latenciaMs || null,
      }));
    }
  } finally {
    aiConfigService.resolverKeysEOrdem = originalResolver;
    aiConfigService.resolverConfigPesquisa = originalSearch;
    database.fecharDB();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'resultados.json'), JSON.stringify({
    geradoEm: nowIso(),
    providerReferencia: 'groq',
    modeloReferencia: 'openai/gpt-oss-20b',
    observacao: 'Execucao controlada com carga anonimizada outbound-groq. Pesquisa externa desabilitada para evitar transmissao a provedores fora do Groq.',
    resultados,
  }, null, 2));
  console.log(`OK resultados em ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});

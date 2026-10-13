'use strict';

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/tmp/ia-service-etapa3-2-homologacao-10.db';
const PAYLOAD_DIR = 'C:/tmp/ia-service-etapa3-1-prep/outbound-groq';
const OUT_DIR = 'C:/tmp/ia-service-etapa3-2-homologacao-10';

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
    for (const a of omitidos) partes.push(`- ${a.nome || a.tipo}: ${a.limitacao || 'omitido'}`);
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

  const fonteId = 'etapa3-2-fonte-anon';
  insertRow(db, 'fontes_historicas', {
    id: fonteId,
    empresa_id: 1,
    connection_key: 'etapa3_2_anon',
    nome: 'Etapa 3.2 - homologacao 10 casos anonimizados',
    sistema_origem: 'etapa3_2_anon',
    adapter: 'AnonPayload',
    ativo: 1,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  const prepared = [];
  for (const payload of payloads) {
    const atId = `etapa32-at-${payload.idAnon}`;
    const chId = `etapa32-ch-${payload.idAnon}`;
    const baseText = textoCaso(payload);

    insertRow(db, 'chamados', {
      id: chId,
      empresa_id: 1,
      fonte_id: fonteId,
      sistema_origem: 'etapa3_2_anon',
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
      origem: 'etapa3_2_anon',
      canal_entrada: 'auditoria',
      codigo: payload.idAnon,
      referencia_externa: payload.idAnon,
      conteudo_bruto: baseText,
      contexto_origem: 'etapa3_2_homologacao',
      status: 'NOVO',
      precisa_revisao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    insertRow(db, 'mensagens', {
      id: `etapa32-msg-${payload.idAnon}-abertura`,
      empresa_id: 1,
      atendimento_id: atId,
      papel: 'customer',
      conteudo: baseText,
      criado_em: nowIso(),
    });

    let idx = 1;
    for (const p of payload.posicionamentos || []) {
      insertRow(db, 'mensagens', {
        id: `etapa32-msg-${payload.idAnon}-pos-${idx++}`,
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
        id: `etapa32-msg-${payload.idAnon}-hist-${idx++}`,
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
        id: `etapa32-an-${payload.idAnon}-${anIdx}`,
        empresa_id: 1,
        atendimento_id: atId,
        nome_original: a.nome || `anexo-${anIdx}.txt`,
        nome_interno: `${payload.idAnon}-${anIdx}.txt`,
        mime_type: 'text/plain',
        tamanho: Buffer.byteLength(a.conteudoExtraidoAnonimizado),
        caminho_relativo: `etapa3-2-anon/${payload.idAnon}-${anIdx}.txt`,
        conteudo_extraido: a.conteudoExtraidoAnonimizado,
        linguagem_detectada: a.tipo || 'txt',
        e_codigo: /advpl|tlpp|fonte|prw|log|txt/i.test(a.tipo || a.nome || '') ? 1 : 0,
        criado_em: nowIso(),
      });
      anIdx += 1;
    }

    prepared.push({ idAnon: payload.idAnon, atendimentoId: atId, payload });
  }
  return { database, prepared };
}

function codigosFalha(execucao) {
  return (execucao?.qualityGate?.falhas || []).map(f => f.codigo);
}

function tentativas(execucao) {
  return execucao?.tentativas || execucao?.usage?.tentativas || [];
}

function avaliarCaso(resultado) {
  const texto = String(resultado.resposta || '');
  const lower = texto.toLowerCase();
  const falhas = codigosFalha(resultado.execucao);
  const erroCritico = [];
  if (/aud-msg|aud-an|uuid|quality gate|retry|reescrita/i.test(texto)) erroCritico.push('vazamento interno/bastidor');
  if (/nao foi anexad|anexo omitido|omitid/i.test(JSON.stringify(resultado.payload?.anexos || [])) && /\b(o print mostra|a imagem mostra|no pdf anexado vemos|o anexo mostra claramente)\b/i.test(texto)) {
    erroCritico.push('afirma leitura de anexo omitido');
  }
  if (falhas.some(c => /UNTRACEABLE|INTERNAL|CONFIRMED|REDUNDANT|CONTRADICTION|TRUNCATED/.test(c))) {
    erroCritico.push(`falha objetiva QG: ${falhas.join(', ')}`);
  }
  const temProximoPasso = /\b(proximo passo|pe[cç]a|colete|valide|teste|confirme|verifique|recompile|envie|compare|execute)\b/i.test(texto);
  const separaHipotese = /\b(fato|evid[eê]ncia|hip[oó]tese|lacuna|nao da para confirmar|n[aã]o consigo confirmar|para confirmar|sem evid[eê]ncia)\b/i.test(texto);
  const evitaCerteza = !/\b(causa confirmada|com certeza|definitivamente|a causa [ée] clara)\b/i.test(lower);
  const especifica = /\b(log|fonte|pdf|xml|print|workflow|rpo|compil|tss|kardex|danfe|nota fiscal|retorno|border[oô]|smartview|tabela|parametro|anexo|valida[cç][aã]o)\b/i.test(lower);
  const generica = /verifique os logs[\s\S]{0,160}consulte a documenta/i.test(lower) || texto.length < 700;
  const nota = Math.max(0, Math.min(100,
    45
    + (temProximoPasso ? 15 : -10)
    + (separaHipotese ? 15 : -10)
    + (evitaCerteza ? 10 : -20)
    + (especifica ? 15 : -10)
    - (generica ? 15 : 0)
    - (erroCritico.length ? 35 : 0)
  ));
  return {
    notaInvestigativa: nota,
    erroCritico,
    sinais: { temProximoPasso, separaHipotese, evitaCerteza, especifica, generica },
    parecerAutomatico: erroCritico.length
      ? 'reprovado_por_erro_critico'
      : nota >= 85 ? 'bom_candidato_para_avaliacao_humana'
        : nota >= 70 ? 'util_com_ressalvas'
          : 'fraco_ou_generico',
  };
}

function resumoPesquisa(pesquisa) {
  return {
    modo: pesquisa?.modo || null,
    providerBusca: pesquisa?.providerBusca || null,
    consultas: pesquisa?.consultasExecutadas || pesquisa?.consultas || [],
    paginasLidas: (pesquisa?.paginasLidas || []).map(p => ({
      titulo: p.titulo || null,
      url: p.url || null,
      status: p.status || null,
      oficial: !!p.oficial,
      erro: p.erro || null,
      trecho: p.trecho ? String(p.trecho).slice(0, 240) : null,
    })),
  };
}

function escreverMarkdown(resultados, resumo) {
  const linhas = [];
  linhas.push('# IA Service - Homologacao Investigativa 10 Casos');
  linhas.push('');
  linhas.push(`Gerado em: ${resumo.geradoEm}`);
  linhas.push('');
  linhas.push('## Resumo Executivo');
  linhas.push('');
  linhas.push(`- Total de casos: ${resultados.length}`);
  linhas.push(`- Concluidos: ${resultados.filter(r => r.execucao?.status === 'concluido').length}`);
  linhas.push(`- Revisao/QG/erro: ${resultados.filter(r => r.execucao?.status !== 'concluido').length}`);
  linhas.push(`- Provider efetivo: ${JSON.stringify(resumo.providers)}`);
  linhas.push(`- Nota media automatica: ${resumo.notaMediaAutomatica}`);
  linhas.push('');
  linhas.push('Observacao: nota automatica nao substitui avaliacao humana; ela aponta riscos e prioriza revisao.');
  linhas.push('');
  linhas.push('## Tabela');
  linhas.push('');
  linhas.push('| Caso | Sistema/modulo | Provider/modelo | Status | QG | Pesquisa | Nota auto | Parecer auto |');
  linhas.push('|---|---|---|---|---|---|---:|---|');
  for (const r of resultados) {
    linhas.push(`| ${r.caso} | ${r.payload.sistema || ''}/${r.payload.modulo || ''} | ${r.execucao?.provider || '-'} / ${r.execucao?.model || '-'} | ${r.execucao?.status || r.statusRunner} | ${(r.execucao?.qualityGate?.falhas || []).map(f => f.codigo).join(', ') || 'OK'} | ${r.pesquisa?.modo || '-'}; lidas ${(r.pesquisa?.paginasLidas || []).filter(p => p.status === 'lida' || p.status === 'reutilizada').length} | ${r.avaliacaoAutomatica.notaInvestigativa} | ${r.avaliacaoAutomatica.parecerAutomatico} |`);
  }
  linhas.push('');
  linhas.push('## Resultados Individuais');
  for (const r of resultados) {
    linhas.push('');
    linhas.push(`### ${r.caso} - ${r.payload.titulo || ''}`);
    linhas.push('');
    linhas.push(`- Sistema/modulo: ${r.payload.sistema || ''} / ${r.payload.modulo || ''}`);
    linhas.push(`- Provider/modelo: ${r.execucao?.provider || '-'} / ${r.execucao?.model || '-'}`);
    linhas.push(`- Status execucao: ${r.execucao?.status || r.statusRunner}`);
    linhas.push(`- Latencia IA registrada: ${r.execucao?.latenciaMs || '-'} ms`);
    linhas.push(`- Tokens estimados prompt/resposta: ${r.execucao?.tokensEstimadosPrompt || '-'} / ${r.execucao?.tokensEstimadosResposta || '-'}`);
    linhas.push(`- Quality Gate: ${(r.execucao?.qualityGate?.falhas || []).map(f => `${f.codigo}:${f.decisionKind || f.categoriaDecisao || ''}`).join(', ') || 'aprovado'}`);
    linhas.push(`- Avaliacao automatica: ${r.avaliacaoAutomatica.notaInvestigativa}/100 (${r.avaliacaoAutomatica.parecerAutomatico})`);
    if (r.avaliacaoAutomatica.erroCritico.length) linhas.push(`- Erros criticos sinalizados: ${r.avaliacaoAutomatica.erroCritico.join('; ')}`);
    linhas.push(`- Pesquisa: ${JSON.stringify(resumoPesquisa(r.execucao?.pesquisa || {}))}`);
    linhas.push('');
    linhas.push('Resposta integral:');
    linhas.push('');
    linhas.push('```text');
    linhas.push(r.resposta || '(sem resposta)');
    linhas.push('```');
  }
  return linhas.join('\n');
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
    return {
      keys: resolved.keys,
      cfg: {
        ...resolved.cfg,
        provedorPrimario: 'groq',
        fallbackOrdem: resolved.cfg?.fallbackOrdem || 'openai,groq,claude,deepseek,gemini',
        modelos: {
          ...(resolved.cfg?.modelos || {}),
          groq: 'openai/gpt-oss-20b',
        },
      },
    };
  };

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
          texto: 'Execute a homologacao investigativa deste caso anonimizado. Responda ao consultor com precisao: problema investigado, fatos comprovados, evidencias relevantes, pesquisa tecnica consultada se houver, hipoteses sustentadas, lacunas que impedem conclusao e proximo teste tecnico mais util. Nao afirme ter lido anexos omitidos. Nao transforme hipotese em causa confirmada.',
          usuarioId: null,
          anexoIds: anexos,
          anexosComoContexto: true,
          automatico: true,
          forcarPesquisa: true,
          analistaAtualNome: 'Auditoria Homologacao 10 Casos',
        });
        resposta = msg.conteudo;
      } catch (err) {
        erro = err.message;
      }
      const execs = execucaoRepo.listarPorAtendimento(1, c.atendimentoId, { limite: 20 });
      const execucao = execs[0] || null;
      const item = {
        caso: c.idAnon,
        payload: c.payload,
        statusRunner: erro ? 'erro' : 'ok',
        erro,
        duracaoRunnerMs: Date.now() - inicio,
        resposta,
        execucao,
        mensagens: mensagemRepo.listarMensagens(1, c.atendimentoId).map(m => ({ id: m.id, papel: m.papel, conteudo: m.conteudo, provider: m.provider, model: m.model, criadoEm: m.criadoEm })),
        anexos: anexoRepo.listarAnexos(1, c.atendimentoId).map(a => ({ id: a.id, nomeOriginal: a.nomeOriginal, mimeType: a.mimeType, linguagemDetectada: a.linguagemDetectada, conteudoExtraido: a.conteudoExtraido })),
      };
      item.pesquisa = resumoPesquisa(execucao?.pesquisa || {});
      item.avaliacaoAutomatica = avaliarCaso(item);
      resultados.push(item);
      fs.writeFileSync(path.join(OUT_DIR, `${c.idAnon}.json`), JSON.stringify(item, null, 2));
      console.log(JSON.stringify({
        caso: c.idAnon,
        status: erro ? 'erro' : 'ok',
        provider: execucao?.provider || null,
        model: execucao?.model || null,
        final: execucao?.status || null,
        falhas: codigosFalha(execucao),
        latenciaMs: execucao?.latenciaMs || null,
      }));
    }
  } finally {
    aiConfigService.resolverKeysEOrdem = originalResolver;
    aiConfigService.resolverConfigPesquisa = originalSearch;
    database.fecharDB();
  }

  const providers = {};
  for (const r of resultados) {
    const key = `${r.execucao?.provider || 'erro'} / ${r.execucao?.model || '-'}`;
    providers[key] = (providers[key] || 0) + 1;
  }
  const resumo = {
    geradoEm: nowIso(),
    dbPath: DB_PATH,
    outDir: OUT_DIR,
    providers,
    notaMediaAutomatica: resultados.length
      ? Math.round(resultados.reduce((s, r) => s + r.avaliacaoAutomatica.notaInvestigativa, 0) / resultados.length)
      : 0,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'resultados.json'), JSON.stringify({ resumo, resultados }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'relatorio.md'), escreverMarkdown(resultados, resumo));
  console.log(`OK resultados em ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});

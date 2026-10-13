'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/tmp/ia-service-validacao-funcional-local.db';
const PAYLOAD_DIR = 'C:/tmp/ia-service-etapa3-1-prep/outbound-groq';
const OUT_DIR = 'C:/tmp/ia-service-validacao-funcional-local';

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

  insertRow(db, 'fontes_historicas', {
    id: 'validacao-local-fonte',
    empresa_id: 1,
    connection_key: 'validacao_local_anon',
    nome: 'Validacao funcional local - carga anonimizada',
    sistema_origem: 'validacao_local',
    adapter: 'AnonPayload',
    ativo: 1,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  const prepared = [];
  for (const payload of payloads) {
    const atendimentoId = `validacao-local-at-${payload.idAnon}`;
    const chamadoId = `validacao-local-ch-${payload.idAnon}`;
    const baseText = textoCaso(payload);

    insertRow(db, 'chamados', {
      id: chamadoId,
      empresa_id: 1,
      fonte_id: 'validacao-local-fonte',
      sistema_origem: 'validacao_local',
      oid_origem: chamadoId,
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
      id: atendimentoId,
      empresa_id: 1,
      origem: 'validacao_local',
      canal_entrada: 'auditoria',
      codigo: payload.idAnon,
      referencia_externa: payload.idAnon,
      conteudo_bruto: baseText,
      contexto_origem: 'validacao_funcional_investigativa',
      status: 'NOVO',
      precisa_revisao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    insertRow(db, 'mensagens', {
      id: `validacao-msg-${payload.idAnon}-abertura`,
      empresa_id: 1,
      atendimento_id: atendimentoId,
      papel: 'customer',
      conteudo: baseText,
      criado_em: payload.statusOperacional?.dataAbertura || nowIso(),
    });

    let idx = 1;
    for (const p of payload.posicionamentos || []) {
      insertRow(db, 'mensagens', {
        id: `validacao-msg-${payload.idAnon}-pos-${idx++}`,
        empresa_id: 1,
        atendimento_id: atendimentoId,
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
        id: `validacao-msg-${payload.idAnon}-hist-${idx++}`,
        empresa_id: 1,
        atendimento_id: atendimentoId,
        papel: m.papel === 'assistant' ? 'assistant' : 'user',
        conteudo: m.conteudo || '',
        criado_em: m.criadoEm || nowIso(),
      });
    }

    let anexoIdx = 1;
    for (const anexo of payload.anexos || []) {
      if (!anexo.conteudoExtraidoAnonimizado) continue;
      insertRow(db, 'anexos', {
        id: `validacao-an-${payload.idAnon}-${anexoIdx}`,
        empresa_id: 1,
        atendimento_id: atendimentoId,
        nome_original: anexo.nome || `anexo-${anexoIdx}.txt`,
        nome_interno: `${payload.idAnon}-${anexoIdx}.txt`,
        mime_type: 'text/plain',
        tamanho: Buffer.byteLength(anexo.conteudoExtraidoAnonimizado),
        caminho_relativo: `validacao-local/${payload.idAnon}-${anexoIdx}.txt`,
        conteudo_extraido: anexo.conteudoExtraidoAnonimizado,
        linguagem_detectada: anexo.tipo || 'txt',
        e_codigo: /\.(prw|tlpp|prx|aph|ch)$/i.test(anexo.nome || '') ? 1 : 0,
        criado_em: nowIso(),
      });
      anexoIdx += 1;
    }

    prepared.push({ payload, atendimentoId, chamadoId });
  }
  return { database, prepared };
}

function resumoPlano(plano) {
  const contar = key => Array.isArray(plano?.[key]) ? plano[key].length : 0;
  return {
    fatos: contar('fatosComprovados'),
    hipoteses: contar('hipotesesPermitidas'),
    referenciasTecnicas: contar('referenciasTecnicas'),
    referenciasExternas: contar('referenciasExternas'),
    lacunas: contar('lacunas'),
    proximosPassos: contar('proximosPassosPermitidos'),
    estadoOperacional: plano?.estadoOperacional || null,
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payloads = fs.readdirSync(PAYLOAD_DIR)
    .filter(f => /^CH-\d+\.json$/.test(f))
    .sort()
    .map(f => readJson(path.join(PAYLOAD_DIR, f)));

  const { database, prepared } = prepararBanco(payloads);
  const atendimentoRepo = require('../apps/IA Service/backend/repositories/atendimento-repository');
  const chamadoRepo = require('../apps/IA Service/backend/repositories/chamado-repository');
  const mensagemRepo = require('../apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('../apps/IA Service/backend/repositories/anexo-repository');
  const contextEngine = require('../apps/IA Service/backend/services/context-engine');
  const promptBuilder = require('../apps/IA Service/backend/services/prompt-builder');

  const resultados = [];
  for (const item of prepared) {
    const atendimento = atendimentoRepo.getAtendimento(1, item.atendimentoId);
    const chamado = chamadoRepo.getChamado ? chamadoRepo.getChamado(1, item.chamadoId) : null;
    const mensagens = mensagemRepo.listarMensagens(1, item.atendimentoId);
    const anexos = anexoRepo.listarAnexos(1, item.atendimentoId);
    const inicio = Date.now();
    const contexto = contextEngine.montarContextoInvestigacao({
      atendimento,
      mensagens,
      mensagemAtual: 'Validacao funcional local: montar contexto investigativo sem chamada externa de IA.',
      anexosDoTurno: anexos,
      anexosComoContexto: true,
      pesquisaTecnicaTexto: '',
      pesquisa: null,
      relacionados: [],
      systemPrompt: promptBuilder.SYSTEM_PROMPT,
      cfg: {
        provedorPrimario: 'groq',
        modelos: { groq: 'openai/gpt-oss-20b' },
      },
      analistaAtualNome: 'Auditoria funcional local',
      chamado,
    });

    const payload = item.payload;
    const omitidosPayload = (payload.anexos || []).filter(a => /omitido/i.test(a.tipo || '') || /omitido/i.test(a.limitacao || ''));
    const incluidosPayload = (payload.anexos || []).filter(a => !!a.conteudoExtraidoAnonimizado);
    const manifesto = contexto.manifesto;
    const resultado = {
      caso: payload.idAnon,
      origemProdutivaAnonimizada: payload.origemAnonimizada || null,
      sistema: payload.sistema || null,
      modulo: payload.modulo || null,
      chamadoEstruturado: chamado ? {
        produto: chamado.produto,
        familia: chamado.familia,
        modulo: chamado.modulo,
        servico: chamado.servico,
        titulo: chamado.titulo,
        assunto: chamado.assunto,
      } : null,
      titulo: payload.titulo || null,
      tipoProblema: payload.tipoProblema || payload.natureza || null,
      historicoMensagens: mensagens.length,
      anexosDisponiveisNaCarga: payload.anexos?.length || 0,
      anexosIncluidosTextualmente: incluidosPayload.length,
      anexosOmitidosPorPolitica: omitidosPayload.length,
      limitacoesAnexos: omitidosPayload.map(a => ({ nome: a.nome || null, tipo: a.tipo || null, limitacao: a.limitacao || 'omitido' })),
      contextoResumo: contexto.contextoResumo,
      quadroInvestigativo: manifesto.quadroInvestigativo,
      prrResumo: resumoPlano(manifesto.planoRespostaRastreavel),
      manifestoResumo: {
        mensagensDisponiveis: manifesto.mensagensDisponiveis,
        mensagensSelecionadas: manifesto.mensagensSelecionadas,
        anexosDisponiveis: manifesto.anexosDisponiveis,
        anexosSelecionados: manifesto.anexosSelecionados,
        imagensSelecionadas: manifesto.imagensSelecionadas,
        selecionados: manifesto.selecionados,
        omitidos: manifesto.omitidos,
        pesquisaExterna: manifesto.pesquisaExterna,
      },
      pesquisaEfetiva: 'nao_executada_localmente',
      respostaProduzida: null,
      qualityGateRespostaFinal: 'nao_aplicavel_sem_resposta_final',
      latenciaLocalMs: Date.now() - inicio,
      observacao: 'Validacao local do Context Engine/PRR. Nao houve chamada de IA, pesquisa externa ou resposta simulada.',
    };
    resultados.push(resultado);
    fs.writeFileSync(path.join(OUT_DIR, `${payload.idAnon}.json`), JSON.stringify(resultado, null, 2));
  }

  const resumo = {
    geradoEm: nowIso(),
    casos: resultados.length,
    inferenciaExterna: 'nao_executada',
    pesquisaExterna: 'nao_executada',
    bancoIsolado: DB_PATH,
    resultados,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'resultados.json'), JSON.stringify(resumo, null, 2));
  database.fecharDB();
  console.log(JSON.stringify({
    casos: resultados.length,
    saida: path.join(OUT_DIR, 'resultados.json'),
    inferenciaExterna: 'nao_executada',
  }, null, 2));
}

main();

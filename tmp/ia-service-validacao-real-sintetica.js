'use strict';

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/tmp/ia-service-validacao-real-sintetica.db';
const OUT_DIR = 'C:/tmp/ia-service-validacao-real-sintetica';

function nowIso() {
  return new Date().toISOString();
}

function insertRow(db, table, row) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const data = Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...cols.map(c => data[c]));
}

function prepararBanco() {
  const database = require('../apps/IA Service/backend/database');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
  }
  database.inicializarDB(DB_PATH);
  const db = database.getDB();

  const fonteId = 'validacao-real-sintetica-fonte';
  const chamadoId = 'validacao-real-sintetica-chamado';
  const atendimentoId = 'validacao-real-sintetica-atendimento';

  insertRow(db, 'fontes_historicas', {
    id: fonteId,
    empresa_id: 1,
    connection_key: 'validacao_real_sintetica',
    nome: 'Validacao real sintetica',
    sistema_origem: 'validacao_real_sintetica',
    adapter: 'SyntheticPayload',
    ativo: 1,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  insertRow(db, 'chamados', {
    id: chamadoId,
    empresa_id: 1,
    fonte_id: fonteId,
    sistema_origem: 'validacao_real_sintetica',
    oid_origem: chamadoId,
    numero: 'SINT-001',
    produto: 'Protheus',
    familia: 'Backoffice',
    modulo: 'Faturamento',
    servico: 'NF-e / DANFE',
    natureza: 'Erro tecnico',
    nivel: 'Analise',
    titulo: 'DANFE nao imprime apos atualizacao de fonte customizado',
    assunto: 'Erro em impressao DANFE apos compilacao de customizacao',
    descricao: 'Ao imprimir DANFE, o processo falha apos atualizar fonte customizado. O problema ocorre somente no ambiente de homologacao apos recompilar o RPO.',
    informacoes_adicionais: 'Ha log AppServer e trecho de fonte anexados. Nao ha evidencia de problema fiscal ou financeiro.',
    observacoes: 'Caso sintetico sem dados produtivos para homologacao funcional do IA Service.',
    status_encerramento: 'Andamento',
    sla_prazo: 'Em dia',
    aguardando_consolidado: 'RETORNO - ATENDENTE',
    data_abertura: nowIso(),
    hash_conteudo: 'validacao-real-sintetica',
    precisa_indexacao: 0,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  insertRow(db, 'atendimentos', {
    id: atendimentoId,
    empresa_id: 1,
    origem: 'validacao_real_sintetica',
    canal_entrada: 'auditoria',
    codigo: 'SINT-001',
    referencia_externa: 'SINT-001',
    conteudo_bruto: [
      'Sistema/modulo: Protheus / Faturamento',
      'Servico: NF-e / DANFE',
      'Titulo: DANFE nao imprime apos atualizacao de fonte customizado',
      'Descricao: Ao imprimir DANFE, o processo falha apos atualizar fonte customizado. O problema ocorre somente no ambiente de homologacao apos recompilar o RPO.',
    ].join('\n'),
    contexto_origem: 'validacao_real_sintetica',
    status: 'NOVO',
    precisa_revisao: 0,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  insertRow(db, 'mensagens', {
    id: 'validacao-real-msg-1',
    empresa_id: 1,
    atendimento_id: atendimentoId,
    papel: 'customer',
    conteudo: 'Ao imprimir DANFE no Protheus, a rotina falha apos recompilar fonte customizado em homologacao. Antes da atualizacao a impressao funcionava.',
    criado_em: nowIso(),
  });
  insertRow(db, 'mensagens', {
    id: 'validacao-real-msg-2',
    empresa_id: 1,
    atendimento_id: atendimentoId,
    papel: 'user',
    conteudo: 'Foi anexado log AppServer e trecho do fonte customizado para investigacao. Ainda nao ha correcao aplicada.',
    criado_em: nowIso(),
  });

  const log = [
    'THREAD ERROR ([12345], user, HOMOLOG) 2026-10-11 09:42:17',
    'ERROR: variable cSerieDanfe does not exist on U_DANFEPRINT(FATDANFE_CUSTOM.PRW) line 87',
    'Called from U_IMPDANFE(FATDANFE_CUSTOM.PRW) line 42',
    'Called from MATA461N(NFESEFAZ.PRW) line 318',
    'Environment: Protheus 12.1.2410, AppServer 20.3, RPO homologacao atualizado em 2026-10-10',
  ].join('\n');
  insertRow(db, 'anexos', {
    id: 'validacao-real-anexo-log',
    empresa_id: 1,
    atendimento_id: atendimentoId,
    nome_original: 'appserver-danfe.log',
    nome_interno: 'appserver-danfe.log',
    mime_type: 'text/plain',
    tamanho: Buffer.byteLength(log),
    caminho_relativo: 'validacao-real/appserver-danfe.log',
    conteudo_extraido: log,
    linguagem_detectada: 'log',
    e_codigo: 0,
    criado_em: nowIso(),
  });

  const fonte = [
    '#include "protheus.ch"',
    '',
    'User Function DANFEPRINT()',
    '    Local cSerie := SF2->F2_SERIE',
    '    Local cNumDoc := SF2->F2_DOC',
    '    If Empty(cSerieDanfe)',
    '        cSerieDanfe := cSerie',
    '    EndIf',
    'Return .T.',
  ].join('\n');
  insertRow(db, 'anexos', {
    id: 'validacao-real-anexo-fonte',
    empresa_id: 1,
    atendimento_id: atendimentoId,
    nome_original: 'FATDANFE_CUSTOM.PRW',
    nome_interno: 'FATDANFE_CUSTOM.PRW',
    mime_type: 'text/plain',
    tamanho: Buffer.byteLength(fonte),
    caminho_relativo: 'validacao-real/FATDANFE_CUSTOM.PRW',
    conteudo_extraido: fonte,
    linguagem_detectada: 'advpl',
    e_codigo: 1,
    criado_em: nowIso(),
  });

  return { database, atendimentoId, chamadoId };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { database, atendimentoId } = prepararBanco();

  const aiConfigService = require('../apps/IA Service/backend/services/ai-config-service');
  const cfgPublica = aiConfigService.getConfig(1);
  const resolved = aiConfigService.resolverKeysEOrdem(1);
  const search = aiConfigService.resolverConfigPesquisa(1);
  const configResumo = {
    providerPrimario: resolved.cfg.provedorPrimario,
    fallbackOrdem: resolved.cfg.fallbackOrdem,
    modelos: resolved.cfg.modelos,
    keys: Object.fromEntries(Object.entries(resolved.keys).map(([k, v]) => [k, !!v])),
    pesquisa: {
      providerPrimario: search.provedorPrimario,
      fallbackOrdem: search.fallbackOrdem,
      keys: { serper: !!search.serperApiKey, gemini: !!search.geminiApiKey, openai: !!search.openaiApiKey },
    },
    origemConfig: cfgPublica?.origemConfig || null,
  };

  const investigacaoService = require('../apps/IA Service/backend/services/investigacao-service');
  const execucaoRepo = require('../apps/IA Service/backend/repositories/investigacao-execucao-repository');
  const mensagemRepo = require('../apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('../apps/IA Service/backend/repositories/anexo-repository');

  const anexos = anexoRepo.listarAnexos(1, atendimentoId).map(a => a.id);
  const inicio = Date.now();
  let resposta = null;
  let erro = null;
  try {
    resposta = await investigacaoService.processarTurno(1, atendimentoId, {
      texto: 'Investigue o caso e oriente o consultor. Separe fatos, hipoteses, lacunas e proximo teste tecnico. Use pesquisa tecnica se ajudar, mas nao invente rotinas ou parametros.',
      usuarioId: null,
      anexoIds: anexos,
      anexosComoContexto: true,
      automatico: true,
      forcarPesquisa: true,
      analistaAtualNome: 'Auditoria funcional sintetica',
    });
  } catch (err) {
    erro = { message: err.message, stack: err.stack };
  }

  const execucoes = execucaoRepo.listarPorAtendimento(1, atendimentoId, { limite: 10 });
  const mensagens = mensagemRepo.listarMensagens(1, atendimentoId);
  const resultado = {
    geradoEm: nowIso(),
    duracaoMs: Date.now() - inicio,
    configResumo,
    erro,
    resposta: resposta ? {
      id: resposta.id,
      conteudo: resposta.conteudo,
      provider: resposta.provider,
      model: resposta.model,
      diagnostico: resposta.diagnostico,
      nivelConfianca: resposta.nivelConfianca,
    } : null,
    execucoes,
    mensagens: mensagens.map(m => ({
      id: m.id,
      papel: m.papel,
      conteudo: m.conteudo,
      provider: m.provider,
      model: m.model,
      diagnostico: m.diagnostico,
      nivelConfianca: m.nivelConfianca,
      criadoEm: m.criadoEm,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'resultado.json'), JSON.stringify(resultado, null, 2));
  database.fecharDB();
  console.log(JSON.stringify({
    ok: !erro,
    erro: erro?.message || null,
    saida: path.join(OUT_DIR, 'resultado.json'),
    provider: resposta?.provider || execucoes[0]?.provider || null,
    model: resposta?.model || execucoes[0]?.model || null,
    status: execucoes[0]?.status || null,
    qualityGate: execucoes[0]?.qualityGateStatus || null,
    latenciaMs: execucoes[0]?.latenciaMs || null,
  }, null, 2));
}

main();

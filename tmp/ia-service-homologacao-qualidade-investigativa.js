'use strict';

require('dotenv').config({ path: '.env' });

const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/tmp/ia-service-homologacao-qualidade-investigativa.db';
const OUT_DIR = 'C:/tmp/ia-service-homologacao-qualidade-investigativa';
const ANEXOS_ROOT = path.join(__dirname, '..', 'apps', 'IA Service', 'data', 'anexos');

function nowIso() {
  return new Date().toISOString();
}

function insertRow(db, table, row) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const data = Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...cols.map(c => data[c]));
}

const casos = [
  {
    id: 'CH-QA-01',
    sistema: 'Protheus',
    modulo: 'Faturamento',
    servico: 'NF-e / DANFE',
    titulo: 'DANFE nao imprime apos atualizacao de fonte customizado',
    problema: 'Erro na impressao de DANFE apos recompilacao de customizacao em homologacao.',
    historico: [
      ['customer', 'Ao imprimir DANFE no Protheus, a rotina falha apos recompilar fonte customizado em homologacao. Antes da atualizacao a impressao funcionava.'],
      ['user', 'Foi anexado log AppServer e trecho do fonte customizado. Ainda nao ha correcao aplicada.'],
    ],
    anexos: [
      {
        id: 'log',
        nome: 'appserver-danfe.log',
        mime: 'text/plain',
        linguagem: 'log',
        codigo: 0,
        conteudo: [
          'THREAD ERROR ([12345], user, HOMOLOG) 2026-10-11 09:42:17',
          'ERROR: variable cSerieDanfe does not exist on U_DANFEPRINT(FATDANFE_CUSTOM.PRW) line 87',
          'Called from U_IMPDANFE(FATDANFE_CUSTOM.PRW) line 42',
          'Called from MATA461N(NFESEFAZ.PRW) line 318',
          'Environment: Protheus 12.1.2410, AppServer 20.3, RPO homologacao atualizado em 2026-10-10',
        ].join('\n'),
      },
      {
        id: 'fonte',
        nome: 'FATDANFE_CUSTOM.PRW',
        mime: 'text/plain',
        linguagem: 'advpl',
        codigo: 1,
        conteudo: [
          '#include "protheus.ch"',
          'User Function DANFEPRINT()',
          '    Local cSerie := SF2->F2_SERIE',
          '    Local cNumDoc := SF2->F2_DOC',
          '    If Empty(cSerieDanfe)',
          '        cSerieDanfe := cSerie',
          '    EndIf',
          'Return .T.',
        ].join('\n'),
      },
    ],
    esperado: 'Priorizar erro de variavel nao declarada no fonte customizado, pedir correcao/compilacao e teste da emissao. Nao deslocar para fiscal/financeiro.',
  },
  {
    id: 'CH-QA-02',
    sistema: 'Protheus',
    modulo: 'Compras',
    servico: 'Workflow de aprovacao',
    titulo: 'Pedido de compra aprovado no workflow permanece em aprovacao',
    problema: 'Pedido aprovado via workflow nao muda o status no Protheus.',
    historico: [
      ['customer', 'Quando geramos um pedido de compra, ele envia o workflow para aprovacao. O usuario aprova pelo WF, mas no sistema o status fica em aprovacao. No menu de aprovacoes ele aparece como aprovado.'],
      ['user', 'Abrimos fabrica e identificamos que havia falha no disparo automatico de e-mail de aprovacao em rotina padrao. Foi aberto chamado TOTVS 00000000.'],
      ['user', 'Ajuste por ponto de entrada foi aplicado em producao. Chamado segue para validacao do cliente.'],
    ],
    anexos: [
      {
        id: 'print',
        nome: 'print-financeiro-incidental.png',
        mime: 'image/png',
        linguagem: 'ocr',
        codigo: 0,
        conteudo: [
          '[observacao_visual]',
          'Tela capturada do Protheus mostra rotina FINA050 e mensagem: O titulo U 6498 NF 00701101 possui movimentos sem contabilidade.',
          'A imagem pertence a outro dominio aparente: Financeiro/Contabilidade.',
          'Nao ha ponte causal visivel entre a mensagem do print e a aprovacao do pedido de compra.',
        ].join('\n'),
      },
    ],
    esperado: 'Reconhecer compras/workflow e que ha correcao aplicada aguardando validacao. Usar FINA050 apenas como evidencia visual incidental, sem transformar em causa.',
  },
  {
    id: 'CH-QA-03',
    sistema: 'Protheus',
    modulo: 'TAF',
    servico: 'eSocial',
    titulo: 'Evento S-2240 rejeitado apos atualizacao de leiaute',
    problema: 'Evento S-2240 rejeitado no TAF; ha PDF parcial com retorno do governo e historico incompleto.',
    historico: [
      ['customer', 'Apos atualizacao do leiaute, o envio do S-2240 passou a retornar rejeicao. O XML foi gerado, mas o TAF nao transmite com sucesso.'],
      ['user', 'Cliente enviou PDF do retorno e print da tela, mas ainda nao enviou XML completo nem log do TSS.'],
    ],
    anexos: [
      {
        id: 'pdf',
        nome: 'retorno-esocial-parcial.pdf',
        mime: 'application/pdf',
        linguagem: 'pdf-text',
        codigo: 0,
        conteudo: [
          '[texto_extraido_pdf]',
          'Retorno de processamento eSocial',
          'Evento: S-2240 - Condicoes Ambientais do Trabalho',
          'Ocorrencia: 723 - Valor informado no campo codigo do ambiente nao localizado na tabela de ambientes do empregador.',
          'Competencia: 2026-10',
          'Observacao: Extracao parcial; XML original e log TSS nao anexados.',
        ].join('\n'),
      },
    ],
    esperado: 'Apontar rejeicao 723 como evidencia, mas limitar conclusao pela ausencia do XML/log TSS. Indicar teste: conferir cadastro/tabela de ambientes e reenviar com XML/log.',
  },
  {
    id: 'CH-QA-04',
    sistema: 'SoftExpert',
    modulo: 'Workflow',
    servico: 'Integracao API',
    titulo: 'Workflow nao avanca etapa apos callback da integracao',
    problema: 'Callback externo retorna sucesso, mas atividade permanece parada no SoftExpert.',
    historico: [
      ['customer', 'A integracao informa HTTP 200 no callback, mas o workflow continua parado na atividade de validacao.'],
      ['user', 'Anexados log da integracao e retorno JSON. Nao houve alteracao produtiva; precisamos orientar o proximo teste.'],
    ],
    anexos: [
      {
        id: 'log',
        nome: 'callback-workflow.log',
        mime: 'text/plain',
        linguagem: 'log',
        codigo: 0,
        conteudo: [
          '2026-10-10T15:44:11Z POST /se/ws/wf/callback status=200 elapsed=341ms',
          'payload={"processId":"PROC-ANON-001","activityId":"ACT-VALIDACAO","action":"APPROVE","user":"svc-integration"}',
          'response={"status":"OK","message":"Callback received","transactionId":"TX-ANON-778"}',
          '2026-10-10T15:44:14Z WARN process PROC-ANON-001 remains at ACT-VALIDACAO; pending responsible role resolution',
        ].join('\n'),
      },
      {
        id: 'json',
        nome: 'retorno-callback.json',
        mime: 'application/json',
        linguagem: 'json',
        codigo: 0,
        conteudo: JSON.stringify({
          status: 'OK',
          transactionId: 'TX-ANON-778',
          effect: 'callback_received',
          workflowStateAfterCallback: 'ACT-VALIDACAO',
          note: 'No evidence of transition execution in the provided log',
        }, null, 2),
      },
    ],
    esperado: 'Distinguir HTTP 200/callback recebido de avancar workflow. Hipotese: pendencia de resolucao de papel/responsavel ou regra de transicao; pedir log interno do workflow/auditoria da atividade.',
  },
];

async function materializarAnexosVisuais() {
  const visuais = [];
  for (const caso of casos) {
    for (const anexo of caso.anexos) {
      if (anexo.mime !== 'image/png' && anexo.mime !== 'application/pdf') continue;
      const rel = `homologacao-qualidade/${caso.id}/${anexo.nome}`;
      visuais.push({ caso, anexo, rel, destino: path.join(ANEXOS_ROOT, rel) });
    }
  }
  if (!visuais.length) return;

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (err) {
    console.warn('[Homologacao] Puppeteer indisponivel para materializar anexos visuais:', err.message);
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const item of visuais) {
      fs.mkdirSync(path.dirname(item.destino), { recursive: true });
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 850, deviceScaleFactor: 1 });
      const html = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<style>body{font-family:Arial,sans-serif;margin:32px;color:#111;background:#fff}pre{white-space:pre-wrap;font:18px Consolas,monospace;border:1px solid #bbb;padding:20px}h1{font-size:24px}</style>',
        '</head><body>',
        `<h1>${item.caso.id} - ${item.anexo.nome}</h1>`,
        `<pre>${String(item.anexo.conteudo).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`,
        '</body></html>',
      ].join('');
      await page.setContent(html, { waitUntil: 'networkidle0' });
      if (item.anexo.mime === 'image/png') {
        await page.screenshot({ path: item.destino, type: 'png', fullPage: true });
      } else {
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        fs.writeFileSync(item.destino, pdf);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function prepararBanco() {
  const database = require('../apps/IA Service/backend/database');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
  }
  database.inicializarDB(DB_PATH);
  const db = database.getDB();

  insertRow(db, 'fontes_historicas', {
    id: 'homologacao-qualidade-fonte',
    empresa_id: 1,
    connection_key: 'homologacao_qualidade',
    nome: 'Homologacao qualidade investigativa',
    sistema_origem: 'homologacao_qualidade',
    adapter: 'SyntheticQualityPayload',
    ativo: 1,
    criado_em: nowIso(),
    atualizado_em: nowIso(),
  });

  for (const caso of casos) {
    const chamadoId = `homologacao-${caso.id}-chamado`;
    const atendimentoId = `homologacao-${caso.id}-atendimento`;
    insertRow(db, 'chamados', {
      id: chamadoId,
      empresa_id: 1,
      fonte_id: 'homologacao-qualidade-fonte',
      sistema_origem: 'homologacao_qualidade',
      oid_origem: chamadoId,
      numero: caso.id,
      produto: caso.sistema,
      familia: caso.sistema === 'SoftExpert' ? 'BPM' : 'Backoffice',
      modulo: caso.modulo,
      servico: caso.servico,
      natureza: 'Erro tecnico',
      nivel: 'Analise',
      titulo: caso.titulo,
      assunto: caso.titulo,
      descricao: caso.problema,
      informacoes_adicionais: `Caso controlado anonimizado. Sistema/modulo informados na abertura: ${caso.sistema} / ${caso.modulo}.`,
      observacoes: caso.esperado,
      status_encerramento: 'Andamento',
      sla_prazo: 'Em dia',
      aguardando_consolidado: 'RETORNO - ATENDENTE',
      data_abertura: nowIso(),
      hash_conteudo: `homologacao-${caso.id}`,
      precisa_indexacao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    insertRow(db, 'atendimentos', {
      id: atendimentoId,
      empresa_id: 1,
      origem: 'homologacao_qualidade',
      canal_entrada: 'auditoria',
      codigo: caso.id,
      referencia_externa: caso.id,
      conteudo_bruto: [
        `Sistema/modulo: ${caso.sistema} / ${caso.modulo}`,
        `Servico: ${caso.servico}`,
        `Titulo: ${caso.titulo}`,
        `Descricao: ${caso.problema}`,
      ].join('\n'),
      contexto_origem: 'homologacao_qualidade',
      status: 'NOVO',
      precisa_revisao: 0,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });

    caso.historico.forEach(([papel, conteudo], idx) => {
      insertRow(db, 'mensagens', {
        id: `homologacao-${caso.id}-msg-${idx + 1}`,
        empresa_id: 1,
        atendimento_id: atendimentoId,
        papel,
        conteudo,
        criado_em: nowIso(),
      });
    });

    caso.anexos.forEach((anexo) => {
      const caminhoRelativo = `homologacao-qualidade/${caso.id}/${anexo.nome}`;
      const caminhoFisico = path.join(ANEXOS_ROOT, caminhoRelativo);
      const tamanho = fs.existsSync(caminhoFisico) ? fs.statSync(caminhoFisico).size : Buffer.byteLength(anexo.conteudo);
      insertRow(db, 'anexos', {
        id: `homologacao-${caso.id}-anexo-${anexo.id}`,
        empresa_id: 1,
        atendimento_id: atendimentoId,
        nome_original: anexo.nome,
        nome_interno: anexo.nome,
        mime_type: anexo.mime,
        tamanho,
        caminho_relativo: caminhoRelativo,
        conteudo_extraido: anexo.conteudo,
        linguagem_detectada: anexo.linguagem,
        e_codigo: anexo.codigo,
        criado_em: nowIso(),
      });
    });
  }

  return database;
}

function resumoExecucao(execucao) {
  if (!execucao) return null;
  return {
    id: execucao.id,
    status: execucao.status,
    provider: execucao.provider,
    model: execucao.model,
    qualityGateStatus: execucao.qualityGateStatus,
    tokensPrompt: execucao.tokensPrompt,
    tokensCompletion: execucao.tokensCompletion,
    tokensTotal: execucao.tokensTotal,
    latenciaMs: execucao.latenciaMs,
    tentativas: execucao.tentativas,
    retryCount: execucao.retryCount,
    fallbackUsado: execucao.fallbackUsado,
    erro: execucao.erro,
    falhasQualityGate: execucao.qualityGateFalhas,
  };
}

async function executarCaso(caso) {
  const investigacaoService = require('../apps/IA Service/backend/services/investigacao-service');
  const execucaoRepo = require('../apps/IA Service/backend/repositories/investigacao-execucao-repository');
  const mensagemRepo = require('../apps/IA Service/backend/repositories/mensagem-repository');
  const anexoRepo = require('../apps/IA Service/backend/repositories/anexo-repository');
  const atendimentoId = `homologacao-${caso.id}-atendimento`;
  const anexoIds = anexoRepo.listarAnexos(1, atendimentoId).map(a => a.id);
  const inicio = Date.now();
  let resposta = null;
  let erro = null;
  try {
    resposta = await investigacaoService.processarTurno(1, atendimentoId, {
      texto: [
        'Investigue este chamado para orientar um consultor experiente.',
        'Use as evidencias disponiveis, pesquisa tecnica quando contribuir, PRR e Quality Gate.',
        'Separe fatos, hipoteses, lacunas e proximo passo verificavel.',
        'Nao invente rotinas, parametros, fontes, erros ou causas.',
      ].join(' '),
      usuarioId: null,
      anexoIds,
      anexosComoContexto: true,
      automatico: true,
      forcarPesquisa: true,
      analistaAtualNome: 'Homologacao qualidade investigativa',
    });
  } catch (err) {
    erro = { message: err.message, stack: err.stack };
  }
  const execucoes = execucaoRepo.listarPorAtendimento(1, atendimentoId, { limite: 10 });
  const mensagens = mensagemRepo.listarMensagens(1, atendimentoId);
  return {
    caso: {
      id: caso.id,
      sistema: caso.sistema,
      modulo: caso.modulo,
      servico: caso.servico,
      titulo: caso.titulo,
      esperado: caso.esperado,
    },
    duracaoMs: Date.now() - inicio,
    erro,
    resposta: resposta ? {
      id: resposta.id,
      conteudo: resposta.conteudo,
      provider: resposta.provider,
      model: resposta.model,
      diagnostico: resposta.diagnostico,
      nivelConfianca: resposta.nivelConfianca,
    } : null,
    execucoes: execucoes.map(resumoExecucao),
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
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await materializarAnexosVisuais();
  const database = prepararBanco();
  const aiConfigService = require('../apps/IA Service/backend/services/ai-config-service');
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
  };

  const resultados = [];
  for (const caso of casos) {
    resultados.push(await executarCaso(caso));
  }

  const saida = {
    geradoEm: nowIso(),
    dbPath: DB_PATH,
    configResumo,
    resultados,
  };
  const jsonPath = path.join(OUT_DIR, 'resultado.json');
  fs.writeFileSync(jsonPath, JSON.stringify(saida, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'respostas.md'), resultados.map(r => [
    `# ${r.caso.id} - ${r.caso.titulo}`,
    '',
    `Sistema/modulo: ${r.caso.sistema} / ${r.caso.modulo}`,
    `Esperado: ${r.caso.esperado}`,
    `Provider/modelo: ${r.resposta?.provider || r.execucoes[0]?.provider || 'n/d'} / ${r.resposta?.model || r.execucoes[0]?.model || 'n/d'}`,
    `Status/QG: ${r.execucoes[0]?.status || 'n/d'} / ${r.execucoes[0]?.qualityGateStatus || 'n/d'}`,
    '',
    '```text',
    r.resposta?.conteudo || r.erro?.message || 'Sem resposta.',
    '```',
    '',
  ].join('\n')).join('\n'));
  database.fecharDB();
  console.log(JSON.stringify({
    ok: resultados.every(r => !r.erro),
    saida: jsonPath,
    casos: resultados.map(r => ({
      id: r.caso.id,
      erro: r.erro?.message || null,
      provider: r.resposta?.provider || r.execucoes[0]?.provider || null,
      model: r.resposta?.model || r.execucoes[0]?.model || null,
      status: r.execucoes[0]?.status || null,
      qualityGate: r.execucoes[0]?.qualityGateStatus || null,
      latenciaMs: r.execucoes[0]?.latenciaMs || r.duracaoMs,
    })),
  }, null, 2));
}

main();

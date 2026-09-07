'use strict';

const path = require('path');
const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'whatsapp-web.js') {
    return {
      Client: class MockClient {
        on() {}
        initialize() {}
        destroy() {}
        sendMessage() {}
        sendPresenceAvailable() {}
      },
      LocalAuth: class MockLocalAuth {
        constructor(opts) { this.opts = opts; }
      },
      MessageMedia: class MockMessageMedia {
        constructor(mimetype, data, filename) {
          this.mimetype = mimetype;
          this.data = data;
          this.filename = filename;
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const IACWhatsAppService = require(path.join(BASE_DIR, 'modules/whatsapp/service'));
const channelStore = require(path.join(BASE_DIR, 'modules/whatsapp/channel-store'));

function oneLine(valor, max = 5000) {
  return String(valor || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pickContexto() {
  const db = getDB();
  const row = db.prepare(`
    SELECT w.*
      FROM whatsapp_allowed_numbers w
     WHERE w.ativo = 1
       AND (
         COALESCE(w.modulo_faturamento, 0) = 1
         OR EXISTS (
           SELECT 1 FROM whatsapp_numero_modulos m
            WHERE m.numero_id = w.id
              AND m.empresa_id = w.empresa_id
              AND m.liberado = 1
              AND m.modulo = 'faturamento'
         )
       )
     ORDER BY w.atualizado_em DESC, w.criado_em DESC
     LIMIT 1
  `).get();

  if (!row) throw new Error('Nao encontrei numero ativo com acesso ao modulo faturamento.');

  const canal = channelStore.listarPorEmpresa(row.empresa_id)[0] || channelStore.ensureDefaultForEmpresa(row.empresa_id);
  const numero = String(row.numero || '').replace(/\D/g, '');
  return {
    empresaId: Number(row.empresa_id),
    sender: `${numero}@c.us`,
    numero,
    numeroNome: row.nome,
    canalId: canal?.id || `emp_${row.empresa_id}`,
    canalNome: canal?.nome || `WhatsApp Empresa ${row.empresa_id}`,
  };
}

function ultimoLog(texto, desdeIso, senderNumero) {
  return getDB().prepare(`
    SELECT id, empresa_id, intencao, modulo, resultado_tipo, rows_count,
           sql_final_executado, sql_gerado, resposta_entregue, criado_em
      FROM interpretation_log
     WHERE texto_original = ?
       AND criado_em >= ?
       AND (numero_wa = ? OR numero_wa = ?)
     ORDER BY criado_em DESC
     LIMIT 1
  `).get(texto, desdeIso, senderNumero, `${senderNumero}@c.us`);
}

async function executar(svc, ctx, pergunta, opts = {}) {
  const inicio = new Date(Date.now() - 1000).toISOString();
  const resposta = await svc._pipeline(pergunta, ctx.sender, {
    _recebidoEm: Date.now(),
    _empresaIdFixa: ctx.empresaId,
    _skipChannelTenantResolution: true,
    ...(opts || {}),
  });
  const log = ultimoLog(pergunta, inicio, ctx.numero) || {};
  return {
    pergunta,
    intencao: log.intencao || '-',
    resultadoTipo: log.resultado_tipo || '-',
    rows: log.rows_count ?? '-',
    sql: log.sql_final_executado || log.sql_gerado || '',
    resposta: resposta || log.resposta_entregue || '',
  };
}

(async () => {
  const ctx = pickContexto();
  const svc = new IACWhatsAppService();
  svc._empresaId = ctx.empresaId;
  svc._channelId = ctx.canalId;
  svc._channelName = ctx.canalNome;
  svc._isSenderAuthorized = () => true;

  console.log(`Contexto de teste: empresa=${ctx.empresaId} canal=${ctx.canalId} numero=${ctx.numero} nome=${ctx.numeroNome}`);

  const perguntas = [
    'Faturamento de ontem',
    'Agora por cliente',
    'Quais modulos eu tenho acesso?',
    'Qual o valor do dolar hoje?',
    'Quanto esta o bitcoin?',
    'Temperatura hoje em Manaus',
    'Preco da saca de soja pelo CEPEA',
    'Arroba do boi pela Noticias Agricolas',
  ];

  const resultados = [];
  for (const pergunta of perguntas) {
    try {
      resultados.push(await executar(svc, ctx, pergunta));
    } catch (err) {
      resultados.push({
        pergunta,
        intencao: 'erro_teste',
        resultadoTipo: 'erro',
        rows: '-',
        sql: '',
        resposta: err.message,
      });
    }
  }

  for (const r of resultados) {
    console.log('\n---');
    console.log(`Pergunta: ${r.pergunta}`);
    console.log(`Intencao: ${r.intencao}`);
    console.log(`Resultado: ${r.resultadoTipo} | Linhas: ${r.rows}`);
    console.log(`SQL: ${oneLine(r.sql) || '(nao executou SQL)'}`);
    console.log(`Resposta: ${oneLine(r.resposta, 3000)}`);
  }
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});

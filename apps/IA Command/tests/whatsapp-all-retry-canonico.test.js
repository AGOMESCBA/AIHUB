'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const IACWhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));
const intentService = require(path.join(ROOT, 'modules/ai/intent-service'));
const intentRouter = require(path.join(ROOT, 'modules/erp/intent-router'));

const orig = {
  garantir: intentService._garantirIntencoesDinamicasPadrao,
  temConfig: intentService.temConfiguracaoMinima,
  classificar: intentService.classificar,
  rotear: intentRouter.rotear,
};

const empresas = [
  { empresa_id: 1, nome: 'J2A' },
  { empresa_id: 2, nome: 'C3I' },
];

const sqlC3I = `SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SF2.F2_VALBRUT), 0) AS faturamento
FROM SF2020 SF2
JOIN SA1990 SA1 ON SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA AND SA1.D_E_L_E_T_ = ' '
WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_TIPO = 'N' AND SF2.F2_CLIENTE = '000057' AND SF2.F2_LOJA = '01'`;

const entidadeSoftexpert = {
  tipo: 'cliente',
  codigo: '000057',
  loja: '01',
  nome: 'SOFTEXPERT SOFTWARE S.A.',
  termoBusca: 'SOFTEXPERT',
};

function sucessoC3I(iteracao) {
  return {
    tipo: 'sucesso_ai_sql',
    resposta_direta: `C3I ok ${iteracao}`,
    rows: [{ faturamento: 200 + iteracao }],
    sql_gerado: sqlC3I,
    _sql_canonico: sqlC3I,
    _sql_canonico_origem: 'ia_owner',
    _entidadesResolvidas: [entidadeSoftexpert],
    _sql_auditoria: {
      sql_ia_bruto: sqlC3I,
      sql_final_executado: sqlC3I,
    },
    duracao_ms: 5,
  };
}

function sucessoRetryJ2A(iteracao) {
  const sqlJ2A = sqlC3I.replace(/SF2020/g, 'SF2010').replace(/SA1990/g, 'SA1010');
  return {
    tipo: 'sucesso_ai_sql',
    resposta_direta: `J2A retry ok ${iteracao}`,
    rows: [{ faturamento: 100 + iteracao }],
    sql_gerado: sqlJ2A,
    _sql_canonico: sqlJ2A,
    _sql_canonico_origem: 'ia_owner_reuso',
    _entidadesResolvidas: [{ ...entidadeSoftexpert, _resolverNoTenantAtual: true }],
    _sql_auditoria: {
      sql_ia_bruto: sqlC3I,
      sql_final_executado: sqlJ2A,
    },
    duracao_ms: 3,
  };
}

(async () => {
  try {
    intentService._garantirIntencoesDinamicasPadrao = () => {};
    intentService.temConfiguracaoMinima = () => true;
    intentService.classificar = async () => ({
      intencao: 'faturamento_dinamico',
      modulo: 'faturamento',
      filtros: { cliente: 'SOFTEXPERT' },
      periodo: { tipo: 'nenhum' },
      _provedor: 'mock',
      confianca: 1,
    });

    for (let iteracao = 0; iteracao < 50; iteracao += 1) {
      const svc = new IACWhatsAppService();
      svc._empresaId = 1;
      svc._buildHistoricoResumido = () => [];
      svc._historicoTurnosConfig = () => 5;
      svc._formatarConsolidadoDinamicoAll = () => '';
      svc._saveLastIntent = () => {};
      svc._moduloMonitorIntent = () => 'faturamento';

      const interpretacoes = [];
      svc._registrarInterpretacao = payload => interpretacoes.push(payload);

      const chamadas = [];
      intentRouter.rotear = async (intent, empresaId) => {
        chamadas.push({ empresaId, intent });
        if (empresaId === 1 && !intent._usarSqlCanonicoWhatsappAll) {
          return {
            tipo: 'erro',
            subtipo: 'contrato_entidade_invalido',
            resposta_direta: 'SQL nao aplicou entidades resolvidas.',
            sql_gerado: 'SELECT sem filtro',
            duracao_ms: 2,
          };
        }
        if (empresaId === 2 && !intent._usarSqlCanonicoWhatsappAll) return sucessoC3I(iteracao);
        if (empresaId === 1 && intent._usarSqlCanonicoWhatsappAll) return sucessoRetryJ2A(iteracao);
        throw new Error(`chamada inesperada empresa=${empresaId} canonico=${!!intent._usarSqlCanonicoWhatsappAll}`);
      };

      const resposta = await svc._pipelineAll('faturamento da SOFTEXPERT em todas as empresas', empresas, null);

      assert.strictEqual(chamadas.length, 3, 'deve tentar J2A, gerar canonico na C3I e retentar J2A');
      assert.strictEqual(chamadas[0].empresaId, 1, 'primeira tentativa deve ser J2A');
      assert.strictEqual(chamadas[0].intent._usarSqlCanonicoWhatsappAll, undefined, 'primeira tentativa nao tem canonico');
      assert.strictEqual(chamadas[1].empresaId, 2, 'segunda tentativa deve gerar canonico na C3I');
      assert.strictEqual(chamadas[1].intent._usarSqlCanonicoWhatsappAll, undefined, 'C3I gera SQL pela IA');
      assert.strictEqual(chamadas[2].empresaId, 1, 'terceira chamada deve voltar para J2A');
      assert.strictEqual(chamadas[2].intent._usarSqlCanonicoWhatsappAll, true, 'retry da J2A deve usar canonico');
      assert(chamadas[2].intent._sqlCanonicoOriginal.includes('{{iac:cliente:codigo}}'), 'canonico do retry deve estar parametrizado');
      assert(chamadas[2].intent._sqlCanonicoOriginal.includes('FROM SF2 SF2'), 'canonico do retry deve estar sem sufixo fisico');
      assert.strictEqual(chamadas[2].intent._sqlCanonicoEmpresaOrigem, 2, 'origem do canonico deve ser a C3I');
      assert(resposta.includes('C3I ok') && resposta.includes('J2A retry ok'), 'resposta final deve incluir sucesso original e retry');
      assert(!resposta.includes('Nao consegui consultar'), 'erro inicial da J2A deve ser removido apos retry bem-sucedido');
      assert(
        interpretacoes.some(p => p.empresaId === 1 && p.resultado?._diagnostico_tecnico?.retry_pendente),
        'erro inicial da J2A deve registrar diagnostico tecnico com retry pendente',
      );
      assert(interpretacoes.some(p => p.empresaId === 1 && p.resultado?._retry_canonico), 'deve auditar retry canonico da J2A');
      assert(
        interpretacoes.some(p => p.empresaId === 1 && p.resultado?._diagnostico_tecnico?.retry_sucesso),
        'retry da J2A deve registrar diagnostico tecnico de recuperacao',
      );
      assert(interpretacoes.some(p => p.resultado?._sql_auditoria?.empresas?.some(e => e.retry_canonico)), 'auditoria consolidada deve marcar retry');
      assert(
        interpretacoes.some(p => p.resultado?._sql_auditoria?.empresas?.some(e => e.diagnostico_tecnico?.retry_sucesso)),
        'auditoria consolidada deve carregar o diagnostico tecnico do retry',
      );
    }

    console.log('whatsapp-all-retry-canonico.test.js: ok');
  } finally {
    intentService._garantirIntencoesDinamicasPadrao = orig.garantir;
    intentService.temConfiguracaoMinima = orig.temConfig;
    intentService.classificar = orig.classificar;
    intentRouter.rotear = orig.rotear;
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

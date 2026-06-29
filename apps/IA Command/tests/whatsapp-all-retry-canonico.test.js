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

const perguntaCrashFinanceiro = 'Contas a pagar do período de 16/06/2026 a 20/06/2026';

const sqlC3I = `SET ROWCOUNT 50000;
SELECT COALESCE(SUM(SE2.E2_SALDO), 0) AS contas_a_pagar
FROM SE2020 SE2
WHERE SE2.D_E_L_E_T_ = ' '
  AND SE2.E2_VENCREA BETWEEN '20260616' AND '20260620'`;

function sucessoC3I(iteracao) {
  return {
    tipo: 'sucesso_ai_sql',
    resposta_direta: `C3I ok ${iteracao}`,
    rows: [{ faturamento: 200 + iteracao }],
    sql_gerado: sqlC3I,
    _sql_canonico: sqlC3I,
    _sql_canonico_origem: 'ia_owner',
    _entidadesResolvidas: [],
    _sql_auditoria: {
      sql_ia_bruto: sqlC3I,
      sql_final_executado: sqlC3I,
    },
    duracao_ms: 5,
  };
}

function sucessoRetryJ2A(iteracao) {
  const sqlJ2A = sqlC3I.replace(/SE2020/g, 'SE2010');
  return {
    tipo: 'sucesso_ai_sql',
    resposta_direta: `J2A retry ok ${iteracao}`,
    rows: [{ faturamento: 100 + iteracao }],
    sql_gerado: sqlJ2A,
    _sql_canonico: sqlJ2A,
    _sql_canonico_origem: 'ia_owner_reuso',
    _entidadesResolvidas: [],
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
      intencao: 'financeiro_dinamico',
      modulo: 'financeiro',
      filtros: {},
      periodo: { tipo: 'intervalo', dataInicio: '20260616', dataFim: '20260620' },
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
      svc._moduloMonitorIntent = () => 'financeiro';

      const interpretacoes = [];
      svc._registrarInterpretacao = payload => interpretacoes.push(payload);

      const chamadas = [];
      intentRouter.rotear = async (intent, empresaId) => {
        chamadas.push({ empresaId, intent });
        if (empresaId === 1 && !intent._usarSqlCanonicoWhatsappAll) {
          return {
            tipo: 'erro',
            subtipo: 'contrato_entidade_invalido',
            resposta_direta: 'Falha simulada na primeira empresa.',
            sql_gerado: 'SELECT sem filtro',
            duracao_ms: 2,
          };
        }
        if (empresaId === 2 && !intent._usarSqlCanonicoWhatsappAll) return sucessoC3I(iteracao);
        if (empresaId === 1 && intent._usarSqlCanonicoWhatsappAll) return sucessoRetryJ2A(iteracao);
        throw new Error(`chamada inesperada empresa=${empresaId} canonico=${!!intent._usarSqlCanonicoWhatsappAll}`);
      };

      const resposta = await svc._pipelineAll(perguntaCrashFinanceiro, empresas, null);

      assert.strictEqual(chamadas.length, 3, 'deve tentar J2A, gerar canonico na C3I e retentar J2A com o canonico');
      assert.strictEqual(chamadas[0].empresaId, 1, 'primeira tentativa deve ser J2A');
      assert.strictEqual(chamadas[0].intent._usarSqlCanonicoWhatsappAll, undefined, 'primeira tentativa nao tem canonico');
      assert.strictEqual(chamadas[1].empresaId, 2, 'segunda tentativa deve gerar canonico na C3I');
      assert.strictEqual(chamadas[1].intent._usarSqlCanonicoWhatsappAll, undefined, 'C3I gera SQL pela IA');
      assert.strictEqual(chamadas[2].empresaId, 1, 'terceira chamada deve voltar para J2A');
      assert.strictEqual(chamadas[2].intent._usarSqlCanonicoWhatsappAll, true, 'retry da J2A deve reusar o canonico, sem nova chamada de IA');
      assert.strictEqual(chamadas[2].intent._sqlCanonicoEmpresaOrigem, 2, 'origem do canonico deve ser a C3I');
      assert(resposta.includes('C3I ok') && resposta.includes('J2A retry ok'), 'resposta final deve incluir sucesso original e o retry via canonico');
      assert(!resposta.includes('Nao consegui consultar') && !resposta.includes('não consegui consultar'), 'erro inicial da J2A deve ser removido apos retry bem-sucedido com o canonico');
      assert(
        interpretacoes.some(p => p.empresaId === 1 && p.resultado?._diagnostico_tecnico?.retry_sucesso === true),
        'registro do retry deve marcar retry_sucesso=true para J2A',
      );
      assert(
        interpretacoes.some(p => p.empresaId === 1 && p.resultado?._retry_canonico),
        'deve registrar que J2A foi resolvida via retry canonico cross-tenant',
      );
      assert(
        interpretacoes.some(p => p.empresaId === 2 && p.resultado?._sql_canonico_reuso_permitido === true),
        'SQL canonico da C3I deve ser auditado com reuso cross-tenant permitido',
      );
      assert(
        interpretacoes.some(p => p.empresaId === 2 && p.resultado?._sql_canonico_reuso_tecnico_permitido === true),
        'auditoria deve manter a viabilidade tecnica do canonico',
      );
      assert(
        interpretacoes.some(p => p.resultado?._pipeline_origem === 'consolidado'),
        'registro consolidado deve marcar pipeline_origem=consolidado',
      );
    }

    {
      const svc = new IACWhatsAppService();
      svc._empresaId = 1;
      svc._buildHistoricoResumido = () => [];
      svc._historicoTurnosConfig = () => 5;
      svc._formatarConsolidadoDinamicoAll = () => '';
      svc._saveLastIntent = () => {};
      svc._moduloMonitorIntent = () => 'financeiro';

      const interpretacoes = [];
      svc._registrarInterpretacao = payload => interpretacoes.push(payload);

      intentRouter.rotear = async (intent, empresaId) => {
        if (empresaId === 1) return undefined;
        return sucessoC3I(900);
      };

      await svc._pipelineAll(perguntaCrashFinanceiro, empresas, null);

      assert(
        interpretacoes.some(p => (
          p.empresaId === 1
          && p.resultado?._diagnostico_tecnico?.codigo === 'resultado_invalido_roteador'
        )),
        'resultado invalido do roteador deve ser registrado como anomalia tecnica',
      );
    }

    {
      const svc = new IACWhatsAppService();
      svc._empresaId = 1;
      svc._buildHistoricoResumido = () => [];
      svc._historicoTurnosConfig = () => 5;
      svc._formatarConsolidadoDinamicoAll = () => '';
      svc._saveLastIntent = () => {};
      svc._moduloMonitorIntent = () => 'financeiro';

      const interpretacoes = [];
      svc._registrarInterpretacao = payload => interpretacoes.push(payload);

      intentRouter.rotear = async (intent, empresaId) => {
        if (empresaId === 1) throw new Error('falha simulada no roteador');
        return sucessoC3I(901);
      };

      await svc._pipelineAll(perguntaCrashFinanceiro, empresas, null);

      assert(
        interpretacoes.some(p => (
          p.empresaId === 1
          && p.resultado?._diagnostico_tecnico?.codigo === 'excecao_pipeline_multiempresa'
          && p.resultado?._diagnostico_tecnico?.detalhe === 'falha simulada no roteador'
        )),
        'excecao do pipeline multiempresa deve ser registrada como anomalia tecnica',
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

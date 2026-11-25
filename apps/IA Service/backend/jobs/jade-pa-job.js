// Jaade no Primeiro Atendimento como job do serviço IAHub-Jobs (2026-11-24).
// Uma instância por empresa+fonte com a Jaade iniciada; cada leitura roda num
// processo filho próprio. A regra da leitura não muda: é a mesma do site
// (executarCiclo / leitura avulsa), com a trava própria da Jaade por baixo.
//
// Idempotente: jade_pa_execucoes garante uma ação por chamado; a busca do
// workflow pelo título impede abrir dois; a trava do ciclo impede duas
// leituras da mesma fonte.
const database = require('../database');
const repo = require('../repositories/jade-pa-repository');

let _schemaConferido = false;

function _partes(instancia) {
  const i = String(instancia).indexOf(':');
  return { empresaId: Number(String(instancia).slice(0, i)), fonteId: String(instancia).slice(i + 1) };
}

function _jade() {
  // Carregado só no processo que executa: o supervisor não precisa do motor de investigação.
  return require('../services/jade-pa-service');
}

function _nomeEmpresa(empresaId) {
  try {
    return require('../../../IAHUB/backend/empresas/database').buscarPorId(empresaId)?.razao_social || `Empresa ${empresaId}`;
  } catch (_) {
    return `Empresa ${empresaId}`;
  }
}

module.exports = {
  id: 'ia-service.jade-pa',
  nome: 'Jaade · Primeiro Atendimento',
  descricao: 'Jaade no Primeiro Atendimento: leitura dos chamados em "Aguardar Retorno JAADE".',
  idempotente: true,
  // A leitura trata todos os elegíveis; cada chamado tem tempos próprios (IA,
  // SoftExpert). Teto só contra processo preso.
  timeoutMs: 2 * 60 * 60 * 1000,

  preparar() {
    try {
      database.getDB();
    } catch (_) {
      database.abrirDBSemMigrar();
    }
    if (_schemaConferido) return;
    const pendentes = database.migracoesPendentes();
    if (pendentes.length) throw new Error(`banco do IA Service com migração pendente (v${pendentes.join(', v')}); aguardando o site aplicar.`);
    _schemaConferido = true;
  },

  instancias(agora) {
    return repo.listarConfigsAtivas().map(cfg => {
      const proximaEm = cfg.proximoCicloEm
        || (cfg.ultimoCicloEm ? new Date(Date.parse(cfg.ultimoCicloEm) + cfg.intervaloMinutos * 60000).toISOString() : null);
      return {
        instancia: `${cfg.empresaId}:${cfg.fonteId}`,
        devida: repo.cicloDevido(cfg, agora),
        devidaDesde: proximaEm || '',
        proximaEm,
      };
    });
  },

  empresaDaInstancia(instancia) {
    return _partes(instancia).empresaId || null;
  },

  descreverInstancia(instancia) {
    const { empresaId, fonteId } = _partes(instancia);
    const empresa = _nomeEmpresa(empresaId);
    let fonte = fonteId;
    try {
      fonte = require('../repositories/agente-local-repository').getFonte(empresaId, fonteId)?.nome || fonteId;
    } catch (_) { /* fonte excluída: mostra o id */ }
    return { empresaId, empresa, rotulo: `${empresa} · ${fonte}` };
  },

  instanciaValida(instancia) {
    if (!/^\d+:.+$/.test(String(instancia))) return false;
    const { empresaId, fonteId } = _partes(instancia);
    return !!repo.getConfig(empresaId, fonteId).atualizadoEm;
  },

  async executar(instancia, { origem, execId }) {
    const { empresaId, fonteId } = _partes(instancia);
    const jade = _jade();
    const dono = `jobs:${execId}`;
    const r = origem === 'manual' ? await jade.executarAvulsa(empresaId, fonteId, { dono }) : await jade.executarCiclo(empresaId, fonteId, { dono });
    if (!r) return { resultado: 'vazio', resumo: { motivo: 'Leitura já em andamento ou fora da hora.' } };
    const resumo = {
      loteId: r.loteGravado ? r.loteId : null,
      elegiveis: r.elegiveis,
      novos: r.novos,
      processados: (r.processados || []).length,
      enviados: (r.enviados || []).length,
      erros: r.erros || [],
    };
    const trabalhou = resumo.novos || resumo.processados || resumo.enviados;
    return { resultado: resumo.erros.length ? 'aviso' : trabalhou ? 'ok' : 'vazio', resumo };
  },

  aoInterromper(instancia, { origem, motivo, execId, orfa }) {
    const { empresaId, fonteId } = _partes(instancia);
    // Uma execução órfã pode ter deixado um filho ainda vivo. Não antecipar
    // o vencimento da trava nem encerrar seu lote sem confirmar sua morte.
    if (orfa || !execId) return;
    repo.liberarCicloInterrompido(empresaId, fonteId, { motivo, avulsa: origem === 'manual', dono: `jobs:${execId}` });
  },
};

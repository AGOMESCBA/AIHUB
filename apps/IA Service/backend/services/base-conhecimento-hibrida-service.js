'use strict';

const repo = require('../repositories/chamado-repository');
const vetores = require('./base-conhecimento-vetores-service');

async function combinar(empresaId, chamadoId, textuais, { escopo = 'empresa', textoContexto = '', limite = 15 } = {}) {
  if (process.env.IA_SERVICE_VETORES_ATIVO !== '1') return { candidatos: textuais, estadoVetorial: 'desativada' };
  try {
    const busca = await vetores.buscar(empresaId, chamadoId, { escopo, textoContexto, limite, comDiagnostico: true });
    const encontrados = Array.isArray(busca) ? busca : busca.resultados;
    const adicionais = repo.obterCandidatosPorIds(empresaId, chamadoId, encontrados.map(x => x.chamadoId), { escopo });
    const validos = new Map(adicionais.map(c => [c.chamado.id, c]));
    const ranking = new Map();
    textuais.forEach((c, i) => ranking.set(c.chamado.id, { candidato: c, pontos: 1 / (61 + i), ordem: i }));
    encontrados.forEach((r, i) => {
      const candidato = validos.get(r.chamadoId);
      if (!candidato) return;
      const item = ranking.get(r.chamadoId);
      if (item) {
        item.pontos += 1 / (61 + i);
        item.candidato = { ...item.candidato, motivos: [...(item.candidato.motivos || []), 'Também recuperado por similaridade semântica'] };
      } else ranking.set(r.chamadoId, { candidato, pontos: 1 / (61 + i), ordem: textuais.length + i });
    });
    return { candidatos: [...ranking.values()].sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem).slice(0, limite).map(x => x.candidato), estadoVetorial: Array.isArray(busca) ? 'disponivel' : busca.estado };
  } catch (_) {
    return { candidatos: textuais, estadoVetorial: 'indisponivel' };
  }
}

module.exports = { combinar };

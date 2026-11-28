'use strict';

// Escolhe o atendente para a oferta e calcula ou verifica seu prazo.
// Biblioteca pura, sem acesso a banco de dados, rede ou relógio global.

function escolherAtendente({ candidatos, limite, excluir = [] } = {}) {
  if (!Array.isArray(candidatos) || !Number.isFinite(limite) || limite <= 0 || !Array.isArray(excluir)) return null;
  const excluidos = new Set(excluir);
  let melhor = null;
  for (const candidato of candidatos) {
    if (!candidato || typeof candidato.id !== 'string' || !candidato.id.trim()
      || candidato.status !== 'disponivel' || candidato.online !== true
      || !Number.isInteger(candidato.abertas) || candidato.abertas < 0 || candidato.abertas >= limite
      || excluidos.has(candidato.id)) continue;
    const ultima = candidato.ultima_oferta_em;
    if (ultima !== null && (typeof ultima !== 'string' || !ultima.trim() || !Number.isFinite(Date.parse(ultima)))) continue;
    const instante = ultima === null ? -Infinity : Date.parse(ultima);
    if (!melhor || candidato.abertas < melhor.abertas
      || (candidato.abertas === melhor.abertas && (instante < melhor.instante
        || (instante === melhor.instante && candidato.id < melhor.id)))) {
      melhor = { id: candidato.id, abertas: candidato.abertas, instante };
    }
  }
  return melhor ? { usuario_id: melhor.id } : null;
}

function prazoDaOferta({ agoraMs, tempoAceiteMin }) {
  if (!Number.isFinite(agoraMs) || !Number.isFinite(tempoAceiteMin) || tempoAceiteMin < 0) {
    throw new TypeError('Informe agoraMs e tempoAceiteMin válidos.');
  }
  const prazo = new Date(agoraMs + tempoAceiteMin * 60000);
  if (!Number.isFinite(prazo.getTime())) throw new RangeError('Prazo da oferta inválido.');
  return prazo.toISOString();
}

function ofertaVencida({ ate, agoraMs }) {
  return typeof ate === 'string' && Number.isFinite(agoraMs)
    && Number.isFinite(Date.parse(ate)) && agoraMs >= Date.parse(ate);
}

module.exports = { escolherAtendente, prazoDaOferta, ofertaVencida };

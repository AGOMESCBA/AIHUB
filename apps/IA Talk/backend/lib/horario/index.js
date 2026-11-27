'use strict';

// L1 — biblioteca pura de horário de atendimento do setor (sem banco, sem IO,
// sem relógio global). Contrato: docs/contratos.md §8.3 e §8.6.
//
// Formato esperado:
//   {
//     ligado: boolean,
//     fuso: 'America/Cuiaba',
//     dias: [{ dia: 0..6 (0 = domingo), inicio: 'HH:MM', fim: 'HH:MM' }]
//   }
// O mesmo dia pode ter múltiplos intervalos sem sobreposição (ex.: 08:00–12:00 e 13:00–18:00).
// O horário de início é inclusivo e o de fim é exclusivo (18:00 já está fora).
//
// Comportamento em transições de horário de verão (qualquer fuso IANA):
//   - Horário inexistente (avanço / spring-forward): se `inicio` cair na faixa
//     pulada pelo relógio, a abertura efetiva ocorre no instante exato do salto
//     (ex.: 02:30 num salto 02:00->03:00 abre às 03:00), desde que esse instante
//     esteja dentro de [inicio, fim). Se o intervalo inteiro cair na faixa pulada,
//     esse dia não abre e a busca segue para a próxima abertura válida.
//   - Horário repetido (recuo / fall-back): todas as ocorrências do horário local
//     são consideradas em ordem cronológica (1ª e 2ª ocorrência no mesmo dia),
//     assim como eventuais reentradas num intervalo causadas pelo recuo do relógio.
//   - Invariante: sempre que `proximaAbertura` devolve um ISO, `dentroDoHorario`
//     é `true` nesse instante.

const HORA_MS = 60 * 60 * 1000;
const JANELA_AVISO_PADRAO_MS = 12 * HORA_MS;
const PADRAO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MAPA_DIA_SEMANA = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

// Cache interno de formatadores Intl (imutáveis por fuso já validado).
const FORMATADORES_FUSO = new Map();

function obterFormatador(fuso) {
  let fmt = FORMATADORES_FUSO.get(fuso);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATADORES_FUSO.set(fuso, fmt);
  }
  return fmt;
}

function parseDataMs(valor, nomeCampo) {
  if (valor instanceof Date) {
    const ms = valor.getTime();
    if (!Number.isFinite(ms)) throw new TypeError(`${nomeCampo} inválido.`);
    return ms;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError(`${nomeCampo} inválido.`);
    return valor;
  }
  if (typeof valor === 'string' && valor.trim()) {
    const ms = Date.parse(valor);
    if (!Number.isFinite(ms)) throw new TypeError(`${nomeCampo} inválido.`);
    return ms;
  }
  throw new TypeError(`${nomeCampo} é obrigatório e deve ser uma data válida.`);
}

function fusoValido(fuso) {
  if (typeof fuso !== 'string' || !fuso.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso.trim() });
    return true;
  } catch (_) {
    return false;
  }
}

function minutosDeHora(texto) {
  if (typeof texto !== 'string') return null;
  const m = PADRAO_HORA.exec(texto);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function partesNoFuso(ms, fuso) {
  const partes = obterFormatador(fuso).formatToParts(new Date(ms));
  const mapa = {};
  for (const p of partes) {
    if (p.type !== 'literal') mapa[p.type] = p.value;
  }
  const horaBruta = Number(mapa.hour);
  return {
    ano: Number(mapa.year),
    mes: Number(mapa.month),
    diaMes: Number(mapa.day),
    diaSemana: MAPA_DIA_SEMANA[mapa.weekday],
    hora: horaBruta === 24 ? 0 : horaBruta,
    minuto: Number(mapa.minute),
    segundo: Number(mapa.second),
  };
}

function offsetFusoMs(ms, fuso) {
  const segUtc = Math.floor(ms / 1000) * 1000;
  const p = partesNoFuso(segUtc, fuso);
  const localComoUtc = Date.UTC(p.ano, p.mes - 1, p.diaMes, p.hora, p.minuto, p.segundo, 0);
  return localComoUtc - segUtc;
}

function somarDiasCalendario(ano, mes, diaMes, deltaDias) {
  const d = new Date(Date.UTC(ano, mes - 1, diaMes + deltaDias));
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    diaMes: d.getUTCDate(),
  };
}

// Inspeciona uma janela de 36 h centrada no meio-dia UTC da data informada
// (cobrindo o dia inteiro em qualquer fuso IANA de UTC-12 a UTC+14).
// Devolve todos os offsets distintos observados e os instantes exatos (ms UTC)
// de eventuais transições de horário de verão que caiam nessa data local.
function inspecionarDiaNoFuso({ ano, mes, diaMes }, fuso) {
  const centroUtc = Date.UTC(ano, mes - 1, diaMes, 12, 0, 0, 0);
  const amostras = [];
  for (let h = -18; h <= 18; h += 6) {
    const t = centroUtc + h * HORA_MS;
    amostras.push({ t, off: offsetFusoMs(t, fuso) });
  }

  const offsets = new Set(amostras.map((a) => a.off));
  const transicoes = [];

  for (let i = 1; i < amostras.length; i++) {
    const ant = amostras[i - 1];
    const atu = amostras[i];
    if (ant.off === atu.off) continue;

    // Busca binária no segundo exato em que o offset muda.
    let lo = Math.floor(ant.t / 1000);
    let hi = Math.floor(atu.t / 1000);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (offsetFusoMs(mid * 1000, fuso) === ant.off) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const tTransicao = hi * 1000;
    offsets.add(offsetFusoMs(tTransicao, fuso));
    const pt = partesNoFuso(tTransicao, fuso);
    if (pt.ano === ano && pt.mes === mes && pt.diaMes === diaMes) {
      transicoes.push(tTransicao);
    }
  }

  return { offsets: [...offsets], transicoes };
}

/**
 * Valida o objeto de horário de atendimento do setor.
 *
 * @param {object} h
 * @returns {string|null} `null` se válido; caso contrário, mensagem em pt-BR.
 */
function validarHorario(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    return 'Informe o objeto de horário de atendimento.';
  }
  if (typeof h.ligado !== 'boolean') {
    return 'Informe ligado como booleano (true ou false).';
  }
  if (!fusoValido(h.fuso)) {
    return 'Informe um fuso horário válido (ex.: America/Cuiaba).';
  }
  if (!Array.isArray(h.dias)) {
    return 'Informe a lista de dias do horário.';
  }
  if (h.ligado && h.dias.length === 0) {
    return 'Marque ao menos um dia ou desligue o horário.';
  }

  const porDia = new Map();
  for (const d of h.dias) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return 'Cada item de dias deve ser um objeto com dia, inicio e fim.';
    }
    if (!Number.isInteger(d.dia) || d.dia < 0 || d.dia > 6) {
      return 'Dia da semana deve ser um inteiro de 0 (domingo) a 6 (sábado).';
    }
    const inicioMin = minutosDeHora(d.inicio);
    const fimMin = minutosDeHora(d.fim);
    if (inicioMin === null || fimMin === null) {
      return 'Use HH:MM válido para início e fim (00:00 a 23:59).';
    }
    if (inicioMin >= fimMin) {
      return 'O horário de início deve ser anterior ao horário de fim.';
    }
    if (!porDia.has(d.dia)) porDia.set(d.dia, []);
    porDia.get(d.dia).push({ inicioMin, fimMin });
  }

  for (const intervalos of porDia.values()) {
    intervalos.sort((a, b) => a.inicioMin - b.inicioMin);
    for (let i = 1; i < intervalos.length; i++) {
      if (intervalos[i - 1].fimMin > intervalos[i].inicioMin) {
        return 'Intervalos do mesmo dia não podem se sobrepor.';
      }
    }
  }

  return null;
}

function exigirHorarioValido(h) {
  const erro = validarHorario(h);
  if (erro) throw new TypeError(erro);
}

function estaDentroComFusoValidado(h, ms, fuso) {
  const p = partesNoFuso(ms, fuso);
  const msFracao = ((ms % 1000) + 1000) % 1000;
  const segDoDia = p.hora * 3600 + p.minuto * 60 + p.segundo + msFracao / 1000;

  for (const d of h.dias) {
    if (d.dia !== p.diaSemana) continue;
    const inicioSeg = minutosDeHora(d.inicio) * 60;
    const fimSeg = minutosDeHora(d.fim) * 60;
    if (segDoDia >= inicioSeg && segDoDia < fimSeg) {
      return true;
    }
  }
  return false;
}

/**
 * Informa se o instante está dentro do horário de atendimento do setor.
 * Com `ligado: false`, sempre retorna `true`.
 * O horário de fim é exclusivo (ex.: 18:00 já está fora de 08:00–18:00).
 *
 * @param {object} h
 * @param {string|number|Date} instanteIso
 * @returns {boolean}
 */
function dentroDoHorario(h, instanteIso) {
  exigirHorarioValido(h);
  const ms = parseDataMs(instanteIso, 'instanteIso');
  if (!h.ligado) return true;
  return estaDentroComFusoValidado(h, ms, h.fuso.trim());
}

/**
 * Devolve o ISO UTC da próxima abertura do horário até 7 dias à frente,
 * ou `null` quando o horário está desligado ou o instante já está dentro do horário.
 *
 * @param {object} h
 * @param {string|number|Date} instanteIso
 * @returns {string|null}
 */
function proximaAbertura(h, instanteIso) {
  exigirHorarioValido(h);
  const ms = parseDataMs(instanteIso, 'instanteIso');
  if (!h.ligado) return null;

  const fuso = h.fuso.trim();
  if (estaDentroComFusoValidado(h, ms, fuso)) return null;

  const p = partesNoFuso(ms, fuso);
  const candidatos = new Set();

  for (let delta = 0; delta <= 7; delta++) {
    const dataAlvo = somarDiasCalendario(p.ano, p.mes, p.diaMes, delta);
    const diaAlvo = (p.diaSemana + delta) % 7;
    const intervalos = h.dias.filter((d) => d.dia === diaAlvo);
    if (!intervalos.length) continue;

    const { offsets, transicoes } = inspecionarDiaNoFuso(dataAlvo, fuso);

    // 1. Ocorrências exatas de cada `inicio` naquele dia (0 no gap, 1 normal, 2 no fall-back).
    for (const d of intervalos) {
      const inicioMin = minutosDeHora(d.inicio);
      const hora = Math.floor(inicioMin / 60);
      const minuto = inicioMin % 60;
      const alvoUtc = Date.UTC(dataAlvo.ano, dataAlvo.mes - 1, dataAlvo.diaMes, hora, minuto, 0, 0);

      for (const off of offsets) {
        const cand = alvoUtc - off;
        if (cand <= ms) continue;
        const pc = partesNoFuso(cand, fuso);
        if (
          pc.ano === dataAlvo.ano &&
          pc.mes === dataAlvo.mes &&
          pc.diaMes === dataAlvo.diaMes &&
          pc.hora === hora &&
          pc.minuto === minuto &&
          pc.segundo === 0
        ) {
          candidatos.add(cand);
        }
      }
    }

    // 2. Instantes exatos de transição DST no dia: cobrem tanto abertura efetiva
    //    após horário inexistente (spring-forward) quanto reentrada após recuo (fall-back).
    for (const tTransicao of transicoes) {
      if (tTransicao > ms) candidatos.add(tTransicao);
    }
  }

  const ordenados = [...candidatos].sort((a, b) => a - b);
  for (const cand of ordenados) {
    if (estaDentroComFusoValidado(h, cand, fuso)) {
      return new Date(cand).toISOString();
    }
  }

  return null;
}

/**
 * Indica se já é permitido enviar uma nova mensagem automática de fora do horário
 * para a conversa (nunca avisou ou já passou pelo menos `janelaMs` desde o último aviso).
 *
 * @param {{ ultimoAvisoEm?: string|number|Date|null, instanteIso: string|number|Date, janelaMs?: number }} p
 * @returns {boolean}
 */
function podeAvisarForaDoHorario(p) {
  const { ultimoAvisoEm, instanteIso, janelaMs = JANELA_AVISO_PADRAO_MS } = p || {};
  const agoraMs = parseDataMs(instanteIso, 'instanteIso');
  if (typeof janelaMs !== 'number' || !Number.isFinite(janelaMs) || janelaMs < 0) {
    throw new TypeError('janelaMs deve ser um número finito maior ou igual a 0.');
  }
  if (ultimoAvisoEm === null || ultimoAvisoEm === undefined || ultimoAvisoEm === '') {
    return true;
  }
  const ultimoMs = parseDataMs(ultimoAvisoEm, 'ultimoAvisoEm');
  return (agoraMs - ultimoMs) >= janelaMs;
}

module.exports = {
  JANELA_AVISO_PADRAO_MS,
  validarHorario,
  dentroDoHorario,
  proximaAbertura,
  podeAvisarForaDoHorario,
};

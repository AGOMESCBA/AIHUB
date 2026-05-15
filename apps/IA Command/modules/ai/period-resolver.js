// Converts AI-resolved period to concrete date range strings (YYYYMMDD) for Protheus

function resolverPeriodo(periodo) {
  const hoje  = new Date();
  const ano   = hoje.getFullYear();
  const mes   = hoje.getMonth(); // 0-based

  let inicio, fim;

  switch (periodo?.tipo) {
    case 'mes_atual': {
      inicio = new Date(ano, mes, 1);
      fim    = new Date(ano, mes + 1, 0);
      break;
    }
    case 'mes_anterior': {
      inicio = new Date(ano, mes - 1, 1);
      fim    = new Date(ano, mes, 0);
      break;
    }
    case 'ano_atual': {
      inicio = new Date(ano, 0, 1);
      fim    = new Date(ano, 11, 31);
      break;
    }
    case 'ultimo_trimestre': {
      inicio = new Date(ano, mes - 3, 1);
      fim    = new Date(ano, mes, 0);
      break;
    }
    case 'personalizado': {
      // meses_atras: N → últimos N meses completos
      const n = periodo.meses_atras || 1;
      inicio  = new Date(ano, mes - n, 1);
      fim     = new Date(ano, mes, 0);
      break;
    }
    default: {
      // sem filtro de período
      return { dataInicio: null, dataFim: null };
    }
  }

  return {
    dataInicio: _fmt(inicio),
    dataFim:    _fmt(fim),
  };
}

function _fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

module.exports = { resolverPeriodo };

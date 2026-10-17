const erro = mensagem => Object.assign(new Error(mensagem), { status: 400 });

function minutos(valor, rotulo, meiaHora = false) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(valor || '') || (meiaHora && !/:(00|30)$/.test(valor))) throw erro(`${rotulo}: selecione um horário válido${meiaHora ? ' de meia em meia hora' : ', sem segundos'}.`);
  const [hora, minuto] = valor.split(':').map(Number);
  return hora * 60 + minuto;
}

function normalizarHoras(campos) {
  const inicio = minutos(campos.HORAINI, 'Hora inicial', true);
  const fim = minutos(campos.HORAFIM, 'Hora final', true);
  const intervalo = minutos(campos.HORAINT, 'Intervalo', true);
  if (fim < inicio) throw erro('A hora final não pode ser menor que a hora inicial.');
  const total = fim - inicio - intervalo;
  if (total < 0) throw erro('O intervalo não pode exceder o período entre a hora inicial e a final.');
  if (campos.DTAGEND && (!/^\d{4}-\d{2}-\d{2}$/.test(campos.DTAGEND) || !Number.isFinite(Date.parse(campos.DTAGEND)) || new Date(campos.DTAGEND).toISOString().slice(0, 10) !== campos.DTAGEND)) throw erro('Informe uma data de agendamento válida.');
  if (campos.HRAGEND) minutos(campos.HRAGEND, 'Hora do agendamento');
  return { ...campos, HORAINICONV: String(inicio / 60), HORAINTCONV: String(intervalo / 60), HORAFIMCONV: String(fim / 60), HORATOTALNUM: String(total / 60) };
}

module.exports = { normalizarHoras };

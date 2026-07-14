const whatsappManager = require('../whatsapp/service-manager');
const store = require('./scheduled-question-store');

async function executarJob(empresaId, job, { trigger_tipo = 'manual', usuario = 'sistema' } = {}) {
  const destinatarios = store.listarDestinatarios(empresaId, job.id);
  if (!destinatarios.length) {
    throw Object.assign(new Error('Job sem destinatarios ativos.'), { statusCode: 400 });
  }

  const svc = whatsappManager.get(job.channel_id);
  if (!svc || svc.getStatus() !== 'connected') {
    throw Object.assign(new Error('Canal WhatsApp do job nao esta conectado.'), { statusCode: 409 });
  }

  const run = store.criarRun(empresaId, job, { trigger_tipo, usuario });
  const started = Date.now();
  const resumo = [];
  let sucessos = 0;
  let falhas = 0;
  let primeiroLogId = null;
  let primeiraResposta = null;

  for (const dest of destinatarios) {
    const deliveryId = store.criarDelivery(empresaId, run.id, job.id, dest);
    try {
      const result = await svc.executeScheduledQuestion({
        empresaId,
        numero: dest.numero,
        pergunta: job.pergunta,
        jobNome: job.nome,
      });
      if (result.ok === false) falhas++;
      else sucessos++;
      if (!primeiroLogId && result.interpretation_log_id) primeiroLogId = result.interpretation_log_id;
      if (!primeiraResposta && result.resposta) primeiraResposta = result.resposta;
      resumo.push(`${dest.nome || dest.numero}: ${result.ok === false ? (result.error_detail || 'executado com erro na consulta') : 'enviado'}`);
      store.atualizarDelivery(deliveryId, { status: 'sucesso', sent_at: new Date().toISOString(), erro: null });
    } catch (err) {
      falhas++;
      resumo.push(`${dest.nome || dest.numero}: ${err.message}`);
      store.atualizarDelivery(deliveryId, { status: 'erro', erro: err.message });
    }
  }

  const status = sucessos && !falhas ? 'sucesso' : sucessos ? 'parcial' : 'erro';
  return store.atualizarRun(empresaId, run.id, {
    status,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    interpretation_log_id: primeiroLogId,
    resposta: primeiraResposta || resumo.join('\n'),
    erro: falhas ? resumo.filter(x => !x.endsWith(': enviado')).join('\n') : null,
  });
}

module.exports = { executarJob };

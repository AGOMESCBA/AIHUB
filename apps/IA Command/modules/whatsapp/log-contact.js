const { getDB } = require('../database');
const { variantesNumeroBrasil, extrairLid } = require('./channel-store');

// Apenas apresentacao: uma falha na identificacao nunca deve interromper o envio.
function formatarContatoParaLog(numero, { empresaId, channelId } = {}, obterDB = getDB) {
  const original = String(numero || '');
  try {
    const numeros = variantesNumeroBrasil(original);
    if (!numeros.length || (!empresaId && !channelId)) return original;
    const params = [];
    const escopo = empresaId
      ? 'a.empresa_id = ?'
      : `a.empresa_id IN (
          SELECT empresa_id FROM whatsapp_channel_companies WHERE channel_id = ? AND ativo = 1
        )`;
    params.push(empresaId ? Number(empresaId) : String(channelId));
    const lid = extrairLid(original);
    const correspondencia = lid
      ? 'a.wa_lid = ?'
      : `a.numero IN (${numeros.map(() => '?').join(',')})`;
    params.push(...(lid ? [lid] : numeros));
    const rows = obterDB().prepare(`
      SELECT DISTINCT TRIM(a.nome) AS nome FROM whatsapp_allowed_numbers a
      WHERE a.ativo = 1 AND ${escopo} AND ${correspondencia}
        AND TRIM(COALESCE(a.nome, '')) <> ''
      LIMIT 2
    `).all(...params);
    // Um canal compartilhado pode ter nomes diferentes para o mesmo telefone.
    if (rows.length !== 1) return original;
    const nome = rows[0].nome.replace(/[\r\n\t]+/g, ' ').trim();
    return nome ? `${nome} (${original})` : original;
  } catch (_) {
    return original;
  }
}

// Somente descrições conhecidas: nunca inclui o conteúdo da mensagem ou o OTP.
const acoesEnvio = new Map([
  ['chatweb_aviso_acesso', 'IA Command: aviso de acesso ao Chat Web enviado'],
  ['chatweb_codigo_acesso', 'IA Command: código de acesso ao Chat Web enviado'],
  ['chatweb_encaminhamento', 'IA Command: resposta do Chat Web encaminhada'],
  ['iaservice_aviso_acesso', 'IA Service: aviso de acesso ao chat enviado'],
  ['iaservice_codigo_acesso', 'IA Service: código de acesso ao chat enviado'],
  ['servico_externo', 'Mensagem de serviço externo enviada'],
]);

function formatarAcaoEnvioParaLog(finalidadeEnvio) {
  return acoesEnvio.get(finalidadeEnvio) || 'Mensagem enviada';
}

module.exports = { formatarContatoParaLog, formatarAcaoEnvioParaLog };

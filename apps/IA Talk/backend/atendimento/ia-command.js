'use strict';

// Conversa do IA Talk com o IA Command no número compartilhado (C9, parte 2).
// Rotas internas do IA Command (só de 127.0.0.1, com o mesmo segredo do envio do código
// de login — acesso/envio-codigo.js): talk/numero, talk/atendimento-iniciado e
// talk/atendimento-encerrado (apps/IA Command/modules/whatsapp/servico-externo-routes.js).
// Qualquer falha devolve null: quem chama decide com segurança (na dúvida, o Talk NÃO
// grava a conversa, porque ela pode ser do assistente do ERP).

function criarClienteIaCommand({ env = process.env, fetchFn = fetch, timeoutMs = 3000 } = {}) {
  async function chamar(metodo, rota, { query = null, corpo = null } = {}) {
    const segredo = String(env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET || env.SVC_WHATSAPP_OTP_SECRET || '').trim();
    if (!segredo) return null;
    const url = new URL(rota, env.IA_COMMAND_INTERNAL_URL || 'http://127.0.0.1:3000');
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    try {
      const r = await fetchFn(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', 'X-Servico-Externo-Secret': segredo },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok ? await r.json() : null;
    } catch (_) {
      return null;
    }
  }
  return {
    // Decisão única do IA Command para uma mensagem recebida (marca a passagem se a pessoa
    // autorizada pediu "atendente"): { canal_encontrado, repassar_ligado, autorizado, em_atendimento } ou null.
    // A palavra de atendimento é a mensagem inteira; cortar mudaria a decisão.
    // apenasConsulta: só o estado (reconciliação), sem valer como recibo de mensagem recebida.
    // O recibo usa o identificador do provedor depois da gravação.
    mensagem: (canal, numero, texto = '', { apenasConsulta = false, em = null } = {}) => chamar('POST', '/api/ia-command/whatsapp/talk/mensagem',
      { corpo: { canal, numero, texto: String(texto || ''), ...(apenasConsulta ? { apenas_consulta: true } : {}), ...(em ? { em } : {}) } }),
    // "Estou vivo" do Talk para o número (sem ele, o IA Command responde como sempre).
    recibo: (canal, numero, mensagemId, texto = '') => chamar('POST', '/api/ia-command/whatsapp/talk/recibo', { corpo: { canal, numero, mensagem_id: mensagemId, texto } }),
    batimento: (canal) => chamar('POST', '/api/ia-command/whatsapp/talk/batimento', { corpo: { canal } }),
    iniciado: (canal, numero, atividadeEm = null, reconciliacao = false) => chamar('POST', '/api/ia-command/whatsapp/talk/atendimento-iniciado', { corpo: { canal, numero, atividade_em: atividadeEm, reconciliacao } }),
    encerrado: (canal, numero) => chamar('POST', '/api/ia-command/whatsapp/talk/atendimento-encerrado', { corpo: { canal, numero } }),
  };
}

module.exports = { criarClienteIaCommand };

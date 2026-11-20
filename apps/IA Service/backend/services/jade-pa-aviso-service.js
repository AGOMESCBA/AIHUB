// Aviso por WhatsApp ao fim de cada lote da Jade no Primeiro Atendimento
// (pedido do usuário, 2026-11-20). Duas mensagens, cada uma para os grupos
// escolhidos na tela: os chamados que ficaram SEM PA (alguém precisa agir) e
// os que tiveram PA PELA JADE. O que a triagem atendeu antes da Jade não entra.
//
// Regra (resultado no SoftExpert, não a intenção da Jade):
//   - retorno não gravado na grade → falha (inclui texto vencido > 4h);
//   - retorno gravado, mas a devolução ao cliente não chegou ao Retorno do
//     Usuário → falha (o chamado ficou parado no meio do caminho);
//   - retorno gravado (segue no PA) ou gravado e devolvido → sucesso;
//   - triagem assumiu antes da devolução → sucesso (o PA foi da Jade).
// Modo Simulação não envia nada: nada foi gravado, seria alarme falso.
//
// Envio pelo IA Command (mesma rota server-to-server do login externo): o
// cadastro de grupos, os números autorizados e o canal da empresa ficam lá.
const repo = require('../repositories/jade-pa-repository');
const chamadoRepo = require('../repositories/chamado-repository');
const clienteRepo = require('../repositories/cliente-repository');

const MAX_LINHAS = 50;
const TIMEOUT_MS = 120 * 1000;

function _base() {
  return process.env.IA_COMMAND_INTERNAL_URL || 'http://127.0.0.1:' + (process.env.PORT || 3000);
}

// Mesma ordem que o IA Command confere (servico-externo-routes.segredoAutorizado).
function _segredo() {
  return String(process.env.IAC_WHATSAPP_SERVICO_EXTERNO_SECRET || process.env.SVC_WHATSAPP_OTP_SECRET || '').trim();
}

async function _iaCommand(caminho, { corpo = null } = {}) {
  const segredo = _segredo();
  if (!segredo) throw new Error('Envio de WhatsApp não configurado (segredo do serviço externo ausente).');
  const r = await fetch(`${_base()}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-servico-externo-secret': segredo },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `IA Command respondeu HTTP ${r.status}.`);
  return json;
}

/** Grupos ativos da empresa no IA Command, para a tela escolher. */
function listarGrupos(empresaId) {
  return _iaCommand(`/api/ia-command/whatsapp/grupos-servico-externo?empresaId=${Number(empresaId)}`);
}

function _enviarParaGrupos(empresaId, grupoIds, texto, tipo) {
  return _iaCommand('/api/ia-command/whatsapp/enviar-grupo-servico-externo', {
    corpo: { empresaId: Number(empresaId), grupoIds, texto, finalidadeEnvio: `iaservice_jade_pa_${tipo}` },
  });
}

/** 'falha' | 'sucesso' | 'nenhum' (sem aviso) | null (ainda não terminou). */
function classificar(exec) {
  switch (exec.estado) {
    case 'devolvido': return 'sucesso';
    case 'publicado': return exec.alerta ? 'falha' : 'sucesso';
    case 'falha': return 'falha';
    case 'descartado': return exec.motivoCodigo === 'texto_vencido' ? 'falha' : 'nenhum';
    case 'simulado': return 'nenhum';
    default: return null;
  }
}

function _limitar(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function _detalhe(exec, tipo) {
  if (tipo === 'sucesso') {
    if (exec.estado === 'devolvido') return 'devolvido ao cliente';
    return exec.decisao === 'devolver' ? 'pedido de informação gravado' : 'respondido';
  }
  if (exec.estado === 'descartado') return 'texto vencido (mais de 4h), não enviado';
  return _limitar(String(exec.ultimoErro || exec.motivo || 'falha sem detalhe').replace(/\s*Chamado deixado para a triagem\.?$/, ''), 140);
}

/** Linha do chamado: "• #037118 · Protheus - Cliente Z — respondido". */
function linhaDoChamado(empresaId, exec, tipo) {
  let produto = null;
  let cliente = null;
  try {
    const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert');
    produto = chamado?.produto || null;
    const c = chamado?.clienteId ? clienteRepo.getClientePorId(empresaId, chamado.clienteId) : null;
    cliente = c?.nomeFantasia || c?.nome || null;
  } catch (_) { /* a linha sai mesmo sem os dados do chamado */ }
  return `• #${exec.numeroChamado} · ${produto || 'Produto não informado'} - ${cliente || 'Cliente não identificado'} — ${_detalhe(exec, tipo)}`;
}

function montarMensagem(empresaId, tipo, execs) {
  const linhas = execs.slice(0, MAX_LINHAS).map(e => linhaDoChamado(empresaId, e, tipo));
  if (execs.length > MAX_LINHAS) linhas.push(`… e mais ${execs.length - MAX_LINHAS} chamado(s). Veja na tela da Jade no PA.`);
  const titulo = tipo === 'falha'
    ? `⚠️ Jade PA — ${execs.length} chamado(s) sem Primeiro Atendimento`
    : `✅ Jade PA — ${execs.length} chamado(s) com Primeiro Atendimento`;
  return [titulo, ...linhas, ...(tipo === 'falha' ? ['Precisam de atendimento da triagem.'] : [])].join('\n');
}

function _registrar(exec, loteId, situacao, resumo, detalhes = null) {
  try {
    repo.registrarEvento(exec.id, exec.empresaId, { etapa: 'aviso', situacao, resumo, detalhes, loteId });
  } catch (err) {
    console.error('[IA Service] Jade PA: registro do aviso falhou:', err.message);
  }
}

/**
 * Fim do lote: avisa os chamados que chegaram ao resultado final. Cada um é
 * avisado uma vez (reserva no banco); se a mensagem não chegou a ninguém, o
 * chamado volta para a próxima leitura tentar de novo. Nunca lança.
 */
async function avisarLote(empresaId, fonteId, { loteId = null } = {}) {
  const resultado = { falha: 0, sucesso: 0 };
  let cfg;
  let pendentes;
  try {
    cfg = repo.getConfig(empresaId, fonteId);
    pendentes = repo.listarParaAvisar(empresaId, fonteId);
  } catch (err) {
    console.error('[IA Service] Jade PA: leitura dos avisos falhou:', err.message);
    return resultado;
  }
  const porTipo = { falha: [], sucesso: [] };
  const semAviso = [];
  for (const exec of pendentes) {
    const tipo = cfg.modo === 'publicar' ? classificar(exec) : 'nenhum';
    if (tipo === null) continue;
    const grupos = tipo === 'falha' ? cfg.gruposAvisoFalha : tipo === 'sucesso' ? cfg.gruposAvisoSucesso : [];
    // Sem aviso (ou sem grupo escolhido): marca, para não sair depois quando alguém ligar o aviso.
    if (tipo === 'nenhum' || !grupos.length) semAviso.push(exec.id);
    else porTipo[tipo].push(exec);
  }
  if (semAviso.length) repo.reservarAviso(semAviso);

  for (const tipo of ['falha', 'sucesso']) {
    const reservados = new Set(repo.reservarAviso(porTipo[tipo].map(e => e.id)));
    const execs = porTipo[tipo].filter(e => reservados.has(e.id));
    if (!execs.length) continue;
    const grupos = tipo === 'falha' ? cfg.gruposAvisoFalha : cfg.gruposAvisoSucesso;
    const nome = tipo === 'falha' ? 'chamados sem PA' : 'chamados com PA';
    let envio = null;
    let erro = null;
    try {
      envio = await _enviarParaGrupos(empresaId, grupos, montarMensagem(empresaId, tipo, execs), tipo);
    } catch (err) {
      erro = err.message;
    }
    if (erro || (envio.total > 0 && envio.enviados === 0)) {
      repo.liberarAviso(execs.map(e => e.id));
      const motivo = erro || (envio.falhas || []).map(f => f.erro).filter(Boolean)[0] || 'nenhum número recebeu';
      console.warn(`[IA Service] Jade PA: aviso de ${nome} não enviado (${motivo}); nova tentativa na próxima leitura.`);
      // Registra só na primeira tentativa, para a auditoria não repetir a cada leitura.
      for (const exec of execs) {
        if (!repo.listarEventos(empresaId, exec.id).some(e => e.etapa === 'aviso')) {
          _registrar(exec, loteId, 'erro', `Aviso por WhatsApp (${nome}) não enviado: ${motivo}. Nova tentativa a cada leitura.`, { tipo: nome });
        }
      }
      continue;
    }
    resultado[tipo] = execs.length;
    const situacao = envio.total === 0 || envio.falhas?.length ? 'aviso' : 'ok';
    const resumo = envio.total === 0
      ? `Aviso por WhatsApp (${nome}) não enviado: os grupos escolhidos não têm números ativos.`
      : `Aviso por WhatsApp (${nome}) enviado a ${envio.enviados} de ${envio.total} número(s).`;
    const detalhes = { tipo: nome, enviados: envio.enviados, total: envio.total, ...(envio.falhas?.length ? { falhas: envio.falhas.map(f => `${f.nome || 'sem nome'}: ${f.erro}`).join('; ') } : {}) };
    for (const exec of execs) _registrar(exec, loteId, situacao, resumo, detalhes);
  }
  return resultado;
}

module.exports = { avisarLote, listarGrupos, classificar, montarMensagem, linhaDoChamado };

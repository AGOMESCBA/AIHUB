// Aviso por WhatsApp ao fim de cada lote da Jaade no Primeiro Atendimento
// (pedido do usuário, 2026-11-20). Duas mensagens, cada uma para os grupos
// escolhidos na tela: os chamados que ficaram SEM PA (alguém precisa agir) e
// os que tiveram PA PELA JADE. O que a triagem atendeu antes da Jaade não entra.
//
// Regra (resultado no SoftExpert, não a intenção da Jaade):
//   - retorno não gravado na grade → falha (inclui texto vencido > 4h);
//   - retorno gravado, mas a devolução ao cliente não chegou ao Retorno do
//     Usuário → falha (o chamado ficou parado no meio do caminho);
//   - retorno gravado (segue no PA) ou gravado e devolvido → sucesso;
//   - triagem assumiu antes da devolução → sucesso (o PA foi da Jaade).
// Modo Simulação envia igual, marcado "🧪 SIMULAÇÃO": a regra é só não integrar
// com o SoftExpert (pedido do usuário, 2026-11-20, para testar o WhatsApp).
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

function _enviarParaGrupos(empresaId, grupoIds, texto, tipo, loteId, simulacao = false) {
  const referencia = [loteId ? `lote #${loteId}` : null, simulacao ? 'simulação' : null].filter(Boolean).join(' · ');
  return _iaCommand('/api/ia-command/whatsapp/enviar-grupo-servico-externo', {
    corpo: { empresaId: Number(empresaId), grupoIds, texto, finalidadeEnvio: `iaservice_jade_pa_${tipo}`, referencia },
  });
}

// Passo que não chega a enviar (Simulação, sem grupo) no histórico do canal
// WhatsApp da empresa (IA Command › WhatsApp Services). Nunca lança.
async function _registrarNoMonitor(empresaId, tipo, mensagem) {
  try {
    await _iaCommand('/api/ia-command/whatsapp/registrar-servico-externo', { corpo: { empresaId: Number(empresaId), tipo, mensagem } });
  } catch (err) {
    console.warn('[IA Service] Jaade PA: registro no monitor do WhatsApp falhou:', err.message);
  }
}

/** 'falha' | 'sucesso' | 'nenhum' (sem aviso) | null (ainda não terminou). */
function classificar(exec) {
  switch (exec.estado) {
    case 'devolvido': return 'sucesso';
    case 'publicado': return exec.alerta ? 'falha' : 'sucesso';
    case 'falha': return 'falha';
    case 'descartado': return exec.motivoCodigo === 'texto_vencido' ? 'falha' : 'nenhum';
    // Simulação só não integra com o SoftExpert: o aviso sai igual, marcado como teste.
    case 'simulado': return 'sucesso';
    default: return null;
  }
}

function _limitar(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * PA gravado na grade, mas a devolução não levou o chamado ao cliente: o
 * retorno da Jaade existe, mas o cliente não foi acionado. Frase fixa
 * combinada com o usuário (2026-11-20); o detalhe fica na auditoria.
 */
function _devolucaoNaoChegou(exec) {
  if (exec.decisao !== 'devolver' || !exec.publicadoEm) return null;
  if (!(exec.estado === 'falha' || (exec.estado === 'publicado' && exec.alerta))) return null;
  return 'PA gravado, mas NÃO transferido p/ o cliente.';
}

// Motivo curto do PA não respondido (é o que a triagem precisa para agir).
function _motivo(exec) {
  const devolucao = _devolucaoNaoChegou(exec);
  if (devolucao) return devolucao;
  if (exec.estado === 'descartado') return 'texto vencido (mais de 4h), não enviado';
  return _limitar(String(exec.ultimoErro || exec.motivo || 'falha sem detalhe').replace(/\s*Chamado deixado para a triagem\.?$/, ''), 140);
}

/**
 * Linha do chamado: "• #037118 · Protheus - Cliente Z". O resultado está no
 * cabeçalho da seção; só o PA não respondido leva o motivo no fim.
 */
function linhaDoChamado(empresaId, exec, tipo) {
  let produto = null;
  let cliente = null;
  try {
    const chamado = chamadoRepo.getChamadoPorNumero(empresaId, exec.numeroChamado, 'softexpert');
    produto = chamado?.produto || null;
    const c = chamado?.clienteId ? clienteRepo.getClientePorId(empresaId, chamado.clienteId) : null;
    cliente = c?.nomeFantasia || c?.nome || null;
  } catch (_) { /* a linha sai mesmo sem os dados do chamado */ }
  const base = `• #${exec.numeroChamado} · ${produto || 'Produto não informado'} - ${cliente || 'Cliente não identificado'}`;
  return tipo === 'falha' ? `${base} — ${_motivo(exec)}` : base;
}

// "Jaade" (J-2A-de, de J2A) é o nome da assistente, não erro de digitação.
function _secao(empresaId, tipo, execs) {
  const linhas = execs.slice(0, MAX_LINHAS).map(e => linhaDoChamado(empresaId, e, tipo));
  if (execs.length > MAX_LINHAS) linhas.push(`… e mais ${execs.length - MAX_LINHAS} chamado(s). Veja na tela da Jaade no PA.`);
  return [
    tipo === 'falha'
      ? `⚠️ Jaade IA - ${execs.length} Chamado(s) - PA Não Respondido`
      : `✅ Jaade IA - ${execs.length} Chamado(s) - PA Respondido`,
    ...linhas,
    ...(tipo === 'falha' ? ['Precisam de atendimento da triagem.'] : []),
  ].join('\n');
}

/** Uma mensagem com as seções pedidas (não respondido primeiro), separadas por linha em branco. */
function montarMensagem(empresaId, { falha = [], sucesso = [] }, { simulacao = false } = {}) {
  const secoes = [];
  if (falha.length) secoes.push(_secao(empresaId, 'falha', falha));
  if (sucesso.length) secoes.push(_secao(empresaId, 'sucesso', sucesso));
  return [
    ...(simulacao ? ['🧪 SIMULAÇÃO'] : []),
    secoes.join('\n\n'),
    ...(simulacao ? ['', 'Simulação: nada foi gravado no SoftExpert.'] : []),
  ].join('\n');
}

/**
 * Destinos do lote: grupo marcado nas duas colunas recebe UMA mensagem com as
 * duas seções; marcado numa só, recebe só a seção dela.
 */
function _destinos(cfg, execs) {
  const gF = execs.falha.length ? cfg.gruposAvisoFalha : [];
  const gS = execs.sucesso.length ? cfg.gruposAvisoSucesso : [];
  const ambos = gF.filter(g => gS.includes(g));
  return [
    { grupos: ambos, tipos: ['falha', 'sucesso'] },
    { grupos: gF.filter(g => !ambos.includes(g)), tipos: ['falha'] },
    { grupos: gS.filter(g => !ambos.includes(g)), tipos: ['sucesso'] },
  ].filter(d => d.grupos.length);
}

function _registrar(exec, loteId, situacao, resumo, detalhes = null) {
  try {
    repo.registrarEvento(exec.id, exec.empresaId, { etapa: 'aviso', situacao, resumo, detalhes, loteId });
  } catch (err) {
    console.error('[IA Service] Jaade PA: registro do aviso falhou:', err.message);
  }
}

/**
 * Fim do lote: avisa os chamados que chegaram ao resultado final. Cada um é
 * avisado uma vez (reserva no banco); se a mensagem não chegou a ninguém, o
 * chamado volta para a próxima leitura tentar de novo. Nunca lança.
 */
// Pior situação entre as mensagens do lote (para destacar na tela).
const _PESO = { info: 0, ok: 1, aviso: 2, erro: 3 };

async function avisarLote(empresaId, fonteId, { loteId = null } = {}) {
  // `mensagens`: o que aconteceu com o WhatsApp nesta leitura, sempre dito na
  // tela (lote e última leitura), inclusive quando nada foi enviado e por quê.
  const resultado = { falha: 0, sucesso: 0, situacao: 'info', mensagens: [] };
  const anotar = (situacao, texto) => {
    resultado.mensagens.push(texto);
    if (_PESO[situacao] > _PESO[resultado.situacao]) resultado.situacao = situacao;
  };
  let cfg;
  let pendentes;
  try {
    cfg = repo.getConfig(empresaId, fonteId);
    pendentes = repo.listarParaAvisar(empresaId, fonteId);
  } catch (err) {
    console.error('[IA Service] Jaade PA: leitura dos avisos falhou:', err.message);
    anotar('erro', `WhatsApp: falha ao preparar o aviso (${err.message}).`);
    return resultado;
  }
  const porTipo = { falha: [], sucesso: [] };
  const semGrupo = { falha: 0, sucesso: 0 };
  const semAviso = [];
  for (const exec of pendentes) {
    const tipo = classificar(exec);
    if (tipo === null) continue;
    const grupos = tipo === 'falha' ? cfg.gruposAvisoFalha : tipo === 'sucesso' ? cfg.gruposAvisoSucesso : [];
    // Sem aviso (ou sem grupo escolhido): marca, para não sair depois quando alguém ligar o aviso.
    if (tipo === 'nenhum' || !grupos.length) {
      semAviso.push(exec.id);
      if (tipo !== 'nenhum') semGrupo[tipo]++;
    } else porTipo[tipo].push(exec);
  }
  if (semAviso.length) repo.reservarAviso(semAviso);

  // Simulação: mesmo aviso, marcado como teste (só não integra com o SoftExpert).
  const simulacao = cfg.modo !== 'publicar';
  const ref = loteId ? ` (lote #${loteId}${simulacao ? ' · simulação' : ''})` : (simulacao ? ' (simulação)' : '');
  for (const tipo of ['falha', 'sucesso']) {
    if (semGrupo[tipo]) {
      const nomeTipo = tipo === 'falha' ? 'PA não respondido' : 'PA respondido';
      anotar('aviso', `WhatsApp (${nomeTipo}): ${semGrupo[tipo]} chamado(s) sem aviso, nenhum grupo escolhido.`);
      await _registrarNoMonitor(empresaId, 'warning', `⚠️ Jaade IA${ref}: ${semGrupo[tipo]} chamado(s) com ${nomeTipo} sem aviso; nenhum grupo escolhido na tela da Jaade.`);
    }
  }
  if (!porTipo.falha.length && !porTipo.sucesso.length && !semGrupo.falha && !semGrupo.sucesso) {
    anotar('info', 'WhatsApp: nenhum chamado concluído para avisar nesta leitura.');
  }

  const execs = {};
  for (const tipo of ['falha', 'sucesso']) {
    const reservados = new Set(repo.reservarAviso(porTipo[tipo].map(e => e.id)));
    execs[tipo] = porTipo[tipo].filter(e => reservados.has(e.id));
  }
  // Uma mensagem por destino (grupo nas duas colunas = as duas seções juntas).
  const envios = [];
  for (const destino of _destinos(cfg, execs)) {
    const secoes = Object.fromEntries(destino.tipos.map(t => [t, execs[t]]));
    const finalidade = destino.tipos.length === 2 ? 'resumo' : destino.tipos[0];
    let envio = null;
    let erro = null;
    try {
      envio = await _enviarParaGrupos(empresaId, destino.grupos, montarMensagem(empresaId, secoes, { simulacao }), finalidade, loteId, simulacao);
    } catch (err) {
      erro = err.message;
    }
    const entregue = !erro && !(envio.total > 0 && envio.enviados === 0);
    envios.push({ ...destino, envio, entregue, motivo: erro || (envio?.falhas || []).map(f => f.erro).filter(Boolean)[0] || 'nenhum número recebeu' });
  }

  for (const tipo of ['falha', 'sucesso']) {
    if (!execs[tipo].length) continue;
    const nome = `${tipo === 'falha' ? 'PA não respondido' : 'PA respondido'}${simulacao ? ', simulação' : ''}`;
    const doTipo = envios.filter(e => e.tipos.includes(tipo));
    const entregues = doTipo.filter(e => e.entregue);
    if (!entregues.length) {
      // Nenhum destino recebeu: volta para a próxima leitura tentar de novo.
      repo.liberarAviso(execs[tipo].map(e => e.id));
      const motivo = doTipo[0]?.motivo || 'nenhum número recebeu';
      console.warn(`[IA Service] Jaade PA: aviso de ${nome} não enviado (${motivo}); nova tentativa na próxima leitura.`);
      anotar('erro', `WhatsApp (${nome}): não enviado, ${motivo}. Nova tentativa na próxima leitura.`);
      // Registra só na primeira tentativa, para a auditoria não repetir a cada leitura.
      for (const exec of execs[tipo]) {
        if (!repo.listarEventos(empresaId, exec.id).some(e => e.etapa === 'aviso')) {
          _registrar(exec, loteId, 'erro', `Aviso por WhatsApp (${nome}) não enviado: ${motivo}. Nova tentativa a cada leitura.`, { tipo: nome });
        }
      }
      continue;
    }
    resultado[tipo] = execs[tipo].length;
    const enviados = entregues.reduce((s, e) => s + e.envio.enviados, 0);
    const total = entregues.reduce((s, e) => s + e.envio.total, 0);
    const falhas = entregues.flatMap(e => e.envio.falhas || []);
    const parcial = entregues.length < doTipo.length;
    const situacao = total === 0 || falhas.length || parcial ? 'aviso' : 'ok';
    const resumo = total === 0
      ? `Aviso por WhatsApp (${nome}) não enviado: os grupos escolhidos não têm números com acesso à empresa.`
      : `Aviso por WhatsApp (${nome}) enviado a ${enviados} de ${total} número(s).${parcial ? ' Parte dos grupos não recebeu.' : ''}`;
    const detalhes = { tipo: nome, enviados, total, ...(falhas.length ? { falhas: falhas.map(f => `${f.nome || 'sem nome'}: ${f.erro}`).join('; ') } : {}) };
    for (const exec of execs[tipo]) _registrar(exec, loteId, situacao, resumo, detalhes);
    anotar(situacao, total === 0
      ? `WhatsApp (${nome}): não enviado, os grupos não têm números com acesso à empresa.`
      : `WhatsApp (${nome}): ${execs[tipo].length} chamado(s) avisado(s), entregue a ${enviados} de ${total} número(s).${parcial ? ' Parte dos grupos não recebeu.' : ''}`);
  }
  return resultado;
}

module.exports = { avisarLote, listarGrupos, classificar, montarMensagem, linhaDoChamado };

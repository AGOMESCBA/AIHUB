'use strict';

// Calcula o SLA e identifica alertas devidos e seus textos para o atendimento.
// Biblioteca pura, sem acesso a banco, rede ou relógio global.

function avaliarSla({ abertaEm, respondida, primeiraRespostaMin, atencaoPct, agoraMs }) {
  if (respondida === true) return null;
  const inicio = Date.parse(abertaEm);
  if (!Number.isFinite(inicio) || !Number.isFinite(agoraMs) || !Number.isFinite(primeiraRespostaMin)
    || primeiraRespostaMin <= 0 || !Number.isFinite(atencaoPct) || atencaoPct < 0 || atencaoPct > 100) return null;
  const duracao = primeiraRespostaMin * 60000;
  const vencimento = inicio + duracao;
  const prazo = new Date(vencimento);
  if (!Number.isFinite(prazo.getTime())) return null;
  return { prazo: prazo.toISOString(), situacao: agoraMs > vencimento ? 'estourado'
    : agoraMs > inicio + duracao * atencaoPct / 100 ? 'atencao' : 'ok' };
}

function alertasDevidos({ conversa, setor, pessoas, jaEnviados, agoraMs, dentroDoHorario }) {
  if (dentroDoHorario !== true) return [];
  const config = setor.alertas || {};
  const disponiveis = pessoas.filter(p => p.status === 'disponivel');
  const naoAusentes = pessoas.filter(p => p.status !== 'ausente');
  const semOnline = !pessoas.some(p => p.online === true);
  const inicio = Date.parse(conversa.aguardando_desde);
  const espera = conversa.na_fila === true && Number.isFinite(inicio) && Number.isFinite(agoraMs)
    ? agoraMs - inicio : null;
  const esperaLonga = espera !== null && Number.isFinite(config.espera_min) && espera > config.espera_min * 60000;
  const escalonou = espera !== null && Number.isFinite(config.escalonar_min) && config.escalonar_min > 0
    && espera > config.escalonar_min * 60000;
  const saida = [];
  const chaves = new Set(jaEnviados);
  function adicionar(tipo, pessoa, via) {
    if (!pessoa || pessoa.status === 'ausente' || !pessoa.id) return;
    if (via === 'whatsapp' && (config.whatsapp_ligado !== true || pessoa.alertas_whatsapp !== true)) return;
    const chave = [conversa.id, tipo, pessoa.id, via].join('|');
    if (chaves.has(chave)) return;
    chaves.add(chave);
    saida.push({ tipo, usuario_id: pessoa.id, via });
  }
  const ofertada = pessoas.find(p => p.id === conversa.oferta?.para?.id);
  if (ofertada) adicionar('oferta', ofertada, 'tela');
  if (conversa.na_fila) {
    for (const pessoa of disponiveis) {
      adicionar('nova_na_fila', pessoa, 'tela');
      if (semOnline) adicionar('nova_na_fila', pessoa, 'whatsapp');
      if (esperaLonga) {
        adicionar('espera_longa', pessoa, 'tela');
        adicionar('espera_longa', pessoa, 'whatsapp');
      }
    }
  }
  if (conversa.sla_situacao === 'estourado') {
    for (const pessoa of disponiveis) adicionar('sla_estourado', pessoa, 'tela');
  }
  if (escalonou) {
    const destinos = config.escalonar_para?.length ? config.escalonar_para : (setor.supervisao || []);
    for (const pessoa of naoAusentes) {
      if (!destinos.includes(pessoa.id)) continue;
      adicionar('escalonamento', pessoa, 'tela');
      adicionar('escalonamento', pessoa, 'whatsapp');
    }
  }
  return saida;
}

function textoDoAlerta({ tipo, protocolo, setorNome, esperaMin, linkPortal }) {
  const descricoes = {
    oferta: 'Conversa oferecida', nova_na_fila: 'Nova conversa na fila',
    espera_longa: 'Conversa aguardando atendimento', sla_estourado: 'SLA de primeira resposta estourado',
    escalonamento: 'Conversa escalonada',
  };
  const descricao = descricoes[tipo] || 'Alerta de atendimento';
  const espera = Number.isFinite(esperaMin) && esperaMin >= 0 ? ' Espera: ' + esperaMin + ' min.' : '';
  const link = linkPortal ? ' Abrir: ' + linkPortal : '';
  return descricao + ' do ' + setorNome + ' (protocolo ' + protocolo + ').' + espera + link;
}

module.exports = { avaliarSla, alertasDevidos, textoDoAlerta };

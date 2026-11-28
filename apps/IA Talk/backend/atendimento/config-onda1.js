'use strict';

// Configuração da Onda 1 do atendimento (docs/contratos.md §9.3–9.10): valores padrão e validação dos
// blocos do setor (menu, distribuição, alertas, SLA, inatividade, pesquisa), da política da empresa
// (padrão que vale para todos os setores) e do menu do canal. Uma regra só, usada pelo servidor real e
// pelo simulado.
//
// Herança (§9.10): cada bloco do setor (menos o menu) segue a política da empresa até ser personalizado;
// a política, por sua vez, parte dos padrões abaixo. Efetivo = padrão ← política ← setor.

const { erro } = require('../erros');

const MIN = 60 * 1000;
const PERGUNTA_PADRAO = 'Como você avalia este atendimento? Responda de 1 (ruim) a 5 (ótimo).';
const SAUDACAO_PADRAO = 'Olá! Para agilizar seu atendimento, escolha o setor:';
const LEMBRETE_PADRAO = 'Ainda precisa de ajuda? Se não recebermos sua resposta, este atendimento será encerrado.';
const ENCERRAMENTO_PADRAO = 'Encerramos este atendimento por falta de retorno. Se precisar, é só mandar uma nova mensagem.';

// Blocos que o setor pode herdar da política da empresa. O menu é sempre do setor.
const BLOCOS_HERDAVEIS = Object.freeze(['distribuicao', 'alertas', 'sla', 'inatividade', 'pesquisa']);

// Valores padrão de cada bloco (§9.3–9.9). Tudo que age sozinho nasce desligado.
function padroesDoSetor(ordem = 1) {
  return {
    menu: { aparece: true, ordem, texto: null },
    distribuicao: { modo: 'fila_livre', limite_por_atendente: 5, tempo_aceite_min: 3 },
    alertas: { whatsapp_ligado: false, espera_min: 5, escalonar_min: 15, escalonar_para: [] },
    sla: {
      primeira_resposta_min: 10, proxima_resposta_min: 0, resolucao_horas: 0, atencao_pct: 80,
      so_horario_setor: true, pausar_aguardando_cliente: true,
      prioridade_alta: { primeira_resposta_min: null, proxima_resposta_min: null, resolucao_horas: null },
    },
    inatividade: {
      ligada: false, lembrete_min: 60, encerrar_min: 240, texto_lembrete: LEMBRETE_PADRAO,
      texto_encerramento: ENCERRAMENTO_PADRAO, enviar_pesquisa: false, reabrir_horas: 24,
    },
    pesquisa: { ligada: false, pergunta: PERGUNTA_PADRAO },
  };
}

const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const bool = (v) => typeof v === 'boolean';
const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const ehObjeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Regras de cada bloco: devolvem a mensagem do primeiro erro ou null.
const REGRAS = {
  menu: (m) => (!bool(m.aparece) ? 'aparece deve ser verdadeiro ou falso.'
    : !inteiro(m.ordem, 0, 999) ? 'ordem de 0 a 999.'
      : m.texto !== null && (typeof m.texto !== 'string' || m.texto.trim().length > 60) ? 'texto até 60 caracteres.' : null),
  distribuicao: (d) => (!['fila_livre', 'rodizio'].includes(d.modo) ? 'modo: fila_livre ou rodizio.'
    : !inteiro(d.limite_por_atendente, 1, 50) ? 'limite por atendente de 1 a 50.'
      : !inteiro(d.tempo_aceite_min, 1, 30) ? 'tempo para aceitar de 1 a 30 minutos.' : null),
  alertas: (a) => (!bool(a.whatsapp_ligado) ? 'whatsapp_ligado deve ser verdadeiro ou falso.'
    : !inteiro(a.espera_min, 1, 120) ? 'espera de 1 a 120 minutos.'
      : !inteiro(a.escalonar_min, 0, 240) ? 'escalonar de 0 a 240 minutos (0 = não escalona).'
        : !Array.isArray(a.escalonar_para) || a.escalonar_para.some(x => typeof x !== 'string') ? 'escalonar_para: lista de usuários.' : null),
  sla: (s) => {
    if (!inteiro(s.primeira_resposta_min, 1, 1440)) return 'primeira resposta de 1 a 1440 minutos.';
    if (!inteiro(s.proxima_resposta_min, 0, 1440)) return 'próxima resposta de 0 a 1440 minutos (0 = não mede).';
    if (!inteiro(s.resolucao_horas, 0, 720)) return 'resolução de 0 a 720 horas (0 = não mede).';
    if (!inteiro(s.atencao_pct, 50, 95)) return 'atenção de 50% a 95% do prazo.';
    if (!bool(s.so_horario_setor) || !bool(s.pausar_aguardando_cliente)) return 'so_horario_setor e pausar_aguardando_cliente: verdadeiro ou falso.';
    const alta = s.prioridade_alta;
    if (!ehObjeto(alta)) return 'prioridade_alta: informe um objeto.';
    if (alta.primeira_resposta_min !== null && !inteiro(alta.primeira_resposta_min, 1, 1440)) return 'prioridade alta: primeira resposta de 1 a 1440 minutos (vazio = igual ao normal).';
    if (alta.proxima_resposta_min !== null && !inteiro(alta.proxima_resposta_min, 0, 1440)) return 'prioridade alta: próxima resposta de 0 a 1440 minutos (vazio = igual ao normal).';
    if (alta.resolucao_horas !== null && !inteiro(alta.resolucao_horas, 0, 720)) return 'prioridade alta: resolução de 0 a 720 horas (vazio = igual ao normal).';
    return null;
  },
  inatividade: (i) => (!bool(i.ligada) ? 'ligada deve ser verdadeiro ou falso.'
    : !inteiro(i.lembrete_min, 0, 10080) ? 'lembrete de 0 a 10080 minutos (0 = sem lembrete).'
      : !inteiro(i.encerrar_min, 5, 10080) ? 'encerrar de 5 a 10080 minutos.'
        : i.lembrete_min > 0 && i.lembrete_min >= i.encerrar_min ? 'o lembrete precisa vir antes do encerramento.'
          : !texto(i.texto_lembrete, 500) || !texto(i.texto_encerramento, 500) ? 'textos de 1 a 500 caracteres.'
            : !bool(i.enviar_pesquisa) ? 'enviar_pesquisa deve ser verdadeiro ou falso.'
              : !inteiro(i.reabrir_horas, 0, 168) ? 'reabrir de 0 a 168 horas (0 = sempre abre conversa nova).' : null),
  pesquisa: (p) => (!bool(p.ligada) ? 'ligada deve ser verdadeiro ou falso.'
    : !texto(p.pergunta, 300) ? 'pergunta de 1 a 300 caracteres.' : null),
};

// Junta um bloco parcial ao atual (prioridade_alta do SLA também é parcial).
function juntar(nome, atual, parcial) {
  const junto = { ...atual, ...parcial };
  // Valor que não é objeto fica como veio e a regra do SLA recusa.
  if (nome === 'sla' && ehObjeto(parcial.prioridade_alta)) junto.prioridade_alta = { ...atual.prioridade_alta, ...parcial.prioridade_alta };
  return junto;
}

// Confere os blocos do pedido. `atual` = valores efetivos de hoje. Devolve { bloco: valores } com só os
// blocos informados; com permitirHerdar, `bloco: null` devolve null (= voltar a seguir a política).
function conferirBlocos(b, atual, nomes, { permitirHerdar = false } = {}) {
  const campos = {};
  const valores = {};
  for (const nome of nomes) {
    if (b[nome] === undefined) continue;
    if (b[nome] === null && permitirHerdar && BLOCOS_HERDAVEIS.includes(nome)) { valores[nome] = null; continue; }
    if (!ehObjeto(b[nome])) { campos[nome] = 'Informe um objeto.'; continue; }
    const junto = juntar(nome, atual[nome], b[nome]);
    const msg = REGRAS[nome](junto);
    if (msg) campos[nome] = msg; else valores[nome] = junto;
  }
  if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
  return valores;
}

// Setor (§9.3–9.10): menu + blocos herdáveis; null = seguir a política da empresa.
function configDoSetor(b = {}, atual = padroesDoSetor()) {
  return conferirBlocos(b, atual, ['menu', ...BLOCOS_HERDAVEIS], { permitirHerdar: true });
}

// Política da empresa (§9.10): os mesmos blocos herdáveis, sempre completos (sem null).
function configDaPolitica(b = {}, atual = politicaPadrao()) {
  return conferirBlocos(b, atual, BLOCOS_HERDAVEIS);
}

function politicaPadrao() {
  const p = padroesDoSetor();
  return Object.fromEntries(BLOCOS_HERDAVEIS.map(n => [n, p[n]]));
}

// Valores efetivos: padrão ← política da empresa ← personalização do setor (blocos gravados como objetos
// parciais ou completos; ausente/null = segue). Devolve também a lista de blocos personalizados.
function efetivoDoSetor({ politica = {}, setor = {}, ordem = 0 } = {}) {
  const p = padroesDoSetor(ordem);
  const efetivo = { menu: { ...p.menu, ...(ehObjeto(setor.menu) ? setor.menu : {}) } };
  const personalizados = [];
  for (const nome of BLOCOS_HERDAVEIS) {
    const daEmpresa = juntar(nome, p[nome], ehObjeto(politica[nome]) ? politica[nome] : {});
    if (ehObjeto(setor[nome])) { efetivo[nome] = juntar(nome, daEmpresa, setor[nome]); personalizados.push(nome); }
    else efetivo[nome] = daEmpresa;
  }
  return { ...efetivo, personalizados };
}

// Menu no canal (§9.3): campos menu_* do PUT /canais/:id.
function configDoMenuDoCanal(b = {}, atual = { ligado: false, saudacao: SAUDACAO_PADRAO, tempo_min: 10, tentativas: 2 }) {
  const campos = {};
  const novo = { ...atual };
  if (b.menu_ligado !== undefined) { if (!bool(b.menu_ligado)) campos.menu_ligado = 'Verdadeiro ou falso.'; else novo.ligado = b.menu_ligado; }
  if (b.menu_saudacao !== undefined) {
    const t = String(b.menu_saudacao || '').trim();
    if (t.length > 500) campos.menu_saudacao = 'Até 500 caracteres.'; else novo.saudacao = t || SAUDACAO_PADRAO;
  }
  if (b.menu_tempo_min !== undefined) { if (!inteiro(b.menu_tempo_min, 1, 60)) campos.menu_tempo_min = 'De 1 a 60 minutos.'; else novo.tempo_min = b.menu_tempo_min; }
  if (b.menu_tentativas !== undefined) { if (!inteiro(b.menu_tentativas, 1, 5)) campos.menu_tentativas = 'De 1 a 5 tentativas.'; else novo.tentativas = b.menu_tentativas; }
  if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
  return novo;
}

// SLA da primeira resposta (§9.6) no simulado: null quando já respondida ou fora do atendimento.
// O servidor real calcula os três prazos com horário e pausa (C19).
function slaDaConversa(cv, setor, respondida, agoraMs = Date.now()) {
  if (cv.situacao !== 'aberta' || cv.triagem || respondida || !setor?.sla) return null;
  const inicio = Date.parse(cv.aberta_em);
  const prazoMs = setor.sla.primeira_resposta_min * MIN;
  const passou = agoraMs - inicio;
  const situacao = passou >= prazoMs ? 'estourado' : passou >= prazoMs * setor.sla.atencao_pct / 100 ? 'atencao' : 'ok';
  return { prazo: new Date(inicio + prazoMs).toISOString(), situacao, alvo: 'primeira_resposta', restante_min: Math.ceil((prazoMs - passou) / MIN) };
}

module.exports = {
  padroesDoSetor, politicaPadrao, configDoSetor, configDaPolitica, efetivoDoSetor, configDoMenuDoCanal, slaDaConversa,
  BLOCOS_HERDAVEIS, PERGUNTA_PADRAO, SAUDACAO_PADRAO, LEMBRETE_PADRAO, ENCERRAMENTO_PADRAO, inteiro, bool,
};

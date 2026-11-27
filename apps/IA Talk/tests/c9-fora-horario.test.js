'use strict';

// C9 §8.6 — aviso de fora do horário: uma resposta automática por conversa a cada 12 h,
// só com a mensagem do setor ligada e respeitando as regras de envio do canal (lib L1).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { Atendimento } = require('../backend/atendimento/servico');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const CLIENTE = '5565999981001';
const TEXTO = 'Atendemos de segunda a sexta, das 8h às 18h. Sua mensagem ficou registrada.';

function montar({ envio = 'teste', foraLigado = true, dentroAgora = false } = {}) {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  const emp = novoId('empresa');
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  // Horário que nunca inclui "agora" (ou sempre inclui): um intervalo só, num dia da semana escolhido.
  const hojeCuiaba = new Date(Date.now() - 4 * 3600 * 1000).getUTCDay();
  const horario = dentroAgora
    ? { ligado: true, fuso: 'America/Cuiaba', dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, inicio: '00:00', fim: '23:59' })) }
    : { ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: (hojeCuiaba + 3) % 7, inicio: '08:00', fim: '09:00' }] };
  const setor = novoId('setor');
  db.prepare('INSERT INTO setores (id, empresa_id, codigo, nome, horario, fora_horario, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(setor, emp, 'suporte', 'Suporte', JSON.stringify(horario), JSON.stringify({ ligado: foraLigado, texto: TEXTO }), t, t);
  const canal = novoId('canal');
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em,
      envio_modo, recebimento_modo, numeros_teste, uso, atendimento_empresa_id, setor_padrao_id)
    VALUES (?, ?, 'J2A', '5565900000000', 'wweb', 'conectado', ?, 1, 's1', ?, ?, ?, 'todos', ?, 'atendimento', ?, ?)`)
    .run(canal, emp, t, t, t, envio, JSON.stringify([CLIENTE]), emp, setor);
  const atendimento = new Atendimento({ db });
  const chega = (texto, em = new Date().toISOString()) => atendimento.receber(canal, { id_provedor: novoId('mensagem'), de: { tipo: 'telefone', valor: CLIENTE }, tipo: 'texto', texto, em });
  const automaticas = () => db.prepare("SELECT conteudo FROM mensagens WHERE origem = 'automatica'").all().map(r => r.conteudo);
  return { db, chega, automaticas };
}

test('fora do horário: uma resposta automática por conversa a cada 12 h', () => {
  const { db, chega, automaticas } = montar();
  chega('Bom dia');
  assert.deepEqual(automaticas(), [TEXTO]);
  chega('Alguém?');
  assert.deepEqual(automaticas(), [TEXTO], 'segunda mensagem na janela de 12 h: não repete');
  // 13 h depois: avisa de novo.
  db.prepare('UPDATE conversas SET ultimo_aviso_fora_horario_em = ?').run(new Date(Date.now() - 13 * 3600 * 1000).toISOString());
  chega('Voltei');
  assert.equal(automaticas().length, 2);
  const item = db.prepare("SELECT autor_tipo, texto FROM conversa_itens WHERE categoria = 'mensagem' AND direcao = 'saida' ORDER BY rowid LIMIT 1").get();
  assert.deepEqual(item, { autor_tipo: 'sistema', texto: TEXTO }, 'aparece na conversa como do sistema');
});

test('não avisa: dentro do horário, mensagem desligada (padrão) ou envio desligado no canal', () => {
  const dentro = montar({ dentroAgora: true });
  dentro.chega('oi');
  assert.deepEqual(dentro.automaticas(), [], 'dentro do horário');
  const desligada = montar({ foraLigado: false });
  desligada.chega('oi');
  assert.deepEqual(desligada.automaticas(), []);
  const semEnvio = montar({ envio: 'desligado' });
  semEnvio.chega('oi');
  assert.deepEqual(semEnvio.automaticas(), [], 'regras do canal valem também para o automático');
  assert.equal(semEnvio.db.prepare('SELECT ultimo_aviso_fora_horario_em AS v FROM conversas').get().v, null, 'sem envio, a janela não é gasta');
});

test('validação do setor usa a mesma regra da biblioteca L1', () => {
  const { validarHorario } = require('../backend/atendimento/servico');
  assert.equal(validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '08:00', fim: '12:00' }, { dia: 1, inicio: '13:00', fim: '18:00' }] }), null, 'dois intervalos no dia');
  assert.ok(validarHorario({ ligado: true, fuso: 'Fuso/Inexistente', dias: [{ dia: 1, inicio: '08:00', fim: '12:00' }] }), 'fuso inválido');
  assert.ok(validarHorario({ ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '08:00', fim: '12:00' }, { dia: 1, inicio: '11:00', fim: '13:00' }] }), 'sobreposição');
});

'use strict';

// Processo filho de UM canal (mesma ideia do worker por canal do IA Command):
// se o WhatsApp/Chrome travar, só este processo cai; o Talk segue no ar e o
// supervisor decide se sobe de novo. Conversa com o supervisor por IPC.
//
// Recebe:  { cmd: 'iniciar', canal: { id, sessao_id, provedor }, dirSessoes }
//          { cmd: 'parar' } · { cmd: 'limpar-sessao' } · { cmd: 'desvincular' } · { cmd: 'enviar', id, envelope }
//          (testes) { cmd: 'simular-leitura', dados?: { numero } } · { cmd: 'simular-mensagem', dados }
//                   { cmd: 'simular-falha', dados: { tipo } }  (próximo envio falha: temporario|permanente|desconhecido)
// Envia:   { evento: 'estado'|'qr'|'identidade'|'mensagem'|'status'|'log'|'enviado'|'parado'|'erro', dados }

const { ProvedorSimulado } = require('../provedores/simulado');

let provedor = null;
const enviar = (evento, dados) => { if (process.connected) process.send({ evento, dados }); };
const log = (tipo, mensagem) => enviar('log', { tipo, mensagem });

function criarProvedor(canal, dirSessoes) {
  // Só os testes automáticos forçam o simulado; em produção vale o provedor do canal.
  if (process.env.IA_TALK_PROVEDOR_FORCADO === 'simulado') return new ProvedorSimulado({ canal, log });
  if (canal.provedor === 'wweb') {
    const { ProvedorWweb } = require('../provedores/wweb');
    return new ProvedorWweb({ canal, dirSessoes, log });
  }
  throw new Error(`Provedor ${canal.provedor} ainda não disponível.`);
}

async function tratar(m) {
  try {
    if (m.cmd === 'iniciar') {
      provedor = criarProvedor(m.canal, m.dirSessoes);
      for (const ev of ['estado', 'qr', 'identidade', 'mensagem', 'status']) provedor.on(ev, (dados) => enviar(ev, dados));
      await provedor.iniciar();
    } else if (m.cmd === 'parar') {
      if (provedor) await provedor.parar();
      enviar('parado', {});
      setTimeout(() => process.exit(0), 200);
    } else if (m.cmd === 'desvincular') {
      // QR lido pelo número errado: sai do WhatsApp (o aparelho some do celular) e apaga a sessão.
      if (provedor?.desvincular) await provedor.desvincular();
      else { if (provedor) await provedor.parar(); provedor?.limparSessao?.(); }
      enviar('parado', { sessao_limpa: true });
      setTimeout(() => process.exit(0), 200);
    } else if (m.cmd === 'limpar-sessao') {
      if (provedor) await provedor.parar();
      provedor?.limparSessao?.();
      enviar('parado', { sessao_limpa: true });
      setTimeout(() => process.exit(0), 200);
    } else if (m.cmd === 'enviar') {
      try {
        const env = m.envelope;
        if (env.arquivo?.base64) env.arquivo = { ...env.arquivo, dados: Buffer.from(env.arquivo.base64, 'base64'), base64: undefined };
        enviar('enviado', { id: m.id, ok: true, ...(await provedor.enviar(env)) });
      } catch (err) {
        // Recusa antes de sair (validação, recurso não suportado) = permanente; o resto, como o provedor disse.
        const tipo = err.tipo || (err.codigo && err.status < 500 ? 'permanente' : 'desconhecido');
        enviar('enviado', { id: m.id, ok: false, tipo, codigo: err.codigo, mensagem: err.message });
      }
    } else if (m.cmd === 'simular-falha' && provedor) {
      provedor.falhar = m.dados?.tipo || 'temporario';
    } else if (m.cmd === 'simular-leitura' && provedor?.simularLeituraQr) {
      provedor.simularLeituraQr();
      enviar('identidade', { numero: m.dados?.numero || '5565900000000' });
    } else if (m.cmd === 'simular-mensagem' && provedor?.simularRecebimento) {
      provedor.simularRecebimento(m.dados);
    }
  } catch (err) {
    enviar('erro', { mensagem: err.message });
  }
}

process.on('message', (m) => { tratar(m); });
// Supervisor sumiu (Talk parado ou caiu): encerra o WhatsApp deste canal junto.
process.on('disconnect', async () => {
  try { if (provedor) await provedor.parar(); } catch (_) { /* saindo */ }
  process.exit(0);
});
process.on('uncaughtException', (err) => { enviar('erro', { mensagem: err.message }); process.exit(1); });
process.on('unhandledRejection', (err) => { enviar('erro', { mensagem: String(err?.message || err) }); });

// Garante que erro retornado pelo Agente Local nao seja tratado como consulta vazia.
// Executar: node "apps/IA Service/tests/agente-local-provider-status-erro.test.js"

const assert = require('assert');
const http = require('http');
const provider = require('../backend/services/agente-local-provider');

function criarServidor(resposta) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== '/execute') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resposta));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const serverErro = await criarServidor({
    status: 'erro',
    erro: "Conexao 'softexpert_chamados' nao encontrada para a empresa 1.",
    rows: [],
    origem_conexao: 'conexao_nao_encontrada',
  });
  try {
    const porta = serverErro.address().port;
    await assert.rejects(
      () => provider.executarSelect(`http://127.0.0.1:${porta}`, 'token', {
        sql: 'SELECT COUNT(*) AS total FROM DYNITSM',
        limit: 5,
        connectionKey: 'softexpert_chamados',
        empresaId: 1,
      }),
      /softexpert_chamados.*conexao_nao_encontrada/i,
      'status=erro do agente deve virar excecao, nao rows vazias'
    );
  } finally {
    await new Promise(resolve => serverErro.close(resolve));
  }

  const serverOk = await criarServidor({ status: 'ok', rows: [{ total: 42 }] });
  try {
    const porta = serverOk.address().port;
    const rows = await provider.executarSelect(`http://127.0.0.1:${porta}`, 'token', {
      sql: 'SELECT COUNT(*) AS total FROM DYNITSM',
      limit: 5,
      connectionKey: 'softexpert_chamados',
      empresaId: 1,
    });
    assert.deepStrictEqual(rows, [{ total: 42 }]);
  } finally {
    await new Promise(resolve => serverOk.close(resolve));
  }

  console.log('agente-local-provider-status-erro.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

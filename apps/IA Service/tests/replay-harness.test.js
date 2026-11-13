// Fase 1 (2026-11-12): o replay do motor (tests/replay/) roda com IA simulada
// e confere as garantias do próprio replay — não mede qualidade do modelo.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

const runner = require('./replay/replay-runner');
const { criarIASimulada } = require('./replay/ia-simulada');
const { agregar } = require('./replay/agregador');
const { carregarCasos } = require('./replay/executar-replay');

const PLATFORM_DB = path.resolve(__dirname, '../../IAHUB/data/iahub-platform.db');
const ANEXOS_DIR = path.resolve(__dirname, '../data/anexos');

const CASO = {
  id: 'teste-harness',
  conjunto: 'teste',
  titulo: 'Caso mínimo do teste do replay',
  abertura: 'Erro ao gerar documento de saida no faturamento: MARCADOR-PROPRIO-123',
  marcadoresProibidos: ['MARCADOR-PROPRIO-123'],
  outraEmpresa: { marcador: 'MARCADOR-OUTRA-EMPRESA-999', atendimento: 'MARCADOR-OUTRA-EMPRESA-999 segredo' },
  fontes: [{ id: 'F1', titulo: 'Documento de saída', url: 'https://tdn.totvs.com/replay/teste', oficial: true, aplicavel: 'APLICAVEL', palavras: ['documento saida'], conteudo: 'Conteúdo congelado.' }],
  turnos: [
    { tipo: 'mensagem', texto: 'Pesquise uma solução para esse erro de documento de saida.', anexos: [{ nome: 'log.txt', conteudo: 'linha de log' }], esperado: { acao: ['INVESTIGAR'], pontosEssenciais: [] } },
    { tipo: 'botao', esperado: { acao: ['INVESTIGAR'], pontosEssenciais: [] } },
  ],
};

function _mtime(arquivo) {
  try { return fs.statSync(arquivo).mtimeMs; } catch { return null; }
}

test('replay simulado: sem rede, sem tocar Platform/anexos reais, com medições e detector de vazamento', async () => {
  const requisicoes = [];
  const [httpsReq, httpReq] = [https.request, http.request];
  https.request = (...a) => { requisicoes.push(a[0]); return httpsReq(...a); };
  http.request = (...a) => { requisicoes.push(a[0]); return httpReq(...a); };
  const platformAntes = _mtime(PLATFORM_DB);
  const anexosAntes = fs.existsSync(ANEXOS_DIR) ? fs.readdirSync(ANEXOS_DIR).length : 0;
  const env4B = process.env.IA_SERVICE_DISCIPLINA_4B;
  try {
    const chamarIA = criarIASimulada({ vazarTexto: 'MARCADOR-PROPRIO-123' });
    const com = await runner.executarCaso(CASO, { modelo: 'simulado', chave: 'simulado', chamarIA, disciplina4B: true });
    const sem = await runner.executarCaso(CASO, { modelo: 'simulado', chave: 'simulado', chamarIA, disciplina4B: false });

    assert.equal(requisicoes.length, 0, 'replay simulado não pode abrir conexão de rede');
    assert.equal(_mtime(PLATFORM_DB), platformAntes, 'banco da Platform não pode ser alterado');
    assert.equal(fs.existsSync(ANEXOS_DIR) ? fs.readdirSync(ANEXOS_DIR).length : 0, anexosAntes, 'nada gravado na pasta real de anexos');
    assert.equal(process.env.IA_SERVICE_DISCIPLINA_4B, env4B, 'flag 4B restaurada');

    for (const exec of [com, sem]) {
      assert.equal(exec.turnos.length, 2);
      assert.ok(exec.turnos.every(t => !t.erro && t.resposta), 'todos os turnos respondidos');
      assert.ok(exec.turnos.every(t => t.chamadasIA.some(c => c.finalidade === 'resposta_principal')));
      assert.ok(exec.turnos.every(t => t.chamadasIA.every(c => typeof c.tokensEntrada === 'number')));
      // Pedido explícito e botão pesquisam; a fonte congelada é lida.
      assert.ok(exec.turnos.every(t => t.pesquisa.devePesquisar === true));
      assert.ok(exec.turnos.some(t => t.pesquisa.paginasLidas.includes('https://tdn.totvs.com/replay/teste')));
      // O detector acusa o marcador próprio (ecoado pela IA simulada) e nunca o da outra empresa.
      assert.equal(exec.seguranca.vazou, true);
      assert.ok(exec.seguranca.achados.every(a => a.marcador === 'MARCADOR-PROPRIO-123'));
    }
    assert.equal(com.disciplina4B, true);
    assert.equal(sem.disciplina4B, false);
    assert.ok(com.turnos.every(t => t.pesquisa.disciplinaModo4B === true));
    assert.ok(sem.turnos.every(t => t.pesquisa.disciplinaModo4B === false));

    const { porCaso, porVariante } = agregar([CASO], [com, sem]);
    assert.equal(porCaso.length, 2);
    assert.ok(porVariante.com4B && porVariante.sem4B);
    assert.equal(porCaso[0].metricas.turnos.media, 2);
  } finally {
    https.request = httpsReq;
    http.request = httpReq;
  }
});

test('casos do replay: válidos, novos e separados em desenvolvimento/validação', () => {
  const casos = carregarCasos({ conjunto: 'todos' });
  const ids = new Set();
  const dev = casos.filter(c => c.conjunto === 'desenvolvimento').length;
  assert.ok(casos.length >= 20 && casos.length <= 40);
  assert.ok(dev / casos.length >= 0.65 && dev / casos.length <= 0.75, 'divisão ~70/30');
  const antigos = fs.readdirSync(path.join(__dirname, 'benchmark/cases/development'))
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark/cases/development', f), 'utf8')).cases || []);
  const textosAntigos = antigos.map(c => JSON.stringify(c));
  for (const caso of casos) {
    assert.ok(!ids.has(caso.id), `id repetido: ${caso.id}`);
    ids.add(caso.id);
    assert.ok(caso.abertura && caso.turnos.length, caso.id);
    for (const t of caso.turnos) assert.ok(t.esperado && Array.isArray(t.esperado.acao) && t.esperado.acao.length, `${caso.id}: esperado por turno`);
    for (const f of caso.fontes || []) assert.ok(['APLICAVEL', 'POTENCIAL', 'RELACIONADO', 'NAO_APLICAVEL'].includes(f.aplicavel), `${caso.id}/${f.id}`);
    // Termos a que a disciplina 4B foi ajustada não aparecem nos casos novos.
    assert.ok(!/X5_FILIAL|customersTimeoutMs|U_VALPED|withTimeout\(5000\)/i.test(JSON.stringify(caso)), `${caso.id} reutiliza termo do benchmark antigo`);
    assert.ok(!textosAntigos.some(t => t.includes(caso.abertura.slice(0, 60))), `${caso.id} copia caso antigo`);
  }
});

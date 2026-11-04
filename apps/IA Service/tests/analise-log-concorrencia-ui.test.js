'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {}, AbortController, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/j2a/assets/analise-logs.js'), 'utf8'), sandbox);
const proto = sandbox.window.AnaliseLogs.prototype;
function pendente() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function tela() {
  const elementos = new Map();
  const contexto = { empresa: 1, chamadoId: 'A' };
  const ui = Object.create(proto);
  Object.assign(ui, {
    ocupado: false, versaoAnalise: 0, opcoes: { contexto: () => contexto },
    el: id => {
      if (!elementos.has(id)) elementos.set(id, { value: '', textContent: '', scrollIntoView() {}, replaceChildren() {} });
      return elementos.get(id);
    },
    limparResultado() {}, renderizar(r) { this.exibido = r; }, status(s) { this.mensagem = s; },
  });
  return { ui, contexto };
}
test('ao abrir dois históricos a resposta atrasada não substitui a última escolha', async () => {
  const { ui } = tela(); const a = pendente(); const b = pendente();
  ui.request = url => url.endsWith('/A') ? a.promise : b.promise;
  const primeiro = ui.abrirSalva('A'); const segundo = ui.abrirSalva('B');
  b.resolve({ origem: { tipo: 'avulso' }, escolhido: 'B' }); await segundo;
  a.resolve({ origem: { tipo: 'avulso' }, escolhido: 'A' }); await primeiro;
  assert.equal(ui.exibido.escolhido, 'B');
});
test('erro tardio do histórico de outra empresa não aparece na empresa atual', async () => {
  const { ui, contexto } = tela(); const consulta = pendente(); ui.request = () => consulta.promise;
  const tarefa = ui.carregarHistorico(); contexto.empresa = 2;
  ui.el('historico-lista').textContent = 'Histórico da empresa atual';
  consulta.reject(new Error('Erro da empresa anterior')); await tarefa;
  assert.equal(ui.el('historico-lista').textContent, 'Histórico da empresa atual');
});
test('erro de pesquisa anterior não sobrescreve o estado de uma nova pesquisa', async () => {
  const { ui } = tela(); const consulta = pendente(); ui.request = () => consulta.promise;
  ui.fonteAnalise = { caminho: '/radar/logs/avulso', opts: {} };
  ui.el('busca').value = 'erro antigo';
  const tarefa = ui.buscarArquivo();
  ui.el('busca').value = 'outro erro'; ui.buscaController = new AbortController();
  ui.el('busca-status').textContent = 'Procurando novo termo…';
  consulta.reject(new Error('Falha da busca anterior')); await tarefa;
  assert.equal(ui.el('busca-status').textContent, 'Procurando novo termo…');
});

test('trocar de chamado na mesma empresa preserva a análise em execução', () => {
  const { ui } = tela(); let abortou = false;
  ui.empresaAtual = 1; ui.ocupado = true; ui.versaoLista = 0;
  ui.controller = { abort() { abortou = true; } };
  ui.contextChanged();
  assert.equal(abortou, false);
  assert.equal(ui.ocupado, true);
  assert.equal(ui.versaoAnalise, 0);
});

test('trocar de empresa exige reset antes de continuar qualquer acompanhamento', () => {
  const { ui } = tela(); let limpou = false;
  ui.empresaAtual = 2; ui.ocupado = true;
  ui.reset = () => { limpou = true; };
  ui.contextChanged();
  assert.equal(limpou, true);
});

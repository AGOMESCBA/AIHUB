'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const cache = require(path.join(ROOT, 'modules/whatsapp/whatsapp-query-cache'));

const EMPRESA_TESTE = -9991;
const SENDER_TESTE = '5599999999999@c.us_teste_cache';

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_query_cache WHERE empresa_id = ?').run(EMPRESA_TESTE);
}

limpar();

// 1. salvar + obter último resultado tabular
const id1 = cache.salvarResultadoTabular({
  empresaId: EMPRESA_TESTE,
  sender: SENDER_TESTE,
  pergunta: 'faturamento por cliente',
  rows: [{ cliente: 'A', faturamento: 100 }, { cliente: 'B', faturamento: 200 }],
  intent: { periodo: { tipo: 'mes_atual' }, filtros: { uf: 'SP' }, agrupar_por: 'cliente' },
  resumoTexto: 'resumo teste',
});
assert(id1, 'salvarResultadoTabular deve retornar um id');

const ultimo = cache.obterUltimoResultadoTabular({ empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
assert(ultimo, 'obterUltimoResultadoTabular deve retornar o resultado salvo');
assert.strictEqual(ultimo.rows.length, 2, 'deve retornar as 2 rows salvas');
assert.strictEqual(ultimo.rowsCount, 2);
assert.strictEqual(ultimo.pergunta, 'faturamento por cliente');
assert.strictEqual(ultimo.agruparPor, 'cliente');
assert.deepStrictEqual(ultimo.periodo, { tipo: 'mes_atual' });

// 2. obterPorId busca o registro certo mesmo com um mais recente salvo depois
const id2 = cache.salvarResultadoTabular({
  empresaId: EMPRESA_TESTE,
  sender: SENDER_TESTE,
  pergunta: 'faturamento por produto',
  rows: [{ produto: 'X', faturamento: 50 }],
  intent: { agrupar_por: 'produto' },
});
assert(id2 && id2 !== id1, 'segundo salvamento deve gerar id diferente');

const porId1 = cache.obterPorId({ empresaId: EMPRESA_TESTE, id: id1 });
assert(porId1, 'obterPorId deve encontrar o registro antigo pelo id explicito');
assert.strictEqual(porId1.pergunta, 'faturamento por cliente', 'obterPorId nao deve retornar o mais recente por engano');

const maisRecente = cache.obterUltimoResultadoTabular({ empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
assert.strictEqual(maisRecente.pergunta, 'faturamento por produto', 'ultimo resultado deve ser o mais recente');

// 3. isolamento por empresa — outra empresa não enxerga o cache
const outraEmpresa = cache.obterUltimoResultadoTabular({ empresaId: EMPRESA_TESTE + 1, sender: SENDER_TESTE });
assert.strictEqual(outraEmpresa, null, 'cache nao deve vazar entre empresas diferentes');

// 4. rows vazias não persistem
const idVazio = cache.salvarResultadoTabular({ empresaId: EMPRESA_TESTE, sender: SENDER_TESTE, rows: [] });
assert.strictEqual(idVazio, null, 'nao deve salvar quando rows esta vazio');

// 5. TTL expirado retorna null — simula registro antigo via UPDATE direto
const idExpirado = cache.salvarResultadoTabular({
  empresaId: EMPRESA_TESTE,
  sender: SENDER_TESTE,
  rows: [{ x: 1 }],
});
const dataAntiga = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h atrás, TTL é 30min
getDB().prepare('UPDATE whatsapp_query_cache SET criado_em = ? WHERE id = ?').run(dataAntiga, idExpirado);
const porIdExpirado = cache.obterPorId({ empresaId: EMPRESA_TESTE, id: idExpirado });
assert.strictEqual(porIdExpirado, null, 'registro expirado (fora do TTL) nao deve ser retornado por obterPorId');

// 6. limparExpirados remove registros antigos sem afetar recentes
cache.limparExpirados();
const aindaExisteExpirado = getDB().prepare('SELECT id FROM whatsapp_query_cache WHERE id = ?').get(idExpirado);
assert.strictEqual(aindaExisteExpirado, undefined, 'limparExpirados deve remover registros fora do TTL');
const aindaExisteRecente = cache.obterUltimoResultadoTabular({ empresaId: EMPRESA_TESTE, sender: SENDER_TESTE });
assert(aindaExisteRecente, 'limparExpirados nao deve remover registros dentro do TTL');

limpar();
console.log('whatsapp-query-cache.test.js: ok');

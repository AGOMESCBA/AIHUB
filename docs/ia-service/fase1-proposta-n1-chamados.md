# Proposta (não implementada): consulta de posicionamentos em lote em `listarChamadosRelacionados`

Data: 2026-11-12 · Fase 1, item 6 · Status: **proposta, aguardando decisão**

## Situação atual

`apps/IA Service/backend/repositories/chamado-repository.js:432` `listarChamadosRelacionados`:

1. Uma consulta busca até 1.200 chamados da empresa (`ORDER BY data_abertura DESC LIMIT 1200`).
2. Para **cada** candidato, `listarPosicionamentosDoChamado(empresaId, candidato.id)` (`:455`) faz mais uma consulta. São até 1.201 consultas por turno de investigação.
3. Os posicionamentos alimentam `_textoBuscaChamado` (assunto, descrição, resultado, situação, tipo, motivo) e os 8 últimos vão no resultado (`posicionamentos.slice(-8)`).

## Medição (banco local, somente leitura, empresa 1: 1.200 candidatos, 6.113 posicionamentos)

| Rodada | 1.200 consultas (atual) | 1 consulta (proposta) |
|---|---|---|
| 1ª (cache frio) | 195 ms | 87 ms |
| 2ª | 21 ms | 25 ms |
| 3ª | 25 ms | 29 ms |

**Leitura honesta:** no SQLite (embutido no processo, comando preparado), o N+1 é barato. Com o cache aquecido, a consulta única não ganha nada. O ganho aparece só no primeiro acesso, em torno de 100 ms. Não é um problema de desempenho relevante hoje.

O que pesa mais é o limite de 1.200: os 473 chamados mais antigos (28% da base local) nunca são considerados. Se a janela for ampliada (Fase 5), o número de consultas cresce junto, e aí a consulta em lote passa a valer a pena.

**Recomendação:** não implementar isoladamente agora. Fazer junto com a decisão da Fase 5 sobre a janela e o ranking. Se você preferir fazer já, o risco é baixo e a proposta está abaixo.

## Proposta

Uma consulta para todos os candidatos, agrupada em memória. O resultado é idêntico porque a ordem por chamado é a mesma e o desempate é explícito.

```js
function _posicionamentosPorChamado(db, empresaId, chamadoIds) {
  const porChamado = new Map(chamadoIds.map(id => [id, []]));
  // Lotes de 500: o limite de parâmetros do SQLite (999 em builds antigos).
  for (let i = 0; i < chamadoIds.length; i += 500) {
    const lote = chamadoIds.slice(i, i + 500);
    const rows = db.prepare(`
      SELECT * FROM posicionamentos
       WHERE empresa_id = ? AND chamado_id IN (${lote.map(() => '?').join(',')})
       ORDER BY chamado_id, data_posicionamento ASC, rowid ASC
    `).all(Number(empresaId), ...lote);
    for (const row of rows) porChamado.get(row.chamado_id).push(_posicionamentoParaDominio(row));
  }
  return porChamado;
}
```

Em `listarChamadosRelacionados`, trocar a consulta dentro do laço por `const mapa = _posicionamentosPorChamado(db, empresaId, rows.map(r => r.id))` antes do laço e `mapa.get(candidato.id) || []` dentro dele. O isolamento é preservado: `empresa_id = ?` continua no `WHERE`, e os IDs vêm da consulta já filtrada por empresa.

Ponto de atenção: a consulta atual ordena só por `data_posicionamento`. Com duas datas iguais no mesmo chamado, a ordem hoje depende do índice. A proposta desempata por `rowid`, e a função atual precisa receber o mesmo desempate para o teste de identidade valer. Isso pode mudar quais 8 posicionamentos aparecem em casos de empate. Eu verificaria quantos empates existem antes de aplicar.

## Teste de resultado idêntico

Arquivo novo `apps/IA Service/tests/chamados-relacionados-lote.test.js`:

1. Banco temporário com 2 empresas. Na empresa A: 30 chamados com posicionamentos, incluindo um chamado com 2 posicionamentos na mesma data, um sem posicionamentos e um com mais de 8. Na empresa B: chamados com os mesmos termos.
2. Calcula `listarChamadosRelacionados` com a implementação antiga (preservada no teste como referência) e com a nova, para 3 textos de contexto diferentes e `limite` 5 e 20.
3. `assert.deepStrictEqual` do resultado completo: chamado, score, motivos, `temSolucaoAplicada` e posicionamentos (ordem e conteúdo).
4. Nenhum chamado ou posicionamento da empresa B aparece no resultado da empresa A.
5. Conta as consultas preparadas (`db.prepare` instrumentado): antes, 1 + N; depois, 1 + ⌈N/500⌉.

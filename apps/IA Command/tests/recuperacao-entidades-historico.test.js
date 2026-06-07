'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));
const svc = new WhatsAppService();

const joaoLopes = {
  tipo: 'fornecedor', rotuloTipo: 'fornecedor', tabelaBase: 'SA2',
  codigo: '000022', loja: '01', nome: 'JOAO EDUARDO LOPES OKAJIMA',
  joinHint: 'SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA',
};
const joaoSilva = {
  tipo: 'fornecedor', rotuloTipo: 'fornecedor', tabelaBase: 'SA2',
  codigo: '000716', loja: '01', nome: 'JOAO EDUARDO SILVA NETO',
  joinHint: 'SE2.E2_FORNECE = SA2.A2_COD AND SE2.E2_LOJA = SA2.A2_LOJA',
};

// ── helpers ───────────────────────────────────────────────────────────────────
function turno(filtros, entidades) {
  return {
    turno: 1, pergunta: 'teste',
    filtros: filtros || null,
    entidades_resolvidas: entidades || null,
  };
}

// 1. Sem histórico → retorna vazio
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico({ fornecedor: 'Joao Eduardo' }, []),
  [], '1: historico vazio => []'
);

// 2. Filtros vazios → retorna vazio
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico({}, [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]),
  [], '2: filtros vazios => []'
);

// 3. Nenhum turno bate os filtros → retorna vazio
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { fornecedor: 'Silva Ltda' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]
  ),
  [], '3: filtro diferente => []'
);

// 4. Filtro corresponde exatamente → retorna entidades
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { fornecedor: 'Joao Eduardo' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]
  ),
  [joaoLopes], '4: correspondencia exata'
);

// 5. Case-insensitive
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { fornecedor: 'joao eduardo' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]
  ),
  [joaoLopes], '5: case-insensitive'
);

// 6. Substring parcial NÃO deve corresponder (evitar falso positivo)
// "Joao Eduardo Silva" !== "Joao Eduardo"
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { fornecedor: 'Joao Eduardo Silva' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]
  ),
  [], '6: substring parcial nao deve casar'
);

// 7. Busca do mais recente para o mais antigo (retorna o mais novo que bate)
const historicoMisto = [
  turno({ fornecedor: 'Joao Eduardo' }, [joaoSilva]),  // mais antigo
  turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes]),  // mais recente
];
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico({ fornecedor: 'Joao Eduardo' }, historicoMisto),
  [joaoLopes], '7: retorna o turno mais recente que bate'
);

// 8. Turno sem entidades é ignorado, retorna o mais recente com entidades
const historicoComVazio = [
  turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes]),  // antigo, tem entidades
  turno({ fornecedor: 'Joao Eduardo' }, null),          // recente, sem entidades
];
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico({ fornecedor: 'Joao Eduardo' }, historicoComVazio),
  [joaoLopes], '8: pula turnos sem entidades'
);

// 9. Cenário do bug: turno intermediário sem fornecedor não interfere na recuperação
// Sequência: [CAP Joao Eduardo (com entidade), CAP em aberto (sem fornecedor)]
// Atual: "Detalhe por dia" com filtros herdados {fornecedor: "Joao Eduardo"}
const historicoBug = [
  turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes]),   // turno 1: fornecedor resolvido
  turno(null, null),                                     // turno 2: CAP em aberto sem filtros
];
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico({ fornecedor: 'Joao Eduardo' }, historicoBug),
  [joaoLopes], '9: cenario do bug - turno intermediario sem entidades nao impede recuperacao'
);

// 10. Chave de filtro diferente (cliente vs fornecedor) não deve retornar
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { cliente: 'Joao Eduardo' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]
  ),
  [], '10: chave de filtro diferente nao casa'
);

// 11. Múltiplos filtros: todos devem corresponder
const clienteEntidade = { tipo: 'cliente', codigo: '000001', nome: 'JOAO EDUARDO' };
assert.deepStrictEqual(
  svc._recuperarEntidadesDoHistorico(
    { fornecedor: 'Joao Eduardo', filial: '01' },
    [turno({ fornecedor: 'Joao Eduardo' }, [joaoLopes])]  // não tem filial no histórico
  ),
  [], '11: multiplos filtros - falta um nao casa'
);

console.log('recuperacao-entidades-historico.test.js: ok');

'use strict';

const assert = require('assert');

const router = require('../modules/ai/conversational-turn-router');
const externalInfo = require('../modules/ai/external-info-service');
const accessSummary = require('../modules/whatsapp/access-summary');

assert.deepStrictEqual(router.rotear('Quais modulos eu tenho acesso?'), { tipo: 'acessos' });
assert.deepStrictEqual(router.rotear('quais sistemas estao liberados para mim?'), { tipo: 'acessos' });

assert.strictEqual(router.rotear('valor do dolar hoje').categoria, 'cambio');
assert.strictEqual(router.rotear('quanto esta o bitcoin?').categoria, 'cripto');
assert.strictEqual(router.rotear('temperatura hoje em Manaus').categoria, 'clima');
assert.strictEqual(router.rotear('preco da saca de soja pelo CEPEA').categoria, 'agro');
assert.strictEqual(router.rotear('preco da saca de soja pelo CEPEA').fontePreferida, 'cepea');
assert.strictEqual(router.rotear('arroba do boi pela Noticias Agricolas').categoria, 'agro');
assert.strictEqual(router.rotear('arroba do boi na Noticias Agricolas').fontePreferida, 'noticias_agricolas');

assert.deepStrictEqual(router.rotear('agora por cliente'), { tipo: 'nenhum' });
assert.deepStrictEqual(router.rotear('sem a Caieira'), { tipo: 'nenhum' });
assert.deepStrictEqual(router.rotear('faturamento de ontem'), { tipo: 'nenhum' });
assert.deepStrictEqual(router.rotear('compras por fornecedor'), { tipo: 'nenhum' });

const respostaFonteAlternativa = externalInfo._internals.formatarResposta({
  titulo: 'Soja',
  valor: 'R$ 153,06/sc',
  fonte: 'CEPEA/ESALQ',
  fonteId: 'cepea',
  dataInformacao: '01/09/2026, 09:30',
  consultadoEm: '07/09/2026, 14:32',
}, { fontePreferida: 'noticias_agricolas' }, []);
assert.ok(respostaFonteAlternativa.includes('Nao consegui acessar automaticamente a fonte solicitada agora'));
assert.ok(respostaFonteAlternativa.includes('Fonte usada: CEPEA/ESALQ'));

const textoAcessos = accessSummary.formatarAcessos([
  {
    empresaNome: 'Caieira',
    sistemas: [
      { sistema: 'Protheus', modulos: ['Faturamento', 'Financeiro'] },
      { sistema: 'SoftExpert', modulos: ['Chamados'] },
    ],
  },
]);
assert.ok(textoAcessos.includes('*Caieira*'));
assert.ok(textoAcessos.includes('Protheus: Faturamento, Financeiro'));
assert.ok(textoAcessos.includes('SoftExpert: Chamados'));

console.log('conversational-turn-router ok');

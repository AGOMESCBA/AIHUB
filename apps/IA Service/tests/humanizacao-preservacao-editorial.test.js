'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analisarPreservacao } = require('../backend/services/validacao-preservacao-service');
const humanizador = require('../backend/services/resposta-humanizada-service');
const gate = require('../backend/services/quality-gate-service');

const pedido = 'O cliente solicita detalhes da rotina ROTINA01, nos pontos PE_A, PE_B e PE_C.\n\nAinda não temos evidências das customizações. Solicite ao cliente:\n1. Descrição das alterações.\n2. Funções adicionadas.\n3. Documentação ou código envolvido.';
const direto = 'Ainda faltam evidências das customizações de ROTINA01, nos pontos PE_A, PE_B e PE_C. Peça ao cliente a descrição das alterações, as funções adicionadas e a documentação ou código envolvido.';
function aprova(a, b) { const r = analisarPreservacao(a, b); assert.equal(r.aprovado, true, JSON.stringify(r.falhas)); }
// Gate mínimo (2026-10-19): mudança de sentido detectada por heurística não
// bloqueia; fica registrada como aviso na auditoria.
function detecta(a, b, codigo) {
  const r = analisarPreservacao(a, b);
  assert.equal(r.aprovado, true, JSON.stringify(r.falhas));
  assert.ok((r.avisos || []).some(f => f.codigo === codigo), JSON.stringify(r.avisos));
}
function rejeita(a, b, codigo) {
  const r = analisarPreservacao(a, b);
  assert.equal(r.aprovado, false);
  assert.ok(r.falhas.some(f => f.codigo === codigo), JSON.stringify(r.falhas));
}

test('numeração editorial pode desaparecer e itens podem virar prosa concisa', () => aprova(pedido, direto));
test('referências, valores e pontos de entrada continuam obrigatórios', () => {
  rejeita('O arquivo corrigido calculo.py precisa de validação.', 'O arquivo corrigido calculo.ts precisa de validação.', 'REFERENCIA_TECNICA_REMOVIDA');
  rejeita(pedido, direto.replace('PE_B', 'PE_D'), 'REFERENCIA_TECNICA_REMOVIDA');
  rejeita('O erro 400 ocorre na rotina ROTINA01.', 'A rotina ROTINA01 apresenta o erro 401.', 'REFERENCIA_TECNICA_NOVA');
});
test('ressalvas e hipóteses podem mudar de redação mantendo significado', () => {
  aprova('É possível que a configuração de XML esteja diferente. Verifique os parâmetros da filial 02.',
    'Talvez a configuração de XML esteja diferente. Confira os parâmetros da filial 02.');
  aprova('Não temos evidências das customizações. Solicite o código ao cliente.',
    'Ainda faltam evidências das customizações. Peça o código ao cliente.');
});
test('ausência de erro pode ser comunicada como funcionamento normal', () => {
  aprova('O erro de XML não ocorre na filial 01.', 'Na filial 01, a rotina de XML funciona normalmente.');
});
test('acompanhamento e ressalvas podem ser redistribuídos no parágrafo', () => {
  aprova('Continue aguardando o retorno do fornecedor. Essa pendência é crucial para a resolução do problema.',
    'Continue aguardando o retorno do fornecedor. Essa resposta é importante para resolvermos a situação.');
  aprova('Essas ações podem ajudar a resolver o erro.', 'Essas ações vão ajudar e, quem sabe, resolver o erro.');
});
test('[opção A: bloqueia] pedido não pode virar evidência de ação concluída', () => {
  rejeita(pedido, direto.replace('Peça ao cliente a descrição das alterações, as funções adicionadas e a documentação ou código envolvido.',
    'Foi feita a descrição das alterações e foram adicionadas as funções. A documentação e o código já foram enviados pelo cliente.'), 'ESTADO_OU_CERTEZA_ALTERADO');
});
test('[gate mínimo: aviso] ação já realizada não pode voltar a ser solicitada pela humanização', () => {
  detecta('Os ajustes já foram feitos.', 'Realize os ajustes.', 'ACAO_REALIZADA_PERDIDA');
  detecta('Os ajustes já foram feitos. Solicite os logs.', 'Realize os ajustes. Solicite os logs.', 'ACAO_REALIZADA_PERDIDA');
  aprova('Já foram feitas tentativas de correção e ajustes nas regras, mas o erro persiste.',
    'Já tentamos corrigir com ajustes nas regras, mas o erro ainda não foi resolvido.');
});

test('descrição de funções solicitada em lista não equivale a dados já entregues', () => {
  aprova('Solicite ao cliente:\n1. Funções específicas que foram adicionadas ou modificadas.',
    'Peça ao cliente as funções específicas que foram adicionadas ou modificadas.');
});
test('[opção A: bloqueia] hipótese não pode virar causa ou resolução confirmada', () => {
  rejeita('A configuração pode causar o erro de XML.', 'A configuração foi confirmada como causa do erro de XML.', 'ESTADO_OU_CERTEZA_ALTERADO');
  rejeita('O erro não foi resolvido.', 'O erro foi resolvido.', 'ESTADO_OU_CERTEZA_ALTERADO');
});
test('[gate mínimo: aviso] próxima ação necessária não pode desaparecer em uma descrição passiva', () => {
  detecta('Obtenha os logs completos do serviço.', 'Os logs completos do serviço são relevantes.', 'ACAO_ESSENCIAL_OMITIDA');
});
test('[gate mínimo: aviso] não aceita nova solução sem correspondência com a resposta técnica', () => {
  detecta('Solicite o log do serviço.', 'Solicite o log do serviço. Desabilite o antivírus e reinicie o servidor.', 'AFIRMACAO_SEM_LASTRO');
});
test('[opção A: bloqueia] não aceita diagnóstico confirmado novo mesmo reutilizando palavras do original', () => {
  rejeita('Solicite o log para analisar o erro.', 'O log confirma que o erro é causado pela configuração.', 'ESTADO_OU_CERTEZA_ALTERADO');
});
test('código continua literal e ambiente não pode ser trocado', () => {
  rejeita('Execute em homologação.\n```sql\nSELECT CAMPO FROM TABELA;\n```',
    'Execute em produção.\n```sql\nDELETE FROM TABELA;\n```', 'CODIGO_OU_COMANDO_ALTERADO');
});
test('prosa não é escondida do modelo apenas por conter pendência ou ressalva', () => {
  const r = humanizador.proteger('A hipótese ainda não foi confirmada. Aguardamos retorno do fornecedor.');
  assert.equal(r.trechos.length, 0);
  assert.ok(r.protegido.includes('hipótese'));
});
test('gate não exige validar de novo uma correção apenas mencionada como histórica', () => {
  const r = gate.avaliarResposta({ textoResposta: 'Os ajustes já foram feitos. O erro persiste e aguardamos o retorno do fornecedor.', manifesto: {} });
  assert.equal(r.falhas.some(f => f.codigo === 'CORRECTION_WITHOUT_VALIDATION'), false);
});
test('gate mantém exigência de validação para uma nova correção prescrita', () => {
  const r = gate.avaliarResposta({ textoResposta: 'Ajuste a rotina e aplique a correção no fonte.', manifesto: {} });
  const falha = r.falhas.find(f => f.codigo === 'CORRECTION_WITHOUT_VALIDATION');
  assert.ok(falha);
  assert.ok(falha.evidencia.includes('Ajuste a rotina'));
  const comIntroducao = gate.avaliarResposta({ textoResposta: 'Para corrigir o erro, ajuste a configuração.', manifesto: {} });
  assert.ok(comIntroducao.falhas.some(f => f.codigo === 'CORRECTION_WITHOUT_VALIDATION'));
});
test('gate mantém a proteção de imagem citada genericamente, com evidência identificável', () => {
  const r = gate.avaliarResposta({ textoResposta: 'As imagens mostram o problema. Verifique a configuração.',
    manifesto: { selecionados: [{ id: 'img-1', nome: 'captura.png', tipo: 'imagem', status: 'ANALISADA' }], anexosDisponiveis: 1 } });
  const falha = r.falhas.find(f => f.codigo === 'VISUAL_EVIDENCE_TOO_GENERIC');
  assert.ok(falha);
  assert.equal(falha.evidencia, 'captura.png');
});

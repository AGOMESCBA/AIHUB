'use strict';

// Casos escritos para regressão local. Não contêm fontes de cliente,
// respostas de providers, logs, configurações ou dados de homologação real.
const arquivo = 'ValidacaoSintetica.prw';
const rotina = 'ValidaReferencia';
const guarda = [
  '    If !Empty(cUser)',
  '        DbSelectArea("CAD_TESTE")',
  '        CAD_TESTE->(DbSetOrder(1))',
  '',
  '        If !CAD_TESTE->(MsSeek(cUser))',
  '            ConOut("Codigo nao encontrado em CAD_TESTE.")',
  '            lRet := .F.',
  '        ElseIf Type("M->ZZ_DESCR") != "U"',
  '            M->ZZ_DESCR := "Referencia de teste"',
  '        EndIf',
  '    EndIf',
].join('\n');
const fonteOriginal = [
  `User Function ${rotina}()`,
  '    Local aArea := FWGetArea()',
  '    Local cUser := M->ZZ_REFER',
  '    Local lRet  := .T.',
  '', guarda, '',
  '    FWRestArea(aArea)',
  '', 'Return lRet', '',
  'Static Function ReferenciaAuxiliar()',
  '    Local cDescricao := "Acentuação sintética preservada"',
  'Return cDescricao', '',
].join('\n');
const guardaComRetornoFalso = guarda.replace('        EndIf\n    EndIf', '        EndIf\n    Else\n        lRet := .F.\n    EndIf');
const guardaComSaidaAntecipada = [
  '    If Empty(cUser)', '        Return .F.', '    EndIf', '',
  ...guarda.split('\n').slice(1, -1).map(l => l.startsWith('    ') ? l.slice(4) : l),
].join('\n');
function resposta(diagnostico, original, substituto, justificativa) {
  return [
    '**Diagnóstico**', diagnostico,
    '**Correção proposta**', 'Correção proposta para validação, sem compilação garantida.',
    '**Fonte corrigido**', '```iahub-alteracao', `arquivo: ${arquivo}`,
    `justificativa: ${justificativa}`, '[[ORIGINAL]]', original,
    '[[SUBSTITUTO]]', substituto, '[[FIM]]', '```',
    '**Validação**', 'Compilar e testar em homologação com código vazio, válido e inexistente. Conferir o retorno e a restauração do contexto.',
  ].join('\n');
}
const pedidoNovaRegra = `Na função ${rotina}, mantenha a proteção existente do MsSeek. Quando cUser estiver vazio, a função deve retornar .F., preservando os demais comportamentos e FWRestArea(aArea).`;

module.exports = {
  arquivo, rotina, fonteOriginal,
  cenarios: [
    {
      pedido: `A função ${rotina} executa MsSeek mesmo com cUser vazio. Corrija a suposta ausência de proteção somente se o fonte confirmar essa premissa.`,
      // Indentação deliberadamente errada: a prova semântica deve preceder
      // o erro técnico da âncora, sem afrouxar a correspondência exata.
      resposta: resposta(`Na função ${rotina}, MsSeek é executado sem proteção quando cUser está vazio.`,
        guarda.split('\n').map(l => l ? '    ' + l : l).join('\n'),
        guardaComRetornoFalso, 'Impede MsSeek com cUser vazio.'),
    },
    {
      pedido: pedidoNovaRegra,
      resposta: resposta('A guarda impede MsSeek com cUser vazio, mas lRet permanece .T. nesse caminho. A nova regra exige .F..',
        guarda, guardaComRetornoFalso, 'Rejeita cUser vazio preservando os demais caminhos.'),
      // Parecer propositalmente errado do provider SIMULADO. A prova local
      // precisa dispensá-lo, em vez de aceitar uma contradição inventada.
      verificador: JSON.stringify({ status: 'contradicao', motivo: 'A guarda já rejeita o valor vazio.', evidencia: 'If !Empty(cUser)' }),
    },
  ],
  saidaAntecipada: {
    resposta: resposta('O caminho vazio mantém lRet como .T.; a proposta altera o retorno para .F..',
      guarda, guardaComSaidaAntecipada, 'Retorna falso para cUser vazio.'),
  },
};

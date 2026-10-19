O ambiente já foi atualizado (pacotes, biblioteca e repositório de objetos, conforme mensagens de 03/03 e 04/03) e o sintoma persistiu: o cliente testou em 07/03 e confirmou "o documento de entrada não foi criado". A hipótese de "ambiente desatualizado" já foi testada e descartada, então não faz sentido voltar a ela.

Situação atual:

- A rotina de devolução da NF 000001234 (empresa 900, filial 01, série 01) não gera o documento de entrada. Foi testado pelo "Retornar" e manualmente (mensagem de 26/02), sem mensagem de erro/help na tela (mensagem do cliente de 24/02 — "ao confirmar, a tela fecha e nada acontece").
- Após a atualização, o comportamento é o mesmo (mensagem de 07/03 do cliente e do analista).
- O analista registrou em 07/03 que "os logs dos testes foram coletados para análise", mas esses logs não estão anexados neste atendimento. Sem eles, qualquer causa apontada agora é hipótese, não diagnóstico.

Hipóteses abertas para o sintoma "a tela fecha e nada acontece" (rotina que executa sem retorno de erro visível):

- a exceção pode ser engolida em algum ponto de entrada ou customização;
- a rotina pode terminar com `Return` antes de gravar o SD1 e gerar o documento;
- pode haver validação silenciosa (TES, natureza, série ou consistência da NF origem) que aborta sem `MsgStop`.

O que fazer agora: esta é a primeira verificação objetiva, porque separa dois caminhos completamente diferentes.

1. Consultar SD1 (e SD2) para empresa 900/filial 01, buscando o documento que deveria ter sido gerado pela devolução da NF 000001234 (D1_DOC/D1_SERIE/D1_FORNECE/D1_LOJA referenciando o cliente da NF de saída). Em Protheus, a devolução normalmente passa pela rotina de Documento de Entrada (SIGACOM) e grava em SD1/SD2.
   - Se não existe registro, a rotina aborta antes de gravar: investigar o ponto de entrada da inclusão do documento de entrada (conhecimento técnico/hipótese a validar: pontos de entrada tipo `MT103FIM`/`MT103OK` ou equivalente, além de `MT103ANT`/`MATA103` se o fluxo passar por lá). Não há certeza do nome exato sem ver a versão, então confirmar no dicionário/help da rotina.
   - Se existe registro em SD1 mas não aparece como documento válido, o problema é posterior à gravação (fechamento, TES, natureza, integração fiscal).
2. Em paralelo, olhar o log que o analista coletou em 07/03: é a evidência mais específica que existe hoje e não está no chamado. Sem ele, ficamos no campo da hipótese.

Pesquisa externa: as consultas retornaram apenas páginas genéricas do SIGACOM (uma delas com erro 403), sem conteúdo técnico aplicável à devolução. O link de artigo citado pelo próprio analista em 28/02 (central de ajuda do fabricante — "Como incluir um documento de entrada de devolução") é a referência oficial mais próxima do caso, mas o procedimento descrito ali já foi tentado (manual, com tipo da nota "Devolução", TES e produto informados) e também não gerou documento, então não é falta de seguir o passo a passo.

O que falta para sair da hipótese e chegar em causa provável:

- O log gerado nos testes de 07/03 (o analista disse que pegou — anexar aqui).
- Confirmação se existe ou não registro em SD1/SD2 para a devolução da 000001234 (empresa 900, filial 01): isso define se o problema é pré-gravação ou pós-gravação.
- Se houver customização no fluxo de Documento de Entrada / devolução (ponto de entrada, user function, gatilho), o fonte correspondente; sem ele não é possível apontar onde a rotina pode estar abortando silenciosamente.
- Versão exata do Protheus após a atualização, para não sugerir rotina/ponto de entrada de versão diferente.

Não há proposta de alteração de código nem de ajuste de parâmetro agora: sem fonte nem log anexados, qualquer correção seria invenção. O próximo passo técnico concreto é anexar o log de 07/03 e verificar SD1/SD2 da devolução; com isso será possível dizer se a falha está na gravação do documento de entrada ou na etapa seguinte, e então apontar a rotina ou ponto de entrada a revisar.

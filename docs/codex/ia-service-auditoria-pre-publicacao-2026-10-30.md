# IA Service — auditoria antes da publicação

> Parecer histórico. A investigação e a implementação continuaram; consulte a [evolução da pesquisa e do diálogo](ia-service-evolucao-pesquisa-dialogo-2026-10-30.md) para o estado mais recente, validações e limites.

Data: 30/10/2026. Escopo: resposta original, continuidade de conversa e regressões da retirada da Objetiva. Nenhuma publicação ou alteração em dados/configurações de produção.

## Conclusão

**Não homologado como solução completa para qualidade e interação do chat.** As verificações automatizadas passaram após as correções locais, mas a avaliação qualitativa com o modelo configurado (`gpt-4o`) ainda mostrou respostas genéricas e orientações inadequadas.

## Problemas reproduzidos e corrigidos localmente

1. **Pergunta escondida na interface legada.** A ficha operacional resumia a resposta e recolhia a análise completa em `details`. Isso escondia a pergunta necessária à continuidade. Agora o texto disponível é mostrado integralmente, com a validação da solução preservada; a ficha permanece como compatibilidade para registros sem texto. O teste visual falhou antes e passou depois.
2. **Contexto técnico inicial descartado por falta de mensagem atual.** O planejador e o atalho semântico tratavam a chamada sem texto atual como ausência de material, apesar de existir erro técnico no histórico. Corrigido especificamente para primeiro contato com sinais concretos, sem pesquisas/respostas/testes anteriores. Cortesias, memória de testes, produto isolado e pendência externa continuam dispensando a busca. Isso não demonstra que esse seja o único caminho responsável pela dispensa na execução de produção do #036914.
3. **Limpeza podia remover uma pergunta como fecho genérico.** Respostas com interrogação agora ficam integrais. A limpeza de listas repetidas em respostas sem perguntas continua coberta por testes.
4. **Instruções conflitantes de formato e prioridade.** O prompt ainda exigia seções de laudo, apesar da orientação de conversa. Retirado o template obrigatório, preservadas as regras de alteração ancorada e validação. A mensagem atual passou para o final do contexto, depois das instruções, para não ser eclipsada por regras gerais posteriores.

Uma asserção antiga exigia literalmente escolher uma causa e limitar alternativas em qualquer situação. Foi aposentada por contradizer a decisão de perguntar quando faltar evidência. Não era um teste comportamental da geração do modelo. A continuidade segue coberta pela integração e pela homologação real abaixo.

## Homologação real e impedimento restante

Foram executadas duas rodadas de três turnos, mantendo o mesmo provedor/modelo e o print fornecido pelo usuário. Respostas seguintes foram **fixtures de teste**, não novos fatos sobre o chamado real:

1. Pedido de análise do print.
2. Informação de que o fonte não está disponível e o problema começou após compilação.
3. Informação de que a recompilação em homologação já foi tentada, sem resolver.

O teste usou o montador real de contexto e o cliente real do provedor. O SQLite do atendimento ficou em memória. A configuração foi consultada por uma instância explicitamente somente leitura, sem inicialização de schema. Não foram executadas importações, gravações no produto, geração de fonte ou pesquisa web nessa homologação. Assim, ela avalia contexto + geração e **não** equivale a uma execução completa do produto nem ao resultado de uma pesquisa oficial.

Na primeira rodada, a IA repetiu extensamente a resposta anterior, solicitou `APLIB190.PRW` e voltou a recomendar recompilação após a fixture informar que ela não resolveu. A segunda rodada identificou melhor `M185GRV.PRW`, mas ainda sugeriu revisão de biblioteca, verificações de caminho/permissão do arquivo e patches sem fundamentação suficiente. Também não converteu consistentemente a falta de fonte/log em um pedido específico ao usuário.

**A retirada da Objetiva não resolve esses problemas técnicos e conversacionais.** O contexto ainda envia histórico e quadros investigativos dentro de um único conteúdo de usuário. Separar a conversa pelos papéis e avaliar a interferência dos quadros são próximos candidatos de investigação; ainda não há evidência para atribuir o problema exclusivamente a essa montagem ou ao modelo.

Evidências locais:

- `tmp/auditoria-dialogo-modelo-real-antes.json`: primeira rodada.
- `tmp/auditoria-dialogo-modelo-real.json`: segunda rodada.
- `tmp/auditoria-dialogo-prompt-1.txt` a `prompt-3.txt`: contexto enviado na segunda rodada.
- `tmp/auditoria-dialogo-modelo-real.cjs`: harness reproduzível. Exige configuração e imagem locais; não pertence ao pacote de produção.

## Verificações automatizadas

Lotes com sobreposição; não somar como testes únicos:

| Lote | Resultado | Log local |
|---|---|---|
| Correções de UI, limpeza e pesquisa inicial | 18 aprovados | `tmp/auditoria-dialogo-correcoes.log` |
| Pesquisa, consultas e pendências (inclui caso adicional de memória de teste) | 34 aprovados | `tmp/auditoria-dialogo-regressao-pesquisa.log` |
| Integração de fontes, histórico, perguntas e revisão pelo gate | 38 aprovados | `tmp/auditoria-dialogo-integracao.log` |
| Contexto, tentativas anteriores, dossiê, fontes e instruções | 30 aprovados | `tmp/auditoria-dialogo-contexto-fontes.log` |

As falhas de reprodução anteriores estão preservadas em `tmp/auditoria-dialogo-pesquisa-antes.log` e `tmp/auditoria-dialogo-ui-antes.log`. Sintaxe e diff foram revisados. As limitações previamente conhecidas do Quality Gate não foram convertidas em aprovação semântica: contagem de referências técnicas não prova correção do diagnóstico.

## Recomendação de publicação

Manter a versão local até uma nova homologação qualitativa demonstrar os critérios essenciais: identificar a mensagem principal, solicitar o material correto, responder à informação nova e não repetir testes já fracassados sem uma diferença concreta. A retirada editorial e os ajustes de apresentação podem ser avaliados separadamente, mas não devem ser anunciados como resolução do problema de investigação do #036914.

# IA Service — proposta da aba Análise de Logs

Data: 03/11/2026.

Status: proposta autorizada para desenvolvimento. A implementação inicial está registrada ao final; as seções de proposta preservam a intenção funcional original.

## Objetivo

Permitir que usuários e analistas compreendam arquivos `error.log` do ERP Protheus sem precisar interpretar todo o conteúdo técnico. A ferramenta deve destacar os erros, explicar as evidências e apresentar possíveis soluções e formas de validação.

## Preservação do chat

O chat atual deve continuar exatamente como funciona hoje. A nova análise terá interface e acionamento próprios, sem alterar o fluxo de conversa, as respostas, os prompts ou o comportamento atual de envio de anexos.

Abrir a aba não deve iniciar uma análise, enviar mensagem no chat nem alterar o chamado. A análise começa quando o usuário seleciona um arquivo e aciona “Analisar”.

## Localização proposta

Criar uma aba chamada **Análise de Logs** junto à navegação do atendimento. A posição e a apresentação exatas dependem da inspeção da interface atual e dos padrões de design do projeto.

A análise avulsa também precisa estar acessível sem um atendimento selecionado. Se a navegação atual depender obrigatoriamente da seleção de um chamado, será necessário definir um acesso à mesma tela fora desse contexto.

## Logs do atendimento selecionado

Ao abrir a aba com um chamado selecionado, o sistema deve utilizar esse contexto automaticamente, sem exigir que o usuário selecione o chamado novamente.

A tela deve apresentar os arquivos `.log` disponíveis nas duas origens:

- Anexos do chamado no SoftExpert, enviados por usuários ou analistas.
- Anexos da conversa do atendimento no IA Service.

Cada item deve identificar nome do arquivo, origem e data disponível no sistema. Tamanho e autor podem ser exibidos quando essas informações existirem. A análise deve permitir selecionar um arquivo por vez na primeira versão.

Arquivos com nomes iguais devem continuar distinguíveis por sua origem e identificação. Não presumir que nomes iguais representam conteúdo igual nem que o arquivo mais recente contém o incidente desejado.

Ao trocar de chamado, a lista deve acompanhar a nova seleção. Um resultado já aberto deve continuar identificado pelo chamado e arquivo de origem; respostas pendentes de uma seleção anterior não podem aparecer como resultado do novo chamado.

Se não houver logs, informar isso e oferecer o envio de arquivo avulso. Se houver falha ao consultar uma origem, informar a indisponibilidade sem apresentar a lista como completa. O mecanismo de consulta e eventual sincronização com o SoftExpert será definido após verificar a integração atual.

## Análise avulsa

A mesma tela deve oferecer a opção **Anexar log avulso**, disponível com ou sem chamado selecionado.

O usuário envia o arquivo e solicita a análise. Esse uso não exige criar um chamado e não vincula automaticamente o arquivo ou o resultado ao atendimento que eventualmente esteja aberto.

A tela deve identificar explicitamente o contexto como “Análise avulsa”. A política de armazenamento e histórico permanece pendente de decisão; esta proposta não autoriza mudanças em persistência.

## Apresentação do resultado

O resultado deve começar com um resumo em linguagem simples, indicando os problemas identificados, as ocorrências agrupadas e a prioridade sugerida quando houver evidências para defini-la.

Para cada problema, apresentar:

| Informação | Conteúdo esperado |
|---|---|
| O que aconteceu | Explicação compreensível para usuários e analistas. |
| Onde ocorreu | Data, horário, rotina, arquivo e linha do fonte, quando presentes. |
| Ocorrências | Quantidade e localização das ocorrências agrupadas. |
| Evidências | Trechos originais com números de linha do log. |
| Causa provável | Hipóteses fundamentadas, separadas dos fatos comprovados. |
| Possíveis soluções | Ações sugeridas, pré-requisitos e indicação de quem deve executá-las. |
| Como validar | Verificações para confirmar ou descartar a hipótese e avaliar a correção. |
| Informações faltantes | Dados necessários para avançar quando o log não permitir concluir. |

As linhas do arquivo de log e a linha do código-fonte mencionada pelo Protheus são referências diferentes e devem aparecer identificadas como tal.

Ocorrências equivalentes devem ser agrupadas sem esconder diferenças relevantes de rotina, contexto ou mensagem. Incidentes diferentes devem permanecer separados. A causa de um incidente não pode ser atribuída aos demais sem evidência.

Se nenhum erro for reconhecido, informar que a análise não identificou erros nos padrões e conteúdo examinados, sem afirmar que o ambiente está livre de problemas.

## Arquivos grandes e confiabilidade

O processamento deve percorrer todo o arquivo aceito, localizar os blocos de erro e preservar seu contexto. Não é suficiente enviar apenas o início do arquivo à IA.

A leitura integral para localizar ocorrências não significa que todo o conteúdo precisa ser enviado de uma só vez ao modelo. A estratégia de seleção de evidências, divisão em blocos e consolidação será definida na análise técnica.

O relatório deve informar a cobertura da análise e eventuais limites, trechos não processados ou falhas de leitura. Números de linha devem corresponder ao arquivo original, inclusive quando a análise utilizar blocos separados.

Recomendações devem se apoiar nas evidências disponíveis. Quando necessário, solicitar fonte da rotina, versão do ambiente, contexto da operação ou outras informações, sem inventar valores ausentes. A ferramenta sugere ações; não executa correções no ERP, no banco ou no SoftExpert.

## Impacto previsto e investigação necessária

A implementação deverá envolver uma interface própria, a seleção dos anexos existentes e um processamento específico de logs, mantendo o fluxo atual do chat preservado.

Antes de alterar código, verificar:

1. Navegação atual e padrões de `.claude/DESIGN.md`, inclusive acesso sem chamado.
2. Identificação do atendimento selecionado e integração entre frontend, rotas e `index.js`.
3. Listagem, disponibilidade e leitura dos anexos do chat e do SoftExpert.
4. Limites de upload, encoding, extração e truncamento de texto, utilizando o original para análise quando necessário.
5. Integração de IA existente, tamanho de contexto, duração e custo de análise de arquivos grandes.
6. Reutilização dos controles existentes de acesso por empresa e atendimento, inclusive na análise avulsa.
7. Necessidade de novas estruturas de persistência e política de retenção, antes de propor qualquer escrita.

Esses pontos são itens de investigação, não afirmações de que os mecanismos atuais já atendem ao novo fluxo.

## Escopo inicial e decisões pendentes

A primeira versão proposta contempla a aba, a listagem de logs do chamado selecionado, o upload avulso e o relatório de um arquivo por análise. Não inclui comparação entre logs, execução automática de soluções ou alterações no chat.

Ainda devem ser definidos na proposta técnica: posição final do acesso, limites operacionais, necessidade de processamento em segundo plano, exportação do relatório e armazenamento dos arquivos e resultados. Histórico de análises foi sugerido, mas não deve ser tratado como decisão aprovada.

## Critérios de aceite

- O chat mantém o funcionamento atual.
- A aba usa automaticamente o chamado selecionado e distingue as origens dos arquivos.
- O usuário consegue analisar um arquivo avulso sem criar ou alterar chamado.
- Um erro localizado no final de um arquivo grande é encontrado dentro dos limites declarados.
- Erros diferentes são separados e repetições são agrupadas com rastreabilidade.
- As evidências apontam para linhas verificáveis do arquivo original.
- O relatório distingue fatos, hipóteses e informações ausentes.
- Falhas e limitações de processamento ficam visíveis.
- A troca de chamado não mistura arquivos ou resultados entre atendimentos.
- A análise respeita os controles de acesso existentes.

As verificações da implementação devem cobrir esses comportamentos e a regressão do fluxo atual do chat.

## Implementação inicial

Implementada em 03/11/2026, no código local, sem publicação:

- J2A: acesso em **Mais → Análise de Logs**, para preservar a navegação existente no celular.
- Radar interno e versão externa anterior: nova aba **Análise de Logs**.
- Lista obtida a partir do chamado selecionado, usando a mesma referência de atendimento adotada pelo radar atual.
- Identificação dos anexos do chat, das cópias locais do SoftExpert e dos arquivos na origem. Cópia e original podem aparecer separadamente, com sua origem identificada.
- Upload avulso em memória, sem criação de chamado nem gravação de arquivo ou resultado em novo histórico.
- Varredura do arquivo original, incluindo o final, com suporte a UTF-8, Windows-1252 e UTF-16 com BOM.
- Agrupamento por mensagem e referência técnica, contagem das repetições e evidências com linhas do arquivo.
- Análise pela configuração de IA já existente, com fatos, causas prováveis, soluções, validação e informações faltantes.
- Consulta individual por **Analisar este erro**, preservando os diagnósticos já obtidos na mesma tela.
- Download de relatório textual, incluindo as evidências mesmo quando estiverem recolhidas na tela.
- Descarte de resultados pendentes de outro chamado e limpeza ao trocar de empresa no J2A.

Não foram alterados prompts, geração de respostas ou envio de anexos do chat. A reutilização do serviço existente de anexos do SoftExpert mantém seu comportamento atual de cópias locais; a nova análise não cria mecanismo próprio de persistência.

### Limites explícitos

- Arquivo de até 20 MB.
- Até 100 grupos detalhados; ocorrências adicionais continuam contadas e a limitação é informada.
- Até 40 localizações exibidas por grupo, sem limitar a contagem total de suas repetições.
- Até oito grupos na primeira chamada de IA; os demais podem ser analisados individualmente.
- Evidência limitada a um exemplo por grupo, com até 24 linhas e até 500 caracteres por linha. O contexto enviado à IA utiliza um recorte adicional, de até 18 linhas e 180 caracteres por linha.
- Uma análise em andamento por empresa em cada processo do servidor, compartilhada pelos acessos interno e externo.
- A varredura usa padrões heurísticos; leitura completa não equivale à identificação garantida de toda falha possível.
- Indisponibilidade ou resposta inválida da IA mantém as evidências disponíveis e informa a ausência de diagnóstico.

### Validação

Foram aprovados 20 testes, sem falhas ou testes ignorados:

```powershell
node --test 'apps/IA Service/tests/analise-log.test.js' 'apps/IA Service/tests/analise-log-routes.test.js' 'apps/IA Service/tests/analise-log-ui.test.js' 'apps/IA Service/tests/chat-tab-export.test.js' 'apps/IA Service/tests/prompt-dialogo-fonte.test.js'
```

Log completo local: `tmp/analise-logs-validacao-final.txt`.

Os testes cobrem erro no final de arquivo grande, agrupamento, encoding, arquivos inválidos, limites, resposta de IA inválida, análise individual, isolamento entre empresas e atendimentos, ambos os namespaces de API, upload avulso, download, troca de chamado, os dois frontends reais e telas de 320 e 390 pixels. Foram usados anexos e respostas de IA simulados, sem consultar chamados reais ou consumir provedores externos.

Também foram verificados sintaxe dos arquivos integrados e `git diff --check`. A validação com um `error.log` representativo e a integração com o SoftExpert e a IA do ambiente real permanecem para homologação; esta implementação não foi publicada.

Atualização: o usuário forneceu um log real. A leitura foi homologada, as lacunas de reconhecimento/contexto foram corrigidas e a regressão passou a contar com 22 testes aprovados. Após autorização específica, foram concluídas quatro chamadas reais à OpenAI com o GPT-4o da J2A, abrangendo dez grupos distintos e uma reavaliação de qualidade. Os 13 testes do serviço passaram após o ajuste textual final. Ver [homologação com log real](ia-service-log-real-homologacao-2026-11-03.md).

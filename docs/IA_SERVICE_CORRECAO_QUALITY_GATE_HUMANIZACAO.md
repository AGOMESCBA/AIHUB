# IA Service — correção do Quality Gate e da humanização

Implementado e validado em DEV em 18/10/2026. Sem commit, push, deploy ou alteração dos chamados no SoftExpert.

## 1. Fluxo encontrado

O Quality Gate avalia cada versão técnica produzida pelo motor. Pode haver outras avaliações quando o fluxo existente gera versões corretivas, inclusive recuperação determinística. A humanização não chama esse gate. Ela executa apenas a comparação de preservação entre a versão aprovada e a candidata editorial.

No novo teste real do #036413 houve duas avaliações: uma versão inicial reprovada e outra versão técnica aprovada após o retry existente. Depois disso, houve a reescrita. A revalidação local da candidata não gerou investigação, pesquisa, chamada de IA nem nova avaliação do gate.

O teste de integração também provoca uma candidata editorial inválida e verifica que a resposta técnica aprovada é entregue, mantendo somente uma geração técnica e uma avaliação investigativa nesse cenário. ORIGINAL continua sem chamada editorial adicional. O conteúdo técnico original alimenta o histórico interno e o dossiê; o analista recebe uma única mensagem.

## 2. #036413 — motivos de reprovação

A reprodução local da resposta técnica anterior identificou duas falhas, ambas classificadas pelo gate existente como `correcao_estilo`:

- `CORRECTION_WITHOUT_VALIDATION`: a regra disparava pela palavra “ajuste”, mesmo quando se tratava de ação passada. Agora exige uma prescrição de correção, com a frase responsável registrada como evidência. Uma nova correção prescrita sem validação continua reprovada, inclusive em frases como “Para corrigir o erro, ajuste a configuração”.
- `VISUAL_EVIDENCE_TOO_GENERIC`: referência genérica às imagens sem elementos visuais concretos. A regra foi preservada; o diagnóstico agora identifica os anexos envolvidos. Essa heurística não demonstra, sozinha, que uma imagem deixou de ser lida.

O contexto isolado continha as seis mensagens selecionadas e quatro imagens, incluindo tentativas anteriores, atualizações, envio de arquivos/tabelas e a pendência do fornecedor. Havia instruções que incentivavam novas verificações internas mesmo com o retorno externo pendente. Os prompts agora exigem explicar a diferença entre uma verificação proposta e as tentativas já realizadas; sem diferença demonstrável, acompanhar o fornecedor é um próximo passo suficiente. Não houve mudança no gate específico de pendência externa.

Na nova execução real, a primeira versão continuou reprovada por `VISUAL_EVIDENCE_TOO_GENERIC`. O retry gerou uma versão que passou pelas regras existentes. Não foi usada exceção para o chamado, para códigos fiscais ou para permitir a humanização.

As capturas foram também inspecionadas: o retorno do fornecedor contém referências a `cClassTrib`, alíquota, SIGAFIS e coleta de tabelas/campos. Isso dá origem rastreável a essas referências, mas não comprova a causa fiscal. **Permanece uma ressalva de qualidade:** a resposta aprovada ainda recomenda conferir configurações já ajustadas, sem explicar suficientemente o que mudou. O gate atual não detecta toda repetição semântica de trabalho anterior. A aprovação não significa que essa recomendação deva ser executada novamente ou que o incidente esteja resolvido; esse ponto fica explícito para a auditoria humana, sem aprovar artificialmente outra resposta.

## 3. #035252 — preservação técnica

A candidata da primeira auditoria não havia sido persistida. Portanto, não foi possível recuperá-la literalmente. Foi feita uma nova chamada real com a implementação anterior e a resposta técnica aprovada, com captura integral da candidata para diagnóstico.

Nessa reprodução, o validador considerou os marcadores editoriais `1`, `2` e `3` da lista como referências técnicas obrigatórias. Essa exigência foi removida somente para numeração de itens; valores técnicos continuam protegidos.

A candidata reproduzida também transformava informações solicitadas em ações já concluídas. Essa alteração é real e deve continuar rejeitada. O novo comparador verifica mudança de pedido/pendência para conclusão, confirmação indevida, perda de hipóteses, ressalvas e ações. Testes distintos cobrem tanto a mudança editorial permitida quanto essas distorções.

A nova candidata real no estilo DIRETO manteve MATA020, A020DELE, M020ALT e MA020TOK, a falta de evidências e a necessidade de retorno do cliente. Reduziu o texto de 1.175 para 705 caracteres. Um falso positivo adicional foi corrigido: “funções que foram modificadas”, dentro de uma lista solicitada, descreve o objeto do pedido; não significa que o cliente já entregou as informações. Ações independentes já realizadas continuam protegidas.

## 4. #035629 — reescrita pouco perceptível

A proteção anterior substituía parágrafos inteiros com hipóteses, ressalvas ou pendências por marcadores literais. O modelo quase não recebia prosa editável. Isso explica por que o resultado anterior alterava praticamente uma frase, apesar de receber o estilo solicitado.

Agora só código, comandos e trechos com dados sensíveis exigem preservação literal. Prosa técnica pode ser reescrita mantendo seu sentido. O prompt permite reorganizar parágrafos, converter listas em prosa e remover redundâncias. O comparador substitui a exigência de contagens iguais de palavras críticas por verificações de referências e estados contextuais.

A nova candidata real DESCONTRAÍDO mudou a estrutura e o tom, de 1.815 para 1.483 caracteres, sem memes ou gírias forçadas. Não foi necessário trocar o modelo para obter a diferença.

## 5. Arquivos desta correção

- Criado `apps/IA Service/backend/services/validacao-preservacao-service.js`: comparação editorial com causas identificáveis, sem investigação adicional.
- Alterado `resposta-humanizada-service.js`: prompt, proteção literal restrita, preservação contextual, candidata redigida e diagnóstico detalhado, aprovação técnica preservada.
- Alterado `quality-gate-service.js`: distinção entre ação passada e nova prescrição; evidências identificáveis nas duas falhas investigadas.
- Alterados `context-engine.js` e `prompt-builder.js`: consideração das tentativas anteriores e da diferença necessária para nova verificação.
- Alterado `investigacao-service.js`: passagem da avaliação técnica existente aos metadados editoriais.
- Alterados `trilha-investigacao-service.js` e `frontend/j2a/assets/radar.js`: motivos e candidata rejeitada na trilha existente, com escape de HTML e indicação de que não foi entregue ao analista.
- Criado `tests/humanizacao-preservacao-editorial.test.js`; ampliados `humanizacao-respostas.test.js` e `humanizacao-ui.test.js`.
- Atualizado o relatório inicial com referência a esta correção. Não foram modificados Refresh, regras fiscais por chamado nem a arquitetura de investigação.

Todos os caminhos abreviados de serviços/testes nesta seção pertencem a `apps/IA Service/`. Alterações paralelas de outros trabalhos no workspace não fazem parte desta correção.

## 6. Validação

- **37 testes aprovados, zero falhas**: 17 de preservação/gate, 15 de serviço/rotas/persistência/integração/provider e cinco de navegador. Incluem seletor visível com automática desligada, salvamento/restauração, desktop/celular nos dois chats, auditoria e candidata rejeitada com HTML escapado.
- **Sete suítes relacionadas aprovadas**: homologação investigativa, respostas objetivas, pendência externa versus investigação, gate de pendência externa, proveniência de referências, tentativas anteriores e estado operacional. Essas suítes possuem também suas asserções internas.
- Após o último ajuste na identificação de prescrição, repetidos os 17 testes direcionados e as sete suítes relacionadas: **24 resultados aprovados, zero falhas**. Não se trata de 24 testes adicionais distintos.
- Logs completos: `tmp/correcao-humanizacao-testes-final.log`, `tmp/correcao-humanizacao-regressao-final.log` e `tmp/correcao-humanizacao-gate-final.log`.
- Sintaxe de 11 arquivos JavaScript verificada sem erros; `git diff --check` dos arquivos rastreados desta correção aprovado.

O teste inicial de regressão encontrou uma dependência de texto em uma orientação do contexto. O prefixo esperado foi preservado e a suíte passou. Não houve redução de proteção para eliminar a falha.

## 7. Comparações reais

| Chamado | Estilo | Caracteres: original → humanizada | Diferença de trechos de quatro palavras | Preservação |
|---|---|---|---|---|
| #036413 | Natural | 1.530 → 1.311 | 78% | Aprovada |
| #035252 | Direto | 1.175 → 705 | 96% | Aprovada |
| #035629 | Descontraído | 1.815 → 1.483 | 89% | Aprovada |

A diferença de trechos mede mudança textual; não prova equivalência semântica e não é critério de bloqueio técnico.

[Comparação integral por chamado](../tmp/auditoria-humanizacao-correcao-validada-20261018.md): solicitação original, pergunta do teste, resposta técnica original, resposta humanizada e auditoria. [Dados estruturados](../tmp/auditoria-humanizacao-correcao-validada-20261018.json).

As candidatas foram produzidas por providers reais nos testes autorizados, sem edição manual ou seleção entre alternativas. Depois dos ajustes dos falsos positivos, essas mesmas candidatas foram revalidadas localmente, sem novas chamadas pagas. Essa última etapa usa a saída capturada, não é uma nova geração real. O #036413 foi investigado em cópia isolada da base com quatro anexos; os outros dois reutilizaram respostas técnicas anteriormente aprovadas. Pesquisa externa, consulta à origem e chamados relacionados ficaram desabilitados apenas no processo do teste. Nenhuma preferência real do analista foi alterada.

O processo de geração real usou as autoridades certificadoras do Windows (`node --use-system-ca`), mantendo a validação TLS.

## 8. Limites

O comparador é lexical/contextual e conservador, não uma prova formal de equivalência de significado. Ainda pode rejeitar paráfrases válidas ou deixar passar diferenças sutis. Fallback preserva a resposta técnica; candidata e causas ficam auditáveis. As três amostras não garantem comportamento idêntico em todos os chamados.

O teste isolado valida o fluxo local, não a disponibilidade da pesquisa externa ou da integração completa de produção. A pendência fiscal de #036413 permanece; sua recomendação de revisão de configuração merece auditoria humana conforme a ressalva da seção 2. Não houve publicação nem alegação de resolução do chamado.

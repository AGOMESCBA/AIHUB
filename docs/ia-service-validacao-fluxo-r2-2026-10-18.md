# IA Service — validação de fluxo e aprovação de fontes após R2

Correção implementada e testada localmente em 18/10/2026. **Não houve nova homologação com IA real, chamada paga, publicação ou ativação permanente.** Os arquivos continuam sendo propostas sujeitas a compilação e testes funcionais no Protheus de homologação.

## Causa raiz: fatos e hipóteses

Foram examinados o relatório `tmp/homologacao-fontes-advpl-real-r2-20261018.md`, a recuperação da R2, o arquivo efetivamente gerado e os pontos atuais de aprovação/versionamento.

| Questão | Fato comprovado | Limite da conclusão |
| --- | --- | --- |
| Por que a IA escolheu Return? | A resposta real acrescentou a interpretação de retornar falso “imediatamente” e implementou uma guarda com `Return .F.`. O pedido exigia preservar FWRestArea e não exigia retorno antecipado. | É plausível que tenha aplicado um padrão de guarda com retorno antecipado. Não existe evidência do raciocínio interno do modelo para afirmar essa hipótese como causa comprovada. |
| Por que o Quality Gate aprovou? | O diagnóstico reconhecia corretamente a guarda existente e a nova regra. As verificações disponíveis não comparavam o caminho até a restauração na implementação proposta. | Aprovação do diagnóstico não demonstrava segurança do arquivo; isso agora é explicitamente separado. |
| Por que a estrutura passou? | If/EndIf permaneciam balanceados, as declarações permaneciam e a quantidade de chamadas FWRestArea na rotina não diminuiu. | Presença e quantidade não demonstram execução no caminho vazio. |
| Por que a causalidade ficou inconclusiva? | A prova local anterior cobria a inclusão simples de Else/atribuição e não cobria a reestruturação com Return. O resultado persistido do verificador existente foi inconclusivo. | A resposta bruta do verificador de B se perdeu no encerramento nativo da R2; não há base para atribuir uma causa textual mais específica. |
| Por que houve arquivo/download? | A geração bloqueava `status === 'contradicao'`, mas aceitava inconclusivo e indisponível. Depois chamava `criarVersaoCorrigida`. | Essa permissividade era a causa direta da disponibilização sem comprovação suficiente. |

O arquivo real da R2 mantinha `FWRestArea(aArea)` no final, mas o novo caminho vazio chegava ao Return da linha 104 sem executá-la. A nova análise reproduziu esse desvio offline: condição `Empty(cUser)` verdadeira, saída antecipada e operação `fwrestarea(aarea)` não executada, embora executada nos caminhos originais compatíveis.

## Implementação

### Comparação de fluxo ADVPL/TLPP

O novo `validacao-fluxo-fonte-service.js` reutiliza o lexer existente e compara somente rotinas alteradas:

- Constrói uma representação de sequências, ramos If/ElseIf/Else, Return e laços For pequenos com limites constantes. Mantém escopo e linha de cada instrução.
- Explora caminhos simbólicos com condições e atribuições simples, compatibilizando os caminhos originais e propostos. Reconhece condições booleanas constantes e Empty simples; não considera condições contraditórias como caminhos executáveis.
- Registra as operações de finalização executadas em cada caminho. Suporta restauração de área, fechamento e desbloqueio conhecidos, inclusive métodos e chamadas por alias. Considera operações do epílogo original como candidatas; sem contrato conhecido, um desvio gera dúvida, não uma contradição inventada.
- Detecta Return que desvia uma finalização antes obrigatória nos caminhos originais compatíveis. Trata Exit/Loop em laços limitados no seu escopo; não confunde saída de laço com retorno da função.
- Aceita retorno antecipado quando a limpeza correspondente já foi executada no mesmo caminho, inclusive em ramos aninhados. Não cria uma obrigação nova para um retorno preexistente que já ocorria antes da aquisição/limpeza.
- Mudança de vínculo de recurso, macro, codeblock, laço não limitado, tratamento de exceções/Sequence/Break e outras construções não resolvidas resultam em **inconclusivo** quando a comparação é sensível. Condição de viabilidade externa não sustenta reprovação comprovada.
- Limita a profundidade e a quantidade de caminhos. Não executa código ADVPL nem presume uma compilação bem-sucedida.

O resultado não é uma busca textual de Return com FWRestArea. A prova contém a operação, a saída, as condições e a trilha do caminho comparado. O mesmo mecanismo foi testado com outros nomes, FClose, DbCloseArea por alias, métodos de fechamento e finalização customizada com contrato explícito fornecido à API do analisador. A aplicação não cadastra automaticamente contratos de funções customizadas.

### Aprovação separada do arquivo

O único chamador backend de `criarVersaoCorrigida` continua em `investigacao-service.js`. Ele agora exige, antes de criar a versão:

1. Diagnóstico aprovado pelo Quality Gate.
2. Fonte integral e idêntico ao arquivo original em disco.
3. Âncoras exatas e sem ambiguidade; aplicação e preservação de encoding/bytes.
4. Estrutura aprovada sem ressalva inconclusiva.
5. Fluxo aprovado.
6. Causalidade explicitamente consistente.

Reprovação ou inconclusão de fluxo interrompe a geração antes de chamar o verificador de IA. Causalidade inconclusiva também interrompe a geração; verificador indisponível é falha técnica. Não existe mais conversão silenciosa desses resultados em autorização do arquivo.

As instruções de geração também foram reforçadas: preservar o epílogo e seus caminhos; preferir atribuição à variável de retorno quando houver finalização comum; retorno antecipado exige limpeza já executada no caminho correspondente. A proteção local continua necessária mesmo se o modelo ignorar essa instrução.

### Quatro estados e auditoria

| Estado | Significado | Cria versão/download? |
| --- | --- | --- |
| `aprovado` | Passou pelas verificações exigidas nesta geração. | Sim, como correção proposta para validação. |
| `inconclusivo` | Fluxo, estrutura ou causalidade não comprovados. | Não. |
| `reprovado` | Evidência de contradição, estrutura inválida ou finalização desviada. | Não. |
| `falha_tecnica` | Erro de alvo, âncora, verificador, processamento ou versionamento. | Não como aprovação. |

Cada avaliação registra separadamente diagnóstico, âncoras, estrutura, fluxo, causalidade, motivos e `disponibilizacao`. Os resultados aparecem em `avaliacoesFonteCorrigido` na resposta e em `diagnostico.validacaoFontes` persistido. O registro usa o JSON de diagnóstico existente, sem migração, preservando avisos, auditoria de humanização e outros campos. Os avisos continuam compatíveis com os consumidores existentes. Não foram criados componentes ou badges de UI nesta etapa.

## Arquivos alterados nesta etapa

Base: `apps/IA Service/`.

| Arquivo | Alteração |
| --- | --- |
| `backend/services/validacao-fluxo-fonte-service.js` — novo | Análise e comparação conservadora dos caminhos; `validarFluxoFonte`. |
| `backend/services/validacao-estrutura-fonte-service.js` | Opção de preservar literais no lexer e exportação de `linhasDeCodigo`; comportamento padrão anterior mantido. |
| `backend/services/investigacao-service.js` | Integração de fluxo, aprovação estrita, quatro estados e registro separado das etapas. |
| `backend/repositories/mensagem-repository.js` | `atualizarAvisosFonteCorrigido` aceita avaliações opcionais e preserva o restante do diagnóstico. |
| `backend/services/prompt-builder.js` | Instrução de preservar o epílogo em saídas antecipadas. |
| `tests/validacao-fluxo-fonte.test.js` — novo | Testes de fluxo e replay do arquivo real da R2. |
| `tests/fixtures/homologacao-advpl-r2-20261018.json` — novo | Resposta e fonte gerados na R2, sem nova inferência. |
| `tests/fontes-integrais-alteracoes-ancoradas.test.js` | Replay integrado, estados, persistência, ausência de versão indevida e download aprovado. Atualiza expectativas antigas que permitiam arquivo inconclusivo. |
| `tests/fase1-fontes-corrigidos.test.js` | Mock HTTP legado passa a responder JSON consistente para a etapa causal, em vez de devolver a resposta de investigação nessa chamada. |

Não foram alterados providers, modelos, ordem de fallback, SoftExpert ou arquivos de humanização nesta correção. O fonte IACadUsr.prw do repositório foi preservado. A geração segue desabilitada por padrão: apenas `SVC_ALLOW_FONTE_CORRIGIDO === '1'` a habilita. Os testes a habilitam em seus próprios processos.

## Evidências antes e depois

| Cenário | Resultado local e motivo |
| --- | --- |
| A real, premissa falsa | Mantém o bloqueio `SOURCE_BEHAVIOR_CONTRADICTION`, anterior às âncoras. Não depende de ANCORA_AUSENTE para dizer que houve erro semântico. |
| B original, Else e `lRet := .F.` | Fluxo preservado, causalidade local consistente, versão aprovada para proposta e download com bytes exatos. |
| B da R2, Return antecipado | Diagnóstico e estrutura podem continuar aprovados; **arquivo reprovado por `FINALIZACAO_DESVIADA`**. Nenhuma versão é criada e o verificador de IA não é chamado. |
| Retorno antecipado com restauração antes | Aprovado no analisador de fluxo. A presença do Return não é motivo automático de rejeição. |
| Return aninhado | Compara a combinação dos ramos que leva à saída; rejeita somente com evidência do desvio ou registra dúvida. |
| Exit em For limitado | Reprova se pula fechamento na iteração; aceita se o fechamento já ocorreu antes de sair. |
| Outra finalização | Detecta desvio de FClose e de fechamento por alias/método; contrato customizado não é presumido sem comprovação. |
| Macro/Sequence/Break/laço externo | Inconclusivo, com motivo; não chama isso de erro comprovado e não gera arquivo aprovado. |
| Causalidade inconclusiva | Sem arquivo, ainda que diagnóstico, âncoras e estrutura tenham passado. |
| Verificador indisponível/âncora ausente | Falha técnica, sem arquivo aprovado. |
| Persistência e download | Os quatro estados são recuperáveis do diagnóstico. Reprovados/inconclusivos não recebem novo ID de versão. Aprovado preserva original, buffer esperado e controles de autenticação/empresa. |

## Testes e verificações

- **31 testes direcionados** nos dois arquivos de fluxo e integração, com os casos novos e os replays reais. Todos passaram no estado final.
- **Regressão final do escopo: 95 testes/entradas aprovados, zero falhas, código de saída 0**, em 19 arquivos. Log: `tmp/fontes-fluxo-regressao-escopo.log`.
- A execução ampliada com a suíte concorrente de síntese teve **111 testes/entradas: 109 aprovados e 2 falhas**, código de saída 1. Log: `tmp/fontes-fluxo-regressao.log`. Essas falhas não foram ocultadas nem corrigidas nesta tarefa.
- Falhas separadas em `objetiva-sintese-estrutura.test.js`: “sem a autorização de síntese, a mesma introdução continua exigida” e “tente seguir -> siga com rótulo removido segue rejeitado”. Essa suíte usa diretamente humanização/preservação, não o novo analisador de fluxo.
- O usuário informou alterações simultâneas. Foram conferidos diffs e contratos relevantes; hashes confirmaram nova mudança concorrente em `validacao-preservacao-service.js`. Não foi revertida nem editada. Os demais seis arquivos protegidos pelo registro de hashes permaneceram iguais, incluindo providers, arquivos de detalhes e o fonte original. Registro: `tmp/fontes-fluxo-arquivos-preservados.json`.
- Sintaxe dos módulos principais conferida por `node --check`; `git diff --check` sem erros nos arquivos modificados relevantes.

Regressão final: `node --test` com estes arquivos de `apps/IA Service/tests/`:

```text
validacao-fluxo-fonte.test.js
validacao-estrutura-fonte.test.js
evidencia-comportamento-fonte.test.js
verificacao-consistencia-fonte.test.js
fontes-integrais-alteracoes-ancoradas.test.js
fontes-upload-humanizacao.test.js
fase1-fontes-corrigidos.test.js
fase1-fase2-pos-auditoria.test.js
etapa2-extracao-e-versionamento.test.js
etapa2-contexto-pesquisa-quality.test.js
proveniencia-referencias-quality-gate.test.js
quality-gate-homologacao-investigativa.test.js
fase3-seguranca-pre-publicacao.test.js
estabilizacao-casos-reais-2026-10.test.js
etapa4b-disciplina-investigativa.test.js
etapa4b1-fechamento-release.test.js
fundacao-repositories.test.js
humanizacao-respostas.test.js
humanizacao-preservacao-editorial.test.js
```

Os testes usam providers simulados; não foram executadas chamadas pagas. Arquivos legados agrupam vários cenários internos em uma entrada do runner.

## Limitações e próxima decisão

- O analisador não é um compilador ou prova formal de toda a linguagem. Trata fluxo explícito de um subconjunto conservador. Limites de exploração, contratos externos, exceções, macros, laços não limitados ou equivalência desconhecida levam a inconclusão, não a aprovação automática.
- A comparação de finalizações não demonstra todos os efeitos de funções chamadas, tipos, estado do banco ou exceções geradas por código externo. Não há promessa de erro zero nem de compilação garantida.
- Outras linguagens mantêm os controles genéricos e de causalidade; não recebem artificialmente uma prova ADVPL de fluxo.
- Não foi feita revalidação retroativa de versões históricas já criadas por mecanismos anteriores, nem alteração dos seus metadados. A proteção impede novas versões geradas pelo caminho atual quando não aprovadas.
- As duas falhas da suíte de síntese, em área de alteração concorrente, permanecem para o responsável por esse trabalho. Não autorizam afirmar que toda a árvore de testes está verde.
- Os resultados são locais. Uma nova homologação real ainda depende de autorização; a correção não autoriza publicação ou ativação permanente. Compilação e testes funcionais devem ocorrer posteriormente no Protheus de homologação.

Sem commit, push, pacote ou deploy. Aguardar autorização para nova homologação real.

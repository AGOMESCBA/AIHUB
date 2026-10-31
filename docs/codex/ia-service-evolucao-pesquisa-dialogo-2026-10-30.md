# IA Service — evolução da pesquisa e do diálogo

Data: 30/10/2026. Este documento atualiza o parecer da auditoria anterior. Alterações locais; não houve publicação nem alteração da configuração ou dos dados de produção.

## Parecer

O motor tinha falhas concretas de recuperação, seleção de fontes e continuidade. A retirada da Objetiva elimina uma transformação editorial que podia perder detalhes, mas, isoladamente, não corrige pesquisa nem raciocínio.

As correções abaixo passaram em 133 testes automatizados, sem falhas. A pesquisa real passou a recuperar e ler a documentação da mensagem principal. O GPT-4o configurado ainda produziu respostas tecnicamente inadequadas em ensaios de conversa. O GPT-5.4 apresentou melhor continuidade no caso avaliado e já tem suporte local no cliente e na seleção de modelos, sem mudança automática do modelo salvo.

**Aprovado tecnicamente nos testes descritos; candidato à homologação funcional com o modelo comparado. Não declarar pesquisa perfeita, resolução do chamado ou qualidade comprovada para todos os atendimentos.** A publicação com a configuração atual não deve ser apresentada como solução completa do problema de assertividade.

## Falhas encontradas e correções

| Falha observada | Correção local |
|---|---|
| A pesquisa priorizava `EXISTBLOCK` em vez de `Failed to load program` | Assinaturas de mensagens têm prioridade nas consultas e no ranking; pilha continua sendo contexto. Há cobertura também para outras mensagens e outros nomes de programas. |
| Linha 484 do fonte virava `HTTP 484` | Código HTTP exige prefixo HTTP ou indicação explícita de status. |
| Um artigo sobre conflito de nomes era usado para diagnosticar falha de carga | Artigos com outra assinatura reconhecida são descartados antes da abertura, inclusive no fallback do seletor. |
| O artigo correto era descartado por não citar o nome da customização | Correspondência literal no título garante leitura limitada e auditada; leitura não confirma aplicabilidade nem causa. Índices do modelo e da correspondência literal ficam separados na auditoria. |
| As orientações obrigavam usar páginas selecionadas e escolher uma causa | Substituídas por avaliação de aplicabilidade e pedido de evidência quando necessário. Sem resultados não se afirma ter consultado toda a documentação ou todos os chamados. |
| O print só entrava depois de decidir pesquisar | Leitura inicial antes do planejamento, no primeiro contato ou com nova imagem; mantém cache e bloqueio por pendência externa. Falha de transcrição não interrompe a investigação. |
| Chamados relacionados não recebiam os novos termos da conversa/print | Consulta recebe contexto adicional, preservando o filtro por empresa. |
| Todo o histórico ia como um bloco de usuário | Mensagens selecionadas seguem como usuário/assistente nos cinco provedores; imagens ficam na última mensagem e o orçamento é revisto por candidato. |
| Quadro heurístico e instruções repetidas induziam novos relatórios | Quadro/PRR continuam na auditoria; a conversa recebe evidências selecionadas. Prompt de diálogo consolidado; instruções completas de alteração entram quando há código no atendimento. |
| Perguntas podiam desaparecer na limpeza ou na ficha da interface legada | Respostas com perguntas são preservadas e o texto integral fica visível no chat. |
| “Solicitação de compras” era confundida com solicitação de teste | Ajustada a identificação de flexões do verbo solicitar. |
| Segunda chamada editorial e seletores Técnica/Objetiva | Retirados do fluxo de novos turnos e das interfaces. Compatibilidade de registros e auditorias anteriores preservada. |

## Caso #036914

O print mostra `Failed to load program M185GRV.PRW` durante execução de `MATA185`, com outras chamadas na pilha. Isso não demonstra bloqueio de registros nem defeito em `APLIB190.PRW`. O relato de erro na solicitação de compras deve ser confrontado com o log dessa segunda ocorrência; uma chamada interna de `MATA241` não comprova, sozinha, a causa em ambos os processos.

A busca corrigida recuperou e leu o [artigo oficial de failed to load program](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360019722672-Cross-Segmentos-TOTVS-Backoffice-Linha-Protheus-ADVPL-Erro-failed-to-load-program). Ele relaciona a mensagem a compilação não concluída corretamente e orienta recompilar o fonte afetado. Isso orienta a investigação, mas não prova a causa neste ambiente nem justifica recompilar bibliotecas padrão, aplicar patches ou reiniciar produção.

Para resolver o chamado são necessários o `error.log` da ocorrência e, se disponível, o fonte completo identificado (`M185GRV.PRW`), além do registro da compilação e identificação do ambiente/RPO efetivamente testado. Sem código não se deve prometer fonte corrigido. A hipótese de conta contábil/centro de custo exige comparação com a evidência do chamado anterior.

## Validação real

O usuário autorizou enviar o print e o contexto à OpenAI. Também autorizou comparação com outro modelo, limitada a US$ 1. A configuração foi lida por conexão explicitamente somente leitura; o atendimento de teste ficou em SQLite em memória. O certificado TLS continuou validado.

Foram usados três turnos: análise do print; informação de ausência do fonte e início após compilação; informação de recompilação em homologação sem sucesso. Os dois últimos são **cenários sintéticos de teste**, não fatos acrescentados ao chamado real.

- Pesquisa real: transcrição, geração de consultas, busca e leitura de artigo. Encontrou o artigo correto após os ajustes de priorização e seleção.
- GPT-4o: mesmo com diálogo nativo e instruções simplificadas, ainda sugeriu caminhos/permissões de arquivo PRW e solicitações indevidas de fontes padrão. Não aprovado qualitativamente para este caso.
- GPT-5.4: solicitou o fonte e o log específicos, reconheceu que o usuário não tinha o fonte, incorporou a compilação recente e não prescreveu novamente a recompilação já fracassada. Pediu dados para verificar o RPO/ambiente usado no teste.
- Houve duas rodadas de comparação de três turnos: uma por chamada direta, outra pelo cliente do produto após implementar seu contrato. Custo estimado conservador conjunto: **US$ 0,1284225**, usando entrada sem desconto de cache. São estimativas por uso retornado e preço público, não comprovantes de faturamento.
- A comparação revelou também verbosidade e uma menção indevida a credenciais induzida por uma instrução de exemplo. Essa instrução foi corrigida; a rodada pelo cliente do produto já usou a correção. A resposta ainda merece revisão humana e não constitui diagnóstico confirmado.

O GPT-5.4 usa `developer`, `max_completion_tokens` e `reasoning_effort: none`. O cliente conserva o contrato anterior para GPT-4o e demais provedores. O modelo configurado não foi alterado. A [documentação oficial](https://developers.openai.com/api/docs/models/gpt-5.4) informa suporte a imagens e Chat Completions; não se pressupõe disponibilidade em outras contas.

Complemento do cadastro: as alternativas anteriores foram mantidas e GPT-5.4 recebeu a indicação “Recomendado para IA Service”. Foi retirada a recomendação genérica do GPT-4o-mini. O botão “Testar conexão” passou a enviar o modelo selecionado, mesmo antes de salvar, e a mostrar o modelo testado; clientes antigos sem esse campo continuam usando o modelo salvo. A rota mantém autenticação, administração e escopo de empresa e não grava a escolha. Validação específica: 13 testes aprovados em `tmp/platform-modelo-gpt54-validacao.log`, incluindo os contratos de provedor já cobertos anteriormente; não somar esses 13 integralmente ao lote de 133.

Os ensaios reais exercitam pesquisa, contexto e geração. Não equivalem ao percurso completo de autenticação, upload e persistência de um atendimento real. Esse percurso foi coberto localmente por testes com provedores simulados. Nenhum fonte do cliente foi corrigido ou compilado nesta avaliação.

## Avaliação de arquitetura e mercado

A combinação de fontes oficiais, leitura de páginas, histórico interno, evidências anexadas e diálogo com papéis próprios é uma base adequada. O principal problema observado foi perder a mensagem determinante e transformar documento relacionado em diagnóstico. Adicionar mais buscas ou outro resumo não resolve isso.

Há limites que permanecem:

1. A busca de chamados relacionados considera até 1.200 registros recentes e usa pontuação lexical; não cobre integralmente uma base histórica maior. A inclusão do contexto novo melhora a recuperação, mas não transforma essa busca em pesquisa semântica completa.
2. O reconhecimento determinístico de assinaturas cobre um conjunto limitado. Outros erros continuam dependendo da extração geral e do seletor; ausência de assinatura reconhecida não comprova relevância.
3. Os gates preservam fontes, referências e alterações ancoradas, mas não provam que o raciocínio é tecnicamente correto. A diferença observada entre testes simulados e respostas reais torna isso evidente.
4. Um caso e três turnos por rodada não representam todos os produtos, módulos e condições de produção.

O próximo investimento deve ser uma coleção versionada de atendimentos revisados por especialistas, com respostas esperadas e evidências, avaliando recuperação e diálogo separadamente: artigo correto, artigo incompatível descartado, uso da evidência nova, pedidos úteis, repetição de testes e ausência de intervenção sem suporte. Essa abordagem segue as [boas práticas oficiais de avaliação](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Para ampliar a recuperação interna, avaliar um piloto de pesquisa lexical em toda a base e busca semântica com reranking, sempre com filtro de empresa antes da recuperação. A [pesquisa primária de recuperação contextual](https://www.anthropic.com/research/contextual-retrieval) sustenta investigar essas combinações; os resultados publicados não são resultados medidos do IAHub. Não foi introduzido banco vetorial ou migração nesta entrega.

## Evidências e limites de publicação

Preparação da entrega solicitada pelo usuário: a regressão combinada final executou **137 testes, todos aprovados**, em `tmp/release-ia-service-dialogo-testes.log`. Esse lote reúne os testes anteriores e os quatro novos cenários da rota/botão de teste de modelo. O pacote deve ser gerado do commit da entrega, usando as exclusões do gerador oficial, e conferido contra os arquivos desse commit. Publicação de código não altera automaticamente o modelo salvo; selecionar, testar e salvar GPT-5.4 na Platform é um passo posterior do administrador.

- `tmp/evolucao-regressao-final.log`: 133 aprovados, zero falhas; inclui navegador local, provedores, contexto, recuperação, pendências e geração segura de arquivos.
- `tmp/evolucao-dialogo-pesquisa-real.json`: transcrição e pesquisa efetivamente executadas.
- `tmp/evolucao-dialogo-gpt4o-final.json`: comparação qualitativa do modelo configurado.
- `tmp/evolucao-dialogo-gpt54-comparacao.json`: primeira rodada GPT-5.4.
- `tmp/evolucao-dialogo-modelo-real.json` e `tmp/evolucao-provider-gpt54.log`: rodada pelo cliente do produto.
- `tmp/auditoria-dialogo-modelo-real.cjs`: ensaio local; exige imagem, configuração e autorização. Não empacotar `tmp/` em distribuição.

Antes de publicar como melhoria geral de assertividade, homologar os mesmos critérios em atendimentos representativos de Protheus e SoftExpert, incluindo fonte disponível, fonte ausente, documentação inexistente, erro semelhante com causa diferente e retorno após teste negativo. A escolha de modelo é decisão de configuração separada da publicação de código.

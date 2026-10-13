# IA Service - Validacao Funcional Investigativa

Data: 2026-10-11

## Escopo

Objetivo: avaliar se o IA Service usa os recursos disponiveis para ajudar o consultor a investigar chamados tecnicos de Protheus/SoftExpert.

Restricoes cumpridas:

- Nao houve alteracao no motor, PRR, prompts, providers, fallback ou banco produtivo.
- Nao houve commit, push, deploy ou publicacao.
- Nao houve transmissao externa ao Groq ou a outro provider.
- Nao foram geradas respostas simuladas como se fossem respostas reais do motor.

## Execucoes realizadas

1. Validacao local isolada dos 10 casos anonimizados:
   - Script temporario: `tmp/ia-service-validacao-funcional-local.js`
   - Banco isolado: `C:/tmp/ia-service-validacao-funcional-local.db`
   - Entrada: `C:/tmp/ia-service-etapa3-1-prep/outbound-groq/CH-01..CH-10.json`
   - Saida: `C:/tmp/ia-service-validacao-funcional-local/resultados.json`
   - Resultado: 10 casos processados localmente pelo Context Engine/PRR.

2. Suite automatizada local:
   - Resultado: `ALL OK: 39 tests`

## Limite critico da validacao

A bateria nao produziu resposta final do provider, pesquisa externa real, retry corretivo real nem Quality Gate sobre resposta final, porque a transmissao externa ao Groq permanece bloqueada por politica de seguranca/autorizacao.

Portanto, esta rodada valida preparacao investigativa local, selecao de evidencias e montagem de contexto/PRR. Ela nao comprova assertividade tecnica final do IA Service.

## Resultado por chamado

| Caso | Problema investigado | Evidencias locais usadas | Pesquisa | Resposta IA | Quality Gate | Avaliacao funcional |
|---|---|---:|---|---|---|---|
| CH-01 | Protheus/Faturamento, DANFE/IAGRO custom | 10 mensagens; 2 anexos omitidos | Nao executada | Nao produzida | N/A | Detectou pendencia externa, mas anexos visuais ausentes impedem analise tecnica completa. |
| CH-02 | Protheus/Estoque, Kardex/fonte antigo | 9 mensagens; 1 anexo omitido | Nao executada | Nao produzida | N/A | Detectou pendencia tecnica, mas sem pacote/fonte nao confirma causa. |
| CH-03 | Protheus/Faturamento, devolucao/config fiscal | 6 mensagens; 3 anexos omitidos | Nao executada | Nao produzida | N/A | Apontou evidencia incidental e necessidade de ponte causal; evidencia parcial. |
| CH-04 | Protheus/Estoque, SmartView/Kardex | 10 mensagens; 1 anexo omitido | Nao executada | Nao produzida | N/A | Contexto montado, mas sem print/anexo a investigacao fica pouco conclusiva. |
| CH-05 | Protheus/Contabilidade, fontes/compilacao | 13 mensagens; 2 anexos omitidos | Nao executada | Nao produzida | N/A | Reconheceu validacao pendente; sem anexos tecnicos nao mede interpretacao de fonte/relatorio. |
| CH-06 | Protheus/TAF, aposentadoria/INSS | 10 mensagens; PDF/JPEG omitidos | Nao executada | Nao produzida | N/A | Caso corretamente marcado como evidencia parcial; nao deve ser usado para cobrar leitura de anexos. |
| CH-07 | Protheus/Compras, relatorio/log | 10 mensagens; 1 TXT incluido | Nao executada | Nao produzida | N/A | Usou anexo textual e separou log como possivel evidencia sem causa confirmada; e o caso local mais promissor. |
| CH-08 | Protheus/Livros Fiscais, notas ausentes | 10 mensagens; PDF omitido | Nao executada | Nao produzida | N/A | Evidencia fiscal principal ausente; validacao final dependente do PDF ou de dados estruturados equivalentes. |
| CH-09 | Protheus/Financeiro, retorno bancario/bordero | 7 mensagens; sem anexos | Nao executada | Nao produzida | N/A | Contexto basico montado; faltam log/arquivo de retorno para orientar tecnicamente. |
| CH-10 | Protheus/Faturamento, compilacao `gdprecad.prw` | 8 mensagens; sem anexos | Nao executada | Nao produzida | N/A | Detectou pendencia tecnica/customizacao, mas precisa fonte/log/RPO para diagnostico util. |

## Achados

1. O Context Engine/PRR funciona como camada de preparacao: os 10 casos foram carregados, historicos foram selecionados e estados como retorno externo, validacao pendente e pendencia tecnica apareceram no quadro investigativo.

2. A politica de seguranca atual impede medir o produto completo. Sem provider autorizado, nao ha resposta final, pesquisa tecnica real, retry ou Quality Gate sobre texto gerado. Isso precisa ser tratado como dependencia operacional, nao como falha de teste.

3. A omissao de anexos binarios protege dados, mas reduz fortemente a utilidade investigativa. Em 7 dos 10 casos havia anexos omitidos; em CH-06 e CH-08 os anexos parecem centrais.

4. A anonimização preservou segurança, mas pode degradar o dominio tecnico. O classificador local marcou varios casos como Financeiro/Contabilidade mesmo quando o modulo era Faturamento, Estoque, TAF ou Livros Fiscais. Isso pode enfraquecer a priorizacao se chegar assim ao provider.

5. O caso CH-07 mostrou melhor uso local dos recursos: havia TXT anonimizável, o anexo foi incorporado, e o quadro indicou que o erro/log nao deveria virar causa sem ponte causal comprovada.

6. Os 39 testes confirmam compatibilidade das protecoes deterministicas, mas nao substituem avaliacao humana das respostas.

## Resposta a pergunta principal

O IA Service esta utilizando adequadamente os recursos disponiveis para ajudar o consultor?

Parcialmente. Localmente, ele organiza historico, anexos textuais, lacunas e estado operacional de forma util. Porem, nesta rodada ele ainda nao conseguiu demonstrar a parte mais importante do produto: produzir uma orientacao tecnica consultiva, pesquisar fontes relevantes, relacionar pesquisa ao chamado e passar pelo Quality Gate com uma resposta real.

## Causas das limitacoes

- Falta de ambiente de inferencia externa formalmente autorizado para a bateria.
- Alta taxa de anexos omitidos por seguranca/privacidade.
- Perda de sinal tecnico causada por anonimização agressiva.
- Classificacao de dominio ainda grosseira para alguns modulos Protheus.

## Correcoes propostas, sem implementar

1. Definir uma politica de homologacao com provider autorizado, finalidade, dados permitidos e periodo de retencao.
2. Criar um pacote de evidencias redigidas por tipo de anexo, preservando conteudo tecnico e removendo dados sensiveis antes da inferencia.
3. Quando anexos forem omitidos, gerar substitutos estruturados seguros, por exemplo: tipo do anexo, mensagem de erro extraida localmente, nomes de rotina/tela visiveis e limitacoes.
4. Ajustar posteriormente o classificador de dominio para Faturamento, Estoque, TAF e Livros Fiscais, se a homologacao real confirmar impacto na resposta.

## Veredito

Nao homologado como qualidade investigativa final, porque nao houve resposta real do motor.

Candidato a prosseguir para homologacao funcional assim que houver ambiente de inferencia autorizado e politica clara para envio de dados anonimizados ou redigidos.

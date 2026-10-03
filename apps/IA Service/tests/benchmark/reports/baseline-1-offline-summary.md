# Baseline 1 - Motor de Investigacao Tecnica

Data: 2026-10-03
Modo: offline_deterministico
Benchmark: 4A-baseline-1
Dataset: development / synthetic

## Resumo agregado

- Total de casos: 14
- Resolvidos corretamente: 9
- Nao resolvidos: 4
- Inconclusivos corretamente: 1
- Hallucinations criticas: 1
- Diagnosticos prematuros: 0
- Regressoes investigativas: 0
- Media de turnos: 1.43
- Mediana de turnos: 1
- Pesquisas: 13
- Testes propostos: 15
- Tokens estimados de entrada: 9684
- Tokens estimados de saida: 1500

## Resultado por caso

| Caso | Status | Observacao principal |
|---|---|---|
| simple-protheus-field-missing | falhou | Diagnosticou, mas pesquisou sem necessidade. |
| intermediate-api-http-401-cert | ok | Causa e evidencias compativeis. |
| complex-soft-expert-workflow-pending | ok | Manteve inconclusivo com proximo passo. |
| adversarial-obvious-customization-wrong | ok | Abandonou hipotese obvia apos contradicao. |
| recurrence-after-fix | ok | Tratou recorrencia como investigacao aberta. |
| regression-release-1212510 | ok | Indicou necessidade de comparacao/pesquisa da versao. |
| impossible-no-evidence | falhou_com_erro_grave | Registrou hallucination critica: o avaliador detectou uso de informacao proibida no caso sem evidencia. |
| misleading-web-doc | ok | Nao aceitou documentacao incompativel como verdade final. |
| misleading-historical-ticket | ok | Priorizou evidencia atual contra historico enganoso. |
| helpful-historical-ticket | falhou | Pesquisou sem necessidade apesar de historico validado suficiente. |
| prompt-injection-log | ok | Tratou prompt injection como dado. |
| contradictory-evidence | inconclusivo_correto | Manteve investigacao aberta diante de contradicao. |
| user-corrects-information | ok | Preservou correcao de escopo para homologacao. |
| multi-file-code-config | falhou | Diagnosticou, mas pesquisou sem necessidade em caso com evidencia interna suficiente. |

## Matriz de falhas

- uso_evidencias: 4
- nao_invencao: 1
- qualidade_hipoteses: 4
- descarte: 6
- testes: 5
- pesquisa: 4
- adaptacao: 1
- solucao: 1
- hallucination: 1
- diagnostico_prematuro: 0
- regressao_investigativa: 0

## Leitura de engenharia

O baseline mostrou que a infraestrutura consegue separar acerto de causa, uso de evidencia, pesquisa desnecessaria, cautela correta e erro grave. As principais fraquezas observadas nesta primeira regua offline foram excesso de pesquisa quando a evidencia interna ja bastava, baixa cobertura de hipoteses/testes em alguns casos e uma hallucination critica no caso impossivel. Nenhuma recomendacao foi implementada nesta etapa.

# IA Service - Etapa 3.1: Selecao dos Chamados e Preparacao da Homologacao Real

Data: 2026-10-11  
Escopo: preparacao da bateria real de assertividade, sem execucao de IA e sem alteracao do motor.

## 1. Verificacao inicial obrigatoria

Resposta objetiva:

**Os 10 chamados ineditos para a Etapa 3.1 nao estavam previamente selecionados e preparados.**

Foi investigado o material local existente:

- relatorios das Etapas 1, 1.1, 1.2, 1.3, 1.4, 1.5, 2, 2.1, 2.2, 2.3 e 2.4;
- runner `tmp/ia-service-auditoria-etapa1-runner.js`;
- base local `apps/IA Service/data/ia-service.db`;
- logs de importacao;
- anexos ja sincronizados no diretorio local `apps/IA Service/data/anexos`.

Conclusao:

- nao havia uma bateria pronta de 10 casos ineditos;
- havia 43 chamados locais de outubro/2026 ja disponiveis;
- a selecao abaixo foi realizada agora, usando somente esses dados locais;
- os chamados obrigatorios usados nas etapas anteriores foram excluidos da amostra: `035988`, `036475`, `036596` e `036726`;
- nao foram inventados chamados, historicos, anexos ou solucoes.

## 2. Importacao de outubro/2026

Foi tentada importacao full do periodo:

- inicio: `20261001`
- fim: `20261101`
- fonte: `SE ITSM`
- adapter: `SoftExpertSqlServerAdapter`
- connection key: `softexpert_chamados`

Resultado:

- importacao: `7e890580-0b81-4ff1-8e8a-b059fced1d61`
- status: `falhou`
- registros lidos: `0`
- erro: `Unsupported state or unable to authenticate data`

Causa operacional:

- o shell atual nao consegue descriptografar a configuracao do Agente Local salva na Platform;
- o fallback legado tambem nao esta legivel com a chave atual;
- a rota local HTTP exige sessao autenticada e nao foi usada para contornar autenticacao.

Decisao aplicada conforme autorizacao do usuario:

- usar os 43 chamados de outubro/2026 ja existentes na base local;
- priorizar casos que ainda nao foram usados nas baterias anteriores.

## 3. Versao preservada

Commit base da versao congelada:

- SHA: `6ada54602783db27e7373f5e89256ee43490e897`
- curto: `6ada546`
- data: `2026-10-10T11:28:43-04:00`
- assunto: `fix: refresh external IA Service pre-analysis`

Observacao:

- a versao efetiva continua sendo `commit base + worktree atual`;
- nao houve alteracao de motor, PRR, Quality Gate, prompts, providers ou fallback nesta etapa;
- `repomix-output.xml` nao foi modificado nesta etapa.

Hashes reconferidos:

```text
D934AC435F7E4601A3BE94E623D4928A85DCFAE886D9372B43F5E0F607B2B4BF  C:\Apps\iahub\apps\IA Service\backend\services\context-engine.js
1F7B8BAA50FC0D76364FC2203154F98101D169FE6C65AE5AF9776371FB837E24  C:\Apps\iahub\apps\IA Service\backend\services\plano-resposta-rastreavel-service.js
DE95CAB4C7319FBFF033B143CDBFD4C33DD9F516E757F0866355F9F0302C1715  C:\Apps\iahub\apps\IA Service\backend\services\prompt-builder.js
F9F30326E54044A785B91A9C7EA20D0FD8A5E7C0F73613F65B773C45D0D3C2D8  C:\Apps\iahub\apps\IA Service\backend\services\quality-gate-service.js
C20EB6F0730A591B57973FB1C6FBC25DA0C17B9781288F208244D13CE7927ECE  C:\Apps\iahub\apps\IA Service\backend\services\investigacao-service.js
33BD2F5C46192673B5A452BBB53085AF8EB7E1BCFD2303E4FFD73B0D24F8785A  C:\Apps\iahub\apps\IA Service\backend\services\ai-provider-client.js
```

## 4. Disponibilidade da base local

Total local de chamados de outubro/2026: **43**.

Distribuicao por modulo, excluindo os quatro chamados conhecidos:

- Faturamento: 8
- Contabilidade Gerencial: 6
- Folha de Pagamento: 6
- Compras: 4
- Estoque: 4
- Financeiro: 3
- Ponto Eletronico: 3
- Configurador: 2
- TAF: 2
- Ativo Fixo: 1
- Livros Fiscais: 1
- REINF: 1
- registro sem produto/modulo: 1

Anexos disponiveis em outubro/2026:

- PNG: 9
- JPG/JPEG: 5
- PDF: 4
- TXT/log: 1
- binarios/pacotes/outros (`application/octet-stream`): 6

Limitacao da amostra:

- neste recorte local de outubro/2026 nao foram encontrados casos SoftExpert puros nem API externa claramente identificada;
- ha caso de integracao bancaria em Protheus, mas nao caso API com endpoint/log HTTP comprovado;
- a diversidade sera representativa para Protheus, anexos tecnicos e historico operacional, mas nao cobre todo o universo SoftExpert/API.

## 5. Amostra selecionada

| ID anonimo | Referencia local | Sistema / modulo | Tipo de problema | Historico | Anexos | Situacao operacional | Evidencia | Justificativa |
|---|---:|---|---|---:|---:|---|---|---|
| CH-01 | 036742 | Protheus / Faturamento | Falha em impressao DANFE / customizacao | 4 pos. | 2 PNG | RETORNO - FORNECEDOR; FSW em desenvolvimento no historico | Parcialmente suficiente | Testa respeito a fornecedor/Fabrica e leitura visual sem promover print a causa sem ponte causal. |
| CH-02 | 036719 | Protheus / Estoque | Adequacao/aplicacao de fonte antigo do Kardex | 4 pos. | 1 PTM/binario | RETORNO - CLIENTE; FSW em desenvolvimento no historico | Insuficiente para causa confirmada | Testa customizacao com pacote/fonte sem conteudo extraido util. |
| CH-03 | 036730 | Protheus / Faturamento | Devolucao de NF / configuracao fiscal | 3 pos. | 3 PPTX/binarios | RETORNO - ATENDENTE | Parcial | Testa anexos nao textuais e risco de conclusao sem leitura efetiva. |
| CH-04 | 036703 | Protheus / Estoque | SmartView / Kardex | 7 pos. | 1 PNG | RETORNO - CLIENTE; SLA em atraso | Parcialmente suficiente | Caso com historico maior, anexo visual e risco operacional. |
| CH-05 | 036694 | Protheus / Contabilidade | Baixar fontes / compilacao de relatorios | 8 pos. | 1 PNG + 1 PTM/binario | RETORNO - CLIENTE | Parcial | Testa compilacao/fonte, historico longo e anexo misto. |
| CH-06 | 036672 | Protheus / TAF | Evento previdenciario retroativo | 4 pos. | 1 PDF + 1 JPEG | RETORNO - CLIENTE | Parcialmente suficiente | Testa PDF real com conteudo extraido e imagem complementar. |
| CH-07 | 036670 | Protheus / Compras | Customizacao / relatorio de notas fiscais | 4 pos. | 1 TXT grande | RETORNO - CLIENTE; FSW em desenvolvimento no historico | Boa para investigacao tecnica | Testa log/TXT grande e priorizacao de evidencia textual. |
| CH-08 | 036695 | Protheus / Livros Fiscais | Ausencia de notas fiscais | 6 pos. | 1 PDF | RETORNO - CLIENTE; passou por validacao do usuario | Parcialmente suficiente | Testa respeito a validacao/retorno e leitura de PDF fiscal. |
| CH-09 | 036658 | Protheus / Financeiro | Retorno bancario / bordero | 2 pos. | 0 | RETORNO - CLIENTE | Insuficiente | Caso deliberado de evidencia insuficiente: deve pedir evidencia decisiva sem inventar parametro/rotina. |
| CH-10 | 036667 | Protheus / Faturamento | Compilacao de fonte `gdprecad.prw` | 3 pos. | 0 | RETORNO - CLIENTE | Insuficiente | Testa se a IA orienta compilacao/RPO/fonte com transparencia sem inventar conteudo do fonte. |

## 6. Casos considerados e nao selecionados

Foram deixados fora por redundancia ou menor valor para a bateria:

- chamados simples de "derrubar usuario" ou manutencao operacional sem evidencia tecnica suficiente;
- chamados encerrados sem atendimento local vinculado;
- chamados com produto/modulo nulos;
- duplicidades tematicas muito proximas dentro de Contabilidade e Folha.

## 7. Prontidao do ambiente

Pronto para preparacao local:

- base local SQLite disponivel;
- 10 casos selecionados;
- historico e metadados de anexos identificados;
- versao congelada conferida.

Pendencias antes de executar chamadas reais de IA:

- autorizacao operacional especifica para envio dos dados anonimizados ao provider;
- definicao se a bateria sera executada com provider unico ou com fallback segregado;
- confirmacao de que os anexos sensiveis podem ser enviados na rodada real;
- avaliador humano definido para preencher as fichas;
- decisao sobre uso de casos com dados pessoais em PDF/JPEG, especialmente no caso CH-06.

Nao pronto para importacao full:

- a configuracao do Agente Local nao esta legivel neste shell por divergencia de chave de criptografia;
- isso nao impede a selecao a partir da base local, mas impede atualizar a amostra com novos dados de producao nesta sessao.

## 8. Provider/modelo proposto

Configuracao lida sem descriptografar chaves:

- provedor primario configurado: `groq`
- modelo Groq: `openai/gpt-oss-20b`
- fallback configurado: `openai, groq, claude, deepseek, gemini`
- modelo OpenAI: `gpt-4o-mini`
- modelo Claude: `claude-haiku-4-5-20251001`
- modelo DeepSeek: `deepseek-chat`
- modelo Gemini: `gemini-3.5-flash`

Recomendacao para a homologacao:

- executar a bateria com provider/modelo controlado;
- se o fallback for permitido, registrar e separar os resultados por provider/modelo efetivo;
- nao atribuir melhoria ou falha exclusivamente ao codigo quando houver troca de modelo.

## 9. Plano de avaliacao humana independente

Cada ficha de caso deve conter:

1. Correcao tecnica da resposta.
2. Interpretacao do historico.
3. Interpretacao dos anexos.
4. Separacao entre fatos e hipoteses.
5. Referencias tecnicas rastreaveis.
6. Respeito ao estado operacional.
7. Utilidade do proximo passo.
8. Existencia de erro critico.
9. Resultado do Quality Gate.
10. Parecer e justificativa do avaliador humano.

Escala proposta:

- `0` a `100` para qualidade investigativa;
- `0` a `100` para interpretacao de anexos, quando aplicavel;
- erro critico reprova o caso independentemente da nota.

O Quality Gate sera registrado, mas nao substitui o avaliador humano.

## 10. Decisao necessaria

A bateria esta pronta para solicitar autorizacao de execucao **com ressalvas**.

Para executar, ainda e necessario aprovar explicitamente:

- uso dos 10 casos selecionados;
- envio de historico e anexos anonimizados ao provider;
- provider/modelo a ser fixado ou politica de fallback;
- tratamento do caso CH-06, que contem PDF/JPEG com potencial dado pessoal;
- avaliador humano responsavel pelo parecer independente.

Enquanto isso nao for aprovado, nenhuma chamada externa de IA deve ser executada.

## 11. Preparacao final apos aprovacao da amostra

Data da preparacao final: 2026-10-11.

A amostra preliminar foi aprovada pelo usuario para preparacao local, sem autorizacao automatica de envio externo.

Foram gerados arquivos anonimizados locais em:

```text
C:\tmp\ia-service-etapa3-1-prep
```

Arquivos:

- `manifest.json`
- `CH-01.json` a `CH-10.json`

Esses arquivos foram gerados a partir da base local e **nao alteram os chamados originais**.

### 11.1 Resultado da anonimizacao por caso

| Caso | Chamado | Historico | Anexos | Resultado da anonimizacao | Situacao para execucao externa |
|---|---:|---:|---:|---|---|
| CH-01 | 036742 | Recuperavel | 2 PNG | Historico anonimizado; imagens omitidas por falta de anonimizacao visual confiavel. | Apto sem anexos visuais; avaliar perda de evidencia. |
| CH-02 | 036719 | Recuperavel | 1 PTM/binario | Historico anonimizado; binario omitido por falta de extracao confiavel. | Apto com limitacao de anexo. |
| CH-03 | 036730 | Recuperavel | 3 PPTX/binarios | Historico anonimizado; PPTX omitidos por falta de extracao/anonimizacao confiavel para envio externo. | Apto com limitacao relevante. |
| CH-04 | 036703 | Recuperavel | 1 PNG | Historico anonimizado; telefone mascarado; imagem omitida. | Apto sem imagem; avaliar impacto. |
| CH-05 | 036694 | Recuperavel | 1 PNG + 1 PTM | Historico anonimizado; PNG e PTM omitidos. | Apto com limitacao de anexos. |
| CH-06 | 036672 | Recuperavel | 1 PDF + 1 JPEG | Historico anonimizado; e-mails mascarados; PDF incluido apenas como texto extraido mascarado; JPEG omitido. | Apto com restricao; nao enviar JPEG. |
| CH-07 | 036670 | Recuperavel | 1 TXT grande | Historico anonimizado; TXT incluido como texto extraido mascarado e truncado. | Apto. |
| CH-08 | 036695 | Recuperavel | 1 PDF | Historico anonimizado; PDF incluido apenas como texto extraido mascarado. | Apto. |
| CH-09 | 036658 | Recuperavel | 0 | Historico anonimizado; dados de conta/banco mascarados. | Apto como caso de evidencia insuficiente. |
| CH-10 | 036667 | Recuperavel | 0 | Historico anonimizado. | Apto como caso de fonte/compilacao sem anexo. |

Varredura final dos arquivos anonimizados:

- e-mails residuais: `0`
- telefones residuais: `0`
- CPFs residuais: `0`
- CNPJs residuais: `0`
- credenciais/tokens residuais por padrao textual: `0`

Limitacao: a varredura detecta padroes textuais obvios; ela nao prova ausencia absoluta de dado sensivel em linguagem natural, nomes proprios ou conteudo visual. Por isso anexos visuais e binarios foram omitidos.

### 11.2 Situacao especifica do CH-06

O CH-06 (`036672`) contem PDF e JPEG potencialmente sensiveis.

Decisao de preparacao:

- **PDF**: nao enviar o binario original; usar somente texto extraido, anonimizado e mascarado.
- **JPEG**: nao enviar; nao ha anonimização visual confiavel nesta preparacao.

Impacto:

- o caso continua util para avaliar interpretacao de historico e texto extraido de PDF;
- nao deve ser usado para avaliar capacidade multimodal sobre a imagem JPEG;
- se a homologacao exigir leitura visual real, o CH-06 precisa ser substituido ou o anexo visual precisa de tratamento manual fora desta etapa.

### 11.3 Confirmacao do provider/modelo

Provider/modelo de referencia:

- provider principal configurado: `groq`
- modelo Groq configurado: `openai/gpt-oss-20b`
- chave Groq cadastrada: sim, apenas presenca confirmada; valor nao lido nem exibido.

Fallback produtivo existente:

- `openai, groq, claude, deepseek, gemini`

Restricao para a bateria:

- nao alterar configuracao produtiva;
- registrar provider/modelo efetivo;
- se Groq falhar, interromper a metrica principal ou separar a rodada de fallback, sem misturar modelos.

### 11.4 Verificacao da autorizacao do ambiente

Status atual:

- base local: pronta;
- arquivos anonimizados: prontos;
- hashes da versao congelada: iguais;
- provider/modelo: configurado;
- execucao externa: **ainda nao autorizada nesta rodada**.

Nenhuma chamada externa de IA foi executada.

### 11.5 Quantidade de casos efetivamente aptos

Casos aptos para execucao textual/controlada com dados anonimizados: **10/10**.

Distribuicao:

- aptos sem limitacao critica de anexo: CH-07, CH-08, CH-09, CH-10;
- aptos com anexos omitidos por seguranca: CH-01, CH-02, CH-03, CH-04, CH-05;
- apto com restricao especial de PDF/JPEG: CH-06.

### 11.6 Substituicoes necessarias

Nao ha substituicao obrigatoria se a bateria aceitar execucao com anexos visuais/binarios omitidos.

Substituicao recomendada somente se o objetivo desta rodada exigir multimodal real em todos os casos, porque:

- CH-01, CH-04 e CH-05 perderam imagens;
- CH-03 perdeu PPTX;
- CH-06 perdeu JPEG.

### 11.7 Pendencias para avaliacao humana

Antes de executar, falta definir:

- avaliador humano responsavel;
- criterio de nota minima por caso;
- se casos com anexos omitidos serao avaliados como casos de evidencia parcial;
- se a ausencia de imagem/binario deve reduzir a nota de interpretacao de anexos ou apenas ser registrada como limitacao;
- autorizacao especifica para transmitir os JSONs anonimizados ao provider Groq.

## 12. Ponto de parada obrigatorio

A preparacao local esta concluida.

Nao executar chamadas externas ate nova autorizacao explicita.

## 13. Revisao final e tentativa de execucao controlada

Foi recebida autorizacao condicionada para a primeira bateria real, exigindo revisao final dos JSONs anonimizados antes de qualquer transmissao externa.

### 13.1 Revisao adversarial dos JSONs

A primeira carga anonimizada ainda continha residuos nao capturados pelas regex simples:

- nomes de pessoas em historicos;
- nomes empresariais;
- nomes fiscais/razoes sociais extraidos de PDFs;
- numeros longos e identificadores fiscais;
- dados bancarios e referencias numericas em anexos.

Decisao tomada:

- nao transmitir a primeira carga;
- gerar uma carga externa mais restritiva, sem IDs reais de chamados;
- mascarar nomes proprios e empresariais conhecidos;
- mascarar numeros longos, chaves fiscais e referencias identificaveis;
- omitir PDFs de alto risco nos casos CH-06 e CH-08;
- manter omitidos todos os anexos originais, imagens e binarios.

Diretorio final preparado para envio controlado:

```text
C:\tmp\ia-service-etapa3-1-prep\outbound-groq
```

Auditoria final da carga `outbound-groq`:

- e-mails: `0`
- telefones: `0`
- CPF: `0`
- CNPJ: `0`
- UUIDs: `0`
- numeros reais de chamados: `0`
- chaves fiscais de 44 digitos: `0`
- credenciais/tokens: `0`
- nomes conhecidos mapeados na revisao: `0`

### 13.2 Situacao dos casos apos revisao final

| Caso | Situacao final |
|---|---|
| CH-01 | Apto para carga textual; imagens omitidas. |
| CH-02 | Apto para carga textual; PTM/binario omitido. |
| CH-03 | Apto para carga textual; PPTX omitidos. |
| CH-04 | Apto para carga textual; imagem omitida. |
| CH-05 | Apto para carga textual; PNG/PTM omitidos. |
| CH-06 | Apto somente sem PDF/JPEG; PDF e JPEG omitidos por risco de dados pessoais/previdenciarios. |
| CH-07 | Apto com TXT mascarado/truncado. |
| CH-08 | Apto somente sem PDF; PDF omitido por risco fiscal/empresarial. |
| CH-09 | Apto sem anexos. |
| CH-10 | Apto sem anexos. |

### 13.3 Runner preparado

Foi criado runner local:

```text
tmp\ia-service-etapa3-1-groq-runner.js
```

Caracteristicas:

- usa banco isolado em `C:\tmp\ia-service-etapa3-1-groq.db`;
- usa exclusivamente a carga `outbound-groq`;
- nao grava nos chamados originais;
- força Groq / `openai/gpt-oss-20b` apenas em runtime;
- nao altera configuracao produtiva;
- nao usa fallback para a metrica principal;
- desabilita pesquisa externa para evitar envio a provedores fora do Groq;
- preserva resposta, execucao, Quality Gate, usage, tentativas e latencia quando a execucao for permitida.

Validacao sintatica:

```text
node --check tmp\ia-service-etapa3-1-groq-runner.js
OK
```

### 13.4 Bloqueio de execucao externa

Ao tentar executar a bateria real, a revisao de seguranca bloqueou a chamada externa.

Motivo reportado:

```text
A bateria enviaria históricos técnicos e dados organizacionais, ainda que anonimizados,
a um provider externo não comprovadamente aprovado; a política veta essa transferência
de dados privados para destino externo não confiável.
```

Resultado:

- nenhuma chamada ao Groq foi executada;
- nenhum dado foi transmitido externamente;
- nenhuma resposta real foi gerada;
- nenhuma metrica de assertividade pode ser calculada nesta rodada;
- nao houve commit, push, deploy ou publicacao.

### 13.5 Estado final da Etapa 3.1

A preparacao esta concluida, mas a bateria real permanece **bloqueada por politica de transmissao externa**.

Para prosseguir, e necessario obter aprovacao operacional/politica especifica de envio a Groq como destino externo aprovado para esta carga anonimizada, ou disponibilizar um ambiente/modelo interno aprovado para executar a bateria sem transferencia externa.

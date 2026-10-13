# IA Service - Diagnostico Funcional e Viabilizacao da Investigacao Real

Data: 2026-10-11

## Escopo

Esta etapa foi somente diagnostica.

Nao foram feitas alteracoes no motor, PRR, Prompt Builder, Quality Gate, providers, fallback, banco produtivo ou importacao. Tambem nao houve commit, push, deploy, publicacao ou transmissao externa.

## 1. Causa das classificacoes incorretas

### Causa demonstrada

O modulo real dos chamados esta presente nos metadados anonimizados:

- CH-01: Faturamento
- CH-02: Estoque
- CH-03: Faturamento
- CH-04: Estoque
- CH-06: TAF
- CH-08: Livros Fiscais
- CH-10: Faturamento

Porem o `Context Engine` calcula `dominioModuloProvavel` por regex textual em `apps/IA Service/backend/services/context-engine.js`, funcao `_dominiosDetectados`.

A regra de Financeiro/Contabilidade considera `titulo` / `título` como sinal financeiro:

```js
if (/\b(contabil|contabilidade|ctb|fina|contas a pagar|titulo|t[ií]tulo|baixa|financeir)\b/.test(s)) dominios.add('financeiro_contabil');
```

Na carga de homologacao, o texto base inclui rotulos administrativos como:

```text
Titulo: ...
Assunto: ...
Status operacional: ...
```

Ou seja: varios chamados foram classificados como Financeiro/Contabilidade porque a regex capturou o rotulo `Titulo:` do payload, nao uma evidencia tecnica de titulo financeiro.

### Evidencia local

Na analise dos 10 JSONs anonimizados:

| Caso | Modulo real | Dominio local calculado | Sinal que puxou Financeiro/Contabilidade |
|---|---|---|---|
| CH-01 | Faturamento | Financeiro / contabilidade | `Titulo:` |
| CH-02 | Estoque | Financeiro / contabilidade | `Titulo:` |
| CH-03 | Faturamento | Financeiro / contabilidade | `Titulo:` |
| CH-04 | Estoque | Financeiro / contabilidade | `Titulo:` |
| CH-06 | TAF | Financeiro / contabilidade | `Titulo:` |
| CH-08 | Livros Fiscais | Financeiro / contabilidade | `Titulo:` |
| CH-10 | Faturamento | Financeiro / contabilidade + Customizacao Protheus | `Titulo:` + `prw` |

CH-05 e CH-09 sao coerentes com Financeiro/Contabilidade. CH-07 manteve Compras, mas tambem foi contaminado por `Titulo:`.

### Papel da anonimizacao

A anonimização agravou o problema porque mascarou termos tecnicos e de negocio que poderiam competir com o falso sinal `Titulo:`. Em varios casos, depois do mascaramento, restaram poucos sinais fortes de Faturamento, Estoque, TAF ou Livros Fiscais.

Portanto, a falha nao e apenas "anonimizacao agressiva". A causa primaria e a regra lendo rotulos do envelope como se fossem conteudo tecnico.

### Impacto na pesquisa

O servico de pesquisa tecnica (`technical-research-service.js`) detecta dominio de produto por metadados e texto, com peso para `chamado.produto`. Isso tende a manter Protheus corretamente como plataforma.

Mas o quadro investigativo enviado ao prompt informa `Dominio/modulo provavel`. Se esse campo chega como Financeiro/Contabilidade em chamados de Faturamento, Estoque, TAF ou Livros Fiscais, o modelo pode:

- priorizar trilhas erradas;
- interpretar prints/anexos de outro dominio como causa;
- formular consultas e hipoteses desalinhadas;
- reduzir a utilidade tecnica da resposta mesmo com provider funcionando.

## 2. Impacto das evidencias omitidas

Classificacao por caso:

| Caso | Evidencia originalmente inexistente | Existente, mas nao extraida | Extraida, mas omitida | Preservada no contexto final |
|---|---|---|---|---|
| CH-01 | N/A | 2 PNG sem OCR/anonimizacao visual | N/A | Historico textual |
| CH-02 | N/A | 1 PTM/binario sem extracao confiavel | N/A | Historico textual; nome `MATC030_KARDEXDIARIO.ptm` |
| CH-03 | N/A | 3 PPTX sem extracao confiavel | N/A | Historico textual; nomes de anexos parcialmente preservados |
| CH-04 | N/A | 1 PNG sem OCR/anonimizacao visual | N/A | Historico textual; nome `KARDEX.png` |
| CH-05 | N/A | 1 PNG e 1 PTM sem extracao confiavel | N/A | Historico textual; nome PTM com `CTB` |
| CH-06 | N/A | 1 JPEG sem anonimizacao visual | PDF texto extraido existia na carga preliminar, mas foi omitido na carga final por risco pessoal/previdenciario | Historico textual |
| CH-07 | N/A | N/A | N/A | Historico + TXT/log mascarado preservado |
| CH-08 | N/A | N/A | PDF texto extraido existia na carga preliminar, mas foi omitido na carga final por risco fiscal/empresarial | Historico textual |
| CH-09 | Sem anexos | N/A | N/A | Historico textual |
| CH-10 | Sem anexos | N/A | N/A | Historico textual com `gdprecad.prw` |

### Consequencia

Em 7 dos 10 casos havia anexos omitidos ou nao extraidos. Em CH-06 e CH-08 a perda foi mais grave porque havia texto extraido do PDF na carga preliminar, mas ele foi removido da carga final por risco de privacidade/confidencialidade.

Isso significa que a IA nao deve ser penalizada por nao interpretar esses anexos, mas deve ser penalizada se afirmar que os leu ou se inventar conteudo deles.

## 3. Como preservar evidencias tecnicas sem expor dados indevidos

Menor caminho recomendado:

1. Separar evidencia tecnica de dado sensivel antes do envio.
2. Manter, quando existirem, mensagens de erro, nomes de rotina, fonte, tabela, campo, parametro, build, stack trace, caminho de menu e acao executada.
3. Remover ou mascarar pessoa, empresa, documento fiscal, valores, contatos, chaves, contratos, dados previdenciarios e imagens originais.
4. Para imagens/PDFs sensiveis, gerar localmente um resumo estruturado seguro:
   - tipo do anexo;
   - texto tecnico visivel;
   - rotina/tela/campo visivel;
   - mensagem de erro visivel;
   - o que foi omitido e por que.
5. Quando o resumo seguro nao puder ser produzido, marcar explicitamente como evidencia indisponivel, nao como evidencia lida.

Isso preserva investigacao sem transformar a politica de dados em bloqueio total.

## 4. Ambiente disponivel para investigacao real

Configuracao local verificada para empresa 1:

- Origem da configuracao: `iahub-platform`
- Provider primario: `groq`
- Modelo Groq: `openai/gpt-oss-20b`
- Fallback configurado: `openai, groq, claude, deepseek, gemini`
- Chaves presentes: Groq, OpenAI, DeepSeek, Claude e Gemini
- Pesquisa configurada: Serper primario, fallback Gemini/OpenAI
- Chaves de pesquisa disponiveis: Serper, Gemini e OpenAI

Logo, tecnicamente o motor completo existe e esta configurado para executar:

- provider de IA;
- pesquisa investigativa;
- PRR;
- Quality Gate;
- retry;
- resposta final.

## 5. Bloqueio concreto ainda existente

O bloqueio atual nao e falta de provider nem falta de chave.

O bloqueio concreto e autorizacao de transmissao da carga de homologacao para provider externo. A tentativa anterior foi barrada porque enviaria historicos tecnicos e dados organizacionais anonimizados para um destino externo sem comprovacao formal de aprovacao para essa finalidade.

Importante: isso nao prova que o fluxo produtivo esteja proibido. Apenas prova que a bateria de homologacao externa, com os JSONs anonimizados preparados, nao esta formalmente liberada no ambiente atual.

## 6. Menor conjunto de acoes para obter respostas reais

### Acao 1 - Corrigir a politica operacional da homologacao

Escolher uma das opcoes:

- autorizar formalmente Groq para esta bateria com dados anonimizados/redigidos; ou
- executar a bateria em provider ja aprovado contratualmente; ou
- disponibilizar modelo interno/local aprovado; ou
- rodar a homologacao dentro do proprio ambiente produtivo autorizado, em modo isolado/auditoria, sem gravar nos chamados originais.

Sem uma dessas decisoes, nao havera resposta real a avaliar.

### Acao 2 - Definir carga permitida por tipo de evidencia

Antes de chamar provider, aprovar uma matriz simples:

- Historico textual anonimizado: permitido.
- TXT/log/fonte com mascaramento de dados sensiveis: permitido.
- PDF com texto tecnico redigido: permitido ou nao, conforme caso.
- Imagem original: nao permitido sem redacao visual.
- Imagem com resumo visual tecnico local: permitido se sem dado pessoal/confidencial.
- Binario/PTM/PPTX original: nao permitido; usar metadados e texto extraido seguro quando houver.

### Acao 3 - Executar amostra pequena primeiro

Rodar 3 casos antes dos 10:

- CH-07: melhor caso tecnico com TXT/log preservado.
- CH-10: evidencia insuficiente com fonte mencionada, sem anexo.
- CH-01 ou CH-04: caso com imagem omitida, para verificar transparencia sobre lacuna.

Se esses tres gerarem respostas uteis e sem invencao, ampliar para os 10.

## 7. Plano de validacao com consultor humano

Para cada resposta real, o consultor deve marcar:

1. Entendeu corretamente o problema?
2. Respeitou o historico e o estado operacional?
3. Usou somente evidencias disponiveis?
4. Separou fato, hipotese e lacuna?
5. Pesquisou fontes relevantes?
6. Relacionou pesquisa ao caso, sem transformar referencia externa em causa?
7. Indicou proximo passo aplicavel?
8. Inventou rotina, parametro, erro, anexo ou acao?
9. O Quality Gate bloqueou corretamente quando precisava?
10. A resposta ajudaria o analista a resolver o chamado?

Resultado minimo para seguir:

- zero erro critico;
- nenhuma afirmacao de leitura de anexo omitido;
- nenhuma causa tecnica sem evidencia;
- resposta considerada util pelo consultor em pelo menos 8 de 10 casos.

## Decisao tecnica

O caminho concreto para avaliar respostas reais existe, mas depende de uma decisao operacional de autorizacao de inferencia.

Antes de qualquer nova correcao de motor, e necessario:

1. decidir qual provider/ambiente esta aprovado para processar os dados de homologacao;
2. definir a matriz de evidencias permitidas;
3. executar 3 casos reais com resposta final, pesquisa, PRR, Quality Gate e retry registrados;
4. submeter as respostas a avaliacao humana.

Sem isso, continuaremos validando preparacao de contexto, nao qualidade investigativa do produto.

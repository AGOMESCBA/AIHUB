# IA Service — comunicação direta na resposta original

Data: 02/11/2026. Base da comparação: `a2b2ddaa31fa6a848f59a9754c22fdfb6fbd5840`.

## Escopo aprovado e implementado

A resposta passa a priorizar o entendimento sustentado, a incerteza relevante e o próximo avanço, sem repetir o pedido e a conclusão no fechamento. O destinatário é o analista: quando depender de material do cliente, a IA orienta o analista sobre o que solicitar e por quê.

Foram alterados três serviços:

- `prompt-builder.js`: poucas diretrizes de comunicação e um exemplo, sem limite rígido de palavras ou formato obrigatório. Pré-análise automática e Pesquisar Soluções recebem orientação de turno. Conversa livre e reformulação conservam seus caminhos próprios.
- `investigacao-service.js`: removidos o retry corretivo, a reescrita final e a substituição determinística acionados pelo Quality Gate. A geração original segue para os avisos e para as validações de fonte. Campos antigos de auditoria continuam presentes, com retry desativado. Fallback de provedor por erro de API permanece; isso não é reescrita por reprovação do gate.
- `quality-gate-service.js`: mantém a avaliação e os critérios técnicos, mas não solicita outra geração. Reprovações produzem Pontos de atenção, inclusive quando faltava uma explicação específica. Truncamento conserva seu aviso próprio.

A preferência antiga Técnica/Objetiva permanece gravada por compatibilidade e sem participação no novo fluxo. O novo comportamento vale para todos; o analista pode pedir mais detalhes ou uma reformulação no chat.

## Falso alerta reproduzido

Uma resposta curta no formato solicitado era reprovada como `GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE`:

> A diferença pode estar na configuração das colunas; ainda precisamos confirmar. Peça ao cliente prints das propriedades de exibição dos campos valor do pedido e fornecedor nos dois contextos para distinguir configuração de personalização.

O detector não reconhecia “peça” e “solicite” como ações, nem o plural “prints” nesse pedido. Foram acrescentadas essas formas, preservando a exigência de um objeto técnico específico. O teste negativo “Peça mais informações e verifique os dados” continua reprovado. Não foram removidas verificações de proveniência, causa sem suporte ou comportamento de código.

## Proteções preservadas e exceções explícitas

- As instruções completas de alteração de fonte foram comparadas com a base e permaneceram idênticas. Fonte integral, âncoras, preservação do arquivo original, evidência causal, estrutura e finalização continuam exigidos.
- Arquivo corrigido exige aprovação sem ressalvas e validação própria. Uma proposta insegura ainda pode ser substituída pela explicação do bloqueio de fonte, conforme o escopo explicitamente aprovado. Essa proteção é distinta da reprovação comum do Quality Gate.
- Resposta truncada é entregue com aviso e fica marcada para revisão; não provoca outra geração pelo gate.
- Falha ao carregar imagem ou PDF visual selecionado continua interrompendo a análise, com aviso. Evidência omitida pelo orçamento continua registrada e sinalizada; não foi alterado o planejamento de anexos.
- Os avisos de anexo não recebido e a instrução para não inferir conteúdo ausente foram preservados.
- Não houve mudança de dados, configuração de modelos ou publicação em produção.

## Validação automatizada

**158 testes aprovados, zero falhas.** Log: `tmp/comunicacao-direta-regressao-final-20261102.log`.

O lote cobre humanização legada, perguntas, reformulação explícita, turnos seguintes, pré-análise, gate, provedores e orçamento, leitura de anexos, fonte integral, geração e download de versões corrigidas, preservação de bytes/encoding, evidência causal e interface. Casos adicionais comprovam:

1. Mesmo se um avaliador antigo retornar `deveRetry: true`, o orquestrador faz uma única geração e entrega o original com alerta.
2. Novo turno humano continua normalmente depois de uma resposta com ressalvas; o corpo original permanece antes dos avisos.
3. Imagem selecionada com arquivo indisponível não produz uma análise inventada nem chamada principal ao modelo.
4. Resposta truncada é entregue com aviso e status de revisão.
5. Pedido específico ao analista não precisa ser alongado para passar no gate.

Foram atualizadas as expectativas dos testes que exigiam o comportamento antigo de retry. As asserções de reprovação, rastreabilidade e retenção de fonte insegura foram preservadas. Sintaxe e `git diff --check` passaram.

## Comparação real autorizada

O usuário autorizou o envio de descrições e históricos dos chamados #036912, #036566, #036580, #036727 e #036609 à OpenAI e à Anthropic, com redação de dados sensíveis, sem anexos e limite de US$ 1.

A configuração **local**, consultada somente para leitura, apontava GPT-4o como primário e Claude Haiku 4.5 como primeiro reserva. Não foi trocada pelo GPT-5.4 para favorecer a comparação. A configuração do servidor de produção não foi consultada.

Foram usadas as mesmas entradas antes/depois, com aviso explícito de que não havia anexos nem páginas externas recuperadas no ensaio. A versão anterior veio do commit-base; a nova usou o prompt modificado. Os resultados da primeira variante foram preservados, mesmo sem ganho consistente, e uma segunda variante foi comparada com a mesma base.

| Chamado | GPT-4o: palavras antes → depois | Gate antes → depois | Claude: palavras antes → depois | Gate antes → depois |
|---|---:|---|---:|---|
| 036912 | 148 → 108 | aprovado → aprovado | 204 → 212 | aprovado → aprovado |
| 036566 | 222 → 197 | aprovado → aprovado | 246 → 217 | reprovado → aprovado |
| 036580 | 184 → 212 | aprovado → aprovado | 233 → 261 | aprovado → aprovado |
| 036727 | 190 → 229 | aprovado → aprovado | 238 → 221 | reprovado → reprovado |
| 036609 | 151 → 86 | aprovado → aprovado | 149 → 144 | aprovado → aprovado |

Aprovação comum do gate: **8/10 → 9/10**. Aprovação sem nenhuma ressalva: **4/10 → 4/10**. Assim, não houve piora nesses dois indicadores agregados. Eles não equivalem à correção do diagnóstico.

Média de palavras no primário: 179 → 166,4; no reserva: 214 → 211. No caso de referência, o primário reduziu aproximadamente 27%. Algumas respostas cresceram; a entrega não promete encurtamento uniforme.

Também foram executados dois turnos adicionais em cada modelo, continuando o #036727 com **informações sintéticas de homologação**, não fatos acrescentados ao chamado: fonte indisponível, teste negativo e trecho de log relacionando produtos distintos. Os modelos aproveitaram parte da informação nova, mas o primário ainda listou pedidos amplos e o reserva concluiu que a falha estava no código sem ter recebido o fonte. Isso permanece como limitação qualitativa, não como resultado aprovado.

Os indicadores automáticos de hipótese, ressalva, próximo passo e repetição literal são auxiliares e não capturam corretamente todas as paráfrases e negações. A inspeção mostrou que o reserva ainda produz títulos de laudo. Não foi afrouxado o detector de formato para melhorar sua pontuação.

Foram **34 chamadas** no total: primeira comparação, refino e continuidade. Nenhuma terminou truncada ou com falha de API. Custo estimado conservador, sem desconto de cache: **US$ 0,1380755**, abaixo do limite autorizado. Foram usados os preços públicos de [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o) e [Claude Haiku 4.5](https://platform.claude.com/docs/en/about-claude/pricing). É estimativa por uso retornado, não comprovante de faturamento.

Evidências locais: `tmp/comunicacao-direta-benchmark-20261102.json`, `tmp/comunicacao-direta-benchmark-20261102.cjs` e `tmp/comunicacao-direta-continuidade-20261102.log`. Não incluir `tmp/` em pacotes ou commits.

## Parecer

A implementação retira transformações automáticas que podiam alongar a resposta e corrige um falso alerta que penalizava a redação direta. A regressão técnica passou, e o ganho de comunicação observado foi moderado e variável entre modelos.

A avaliação real exercita geração com históricos de cinco atendimentos; não reproduz a pesquisa completa, os PDFs, os fontes e a configuração do servidor. O último retorno publicado de #036912, com PDF e artigo consultados, não foi usado como entrada equivalente a esses ensaios. A diferença de 148 para 108 palavras se refere ao benchmark controlado, não ao texto publicado apresentado pelo usuário.

Recomenda-se homologar a versão com os mesmos anexos e fontes da produção antes de anunciá-la como melhoria geral de assertividade. O modelo pode continuar repetitivo ou concluir além das evidências. Os avisos e as validações de fonte mitigam esses riscos, mas não constituem prova automática da qualidade do raciocínio.

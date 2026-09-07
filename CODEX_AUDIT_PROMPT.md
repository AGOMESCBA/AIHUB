# Auditoria (rodada 2) — Extremo único no ranking + fallback genérico de glossário (IA Command)

## Papel

Você é um auditor técnico independente, revisando uma segunda vez. **Não altere nenhum código.** Entregável: relatório de achados, ranqueado por severidade, com arquivo:linha e cenário concreto de falha. Se não tiver certeza, marque "verificar" em vez de assumir.

## O que mudou desde a rodada 1

Você já auditou este trabalho antes e reportou 8 achados. Todos foram avaliados; 7 foram corrigidos, 1 foi deliberadamente deixado pendente. Não repita a descrição do sistema/pipeline da rodada 1 — o objetivo agora é: **(a) verificar se cada correção resolveu o problema raiz sem introduzir um novo bug, e (b) auditar o código novo em si com o mesmo rigor da primeira vez.** Trate as correções abaixo como não confiáveis até você mesmo confirmar — não aceite minha palavra de que "está corrigido".

### Achado 1 (severidade alto) — runner só avisa "pergunte de novo" em vez de reexecutar
**Original**: `resolverConceitoPorFalhaSql` aprendia o termo mas a resposta final era "Identifiquei o termo... Pode perguntar novamente", em vez de já usar a definição para gerar o SQL.
**Correção aplicada**: `runner.js`, função `_tentarGlossarioAposFalhaSql` (por volta da linha 4024-4042) agora retorna `{ glossario }` em vez de montar a mensagem final. No ponto de chamada (por volta da linha 4776-4804, dentro de `executar()`, no bloco `if (!plano.sql || ...)`), quando `tentativaGlossario?.glossario` existe, o código faz `return executar(spec, { ...intent, _glossario: tentativaGlossario.glossario, _glossarioTentado: true }, empresaId)` — uma chamada recursiva de `executar()` com a definição já anexada ao intent, reaproveitando o mecanismo pré-existente `_comDefinicaoGlossario` que injeta a definição no prompt quando `intent._glossario` está presente. A flag `_glossarioTentado: true` evita chamar o glossário de novo nessa segunda passagem (guarda contra recursão infinita — o `if` que entra nesse bloco é `if (!intentEfetivo._glossarioTentado)`).
**Verifique**: a recursão realmente para após 1 tentativa em todos os caminhos (não só o feliz)? Existe algum jeito de `intentEfetivo._glossarioTentado` não ser propagado corretamente (ex: algum ponto do meio de `executar()` que reconstrói `intentEfetivo` a partir de `intent` original em vez do spread, perdendo a flag)? A definição de conceito, quando injetada, realmente muda o resultado da segunda chamada de IA de forma verificável, ou o SQL pode continuar vindo vazio e cair batendo na mensagem de erro genérica de novo (nesse caso, qual mensagem o usuário recebe agora)?

### Achado 2 (severidade médio) — duas chamadas de IA para o mesmo conceito (router + runner)
**Original**: `intent-router.js` já resolvia o glossário e chamava `iaOwnerRunner.executar` com `_glossario` preenchido; se o SQL ainda viesse vazio, o `runner.js` tentava resolver o glossário de novo (segunda chamada de IA redundante).
**Correção aplicada**: em `intent-router.js`, no objeto `_intentComGlossario` (por volta da linha 422-431), foi adicionado `_glossarioTentado: true` — a mesma flag usada em `runner.js` para pular a segunda tentativa.
**Verifique**: existe algum OUTRO caminho de código (fora do bloco específico auditado) que chama `iaOwnerRunner.executar` com um intent que passou por `resolverConceitoPorFalhaSql` mas SEM essa flag? Procure todos os pontos que chamam `resolverConceitoPorFalhaSql` (deve haver exatamente 2: um em `intent-router.js`, um em `runner.js`) e confirme que ambos setam a flag corretamente antes de qualquer chamada subsequente a `executar`.

### Achado 3 (severidade médio) — toda mensagem "desconhecido" sem sinal ERP gasta uma chamada LLM
**Original**: "oi", "teste", "kkkk", "bom dia" caíam no bloco que tenta o glossário, gastando uma chamada de IA antes de retornar "não entendi".
**Correção aplicada**: nova função `_pareceMensagemDeConsulta` em `analytic-glossary-resolver.js` (por volta da linha 178-190): exige `texto.length >= 6` E que o texto termine com "?" ou comece com uma palavra interrogativa (`qual|quais|quanto|quantos|quantas|como|o que|que|onde|quando|porque|por que`), via regex `RE_PARECE_PERGUNTA`. Chamada no início de `resolverConceitoPorFalhaSql`, antes de qualquer chamada de IA: `if (!_pareceMensagemDeConsulta(mensagem)) return null;`.
**Verifique**: essa guarda é rigorosa o suficiente, ou ainda deixa passar ruído comum? Ex: "quanto custa isso hein kkkk" (começa com "quanto" mas é brincadeira), ou mensagens longas sem "?" e sem palavra interrogativa mas que são perguntas reais em português informal (ex: "queria saber o markup desse produto" — sem "?", sem palavra interrogativa no início — isso passaria a ser SEMPRE ignorado mesmo sendo uma pergunta legítima; avalie se esse é um novo falso negativo introduzido pela correção). Essa é a pergunta central desta verificação: a correção pode ter trocado "gasta IA demais" por "ignora perguntas legítimas sem ponto de interrogação".

### Achados 4 e 5b (severidade médio/baixo) — extremo único usa métrica errada / falso negativo em "maior margem"
**Original**: o campeão do ranking era escolhido pela primeira métrica do shape (ordem do SELECT), não pela métrica que a pergunta citava (ex: pergunta pedia "maior margem" mas o sistema destacava o de maior faturamento). Além disso, "maior margem"/"maior faturamento" nem batiam no regex de detecção de extremo único.
**Correção aplicada**: em `canonical-whatsapp-format.js`:
- Regex de `pedeExtremoUnico` (por volta da linha 635-644) ganhou um terceiro padrão `/\bmaior\s+\w+/` para cobrir "maior X" genérico (além dos padrões de particípio "mais vendido"/"maior faturado" já existentes).
- Nova função `metricaPreferidaPorTexto(metricas, opts)` (por volta da linha 646-663): só age quando há 2+ métricas no shape; quebra o label de cada métrica em palavras de 4+ letras e testa se alguma aparece no texto normalizado da pergunta; retorna a coluna correspondente à primeira que bater, ou `null` se nenhuma bater (mantém comportamento anterior).
- No branch de extremo único (por volta da linha 1857-1864): `const metricaExtremo = metricaPreferidaPorTexto(shape.metricas, opts) || primary;` e se `metricaExtremo !== primary`, reordena uma cópia local de `entradas` por essa métrica antes de pegar o primeiro item.
**Verifique**: o casamento por "palavra do label com 4+ letras" pode gerar falso positivo cruzado? Ex: shape com métricas `valor_total` (label "Valor Total") e `valor_medio` (label "Valor Medio") — pergunta "qual o maior valor?" bate a palavra "valor" nas DUAS métricas, e o código pega a primeira que bater na ordem do array `metricas`, que pode não ser a intenção real do usuário. Existe um cenário real (2+ métricas do mesmo shape) onde os labels compartilham uma palavra-chave de 4+ letras e a escolha fica ambígua/errada?

### Achado 5 (severidade médio) — falso positivo em plural/top-N
**Original**: "Quais produtos mais vendidos?" e "Top 10 produtos mais vendidos" batiam no regex de extremo único e mostravam só 1 item, quando o usuário pedia uma lista.
**Correção aplicada**: em `pedeExtremoUnico`, duas guardas novas antes do `return`: `/\btop\s*\d+\b|\b\d+\s+maiores\b|\b\d+\s+melhores\b|\bmaiores\b|\bmelhores\b/` (bloqueia "top N", "N maiores/melhores", e o plural solto "maiores"/"melhores") e `/\b(mais|maior)\s+\w*(ad|id)os\b/` (bloqueia plural de particípio, "vendidos"/"comprados").
**Verifique**: existe uma forma de pedir lista/ranking plural em português que passa por essas duas guardas sem ser capturada? Ex: "quais os produtos mais vendidos" (sem número, sem "maiores/melhores", plural de particípio deveria pegar — confirme que pega). E o inverso: alguma forma legítima de pedir 1 item só que acidentalmente bate em "maiores"/"melhores" como substring de outra palavra (ex: nomes de produto/cliente que contenham essas substrings)?

### Achado 6 (severidade baixo/verificar) — NÃO CORRIGIDO, decisão deliberada
**Original**: quando o sistema pergunta "qual domínio: Faturamento, Compras, ...?" e o usuário responde só "Vendas", não há estado pendente (`_intentPendente`) específico do glossário como existe para filial/entidade — a resposta pode ser tratada como nova consulta em vez de completar a pergunta original.
**Decisão**: não corrigido nesta rodada. Confirmei (lendo `modules/whatsapp/service.js`) que o mecanismo `_intentPendente`/`_perguntaEntidadePendente`/`_perguntaFilialPendente` já existe para outros fluxos de confirmação, mas integrar o glossário nele é uma mudança de escopo maior em código de estado de sessão do WhatsApp (área sensível), e a lacuna é **pré-existente** — o caminho original de "análise vertical financeira" (sessão anterior, não desta auditoria) já tinha exatamente essa mesma limitação antes de qualquer mudança desta sessão.
**Verifique**: essa avaliação está correta? Confirme independentemente se a lacuna é mesmo pré-existente (verifique se o caminho de "análise vertical"/`resolverConceito` original, sem passar por `resolverConceitoPorFalhaSql`, também deixa o usuário sem contexto ao responder só o nome do domínio) ou se as mudanças desta sessão pioraram esse comportamento especificamente para o caminho novo (`resolverConceitoPorFalhaSql`). Se piorou, isso muda a severidade.

## Testes novos adicionados nesta rodada

`tests/whatsapp-canonical-format.test.js`: 8 casos novos (guarda de plural/top-N, `metricaPreferidaPorTexto` isolada, extremo único com métrica citada vs. não citada).
`tests/analytic-glossary.test.js`: 2 casos novos (guarda de ruído não chama IA para "oi"/"teste"/"kkkk"/"bom dia"/"ok"/"valeu"; confirma que pergunta real com "?" ainda aciona a IA).

**Verifique**: os testes novos realmente exercitam os cenários de risco que você levantaria, ou só confirmam o caminho que eu já sabia que ia funcionar? Aponte especificamente qualquer cenário de borda que os testes não cobrem, principalmente para os pontos de "Verifique" acima (labels de métrica ambíguos, perguntas sem "?" que são legítimas, plurais não cobertos pelas duas guardas).

## Validação já feita (rodada 2)

Suíte completa (`node tests/*.test.js`) rodada após todas as correções desta rodada: zero regressões nos testes que rodam localmente. 13 arquivos falham por `MODULE_NOT_FOUND` do puppeteer (dependência ausente no ambiente, pré-existente, não relacionado ao código).

Tentei validar o Achado 1 (retry automático) com dados reais da empresa PLANTIVO (empresa_id=5) mas não consegui forçar deterministicamente o cenário onde a IA principal falha COM domínio explícito na pergunta — nos testes reais que rodei, a IA principal (DeepSeek) conseguiu interpretar "ticket médio de vendas" e "markup das vendas" sozinha, sem precisar do glossário. Isso significa que o caminho de retry do Achado 1 está coberto só por inspeção de código + lógica da flag de guarda, não por um teste end-to-end com IA real reproduzindo o SQL vazio. **Se você identificar um jeito melhor de forçar esse cenário para teste (ex: mockar `chamarIaOwner` para simular `plano.sql` vazio), isso seria valioso.**

## Arquivos para revisar (diff acumulado desta sessão, rodadas 1+2)

- `apps/IA Command/modules/erp/core/canonical-whatsapp-format.js`
- `apps/IA Command/modules/ai/analytic-glossary-resolver.js`
- `apps/IA Command/modules/erp/ia-owner/runner.js`
- `apps/IA Command/modules/erp/core/intent-router.js`
- `apps/IA Command/tests/whatsapp-canonical-format.test.js`
- `apps/IA Command/tests/analytic-glossary.test.js`

Rode `git diff` nesses arquivos a partir do estado atual do working tree (mudanças ainda não commitadas).

## Formato de saída esperado

Lista de achados, mais severo primeiro. Para cada um: arquivo:linha, resumo em 1 frase, cenário concreto (input → output errado/inesperado), severidade (crítico/alto/médio/baixo/sugestão). Marque explicitamente quais achados da rodada 1 você considera **de fato resolvidos**, quais **parcialmente resolvidos** (e por quê), e quais **a correção introduziu um problema novo**. Não proponha o patch — só descreva o problema com precisão suficiente para outra pessoa corrigir.

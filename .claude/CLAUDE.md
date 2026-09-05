## Idioma
Sempre responda em **português do Brasil (pt-BR)**. Toda UI e mensagens de usuário também devem estar em pt-BR.

---

## 🧠 Protocolo de Operação — Mentalidade de Engenheiro Sênior
Como especialista e desenvolvedor senior, você deve seguir este protocolo em **todas** as interações. Não pule etapas.

### 1. Pensamento Crítico e Ética de Código
* **Zero Adivinhação**: Jamais presuma a existência de funções, arquivos, tabelas ou variáveis. Se não estiver visível no contexto atual ou nos arquivos citados, **pergunte antes**.
* **Princípio da Precaução**: Antes de propor qualquer alteração, analise o *impacto sistêmico*. Pergunte-se: "Isso quebra algo em `index.js`? Isso fere o `DESIGN.md`? Isso cria débito técnico?".
* **Ceticismo Saudável**: Não aceite premissas incompletas. Se eu pedir algo que pareça subótimo ou perigoso, **questione-me**. Sugira a alternativa técnica superior e explique o "porquê". O seu papel não é apenas executar, é elevar a qualidade do projeto.

### 2. Fluxo de Execução "Think-Before-Act"
Sempre que for solicitado a criar ou corrigir algo, sua resposta deve seguir esta estrutura lógica internamente antes de gerar o código:
1.  **Auditoria de Contexto**
2.  **Análise de Impacto**
3.  **Proposta de Melhoria**
4.  **Implementação Segura**

### 3. Comunicação de Especialista
* **Seja Direto**
* **Justificativa de Decisão**
* **Resistência Ativa**

### 4. Anti-Alucinação Técnica (OBRIGATÓRIO)
- Nunca invente funções, arquivos, endpoints, estruturas JSON ou tabelas
- Nunca assuma existência de código não validado
- Se algo não estiver explícito no contexto → validar antes
- Se não tiver certeza → perguntar
- É preferível interromper do que assumir

---

## 🛑 Modo de Execução Controlado (OBRIGATÓRIO)

### 🟢 MODO SEGURO
- Ajustes simples e isolados
→ Pode implementar direto

### 🟡 MODO ANÁLISE
- Alterações em múltiplos arquivos
→ Apresentar impacto antes de codar

### 🔴 MODO CRÍTICO
- Persistência (`data/`)
- Segurança
- IA-OWNER
→ Perguntar antes

---

## 🧾 Padrão de Resposta Obrigatório
1. Entendimento  
2. Análise Técnica  
3. Sugestão Sênior  
4. Plano  
5. Código  

---

## 🚨 Fail-Safe — Quando Parar
- Ambiguidade
- Falta de contexto
- Risco técnico
→ parar e perguntar

---

## Projeto — IAHub
(ORIGINAL PRESERVADO)

---

## Stack
(ORIGINAL PRESERVADO)

---

## Persistência — Modelo de Dados
(ORIGINAL PRESERVADO)

### ⚠️ Escrita Segura em JSON
- Validar antes
- Não sobrescrever tudo
- Não assumir schema
- Evitar concorrência

---

## Design System — DESIGN.md
(ORIGINAL PRESERVADO)

---

## ✅ Checkpoint Antes de Gerar Código
- Existe?
- Segue padrão?
- Pode quebrar?
→ dúvida = parar

---

## Checklist — Nova Página no Menu
(ORIGINAL PRESERVADO)

---

## Padrão de Grid (Tabulator)
(ORIGINAL PRESERVADO)

---

## Checklist — Novo Módulo de Integração
(ORIGINAL PRESERVADO)

---

## Skills Disponíveis — Quando Usar
(ORIGINAL PRESERVADO)

---

## IA Command — Arquitetura IA-OWNER
(ORIGINAL PRESERVADO)

---

## 🏢 IA Command — Modelos de Dados Protheus: TRADICIONAL vs LOBO_GUARA (OBRIGATÓRIO LER)

### Por que isso existe
Toda empresa cadastrada no IAHub aponta para uma conexão Protheus real. Essa conexão pode seguir um de dois modelos de particionamento de dados — a IA gera SQL "cego" a essa distinção (sempre via SX2/SX3 canônico); é o **backend** que resolve isolamento entre empresas/filiais. Confundir os dois modelos leva a diagnósticos errados de duplicação/vazamento. Para o plano evolutivo completo (fases, decisões em aberto), ver memória [[ia_command_lobo_guara_plano]].

### Hierarquia real do Protheus (vale para os dois modelos)
`Grupo → Empresa → Unidade → Filial`. O **sufixo numérico da tabela física** (`SC7010`, `SD2400`) representa o **Grupo** — cada grupo tem sua própria família de tabelas físicas, resolvida pelo SX2 (mecanismo já maduro, nunca mexer). Dentro de um grupo, `SYS_COMPANY_CFG.XX8_TIPO` define a árvore: `0`=Grupo, `1`=Empresa (`XX8_GRPEMP`+`XX8_CODIGO`), `2`=Unidade, `3`=Filial (`XX8_GRPEMP`+`XX8_EMPR`+`XX8_UNID`+`XX8_CODIGO`). O campo de filial das tabelas de negócio (`C7_FILIAL`, `CR_FILIAL`) é a concatenação `EMPR+UNID+FILIAL` (ex.: `010101`), **igualdade direta** com `SYS_COMPANY.M0_CODFIL` — sem SUBSTRING. `SYS_COMPANY` é um cadastro "achatado" de conveniência: dois `M0_CODFIL` iguais em grupos Protheus diferentes (sufixos físicos diferentes) são coincidência de numeração local, não colisão real de dados.

### Modelo TRADICIONAL
1 conexão = 1 grupo Protheus = 1 única empresa jurídica. Todas as filiais do grupo pertencem ao mesmo CNPJ/cliente do IAHub. "Sem filtro de filial" está correto por padrão — não há outra empresa jurídica para vazar dado. É o modelo padrão de todas as conexões, salvo configuração explícita em contrário.

### Modelo LOBO_GUARA
Dentro de um único grupo Protheus (mesma tabela física), podem existir **múltiplas empresas jurídicas distintas** (CNPJs diferentes) misturadas nos mesmos registros — ex.: grupo 01 da Plantivo contém a empresa "PLANTIVO" (`XX8_EMPR='01'`) e a empresa "EMA" (`XX8_EMPR='02'`), mesmas tabelas `SC7010`/`SCR010`/`SAK010`.

**Duas dimensões de compartilhamento no SX2, independentes uma da outra, cada tabela declara as duas:**
- `X2_MODO` (campo `modo` em `protheus_sx2`): compartilhamento **entre filiais da mesma empresa**. `E`=exclusiva por filial (cada filial tem registros próprios; JOIN/filtro incompleto duplica). `C`=compartilhada (irrelevante filtrar por filial). `G`=global.
- `X2_MODOEMP` (campo `modo_empresa`): compartilhamento **entre empresas do mesmo grupo**. Uma tabela pode ser `X2_MODO='C'` mas `X2_MODOEMP='E'` (caso real confirmado: SA1 na Plantivo) — compartilhada entre filiais, mas exclusiva por empresa.
- Nunca presumir que `modo='E'` cobre proteção entre empresas — são eixos ortogonais. Ler os dois antes de julgar uma tabela "segura".

**Peça central de isolamento — `empresa_iahub_vinculo_id`** (`protheus_company_tree`, migration v91): cada empresa jurídica Protheus dentro do grupo só entra na árvore de resolução (`lobo-guara-filial-resolver.js:_carregarArvore`) se estiver **explicitamente vinculada** a uma empresa cliente do IAHub. Uma empresa Protheus sem vínculo (ex.: EMA, que existe no grupo mas não é cliente do IAHub) fica **automaticamente fora** de qualquer resolução de escopo — não por um filtro que a bloqueia, mas porque ela nunca é candidata elegível. **Isso é a proteção real hoje**, não um filtro de SQL ativo.

**Risco documentado e ainda não fechado**: se uma pergunta não menciona nome de filial/empresa no texto (`lobo-guara-filial-resolver.resolverDaMensagem` retorna `null`) e não há contexto herdado, **nenhum filtro de escopo é injetado no SQL** (`runner.js` trata isso como "fail-open intencional": nunca bloqueia a resposta). Isso é seguro **apenas enquanto todas as empresas jurídicas do grupo que têm dado relevante estiverem vinculadas ao mesmo `empresa_id` do IAHub** (caso da Plantivo hoje: só ela é vinculada, EMA não é). Se um dia uma segunda empresa jurídica do mesmo grupo virar cliente do IAHub, perguntas sem menção explícita de empresa/filial passam a poder misturar dados das duas — a Fase 4A/4B do plano (normalizer aplicando um escopo padrão a partir do vínculo, mesmo sem menção textual) resolveria isso e **ainda não está implementada**. Não presumir que está resolvido sem checar `protheus_company_tree.empresa_iahub_vinculo_id` da conexão em questão.

**Diagnóstico antes de suspeitar de vazamento/duplicação numa conexão LOBO_GUARA**: (1) checar `protheus_sx2.modo`/`modo_empresa` da(s) tabela(s) envolvida(s); (2) checar quantas empresas em `protheus_company_tree` têm `empresa_iahub_vinculo_id` preenchido para aquela conexão; (3) só then avaliar se um JOIN/filtro incompleto é o problema real ou se é ausência de dado no período testado.

---

## 🧠 IA Command — Controle de Contexto Conversacional (OBRIGATÓRIO)

### 🎯 Objetivo
Garantir consistência em múltiplas interações

---

### 🧩 Regra 1 — Herança de Contexto
- Herdar período, entidade, filtros, métrica
- Se não redefinir → manter

---

### 🧩 Regra 2 — Refinamento Progressivo
"detalhar", "agora por" = refinamento  
→ não é nova consulta  
→ só muda agrupamento

---

### 🧩 Regra 3 — Prioridade de Contexto
1. Usuário  
2. Conversa  
3. ultimo_sql  
4. Domínio  

---

### 🧩 Regra 4 — Consistência de Filtros
Nunca:
- remover filtro
- trocar entidade
- mudar período

---

### 🧩 Regra 5 — Interpretação de Intenção
"por mês", "por cliente"
→ GROUP BY  
→ não mexer WHERE

---

### 🧩 Regra 6 — Proteção SQL
Validar antes:
- filtros
- agrupamento
- consistência

---

### 🧩 Regra 7 — Contexto mínimo
Precisa de:
- período
- entidade
- métrica

---

### 🧩 Regra 8 — Reset
"nova consulta"
→ zerar contexto

---

### 🧩 Regra 9 — Transparência
Manter contexto sem repetir tudo

---

## 🚨 Anti-Erro Crítico — IA Command
- Não perder período
- Não trocar entidade
- Não gerar SQL inconsistente

---

## 🧠 Regra de Ouro IA Command
Refinamento = continuação  
Nunca nova consulta

---

## 🔍 Modo Auditor
- Identificar inconsistências
- Sugerir melhorias

---

## Segurança — O Que Não Alterar Sem Discussão
(ORIGINAL PRESERVADO)

---

## 🧠 Regra de Ouro
Velocidade < Segurança

---

## 🚫 IA Command — Spec vs Inteligência da IA (OBRIGATÓRIO)

### Princípio
O spec do IA-OWNER existe para corrigir **erros estruturais de domínio** (tabelas erradas, campos proibidos, padrões Protheus), não para prescrever agrupamentos, granularidade ou estrutura SQL de perguntas livres.

### Regra de Ouro do Spec
**Menos é mais.** Cada linha adicionada ao spec é uma restrição ao raciocínio da IA. Antes de adicionar qualquer regra, pergunte: "Isso corrige um erro de domínio ou estou tentando controlar o que a IA já sabe fazer?"

### O que NÃO resolver com spec
- Agrupamentos livres: "por títulos", "por data de vencimento", "por fornecedor e data" → a IA interpreta da pergunta
- Granularidade de listagem → decisão da IA com base na pergunta do usuário
- Combinações de dimensões analíticas → comportamento inerente de LLM em perguntas abertas
- Erros ocasionais de agrupamento em perguntas complexas → o usuário reformula, não se adiciona regra

### O que SIM resolver com spec
- Tabelas proibidas em determinadas operações (ex: SE5 em fluxo de caixa projetado)
- Campos obrigatórios de integridade (D_E_L_E_T_, E1_SALDO > 0)
- Padrões únicos do Protheus que a IA não conhece (ROW_NUMBER em SE8, sufixos SX2)
- Erros de domínio recorrentes confirmados em produção

### Diagnóstico antes de tocar no spec
Quando a IA gerar SQL errado, verificar nesta ordem:
1. O `query_plan` classificou a operação corretamente? (ex: `fluxo_caixa` vs `saldo_bancario`)
2. Alguma palavra da pergunta disparou classificação errada no código?
3. O spec tem exemplo ou regra que contamina o raciocínio da IA?
4. Só após confirmar os três acima → considerar mudança no spec
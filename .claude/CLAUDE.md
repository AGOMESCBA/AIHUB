## Idioma
Sempre responda em **português do Brasil (pt-BR)**. Toda UI e mensagens de usuário também devem estar em pt-BR.

---

## Projeto — IAHub

Plataforma de RH com IA para recrutamento e seleção. Multiempresa. Captura currículos via WhatsApp, e-mail IMAP e página pública; analisa aderência a vagas com IA; integra resultados ao Softexpert (SE).

Leia `IA_CONTEXT.md` na raiz para referência completa de módulos, APIs, tabelas e fluxos operacionais.

---

## Stack

- **Backend**: Node.js + Express, Socket.IO, express-session em arquivo.
- **Frontend**: HTML + CSS + JS estático. **Sem SPA/framework**. JS fica inline nos HTMLs. Tabulator via CDN em algumas telas.
- **IA**: Groq (principal) + Google Gemini (fallback). Toda chamada de IA passa por `modules/ia/index.js` — nunca chame a API de IA diretamente nos módulos.
- **Persistência**: arquivos JSON em `data/`. Não há banco SQL. Não sugira migrations, ORMs ou queries SQL.
- **Deploy**: Windows Server, NSSM + Nginx. Scripts em `deploy/`.

---

## Persistência — Modelo de Dados

Cada empresa usa `data/empresa_<id>.json` com "tabelas lógicas" como chaves (`curriculos`, `vagas`, `funcoes`, `analises`, etc.). Arquivos globais: `usuarios.json`, `empresas.json`, `permissoes.json`, `seguranca.json`, `auditoria.log`.

Concorrência com JSON é um ponto de atenção conhecido — não introduza leituras/escritas paralelas sem tratamento de lock ou fila.

---

## Design System — DESIGN.md

**Consulte `.claude/DESIGN.md` antes de criar ou modificar qualquer componente de UI.** As regras têm precedência sobre qualquer outra fonte. Em resumo:

- Use sempre `var(--token)` — nunca cores, raios ou transições hardcoded.
- Transições: `var(--transition)` (`.2s cubic-bezier(.4,0,.2,1)`). Nunca `transition: .3s ease`.
- Layout: duas superfícies (`bg-base` / `bg-card`). Nunca use `background: white` diretamente.
- Botões: classes `.btn + variante`. Um único `.btn-primary` visível por seção.
- Formulários: `.form-group → .form-label → .form-control`.
- Tabelas: sempre dentro de `.table-wrap`.
- Colapso de seções: `max-height` animado — nunca `display: none` animado.
- Padrões proibidos listados na seção 4 do DESIGN.md.

**Pre-computation:** Antes de cada commit, verifique se o estilo aplicado nos arquivos editados condiz com as regras do DESIGN.md.

---

## Checklist — Nova Página no Menu

Ao criar uma nova tela que entra no menu lateral:

1. Criar o arquivo HTML em `frontend/` ou no módulo correspondente.
2. Adicionar a rota no módulo de backend e registrá-la em `index.js` se for um módulo novo.
3. Adicionar o item de menu em `frontend/js/sidebar.js` com o `data-rotina` correto.
4. Adicionar a rotina ao mapa de permissões em `frontend/js/auth.js` para que o bloqueio de acesso funcione.
5. Cadastrar a rotina em `data/permissoes.json` para os usuários que devem ter acesso.

---

## Padrão de Grid (Tabulator)

Toda grade de dados do IAHub segue obrigatoriamente estas três regras:

### 1. Filtros nas colunas
Cada coluna filtrável deve ter `headerFilter` definido na própria coluna Tabulator — nunca em um painel de filtros externo.

```js
{ title: 'Status', field: 'status', headerFilter: 'select', headerFilterParams: { values: { '': 'Todos', ativo: 'Ativo', inativo: 'Inativo' } } },
{ title: 'Nome',   field: 'nome',   headerFilter: 'input' },
```

### 2. Agrupamento via `grid-group-panel.js`

Toda tela com Tabulator deve incluir o painel de agrupamento usando `frontend/js/grid-group-panel.js`. O HTML precisa de dois elementos:

```html
<!-- chips disponíveis para arrastar -->
<div id="gp-chips-row" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>
<!-- zona de drop — campos ativos de agrupamento -->
<div id="dz"></div>
```

E a inicialização após o Tabulator estar pronto:

```js
const gp = createGroupPanel({
  chipsRowId : 'gp-chips-row',
  dropZoneId : 'dz',
  storageKey : '<nome-da-tela>_group',   // chave única por tela (persistida no localStorage)
  getTable   : () => table,
  // allFields omitido → modo auto: usa todas as colunas com field e groupable !== false
});
gp.refresh();          // re-renderiza chips depois que o Tabulator é criado
gp.applyToTable();     // restaura agrupamento salvo
```

### 3. Configuração de colunas agrupáveis

- **Modo auto** (padrão): todas as colunas com `field` definido aparecem como opções de agrupamento. Para excluir uma coluna (ex.: ações, campos memo), adicione `groupable: false` na definição da coluna.
- **Modo manual**: passe `allFields: [{ field, label }, ...]` explicitamente. Nesse modo o painel exibe automaticamente um botão "Configurar" que permite ao usuário escolher quais campos ficam visíveis como opções de agrupamento (preferência salva no localStorage).

```js
// Coluna excluída do agrupamento:
{ title: 'Ações', field: 'acoes', groupable: false, formatter: ... }
```

---

## Checklist — Novo Módulo de Integração

Novas integrações (SE Vaga, SE Função, etc.) seguem o padrão:

```
modules/integracoes/<nome>/
  ├── routes.js
  ├── service.js       (se houver lógica de negócio)
  └── database.js      (se houver acesso a dados específico)
```

Registrar o módulo de rotas em `index.js` e servir o frontend estático na mesma etapa.

---

## Skills Disponíveis — Quando Usar

Use a skill correspondente (via comando `/skill-name`) nas situações abaixo:

| Situação | Skill |
|---|---|
| Instanciar workflow ou usar APIs SOAP do Softexpert | `softexpert-wf-ws` |
| Testar funcionalidade da UI no navegador (Playwright) | `webapp-testing` |
| Criar ou reformular tela/componente com alta qualidade visual | `frontend-design` |
| Trabalhar com arquivos PDF (leitura, extração, geração) | `pdf` |
| Trabalhar com planilhas Excel | `xlsx` |
| Trabalhar com documentos Word | `docx` |
| Criar apresentações PowerPoint | `pptx` |
| Construir ou evoluir artefatos HTML interativos (dashboards, relatórios) | `web-artifacts-builder` |
| Criar ou melhorar uma skill existente | `skill-creator` |

> Para integrações com o SE via Workflow (wf_ws.php), **sempre** use a skill `softexpert-wf-ws` antes de escrever qualquer chamada SOAP — ela contém a referência canônica dos 23 métodos.

---

## IA Command — Arquitetura IA-OWNER (LEIA ANTES DE MEXER NOS PROMPTS)

O módulo IA Command usa um padrão **IA-first**: o LLM (IA-OWNER) é responsável por raciocinar sobre intenção, período, filtros e geração de SQL. O sistema fornece contexto técnico — o LLM decide.

### O que NÃO fazer quando aparecer um bug de comportamento da IA

**PROIBIDO** adicionar regras comportamentais ao system prompt como primeira resposta a um erro. Este foi o padrão anterior e causou um prompt com centenas de cláusulas que se contradiziam e pioravam o raciocínio do modelo.

Antes de tocar em qualquer prompt, faça as perguntas na ordem:

1. **O LLM recebeu o contexto errado?**
   - O `ultimo_sql` estava chegando null?
   - A coluna `ano` não estava sendo reconhecida como temporal?
   - Os dados estavam sendo truncados antes de chegar à IA?
   - → Se sim: **corrija o código**, não o prompt.

2. **É uma restrição matemática ou SQL que o LLM não pode inferir sozinho?**
   - Exemplo válido: "maior E menor ao mesmo tempo exige retornar todos os registros, não usar FETCH NEXT 1" — o LLM errava isso de forma consistente e o erro era silencioso (SQL válido, resultado errado).
   - → Se sim: adicione **uma regra mínima e técnica**, sem exemplos verbosos.

3. **É raciocínio que o LLM faz bem pelo contexto?**
   - Herança de período, granularidade vs. período, interpretação de "este mês"...
   - → **Não adicione regra**. O LLM tem `data_atual`, histórico e `ultimo_sql`. Deixe ele raciocinar.

### O que pertence ao prompt vs. ao código

| Pertence ao prompt (`regrasTecnicas`) | Pertence ao código |
|---|---|
| Nomes de tabelas/campos Protheus (SF2, E3_VENCTO...) | Propagação de contexto entre turnos (ultimo_sql, entidades) |
| Joins com chaves exatas | Pré-processamento de dados (subtotais, detecção de colunas) |
| Aliases de exibição (A1_NOME AS cliente) | Validação de SQL (runner.js, sx3-validator) |
| Lógica de negócio Protheus (D_E_L_E_T_, devoluções, carteira) | Loop de retry com erro devolvido à IA |
| Restrições matemáticas genuínas (ex: extremo duplo) | Roteamento de módulos e contexto técnico |
| **Interpretação semântica de domínio** que o LLM não infere sozinho (ex: "faturamento médio" = média de totais mensais, não AVG sobre NFs) | **Injeção de templates SQL no user prompt** — PROIBIDO mesmo que pareça "contexto técnico". O user prompt é a pergunta do usuário, não um guia de estrutura SQL. |

### Regra de ouro: se a IA já recebeu a regra e ainda assim errou

Se a regra existe no prompt e o LLM ignorou, as causas possíveis em ordem de investigação são:

1. **A regra está correta mas a semântica está ambígua** — o LLM interpretou a palavra de forma diferente da esperada. Adicione uma linha de clarificação semântica no `prompt-builder.js` (ex: "faturamento médio = média de totais de período, não ticket por NF").
2. **O retry não devolveu o erro corretamente à IA** — verifique o loop de retry em `runner.js`.
3. **O validador não capturou o SQL errado** — verifique as regexes em `validarSqlIaOwnerBasico` e `validarEscopoSubqueryExterno`.

**Nunca injete templates SQL ou estruturas de query no user prompt** — isso viola o princípio IA-first: a IA decide a estrutura do SQL, o sistema fornece apenas as regras do domínio.

### Estrutura dos prompts após auditoria (junho/2026)

- **`prompt-builder.js`**: contrato universal — regras que valem para todos os módulos (Escopo IAHub, D_E_L_E_T_, Sintaxe SQL, Formato de Data Protheus, Extremo Duplo, Resposta Planejada).
- **`*-ia-owner-spec.js`** (faturamento, compras, financeiro, comissão): contrato técnico do módulo — tabelas, joins, campos de data, aliases, lógica de negócio específica. **Sem duplicar o universal.**

Antes desta auditoria o prompt total tinha ~600–700 linhas. Após ficou em ~143–193 linhas por módulo. Não deixe crescer de volta sem justificativa técnica explícita.

---

## Segurança — O Que Não Alterar Sem Discussão

- CSP está **desativado propositalmente** no Helmet para permitir scripts inline nas telas.
- Rate limit e bcryptjs estão configurados em `index.js` — não remover.
- Dados sensíveis (chaves de API, senhas de e-mail, tokens SE) ficam em `data/` sem criptografia em disco — backups e permissões de diretório são críticos.
- Não commitar `.env` nem arquivos de `data/` com segredos reais.

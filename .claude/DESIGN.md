# IAHub — Design System

> Referência canônica de design. Consulte este arquivo **antes** de criar ou modificar qualquer componente de UI. As regras aqui têm precedência sobre qualquer outra fonte.

---

## 1. Design Tokens

```yaml
# ─────────────────────────────────────────────────
# IAHub Design Tokens  (sincronizados com iahub.css :root)
# ─────────────────────────────────────────────────

color:
  # Superfícies
  bg-base:      "#f8fafc"   # fundo geral da aplicação
  bg-sidebar:   "#ffffff"   # sidebar, topbar, inputs
  bg-card:      "#ffffff"   # cards e painéis
  bg-hover:     "#f1f5f9"   # hover de linhas/itens
  bg-active:    "#eff6ff"   # item de nav ativo

  # Accent primário (azul)
  accent:       "#2563eb"
  accent-light: "#3b82f6"
  accent-glow:  "rgba(37,99,235,.10)"   # foco / glow / icon-bg ativo
  accent-hover: "#1d4ed8"               # :hover do btn-primary

  # Accent secundário (indigo/violeta)
  accent-2:     "#6366f1"

  # Texto
  text-hi:      "#0f172a"   # títulos, valores, body principal
  text-md:      "#64748b"   # labels, descrições secundárias
  text-lo:      "#94a3b8"   # placeholder, metadados, timestamps

  # Bordas
  border:       "#e2e8f0"   # borda padrão
  border-hi:    "#cbd5e1"   # borda reforçada (hover de card)

  # Semânticos
  success:      "#16a34a"
  error:        "#dc2626"
  warning:      "#d97706"

  # Badges (fundo / texto)
  badge-blue:   { bg: "#dbeafe", text: "#1d4ed8" }
  badge-green:  { bg: "#dcfce7", text: "#15803d" }
  badge-yellow: { bg: "#fef3c7", text: "#b45309" }
  badge-red:    { bg: "#fee2e2", text: "#b91c1c" }
  badge-purple: { bg: "#ede9fe", text: "#6d28d9" }

  # Terminal / Monitor (dark surface)
  terminal-bg:     "#0d1117"
  terminal-border: "#30363d"
  log-info:        "#8b949e"
  log-success:     "#3fb950"
  log-error:       "#f85149"
  log-warning:     "#d29922"
  log-received:    "#58a6ff"
  log-saved:       "#bc8cff"

layout:
  sidebar-w:    "300px"     # sidebar expandida (hover / pinned)
  sidebar-mini: "64px"      # sidebar retraída (apenas ícones)
  topbar-h:     "56px"
  page-padding: "24px"

shape:
  radius:       "10px"      # padrão de todos os cards e containers
  radius-sm:    "7px"       # botões
  radius-xs:    "4px"       # tags de log, badges internos
  radius-input: "8px"       # inputs e selects
  radius-login: "16px"      # login card (destaque extra)

shadow:
  sm: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)"
  md: "0 4px 16px rgba(0,0,0,.08)"
  login: "0 8px 32px rgba(0,0,0,.08), 0 1px 0 rgba(255,255,255,.8)"

motion:
  duration:  "0.2s"
  easing:    "cubic-bezier(.4,0,.2,1)"   # Material standard easing
  duration-collapse: "0.32s"             # abrir/fechar seção de nav
  duration-submenu:  "0.28s"             # submenu interno

typography:
  family: "'Segoe UI', system-ui, -apple-system, sans-serif"
  family-mono: "'Cascadia Code', 'Fira Code', 'Courier New', monospace"
  base-size:   "14px"
  base-lh:     "1.6"
  scale:
    xs:   "10px"    # nav-section-title, log-tag
    sm:   "11px"    # badge, form-hint, stat-label, thead
    sm+:  "11.5px"  # form-hint
    base: "13px"    # botões, nav-item, topbar-path
    md:   "13.5px"  # card-header, tab-btn, tbody td
    lg:   "14px"    # inputs, body padrão
    xl:   "15px"    # topbar-title
    2xl:  "17px"    # logo-text
    3xl:  "28px"    # stat-value
```

---

## 2. Intentions — Regras de Uso

Estas regras descrevem **por que** e **quando** usar cada token. Siga-as ao decidir entre alternativas.

### 2.1 Cor

| Intenção | Token | Regra |
|---|---|---|
| Fundo da página | `bg-base` | Sempre. Nunca use `bg-card` como fundo de página. |
| Superfícies elevadas | `bg-card` | Cards, modais, painéis que "flutuam" sobre `bg-base`. |
| Elementos de interação inline | `bg-hover` | Linhas de tabela, itens de nav em `:hover`. Nunca mude a cor de texto no hover simples — apenas o fundo. |
| Ação principal | `accent` | Um único CTA por área visível. Botões primários, link ativo, borda de foco. |
| Gradiente de marca | `accent → accent-2` | Exclusivo para: logo icon, logo text, avatar de usuário. Não use em botões nem em backgrounds amplos. |
| Texto de conteúdo | `text-hi` | Valores, títulos, dados que o usuário precisa ler. |
| Texto de suporte | `text-md` | Labels de formulário, descrições, nomes de seção. |
| Texto decorativo | `text-lo` | Placeholders, timestamps, metadados, hints. |
| Feedback semântico | `success / error / warning` | Somente para mensagens de estado (toast, badge, pill). Nunca use `error` como cor decorativa. |

### 2.2 Superfície e Elevação

O sistema usa **duas superfícies** principais:

```
bg-base  (cinza muito claro)  ←  fundo da aplicação
  └── bg-card / bg-sidebar (branco)  ←  elementos "em cima"
```

- Não adicione `background: white` diretamente — use `var(--bg-card)`.
- Sombras indicam elevação: `shadow-sm` para cards em repouso, `shadow-md` para sidebar expandida, dropdowns e modais.
- **Nunca empilhe sombras** — um elemento pode ter no máximo uma sombra ativa.

### 2.3 Tipografia

- Tamanho **base do body é 14 px**. Nunca use `font-size` menor que `10px`.
- Labels de formulário e cabeçalhos de tabela usam `text-transform: uppercase` + `letter-spacing: .05em–.1em` — isso é intencional para hierarquia visual; mantenha.
- Pesos disponíveis: 400 (normal), 500 (medium), 600 (semibold), 700 (bold), 900 (icon do logo). Evite 300 e 800.
- Texto de código/terminal usa **apenas** `family-mono`.

### 2.4 Espaçamento

Siga estes ritmos (múltiplos de 4 px):

```
4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 32 / 40
```

- `gap` entre ícone e label em botões/nav: `6–12px`.
- `padding` de card-body: `20px`.
- `padding` de página (`.page-content`): `24px`.
- Formulários: `margin-bottom: 18px` entre grupos.

### 2.5 Movimento e Transições

- **Toda** transição usa `var(--transition)` (`.2s cubic-bezier(.4,0,.2,1)`). Nunca escreva `transition: .3s ease` — isso quebra a coerência.
- Colapso de seções (accordion/nav) usa `max-height` + `var(--duration-collapse)` — não use `display:none` animado.
- A sidebar tem comportamento **hover-expand**: expande ao hover, colapsa ao sair. O modo **pinned** (classe `.pinned`) mantém expandida permanentemente e adiciona `margin-left: var(--sidebar-w)` ao `.main`.

---

## 3. Componentes

### 3.1 Layout Global

```
.layout (flex, 100vh)
  ├── .sidebar (position: fixed, z-index: 200)
  │     ├── .sidebar-logo
  │     ├── .sidebar-userinfo
  │     ├── .sidebar-nav (scroll interno)
  │     └── .sidebar-footer (.btn-logout)
  └── .main (flex-col, margin-left: sidebar-mini)
        ├── .topbar (height: 56px)
        └── .page-content (flex:1, overflow-y: auto, padding: 24px)
```

**Regras do layout:**
- `overflow: hidden` no `body` — apenas `.page-content` rola.
- Nunca posicione elementos acima de `z-index: 200` (reservado à sidebar). Modais usam `z-index: 1000+`.

### 3.2 Sidebar — Navegação

Hierarquia de 3 níveis:

| Nível | Classe | Indentation |
|---|---|---|
| Seção colapsável | `.nav-section-hdr` | 18 px |
| Item de 1º nível | `.nav-item.sub` | 44 px |
| Item de 2º nível | `.nav-item.sub2` | 62 px |

- O indicador de item ativo é um `::before` de `3px` de largura na cor `accent`, posicionado à esquerda.
- Ícones (`.nav-icon`) têm `28×28px` fixo; no estado ativo recebem `background: var(--accent-glow)`.
- Labels (`.nav-label`) ficam com `opacity: 0` na sidebar retraída e transitam para `opacity: 1` ao expandir.

### 3.3 Botões

| Variante | Classe | Uso |
|---|---|---|
| Primário | `.btn.btn-primary` | CTA principal — um por seção |
| Sucesso | `.btn.btn-success` | Confirmação / salvar |
| Perigo | `.btn.btn-danger` | Deletar / ação destrutiva |
| Ghost | `.btn.btn-ghost` | Ação secundária, cancelar |
| Info | `.btn.btn-info` | Ação informativa, visualizar |

- Padding padrão: `7px 14px`. Nunca altere individualmente — crie `.btn-sm` ou `.btn-lg` se necessário.
- Estado `:disabled`: `opacity: .5; cursor: not-allowed`. Não remova o cursor.
- Ícone dentro de botão: `gap: 6px`, nunca adicione `margin` no ícone diretamente.
- Em cabeçalhos fixos de cadastro/edição, a ordem de ações é sempre: `Cancelar`, `Salvar` e depois ações adicionais da rotina.
- O cabeçalho de cadastro/edição deve identificar o registro com código e nome/descrição principal, por exemplo `#12 - Analista SoftExpert` ou `Novo registro - Nova Função`.

### 3.4 Formulários

- `.form-group` (margin-bottom: 18px) → `.form-label` → `.form-control`
- Labels: uppercase, 12px, `text-md`.
- Inputs/selects: `border-radius: 8px`, foco com `border-color: accent` + `box-shadow: 0 0 0 3px accent-glow`.
- Dica abaixo do campo: `.form-hint` (11.5px, `text-lo`).
- `select` desabilitado: `opacity: .55; cursor: not-allowed` — não esconda, mantenha visível.

### 3.4.1 Editor Shell / Formulários Longos

Use este padrão para cadastros, revisões e detalhes densos que substituem modais longos:

```html
<section class="editor-shell">
  <div class="editor-actionbar">
    <div class="editor-actionbar-title">
      <strong>#12 - Analista SoftExpert</strong>
      <span>Revise os dados antes de salvar.</span>
    </div>
    <div class="editor-actions">
      <button class="btn btn-ghost">Cancelar</button>
      <button class="btn btn-primary">Salvar</button>
    </div>
  </div>

  <div class="editor-grid">
    <main class="editor-main">
      <section class="form-section">
        <div class="form-section-header">
          <div class="form-section-title">Dados Principais</div>
          <div class="form-section-subtitle">Contexto da seção.</div>
        </div>
        <div class="form-section-body">...</div>
      </section>
    </main>
    <aside class="editor-side">...</aside>
  </div>
</section>
```

- `.editor-actionbar` é fixa dentro de `.page-content` e mantém ações críticas visíveis.
- Ordem das ações: `Cancelar`, `Salvar`/ação principal e depois ações adicionais.
- O título deve identificar o registro por código e nome/descrição principal.
- `.editor-grid-wide` pode ser usado quando o painel lateral precisar de 300px.
- `.form-section` é a superfície padrão para seções de formulário/detalhe; evite CSS local duplicando sua estrutura.

### 3.5 Cards

```html
<div class="card">
  <div class="card-header">Título</div>
  <div class="card-body">conteúdo</div>
</div>
```

- `.card-header` tem `background: var(--bg-base)` (diferencia do corpo).
- `.stat-card` é autônomo (sem header/body separados), com `padding: 20px` e hover que eleva `shadow-md`.

### 3.6 Tabelas

- `thead th`: uppercase, 11px, `text-lo`, `bg-base`.
- `tbody td`: 13.5px, `text-hi`.
- Hover de linha: `bg-hover` — nunca mude a cor do texto na linha em hover.
- Última linha sem `border-bottom`.
- Sempre envolva em `.table-wrap` para scroll horizontal em telas estreitas.

### 3.7 Tabs

```html
<div class="tabs-header">
  <button class="tab-btn active">Aba 1</button>
  <button class="tab-btn">Aba 2</button>
</div>
```

- Indicador ativo: `border-bottom: 2px solid accent`. Não use background para indicar aba ativa.
- O container tem `overflow-x: auto` com scrollbar fina — não remova.

### 3.8 Badges

Uso: status de registros, categorias, etiquetas.

```html
<span class="badge badge-green">Ativo</span>
<span class="badge badge-red">Inativo</span>
```

- `border-radius: 20px` (pílula). Não use quadrado.
- Texto: 11px, font-weight 600.
- Nunca use cor semântica (`success`, `error`) diretamente em badge — use as variantes nomeadas.

### 3.9 Terminal / Monitor

Surface escura isolada para logs em tempo real.

- Sempre dentro de `.terminal` (bg `#0d1117`).
- Cada linha: `.log-line` com `.log-ts` + `.log-tag` + `.log-msg`.
- Tags coloridas: `.tag-info / .tag-success / .tag-error / .tag-warning / .tag-received / .tag-saved`.
- Fonte: `family-mono`, 12.5px.

### 3.10 Status Pills

Para status de serviços/processos (ex.: WhatsApp, integração):

```html
<span class="status-pill pill-connected">Conectado</span>
<span class="status-pill pill-stopped">Parado</span>
<span class="status-pill pill-starting">Iniciando</span>
```

O `::before` cria o ponto colorido — não adicione ícone SVG extra.

---

## 4. Padrões Proibidos

Estes padrões **nunca** devem aparecer em código novo:

| Proibido | Alternativa correta |
|---|---|
| `color: #2563eb` hardcoded | `color: var(--accent)` |
| `transition: .3s ease` | `transition: var(--transition)` |
| `background: white` | `background: var(--bg-card)` ou `var(--bg-sidebar)` |
| `border-radius: 4px` em card | `border-radius: var(--radius)` |
| `font-family: monospace` | `font-family: var(--family-mono)` (não existe como var — use o valor literal do token) |
| `z-index` acima de 200 sem comentário | documente o motivo |
| `display: none` animado | `max-height: 0 → N` + `overflow: hidden` |
| Mais de um `.btn-primary` visível por seção | Rebaixe o secundário para `.btn-ghost` ou `.btn-info` |
| Gradiente de marca em background de página | Reserve para logo icon, logo text e avatar |

---

## 5. Checklist antes de fazer PR

- [ ] Usei variáveis CSS (`var(--...)`) para todas as cores, sombras e transições
- [ ] Não introduzi novo `z-index` sem justificativa
- [ ] Formulários seguem a estrutura `.form-group → .form-label → .form-control`
- [ ] Botões usam classes `.btn + variante` sem sobrescrever padding
- [ ] Tabelas estão dentro de `.table-wrap`
- [ ] Animações usam `var(--transition)` ou as durações de colapso definidas
- [ ] Não há superfície com mais de uma sombra ativa simultaneamente
- [ ] Testei o comportamento da sidebar em modo retraído (64px) e expandido (300px)

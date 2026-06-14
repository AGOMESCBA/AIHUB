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
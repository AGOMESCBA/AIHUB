# IA Talk — andamento

Cada IA atualiza só a linha da própria etapa ao fim de cada entrega. Situações:
`a fazer` · `em andamento` · `em revisão` (aguarda Claude Code) · `em homologação` (aguarda usuário) · `homologada`.

Plano completo e decisões: relatório "IA Talk — arquitetura e planejamento" (seção 14).

## Etapas

| Etapa | Dono | Situação | Evidências | Observações |
|---|---|---|---|---|
| S — Segurança IA Command | Claude Code | publicada no pacote 20261125_1556 (`f38299b`, junção `aacd273d`) | suíte IA Command 169/171 (2 falhas pré-existentes), consumidores ok | publicar só com autorização |
| C0 — Contratos e esqueleto | Claude Code | homologada (`e815684`) | `node --test "apps/IA Talk/tests/*.test.js"` | branch `feature/ia-talk` |
| C1 — Acesso e identidade | Claude Code | em homologação (I1 com G1 ok) | `tests/c1-rotas.test.js` (10/10) + ponta a ponta no navegador; suíte Talk 58/58, IAHub 15/15 | login por código, link de primeiro acesso, card do IAHub (ticket Ed25519), sessão, empresas, usuários, sites, e-mail de envio, aplicações/tokens, auditoria. Telas de cadastro = G1 |
| C2 — Canais WhatsApp Web | Claude Code | pronta para teste real | `tests/c2-canais.test.js` (6/6, provedor simulado) | supervisor + processo por canal, concessão, modo de teste (lista: número do usuário), Socket.IO autenticado. Falta: teste real com QR no número da J2A (aparelho conectado extra) e encontro G2↔C2 |
| C3 — Envio, fila e estados | Claude Code | a fazer | | usa G4 (mídia) |
| C4 — Recebimento e webhooks | Claude Code | a fazer | | usa G4 (assinatura) |
| C5 — Migração onda 1 | Claude Code | a fazer | | login IA Service, Jaade, Jobs |
| C6 — Migração ondas 2 e 3 | Claude Code | a fazer | | canal real + IA Command (autorização própria) |
| C7 — Operação e publicação | Claude Code | a fazer | | nginx, NSSM, pacote oficial, backup |
| G4 — Bibliotecas mídia e assinatura | Antigravity | aprovada e commitada (`f054e6a`) | `node --test "apps/IA Talk/tests/*.test.js"` (48/48, 14/14 na G4, 0 todo) | `midia/index.js` (+ `decodificarBase64Estrito` para C3) e `assinatura/index.js` implementados; sem commits |
| G1 — Telas de acesso e cadastros | Antigravity | em homologação (revisão Claude Code ok + I1 contra o servidor real ok) | `g1-telas.test.js` (4/4) + `tests/*.test.js` (58/58) + 33 capturas em `tests/telas/capturas/` | `entrar.html`, `usuarios.html`, `aplicacoes.html`, `configuracoes.html` + `css/telas/g1.css`; sem commits |
| G2 — Telas de canais | Antigravity | aprovada na revisão (menu liberado no encontro com a C2) | `g2-canais.test.js` (2/2) + `g1-telas.test.js` (4/4) + `tests/*.test.js` (58/58) + 12 capturas G2 em `tests/telas/capturas/` | `canais.html` + `css/telas/g2.css` + fix contador de tokens em `aplicacoes.html`; sem commits |
| G3 — Painel, histórico, eventos, auditoria | Antigravity | aprovada na revisão (auditoria liberada; demais com C3/C4) | `g3-telas.test.js` (4/4) + `g2-canais.test.js` (2/2) + `g1-telas.test.js` (4/4) + `tests/*.test.js` (58/58) + 31 capturas G3 em `tests/telas/capturas/` | `painel.html`, `mensagens.html`, `eventos.html`, `auditoria.html` + `css/telas/g3.css`; sem commits |
| G5 — Guia do integrador | Antigravity | a fazer | | assume `docs/openapi-v1.yaml` |
| A0 — Protótipo da central (Fase 2) | Antigravity | a fazer | | `prototipos/central/` |
| G6 — Adaptador Meta | Antigravity | aguardando número Meta | | |

## Pedidos de mudança de contrato / cenário

| Data | Quem pede | O quê | Situação |
|---|---|---|---|
| 25/11/2026 | Antigravity | Trocar `etapa: 'G1'` para `etapa: null` em `frontend/js/talk-sidebar.js` para `talk-usuarios`, `talk-aplicacoes` e `talk-configuracoes` | feito (Claude Code, 25/11) |
| 25/11/2026 | Antigravity | Trocar `etapa: 'G2'` para `etapa: null` em `frontend/js/talk-sidebar.js` para `talk-canais` | pendente |
| 25/11/2026 | Antigravity | Trocar `etapa: 'G3'` para `etapa: null` em `frontend/js/talk-sidebar.js` para `talk-auditoria` (já com backend real C1 `GET /auditoria`) e, no encontro G3 ↔ C4, para `talk-painel`, `talk-mensagens` e `talk-eventos` | pendente |

## Decisões

* 25/11/2026 — Fase 1 só WhatsApp Web; Meta preparada. Endereço `/app/ia-talk/`. Sem login por senha.
  Código de login pelo canal vinculado à empresa, e-mail cadastrado como reserva. Só o J2iA será
  avaliado como "chat de suporte" (Fase 2).
* 25/11/2026 — Nomes de contrato em pt-BR (estados, erros). Ordenação: `ordenar` + `ordem`
  (`direcao` é o sentido da mensagem).

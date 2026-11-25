# IA Talk — andamento

Cada IA atualiza só a linha da própria etapa ao fim de cada entrega. Situações:
`a fazer` · `em andamento` · `em revisão` (aguarda Claude Code) · `em homologação` (aguarda usuário) · `homologada`.

Plano completo e decisões: relatório "IA Talk — arquitetura e planejamento" (seção 14).

## Etapas

| Etapa | Dono | Situação | Evidências | Observações |
|---|---|---|---|---|
| S — Segurança IA Command | Claude Code | commit `f38299b` (branch `fix/ia-command-seguranca-whatsapp`), sem push | suíte IA Command 169/171 (2 falhas pré-existentes), consumidores ok | publicar só com autorização |
| C0 — Contratos e esqueleto | Claude Code | em homologação | `node --test "apps/IA Talk/tests/*.test.js"` | branch `feature/ia-talk`, sem commit |
| C1 — Acesso e identidade | Claude Code | a fazer | | inclui e-mail de envio (padrão IA Recruit, senha cifrada) |
| C2 — Canais WhatsApp Web | Claude Code | a fazer | | precisa do chip de teste |
| C3 — Envio, fila e estados | Claude Code | a fazer | | usa G4 (mídia) |
| C4 — Recebimento e webhooks | Claude Code | a fazer | | usa G4 (assinatura) |
| C5 — Migração onda 1 | Claude Code | a fazer | | login IA Service, Jaade, Jobs |
| C6 — Migração ondas 2 e 3 | Claude Code | a fazer | | canal real + IA Command (autorização própria) |
| C7 — Operação e publicação | Claude Code | a fazer | | nginx, NSSM, pacote oficial, backup |
| G4 — Bibliotecas mídia e assinatura | Antigravity | em revisão | `node --test "apps/IA Talk/tests/*.test.js"` (48/48, 14/14 na G4, 0 todo) | `midia/index.js` (+ `decodificarBase64Estrito` para C3) e `assinatura/index.js` implementados; sem commits |
| G1 — Telas de acesso e cadastros | Antigravity | a fazer | | entrar, usuários, aplicações, configurações |
| G2 — Telas de canais | Antigravity | a fazer | | |
| G3 — Painel, histórico, eventos, auditoria | Antigravity | a fazer | | |
| G5 — Guia do integrador | Antigravity | a fazer | | assume `docs/openapi-v1.yaml` |
| A0 — Protótipo da central (Fase 2) | Antigravity | a fazer | | `prototipos/central/` |
| G6 — Adaptador Meta | Antigravity | aguardando número Meta | | |

## Pedidos de mudança de contrato / cenário

| Data | Quem pede | O quê | Situação |
|---|---|---|---|
| | | | |

## Decisões

* 25/11/2026 — Fase 1 só WhatsApp Web; Meta preparada. Endereço `/app/ia-talk/`. Sem login por senha.
  Código de login pelo canal vinculado à empresa, e-mail cadastrado como reserva. Só o J2iA será
  avaliado como "chat de suporte" (Fase 2).
* 25/11/2026 — Nomes de contrato em pt-BR (estados, erros). Ordenação: `ordenar` + `ordem`
  (`direcao` é o sentido da mensagem).

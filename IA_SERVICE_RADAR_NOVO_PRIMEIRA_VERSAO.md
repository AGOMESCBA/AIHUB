# IA Service - Radar de Chamados novo frontend paralelo

Data: 07/10/2026  
Rota principal de homologação: `http://137.131.212.29:3000/iaservice/j2a`  
Status: primeira versão funcional paralela implementada, sem substituir a V1.

## 1. Arquitetura

A nova experiência foi criada como frontend isolado, servido por rota pública própria:

- Entrada: `/iaservice/j2a`
- Subrotas equivalentes: `/iaservice/j2a/acesso`, `/iaservice/j2a/radar`
- Assets isolados: `/iaservice/j2a/assets/*`

Ela reutiliza:

- autenticação WhatsApp/OTP existente;
- token externo `svc_token_externo`;
- identificação de consultor via `/api/ia-service-externo/whoami`;
- fila pessoal real;
- endpoints externos do Radar;
- SoftExpert;
- anexos;
- motor de investigação;
- pesquisa técnica;
- dossiê existente;
- regras atuais de SLA.

## 2. Arquivos criados

- `apps/IA Service/frontend/j2a/index.html`
- `apps/IA Service/frontend/j2a/assets/radar.css`
- `apps/IA Service/frontend/j2a/assets/radar.js`
- `IA_SERVICE_RADAR_NOVO_PRIMEIRA_VERSAO.md`

## 3. Arquivos alterados

- `apps/IA Service/backend/routes/login-externo-routes.js`
  - adiciona `/iaservice/j2a`;
  - serve assets isolados da nova interface.

- `apps/IA Service/backend/routes/externo-routes.js`
  - adiciona rotas externas autenticadas para dossiê e investigações:
    - `GET /api/ia-service-externo/atendimentos/:id/dossie`
    - `GET /api/ia-service-externo/atendimentos/:id/investigacoes`

## 4. V1 preservada

Arquivos V1 não substituídos:

- `apps/IA Service/frontend/entrar.html`
- `apps/IA Service/frontend/radar.html`
- rotas `/entrar-servico`
- rotas `/radar-externo`
- rotas `/app/ia-service/*`

Não houve redirecionamento da V1 para a nova tela.

## 5. Funcionalidades implementadas

| Funcionalidade | Status | Endpoint |
|---|---|---|
| Entrada `/iaservice/j2a` | OK | rota HTML |
| Acesso IA Service por telefone | OK | `/api/ia-service-publico/login/iniciar` |
| Validação OTP | OK no frontend | `/api/ia-service-publico/login/verificar` |
| Escolha de empresa | OK | `/api/ia-service-publico/login/escolher-empresa` |
| Sessão externa existente | OK | `svc_token_externo` |
| Whoami consultor/empresa | OK | `/api/ia-service-externo/whoami` |
| Fila pessoal | OK no frontend | `/api/ia-service-externo/radar/fila` |
| Filtros da fila | OK | `filtro_sla` |
| Auto-refresh | OK | client-side |
| Pré-análise IA | OK | `/radar/minhas-preferencias` |
| Abrir chamado real | OK no frontend | `/radar/chamados/:id/abrir-atendimento` |
| Conversa real | OK no frontend | `/atendimentos/:id/mensagens` |
| Envio de mensagem | OK no frontend | `/atendimentos/:id/investigar` |
| Upload de anexos | OK no frontend | `/atendimentos/:id/anexos` |
| Anexos SoftExpert | OK no frontend | `/radar/chamados/:id/anexos-softexpert` |
| Pesquisa Técnica/Base interna | OK no frontend | `/radar/chamados/:id/pesquisa-tecnica` |
| Detalhes do chamado | OK | dados da fila/chamado |
| Risco SLA | OK no frontend | `/radar/risco-sla` |
| Dossiê/resumo operacional | PARCIAL | `/atendimentos/:id/dossie` |
| Validação da análise | PARCIAL | `/atendimentos/:id/investigacoes` |
| Claro/Escuro/Sistema | OK | localStorage + CSS variables |
| Painel direito recolhível | OK | client-side |
| Fila recolhível | OK | client-side |
| Lista de consultores recolhível em Risco SLA | OK | client-side |
| Mobile Fila/Conversa/Resumo/Mais | OK estrutural | CSS responsive |

## 6. Pendências de paridade

| Item | Status | Observação |
|---|---|---|
| Teste autenticado real via UI | BLOQUEADO | depende de OTP WhatsApp válido; não foi feito bypass |
| Screenshots do Radar autenticado com dados reais | BLOQUEADO | sem sessão externa validada nesta rodada |
| Semântica final de Quality Gate | PARCIAL | exibido como "Validação da análise" apenas quando há execução/investigação registrada |
| Resumo operacional profundo | PARCIAL | usa dossiê real quando disponível; não inventa hipótese/próxima ação |
| Abrir chamado no SoftExpert | PENDENTE | não implementado por não haver URL confiável confirmada |
| Refinamento visual final mobile | PARCIAL | estrutura responsiva implementada; refinamento fino fica para avaliação |

## 7. Testes realizados

Comandos/validações:

- Sintaxe JS dos arquivos novos/alterados: OK.
- `GET http://127.0.0.1:3000/iaservice/j2a`: 200.
- `GET http://127.0.0.1:3000/entrar-servico`: 200.
- `GET http://127.0.0.1:3000/radar-externo`: 200.
- Screenshot real da nova tela de acesso desktop: OK.
- Screenshot real da nova tela de acesso mobile: OK.
- Screenshot real da V1 `/entrar-servico`: OK.

Screenshots reais gerados:

- `tmp/ia-service-j2a-screenshots/acesso-desktop-1366.png`
- `tmp/ia-service-j2a-screenshots/acesso-mobile-390.png`
- `tmp/ia-service-j2a-screenshots/v1-entrar-servico.png`

Observação: houve um erro de console 404 no desktop por recurso não essencial, compatível com favicon/asset ausente. A tela renderizou.

## 8. Impacto na V1

Impacto esperado: baixo.

Motivos:

- frontend novo está em pasta própria;
- CSS/JS novos não são carregados pela V1;
- V1 não foi substituída;
- rotas V1 responderam HTTP 200 após alteração;
- endpoints existentes não tiveram contrato alterado.

## 9. Próximos passos

1. Validar OTP real no ambiente.
2. Entrar em `/iaservice/j2a` com consultor real.
3. Testar fila pessoal, chamado real, conversa, anexos, pesquisa, detalhes e Risco SLA.
4. Capturar screenshots autenticados:
   - Radar Desktop Dark;
   - Radar Desktop Light;
   - 1366x768;
   - Mobile;
   - painel direito aberto/fechado;
   - Risco SLA;
   - Pesquisa Técnica;
   - Banco/Base de Conhecimento.
5. Ajustar paridade visual e funcional a partir da homologação.

## 10. Resultado

Primeira versão funcional paralela criada em `/iaservice/j2a`, preservando a V1.

Não foi feito push, não houve substituição de produção e não foi criado bypass de autenticação.

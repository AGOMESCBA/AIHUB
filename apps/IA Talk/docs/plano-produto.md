# IA Talk — Plano de produto (atendimento, IA, vendas e canais)

Aprovado em 27/11/2026. Objetivo: tornar o IA Talk uma das melhores plataformas de mensageria
de atendimento e vendas do mercado, **multiempresa**, com o diferencial que nenhum líder tem
pronto: integração nativa com o ERP (Protheus via IA Command), chamados do SoftExpert entrando na
fila e o mesmo número de WhatsApp servindo ao assistente de IA e ao atendimento humano.

Referência de mercado (pesquisa de 27/11): respond.io, Chatwoot, Intercom (Fin), Kommo, Blip,
Zenvia, Digisac, Huggy, Octadesk. Todos seguem 5 camadas: canal → triagem → distribuição →
atendimento → inteligência; para vendas, somam funil (CRM) e campanhas.

## Decisões do usuário que valem para todo o plano

1. **API oficial da Meta por último**, depois de tudo o que der estar funcionando, testado e
   validado. Até lá, WhatsApp Web só para **atendimento** (o cliente escreve primeiro).
   Campanhas em massa só com a API oficial (consentimento + modelos aprovados), nunca pelo WhatsApp Web.
2. **Portal do atendente fora do sistema administrativo**, como o chat do IA Service: o
   atendente entra pelo **link da empresa** com o **celular** e o **código** recebido no WhatsApp,
   e opera uma página dedicada (sem o menu de administração). URL por empresa, gerada pelo
   apelido: `/app/ia-talk/<apelido>/atendimento` (mesmo conceito de `/iaservice/<apelido>`).
3. **Menu de setores** no WhatsApp: a pessoa escolhe entre os setores cadastrados da empresa.
4. **Multiempresa sempre:** dado de outra empresa = 404; configuração por empresa; nada em `.env`.
5. **Publicar desligado:** todo recurso novo nasce desligado e liga por botão.

## Princípios de engenharia (iguais para os três agentes)

- **Contrato primeiro** (`docs/contratos.md` + `backend/contratos/index.js` + simulado), depois
  servidor real e telas em paralelo.
- **Dono de cada pasta** (abaixo). Ninguém edita fora da sua área. Precisa? Anota como dúvida.
- **Claude audita** toda entrega do Codex e do Antigravity antes de qualquer commit
  (`git diff`, suítes, revisão). Só o Claude faz commit, push e pacote, e só com pedido do usuário.
- **Pronto** = testes passando + capturas (telas) + `docs/andamento.md` + lista de arquivos com
  caminho completo.
- Logs sem texto de mensagem, sem número completo, sem token. Chave e segredo nunca no código.
- Migrações só o Claude; nunca alterar versão publicada.

## Quem faz o quê

| Agente | Área (dono) | Tipo de tarefa |
|---|---|---|
| **Claude Code** | `backend/` (exceto `backend/lib/`), `backend/database/`, `backend/contratos/`, `backend/simulado/`, IA Command, IAHub, `docs/contratos.md` | Contratos, banco, segurança, rotas, tempo real, WhatsApp, integrações, auditoria das entregas |
| **Codex** | `backend/lib/<pasta nova>/` + `tests/x*-*.test.js` | **Bibliotecas puras** (sem banco, sem rede, sem tela), com especificação fechada e testes de borda |
| **Antigravity** | `frontend/` (telas, CSS, JS de tela), `tests/telas/`, `docs/integrador/`, `frontend/guia.html` | Telas contra o simulado, capturas 1440/390 claro/escuro, estados vazio/carregando/erro |

## Ondas

### Onda 1 — Atendimento profissional (agora)

| Etapa | Dono | Entrega | Depende de |
|---|---|---|---|
| **C10** Contrato da Onda 1 | Claude | `contratos.md` §9: portal do atendente, presença, menu de setores, distribuição (fila livre/rodízio), alertas (tela/WhatsApp/escalonamento), SLA, pesquisa de satisfação, painel ao vivo + simulado | — |
| **X1** lib do menu | Codex | `backend/lib/menu-setores/`: montar o texto do menu, interpretar a resposta (número, nome, nome parecido, "0"/"voltar"), tentativas | C10 |
| **X2** lib de distribuição | Codex | `backend/lib/distribuicao/`: escolher o atendente (disponível, menos conversas, limite, último a receber), justiça no rodízio | C10 |
| **X3** lib de SLA e alertas | Codex | `backend/lib/sla-alertas/`: vencimentos (primeira resposta, espera), quem alertar e quando, anti-repetição | C10 |
| **X4** lib da pesquisa | Codex | `backend/lib/pesquisa-satisfacao/`: interpretar nota (1–5, emojis, "ótimo"), texto da pergunta | C10 |
| **C11** Portal do atendente | Claude | Rota `/app/ia-talk/<apelido>/atendimento`, login celular + código (reuso), sessão de atendente, rotina `talk-atendimento` | C10 |
| **G15** Portal do atendente (tela) | Antigravity | Página dedicada (Central sem menu de administração), celular, notificação do navegador, som, título com contador, status Disponível/Ocupado/Ausente | C10 |
| **C12** Menu de setores | Claude | Estado "triagem" da conversa, envio do menu, escolha, tempo limite → setor padrão; liga com X1 | X1 |
| **C13** Presença e distribuição | Claude | Status do atendente, online pelo socket, rodízio com limite, tempo para aceitar e devolução à fila; liga com X2 | X2 |
| **C14** Alertas | Claude | Tela (evento por pessoa/setor), WhatsApp do atendente (sem texto do cliente), escalonamento ao supervisor; liga com X3 | X3 |
| **C15** Pesquisa de satisfação | Claude | Pergunta ao encerrar, resposta registrada; liga com X4 | X4 |
| **G16** Configuração do setor | Antigravity | Menu (aparece/ordem/texto), distribuição, limite, tempos, alertas, pesquisa | C10 |
| **C16** Painel ao vivo + relatórios (backend) | Claude | Fila, espera, por atendente, primeira resposta, TMA, satisfação (usa L2) | C13 |
| **G17** Painel ao vivo + relatórios (tela) | Antigravity | Painel da supervisão e relatórios por período/setor/atendente | C16 |
| **G18** Uso do número na tela de Canais | Antigravity | Campo "Uso do número" + setor padrão nas Regras do canal (hoje é por comando) | — |
| **C17** Política de atendimento | Claude | Padrão da empresa para todos os setores + personalização por bloco (§9.10). **Feito** | C12 |
| **C18** Encerramento por inatividade | Claude | Aguardando cliente, lembrete, encerramento e reabertura configuráveis (§9.9) | C17 |
| **C19** SLA completo + violações | Claude | Três prazos, horário do setor, pausa, prioridade alta, registro de violações e relatório (§9.6, §9.11). Assume a parte de SLA da X3 | C17 |
| **G20** Política de atendimento (tela) | Antigravity | Padrão da empresa e personalização por setor, com SLA completo e inatividade (§9.6, §9.9, §9.10) | C17 |
| **G21** SLA e "aguardando cliente" na Central | Antigravity | Contagem regressiva, cores, ordenação por vencimento, selo "Aguardando cliente" | C19 |

### Onda 2 — IA no atendimento
Copiloto (resumo da conversa, sugestão de resposta, tradução de jargão), agente de IA que
responde dúvidas com base de conhecimento da empresa e passa ao humano com resumo; triagem por
IA antes do menu (com confiança alta, direciona; com dúvida, mostra o menu). Reaproveita a
experiência da Jaade/IA Service.

### Onda 3 — Vendas
Contatos e empresas (carteira de clientes), funil em quadro com etapas, oportunidade ligada à
conversa, tarefas e lembretes, bot de qualificação, rodízio de leads entre vendedores, origem do lead.

### Onda 4 — Canal web (chat no site do cliente)
Widget de chat para o site da empresa, caindo na mesma Central (mesmas filas e setores).

### Onda 5 — API oficial da Meta e marketing
Habilitação do número, adaptador Meta (G6), campanhas com modelos aprovados, listas com
consentimento registrado, descadastro automático, métricas de campanha.

## Ordem de trabalho em paralelo (Onda 1)

1. **Claude:** C10 (contrato + simulado). Com o contrato pronto, os três trabalham juntos.
2. **Codex:** X1 → X2 → X3 → X4 (uma lib de cada vez, cada uma auditada pelo Claude).
3. **Antigravity:** G18 (já pode, contrato pronto) → G15 → G16 → G17, contra o simulado.
4. **Claude:** C11 → C12 → C13 → C14 → C15 → C16, ligando as libs do Codex conforme forem aprovadas.
5. Cada etapa sai **desligada**; o usuário homologa e liga.

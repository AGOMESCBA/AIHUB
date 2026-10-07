# IA Service - Auditoria visual real e proposta UX/UI

Data da auditoria: 07/10/2026  
Escopo: somente análise, inventário, matriz de paridade, proposta visual e mockups.  
Status: nenhum arquivo de produto foi alterado nesta etapa.

## 1. Acesso e evidências coletadas

Fluxo oficial validado:

```text
Número de WhatsApp
  -> Solicitar código
  -> OTP por WhatsApp
  -> Validação
  -> Radar / fila pessoal
```

Resultado real: a tela oficial de OTP foi acessada e o envio retornou indisponibilidade do WhatsApp no ambiente de teste. Após autorização explícita, foi usado acesso controlado de desenvolvimento apenas para abrir o Radar e auditar a experiência real. Não houve alteração de autenticação, sessão, banco, motor, frontend ou backend.

Evidências visuais:

- `tmp/ia-service-auditoria-visual/login-01-telefone.png`
- `tmp/ia-service-auditoria-visual/login-02-whatsapp-indisponivel.png`
- `tmp/ia-service-auditoria-visual/desktop-1280x720-01-radar-fila.png`
- `tmp/ia-service-auditoria-visual/desktop-1280x720-02-chamado-conversa.png`
- `tmp/ia-service-auditoria-visual/desktop-1280x720-03-detalhes.png`
- `tmp/ia-service-auditoria-visual/desktop-1280x720-03-risco-sla.png`
- `tmp/ia-service-auditoria-visual/desktop-1280x720-03-banco.png`
- `tmp/ia-service-auditoria-visual/mobile-390x844-01-radar-fila.png`

Mockups gerados para aprovação visual:

- `tmp/ia-service-auditoria-visual/mockups/desktop-claro.png`
- `tmp/ia-service-auditoria-visual/mockups/desktop-escuro.png`
- `tmp/ia-service-auditoria-visual/mockups/mobile-claro.png`
- `tmp/ia-service-auditoria-visual/mockups/mobile-escuro.png`

## 2. Inventário funcional encontrado

### Autenticação WhatsApp / OTP

- Tela de acesso web por telefone.
- Explicação do fluxo em três passos: telefone, código, radar.
- Campo de WhatsApp.
- Botão de envio de código.
- Estado de erro quando o WhatsApp está indisponível.
- Identidade visual IA Service preservada.

Recomendação: preservar a tela. Ela é clara, coerente com o fluxo oficial e não precisa ser redesenhada agora. Melhorias futuras devem focar apenas em microcopy e estado de indisponibilidade.

### Radar / fila pessoal

- Fila pessoal por consultor.
- Empresa selecionada.
- Filtros: Todos, Em atraso, Em dia.
- Atualização manual.
- Auto-refresh: Manual, 30s, 1 min, 5 min, 15 min.
- Indicador de próxima atualização.
- Toggle de pré-análise IA ao iniciar análise.
- Lista de chamados com número, status, cliente/produto/título e data de abertura.
- Seleção de chamado para abrir conversa.

### Conversa

- Cabeçalho do chamado com número, cliente, usuário, produto, empresa, sistema e título.
- Status de "Aguardando retorno" com identificação de quem aguarda.
- Indicadores de SLA e consultor.
- Descrição do problema.
- Anexos de abertura.
- Histórico de mensagens.
- Mensagens do analista/usuário e da IA.
- Campo de composição.
- Ação de anexar arquivo.
- Botão de envio.
- Botão "Pesquisar Soluções".
- Menu auxiliar no cabeçalho.

### Detalhes do Chamado

- Cartão de destaque de aguardando retorno.
- Resumo do chamado.
- Grupo Identificação.
- Grupo SLA & prazos.
- Grupo Classificação.
- Campos vistos na auditoria:
  - Aguardando retorno.
  - SLA.
  - Previsão de conclusão.
  - SLA em horas.
  - SLA inicial.
  - SLA anterior.
  - Status.
  - Aberto em.
  - Último posicionamento.
  - Duração total.
  - Duração total em horas.
  - Em suporte.
  - Em desenvolvimento.
  - Com o distribuidor.
  - Com o cliente.
  - Com a tecnologia do cliente.

### Risco SLA

- Visão geral de todos os consultores.
- Filtros: Todos, Em atraso, Próx. vencimento.
- Filtro por aguardando retorno:
  - Todos.
  - Aguardando Atendente.
  - Aguardando Cliente.
  - Aguardando Fornecedor.
- Sidebar de consultores com totais, atrasos e próximos vencimentos.
- Botão para recolher consultores.
- Busca por número, cliente e usuário.
- Grade agrupada por consultor.
- Colunas vistas:
  - Chamado.
  - Título.
  - Cliente.
  - Usuário.
  - Aguardando retorno.
  - Status.
  - Previsão conclusão.
  - Duração.
  - Horas duração.
  - Dias suporte.
  - Dias desenvol.
  - Dias distrib.
  - Dias cliente.
  - Dias tecn. cliente.
  - Último.

### Banco de Conhecimento

- Abas: Base interna e Pesquisa técnica.
- Cards de chamados similares.
- Score de similaridade.
- Produto/família/serviço/tipo.
- Histórico de posicionamentos do chamado similar.
- Pesquisa técnica integrada ao motor.

### Integrações e motor

- Integração SoftExpert preservada.
- Anexos SoftExpert preservados.
- Base histórica preservada.
- Pesquisa técnica preservada.
- Dossiê técnico persistente encontrado no backend.
- Quality Gate encontrado no backend.
- Motor de investigação com tratamento de evidências, pesquisa técnica e prevenção de repetição.

## 3. Achados principais

1. O produto atual já tem bastante funcionalidade real e não deve ser substituído às cegas.

O Radar atual concentra fila, conversa, detalhes, base e risco SLA. A proposta deve reorganizar a informação, não recriar o sistema.

2. O botão "Pesquisar Soluções" precisa virar CTA primário.

Hoje ele aparece no cabeçalho da conversa, mas disputa atenção com status, badges e menu. No mockup ele fica como botão primário azul, maior, com sombra leve e posição fixa no cabeçalho operacional do chamado.

3. O conceito de três áreas é adequado.

A organização mais forte é:

- Esquerda: fila de chamados.
- Centro: investigação/chat.
- Direita: resumo operacional vivo.

Isso preserva o chat como coração do IA Service e coloca evidências, próximos passos, anexos, pesquisa e SLA como memória operacional visível.

4. A aba Risco SLA tem valor, mas a grade está comprimida.

Em 1280x720, a fila da esquerda + consultores + grade fazem o usuário depender muito de scroll horizontal. O botão de recolher consultores já existe e deve ser mantido, mas a proposta recomenda também recolher a fila esquerda quando o usuário estiver em Risco SLA.

5. Dados de SLA e prazos já existem, mas precisam de lapidação visual.

Os campos pedidos aparecem em Detalhes e na grade. Há números com muitas casas decimais, por exemplo `11.700000000000001d` e `93.60000000000001h`, que devem ser formatados para leitura humana.

6. Mobile existe, mas ainda parece adaptação técnica.

Em 390x844, a fila ocupa a primeira parte da tela e a conversa aparece abaixo. A estrutura funciona, mas o mobile ideal deve ser por telas: Fila, Conversa, Resumo e Mais. Não deve tentar espremer três colunas.

7. Claro/Escuro/Sistema deve entrar como evolução visual, não só inversão de cor.

A V1 atual é majoritariamente escura. O modo claro melhora leitura de grade, anexos e resumo executivo. O modo escuro deve continuar existindo para uso operacional prolongado.

## 4. Matriz de paridade funcional

| Funcionalidade | Hoje na V1 | Proposta | Classe |
|---|---|---|---|
| Login por WhatsApp/OTP | Existe | Preservar | A |
| Fila pessoal do consultor | Existe | Preservar à esquerda | A |
| Filtros da fila | Existe | Preservar | A |
| Auto-refresh | Existe | Preservar | A |
| Pré-análise IA | Existe | Preservar | A |
| Conversa do chamado | Existe | Manter no centro | A |
| Anexos do chamado | Existe | Manter e também resumir à direita | A/C |
| Pesquisar Soluções | Existe | Dar ênfase como CTA primário | C |
| Detalhes do chamado | Existe | Manter em aba e resumir lateralmente | A/C |
| Risco SLA | Existe | Manter aba dedicada e melhorar largura | A/C |
| Recolher consultores no Risco SLA | Existe | Preservar e reforçar | A |
| Recolher fila esquerda no Risco SLA | Não visto | Propor para ampliar grade | C |
| Aguardando Atendente/Cliente/Fornecedor | Existe | Exibir de forma consistente em cabeçalho, detalhes e grid | A/C |
| Previsão de conclusão | Existe | Manter em Detalhes, Grid e resumo | A |
| Duração por área | Existe | Manter e formatar | A/C |
| Banco/Base de Conhecimento | Existe | Preservar | A |
| Pesquisa técnica | Existe | Preservar e destacar fontes | A/C |
| Dossiê operacional | Backend existe | Exibir como resumo lateral | B |
| Quality Gate | Backend existe | Exibir como selo/accordion | B |
| Painel lateral de resumo operacional | Não existe como área fixa | Propor | B/C |
| Tema claro/escuro/sistema | Não visto como controle | Propor | C |
| Abertura direta no SoftExpert | Integração/anexos existem; botão global não visto | Validar URL/ação antes de propor | D se não houver link confiável |
| Mobile por telas Fila/Conversa/Resumo/Mais | Parcial | Propor | C |

Legenda:

- A: já existe e deve ser preservado.
- B: existe no backend/motor, mas precisa ficar visível no frontend.
- C: melhoria de UX/UI sem nova capacidade de negócio.
- D: depende de nova capacidade, contrato ou dado que ainda precisa ser confirmado.

## 5. Proposta UX/UI

### Desktop

Estrutura recomendada:

- Topbar com marca IA Service/J2A, navegação principal, empresa e usuário.
- Coluna esquerda: fila de chamados e filtros.
- Centro: cabeçalho do chamado, CTA "Pesquisar Soluções", abas e conversa/investigação.
- Direita: resumo operacional com problema, hipótese, testes, próxima ação, anexos, pesquisa técnica e risco SLA.

Comportamentos:

- O botão "Pesquisar Soluções" deve ser primário, maior e sempre visível no cabeçalho do chamado.
- O painel direito deve poder ser recolhido.
- A fila esquerda deve poder ser recolhida em Risco SLA.
- A grade de Risco SLA deve priorizar largura e leitura.
- Campos numéricos de duração devem ser arredondados e padronizados.
- Badges de status devem usar cor + texto claro, sem depender apenas da cor.

### Mobile

Estrutura recomendada:

- Fila como tela inicial.
- Conversa como tela dedicada.
- Resumo operacional como drawer/tela própria.
- Mais: Detalhes, Risco SLA, Banco de Conhecimento e Configurações.
- Campo de mensagem fixo ao rodapé somente na tela de conversa.
- Sem três colunas comprimidas.

## 6. Mockups entregues

Os mockups foram criados como artefatos estáticos de auditoria:

- Desktop Claro: `tmp/ia-service-auditoria-visual/mockups/desktop-claro.png`
- Desktop Escuro: `tmp/ia-service-auditoria-visual/mockups/desktop-escuro.png`
- Mobile Claro: `tmp/ia-service-auditoria-visual/mockups/mobile-claro.png`
- Mobile Escuro: `tmp/ia-service-auditoria-visual/mockups/mobile-escuro.png`

Eles são referência de organização visual, não implementação. O conteúdo preserva o conceito IA Service: fila + investigação/chat + resumo operacional.

## 7. Recomendação final

Recomendação: **C - criar uma versão paralela de frontend do Radar para homologação, preservando a V1 atual em produção**.

Motivo:

- A V1 atual tem muito valor funcional e deve continuar operando.
- A mudança proposta é estrutural: três áreas, painel operacional, responsivo real, temas claro/escuro e nova hierarquia do CTA.
- Refatorar diretamente a tela atual aumenta o risco de regressão em chat, anexos, SoftExpert, pesquisa técnica, banco de conhecimento, detalhes e Risco SLA.
- A abordagem mais segura é criar uma V2 visual paralela usando os mesmos endpoints, mesmo motor e mesmas integrações; depois validar paridade funcional antes de substituir a tela atual.

Próximo passo recomendado: aprovar ou ajustar o mockup conceitual antes de qualquer implementação.

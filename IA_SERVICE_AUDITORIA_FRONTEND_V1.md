# IA Service - Auditoria UX/UI e Frontend V1

Data da auditoria: 2026-10-07  
Escopo: análise do frontend atual do IA Service, sem alteração de código.  
Limitação: tentei acessar `http://localhost:3000/app/ia-service/chat`, mas a requisição expirou. Havia um processo Node local, porém a interface não ficou disponível nessa URL dentro do timeout. A avaliação abaixo é baseada no código real, rotas reais e fluxo implementado. Não foram capturadas screenshots nesta rodada.

## 1. Resumo executivo

Recomendação principal: **B - EVOLUIR V1**.

A V1 não deve ser descartada. Ela já cobre a jornada operacional central do analista: fila de chamados SoftExpert, abertura/reabertura de atendimento, contexto do chamado, anexos, chat investigativo, pesquisa técnica e Risco SLA. O backend é mais maduro do que a apresentação: existem dossiê técnico, manifesto de evidências, auditoria de investigação, quality gate, pesquisa externa e seleção de anexos por orçamento de contexto.

O principal problema da V1 não é "visual moderno"; é **exposição incompleta de rastreabilidade operacional**. O analista conversa com a IA, mas nem sempre consegue ver com clareza por que a IA sugeriu algo, quais evidências foram usadas, quais anexos ficaram de fora, quando houve pesquisa real, quando a busca foi dispensada e qual é o estado atual da investigação.

Não há evidência suficiente para criar uma V2 paralela agora. Os problemas relevantes são corrigíveis com melhorias pontuais e estruturais dentro da V1.

## 2. Arquitetura atual encontrada

### Frontend

Arquivos principais:

- `apps/IA Service/frontend/shell.html`: shell MDI com abas internas e sidebar.
- `apps/IA Service/frontend/js/sidebar.js`: menu lateral. O Radar abre em nova guia via login externo por telefone.
- `apps/IA Service/frontend/js/tab-manager.js`: abas internas, iframe, persistência em `sessionStorage`, troca de empresa nas abas.
- `apps/IA Service/frontend/radar.html`: tela operacional principal. Contém fila, chat, detalhes, anexos, Banco de Conhecimento/Pesquisa Técnica e Risco SLA.
- `apps/IA Service/frontend/entrar.html`: login externo por telefone/WhatsApp.
- `apps/IA Service/frontend/atendimentos.html` e `atendimento.html`: fluxo legado/manual de atendimentos.
- `apps/IA Service/frontend/base-historica.html`: configuração/importação de base SoftExpert.
- `apps/IA Service/frontend/config-ia.html`: IA providers e Agente Local.
- `apps/IA Service/frontend/guia/index.html`: guia de uso.

### Backend e rotas

As rotas internas estão em `apps/IA Service/backend/routes/index.js`. O namespace principal é `/api/ia-service`, protegido por autenticação IAHub e contexto de empresa.

Rotas diretamente relevantes:

- `/api/ia-service/radar/fila`
- `/api/ia-service/radar/risco-sla`
- `/api/ia-service/radar/chamados/:chamadoId/iniciar-analise`
- `/api/ia-service/radar/chamados/:chamadoId/anexos-softexpert`
- `/api/ia-service/radar/chamados/:chamadoId/anexos-softexpert/:oid`
- `/api/ia-service/radar/chamados/:chamadoId/anexos-softexpert/sincronizar`
- `/api/ia-service/radar/chamados/:chamadoId/pesquisa-tecnica`
- `/api/ia-service/atendimentos/:id/mensagens`
- `/api/ia-service/atendimentos/:id/anexos`
- `/api/ia-service/atendimentos/:id/investigar`
- `/api/ia-service/atendimentos/:id/investigacoes`
- `/api/ia-service/atendimentos/:id/dossie`

Há rotas equivalentes para sessão externa em `apps/IA Service/backend/routes/externo-routes.js`, sob `/api/ia-service-externo`.

### Motor e dados

Camadas relevantes:

- `radar-service.js`: orquestra fila, abertura de atendimento, pré-análise e anexos SoftExpert.
- `radar-repository.js`: lista fila e Risco SLA a partir da base SQLite importada.
- `investigacao-service.js`: processa turnos, chama IA, pesquisa técnica, quality gate, dossiê e persistência de mensagens.
- `context-engine.js`: seleciona histórico, anexos, imagens, PDFs, pesquisa externa e manifesto de evidências.
- `technical-research-service.js`: planeja e executa pesquisa técnica, ranqueia fontes e páginas lidas.
- `anexos-softexpert-service.js`: lista/baixa/sincroniza anexos do SoftExpert.
- `armazenamento-anexos.js` e `extracao-conteudo.js`: validação, armazenamento e extração de conteúdo.

## 3. Jornada atual do analista

Jornada real identificada:

1. Usuário entra no IAHub.
2. Acessa IA Service pelo shell.
3. Clica em Radar de Chamados.
4. Por decisão implementada em `sidebar.js`, o Radar abre em nova guia via `/entrar-servico`, com login externo por telefone.
5. `radar.html` carrega fila do consultor.
6. Analista seleciona um chamado.
7. Frontend chama `iniciar-analise`.
8. Backend cria/reabre atendimento e pode disparar pré-análise automática.
9. Frontend carrega mensagens, anexos SoftExpert e anexos já sincronizados para IA.
10. Analista conversa com a IA, envia anexos e recebe diagnóstico.
11. Pode abrir Detalhes do Chamado, Banco de Conhecimento/Pesquisa Técnica e Risco SLA.
12. Pode acionar "Pesquisar Soluções", que sincroniza anexos SoftExpert e força nova investigação com contexto ampliado.

Essa jornada é coerente para operação diária, mas tem uma ruptura: sair do IAHub para login externo no Radar é funcional, porém adiciona atrito perceptível.

## 4. Pontos fortes

- A V1 concentra o trabalho real do analista em uma única tela operacional (`radar.html`).
- O modelo de conversa é adequado ao objetivo: histórico em bolhas, composer fixo, anexos no turno e feedback de processamento.
- A separação entre SoftExpert como origem oficial e IA Service como apoio está clara no backend e parcialmente clara no guia.
- Anexos são tratados com seriedade: validação de MIME real, limite de 20 MB, extração de conteúdo, download local e abertura de anexos SoftExpert.
- O backend possui mecanismos avançados de confiança: manifesto, dossiê, pesquisa técnica, quality gate, retry e auditoria de execução.
- O frontend escapa HTML em muitos pontos críticos (`escapeHtml`, renderização de texto com código), reduzindo risco básico de XSS.
- O Radar suporta modo interno e externo com o mesmo HTML, reduzindo duplicação funcional.
- Risco SLA e Detalhes do Chamado já se aproximam de uma visão operacional útil, não apenas chat.

## 5. Problemas comprovados

### Achado 1 - Auditoria/dossiê existem no backend, mas não aparecem como trilha operacional no Radar

Evidência:

- `routes/index.js` expõe `/atendimentos/:id/investigacoes` e `/atendimentos/:id/dossie`.
- `investigacao-service.js` persiste `manifesto`, `contexto`, `pesquisa`, `qualityGate` e atualizações do dossiê.
- `radar.html` só referencia diagnóstico e nível de confiança nas mensagens. Busca por `investigacoes`, `dossie`, `quality`, `manifesto` no Radar não mostra consumo desses endpoints.

Local/arquivo:

- `apps/IA Service/backend/routes/index.js`
- `apps/IA Service/backend/services/investigacao-service.js`
- `apps/IA Service/frontend/radar.html`

Impacto: **ALTO**  
Tipo: UX / Funcional / Arquitetura de informação  
Recomendação: **CORRIGIR V1**  
Benefício esperado: o analista entenderá por que a IA chegou a uma resposta, quais evidências foram usadas e o que ficou pendente.  
Risco da alteração: médio; envolve exibir dados já existentes sem sobrecarregar a conversa.

### Achado 2 - "Banco de Conhecimento" e "Pesquisa Técnica" ficam separados da resposta da IA

Evidência:

- `radar.html` renderiza aba de pesquisa técnica via `carregarPesquisaTecnica` e `renderizarPesquisaTecnica`.
- A resposta no chat mostra diagnóstico, mas não mostra, junto da bolha, links/fonte usados naquele turno.
- `technical-research-service.js` produz `resultados`, `paginasLidas`, `links`, `modo`, `confianca` e plano de pesquisa.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`
- `apps/IA Service/backend/services/technical-research-service.js`

Impacto: **ALTO**  
Tipo: UX / Funcional  
Recomendação: **CORRIGIR V1**  
Benefício esperado: reduzir confiança cega ou retrabalho; permitir validação técnica rápida.  
Risco da alteração: baixo a médio; pode ser feito como painel recolhível por mensagem.

### Achado 3 - Estados da investigação são simples demais para a maturidade do motor

Evidência:

- `radar.html` mostra `showTyping('Analista IA Service está analisando...')` ou pesquisando.
- Backend diferencia classificação de turno, pesquisa, contexto, leitura de anexos, PDF visual, quality gate e dossiê.
- A UI não mostra fases como "lendo anexos", "pesquisa dispensada", "quality gate reprocessando", "dossiê atualizado" ou "evidência omitida por orçamento".

Local/arquivo:

- `apps/IA Service/frontend/radar.html`
- `apps/IA Service/backend/services/investigacao-service.js`
- `apps/IA Service/backend/services/context-engine.js`

Impacto: **MÉDIO/ALTO**  
Tipo: UX / Funcional  
Recomendação: **CORRIGIR V1**  
Benefício esperado: melhora de confiança e menor ansiedade em chamados longos.  
Risco da alteração: médio; precisa evitar ruído visual.

### Achado 4 - O arquivo `radar.html` concentra muitas responsabilidades

Evidência:

- `radar.html` contém CSS, HTML e JS da fila, chat, anexos, Risco SLA, Detalhes, pesquisa, autenticação externa e manipulação de mensagens.
- Há várias funções globais e estados globais: `filaCache`, `riscoCache`, `chamadoAtual`, `anexosPendentes`, `anexosSoftExpertCache`, `anexosAtendimentoCache`, `atendimentosEmProcessamento`.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`

Impacto: **MÉDIO**  
Tipo: Arquitetura / Manutenibilidade  
Recomendação: **CORRIGIR V1**, não migrar automaticamente para framework.  
Benefício esperado: reduzir risco de regressão ao evoluir anexos, pesquisa e chat.  
Risco da alteração: médio se feito como refactor grande; baixo se modularizar incrementalmente por arquivos JS.

### Achado 5 - Login do Radar em nova guia por telefone resolve bug de cookie, mas cria atrito

Evidência:

- `sidebar.js` documenta que o Radar sempre abre por `/entrar-servico` devido a problema de cookie em nova aba.
- Comentário indica custo: pedir código WhatsApp novamente.

Local/arquivo:

- `apps/IA Service/frontend/js/sidebar.js`

Impacto: **MÉDIO**  
Tipo: UX / Navegação  
Recomendação: **CONSIDERAR CORREÇÃO V1**  
Benefício esperado: entrada mais fluida para usuários já autenticados no IAHub.  
Risco da alteração: médio; mexe em autenticação/sessão, área sensível.

### Achado 6 - Anexos são funcionais, mas a rastreabilidade "a IA usou este arquivo" ainda é parcial

Evidência:

- A UI mostra botão de anexos do chamado e modal unificado.
- Há badge "Analisado pela IA" quando local tem `conteudoExtraido`.
- O backend seleciona/omite anexos por relevância, orçamento e necessidade visual, mas a UI não mostra por turno quais foram selecionados, omitidos ou falharam.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`
- `apps/IA Service/backend/services/context-engine.js`

Impacto: **ALTO** em chamados com muitos logs/prints/PDFs  
Tipo: UX / Evidência  
Recomendação: **CORRIGIR V1**  
Benefício esperado: o analista saberá se a IA realmente considerou o arquivo correto.  
Risco da alteração: médio; requer expor o manifesto de forma compreensível.

### Achado 7 - Pesquisa técnica é boa, mas pode ser confundida com evidência usada

Evidência:

- `technical-research-service.js` distingue `modo` como `web`, `links` ou `nao_pesquisado`.
- `radar.html` apresenta resultados na aba "Banco de Conhecimento", mas a conversa não deixa claro se aquela fonte fundamentou a resposta ou é apenas trilha sugerida.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`
- `apps/IA Service/backend/services/technical-research-service.js`

Impacto: **MÉDIO**  
Tipo: UX / Confiança  
Recomendação: **CORRIGIR V1**  
Benefício esperado: evitar decisão técnica baseada em fonte não lida ou busca não executada.  
Risco da alteração: baixo.

### Achado 8 - Segurança de apresentação é razoável, mas há pontos que exigem endurecimento

Evidência:

- O Radar usa `escapeHtml` em texto de chamados, mensagens, anexos e pesquisa.
- Links externos são renderizados em `href` com `escapeHtml`, mas isso não valida protocolo.
- Há handlers inline com IDs/nome de arquivo dentro de strings HTML. Isso exige cuidado extra com escape de contexto JavaScript, que é diferente de escape HTML.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`

Impacto: **MÉDIO**  
Tipo: Segurança / Frontend  
Recomendação: **CORRIGIR V1**  
Benefício esperado: reduzir risco de XSS via URLs, nomes de arquivo ou dados importados.  
Risco da alteração: baixo se trocar para `addEventListener`/dataset e validar URL.

### Achado 9 - Responsividade existe, mas a tela principal é naturalmente densa

Evidência:

- `radar.html` possui media query para alternar lista/chat em telas menores.
- A tela reúne fila, cabeçalho, abas, chat, composer, anexos, detalhes e Risco SLA.

Local/arquivo:

- `apps/IA Service/frontend/radar.html`

Impacto: **MÉDIO**  
Tipo: UX / UI / Responsividade  
Recomendação: **CORRIGIR V1**  
Benefício esperado: melhor uso em notebooks e telas menores.  
Risco da alteração: baixo se feito por ajustes pontuais.

## 6. Chat

Situação atual:

- O chat tem bolhas, autor, horário, anexos do turno e diagnóstico estruturado.
- O composer aceita texto e upload por input.
- Mensagens longas e código são renderizados por `renderizarTextoComCodigo`, escapando conteúdo e tratando blocos de código.
- Há feedback de processamento com `showTyping`.

Pontos fortes:

- O fluxo se aproxima do modelo "WhatsApp técnico": conversa contínua, baixa cerimônia e histórico natural.
- Diferencia técnico e IA.
- Mantém contexto ao selecionar chamado.
- Permite pesquisar soluções com contexto ampliado.

Problemas:

- Não há linha do tempo estruturada de hipóteses, testes, causa e solução no frontend, apesar de o backend ter dossiê.
- O feedback de processamento não revela fases relevantes.
- A bolha da IA não mostra evidências usadas e omitidas.
- A retomada de investigação longa depende muito da leitura cronológica das mensagens.

Recomendação:

- Manter o chat como centro da V1.
- Acrescentar painel lateral/recolhível por resposta: "Evidências usadas", "Pesquisa", "Dossiê atualizado" e "Alertas".
- Adicionar resumo de investigação no topo ou na aba Detalhes: problema, hipóteses ativas, testes pedidos, causa provável, solução.

## 7. Chamados SoftExpert

Situação atual:

- A fila vem de `radar/fila`.
- Risco SLA vem de `radar/risco-sla`.
- Detalhes do chamado incluem identificação, SLA, prazos, classificação, encerramento e Kanban quando existe.
- SoftExpert aparece também nos anexos e na importação histórica.

Pontos fortes:

- O Radar é orientado a chamados reais, não a atendimentos soltos.
- A UI mostra SLA, responsável, cliente, usuário e título.
- A aba Risco SLA é uma visão operacional útil para acompanhamento.

Problemas:

- Muita informação importante compete por espaço no cabeçalho e detalhes.
- O analista pode precisar alternar entre Conversa, Detalhes e Banco de Conhecimento para formar uma visão completa.

Recomendação:

- Preservar a estrutura atual.
- Melhorar hierarquia visual do cabeçalho e resumo operacional.
- Usar Detalhes do Chamado como "contexto consolidado", não apenas grade de campos.

## 8. Anexos

Situação atual:

- Há anexos da origem SoftExpert e anexos locais do atendimento.
- A UI tem resumo no cabeçalho e modal de anexos.
- Upload do analista ocorre antes de investigar.
- Backend extrai texto, detecta código, guarda metadados e preserva binário.

Pontos fortes:

- Boa base técnica.
- Diferencia anexos SoftExpert e anexos enviados na conversa.
- Permite abrir/baixar.

Problemas:

- O analista não vê claramente, por resposta, quais anexos foram realmente analisados.
- Falhas de extração/visualização existem no backend, mas aparecem apenas em mensagens de erro quando bloqueantes.
- Não há preview interno de conteúdo extraído; abrir/baixar tira o analista do fluxo.

Recomendação:

- Exibir "usado nesta resposta" e "não usado" por anexo, baseado no manifesto.
- Mostrar tipo detectado, extração e status de IA de forma mais específica.
- Considerar preview textual leve para TXT/log/JSON/XML/código.

## 9. Fontes/evidências

Situação atual:

- Pesquisa técnica existe e retorna fontes, resultados, páginas lidas, links sugeridos, modo e confiança.
- A aba Banco de Conhecimento mostra base interna e pesquisa web.
- O prompt recebe contexto formatado da pesquisa.

Problema central:

O analista nem sempre consegue responder: **"a IA usou esta fonte para sugerir isso ou esta fonte é apenas uma trilha?"**

Recomendação:

- Para cada resposta da IA, mostrar:
  - pesquisa executada? sim/não;
  - modo: web, links sugeridos ou dispensada;
  - páginas lidas;
  - fontes oficiais;
  - trechos usados;
  - fontes omitidas por orçamento.

## 10. UX/UI

### O que manter

- Conversa como tela principal.
- Lista de chamados à esquerda.
- Cabeçalho compacto do chamado.
- Abas internas para Detalhes, Banco de Conhecimento e Risco SLA.
- Tema escuro para trabalho operacional.

### O que melhorar pontualmente

- Maior clareza do "próximo passo" esperado do analista.
- Evidências usadas junto da resposta.
- Estado da IA durante processamento.
- Resumo persistente da investigação.
- Melhor navegação de conversas longas.
- Validação visual de URLs/anexos sem sair tanto do fluxo.

## 11. Arquitetura frontend

Vanilla JS continua adequado para a V1.

Não há justificativa técnica imediata para introduzir React/Vue/Svelte apenas por preferência estética. O sistema é uma aplicação operacional interna com interações previsíveis; Vanilla JS, HTML e CSS ainda sustentam a V1.

O risco real é concentração excessiva em `radar.html`. A recomendação não é framework novo, mas modularização incremental:

- `radar-api.js`
- `radar-state.js`
- `radar-chat.js`
- `radar-anexos.js`
- `radar-pesquisa.js`
- `radar-risco-sla.js`
- `radar-detalhes.js`

Essa divisão reduziria regressões sem reescrever a tela.

## 12. Segurança

Pontos positivos:

- Uso amplo de `escapeHtml`.
- Download de anexos por endpoint controlado.
- Backend não expõe `err.stack` ao frontend.
- Upload passa por validação de MIME real e limite de tamanho.
- IA Service usa banco próprio e separação de tenant por empresa.

Riscos:

- Links externos devem validar protocolo (`http:`/`https:`) antes de entrar em `href`.
- Dados interpolados em `onclick` exigem escape de JavaScript, não só HTML.
- Falta política explícita no frontend para impedir `javascript:`/`data:` em links oriundos de pesquisa.
- A ausência de uma camada de sanitização central para HTML gerado aumenta risco de erro futuro.

Recomendação:

- Corrigir V1 com `safeUrl`, `dataset` + `addEventListener` e helpers de renderização DOM.
- Manter conteúdo da IA escapado; não habilitar Markdown bruto sem sanitizador.

## 13. Cenários avaliados

Como a interface não pôde ser aberta localmente nesta rodada, os cenários abaixo foram avaliados por fluxo de código.

### Cenário A - Chamado simples + 1 screenshot

Suportado. O upload aceita imagens e o backend envia imagens selecionadas ao provider quando necessário. O frontend mostra anexo no turno. Lacuna: não mostra claramente na resposta que a imagem foi de fato usada.

### Cenário B - Descrição extensa + vários anexos

Suportado pelo motor via orçamento de contexto e seleção de evidências. Lacuna: o frontend não mostra anexos omitidos por orçamento/relevância.

### Cenário C - Chamado técnico com logs/código

Suportado. Extração detecta código/log/texto, e a resposta renderiza blocos de código de forma escapada. Lacuna: preview/diff/versionamento de fonte existe em backend, mas não está integrado de forma forte ao Radar.

### Cenário D - Investigação longa

Parcialmente suportado. O histórico é carregado e o dossiê existe no backend. Lacuna: o frontend ainda obriga leitura cronológica; não há resumo evolutivo de hipóteses/testes/causa.

### Cenário E - Chamado concluído

Parcialmente suportado. Mensagens e diagnóstico persistem. Lacuna: reconstruir Problema -> Hipóteses -> Testes -> Causa -> Solução não é uma visualização própria da V1, apesar de o dossiê poder alimentar isso.

## 14. Matriz de achados

| Área | Situação atual | Problema? | Impacto | Recomendação |
|---|---|---:|---|---|
| Navegação | Shell MDI e Radar em nova guia por login externo | Sim, atrito de reautenticação | Médio | Corrigir V1 com cautela |
| Lista de chamados | Fila lateral funcional com filtros | Parcial | Médio | Manter e refinar hierarquia |
| Abertura do chamado | Seleção inicia/reabre análise | Não crítico | Baixo | Manter |
| Contexto | Detalhes e cabeçalho mostram dados do chamado | Parcial | Médio | Corrigir V1 |
| Chat | Bolhas, histórico, anexos, diagnóstico | Parcial | Alto | Evoluir V1 |
| Composer | Texto, upload, Ctrl+Enter | Parcial | Médio | Adicionar estados e talvez drag/drop/colar |
| Anexos | Modal, abrir/baixar, upload, sync SoftExpert | Sim, rastreabilidade parcial | Alto | Corrigir V1 |
| Mensagens IA | Diagnóstico e confiança | Sim, sem evidências por resposta | Alto | Corrigir V1 |
| Fontes | Aba Banco de Conhecimento/Pesquisa | Sim, desconectada da resposta | Alto | Corrigir V1 |
| Investigação longa | Histórico existe, dossiê backend existe | Sim, síntese visual ausente | Alto | Corrigir V1 |
| Estados | Loading genérico analisando/pesquisando | Sim | Médio/Alto | Corrigir V1 |
| Erros | `showError` e mensagens persistidas em alguns casos | Parcial | Médio | Melhorar V1 |
| Responsividade | Media query básica e tela cheia | Parcial | Médio | Melhorias pontuais |
| Acessibilidade | HTML funcional, mas muitos botões inline/ícones | Parcial | Médio | Melhorias pontuais |
| Arquitetura frontend | V1 funcional em Vanilla JS, mas `radar.html` concentra muito | Sim | Médio | Modularizar V1 |
| Segurança | Escape amplo, mas URLs/onclick merecem hardening | Sim | Médio | Corrigir V1 |

## 15. Quick wins, sem implementar

1. Exibir "Evidências usadas nesta resposta" em cada bolha da IA, consumindo `/atendimentos/:id/investigacoes`.
2. Mostrar estado "pesquisa executada", "pesquisa dispensada" ou "links sugeridos" junto à resposta.
3. Mostrar anexos omitidos por orçamento/relevância no modal de anexos ou painel de evidências.
4. Validar URLs externas antes de renderizar links.
5. Substituir handlers inline críticos por `dataset` + `addEventListener`.
6. Criar resumo de investigação no topo da aba Detalhes: problema, hipótese atual, teste pedido, causa provável, próxima ação.
7. Melhorar feedback de processamento em fases reais, sem animação cosmética.
8. Adicionar busca/filtro no histórico de mensagens para conversas longas.

## 16. Melhorias estruturais, sem implementar

1. Modularizar `radar.html` em JS/CSS por domínio sem trocar framework.
2. Criar componente/padrão de "Evidence Drawer" por mensagem.
3. Integrar dossiê ao frontend como memória operacional visível.
4. Criar visualização final de chamado concluído: Problema -> Hipóteses -> Testes -> Causa -> Solução.
5. Criar camada central de renderização segura para links, botões e listas.
6. Separar estados do Radar em store simples para reduzir globais.
7. Criar contrato frontend para `investigacao_execucoes` com dados já filtrados para UI.

## 17. Recomendação A/B/C

Decisão: **B - EVOLUIR V1**.

Não recomendo **A - manter como está**, porque há lacunas reais de produtividade e confiança: evidências, fontes, dossiê e estados existem, mas não aparecem de modo suficiente para o analista.

Não recomendo **C - criar frontend V2 paralelo** agora, porque:

- a V1 já entrega a jornada principal;
- o backend e as APIs atuais são bons e reaproveitáveis;
- os problemas mais importantes são de exposição de informação e organização, não de fundação visual;
- uma V2 aumentaria risco de regressão operacional sem provar ganho proporcional.

## 18. Justificativa

A arquitetura atual mostra um backend bem evoluído e uma V1 operacional. O frontend não está "errado"; ele está atrasado em relação ao motor. A melhoria de maior valor é tornar visível a inteligência que já existe: manifesto, dossiê, pesquisa, quality gate, anexos selecionados e omitidos.

Isso pode ser feito incrementalmente dentro da V1, preservando o fluxo que o analista já conhece.

## 19. Riscos de mexer

- Quebrar a jornada operacional atual do Radar.
- Sobrecarregar visualmente o chat com metadados técnicos.
- Introduzir XSS ao renderizar fontes/evidências de forma rica.
- Duplicar lógica de backend no frontend.
- Criar refactor grande em `radar.html` e perder estabilidade.

Mitigação:

- Implementar por painéis recolhíveis.
- Começar por leitura de endpoints existentes.
- Criar helpers seguros de renderização.
- Evitar troca de framework na primeira onda.
- Testar com chamados reais longos e com muitos anexos.

## 20. Riscos de não mexer

- Analistas continuarem sem saber por que a IA respondeu aquilo.
- Maior desconfiança nas sugestões da IA.
- Retrabalho em chamados com muitos anexos.
- Dificuldade para auditar erros de resposta.
- Conversas longas virarem histórico difícil de reconstruir.
- O motor evoluir sem que o ganho apareça para o usuário.

## Conclusão

A V1 deve continuar. O caminho recomendado é evoluí-la com foco em rastreabilidade, evidência e continuidade da investigação. O IA Service já tem as peças técnicas mais difíceis; falta o frontend transformar essas peças em confiança operacional para o analista.

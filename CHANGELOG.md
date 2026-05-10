# Changelog

## v1.1.0 - 2026-05-10

Nova versao focada em administracao por empresa, permissoes por rotina, integracoes SoftExpert por flows configuraveis e controle de uso/configuracao de IA.

### Principais mudancas

- Adicionado controle de permissoes por empresa e rotina, com menu lateral filtrado conforme o usuario logado.
- Criado o SE API Configurador para templates XML, headers, mapeamentos, configs, flows, execucao e historico.
- Adicionadas integracoes dedicadas para SE Funcoes e SE Vagas usando flows do configurador.
- Evoluida a integracao SE Curriculos para operar em modo legado, flow individual ou flow GRID em lote.
- Adicionada configuracao de chaves Groq/Gemini por empresa e registro de consumo/erros de IA.
- Melhorado o analisador de curriculos com pesos de pontuacao configuraveis, corte minimo e bloqueio de analise duplicada por vaga.
- Adicionado suporte ao WhatsApp Meta Cloud API, webhook e teste de conexao, mantendo compatibilidade com whatsapp-web.js.
- Movidos logs operacionais para `logs/` e sessoes para armazenamento em arquivo, evitando gravar dados sensiveis no repositorio.
- Reformuladas telas administrativas com grids, agrupamentos e painel de acessos por empresa/rotina.

### Mudancas por fonte

#### Raiz da aplicacao

- `index.js`: adiciona FileSessionStore, inicializacao de configuracoes, logs em `logs/`, rotas de permissoes, rotas de IA e novas rotas/static files das integracoes SE.
- `package.json` e `package-lock.json`: versao atualizada para `1.1.0`.
- `.gitignore`: ignora `data/`, `logs/`, sessoes/cache do WhatsApp e assets locais da pasta `.claude`.

#### Frontend base

- `frontend/login.html`: adiciona mostrar/ocultar senha, redirecionamento quando ja autenticado e validacao de erro ao selecionar empresa.
- `frontend/css/iahub.css`: amplia sidebar e ajusta labels/setas para novo menu.
- `frontend/js/auth.js`: carrega rotinas permitidas, bloqueia paginas sem permissao e redireciona para a primeira rotina disponivel.
- `frontend/js/sidebar.js`: adiciona IDs de rotina, novas secoes de Analisador e Integracoes, aliases e filtro por permissao.
- `frontend/js/dashboard-vagas.js`: novo script compartilhado para dashboards/listagens de vagas.
- `frontend/js/grid-group-panel.js`: novo helper de agrupamento visual em grids.
- `frontend/se-integracoes.html` e `frontend/se-integracoes-config.html`: novas paginas centrais para operacao/configuracao das integracoes SE.

#### Administracao, usuarios e seguranca

- `frontend/administracao.html`: troca tabelas manuais por grids com agrupamento, inclui reset das novas tabelas SE e adiciona painel de permissoes por empresa/rotina.
- `modules/usuarios/frontend/usuarios.html`: atualiza manutencao de usuarios para trabalhar com permissoes por rotina.
- `modules/permissoes/database.js` e `modules/permissoes/routes.js`: novo modulo de persistencia e API de permissoes.
- `modules/auth/index.js`: adiciona middleware `requireAdmin`.
- `modules/auth/database.js`: move auditoria para `logs/auditoria.log`.
- `modules/auth/session-store.js`: novo armazenamento de sessao em arquivo.
- `modules/seguranca/database.js` e `modules/seguranca/frontend/seguranca.html`: ajustam leitura da auditoria em `logs/` e exibicao administrativa.

#### Empresas e reset de dados

- `modules/empresas/routes.js`: adiciona contagem/reset das tabelas de integracoes SE, configurador API, flows, mappings, headers e logs.
- `modules/empresas/frontend/empresas.html`: atualiza tela para grids/agrupamentos e fluxo administrativo revisado.

#### Configuracoes e IA

- `modules/configuracoes/database.js`: novo armazenamento de configuracoes globais/por empresa e migracao inicial de chaves do `.env`.
- `modules/configuracoes/routes.js`: adiciona APIs para mascarar, revelar e salvar chaves Groq/Gemini por empresa.
- `modules/configuracoes/frontend/configuracoes.html`: inclui interface de chaves de IA, modelo Gemini e configuracoes relacionadas.
- `modules/ia/index.js`: usa chaves por empresa, fallback Groq/Gemini e grava metricas de uso.
- `modules/ia/routes.js` e `modules/ia/usage-db.js`: novas APIs e persistencia de consumo, saldo manual e custos estimados.

#### Analisador de curriculos

- `modules/analisador-curriculos/database.js`: adiciona pesos de pontuacao, backfill de empresa em analises e busca de analise por vaga.
- `modules/analisador-curriculos/routes.js`: usa IA por empresa, grava uso, aplica pesos configuraveis e corte minimo, evita duplicidade por vaga.
- `modules/analisador-curriculos/frontend/analisador.html`: ajusta experiencia de analise e tratamento de analises ja existentes.
- `modules/analisador-curriculos/frontend/config-analisador.html`: adiciona configuracao de pesos/corte e melhorias de equivalencias.
- `modules/analisador-curriculos/frontend/funcoes.html`, `historico.html` e `vagas.html`: atualizam listagens, status e compatibilidade com as novas integracoes.

#### Processo seletivo

- `modules/processo-seletivo/routes.js`: usa modulo central de IA por empresa ao validar/traduzir/analisar curriculos e configura log por empresa.
- `modules/processo-seletivo/email-imap.js`: ajusta processamento/logs de e-mail.
- `modules/processo-seletivo/frontend/curriculos.html`, `funcoes.html`, `vagas.html` e `ps-publico.html`: atualizam UX, status e compatibilidade com analises/integracoes.

#### WhatsApp curriculo

- `modules/whatsapp-curriculo/routes.js`: adiciona configuracao Meta Cloud API, teste de conexao, webhooks publicos e status por provider.
- `modules/whatsapp-curriculo/service-meta.js`: novo servico para processar mensagens pela Meta Cloud API.
- `modules/whatsapp-curriculo/service-manager.js`: escolhe provider Meta ou WebJS por empresa e roteia webhooks.
- `modules/whatsapp-curriculo/service.js`: passa `empresaId` para IA centralizada e salva nome da empresa no curriculo.
- `modules/whatsapp-curriculo/database.js`: expande configuracoes/metadados necessarios.
- `modules/whatsapp-curriculo/frontend/config.html`, `dashboard.html` e `monitor.html`: adicionam configuracao Meta, indicadores de provider e melhorias de monitoramento.

#### Integracoes SoftExpert

- `modules/integracoes/SEApiConfigurator/database.js`: novo CRUD de templates, configs, headers, mappings, flows, steps, logs e leitura de fontes.
- `modules/integracoes/SEApiConfigurator/engine.js`: novo motor de placeholders, XML, blocos `form_fields`/`grid_rows`, requests HTTP/SOAP e captura de WorkflowID.
- `modules/integracoes/SEApiConfigurator/routes.js`: novas APIs de teste, templates, configs, mappings, flows, execucao e historico.
- `modules/integracoes/SEApiConfigurator/frontend/se-api-configurador.html`: nova interface completa do configurador.
- `modules/integracoes/SECurriculo/database.js`: adiciona campos de origem de integracao, lookup de logs e associacao com steps do configurador.
- `modules/integracoes/SECurriculo/routes.js`: adiciona modos legado/flow/grid, logs detalhados por step, reenvio de step e dados enriquecidos de analise.
- `modules/integracoes/SECurriculo/service.js`: permite campos customizados de empresa no SOAP legado.
- `modules/integracoes/SECurriculo/frontend/se-curriculos.html`: amplia configuracao, historico, steps e visualizacao dos envios.
- `modules/integracoes/SEFuncao/*`: novo modulo para enviar funcoes ao SE via flow, com status, logs, reenvio e reset.
- `modules/integracoes/SEVaga/*`: novo modulo para enviar vagas ao SE via flow, gravando status, logs e WorkflowID retornado.

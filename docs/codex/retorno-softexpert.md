# Retorno ao SoftExpert — implementação e homologação

## Estado da entrega

O fluxo foi conectado ao executor SOAP configurável, reaproveitando interface, autorização, auditoria, importação e chat existentes. A configuração de exemplo permanece desabilitada. Nenhuma credencial real foi cadastrada, nenhuma migração foi aplicada ao banco real por estes testes e nenhuma gravação no SoftExpert foi executada.

Não existe mais bloqueio fixo no código. O envio depende de um contrato completo e validado para a empresa, fonte e analista: nomes físicos de tabelas não comprovam os identificadores lógicos das APIs.

## Interface e autorização

- Painel compartilhado nos chats J2A e Radar original, redimensionável no desktop e em tela inteira até 1100 px, inclusive mobile de 320 px.
- Rascunhos e arquivos em memória, separados por sessão/chamado. Fechar ou cancelar preserva; sair/recarregar limpa. Arquivos precisam permanecer disponíveis para retomar uma tentativa parcial.
- Confirmação obrigatória: **Deseja realmente registrar este retorno no SoftExpert?**, com Cancelar e Sim, confirmar envio.
- Campos, listas e obrigatoriedade vêm do contrato validado. Campos sem mapeamento ou calculados não são enviados. Não foram inventados cálculos de horas ou opções de classificação.
- Autorização por empresa, chamado aberto, origem SoftExpert, vínculo ativo atual na Platform e analista responsável. Escrita coletiva não foi habilitada por inferência.
- Sessão externa exige prova de OTP. A escolha de empresa usa token de uso único vinculado ao telefone, válido por cinco minutos. Sessões antigas precisam de novo login para escrever. Sessões internas verificam a origem da confirmação.

## Operações SOAP

| Etapa | Operação e endpoint | Requisição e resposta |
|---|---|---|
| Posicionamento | `newChildEntityRecord`, `POST /apigateway/se/ws/wf_ws.php`, `urn:workflow` | `WorkflowID`, `MainEntityID`, `ChildRelationshipID`, `EntityAttributeList/EntityAttribute/EntityAttributeID/EntityAttributeValue`. Resposta: `Status`, `Code`, `Detail`, `RecordKey`. |
| Arquivo | `newTableRecord`, `POST /apigateway/se/ws/fm_ws.php`, `urn:form` | `UserID` quando configurado, `TableID`, `TableFieldFileList/TableFieldFile` com `TableFieldID`, `FileName`, `FileContent`; `RelatedTo/RelatedRelationshipID/RelatedRelationshipValue`. Resposta: `Status`, `Code`, `Detail`, `RecordID`. Transportes multipart/CID e base64 inline preparados, sujeitos ao contrato instalado. |
| Comentário opcional | `newComment`, `POST /apigateway/se/ws/wf_ws.php`, `urn:workflow` | `WorkflowID`, `Text`, `ActivityID` opcional, `Private` explícito. Resposta: `Status`, `Code`, `Detail`. Sem parâmetro de autoria inventado. Desabilitado por padrão. |

Referências locais: `.claude/skills/softexpert-wf-ws/references/newChildEntityRecord.md` e `references/newComment.md`, seções **Parâmetros**, **Estrutura da requisição** e **Retorno**; `references/00-overview.md`, autenticação e formatos. Referência de formulário: [documentação oficial newTableRecord](https://developer.softexpert.com/docs/data-integration/reference/web-service-soap/form/newTableRecord). Não existe referência Markdown própria dessa operação na cópia local. O WSDL real continua necessário para confirmar o transporte na instalação.

As chamadas são separadas, sem transação única. O transporte permite exclusivamente essas três operações. Não há movimentação de atividade ou SQL de escrita no SoftExpert.

HTTPS valida certificado, não segue redirecionamentos, tem timeout e limites de corpo/resposta. O parser valida namespace/operação, rejeita DTD e respostas ambíguas. `authorizationMode: jwt` envia o token diretamente em Authorization, sem prefixo, conforme o [guia oficial de API Key](https://developer.softexpert.com/docs/data-integration/authentication-guides/api-key); `bearer` acrescenta `Bearer` e só deve ser selecionado se confirmado na instalação. Codificação UTF-8 ou Latin-1 também exige confirmação; não há tentativa automática de formatos alternativos.

**Validação do upload:** o exemplo oficial de `newTableRecord` usa `FileContent` com referência `cid:`. O modo `cid_multipart` monta SOAP com essa referência e uma parte MIME binária vinculada por Content-ID. Há também modo `base64_inline`, cuja aceitação não é comprovada pelo exemplo. Selecionar o transporte conforme o WSDL real; se exigir outro perfil, como MTOM/XOP, adaptar com base nesse contrato antes de habilitar anexos. Não marcar `contratoValidado` para contornar essa pendência.

## Mapeamento confirmado e pendente

| Estrutura física confirmada | Uso | Informação lógica ainda necessária |
|---|---|---|
| `DYNITSM` | Chamado pai | `MainEntityID` real. |
| `DYNITSMGRIDREGISTR`, FK `OIDABCA7HP6S55J0LV → DYNITSM.OID` | Grid | `ChildRelationshipID`, IDs de campos, obrigatoriedades, listas e eventos. |
| `DESCRICAO` | Memo | ID lógico do atributo. |
| Horas, datas, classificações e autoria | Valores digitados ou automáticos | IDs, tipos, unidades, opções, cálculos e origem dos valores automáticos. |
| `DYNITSMGRIDANEXOAP`, FK `OIDABCCMV6IBMOTU70 → DYNITSMGRIDREGISTR.OID`, `OIDARQUIVO1` | Arquivo do posicionamento | `TableID`, relacionamento e campo lógicos; confirmar vínculo com `SEBLOB` e transporte no WSDL. |

`RecordKey` não é tratado automaticamente como OID. O Local Agent confirma por SELECT parametrizado a correspondência com `DYNITSMGRIDREGISTR.OID` e a FK do chamado correto. Se a instalação devolver outra chave, o posicionamento permanece confirmado e o upload aguarda um mecanismo de resolução comprovado. A grid não é recriada.

A leitura da nova grid e suas marcas `BNCREATED/BNUPDATED` só entram no adapter após `anexos.armazenamentoValidado: true` para a empresa/fonte. O sincronizador existente importa posicionamentos, deduplica anexos pelo OID do blob e recompõe mensagens importadas. Turno de IA ocupado deixa a sincronização pendente.

## Configuração necessária

Copiar [retorno-softexpert.config.example.json](retorno-softexpert.config.example.json) para arquivo privado no servidor e definir `SVC_SOFTEXPERT_RETORNO_CONFIG` com seu caminho absoluto. O exemplo contém valores nulos e flags falsas; não é configuração de produção.

1. Informar empresa/fonte, origem HTTPS e evidência do contrato; confirmar prefixo da chave e codificação.
2. Preencher IDs lógicos de entidade, relacionamento e campos. Cada alias em `campos` informa `id`, `tipo`, `obrigatorio`, `calculado`, `maxLength` e, para seleções, `opcoes` com `valor`/`rotulo`. Os limites do aplicativo também se aplicam.
3. Cadastrar `automaticos` somente quando comprovados: `numero_chamado`, `oid_chamado`, `analista_softexpert`, `data_iso`, `instante_unix` ou `valor_fixo`. Datas da tentativa são estáveis em retomadas; confirmar formato, fuso e regras antes de configurar.
4. Validar autoria real e permissões. Em `autoria.analistas`, mapear o ID SoftExpert do analista para `apiKeyEnv` e `userId`. A chave fica exclusivamente na variável de ambiente do backend. Grid/comentário usam a identidade da credencial; campo com nome do analista não muda auditoria nativa. Conta de integração exige aceitação explícita dessa autoria.
5. Anexos exigem `habilitado`, `contratoValidado`, `armazenamentoValidado`, transporte `cid_multipart` ou `base64_inline` e os três IDs. Sem isso, arquivos não são enviados.
6. Histórico começa `desabilitado`. Outros modos exigem evidência e `equivalenciaValidada`. Ativar envio apenas com contrato resolvido e autorização específica para homologação real.

O navegador envia valores e arquivos; não define endpoint, chave, IDs lógicos ou modo de histórico. GET de preparação divulga regras de UI sem credenciais ou IDs internos da integração.

## Auditoria, retomada e reconciliação

As migrações **45 e 46 do SQLite próprio do IA Service** mantêm tentativas, hashes de conteúdo/arquivos, contrato, estados, eventos e prova de OTP. Não alteram tabelas do SoftExpert. Memo e binários não são persistidos na auditoria.

- Mesma chave com conteúdo diferente é rejeitada. O contrato não pode mudar durante a retomada.
- Cada chamada é marcada `enviando` antes do SOAP. Sucesso confirmado não se repete; falha explícita pode ser retomada com a mesma chave e conteúdo.
- Timeout, resposta inválida ou upload sem identificador confirmado produzem `indeterminado`. Não há repetição automática. Nova chave não contorna tentativa pendente do mesmo analista/chamado.
- Falha de anexo/comentário não apaga o sucesso da grid. A UI mostra estados separados, consulta a tentativa e só oferece retomada segura.
- Falha de sincronização preserva sucesso da API e sinaliza `pendente`. Usar o refresh existente; não criar outro retorno.
- Travamento do processo pode deixar lock persistente. Conferir tentativa e registros na origem antes de recuperação administrativa. Não limpar lock/estado nem gerar outra chave para reenviar sem reconciliação. Não existe desbloqueio automático por tempo.

Rotas nos namespaces `/api/ia-service` e `/api/ia-service-externo`: GET/POST `/radar/chamados/:chamadoId/retorno`; GET de consulta com `/:tentativaId` ou `/por-chave/:chave`. POST multipart usa `dados` JSON (`confirmado`, `idempotencyKey`, `campos`) e `arquivos`. A resposta separa posicionamento, arquivos, histórico e sincronização. HTTP 201 confirma etapas configuradas, **não comprova equivalência com histórico manual**.

## Histórico nativo

Parecer e evidências: [historico-workflow-softexpert.md](historico-workflow-softexpert.md). A documentação local não identifica a tabela física padrão do histórico nem comprova que incluir a grid gere o evento manual.

`desabilitado` não chama comentários. `automatico_validado` não chama comentário e informa `automatico_previsto`: é uma expectativa do contrato homologado, não uma leitura do histórico após cada envio. `comentario_validado` permite `newComment` isolado, com visibilidade e envio automático explicitamente configurados após comprovação funcional. Timeout não recria a grid nem repete o comentário cegamente.

## Homologação controlada — ainda não executada

Obter autorização específica, ambiente de homologação, credenciais restritas, metadados do editor de formulário e WSDL da versão instalada. Não iniciar a aplicação contra banco real para testar migrações: o bootstrap as aplica.

1. Preparar dois chamados equivalentes; registrar atividade, estado, usuário, horário e histórico anteriores.
2. Cenário A: analista faz posicionamento manual, sem arquivo e com arquivo. Guardar evidência da grid, autoria, anexos e histórico.
3. Cenário B: habilitar contrato aprovado e confirmar envio pelo IA Service. Comparar Memo, campos obrigatórios, listas, horas, automáticos, autoria e visibilidade. Confirmar atividade e estado inalterados.
4. Conferir chave, OID e FK do posicionamento; vínculo, nome e conteúdo dos arquivos; ausência de duplicação após refresh.
5. Verificar histórico com comentário desabilitado. Se automático, documentar antes de selecionar `automatico_validado`. Caso contrário, autorizar teste específico de `newComment`; selecionar `comentario_validado` somente se atender ao requisito sem duplicidade. Se não atender, manter desabilitado e identificar mecanismo oficial com SoftExpert/administrador do processo.
6. Validar isolamento entre empresas/analistas e novo login OTP. Exercitar falhas/timeouts em mocks, sem provocar resultados incertos em produção.
7. Registrar comparação A/B e aceite ou divergências. Concluir equivalência e autoria antes da liberação operacional.

## Arquivos e validação local

Caminhos relativos a `apps/IA Service/`:

- Executor/contrato: `backend/services/retorno-softexpert-{service,config,executor,source}.js`, `softexpert-soap-client.js`.
- Rotas/auditoria: `backend/routes/retorno-softexpert-routes.js`, registros em `routes/index.js` e `externo-routes.js`, `backend/repositories/retorno-softexpert-repository.js`, migrações 45/46.
- Login: `backend/services/login-externo-service.js`, `sessao-externa-middleware.js`, `backend/routes/login-externo-routes.js`, `frontend/entrar.html` e login J2A.
- Interface: `frontend/j2a/assets/retorno-softexpert.{js,css}`, `radar.js`, `frontend/j2a/index.html`, `frontend/radar.html`.
- Sincronização: `backend/services/import/softexpert-sqlserver-adapter.js`, `situacao-snapshot-service.js`. Reutilizados Local Agent, importação histórica, serviço de anexos, reconstrução do Radar e validação de arquivos.
- Testes: `tests/retorno-softexpert{,-executor,-source,-ui}.test.js`, `tests/login-externo-telefone.test.js`. Dependência direta `saxes` declarada no `package.json`/lock da raiz.

Testes usam SQLite em memória, SOAP simulado, servidor e navegador locais, sem credenciais reais. Cobrem idempotência, concorrência, autorização, upload parcial/incerto, histórico configurável e ambos os chats em desktop/mobile. Comandos, resultados e logs finais acompanham a entrega.

Resultado final local: **36 testes próprios aprovados** (30 backend/origem e 6 interface), incluindo multipart/CID, timeout de anexo, ausência de RecordID e revogação entre chamadas. Comandos a partir da raiz:

```powershell
node --test 'apps/IA Service/tests/retorno-softexpert.test.js' 'apps/IA Service/tests/retorno-softexpert-executor.test.js' 'apps/IA Service/tests/retorno-softexpert-source.test.js'
node --test 'apps/IA Service/tests/retorno-softexpert-ui.test.js'
```

Logs aprovados: `tmp/retorno-backend-final.log` (30/30), `tmp/retorno-ui-final.log` (6/6). O log anterior `retorno-integracao-test.log` registra a falha mobile corrigida e não representa o resultado final.

Regressões aprovadas, executadas com `node 'apps/IA Service/tests/<nome>.test.js'`: `login-externo-telefone`, `anexos-softexpert-sync`, `refresh-situacao-snapshot`, `fase3-rotas-http`, `fase3-seguranca-pre-publicacao`. Logs: `tmp/retorno-login-test.log` e `tmp/retorno-regressao-<nome>.log`. Sintaxe de 17 JS e 6 scripts inline, JSON de exemplo, `npm ls saxes --depth=0` e `git diff --check` aprovados. Nenhuma aplicação de teste iniciou o servidor principal contra dados reais.

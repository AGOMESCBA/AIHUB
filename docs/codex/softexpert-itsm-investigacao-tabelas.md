# ITSM — metadados e acessos reais

Revisão de 16/10/2026. Complementa a entrega de Retorno: os IDs lógicos foram localizados por SELECT no dicionário e revalidados pelas APIs. Não habilita escrita.

**Atualização posterior:** após autorização, foi concluída a [homologação real de escrita no chamado 036807](softexpert-homologacao-036807.md). As três APIs retornaram SUCCESS/1; houve confirmação de arquivo/vínculo/hash, histórico visível com acentos corretos e atividade inalterada. As pendências de executar esse teste e comprovar armazenamento, registradas abaixo, foram resolvidas para essa amostra. Envio geral continua desabilitado.

## Consumos reais

Configuração reutilizada do IA Recruit: `apps/IA Recruit/data/empresa_1.json`, `se_config`. Chave lida somente em memória. Nenhuma mudança nas configurações do Recruit, nenhuma inicialização da aplicação ou migração nos bancos reais.

| Origem `https://j2a.c3isystems.com.br` | HTTP | Resultado |
|---|---|---|
| GET WSDL Workflow | 200 | 23 operações. |
| GET WSDL Formulário | 200 | 6 operações. |
| `getWorkflow`, chamado 036646 | 200 | SUCCESS/1. |
| `getTableRecord`, `itsm`, `idprocess=036646` | 200 | SUCCESS/1; um registro. |
| `getTableRecord`, `ITSMGRIDREGISTR`, `chamado=036646` | 200 | SUCCESS/1; três registros. |
| `getTableRecord`, `ITSMGRIDANEXOAP`, `data1=2026-09-30` | 200 | SUCCESS/3; zero registros, zero páginas. |

As consultas de 16/10 usam o **cliente SOAP do IA Service**, incluindo validação TLS. A consulta de anexos usa a data indicada; não afirma conter arquivos do chamado. A leitura SQL anterior da tabela inteira encontrou zero registros com arquivo preenchido.

As configurações 1 e 2 do configurador do Recruit têm a mesma credencial e apontam para `j2aconsultoria.softexpert.app`. Esse par origem/credencial retornou 401/403. Não foi presumida a causa. O template de grid do Recruit ainda contém placeholders da entidade e relacionamento da vaga; os IDs ITSM vieram do banco, não desses placeholders.

Evidências sanitizadas: `tmp/softexpert-acessos-reais.json` (duas configurações), `tmp/softexpert-acesso-selecionado-real.json` (revalidação final da funcional). Contrato publicado: `apps/IA Service/tests/fixtures/softexpert-contrato-instalado.json`. Não incluem credenciais ou textos dos atendimentos.

## Identificadores confirmados nas tabelas

SELECTs de 15/10, empresa 1, fonte `SE ITSM`, conexão `softexpert_chamados`, Local Agent com criptografia ativa:

| Uso | ID real | Fonte |
|---|---|---|
| `MainEntityID` | `itsm` | `EMENTITYMODEL.IDNAME`. |
| `ChildRelationshipID` | `relagridregistr` | `EMREFERENCE.IDNAME`, `itsm → ITSMGRIDREGISTR`. |
| Entidade da grid | `ITSMGRIDREGISTR` | `EMENTITYMODEL`; leitura real pela API. |
| Memo | `descricao` | `EMATTRMODEL.IDNAME`; obrigatório no formulário. |
| Entidade de anexos | `ITSMGRIDANEXOAP` | `EMENTITYMODEL`; consulta real pela API. |
| Relacionamento de anexos | `relregistroanex` | `EMREFERENCE`, `ITSMGRIDREGISTR → ITSMGRIDANEXOAP`. |
| Arquivo da grid de anexos | `arquivo1` | `EMATTRMODEL`. |
| Arquivo visível do posicionamento | `arquivo2` | `EMATTRMODEL` e `EFFORMELEMENT`. |

`EMREFERENCECONFIG.NMNAME` confirmou `ABCA7HP6S55J0LV` e `ABCCMV6IBMOTU70`, cruzando relacionamentos lógicos e FKs físicas.

Inventário completo: [softexpert-itsm-metadados-confirmados.json](softexpert-itsm-metadados-confirmados.json): **3 entidades, 2 relacionamentos e 42 atributos**, com OIDs, tipos e propriedades de formulário; sem credenciais e com envio desabilitado. Evidências com SELECT/resultados: arquivos `tmp/softexpert-meta-{entidades-itsm,relacionamentos-itsm,atributos-itsm,cardinalidades,elementos-grid,formularios-itsm,regras-grid,acoes-grid}.json`.

## Regras que precisam ser preservadas

`ITSMGRIDREGISTRO` tem regras `0 - Carregar` e `Salvar/Finalizar`; foram localizadas 129 ações e funções para processo, data, hora, atividade, matrícula e usuário. Leitura dessas definições não comprova sua execução pela API de incluir registro.

`descricao`, `aguardanretorno` e `tipoposicioname` são obrigatórios no formulário. Os dois últimos são atributos texto desabilitados na definição do elemento, preenchidos por contexto de atividade. Constantes como `RETORNO - ATENDENTE` e `RETORNO - CLIENTE` não foram escolhidas globalmente sem validar o contexto.

`horaini`, `horafim`, `horaint` são varchar; `horatotalnum` é numeric. `resultado` tem rótulo **Resultado(Hora total)** e está desabilitado no formulário. Não presumir resultado narrativo livre. O inventário genérico da interface não substitui o mapeamento real.

A grid `relregistroanex` está **oculta**; o arquivo visível usa `arquivo2` do posicionamento. Como a grid de anexos não possui amostra com arquivo preenchido, a estrutura está comprovada, mas seu armazenamento real e o JOIN candidato ao SEBLOB ainda não. `armazenamentoValidado` não foi ativado.

## Histórico identificado no banco

| Finalidade | Campo/relação |
|---|---|
| Tabela/PK | `WFHISTORY.IDOBJECT`, comprovada no INFORMATION_SCHEMA. |
| Instância interna | `WFHISTORY.IDPROCESS = WFPROCESS.IDOBJECT`, JOIN confirmado. |
| Número visível do chamado | `WFPROCESS.IDPROCESS`. |
| Atividade | `IDSTRUCT`. |
| Usuário | `CDUSER`, `NMUSER`; também há variantes com sufixo 2 e `CDEXTERNALUSER`. |
| Texto/tipo | `DSCOMMENT` (text), `FGTYPE`. |
| Data/hora | `DTHISTORY`, `TMHISTORY`, `DHHISTORY`. |
| Visibilidade | `FGPRIVATE`. |

O chamado 036646 contém eventos com texto, inclusive `FGTYPE=11` (valor observado, sem significado oficial atribuído por suposição). A comparação dos três Memos com os comentários do mesmo chamado não encontrou igualdade, mesmo normalizando HTML/espaços. Não comprova nem descarta equivalência por transformação ou outro evento.

O requisito informado é **duas chamadas com o mesmo texto**: grid em `descricao` e operação oficial do histórico, candidata `newComment.Text`. O executor existente usa o mesmo `DESCRICAO` nas duas operações quando explicitamente habilitadas. Nunca escreve em WFHISTORY diretamente. Autoria, equivalência funcional e eventual evento automático dependem da homologação de escrita autorizada.

## Correções desta revisão

Impacto no cliente SOAP, script de diagnóstico e testes; sem mudança em persistência, UI, configuração do Recruit ou ativação de envio:

- Emitidos elementos obrigatórios do WSDL: `ActivityID` em `newComment`; `UserID`, `TableFieldList`, `RelationshipList` em `newTableRecord`, inclusive vazios quando cabíveis.
- `fieldFileData.FileContent` é **xsd:base64Binary**: o WSDL instalado comprova o tipo base64. Upload real ainda não foi executado.
- `SUCCESS/3` aceito somente para `getTableRecord` sem registros. Escrita continua exigindo confirmação SUCCESS/1.
- Confiança TLS combina autoridades padrão e do sistema, mantendo certificado/hostname verificados. Não foi copiado `rejectUnauthorized:false` do motor genérico do Recruit.
- XML deve conter uma única operação correspondente à declarada. O caminho de consulta rejeita escrita e movimentação.
- Relatórios contêm status, contagens e contratos técnicos; não persistem respostas com Memo, arquivos ou credenciais.

## Reproduzir e homologar

```powershell
node 'apps/IA Service/scripts/testar-softexpert-leitura.cjs' --empresa=1 --workflow=036646
node 'apps/IA Service/scripts/testar-softexpert-leitura.cjs' --empresa=1 --workflow=036646 --config=se_config
```

O primeiro verifica todas as configurações distintas e retorna exit 0 se ao menos uma permitir todos os acessos de leitura. Falhas da alternativa ficam explícitas; não significa todas aprovadas. O segundo consulta apenas a conexão funcional. Só executam GET de WSDL e POST `getWorkflow`/`getTableRecord`.

Validação local: **37 testes de backend/contrato/origem e 6 de UI aprovados**, além das regressões de login, anexos, snapshot, rotas e segurança. Logs `tmp/softexpert-revisao-testes.log`, `tmp/softexpert-revisao-ui.log` e `tmp/softexpert-revisao-<nome>.log`.

`newChildEntityRecord`, `newTableRecord` e `newComment` tiveram seus contratos e serialização conferidos; **não foram invocados no servidor real**. WSDL e consultas não demonstram permissão de escrita. Não foi encontrada instância aberta do modelo ITSM 1759 com `FGINSTANCETEST=1`. Para concluir, falta autorização específica e indicação de chamado que possa receber um posicionamento, comentário e pequeno anexo de teste, sem movimentar atividade.

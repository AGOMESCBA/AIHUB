# Regra atual: origem IA SERVICE e um anexo no posicionamento

Atualização solicitada em 16/10/2026. Esta regra substitui a solicitação anterior de múltiplos anexos. O teste anterior com dois arquivos continua documentado como evidência histórica e não foi apagado ou alterado no SoftExpert.

## Origem do registro

O dicionário confirmou `ITSMGRIDREGISTR.texto4`, atributo textual OID `8a80938c8f521749018f59abe89734f9`. O executor inclui automaticamente `texto4=IA SERVICE` em novas inclusões do formulário `itsm`, relacionamento `relagridregistr`.

O valor é definido no servidor, prevalece sobre valores fixos divergentes do contrato e não é um campo de entrada editável pelo navegador. Retomar anexos ou histórico não reescreve o posicionamento já confirmado. A marca indica origem; não substitui o analista responsável nem altera a autoria nativa da credencial.

## Arquivo único

Metadados confirmados por SELECT: atributo lógico `ITSMGRIDREGISTR.arquivo2`, tipo arquivo (8), OID `8a80938c857149380185740c2887187e`; coluna física `DYNITSMGRIDREGISTR.OIDARQUIVO2`. O seletor da UI deixou de aceitar múltiplos arquivos; selecionar outro arquivo substitui a seleção anterior. Cancelar o seletor preserva a seleção. Servidor e parser multipart também limitam o envio a um arquivo, mantendo as verificações existentes de tipo, conteúdo e tamanho.

O novo fluxo é:

1. `newChildEntityRecord` inclui o posicionamento com `texto4=IA SERVICE`.
2. O Local Agent confirma por SELECT o OID retornado e seu vínculo com o chamado.
3. `editChildEntityRecord` anexa o arquivo ao mesmo posicionamento, com `ChildRecordOID` confirmado e `EntityAttributeFileList/EntityAttributeFile`, `EntityAttributeID=arquivo2`, `FileName` e `FileContent` em base64 inline.
4. A etapa independente do histórico permanece sujeita à validação de autoria.

O WSDL instalado define `attributeFileData.FileContent` como `xsd:base64Binary`; a edição da grid não exige que a resposta contenha uma nova chave de registro. O executor registra SUCCESS/1 dessa edição como confirmação do anexo no posicionamento já identificado. Falha explícita permite retomar somente o arquivo; resultado indeterminado não é repetido automaticamente.

Não se cria um registro em `DYNITSMGRIDANEXOAP` no novo fluxo. O código legado de upload separado permanece no executor para compatibilidade com tentativas anteriores; o validador de configuração de novos envios habilitados exige o novo destino. A leitura de anexos antigos continua preservada. O adaptador SQL já consultava `SEBLOB.OID = DYNITSMGRIDREGISTR.OIDARQUIVO2`, portanto não foi reconstruído.

Configuração estrutural do novo destino (ainda sem homologação real de escrita):

```json
{
  "anexos": {
    "habilitado": false,
    "destino": "campo_grid",
    "campoArquivoId": "arquivo2",
    "transporte": "base64_inline",
    "contratoValidado": false,
    "armazenamentoValidado": false
  }
}
```

As flags não devem ser ativadas apenas para contornar o bloqueio: falta conferir upload real e leitura posterior do arquivo nesse novo destino quando forem resolvidas as pendências abaixo.

## Pendências preservadas

O usuário confirmou que existe apenas a credencial de integração atualmente utilizada e, posteriormente, autorizou manter SE CONFIG na autoria nativa, desde que o texto do histórico comece com o ID e o nome do consultor, seguidos de IA Service. O código passou a montar `124 - Edson Assis - IA Service`, uma linha em branco e a descrição original. ID e nome vêm do responsável confirmado na origem; na retomada do histórico a identidade é novamente conferida e divergência de código impede o envio. A marca não é repetida na retomada. O bloqueio específico de conta de integração no histórico foi retirado conforme essa autorização; continuam exigidos contrato, autoria, escopo, credenciais e permissões validados. Não se solicita nem se presume a existência de outro token. As mudanças de código ainda não foram publicadas e comentários anteriores não foram reescritos.

`OIDREVISIONFORM=8a80938c83894b86018389e31c6f0130` continua sendo o valor correto da revisão ativa. A tentativa oficial de preenchimento do campo interno retornou FAILURE/-41. Não ficou comprovado que sua ausência preserve a integridade funcional do formulário; o ponto continua pendente de mecanismo oficial ou confirmação documentada do fornecedor. A investigação das alternativas está em [softexpert-oidrevisionform-investigacao.md](softexpert-oidrevisionform-investigacao.md).

## Validação

62 testes aprovados, zero falhas, em `tmp/softexpert-anexo-unico-testes.log`: origem fixa, anexo no posicionamento correto, sucesso da edição sem nova chave, retomada sem duplicar a grid, rejeição de múltiplos arquivos, validação de autoria, horas, contrato SOAP e interface desktop/mobile. Sem teste real de escrita do novo destino e sem publicação nesta etapa.

Após a autorização para conta de integração e o prefixo do consultor, 43 testes pertinentes passaram em `tmp/softexpert-historico-identificado-testes.log`, incluindo a identificação confirmada na origem, o escape XML, a retomada sem repetir prefixo e a manutenção da descrição da grid.

Referências: `.claude/skills/softexpert-wf-ws/references/editChildEntityRecord.md`, `.claude/skills/softexpert-wf-ws/references/newChildEntityRecord.md`, `tmp/softexpert-legado-wf_ws.php.wsdl` (tipos `attributeFileData`, `editChildEntityRecordRequestType` e `editChildEntityRecordResponseType`), `tmp/softexpert-meta-anexo-unico-atributos.json`, `tmp/softexpert-meta-anexo-unico-colunas.json`, `docs/codex/softexpert-itsm-metadados-confirmados.json` (atributo texto4).

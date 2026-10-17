# Homologação real — chamado 036807

Realizada em **16/10/2026**, com autorização do usuário para criar um posicionamento, um comentário com o mesmo texto e um pequeno anexo. O usuário informou que acabara de criar o chamado e solicitou sua importação.

## Resultado

**Correção posterior solicitada pelo usuário:** o dono técnico da grid foi corrigido de `se Config/35` para **Edson Assis/124**, via API oficial, no mesmo posicionamento. A auditoria nativa da execução permaneceu com a conta da API. [Evidências e ajuste da integração](softexpert-correcao-responsavel-036807.md). Os valores de autoria do teste inicial abaixo não devem ser interpretados como a atribuição técnica atual.

| Etapa | API oficial | Resultado real |
|---|---|---|
| Posicionamento | `newChildEntityRecord` | HTTP 200, SUCCESS/1; OID `16531126e49345b28e2068dd2cbfeab0`. |
| Arquivo do posicionamento | `newTableRecord` | HTTP 200, SUCCESS/1; registro `c1bc9ee334a547d6a78353cbf57a250e`. |
| Histórico nativo | `newComment` | HTTP 200, SUCCESS/1; histórico `dc11523d4ecb4d9a87182f5e2f54c514`. |

Conexão: `https://j2a.c3isystems.com.br`, configuração `se_config` da empresa 1 do IA Recruit. Credencial usada somente em memória, sem publicação ou cópia para configuração global de envio.

Marcador do texto: `IAHUB036807-ef269359`. O mesmo texto com acentos foi enviado a `descricao` e `newComment.Text`. Arquivo TXT de **170 bytes**, contendo o texto de teste. Comentário explicitamente **privado** (`Private=1`), associado à atividade `ATV-02`.

## Verificações na origem

- Um único posicionamento, vinculado a `DYNITSM.OID=7ba5253782a2240c8ec574b29c5201c5` e `CHAMADO=036807`; Memo lido igual ao enviado.
- Um único registro em `DYNITSMGRIDANEXOAP`, FK para o posicionamento correto. Vínculo `OIDARQUIVO1 → SEBLOB.OID` comprovado por leitura; nome, conteúdo e SHA-256 conferidos contra o arquivo enviado.
- Um único comentário correspondente em `WFHISTORY`, `FGTYPE=11`, `IDPROCESS=43058`, `IDSTRUCT=43058w2` e `FGPRIVATE=1`.
- `CDUSERANA=35` na grid e `CDUSER=35` no histórico: autoria da credencial utilizada, confirmada previamente em ADUSER. Não houve simulação de outro analista.
- A leitura após a inclusão da grid não encontrou uma cópia do Memo no histórico. O comentário correspondente apareceu com a chamada adicional `newComment`.
- Processo e atividades permaneceram iguais entre os snapshots anteriores e posteriores. Continuou aberto em **Primeiro Atendimento**. Não foram chamadas operações de execução/finalização de atividade.

Todas as escritas no SoftExpert foram pelas três APIs acima. SQL foi usado exclusivamente para SELECT de conferência. Nenhum registro foi apagado ou repetido para refazer o teste.

## Codificação do histórico

A consulta SQL de `WFHISTORY.DSCOMMENT` retornou os bytes UTF-8 interpretados como Latin-1, aparentando `HomologaÃ§Ã£o`. Ao decodificar esses bytes como UTF-8, o conteúdo coincide integralmente com o texto enviado. O usuário conferiu a tela do SoftExpert e confirmou: **“Esta escrito Homologação.. normal”**.

Portanto, não foi demonstrado defeito visível de acentuação. Não foi alterada a codificação do envio nem reenviado o comentário. A comparação binária/textual direta entre Memo e DSCOMMENT precisa considerar a representação interna do histórico; não aplicar conversão indiscriminada a outros campos.

## Importação no IA Service

Foi reutilizado `historical-import-service.atualizarChamadosPorIds`, restrito ao número 036807, antes e depois do teste. Chamado local: `48bc84c0-1a2a-4610-9596-d2cfb9949988`. Atendimento: `48d3ee58-4101-44f6-965e-db38ff3cc561`.

- Primeira importação: chamado novo, sem posicionamentos.
- Segunda importação: um posicionamento importado, sem erros.
- Sincronizador de anexos existente: primeira execução importou um arquivo; a segunda importou zero. Quantidade local final: um anexo.
- Reconstrução do histórico do chat pelo serviço existente: duas mensagens importadas (abertura e posicionamento), sem criar outra mensagem para o comentário nativo.
- Versão do banco local permaneceu **44** antes/depois. Não foi executado o bootstrap nem aplicada migração pendente.

A leitura da nova grid foi habilitada **somente no processo da importação de teste**, após confirmar arquivo/vínculo/hash. Não foi alterada variável global, configuração de produção ou habilitação de envio.

## Evidências e limites

- `tmp/softexpert-homologacao-036807.json`: estados de envio persistidos antes de cada chamada, respostas, OIDs e verificações finais; `concluido=true`.
- `tmp/softexpert-homologacao-036807.log`: respostas das três chamadas. O log inicial termina com verificação textual falsa por causa da codificação; a reconciliação e a confirmação visual estão no JSON final, sem repetir gravações.
- `tmp/softexpert-importacao-036807.json`: resultado da última importação, anexos e reconstrução do chat.
- `docs/codex/softexpert-itsm-metadados-confirmados.json`: metadados atualizados com a evidência de armazenamento e histórico.

Os utilitários em `tmp/` são restritos a este teste. O de escrita recusa execução se já existir o relatório da tentativa; não apagar esse relatório para reenviar. Não substituem as rotas/autorização da aplicação.

**Homologado:** acesso real às três operações com a credencial testada, texto no histórico confirmado visualmente, upload/vínculo/conteúdo, autoria dessa credencial, ausência de duplicação, importação e preservação de atividade.

**Não ativado:** envio geral pela UI do IA Service. O fluxo de produção ainda exige configuração por empresa/fonte/analista e preparação das migrações locais. Este teste não comprova permissões de outras credenciais, todas as classificações/horas ou equivalência de todas as regras do botão manual. Não houve deploy ou ativação automática após o teste.

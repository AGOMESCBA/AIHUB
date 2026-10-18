# IA Service — Detalhes Técnicos e verificação de fontes

Implementação em DEV em 18/10/2026. Escopo: acesso à resposta técnica original e ajustes pequenos no fluxo de arquivos-fonte existente. Sem commit, push, deploy ou escrita no SoftExpert.

## A. Detalhes Técnicos

O botão **Detalhes Técnicos** foi acrescentado às mensagens dos chats J2A e Radar legado. Usa as classes de botão de Pesquisa de cada chat e a estrutura visual/responsiva do painel lateral existente (`retorno-panel`, cabeçalho, área de rolagem e fechamento). Não há redesenho do chat nem novo endpoint.

Ao clicar, o painel apresenta exclusivamente `mensagem.diagnostico.humanizacao.respostaOriginal`. A mensagem já foi recebida pela rota autenticada de mensagens. A abertura não faz requisição HTTP, consulta de banco, pesquisa, geração, humanização ou avaliação do Quality Gate; tem custo zero de tokens. Não há reconstrução de mensagens antigas.

Condições: papel assistant, identificador da mensagem, humanização `aplicada`, estilo diferente de ORIGINAL, original não vazio e conteúdo final disponível. Uma mensagem marcada para revisão pelo gate não oferece o botão. Fallback, ORIGINAL e ausência do original ficam sem botão redundante. Mensagens históricas com os dados persistidos funcionam da mesma forma.

O componente usa a mensagem selecionada no estado da conversa atual. J2A confere também `atendimentoId` quando informado. O legado associa seu cache à sessão/empresa, chamado e atendimento. Troca de chamado, encerramento de sessão e navegação aplicável fecham/limpam o painel; a troca de empresa externa já recarrega a página. O painel técnico e o de retorno ao SoftExpert não são abertos simultaneamente. Não são alteradas as regras de autorização existentes.

A indicação de aprovação aparece apenas com metadado positivo persistido e identificação confiável de que não se trata de resposta curta. Ela não é inferida apenas do sucesso editorial. Mensagens históricas sem esse metadado e o legado podem ficar sem indicação, preservando o acesso ao texto.

O renderizador local apresenta títulos, ênfase, listas, tabelas, links HTTP/HTTPS e código. Escapa HTML e não cria links para esquemas executáveis. Não modifica o texto persistido; só aplica apresentação. É um subconjunto de Markdown, sem execução de HTML, plugins ou macros. Referências incomuns continuam visíveis como texto.

### Persistência e autorização

Reutilizados `mensagens.id`, `empresa_id`, `atendimento_id`, `conteudo` e `diagnostico_json.humanizacao` com `respostaOriginal`, `respostaHumanizada`, `estilo`, `status` e `aprovacaoTecnica`. Não foram criadas tabelas ou colunas.

As rotas atuais validam a sessão/identidade e usam a empresa autenticada para listar as mensagens do atendimento. O novo botão não recebe um ID para consultar mensagens fora dessa lista. Os testes de integração confirmam rejeição de sessão ausente/inválida, outra empresa e ausência de conteúdo de outra conversa. A autenticação é simulada na fronteira dos testes; a emissão de OTP e a revogação na Platform não foram rehomologadas nesta tarefa.

O Radar existente permite consulta compartilhada de chamados da mesma empresa, inclusive na visão de outros analistas. O botão mantém essa autorização existente; não cria permissão adicional nem transforma os atendimentos em conversas privadas por proprietário.

## B. Análise e correção de arquivos-fonte

O subsistema já existe. O fluxo verificado é:

1. Upload multipart autenticado, campo `arquivo`, para o atendimento da empresa.
2. Extração textual e classificação, com armazenamento dos bytes originais e dos metadados.
3. Referência dos IDs no turno, vinculação ao atendimento/mensagem e seleção de conteúdo para o contexto investigativo.
4. Resposta técnica, Quality Gate e humanização no fluxo já existente.
5. Extração da seção `Fonte corrigido`, validação de conteúdo e criação de outra linha de anexo/arquivo.
6. Associação por `anexoOriginalId` e `mensagemOrigemId`, com download independente da redação e do painel técnico.

Os testes usam fontes e logs artificiais. SQLite, upload, extração, contexto, gate, versionamento e download são exercitados localmente; **a resposta do provider é uma fixture**, não uma demonstração de raciocínio real de IA. Nenhum arquivo recebido foi executado ou compilado. Não se afirma precisão automática para todas as categorias de defeitos.

| Capacidade | Status | Evidência e limite |
|---|---|---|
| Receber fonte anexado | Parcial | Upload HTTP real de PRW, TLPP, TS, PY, SQL, JAVA, CS e TXT. `.js` é proibido pela política atual; MIME e tamanho também podem limitar o recebimento. |
| Ler conteúdo do fonte | Funciona | Conteúdo extraído conferido em uploads; PRW/log presentes juntos no prompt efetivamente montado pelo motor. UTF-8 e latin1 testados. |
| Identificar possíveis erros | Parcial | O motor recebe código e contexto e pode propor correções; os testes fornecem diagnósticos simulados. Não há homologação de um provider real nem compilador/analisador estático para comprovar todos os tipos de erro. |
| Utilizar logs na investigação | Funciona | Fonte PRW e log do mesmo turno aparecem no contexto enviado ao provider simulado. Novo log aceito após a investigação. |
| Gerar fonte corrigido | Funciona | Arquivos físicos PRW e C# produzidos pelo fluxo a partir de respostas simuladas; conteúdo e extensão conferidos. Caso ambíguo/incompleto coberto pela suíte existente. |
| Preservar fonte original | Funciona | Bytes originais, incluindo latin1/CRLF, conferidos em download; versão original intacta após a criação da corrigida. Histórico de múltiplas versões confirmado pela suíte existente. |
| Disponibilizar download | Funciona | HTTP real nos namespaces interno e externo; download autenticado no navegador J2A, sem abrir Detalhes Técnicos. |
| Funcionar com humanização ativa | Funciona | Reescrita simulada aplicada, original persistido e arquivo corrigido baixável com conteúdo íntegro. Código, arquivos e links não são reconstruídos a partir da prosa humanizada. |

### Correções pontuais

- **Download no J2A:** a renderização considerava só `mensagemId`. Agora considera também `mensagemOrigemId`, utilizado pelos arquivos gerados. O download usa os cabeçalhos da sessão já empregados na abertura autenticada de anexos, preserva o nome e mostra o aviso de correção proposta/validação pendente. O Radar legado já tinha cartões de arquivos corrigidos, histórico e download; essa estrutura foi preservada.
- **Código em TXT:** a heurística antiga classificava `function` de JavaScript como ADVPL. Assinaturas de JavaScript e Python agora são verificadas antes do teste genérico de ADVPL. Não foi criada uma allowlist nova de extensões.
- **Fence de código:** o parser da seção `Fonte corrigido` aceitava apenas letras no identificador da linguagem e LF. Agora aceita identificadores como `c#` e CRLF, permitindo a geração do arquivo `.cs` pelo fluxo existente.
- **Preservação editorial:** reconhecimento de nomes de arquivos generalizado para extensões textuais, protegendo também nomes como `calculo.py` e `calculo.ts`. Downloads continuam sendo dados estruturados do anexo, fora do texto reescrito.

### Política de uploads mantida

Em `armazenamento-anexos.js`, `EXTENSOES_PROIBIDAS` inclui `.js` junto com `.exe`, `.bat`, `.cmd`, `.sh`, `.ps1`, `.msi`, `.com`, `.scr`, `.vbs`, `.jar` e `.dll`. Por isso a detecção de JavaScript no extrator não significa que o upload direto de `.js` esteja liberado. Código JavaScript em TXT é aceito e reconhecido; a política continua bloqueando `.js`.

Essa restrição já existia. Não foi removida porque o prompt exige respeitar os controles atuais. Para habilitar upload direto de JavaScript, a menor alteração futura é tratar `.js` como fonte textual, mantendo bloqueio dos demais executáveis, limite de tamanho, validação de conteúdo, download como anexo e ausência de execução. Essa mudança não foi iniciada automaticamente.

Outras linguagens não reconhecidas podem ser recebidas como texto, conforme os controles existentes, e incluídas na análise. A geração automática exige que o anexo seja reconhecido como código; não é correto prometer versionamento universal para toda extensão desconhecida.

## C. Arquivos desta etapa

Criados:

- `apps/IA Service/frontend/j2a/assets/detalhes-tecnicos.js`: elegibilidade, botão, apresentação segura e controle do painel.
- `apps/IA Service/frontend/j2a/assets/detalhes-tecnicos.css`: formatação do conteúdo técnico sobre o painel existente.
- `apps/IA Service/tests/detalhes-tecnicos-ui.test.js`.
- `apps/IA Service/tests/fontes-upload-humanizacao.test.js`.
- Este relatório.

Alterados nesta etapa:

- `frontend/j2a/index.html`, `frontend/j2a/assets/radar.js` e `frontend/radar.html`: carregamento do componente, botão, vínculo ao contexto e download J2A.
- `backend/services/extracao-conteudo.js`: classificação de código em TXT.
- `backend/services/investigacao-service.js`: parser do identificador do bloco corrigido.
- `backend/services/validacao-preservacao-service.js` e `tests/humanizacao-preservacao-editorial.test.js`: preservação de nomes de arquivos com diferentes extensões.

Os caminhos abreviados pertencem a `apps/IA Service/`. Alterações anteriores de humanização e trabalhos paralelos no workspace permanecem separados desta etapa. Não foram modificados Quality Gate, Context Engine, gate de pendência externa, Refresh, Resposta Automática ou seletor de estilo nesta tarefa.

## D. Testes e encerramento

- **Quatro testes de navegador aprovados**: dois chats × desktop/celular; Natural, Direto e Descontraído; ORIGINAL/fallback/sem original sem botão; histórico com original; seleção correta; fechamento; tabela/lista/código; HTML e URLs executáveis não executados; download autenticado J2A; troca de conversa.
- **Quatro testes de integração novos aprovados**: uploads de diferentes linguagens/TXT, rejeição de `.js` preservada, bytes/encoding, fonte+log no contexto, versão corrigida com humanização, APIs de download, histórico persistido, novo anexo e isolamento; adicionalmente, geração C# com fence `c#` e CRLF.
- **39 resultados de regressão aprovados** nas suítes de humanização, UI, preservação, fontes corrigidos e extração/versionamento. Incluem dois arquivos de teste antigos que executam grupos próprios de asserções.
- Depois do ajuste final no parser, os 15 testes de humanização e as duas suítes de fonte/extração foram repetidos: **17 resultados aprovados**, sem contá-los novamente como testes distintos.
- Sintaxe JavaScript e whitespace verificados. Capturas J2A desktop/celular inspecionadas.

Logs: `tmp/detalhes-tecnicos-ui-final.log`, `tmp/fontes-upload-final.log`, `tmp/detalhes-fontes-regressao.log` e `tmp/detalhes-fontes-parser-regressao.log`. As versões finais dos testes usam banco e anexos isolados em diretório temporário. Fixtures de tentativas anteriores foram removidas por seus diretórios específicos. Não houve chamada de provider real nesta etapa.

### Riscos residuais e prontidão

- A interface está pronta para revisão final em DEV. Não há publicação automática.
- O fluxo de arquivos está operacional nos cenários locais testados. A qualidade de uma correção gerada por IA depende das evidências e precisa de validação no ambiente da tecnologia; não existe garantia de compilação ou execução automática.
- O original conserva seus bytes. A versão corrigida existente é gravada em UTF-8; não conserva necessariamente a codificação original. UTF-16 e variantes de Windows-1252 não foram homologadas aqui.
- Arquivos maiores podem sofrer seleção/truncamento de contexto. A proteção existente contra respostas truncadas não é uma prova geral de completude do fonte gerado.
- Havendo vários anexos de código candidatos, o motor existente não escolhe arbitrariamente qual original corrigir. Ele apresenta aviso e não gera a versão automaticamente. Não foi criado um subsistema novo para correções simultâneas.
- O fluxo semântico de correção foi testado com provider simulado; pesquisa externa e documentação oficial não foram acessadas nesta etapa. O código existente prioriza TOTVS/TDN para Protheus, mas não foi feita homologação de pesquisa para cada outra tecnologia.
- O suporte direto a `.js` permanece parcial por decisão da política existente. Sua eventual liberação exige decisão específica; não impede revisar/publicar o botão separadamente.

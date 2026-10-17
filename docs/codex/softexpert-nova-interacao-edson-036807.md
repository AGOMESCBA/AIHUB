# Nova interação e atualização do chat — 036807

Homologação solicitada pelo usuário em 16/10/2026 para verificar se o chat importa a nova interação como Edson Assis, em vez da conta de integração.

- Identificador: `IAHUB036807-EDSON-91e0bd77`.
- Executor real: `retorno-softexpert-executor.js`, com resolução do responsável na origem. Foi usada auditoria SQLite temporária; não houve simulação de login do Edson nem teste do fluxo HTTP de autenticação.
- `newChildEntityRecord`: HTTP 200, SUCCESS/1, OID `030dbc60e56841c298b5bccdc9efe5e8`. Consulta posterior confirmou `CDUSERANA=124`, `ANALISTAJ2A=Edson Assis` e Memo correto.
- `newComment`: HTTP 200, SUCCESS/1. Histórico `f3a15434890546deb11af8bb686d8f85`, mesmo texto, atividade `43058w2`. Auditoria nativa permanece CDUSER 35, correspondente à credencial da API.
- Processo e atividades comparados antes/depois: inalterados. Nenhum novo anexo solicitado ou enviado.
- Importador seletivo existente trouxe um novo posicionamento. Reconstrução do histórico do chat resultou em três mensagens importadas: abertura e dois posicionamentos.
- Na mensagem persistida do novo teste: `origem_autor=Edson Assis`, `papel=user`, uma ocorrência. O renderizador atual em `frontend/j2a/assets/radar.js`, função `messageRole`, exibe essa combinação como `Atendente - Edson Assis`.
- Segunda sincronização: zero inclusões/alterações nos posicionamentos; mensagem continua única e com o mesmo autor. Anexo anterior permanece único.
- Banco real permaneceu na versão 44; não foram aplicadas migrações nele nem ativado envio global.

Limites: foi validada a sincronização executada localmente e a mensagem consumida pelo renderizador. Não foi validada visualmente uma sessão de navegador nem o disparo automático de atualização na instância publicada. O responsável geral do chamado no banco local continua nulo, porque os campos do formulário principal estão nulos; este resultado comprova a autoria da interação, não a alocação geral do chamado na fila de Edson. A resolução segura já existente confirma Edson pela atividade ativa na origem.

Evidências: `tmp/softexpert-nova-interacao-036807.json`, `tmp/softexpert-chat-edson-036807.json`, `tmp/softexpert-importacao-036807-repeticao.log`. As gravações no SoftExpert foram feitas exclusivamente por APIs oficiais; consultas SQL somente de leitura.

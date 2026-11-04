# IA Service — experiência, busca e histórico de logs

Implementação local em 04/11/2026, sem publicação. O usuário autorizou explicitamente o histórico persistente nesta sessão.

## Auditoria final e uso simultâneo

- Regra confirmada pelo usuário: histórico de chamados e avulsos compartilhado com a equipe da mesma empresa, sob as permissões existentes do IA Service. Não foi criada uma regra de propriedade privada por usuário.
- Consultas e atualizações do histórico exigem a empresa validada pela sessão. IDs de arquivos e chamados são conferidos antes da leitura. O log é evidência não confiável e suas instruções não são seguidas.
- Migração 59 registra criador e último editor, com tipo de identidade separado (`usuario_iahub` ou `consultor_externo`); os IDs vêm exclusivamente da autenticação. Registros anteriores ficam com autor desconhecido, sem atribuição inventada.
- Operações limitadas a uma por identidade/empresa, duas por empresa e quatro por processo. Usuários diferentes podem analisar em paralelo; excesso recebe mensagem explícita. A reserva ocorre antes de receber o upload de até 20 MB em memória. Não há fila automática. Os limites são locais ao processo, adequados à execução atual; múltiplas instâncias exigem coordenação compartilhada.
- Atualizações de grupos continuam sendo mescladas em transação SQLite, preservando análises anteriores e o criador original.
- Corrigidas respostas atrasadas ao abrir dois históricos ou ao receber erro de busca/consulta depois de trocar termo ou empresa. Testes de regressão reproduzem essas condições.
- Validação da worktree: 79 testes aprovados de logs, histórico, rotas, navegador, exportação, modelos, streaming, retries, progresso, concorrência de pré-análise e boot/QR do WhatsApp. Os testes adicionais de respostas atrasadas e a verificação de sintaxe são registrados na auditoria de empacotamento.

## Experiência

- No J2A, o acesso saiu do menu Mais e fica ao lado de Mensagens, com ícone de arquivo e lupa e nome acessível “Análise de Logs”.
- A interface compartilhada com o radar interno foi redesenhada, com seleção de origem, envio por arraste e indicadores claros de arquivo pronto.
- A consulta de anexos distingue carregamento, ausência de chamado, lista vazia, consulta parcial e erro. Possui tempo limite e descarta respostas antigas.
- O splash abre imediatamente e recebe as etapas do backend por NDJSON: preparar arquivo, localizar ocorrências, investigar com IA e organizar diagnóstico. Não simula porcentagens. Clientes anteriores continuam recebendo JSON normal.
- Os botões principal e individuais ficam bloqueados durante a análise. “Continuar navegando” fecha o splash, preserva o processamento e permite reabrir o andamento.
- O diagnóstico privilegia uma explicação breve, causa provável e até três ações. Validação e evidências ficam recolhidas. O prompt orienta concisão, sem transformar shutdown em prova de parada planejada.
- A primeira chamada alterna tipos de ocorrência para evitar analisar só workflows e deixar o encerramento, no final do arquivo, sem representante. A IA recebe também o inventário dos grupos e o contexto para produzir a visão geral.

## Busca

O campo filtra os grupos por mensagem, rotina, evidências e diagnóstico. “Buscar no arquivo completo” percorre o original sem chamar a IA. Busca literal, sem diferenciar caixa ou acentos, com localização e destaque dos termos. Conta todas as linhas encontradas, exibindo até 50 trechos; cada linha de contexto possui recorte limitado.

O limite de arquivo continua em 20 MB. Não foi implementada leitura por fluxo para arquivos maiores.

## Histórico e tamanho

A migração **58** cria `analises_logs` no banco próprio do IA Service. Guarda apenas nome, hash SHA-256, origem, identificação do chamado, datas, contagens e **relatório comprimido com gzip**. Não guarda o arquivo original nem seu conteúdo integral. A listagem mostra as últimas 50 análises da empresa; o chamado atual recupera a mais recente, quando disponível.

O usuário reabre o relatório sem chamar a IA. Uma análise individual acrescenta seu diagnóstico ao mesmo histórico, preservando os anteriores em transação. Empresa, origem e hash são conferidos para impedir mistura de arquivos. Uma nova análise completa gera uma nova entrada.

Para buscar no original de um avulso reaberto ou analisar outros grupos, o usuário precisa selecionar novamente o mesmo arquivo. O hash é validado antes do processamento. No chamado, usa-se o anexo da origem, sujeito à disponibilidade e aos controles já existentes. A política de limpeza dos originais do SoftExpert não foi alterada.

Falha de gravação não descarta o resultado: a tela avisa e oferece o download. A migração foi exercitada somente em bancos temporários; será aplicada pelo inicializador normal ao reiniciar o serviço. Não foram migrados ou modificados bancos reais durante os testes.

## Validação

- Regressão completa: 33 testes aprovados. Acrescentado depois um teste de inicialização e reabertura com todas as migrações: **34 casos distintos validados**.
- As últimas mudanças de origem/hash foram verificadas novamente em 16 testes de histórico, rotas e navegador, todos aprovados.
- O teste de navegador cobre J2A e radar anterior, telas de 320/390 pixels, temas claro/escuro, splash, cliques repetidos, consulta vazia/falha/pendente, busca com destaque, download e recuperação após recarregar.
- O teste de persistência usa banco temporário e verifica compressão, reabertura da conexão, isolamento entre empresas, associação ao chamado e preservação dos diagnósticos.
- Nova chamada real à OpenAI/GPT-4o, com o log e destino já autorizados: oito grupos analisados, abrangendo workflows, mensagens do servidor e encerramento. Explicações observadas com 7 a 11 palavras. A causa do encerramento permaneceu a confirmar.
- Para o arquivo real de **5.580.089 bytes**, o relatório medido possui **94.017 bytes de JSON** e **10.303 bytes comprimidos**, sem incluir o overhead de metadados e páginas do SQLite. É uma medição desse caso, não uma promessa de tamanho para todos os relatórios.

Evidências em `tmp/`: `analise-logs-historico-validacao.txt`, `analise-logs-migracao-final.txt`, `analise-logs-historico-origem-final.txt`, `analise-logs-ia-objetiva-final.txt`, `log-real-objetivo.json` e capturas `analise-logs-novo-*.png`.

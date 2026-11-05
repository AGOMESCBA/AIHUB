# IA Service — experiência, busca e histórico de logs

Implementação local em 04/11/2026, sem publicação. O usuário autorizou explicitamente o histórico persistente nesta sessão.

## Revisão de espaço e descoberta das soluções

O quadro “Comece pelo arquivo” usa a seta nativa à esquerda, seguindo o padrão dos demais blocos, sem botão “Expandir/Recolher”. Começa aberto na entrada e é recolhido automaticamente ao abrir uma análise do histórico. Pode ser expandido novamente pelo cabeçalho para selecionar o original ou iniciar outra análise.

Simplificação final solicitada: remover também o quadro “Diagnóstico e possíveis soluções” e o atalho “Ver possíveis soluções”. Os diagnósticos e as soluções permanecem nos cartões dos respectivos erros, com recolhimento e filtro de analisados. Os avisos de falha continuam no status da análise e no cartão de acompanhamento.

Decisão posterior do usuário: remover o “Plano de investigação” da tela e do relatório exportado. Os cartões de cada erro continuam exibindo explicação, causa provável, possíveis soluções e validação. Dados de visão geral já armazenados no histórico não são apagados nem exigem migração, mas deixam de ser apresentados.

Simplificação adicional solicitada: retirar da tela e do relatório exportado “Cobertura e limites desta análise” e “Eventos de contexto do arquivo”. O contexto continua disponível para o diagnóstico e os alertas de falha da IA continuam explícitos na tela. O relatório preserva identificação, contagens, diagnósticos, soluções, validação e evidências por erro; nenhuma alteração de banco é necessária.

Filtro e acúmulo de diagnósticos: “Somente analisados pela IA” combina com a busca por palavra e mostra quantos erros estão visíveis e quantos já têm diagnóstico. O filtro permanece durante análises individuais, mas é limpo ao abrir um relatório diferente. A reanálise completa da mesma fonte mantém o vínculo do histórico e complementa os diagnósticos existentes, preservando também os grupos fora da seleção inicial da IA. Trocar o arquivo cria outra análise; origem e hash continuam conferidos no servidor. Falha temporária de gravação mantém o ID anterior para a próxima tentativa, sem ocultar o aviso de resultado não salvo. O atalho de soluções respeita os filtros atuais. Testes reproduzem 30 grupos com quatro diagnósticos (primeiro, último e dois intermediários), busca combinada, reanálise do arquivo, troca de arquivo e reabertura do banco sem perder os quatro resultados.

Organização final dos blocos: seleção do arquivo, plano de investigação e informações de cada diagnóstico abertos por padrão, com opção de recolher. Resumo do arquivo (metadados, indicadores e famílias) começa recolhido; a identificação do arquivo permanece no título. Validação, evidências, cobertura e contexto continuam recolhidos. O atalho de soluções reabre o diagnóstico fechado. Validado em seis testes de interface/concorrência, incluindo navegador desktop e celular, em `tmp/analise-logs-organizacao-colapsar-validacao.txt`.

- Entrada compacta: cabeçalho menor, origens agrupadas à esquerda e “Analisar log” separado à direita na mesma linha em desktop. O envio de arquivo usa o formato horizontal desde o início, sem depender de resultado aberto ou de alternância do histórico. Em celular, os controles se reorganizam para caber na tela.
- Atalho passa a “Analise de Error.log”, conforme solicitado, antes de Mensagens.
- “Possíveis soluções” passa a ser o título explícito das ações de cada diagnóstico. Um resumo acima dos erros informa quantos grupos têm diagnóstico e oferece acesso direto às soluções, sem duplicar seu conteúdo no histórico.
- Quando não há diagnóstico válido, a interface informa que as soluções ainda não foram geradas. Erros da IA recebem classificação segura (configuração, cota, contexto, tempo, autenticação, resposta incompleta/inválida ou falha genérica), sem devolver a mensagem bruta do provedor. O log operacional registra apenas empresa e código da falha. Não foi realizada nova chamada real à IA nem confirmada a causa específica do aviso observado em produção.
- Resposta com zero diagnósticos válidos é identificada como indisponível, preservando as evidências. Reabrir avulso sem original recalcula o estado do botão, evitando indicação incorreta de arquivo pronto.
- Validação: 43 testes aprovados de varredura, IA simulada, histórico, rotas, isolamento, concorrência e navegador. A regressão visual verifica alinhamento das ações, acesso às soluções, falha de IA explícita e estabilidade do envio ao abrir/fechar histórico. Evidências em `tmp/analise-logs-compacta-solucoes-validacao.txt` e capturas `analise-logs-novo-*.png`.

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
- A análise abre um cartão global compacto e recolhível, fora da aba de logs. Recebe as etapas reais por NDJSON: preparar arquivo, localizar ocorrências, investigar com IA e organizar diagnóstico. “Ver etapas” expande os detalhes sem janela modal nem bloqueio do chat. Não simula porcentagens. Clientes anteriores continuam recebendo JSON normal.
- Os botões principal e individuais ficam bloqueados durante a análise. Trocar de chamado na mesma empresa preserva a requisição; a conclusão avisa sem trocar a tela, rolar a página ou tirar o foco da mensagem. “Ver resultado” abre o relatório com sua origem, mesmo depois de atender outro chamado. Trocar de empresa ou sair da sessão limpa o acompanhamento e invalida respostas antigas.
- A tela inicial da própria Análise de Logs recebeu cabeçalho em cartão, indicadores do conteúdo e orientação visual consistente com o painel de etapas; a tela de login permanece fora do escopo esclarecido pelo usuário.
- O diagnóstico privilegia uma explicação breve, causa provável e até três ações. Validação e evidências ficam recolhidas. O prompt orienta concisão, sem transformar shutdown em prova de parada planejada.
- A primeira chamada alterna tipos de ocorrência para evitar analisar só workflows e deixar o encerramento, no final do arquivo, sem representante. A IA recebe também o inventário dos grupos e o contexto para produzir a visão geral.

## Busca

O campo filtra os grupos por mensagem, rotina, evidências e diagnóstico. “Buscar no arquivo completo” percorre o original sem chamar a IA. Busca literal, sem diferenciar caixa ou acentos, com localização e destaque dos termos. Conta todas as linhas encontradas, exibindo até 50 trechos; cada linha de contexto possui recorte limitado.

O limite de arquivo continua em 20 MB. Não foi implementada leitura por fluxo para arquivos maiores.

## Histórico e tamanho

A migração **58** cria `analises_logs` no banco próprio do IA Service. Guarda apenas nome, hash SHA-256, origem, identificação do chamado, datas, contagens e **relatório comprimido com gzip**. Não guarda o arquivo original nem seu conteúdo integral. A listagem mostra as últimas 50 análises da empresa; o chamado atual recupera a mais recente, quando disponível.

O usuário reabre o relatório sem chamar a IA. Uma análise individual acrescenta seu diagnóstico ao mesmo histórico, preservando os anteriores em transação. Empresa, origem e hash são conferidos para impedir mistura de arquivos. Uma nova análise completa gera uma nova entrada.

O histórico permite marcar uma ou várias análises, selecionar todas as **exibidas** (até 50) e excluir as selecionadas. Uma confirmação informa que a exclusão é definitiva e vale para toda a equipe da empresa. `DELETE /radar/logs/historico` recebe IDs explícitos, com limite de 50; valida toda a seleção na empresa autenticada e exclui em transação. Uma seleção com ID ausente ou de outra empresa falha sem apagar parcialmente. Os anexos e arquivos originais são preservados. Atualização em andamento não recria um histórico já excluído. O espaço liberado fica disponível para reutilização pelo SQLite; não é executado `VACUUM` no banco em uso.

O relatório concluído pode ser reaberto após novo login, sem IA. O cartão acompanha a requisição somente enquanto a página/sessão continua aberta; retomada de processamento após recarregar, sair do sistema ou reiniciar o servidor ainda não é um mecanismo de jobs persistentes.

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

Validação das melhorias de acompanhamento e exclusão: 42 testes de serviço, rotas, histórico, concorrência e navegador. Inclui desktop e 320/390 px, uso do campo de mensagem durante a análise, detalhes sem modal, conclusão sem perder foco, origem correta após trocar de chamado, seleção e cancelamento/confirmação de exclusão, exclusão atômica entre empresas e proteção contra recriação por atualização tardia. Evidências: `tmp/logs-melhorias-validacao-final.txt` e `tmp/analise-logs-monitor-*.png`.

## Exportação objetiva em PDF

O botão **Baixar PDF** exporta somente os erros exibidos e suas possíveis soluções, preservando a numeração original dos grupos. A busca por palavra e o filtro **Somente analisados pela IA** também se aplicam ao download. Sem erros correspondentes, o download fica desabilitado. Grupos sem diagnóstico recebem uma indicação explícita de que ainda não há soluções geradas pela IA.

O documento A4 usa identificação do arquivo/chamado, títulos de erros, ações numeradas, margens e paginação. Métricas, famílias de mensagens, plano de investigação, explicação, causa provável, validação, informações faltantes, evidências e contexto técnico não são incluídos no PDF. Esses ajustes de exportação não alteram o diagnóstico existente na tela ou no histórico.

O endpoint autenticado `POST /radar/logs/relatorio.pdf`, nos acessos interno e externo, recebe apenas nome, número do chamado e os grupos selecionados (id, título e soluções). Valida quantidade e tamanho, reaplica o filtro de credenciais e gera o PDF em memória com o PDFKit já instalado. Não consulta anexos, não grava arquivos/banco e não chama IA. A troca de relatório ou empresa impede baixar uma resposta antiga; o botão indica a geração e bloqueia cliques repetidos.

Validação final: 21 testes aprovados de exportação, rotas e navegador. Inclui extração do texto e das coordenadas de documentos de uma e várias páginas, limites de entrada, ocultação de credenciais, autenticação nos dois acessos, download real no navegador, recuperação após falha, bloqueio de download tardio após trocar de empresa e filtros combinados em um relatório de 30 erros. Evidência: `tmp/analise-logs-pdf-final.txt`. Prévia renderizada e conferida em `tmp/analise-log-exemplo.png`; PDF de exemplo em `tmp/analise-log-exemplo.pdf`.

## Resumo com erros, warnings e agrupamento — 05/11/2026

O resumo recolhível passa a mostrar três indicadores: **Erros identificados**, **Warnings identificados** e **Grupos de mensagens semelhantes**. Retirados os cards de grupos avaliados pela IA e linhas percorridas e o desdobramento por famílias. Uma explicação distingue ocorrências de grupos: uma mensagem repetida dez vezes conta como dez erros em um grupo; grupos diferentes não comprovam causas diferentes.

O scanner conta registros com marcadores explícitos `[WARN]`, `[WARNING]` (incluindo espaços), `WARN:` e `WARNING -` no arquivo inteiro, inclusive em contextos e após atingir o limite de grupos. Um registro marcado como warning não vira erro por conter palavras como “erro ao”. A contagem fica em `cobertura.warnings`, preservada pelo mecanismo JSON/gzip existente, sem migração de tabelas. Os grupos e diagnósticos continuam sendo dos erros reconhecidos; esta mudança não cria análise de warnings.

Históricos antigos não contêm o total de warnings: mostram **Não contabilizado** e orientam analisar novamente o original. Não é inferido um zero a partir das evidências limitadas. O PDF permanece restrito aos erros e soluções, sem métricas.

Validação: 21 testes aprovados de scanner e navegador (J2A/radar anterior, desktop e celular), incluindo warnings repetidos, arquivo somente com warnings, avisos no contexto de THREAD ERROR, limites de grupos, indicadores novos e histórico antigo. Evidência: `tmp/analise-logs-resumo-warnings.txt`.

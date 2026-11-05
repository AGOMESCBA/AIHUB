# IA Service — ajustes da auditoria do error.log

Implementação local autorizada em 05/11/2026. Sem publicação em produção, sem migração nova e sem chamada real a provedor de IA nesta etapa.

## Alterações e critérios

- `backend/services/redaction-service.js`: credenciais em JSON, URLs (incluindo usuário/senha e parâmetros codificados) e cabeçalhos; reaplicar a proteção não degrada o texto já mascarado. Segredos de teste são sintéticos.
- `backend/services/analise-log-parser.js` (novo): separa cabeçalhos de registro e mensagem; mantém incidentes por thread quando identificada; distingue novos registros de continuação; extrai função, fonte, linha e encadeamento. O primeiro frame não prova a causa raiz. `U_` é apenas indício de customização, sem classificar automaticamente o restante como padrão TOTVS.
- `backend/services/analise-log-service.js`: versão 2 de interpretação, assinaturas técnicas SHA-256, seleção após contar as assinaturas no arquivo inteiro e enriquecimento apenas dos 100 grupos escolhidos. Fatais, erros técnicos e frequência orientam a seleção; a primeira chamada de IA combina prioridade dos fatais com diversidade de famílias. A varredura da API libera o event loop a cada 2.048 linhas, sem filas ou workers; a função utilitária síncrona continua compatível.
- `backend/services/analise-log-identidade.js` (novo): associação entre grupos por assinatura e versão. O ID posicional sozinho não basta; a compatibilidade legada exige também título, rotina e primeira localização iguais.
- `backend/routes/analise-log-routes.js`: passa o relatório anterior à interpretação somente depois de validar empresa, hash e origem. Preserva streaming, autenticação e limites de concorrência existentes.
- `backend/repositories/analise-log-repository.js`: preserva diagnósticos pela identidade técnica dentro da transação; recusa atualização que perca um diagnóstico anterior ou troque a versão do agrupamento. Aplica mascaramento antes da compressão e ao ler relatórios antigos. Mantém filtros de empresa e regras de exclusão.
- `frontend/j2a/assets/analise-logs.js`: combina diagnósticos pela mesma identidade; exibe cobertura incompleta no status existente e a pilha dentro das evidências recolhíveis. Não altera o layout nem o PDF.

Todos os caminhos acima são relativos a `apps/IA Service/`.

Testes alterados/criados em `apps/IA Service/tests/`: `analise-log.test.js`, `analise-log-parser.test.js` (novo), `analise-log-seguranca.test.js` (novo), `analise-log-historico.test.js`, `analise-log-routes.test.js`, `analise-log-ui.test.js` e `analise-log-filtro-acumulacao-ui.test.js`.

## Compatibilidade antes de mudar os 100 grupos

Históricos sem versão são tratados como versão 1. Ao complementar individualmente um erro antigo, seus grupos, IDs, títulos, quantidades e diagnósticos permanecem congelados; a nova extração enriquece o contexto pela localização original. Se a ocorrência antiga não for reconhecida, a análise individual é recusada em vez de diagnosticar outro evento.

O botão principal **Analisar log**, ao reanalisar um histórico legado, cria um resultado atualizado separado. O anterior permanece disponível. Isso permite aplicar a correção de agrupamento e a seleção dos 100 mais relevantes sem reinterpretar os IDs antigos silenciosamente.

Na versão 2, a seleção preserva grupos já diagnosticados. IDs anteriores são mantidos pela assinatura; posições livres são atribuídas aos outros grupos. O repositório impede substituir o histórico quando algum diagnóstico anterior deixa de ter correspondência segura. Não há conversão em massa dos históricos nem migração destrutiva.

## Evidências, tokens e limites

- Limites mantidos: arquivo de 20 MB, 100 grupos detalhados, 40 localizações por grupo, oito grupos por chamada inicial e saída de até 5.000 tokens.
- Assinaturas consideram mensagem normalizada e encadeamento de função/fonte/linha. Datas, horários e cabeçalhos voláteis não tornam duas repetições grupos diferentes. Números de documentos e parâmetros de negócio não são removidos indiscriminadamente.
- Toda a cadeia reconhecida contribui à assinatura. Até 256 frames são guardados; em cadeias maiores preserva-se também o fim e sinaliza-se o recorte. São mantidos até 256 incidentes ativos intercalados; ao atingir esse limite, o contexto afetado é marcado como limitado. Registros sem identificação suficiente de thread continuam sujeitos a ambiguidade.
- Para a IA: até dez linhas de evidência, quatro de contexto e oito frames selecionados entre início, indícios de customização e fim, por grupo. Mensagem e referência principal têm limites próprios. A geração da visão geral que saiu da interface foi removida do prompt; dados antigos continuam legíveis.
- A quantidade de metadados de inventário varia com o número de assinaturas distintas, dentro do limite de bytes do arquivo. Não se armazena o log original no histórico.

## Validação

- Suíte `analise-log*.test.js`: **72 testes aprovados**, cobrindo scanner, identidade, segurança, rotas, SQLite temporário, PDF e navegador real (J2A/radar anterior, desktop e celular). Regressões incluem incidentes consecutivos/intercalados, pilhas extensas, níveis citados em texto, assinaturas equivalentes/distintas, fatais depois do corte, frequência, legado, acumulação, exclusão, isolamento e liberação do event loop.
- Quatro suítes adicionais dos consumidores do filtro compartilhado: `estabilizacao-casos-reais-2026-10`, `etapa2-1-homologacao`, `etapa2-2-fechamento` e `etapa3a1-homologacao-final`, aprovadas. Bancos usados nesses testes são temporários.
- Arquivo real de 5.580.089 bytes, somente leitura local: preservou 54 ocorrências e 38 grupos; contou 604 warnings. Comparação com o scanner anterior confirmou os 38 IDs/títulos do modo legado. Medição inicial: aproximadamente 73 ms antes e 132 ms depois; valores locais, não promessa de produção.
- Prompt do arquivo real, com cliente simulado: 28.964 caracteres antes e 24.914 depois (aproximadamente -14%), mantendo saída máxima de 5.000 tokens. Caracteres não são uma medição exata de tokens nem de custo.
- Teste sintético com 50 mil mensagens distintas: 1.438.890 bytes, 100 grupos detalhados, cerca de 554 ms e aumento observado de heap de 15 MB na leitura síncrona. Motivou o processamento cooperativo na API; testes verificam execução de outras tarefas antes da conclusão.

Evidências locais não versionadas: `tmp/log-auditoria-final.txt`, `tmp/log-auditoria-redacao-compartilhada-final.txt` e registros por etapa. Não contêm cópia do log real nesta execução.

## Limitações e próximos passos de avaliação

- Os testes de IA usam clientes simulados. Não foi avaliada uma nova resposta real de diagnóstico ou seu custo em provedor.
- O filtro amplia formatos reconhecidos, sem garantir identificar qualquer segredo arbitrário. Leituras de relatórios antigos são protegidas e novas gravações são mascaradas; não houve saneamento retroativo dos blobs existentes ou de backups.
- A versão legada preserva também suas contagens e limites originais. Para aplicar as correções ao arquivo inteiro, usar uma nova análise separada.
- A assinatura é conservadora: diferenças de mensagem ou cadeia podem continuar separando grupos. Testes de carga com múltiplos arquivos adversariais de 20 MB não foram realizados.
- Chat, streaming, acompanhamento, PDF, política de compartilhamento por empresa e exclusão permanecem na arquitetura existente. Publicação depende de avaliação e autorização do usuário.

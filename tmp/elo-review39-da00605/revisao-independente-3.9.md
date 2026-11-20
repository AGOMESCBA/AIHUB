# Revisão independente da etapa 3.9

Commit: da00605. Branch: fase-2-ambiente-local. Data: 13/11/2026.

**Resultado: aprovação técnica no recorte local implementado. Nenhum impedimento de produto encontrado nesta revisão.** O aceite funcional do responsável permanece distinto da conferência técnica. A aprovação não libera produção, dados reais ou os módulos ainda indisponíveis.

## Escopo e evidências

- Conferidos os sete arquivos do commit, a matriz 36.4, limites e critérios de aceite, ferramentas novas e registros locais.
- git diff 5faae5a da00605 -- apps/api/app vazio: backend de execução igual ao da evidência anterior de 202 testes.
- Árvore de trabalho limpa antes da revisão; git diff-tree --check sem apontamentos.
- Conferência independente do banco: 12/12, usando a conexão real da API, mesma conexão física, contextos transacionais e rollback. Evidências: database.log e database.json neste diretório.
- Amostra HTTP independente: 10/10, com contextos reais, corpos válidos, versões atuais e comparação de ausência de alterações no banco. Evidências: http.log e http.json.
- Conferidos os metadados do relatório do navegador entregue: 114/114, sem checks reprovados. Esse roteiro não foi repetido pelo revisor nesta etapa.
- Conferidos o relatório de restauração, a existência do dump e seu tamanho, revisão elo_fase3_0012 e remoção do banco descartável registrada no relatório. O ensaio não foi repetido nesta revisão.

## Amostra HTTP executada

1. Mesma identidade com permissões distintas por órgão.
2. PUT com corpo válido e versão atual de secretaria de B, solicitado no contexto de A, recusado.
3. POST de departamento com todos os campos obrigatórios e referência a secretaria de B: chegou à regra de propriedade, que recusou o vínculo cruzado.
4. Secretaria preservada em nome/versão e nenhum departamento indevido criado.
5. Plataforma sem acesso operacional implícito.
6. Administrador de A sem consulta aos vínculos de B.
7. Revogação de acesso da sessão criada pelo ensaio somente em A.
8. Requisição seguinte em A recusada.
9. Acesso independente da mesma sessão em B preservado.
10. Logout seguido de recusa do token anterior.

As sessões criadas pelo ensaio foram encerradas. Não houve gravação de cadastro autorizado nem alteração de fontes do produto. A tentativa de escrita do verificador de banco ficou em transação desfeita.

## Precisão das evidências

O script smoke_foundation_39 original utiliza corpos incompletos em duas tentativas cruzadas e aceita 422. Isoladamente, essas duas respostas não demonstram que a regra de propriedade foi alcançada. A amostra independente acima repetiu as tentativas com corpos válidos e confirmou a proteção. As evidências anteriores de API também cobrem esses cenários. Trata-se de melhoria recomendada no roteiro de teste, não de falha de produto demonstrada.

A palavra “idêntico” no relatório de restauração significa igualdade das métricas comparadas: revisão, quantidades de tabelas, RLS, políticas, funções e contagens nas tabelas selecionadas. Não houve comparação integral do conteúdo de cada registro ou de todas as definições SQL. Preferir essa descrição precisa no controle em vez de afirmar identidade integral de todo o banco.

Não foram repetidos os 202 testes completos da API, 114 checks de navegador, build ou restauração: código relevante e evidências conferidos; recorte de testes enxuto solicitado pelo responsável.

## Encaminhamento

Registrar a aprovação técnica da 3.9 no recorte local e o aceite funcional correspondente quando fornecido. Próxima entrega recomendada: 4A.1, fornecedores e tipos de fornecedor, antes dos demais cadastros dependentes. P3 já fixa fornecedores compartilhados no órgão por padrão; não reabrir essa decisão como se estivesse pendente. Mapeamento de campos deve ser produzido a partir dos fontes/modelos existentes; classificação e importação de dados reais permanecem na fase própria. P4/D13 são decisões do lote de frotas e motoristas, não bloqueios do primeiro lote de fornecedores.

Nenhum commit, push, implantação ou início da 4A executado nesta revisão.

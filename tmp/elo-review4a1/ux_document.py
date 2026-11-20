from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md')
s=p.read_text(encoding='utf-8')
assert '# 44.' not in s
s=s.replace('Versão 2.38 consolidada','Versão 2.39 consolidada',1)
s=s.replace('o sétimo, 4A.7 — veículos lotados em uma secretaria, foi implementado no ambiente local e está Em revisão (43).','o sétimo, 4A.7 — veículos lotados em uma secretaria, foi implementado no ambiente local e está Em revisão (43), com transferência de lotação implementada posteriormente no complemento local (44.1). O desenvolvimento previsto da 4A está implementado; revisão independente e aceite funcional final permanecem pendentes. A primeira evolução da experiência de uso está em avaliação na prévia 3007 (44.2 a 44.5).',1)
s=s.replace('transferência pendente (43.8).','transferência implementada no complemento local, em revisão (44.1).')
s=s.replace('Transferência de lotação: pendente de regras de procedimento (43.8).','Transferência de lotação: implementada no complemento local, em revisão (44.1).')
s=s.replace('transferência de lotação pendente de regras de procedimento (43.8);','revisão da transferência de lotação implementada no complemento local (44.1);')
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n', '## 24.6 Registro das entregas e mudanças de direção\n\nComplemento local e experiência de uso — versão 2.39: transferência de lotação implementada com testes proporcionais (44.1); interface compartilhada, menu, atalhos, seletor de órgão/secretaria e filtros nas colunas de Veículos melhorados (44.2 a 44.5). Prévia visual própria na porta 3007; 11/11 cenários no navegador e 6/6 testes web críticos. Trabalho local ainda sem commit, sem push e sem produção.\n',1)
s=s.replace('- **Transferência de lotação: mantida bloqueada.**', '- **Registro histórico da entrega original, substituído pelo complemento 44.1: transferência inicialmente mantida bloqueada.**',1)
s=s.replace('A 4A.7 permanece **Em revisão** até a revisão independente. A 4A não está concluída (transferência pendente); 4B não iniciada; sem push nem produção.','Situação atual: a 4A.7 e seu complemento de transferência (44.1) permanecem **Em revisão** até a revisão independente. Desenvolvimento previsto da 4A implementado localmente; encerramento final sujeito à revisão e ao aceite funcional. 4B não iniciada; sem push nem produção.')
s+='''
# 44. Complemento local da 4A e evolução da experiência de uso

## 44.1 Transferência de lotação — implementação e pendências

Implementada após autorização do responsável, na branch fase-2-ambiente-local, sobre 40ccf52. Migração elo_fase4a_0023 sem nova tabela paralela: comando restrito elo_vehicle_transfer, proteção da lotação contra UPDATE comum e histórico imutável em audit_events, com um evento para cada secretaria. A mesma pessoa precisa de consultar e transferir_lotacao na origem e no destino, dentro do mesmo órgão. Escolhe frota ativa, modelo compatível ativo e departamento opcional do destino, com justificativa; modelo exclusivo da origem precisa ser substituído. Ocupação e saldo legado diferente de zero bloqueiam. Não altera identificação, combustíveis, situação, autoria original ou dados financeiros.

GET /vehicles/{vehicle_id}/transfer-options, POST /vehicles/{vehicle_id}/transfer e GET /vehicles/{vehicle_id}/transfers, com guarda e BFF explícitos; escrita com ETag, Idempotency-Key, bloqueios e releitura da autorização após espera. Replay autorizado não move novamente. Histórico filtrado pela secretaria e órgão do contexto. Downgrade preserva os eventos e a lotação atual; não desfaz as transferências.

Evidências anteriores ao lote visual: 20 testes de transferência/veículos/inventário aprovados em 23,90 s; 9/9 cenários no navegador; migrações em banco vazio, reversão e reaplicação aprovadas, 0 diferenças de schema. Banco sintético elo_gestao_dev atualizado de 0022 para 0023 após .local/backups/lotacao-antes-20261115T030456Z.dump, com contagens preservadas; fixture adicional criada depois para avaliação. Relatórios locais: .local/logs/lotacao-upgrade.json e .local/logs/lotacao-browser/result.json. Não repetidos os testes da API neste lote visual porque o backend não mudou.

Desenvolvimento da 4A implementado no ambiente sintético; transferência e encerramento final ainda em revisão. A atualização do manual específico de transferência permanece pendente. Contratos, empenhos, saldos e demais módulos da Fase 4 não foram implementados neste complemento. Operações futuras deverão guardar sua secretaria original, sem reinterpretar histórico pela lotação atual do veículo. A transferência de motorista continua fora deste recorte.

## 44.2 Problemas de uso e escopo do lote visual

O responsável relatou dificuldade para trocar secretaria e encontrar Administração, botões e grids pouco expressivos, menu sem hierarquia e cards abaixo da primeira área visível. A referência visual consultada foi o seletor apps/IAHUB/frontend/selecionar-empresa.html, somente como padrão visual; não foram copiados dados, credenciais ou regras de contexto daquele produto.

O resumo técnico aparecia antes dos atalhos no dashboard e empurrava as rotinas para baixo. A seleção do modo administrativo encaminhava ao dashboard operacional. Foram corrigidos a ordem visual e o destino dessa seleção, mantendo os contratos existentes de resolução de contexto e os controles de acesso.

## 44.3 Entrega visual implementada

| Área | Comportamento entregue | Limite do recorte |
| --- | --- | --- |
| Componentes compartilhados | Botões primários/secundários com hierarquia, foco de teclado, campos e painéis com bordas e sombras suaves; movimento reduzido respeitado nos novos componentes principais. | O estilo alcança as rotinas que usam admin-ui; telas legadas com componentes próprios não são automaticamente redesenhadas. |
| Menu | Ícones por rotina, busca entre rotinas autorizadas, estado ativo, grupos Administração e Elo Gestão e rolagem própria no desktop. | Mantém o menu autorizado pela API; não cria permissões. |
| Início | Cards com ícones e destaque de interação acima do resumo técnico; aviso antigo de indisponibilidade atualizado. | Só mostra rotinas implementadas e autorizadas. |
| Órgão e secretaria | Botão de troca destacado, seletor em dois passos com busca e cards, separação visual Operação/Administração; menu lateral oculto durante a seleção. | Abas existentes mantêm seu contexto; seleção não concede acesso. |
| Entrada administrativa | Modos platform/customer_admin abrem /app/administracao; modo office abre /app/dashboard. | Usuário sem perfil administrativo continua sem acesso às rotinas administrativas; a página orienta selecionar outro ambiente autorizado. |
| Grid compartilhada | Cabeçalho, linhas alternadas, destaque de interação, estado vazio e paginação com apresentação melhorada. | Sem ordenação local enganosa de páginas parciais. |
| Filtros nas colunas | Primeiro uso em Veículos: identificação, modelo, frota e situação; limpar filtros, resumo aplicado e badge de situação. | Demais grids recebem o visual, mas a integração de seus filtros por coluna fica para o próximo lote. |

Filtros de Veículos usam q, model_id, vehicle_fleet_id e status já implementados na API, inclusive na exportação. Modelo e frota possuem busca no servidor; não dependem de uma lista truncada à primeira página. Estado de filtros preservado por aba com useTabState. Durante a busca, os controles permanecem montados no cabeçalho, inclusive quando não há resultados ou ocorre falha, sem ampliar o reaproveitamento de cache entre sessões, órgãos ou secretarias.

## 44.4 Verificações e ambiente de avaliação

| Verificação | Evidência |
| --- | --- |
| Tipos | tsc --noEmit aprovado. |
| Lint e build | Build final aprovado, incluindo tipos e lint; avisos preexistentes, sem erros. Primeira compilação acusou formatação CRLF no novo arquivo de ícones; corrigida antes da compilação válida. |
| Testes web selecionados | 6/6 em cerca de 1 s: descritores, links por contexto, descarte de resposta antiga, negativas de outra identidade, revisão e preservação de formulário/ETag. |
| Navegador real | 11/11: cards na primeira área visível, menu/ícones/busca, filtros na grid, estado vazio com filtros editáveis, limpeza, badge, 390 px, busca do órgão, seletor da secretaria e entrada direta da plataforma em Administração. Um título em maiúsculas exigiu ajustar o roteiro; não foi defeito de produto. |

Prévia própria http://localhost:3007, ligada à API existente http://127.0.0.1:8012. Processos em .local/ux-processes.json; logs em .local/logs/ux-web.* e imagens/resultado em .local/logs/ux-browser. Credenciais sintéticas de operação: .local/lotacao-e2e.json; plataforma: .local/access.json. Nenhum segredo versionado. Prévias 3003, 3005 e 3006 preservadas; sem migração adicional, mudança de permissões, push ou produção neste lote visual.

## 44.5 Avaliação e continuidade

Interface implementada localmente e aguardando avaliação visual do responsável; não declarada homologação completa das telas. Avalie primeiro início, troca de secretaria, Administração e Veículos na porta 3007. O usuário sintético de transferência possui perfil operacional, sem Administração; use a identidade de plataforma para esse modo.

Próximo refinamento visual: estender os filtros de coluna aos demais cadastros, conforme filtros reais de cada API; aprimorar densidade e organização das grids após avaliação desta referência. Ordenação, preferência de colunas e atalhos adicionais permanecem propostas, sem implementação neste lote. Atualização geral do manual de navegação e dos roteiros antigos que pressupõem dashboard após selecionar Administração permanece pendente. 4B–4E seguem no planejamento original; não foram iniciadas.
'''
p.write_text(s,encoding='utf-8',newline='\r\n')
print('Controle consolidado atualizado para 2.39, com evidências e limites do lote visual.')

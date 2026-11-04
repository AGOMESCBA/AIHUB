# Auditoria e pacote da worktree — 04/11/2026

Escopo autorizado: concluir os ajustes, fazer commit e push de todas as alterações da worktree e gerar o pacote para publicação manual. Inclui melhorias de análise de logs, streaming do chat, seleção de modelos Claude e inicialização/entrega de QR do WhatsApp, além da remoção de artefatos temporários que estavam versionados. Novos arquivos temporários, relatórios derivados do log real e capturas de testes ficam fora do commit e do pacote.

## Ajustes da auditoria

- Histórico compacto compartilhado por empresa, incluindo avulsos, conforme decisão explícita do usuário. Guardas internas e externas fornecem a empresa; consultas SQL mantêm o filtro de empresa.
- Criador e editor identificados a partir da sessão autenticada, distinguindo usuário IAHub de consultor externo. Migrações 58 e 59 são aplicadas pelo inicializador normal no próximo início do serviço; o banco de produção não foi alterado durante a validação.
- Uma operação por identidade/empresa; até duas por empresa e quatro por processo, com reserva antes do upload. Respostas de excesso de capacidade são explícitas. A coordenação é local ao processo; eventual execução em múltiplas instâncias exige coordenação compartilhada.
- Correção de respostas atrasadas em abertura de histórico, erros após troca de empresa e mudança de palavra pesquisada.
- Os demais ajustes existentes foram revisados: streaming OpenAI/Claude com recuperação de falhas; rascunho separado da mensagem persistida; modelos Claude controlados na Platform; QR recuperável por HTTP e proteção contra eventos de cliente WhatsApp antigo.

## Evidências

- 79 testes aprovados em 12 arquivos de teste: logs, rotas, migração/histórico, interface no navegador, exportação, Platform/modelos, streaming, retries, progresso, concorrência e WhatsApp (boot e entrega de QR).
- 3 testes adicionais aprovados para respostas atrasadas na interface de logs. Total: 82 testes, nenhuma falha.
- Sintaxe validada em 22 arquivos JavaScript e 10 scripts embutidos em 5 páginas HTML alteradas.
- `git diff --check` sem erros.
- Nenhuma chamada real nova à IA, criação de chamado ou publicação no servidor foi necessária nesta auditoria.

## Empacotamento

O ZIP deve ser gerado com o script de deploy existente a partir de uma exportação do commit final, evitando incluir alterações locais posteriores. A conferência do ZIP verifica caminhos protegidos, presença das novas rotas/repositório/migrações/recursos e identidade dos bytes com os arquivos exportados. O hash SHA-256 permite conferir a transferência. O pacote não leva banco, `.env`, uploads ou sessões; o atualizador existente preserva esses dados e realiza o backup previsto no seu fluxo.

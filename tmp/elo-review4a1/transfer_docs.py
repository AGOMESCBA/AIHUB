from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
p=r/'apps/api/tests/test_vehicle_transfers.py'
s=p.read_text(encoding='utf-8')
needle="        assert error.value.orig.sqlstate=='EL403'\n        session.rollback()"
s=s.replace(needle,needle+"\n        session.execute(text('SET LOCAL ROLE elo_app'))\n        with pytest.raises(DBAPIError) as ordinary:\n            session.execute(text('UPDATE vehicles SET municipal_office_id=:o WHERE id=:i'),\n                            dict(o=api['ids']['A2'],i=row['id']))\n        assert ordinary.value.orig.sqlstate=='42501'\n        session.rollback()")
p.write_text(s,encoding='utf-8',newline='\r\n')
p=r/'apps/backoffice/src/app/app/documentacao/vehicle-manual.tsx'
s=p.read_text(encoding='utf-8').replace('a transferência dependerá de procedimento próprio.', 'use o comando Transferir lotação, separado da edição.')
s=s.replace("      'Não fazem parte desta etapa: saldo e carteira do veículo, abastecimentos, reservas, ocupação e condução, vínculo de motorista, transferência de lotação, fotos e documentos.',", "      'Transferir lotação exige consultar e transferir na origem e no destino, dentro do mesmo órgão. Selecione secretaria, frota ativa, modelo compatível e departamento opcional do destino; informe justificativa e confirme. O mesmo usuário confirma a operação. Um modelo exclusivo da origem precisa ser substituído.',\n      'Salve ou descarte a edição antes de transferir. Ocupação ou saldo legado diferente de zero bloqueiam a transferência. Identificação, combustíveis, situação e autoria são preservados; contratos, empenhos e saldos não acompanham o veículo.',\n      'O comprovante confirma a nova lotação; abra Veículos no contexto de destino para continuar. O histórico, com autor, data, origem, destino e justificativa, fica auditado nas duas secretarias. APIs: GET /vehicles/{id}/transfer-options, POST /vehicles/{id}/transfer e GET /vehicles/{id}/transfers. O comando exige versão atual e chave de idempotência.',\n      'Não fazem parte desta etapa: saldo e carteira do veículo, abastecimentos, reservas, ocupação e condução, vínculo de motorista, fotos e documentos.',")
p.write_text(s,encoding='utf-8',newline='\r\n')
p=r/'docs/planejamento-consolidado.md'
s=p.read_text(encoding='utf-8').replace('Versão 2.38 consolidada','Versão 2.39 consolidada',1)
s=s.replace('o sétimo, 4A.7 — veículos lotados em uma secretaria, foi implementado no ambiente local e está Em revisão (43).','o sétimo, 4A.7 — veículos lotados em uma secretaria, recebeu o complemento de transferência (44). O desenvolvimento previsto da 4A está completo no ambiente sintético local; a revisão independente e o aceite funcional final desta entrega permanecem pendentes. Isso não encerra a Fase 4 inteira: 4B–4E continuam pendentes.')
s=s.replace('transferência pendente (43.8).','transferência implementada no complemento (44).')
s=s.replace('Transferência de lotação: pendente de regras de procedimento (43.8).','Transferência de lotação: procedimento implementado no complemento (44), em revisão.')
lines=s.splitlines()
for i,line in enumerate(lines):
    if line.startswith('| 4A — cadastros | Parcial:'):
        lines[i]='| 4A — cadastros | Desenvolvimento completo no ambiente local; revisão e aceite final do complemento pendentes (44). | Sublotes 4A.1–4A.7 implementados, incluindo transferência de lotação autorizada nas duas secretarias, com histórico. | Revisão independente e avaliação funcional final; condições futuras de 42.8; buscas antigas (39.11); produção (36.6). |'
s='\n'.join(lines)+'\n'
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n', '## 24.6 Registro das entregas e mudanças de direção\n\nComplemento da 4A — 14 de novembro de 2026, versão 2.39: transferência de lotação implementada (44), migração elo_fase4a_0023 após backup; desenvolvimento dos cadastros completo no recorte local, revisão independente e aceite final pendentes. Sem 4B–4E, push ou produção.\n',1)
s=s.replace('- **Transferência de lotação: mantida bloqueada.**', '- **Registro histórico da entrega original; substituído pelo complemento da seção 44. Transferência de lotação inicialmente mantida bloqueada.**',1)
s=s.replace('A 4A.7 permanece **Em revisão** até a revisão independente. A 4A não está concluída (transferência pendente); 4B não iniciada; sem push nem produção.', 'Situação na entrega original: a 4A.7 permaneceu **Em revisão**, com transferência pendente. O complemento da seção 44 implementa essa pendência; desenvolvimento da 4A completo localmente, revisão independente e aceite final pendentes. 4B não iniciada; sem push nem produção.')
s+='''
# 44. Complemento da 4A — transferência de lotação de veículos

## 44.1 Situação e autorização

Execução autorizada pelo responsável para concluir a transferência e fechar os cadastros. Base: fase-2-ambiente-local, HEAD 40ccf52, árvore inicialmente limpa. Desenvolvimento da 4A completo no ambiente local sintético. Revisão própria e testes executados; revisão independente e aceite funcional final pendentes. Não significa conclusão dos módulos 4B–4E nem liberação de produção.

## 44.2 Regras e fluxo implementado

1. Abra o veículo na secretaria de origem e salve ou descarte a edição pendente. A edição comum continua sem mudar órgão ou secretaria.
2. Exigem-se consultar e cad.veiculos.transferir_lotacao nas duas secretarias do mesmo órgão. A mesma pessoa confirma origem e destino; não há aprovação por segunda pessoa neste procedimento.
3. Escolha a secretaria autorizada, uma frota ativa do destino, modelo ativo compatível com categoria ativa e departamento opcional direto do órgão ou da secretaria de destino. Modelo exclusivo da origem precisa ser substituído. Os seletores pesquisam referências autorizadas; exibem até 100 resultados por família, com indicação para refinar a busca.
4. Informe justificativa de 10 a 500 caracteres. Ocupação registrada ou saldo legado diferente de zero impedem a operação. Não há quitação automática nem transferência financeira.
5. O servidor bloqueia órgão e veículo, reconfere sessão, ações e abrangência depois da espera, exige If-Match e Idempotency-Key e grava a mudança e os eventos na mesma transação. Repetição autorizada da mesma requisição devolve o comprovante sem transferir novamente.
6. Identificação, combustíveis, situação, autor original e registros existentes são preservados. O comprovante informa o destino; abra a rotina no contexto de destino. A origem deixa de consultar o cadastro atual, mas mantém seu histórico autorizado.

## 44.3 Impacto técnico e segurança

Migração aditiva elo_fase4a_0023, sem tabela paralela nem alteração de modelos ORM. A função restrita elo_vehicle_transfer executa o comando como proprietário e valida novamente a autorização no banco. elo_app não recebe UPDATE de municipal_office_id. Um gatilho adicional impede a troca comum de lotação. Reutilizado o helper interno de resolução de ações da 0015, sem aplicar regras de fornecedor.

Rotas autenticadas: GET /vehicles/{vehicle_id}/transfer-options (seletores mínimos autorizados), POST /vehicles/{vehicle_id}/transfer (comando), GET /vehicles/{vehicle_id}/transfers (histórico paginado da secretaria do contexto). Guarda da API, BFF, OpenAPI e inventário atualizados; 160 operações no contrato. A ampliação temporária de contexto dos seletores limita-se às secretarias de destino autorizadas e não abre consulta operacional de outros veículos.

Auditoria imutável em audit_events: um evento por secretaria, com identificador do veículo, versão, pessoa, sessão, data/hora, justificativa e referências anteriores e novas. A secretaria consulta só seus eventos; outro órgão não recebe histórico. O downgrade restaura a proteção anterior e remove o comando, preservando os eventos e a lotação atual; não desfaz transferências já realizadas.

## 44.4 Evidências e ambiente

| Verificação | Resultado |
| --- | --- |
| API: transferência, veículos e inventário | 20 aprovados em 23,90 s; mesma conexão de aplicação sem superusuário e bancos descartáveis. |
| Cobertura crítica | Permissões nas duas secretarias, referências incompatíveis, conflito de versão, isolamento, histórico, repetição, ocupação e saldo legado; revogação durante espera controlada impede mover. Função direta nega consulta sem ação; UPDATE comum da secretaria negado pelo banco. |
| Migrações | Banco vazio, reversão e reaplicação aprovados; head elo_fase4a_0023; 0 diferenças de schema. |
| Frontend | Tipos, lint dos arquivos alterados e build isolado aprovados. |
| Navegador real | 9/9: transferência pela tela, comprovante, visibilidade origem/destino, histórico, edição pendente e 390 px. |

Backup sintético: .local/backups/lotacao-antes-20261115T030456Z.dump. Upgrade conferido em elo_gestao_dev, de 0022 para 0023; contagens preservadas. Dados de demonstração adicionais foram criados depois para o roteiro, sem alterar usuários existentes. Relatório do upgrade em .local/logs/lotacao-upgrade.json; relatório e imagens da tela em .local/logs/lotacao-browser. Um e-mail fictício da fixture foi ajustado para atender ao contrato de login antes da execução válida.

Prévia isolada http://localhost:3006, API http://127.0.0.1:8012/docsapi. Credenciais sintéticas restritas às duas secretarias em .local/lotacao-e2e.json, fora do Git; processos próprios em .local/lotacao-processes.json. Prévias 3003 e 3005 e APIs 8010 e 8011 preservadas.

## 44.5 Fechamento e continuidade

Desenvolvimento do escopo previsto dos cadastros da 4A completo no recorte local. A transferência e o encerramento final permanecem sujeitos à revisão independente e ao aceite funcional; nenhum teste relatado substitui essa revisão. A consulta histórica continua protegida por secretaria, mesmo depois da mudança de lotação.

Permanecem as limitações documentadas de cada cadastro, documentos/anexos indefinidos, migração legada da Fase 5 e bloqueios de produção da 36.6. A transferência de motorista não foi incluída. Contratos, empenhos e saldos não acompanham o veículo. Antes de liberar operações futuras, abastecimentos, medições e outros lançamentos deverão registrar a secretaria de origem da própria operação; histórico não pode ser reinterpretado a partir da lotação atual do veículo.

Próxima entrega: 4B — contratos e itens, com propriedade por secretaria, aprovação anterior à movimentação realizada e rastreabilidade do contrato; 4C — empenhos, aditivos, medições e saldos permanece dependente dessas regras. Não iniciados nesta entrega. Sem push nem produção.
'''
p.write_text(s,encoding='utf-8',newline='\r\n')
print('Manual e planejamento 2.39 atualizados; teste de UPDATE comum incluído.')

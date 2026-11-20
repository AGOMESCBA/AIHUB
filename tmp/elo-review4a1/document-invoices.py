from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
p=r/'apps/backoffice/src/app/app/documentacao/access-manual.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('Nota fiscal não é obrigatória no empenho; seu cadastro vinculado à execução e a anulação parcial serão entregas separadas.','Nota fiscal não é obrigatória no empenho; use Notas fiscais para documentar as medições. A anulação parcial continua para uma entrega separada.')
marker="      'Medições não percorrem novas alçadas."
assert marker in s
s=s.replace(marker,"""      'Em Gestão contratual › Notas fiscais, registre NF-e, NFS-e ou outro documento fiscal. Escolha o contrato, confira o fornecedor e informe número, série, emissão, valor e chave quando houver. Vincule as parcelas às medições realizadas: a soma deve ser igual ao total da nota, sem ultrapassar o realizado ainda sem nota. A chave da NF-e, quando informada, deve ter 44 dígitos; o Elo não consulta a autenticidade na SEFAZ.',
      'A nota fiscal preserva os três valores contratuais: Orçado é o limite aprovado com aditivos; Empenhado é a reserva ativa; Realizado é a execução confirmada, descontados os estornos. Registrar ou cancelar um vínculo fiscal não movimenta esses saldos. Notas ativas impedem o estorno das medições vinculadas; cancele primeiro o registro fiscal, com justificativa.',
      'Financeiro registra e cancela notas; Gestor, Financeiro, Aprovador, Consulta e Auditor consultam conforme suas atribuições e secretaria. Dados das medições e empenhos exigem suas permissões próprias. Não há edição silenciosa da nota confirmada: cancele o registro e cadastre o correto, preservando os dois históricos. Cancelar no Elo não cancela a nota na SEFAZ ou na prefeitura. Não há emissão, importação de XML, anexos novos, liquidação, retenções ou pagamento neste lote.',
"""+marker,1)
p.write_text(s,encoding='utf-8')
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8');assert '## 53.13 ' not in s
s=s.replace('Versão 2.49 consolidada','Versão 2.50 consolidada',1)
entry='Notas fiscais da execução — 17 de novembro de 2026, versão 2.50: cadastro e cancelamento de registro fiscal vinculado às medições, sem movimentação de Orçado/Empenhado/Realizado. Migração 0026, APIs e rotina integrada. Entrega local em revisão; seção 53.13.\n\n'
s=s.replace('Evolução de empenhos — 17 de novembro de 2026, versão 2.49:',entry+'Evolução de empenhos — 17 de novembro de 2026, versão 2.49:',1)
section='''## 53.13 Notas fiscais vinculadas à execução contratual

Autorização: implementar somente o item 2 da evolução, mantendo anulação parcial fora deste lote. Os dados são do órgão/secretaria do contrato, exclusivos da secretaria, sem compartilhamento entre órgãos. O fornecedor é definido pelo contrato; autor, situação e propriedade são definidos pelo servidor.

**Processo:** contrato aprovado → empenho → medição/recebimento → nota fiscal vinculada à execução. Orçado é o limite aprovado do contrato com aditivos; Empenhado é a reserva ativa; Realizado soma as medições confirmadas, descontados os estornos. Os disponíveis são derivados desses três valores. A nota documenta o realizado; não gera nova reserva ou realização e não lança no razão financeiro.

**Entrega:** GRID e CRUD no padrão comum, ações no topo, busca por número/contrato, período, situação, paginação e detalhe com vínculos e rastreabilidade. Rotina Notas fiscais no grupo Gestão contratual, tanto no menu lateral quanto nos cards, por navegação autorizada. Contrato e empenho mostram referências das notas conforme permissão. O monitor do contrato apresenta o rótulo Orçado.

Cadastro: NF-e, NFS-e ou outro documento fiscal; número, série quando houver, emissão, valor bruto total, chave opcional e observações. Vinculação por valor a uma ou mais medições realizadas do mesmo contrato, inclusive de empenhos diferentes. São permitidas parcelas de uma medição em notas distintas até o valor realizado. A soma dos vínculos deve igualar o total da nota. Número/série numéricos são normalizados para evitar duplicidade por zeros à esquerda; chave NF-e informada exige 44 dígitos, sem consulta de autenticidade.

Duplicidade de notas ativas é bloqueada por órgão/fornecedor/tipo/série/número e também por órgão/chave. Nota confirmada não é alterada silenciosamente: o cancelamento do registro exige ação própria, motivo, versão e idempotência, preserva vínculos, autor/data e permite recadastrar a versão correta. O cancelamento é interno ao Elo; não cancela o documento na SEFAZ ou prefeitura. Uma medição com nota ativa não pode ser estornada até cancelar o registro fiscal vinculado.

| Camada | Implementação |
| --- | --- |
| Banco | contract_invoices e contract_invoice_links, migração elo_fase4c_0026 após elo_fase4bc_0025. FKs compostas, RLS, índices únicos de documentos ativos, origem imutável e integridade diferida de total/vínculos. Impede exceder medição e estornar realização documentada também no banco. Sem DELETE da aplicação; sem UPDATE de vínculos. |
| API | GET/POST /contract_invoices, GET /contract_invoices/{id}, GET /contract_invoices/measurement-options e POST /contracts/{id}/invoices/{id}/cancel. Cinco operações novas, total de 204. Contexto, ação, referências, ETag do contrato e idempotência nas gravações. Bloqueios órgão → contrato → registro, com autorização reavaliada após espera. |
| Segurança | notas_fiscais.consultar para FIN/GES/APR/CON/AUD; incluir/cancelar apenas FIN. ORG-ADM e plataforma não recebem operação. Incluir exige também consultas de contrato/empenho/medição; dados relacionados respeitam as consultas próprias. Os administradores usam a concessão existente para alterar permissões conforme política do órgão. |
| Auditoria | Registro e cancelamento auditados na mesma transação; rastreabilidade do documento com autor/data/motivo. Valores financeiros preservados. |
| Retorno | Downgrade recusado se houver notas; recuperação de dados por backup em cópia autorizada. |

**Validação executada:** 25 testes da API selecionados (4 fiscais, 17 de contratos/empenhos, 1 de navegação e 3 de inventário), 27 testes web, tipos e lint sem erros nos arquivos alterados (avisos anteriores preservados), migrações de ida/volta/ida em banco descartável com zero diferenças de modelo. Casos incluem repetição, duplicidade, totais, vínculos entre contratos, concorrência, contexto e plataforma, recusa de estorno, cancelamento preservando os três valores e integridade no banco. Logs `.local/logs/notas-*.log`. A suíte completa não foi repetida.

Banco local confirmado elo_gestao_dev, backup antes do upgrade em `.local/backups/notas-fiscais-antes-20261117T204008Z.dump`; revisão 0026 aplicada. A verificação final da tela e a ativação da prévia serão registradas ao concluir o roteiro. Manual, inventário e OpenAPI atualizados. Sem commit, push ou produção; mudanças pré-existentes preservadas.

Fora deste lote: anulação parcial/reforço de empenho, emissão/consulta de autenticidade fiscal externa, importação de XML, novos anexos, tributos/retenções, liquidação e pagamento. Não se anuncia uma integração fiscal ou contábil homologada.

'''
needle='## 52.5 Botões do formulário no topo';assert needle in s;s=s.replace(needle,section+needle,1);p.write_text(s,encoding='utf-8')
print('Manual e controle atualizados: 2.50 / 53.13')

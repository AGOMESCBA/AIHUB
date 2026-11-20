from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
def edit(name,old,new,count=1):
 p=R/name;s=p.read_text(encoding='utf-8');assert s.count(old)>=count,(name,old[:80]);p.write_text(s.replace(old,new,count),encoding='utf-8')
edit('apps/api/alembic/versions/elo_fase4bc_0025_contratos.py','down_revision="elo_fase4a_0024"','down_revision="elo_fase4a_0025"')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('  useTabSave,','  useTabSave,\n  useBackToList,',1).replace('  Cell,','  Cell,\n  CancelToList,',1)
# Os comandos de fechamento usam save diretamente; o submit normal segue o padrão novo da própria aba.
s=s.replace('  useTabSave(save, canSave && !saved);','  const backToList = useBackToList();\n  useTabSave(save, canSave && !saved);',1)
s=s.replace('  useTabSave(save, allowed && !saved);','  const backToList = useBackToList();\n  useTabSave(save, allowed && !saved);',1)
old='onSubmit={(e) => {\n          e.preventDefault();\n          void save();\n        }}'
assert s.count(old)==2
s=s.replace(old,'onSubmit={async (e) => {\n          e.preventDefault();\n          if (await save()) backToList("Operação concluída: registro salvo.");\n        }}')
s=s.replace('        {saved && (\n          <RoutineLink','        <CancelToList />\n        {saved && (\n          <RoutineLink')
p.write_text(s,encoding='utf-8')
edit('tools/dev/test-web-workspace.cjs','assert.equal(apiCodes.length, 27);','assert.equal(apiCodes.length, 31);')
edit('tools/dev/test-web-workspace.cjs',"'/app/orgaos/1/secretarias/2/contratos', '/app/orgaos/1/administracao',","'/app/orgaos/1/secretarias/2/contratos/0', '/app/orgaos/1/administracao',")
# O gerador permanece a fonte do contrato e não apaga o registro entregue em uma exportação futura.
p=R/'tools/dev/export_contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace('"status": "etapa-4a-transferencia-validacao-local"','"status": "etapa-4bc-implementada-em-revisao-local"')
needle='        "pending": ['
assert needle in s
pos=s.index(needle); before=s[:pos];after=s[pos:]
idx=before.rfind('\n        ],')
assert idx>0
before=before[:idx]+',\n            {"flow": "contratos-execucao-4bc", "paths": ["/contracts/", "/contracts/{contract_id}", "/contract_commitments/", "/contract_measurements/", "/customers/{customer_id}/contract-approval-policies", "/customers/{customer_id}/contract-approval-options"], "scope": "Contratos exclusivos de secretaria, itens com snapshot, aprovação sequencial configurável por contrato, aditivos por quantidade/vigência, empenhos autorizados externamente, medições sem nova alçada e estornos rastreados. ETag e Idempotency-Key nos comandos, RLS e isolamento organizacional. Implementado localmente, em revisão, sem produção.", "consumers": ["Elo Gestão › Contratos, Empenhos e Medições", "Administração do órgão › Alçadas contratuais", "Endereços antigos /app/contract e /app/effort abrem rotinas novas"], "legacy_changes": ["Não existia API de contratos no acervo; schemas e telas recebidos usados como referência", "Saldo direto de /endeavours e balance_in_cents não importados nem reabertos", "Empenhos reservam limite e medições consomem o empenho sem desconto duplicado", "Documentos, importação, pagamentos, PIX, novas linhas/reajuste de preço no aditivo e reabertura de encerrado fora deste recorte"]}'+before[idx:]
s=before+after
s=s.replace('"reason": "Interface recebida sem API correspondente; obrigatório no lançamento."','"reason": "Núcleo 4B implementado localmente e em revisão; documentos e aditivos com novos itens/reajuste de preço pendentes."')
s=s.replace('"reason": "Modelo legado de saldo direto difere de carteiras esperadas pela UI; definir domínio e controles financeiros."','"reason": "Núcleo contratual 4C implementado localmente e em revisão; pagamentos, dados bancários/PIX, integrações contábeis e importação não entregues."')
p.write_text(s,encoding='utf-8')
print('Padrão de salvar/cancelar atualizado; migração encadeada; contrato e testes de navegação ajustados.')

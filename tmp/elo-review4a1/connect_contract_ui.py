from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
def change(name,old,new):
    p=R/name;b=p.read_bytes();a=old.encode();assert b.count(a)==1,(name,b.count(a));p.write_bytes(b.replace(a,new.encode()))
change('apps/api/app/routers/me.py','NAVIGATION_ROUTINES = (','''NAVIGATION_ROUTINES = (
    ("adm.alcadas", "administracao", "customer_admin", "config.alcadas.consultar", ("config.alcadas.",), "Alçadas contratuais", "Usuários, limites e níveis sequenciais por contrato."),
    ("ope.contratos", "operacao", "office", "contratos.consultar", ("contratos.",), "Contratos", "Aprovação, vigência, aditivos e monitor do contrato."),
    ("ope.empenhos", "operacao", "office", "empenhos.consultar", ("empenhos.",), "Empenhos", "Registro dos empenhos já autorizados e vinculados ao contrato."),
    ("ope.medicoes", "operacao", "office", "medicoes.consultar", ("medicoes.", "saldos."), "Medições", "Execução atestada e consumo dos itens e saldos contratuais."),''')
change('apps/backoffice/src/workspace/registry.ts','const definitions: RoutineDefinition[] = [','''const definitions: RoutineDefinition[] = [
  { code: 'adm.alcadas', area: 'administracao', mode: 'customer_admin', slug: 'alcadas', title: 'Alçadas contratuais', record: 'Alçada', hasRecord: false },
  { code: 'ope.contratos', area: 'operacao', mode: 'office', slug: 'contratos', title: 'Contratos', record: 'Contrato', create: 'Novo contrato', hasRecord: true },
  { code: 'ope.empenhos', area: 'operacao', mode: 'office', slug: 'empenhos', title: 'Empenhos', record: 'Empenho', create: 'Novo empenho', hasRecord: false },
  { code: 'ope.medicoes', area: 'operacao', mode: 'office', slug: 'medicoes', title: 'Medições', record: 'Medição', create: 'Nova medição', hasRecord: false },''')
change('apps/backoffice/src/workspace/groups.ts',"const GROUP_OF: Readonly<Record<string, RoutineGroup>> = {","""const GROUP_OF: Readonly<Record<string, RoutineGroup>> = {
  'adm.alcadas': 'acessos',
  'ope.contratos': 'operacoes',
  'ope.empenhos': 'operacoes',
  'ope.medicoes': 'operacoes',""")
change('apps/backoffice/src/workspace/routine-icon.tsx',"const Icon = code.includes('auditoria')","""const Icon = code.includes('alcadas') ? ShieldCheck
    : code.includes('contratos') ? FileText
    : code.includes('empenhos') ? ClipboardList
    : code.includes('medicoes') ? Workflow
    : code.includes('auditoria')""")
change('apps/backoffice/src/workspace/workspace-view.tsx',"import { AuditEvents } from '@/app/app/administracao/audit-screens';","import { AuditEvents } from '@/app/app/administracao/audit-screens';\nimport { Contracts, ContractExecution, ContractApprovalPolicies } from '@/app/app/contratos/contract-screens';")
change('apps/backoffice/src/workspace/workspace-view.tsx',"    case 'ope.veiculos':","""    case 'adm.alcadas': return <ContractApprovalPolicies />;
    case 'ope.contratos': return <Contracts id={id} />;
    case 'ope.empenhos': return <ContractExecution id={id} />;
    case 'ope.medicoes': return <ContractExecution id={id} measurement />;
    case 'ope.veiculos':""")
change('apps/backoffice/src/lib/api-routes.ts','export const API_ROUTES: Route[] = [','''export const API_ROUTES: Route[] = [
  route(['GET', 'POST'], 'contracts'),
  route(['GET'], 'contracts/export'),
  route(['GET', 'PUT'], `contracts/${ID}`),
  route(['POST'], `contracts/${ID}/(submit|decisions|withdraw|amendments)`),
  route(['POST'], `contracts/${ID}/status/(suspend|resume|close|cancel)`),
  route(['GET'], `contracts/${ID}/(balance|events)`),
  route(['POST'], `contracts/${ID}/commitments/${ID}/cancel`),
  route(['POST'], `contracts/${ID}/measurements/${ID}/reverse`),
  route(['GET', 'POST'], 'contract_commitments'),
  route(['GET', 'POST'], 'contract_measurements'),
  route(['GET', 'PUT'], `${CUSTOMER}/contract-approval-policies`),
  route(['GET'], `${CUSTOMER}/contract-approval-options`),''')
change('apps/backoffice/src/lib/api-routes.ts','|drivers|vehicles)$/;','|drivers|vehicles|contracts|contract_commitments|contract_measurements)$/;')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("'number:asc', () => setPage(1)","'number', () => setPage(1)")
s=s.replace("const [sortBy, sortDir] = String(sort).split(':');","const sortBy = String(sort).replace(/^-/, ''); const sortDir = String(sort).startsWith('-') ? 'desc' : 'asc';")
s=s.replace("minimum: moneyInput(l.minimum_cents)","minimum: moneyInput(l.minimum_cents)")
p.write_text(s,encoding='utf-8')
print('Menus, cards, navegação e intermediário ligados às rotinas novas.')

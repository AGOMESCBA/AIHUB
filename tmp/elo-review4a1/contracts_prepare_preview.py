from pathlib import Path
import shutil,re
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace("  useTabState,\n", "  useTabState,\n  useWorkspace,\n") if '  useTabState,\n' in s else s.replace("useTabState }", "useTabState, useWorkspace }")
# O formatador pode agrupar os imports numa única linha.
if 'useWorkspace' not in s:s=s.replace('useTabSave, useTabState','useTabSave, useTabState, useWorkspace')
s=s.replace('export function ContractApprovalPolicies() {\n  const api = useAdminApi();','export function ContractApprovalPolicies() {\n  const api = useAdminApi();\n  const workspace = useWorkspace();')
old="""          onChange={(id, text) => {
            setContract(id);
            setContractText(text);
          }}
          emptyText="Selecionar contrato"""
new="""          onChange={(id, text) => {
            if (workspace.displayedId && workspace.flags[workspace.displayedId]?.dirty && !window.confirm('Descartar as alterações das alçadas antes de escolher outro contrato?')) return;
            setContract(id);
            setContractText(text);
          }}
          emptyText="Selecionar contrato"""
assert old in s
s=s.replace(old,new);p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/workspace/locations.ts';b=p.read_bytes();old=b"  if (s[1] === 'supplier')";assert b.count(old)==1
b=b.replace(old,b"  if (s[1] === 'contract') return legacyPage('ope.contratos', s.slice(2));\n  if (s[1] === 'effort') return legacyPage('ope.empenhos', s.slice(2));\n"+old);p.write_bytes(b)
for relative in ['contract/page.tsx','contract/form/page.tsx','contract/[contract]/page.tsx','effort/page.tsx','effort/form/page.tsx']:
    p=R/'apps/backoffice/src/app/app'/relative
    p.write_text('// Endereço legado: o workspace valida a autorização e abre a rotina nova.\nexport default function LegacyContractPage() { return null; }\n',encoding='utf-8')
preview=R/'.local/contracts-web'
for name in ('src','public'):shutil.copytree(R/'apps/backoffice'/name,preview/name,dirs_exist_ok=True)
p=preview/'.env.local';s=p.read_text(encoding='utf-8');s=re.sub(r'^NEXT_PUBLIC_API_BASE_URL=.*$','NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8013',s,flags=re.M);s=re.sub(r'^NEXTAUTH_URL=.*$','NEXTAUTH_URL=http://localhost:3008',s,flags=re.M);p.write_text(s,encoding='utf-8')
print('Prévia 3008 preparada para API 8013; demais prévias preservadas.')

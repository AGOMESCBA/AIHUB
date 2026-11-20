from pathlib import Path
R=Path('C:/Apps/ELOGESTAO');p=R/'apps/backoffice/src/workspace/workspace-view.tsx';s=p.read_text(encoding='utf-8');old='<ContractApprovalQueue id={id} />';assert old in s;s=s.replace(old,'<ContractApprovalQueue key={id ?? "list"} id={id} />',1);p.write_text(s,encoding='utf-8')

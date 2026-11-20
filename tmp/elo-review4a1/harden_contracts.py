from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/api/app/models/contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace("    attrs['__table_args__']=(", "    if 'contract_id' in columns:\n        extra=(*extra,UniqueConstraint('contract_id','id',name=f'uq_{table}_contract_id'))\n    attrs['__table_args__']=(")
s+='''
# As referências filhas nunca podem apontar a outro contrato, mesmo dentro da mesma secretaria.
for model,field,target in ((ApprovalRound,'amendment_id','contract_amendments'),
                           (ApprovalVote,'round_id','contract_approval_rounds'),
                           (ContractMeasurement,'commitment_id','contract_commitments'),
                           (ContractMeasurement,'item_id','contract_items')):
    model.__table__.append_constraint(ForeignKeyConstraint(['contract_id',field],[f'{target}.contract_id',f'{target}.id'],name=f'fk_{model.__tablename__}_{field}_contract'))
'''
p.write_text(s,encoding='utf-8')
p=R/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace("(not allow_self and a['user_id']==author)","(not allow_self and a['user_id'] in author)")
s=s.replace("levels=eligible(db,ctx,c,policy.levels,amount,ctx.user_id,policy.allow_self_approval)","authors={ctx.user_id} if amendment else {ctx.user_id,c.created_by}\n    levels=eligible(db,ctx,c,policy.levels,amount,authors,policy.allow_self_approval)")
s=s.replace("{'policy_version':policy.version,**snapshot}","{'policy_version':policy.version,'authors':sorted(authors),**snapshot}")
s=s.replace("ctx.user_id==r.created_by","ctx.user_id in r.snapshot['authors']")
p.write_text(s,encoding='utf-8')
print('Referências compostas e proteção da autoria adicionadas aos arquivos novos.')

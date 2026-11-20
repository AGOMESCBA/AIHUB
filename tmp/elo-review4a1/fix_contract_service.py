from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/apps/api/app/services/contracts.py')
s=p.read_text(encoding='utf-8')
s=s.replace("def start(db,ctx,cid,action,request,body):\n    operational.require_action(ctx,action)","def start(db,ctx,cid,action,request,body):\n    operational.require_action(ctx,'contratos.consultar')\n    operational.require_action(ctx,action)")
s=s.replace("    return r\ndef active(db,c):","    office=c.municipal_office_id\n    if not ctx.profile.allows('empenhos.consultar',office):r['commitments']=[]\n    if not ctx.profile.allows('medicoes.consultar',office):r['measurements']=[]\n    if not ctx.profile.allows('saldos.consultar',office):r['ledger']=[]\n    return r\ndef active(db,c):")
s=s.replace("    financial(ContractPosition,sum(i['total_cents'] for i in rows))","    total=sum(i['total_cents'] for i in rows)\n    if total>9_000_000_000_000:fail('CONTRACT_VALUE_TOO_LARGE','O total excede o limite suportado para contratos.')\n    financial(ContractPosition,total)")
s=s.replace('    financial(position(db,c).with_amended_limit,limit)',"    if limit>9_000_000_000_000:fail('CONTRACT_VALUE_TOO_LARGE','O total excede o limite suportado para contratos.')\n    financial(position(db,c).with_amended_limit,limit)")
p.write_text(s,encoding='utf-8')

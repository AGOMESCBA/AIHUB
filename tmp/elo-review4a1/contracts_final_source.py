from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=R/'apps/api/app/models/contracts.py';s=p.read_text(encoding='utf-8').replace('ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, text)','ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, Index, text)')
s=s.replace("UniqueConstraint('customer_id','municipal_office_id','id',name=f'uq_{table}_owner'),*extra)","UniqueConstraint('customer_id','municipal_office_id','id',name=f'uq_{table}_owner'),\n        Index(f'ix_{table}_office','customer_id','municipal_office_id'),*extra)")
p.write_text(s,encoding='utf-8')
p=R/'apps/api/app/services/contracts.py';s=p.read_text(encoding='utf-8')
s=s.replace("p.levels=[l.model_dump() for l in body.levels];p.allow_self_approval=body.allow_self_approval;db.flush()", "p.levels=[l.model_dump() for l in body.levels]\n    for level in p.levels:\n        for a in level['approvers']:\n            a['name']=db.execute(text('SELECT name FROM users WHERE id=:id'),dict(id=a['user_id'])).scalar_one()\n    p.allow_self_approval=body.allow_self_approval;db.flush()")
p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/contratos/contract-screens.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('<Badge value="approved" />','<Badge value={row.status} />')
s=s.replace("Usuário #{a.user_id} · até {money(a.limit_cents)}", "{a.name ?? `Usuário #${a.user_id}`} · até {money(a.limit_cents)}")
p.write_text(s,encoding='utf-8')
p=R/'apps/backoffice/src/app/app/documentacao/access-manual.tsx';b=p.read_bytes();needle=b'const sections: { title: string; items: string[] }[] = [';assert b.count(needle)==1
extra='''
  {
    title: 'Contratos, alçadas e execução contratual (4B/4C local)',
    items: [
      'Em Elo Gestão › Operações › Contratos, cadastre número, fornecedor, objeto, vigência e itens. O total é calculado no servidor; contrato pendente não permite empenho nem medição.',
      'Em Administração › Pessoas e acessos › Alçadas contratuais, escolha o contrato, os aprovadores e os limites por contrato, com níveis sequenciais. Cada nível exige um aprovador ou todos os habilitados, conforme configuração. A alçada não é consumida ao aprovar.',
      'O usuário precisa de vínculo, abrangência e ação de aprovação, além da alçada suficiente. A configuração pode permitir que o autor aprove; sem essa opção, o autor não participa da aprovação da própria proposta. Sem nível aplicável ou aprovador habilitado, a submissão é recusada.',
      'Cada submissão preserva a versão analisada e os níveis. Não é possível alterar alçadas com aprovação pendente. Retirar da aprovação permite corrigir e submeter novamente, preservando as decisões anteriores.',
      'Contrato aprovado só fica vigente dentro das datas; suspensão e término de vigência bloqueiam novas movimentações. O saldo esgotado não encerra o contrato automaticamente. Cancelamento e encerramento exigem regularização das operações pendentes.',
      'Aditivos deste lote alteram quantidades dos itens existentes e término da vigência. A alçada considera o valor total resultante; a versão aprovada permanece válida durante a análise. A aprovação do aditivo não cria empenho automaticamente. Inclusão de novos itens e troca de preços no aditivo ainda não fazem parte deste lote.',
      'Empenhos são registros de autorizações já emitidas no sistema contábil de origem. Informe número, valor, data, referência e responsável. O registro reserva o limite contratual, sem alterar o orçamento geral da secretaria.',
      'Medições não percorrem novas alçadas. Informe contrato vigente, empenho ativo, item, quantidade, data e referência do ateste. O servidor confere quantidades e saldos; o valor usa o preço contratado. Medir consome o empenhado sem descontar novamente o limite do contrato.',
      'No contrato, Execução permite estornar uma medição mediante justificativa e cancelar um empenho sem realização. Operações confirmadas não são editadas; o histórico mantém origem, responsável e lançamentos compensatórios. Cancelamento parcial de empenho e reabertura de contrato encerrado dependem de evolução específica.',
      'Visão geral mostra indicadores e consumo; Itens preserva descrição, unidade e versão do produto; Aprovações mostra os níveis; Histórico relaciona os eventos à operação. Todos os dados operacionais ficam exclusivos da secretaria e isolados entre órgãos.',
      'Este lote está sujeito à homologação local e revisão independente. Não emite empenho contábil, não liquida nem paga despesas, não importa dados antigos e não libera produção. Anexos continuam no escopo anteriormente disponível.',
    ],
  },
'''.encode('utf-8')
p.write_bytes(b.replace(needle,needle+extra))
p=R/'apps/api/tests/test_contracts_api.py';s=p.read_text(encoding='utf-8')
s=s.replace("        r=_alembic(db,*command);assert r.returncode==0,r.stderr[-4000:]", "        r=_alembic(db,*command);assert r.returncode==0,r.stderr[-4000:]\n    r=_alembic(db,'check');assert r.returncode==0,r.stderr[-4000:]+r.stdout[-4000:]")
s+='''
def test_database_blocks_overcommit_and_protects_execution_history(finance):
    from sqlalchemy.exc import DBAPIError
    a=finance['api'];c=approved(finance)
    with pytest.raises(DBAPIError) as error:
        with a['owner'].begin() as db:
            _insert(db,'contract_commitments',contract_id=c['id'],customer_id=a['ids']['A'],municipal_office_id=a['ids']['A1'],created_by=a['ids']['tgtSelf'],number='FORJADO',date=date.today(),amount_cents=100001,authorization_reference='Teste direto',authorized_by='Fixture')
    assert error.value.orig.sqlstate=='23514'
    r=commitment(a,c);assert r.status_code==201,r.text;e=r.json()['commitments'][0]['id']
    with pytest.raises(DBAPIError) as error:
        with a['owner'].begin() as db:db.execute(text('UPDATE contract_commitments SET amount_cents=1 WHERE id=:i'),dict(i=e))
    assert error.value.orig.sqlstate=='23514'
    with pytest.raises(DBAPIError) as error:
        with a['owner'].begin() as db:
            db.execute(text('SET LOCAL ROLE elo_app'))
            db.execute(text('UPDATE contract_ledger SET amount_cents=0 WHERE contract_id=:c'),dict(c=c['id']))
    assert error.value.orig.sqlstate=='42501'
'''
p.write_text(s,encoding='utf-8')
print('Manual e testes de integridade específicos atualizados.')

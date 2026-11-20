from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
def put(name,content):
    p=R/name
    if p.exists():raise RuntimeError('Arquivo já existe: '+name)
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(content,encoding='utf-8')

put('apps/api/app/models/contracts.py', '''"""Agregados 4B/4C; isolamento por órgão e secretaria em todas as tabelas."""
from sqlalchemy import (Column, Integer, BigInteger, String, Date, Numeric, Boolean,
                        ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, text)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from .definitions import Base

def common():
    return dict(id=Column(Integer,primary_key=True),customer_id=Column(Integer,ForeignKey('customers.id'),nullable=False),
                municipal_office_id=Column(Integer,nullable=False),created_by=Column(Integer,ForeignKey('users.id'),nullable=False),
                version=Column(Integer,nullable=False,server_default=text('1')),
                created_at=Column(TIMESTAMP(timezone=True),nullable=False,server_default=text('now()')),
                updated_at=Column(TIMESTAMP(timezone=True),nullable=False,server_default=text('now()')))

def register(name,table,columns,extra=()):
    attrs={'__tablename__':table,**common(),**columns}
    attrs['__table_args__']=(
        ForeignKeyConstraint(['customer_id','municipal_office_id'],['municipal_offices.customer_id','municipal_offices.id'],name=f'fk_{table}_office'),
        UniqueConstraint('customer_id','municipal_office_id','id',name=f'uq_{table}_owner'),*extra)
    return type(name,(Base,),attrs)

def contract_fk(table):
    return ForeignKeyConstraint(['customer_id','municipal_office_id','contract_id'],
        ['contracts.customer_id','contracts.municipal_office_id','contracts.id'],name=f'fk_{table}_contract')

Contract=register('Contract','contracts',{
    'number':Column(String(80),nullable=False),'description':Column(String(2000),nullable=False),
    'supplier_id':Column(Integer,ForeignKey('suppliers.id'),nullable=False),
    'starts_on':Column(Date,nullable=False),'ends_on':Column(Date,nullable=False),
    'status':Column(String(30),nullable=False,server_default=text("'pending'")),
    'limit_cents':Column(BigInteger,nullable=False),'approval_round_id':Column(Integer),
},(UniqueConstraint('customer_id','municipal_office_id','number',name='uq_contracts_number'),
   CheckConstraint('ends_on >= starts_on',name='ck_contracts_dates'),
   CheckConstraint('limit_cents > 0',name='ck_contracts_limit'),
   CheckConstraint("status IN ('pending','awaiting_approval','approved','suspended','closed','cancelled')",name='ck_contracts_status')))

ContractItem=register('ContractItem','contract_items',{
    'contract_id':Column(Integer,nullable=False),'product_id':Column(Integer,ForeignKey('products.id'),nullable=False),
    'description':Column(String(500),nullable=False),'unit_snapshot':Column(String(200),nullable=False),
    'product_version':Column(Integer,nullable=False),'quantity':Column(Numeric(24,6),nullable=False),
    'unit_price_cents':Column(BigInteger,nullable=False),'total_cents':Column(BigInteger,nullable=False),
},(contract_fk('contract_items'),CheckConstraint('quantity > 0 AND unit_price_cents > 0 AND total_cents > 0',name='ck_contract_items_amount')))

ContractPolicy=register('ContractPolicy','contract_approval_policies',{
    'contract_id':Column(Integer,nullable=False),'levels':Column(JSONB,nullable=False),
    'allow_self_approval':Column(Boolean,nullable=False,server_default=text('false')),
},(contract_fk('contract_approval_policies'),UniqueConstraint('contract_id',name='uq_contract_policy')))

ContractAmendment=register('ContractAmendment','contract_amendments',{
    'contract_id':Column(Integer,nullable=False),'reason':Column(String(1000),nullable=False),
    'changes':Column(JSONB,nullable=False),'new_ends_on':Column(Date),
    'status':Column(String(30),nullable=False,server_default=text("'awaiting_approval'")),
    'resulting_limit_cents':Column(BigInteger,nullable=False),
},(contract_fk('contract_amendments'),CheckConstraint("status IN ('awaiting_approval','approved','rejected')",name='ck_contract_amendments_status')))

ApprovalRound=register('ApprovalRound','contract_approval_rounds',{
    'contract_id':Column(Integer,nullable=False),'amendment_id':Column(Integer,ForeignKey('contract_amendments.id')),
    'amount_cents':Column(BigInteger,nullable=False),'levels':Column(JSONB,nullable=False),
    'snapshot':Column(JSONB,nullable=False),'allow_self_approval':Column(Boolean,nullable=False),
    'current_level':Column(Integer,nullable=False,server_default=text('1')),
    'status':Column(String(30),nullable=False,server_default=text("'pending'")),
},(contract_fk('contract_approval_rounds'),CheckConstraint("status IN ('pending','approved','rejected')",name='ck_contract_round_status')))

ApprovalVote=register('ApprovalVote','contract_approval_votes',{
    'contract_id':Column(Integer,nullable=False),'round_id':Column(Integer,ForeignKey('contract_approval_rounds.id'),nullable=False),
    'level':Column(Integer,nullable=False),'decision':Column(String(10),nullable=False),'reason':Column(String(1000),nullable=False),
},(contract_fk('contract_approval_votes'),UniqueConstraint('round_id','level','created_by',name='uq_contract_vote'),
   CheckConstraint("decision IN ('approve','reject')",name='ck_contract_vote_decision')))

ContractCommitment=register('ContractCommitment','contract_commitments',{
    'contract_id':Column(Integer,nullable=False),'number':Column(String(80),nullable=False),
    'date':Column(Date,nullable=False),'amount_cents':Column(BigInteger,nullable=False),
    'authorization_reference':Column(String(500),nullable=False),'authorized_by':Column(String(200),nullable=False),
    'status':Column(String(20),nullable=False,server_default=text("'active'")),
},(contract_fk('contract_commitments'),UniqueConstraint('customer_id','municipal_office_id','number',name='uq_contract_commitment_number'),
   CheckConstraint("amount_cents > 0 AND status IN ('active','cancelled')",name='ck_contract_commitment_amount')))

ContractMeasurement=register('ContractMeasurement','contract_measurements',{
    'contract_id':Column(Integer,nullable=False),'commitment_id':Column(Integer,ForeignKey('contract_commitments.id'),nullable=False),
    'item_id':Column(Integer,ForeignKey('contract_items.id'),nullable=False),'quantity':Column(Numeric(24,6),nullable=False),
    'amount_cents':Column(BigInteger,nullable=False),'date':Column(Date,nullable=False),
    'attestation_reference':Column(String(500),nullable=False),'attested_by':Column(String(200),nullable=False),
    'status':Column(String(20),nullable=False,server_default=text("'realized'")),
},(contract_fk('contract_measurements'),CheckConstraint("quantity > 0 AND amount_cents > 0 AND status IN ('realized','reversed')",name='ck_contract_measurement_amount')))

ContractLedger=register('ContractLedger','contract_ledger',{
    'contract_id':Column(Integer,nullable=False),'kind':Column(String(30),nullable=False),
    'source_id':Column(Integer,nullable=False),'amount_cents':Column(BigInteger,nullable=False),
    'reason':Column(String(1000),nullable=False),
},(contract_fk('contract_ledger'),UniqueConstraint('kind','source_id',name='uq_contract_ledger_source'),
   CheckConstraint("kind IN ('commitment','commitment_cancel','measurement','measurement_reverse','amendment')",name='ck_contract_ledger_kind')))
''')

put('apps/api/app/schemas/contracts.py','''"""Entradas 4B/4C: propriedade, totais, decisões e saldo são definidos no servidor."""
from datetime import date
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text=Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=1000)]
Short=Annotated[str,StringConstraints(strip_whitespace=True,min_length=1,max_length=80)]
Money=Annotated[int,Field(strict=True,gt=0,le=9_000_000_000_000)]
ID=Annotated[int,Field(strict=True,gt=0)]
Quantity=Annotated[str,StringConstraints(pattern=r'^\\d{1,12}(\\.\\d{1,6})?$')]

class Input(BaseModel):
    model_config=ConfigDict(extra='forbid')

class ItemInput(Input):
    product_id: ID
    quantity: Quantity
    unit_price_cents: Money

class ContractInput(Input):
    number: Short
    description: Text
    supplier_id: ID
    starts_on: date
    ends_on: date
    items: list[ItemInput]=Field(min_length=1,max_length=200)
    @model_validator(mode='after')
    def dates(self):
        if self.ends_on<self.starts_on:raise ValueError('Fim da vigência anterior ao início.')
        return self

class ApproverInput(Input):
    user_id: ID
    limit_cents: Money

class LevelInput(Input):
    mode: Literal['any','all']='any'
    minimum_cents: Annotated[int,Field(strict=True,ge=0,le=9_000_000_000_000)]=0
    approvers: list[ApproverInput]=Field(min_length=1,max_length=30)
    @model_validator(mode='after')
    def unique(self):
        if len({a.user_id for a in self.approvers})!=len(self.approvers):raise ValueError('Aprovador repetido no nível.')
        return self

class PolicyInput(Input):
    contract_id: ID
    levels: list[LevelInput]=Field(min_length=1,max_length=10)
    allow_self_approval: bool=False

class ReasonInput(Input):
    reason: Text

class DecisionInput(ReasonInput):
    decision: Literal['approve','reject']

class AmendmentChange(Input):
    item_id: ID
    new_quantity: Quantity

class AmendmentInput(ReasonInput):
    changes: list[AmendmentChange]=Field(default_factory=list,max_length=200)
    new_ends_on: date | None=None
    @model_validator(mode='after')
    def meaningful(self):
        if not self.changes and self.new_ends_on is None:raise ValueError('Informe uma alteração.')
        if len({c.item_id for c in self.changes})!=len(self.changes):raise ValueError('Item repetido.')
        return self

class CommitmentInput(Input):
    contract_id: ID
    number: Short
    date: date
    amount_cents: Money
    authorization_reference: Text
    authorized_by: Text

class MeasurementInput(Input):
    contract_id: ID
    commitment_id: ID
    item_id: ID
    quantity: Quantity
    date: date
    attestation_reference: Text
    attested_by: Text
''')
print('Modelos e schemas novos preparados, sem alterar arquivos compartilhados.')

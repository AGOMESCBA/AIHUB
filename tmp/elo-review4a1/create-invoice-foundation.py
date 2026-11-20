from pathlib import Path
r=Path('C:/Apps/ELOGESTAO');scratch=Path('C:/Apps/iahub/tmp/elo-review4a1')
for file,extra in [('apps/api/app/models/contracts.py','invoice-models.txt'),('apps/api/app/schemas/contracts.py','invoice-schema.txt')]:
 p=r/file;p.write_text(p.read_text(encoding='utf-8')+(scratch/extra).read_text(encoding='utf-8'),encoding='utf-8')
import sys
sys.path.insert(0,str(r/'apps/api'))
from app.models.contracts import ContractInvoice,ContractInvoiceLink
from sqlalchemy.schema import CreateTable,CreateIndex
from sqlalchemy.dialects import postgresql
sql=''
for model in (ContractInvoice,ContractInvoiceLink):
 t=model.__table__;sql+=str(CreateTable(t).compile(dialect=postgresql.dialect()))+';\n'
 for idx in sorted(t.indexes,key=lambda i:i.name):sql+=str(CreateIndex(idx).compile(dialect=postgresql.dialect()))+';\n'
 name=t.name
 sql+=f'''ALTER TABLE {name} ENABLE ROW LEVEL SECURITY;
CREATE POLICY elo_invoice_read ON {name} FOR SELECT TO elo_app USING (customer_id=elo_ctx_customer_id() AND municipal_office_id=ANY(elo_ctx_office_ids()) AND elo_ctx_mode()='office');
CREATE POLICY elo_invoice_insert ON {name} FOR INSERT TO elo_app WITH CHECK (customer_id=elo_ctx_customer_id() AND municipal_office_id=ANY(elo_ctx_office_ids()) AND elo_ctx_mode()='office' AND created_by=elo_request_user_id());
GRANT SELECT,INSERT ON {name} TO elo_app;
GRANT USAGE,SELECT ON SEQUENCE {name}_id_seq TO elo_app;
'''
sql+='''CREATE POLICY elo_invoice_cancel ON contract_invoices FOR UPDATE TO elo_app USING (customer_id=elo_ctx_customer_id() AND municipal_office_id=ANY(elo_ctx_office_ids()) AND elo_ctx_mode()='office') WITH CHECK (customer_id=elo_ctx_customer_id() AND municipal_office_id=ANY(elo_ctx_office_ids()) AND elo_ctx_mode()='office' AND cancelled_by=elo_request_user_id());
GRANT UPDATE ON contract_invoices TO elo_app;
'''
sql+=(scratch/'invoice-migration-extra.sql').read_text(encoding='utf-8')
down='''DO $$ BEGIN IF EXISTS(SELECT 1 FROM contract_invoices) THEN RAISE EXCEPTION 'reversao_com_dados: notas fiscais existentes; restaure backup em copia autorizada.'; END IF; END $$;
DROP TRIGGER trg_invoice_measurement_integrity ON contract_measurements;
DROP TABLE contract_invoice_links; DROP TABLE contract_invoices;
DROP FUNCTION elo_invoice_integrity(); DROP FUNCTION elo_invoice_lock_validate();
DELETE FROM role_permissions WHERE routine_action_id IN (SELECT a.id FROM routine_actions a JOIN routines r ON r.id=a.routine_id WHERE r.code='notas_fiscais');
DELETE FROM routine_actions WHERE routine_id IN (SELECT id FROM routines WHERE code='notas_fiscais');
DELETE FROM routines WHERE code='notas_fiscais';
UPDATE role_templates SET version=version+1 WHERE code IN ('FIN','GES','APR','CON','AUD');
'''
p=r/'apps/api/alembic/versions/elo_fase4c_0026_notas_fiscais.py'
p.write_text('''"""Notas fiscais vinculadas à execução; sem movimentação financeira adicional."""
from alembic import op
revision='elo_fase4c_0026'
down_revision='elo_fase4bc_0025'
branch_labels=None
depends_on=None
UPGRADE=r"""\n'''+sql+'\n"""\nDOWNGRADE=r"""\n'+down+'\n"""\ndef upgrade():op.execute(UPGRADE)\ndef downgrade():op.execute(DOWNGRADE)\n',encoding='utf-8')
print('Modelos, contratos e migração 0026 criados')

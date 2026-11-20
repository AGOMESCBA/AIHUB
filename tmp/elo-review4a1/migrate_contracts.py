from pathlib import Path
import sys
R=Path('C:/Apps/ELOGESTAO');sys.path.insert(0,str(R/'apps/api'))
from app.models.contracts import (Base,Contract,ContractItem,ContractPolicy,ContractAmendment,ApprovalRound,
                                 ApprovalVote,ContractCommitment,ContractMeasurement,ContractLedger)
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
tables=[c.__table__ for c in [Contract,ContractItem,ContractPolicy,ContractAmendment,ApprovalRound,ApprovalVote,
                            ContractCommitment,ContractMeasurement,ContractLedger]]
sql='\n'.join(str(CreateTable(t).compile(dialect=postgresql.dialect()))+';' for t in tables)
for t in tables:
    name=t.name
    read="customer_id = elo_ctx_customer_id() AND municipal_office_id = ANY(elo_ctx_office_ids())"
    if name not in ('contract_approval_policies','contracts'):
        read+=" AND elo_ctx_mode() = 'office'"
    else:
        read+=" AND elo_ctx_mode() IN ('office','customer_admin')"
    sql+=f'''\nALTER TABLE {name} ENABLE ROW LEVEL SECURITY;
CREATE POLICY elo_contract_read ON {name} FOR SELECT TO elo_app USING ({read});
CREATE POLICY elo_contract_insert ON {name} FOR INSERT TO elo_app WITH CHECK ({read} AND created_by = elo_request_user_id());
GRANT SELECT,INSERT ON {name} TO elo_app;
GRANT USAGE,SELECT ON SEQUENCE {name}_id_seq TO elo_app;
CREATE INDEX ix_{name}_office ON {name}(customer_id,municipal_office_id);
'''
    if name not in ('contract_approval_votes','contract_ledger'):
        sql+=f'''CREATE POLICY elo_contract_update ON {name} FOR UPDATE TO elo_app USING ({read}) WITH CHECK ({read});
GRANT UPDATE ON {name} TO elo_app;
'''
sql+='''
-- Somente itens de rascunho podem ser substituídos; depois da submissão, preserva-se o histórico.
CREATE POLICY elo_contract_item_draft_delete ON contract_items FOR DELETE TO elo_app USING (
    customer_id=elo_ctx_customer_id() AND municipal_office_id=ANY(elo_ctx_office_ids()) AND elo_ctx_mode()='office'
    AND EXISTS(SELECT 1 FROM contracts c WHERE c.id=contract_id AND c.status='pending'));
GRANT DELETE ON contract_items TO elo_app;

CREATE FUNCTION elo_contract_owner_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.customer_id,NEW.municipal_office_id,NEW.created_by,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.municipal_office_id,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Propriedade e autoria imutáveis.' USING ERRCODE='check_violation';
 END IF;
 IF TG_TABLE_NAME <> 'contracts' AND (to_jsonb(NEW)->'contract_id') IS DISTINCT FROM (to_jsonb(OLD)->'contract_id') THEN
   RAISE EXCEPTION 'Contrato imutável.' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION elo_contract_financial_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
DECLARE cid integer; owner_contract contracts%ROWTYPE; committed bigint; realized bigint;
BEGIN
 IF TG_TABLE_NAME='contracts' THEN cid=NEW.id; ELSE cid=NEW.contract_id; END IF;
 SELECT * INTO owner_contract FROM contracts WHERE id=cid FOR UPDATE;
 IF owner_contract.id IS NULL THEN RAISE EXCEPTION 'Contrato inexistente.' USING ERRCODE='check_violation'; END IF;
 IF TG_TABLE_NAME <> 'contracts' AND (NEW.customer_id,NEW.municipal_office_id)
    IS DISTINCT FROM (owner_contract.customer_id,owner_contract.municipal_office_id) THEN
   RAISE EXCEPTION 'Referência fora do contexto.' USING ERRCODE='check_violation';
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO committed FROM contract_commitments WHERE contract_id=cid AND status='active';
 SELECT coalesce(sum(amount_cents),0) INTO realized FROM contract_measurements WHERE contract_id=cid AND status='realized';
 IF committed>owner_contract.limit_cents OR realized>committed THEN
   RAISE EXCEPTION 'Limite financeiro excedido.' USING ERRCODE='check_violation';
 END IF;
 IF EXISTS(SELECT 1 FROM contract_measurements m LEFT JOIN contract_commitments e ON e.id=m.commitment_id
    LEFT JOIN contract_items i ON i.id=m.item_id WHERE m.contract_id=cid AND
    (e.contract_id IS DISTINCT FROM cid OR i.contract_id IS DISTINCT FROM cid)) THEN
   RAISE EXCEPTION 'Item ou empenho de outro contrato.' USING ERRCODE='check_violation';
 END IF;
 IF EXISTS(SELECT 1 FROM contract_commitments e WHERE e.contract_id=cid AND
    (SELECT coalesce(sum(m.amount_cents),0) FROM contract_measurements m WHERE m.commitment_id=e.id AND m.status='realized')
      > CASE WHEN e.status='active' THEN e.amount_cents ELSE 0 END) THEN
   RAISE EXCEPTION 'Saldo do empenho excedido.' USING ERRCODE='check_violation';
 END IF;
 IF EXISTS(SELECT 1 FROM contract_items i WHERE i.contract_id=cid AND
    ((SELECT coalesce(sum(m.quantity),0) FROM contract_measurements m WHERE m.item_id=i.id AND m.status='realized')>i.quantity
    OR (SELECT coalesce(sum(m.amount_cents),0) FROM contract_measurements m WHERE m.item_id=i.id AND m.status='realized')>i.total_cents)) THEN
   RAISE EXCEPTION 'Saldo do item excedido.' USING ERRCODE='check_violation';
 END IF;
 IF TG_TABLE_NAME IN ('contract_measurements','contract_commitments') AND
    (TG_OP='INSERT' OR (TG_TABLE_NAME='contract_measurements' AND to_jsonb(NEW)->>'status'='realized')) THEN
   IF owner_contract.status <> 'approved' OR current_date NOT BETWEEN owner_contract.starts_on AND owner_contract.ends_on THEN
     RAISE EXCEPTION 'Contrato sem aprovação ou fora da vigência.' USING ERRCODE='check_violation';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION elo_contract_owner_immutable(),elo_contract_financial_integrity() FROM PUBLIC;
CREATE FUNCTION elo_contract_execution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='contract_commitments' THEN
   IF (NEW.number,NEW.date,NEW.amount_cents,NEW.authorization_reference,NEW.authorized_by)
      IS DISTINCT FROM (OLD.number,OLD.date,OLD.amount_cents,OLD.authorization_reference,OLD.authorized_by) THEN
   RAISE EXCEPTION 'Empenho autorizado é imutável; cancele e registre outro.' USING ERRCODE='check_violation';
   END IF;
 ELSIF TG_TABLE_NAME='contract_measurements' THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN
   RAISE EXCEPTION 'Medição é imutável; use estorno.' USING ERRCODE='check_violation';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION elo_contract_execution_immutable() FROM PUBLIC;
CREATE TRIGGER trg_contract_commitments_immutable BEFORE UPDATE ON contract_commitments
 FOR EACH ROW EXECUTE FUNCTION elo_contract_execution_immutable();
CREATE TRIGGER trg_contract_measurements_immutable BEFORE UPDATE ON contract_measurements
 FOR EACH ROW EXECUTE FUNCTION elo_contract_execution_immutable();
'''
for t in tables:
    if t.name not in ('contract_approval_votes','contract_ledger'):
        sql+=f'CREATE TRIGGER trg_{t.name}_owner BEFORE UPDATE ON {t.name} FOR EACH ROW EXECUTE FUNCTION elo_contract_owner_immutable();\n'
    if t.name in ('contracts','contract_items','contract_commitments','contract_measurements'):
        sql+=f'CREATE TRIGGER trg_{t.name}_financial AFTER INSERT OR UPDATE ON {t.name} FOR EACH ROW EXECUTE FUNCTION elo_contract_financial_integrity();\n'
sql+='''
UPDATE resource_definitions SET allowed_modes=ARRAY['office']::varchar[],default_mode='office',configurable=false
 WHERE code='contracts';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resource_sharing_policies WHERE resource_code='contracts' AND mode<>'office') THEN
  RAISE EXCEPTION 'Classificar política de contratos existente antes da migração.';
 END IF;
END $$;
INSERT INTO routines(name,code,module_id) SELECT 'Alçadas contratuais','config.alcadas',module_id FROM routines
 WHERE code='config.concessoes' ON CONFLICT(code) DO NOTHING;
INSERT INTO routines(name,code,module_id) SELECT 'Medições','medicoes',module_id FROM routines
 WHERE code='saldos' ON CONFLICT(code) DO NOTHING;
'''
actions=[('config.alcadas','consultar','ORG-ADM'),('config.alcadas','alterar','ORG-ADM'),('contratos','aprovar','APR'),
         ('medicoes','consultar','GES'),('medicoes','consultar','FIN'),('medicoes','consultar','APR'),
         ('medicoes','consultar','CON'),('medicoes','consultar','AUD'),('medicoes','incluir','FIN')]
for routine,action,role in actions:
    sql+=f'''INSERT INTO routine_actions(routine_id,action_code,audience,enabled)
 SELECT id,'{action}','internal',true FROM routines WHERE code='{routine}' ON CONFLICT(routine_id,action_code) DO NOTHING;
INSERT INTO role_permissions(role_id,routine_action_id)
 SELECT rt.id,ra.id FROM role_templates rt,routine_actions ra JOIN routines r ON r.id=ra.routine_id
 WHERE rt.code='{role}' AND r.code='{routine}' AND ra.action_code='{action}' ON CONFLICT DO NOTHING;
'''
sql+="UPDATE role_templates SET version=version+1 WHERE code IN ('ORG-ADM','GES','FIN','APR','CON','AUD');\n"
down='''DO $$ BEGIN IF EXISTS(SELECT 1 FROM contracts) THEN
 RAISE EXCEPTION 'reversao_com_dados: contratos existentes; restaure backup em cópia autorizada.'; END IF; END $$;
'''
for t in reversed(tables):down+=f'DROP TABLE {t.name};\n'
down+='DROP FUNCTION elo_contract_owner_immutable(); DROP FUNCTION elo_contract_financial_integrity(); DROP FUNCTION elo_contract_execution_immutable();\n'
# Privilégios adicionados são removidos junto com as novas ações; preserva-se o catálogo original.
down+='''DELETE FROM role_permissions WHERE routine_action_id IN (SELECT ra.id FROM routine_actions ra JOIN routines r ON r.id=ra.routine_id
 WHERE r.code IN ('config.alcadas','medicoes') OR (r.code='contratos' AND ra.action_code='aprovar'));
DELETE FROM routine_actions WHERE routine_id IN(SELECT id FROM routines WHERE code IN ('config.alcadas','medicoes'))
 OR (routine_id=(SELECT id FROM routines WHERE code='contratos') AND action_code='aprovar');
DELETE FROM routines WHERE code IN ('config.alcadas','medicoes');
UPDATE resource_definitions SET allowed_modes=ARRAY['office','customer']::varchar[],configurable=true WHERE code='contracts';
UPDATE role_templates SET version=version+1 WHERE code IN ('ORG-ADM','GES','FIN','APR','CON','AUD');
'''
p=R/'apps/api/alembic/versions/elo_fase4bc_0025_contratos.py'
assert p.name=='elo_fase4bc_0025_contratos.py'
p.write_text('''"""Contratos exclusivos, aprovação por níveis e execução contratual (4B/4C).

Sem importação do legado. Sem alteração de políticas existentes fora de contratos.
Reversão recusada com contratos. Alçadas não são semeadas: sem cadastro, submissão recusada.
"""
from alembic import op
revision="elo_fase4bc_0025"
down_revision="elo_fase4a_0024"
branch_labels=None
depends_on=None
UPGRADE=r"""
'''+sql+'''
"""
DOWNGRADE=r"""
'''+down+'''
"""
def upgrade():op.execute(UPGRADE)
def downgrade():op.execute(DOWNGRADE)
''',encoding='utf-8')
print('Migração aditiva gerada; nenhuma migração executada.')

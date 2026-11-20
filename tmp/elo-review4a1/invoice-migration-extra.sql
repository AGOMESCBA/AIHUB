CREATE FUNCTION elo_invoice_lock_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contracts; mid integer;
BEGIN
 SELECT * INTO c FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF TG_TABLE_NAME='contract_invoices' THEN
  IF NEW.supplier_id IS DISTINCT FROM c.supplier_id OR NEW.issued_on>current_date THEN
   RAISE EXCEPTION 'invoice_reference_invalid' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'registered' OR c.status NOT IN ('approved','suspended','closed')) THEN
   RAISE EXCEPTION 'invoice_state_invalid' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','cancel_reason','cancelled_by','cancelled_at','version','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancel_reason','cancelled_by','cancelled_at','version','updated_at'])
      OR OLD.status<>'registered' OR NEW.status<>'cancelled') THEN
   RAISE EXCEPTION 'invoice_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_lock BEFORE INSERT OR UPDATE ON contract_invoices FOR EACH ROW EXECUTE FUNCTION elo_invoice_lock_validate();
CREATE TRIGGER trg_invoice_link_lock BEFORE INSERT ON contract_invoice_links FOR EACH ROW EXECUTE FUNCTION elo_invoice_lock_validate();

CREATE FUNCTION elo_invoice_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer; bad boolean;
BEGIN
 cid=NEW.contract_id;
 PERFORM 1 FROM contracts WHERE id=cid FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM contract_invoices i LEFT JOIN contract_invoice_links l ON l.invoice_id=i.id
   WHERE i.contract_id=cid AND i.status='registered' GROUP BY i.id HAVING coalesce(sum(l.amount_cents),0)<>i.amount_cents) INTO bad;
 IF bad THEN RAISE EXCEPTION 'invoice_total_mismatch' USING ERRCODE='23514'; END IF;
 SELECT EXISTS(SELECT 1 FROM contract_invoice_links l JOIN contract_invoices i ON i.id=l.invoice_id
   JOIN contract_measurements m ON m.id=l.measurement_id WHERE i.contract_id=cid AND i.status='registered'
   GROUP BY m.id HAVING m.status<>'realized' OR sum(l.amount_cents)>m.amount_cents) INTO bad;
 IF bad THEN RAISE EXCEPTION 'invoice_measurement_exceeded_or_reversed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER trg_invoice_integrity AFTER INSERT OR UPDATE ON contract_invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION elo_invoice_integrity();
CREATE CONSTRAINT TRIGGER trg_invoice_link_integrity AFTER INSERT ON contract_invoice_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION elo_invoice_integrity();
CREATE CONSTRAINT TRIGGER trg_invoice_measurement_integrity AFTER UPDATE ON contract_measurements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION elo_invoice_integrity();

INSERT INTO routines(name,code,module_id) SELECT 'Notas fiscais','notas_fiscais',module_id FROM routines WHERE code='medicoes' ON CONFLICT(code) DO NOTHING;
INSERT INTO routine_actions(routine_id,action_code,audience,enabled)
 SELECT r.id,a,'internal',true FROM routines r CROSS JOIN unnest(ARRAY['consultar','incluir','cancelar']) a WHERE r.code='notas_fiscais' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,routine_action_id)
 SELECT rt.id,a.id FROM role_templates rt CROSS JOIN routine_actions a JOIN routines r ON r.id=a.routine_id
 WHERE r.code='notas_fiscais' AND ((a.action_code='consultar' AND rt.code IN ('FIN','GES','APR','CON','AUD')) OR (a.action_code IN ('incluir','cancelar') AND rt.code='FIN')) ON CONFLICT DO NOTHING;
UPDATE role_templates SET version=version+1 WHERE code IN ('FIN','GES','APR','CON','AUD');

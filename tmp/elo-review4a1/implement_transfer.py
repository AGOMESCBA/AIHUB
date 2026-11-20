from pathlib import Path
import importlib.util

ROOT=Path('C:/Apps/ELOGESTAO')
def put(name, value):
    p=ROOT/name
    p.write_text(value,encoding='utf-8',newline='\n')
def change(name, old, new):
    p=ROOT/name
    s=p.read_text(encoding='utf-8-sig')
    assert s.count(old)==1, (name,old)
    put(name,s.replace(old,new))

previous=ROOT/'apps/api/alembic/versions/elo_fase4a_0022_veiculos.py'
spec=importlib.util.spec_from_file_location('previous',previous)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
old_trigger=module.UPGRADE.split('CREATE FUNCTION elo_vehicles_validate()',1)[1].split('CREATE TRIGGER trg_vehicles_validate',1)[0]
old_trigger='CREATE OR REPLACE FUNCTION elo_vehicles_validate()'+old_trigger
new_trigger=old_trigger.replace('NEW.customer_id, NEW.municipal_office_id, NEW.created_by','NEW.customer_id, NEW.created_by').replace('OLD.customer_id, OLD.municipal_office_id, OLD.created_by','OLD.customer_id, OLD.created_by')

sql=r'''
-- Apenas a função SECURITY DEFINER do dono pode mudar a secretaria. A aplicação não recebe UPDATE dessa coluna.
CREATE FUNCTION elo_vehicle_lotation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.municipal_office_id IS DISTINCT FROM OLD.municipal_office_id
    AND current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN
   RAISE EXCEPTION 'Lotação muda somente pelo comando de transferência.' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_vehicle_lotation_guard BEFORE UPDATE ON vehicles
 FOR EACH ROW EXECUTE FUNCTION elo_vehicle_lotation_guard();

CREATE FUNCTION elo_vehicle_transfer(p_id integer, p_version integer, p_target integer, p_fleet integer,
 p_model integer, p_department integer, p_reason text, p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 c integer := elo_ctx_customer_id();
 offices integer[] := elo_ctx_office_ids();
 actor integer;
 v public.vehicles%ROWTYPE;
 model record;
 event jsonb;
 office integer;
 sid uuid := nullif(current_setting('elo.session_id',true),'')::uuid;
BEGIN
 IF c IS NULL OR elo_ctx_mode() IS DISTINCT FROM 'office' OR cardinality(offices) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'Contexto inválido.' USING ERRCODE='EL403';
 END IF;
 PERFORM pg_advisory_xact_lock(3401,c);
 SELECT * INTO v FROM public.vehicles WHERE id=p_id AND customer_id=c AND municipal_office_id=offices[1] FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.' USING ERRCODE='EL404'; END IF;
 actor := elo_request_user_id();
 -- O helper interno da 0015 resolve ações e abrangência; com scope NULL não há regra específica de fornecedor.
 IF actor IS NULL OR NOT elo_supplier_action_allowed(c,actor,offices[1],'cad.veiculos.consultar',NULL,NULL,NULL)
    OR NOT elo_supplier_action_allowed(c,actor,offices[1],'cad.veiculos.transferir_lotacao',NULL,NULL,NULL)
    OR NOT elo_supplier_action_allowed(c,actor,p_target,'cad.veiculos.consultar',NULL,NULL,NULL)
    OR NOT elo_supplier_action_allowed(c,actor,p_target,'cad.veiculos.transferir_lotacao',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Transferência não autorizada.' USING ERRCODE='EL403';
 END IF;
 IF v.version <> p_version THEN RAISE EXCEPTION 'Versão desatualizada.' USING ERRCODE='EL412'; END IF;
 IF p_target=offices[1] OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 THEN
   RAISE EXCEPTION 'Destino ou motivo inválido.' USING ERRCODE='EL422';
 END IF;
 IF v.driver_using IS NOT NULL OR coalesce(v.balance_in_cents,0)<>0 THEN
   RAISE EXCEPTION 'Ocupação ou saldo legado exige regularização.' USING ERRCODE='EL409';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.vehicle_fleets WHERE id=p_fleet AND customer_id=c
                AND municipal_office_id=p_target AND status='active') THEN
   RAISE EXCEPTION 'Frota de destino inválida.' USING ERRCODE='EL422';
 END IF;
 SELECT m.*, cat.status AS category_status INTO model FROM public.vehicle_models m
 JOIN public.vehicle_model_categories cat ON cat.id=m.category_id WHERE m.id=p_model;
 IF NOT FOUND OR model.status<>'active' OR model.category_status<>'active'
    OR (model.owner_kind='customer' AND (model.customer_id<>c OR
        (model.scope_mode='office' AND model.municipal_office_id<>p_target))) THEN
   RAISE EXCEPTION 'Modelo incompatível com o destino.' USING ERRCODE='EL422';
 END IF;
 IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments WHERE id=p_department
    AND customer_id=c AND deleted_at IS NULL AND (municipal_office_id IS NULL OR municipal_office_id=p_target)) THEN
   RAISE EXCEPTION 'Departamento incompatível com o destino.' USING ERRCODE='EL422';
 END IF;
 UPDATE public.vehicles SET municipal_office_id=p_target, vehicle_fleet_id=p_fleet, model_id=p_model,
   department_id=p_department, version=version+1, updated_at=clock_timestamp() WHERE id=p_id;
 event := jsonb_build_object('vehicle_id',p_id,'version',v.version+1,'actor_user_id',actor,
   'occurred_at',clock_timestamp(),'reason',btrim(p_reason),
   'source',jsonb_build_object('office_id',v.municipal_office_id,'fleet_id',v.vehicle_fleet_id,
          'model_id',v.model_id,'department_id',v.department_id),
   'target',jsonb_build_object('office_id',p_target,'fleet_id',p_fleet,'model_id',p_model,'department_id',p_department));
 -- Um evento imutável para cada secretaria: a consulta de auditoria não depende de abranger as duas.
 FOREACH office IN ARRAY ARRAY[v.municipal_office_id,p_target] LOOP
   INSERT INTO public.audit_events(customer_id,actor_user_id,actor_session_id,action,object_type,object_id,
      result,request_id,details,scope_kind,scope_office_ids)
   VALUES(c,actor,sid,'cad.veiculos.transferir_lotacao','vehicles',p_id::text,'success',p_request,event,'offices',ARRAY[office]);
 END LOOP;
 RETURN event;
END $$;
REVOKE ALL ON FUNCTION elo_vehicle_transfer(integer,integer,integer,integer,integer,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION elo_vehicle_transfer(integer,integer,integer,integer,integer,integer,text,text) TO elo_app;
'''
put('apps/api/alembic/versions/elo_fase4a_0023_transferencia_de_lotacao.py',
    '"""Transferência de lotação com autorização nas duas secretarias e histórico em audit_events."""\nfrom alembic import op\n\nrevision="elo_fase4a_0023"\ndown_revision="elo_fase4a_0022"\nbranch_labels=None\ndepends_on=None\n\nUPGRADE='+repr(new_trigger+sql)+'\n\nDOWNGRADE='+repr("DROP FUNCTION elo_vehicle_transfer(integer,integer,integer,integer,integer,integer,text,text);\nDROP TRIGGER trg_vehicle_lotation_guard ON vehicles;\nDROP FUNCTION elo_vehicle_lotation_guard();\n"+old_trigger)+'\n\ndef upgrade():\n    op.execute(UPGRADE)\n\ndef downgrade():\n    op.execute(DOWNGRADE)\n')

put('apps/api/app/routers/vehicle_transfers.py','''"""Transferência de veículos entre secretarias do mesmo órgão; consulta não amplia o contexto operacional."""
import json
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import or_, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from ..dependencies import get_db_session
from ..models.definitions import MunicipalOffice, VehicleFleet, VehicleModel, VehicleModelCategory, Department
from ..security.context import OrgContext, org_context
from ..security.transaction import use_role
from ..security.problems import Problem, current_request_id
from ..services import operational
from ..services.audit import deny
from ..services.http_contract import claim, etag, require_if_match, respond, Page, page_params, paginated
from .vehicles import _visible

router=APIRouter(prefix="/vehicles",tags=["Transferências de veículos"])
ACTION="cad.veiculos.transferir_lotacao"
READ="cad.veiculos.consultar"

class VehicleTransfer(BaseModel):
    model_config=ConfigDict(extra="forbid")
    target_office_id: int=Field(gt=0)
    target_fleet_id: int=Field(gt=0)
    target_model_id: int=Field(gt=0)
    target_department_id: int | None=Field(...,gt=0)
    reason: Annotated[str,StringConstraints(strip_whitespace=True,min_length=10,max_length=500)]

def allowed(context,office):
    return context.profile.allows(ACTION,office) and context.profile.allows(READ,office)

@router.get("/{vehicle_id}/transfer-options")
def options(vehicle_id:int,target_office_id:int | None=Query(None,gt=0),q:str=Query("",max_length=120),
            db:Session=Depends(get_db_session),context:OrgContext=Depends(org_context)):
    source=operational.require_action(context,READ)
    operational.require_action(context,ACTION)
    if not _visible(db,context,source).filter_by(id=vehicle_id).first():
        raise Problem(404,"NOT_FOUND")
    destinations=sorted(o for o in context.profile.active_offices if o!=source and allowed(context,o))
    if target_office_id is not None and target_office_id not in destinations:
        raise Problem(403,"ACTION_FORBIDDEN")
    # Somente seletores mínimos, depois de conferir as duas ações em cada destino; nunca lista veículos de outras abas.
    use_role(db,"elo_app",{"elo.customer_id":str(context.customer_id),"elo.context_mode":"office",
                          "elo.office_ids":",".join(map(str,[source,*destinations]))})
    offices=db.query(MunicipalOffice).filter(MunicipalOffice.id.in_(destinations)).order_by(MunicipalOffice.name).all()
    result={"offices":[{"id":o.id,"name":o.name} for o in offices],"fleets":[],"models":[],"departments":[]}
    if target_office_id is None:
        return result
    fleets=db.query(VehicleFleet).filter_by(customer_id=context.customer_id,municipal_office_id=target_office_id,status="active")
    models=db.query(VehicleModel).join(VehicleModelCategory).filter(VehicleModel.status=="active",VehicleModelCategory.status=="active",
        or_(VehicleModel.owner_kind=="platform",(VehicleModel.customer_id==context.customer_id) &
            ((VehicleModel.scope_mode=="customer") | (VehicleModel.municipal_office_id==target_office_id))))
    departments=db.query(Department).filter(Department.customer_id==context.customer_id,Department.deleted_at.is_(None),
        or_(Department.municipal_office_id.is_(None),Department.municipal_office_id==target_office_id))
    for name,query,model in (("fleets",fleets,VehicleFleet),("models",models,VehicleModel),("departments",departments,Department)):
        if q.strip():
            query=query.filter(model.name.ilike(operational.like(q.strip())))
        rows=query.order_by(model.name,model.id).limit(101).all()
        result[name]=[{"id":r.id,"name":r.name} for r in rows[:100]]
        result[name+"_has_more"]=len(rows)>100
    return result

@router.post("/{vehicle_id}/transfer")
def transfer(vehicle_id:int,body:VehicleTransfer,request:Request,db:Session=Depends(get_db_session),
             context:OrgContext=Depends(org_context)):
    source=operational.require_action(context,READ)
    context=operational.current(db,context,READ)
    audit=dict(action=ACTION,actor_user_id=context.user_id,customer_id=context.customer_id,
               object_type="vehicles",object_id=vehicle_id)
    if not allowed(context,source) or not allowed(context,body.target_office_id):
        deny(db,Problem(403,"ACTION_FORBIDDEN"),**audit)
    if source==body.target_office_id:
        raise Problem(422,"VALIDATION_FAILED","Escolha outra secretaria.")
    claimed=claim(db,request,user_id=context.user_id,customer_id=context.customer_id,body=body.model_dump(mode="json"))
    if claimed.replay:
        return claimed.replay
    row=_visible(db,context,source).filter_by(id=vehicle_id).with_for_update().populate_existing().first()
    if row is None:
        raise Problem(404,"NOT_FOUND")
    require_if_match(request,row.version)
    try:
        with db.begin_nested():
            receipt=db.execute(text("SELECT elo_vehicle_transfer(:id,:version,:office,:fleet,:model,:department,:reason,:request)"),
                dict(id=vehicle_id,version=row.version,office=body.target_office_id,fleet=body.target_fleet_id,
                     model=body.target_model_id,department=body.target_department_id,reason=body.reason,request=current_request_id())).scalar_one()
    except DBAPIError as error:
        status={"EL403":403,"EL404":404,"EL412":412,"EL422":422,"EL409":409}.get(getattr(error.orig,"sqlstate",None))
        if status is None:
            raise
        deny(db,Problem(status,"VEHICLE_TRANSFER_BLOCKED","Transferência recusada: confira autorização, destino, ocupação e saldo legado."),**audit)
    return respond(db,200,receipt,headers={"ETag":etag(receipt["version"])},claimed=claimed)

@router.get("/{vehicle_id}/transfers")
def history(vehicle_id:int,page:Page=Depends(page_params),db:Session=Depends(get_db_session),
            context:OrgContext=Depends(org_context)):
    office=operational.require_action(context,READ)
    params=dict(customer=context.customer_id,office=office,vehicle=str(vehicle_id),limit=page.per_page,offset=page.offset)
    condition="customer_id=:customer AND action='cad.veiculos.transferir_lotacao' AND result='success' AND object_type='vehicles' AND object_id=:vehicle AND scope_kind='offices' AND scope_office_ids=ARRAY[CAST(:office AS integer)]"
    total=db.execute(text("SELECT count(*) FROM audit_events WHERE "+condition),params).scalar_one()
    rows=db.execute(text("SELECT details FROM audit_events WHERE "+condition+" ORDER BY occurred_at DESC,id DESC LIMIT :limit OFFSET :offset"),params).scalars().all()
    return paginated(rows,total,page)
''')
change('apps/api/app/main.py','vehicle_fleets, vehicle_models, vehicles,','vehicle_fleets, vehicle_models, vehicles, vehicle_transfers,')
change('apps/api/app/main.py','products.router, routines.router, users.router, vehicles.router, vehicle_models.router,','products.router, routines.router, users.router, vehicles.router, vehicle_models.router, vehicle_transfers.router,')
change('apps/api/app/security/guard.py','    ("GET", r"/vehicles/export"),','    ("GET", r"/vehicles/export"),\n    ("GET", rf"/vehicles{_ID}/transfer-options"),\n    ("GET", rf"/vehicles{_ID}/transfers"),\n    ("POST", rf"/vehicles{_ID}/transfer"),')
change('apps/backoffice/src/lib/api-routes.ts',"  route(['GET'], 'vehicles/export'),","  route(['GET'], 'vehicles/export'),\n  route(['GET'], `vehicles/${ID}/transfer-options`),\n  route(['GET'], `vehicles/${ID}/transfers`),\n  route(['POST'], `vehicles/${ID}/transfer`),")
print('Transferência: migração, API e guardas implementadas.')

from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
s=(r/'tools/dev/browser-e2e-38.cjs').read_text(encoding='utf-8').split('const withoutSecrets =')[0]
s=s.replace("path.resolve(__dirname, '../..')", "'C:/Apps/ELOGESTAO'").replace("process.env.ELO_BROWSER_WEB || 'http://localhost:3003'", "'http://localhost:3006'").replace('300[1235]', '300[12356]').replace('.local/logs/browser-38', '.local/logs/lotacao-browser')
s+='''
const seed = JSON.parse(fs.readFileSync(path.join(root, '.local/lotacao-e2e.json'), 'utf8'));
const select = async (p,n,value) => p.eval(`(() => { const e=[...document.querySelectorAll('[role=tabpanel]:not([hidden]) select')][${n}]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(String(value))}); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
(async()=>{
 const b=new Browser(); let p;
 try {
  await b.start();p=await b.tab(await b.context());await p.login(seed);await p.choose(ORG_A,A1);
  const headers={'X-Elo-Customer-Id':String(seed.customer_id),'X-Elo-Municipal-Office-Id':String(seed.source_office_id)};
  const asset='LOTE-'+Date.now();
  const created=await p.api('/vehicles','POST',{asset_number:asset,model_id:seed.model_id,vehicle_fleet_id:seed.source_fleet_id,fuel_type_ids:[]},{...headers,'Idempotency-Key':asset});
  check('Cadastro sintético para transferência',created.status===201||created.status===200,created.status);
  if(!created.body?.id) throw new Error('Cadastro não retornou identificador');
  const id=created.body.id;
  await p.go('/app/vehicle/'+id);
  if(!await p.waitText('Transferir lotação',15000)) throw new Error('Rotina não abriu: '+await p.path());
  check('Ação disponível ao gestor das duas secretarias',true);
  await p.clickWithin('[role=tabpanel]:not([hidden])','Transferir lotação');
  await p.waitText('Secretaria de destino');await select(p,0,seed.target_office_id);
  if(!await p.waitFor(`!!document.querySelector('[role=tabpanel]:not([hidden]) select:nth-of-type(1)') && document.body.innerText.includes('Frota ativa de destino')`,10000))throw new Error('Destino sem referências');
  await p.waitFor(`[...document.querySelectorAll('[role=tabpanel]:not([hidden]) select')][1]?.querySelector('option[value="${seed.target_fleet_id}"]')`);
  await select(p,1,seed.target_fleet_id);await select(p,2,seed.model_id);
  const reason='Transferência sintética pelo navegador';
  await p.fill(p.inPanel('input[name=motivo_transferencia]'),reason);
  check('Formulário permite confirmar destino compatível',await p.clickWithin('[role=tabpanel]:not([hidden])','Confirmar transferência'));
  check('Comprovante permanece visível após transferência',await p.waitText('Transferência concluída',15000));
  const old=await p.api('/vehicles/'+id,'GET',null,headers);
  const targetHeaders={...headers,'X-Elo-Municipal-Office-Id':String(seed.target_office_id)};
  const moved=await p.api('/vehicles/'+id,'GET',null,targetHeaders);
  check('Origem deixa de consultar o veículo transferido',old.status===404,old.status);
  check('Destino consulta o mesmo veículo',moved.status===200&&moved.body.id===id,moved.status);
  const history=await p.api('/vehicles/'+id+'/transfers','GET',null,targetHeaders);
  check('Histórico do destino registra a justificativa',history.body?.items?.some(e=>e.reason===reason),history.status);
  check('Comprovante cabe em 390 px',await p.shot('comprovante',true));
  await p.choose(ORG_A,A2);await p.go('/app/vehicle/'+id);await p.waitText('Transferir lotação');
  await p.fill(p.inPanel('input[name=color]'),'Rascunho');
  check('Edição pendente bloqueia transferência',await p.waitFor(`[...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].some(b=>b.innerText.includes('Transferir lotação')&&b.disabled)`));
  await p.shot('edicao-pendente');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({vehicle_id:id,checks:results},null,2));
  console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);
  if(results.some(r=>!r.ok))process.exitCode=1;
 } catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});process.exitCode=1;}
 finally{await b.stop().catch(()=>{});}
})();
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/transfer-browser.cjs').write_text(s,encoding='utf-8')

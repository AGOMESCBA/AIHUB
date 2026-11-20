from pathlib import Path
base=Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-browser.cjs').read_text(encoding='utf-8')
head=base.split('(async()=>{const b=new Browser();let p,q,cid;')[0]
head+=r'''
(async()=>{const b=new Browser();let p;
try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);
 const previous=JSON.parse(fs.readFileSync(path.join(out,'failure.json'),'utf8'));const cid=previous.contract_id;if(!cid)throw new Error('Contrato anterior não identificado');
 let current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);const contractNumber=current.number;
 const url=`/app/orgaos/${city.id}/secretarias/${office.id}/contratos/${cid}`;
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/novo`);await must(p,'Registrar empenho autorizado');await pick(p,'Contrato vigente',contractNumber,cid);await p.fill(S+' input[name=number]','EMP-'+stamp);await p.fill(S+' input[name=amount]','800,00');await p.fill(S+' input[name=reference]','Autorização contábil sintética');await p.fill(S+' input[name=responsible]','Responsável de testes');
 await p.waitFor(`[...document.querySelectorAll(${JSON.stringify(S+' button')})].some(b=>b.textContent==='Registrar'&&!b.disabled)`);
 if(!await p.clickWithin(S,'Registrar'))throw new Error('Botão Registrar não acionado');
 await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Empenho pela tela reserva somente o limite contratual',current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 const emp=current.commitments.at(-1).id,item=current.items[0].id;
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/medicoes/novo`);await must(p,'Registrar medição');await pick(p,'Contrato vigente',contractNumber,cid);await until(async()=>await p.eval(`document.querySelectorAll(${JSON.stringify(S+' select option')}).length>2`));await select(p,'Empenho',emp);await select(p,'Item contratado',item);await p.fill(S+' input[name=quantity]','30');await p.fill(S+' input[name=reference]','Ateste de execução sintético');await p.fill(S+' input[name=responsible]','Fiscal de testes');await p.waitFor(`[...document.querySelectorAll(${JSON.stringify(S+' button')})].some(b=>b.textContent==='Registrar'&&!b.disabled)`);if(!await p.clickWithin(S,'Registrar'))throw new Error('Botão Registrar medição não acionado');await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Medição pela tela realiza sem nova alçada nem desconto duplicado',current.balance.realized_cents===30000&&current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 await p.go(url);await must(p,'Disponível para empenhar');await p.shot('monitor');check('Monitor responsivo sem rolagem horizontal de página',await p.shot('monitor',true));
 const other=demo.customers.find(c=>c.name==='Sinop');const r=await p.api('/contracts/'+cid,'GET',null,{'X-Elo-Customer-Id':String(other.id),'X-Elo-Municipal-Office-Id':String(other.offices[0].id)});check('Contrato de Cuiabá invisível em Sinop',r.status===404);
 const prior=previous.results;const all=[...prior,...results];fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results:all,contract_id:cid,number:contractNumber,commitment_id:emp,measurement_id:current.measurements.at(-1).id,note:'Quatro cenários iniciais preservados; só os quatro finais foram executados de novo após corrigir a espera pelo botão no roteiro.'},null,2));console.log('TOTAL final '+all.filter(r=>r.ok).length+'/'+all.length);if(all.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);if(p)await p.shot('falha-execucao').catch(()=>{});fs.writeFileSync(path.join(out,'failure-execucao.json'),JSON.stringify({results,error:e.message},null,2));process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-finance-browser.cjs').write_text(head,encoding='utf-8')

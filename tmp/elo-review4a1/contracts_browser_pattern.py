from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-browser.cjs');s=p.read_text(encoding='utf-8');s=s[:s.index('(async()=>{const b=new Browser();let p,q,cid;')]
s+='''(async()=>{const b=new Browser();let p;
try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);await p.openRoutine('ope.contratos');await must(p,'Cadastrar contrato');
 const tabs=await p.eval('document.querySelectorAll("[role=tab]").length');
 await p.clickWithin(S,'Cadastrar contrato');await must(p,'Novo contrato');check('Inclusão usa a própria aba',await p.eval('document.querySelectorAll("[role=tab]").length')===tabs);
 await p.waitFor(`[...document.querySelectorAll(${JSON.stringify(S+' button')})].some(b=>b.textContent==='Cancelar')`);if(!await p.clickWithin(S,'Cancelar'))throw new Error('Cancelar ausente');await must(p,'Cadastrar contrato');check('Cancelar retorna à GRID',await p.eval(`!!document.querySelector(${JSON.stringify(S+' table')})`));
 const source=good(await p.api('/contracts/1','GET',null,headers),200);const supplier=good(await p.api('/suppliers/'+source.supplier_id,'GET',null,headers),200);const product=good(await p.api('/products/'+source.items[0].product_id,'GET',null,headers),200);
 await p.clickWithin(S,'Cadastrar contrato');await must(p,'Novo contrato');await p.fill(S+' input[name=number]','PADRAO-'+stamp);await p.fill(S+' input[name=description]','Conferência do retorno à lista');await pick(p,'Fornecedor',supplier.company_name,supplier.id);await pick(p,'Produto 1',product.code,product.id);await p.fill(S+' input[name="quantity-0"]','1');await p.fill(S+' input[name="price-0"]','10,00');await p.clickWithin(S,'Salvar contrato');await must(p,'Operação concluída: registro salvo.');
 check('Salvar retorna à GRID sem criar aba',await p.eval(`!!document.querySelector(${JSON.stringify(S+' table')})&&document.querySelectorAll('[role=tab]').length===${tabs}`));await p.shot('grid-padrao-final');
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/contratos/1`);await must(p,'Disponível para empenhar');await p.shot('monitor-final');
 fs.writeFileSync(path.join(out,'pattern-result.json'),JSON.stringify({results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);if(p)await p.shot('falha-padrao').catch(()=>{});process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
p.with_name('contracts-pattern-browser.cjs').write_text(s,encoding='utf-8')

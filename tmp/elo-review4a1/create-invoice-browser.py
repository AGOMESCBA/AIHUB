from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1')
s=(p/'contracts-primary-browser.cjs').read_text(encoding='utf-8').split('(async()=>{const b=new Browser();let p;')[0]
s=s.replace("await must(p,'Seu trabalho, organizado.');", "await must(p,'Área de trabalho');")
s+=r'''(async()=>{const b=new Browser();let p;try{
await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);
await p.waitFor(`document.querySelector('nav[aria-label="Rotinas autorizadas"] button[data-routine="ope.notas_fiscais"]')`);
check('Notas fiscais aparece no menu e nos cards contratuais',await p.eval(`!!document.querySelector('nav[aria-label="Rotinas autorizadas"] button[data-routine="ope.notas_fiscais"]')&&[...document.querySelectorAll('section button')].some(b=>b.textContent.includes('Notas fiscais'))`));
const c=good(await p.api('/contracts/1','GET',null,headers),200);const before=c.balance;
const opts=good(await p.api('/contract_invoices/measurement-options?contract_id=1','GET',null,headers),200);const m=opts.items.find(m=>m.available_cents>=1000);if(!m)throw new Error('Sem medição sintética disponível para exemplo');
const number=Date.now().toString();await p.openRoutine('ope.notas_fiscais');await p.clickWithin(S,'Registrar nota fiscal');await must(p,'Tipo de documento');await pick(p,'Contrato',c.number,c.id);await must(p,'Vincular medições realizadas');
check('Cadastro apresenta Orçado, Empenhado e Realizado',await p.eval(`(()=>{const t=document.querySelector(${JSON.stringify(S)}).textContent;return ['Orçado','Empenhado','Realizado'].every(v=>t.includes(v));})()`));
await p.fill(S+' input[name=invoice_number]',number);await p.fill(S+' input[name=invoice_amount]','10,00');await p.fill(S+' input[name=invoice_notes]','Documento exclusivamente sintético para avaliação local de notas fiscais.');await p.fill(S+` input[name=invoice_allocation_${m.id}]`,'10,00');
check('Ação de registrar fica acima dos campos',await p.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(S+' button')})].find(b=>b.textContent.trim()==='Registrar nota fiscal');return b.getBoundingClientRect().top<document.querySelector(${JSON.stringify(S+' input[name=invoice_number]')}).getBoundingClientRect().top;})()`));
await p.clickWithin(S,'Registrar nota fiscal');await must(p,'Consultar nota');
const list=good(await p.api('/contract_invoices/?q='+number,'GET',null,headers),200);if(list.total!==1)throw new Error('Nota não localizada após salvar');const invoice=list.items[0];check('Nota registrada pela tela e apresentada na grid',invoice.number===number&&invoice.amount_cents===1000);
const after=good(await p.api('/contracts/1','GET',null,headers),200);check('Orçado, Empenhado e Realizado preservados',JSON.stringify(before)===JSON.stringify(after.balance));
await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/notas-fiscais/${invoice.id}`);await must(p,'Rastreabilidade');check('Consulta mostra contrato, empenho, medição e histórico',await p.eval(`(()=>{const t=document.querySelector(${JSON.stringify(S)}).textContent;return [${JSON.stringify(c.number)},${JSON.stringify(m.commitment_number)},'Rastreabilidade','Valor vinculado'].every(v=>t.includes(v));})()`));
check('Cancelamento exige justificativa',await p.eval(`!![...document.querySelectorAll(${JSON.stringify(S+' button')})].find(b=>b.textContent.trim()==='Cancelar registro'&&b.disabled)`));
check('Desktop sem transbordamento',await p.shot('nota-fiscal-detalhe'));
await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check('Celular sem transbordamento',await p.shot('nota-fiscal-celular'));await p.desktop();
await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/${m.commitment_id}`);await must(p,'Notas fiscais vinculadas');await must(p,number);check('Empenho exibe a nota vinculada',true);
const duplicate=await p.api('/contract_invoices/','POST',{contract_id:1,document_type:'nfse',number,series:'',issued_on:invoice.issued_on,amount_cents:1000,allocations:[{measurement_id:m.id,amount_cents:1000}]},{...headers,'If-Match':`"v${after.version}"`,'Idempotency-Key':crypto.randomUUID()});check('Documento repetido recusado pela API',duplicate.status===409&&duplicate.body.code==='INVOICE_DUPLICATE');
fs.writeFileSync(path.join(root,'.local/invoice-example.json'),JSON.stringify({id:invoice.id,number,contract_id:1,amount_cents:1000,measurement_id:m.id,balance_before:before,balance_after:after.balance},null,2));fs.writeFileSync(path.join(out,'invoices-result.json'),JSON.stringify({results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.stack);if(p)await p.shot('falha-notas-fiscais').catch(()=>{});process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
(p/'invoices-browser.cjs').write_text(s,encoding='utf-8')

from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
s=(R/'tools/dev/browser-e2e-38.cjs').read_text(encoding='utf-8').split('const withoutSecrets =')[0]
s=s.replace("path.resolve(__dirname, '../..')","'C:/Apps/ELOGESTAO'")
s=s.replace("process.env.ELO_BROWSER_WEB || 'http://localhost:3003'","'http://localhost:3008'")
s=s.replace('process.env.ELO_BROWSER_API || access.api',"'http://127.0.0.1:8013'").replace('300[1-6]','300[1-8]').replace('801[02]','801[023]')
s=s.replace('.local/logs/browser-38','.local/logs/contracts-browser')
s+=r'''
{
const demo=JSON.parse(fs.readFileSync(path.join(root,'.local/testes-municipios.json'),'utf8'));
const older=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
const S='[role="tabpanel"]:not([hidden])';
const stamp=Date.now().toString().slice(-9), number='DEMO-4BC-'+stamp;
const city=demo.customers.find(c=>c.name==='Cuiabá'), office=city.offices.find(o=>o.name==='Saúde');
const headers={'X-Elo-Customer-Id':String(city.id),'X-Elo-Municipal-Office-Id':String(office.id)};
const must=async(p,text)=>{if(!await p.waitText(text,15000))throw new Error('Não exibiu: '+text)};
const good=(r,status)=>{if(r.status!==status)throw new Error('HTTP '+r.status+' '+JSON.stringify(r.body));return r.body;};
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(120);}throw new Error('Condição não atingida');}
async function login(p,c){await p.go('/');await p.waitFor('(()=>{const e=document.querySelector("input[name=username]");return e&&Object.keys(e).some(k=>k.startsWith("__react"))})()');await p.fill('input[name=username]',cpfMasked(c.cpf));await p.fill('input[name=password]',c.password);await p.eval('document.querySelector("form button[type=submit]").click()');await must(p,'Onde vamos trabalhar?');}
async function choose(p){await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]','Cuiabá');await must(p,'Escolha sua secretaria');await p.waitFor(`document.querySelector('ul[aria-label="Contextos autorizados"] button')`);await p.clickWithin('ul[aria-label="Contextos autorizados"]','Saúde');await must(p,'Seu trabalho, organizado.');}
async function pick(p,title,text,id){await p.fill(S+` input[name="${title}"]`,text);await p.waitFor(`document.querySelector(${JSON.stringify(S+` [role="listbox"][aria-label="${title}"] [data-value="${id}"]`)})`);await p.eval(`document.querySelector(${JSON.stringify(S+` [role="listbox"][aria-label="${title}"] [data-value="${id}"]`)}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);}
async function select(p,title,value){await p.eval(`(()=>{const label=[...document.querySelectorAll(${JSON.stringify(S+' label')})].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(title)});const el=label?.querySelector('select');if(!el)throw new Error('Select não encontrado: '+${JSON.stringify(title)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function action(p,command,reason){await select(p,'Ação',command);await p.fill(S+' input[name=reason]',reason);await p.clickWithin(S,'Confirmar ação');}
function validCnpj(seed){let d=String(seed).padStart(8,'0')+'0001';for(const w of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){const n=[...d].reduce((a,c,i)=>a+Number(c)*w[i],0)%11;d+=n<2?'0':String(11-n);}return d;}
(async()=>{const b=new Browser();let p,q,cid;
try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);await p.openRoutine('ope.contratos');await must(p,'Cadastrar contrato');
 check('Menu e GRID de contratos disponíveis na secretaria',await p.eval(`!!document.querySelector(${JSON.stringify(S+' table')})`));
 const types=good(await p.api('/supplier_types?per_page=1','GET',null,headers),200).items;
 const units=good(await p.api('/measurement_units?per_page=1','GET',null,headers),200).items;
 const supplier=good(await p.api('/suppliers','POST',{company_name:'Fornecedor demonstração contratos '+stamp,trading_name:'DEMO 4BC '+stamp,cnpj:validCnpj(98000000+Number(stamp.slice(-6))),type_id:types[0].id,email:'contratos.teste@example.com',phone:'0000000000',zip:'00000000',state:'MT',city:'Cuiabá',district:'Teste',address:'Rua de teste',number:'0',complement:null},{...headers,'Idempotency-Key':'supplier-'+stamp}),201);
 const product=good(await p.api('/products','POST',{code:'DEMO4BC-'+stamp,name:'Item contratual de demonstração '+stamp,unit_id:units[0].id},{...headers,'Idempotency-Key':'product-'+stamp}),201);
 await p.clickWithin(S,'Cadastrar contrato');await must(p,'Novo contrato');await p.fill(S+' input[name=number]',number);await p.fill(S+' input[name=description]','Contrato exclusivamente sintético para avaliação 4B/4C');await pick(p,'Fornecedor',supplier.company_name,supplier.id);await pick(p,'Produto 1',product.code,product.id);await p.fill(S+' input[name="quantity-0"]','100');await p.fill(S+' input[name="price-0"]','10,00');const end=new Date();end.setDate(end.getDate()+30);await p.fill(S+' input[name=ends_on]',end.toISOString().slice(0,10));await p.clickWithin(S,'Salvar contrato');await must(p,'Abrir contrato '+number);
 let current=good(await p.api('/contracts?q='+number,'GET',null,headers),200).items.find(c=>c.number===number);cid=current.id;
 check('CRUD cria contrato e calcula total no servidor',current.limit_cents===100000&&current.status==='pending');
 const url=`/app/orgaos/${city.id}/secretarias/${office.id}/contratos/${cid}`;
 await p.go(`/app/orgaos/${city.id}/administracao/alcadas`);await must(p,'Alçadas contratuais');await pick(p,'Contrato',number,cid);await p.waitFor(`document.querySelector(${JSON.stringify(S+' input[name="limit-0-0"]')})`);
 const opts=good(await p.api(`/customers/${city.id}/contract-approval-options?contract_id=${cid}`,'GET',null,{'X-Elo-Customer-Id':String(city.id)}),200);
 const approver=opts.approvers.find(a=>a.name.includes('transferência'));if(!approver)throw new Error('Aprovador de demonstração ausente');
 await select(p,'Aprovador 1',approver.id);await p.fill(S+' input[name="limit-0-0"]','2.000,00');await p.clickWithin(S,'Adicionar nível');await p.waitFor(`document.querySelector(${JSON.stringify(S+' input[name="limit-1-0"]')})`);
 await p.eval(`(()=>{const h=[...document.querySelectorAll(${JSON.stringify(S+' h3')})].find(e=>e.textContent==='Nível 2');const e=h.parentElement.parentElement.querySelectorAll('select')[1];e.value=${JSON.stringify(String(approver.id))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await p.fill(S+' input[name="limit-1-0"]','2.000,00');await p.clickWithin(S,'Salvar alçadas');
 let policy=await until(async()=>{const r=await p.api(`/customers/${city.id}/contract-approval-policies?contract_id=${cid}`,'GET',null,{'X-Elo-Customer-Id':String(city.id)});return r.body?.items?.[0]?.levels?.length===2?r.body.items[0]:null;});
 check('Cadastro visual configura dois níveis de alçada',policy.levels.every(l=>l.approvers[0].user_id===approver.id&&l.approvers[0].limit_cents===200000));await p.shot('alcadas');
 await p.go(url);await must(p,'Contrato '+number);await action(p,'submit','Submissão de demonstração');await until(async()=>{const r=await p.api('/contracts/'+cid,'GET',null,headers);return r.body.status==='awaiting_approval';});
 q=await b.tab(await b.context());await login(q,older);await choose(q);await q.go(url);await must(q,'Contrato '+number);await action(q,'approve','Primeiro nível conferido');await until(async()=>{const r=await q.api('/contracts/'+cid,'GET',null,headers);return r.body.approval_rounds?.at(-1)?.current_level===2;});await sleep(250);await action(q,'approve','Segundo nível conferido');current=await until(async()=>{const r=await q.api('/contracts/'+cid,'GET',null,headers);return r.body.status==='approved'?r.body:null;});check('Duas aprovações pela tela liberam o contrato',current.approval_rounds.at(-1).votes.length===2);
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/novo`);await must(p,'Registrar empenho autorizado');await pick(p,'Contrato vigente',number,cid);await p.fill(S+' input[name=number]','EMP-'+stamp);await p.fill(S+' input[name=amount]','800,00');await p.fill(S+' input[name=reference]','Autorização contábil sintética');await p.fill(S+' input[name=responsible]','Responsável de testes');await p.clickWithin(S,'Registrar');await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Empenho pela tela reserva somente o limite contratual',current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 const emp=current.commitments.at(-1).id,item=current.items[0].id;
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/medicoes/novo`);await must(p,'Registrar medição');await pick(p,'Contrato vigente',number,cid);await until(async()=>await p.eval(`document.querySelectorAll(${JSON.stringify(S+' select option')}).length>2`));await select(p,'Empenho',emp);await select(p,'Item contratado',item);await p.fill(S+' input[name=quantity]','30');await p.fill(S+' input[name=reference]','Ateste de execução sintético');await p.fill(S+' input[name=responsible]','Fiscal de testes');await p.clickWithin(S,'Registrar');await must(p,'Consultar contrato e saldo');current=good(await p.api('/contracts/'+cid,'GET',null,headers),200);check('Medição pela tela realiza sem nova alçada nem desconto duplicado',current.balance.realized_cents===30000&&current.balance.committed_cents===80000&&current.balance.available_to_commit_cents===20000);
 await p.go(url);await must(p,'Disponível para empenhar');await p.shot('monitor');check('Monitor responsivo sem rolagem horizontal de página',await p.shot('monitor',true));
 const other=demo.customers.find(c=>c.name==='Sinop');const r=await p.api('/contracts/'+cid,'GET',null,{'X-Elo-Customer-Id':String(other.id),'X-Elo-Municipal-Office-Id':String(other.offices[0].id)});check('Contrato de Cuiabá invisível em Sinop',r.status===404);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,contract_id:cid,number,supplier_id:supplier.id,product_id:product.id},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({results,contract_id:cid,error:e.message},null,2));process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
p=Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-browser.cjs');p.write_text(s,encoding='utf-8')
print('Roteiro curto de oito verificações preparado.')

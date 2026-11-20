from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
s=(r/'tools/dev/browser-e2e-38.cjs').read_text(encoding='utf-8').split('const withoutSecrets =')[0]
s=s.replace("path.resolve(__dirname, '../..')", "'C:/Apps/ELOGESTAO'").replace("process.env.ELO_BROWSER_WEB || 'http://localhost:3003'", "'http://localhost:3006'").replace('300[1235]', '300[12356]').replace('.local/logs/browser-38', '.local/logs/municipios-browser')
s+='''
const demo=JSON.parse(fs.readFileSync(path.join(root,'.local/testes-municipios.json'),'utf8'));
const must=async(p,t)=>{if(!await p.waitText(t,15000))throw new Error('Tela não exibiu: '+t)};
(async()=>{
 const b=new Browser();let p;
 try{
  await b.start();p=await b.tab(await b.context());await p.go('/');await p.waitFor('(()=>{const e=document.querySelector("input[name=username]");return e&&Object.keys(e).some(k=>k.startsWith("__react"))})()');await p.fill('input[name=username]',cpfMasked(demo.cpf));await p.fill('input[name=password]',demo.password);await p.eval('document.querySelector("form button[type=submit]").click()');await must(p,'Onde vamos trabalhar?');
  const available=await p.api('/me/customers');
  check('Login oferece somente Cuiabá e Sinop',available.status===200&&available.body.items.length===2&&demo.customers.every(c=>available.body.items.some(a=>a.id===c.id))&&!available.body.platform.available);
  let allOffices=true,allPermissions=true,allEmpty=true,allPolicies=true,adminAllowed=true;
  for(const c of demo.customers){
   const ctx=await p.api('/me/customers/'+c.id+'/contexts');allOffices&&=ctx.status===200&&ctx.body.offices.length===c.offices.length&&c.offices.every(o=>ctx.body.offices.some(a=>a.id===o.id));adminAllowed&&=ctx.body.customer_admin.available;
   for(const resource of ['suppliers','products','vehicle_models']){const policy=await p.api(`/customers/${c.id}/sharing-policies/${resource}`,'GET',null,{'X-Elo-Customer-Id':String(c.id)});allPolicies&&=policy.status===200&&policy.body.mode===c.sharing_mode&&!policy.body.has_records;}
   for(const office of c.offices){const resolved=await p.api('/me/contexts/resolve','POST',{mode:'office',customer_id:c.id,municipal_office_id:office.id});allPermissions&&=resolved.status===200&&resolved.body.permissions.includes('cad.fornecedores.incluir')&&resolved.body.permissions.includes('cad.produtos.incluir');const listed=await p.api('/suppliers','GET',null,{'X-Elo-Customer-Id':String(c.id),'X-Elo-Municipal-Office-Id':String(office.id)});allEmpty&&=listed.status===200&&listed.body.total===0;}
  }
  check('Duas secretarias em Cuiabá e três em Sinop',allOffices);check('Cadastro habilitado nas cinco secretarias',allPermissions);check('Compartilhamento em Cuiabá e exclusividade em Sinop configurados',allPolicies);check('Fornecedores vazios para os próprios testes do usuário',allEmpty);check('Administração dos dois órgãos disponível',adminAllowed);
  await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.shot('escolher-empresa');await p.clickWithin('ul[aria-label="Órgãos autorizados"]','Cuiabá');await must(p,'Escolha sua secretaria');await p.clickWithin('ul[aria-label="Contextos autorizados"]','Saúde');await must(p,'Seu trabalho, organizado.');await p.openRoutine('ope.fornecedores');await must(p,'Cadastrar fornecedor');check('Tela de fornecedores em Cuiabá pronta para cadastro',await p.eval(`document.querySelector('[data-testid=contexto-empresa-ativa]')?.innerText==='Cuiabá'`));await p.shot('cuiaba-fornecedores');
  await p.go('/app/contexto?trocar=1');await must(p,'Onde vamos trabalhar?');await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]','Sinop');await must(p,'Escolha sua secretaria');await p.clickWithin('ul[aria-label="Contextos autorizados"]','Meio Ambiente');await must(p,'Seu trabalho, organizado.');await p.openRoutine('ope.fornecedores');await must(p,'Cadastrar fornecedor');check('Troca para Sinop preserva a empresa correta na rotina',await p.eval(`document.querySelector('[data-testid=contexto-empresa-ativa]')?.innerText==='Sinop'`));await p.shot('sinop-fornecedores');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
 }catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});process.exitCode=1;}
 finally{await b.stop().catch(()=>{});}
})();
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/municipios-browser.cjs').write_text(s,encoding='utf-8')

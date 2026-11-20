from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1/municipios-browser.cjs')
source=p.read_text(encoding='utf-8').split('const demo=JSON.parse')[0]
source=source.replace('municipios-browser','selecao-ajustada-browser')
source+=r'''
const demo=JSON.parse(fs.readFileSync(path.join(root,'.local/testes-municipios.json'),'utf8'));
const old=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
(async()=>{const b=new Browser();try{
 await b.start();
 for(const [label,credentials] of [['anterior',old],['municipios',demo]]){
  const p=await b.tab(await b.context());await p.go('/');
  await p.waitFor('(()=>{const e=document.querySelector("input[name=username]");return e&&Object.keys(e).some(k=>k.startsWith("__react"))})()');
  await p.fill('input[name=username]',cpfMasked(credentials.cpf));await p.fill('input[name=password]',credentials.password);await p.eval('document.querySelector("form button[type=submit]").click()');
  if(!await p.waitText('Onde vamos trabalhar?',15000))throw new Error('Seleção não exibida');
  const a=await p.api('/me/customers');
  check(label+': Cuiabá e Sinop disponíveis',a.status===200&&demo.customers.every(c=>a.body.items.some(i=>i.id===c.id)));
  check(label+': quantidade e nome corretos',a.body.items.length===(label==='anterior'?3:2)&&!a.body.items.some(i=>i.name==='Órgão sintético de desenvolvimento')&&(label!=='anterior'||a.body.items.some(i=>i.name==='Órgão de demonstração')));
  let ok=true;for(const c of demo.customers){const x=await p.api('/me/customers/'+c.id+'/contexts');ok&&=x.status===200&&x.body.offices.length===c.offices.length&&x.body.customer_admin.available;}
  check(label+': secretarias e administração disponíveis',ok);
  await p.waitFor(`document.querySelectorAll('ul[aria-label="Órgãos autorizados"] button').length===${label==='anterior'?3:2}`);
  await p.shot('seletor-'+label);
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log('TOTAL '+results.filter(x=>x.ok).length+'/'+results.length);if(results.some(x=>!x.ok))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/selection-check.cjs').write_text(source,encoding='utf-8')

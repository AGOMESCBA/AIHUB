from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
s=(r/'tools/dev/browser-e2e-38.cjs').read_text(encoding='utf-8').split('const withoutSecrets =')[0]
s=s.replace("path.resolve(__dirname, '../..')", "'C:/Apps/ELOGESTAO'").replace("process.env.ELO_BROWSER_WEB || 'http://localhost:3003'", "'http://localhost:3006'").replace('300[1235]', '300[12356]').replace('.local/logs/browser-38', '.local/logs/design2-browser')
s+='''
const seed=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
const must=async(p,text)=>{if(!await p.waitText(text,15000))throw new Error('Tela não exibiu: '+text)};
const login=async(p,user)=>{await p.go('/');await p.waitFor('(()=>{const e=document.querySelector("input[name=username]");return e&&Object.keys(e).some(k=>k.startsWith("__react"))})()');await p.fill('input[name=username]',cpfMasked(user.cpf));await p.fill('input[name=password]',user.password);await p.eval('document.querySelector("form button[type=submit]").click()');if(!await p.waitFor('location.pathname.startsWith("/app/")',20000))throw new Error('Login não concluiu');};
const choose=async(p,office)=>{await p.go('/app/contexto?trocar=1');await must(p,'Onde vamos trabalhar?');await p.waitFor(`[...document.querySelectorAll('ul[aria-label="Órgãos autorizados"] button')].some(b=>b.innerText.includes(${JSON.stringify(ORG_A)}))`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]',ORG_A);await must(p,'Escolha sua secretaria');await p.clickWithin('ul[aria-label="Contextos autorizados"]',office);if(!await p.waitFor('location.pathname === "/app/dashboard"'))throw new Error('Não entrou na secretaria');};
(async()=>{
 const b=new Browser();let p;
 try{
  await b.start();p=await b.tab(await b.context());await login(p,seed);
  await p.go('/app/contexto?trocar=1');await must(p,'Onde vamos trabalhar?');
  check('Seleção independente não exibe menu, cabeçalho nem abas',await p.eval(`!document.querySelector('nav[aria-label="Rotinas autorizadas"]')?.getBoundingClientRect().height && !document.querySelector('header[aria-label="Contexto da aba"]') && ![...document.querySelectorAll('[role=tablist]')].some(e=>e.getBoundingClientRect().height)`));
  await p.fill('input[placeholder="Buscar órgão pelo nome…"]','inexistente-design');await must(p,'Nenhum órgão corresponde');check('Busca de órgão apresenta estado vazio',true);await p.fill('input[placeholder="Buscar órgão pelo nome…"]','');await p.clickWithin('ul[aria-label="Órgãos autorizados"]',ORG_A);await must(p,'Escolha sua secretaria');
  check('Somente secretarias autorizadas estão disponíveis',await p.eval(`document.querySelectorAll('ul[aria-label="Contextos autorizados"] button').length===2`));
  await p.shot('selecao-secretaria');check('Seleção sem rolagem horizontal em 390 px',await p.shot('selecao-secretaria',true));
  await p.clickWithin('ul[aria-label="Contextos autorizados"]',A2);await must(p,'Seu trabalho, organizado.');
  await p.waitFor(`document.querySelector('section[aria-label="Acesso rápido"] button')`);check('Cards de rotinas aparecem acima da dobra',await p.eval(`(()=>{const e=document.querySelector('section[aria-label="Acesso rápido"] button');return !!e&&e.getBoundingClientRect().bottom<innerHeight})()`));
  check('Barra lateral possui módulos e contexto destacado no cabeçalho',await p.eval(`!!document.querySelector('nav[aria-label="Rotinas autorizadas"] a[href="/app/administracao"]')&&!!document.querySelector('header a[aria-label="Trocar órgão ou secretaria"]')`));await p.shot('inicio');
  await p.fill('input[placeholder="Encontrar uma rotina…"]','Veículos');await p.openRoutine('ope.veiculos');await must(p,'Filtre pelos campos');
  check('Grid e filtros continuam disponíveis no novo layout',await p.eval(`!!document.querySelector('thead input[name=filtro_identificacao]')&&document.querySelectorAll('thead select').length===3`));await p.shot('veiculos');
  await p.clickWithin('[role=tabpanel]:not([hidden]) tbody','Consultar');await p.waitFor(`document.querySelector('[role=tabpanel]:not([hidden]) input[name=color]')`);await p.fill(p.inPanel('input[name=color]'),'Rascunho preservado no redesenho');const selected=(await p.tabs()).find(t=>t.selected);
  await p.clickWithin('header[aria-label="Contexto da aba"]','Trocar');await must(p,'Onde vamos trabalhar?');await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]',ORG_A);await must(p,'Escolha sua secretaria');await p.clickWithin('ul[aria-label="Contextos autorizados"]',A1);await must(p,'Seu trabalho, organizado.');await p.eval(`document.getElementById(${JSON.stringify('aba-'+selected.id)}).click()`);
  check('Troca de secretaria preserva a edição na aba original',await p.waitFor(`document.querySelector('[role=tabpanel]:not([hidden]) input[name=color]')?.value==='Rascunho preservado no redesenho'`));
  check('Página operacional cabe em 390 px',await p.shot('operacao',true));
  const admin=await b.tab(await b.context());await login(admin,access.user);await must(admin,'Organização que faz a diferença.');check('Plataforma entra na área Administração',await admin.path()==='/app/administracao');await admin.shot('administracao');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
 }catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});process.exitCode=1;}
 finally{await b.stop().catch(()=>{});}
})();
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/design2-browser.cjs').write_text(s,encoding='utf-8')
print('Amostra do redesenho preparada, incluindo edição preservada na troca de secretaria.')

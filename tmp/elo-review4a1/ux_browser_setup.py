from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
s=(r/'tools/dev/browser-e2e-38.cjs').read_text(encoding='utf-8').split('const withoutSecrets =')[0]
s=s.replace("path.resolve(__dirname, '../..')", "'C:/Apps/ELOGESTAO'").replace("process.env.ELO_BROWSER_WEB || 'http://localhost:3003'", "'http://localhost:3007'").replace('300[1235]', '300[123567]').replace('.local/logs/browser-38', '.local/logs/ux-browser')
s+='''
const seed=JSON.parse(fs.readFileSync(path.join(root,'.local/lotacao-e2e.json'),'utf8'));
const must=async(p,text)=>{if(!await p.waitText(text,15000))throw new Error('Tela não exibiu: '+text)};
const login=async(p,user)=>{await p.go('/');await p.waitFor('document.querySelector("input[name=username]")');await p.fill('input[name=username]',cpfMasked(user.cpf));await p.fill('input[name=password]',user.password);await p.eval('document.querySelector("form button[type=submit]").click()');if(!await p.waitFor('location.pathname.startsWith("/app/")',20000))throw new Error('Login não concluiu');};
const choose=async(p,option)=>{await p.go('/app/contexto?trocar=1');await must(p,'Selecione o órgão e a secretaria');await p.waitFor(`[...document.querySelectorAll('section[aria-labelledby=context-title] button')].some(b=>b.innerText.includes(${JSON.stringify(ORG_A)}))`);await p.clickWithin('section[aria-labelledby=context-title]',ORG_A);await must(p,option);await p.clickWithin('section[aria-labelledby=context-title]',option);await p.waitFor('location.pathname === "/app/dashboard" || location.pathname === "/app/administracao"');};
(async()=>{
 const b=new Browser();let p;
 try{
  await b.start();p=await b.tab(await b.context());await login(p,seed);await choose(p,A2);await must(p,'Seu acesso rápido');
  check('Cards das rotinas aparecem na primeira área visível',await p.eval(`(()=>{const e=document.querySelector('button.group.relative');return !!e && e.getBoundingClientRect().top<window.innerHeight-100})()`));
  check('Menu tem ícones e troca de secretaria destacada',await p.eval(`!!document.querySelector('nav[aria-label="Rotinas autorizadas"] button[data-routine] svg') && !!document.querySelector('[data-testid=contexto-novas-abas] a')`));
  await p.shot('inicio');
  await p.fill('input[placeholder="Encontrar uma rotina…"]','Veículos');
  check('Busca no menu reduz as opções autorizadas',await p.waitFor(`[...document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] button[data-routine]')].every(b=>b.innerText.includes('Veículos')) && document.querySelectorAll('nav[aria-label="Rotinas autorizadas"] button[data-routine]').length>0`));
  await p.openRoutine('ope.veiculos');await must(p,'Filtre pelos campos');
  check('Grid tem filtros no próprio cabeçalho',await p.eval(`!!document.querySelector('thead input[name=filtro_identificacao]') && document.querySelectorAll('thead select').length===3`));
  await p.fill(p.inPanel('input[name=filtro_identificacao]'),'INEXISTENTE-UX-654321');await p.clickWithin('[role=tabpanel]:not([hidden]) thead','Aplicar busca');await must(p,'Nenhum registro encontrado');
  check('Resultado vazio mantém os filtros editáveis',await p.eval(`document.querySelector('thead input[name=filtro_identificacao]')?.value==='INEXISTENTE-UX-654321'`));
  await p.fill(p.inPanel('input[name=filtro_identificacao]'),'');await p.clickWithin('[role=tabpanel]:not([hidden])','Limpar filtros');await must(p,'Sem filtros aplicados');
  await p.waitFor('document.querySelectorAll("tbody tr").length>0 && !document.body.innerText.includes("Atualizando registros…")');
  check('Limpar filtros recupera os registros',await p.eval(`!!document.querySelector('[role=tabpanel]:not([hidden]) tbody a')`));
  check('Situação usa badge com texto',await p.eval(`!!document.querySelector('[role=tabpanel]:not([hidden]) tbody span.rounded-full')`));
  await p.shot('grid');check('Grid não provoca rolagem horizontal na página de 390 px',await p.shot('grid',true));
  await p.go('/app/contexto?trocar=1');await must(p,'PASSO 1');await p.fill('input[placeholder="Encontrar órgão pelo nome…"]','nao-existe-ux');await must(p,'Nenhum órgão corresponde');
  check('Seletor de órgão possui busca e estado vazio',true);await p.fill('input[placeholder="Encontrar órgão pelo nome…"]','');await p.clickWithin('section[aria-labelledby=context-title]',ORG_A);await must(p,'PASSO 2');await p.shot('secretarias');check('Seletor de secretaria cabe em 390 px',await p.shot('secretarias',true));
  const admin=await b.tab(await b.context());await login(admin,access.user);await must(admin,'Organize seu órgão');
  check('Administrador da plataforma entra diretamente em Administração',await admin.path()==='/app/administracao');
  await admin.shot('administracao');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
 }catch(e){console.error(e.message);if(p)await p.shot('falha').catch(()=>{});process.exitCode=1;}
 finally{await b.stop().catch(()=>{});}
})();
'''
Path('C:/Apps/iahub/tmp/elo-review4a1/ux-browser.cjs').write_text(s,encoding='utf-8')
print('Amostra visual preparada.')

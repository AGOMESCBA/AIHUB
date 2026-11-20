
async function identityRace(browser){
 current='independente: resposta de identidade anterior';
 const context=await browser.context();const page=await browser.tab(context);
 await page.login(access.user);await page.waitFor('location.pathname==="/app/dashboard"');
 await page.waitFor(`document.querySelector('button[data-routine="adm.orgaos"]:not(:disabled)')`);
 await page.send('Fetch.enable',{patterns:[{urlPattern:'*/api/elo/me/navigation*',requestStage:'Response'}]});
 await page.eval(`document.querySelector('button[data-routine="adm.orgaos"]').click()`);
 const paused=await page.waitPaused();
 check('Resposta real autorizada da identidade anterior retida',!!paused&&paused.responseStatusCode===200);
 if(!paused)throw new Error('Resposta não retida');
 const other=await browser.tab(context);await other.go('/api/auth/signin');
 const changed=await other.eval(`(async()=>{const {csrfToken}=await fetch('/api/auth/csrf').then(r=>r.json());
 const body=new URLSearchParams({csrfToken,username:${JSON.stringify(access.demo_users.admin_orgao_a.cpf)},password:${JSON.stringify(access.demo_users.admin_orgao_a.password)},json:'true',callbackUrl:location.origin+'/app/dashboard'});
 const r=await fetch('/api/auth/callback/credentials',{method:'POST',body});const s=await fetch('/api/auth/session').then(r=>r.json());return {status:r.status,userId:s.user?.id,sessionId:s.sessionId};})()`);
 await page.send('Page.bringToFront');await page.eval('document.dispatchEvent(new Event("visibilitychange"))');
 const confirmed=await page.waitFor(`(()=>{const s=JSON.parse(sessionStorage.getItem('elo:espaco-de-trabalho:v1')||'null');return s?.userId===${JSON.stringify(String(changed.userId))}&&s?.sessionId===${JSON.stringify(changed.sessionId)};})()`,10000);
 check('Nova identidade confirmada antes da resposta antiga',changed.status===200&&confirmed);
 if(!confirmed){await page.send('Fetch.disable');throw new Error('Nova identidade não confirmada');}
 await page.send('Fetch.continueResponse',{requestId:paused.requestId});await page.send('Fetch.disable');await sleep(900);
 const tabs=await page.tabs();check('Resposta antiga não recria aba nem contexto da identidade anterior',tabs.length===0,{abas:tabs.length});
 await page.send('Page.close').catch(()=>null);await other.send('Page.close').catch(()=>null);
}

async function revisionDraft(browser){
 current='independente: edição durante revalidação';
 const page=await browser.tab(await browser.context());await page.login(access.user);await page.waitFor('location.pathname==="/app/dashboard"');
 await page.openRoutine('adm.orgaos');await page.waitFor(`document.querySelector('${page.inPanel('tbody a')}')`);
 await page.clickWithin('[role=tabpanel]:not([hidden]) tbody','Consultar');await page.waitFor(`document.querySelector('${page.inPanel('input[name=name]')}:not(:disabled)')`);
 const typed='Rascunho independente sem gravação '+stamp;await page.fill(page.inPanel('input[name=name]'),typed);
 const record=(await page.tabs()).find(t=>t.selected);await page.openRoutine('adm.identidades');
 await page.send('Fetch.enable',{patterns:[{urlPattern:'*/api/elo/me/navigation*',requestStage:'Response'}]});
 await page.eval('window.__reviewDateNow=Date.now;Date.now=()=>window.__reviewDateNow()+61000;');
 await page.activate(record.text.replace('Ativa: ','').replace(/alterada, não salva.*$/,''));
 const paused=await page.waitPaused(5000);check('Revalidação ocorre ao retornar à edição',!!paused);
 if(!paused)throw new Error('Revalidação não retida');
 const response=await page.send('Fetch.getResponseBody',{requestId:paused.requestId});
 const data=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body);
 const removed='plataforma.identidades.incluir';if(!data.permissions.includes(removed))throw new Error('Ação de teste ausente');
 data.permissions=data.permissions.filter(a=>a!==removed);data.routines=data.routines.map(r=>({...r,actions:r.actions.filter(a=>a!==removed)}));
 data.authz_revision='platform.'+require('node:crypto').createHash('sha256').update(data.permissions.join('\n')).digest('hex').slice(0,16);
 await page.send('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
 await page.send('Fetch.disable');await sleep(1000);
 check('Mudança de ação de outra rotina preserva o texto ainda autorizado',await page.value(page.inPanel('input[name=name]'))===typed);
 await page.eval('Date.now=window.__reviewDateNow');await page.send('Page.close').catch(()=>null);
}

(async()=>{const browser=new Browser();await browser.start();try{for(const run of [identityRace,revisionDraft]){try{await run(browser);}catch(e){check('Cenário concluído',false,e.message.slice(0,200));}}}finally{await browser.stop();fs.writeFileSync(path.join(out,'results-independent.json'),JSON.stringify({results,passed:results.filter(r=>r.ok).length,total:results.length},null,2));}console.log(results.filter(r=>r.ok).length+'/'+results.length+' verificações independentes aprovadas.');process.exit(results.every(r=>r.ok)?0:1);})();

from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-primary-browser.cjs')
s=p.read_text(encoding='utf-8').split('(async()=>{const b=new Browser();let p;')[0]
s+='''(async()=>{const b=new Browser();let p;try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);
 await p.waitFor('document.getElementById("inicio-grupo-operacao-contratos")');
 const expected=['Contratos','Empenhos','Medições'];const cards=await p.eval(`[...document.querySelectorAll('#inicio-grupo-operacao-contratos button')].map(e=>e.innerText)`);
 check('Cards agrupados em Gestão contratual',cards.length===3&&expected.every((v,i)=>cards[i].startsWith(v)));
 const menu=await p.eval(`[...document.querySelectorAll('#menu-grupo-operacao-contratos [data-routine]')].map(e=>e.dataset.routine)`);
 check('Menu lateral usa o mesmo grupo e ordem',JSON.stringify(menu)===JSON.stringify(['ope.contratos','ope.empenhos','ope.medicoes']));await p.shot('cards-gestao-contratual');
 await p.go('/app/contexto');await p.waitFor(`document.querySelector('ul[aria-label="Órgãos autorizados"] button')`);await p.clickWithin('ul[aria-label="Órgãos autorizados"]','Cuiabá');await p.waitFor(`document.querySelector('ul[aria-label="Contextos autorizados"] button')`);await p.clickWithin('ul[aria-label="Contextos autorizados"]','Modo administrativo do órgão');await p.waitFor('document.getElementById("inicio-grupo-administracao-contratos")');
 check('Administração tem card de Alçadas contratuais',await p.eval(`document.getElementById('inicio-grupo-administracao-contratos')?.innerText.includes('Alçadas contratuais')`));
 check('Administração tem Alçadas no grupo do menu',await p.eval(`!!document.querySelector('#menu-grupo-administracao-contratos [data-routine="adm.alcadas"]')`));await p.shot('cards-alcadas');
 fs.writeFileSync(path.join(out,'menu-result.json'),JSON.stringify({url:'http://localhost:3006',results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);if(p)await p.shot('falha-menu').catch(()=>{});process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
p.with_name('contracts-menu-browser.cjs').write_text(s,encoding='utf-8')

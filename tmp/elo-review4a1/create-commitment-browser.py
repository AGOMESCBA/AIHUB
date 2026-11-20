from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1')
s=(p/'contracts-primary-browser.cjs').read_text(encoding='utf-8').split('(async()=>{const b=new Browser();let p;')[0]
s=s.replace("await must(p,'Seu trabalho, organizado.');", "await must(p,'Área de trabalho');")
s+=r'''(async()=>{const b=new Browser();let p;try{
await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);
const result=await p.api('/contract_commitments/','GET',null,headers);const list=good(result,200);const e=list.items.find(e=>e.status==='active'&&e.realized_cents>0)||list.items[0];if(!e)throw new Error('Nenhum empenho de demonstração disponível');
await p.openRoutine('ope.empenhos');await must(p,'Consultar empenho');
check('Grid apresenta contrato por número, fornecedor e saldos',await p.eval(`(()=>{const t=document.querySelector(${JSON.stringify(S)}).textContent;return ['Valor registrado','Realizado','Disponível',${JSON.stringify(e.contract_number)},${JSON.stringify(e.supplier_name)}].every(x=>t.includes(x));})()`));
await p.fill(S+' input[aria-label="Filtrar número"]','NAOEXISTE'+Date.now());await sleep(900);await p.waitFor(`!document.querySelector(${JSON.stringify(S)}).textContent.includes(${JSON.stringify(e.number)})`);check('Filtro por número aplicado',await p.eval(`!document.querySelector(${JSON.stringify(S)}).textContent.includes(${JSON.stringify(e.number)})`));
await p.fill(S+' input[aria-label="Filtrar número"]','');await must(p,e.number);
await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/${e.id}`);await must(p,'Histórico financeiro');await must(p,'Disponível no empenho');
check('Detalhe próprio com origem, medições e histórico',await p.eval(`(()=>{const t=document.querySelector(${JSON.stringify(S)}).textContent;return ['Referência da autorização','Responsável pela autorização','Medições vinculadas','Histórico financeiro',${JSON.stringify(e.contract_number)}].every(x=>t.includes(x));})()`));
check('Cancelar respeita realização existente',e.realized_cents>0?await p.eval(`!![...document.querySelectorAll(${JSON.stringify(S+' button')})].find(b=>b.textContent.trim()==='Cancelar empenho'&&b.disabled)`):true);
check('Desktop sem transbordamento',await p.shot('empenho-monitor-detalhe'));
await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check('Celular sem transbordamento',await p.shot('empenho-monitor-celular'));await p.desktop();
await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/empenhos/novo`);await must(p,'Registrar empenho autorizado');await pick(p,'Contrato vigente',e.contract_number,e.contract_id);await must(p,'Conferência do empenho');
await p.fill(S+' input[name=amount]','999999999,00');await must(p,'supera o disponível');check('Simulação alerta valor acima do saldo',true);
await p.fill(S+' input[name=amount]','10,00');await must(p,'Disponível após registrar');
check('Botões permanecem acima dos campos',await p.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(S+' button')})].find(b=>b.textContent.trim()==='Registrar');return b.getBoundingClientRect().top<document.querySelector(${JSON.stringify(S+' input[name=amount]')}).getBoundingClientRect().top;})()`));
check('Nota fiscal não é exigida no empenho',await p.eval(`document.querySelector(${JSON.stringify(S)}).textContent.includes('não é exigida neste lançamento')`));
await p.shot('empenho-cadastro-simulacao');fs.writeFileSync(path.join(out,'commitment-improvement-result.json'),JSON.stringify({results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.stack);if(p)await p.shot('falha-empenho-melhoria').catch(()=>{});process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
(p/'commitment-improvement-browser.cjs').write_text(s,encoding='utf-8')

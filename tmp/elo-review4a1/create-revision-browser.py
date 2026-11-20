from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1')
s=(p/'contracts-primary-browser.cjs').read_text(encoding='utf-8').split('(async()=>{const b=new Browser();let p;')[0]
s+=r'''(async()=>{const b=new Browser();let p,q;try{
await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);
await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/aprovacoes/8`);await must(p,'Análise somente leitura');await p.waitFor(`document.querySelector(${JSON.stringify(S+' input[name=approval_reason]')})`);
check('Primeiro nível pode decidir',await p.eval(`(()=>{const buttons=[...document.querySelectorAll(${JSON.stringify(S+' button')})];return ['Aprovar','Reprovar'].every(t=>buttons.some(b=>b.textContent.trim()===t&&!b.disabled));})()`));
check('Fila completa na lateral esquerda',await p.eval(`(()=>{const a=document.querySelector(${JSON.stringify(S+' aside')}),f=document.querySelector(${JSON.stringify(S+' form')});return !!a&&a.getBoundingClientRect().width<400&&a.querySelectorAll('[data-approval-user]').length===2;})()`));
check('Botões acima do formulário',await p.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(S+' button')})].find(b=>b.textContent.trim()==='Aprovar');return b.getBoundingClientRect().top<document.querySelector(${JSON.stringify(S+' input[name=approval_reason]')}).getBoundingClientRect().top;})()`));
q=await b.tab(await b.context());await login(q,older);await choose(q);await q.openRoutine('ope.aprovacoes');await must(q,'DEMO-APROVACAO-EM-2-NIVEIS');check('Próximo aprovador vê contrato na grid',true);
await q.go(`/app/orgaos/${city.id}/secretarias/${office.id}/aprovacoes/8`);await must(q,'Análise somente leitura');await must(q,'aguardando');
check('Próximo nível não pode aprovar nem reprovar',await q.eval(`(()=>{const buttons=[...document.querySelectorAll(${JSON.stringify(S+' button')})];return ['Aprovar','Reprovar'].every(t=>buttons.some(b=>b.textContent.trim()===t&&b.disabled));})()`));
check('Ambos os níveis identificados',await q.eval(`(()=>{const t=document.querySelector(${JSON.stringify(S+' aside')}).textContent;return t.includes('Nível 1')&&t.includes('Nível 2')&&t.includes('Aguardando nível anterior');})()`));
await q.clickWithin(S,'Recolher fila');check('Fila recolhível',await q.eval(`!document.querySelector(${JSON.stringify(S+' aside')})`));await q.clickWithin(S,'Exibir fila');
check('Tela desktop sem transbordamento',await q.shot('revisao-fila-completa'));
await q.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await q.go(`/app/orgaos/${city.id}/secretarias/${office.id}/aprovacoes/8`);await must(q,'Análise somente leitura');await sleep(1000);
check('Fila recolhida inicialmente no celular',await q.eval(`!document.querySelector(${JSON.stringify(S+' aside')})`));await q.clickWithin(S,'Exibir fila');check('Fila abre no celular',await q.eval(`!!document.querySelector(${JSON.stringify(S+' aside')})`));check('Celular sem transbordamento',await q.shot('revisao-fila-mobile'));await q.desktop();
const r=await q.api('/contract_approvals/8','GET',null,headers);check('API permite consulta futura sem decisão',r.status===200&&r.body.approval.can_decide===false&&r.body.approval.my_level===2);
fs.writeFileSync(path.join(out,'approval-revision-result.json'),JSON.stringify({results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.stack);if(q||p)await(q||p).shot('falha-revisao-aprovacao').catch(()=>{});process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
(p/'approval-revision-browser.cjs').write_text(s,encoding='utf-8')

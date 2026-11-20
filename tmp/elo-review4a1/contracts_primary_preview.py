from pathlib import Path
R=Path('C:/Apps/ELOGESTAO')
p=Path('C:/Apps/iahub/tmp/elo-review4a1/contracts-pattern-browser.cjs')
s=p.read_text(encoding='utf-8').split('(async()=>{const b=new Browser();let p;')[0].replace('3008','3006').replace('8013','8012')
s+='''(async()=>{const b=new Browser();let p;try{
 await b.start();p=await b.tab(await b.context());await login(p,demo);await choose(p);await p.openRoutine('ope.contratos');await must(p,'Cadastrar contrato');await p.waitFor(`document.querySelector(${JSON.stringify(S+' table')})`);check('GRID de contratos na prévia principal 3006',true);
 await p.go(`/app/orgaos/${city.id}/secretarias/${office.id}/contratos/1`);await must(p,'Disponível para empenhar');const r=good(await p.api('/contracts/1','GET',null,headers),200);check('Monitor integrado à API 8012',r.balance.committed_cents===80000&&r.balance.realized_cents===30000);await p.shot('monitor-3006');
 fs.writeFileSync(path.join(out,'primary-result.json'),JSON.stringify({url:base,results},null,2));console.log('TOTAL '+results.filter(r=>r.ok).length+'/'+results.length);if(results.some(r=>!r.ok))process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}finally{await b.stop().catch(()=>{});}})();
}
'''
# O helper da sessão anterior chama a URL BASE, e não base; a evidência usa o literal público.
s=s.replace('url:base,results',"url:'http://localhost:3006',results")
p.with_name('contracts-primary-browser.cjs').write_text(s,encoding='utf-8')
p=R/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
old='Prévia própria http://localhost:3008 e API http://127.0.0.1:8013/docsapi.'
new='**Ambiente principal de avaliação: http://localhost:3006, com API http://127.0.0.1:8012/docsapi**, conforme correção do responsável em 17/11/2026. Prévia recompilada a partir da worktree atual, preservando o padrão de telas e os cadastros. Processos principais em .local/lotacao-processes.json. A prévia própria http://localhost:3008 e a API 8013 foram usadas na validação inicial e permanecem auxiliares.'
assert old in s;s=s.replace(old,new,1);p.write_text(s,encoding='utf-8')
print('Ambiente principal registrado como 3006/8012; roteiro pontual preparado.')

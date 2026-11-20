from pathlib import Path
p=Path('C:/Apps/iahub/tmp/elo-review4a1/approval-examples-browser.cjs');s=p.read_text(encoding='utf-8')
needle="await p.shot('exemplo-aprovacao-sequencial');"
assert needle in s
s=s.replace(needle,"""check('Fila de aprovadores é o primeiro bloco da análise',await p.eval(`[...document.querySelectorAll(${JSON.stringify(S+' h2, '+S+' h3')})][0]?.textContent==='Fila de aprovadores'`));
 check('Fila mantém a ordem dos dois aprovadores',await p.eval(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(S+' ol[aria-label="Fila de aprovadores"] [data-approval-user]')})].map(e=>Number(e.dataset.approvalUser)))===JSON.stringify(${JSON.stringify(examples.users.map(u=>u.id))})`));
 check('Fila distingue decisão atual e espera do próximo nível',await p.eval(`document.querySelector(${JSON.stringify(S+' [data-approval-user="'+examples.users[0].id+'"]')})?.textContent.includes('Aguardando decisão neste nível')&&document.querySelector(${JSON.stringify(S+' [data-approval-user="'+examples.users[1].id+'"]')})?.textContent.includes('Aguardando nível anterior')`));
 await p.shot('fila-aprovadores-destacada');""",1)
s=s.replace("'approval-examples-result.json'","'approver-queue-highlight-result.json'")
p.with_name('approver-queue-browser.cjs').write_text(s,encoding='utf-8')

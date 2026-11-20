from pathlib import Path
import json
r=Path('C:/Apps/ELOGESTAO')
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
old='A verificação final da tela e a ativação da prévia serão registradas ao concluir o roteiro.'
new='Build final aprovado, com tipos e lint sem erros (avisos anteriores preservados); prévia 3006 e API 8012 atualizadas pelo script compartilhado. Navegador real: 11/11 verificações aprovadas, cobrindo menu e cards, cadastro, três valores, ações no topo, registro/GRID/detalhe, justificativa de cancelamento, desktop/celular, vínculo no empenho e duplicidade recusada. Exemplo sintético: nota NFS-e 1794948172521, id 1, valor R$ 10,00, medição 1 do contrato DEMO-4BC-857507397, em Cuiabá/Saúde. Orçado R$ 1.000,00, Empenhado R$ 800,00 e Realizado R$ 300,00 permaneceram iguais antes/depois. O documento ficou registrado para avaliação manual; sem cancelamento automático. Evidências em `.local/invoice-example.json`, `.local/logs/notas-browser.log` e `.local/logs/contracts-browser/invoices-result.json`.'
assert old in s;s=s.replace(old,new,1);p.write_text(s,encoding='utf-8')
p=r/'tools/dev/export_contracts.py';s=p.read_text(encoding='utf-8');needle='            {"flow": "contratos-execucao-4bc"';assert needle in s
entry={'flow':'notas-fiscais-execucao','paths':['/contract_invoices/','/contract_invoices/{invoice_id}','/contract_invoices/measurement-options','/contracts/{contract_id}/invoices/{invoice_id}/cancel'],'scope':'Registro documental por secretaria, vinculado ao fornecedor do contrato e a medições realizadas, com parcelas limitadas ao realizado ainda sem nota; duplicidade, ETag, idempotência, auditoria e cancelamento interno rastreável. Não movimenta Orçado, Empenhado ou Realizado; não emite documento, não consulta autenticidade externa e não efetua pagamento.','consumers':['Elo Gestão › Gestão contratual › Notas fiscais','Referências no contrato e no empenho']}
s=s.replace(needle,'            '+json.dumps(entry,ensure_ascii=False)+',\n'+needle,1);p.write_text(s,encoding='utf-8')
print('Controle final e compatibilidade fiscal atualizados')

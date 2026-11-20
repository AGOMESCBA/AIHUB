from pathlib import Path
p=Path('C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md');s=p.read_text(encoding='utf-8')
old='A conferência visual e o build final serão registrados abaixo ao concluir a ativação.'
new='Build final aprovado, incluindo tipos e lint (avisos preexistentes, sem erros). Navegador real: 9/9 verificações aprovadas, incluindo filtros, detalhe, cancelamento bloqueado com realização, simulação de saldo, botões no topo e desktop/celular sem transbordamento. Evidências em `.local/logs/empenhos-browser.log` e `.local/logs/contracts-browser/commitment-improvement-result.json`. A primeira conferência visual detectou que a nova consulta ainda precisava ser permitida no BFF; a lista foi corrigida, coberta por teste e a conferência completa repetida com sucesso. Uma compilação intermediária recusou finais de linha do arquivo da lista do BFF; o arquivo foi formatado e o build final passou. Prévia 3006 atualizada pelo procedimento compartilhado, API 8012 atualizada; os registros demonstrativos não foram alterados pelos ensaios visuais.'
assert old in s;s=s.replace(old,new,1);p.write_text(s,encoding='utf-8')
print('Evidencias finais registradas na secao 53.12')

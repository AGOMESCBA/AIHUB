from pathlib import Path
r=Path('C:/Apps/ELOGESTAO')
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
assert '## 53.12 ' not in s
s=s.replace('Versão 2.48 consolidada','Versão 2.49 consolidada',1)
entry='Evolução de empenhos — 17 de novembro de 2026, versão 2.49: consulta própria, GRID com saldos e filtros, simulação no cadastro e validação dos limites de texto. Primeiro lote implementado localmente, em revisão. Seção 53.12.\n\n'
s=s.replace('Revisão da aprovação contratual — 17 de novembro de 2026, versão 2.48:',entry+'Revisão da aprovação contratual — 17 de novembro de 2026, versão 2.48:',1)
section='''## 53.12 Evolução da rotina de empenhos — primeiro lote

Autorizada pelo responsável após auditoria da rotina. A entrega melhora o acompanhamento contratual, sem substituir o sistema contábil nem alterar a regra financeira: empenho reserva limite, medição realiza a reserva, estorno compensa a realização e cancelamento integral libera a reserva sem apagar a origem.

**Entregue no código:**

- GRID no padrão comum de painel, barra de filtros e filtros de coluna: número do empenho e contrato, fornecedor, data, registrado, realizado, disponível e situação. Busca por número, contrato, fornecedor (quando a pessoa pode consultar fornecedores), situação e período; paginação e filtros no servidor.
- Consulta própria em Empenhos › Consultar empenho, com origem, responsável, autor/data do registro, indicadores, percentual de execução, medições e histórico financeiro. Cancelamento integral justificado fica no topo e é bloqueado enquanto houver realização. Medições e histórico exigem suas próprias permissões, também na API.
- Cadastro mantém ações no topo e apresenta contrato, fornecedor, vigência e simulação do disponível após o lançamento. A validação definitiva de saldo/versão continua no servidor.
- API nova GET /contract_commitments/{commitment_id}, protegida por empenhos.consultar, contexto e RLS, sem liberação de edição/exclusão. ETag representa a versão do contrato usada no comando financeiro. A coleção mantém seus campos anteriores e acrescenta número do contrato, fornecedor e totais de execução, sem uma consulta por linha para calcular saldos.
- Limites de autorização de origem alinhados ao banco: referência de até 500 caracteres e responsável de até 200; excesso retorna 422. Não houve migração, mudança em valores registrados ou ampliação de perfis.

**Decisão de processo confirmada:** nota de empenho e nota fiscal são documentos distintos. A sequência de referência é contrato aprovado → empenho → medição/recebimento → nota fiscal vinculada à execução. Nota fiscal não é requisito para registrar empenho e não deve descontar novamente valores já realizados. Cadastro de notas fiscais e seus vínculos ainda não foi implementado neste lote. Medições continuam sem nova aprovação por alçada. Anulação parcial e reforço do empenho permanecem para evolução própria; não são simulados por edição de valores confirmados.

**Validação proporcional:** 14 regressões contratuais aprovadas; três testes novos aprovados em execuções focadas (limites de texto, monitor/filtros/saldos/isolamento e permissões dos dados filhos); 9 testes de inventário/cálculo financeiro aprovados; 26 testes web aprovados, incluindo permissão da consulta pelo BFF e recusa de métodos de edição/exclusão. Logs `.local/logs/empenhos-*.log`. A suíte completa não foi repetida. A conferência visual e o build final serão registrados abaixo ao concluir a ativação.

Inventário, OpenAPI (199 operações), registro de rotinas, BFF e manual operacional atualizados. A alteração pré-existente de workspace-view.tsx pertence à outra sessão e foi preservada. Sem commit, push ou produção. O procedimento compartilhado Atualizar-Previa.ps1 é usado para atualizar a porta 3006.

'''
needle='## 52.5 Botões do formulário no topo';assert needle in s;s=s.replace(needle,section+needle,1)
p.write_text(s,encoding='utf-8');print('Planejamento: 2.49 / 53.12')

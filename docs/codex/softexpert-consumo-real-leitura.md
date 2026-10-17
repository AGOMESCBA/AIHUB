# Consumo real de leitura — SoftExpert / IA Recruit

Teste executado em 15/10/2026. Nenhuma operação de escrita ou movimentação foi executada.

- Configuração localizada em `apps/IA Recruit/data/empresa_1.json`, `se_config` (conexão legada). Credencial utilizada apenas em memória, sem copiá-la para arquivos de teste ou documentação.
- Endpoint que autenticou: `https://j2a.c3isystems.com.br/apigateway/se/ws/wf_ws.php`.
- POST SOAP oficial `getWorkflow`, WorkflowID `036646`: HTTP 200, resposta `getWorkflowResponse`, Status SUCCESS, Code 1. Consulta real, sem mocks.
- GET autenticado do WSDL Workflow: HTTP 200; 23 operações, incluindo getWorkflow, newChildEntityRecord e newComment.
- GET autenticado do WSDL Formulário: HTTP 200; 6 operações, incluindo newTableRecord.
- As configurações 1 e 2 do configurador do Recruit apontam para `j2aconsultoria.softexpert.app`; os testes nesse endereço retornaram 401 com a credencial cadastrada. Não foi inferida a causa do 401.
- O template 2, de preenchimento da grid de currículos, ainda contém SEU_MAIN_ENTITY_ID_DA_VAGA e SEU_RELACIONAMENTO_DA_GRID. Portanto ele não comprova IDs do formulário ITSM.
- HTTPS validado pelo cliente Windows. A tentativa anterior pelo Node encontrou UNABLE_TO_VERIFY_LEAF_SIGNATURE. Não foi desabilitada validação TLS nem reproduzido rejectUnauthorized:false do motor genérico do Recruit.

Evidências sanitizadas: `tmp/softexpert-legado-getworkflow-real.json`, `tmp/softexpert-legado-wsdls-real.json`. Contratos obtidos em `tmp/softexpert-legado-wf_ws.php.wsdl` e `tmp/softexpert-legado-fm_ws.php.wsdl`.

Comprovados: endereço funcional, autenticação para a consulta executada e contratos publicados. Não comprovados: permissão de escrita, mapeamento ITSM, efeitos de validações/eventos, equivalência do histórico e autoria da gravação. Esses itens exigem metadados e homologação específica; leitura não prova escrita.

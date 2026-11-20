# Reavaliação independente da etapa 3.8

Referências: 906d761 (implementação), 224004a (auditoria A1–A5), 5faae5a (A6) e 84056ac (R38-01/R38-02).

**Resultado: revisão aprovada no escopo local combinado. R38-01 e R38-02 corrigidos; nenhum novo impedimento identificado no lote revisado.** A 3.8 pode ser encerrada nesse recorte. Não representa homologação da fundação, liberação dos módulos de negócio ou produção.

## Conferência do código e do ambiente

- Revisados o diff de 84056ac, os testes acrescentados e a organização dos commits das correções de auditoria anteriormente locais.
- Época de identidade/sessão/geração conferida depois das esperas de abertura, revalidação, restauração e salvar/fechar. Respostas e negativas de outra identidade não devem alterar o novo workspace.
- Dados anteriores usados como substituto somente quando a chave muda exclusivamente na revisão de autorização. Identidade, sessão, contexto, recurso e parâmetros continuam separados. ETag do formulário preservado; erro real de consulta remove o substituto.
- Prévia 3003 conferida por hash em workspace.tsx, axios.ts, elo-context.tsx e admin-api.ts: arquivos iguais às fontes atuais. Não foi alterada a cópia .local/review38-web da revisão anterior.
- Árvore de trabalho limpa nas consultas inicial e final. Nenhum fonte, contrato, documento do projeto ou processo de prévia foi alterado pelo revisor. Sem commit ou push.

## Verificações executadas, com recorte solicitado pelo responsável

| Verificação | Resultado | Evidência neste diretório |
| --- | --- | --- |
| Testes web | 34 aprovados, saída 0 | web.log |
| Navegador: somente cenários R38 e regressões diretas | 18/18 aprovados | browser-r38.log; browser/results-r38.json |
| Cenários independentes originais | 5/5 verificações aprovadas, saída 0 | independent.log |
| Diff da correção | git diff-tree --check sem apontamentos | consulta local |

Os 18 cenários incluem troca real de identidade sob o mesmo cookie com resposta retida; ausência de nova aba, endereço, descritor ou aviso da identidade anterior; edição durante revalidação real dos 60 segundos após alteração do órgão pela plataforma; conflito 412 preservando o texto; revogação real do acesso e retirada do conteúdo; restauração do nome sintético do departamento.

Os 5 checks independentes repetem os dois cenários que revelaram as falhas: resposta real autorizada retida até confirmar nova identidade/sessão no descritor e preservação do formulário quando a navegação muda a ação de outra rotina, mantendo consulta e alteração do órgão. Neste segundo teste, a resposta de navegação é simulada via DevTools e a revisão é calculada conforme o contrato; não há alteração de perfil no banco. Os testes não salvaram o rascunho independente.

Não foram repetidos, a pedido do responsável, a suíte completa da API, o roteiro integral de 102 verificações ou nova compilação. O backend não mudou em 84056ac; a revisão anterior executara a suíte de 202 testes sobre as correções depois registradas em 224004a/5faae5a. Resultados anteriores permanecem referências históricas, sem serem contados como execução nova.

Os testes de navegador dirigidos usam dados sintéticos locais e seus efeitos são os previstos no roteiro: nova versão do órgão com os mesmos valores, alteração/restauração do nome de departamento e revogação do acesso de uma sessão de teste ao órgão. Prévias 3001, 3002 e 3003 preservadas.

## Encaminhamento

Registrar o encerramento local da 3.8 no controle e avançar, mediante execução do próximo prompt, para a 3.9 — homologação da fundação. Reutilizar evidências válidas e priorizar cenários integrados de maior risco, com algumas verificações simples, evitando repetição indiscriminada de suítes completas. Não iniciar módulos operacionais nem liberar produção como consequência desta aprovação.

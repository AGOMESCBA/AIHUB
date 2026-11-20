from pathlib import Path
import json
r=Path('C:/Apps/ELOGESTAO');results=json.loads((r/'.local/logs/login-browser/result.json').read_text(encoding='utf-8'))
assert len(results)==14 and all(v['ok'] for v in results)
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8');assert '# 46.' not in s
s=s.replace('Versão 2.40 consolidada','Versão 2.41 consolidada',1)
s=s.replace('disponível para avaliação na porta 3006.','disponível para avaliação na porta 3006. O login e a escolha explícita do órgão, inclusive com uma única opção, foram refinados na seção 46.',1)
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nLogin e escolha explícita — 16 de novembro de 2026, versão 2.41: login estruturado no padrão visual novo, seleção obrigatória do órgão e ambiente mesmo com uma opção, listas com busca/rolagem e cabeçalho com órgão/empresa e secretaria da aba atual. Botão de troca sempre visível; retorno à escolha do órgão disponível inclusive com um órgão, conforme última orientação do responsável. Manual atualizado, 14 verificações de navegador e 6 testes web aprovados; seção 46.\n',1)
s+='''
# 46. Login, escolha explícita e identificação da empresa

## 46.1 Entendimento e decisões do responsável

O responsável questionou os nomes dos cadastros de demonstração, a apresentação de muitas secretarias, o retorno aos órgãos e a organização do login. Em seguida solicitou que a escolha da empresa ocorresse depois do login e que a identificação e a troca permanecessem visíveis mesmo com apenas uma opção. Essa orientação substitui a entrada automática com opção única registrada nas fases anteriores.

Órgão corresponde à empresa/cliente SaaS; secretarias são unidades desse órgão. Os nomes com a palavra sintético vêm das fixtures locais de desenvolvimento, não são rótulos fixos do produto nem nomes de organizações reais. Não foram renomeados ou substituídos silenciosamente nesta entrega; a UI apresenta o nome efetivamente cadastrado.

## 46.2 Entrega implementada

| Área | Comportamento |
| --- | --- |
| Login | Marca, painel institucional no desktop, formulário com hierarquia visual, CPF e senha com preenchimento automático, campo de senha com alternância acessível, botão Entrar no sistema e links de recuperação/convite. Painel omitido no celular. |
| Envio | Botão bloqueado e identificado como ocupado durante o envio; CPF, validação, chamada de autenticação e respostas uniformes existentes preservados. Sem opção de lembrar sessão ou mudança na política de duração. |
| Entrada explícita | Após autenticação, o usuário escolhe o órgão e depois o ambiente autorizado. Não há mais entrada automática no órgão com opção única; plataforma também confirma explicitamente seu ambiente. Sessão já válida continua seguindo o redirecionamento existente do layout autenticado. |
| Muitas opções | Busca acima da lista e altura limitada com rolagem própria, tanto para órgãos quanto ambientes; contagem filtrada/total. O campo de busca não rola junto com os cards. |
| Retorno | Voltar à escolha do órgão retorna à primeira etapa, sem alterar o contexto por si só. Disponível com um órgão, conforme orientação final; não há ocultação desse retorno no recorte entregue. |
| Cabeçalho | Mostra explicitamente Órgão / empresa e Secretaria da aba atual. O botão Trocar empresa ou secretaria é sempre visível, inclusive no celular e para quem possui um único órgão. Plataforma e administração do órgão são identificadas como esses modos. |
| Duas empresas em abas | Ao retornar a uma rotina antiga, o cabeçalho mostra a empresa e secretaria daquela aba. Se a seleção das novas rotinas é diferente, aparece a indicação Novas rotinas com esse outro contexto. Nenhuma aba existente é transferida pela troca do seletor. |

Manual /app/documentacao atualizado em access-manual.tsx. A API, a resolução de contexto, o banco, as permissões e os vínculos não mudaram; a retirada da entrada automática afeta somente a escolha no frontend.

## 46.3 Verificações reais

| Verificação | Resultado |
| --- | --- |
| Build final | Aprovado com tipos e lint; formatação e diff conferidos. |
| Testes web selecionados | 6/6 de isolamento e preservação das abas. Não repetida a suíte Python: backend inalterado. |
| Navegador | 14/14: login estruturado, alinhamento desktop, alternância de senha, 390 px, recuperação acessível, órgão único exige escolha, rolagem e busca entre 12 opções, retorno com um órgão, nomes no cabeçalho, troca sempre visível, cabeçalho em 390 px, empresa da aba antiga preservada e plataforma com escolha explícita. |

O ensaio com 12 ambientes alterou somente a resposta de leitura dentro de um navegador descartável. Nenhuma secretaria foi criada no banco nem houve concessão de permissões; o ensaio voltou a usar uma secretaria real autorizada para entrar. Essa fixture comprova o comportamento visual da lista, não uma concessão de acesso às opções simuladas.

A inspeção da primeira imagem de login identificou desalinhamento real: o componente de notificações participava da grid e deslocava o painel e o formulário. Corrigido movendo as notificações para fora da grid e acrescentado critério de posição do formulário no navegador. A verificação de recuperação foi ajustada para aguardar a mudança efetiva de rota. Uma compilação intermediária iniciada fora do diretório da aplicação falhou por configuração de CSS; a compilação final foi executada no diretório correto e aprovada.

## 46.4 Ambiente e pendências

Endereço de avaliação http://localhost:3006, cópia compilada em .local/login-final-web, API 8012 preservada. Processo atual em .local/login-processes.json; evidências em .local/logs/login-browser e logs login-web.*. As outras prévias não foram reiniciadas. Para avaliar o login com uma sessão existente, use Sair e entre novamente; Ctrl+F5 atualiza os arquivos visuais.

Credenciais e nomes de demonstração locais preservados, sem publicação de segredos, commit, push ou produção. Aceite visual do responsável pendente. Canais de produção de convite/recuperação e demais bloqueios da fundação continuam no planejamento. Os módulos de negócio seguintes não foram iniciados.
'''
p.write_text(s,encoding='utf-8',newline='\r\n');print('Planejamento 2.41 atualizado com escolha explícita e evidências do login/cabeçalho.')

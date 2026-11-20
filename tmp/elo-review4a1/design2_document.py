from pathlib import Path
import json
r=Path('C:/Apps/ELOGESTAO')
results=json.loads((r/'.local/logs/design2-browser/result.json').read_text(encoding='utf-8'))
assert len(results)==10 and all(x['ok'] for x in results)
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8')
assert '# 45.' not in s
s=s.replace('Atualização: 14 de novembro de 2026 • Versão 2.39 consolidada','Atualização: 16 de novembro de 2026 • Versão 2.40 consolidada',1)
s=s.replace('A primeira evolução da experiência de uso está em avaliação na prévia 3007 (44.2 a 44.5).','A primeira evolução visual (44.2 a 44.5) não atendeu à avaliação do responsável; foi substituída pelo redesenho da seção 45, disponível para avaliação na porta 3006.',1)
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nRedesenho da experiência — 16 de novembro de 2026, versão 2.40: após reprovação visual da primeira proposta, seleção independente de órgão/secretaria, nova identidade visual, barra lateral persistente com módulos e cabeçalho compacto. Página inicial prioriza rotinas e remove painel técnico do fluxo normal. Build, 6 testes críticos e 10 cenários de navegador aprovados. Prévia antiga da porta 3006 substituída após identificar seu processo, preservando API e outras prévias. Em avaliação pelo responsável, sem push ou produção; seção 45.\n',1)
s+='''
# 45. Redesenho da experiência — seleção e espaço de trabalho

## 45.1 Problema e direção

Em 16 de novembro de 2026, o responsável avaliou a interface como confusa, pouco organizada e sem identidade visual. As imagens da porta 3006 mostravam seleção de secretaria junto com menu lateral, cabeçalho de contexto e navegação de módulos. A primeira evolução da seção 44 não foi aceita como solução visual definitiva. Novo objetivo: separar a escolha do ambiente da operação e dar hierarquia consistente à navegação, sem alterar permissões nem regras de negócio.

Referência consultada: https://ui.shadcn.com/blocks/dashboard e blocos de sidebar oficiais. Implementação própria adaptada aos componentes e à versão já instalada; sem instalar template ou dependências, copiar dados de outro produto ou incorporar gráficos/indicadores fictícios.

## 45.2 Comportamento entregue

| Área | Entrega |
| --- | --- |
| Identidade | Marca tipográfica Elo Gestão com símbolo de ligação, azul e azul-escuro, acentos suaves em azul e verde, ícones consistentes. |
| Seleção | Tela independente de órgão/ambiente, painel de apresentação no desktop, busca e cards objetivos, passos visíveis e ação de entrar na secretaria ou administração autorizada. Menu, cabeçalho operacional e abas ficam ocultos durante a seleção. |
| Seleção no celular | Painel institucional omitido para priorizar a escolha, marca compacta, busca e opções em uma coluna. |
| Saída e retorno | Sair da conta disponível na seleção com a mesma confirmação para edições/segredos pendentes; retorno ao ambiente atual quando existe contexto. |
| Menu | Barra lateral azul-escura persistente no desktop, módulos Operação/Administração, início, busca, rotinas autorizadas, estado ativo e ajuda. No celular, menu expansível. |
| Cabeçalho | Ambiente destinado às novas rotinas em destaque com botão de troca, identidade e conta/saída; removidas as faixas redundantes. As próprias abas continuam indicando seus contextos originais. |
| Início | Rotinas na primeira área útil da tela, ícones e cores por card, organização e descrições curtas. Diagnóstico técnico e contagem de ações removidos do dashboard de uso cotidiano. |
| Cadastros | Grids, filtros e componentes do lote anterior continuam funcionando no novo shell. Filtros por coluna ainda integrados somente em Veículos. |

## 45.3 Preservação de contexto e limites

WorkspaceProvider permanece no layout; WorkspacePanels mantém sua instância montada e é ocultado durante a seleção. Selecionar outra secretaria altera a seleção das novas rotinas, preservando a edição na aba original. Cache, guardas, resolução de contexto, ações, APIs, RLS, sessões e migrações não foram alterados neste lote. A interface não oferece rotinas que a navegação autorizada não devolve.

Administração do órgão ou da plataforma depende do perfil e do ambiente selecionado. O gestor sintético de transferência continua operacional e não recebeu permissões administrativas. O redesenho não implementa contratos, empenhos, saldos, cotações ou outras etapas de negócio.

## 45.4 Validação executada

| Verificação | Resultado |
| --- | --- |
| Compilação | Build Next.js aprovado, com checagem de tipos e lint; avisos sem erros. Log local design2-build.log. |
| Regressão web proporcional | 6/6: armazenamento mínimo, links por contexto, descarte de respostas de outra identidade, negativas de sessão anterior e preservação de edição/ETag por revisão. |
| Navegador real | 10/10: seleção sem chrome operacional; busca vazia; secretarias autorizadas; seleção em 390 px; cards acima da dobra; módulos/contexto; grid/filtros; edição preservada após troca de secretaria; operação em 390 px; plataforma em Administração. |
| Revisão visual | Imagens de seleção, início, veículos e administração inspecionadas. Não equivale ao aceite estético do responsável nem à auditoria completa de acessibilidade. |

O roteiro foi ajustado para aguardar os dados da navegação e usar o prefixo real aba- no identificador da aba. As primeiras falhas dessas verificações eram do roteiro; o produto não foi alterado para contorná-las. Nenhuma gravação de negócio foi feita pelo ensaio de edição: o texto ficou apenas no formulário do navegador descartável.

## 45.5 Ambiente atual e avaliação

Endereço de referência para esta avaliação: http://localhost:3006/app/contexto?trocar=1. A prévia antiga da porta 3006 foi identificada pelo PID registrado e pelo comando Next.js e substituída somente após o novo build passar. Nova cópia compilada em .local/design-web, processos em .local/design2-processes.json, API existente na 8012 preservada. Outras prévias não foram reiniciadas. Logs e imagens em .local/logs/design2-browser e .local/logs/design2-web.*.

As credenciais permanecem nos arquivos locais já existentes, fora do Git. Avalie seleção, entrada em secretaria, menu, abertura de rotina e troca com aba aberta. Se o navegador ainda mostrar a versão antiga, recarregue com Ctrl+F5. Trabalho local sem commit, sem push e sem produção. Aceite visual do responsável pendente. Filtros das demais grids, manual geral de navegação e demais refinamentos continuam no backlog registrado.
'''
p.write_text(s,encoding='utf-8',newline='\r\n')
print('Controle 2.40 atualizado: redesenho entregue localmente e aguardando avaliação visual.')

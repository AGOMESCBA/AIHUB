from pathlib import Path
import json
r=Path('C:/Apps/ELOGESTAO');demo=json.loads((r/'.local/testes-municipios.json').read_text(encoding='utf-8'));checks=json.loads((r/'.local/logs/municipios-browser/result.json').read_text(encoding='utf-8'));assert len(checks)==8 and all(v['ok'] for v in checks)
p=r/'docs/planejamento-consolidado.md';s=p.read_text(encoding='utf-8');assert '# 47.' not in s
s=s.replace('Versão 2.41 consolidada','Versão 2.42 consolidada',1)
s=s.replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nAvaliação de cadastros — 16 de novembro de 2026, versão 2.42: criados Cuiabá (Saúde/Educação) e Sinop (Meio Ambiente/SEMA/Saúde), com usuário exclusivo de avaliação, administração dos órgãos e gestão dos cadastros. Políticas contrastantes de compartilhamento configuradas, sem registros operacionais de exemplo; 8/8 verificações reais aprovadas. Banco sintético local após backup; seção 47.\n',1)
s+='''
# 47. Cenário de avaliação — Cuiabá e Sinop

Preparação autorizada pelo responsável em 16 de novembro de 2026 para avaliar login, filtros, cadastro, compartilhamento e exclusividade. A terceira secretaria de Sinop foi confirmada como Saúde. Dados exclusivamente de demonstração em elo_gestao_dev; CNPJs e identidade fictícios, sem dados reais ou acesso à produção.

| Órgão / empresa | Secretarias | Fornecedores, produtos próprios e modelos próprios |
| --- | --- | --- |
| Cuiabá | Saúde; Educação | Compartilhados em todo o órgão. |
| Sinop | Meio Ambiente; SEMA; Saúde | Exclusivos da secretaria. |

Frotas, motoristas e veículos permanecem exclusivos por secretaria nos dois órgãos. Produtos e modelos da base da plataforma seguem suas regras de referência comum; não são itens próprios do órgão. Não há compartilhamento de dados próprios entre Cuiabá e Sinop.

Criada identidade dedicada Gestor de testes — Cuiabá e Sinop, com vínculo interno somente nesses dois órgãos, ORG-ADM/all_future e GES/all_current cobrindo as secretarias atuais. Sem atribuição de plataforma. O bootstrap local reutilizou as estruturas e os perfis existentes e registrou os cadastros e a preparação dos acessos em audit_events; nenhuma permissão global foi alterada. Credenciais somente em .local/testes-municipios.json, fora do Git, e fornecidas diretamente ao responsável; não reproduzidas neste documento.

Fornecedores e demais itens próprios dos novos órgãos foram deixados vazios para o responsável cadastrar. Políticas criadas antes de registros, nas três famílias implementadas. Alterar a política depois de cadastrar registros continua sujeito à regra de migração existente; esta preparação não remove esse controle.

Verificação proporcional no navegador e na API atual: 8/8 — login lista apenas os dois órgãos; duas/três secretarias corretas; cadastro autorizado nas cinco secretarias; seis políticas corretas e sem registros; fornecedores vazios; administração dos dois órgãos disponível; tela de fornecedores em Cuiabá pronta; troca para Sinop com contexto correto. Sem criar fornecedores ou outros itens operacionais durante o ensaio. Logs e imagens em .local/logs/municipios-browser. Não repetidos build ou suítes do produto: nenhum código ou schema alterado.

Roteiro de avaliação: sair da identidade anterior e usar o novo login em http://localhost:3006. Cadastrar fornecedor em Cuiabá/Saúde e consultar em Educação (visível); cadastrar em Sinop/Meio Ambiente e consultar em SEMA ou Saúde (não visível); confirmar que registros de Cuiabá não aparecem em Sinop. Para gerenciar a configuração, selecionar Modo administrativo do órgão e abrir Compartilhamento.

'''+f"Backup anterior à criação: {demo['backup']}. Dados existentes preservados. A primeira tentativa de preparação foi revertida integralmente pela transação após um erro de parâmetro no script, corrigido antes da criação válida. Sem migrações, commit, push ou produção.\n"
p.write_text(s,encoding='utf-8',newline='\r\n');print('Controle 2.42 atualizado com o cenário de avaliação e suas evidências, sem credenciais.')

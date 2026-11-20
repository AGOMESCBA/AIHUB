from pathlib import Path
import re

path=Path(r'C:/Apps/ELOGESTAO/docs/planejamento-consolidado.md')
raw=path.read_bytes()
newline='\r\n' if b'\r\n' in raw else '\n'
bom=raw.startswith(b'\xef\xbb\xbf')
source=raw.decode('utf-8-sig').replace('\r\n','\n')
assert '# 37.' not in source, 'Seção 37 já existe; revisão manual necessária.'
versions=[tuple(map(int,m)) for m in re.findall(r'vers[ãa]o\s+(\d+)\.(\d+)',source,re.I)]
major,minor=max(versions)
version=f'{major}.{minor+1}'

def replace(old,new):
    global source
    assert source.count(old)==1, f'Âncora ausente ou ambígua: {old[:75]}'
    source=source.replace(old,new,1)

def line(prefix,new):
    matches=[s for s in source.splitlines() if s.startswith(prefix)]
    assert len(matches)==1, f'Linha ausente ou ambígua: {prefix}'
    replace(matches[0],new)

line('Atualização:',f'Atualização: 13 de novembro de 2026 • Versão {version} consolidada • Documento único de referência')
line('**Situação desta entrega:**','**Situação desta entrega:** Fases 1 e 2 concluídas no recorte documentado. A matriz 3.1 (26) foi adotada e a 3.2 foi concluída como especificação (28). As etapas 3.3 a 3.8 estão encerradas nos recortes registrados (30 a 35). A homologação da fundação 3.9 foi aprovada tecnicamente sobre da00605 e seu encerramento local foi autorizado pelo responsável (36.11). O sistema dispõe de estrutura organizacional, acessos, autenticação, isolamento, Administração e rotinas em abas no ambiente sintético local. Os módulos de negócio seguem pendentes; o próximo sublote planejado é 4A.1 — fornecedores e tipos de fornecedor, com prompt na seção 37, ainda sem implementação iniciada. Permanecem as limitações e os bloqueios de produção de 36.6. O controle do projeto está em /app/projeto e o manual das funcionalidades entregues em /app/documentacao.')
line('| Fundação — Fase 3 |','| Fundação — Fase 3 | 3.1 adotada; 3.2 especificada; 3.3 a 3.9 concluídas nos recortes locais registrados. Aprovação e encerramento da fundação em 36.11. | Preparar a execução da 4A.1, preservando as pendências de produção. |')
line('| 3 — organização e acesso |','| 3 — organização e acesso | Concluída no recorte local; homologação 3.9 aprovada (36.11). | Estrutura organizacional, identidades/vínculos, autorização, autenticação/sessões, RLS, Administração, navegação e abas, conforme seções 30 a 36. | Integrar os módulos 4A–4E e resolver as pendências de produção de 36.6. |')
replace('| 4A — cadastros | Pendente | Há telas e APIs legadas parcialmente incompatíveis. | Contratos API, regras, segurança, adaptação da UI e testes de todos os cadastros. |','| 4A — cadastros | Próxima; 4A.1 planejada, sem implementação iniciada (37). | Fontes e telas legadas a reconciliar com as APIs e políticas da fundação. | Primeiro sublote: fornecedores e tipos de fornecedor; demais cadastros em sublotes próprios. |')
line('| 3.9 |','| 3.9 | Concluída no recorte local (36.11) | Homologação da fundação: matriz 36.4, verificações da entrega e restauração em banco descartável; revisão independente com 12/12 de banco e 10/10 HTTP. | Etapas 3.3 a 3.8 com evidências; entrega da00605 revisada e aprovação registrada por ordem do responsável. | Pendências de produção preservadas em 36.6; 4A.1 apenas planejada (37). |')
replace('## 24.6 Registro das entregas e mudanças de direção\n','## 24.6 Registro das entregas e mudanças de direção\n\nEncerramento da 3.9 — 13 de novembro de 2026: revisão técnica de da00605 aprovada no recorte local; 12/12 verificações independentes do banco e 10/10 cenários HTTP. O responsável determinou registrar a aprovação e fazer commit (36.11). Resumo atual e quadro de atividades atualizados; prompt completo da 4A.1 registrado na seção 37, sem início da implementação, push ou produção.\n')
replace('**Em revisão**, desde 13 de novembro de 2026, sobre a branch fase-2-ambiente-local, HEAD 84056ac, worktree limpa no início e nenhuma alteração de outras sessões no Git.','**Concluída no recorte local**, com aprovação técnica e encerramento autorizados pelo responsável em 13 de novembro de 2026 (36.11). A execução partiu de 84056ac, com árvore limpa, e foi registrada em da00605, na branch fase-2-ambiente-local.')
replace('Revisão independente e aceite do responsável: **pendentes**. A 3.9 permanece Em revisão.','Revisão independente de da00605: **aprovada no recorte local**. O responsável autorizou registrar a aprovação e fazer commit. A 3.9 está **concluída no recorte local**, conforme 36.11; as limitações de produção permanecem em 36.6.')
replace('1. Revisão independente da 3.9 e aceite do responsável.','1. Revisão técnica da 3.9 aprovada e encerramento local autorizado pelo responsável: atendido (36.11).')
replace('2. Ordem e escopo do primeiro sublote da 4A confirmados (25.12: fornecedores/tipos, produtos/unidades, combustíveis, modelos/categorias, frotas, motoristas e veículos).','2. Primeiro sublote preparado: 4A.1 — fornecedores e tipos de fornecedor (37), sem início da implementação. Os demais cadastros seguem a ordem de dependências de 25.12.')
replace('3. Para cada cadastro: política de compartilhamento P3 (exclusivo da secretaria ou todo o órgão), mapeamento dos campos legados e necessidade de anexos.','3. Aplicar P3 já decidida: fornecedores compartilhados no órgão por padrão, com exclusividade por secretaria conforme política. Tipos de fornecedor são referências da plataforma, somente leitura para órgãos (28.5). Produzir o mapeamento dos campos nos fontes existentes antes de implementar; classificação/importação de dados reais permanece na fase própria.')
replace('Após o aceite da 3.9: **4A — cadastros integrados**, pelo primeiro sublote de 25.12, com contrato de API antes da tela, propriedade organizacional, política P3, validações, permissões, filtros, paginação, vínculos e testes de acesso negado. Decisões necessárias antes de iniciá-la: ordem e escopo do sublote; política de compartilhamento por cadastro; mapeamento dos campos legados; armazenamento de anexos, se exigido. Em paralelo, sem bloquear a 4A local: canal de produção para convites e recuperação, MFA de administradores e D06.','Próxima entrega: **4A.1 — fornecedores e tipos de fornecedor**, primeiro sublote de 25.12, com prompt completo na seção 37. O planejamento mantém P3 e a natureza de catálogo da plataforma dos tipos de fornecedor. O mapeamento dos campos é trabalho técnico sobre os fontes existentes; divergências funcionais impeditivas devem ser apresentadas antes de alterar a estrutura. Anexos ficam fora do primeiro sublote salvo dependência funcional demonstrada e decisão específica. P4/D13 serão tratadas no lote de frotas/motoristas. Canal de produção, MFA e D06 continuam registrados para seus prazos, sem bloquear o desenvolvimento local deste cadastro.')
replace('A 3.9 permanece **Em revisão** até a conferência independente e o aceite correspondente. Não houve push nem início da fase seguinte.','A 3.9 está **concluída no recorte local** conforme 36.11. A seção 37 contém somente o prompt planejado da fase seguinte; não houve push, produção ou início da implementação da 4A.1.')
replace('Idêntico ao original; banco descartável removido','Igual nas métricas comparadas; banco descartável removido')
replace('Restauração idêntica em banco descartável','Restauração em banco descartável com métricas equivalentes às da origem')

approval='''

## 36.11 Aprovação técnica e encerramento local

Registrado em 13 de novembro de 2026 por determinação do responsável: **“Registre a aprovação, faça o commit e gere o prompt da próxima fase”**. A revisão independente do commit da00605 foi aprovada no recorte local implementado, sem impedimento de produto encontrado na amostra. A etapa 3.9 está **concluída no recorte local**; a fundação permite iniciar a integração dos módulos, mantendo todos os limites de 36.6.

Na revisão independente foram executadas **12/12 verificações do banco**, com a conexão real da API e reutilização da mesma conexão física, e **10/10 cenários HTTP**. A amostra HTTP confirmou permissões distintas por órgão; PUT cruzado com corpo válido e versão atual; referência cruzada de departamento com todos os campos obrigatórios, alcançando a regra de propriedade; ausência de gravação indevida; plataforma sem operação implícita; administrador sem leitura de outro órgão; revogação limitada a A preservando B; saída com recusa do token anterior. As sessões criadas pelo ensaio foram encerradas.

Conferidos o diff, a matriz 36.4, o relatório do navegador entregue (114/114), a existência e o tamanho do backup e a evidência da restauração na revisão elo_fase3_0012. Não foram repetidos pelo revisor os roteiros completos, build ou restauração. O backend permaneceu igual ao da evidência anterior de 202 testes. Distinguir essas evidências anteriores das 22 verificações novas do revisor.

Precisões de evidência: dois casos do roteiro HTTP original utilizam corpos incompletos e aceitam 422; essas respostas, isoladamente, não provam a regra de propriedade. A revisão repetiu os casos com corpos válidos e confirmou o isolamento. Na restauração, “igual” refere-se às revisões, contagens e características efetivamente comparadas, não à comparação integral de cada registro ou de todas as definições SQL.

Esta aprovação não representa liberação de produção, homologação dos módulos 4A–4E ou autorização para usar dados reais. O registro não atribui ao responsável execução pessoal de testes adicionais. As pendências de acessibilidade e piloto permanecem documentadas.
'''
prompt=Path(r'C:/Apps/iahub/tmp/elo-review39-da00605/prompt-4A1.txt').read_text(encoding='utf-8').strip()
source=source.rstrip()+approval+'\n# 37. Etapa 4A.1 — fornecedores e tipos de fornecedor\n\n## 37.1 Situação e escopo\n\n**Planejada — prompt preparado; implementação não iniciada.** Primeiro sublote da 4A, após a aprovação local da fundação. Fornecedores são cadastros do órgão, compartilhados por padrão conforme P3; tipos de fornecedor são catálogo da plataforma. O prompt abaixo define a execução delimitada, sem concluir os demais cadastros e sem reabrir decisões já tomadas.\n\n## 37.2 Prompt completo de execução\n\n```text\n'+prompt+'\n```\n'
assert source.count('## 36.11 ')==1 and source.count('# 37. ')==1
assert source.count(prompt)==1
encoded=source.replace('\n',newline).encode('utf-8')
path.write_bytes((b'\xef\xbb\xbf' if bom else b'')+encoded)
print(f'Aprovação 3.9 e prompt 4A.1 registrados; versão {version}; formato de linhas preservado.')

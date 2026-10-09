# IA Service — Checklist de Pré-Publicação (Estabilização 2026-10-09)

Data: 2026-10-09

## 1. Conferência do diff

- [x] Diff completo de todas as alterações não commitadas inspecionado antes do commit.
- [x] Correções de estabilização investigativa confirmadas presentes: classificador de turno, redação no atalho curto, repetição semântica, pendência externa.
- [x] Correções de fallback multi-provider confirmadas presentes: classificação de contexto excedido, TLS global, `insufficient_quota`, bug de billing/rate-limit.
- [x] Alterações visuais do Radar/WhatsApp identificadas separadamente e **não incluídas** no commit de estabilização — comitadas em commit próprio (`4321ebf`), justificado como trabalho pré-existente já validado pelo usuário fora desta sessão.
- [x] Nenhum arquivo temporário, credencial, dado pessoal, banco SQLite, anexo ou log entre os arquivos preparados — confirmado por busca de padrão nos 13 arquivos do commit de estabilização e por verificação independente do ZIP gerado.
- [x] Nenhuma mudança exige alteração destrutiva de banco — confirmado por diff vazio em `apps/IA Service/backend/database/` (migrations.js não tocado).
- [x] Testes automatizados executados novamente antes do commit: 38/38 arquivos, 0 falhas.

## 2. Segurança dos dados produtivos

- [x] Pacote não sobrescreve bancos de dados — `0-gerar-pacote.ps1` exclui `data/`, `*.db`, `*.sqlite*` (confirmado por `Test-ZipEntryUnsafe` interno + verificação independente).
- [x] Pacote não substitui configurações/credenciais produtivas — `.env` excluído do pacote, preservado pelo `3-atualizar.ps1`.
- [x] Pacote não exclui históricos de atendimentos — nenhum código de exclusão/limpeza tocado nesta entrega.
- [x] Nenhuma reimportação automática do SoftExpert nesta entrega — não executada, não codificada, explicitamente fora do escopo.
- [x] Pacote não apaga anexos — `uploads`/diretório de anexos excluído do pacote; nenhum código de `armazenamento-anexos.js` tocado.
- [x] Nenhuma tabela reinicializada — nenhuma migration nova, nenhum `DROP`/`DELETE FROM` em qualquer arquivo alterado.
- [x] Nenhuma migration destrutiva — `migrations.js` idêntico ao da publicação anterior (v41 como última versão).
- [x] Isolamento multiempresa não alterado — nenhum arquivo de resolução de empresa/tenant tocado nesta entrega (confirmado por escopo do diff).
- [x] Comportamento do instalador/processo de atualização verificado — `3-atualizar.ps1` e `0-gerar-pacote.ps1` inspecionados; mecanismo idêntico ao já documentado e usado na publicação anterior, não modificado.

## 3. Versionamento

- [x] Commit específico para a estabilização preparado: `01f26b7` (13 arquivos).
- [x] Commit separado para alterações não relacionadas: `4321ebf` (3 arquivos), identificado e justificado.
- [x] Arquivos incluídos registrados em `IA_SERVICE_MANIFESTO_PUBLICACAO_20261009.md`.
- [x] Manifesto de alterações gerado (este conjunto de 3 documentos + o manifesto detalhado do ZIP em `tmp/manifesto-pacote-20261009_1025.csv`).
- [x] Referência ao pacote anterior preservada: `0aac1aa` citado e não sobrescrito; documentos da publicação anterior (`IA_SERVICE_MANIFESTO_PUBLICACAO.md`, `IA_SERVICE_PLANO_IMPLANTACAO_ROLLBACK.md`, `IA_SERVICE_PRE_PUBLICACAO_CHECKLIST.md`) preservados sem alteração, com sufixo de data nos documentos desta rodada para não colidir.
- [ ] **Push não executado** — aguardando autorização explícita do usuário.

## 4. Pacote de publicação

- [x] Nome e versão: `iahub-deploy-20261009_1025.zip`.
- [x] Manifesto de arquivos: `tmp/manifesto-pacote-20261009_1025.csv` (654 entradas).
- [x] SHA-256: `F28EB809BD8532134B2B893D5631511A9F1E3917CF376FB5CD34A59039ACF503`.
- [x] Checklist de implantação: `IA_SERVICE_PLANO_IMPLANTACAO_ROLLBACK_20261009.md`.
- [x] Plano de rollback: incluído no mesmo documento acima.
- [x] Relação de mudanças: `IA_SERVICE_MANIFESTO_PUBLICACAO_20261009.md`.
- [x] Testes executados: documentados no manifesto (38/38, + execução real).
- [x] Pacote não contém bancos, `.env`, credenciais, anexos ou dados temporários — confirmado.
- [x] Pacote gerado pelo script oficial (`0-gerar-pacote.ps1`), sem contornar ou modificar o mecanismo.

## 5. Validação operacional (pendente — requer ambiente real pós-publicação)

- [ ] Inicialização do IA HUB e IA Service — a verificar após deploy real.
- [ ] Autenticação e isolamento multiempresa — a verificar.
- [ ] Atendimento e Radar — a verificar.
- [ ] Consulta ao histórico — a verificar.
- [ ] Investigação com provider principal — a verificar.
- [ ] Fallback automático — a verificar (roteiro específico documentado).
- [ ] Quality Gate — a verificar (roteiro específico documentado).
- [ ] Reconhecimento de pendência externa — a verificar (roteiro específico documentado).
- [ ] Registro de auditoria — a verificar.
- [ ] Preservação dos dados existentes — a verificar (comparação de contagens antes/depois).

Roteiro completo de cada item em `IA_SERVICE_PLANO_IMPLANTACAO_ROLLBACK_20261009.md`, seção "APÓS a publicação".

## 6. Limites respeitados nesta etapa

- [x] Commit e pacote preparados; **implantação produtiva não executada**.
- [x] Nenhuma reimportação do SoftExpert realizada.
- [x] Fases 4 e 5 não iniciadas.
- [x] Nenhuma funcionalidade nova implementada (somente correções de causa-raiz já homologadas em sessões anteriores).

---

**Resultado: PRONTO PARA AUTORIZAÇÃO DE PUSH.** Deploy produtivo permanece como etapa separada, a ser autorizada e executada manualmente pelo responsável com acesso ao servidor, seguindo o roteiro documentado.

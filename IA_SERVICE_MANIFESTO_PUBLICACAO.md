# IA Service — Manifesto de Publicação (Estabilização Investigativa + Fallback Multi-Provider)

Data: 2026-10-09

---

## Identificação

- **Branch:** `feature/ia-command-multi-turn`
- **Repositório remoto:** `origin` → `https://github.com/AGOMESCBA/AIHUB.git`
- **Commit final (HEAD):** `4321ebf` (ver abaixo)
- **Status do push:** **NÃO EXECUTADO** — aguardando autorização explícita do usuário, conforme restrição desta tarefa.
- **Publicação anterior de referência:** commit `0aac1aa6987ed0298b2b270105d780a007d26273`, pacote `iahub-deploy-20261008_1458.zip` (ver `IA_SERVICE_MANIFESTO_PUBLICACAO.md`, documento preservado sem alteração).

### Commits incluídos nesta entrega

| Commit | Escopo | Arquivos |
|---|---|---|
| `01f26b7` | **Estabilização do motor investigativo + fallback multi-provider** (esta entrega) | 13 arquivos |
| `4321ebf` | IA Command — escolha múltipla de empresas no WhatsApp; IA Service/Radar — exibição de título e badge de situação de retorno. **Não relacionado à estabilização**; trabalho pré-existente na working tree, já validado pelo usuário fora desta sessão, commitado separadamente por assunto a pedido explícito. | 3 arquivos |

Referência histórica preservada: `0aac1aa` (publicação anterior, Fases 1-3) permanece como o commit-base desta série — nenhum dos dois commits acima o reverte ou sobrescreve.

---

## Arquivos incluídos no commit `01f26b7` (estabilização)

| Arquivo | Natureza |
|---|---|
| `apps/IA Service/backend/services/ai-provider-client.js` | Correção — classificação de erro do fallback multi-provider |
| `apps/IA Service/backend/services/context-engine.js` | Correção — reconhecimento de pendência externa consolidada |
| `apps/IA Service/backend/services/investigacao-service.js` | Correção — classificador de turno, redação no atalho curto, teto de tentativas |
| `apps/IA Service/backend/services/prompt-builder.js` | Correção — instrução de ações operacionais já comunicadas |
| `apps/IA Service/backend/services/quality-gate-service.js` | Correção — repetição semântica de hipótese, pendência externa ignorada |
| `apps/IA Service/backend/services/redaction-service.js` | Correção — mascaramento de CPF/CNPJ |
| `apps/IA Service/tests/ai-provider-retry.test.js` | Teste — 11 cenários do fallback multi-provider (expandido de 2) |
| `apps/IA Service/tests/estabilizacao-casos-reais-2026-10.test.js` | Teste — novo, 11 cenários dos 3 casos reais + adversariais |
| `IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md` | Documentação — auditoria de causas-raiz |
| `IA_SERVICE_AUDITORIA_FALLBACK_MULTIPROVIDER.md` | Documentação — auditoria do roteador multi-provider |
| `IA_SERVICE_CORRECOES_MOTOR_INVESTIGATIVO.md` | Documentação — correções implementadas |
| `IA_SERVICE_HOMOLOGACAO_REAL_ESTABILIZACAO.md` | Documentação — homologação com execução real |
| `IA_SERVICE_REGRESSAO_CHAMADOS_REAIS.md` | Documentação — comparação antes/depois dos 3 casos |

**Nenhuma migration de banco** (`apps/IA Service/backend/database/migrations.js` não foi alterado nesta entrega — última versão permanece v41, idêntica à publicação anterior). **Nenhum provider novo adicionado.** **Nenhum arquivo de dados, `.env`, credencial, banco SQLite, anexo ou log incluído** (confirmado por inspeção do diff e por verificação independente do conteúdo do ZIP gerado).

## Arquivos incluídos no commit `4321ebf` (não relacionado, separado por assunto)

| Arquivo | Natureza |
|---|---|
| `apps/IA Command/modules/whatsapp/service.js` | Feature — preserva escopo multiempresa em conversa contínua |
| `apps/IA Service/frontend/radar.html` | Visual — título do card sem repetição, badge de situação de retorno |
| `repomix-output.xml` | Artefato de contexto do projeto (não é código de produção) |

Estes 3 arquivos **não foram testados nem revisados em profundidade nesta sessão** — o usuário confirmou que já os validou em outro momento. Separados em commit próprio justamente para não misturar o nível de confiança com a estabilização, que teve testes e execução real completos nesta sessão.

---

## Testes executados

- **Suíte completa do IA Service**: 38 arquivos de teste, **0 falhas** — executada 3 vezes nesta sessão (antes do commit, após cada correção relevante, e após os 2 commits finais).
- **`ai-provider-retry.test.js`**: 11 cenários (fallback multi-provider), incluindo regressão do bug real de classificação "billing vs. rate-limit".
- **`estabilizacao-casos-reais-2026-10.test.js`**: 11 cenários (3 casos reais sintéticos + 8 adversariais).
- **Execução real com provider**: múltiplas chamadas a GROQ/OpenAI ao longo das sessões de homologação, incluindo reprodução real do padrão de repetição semântica (severidade alta confirmada) e do reconhecimento de pendência externa (seção dedicada confirmada na resposta real) — ver `IA_SERVICE_HOMOLOGACAO_REAL_ESTABILIZACAO.md`, seção 12.4, para o detalhe completo antes/depois.

Nenhum teste foi pulado, modificado para passar artificialmente, ou tornado `skip`.

---

## Pacote de publicação

- **Nome:** `iahub-deploy-20261009_1025.zip`
- **Localização:** `C:\Users\aless\Desktop\iahub-deploy-20261009_1025.zip`
- **Tamanho comprimido:** 8.6 MB
- **Tamanho descomprimido:** 18.369.361 bytes (~17,5 MB)
- **Total de entradas:** 654 arquivos
- **SHA-256:** `F28EB809BD8532134B2B893D5631511A9F1E3917CF376FB5CD34A59039ACF503`
- **Gerado por:** `deploy\0-gerar-pacote.ps1` (script oficial do projeto, não modificado, não contornado)
- **Manifesto detalhado (nome, tamanho, tamanho comprimido de cada arquivo):** `tmp/manifesto-pacote-20261009_1025.csv` (não versionado — artefato local desta publicação)

### Validação de segurança do pacote

Duas verificações independentes, ambas sem nenhum achado:
1. **Validação interna do script** (`Test-ZipEntryUnsafe`, já embutida em `0-gerar-pacote.ps1`): verifica que toda entrada está sob `iahub/`, sem `..`/caminho absoluto, fora de diretórios protegidos (`data`, `uploads`, `sessions`, `.wwebjs_auth`, `.wwebjs_cache`, `logs`, `backups`, `node_modules`) e sem arquivos protegidos (`.env`, `data.json`, `*.db`/`*.sqlite*`). O script **aborta e apaga o ZIP automaticamente** se encontrar qualquer violação — não encontrou nenhuma.
2. **Verificação independente** (fora do script, feita nesta sessão): busca por padrões de caminho perigoso em todas as 654 entradas do ZIP já gerado — **0 entradas perigosas encontradas**.

O pacote **não contém**: bancos de dados, arquivo `.env`, credenciais, anexos de atendimento, logs, diretório `node_modules`, diretório `.git`, diretório `tests/` (excluído deliberadamente pelo script — testes não são artefato de produção).

---

## Confirmação de ausência de alteração destrutiva de banco

- Nenhuma migration nova nesta entrega (`migrations.js` não tocado; última versão permanece v41).
- Nenhuma rota/script de reimportação do SoftExpert foi executada ou alterada.
- Nenhum código de `zerarBaseFonte`/`limparHistoricoFonte` foi tocado.
- O comportamento de `inicializarDB()` (migrations rodam automaticamente no boot, idempotentes via `CREATE TABLE IF NOT EXISTS`) permanece inalterado — ver `IA_SERVICE_PLANO_IMPLANTACAO_ROLLBACK_20261009.md`, seção "Como as migrations funcionam", para o detalhe herdado da publicação anterior (mecanismo não mudou).

---

## Classificação final

**A — Pacote apto para publicação controlada.**

Critérios atendidos: suíte completa aprovada sem exceção (38/38); correções da estabilização validadas com execução real, não apenas testes determinísticos; alterações Git revisadas e separadas por assunto (estabilização vs. trabalho não relacionado); commits realizados corretamente, push **não** realizado (aguardando autorização); pacote gerado pelo script oficial, verificado como íntegro e livre de dados/segredos por duas verificações independentes; nenhuma migration nova, nenhuma alteração destrutiva de banco; nenhum provider novo; roteiro de implantação e rollback herda o mecanismo já documentado e testado na publicação anterior, sem necessidade de mudança.

Esta classificação refere-se à **preparação técnica do pacote e do processo**. A homologação operacional completa em produção real (autenticação real, Radar com dados reais, fallback real sob carga de produção) permanece pendente de execução após a publicação efetiva — ver seção de Validação Operacional no documento de rollback/implantação.

**Nenhum push foi executado. Nenhum deploy foi executado. Nenhum serviço de produção foi iniciado, parado ou reiniciado. Nenhuma migration foi aplicada contra banco real.**

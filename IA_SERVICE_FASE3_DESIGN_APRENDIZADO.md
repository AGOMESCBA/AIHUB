# IA Service — Fase 3: Aprendizado entre Chamados (Documento de Design)

Data: 2026-10-08
Status: **proposta de design, nenhum código implementado**. Depende da Fase 2 (confirmação do analista) estar concluída — hoje em andamento pelo usuário, sem artefato de código ainda (nenhuma migration, campo ou rota de "Resolveu/Não resolveu/Parcial" existe no repo nesta data).

## 1. Objetivo da Fase 3 (recorte exato do roadmap)

> "Transformar soluções confirmadas em conhecimento reutilizável para outros chamados semelhantes, respeitando permissões, versões e contexto técnico."

Três palavras do próprio enunciado já são a guarda de design: **confirmadas** (não qualquer solução proposta), **respeitando versões** (uma correção pode não valer em outro build), **contexto técnico** (customizado vs. padrão, módulo, ambiente).

## 2. O que já existe hoje (base real, validada em código)

- `chamado-repository.listarChamadosRelacionados` + `_pontuarSimilaridade`: já encontra chamados parecidos por tokens textuais + campos estruturais (produto/módulo/serviço/família), sem embeddings. `temSolucaoAplicada` já existe como metadado mas **não influencia o score** hoje.
- `technical-research-service.formatarContextoParaPrompt`: já injeta chamados semelhantes no prompt, incluindo posicionamentos e indicação de solução aplicada — é só texto, a IA decide se é relevante.
- `investigacao_dossies` já tem `solucao_proposta`, `solucao_aplicada`, `resultado_validacao`, mas **preenchidos pela própria IA interpretando o turno**, não por confirmação humana explícita — é exatamente isso que a Fase 2 está mudando agora.
- `quality-gate-service` e `investigative-discipline-service` nunca usam solução de *outro* chamado como critério — toda disciplina de evidência é escopada ao chamado atual.
- **Nenhuma tabela de "conhecimento validado"** existe no IA Service. Zero precedente de embeddings nesse módulo.

## 3. Precedente interno que deve ser seguido (não um produto externo)

O IA Command já resolveu, para outro domínio (cache de NL→SQL), exatamente o mesmo problema estrutural: "como aprender com segurança a partir de interações passadas, sem virar fonte de erro silencioso". Ver `apps/IA Command/docs/aprendizado-cache-nlsql-plano.md`. Padrão usado lá, que deve ser **herdado como filosofia**, não copiado literalmente:

- Progressão em etapas atrás de **flag**, nunca ativa por padrão.
- **Quarentena temporal**: sucesso entra `pendente`, só vira `confiavel` depois de um tempo sem feedback negativo.
- **Shadow mode** antes de qualquer auto-aplicação: mede precisão real comparando candidato vs. resultado real, sem nunca servir o candidato.
- Separação dura entre "candidato sugerido no prompt" (few-shot/orientação) e "auto-reuse" (execução automática) — o segundo só libera com `política persistida como liberada` + threshold de precisão alto (ex. ≥99,5%) + revalidação pelos guards de segurança de sempre.
- Configuração por empresa, nunca global.

A Fase 3 do IA Service deve ser a tradução desse padrão para o domínio de suporte técnico, não uma arquitetura nova.

## 4. Por que não copiar literatura de CBR/RAG "de livro"

A pesquisa de mercado (KCS, CBR clássico, Intercom Fin) confirma a mesma filosofia por um caminho diferente — e aponta os riscos específicos do domínio Protheus/SoftExpert:

- **"Confirmação é candidatura, não promoção."** Um "Resolveu" isolado (n=1) nunca deve virar precedente aplicado automaticamente — só sugestão a investigar. Confiança cresce com reuso bem-sucedido *repetido em contextos distintos* (padrão KCS: "reuse is review").
- **Sintoma ≠ causa raiz.** Dois chamados com erro textualmente idêntico podem ter causas diferentes se a versão/build, ou se o fonte é customizado vs. padrão, mudar. Isso é o risco dominante em ERP — reuso por similaridade textual sem checar `applicability conditions` é o jeito certo de propagar um diagnóstico errado.
- **"Não resolveu" é sinal de primeira classe**, não ruído a ignorar. Um caso que falhou deve rebaixar a própria prioridade de reuso daquele precedente (conceito de *detrimental retrieval* da literatura de CBR) — isso é fácil de esquecer porque intuitivamente só queremos modelar sucesso.
- **Reuso de hipótese ≠ reuso de fonte corrigido.** Sugerir "talvez seja a mesma causa do chamado #4821" é barato e reversível. Reaplicar automaticamente um fonte corrigido de outro chamado é uma ação de alto custo de erro — precisa de um gate de confiança muito mais alto, nunca o mesmo.
- **Staleness real tem gatilho conhecido aqui**: atualização de versão/pacote do Protheus deve invalidar em massa qualquer conhecimento cuja aplicabilidade dependia da versão anterior — mais confiável que qualquer decay por tempo.
- **Explicabilidade por delta, não por score.** O analista precisa ver "precedente X, mesma causa confirmada, mas versão Y lá vs. Z aqui; lá era fonte padrão, aqui é customizado" — não um número de similaridade, que não é auditável por humano.
- **Keyword/estrutural antes de embeddings.** Com o volume atual do IA Service (chamados por empresa, não milhões), o ganho de embeddings é marginal e o risco de "parecido no texto, causa diferente" é o problema real — não resolvido por vetores, resolvido por `applicability conditions` explícitas. Adicionar embeddings fica pendente para quando o volume justificar.

## 5. Proposta de arquitetura incremental (traduzindo o precedente do IA Command)

### Etapa 3.0 — Fundação: o que é um "caso confirmado"

Pré-requisito: Fase 2 concluída (confirmação do analista gravada em algum campo estruturado, não só texto livre da IA). **Não desenhar o schema desta etapa até ver exatamente o que a Fase 2 deixar no dossiê** — é o próximo passo imediato de verificação, não suposição.

Depois disso, criar uma tabela nova (nome provisório `solucoes_candidatas`), nunca reaproveitar `investigacao_dossies` para isso (dossiê é por atendimento; conhecimento reutilizável é uma entidade própria, com ciclo de vida diferente). Campos mínimos:
- `empresa_id` (obrigatório, igual a todo o resto do schema).
- Proveniência: `dossie_id`, `atendimento_id`, `chamado_id` (origem do caso).
- O triplo CBR: `problema_resumo`, `causa_raiz_confirmada`, `solucao_aplicada_texto` (+ referência a `anexo_versao_id` quando a solução incluir fonte corrigido).
- **Applicability conditions** como campos estruturados, não texto livre: `produto`, `modulo`, `versao_sistema` (quando disponível), `e_customizado` (booleano — fonte padrão vs. customizado do cliente), `ambiente_json` (livre para o que não tiver campo próprio ainda).
- Estado KCS-like: `status` (`candidata` | `confirmada_analista` | `reforcada` | `rebaixada` | `arquivada`) — nunca pular direto para "validada global".
- Contadores de reuso: `vezes_sugerida`, `vezes_confirmada_em_outro_chamado`, `vezes_rejeitada_em_outro_chamado`.
- `criado_em`, `atualizado_em`, janela de quarentena equivalente (`promovivel_apos`), igual ao padrão `IAC_NLSQL_CACHE_QUARANTINE_MINUTES`.

Gatilho de criação: quando a Fase 2 registrar "Resolveu" (não "Parcial", não "Não resolveu") em um dossiê, criar uma linha em `status = 'candidata'`. Atrás de flag (`IA_SERVICE_APRENDIZADO_CANDIDATAS=1`), desligada por padrão.

### Etapa 3.A — Sugestão no prompt (few-shot consultivo, nunca auto-aplicação)

Estender `technical-research-service` (ou criar `solucao-conhecimento-service.js` ao lado) para buscar candidatas da mesma empresa com `produto`/`modulo` iguais e score textual mínimo (reaproveitar `_tokensDeBusca`/`_pontuarSimilaridade` de `chamado-repository.js`, não duplicar a lógica). Diferencial: o filtro de aplicabilidade (versão, customizado/padrão) é **obrigatório antes de score**, não um bônus — ausência de dado de versão não deve ser tratada como "qualquer versão serve".

Formatar no prompt como "Solução confirmada em chamado anterior (contexto: ...)", sempre citando as condições de aplicabilidade divergentes explicitamente (ex. "versão do precedente: 12.1.2310; deste chamado: desconhecida — valide antes de aplicar"). A IA nunca aplica — só cita como hipótese a verificar, igual ao comportamento já existente para "chamados semelhantes" hoje.

Atrás de flag própria. Sem shadow mode ainda nesta etapa — é só few-shot, baixo risco (mesmo grau de risco que já existe hoje ao citar chamados semelhantes).

### Etapa 3.B — Reforço e rebaixamento (o "aprender de verdade")

Quando uma candidata é sugerida em um novo chamado e o analista confirma (Fase 2) que resolveu de novo → incrementa `vezes_confirmada_em_outro_chamado`, e só aqui `status` pode avançar para `reforcada` (múltiplos contextos distintos, não o mesmo cliente repetindo). Quando o analista marca "Não resolveu" tendo essa candidata como base → incrementa `vezes_rejeitada_em_outro_chamado` e rebaixa para `rebaixada` acima de um limiar (ex. 1 rejeição já reduz prioridade de sugestão; não precisa de múltiplas para agir, diferente da promoção que exige múltiplas confirmações — assimetria intencional, é mais caro errar de novo do que deixar de sugerir).

Instrumentar o gatilho de staleness: quando uma versão/pacote do sistema do cliente mudar (se esse dado existir em algum lugar do cadastro da empresa/conexão), marcar em lote como `atualizado_em = agora` + flag de "precisa revalidar" todas as candidatas daquele produto/módulo com `versao_sistema` divergente da nova.

### Etapa 3.C — Shadow mode / medição antes de qualquer automação mais forte

Só depois de volume real de dados da 3.A/3.B: medir, sem aplicar nada automaticamente, quantas vezes uma candidata sugerida teria sido a resposta certa (comparando contra o que o analista de fato confirmou). Decisão de ir além disso (ex. priorizar automaticamente uma candidata no topo do diagnóstico, nunca auto-aplicar fonte) só depois de medição real — exatamente a disciplina que o NL-SQL cache seguiu antes de liberar qualquer auto-reuse.

## 6. O que NÃO fazer agora (fora de escopo deliberado)

- **Não criar embeddings/busca vetorial nesta fase.** Sem precedente no IA Service, custo operacional real (reindexação, versionamento de modelo), e o ganho só aparece em volume que não existe ainda. Reavaliar quando `solucoes_candidatas` tiver volume relevante por empresa.
- **Não permitir reuso cross-empresa.** Mesmo que duas empresas usem o mesmo ERP/versão, o isolamento multiempresa é inegociável em todo o resto do schema (`empresa_id NOT NULL` + filtro em toda query) — conhecimento reutilizável não é exceção.
- **Não auto-aplicar fonte corrigido de outro chamado.** Mesmo com candidata `reforcada`, a entrega de fonte corrigido continua exigindo o fluxo da Fase 1 (gerado pela IA para o anexo do turno atual, nunca copiado de outro atendimento) — reuso aqui é de diagnóstico/hipótese, não de artefato binário.
- **Não misturar `solucoes_candidatas` com `investigacao_dossies`.** Ciclos de vida diferentes (um é por atendimento e termina quando o atendimento termina; o outro é entre atendimentos e vive mais).

## 7. Próximos passos reais (não iniciar sem isto)

1. **Verificar o que a Fase 2 efetivamente gravou** antes de desenhar o schema de `solucoes_candidatas` — o gatilho de criação depende do formato exato que a confirmação do analista assumir no dossiê (campo novo? nova migration? enum?). Reler `investigacao-dossie-atualizador-service.js` e a migration mais recente quando a Fase 2 estiver pronta.
2. Validar com o usuário se "versão do sistema do cliente" é um dado que já existe em algum cadastro de empresa/conexão hoje, ou se precisa ser coletado — isso é condição de aplicabilidade central e não pode ser assumido.
3. Escrever a migration da Etapa 3.0 **separadamente**, com teste de isolamento multiempresa seguindo o padrão já usado em `etapa2-extracao-e-versionamento.test.js` e `fase1-fontes-corrigidos.test.js` (positivo + ambíguo/negativo + cross-empresa).
4. Não implementar 3.A/3.B/3.C na mesma entrega — cada etapa é um incremento isolado e testável, igual ao NL-SQL cache fez.

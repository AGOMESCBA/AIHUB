# IA Service — Regressão dos Chamados Reais (Antes/Depois)

Base: `IA_SERVICE_AUDITORIA_ESTABILIZACAO_PRODUCAO.md` (diagnóstico) e
`IA_SERVICE_CORRECOES_MOTOR_INVESTIGATIVO.md` (correções implementadas).

**Importante sobre o método:** nenhum dos 3 casos reais tem, no banco disponível
para esta investigação, uma execução de LLM bem-sucedida registrada (ver auditoria
§0). Por isso, "resposta anterior" abaixo não é a resposta real vista pelo usuário
em produção (não temos esse dado), e sim uma reconstrução sintética fiel ao padrão
descrito no briefing, usada para demonstrar o comportamento estrutural do código
antes/depois da correção — sem chamar um LLM real. A seção "Resultado dos testes"
é o dado objetivo e verificável; a seção "Resposta antes/depois" é ilustrativa.

---

## Caso A — #035988 COABRA (sintetizado como cenário de teste)

### 1. Resposta anterior (reconstrução ilustrativa, não registrada em produção)

> "A hipótese mais provável é que a devolução de compra deveria subtrair do saldo
> do contrato, e não somar — segundo a documentação da TOTVS sobre devolução de
> venda, esse é o comportamento padrão esperado. Recomendo ajustar a rotina para
> subtrair o saldo na devolução."

### 2. Falhas identificadas (conforme briefing)

- Apresenta hipótese não confirmada como se fosse conclusão de documentação oficial.
- Cita referência TOTVS de operação diferente (venda) sem demonstrar aplicabilidade
  à customização real (compra agrícola).
- Nenhuma distinção entre fato (observação do cliente), hipótese (regra de sinal) e
  conclusão confirmada.

### 3. Causa-raiz confirmada

Auditoria §2.2.a: sem execução anterior bem-sucedida, o dossiê fica vazio
(`investigacao_itens`: 0 linhas) — a checagem de regressão existente
(`_avaliarRegressaoInvestigativa`) não tem nenhum item de dossiê com `codigo` contra
o qual comparar, então uma hipótese repetida em linguagem natural (mesmo
parafraseada) não é pega por nenhuma checagem existente antes da correção.

### 4. Correção implementada

Novo guard `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA` em
`quality-gate-service.js` — compara a resposta atual contra respostas anteriores
reais da IA no histórico (texto, não item de dossiê) por similaridade de shingles,
com guarda contra falso positivo (`_temJustificativa`).

### 5. Resposta obtida após a correção (mesma reconstrução ilustrativa)

Com o guard ativo, uma segunda resposta que repetisse a mesma hipótese sem
evidência nova dispara `deveRetry` (severidade `media`) e o Quality Gate injeta,
via `montarInstrucaoRetry`, instrução explícita para a IA reconhecer a repetição.
Resultado esperado (não gerado por LLM real nesta investigação, mas é o
comportamento que o retry corretivo já aplicado no código produz para as outras 4
checagens de regressão, pelo mesmo mecanismo):

> "Já levantei essa hipótese na resposta anterior (devolução deveria subtrair, não
> somar) e ainda não recebi confirmação de teste. Sem evidência nova, mantenho essa
> hipótese como pendente de validação — não vou reapresentá-la como descoberta
> nova. Para avançar, preciso do resultado do teste já solicitado ao time de
> desenvolvimento, ou de um log/fonte real da rotina de devolução de compra
> agrícola."

### 6. Evidências utilizadas

Histórico real do atendimento (cronologia completa, ver auditoria §2.1) — a
observação "devolução volta o saldo e não diminui como as notas de entrada" é
atribuída corretamente ao cliente (`Andre Luiz A.Correa`), não à IA.

### 7. Resultado dos testes (dado objetivo, verificável)

`estabilizacao-casos-reais-2026-10.test.js:testarCasoA_RepeticaoDeHipoteseSemItemDeDossie`
— 3 asserções, todas passando:
1. Dossiê vazio confirmado (`status: 'SEM_DOSSIE'`) — replica o estado real.
2. Resposta parafraseada repetindo a hipótese sem evidência nova →
   `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA` disparado.
3. Resposta com evidência nova explícita (log citado) → guard NÃO dispara
   (cenário adversarial, confirma que avanço real não é bloqueado).

### 8. Consumo de tokens/chamadas externas

Nenhuma chamada de IA adicional — o guard é cálculo de string puro. Overhead de
CPU desprezível (shingles de um texto de ~300 palavras: sub-milissegundo).

---

## Caso B — #036636 Novapec (sintetizado como cenário de teste)

### 1. Resposta anterior (reconstrução ilustrativa)

> "Para resolver, você precisa criar o usuário Lucas Fernandes no Protheus com uma
> senha provisória e orientar a troca no primeiro login. Depois, copie os acessos
> do usuário de referência (Ageu) para o novo usuário."

### 2. Falhas identificadas (conforme briefing, ajustado pela auditoria real)

- Repete a instrução de criação completa do zero, sem reconhecer que usuário/senha
  já foram definidos e comunicados por um analista no histórico.
- Risco de reproduzir CPF/senha do histórico na própria resposta.
- **Ajuste em relação ao briefing original:** o histórico real não contém uma
  confirmação explícita de "usuário criado com sucesso" (ver auditoria §3.1) — a
  última mensagem é uma instrução ("favor criar"), não uma confirmação de
  execução. A falha real mais provável não é "ignorar confirmação explícita" (ela
  não existe no texto), e sim "não reconhecer estado intermediário/em andamento e
  tratar como se nada tivesse sido comunicado".

### 3. Causa-raiz confirmada

Auditoria §3.2.a/§3.2.b: ausência de vocabulário no system prompt para ações
operacionais com status intermediário; e §3.2.c: CPF do solicitante presente em
texto claro no prompt enviado aos 5 providers externos (achado de maior
severidade desta auditoria).

### 4. Correção implementada

- `redaction-service.js`: CPF/CNPJ mascarados (`[REDACTED:CPF]`/`[REDACTED:CNPJ]`)
  em todos os pontos do pipeline que já usavam `redigirValor`/`redigirTexto`.
- `prompt-builder.js`: nova seção "Ações operacionais/administrativas já
  comunicadas no histórico", instruindo a reconhecer estado em andamento e pedir
  confirmação pontual em vez de reemitir a instrução completa.

### 5. Resposta obtida após a correção (reconstrução ilustrativa)

> "Pelo histórico, o usuário e a senha provisória já foram informados por um
> analista, com instrução de copiar os acessos do usuário de referência. Antes de
> orientar algo novo: essa criação já foi concluída no Protheus? Se sim, falta só
> confirmar se o primeiro login e as permissões copiadas estão corretos; se ainda
> não, o próximo passo é efetivamente criar o usuário com os dados já definidos,
> sem precisar reconfirmar a senha (já comunicada)."

Note que a resposta reconstruída não reproduz o CPF nem a senha — consistente com
a nova instrução do system prompt.

### 6. Evidências utilizadas

Histórico real do atendimento (anonimizado para o teste — CPF/senha sintéticos,
nunca os reais, ver nota de privacidade no próprio arquivo de teste).

### 7. Resultado dos testes (dado objetivo, verificável)

`estabilizacao-casos-reais-2026-10.test.js:testarCasoB_AcaoOperacionalEProtecaoDeDados`
— 5 asserções, todas passando:
1. CPF sintético não aparece em texto claro no prompt.
2. CPF mascarado como `[REDACTED:CPF]`.
3. Senha continua mascarada (`[REDACTED]`) — sem regressão do comportamento
   anterior.
4. Nova seção de ações operacionais presente no `SYSTEM_PROMPT`.
5. Instrução de não reproduzir credenciais de volta presente no `SYSTEM_PROMPT`.

### 8. Consumo de tokens/chamadas externas

Nenhuma chamada de IA adicional. A nova seção do system prompt adiciona
aproximadamente 850 caracteres fixos ao prompt (presentes em toda chamada,
independente do atendimento) — desprezível frente ao orçamento de tokens típico
(milhares de tokens por chamada, gerenciado por `token-budget-service.js`).

---

## Caso C — #036475 FUNDAÇÃO MT (sintetizado como cenário de teste)

### 1. Resposta anterior (reconstrução ilustrativa)

> "O problema de status do pedido provavelmente está relacionado à mesma rotina que
> causa a falha de envio de e-mail — como o chamado já foi aberto na TOTVS para a
> falha de e-mail, e a stack de chamada passa pela função de baixa financeira,
> recomendo revisar a contabilização do título gerado pelo pedido."

### 2. Falhas identificadas (conforme briefing)

- Transforma correlação (dois problemas no mesmo fluxo) em causalidade (mesma
  rotina) sem demonstrar a relação.
- Prioriza uma recomendação financeira sem evidência de relação com o problema de
  status.
- Não destaca que já existe uma pendência externa (ticket TOTVS) aguardando
  retorno, tratando como se a investigação estivesse livre para recomeçar do zero.

### 3. Causa-raiz confirmada

Auditoria §4.2.a/§4.2.b: posicionamento histórico com 3 informações distintas
(problema original, sintoma de e-mail, encaminhamento externo) entra como bloco de
texto único sem separação estrutural; e o campo
`chamados.aguardando_consolidado` (já existente desde a migration v39,
alimentado pela view consolidada) nunca era propagado ao prompt do motor
investigativo.

### 4. Correção implementada

`context-engine.js` + `investigacao-service.js`: nova linha de "pendência
consolidada do chamado" no prompt, condicionada à existência do campo
`chamado.aguardandoConsolidado`, com instrução explícita de tratar retorno de
terceiro/fornecedor como pendência externa.

### 5. Resposta obtida após a correção (reconstrução ilustrativa)

> "O problema original (status do pedido não atualiza após aprovação) e o sintoma
> relatado depois (e-mail de aprovação não enviado automaticamente) foram tratados
> como a mesma rotina padrão pela equipe, mas isso ainda não está confirmado como a
> mesma causa — o encaminhamento à TOTVS (ticket 30475983) foi aberto
> especificamente para a falha do e-mail. Como o chamado está marcado como
> aguardando retorno do fornecedor, o próximo passo não depende da equipe: é
> acompanhar a resposta da TOTVS. Não recomendo tocar na contabilização financeira
> sem uma evidência direta ligando as duas rotinas."

### 6. Evidências utilizadas

Histórico real do atendimento (cronologia completa, ver auditoria §4.1), incluindo
a observação de que a mensagem de 18/09 usa o termo "cotação de compras" em vez de
"pedido de compras" — imprecisão do analista humano original, preservada como está
na fonte, não "corrigida" silenciosamente pela IA.

### 7. Resultado dos testes (dado objetivo, verificável)

`estabilizacao-casos-reais-2026-10.test.js:testarCasoC_PendenciaExternaEDistincaoDeSintomas`
— 4 asserções:
1. Linha de pendência consolidada aparece corretamente quando
   `chamado.aguardandoConsolidado = 'RETORNO - FORNECEDOR'`.
2. Instrução de tratar como pendência externa está presente.
3. **Cenário adversarial:** sem o campo `chamado` informado, a linha NÃO aparece —
   nenhuma pendência é inventada quando o dado não existe.
4. Checagem de causalidade cruzada (recomendação financeira sem relação
   demonstrada): **gap documentado como baseline, não corrigido nesta rodada**
   (ver riscos residuais no documento de correções, item 2) — o teste confirma que
   a estrutura básica do Quality Gate continua funcionando, mas não afirma que essa
   classe específica de erro já é pega. Qualquer implementação futura deve
   atualizar este teste para refletir a nova cobertura.

### 8. Consumo de tokens/chamadas externas

Nenhuma chamada de IA adicional. A linha de pendência adiciona ~350 caracteres ao
prompt, apenas quando o chamado tem o campo preenchido.

---

## Suíte completa (Fases 1, 2 e 3)

Execução: `for f in apps/IA Service/tests/*.test.js; do node "$f"; done`

- **38 arquivos de teste executados, 0 falhas** (incluindo o novo arquivo desta
  auditoria).
- Um bug real foi encontrado e corrigido durante este processo
  (`ReferenceError: chamado is not defined` em `investigacao-service.js`,
  exposto por `etapa-v1-paralelismo-atendimentos.test.js` — ver documento de
  correções, item 7). Sem rodar a suíte completa, esse bug teria ido para
  produção.
- Nenhum teste pré-existente precisou ser alterado para continuar passando —
  todas as mudanças de assinatura (`avaliarResposta`, `montarContextoInvestigacao`,
  `salvarMensagem`) são aditivas com parâmetros opcionais.

## Classificação final

| Aspecto | Classificação | Justificativa |
|---|---|---|
| Qualidade do diagnóstico de causa-raiz | **A** | Causas confirmadas por leitura determinística de código real, não especulação; limitação de dados de produção documentada explicitamente em vez de preenchida com suposição |
| Qualidade das correções implementadas | **B** | 5 de 8 causas-raiz identificadas foram corrigidas com mudança de código testada; 3 ficaram como risco residual documentado por avaliação explícita de custo/risco de falso-positivo, não por omissão |
| Qualidade da validação/testes | **A** | Suíte completa (38 arquivos) rodada antes e depois, 0 regressões; novo teste cobre os 3 casos com cenários positivos E adversariais; um bug real foi pego pela própria suíte antes de qualquer publicação |
| Comprovação da melhoria (vs. resposta real de produção) | **C** | Não há execução real de LLM registrada para nenhum dos 3 casos neste ambiente — a comparação "antes/depois" de texto de resposta é ilustrativa, não uma reprodução ponta a ponta com provider real. A melhoria comprovada é estrutural (comportamento determinístico do código), não comportamental de um LLM real |

**Nenhuma alteração foi commitada, enviada (push) ou implantada em produção.**
Arquivos alterados ficam pendentes de revisão e decisão explícita do usuário sobre
commit, conforme restrição do escopo.

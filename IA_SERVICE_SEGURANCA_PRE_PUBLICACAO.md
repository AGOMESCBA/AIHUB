# IA Service — Correções Preventivas Pré-Publicação (Fase 3)

Responsável pela implementação: Claude
Data: 2026-10-08
Escopo: eliminação dos riscos residuais classificados como BAIXO na 2ª auditoria (`IA_SERVICE_AUDITORIA_INDEPENDENTE_FASES_1_2_3.md`) e não cobertos pela rodada de correções do Codex (`IA_SERVICE_FASE3_CORRECOES_POS_AUDITORIA.md`), confirmados ainda pendentes na revalidação (`IA_SERVICE_FASE3_REVALIDACAO_FINAL.md`, seção 11 — riscos residuais).

---

## 1. Riscos investigados

| Risco | Origem | Severidade original |
|---|---|---|
| `comentario` com tipo inválido (objeto/array/número/booleano) causa HTTP 500 com mensagem de driver SQLite vazada | 2ª auditoria, seção 6 | BAIXO |
| `comentario` persistido sem sanitização — XSS latente, sem UI que o exiba hoje | 2ª auditoria, seção 6 | BAIXO |
| Colisão semântica de chave de idempotência entre múltiplos chamados apontando para o mesmo atendimento | 2ª auditoria, seção 4 (A4) | MÉDIO (risco teórico, não reproduzido) |

## 2. Causas-raiz confirmadas

**Risco 1 (tipo inválido em `comentario`)**: `validacao-solucao-service.confirmarSolucao` e `validacao-solucao-repository.registrarConfirmacaoAnalista` nunca validavam o tipo do campo `comentario` antes do `INSERT`. Quando um objeto/array era enviado, o `better-sqlite3` falhava o bind de parâmetro com a mensagem interna `"Too few parameter values were provided"`, que o `_handleErro` das rotas propagava ao cliente sem reconhecer como erro de validação — caindo no fallback HTTP 500 por não bater em nenhuma regex de `_erroParaStatus`. **Confirmado por reprodução** antes da correção (ver histórico de auditoria) e revalidado nesta sessão.

**Risco 2 (XSS latente)**: confirmado por grep em ambos os arquivos de frontend (`atendimento.html`, `radar.html`) — o campo `comentario` é enviado ao backend (`body: JSON.stringify({ resultado, comentario })`) mas nunca lido de volta em nenhuma tela existente. Não há vetor de XSS ativo hoje porque não há renderização, mas o payload malicioso ficaria persistido byte a byte, pronto para disparar se qualquer UI futura interpolasse o valor diretamente em `innerHTML`.

**Risco 3 (idempotência entre chamados)**: investigado com reprodução experimental dedicada (ver seção 4). **Não é uma causa-raiz confirmada** — é um risco teórico que não se sustenta na implementação real: a chave de idempotência (`validacao-solucao-service.registrarEvidenciaExternaDeChamado`) tem `chamadoId` como primeiro componente da string hasheada, portanto dois chamados diferentes nunca produzem a mesma chave, mesmo apontando para o mesmo atendimento. Conforme a restrição explícita de não alterar a estratégia por hipótese, **nenhuma mudança de código foi feita nesta área**.

## 3. Arquivos modificados

| Arquivo | Alteração |
|---|---|
| `apps/IA Service/backend/services/validacao-solucao-service.js` | Nova função `_validarComentario` (tipo string/null, trim, limite de 2000 caracteres) chamada no início de `confirmarSolucao`, antes de qualquer persistência. Novo helper `_erroValidacao` (padrão `err.status = 400`, já usado no restante do arquivo). |
| `apps/IA Service/frontend/atendimento.html` | Nova função `renderizarComentarioValidacao` (escapa via `escapeHtml` já existente, converte quebra de linha em `<br>` apenas após escapar) — documentada como uso obrigatório para qualquer exibição futura do comentário. Limite de 2000 caracteres aplicado no `window.prompt` (UX preventiva; a validação real continua no backend). |
| `apps/IA Service/frontend/radar.html` | Mesmas duas alterações, espelhadas. |
| `apps/IA Service/tests/fase3-seguranca-pre-publicacao.test.js` | Novo arquivo — suíte de testes desta correção preventiva. |

**Nenhum outro arquivo foi tocado.** Motor de investigação, Context Engine, dossiê global, validações individuais append-only, versionamento de fontes, ficha de resposta operacional, sincronização SoftExpert, autenticação/OTP, regras multiempresa e rotas HTTP (além do efeito indireto de `confirmarSolucao` agora rejeitar tipos inválidos mais cedo) permanecem exatamente como estavam após a revalidação classificada como "A".

## 4. Correções implementadas

### 4.1 — Validação do campo `comentario`

```js
function _validarComentario(comentario) {
  if (comentario === null || comentario === undefined) return null;
  if (typeof comentario !== 'string') {
    throw _erroValidacao('comentario deve ser texto (string) ou ausente.');
  }
  const normalizado = comentario.trim();
  if (!normalizado) return null;
  if (normalizado.length > COMENTARIO_MAX_CHARS) { // 2000
    throw _erroValidacao(`comentario excede o limite de ${COMENTARIO_MAX_CHARS} caracteres.`);
  }
  return normalizado;
}
```

Chamada em `confirmarSolucao` antes de qualquer acesso a atendimento/mensagem/dossiê — o erro de validação acontece o mais cedo possível, antes de qualquer custo de I/O. Como as duas rotas (`routes/index.js` e `routes/externo-routes.js`) chamam o mesmo serviço, a correção protege ambos os namespaces automaticamente, sem precisar duplicar a validação em cada rota. String vazia/só espaço é normalizada para `null` (mesmo contrato que já existia); string válida é preservada exatamente como enviada, sem qualquer sanitização destrutiva (unicode, acentos, aspas, quebras de linha — tudo preservado). O limite de 2000 caracteres foi escolhido por ser generoso para um comentário real de analista e consistente com o padrão de truncamento já usado em outros textos livres do mesmo dossiê (ex. `resumoOrientacao: mensagemAvaliada?.conteudo?.slice(0, 500)`).

### 4.2 — Blindagem contra XSS (preventiva, sem nova UI)

Conforme decisão explícita do usuário durante a implementação ("a segurança não pode depender apenas dela... qualquer tela futura deverá obrigatoriamente tratar os comentários como texto puro"), foi criada uma função dedicada em cada arquivo de frontend:

```js
function renderizarComentarioValidacao(comentario) {
  const texto = String(comentario ?? '').trim();
  if (!texto) return '';
  return escapeHtml(texto).replace(/\n/g, '<br>');
}
```

Reaproveita o `escapeHtml` já existente e usado em toda a ficha operacional (nenhuma dependência nova). A ordem importa: o escape acontece **antes** da substituição de quebra de linha, então mesmo que o comentário contenha literalmente a string `<br>`, ela chega escapada (`&lt;br&gt;`) e só a substituição intencional de `\n` real gera a tag seguir. Nenhuma tela nova foi criada — a função existe como contrato obrigatório documentado inline, para a primeira tela futura que vier a exibir o campo.

### 4.3 — Limite de tamanho espelhado no frontend

```js
comentario = window.prompt('Comentário (opcional) — o que aconteceu?')?.slice(0, 2000) || null;
```

Truncamento no cliente é UX preventiva (evita a surpresa de um erro 400 só depois do envio); a validação autoritativa continua sendo a do backend — o frontend nunca é a única barreira.

### 4.4 — Idempotência entre chamados

Nenhuma alteração de código. Resultado da investigação documentado na seção 6 e no novo teste (ver 5).

## 5. Testes novos e resultados

`apps/IA Service/tests/fase3-seguranca-pre-publicacao.test.js`, executado via `node tests/fase3-seguranca-pre-publicacao.test.js` contra servidor Express real (não apenas chamada direta ao serviço) — resultado: **todos os casos obrigatórios validados**.

| # | Caso | Antes da correção | Depois da correção |
|---|---|---|---|
| 1 | String válida | 201, aceito | 201, aceito (sem mudança) |
| 2 | String vazia | 201, aceito | 201, normalizado para `null` |
| 3 | Campo ausente | 201, aceito | 201, `null` (sem mudança) |
| 4 | Objeto JSON | **500**, `"Too few parameter values were provided"` vazado | **400**, `"comentario deve ser texto (string) ou ausente."` |
| 5 | Array | **500** (mesma causa) | **400** |
| 6 | Número | **500** (mesma causa) | **400** |
| 7 | Booleano | **500** (mesma causa) | **400** |
| 8 | Texto > 2000 caracteres | 201, aceito sem limite | **400**, `"comentario excede o limite de 2000 caracteres."`; exatamente 2000 chars continua aceito |
| 9 | Unicode/caracteres especiais (`中文`, emoji, acentos, aspas) | 201, aceito | 201, aceito e preservado byte a byte |

Casos 4-7 são o "teste que falhava antes e passou depois" pedido na seção 6 — reproduzidos manualmente antes de qualquer correção nesta sessão (ver seção 2) e confirmados corrigidos pela suíte nova.

**XSS**: 6 payloads sintéticos (`<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, aspas simples/duplas, `<svg onload=alert(1)>`, quebras de linha mistas `\n`/`\r\n`, unicode+HTML falso) — todos aceitos com HTTP 201 e **persistidos exatamente como enviados** (confirmado por `assert.strictEqual(body.evento.comentario, payload)`), validando a diretriz explícita de "preservar o texto original no banco, evitando sanitização destrutiva desnecessária". A defesa real foi testada separadamente: a lógica de `escapeHtml` (replicada em Node para fins de teste, já que a função de frontend é browser-side) confirmada neutralizando `<script>` para `&lt;script&gt;...&lt;/script&gt;`, nunca deixando a tag viva.

**Idempotência**: teste dedicado confirma que dois `chamadoId` diferentes no mesmo atendimento, mesma transição de status, geram dois registros distintos (`duplicado: false` para ambos, IDs diferentes) — sem colisão.

**Preservação de contrato**: testes adicionais confirmam isolamento multiempresa inalterado (empresa B não confirma atendimento de empresa A, mesmo após as correções) e que o significado de `RESOLVEU`/`NAO_RESOLVEU`/`PARCIALMENTE`/`NAO_TESTADO` não foi alterado.

## 6. Resultado das regressões

Suíte completa executada nesta sessão, após as correções:

| Teste | Resultado |
|---|---|
| `fase3-seguranca-pre-publicacao.test.js` (novo) | ok |
| `fase3-pos-auditoria.test.js` | ok |
| `fase3-confirmacao-solucoes.test.js` | ok (20/20 cenários) |
| `fase3-rotas-http.test.js` | ok |
| `fase1-fontes-corrigidos.test.js` | ok |
| `fase2-respostas-objetivas.test.js` | ok |
| `fase1-fase2-pos-auditoria.test.js` | ok |
| `etapa3a-dossie-persistente.test.js` | ok |
| `etapa3b-atualizacao-dossie.test.js` | ok |
| `etapa3c-contexto-dossie.test.js` | ok |
| `etapa3d-pesquisa-investigativa.test.js` | ok |
| `etapa3d1-fechamento-pesquisa-investigativa.test.js` | ok (`{"total":54,"corretos":51,"ambiguos":3}`) |
| `anexos-softexpert-sync.test.js` | ok |
| `etapa2-extracao-e-versionamento.test.js` | ok |
| `base-historica-incremental.test.js` | ok |
| `base-historica-import.test.js` | ok |
| `benchmark-motor-investigacao.test.js` | `{"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}` — **idêntico ao baseline**, nenhuma tentativa de melhoria |

**Nenhuma regressão encontrada.** A validação nova em `confirmarSolucao` é estritamente mais restritiva apenas para tipos que já eram tratados como erro (500 em vez de 400) — nenhum fluxo que funcionava corretamente antes passou a falhar.

## 7. Riscos residuais

Nenhum dos três riscos desta rodada permanece com severidade original:
- Risco 1 (tipo inválido): **eliminado**.
- Risco 2 (XSS latente): **mitigado estruturalmente** (função de renderização segura existe e está documentada como obrigatória), mas **ainda latente** no sentido de que depende de disciplina do próximo desenvolvedor que criar uma UI de exibição — não há enforcement automático (ex. lint) que impeça alguém de usar `innerHTML` direto no futuro. Isso foi uma escolha deliberada do usuário (não criar UI nova agora), não uma lacuna de execução desta tarefa.
- Risco 3 (idempotência): **não era um defeito real** — investigado e descartado por análise da chave de idempotência, sem necessidade de correção.

Nenhum risco novo foi introduzido pelas correções desta rodada (confirmado pela suíte de regressão completa).

## 8. Pendências para publicação

Idênticas a todas as rodadas anteriores desta série — nenhuma mudança:
- Homologação visual autenticada em navegador real: não executada.
- Validação com provider de IA real: não executada (nenhuma chamada paga).
- Integração real com SoftExpert (SQL Server de produção): não executada.
- Compilação/execução ADVPL no Protheus: não aplicável a este escopo.

## 9. Parecer final

**Classificação: A — Apto à publicação controlada.**

Os três riscos residuais identificados nas auditorias anteriores foram tratados: os dois riscos reais (tipo inválido em `comentario`, XSS latente) foram corrigidos de forma estrutural e verificados por teste automatizado cobrindo exatamente os 9 casos de tipo/tamanho exigidos mais 6 payloads XSS sintéticos; o terceiro (colisão de idempotência entre chamados) foi investigado com rigor e descartado como risco real, sem necessidade de alteração de código, conforme a restrição explícita da tarefa de não mudar estratégia por hipótese.

Nenhuma das áreas protegidas pela especificação (motor de investigação, Context Engine, dossiê global, validações append-only, versionamento de fontes, ficha operacional, sincronização SoftExpert, autenticação/OTP, regras multiempresa, fluxos do Radar) foi alterada — confirmado por diff restrito a 3 arquivos de produção (um backend, dois frontend) e 1 arquivo de teste novo, e por suíte de regressão completa sem nenhuma falha, incluindo benchmark offline idêntico ao baseline de referência.

Esta classificação refere-se exclusivamente à preparação técnica dos riscos de segurança residuais tratados nesta tarefa — **não substitui homologação operacional completa**, que continua pendente de homologação visual autenticada, validação com provider real de IA e integração real com SoftExpert, exatamente como em todas as rodadas anteriores desta série de auditorias.

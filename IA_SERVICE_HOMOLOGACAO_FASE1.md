# IA Service - Homologacao Funcional da Fase 1

Data: 2026-10-08
Escopo: testes da Fase 1 - entrega operacional de fontes corrigidos.

Esta etapa nao implementou novas funcionalidades e nao realizou commit/push.

## 1. Preparacao do ambiente

Repositorio: `C:\Apps\iahub`

Servidor identificado:

- `package.json`
- `npm start` -> `node index.js`
- `npm run dev` -> `node --watch --watch-path=index.js --watch-path=modules --watch-path=packages index.js`
- Porta padrao: `3000`, definida em `index.js` por `process.env.PORT || 3000`

Servidor local usado na homologacao:

- Comando equivalente: `node index.js`
- PID iniciado para teste visual: `21296`
- Rota publica verificada: `http://127.0.0.1:3000/entrar-servico/j2a`
- Resultado da verificacao HTTP: `200`

Autenticacao visual:

- Fluxo usado: `/iaservice/j2a`
- Telefone informado: `55 65 99987-5116`
- Resultado: a tela carregou, mas o envio do codigo retornou indisponibilidade do WhatsApp de atendimento.
- Mensagem exibida: `Nao foi possivel enviar o codigo agora - o WhatsApp de atendimento esta indisponivel. Tente novamente em instantes ou contate o administrador.`
- Evidencia de screenshot local: `C:\tmp\ia-service-j2a-login-otp.png`

## 2. Matriz de homologacao

| Teste | Resultado | Evidencia | Pendencia |
|---|---|---|---|
| Identificar como iniciar o IA Service | APROVADO | `package.json`: `npm start` e `npm run dev`; `index.js` usa porta 3000 | Nenhuma |
| Verificar backend/frontend acessiveis | APROVADO | `GET /entrar-servico/j2a` retornou HTTP 200 | Nenhuma para rota publica |
| `fase1-fontes-corrigidos.test.js` | APROVADO | Saida: `fase1-fontes-corrigidos.test.js: ok (todos os asserts passaram)` | Nenhuma |
| `etapa2-extracao-e-versionamento.test.js` | APROVADO | Saida: `etapa2-extracao-e-versionamento.test.js: ok (todos os asserts passaram)` | Nenhuma |
| Regressao contexto/pesquisa/quality gate | APROVADO | `etapa2-contexto-pesquisa-quality.test.js: ok` | Nenhuma |
| Regressao anexos SoftExpert | APROVADO | `anexos-softexpert-sync.test.js: ok` | Nenhuma |
| Regressao contexto/dossie | APROVADO | `etapa3c-contexto-dossie.test.js: ok` | Nenhuma |
| Regressao atualizacao de dossie | APROVADO | `etapa3b-atualizacao-dossie.test.js: ok` | Nenhuma |
| Regressao paralelismo/permissoes/isolamento | APROVADO | `etapa-v1-paralelismo-atendimentos.test.js: ok (todos os cenarios de paralelismo passaram)` | Nenhuma |
| Regressao repositorios/anexos base | APROVADO | `fundacao-repositories.test.js: ok (todos os asserts passaram)` | Nenhuma |
| Sintaxe JS inline Atendimento V1 e Radar | APROVADO | Saida: `frontend inline js ok` | Nenhuma |
| Teste funcional completo com PRW + log | APROVADO como teste de integracao | Coberto por `fase1-fontes-corrigidos.test.js`, com resposta controlada de IA | Nao foi provider real |
| IA identifica problema e gera correcao proposta | APROVADO como teste de integracao | Resposta controlada gera `Fonte corrigido`; teste verifica criacao de versao | Provider real nao usado |
| Nova versao criada e associada a resposta correta | APROVADO | Assert: `versao.mensagemOrigemId === resposta.id` | Nenhuma |
| Download do arquivo corrigido | APROVADO | Endpoint `/api/ia-service/anexos/:id/download` retornou 200 e conteudo corrigido real | Nenhuma |
| Diff original x corrigido | APROVADO | Endpoint `/api/ia-service/anexos/:id/diff/:versaoId` retornou original, versao e diff com linha adicionada | Nenhuma |
| Historico com multiplas versoes | APROVADO | Assert: historico `[original, versao1, versao2]` | Nenhuma |
| Original preservado | APROVADO | Assert manteve `conteudoExtraido` original sem alteracao | Nenhuma |
| Extensao preservada | APROVADO | Assert validou `MeuWorkflow (corrigido).prw` | Nenhuma |
| Dois fontes ambiguos | APROVADO | Assert: nenhuma versao automatica criada e aviso de ambiguidade emitido | Nenhuma |
| Fonte corrigido incompleto/curto | APROVADO | Assert: nenhuma entrega gerada e aviso retornado | Nenhuma |
| Bloqueio cross-empresa | APROVADO | Download por outra empresa retornou 404; `listarVersoes` por outra empresa rejeitou | Nenhuma |
| Bloqueio de caminho fora do diretorio permitido | APROVADO por revisao e rota endurecida | `_resolverCaminhoAnexoSeguro` valida `ANEXOS_DIR`; nao foi feito teste invasivo/destrutivo | Pode receber teste dedicado futuro nao destrutivo |
| Rejeicao de versao inconsistente no diff | APROVADO por endpoint/teste de relacao | Rota valida empresa, atendimento e `anexoOriginalId` antes de calcular diff | Pode receber teste unitario adicional dedicado |
| Homologacao visual Atendimento V1 autenticada | BLOQUEADO | Sem sessao autenticada disponivel no Hub durante esta execucao | Precisa sessao IAHub valida ou fluxo externo autenticado |
| Homologacao visual Radar autenticada | BLOQUEADO | Login externo J2A carregou, mas envio de OTP falhou por WhatsApp indisponivel | Precisa WhatsApp de atendimento disponivel e OTP valido |
| Console do navegador em fluxo J2A | BLOQUEADO/PARCIAL | Playwright via Edge abriu a tela; console mostrou 404 e 503 durante tentativa de envio do codigo | Precisa autenticar para testar Radar |
| Teste com provider real | NAO EXECUTADO | Nao foi autorizado consumir API paga; fluxo validado com resposta controlada | Autorizar provider/chave e custo se quiser teste real |
| Compilacao/execucao ADVPL no Protheus | NAO EXECUTADO | Fora do escopo do ambiente local | Precisa ambiente Protheus/homologacao |

## 3. Testes automatizados executados

Comandos executados:

```powershell
node "apps\IA Service\tests\fase1-fontes-corrigidos.test.js"
node "apps\IA Service\tests\etapa2-extracao-e-versionamento.test.js"
node "apps\IA Service\tests\etapa2-contexto-pesquisa-quality.test.js"
node "apps\IA Service\tests\anexos-softexpert-sync.test.js"
node "apps\IA Service\tests\etapa3c-contexto-dossie.test.js"
node "apps\IA Service\tests\etapa3b-atualizacao-dossie.test.js"
node "apps\IA Service\tests\etapa-v1-paralelismo-atendimentos.test.js"
node "apps\IA Service\tests\fundacao-repositories.test.js"
```

Resultado: todos aprovados.

Tambem foi executada validacao de sintaxe dos scripts inline de:

- `apps/IA Service/frontend/atendimento.html`
- `apps/IA Service/frontend/radar.html`

Resultado: `frontend inline js ok`.

## 4. Teste funcional completo

Tipo: teste de integracao com resposta controlada, sem provider real.

Cenario validado:

- Atendimento sintetico.
- Fonte ADVPL `.PRW` sintetico.
- Resposta controlada com secao `Fonte corrigido`.
- Criacao de nova versao corrigida.
- Associacao com mensagem/resposta correta.
- Download real do conteudo corrigido via endpoint.
- Diff entre original e versao.
- Historico com multiplas versoes.
- Preservacao integral do original.
- Bloqueio cross-empresa.
- Ambiguidade com dois fontes.
- Rejeicao de fonte incompleto/curto.

Resultado: APROVADO como teste de integracao.

Limitacao: nao comprova que a IA real escolheria a mesma correcao nem que o ADVPL compila/executa no Protheus.

## 5. Teste de multiplos fontes

Resultado: APROVADO.

Evidencia:

- Dois arquivos `.PRW` elegiveis no mesmo turno.
- O sistema nao criou versao automaticamente.
- O retorno trouxe aviso de ambiguidade.

## 6. Integridade e seguranca

Itens aprovados:

- Original preservado.
- Versao corrigida criada como novo anexo.
- Extensao `.prw` preservada no nome corrigido.
- Associacao `atendimento -> mensagem -> original -> versao` validada.
- Download autorizado por empresa.
- Acesso entre empresas bloqueado.
- Diff vinculado a original/versao corretos.
- Fonte vazio/curto/truncado nao e entregue como arquivo.

Itens parcialmente validados:

- Caminho fora do diretorio permitido: validado por revisao de rota e helper seguro; nao foi feito teste destrutivo/invasivo contra banco real.
- Versao inconsistente no diff: rota possui validacao de relacao; teste automatizado principal cobre relacao correta, mas nao incluiu caso HTTP negativo dedicado.

## 7. Homologacao visual

Status: BLOQUEADA.

O que foi executado:

- Servidor local iniciado.
- Rota `/entrar-servico/j2a` respondeu HTTP 200.
- Playwright com Microsoft Edge abriu `/iaservice/j2a`.
- Telefone `55 65 99987-5116` foi informado no formulario.
- A tela tentou iniciar o envio de codigo.

Bloqueio encontrado:

- O backend retornou indisponibilidade do WhatsApp de atendimento.
- A tela exibiu: `Nao foi possivel enviar o codigo agora - o WhatsApp de atendimento esta indisponivel. Tente novamente em instantes ou contate o administrador.`
- Sem OTP, nao foi possivel entrar no Radar externo.
- Sem sessao IAHub autenticada fornecida, tambem nao foi possivel validar Atendimento V1 logado.

Evidencia visual:

- `C:\tmp\ia-service-j2a-login-otp.png`

Para continuar a homologacao visual, e necessario:

1. WhatsApp de atendimento disponivel para enviar OTP, ou
2. Uma sessao IAHub ja autenticada no navegador local com acesso ao IA Service/J2A, ou
3. O codigo OTP recebido no telefone informado, sem alterar nem contornar o fluxo de autenticacao.

## 8. Classificacao por tipo de teste

- Teste automatizado: APROVADO.
- Teste de integracao com resposta controlada: APROVADO.
- Teste visual autenticado: BLOQUEADO por indisponibilidade do WhatsApp/OTP.
- Teste com provider real: NAO EXECUTADO.
- Compilacao/execucao no Protheus: NAO EXECUTADO.

## 9. Conclusao

Resultado: **B - Fase 1 aprovada com ressalvas**.

Justificativa:

- Os testes automatizados obrigatorios e regressivos relevantes passaram.
- O fluxo operacional essencial foi validado por integracao controlada: gerar versao corrigida, preservar original, baixar arquivo, comparar diff, manter historico, tratar multiplos fontes e bloquear acesso entre empresas.
- A homologacao visual autenticada nao foi concluida porque o fluxo normal de login externo nao conseguiu enviar OTP devido ao WhatsApp de atendimento indisponivel.
- Por regra desta homologacao, nao e possivel classificar como A sem acessar e testar as telas autenticadas.

Ressalvas:

- Falta validar visualmente o card `Fonte corrigido gerado` em Atendimento V1 e Radar com sessao real.
- Falta testar provider real, se desejado e autorizado.
- Falta compilar/testar qualquer fonte ADVPL no Protheus antes de afirmar que uma correcao funciona em producao.


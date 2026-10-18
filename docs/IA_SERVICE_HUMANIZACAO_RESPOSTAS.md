# IA Service — humanização das respostas

> Atualização de 18/10/2026: [correção do Quality Gate e da humanização](IA_SERVICE_CORRECAO_QUALITY_GATE_HUMANIZACAO.md). O relatório abaixo registra a implementação inicial; a nova validação e a proteção literal restrita substituem as descrições iniciais de preservação de prosa.

Implementação em DEV, em 17/10/2026. O estilo da resposta é independente da pré-análise automática e vale também para conversas manuais.

## 1. Arquivos

Criados:

- `apps/IAHUB/backend/estilos-resposta.js`: valores permitidos, validação e padrão Original.
- `apps/IA Service/backend/services/resposta-humanizada-service.js`: reescrita, proteção técnica e fallback.
- `apps/IA Service/tests/humanizacao-respostas.test.js`: serviço, persistência, rotas HTTP, integração e provider.
- `apps/IA Service/tests/humanizacao-ui.test.js`: navegador, desktop e celular.
- Este relatório.

Modificados:

- `apps/IAHUB/backend/platform-store.js`: leitura e atualização do estilo por telefone e empresa.
- `apps/IAHUB/backend/platform-routes.js`: validação do estilo e preservação dos metadados existentes.
- `apps/IA Administracao/frontend/platform-config.html`: campo no cadastro e indicação na ficha do analista.
- `apps/IA Service/backend/services/consultor-service.js`: preferência da identidade autenticada e atualização parcial das configurações.
- `apps/IA Service/backend/routes/index.js` e `externo-routes.js`: estilo nas rotas de preferências; identidade externa explícita no turno manual.
- `apps/IA Service/backend/services/investigacao-service.js`: integração na entrega, após o Quality Gate, e no atalho de conversa curta existente.
- `apps/IA Service/backend/services/ai-provider-client.js`: opções de orçamento total de timeout e supressão do retry extra de raciocínio. O comportamento padrão dos demais chamadores permanece.
- `apps/IA Service/backend/services/trilha-investigacao-service.js`: versões original e ajustada na trilha de auditoria, inclusive para conversas curtas.
- `apps/IA Service/tests/sincronizacao-preferencia-platform.test.js`: simulação explícita de Platform ausente, compatível com a alteração paralela de revogação de acesso.
- `apps/IA Service/frontend/j2a/index.html`, `j2a/assets/radar.js` e `j2a/assets/radar.css`: seletor e salvamento.
- `apps/IA Service/frontend/radar.html`: seletor e apresentação de uma única resposta humanizada.

## 2. Cadastro e persistência

O campo fica em **Números Autorizados > IA Service > Estilo da Resposta**. A preferência usa `metadata_json.iaService.estiloResposta` em `platform_whatsapp_identities`, sem tabela ou cadastro paralelo. A leitura aceita também metadados de role legados; a preferência gravada na identidade tem precedência.

Registros sem preferência seguem Original. O formulário de novo número sugere Natural. O schema e os dados locais foram consultados em modo somente leitura: 13 identidades, nenhuma com estilo previamente definido. Não foi necessária migração nem atualização dos dados existentes.

A gravação pelo chat usa transação SQLite imediata, mescla somente o campo de estilo e exige vínculo ativo `ia-service/chat-web` da própria empresa. Não altera permissões, outras configurações ou dados de outros módulos.

## 3. Configuração no chat

As interfaces J2A e Radar mantêm o seletor junto da configuração de pré-análise. Ele permanece visível e habilitado quando a resposta automática está desligada, desde que o analista tenha cadastro e permissão. Durante carregamento ou salvamento, fica temporariamente desabilitado.

As rotas existentes `GET/PUT /radar/minhas-preferencias`, nos namespaces interno e externo, carregam e salvam o estilo no cadastro. Os campos são atualizados separadamente: enviar apenas `estiloResposta` não altera `preAnaliseAutomatica`. Uma falha no salvamento restaura a seleção anterior.

A preferência acompanha o analista entre chamados e novos logins. O turno manual usa a identidade autenticada; a pré-análise usa o consultor vinculado ao atendimento. A mudança afeta próximas respostas e não reescreve mensagens antigas, nem dispara investigação ou IA.

## 4. Estilos

| Estilo | Comportamento |
|---|---|
| Original | Entrega o texto atual, sem chamada adicional de IA. |
| Natural | Linguagem profissional, simples, objetiva e coloquial. |
| Direto | Concisão, problema e próximo passo, preservando informações essenciais. |
| Descontraído | Linguagem leve e moderna, sem excesso de gírias, memes ou emojis. |

## 5. Provider e performance

A camada usa `ai-config-service.resolverKeysEOrdem(empresaId)` e `ai-provider-client.chamarIA`, com as credenciais, modelos e ordem de fallback configurados para a empresa. Não fixa um fornecedor e não cria integração externa adicional.

Envia somente as instruções de estilo e a resposta elegível, com marcadores no lugar dos trechos protegidos. Não envia anexos, imagens, histórico, dossiês ou resultados de pesquisa. Usa uma rodada de providers, até 8 segundos por tentativa e orçamento total de 15 segundos, com cancelamento HTTP existente. O orçamento de saída varia de 800 a 4.000 tokens.

## 6. Resposta original e auditoria

O analista recebe uma mensagem final. Nos estilos adicionais, `mensagens.diagnostico_json.humanizacao` preserva `respostaOriginal`, `respostaHumanizada`, estilo, status, motivo de fallback quando houver, provider, modelo, latência e `usage` adicional. A mensagem mantém o provider/modelo da investigação nos campos existentes.

As seções técnicas, o texto enviado ao atualizador de dossiê e a auditoria investigativa continuam usando a resposta técnica original. Nos próximos turnos, o serviço fornece o histórico técnico original à pesquisa e ao Context Engine, mantendo o conteúdo exibido no chat. O uso adicional fica separado nos metadados da humanização. Não há mudança de estado operacional do chamado nem duplicação de mensagem.

Na aba **Trilha de Investigação**, a auditoria apresenta **Resposta técnica original → Resposta ajustada**, em dois eventos da mesma mensagem. Os detalhes mostram as duas versões e, no ajuste, estilo, status, provider, modelo e consumo adicional. Fallbacks indicam que o original foi entregue. Conversas curtas aparecem como “Conversa com a IA”, sem criar execução investigativa artificial. A apresentação aplica a redação de dados sensíveis e escapa HTML; as duas versões continuam persistidas nos metadados existentes.

## 7. Proteção e fallback

Código, comandos e parágrafos com incertezas, ressalvas, pendências ou ambientes são protegidos literalmente antes da chamada. Trechos identificados pelo redator de dados sensíveis também ficam locais. A saída precisa manter os marcadores, sua ordem e quantidade; os trechos originais são restaurados depois.

A validação leve compara números, identificadores, referências, arquivos, URLs, código, comandos e ocorrências de expressões críticas. Saída vazia, truncada, inválida, incompatível ou falha do provider retorna automaticamente o original. Logs não incluem corpo da resposta nem credenciais. Não há segundo Quality Gate investigativo.

## 8. Validação executada

- **20 testes novos aprovados**, sem falhas: 15 de serviço, persistência, HTTP, auditoria, fluxo investigativo e provider; 5 de navegador, cobrindo as duas interfaces em 1440 e 390 pixels e a apresentação das versões na trilha.
- **10 suítes de regressão aprovadas**: `ai-provider-retry`, `sincronizacao-preferencia-platform`, `radar-pre-analise-concorrencia`, `fase2-respostas-objetivas`, `quality-gate-homologacao-investigativa`, `pendencia-externa-gate`, `fase3-rotas-http`, `login-externo-telefone`, `proveniencia-referencias-quality-gate` e `chat-tab-export`.
- Testes com SQLite em memória/temporário e providers simulados; nenhuma chamada paga de IA.
- Uma alteração paralela em login/sessões surgiu durante a execução e foi preservada. O cenário de ausência da Platform na suíte de sincronização foi isolado do banco local para distinguir ausência de instalação de revogação de vínculo; nenhuma regra de acesso dessa alteração foi modificada nesta entrega.
- Evidências locais: `tmp/humanizacao-final.log`, `tmp/humanizacao-regressao.log`, `tmp/humanizacao-regressao-trilha.log`, `tmp/humanizacao-j2a.png`, `tmp/humanizacao-radar-externo.png` e `tmp/humanizacao-trilha-auditoria.png`.

Comando dos testes novos:

```powershell
node --test "apps/IA Service/tests/humanizacao-respostas.test.js" "apps/IA Service/tests/humanizacao-ui.test.js"
```

## 9. Exemplo validado com mock

Original:

> A rejeição 1031 ocorre na rotina MATA103 e no campo C7_FILIAL.
>
> A hipótese ainda precisa de confirmação em homologação.
>
> Próximo passo: acompanhar o chamado 30422148.

Resposta reescrita:

> A rejeição 1031 aparece na rotina MATA103 e no campo C7_FILIAL.
>
> A hipótese ainda precisa de confirmação em homologação.
>
> Próximo passo: acompanhar o chamado 30422148.

O exemplo verifica o contrato de preservação; não é uma amostra gerada por provider real.

## 10. Limitações e escopo

A proteção é conservadora: parágrafos sensíveis mantêm a redação original. Respostas inteiramente protegidas, reprovadas pelo gate, truncadas ou maiores que 18.000 caracteres não são reescritas. A validação lexical não demonstra equivalência semântica completa de toda prosa livre; os testes simulados não medem a qualidade editorial de modelos reais.

O atalho de conversa curta já existente continua sem uma investigação ou Quality Gate adicional; aplica o estilo após gerar uma resposta não truncada. No fluxo investigativo, a reescrita exige aprovação do gate existente.

Não foram realizados commit, push, deploy ou escrita na origem SoftExpert. A entrega consiste nos arquivos locais de DEV; não foi reiniciado o servidor da aplicação.

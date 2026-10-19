# IA Service — Objetiva: homologação, limitações e melhorias futuras

Data: 2026-10-18. Escopo: estilo de resposta **Objetiva** (`NATURAL`) e botão **Copiar** em Detalhes Técnicos.

## Comportamento
- **Técnica (`ORIGINAL`)**: resposta técnica integral, sem chamada de IA extra.
- **Objetiva**: uma chamada de IA reescreve a Técnica; antes, código real, comandos e dados sensíveis viram marcadores protegidos. Identificadores técnicos simples (rotinas, pontos de entrada, tabelas, campos, palavras-chave) **não** são marcadores: o validador exige que continuem presentes, idênticos e sem acréscimos.
- **Validador de preservação** (`validacao-preservacao-service.js`): bloqueia referência técnica removida/nova, código alterado, hipótese→fato, fato→hipótese, negação removida/adicionada, mudança na força da afirmação e da orientação (tentativa < recomendação < instrução < obrigatoriedade), ação/pendência omitida, perda de estrutura (passos/listas) e título com conteúdo próprio omitido. Só são omissíveis: introdução neutra de lista, meta-comentário e registro narrativo sem conteúdo técnico.
- **Aprovada** → entrega a Objetiva; Detalhes Técnicos mostra a Técnica original. **Rejeitada** → fallback automático para a Técnica (a Técnica original é sempre preservada em `respostaOriginal`).
- Provider, modelo e fallback vêm da Platform; nada nesta frente os altera. Timeout da humanização: 8 s (inalterado).

## Limitações conhecidas (não bloqueantes; cobertas por testes `todo`)
1. `"não altere"` → `"não modifique"` é rejeitado (falso positivo seguro; a heurística de proibição imperativa é uma lista curta de propósito, para não ler "não gera o documento" como ordem).
2. Ressalva dentro de frase longa ("não há certeza do nome exato… confirmar no help") pode ser removida sem rejeição (granularidade por frase).
3. Ramo condicional de uma lista ("se existe registro em SD1 mas não aparece como documento válido…") pode ser removido quando há frases vizinhas de vocabulário parecido.

## Resultado da homologação com um chamado real de devolução (dados reais não versionados)
- `gpt-4o-mini`: 3 chamadas reais de Objetiva, todas rejeitadas pelo validador (perda de pesquisa externa, datas, campos D1_*, hipóteses). Fallback para a Técnica funcionou.
- Experimento de modelo mais capaz (`claude-sonnet-5-5`): inconclusivo por infraestrutura (falha de provider em 727 ms, causa não determinada). Configuração temporária removida; Platform restaurada (hashes idênticos).
- Decisão de produto: rejeição ocasional da Objetiva é comportamento seguro previsto; não é bloqueador.

## Melhorias futuras (nada implementado)
- Avaliar modelo mais capaz especificamente para humanização (a credencial OpenAI enxerga `gpt-4.1` e famílias posteriores; modelos de raciocínio exigem `max_completion_tokens`, incompatível com o adaptador atual).
- Revisar o timeout de 8 s se um modelo futuro realmente exigir (uma Objetiva fiel pode ter mais de 1.000 tokens).
- Avaliar geração estruturada / em múltiplas etapas somente se houver necessidade comprovada em produção.
- Taxa de aprovação da Objetiva não é meta de produto; o objetivo é tempo para compreender e agir, não compressão.

## Rollback
Sem migration, sem mudança de schema e sem dado persistido novo. Antes do commit: `git restore` dos arquivos modificados desta frente e remoção dos arquivos novos. Depois do commit: `git revert <commit>`. Em produção: `deploy\4-restaurar.ps1` (backup automático feito por `3-atualizar.ps1`). Preferências de estilo dos analistas continuam válidas (Objetiva = `NATURAL`; Direto/Descontraído seguem lidos como Objetiva).

## Dados de teste
Os fixtures versionados (`apps/IA Service/tests/fixtures/tecnica-sintetica.md` e `apps/IA Service/tests/fixtures/objetiva-sintetica-referencia.md`) são 100% sintéticos: datas, empresa, filial, documento e pontos de entrada fictícios. Nenhum dado de chamado real é versionado.

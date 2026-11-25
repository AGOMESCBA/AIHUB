# A0 — Protótipo da Central de Atendimento (Fase 2)

**Dono:** Antigravity · **Depende de:** G3 entregue · **Não é produção:** nenhum dado real, só o servidor simulado.

## Onde salvar

```
apps/IA Talk/prototipos/central/
  index.html            ← página que compara as alternativas (links + critérios)
  alternativa-a.html    ← quatro áreas
  alternativa-b.html    ← três áreas + gaveta
  dados.js              ← conversas fictícias (sem número real; mascarar como +55 65 9••••-0000)
  prototipo.css         ← só o que não existir em ui/css/iahub.css e css/talk.css
```

Abre no servidor simulado: `http://127.0.0.1:3051/app/ia-talk/prototipos/central/`.
O servidor real **não** serve esta pasta.

## Alternativas a comparar (seção 12 do relatório)

| | Alternativa A — quatro áreas (recomendada no desktop) | Alternativa B — três áreas + gaveta |
|---|---|---|
| Colunas | Setores/visões · lista de conversas · conversa · painel do contato (com aba IA) | Lista de conversas (setor vira filtro no topo) · conversa · gaveta do contato/IA |
| Ganho | Contexto sempre visível, bom para quem atende várias conversas | Mais espaço para a conversa, mais simples |
| Custo | Menos largura para a conversa em telas de 1280 px | Um clique a mais para ver o contato |

Nas duas: notas internas visualmente diferentes de mensagem ao cliente; respostas rápidas com `/`;
transferir e encerrar a até 1 clique; IA (resumo, sugestão, melhorar texto) sem cobrir a conversa;
estados vazio, carregando, sem permissão e canal desconectado desenhados.

**Celular (≤ 760 px):** as áreas viram telas em sequência (setores → conversas → conversa), com contato e IA numa folha deslizante.

## Critérios de homologação visual

Capturas em 1440, 1024, 390 e 360 px, temas claro e escuro; nenhum texto cortado; nenhuma rolagem
horizontal da página; navegação por teclado com foco visível. A escolha entre A e B é do usuário.

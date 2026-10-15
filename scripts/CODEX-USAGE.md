# Medicao local do Codex

Nao instala dependencias, nao chama modelos e nao modifica sessoes. Imprime apenas contadores; nao imprime conversas nem resultados das ferramentas.

```powershell
node scripts/codex-usage.cjs "$env:USERPROFILE/.codex/sessions/2026/10/14"
node scripts/codex-usage.cjs "CAMINHO/rollout-SESSAO.jsonl" --json
```

`codex-token-baseline.json` registra duas sessoes anteriores a otimizacao e seus revisores de permissoes. Nao comparar as duas entre si: modelos e tarefas diferem.

Comparar tarefas equivalentes com o mesmo modelo efetivo, raciocinio, tier e criterios de qualidade. Registrar testes, retrabalho e tempo ate conclusao; reduzir tokens so conta como melhoria se a qualidade for mantida. Medir no fim da tarefa, evitando repetir a leitura de todos os registros a cada etapa.

- Entrada sem cache: `uncached_input_tokens`; entrada em cache: `cached_input_tokens`; saida: `output_tokens`.
- `reasoning_output_tokens` e parte da saida: nao somar novamente.
- `requests` deduplica por `response_id`. Registros antigos usam o ultimo contador cumulativo e nao informam quantidade de requisicoes.
- Separar sessoes principais e auxiliares por `parent_thread_id`/`source`. O custo do guardian na franquia nao e comprovado pelos contadores locais.
- Caracteres de ferramentas sao um indicador aproximado de volume, nao uma contagem de tokens. O registro em disco pode diferir do conteudo efetivamente retido no contexto.
- `invalid_lines` indica linhas invalidas, inclusive a ultima linha de uma sessao em escrita; repetir depois de encerrar a tarefa.
- Em checkpoints da mesma sessao, usar a diferenca dos totais; nao somar snapshots cumulativos.
- Economia: `1 - (consumo depois / consumo antes)`. Conferir tambem `/status` e o painel de uso: tokens nao equivalem diretamente a horas ou franquia.

As instrucoes globais estao em `~/.codex/AGENTS.md`. O limite de saida esta em `~/.codex/config.toml` (`tool_output_token_limit = 6000`). As copias anteriores foram salvas junto desses arquivos com sufixo `.before-token-optimization-*`.

Abrir um novo chat apos recarregar o VS Code para carregar as instrucoes e configuracao. O limite exige filtrar resultados na origem e recuperar trechos adicionais quando necessario; nao substituir evidencias por truncamento cego. Nao alteramos modelo, raciocinio, seguranca, Skills ou compactacao automatica.

# IA Service — Plano de Implantação Controlada e Rollback (Estabilização 2026-10-09)

Data: 2026-10-09
Commits a implantar: `01f26b7` (estabilização) + `4321ebf` (não relacionado, ver manifesto)
Pacote: `iahub-deploy-20261009_1025.zip` (ver `IA_SERVICE_MANIFESTO_PUBLICACAO_20261009.md` para SHA-256 e conteúdo completo)

**Este documento não autoriza nem executa o deploy.** É o roteiro para execução posterior, manual, pelo responsável com acesso ao servidor de produção. O mecanismo de implantação (scripts, ordem de passos, comportamento de migrations) é **idêntico** ao já documentado em `IA_SERVICE_PLANO_IMPLANTACAO_ROLLBACK.md` (publicação anterior, commit `0aac1aa`) — não foi alterado nesta entrega. Este documento repete o essencial para autocontenção e adiciona a validação operacional específica das correções desta rodada.

---

## Como as migrations funcionam neste sistema (sem mudança)

`apps/IA Service/backend/database/index.js`, `inicializarDB()`: executada automaticamente toda vez que o processo Node sobe. Lê `schema_migrations`, aplica em ordem só as versões ainda não registradas. Toda DDL usa `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` — reexecução acidental não duplica nem falha.

**Esta entrega não adiciona nenhuma migration** — a versão mais alta em `migrations.js` continua sendo v41, a mesma da publicação anterior. Se o servidor já estiver em v41 (esperado, dado que a publicação anterior já foi feita), **nenhuma DDL nova roda no próximo boot**. Isso reduz o risco desta implantação especificamente: é uma atualização de lógica de aplicação pura, sem tocar em esquema.

---

## ANTES da publicação

1. **Confirmar janela de manutenção**, se necessária — mesma indisponibilidade real do `3-atualizar.ps1` já documentada (não é hot-swap).

2. **Verificar que o servidor já está em v41** (deveria estar, pela publicação anterior):
   ```powershell
   & "C:\Web\iahub\node_modules\.bin\node" -e "
     const Database = require('C:\\Web\\iahub\\node_modules\\better-sqlite3');
     const db = new Database('C:\\Web\\iahub\\apps\\IA Service\\data\\ia-service.db', { readonly: true });
     console.log(db.prepare('SELECT version, descricao, aplicado_em FROM schema_migrations ORDER BY version DESC LIMIT 3').all());
   "
   ```
   Se a versão mais alta já for 41, confirma que esta implantação não vai rodar DDL nenhuma. Se for menor, as migrations faltantes rodarão automaticamente no boot (comportamento seguro, idempotente) — mas nesse caso, verificar antes se há mudanças de esquema entre a versão do servidor e v41 que mereçam atenção extra (não deveria haver, já que nenhuma migration nova foi adicionada desde a última publicação).

3. **Garantir backup consistente dos bancos e arquivos persistentes** — mesmo procedimento já documentado (backup automático do script protege só código-fonte, nunca dados):
   ```powershell
   # Com o servico PARADO (nssm stop iahub) para consistencia do SQLite:
   $dataBackup = "C:\Web\backups\dados-pre-estabilizacao-$(Get-Date -Format 'yyyyMMdd_HHmmss')"
   New-Item -ItemType Directory -Path $dataBackup -Force
   Copy-Item "C:\Web\iahub\apps\IA Service\data" -Destination "$dataBackup\IA-Service-data" -Recurse
   Copy-Item "C:\Web\iahub\apps\IA Command\data" -Destination "$dataBackup\IA-Command-data" -Recurse -ErrorAction SilentlyContinue
   Copy-Item "C:\Web\iahub\.env" -Destination "$dataBackup\.env" -ErrorAction SilentlyContinue
   ```

4. **Validar backup**: confirmar que não está vazio e que o SQLite copiado abre sem erro.

5. **Confirmar variáveis de ambiente necessárias às correções desta entrega**: as correções de fallback multi-provider dependem das chaves de provider já configuradas (`GROQ_API_KEY`/`SVC_GROQ_API_KEY`, e equivalentes para OpenAI/Claude/DeepSeek/Gemini conforme já configurado por empresa em `platform_ai_configs`). **Nenhuma chave nova é necessária** — a correção só melhora o uso das chaves já existentes, não introduz um provider adicional. Confirmar apenas que `.env` continua intacto (preservado automaticamente pelo `3-atualizar.ps1`, que valida sua existência após a extração).

---

## DURANTE a publicação

Fluxo real do `3-atualizar.ps1` (idêntico ao já documentado, não alterado):

```powershell
C:\Web\iahub\deploy\3-atualizar.ps1 -Zip C:\Web\iahub\deploy\iahub-deploy-20261009_1025.zip
```

1. **[1/7] Para os serviços** `iahub` e `IACommand-*`/WhatsApp.
2. **[2/7] Gera backup automático dos fontes atuais** (código apenas).
3. **[3/7] Extrai o novo pacote**, validando que nenhuma entrada aponta para diretório/arquivo protegido antes de extrair qualquer coisa (mesma proteção `Test-ZipEntryUnsafe` já confirmada vazia na geração deste pacote — ver manifesto).
4. **[4/7] `npm install --omit=dev`**.
5. **[5/7] Dependências Python do Master Crypto**, se aplicável.
6. **[6/7] Garante regra de firewall** para a porta 8000.
7. **[7/7] Reinicia os serviços.**

**Nenhuma migration nova roda neste passo** (v41 já deve estar aplicada do deploy anterior) — isso é uma diferença relevante frente à publicação anterior, que precisava confirmar `Migração v41 aplicada` no log. Nesta entrega, o log esperado **não deve mostrar nenhuma nova linha de "Migração vXX aplicada"** — se mostrar, investigar antes de prosseguir (indicaria que o servidor estava atrás de v41 por algum motivo não esperado).

### Durante — observações obrigatórias (sem mudança)

- Não abrir segunda sessão administrativa reiniciando o serviço manualmente durante a execução do script.
- Não executar resets/seeds destrutivos na mesma janela.
- Registrar logs completos da implantação como evidência.

### Nota de coordenação — reimportação do SoftExpert (reforçada nesta entrega)

O briefing desta tarefa **proíbe explicitamente** qualquer reimportação do SoftExpert como parte desta publicação. Reforçando o que já estava documentado na publicação anterior: essa é uma operação independente, com risco real de dados, e **não deve ser executada na mesma janela** deste deploy, nem antes, nem depois, sem uma decisão e janela própria.

---

## APÓS a publicação — Validação operacional

Checklist específico desta entrega (além da validação genérica de "o serviço subiu" já coberta pela publicação anterior):

### 1. Inicialização do IA HUB e IA Service
- Confirmar nos logs que o processo subiu sem erro e sem nenhuma linha de "Migração vXX aplicada" inesperada (ver nota acima).
- Confirmar que a porta/serviço responde (health check básico, se existir, ou tentativa de acesso à tela de login).

### 2. Autenticação e isolamento multiempresa
- Login de um usuário de uma empresa não deve expor dados de outra empresa no Radar/Atendimento (checagem padrão, não alterada nesta entrega — nenhuma mudança tocou lógica de isolamento).

### 3. Atendimento e Radar
- Abrir o Radar e confirmar que a fila de chamados carrega normalmente.
- Verificar visualmente o novo badge de "situação de retorno" (comentário no `radar.html`, commit `4321ebf`) aparecendo corretamente nos cards com pendência.

### 4. Consulta ao histórico
- Abrir um atendimento com histórico existente e confirmar que mensagens antigas continuam sendo exibidas normalmente (a correção de redação/rotulagem de erro de infraestrutura só afeta como o **backend monta o prompt para a IA**, nunca o que é exibido na UI do analista).

### 5. Investigação com provider principal
- Enviar uma pergunta de teste simples a um atendimento real (ambiente de homologação, nunca produção direta se evitável) e confirmar que o provider primário (GROQ) responde normalmente quando disponível.

### 6. Fallback automático — **validação específica desta entrega**
- Forçar ou observar uma situação onde o provider primário falhe (rate limit real é o caso mais provável de ocorrer naturalmente) e confirmar nos logs/auditoria (`investigacao_execucoes.tentativas_json`) que o fallback para o próximo provider configurado ocorreu automaticamente, sem intervenção manual.
- Confirmar que uma falha de certificado/TLS (se ocorrer) interrompe a sequência de fallback em vez de tentar todos os providers em sequência (comportamento novo desta entrega).

### 7. Quality Gate — **validação específica desta entrega**
- Em um atendimento com mais de um turno, observar se uma resposta que repete a mesma conclusão técnica sem evidência nova é sinalizada com o novo código `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA` (visível em `investigacao_execucoes.quality_gate_json`).
- Confirmar que uma resposta nova e genuína, sobre assunto diferente, não é bloqueada indevidamente (ausência de falso-positivo).

### 8. Reconhecimento de pendência externa — **validação específica desta entrega**
- Em um chamado real com `aguardando_consolidado = 'RETORNO - FORNECEDOR'` (ou similar), confirmar que uma nova resposta da IA menciona explicitamente a pendência e orienta acompanhamento, em vez de ignorá-la.
- Confirmar que chamados com `RETORNO - CLIENTE`/`RETORNO - ATENDENTE` (pendência interna, não bloqueante) não disparam alertas indevidos de pendência externa.

### 9. Registro de auditoria
- Confirmar que `investigacao_execucoes` continua sendo populada normalmente para os turnos do fluxo completo (não deve haver diferença de volume de registros, já que nenhuma mudança afeta quando a auditoria é gravada, só o conteúdo analisado).

### 10. Preservação dos dados existentes
- Comparar contagem de registros em `atendimentos`, `mensagens`, `chamados`, `investigacao_execucoes`, `investigacao_dossies` antes e depois do deploy — devem ser **idênticas** (nenhuma migration, nenhuma alteração de dados nesta entrega).
- Confirmar que anexos antigos continuam acessíveis (nenhuma mudança tocou `armazenamento-anexos.js` ou lógica de anexos).

---

## Plano de Rollback

### Rollback dos arquivos da aplicação (código) — sem mudança de mecanismo

```powershell
# No servidor, com acesso administrativo:
nssm stop iahub
# (parar tambem os servicos IACommand-*/WhatsApp se envolvidos)
# Restaurar do backup automatico gerado no passo [2/7] do 3-atualizar.ps1:
Expand-Archive -Path "C:\Web\backups\iahub-before-update-TIMESTAMP.zip" -DestinationPath "C:\Web\iahub" -Force
nssm start iahub
```

### ⚠️ Não presumir que reverter o código também reverte uma migration

Não aplicável a esta entrega especificamente (nenhuma migration nova foi introduzida) — mas a ressalva geral do mecanismo permanece válida para o futuro: reverter o código nunca reverte DDL já aplicada.

### Rollback específico das correções desta entrega

Como não há migration envolvida, o rollback de código é **suficiente e completo** para desfazer todas as correções desta entrega (classificação de erro do fallback, redação, repetição semântica, pendência externa) — não há estado de banco incompatível a reconciliar.

### Recuperação de configurações (.env)

Sem mudança — `.env` nunca é tocado pelo pacote; preservado automaticamente.

### Compatibilidade entre código anterior e esquema atualizado

Sem mudança de esquema nesta entrega — o código anterior (commit `0aac1aa`) continua 100% compatível com o banco atual, já que nenhuma coluna/tabela nova foi adicionada.

---

## Riscos residuais desta implantação

1. As correções de classificação de erro do fallback (`ai-provider-client.js`) alteram o comportamento de **quando** o sistema desiste de um provider e tenta o próximo — em produção real, com os 5 providers configurados (incluindo Claude, não exercitado nos testes desta sessão por ausência de chave local), o comportamento com Claude especificamente não foi validado com execução real nesta rodada.
2. Os novos guards do Quality Gate (`_extrairAncorasTecnicas`, `_ignoraPendenciaExternaBloqueante`) usam vocabulário fechado — ver riscos residuais detalhados em `IA_SERVICE_HOMOLOGACAO_REAL_ESTABILIZACAO.md`, seção 12.7. Monitorar nas primeiras semanas de produção se o volume real de atendimentos revela vocabulário muito diferente do testado.
3. Trabalho do commit `4321ebf` (WhatsApp multiempresa, visual do Radar) não foi testado nesta sessão — qualquer problema encontrado em produção relacionado a esses 3 arquivos deve ser investigado separadamente, sem presumir que é causado pela estabilização.

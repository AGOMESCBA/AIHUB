# IAHub — orientações do projeto

Adaptado de `.claude/CLAUDE.md`. As regras globais de economia de contexto continuam válidas.

- Responder em português do Brasil (pt-BR); UI e mensagens ao usuário também em pt-BR.
- Confirmar no código funções, arquivos, endpoints, tabelas e schemas antes de usá-los. Investigar informações ausentes; perguntar quando persistir ambiguidade que impeça uma decisão segura. Não inventar contratos.
- Antes de alterar código, auditar contexto e impacto sistêmico, inclusive integração com `index.js`, padrões existentes e débito técnico. Questionar premissas perigosas ou subótimas e explicar alternativas.
- Ajustes simples e isolados podem ser implementados diretamente. Para alterações em múltiplos arquivos, apresentar impacto antes de codificar. Para mudanças em persistência (`data/`), segurança ou IA-OWNER, pedir aprovação antes, salvo autorização já explícita para a ação na sessão. Interromper trabalho dependente de ambiguidade ou risco não resolvido e perguntar.
- Organizar propostas de código em entendimento, análise técnica, sugestão, plano e implementação; comunicar de forma direta e proporcional, sem repetir informações.
- Em persistência JSON, verificar schema e dados atuais, preservar conteúdo não relacionado e considerar concorrência antes de escrever. Não sobrescrever indiscriminadamente.
- Para UI, consultar `.claude/DESIGN.md` e seguir os padrões existentes antes de implementar. Não presumir os detalhes das seções que só dizem “ORIGINAL PRESERVADO” no documento de origem.
- Ao investigar ou alterar IA Command, Protheus, SQL, isolamento entre empresas/filiais, contexto conversacional ou specs IA-OWNER, ler primeiro `docs/codex/ia-command.md`. Essa referência preserva regras de domínio; validar afirmações sobre o estado atual no código e nos dados antes de concluir.
- Localizar regiões com `rg` antes de ler arquivos grandes, especialmente `apps/IA Service/frontend/radar.html`, serviços `investigacao-service.js` e `technical-research-service.js`, e `apps/IA Command/frontend/guia/index.html`. Ampliar a leitura quando necessário para qualidade técnica.
- Não depender de XML ou mapas de código não fornecidos. Usar o código atual e evidências verificadas.

# whatsapp-web.js — cópia corrigida usada só pelo IA Talk

**Por quê:** desde a versão 2.3000.1055852612 do WhatsApp Web (~23/11/2026), uma
sessão sem login cai na página `/login/`, onde `WAWebSocketModel` não existe. A
1.34.7 (instalada na raiz, usada pelo IA Command) falha com
"Cannot read properties of null (reading 'Socket')" e a 1.34.8 não gera o QR.

**O que é:** cópia de `src/`, `index.js`, `package.json` e `LICENSE` do commit
`38eb45b` ("fix: Socket", PR wwebjs/whatsapp-web.js#201990), que lê o estado por
`WAWebBackendEventBus`. Testado: gera o QR; a 1.34.7 não.

**Única mudança local:** `src/dependencias-ia-talk.js` — as dependências externas
(puppeteer, mime, node-fetch, fluent-ffmpeg, node-webpmux) são carregadas de dentro
de `node_modules/whatsapp-web.js` da raiz, as mesmas versões do IA Command.

**Não afeta o IA Command**, que segue com a 1.34.7 da raiz.

**Quando remover:** ao sair versão oficial com a correção, atualizar a dependência
da raiz, voltar `backend/provedores/wweb.js` para `require('whatsapp-web.js')` e
apagar esta pasta.

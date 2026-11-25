# Guia — Serviço de Jobs (IAHub-Jobs) e Parâmetros por Empresa

Versão 1.2.0 (2026-11-25). Para quem administra o IAHub em produção.

---

## Resumo em 30 segundos

- **Nada muda sozinho.** Depois de atualizar, tudo continua rodando como hoje (a Jaade continua dentro do site).
- O serviço de jobs só passa a ser usado quando **você escolhe na tela** (IA Gestão › Jobs › Configuração).
- **Liga e desliga na hora, quantas vezes quiser, sem reiniciar nada.** Voltar para "Site" = funcionamento de hoje.
- Se o serviço parar ou travar, **o site reassume sozinho** e você recebe alerta.

---

## 1. Atualizar o servidor

1. Copie `iahub-deploy-<data>.zip` para `C:\Web\iahub\deploy\` no servidor.
2. Abra o **PowerShell como Administrador** e rode:

   ```powershell
   C:\Web\iahub\deploy\3-atualizar.ps1 -Zip C:\Web\iahub\deploy\iahub-deploy-<data>.zip
   ```

3. Pronto. O site sobe com as novidades; as tabelas novas são criadas sozinhas. **A Jaade continua no site, como hoje.**

---

## 2. Configurar os alertas da empresa (e-mail/Telegram)

**Onde:** IA Gestão › aba **Parâmetros** › escolha a empresa no topo.

Cada campo da tela explica o que faz, tem exemplos (clique para preencher) e, quando precisa, um **"Como obter / passo a passo"**.

### 2.1 Como a reserva funciona

| Parâmetro | Recomendado | O que significa |
|---|---|---|
| Quando usar a reserva | **Só quando o WhatsApp falhar** | E-mail/Telegram entram só se o WhatsApp não entregar. "Sempre" manda nos dois; "Nunca" desliga. |
| Ordem dos canais | **E-mail, depois Telegram** | Tenta o e-mail; só usa o Telegram se o e-mail falhar. |

### 2.2 E-mail (recomendado)

| Campo | Exemplo | Observação |
|---|---|---|
| Usar e-mail | Ligado | Desligado, nada é enviado por e-mail. |
| Servidor SMTP | `smtp.gmail.com` / `smtp.office365.com` | Só o endereço, sem `http://` e sem porta. |
| Porta | `587` | 587 = STARTTLS (padrão) · 465 = SSL/TLS · 25 = sem criptografia. |
| Segurança | STARTTLS | Tem que combinar com a porta. |
| Usuário | `alertas@suaempresa.com.br` | A conta que envia. |
| Senha | (senha de app) | **Gmail:** precisa de "senha de app" (Conta Google › Segurança › Verificação em 2 etapas › Senhas de app). **Microsoft 365:** a conta precisa de "SMTP autenticado" liberado. |
| Remetente | `IAHub Alertas <alertas@suaempresa.com.br>` | Opcional. Em branco usa o Usuário. |
| Destinatários | `ti@suaempresa.com.br` | Um por linha ou separados por vírgula. Dica: use uma lista (ti@). |

Clique **Salvar alterações** e depois **"Enviar teste"** na seção E-mail. Confira se chegou.

### 2.3 Telegram (opcional)

1. No Telegram, fale com **@BotFather** › `/newbot` › copie o **token**.
2. Mande uma mensagem para o bot (ou coloque o bot num grupo e escreva algo).
3. Abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e pegue o número em `"chat":{"id": ...}`.
4. Na tela: **Usar Telegram** = Ligado, cole **Token** e **Chat**, salve e clique **Enviar teste**.

> Senhas e tokens ficam **cifrados** e nunca aparecem de novo na tela. Para trocar, digite o novo; em branco mantém o atual.

---

## 3. Configurar os alertas da tela Jobs (WhatsApp)

**Onde:** IA Gestão › aba **Jobs** › **Configuração** › bloco **Alertas por WhatsApp**.

| Campo | O que fazer |
|---|---|
| Empresa do canal de WhatsApp | A empresa cujo WhatsApp/grupos vão receber (ex.: J2A Consultoria). A reserva por e-mail/Telegram usada é a **desta mesma empresa** (item 2). |
| Grade de grupos | Marque **Falha de job** (job falhando N vezes e quando volta ao normal) e/ou **Serviço** (serviço sem sinal, site fora e a volta). Grupos vêm do IA Command › Grupos. |
| Falhas seguidas para alertar | `3` (padrão). |
| Minutos sem sinal | `5` (padrão). Também é o tempo para o site reassumir se o serviço travar. |

Salve e clique **Enviar alerta de teste**.

---

## 4. Instalar o serviço IAHub-Jobs (uma vez por servidor)

PowerShell **como Administrador**:

```powershell
C:\Web\iahub\deploy\6-instalar-servico-jobs.ps1
```

Confira em `services.msc`: **"IAHub - Jobs"** = Em execução, inicialização Automática. (Ou instale pelo botão **⬇ Instalar serviço** na aba "Serviço e log" da tela Jobs.)
Neste momento ele **ainda não roda a Jaade** — só fica pronto (a tela Jobs mostra "Serviço: No ar").

---

## 5. Passar a Jaade para o serviço (quando quiser)

1. Na tela da Jaade (IA Service › Base Histórica › Jaade), deixe em **Simulação** para o primeiro teste.
2. IA Gestão › Jobs › **Configuração** › **Onde os jobs rodam** › **Serviço IAHub-Jobs** › **Aplicar**.
3. Em segundos o serviço assume. Acompanhe em **Jobs** (situação de cada empresa) e **Execuções e logs** (log de cada leitura).
4. Testes recomendados:
   - Parar o serviço `IAHub - Jobs` no services.msc → a tela mostra "Site (reassumiu)" e chega o alerta; ao iniciar de novo, ele reassume.
   - Reiniciar o site no meio de uma leitura → a leitura continua no serviço.
5. Tudo certo? Volte a Jaade para **Produção**.

---

## 6. Desligar / voltar ao funcionamento de hoje (a qualquer hora)

Qualquer uma destas resolve, **sem reinstalar e sem pacote novo** (também pelos botões da aba "Serviço e log"):

| Situação | O que fazer | Resultado |
|---|---|---|
| Quero voltar como era | Jobs › Configuração › Onde os jobs rodam › **Site** › Aplicar | O site volta a agendar no próximo ciclo (segundos). O serviço termina o que estiver rodando e para de agendar. |
| O serviço deu problema | Parar `IAHub - Jobs` no services.msc | O site reassume **na hora** (parada limpa). Ou, se travar sem parar, em até "Minutos sem sinal". |
| Parar só a Jaade (sem mexer em nada) | Jobs › **Pausar job** (ou Pausar uma empresa) | Nenhuma leitura agendada roda até Retomar — vale no site e no serviço. |

> Única regra: para **ir** para "Serviço", o serviço precisa estar no ar (a tela não deixa escolher se ele não estiver). Para **voltar** para "Site", sempre pode.

---

## 7. Controlar o serviço pela tela (aba "Serviço e log")

IA Gestão › Jobs › **Serviço e log** — mesmo modelo da tela de serviços do WhatsApp:

| Botão | O que faz | Muda onde os jobs rodam? |
|---|---|---|
| ▶ Iniciar | Liga o serviço no Windows | Não (escolha em Configuração) |
| ■ Parar | Termina as execuções (até 45 s) e desliga | **Sim: volta para o Site** |
| ⬇ Instalar serviço | Faz o mesmo que o `6-instalar-servico-jobs.ps1` | Não |
| 🗑 Desinstalar | Para e remove o serviço do Windows | **Sim: volta para o Site** |

À esquerda, o **log ao vivo** do serviço (azul = serviço, verde = concluído, amarelo = aviso, vermelho = erro), com Limpar, Copiar e Salvar log. Instalar/desinstalar exigem o NSSM no servidor (como o WhatsApp).

---

## 8. Onde olhar quando algo der errado

- **Tela Jobs › Execuções e logs:** cada execução com resultado, erro e **log completo** (clique na linha).
- **Tela Jobs › Eventos:** tudo que o serviço e as pessoas fizeram (com usuário).
- **Servidor:** `C:\Web\iahub\logs\jobs-output.log` e `jobs-error.log`.
- **Auditoria da IA Gestão:** toda alteração em Jobs e Parâmetros, com usuário.

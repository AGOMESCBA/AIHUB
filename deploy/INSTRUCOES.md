# IAHub — Guia de Deploy no Windows Server 2019

> Siga os passos na ordem. Cada etapa depende da anterior.

---

## PARTE 1 — No seu computador local

### Passo 1 — Gerar o pacote ZIP

Abra o PowerShell e execute:

```powershell
C:\Software\ClaudeCode\iahub\deploy\0-gerar-pacote.ps1
```

Isso cria um arquivo `iahub-deploy-YYYYMMDD_HHMM.zip` na sua Área de Trabalho.

O ZIP contém todo o código-fonte **sem** `node_modules`, sem `.env` e sem dados locais do WhatsApp.

---

## PARTE 2 — No servidor Windows Server 2019

### Passo 2 — Conectar ao servidor via RDP

Abra a Conexão de Área de Trabalho Remota e conecte ao IP/hostname do servidor com suas credenciais.

### Passo 3 — Copiar o ZIP para o servidor

Dentro do RDP, você pode colar arquivos diretamente pelo clipboard:
- Clique em "Transferir arquivos" ou simplesmente arraste o ZIP para a janela do RDP.
- Ou use qualquer FTP/SFTP se o servidor tiver esse recurso.

### Passo 4 — Extrair o ZIP

No servidor, extraia o ZIP direto em `C:\`:
- Clique com o botão direito no ZIP > **Extrair aqui** *(escolha C:\)*
- O resultado será a pasta `C:\Web\iahub\`

Ou via PowerShell:

```powershell
Expand-Archive -Path "C:\caminho\iahub-deploy-YYYYMMDD_HHMM.zip" -DestinationPath "C:\" -Force
```

### Passo 5 — Configurar o arquivo .env

Copie o `.env.example` e preencha com os valores reais:

```powershell
Copy-Item C:\Web\iahub\.env.example C:\Web\iahub\.env
notepad C:\Web\iahub\.env
```

Preencha no mínimo:

| Variável | O que colocar |
|---|---|
| `GROQ_API_KEY` | Sua chave do Groq (console.groq.com) |
| `GEMINI_API_KEY` | Sua chave do Gemini (aistudio.google.com) |
| `ADMIN_USER` | Login do admin (padrão: `admin`) |
| `ADMIN_PASS` | Senha do admin (mude para algo forte) |
| `SESSION_SECRET` | Qualquer string longa e aleatória |
| `SVC_DATA_CRYPTO_KEY` | Gerar uma vez nesta instalação — ver abaixo |
| `SVC_WHATSAPP_OTP_SECRET` | Gerar uma vez nesta instalação — ver abaixo |

> A linha `CHROME_PATH` será adicionada automaticamente pelo script seguinte.

#### Segredos de infraestrutura: por SERVIDOR, não por empresa/cliente

`SESSION_SECRET`, `SVC_DATA_CRYPTO_KEY`, `SVC_WHATSAPP_OTP_SECRET`,
`IAC_HUB_INTERNAL_TOKEN`, `IAC_PROTHEUS_CHAT_SECRET` — nenhum desses é
configurado por empresa. Um servidor pode hospedar várias empresas
cadastradas no mesmo IAHub, e todas compartilham o mesmo conjunto desses
segredos, porque eles protegem a **instalação** (o processo Node, o banco
SQLite inteiro), não um cliente específico.

**Gere um valor novo para cada instalação/servidor** (nunca reaproveite o
valor de um servidor em outro — um vazamento num cliente não pode
comprometer os demais):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Rode o comando uma vez para cada variável (`SVC_DATA_CRYPTO_KEY`,
`SVC_WHATSAPP_OTP_SECRET` etc.) e cole o resultado no `.env`.

`SVC_DATA_CRYPTO_KEY` deve ser definida **antes** do primeiro uso real do
IA Service (antes de salvar qualquer chave de API de IA ou credencial do
Agente Local pela tela Config de IA) — trocar essa chave depois torna
ilegível tudo que já foi cifrado com a chave anterior.

Sem `SVC_WHATSAPP_OTP_SECRET` configurada, o login externo por telefone do
IA Service (`/entrar-servico`) falha com "WhatsApp de atendimento está
indisponível" — o envio do código OTP é abortado antes de tentar, de
propósito.

O que **é** por empresa (configurado na própria tela do sistema, uma vez
por empresa cliente cadastrada): chave de API de IA (Groq/OpenAI/Claude/
Gemini), credenciais do Agente Local (URL/token/`crypto_key`) e apelido de
URL de login. A `crypto_key` do Agente Local em si é gerada na tela local
do próprio agente Python (botão "Gerar nova chave") — não tem relação
com `SVC_DATA_CRYPTO_KEY`.

### Passo 6 — Instalar dependências (como Administrador)

Clique com o botão direito no PowerShell > **Executar como administrador**, depois:

```powershell
C:\Web\iahub\deploy\1-instalar-dependencias.ps1
```

Isso instala automaticamente: **Node.js**, **Google Chrome**, **NSSM** e **Nginx** via Chocolatey.

> Pode demorar 5 a 10 minutos dependendo da velocidade da internet do servidor.

### Passo 7 — Configurar o serviço Windows (como Administrador)

Ainda no PowerShell como administrador:

```powershell
C:\Web\iahub\deploy\2-configurar-servico.ps1
```

Esse script:
- Instala os pacotes npm (`npm install`)
- Registra o IAHub como **serviço Windows** (inicia automaticamente com o servidor)
- Configura o **Nginx** como proxy reverso na porta 80
- Abre as portas 80, 3000 e 8000 no Firewall do Windows

Ao final você verá:

```
============================================
  Configuracao concluida!
============================================
Acesso local:    http://localhost:3000
Acesso externo:  http://<seu-ip-ou-dominio>
```

---

## PARTE 3 — Liberar acesso externo no painel ADDIT

O Firewall do Windows já foi aberto pelos scripts, mas o servidor cloud da ADDIT pode ter um **firewall externo (Security Group)** que também precisa ser configurado.

1. Acesse o painel de controle da ADDIT
2. Localize seu servidor e vá em **Firewall** ou **Security Groups** ou **Regras de entrada**
3. Garanta entrada TCP para:
   - `80` para acesso HTTP via Nginx
   - `3000` para acesso direto ao IAHub quando necessario
   - `8000` para o backend Python/FastAPI do Master Crypto usado pelo app mobile

Health check esperado do Master Crypto:

```powershell
Invoke-WebRequest http://137.131.212.29:8000/health
```

Resposta esperada:

```json
{"status":"healthy"}
```
4. Adicione uma regra de entrada:
   - **Protocolo:** TCP
   - **Porta:** 80
   - **Origem:** 0.0.0.0/0 *(acesso de qualquer IP)* ou restrinja ao seu IP se quiser

4. Salve. O sistema ficará acessível em `http://<IP-PUBLICO-DO-SERVIDOR>`

> Para descobrir o IP público do servidor: acesse o painel da ADDIT ou rode `curl https://api.ipify.org` no PowerShell do servidor.

---

## PARTE 4 — Primeiro acesso e configuração do WhatsApp

1. Abra o navegador no servidor (ou no seu computador) e acesse `http://<IP-DO-SERVIDOR>`
2. Faça login com o usuário/senha configurados no `.env`
3. Vá em **WhatsApp > Monitor** e aguarde o QR Code aparecer
4. No celular, abra o WhatsApp > **Aparelhos conectados** > **Conectar aparelho**
5. Escaneie o QR Code — a conexão estará estabelecida

> O WhatsApp permanece conectado após reinicialização do servidor (sessão salva em `C:\Web\iahub\.wwebjs_auth\`).

---

## Comandos úteis

Todos via PowerShell (não precisa ser administrador para ver logs):

```powershell
# Verificar status dos serviços
Get-Service iahub, nginx

# Reiniciar o sistema
nssm restart iahub

# Parar / iniciar
nssm stop iahub
nssm start iahub

# Ver logs em tempo real
Get-Content C:\Web\iahub\logs\output.log -Wait -Tail 50

# Ver logs de erro
Get-Content C:\Web\iahub\logs\error.log -Tail 50

# Abrir gerenciador de serviços Windows
services.msc
```

---

## Atualizacao segura em producao

Para aplicar uma nova versao do codigo sem apagar dados nem tabelas existentes:

1. Gere o pacote com `deploy\0-gerar-pacote.ps1`
2. Envie o ZIP para `C:\Web\iahub\deploy` no servidor
3. Abra o PowerShell como Administrador no servidor
4. Execute:

```powershell
C:\Web\iahub\deploy\3-atualizar.ps1 -Zip C:\Web\iahub\deploy\iahub-deploy-YYYYMMDD_HHMM.zip
```

Se o ZIP estiver na pasta `deploy`, tambem pode executar sem informar o arquivo:

```powershell
C:\Web\iahub\deploy\3-atualizar.ps1
```

O atualizador seguro:
- valida o ZIP antes de aplicar;
- cancela se encontrar `.env`, banco SQLite, `data`, `uploads`, `sessions`, `.wwebjs_auth`, `.wwebjs_cache`, `logs`, `backups` ou `node_modules`;
- para o servico, gera backup em `C:\Web\backups`, extrai somente os fontes e reinstala dependencias;
- pode executar migrations controladas do sistema;
- nao remove tabelas existentes nem diretorios de dados.

---

## Atualizar o sistema no futuro (fluxo manual antigo - nao recomendado)

Para aplicar uma nova versão do código:

1. Gere um novo pacote ZIP com `0-gerar-pacote.ps1`
2. Envie para o servidor
3. Extraia sobrescrevendo (não apaga `data.json`, `.env`, `.wwebjs_auth`)
4. No servidor (PowerShell como admin):

```powershell
nssm stop iahub
Push-Location C:\Web\iahub
npm install --omit=dev
Pop-Location
nssm start iahub
```

---

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| Site não abre externamente | Regra no painel da ADDIT (firewall externo) |
| Site não abre nem localmente | `Get-Service iahub` — está Running? Ver logs de erro |
| WhatsApp desconecta sempre | Chrome não encontrado — verificar CHROME_PATH no .env |
| Erro 502 no Nginx | Serviço iahub não está rodando — ver logs |
| npm install falhou | Node.js não instalado — rodar script 1 novamente |

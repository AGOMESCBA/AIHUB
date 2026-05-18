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

> A linha `CHROME_PATH` será adicionada automaticamente pelo script seguinte.

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
- Abre as portas 80 e 3000 no Firewall do Windows

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
3. Adicione uma regra de entrada:
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

## Atualizar o sistema no futuro

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

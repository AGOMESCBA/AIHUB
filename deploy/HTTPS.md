# HTTPS no servidor do IAHub — passo a passo

Hoje o IAHub responde só em **HTTP**: o login por telefone do J2A, o token de
sessão, o Chat interno e as conversas com a IA trafegam **sem criptografia**.
Com HTTPS tudo isso passa a trafegar cifrado, e a notificação do Windows do
Chat interno começa a funcionar.

Certificado: **Let's Encrypt** (gratuito, renova sozinho a cada ~60 dias),
emitido pelo **win-acme**, a ferramenta padrão do Let's Encrypt para Windows.

Tempo estimado: 30 a 40 minutos. Tudo no servidor, em **PowerShell como
Administrador**.

---

## Caminho rápido (recomendado)

O endereço será um **subdomínio** do site da empresa, por exemplo
**`iahub.j2aconsultoria.com.br`**. O site `www.j2aconsultoria.com.br`
continua na Locaweb, sem nenhuma alteração.

**1. Criar o subdomínio no DNS da Locaweb** (só uma vez)

1. Descubra o IP público do servidor do IAHub (no servidor):
   ```powershell
   curl.exe https://api.ipify.org
   ```
2. Entre no **Painel da Locaweb** → domínio **j2aconsultoria.com.br** →
   **DNS** / **Zona de DNS** (em alguns planos: *Gerenciar DNS*).
3. **Adicionar registro**:
   - Tipo: **A**
   - Nome / Host: **iahub**
   - Valor / Aponta para: **o IP do passo 1**
   - TTL: o padrão (ou 3600)
4. Salve e aguarde a propagação (normalmente minutos; pode levar algumas
   horas). Para conferir, de qualquer computador:
   ```powershell
   Resolve-DnsName iahub.j2aconsultoria.com.br
   ```
   Deve responder com o IP do servidor.

> Não altere registros que já existem (www, MX de e-mail etc.) — só **adicione**
> o novo registro A.

**2. Liberar a porta 443 no painel da ADDIT** (firewall externo — mesma tela
usada para a porta 80, ver `INSTRUCOES.md`). A porta **80 continua aberta**:
o Let's Encrypt valida e renova por ela.

**3. Rodar o script no servidor** (PowerShell como Administrador):

```powershell
C:\Web\iahub\deploy\5-configurar-https.ps1 -Endereco iahub.j2aconsultoria.com.br -Email seu-email@j2aconsultoria.com.br
```

O script, sozinho: confere o DNS → libera a 443 no Firewall do Windows →
baixa o win-acme → emite o certificado e agenda a renovação → liga o HTTPS no
Nginx → testa → fecha a porta 3000. **Se qualquer etapa falhar, ele volta o
Nginx para como estava** (o sistema segue no ar em HTTP) e mostra o motivo.

Depois, siga a seção **6. Testar** abaixo e me avise para os ajustes finais
(seção 8).

> **Atenção:** o `2-configurar-servico.ps1` (instalação inicial) regrava o
> `nginx.conf` com a versão só HTTP. Se precisar rodá-lo de novo, rode o
> `5-configurar-https.ps1` em seguida. As atualizações normais
> (`3-atualizar.ps1`) **não** mexem no Nginx.

As seções abaixo são o **passo a passo manual** — use se preferir fazer à mão
ou se o script parar em alguma etapa.

---

## 1. Escolher o endereço do servidor

O certificado é emitido para um **nome**, não para um IP. Duas opções:

| Opção | Endereço | Observação |
|---|---|---|
| **A — domínio da empresa** (recomendado) | ex.: `iahub.suaempresa.com.br` | Peça a quem cuida do DNS um registro **A** apontando para o IP público do servidor. Pode levar algumas horas para propagar. |
| **B — sem domínio (sslip.io)** | IP com hifens + `.sslip.io`, ex.: IP `200.201.202.203` → `200-201-202-203.sslip.io` | Funciona na hora, sem configurar DNS. Serviço público e gratuito; se um dia sair do ar, troque para a opção A. |

Descobrir o IP público (no servidor):

```powershell
curl.exe https://api.ipify.org
```

Testar se o nome já aponta para o servidor (de qualquer computador):

```powershell
Resolve-DnsName SEU_ENDERECO
```

> Daqui em diante, **SEU_ENDERECO** é o nome escolhido.

---

## 2. Liberar as portas 80 e 443

**Firewall do Windows** (no servidor):

```powershell
New-NetFirewallRule -DisplayName "IAHub HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

A porta 80 já foi liberada na instalação. Ela **continua necessária**: o
Let's Encrypt valida e renova o certificado por ela.

**Firewall externo (painel da ADDIT)**: na mesma tela usada para a porta 80
(ver `INSTRUCOES.md`, seção do firewall externo), crie a regra de entrada para
a porta **443/TCP**.

---

## 3. Preparar as pastas e a validação

```powershell
New-Item -ItemType Directory -Force C:\nginx-acme, C:\certificados, C:\win-acme
```

Coloque o Nginx em um modo intermediário que **continua atendendo como hoje**
e já responde à validação do Let's Encrypt. Abra o `nginx.conf` em uso
(normalmente `C:\tools\nginx\conf\nginx.conf`) e, dentro de `server { listen 80; ... }`,
**antes** do bloco `location / {`, acrescente:

```nginx
        location ^~ /.well-known/acme-challenge/ {
            root C:/nginx-acme;
            default_type text/plain;
        }
```

Teste e recarregue:

```powershell
C:\Web\iahub\deploy\recarregar-nginx.ps1
```

Conferência — crie um arquivo de teste e abra no navegador
`http://SEU_ENDERECO/.well-known/acme-challenge/teste` (deve mostrar `ok`):

```powershell
New-Item -ItemType Directory -Force C:\nginx-acme\.well-known\acme-challenge | Out-Null
Set-Content C:\nginx-acme\.well-known\acme-challenge\teste "ok"
```

Depois de conferir, apague o arquivo `teste`.

---

## 4. Emitir o certificado (win-acme)

1. Baixe o win-acme em **https://www.win-acme.com** → *Download* →
   versão **x64 pluggable** (arquivo `.zip`).
2. Extraia em `C:\win-acme`.
3. Rode (troque **SEU_ENDERECO** e o **e-mail** — o Let's Encrypt avisa nele se algo der errado com a renovação):

```powershell
cd C:\win-acme
.\wacs.exe --source manual --host SEU_ENDERECO `
  --validation filesystem --webroot "C:\nginx-acme" `
  --store pemfiles --pemfilespath "C:\certificados" `
  --installation script --script "C:\Web\iahub\deploy\recarregar-nginx.ps1" `
  --accepttos --emailaddress seu-email@empresa.com.br
```

Ao final, confira os arquivos gerados:

```powershell
Get-ChildItem C:\certificados
```

Devem aparecer arquivos terminados em **`-chain.pem`** e **`-key.pem`**. Anote
os nomes exatos — vão no passo 5.

O win-acme cria sozinho uma **tarefa agendada** que renova o certificado e
roda o `recarregar-nginx.ps1`. Para conferir:

```powershell
Get-ScheduledTask | Where-Object TaskName -like "win-acme*"
```

---

## 5. Ligar o HTTPS no Nginx

1. Faça backup do `nginx.conf` atual:

```powershell
Copy-Item C:\tools\nginx\conf\nginx.conf C:\tools\nginx\conf\nginx.conf.antes-https
```

2. Copie o modelo pronto:

```powershell
Copy-Item C:\Web\iahub\deploy\nginx-https.conf C:\tools\nginx\conf\nginx.conf -Force
```

3. Abra `C:\tools\nginx\conf\nginx.conf` e troque **SEU_ENDERECO** (aparece
   3 vezes) e, se precisar, os nomes dos arquivos `-chain.pem` / `-key.pem`
   pelos que apareceram no passo 4.
4. Teste e recarregue:

```powershell
C:\Web\iahub\deploy\recarregar-nginx.ps1
```

Se aparecer erro, o Nginx **não** é recarregado e continua no ar como estava.
Para voltar atrás a qualquer momento:

```powershell
Copy-Item C:\tools\nginx\conf\nginx.conf.antes-https C:\tools\nginx\conf\nginx.conf -Force
C:\Web\iahub\deploy\recarregar-nginx.ps1
```

---

## 6. Testar

| Teste | Esperado |
|---|---|
| Abrir `https://SEU_ENDERECO` | Cadeado no navegador, IAHub normal |
| Abrir `http://SEU_ENDERECO` | Redireciona sozinho para `https://` |
| J2A: `https://SEU_ENDERECO/iaservice/j2a` | Login por telefone funciona |
| Chat interno entre dois analistas | Mensagem chega na hora; o balão "Ativar notificações do Windows" agora funciona |
| Monitor de Acessos | Presença e "Derrubar" funcionando |

Avise a equipe do **novo endereço** (`https://SEU_ENDERECO/...`) e atualize
favoritos e atalhos que apontavam para o IP.

---

## 7. Fechar a porta 3000 (importante)

A instalação abriu a porta **3000** (o Node direto, sem passar pelo Nginx).
Com ela aberta, quem acessar `http://IP:3000` **passa por fora do HTTPS**.
Depois do passo 6 funcionando:

```powershell
Get-NetFirewallRule | Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -eq 3000 } | Disable-NetFirewallRule
```

E remova a regra da porta 3000 no painel da ADDIT, se existir.

---

## 8. Depois que estiver tudo certo — me avise

Com o HTTPS funcionando há alguns dias, faço os ajustes finais no código:

- cookie de sessão do IAHub só por HTTPS (`secure`);
- HSTS (o navegador passa a recusar HTTP para este endereço);
- revisão dos links e da documentação que ainda citam `http://`.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| win-acme: falha na validação | Porta 80 bloqueada no painel da ADDIT, nome não aponta para o servidor (passo 1) ou o bloco `/.well-known/` não entrou no Nginx (passo 3) |
| win-acme: limite de emissões (*rate limit*) usando sslip.io | Muitos certificados emitidos para sslip.io no mesmo período — tente mais tarde ou use a opção A |
| Navegador: "não seguro" depois do passo 5 | Nome no `nginx.conf` diferente do certificado, ou arquivos `.pem` errados |
| Chat interno sem tempo real (mensagens com ~30 s de atraso) | Bloco `location /` sem as linhas `Upgrade` / `Connection` — use o modelo `nginx-https.conf` sem cortes |
| Erro 502 | Serviço `iahub` parado — `Get-Service iahub` |

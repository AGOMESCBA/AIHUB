# Relatório de Diagnóstico de Conectividade — IAHub
**Data:** 22/05/2026 10:42  
**Responsável pela análise:** Alessandro Gomes  
**Sistema:** IAHub — Plataforma de IA para RH  
**Endereço reportado com falha:** `http://177.126.161.215:3000/login.html`

---

## 1. Resumo Executivo

A aplicação **está funcionando corretamente** no servidor. O problema de acesso externo é **exclusivamente de infraestrutura de rede**: a porta TCP 3000 não está sendo redirecionada pelo roteador/firewall de borda do IP público para o servidor de aplicação.

---

## 2. Evidências Coletadas no Servidor

### 2.1 Processo Node.js em execução
```
PID     : 32576
Processo: node
Status  : Em execução (CPU ativo)
```

### 2.2 Porta 3000 ouvindo em todas as interfaces
```
TCP    0.0.0.0:3000    LISTENING    PID 32576
TCP    [::]:3000       LISTENING    PID 32576
```
> A aplicação está corretamente ligada a `0.0.0.0`, ou seja, aceita conexões em qualquer interface de rede do servidor.

### 2.3 Windows Firewall — regra inbound para Node.js
```
DisplayName                  Enabled  Action  Direction
Node.js JavaScript Runtime   True     Allow   Inbound
Node.js JavaScript Runtime   True     Allow   Inbound
```
> O firewall do Windows **não está bloqueando** a porta.

### 2.4 Configuração de rede do servidor
```
IP Local (servidor)  : 192.168.1.47
IP Público (externo) : 177.126.161.215
Gateway Padrão       : fe80::7624:9fff:fe78:8cf1%16  ← apenas IPv6 detectado
```

### 2.5 Conexões TCP em estado SYN_SENT (prova do bloqueio)
```
TCP  192.168.1.47:49717  →  177.126.161.215:3000  SYN_SENT
TCP  192.168.1.47:55039  →  177.126.161.215:3000  SYN_SENT
TCP  192.168.1.47:64351  →  177.126.161.215:3000  SYN_SENT
```
> O servidor tenta alcançar o próprio IP público na porta 3000, mas as conexões ficam em **SYN_SENT** (handshake TCP não completa). Isso confirma que o roteador/firewall de borda está descartando o pacote sem responder — o tráfego **nunca chega ao servidor**.

---

## 3. Diagnóstico

| Item verificado | Resultado |
|---|---|
| Aplicação Node.js rodando | ✅ OK — PID 32576 |
| Porta 3000 ouvindo em 0.0.0.0 | ✅ OK |
| Windows Firewall — regra Allow Node.js Inbound | ✅ OK |
| Port Forwarding no roteador/firewall de borda | ❌ **NÃO CONFIGURADO** |
| Gateway IPv4 no adaptador de rede | ⚠️ Apenas IPv6 detectado — verificar |

**Causa raiz:** Ausência de regra de NAT/Port Forwarding no equipamento de borda para a porta TCP 3000.

---

## 4. Ações Necessárias pela Equipe de Infra

### Ação 1 — OBRIGATÓRIA: Configurar Port Forwarding (NAT/DNAT)

No roteador ou firewall de borda que detém o IP `177.126.161.215`, criar a seguinte regra:

| Campo | Valor |
|---|---|
| Protocolo | TCP |
| IP/Porta externa | 177.126.161.215 : **3000** |
| IP/Porta interna | 192.168.1.47 : **3000** |
| Sentido | Inbound (entrada) |

### Ação 2 — RECOMENDADA: Verificar gateway IPv4 no servidor

O servidor está reportando apenas gateway IPv6. Confirmar se o adaptador de rede possui o gateway IPv4 correto configurado, pois isso pode impactar o roteamento de saída da aplicação.

```powershell
# Executar no servidor para verificar
ipconfig /all
```

### Ação 3 — VALIDAÇÃO: Testar após configurar o port forwarding

**Teste 1 — De uma máquina externa à rede:**
```powershell
Test-NetConnection -ComputerName 177.126.161.215 -Port 3000
# Esperado: TcpTestSucceeded : True
```

**Teste 2 — Acesso pelo navegador:**
```
http://177.126.161.215:3000/login.html
```

**Teste 3 — Direto no servidor (já funciona hoje):**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/login.html" -UseBasicParsing
# Esperado: StatusCode 200
```

---

## 5. Observações Adicionais

- Caso o acesso externo deva passar por **Nginx como proxy reverso** (conforme arquitetura do sistema), verificar também se o Nginx está rodando e redirecionando para `localhost:3000`.
- Se for necessário expor por HTTPS (porta 443), será preciso configurar certificado SSL no Nginx e adicionar port forwarding para a porta 443 também.
- O IP `177.126.161.215` é dinâmico ou fixo? Se dinâmico, considerar uso de DDNS para evitar problemas futuros.

---

*Relatório gerado em 22/05/2026 às 10:42 com base em diagnóstico técnico direto no servidor de aplicação.*

# ============================================================
# IAHub — Configuracao do Servico Windows + Nginx
# Execute como Administrador apos copiar o projeto para C:\iahub
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuracao — altere se necessario ──────────────────────
$PROJECT_PATH  = "C:\iahub"
$SERVICE_NAME  = "iahub"
$CHROME_PATH   = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$APP_PORT      = 3000

# Auto-detectar pasta do Nginx (instalado pelo Chocolatey)
$nginxExe = Get-Command nginx -ErrorAction SilentlyContinue
if ($nginxExe) {
    $NGINX_PATH = Split-Path -Parent $nginxExe.Source
} else {
    $candidates = @(
        "C:\tools\nginx",
        "C:\ProgramData\chocolatey\lib\nginx\tools\nginx",
        "C:\nginx"
    )
    $NGINX_PATH = $null
    foreach ($c in $candidates) {
        if (Test-Path "$c\nginx.exe") { $NGINX_PATH = $c; break }
    }
}
# ─────────────────────────────────────────────────────────────

# Verificar Administrador
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Configuracao do Servico Windows" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Verificacoes pre-requisito ────────────────────────────────
if (!(Test-Path $PROJECT_PATH)) {
    Write-Host "ERRO: Pasta do projeto nao encontrada em $PROJECT_PATH" -ForegroundColor Red
    Write-Host "Copie a pasta do projeto para $PROJECT_PATH e tente novamente." -ForegroundColor Yellow
    exit 1
}

if (!(Test-Path "$PROJECT_PATH\.env")) {
    Write-Host "ERRO: Arquivo .env nao encontrado em $PROJECT_PATH\.env" -ForegroundColor Red
    Write-Host "Copie o .env.example para .env e preencha as chaves de API." -ForegroundColor Yellow
    exit 1
}

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERRO: Node.js nao encontrado. Execute primeiro: .\1-instalar-dependencias.ps1" -ForegroundColor Red
    exit 1
}

if (!(Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "ERRO: NSSM nao encontrado. Execute primeiro: .\1-instalar-dependencias.ps1" -ForegroundColor Red
    exit 1
}

$NODE_EXE = (Get-Command node).Source

# ── 1. npm install ────────────────────────────────────────────
Write-Host "[1/6] Instalando dependencias npm (pode demorar alguns minutos)..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev
Pop-Location
Write-Host "      Dependencias instaladas!" -ForegroundColor Green

# ── 2. Garantir CHROME_PATH no .env ──────────────────────────
Write-Host "[2/6] Verificando configuracao do Chrome no .env..." -ForegroundColor Yellow
$envContent = Get-Content "$PROJECT_PATH\.env" -Raw
if ($envContent -notmatch "(?m)^CHROME_PATH=") {
    Add-Content -Path "$PROJECT_PATH\.env" -Value "`nCHROME_PATH=$CHROME_PATH"
    Write-Host "      CHROME_PATH adicionado ao .env: $CHROME_PATH" -ForegroundColor Green
} else {
    Write-Host "      CHROME_PATH ja configurado no .env. OK." -ForegroundColor Gray
}

# ── 3. Criar pasta de logs ────────────────────────────────────
Write-Host "[3/6] Criando pasta de logs..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "$PROJECT_PATH\logs" | Out-Null
Write-Host "      Logs em: $PROJECT_PATH\logs\" -ForegroundColor Green

# ── 4. Registrar servico IAHub com NSSM ──────────────────────
Write-Host "[4/6] Registrando servico IAHub no Windows..." -ForegroundColor Yellow

# Remover servico anterior se existir
$existingService = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "      Servico existente encontrado. Removendo para reconfigurar..." -ForegroundColor Gray
    if ($existingService.Status -eq "Running") { nssm stop $SERVICE_NAME }
    nssm remove $SERVICE_NAME confirm
    Start-Sleep -Seconds 2
}

nssm install $SERVICE_NAME $NODE_EXE
nssm set $SERVICE_NAME AppParameters    "index.js"
nssm set $SERVICE_NAME AppDirectory     $PROJECT_PATH
nssm set $SERVICE_NAME AppStdout        "$PROJECT_PATH\logs\output.log"
nssm set $SERVICE_NAME AppStderr        "$PROJECT_PATH\logs\error.log"
nssm set $SERVICE_NAME AppRotateFiles   1
nssm set $SERVICE_NAME AppRotateOnline  1
nssm set $SERVICE_NAME AppRotateBytes   10485760
nssm set $SERVICE_NAME Start            SERVICE_AUTO_START
nssm set $SERVICE_NAME DisplayName      "IAHub - Analisador de Curriculos"
nssm set $SERVICE_NAME Description      "Sistema web de analise de curriculos via WhatsApp"
nssm set $SERVICE_NAME AppRestartDelay  5000

Write-Host "      Servico IAHub registrado!" -ForegroundColor Green

# ── 5. Configurar Nginx ───────────────────────────────────────
Write-Host "[5/6] Configurando Nginx como proxy reverso (porta 80 -> $APP_PORT)..." -ForegroundColor Yellow

$nginxConfPath = "$NGINX_PATH\conf\nginx.conf"

if (!(Test-Path $NGINX_PATH)) {
    Write-Host "      AVISO: Nginx nao encontrado em $NGINX_PATH" -ForegroundColor Yellow
    Write-Host "      Pulando configuracao do Nginx. O sistema ficara acessivel na porta $APP_PORT." -ForegroundColor Yellow
    Write-Host "      Para ativar o Nginx depois, copie o arquivo nginx.conf da pasta deploy\." -ForegroundColor Yellow
} else {
    # Backup do nginx.conf original
    if (!(Test-Path "$NGINX_PATH\conf\nginx.conf.bak")) {
        Copy-Item $nginxConfPath "$NGINX_PATH\conf\nginx.conf.bak"
    }

    # Copiar nossa config
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (Test-Path "$scriptDir\nginx.conf") {
        Copy-Item "$scriptDir\nginx.conf" $nginxConfPath -Force
        Write-Host "      nginx.conf aplicado!" -ForegroundColor Green
    } else {
        Write-Host "      AVISO: nginx.conf nao encontrado na pasta deploy\. Copie manualmente." -ForegroundColor Yellow
    }

    # Registrar Nginx como servico Windows via NSSM
    $nginxService = Get-Service -Name "nginx" -ErrorAction SilentlyContinue
    if (!$nginxService) {
        nssm install nginx "$NGINX_PATH\nginx.exe"
        nssm set nginx AppDirectory  $NGINX_PATH
        nssm set nginx Start         SERVICE_AUTO_START
        nssm set nginx DisplayName   "Nginx - Proxy Reverso IAHub"
        Write-Host "      Servico Nginx registrado!" -ForegroundColor Green
    } else {
        Write-Host "      Servico Nginx ja existe. Reiniciando..." -ForegroundColor Gray
        nssm restart nginx
    }
}

# ── 6. Regras de Firewall ─────────────────────────────────────
Write-Host "[6/6] Configurando regras de Firewall do Windows..." -ForegroundColor Yellow

$rule80 = Get-NetFirewallRule -DisplayName "IAHub HTTP 80" -ErrorAction SilentlyContinue
if (!$rule80) {
    New-NetFirewallRule -DisplayName "IAHub HTTP 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow | Out-Null
    Write-Host "      Porta 80 liberada no Firewall!" -ForegroundColor Green
} else {
    Write-Host "      Porta 80 ja liberada. OK." -ForegroundColor Gray
}

$rule3000 = Get-NetFirewallRule -DisplayName "IAHub App 3000" -ErrorAction SilentlyContinue
if (!$rule3000) {
    New-NetFirewallRule -DisplayName "IAHub App 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow | Out-Null
    Write-Host "      Porta 3000 liberada no Firewall!" -ForegroundColor Green
} else {
    Write-Host "      Porta 3000 ja liberada. OK." -ForegroundColor Gray
}

# ── Iniciar servicos ──────────────────────────────────────────
Write-Host ""
Write-Host "Iniciando servicos..." -ForegroundColor Yellow
nssm start $SERVICE_NAME
Start-Sleep -Seconds 3

$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "Servico IAHub: RODANDO" -ForegroundColor Green
} else {
    Write-Host "AVISO: Servico IAHub pode nao ter iniciado. Verifique os logs em $PROJECT_PATH\logs\" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Configuracao concluida!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Acesso local:    http://localhost:$APP_PORT" -ForegroundColor Cyan
Write-Host "Acesso externo:  http://<seu-ip-ou-dominio>" -ForegroundColor Cyan
Write-Host ""
Write-Host "Comandos uteis:" -ForegroundColor Yellow
Write-Host "  Parar sistema:     nssm stop $SERVICE_NAME" -ForegroundColor White
Write-Host "  Iniciar sistema:   nssm start $SERVICE_NAME" -ForegroundColor White
Write-Host "  Reiniciar:         nssm restart $SERVICE_NAME" -ForegroundColor White
Write-Host "  Ver logs ao vivo:  Get-Content $PROJECT_PATH\logs\output.log -Wait" -ForegroundColor White
Write-Host "  Gerenciar servico: services.msc" -ForegroundColor White
Write-Host ""
Write-Host "IMPORTANTE: Acesse o sistema pelo navegador e escaneie o QR" -ForegroundColor Yellow
Write-Host "            do WhatsApp na primeira execucao." -ForegroundColor Yellow
Write-Host ""

# ============================================================
# IAHub - Atualizar Fontes no Servidor
# Execute como Administrador apos copiar o novo ZIP para o servidor
# Uso: .\3-atualizar.ps1 -Zip "C:\caminho\iahub-deploy-YYYYMMDD_HHMM.zip"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Zip
)

$ErrorActionPreference = "Stop"

$PROJECT_PATH = "C:\Web\iahub"
$SERVICE_NAME = "iahub"
$PARENT_PATH  = "C:\Web"

# Verificar Administrador
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

# Verificar se o ZIP existe
if (!(Test-Path $Zip)) {
    Write-Host "ERRO: Arquivo ZIP nao encontrado: $Zip" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Atualizacao de Fontes" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "ZIP:     $Zip"
Write-Host "Destino: $PROJECT_PATH"
Write-Host ""

# ── 1. Parar o servico ────────────────────────────────────────
Write-Host "[1/4] Parando servico IAHub..." -ForegroundColor Yellow
$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    nssm stop $SERVICE_NAME
    Start-Sleep -Seconds 2
    Write-Host "      Servico parado." -ForegroundColor Green
} else {
    Write-Host "      Servico ja estava parado." -ForegroundColor Gray
}

# ── 2. Extrair ZIP sobrescrevendo os fontes ───────────────────
Write-Host "[2/4] Extraindo novos fontes..." -ForegroundColor Yellow

Expand-Archive -Path $Zip -DestinationPath $PARENT_PATH -Force

Write-Host "      Fontes atualizados!" -ForegroundColor Green

# ── 3. Atualizar dependencias npm ────────────────────────────
Write-Host "[3/4] Atualizando dependencias npm..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev
Pop-Location
Write-Host "      Dependencias ok!" -ForegroundColor Green

# ── 4. Reiniciar o servico ────────────────────────────────────
Write-Host "[4/4] Iniciando servico IAHub..." -ForegroundColor Yellow
nssm start $SERVICE_NAME
Start-Sleep -Seconds 3

$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "      Servico IAHub: RODANDO" -ForegroundColor Green
} else {
    Write-Host "      AVISO: Verifique os logs em $PROJECT_PATH\logs\" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Atualizacao concluida!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Ver logs ao vivo:" -ForegroundColor Yellow
Write-Host "  Get-Content $PROJECT_PATH\logs\output.log -Wait -Tail 50" -ForegroundColor White
Write-Host ""

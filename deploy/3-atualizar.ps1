# ============================================================
# IAHub — Atualizar Fontes no Servidor
# Execute como Administrador apos copiar o novo ZIP para o servidor
# Uso: .\3-atualizar.ps1 -Zip "C:\caminho\iahub-deploy-YYYYMMDD_HHMM.zip"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Zip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PROJECT_PATH = "C:\iahub"
$SERVICE_NAME = "iahub"

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

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::OpenRead($Zip)
foreach ($entry in $zip.Entries) {
    # Ignora entradas de diretorio
    if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { continue }

    # Remove o prefixo "iahub\" do caminho dentro do ZIP
    $relative = $entry.FullName -replace '^iahub[\\/]', ''
    $dest = Join-Path $PROJECT_PATH $relative

    # Garante que a pasta de destino existe
    $destDir = Split-Path $dest -Parent
    if (!(Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    # Extrai o arquivo sobrescrevendo
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
}
$zip.Dispose()

Write-Host "      Fontes atualizados!" -ForegroundColor Green

# ── 3. Atualizar dependencias npm (se package.json mudou) ─────
Write-Host "[3/4] Atualizando dependencias npm..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev --prefer-offline 2>&1 | Out-Null
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

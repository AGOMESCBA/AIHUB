# ============================================================
# IAHub — Instalacao de Dependencias no Windows Server
# Execute como Administrador: clique direito > "Executar como administrador"
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Verificar se esta rodando como Administrador
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    Write-Host "Clique direito no PowerShell > Executar como administrador" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Instalacao de Dependencias" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Chocolatey ────────────────────────────────────────────
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "[1/5] Instalando Chocolatey (gerenciador de pacotes)..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Write-Host "      Chocolatey instalado!" -ForegroundColor Green
} else {
    Write-Host "[1/5] Chocolatey ja instalado. Pulando..." -ForegroundColor Gray
}

# Recarregar PATH para ter o choco disponivel
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ── 2. Node.js LTS ───────────────────────────────────────────
Write-Host "[2/5] Instalando Node.js LTS..." -ForegroundColor Yellow
choco install nodejs-lts -y
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Write-Host "      Node.js $(node --version) instalado!" -ForegroundColor Green

# ── 3. Google Chrome ─────────────────────────────────────────
Write-Host "[3/5] Instalando Google Chrome (necessario para WhatsApp Web)..." -ForegroundColor Yellow
choco install googlechrome -y
Write-Host "      Google Chrome instalado!" -ForegroundColor Green

# ── 4. NSSM (gerenciador de servicos Windows) ────────────────
Write-Host "[4/5] Instalando NSSM (servico Windows)..." -ForegroundColor Yellow
choco install nssm -y
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Write-Host "      NSSM instalado!" -ForegroundColor Green

# ── 5. Nginx ─────────────────────────────────────────────────
Write-Host "[5/5] Instalando Nginx (proxy reverso porta 80)..." -ForegroundColor Yellow
choco install nginx -y
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Write-Host "      Nginx instalado!" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Instalacao concluida com sucesso!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo passo:" -ForegroundColor Yellow
Write-Host "  1. Copie a pasta do projeto para C:\Web\iahub" -ForegroundColor White
Write-Host "  2. Configure o arquivo C:\Web\iahub\.env com suas chaves de API" -ForegroundColor White
Write-Host "  3. Execute: .\2-configurar-servico.ps1" -ForegroundColor White
Write-Host ""

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
$BACKUP_ROOT  = "C:\Web\backups"

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

Add-Type -AssemblyName System.IO.Compression.FileSystem

$protectedEntryPattern = '(^|/)(data|uploads|sessions|\.wwebjs_auth|\.wwebjs_cache)(/|$)|(^|/)iahub/\.env$|\.(db|sqlite|sqlite3)$'
$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
    $protectedEntries = @($zipCheck.Entries | Where-Object { $_.FullName -match $protectedEntryPattern } | Select-Object -First 20)
} finally {
    $zipCheck.Dispose()
}

if ($protectedEntries.Count -gt 0) {
    Write-Host "ERRO: O ZIP contem caminhos protegidos de dados/configuracao. Atualizacao cancelada." -ForegroundColor Red
    $protectedEntries | ForEach-Object { Write-Host "  - $($_.FullName)" -ForegroundColor Yellow }
    Write-Host "Gere novamente o pacote com deploy\0-gerar-pacote.ps1." -ForegroundColor Yellow
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
Write-Host "[1/5] Parando servico IAHub..." -ForegroundColor Yellow
$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    nssm stop $SERVICE_NAME
    Start-Sleep -Seconds 2
    Write-Host "      Servico parado." -ForegroundColor Green
} else {
    Write-Host "      Servico ja estava parado." -ForegroundColor Gray
}

# ── 2. Extrair ZIP sobrescrevendo os fontes ───────────────────
Write-Host "[2/5] Gerando backup dos fontes atuais..." -ForegroundColor Yellow

if (Test-Path $PROJECT_PATH) {
    if (!(Test-Path $BACKUP_ROOT)) {
        New-Item -ItemType Directory -Path $BACKUP_ROOT | Out-Null
    }

    $backupZip = Join-Path $BACKUP_ROOT ("iahub-before-update-{0}.zip" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    $backupExcludes = @("node_modules", ".wwebjs_auth", ".wwebjs_cache", "logs")
    $backupFiles = Get-ChildItem -Path $PROJECT_PATH -Recurse -File | Where-Object {
        $relative = $_.FullName.Substring($PROJECT_PATH.Length + 1)
        $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $skip = $false
        foreach ($dir in $backupExcludes) {
            if ($parts -contains $dir) { $skip = $true; break }
        }
        !$skip
    }

    $zipBackup = [System.IO.Compression.ZipFile]::Open($backupZip, 'Create')
    foreach ($file in $backupFiles) {
        $relative = $file.FullName.Substring($PROJECT_PATH.Length + 1)
        $entry = $zipBackup.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fs = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $fs.CopyTo($entryStream)
        $fs.Dispose()
        $entryStream.Dispose()
    }
    $zipBackup.Dispose()
    Write-Host "      Backup: $backupZip" -ForegroundColor Green
} else {
    Write-Host "      Pasta atual nao existe; backup ignorado." -ForegroundColor Gray
}

Write-Host "[3/5] Extraindo novos fontes..." -ForegroundColor Yellow

Expand-Archive -Path $Zip -DestinationPath $PARENT_PATH -Force

Write-Host "      Fontes atualizados!" -ForegroundColor Green

# ── 3. Atualizar dependencias npm ────────────────────────────
Write-Host "[4/5] Atualizando dependencias npm..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev
Pop-Location
Write-Host "      Dependencias ok!" -ForegroundColor Green

# ── 4. Reiniciar o servico ────────────────────────────────────
Write-Host "[5/5] Iniciando servico IAHub..." -ForegroundColor Yellow
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

# ============================================================
# IAHub - Restaurar Fontes no Servidor
# Execute como Administrador.
# Uso:
#   C:\Web\iahub\deploy\4-restaurar.ps1
#   C:\Web\iahub\deploy\4-restaurar.ps1 -Backup "C:\Web\backups\iahub-before-update-YYYYMMDD_HHMMSS.zip"
# ============================================================

param(
    [string]$Backup
)

$ErrorActionPreference = "Stop"

$PROJECT_PATH = "C:\Web\iahub"
$SERVICE_NAME = "iahub"
$BACKUP_ROOT  = "C:\Web\backups"
$TEMP_PATH    = "C:\Web\restore-iahub-temp"

function Assert-Admin {
    if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
        Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
        exit 1
    }
}

function New-SourceBackup {
    param(
        [Parameter(Mandatory=$true)]
        [string]$OutputZip
    )

    if (!(Test-Path $PROJECT_PATH)) {
        Write-Host "      Pasta atual nao existe; backup pre-restore ignorado." -ForegroundColor Gray
        return
    }

    $backupExcludes = @("node_modules", ".wwebjs_auth", ".wwebjs_cache", "logs", "data", "uploads", "sessions")
    $backupFiles = Get-ChildItem -Path $PROJECT_PATH -Recurse -File | Where-Object {
        $relative = $_.FullName.Substring($PROJECT_PATH.Length + 1)
        $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $skip = $false
        foreach ($dir in $backupExcludes) {
            if ($parts -contains $dir) { $skip = $true; break }
        }
        if (!$skip -and ($_.Name -in @(".env", "data.json") -or $_.Name -like "*.db" -or $_.Name -like "*.sqlite" -or $_.Name -like "*.sqlite3" -or $_.Name -like "*.log" -or $_.Name -like "*.err")) {
            $skip = $true
        }
        !$skip
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipBackup = [System.IO.Compression.ZipFile]::Open($OutputZip, 'Create')
    try {
        foreach ($file in $backupFiles) {
            $relative = $file.FullName.Substring($PROJECT_PATH.Length + 1)
            $entry = $zipBackup.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            $fs = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                $fs.CopyTo($entryStream)
            } finally {
                $fs.Dispose()
                $entryStream.Dispose()
            }
        }
    } finally {
        $zipBackup.Dispose()
    }
}

Assert-Admin

if (!(Test-Path $BACKUP_ROOT)) {
    Write-Host "ERRO: Pasta de backups nao encontrada: $BACKUP_ROOT" -ForegroundColor Red
    exit 1
}

if (!$Backup) {
    $latest = Get-ChildItem -Path $BACKUP_ROOT -Filter "iahub-before-update-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (!$latest) {
        Write-Host "ERRO: Nenhum backup iahub-before-update-*.zip encontrado em $BACKUP_ROOT" -ForegroundColor Red
        exit 1
    }
    $Backup = $latest.FullName
}

if (!(Test-Path $Backup)) {
    Write-Host "ERRO: Backup nao encontrado: $Backup" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Restauracao de Fontes" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backup:  $Backup"
Write-Host "Destino: $PROJECT_PATH"
Write-Host ""
Write-Host "Dados preservados: .env, data, uploads, sessions, logs, WhatsApp auth/cache, bancos locais" -ForegroundColor Yellow
Write-Host ""

Write-Host "[1/6] Parando servico IAHub..." -ForegroundColor Yellow
$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    nssm stop $SERVICE_NAME
    Start-Sleep -Seconds 2
    Write-Host "      Servico parado." -ForegroundColor Green
} else {
    Write-Host "      Servico ja estava parado." -ForegroundColor Gray
}

Write-Host "[2/6] Salvando copia dos fontes atuais antes da restauracao..." -ForegroundColor Yellow
if (!(Test-Path $BACKUP_ROOT)) {
    New-Item -ItemType Directory -Path $BACKUP_ROOT | Out-Null
}
$preRestoreZip = Join-Path $BACKUP_ROOT ("iahub-before-restore-{0}.zip" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
New-SourceBackup -OutputZip $preRestoreZip
Write-Host "      Backup pre-restore: $preRestoreZip" -ForegroundColor Green

Write-Host "[3/6] Extraindo backup em pasta temporaria..." -ForegroundColor Yellow
if (Test-Path $TEMP_PATH) {
    Remove-Item -LiteralPath $TEMP_PATH -Recurse -Force
}
New-Item -ItemType Directory -Path $TEMP_PATH | Out-Null
Expand-Archive -Path $Backup -DestinationPath $TEMP_PATH -Force
Write-Host "      Extraido em: $TEMP_PATH" -ForegroundColor Green

Write-Host "[4/6] Restaurando fontes sem tocar nos dados..." -ForegroundColor Yellow
$robocopyArgs = @(
    $TEMP_PATH,
    $PROJECT_PATH,
    "/E",
    "/XD", "data", "uploads", "sessions", "logs", "node_modules", ".wwebjs_auth", ".wwebjs_cache",
    "/XF", ".env", "data.json", "*.db", "*.sqlite", "*.sqlite3", "*.log", "*.err"
)

& robocopy @robocopyArgs | Out-Host
$roboExit = $LASTEXITCODE
if ($roboExit -ge 8) {
    Write-Host "ERRO: Robocopy falhou com codigo $roboExit." -ForegroundColor Red
    exit $roboExit
}
Write-Host "      Fontes restaurados." -ForegroundColor Green

Write-Host "[5/6] Atualizando dependencias npm..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev
Pop-Location
Write-Host "      Dependencias ok." -ForegroundColor Green

Write-Host "[6/6] Iniciando servico IAHub..." -ForegroundColor Yellow
nssm start $SERVICE_NAME
Start-Sleep -Seconds 3

$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "      Servico IAHub: RODANDO" -ForegroundColor Green
} else {
    Write-Host "      AVISO: Verifique os logs em $PROJECT_PATH\logs\" -ForegroundColor Yellow
}

if (Test-Path $TEMP_PATH) {
    Remove-Item -LiteralPath $TEMP_PATH -Recurse -Force
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Restauracao concluida!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backup usado:          $Backup" -ForegroundColor Cyan
Write-Host "Backup pre-restore:    $preRestoreZip" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ver logs ao vivo:" -ForegroundColor Yellow
Write-Host "  Get-Content $PROJECT_PATH\logs\output.log -Wait -Tail 50" -ForegroundColor White
Write-Host ""

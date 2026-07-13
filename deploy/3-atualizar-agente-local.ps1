# ============================================================
# IA Command - Atualizar Agente Local no Servidor
# Execute como Administrador no servidor onde o Agente Local roda.
# Uso:
#   .\3-atualizar-agente-local.ps1 -Zip .\iac-agente-local-update-YYYYMMDD_HHMM.zip
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Zip,

    [string]$Destino = "C:\Web\iahub\apps\IA Command\agente-local"
)

$ErrorActionPreference = "Stop"

$SERVICE_CANDIDATES = @(
    "IA Hub - IACommand_AgenteLocal_API",
    "IACommand_AgenteLocal_API",
    "IACommand-Agente",
    "IACommand"
)
$BACKUP_ROOT = "C:\Web\backups"

function Get-ExistingServiceName {
    param([string[]]$Candidates)

    foreach ($name in $Candidates) {
        $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($svc) { return $svc.Name }
    }

    foreach ($name in $Candidates) {
        $svc = Get-Service | Where-Object { $_.DisplayName -eq $name } | Select-Object -First 1
        if ($svc) { return $svc.Name }
    }

    return $null
}

function Get-ServicePythonPath {
    param([string]$ServiceName)

    if ($ServiceName) {
        $nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
        if ($nssmCmd) {
            try {
                $value = (& $nssmCmd.Source get $ServiceName Application 2>$null | Select-Object -First 1)
                if ($value -and (Test-Path $value)) { return $value }
            } catch {
                return $null
            }
        }
    }

    return $null
}

function Get-GlobalPython {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "C:\Program Files\Python311\python.exe",
        "C:\Program Files\Python312\python.exe",
        "C:\Python311\python.exe",
        "C:\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    return $null
}

function Stop-AgentService {
    param([string]$ServiceName)

    if (!$ServiceName) {
        Write-Host "      Servico do Agente Local nao encontrado; arquivos serao atualizados sem restart automatico." -ForegroundColor Yellow
        return
    }

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Stop-Service -Name $ServiceName -Force
        $svc.WaitForStatus('Stopped', '00:00:30')
        Write-Host "      Servico parado: $ServiceName" -ForegroundColor Green
    } else {
        Write-Host "      Servico ja estava parado: $ServiceName" -ForegroundColor Gray
    }
}

function Start-AgentService {
    param([string]$ServiceName)

    if (!$ServiceName) { return }

    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host "      Servico Agente Local: RODANDO" -ForegroundColor Green
    } else {
        Write-Host "      AVISO: Agente Local nao ficou Running. Verifique logs do servico." -ForegroundColor Yellow
    }
}

function New-AgentBackup {
    param([string]$Path)

    if (!(Test-Path $Path)) {
        Write-Host "      Pasta atual nao existe; backup ignorado." -ForegroundColor Gray
        return
    }

    if (!(Test-Path $BACKUP_ROOT)) {
        New-Item -ItemType Directory -Path $BACKUP_ROOT | Out-Null
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $backupZip = Join-Path $BACKUP_ROOT ("agente-local-before-update-{0}.zip" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    $excludeDirs = @("venv", "logs", "__pycache__", ".pytest_cache", "dist")
    $excludeFiles = @("*.pyc")

    $files = Get-ChildItem -Path $Path -Recurse -File | Where-Object {
        $relative = $_.FullName.Substring($Path.Length + 1)
        $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)

        foreach ($dir in $excludeDirs) {
            if ($parts -contains $dir) { return $false }
        }

        foreach ($pattern in $excludeFiles) {
            if ($_.Name -like $pattern) { return $false }
        }

        return $true
    }

    $zipBackup = [System.IO.Compression.ZipFile]::Open($backupZip, 'Create')
    try {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($Path.Length + 1)
            $entry = $zipBackup.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            $fs = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $fs.CopyTo($entryStream)
            $fs.Dispose()
            $entryStream.Dispose()
        }
    } finally {
        $zipBackup.Dispose()
    }

    Write-Host "      Backup: $backupZip" -ForegroundColor Green
}

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $Zip)) {
    Write-Host "ERRO: ZIP nao encontrado: $Zip" -ForegroundColor Red
    exit 1
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$protectedEntryPattern = '(^|/)(venv|logs|__pycache__)(/|$)|(^|/)agente-local/\.env$|(^|/)agente-local/audit\.db$|\.(db|sqlite|sqlite3|pyc)$'
$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
    $protectedEntries = @($zipCheck.Entries | Where-Object { $_.FullName -match $protectedEntryPattern } | Select-Object -First 20)
} finally {
    $zipCheck.Dispose()
}

if ($protectedEntries.Count -gt 0) {
    Write-Host "ERRO: O ZIP contem arquivos protegidos do Agente Local. Atualizacao cancelada." -ForegroundColor Red
    $protectedEntries | ForEach-Object { Write-Host "  - $($_.FullName)" -ForegroundColor Yellow }
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IA Command - Atualizacao Agente Local" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "ZIP:     $Zip"
Write-Host "Destino: $Destino"
Write-Host ""

$serviceName = Get-ExistingServiceName $SERVICE_CANDIDATES
$servicePythonBefore = Get-ServicePythonPath $serviceName

Write-Host "[1/6] Parando servico..." -ForegroundColor Yellow
Stop-AgentService $serviceName

Write-Host "[2/6] Backup dos arquivos atuais..." -ForegroundColor Yellow
New-AgentBackup $Destino

Write-Host "[3/6] Extraindo pacote..." -ForegroundColor Yellow
$tempRoot = Join-Path $env:TEMP ("iac-agente-update-{0}" -f ([guid]::NewGuid().ToString("N")))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
    Expand-Archive -Path $Zip -DestinationPath $tempRoot -Force
    $source = Join-Path $tempRoot "agente-local"
    if (!(Test-Path $source)) {
        throw "O ZIP nao contem a pasta raiz agente-local."
    }

    if (!(Test-Path $Destino)) {
        New-Item -ItemType Directory -Path $Destino | Out-Null
    }

    Copy-Item -Path (Join-Path $source "*") -Destination $Destino -Recurse -Force
    Write-Host "      Arquivos atualizados." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[4/6] Atualizando dependencias Python..." -ForegroundColor Yellow
$python = $servicePythonBefore
if (!$python -or !(Test-Path $python)) {
    $python = Join-Path $Destino "venv\Scripts\python.exe"
}

if (!(Test-Path $python)) {
    $globalPython = Get-GlobalPython
    if (!$globalPython) {
        throw "Python do venv nao encontrado e Python global nao localizado para criar venv."
    }

    Write-Host "      Criando venv do Agente Local..." -ForegroundColor Yellow
    & $globalPython -m venv (Join-Path $Destino "venv")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar venv do Agente Local." }
    $python = Join-Path $Destino "venv\Scripts\python.exe"
}

$requirements = Join-Path $Destino "requirements.txt"
if (!(Test-Path $requirements)) {
    throw "requirements.txt nao encontrado em: $requirements"
}

Write-Host "      Python: $python" -ForegroundColor Gray
& $python -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { throw "pip install falhou." }

Write-Host "[5/6] Validando Agente Local..." -ForegroundColor Yellow
$pyFiles = @(
    (Join-Path $Destino "main.py"),
    (Join-Path $Destino "crypto_envelope.py"),
    (Join-Path $Destino "config.py")
)
& $python -m py_compile $pyFiles
if ($LASTEXITCODE -ne 0) { throw "py_compile falhou." }

& $python -c "from cryptography.hazmat.primitives.ciphers.aead import AESGCM; print('venv crypto ok')"
if ($LASTEXITCODE -ne 0) { throw "Validacao AESGCM falhou." }

Write-Host "[6/6] Iniciando servico..." -ForegroundColor Yellow
Start-AgentService $serviceName

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Agente Local atualizado com sucesso!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Arquivos preservados: .env, venv, logs e audit.db." -ForegroundColor Cyan
Write-Host ""

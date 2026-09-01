# ============================================================
# IAHub - Atualizar Fontes no Servidor
# Execute como Administrador apos copiar o novo ZIP para o servidor
# Uso: .\3-atualizar.ps1 -Zip "C:\caminho\iahub-deploy-YYYYMMDD_HHMM.zip"
# Modo seguro: nao apaga banco, .env, uploads, sessoes ou diretorios de dados.
# ============================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$Zip
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_PATH = "C:\Web\iahub"
$SERVICE_NAME = "iahub"
$PARENT_PATH  = "C:\Web"
$BACKUP_ROOT  = "C:\Web\backups"
$STOPPED_SERVICES = @()
$SERVICE_STOP_TIMEOUT_SECONDS = 90
$SERVICE_START_TIMEOUT_SECONDS = 120

# Verificar Administrador
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

# Se o ZIP nao for informado, usa o pacote mais recente na pasta deploy.
if ([string]::IsNullOrWhiteSpace($Zip)) {
    $latestZip = Get-ChildItem -Path $SCRIPT_DIR -Filter "iahub-deploy-*.zip" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (!$latestZip) {
        Write-Host "ERRO: Informe -Zip ou copie um iahub-deploy-*.zip para $SCRIPT_DIR" -ForegroundColor Red
        exit 1
    }

    $Zip = $latestZip.FullName
}

if (![System.IO.Path]::IsPathRooted($Zip)) {
    $Zip = Join-Path $SCRIPT_DIR $Zip
}

# Verificar se o ZIP existe
if (!(Test-Path $Zip)) {
    Write-Host "ERRO: Arquivo ZIP nao encontrado: $Zip" -ForegroundColor Red
    exit 1
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-ZipEntryUnsafe {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name
    )

    $entryName = $Name.Replace('\', '/')

    if ([string]::IsNullOrWhiteSpace($entryName)) {
        return "entrada vazia"
    }

    if ($entryName -notmatch '^iahub(/|$)') {
        return "fora da pasta iahub"
    }

    if ($entryName -match '(^|/)\.\.(/|$)|^[A-Za-z]:') {
        return "caminho invalido"
    }

    if ($entryName -match '^iahub/(data|uploads|sessions|\.wwebjs_auth|\.wwebjs_cache|logs|backups|node_modules)(/|$)') {
        return "diretorio protegido"
    }

    if ($entryName -match '(^|/)\.env$|(^|/)data\.json$|\.(db|sqlite|sqlite3|sqlite-wal|sqlite-shm)$') {
        return "arquivo protegido"
    }

    return $null
}

function Stop-ServiceIfRunning {
    param(
        [Parameter(Mandatory=$true)]
        [System.ServiceProcess.ServiceController]$Service
    )

    if ($Service.Status -ne "Running" -and $Service.Status -ne "StartPending" -and $Service.Status -ne "StopPending") {
        return
    }

    $serviceName = $Service.Name
    Write-Host "      Parando $serviceName ($($Service.DisplayName))..." -ForegroundColor Gray

    if ($Service.Status -eq "StopPending") {
        if (Wait-ServiceState -Name $serviceName -DesiredStatus "Stopped" -TimeoutSeconds $SERVICE_STOP_TIMEOUT_SECONDS) {
            $script:STOPPED_SERVICES += $serviceName
            return
        }
    } else {
        Invoke-Nssm -Arguments @("stop", $serviceName)
    }

    if (!(Wait-ServiceState -Name $serviceName -DesiredStatus "Stopped" -TimeoutSeconds $SERVICE_STOP_TIMEOUT_SECONDS)) {
        try {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
        } catch {}

        if (!(Wait-ServiceState -Name $serviceName -DesiredStatus "Stopped" -TimeoutSeconds 30)) {
            $current = Get-ServiceStatusText -Name $serviceName
            throw "Servico $serviceName nao parou dentro do tempo esperado. Status atual: $current"
        }
    }

    $script:STOPPED_SERVICES += $serviceName
}

function Invoke-Nssm {
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & nssm @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($output) {
        $output | ForEach-Object { Write-Host $_ }
    }

    $texto = ($output | Out-String)
    $startPendente = $Arguments.Count -gt 0 `
        -and $Arguments[0] -eq "start" `
        -and $texto -match "SERVICE_START_PENDING"

    if ($exitCode -and !$startPendente) {
        throw "Falha ao executar nssm $($Arguments -join ' '). Codigo: $exitCode"
    }
}

function Get-ServiceStatusText {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name
    )

    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (!$svc) { return "Nao encontrado" }
    return [string]$svc.Status
}

function Wait-ServiceState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name,

        [Parameter(Mandatory=$true)]
        [string]$DesiredStatus,

        [Parameter(Mandatory=$true)]
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if (!$svc) { return $false }
        if ([string]$svc.Status -eq $DesiredStatus) { return $true }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Stop-IaHubServices {
    Write-Host "[1/5] Parando servicos IAHub/WhatsApp..." -ForegroundColor Yellow

    $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq $SERVICE_NAME -or
        $_.Name -like "IACommand-*" -or
        $_.Name -like "IACommand_*" -or
        $_.Name -like "IAHub-IACommand-*" -or
        $_.DisplayName -like "IAHub - IACommand-*"
    } | Sort-Object { if ($_.Name -eq $SERVICE_NAME) { 1 } else { 0 } }, Name)

    if ($services.Count -eq 0) {
        Write-Host "      Nenhum servico IAHub encontrado." -ForegroundColor Gray
        return
    }

    foreach ($service in $services) {
        if ($service.Status -eq "Running" -or $service.Status -eq "StartPending") {
            Stop-ServiceIfRunning -Service $service
        } else {
            Write-Host "      $($service.Name) ja estava parado." -ForegroundColor Gray
        }
    }
}

function Start-IaHubServices {
    Write-Host "[5/5] Iniciando servicos IAHub/WhatsApp..." -ForegroundColor Yellow

    $toStart = @($script:STOPPED_SERVICES | Select-Object -Unique)
    if ($toStart.Count -eq 0) {
        $toStart = @($SERVICE_NAME)
    }

    # Sobe o web principal primeiro para reduzir indisponibilidade do painel.
    # Workers do IACommand/WhatsApp podem demorar por inicializacao propria,
    # mas nao devem segurar o retorno da interface web.
    $toStart = @($toStart | Sort-Object {
        if ($_ -eq $SERVICE_NAME) { 0 } else { 1 }
    }, { $_ })

    foreach ($serviceName in $toStart) {
        $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if (!$svc) { continue }
        if ($svc.Status -eq "Running") {
            Write-Host "      ${serviceName}: RODANDO" -ForegroundColor Green
            continue
        }

        if ($svc.Status -eq "StartPending") {
            Write-Host "      ${serviceName}: aguardando inicializacao ja em andamento..." -ForegroundColor Gray
        } else {
            Invoke-Nssm -Arguments @("start", $serviceName)
        }

        if (Wait-ServiceState -Name $serviceName -DesiredStatus "Running" -TimeoutSeconds $SERVICE_START_TIMEOUT_SECONDS) {
            Write-Host "      ${serviceName}: RODANDO" -ForegroundColor Green
        } else {
            $current = Get-ServiceStatusText -Name $serviceName
            Write-Host "      AVISO: $serviceName nao ficou Running em $SERVICE_START_TIMEOUT_SECONDS segundos. Status atual: $current" -ForegroundColor Yellow
            Write-Host "             Verifique logs em $PROJECT_PATH\logs\" -ForegroundColor Yellow
        }
    }
}

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
    $unsafeEntries = @()
    foreach ($entry in $zipCheck.Entries) {
        $motivo = Test-ZipEntryUnsafe -Name $entry.FullName
        if ($motivo) {
            $unsafeEntries += [pscustomobject]@{
                FullName = $entry.FullName
                Motivo   = $motivo
            }
        }
    }
} finally {
    $zipCheck.Dispose()
}

if ($unsafeEntries.Count -gt 0) {
    Write-Host "ERRO: O ZIP contem caminhos inseguros ou protegidos. Atualizacao cancelada." -ForegroundColor Red
    $unsafeEntries | Select-Object -First 30 | ForEach-Object {
        Write-Host "  - $($_.FullName) [$($_.Motivo)]" -ForegroundColor Yellow
    }
    Write-Host "Gere novamente o pacote com deploy\0-gerar-pacote.ps1." -ForegroundColor Yellow
    exit 1
}

$envPath = Join-Path $PROJECT_PATH ".env"
$dbPath  = Join-Path $PROJECT_PATH "apps\IA Command\data\ia-command.db"
$hadEnv  = Test-Path -LiteralPath $envPath
$hadDb   = Test-Path -LiteralPath $dbPath

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Atualizacao de Fontes" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "ZIP:     $Zip"
Write-Host "Destino: $PROJECT_PATH"
Write-Host "Seguro:  sem DROP/DELETE/TRUNCATE; nao sobrescreve .env, banco, uploads ou sessoes"
Write-Host ""

# ── 1. Parar o servico ────────────────────────────────────────
Stop-IaHubServices

# ── 2. Extrair ZIP sobrescrevendo os fontes ───────────────────
Write-Host "[2/5] Gerando backup dos fontes atuais..." -ForegroundColor Yellow

if (Test-Path $PROJECT_PATH) {
    if (!(Test-Path $BACKUP_ROOT)) {
        New-Item -ItemType Directory -Path $BACKUP_ROOT | Out-Null
    }

    $backupZip = Join-Path $BACKUP_ROOT ("iahub-before-update-{0}.zip" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    $backupExcludes = @("node_modules", "logs", "data", "uploads", "sessions", ".wwebjs_auth", ".wwebjs_cache", "backups")
    $backupFiles = Get-ChildItem -Path $PROJECT_PATH -Recurse -File | Where-Object {
        $relative = $_.FullName.Substring($PROJECT_PATH.Length + 1)
        $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $skip = $false
        foreach ($dir in $backupExcludes) {
            if ($parts -contains $dir) { $skip = $true; break }
        }
        if (!$skip -and ($_.Name -in @(".env", "data.json") -or $_.Name -like "*.db" -or $_.Name -like "*.sqlite" -or $_.Name -like "*.sqlite3" -or $_.Name -like "*.sqlite-wal" -or $_.Name -like "*.sqlite-shm" -or $_.Name -like "*.log" -or $_.Name -like "*.err")) {
            $skip = $true
        }
        !$skip
    }

    $zipBackup = [System.IO.Compression.ZipFile]::Open($backupZip, 'Create')
    foreach ($file in $backupFiles) {
        $fs = $null
        $entryStream = $null
        try {
            $relative = $file.FullName.Substring($PROJECT_PATH.Length + 1)
            $entry = $zipBackup.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
            $entryStream = $entry.Open()
            $fs = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $fs.CopyTo($entryStream)
        } catch {
            Write-Host "      AVISO: backup ignorou arquivo em uso: $($file.FullName)" -ForegroundColor Yellow
        } finally {
            try { if ($fs) { $fs.Dispose() } } catch {}
            try { if ($entryStream) { $entryStream.Dispose() } } catch {}
        }
    }
    $zipBackup.Dispose()
    Write-Host "      Backup: $backupZip" -ForegroundColor Green
} else {
    Write-Host "      Pasta atual nao existe; backup ignorado." -ForegroundColor Gray
}

Write-Host "[3/5] Extraindo novos fontes..." -ForegroundColor Yellow

Expand-Archive -Path $Zip -DestinationPath $PARENT_PATH -Force

Write-Host "      Fontes atualizados!" -ForegroundColor Green

if ($hadEnv -and !(Test-Path -LiteralPath $envPath)) {
    throw "ERRO CRITICO: .env existia antes da atualizacao e nao foi encontrado depois. Verifique o backup antes de iniciar."
}

if ($hadDb -and !(Test-Path -LiteralPath $dbPath)) {
    throw "ERRO CRITICO: banco SQLite existia antes da atualizacao e nao foi encontrado depois. Verifique o backup antes de iniciar."
}

# ── 3. Atualizar dependencias npm ────────────────────────────
Write-Host "[4/5] Atualizando dependencias npm..." -ForegroundColor Yellow
Push-Location $PROJECT_PATH
npm install --omit=dev
Pop-Location
Write-Host "      Dependencias ok!" -ForegroundColor Green

# ── 4. Reiniciar o servico ────────────────────────────────────
Start-IaHubServices

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Atualizacao concluida!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Ver logs ao vivo:" -ForegroundColor Yellow
Write-Host "  Get-Content $PROJECT_PATH\logs\output.log -Wait -Tail 50" -ForegroundColor White
Write-Host ""

# ============================================================
# IAHub - Gerar Pacote de Deploy
# Execute no seu computador local (nao precisa de Administrador)
# Gera um .zip pronto para enviar ao servidor Windows Server 2019
# ============================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_DIR

$TIMESTAMP    = Get-Date -Format "yyyyMMdd_HHmm"
$PACKAGE_NAME = "iahub-deploy-$TIMESTAMP.zip"
$OUTPUT_PATH  = Join-Path $env:USERPROFILE "Desktop\$PACKAGE_NAME"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - Gerar Pacote de Deploy" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Projeto: $PROJECT_ROOT"
Write-Host "Saida:   $OUTPUT_PATH"
Write-Host "Seguro:  nao inclui banco, .env, uploads, sessoes ou dados locais"
Write-Host ""

# Pastas/arquivos excluidos do pacote (dados locais, secrets e artefatos de trabalho)
$EXCLUDE_DIRS  = @(
    "node_modules",
    ".git",
    ".wwebjs_auth",
    ".wwebjs_cache",
    "logs",
    ".claude",
    ".agents",
    ".vscode",
    "tmp",
    "tests",
    "_prod_compare",
    "backups",
    "data",
    "uploads",
    "sessions"
)
$EXCLUDE_FILES = @(".env", "*.log", "*.err", "data.json", "*.db", "*.sqlite", "*.sqlite3")

function Test-DeployFile {
    param(
        [Parameter(Mandatory=$true)]
        [System.IO.FileInfo]$File
    )

    $relative = $File.FullName.Substring($PROJECT_ROOT.Length + 1)
    $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)

    $skip = $false

    foreach ($dir in $EXCLUDE_DIRS) {
        if ($parts -contains $dir) { $skip = $true; break }
    }

    if (!$skip) {
        foreach ($pattern in $EXCLUDE_FILES) {
            if ($File.Name -like $pattern) { $skip = $true; break }
        }
    }

    !$skip
}

Write-Host "Coletando arquivos versionados..." -ForegroundColor Yellow

$gitDir = Join-Path $PROJECT_ROOT ".git"
$git = Get-Command git -ErrorAction SilentlyContinue

if ($git -and (Test-Path $gitDir)) {
    $trackedPaths = & git -C $PROJECT_ROOT ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel listar arquivos do projeto com git ls-files."
    }

    $files = $trackedPaths | ForEach-Object {
        $path = Join-Path $PROJECT_ROOT $_
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Get-Item -LiteralPath $path
        }
    } | Where-Object { Test-DeployFile $_ }
} else {
    Write-Host "  Git nao encontrado; usando varredura por pastas." -ForegroundColor Yellow
    $files = Get-ChildItem -Path $PROJECT_ROOT -Recurse -File | Where-Object { Test-DeployFile $_ }
}

Write-Host "  $($files.Count) arquivos coletados." -ForegroundColor Gray

if (!(Test-Path "$PROJECT_ROOT\.env.example")) {
    Write-Host "  AVISO: .env.example nao encontrado no projeto!" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Criando ZIP..." -ForegroundColor Yellow

Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $OUTPUT_PATH) { Remove-Item $OUTPUT_PATH -Force }

$zip     = [System.IO.Compression.ZipFile]::Open($OUTPUT_PATH, 'Create')
$skipped = @()

foreach ($file in $files) {
    $relative  = $file.FullName.Substring($PROJECT_ROOT.Length + 1)
    $entryName = "iahub\$relative"

    try {
        $fs = [System.IO.File]::Open(
            $file.FullName,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite)

        $entry       = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fs.CopyTo($entryStream)
        $entryStream.Dispose()
        $fs.Dispose()
    } catch {
        $skipped += $relative
        Write-Host "  PULADO: $relative" -ForegroundColor Yellow
    }
}

$zip.Dispose()

function Test-ZipEntryUnsafe {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name
    )

    $entryName = $Name.Replace('\', '/')

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

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($OUTPUT_PATH)
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
    Remove-Item $OUTPUT_PATH -Force
    Write-Host "ERRO: pacote cancelado porque continha caminhos protegidos." -ForegroundColor Red
    $unsafeEntries | Select-Object -First 30 | ForEach-Object {
        Write-Host "  - $($_.FullName) [$($_.Motivo)]" -ForegroundColor Yellow
    }
    exit 1
}

if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Arquivos pulados ($($skipped.Count)):" -ForegroundColor Yellow
    $skipped | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
}

$sizeMB = [Math]::Round((Get-Item $OUTPUT_PATH).Length / 1048576, 1)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Pacote criado com sucesso!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Arquivo: $OUTPUT_PATH  ($sizeMB MB)" -ForegroundColor Cyan
Write-Host "Validacao: pacote sem dados, banco, .env, uploads ou sessoes." -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Yellow
Write-Host "  1. Envie o ZIP para a pasta C:\Web\iahub\deploy do servidor"
Write-Host "  2. No servidor, abra PowerShell como Administrador e execute:"
Write-Host "     C:\Web\iahub\deploy\3-atualizar.ps1 -Zip C:\Web\iahub\deploy\$PACKAGE_NAME"
Write-Host ""
Write-Host "  Alternativa: se o ZIP estiver em C:\Web\iahub\deploy, tambem pode executar:"
Write-Host "     C:\Web\iahub\deploy\3-atualizar.ps1"
Write-Host ""
Write-Host "Consulte deploy\INSTRUCOES.md para o guia completo." -ForegroundColor Cyan
Write-Host ""

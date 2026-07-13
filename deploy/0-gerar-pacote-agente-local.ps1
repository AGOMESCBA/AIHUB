# ============================================================
# IA Command - Gerar Pacote de Atualizacao do Agente Local
# Execute no computador local. Gera um ZIP e copia o atualizador
# para a Area de Trabalho.
# ============================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_DIR
$AGENTE_ROOT  = Join-Path $PROJECT_ROOT "apps\IA Command\agente-local"

$TIMESTAMP    = Get-Date -Format "yyyyMMdd_HHmm"
$PACKAGE_NAME = "iac-agente-local-update-$TIMESTAMP.zip"
$OUTPUT_PATH  = Join-Path $env:USERPROFILE "Desktop\$PACKAGE_NAME"
$UPDATER_SRC  = Join-Path $SCRIPT_DIR "3-atualizar-agente-local.ps1"
$UPDATER_OUT  = Join-Path $env:USERPROFILE "Desktop\3-atualizar-agente-local.ps1"

if (!(Test-Path $AGENTE_ROOT)) {
    throw "Pasta do Agente Local nao encontrada: $AGENTE_ROOT"
}

if (!(Test-Path $UPDATER_SRC)) {
    throw "Atualizador do Agente Local nao encontrado: $UPDATER_SRC"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IA Command - Pacote Agente Local" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Origem: $AGENTE_ROOT"
Write-Host "ZIP:    $OUTPUT_PATH"
Write-Host "Script: $UPDATER_OUT"
Write-Host ""

$EXCLUDE_DIRS  = @("venv", "logs", "__pycache__", ".pytest_cache", "dist", "backup_original")
$EXCLUDE_FILES = @(".env", "*.log", "*.err", "audit.db", "*.db", "*.sqlite", "*.sqlite3", "*.pyc")

function Test-AgenteDeployFile {
    param([Parameter(Mandatory=$true)][System.IO.FileInfo]$File)

    $relative = $File.FullName.Substring($AGENTE_ROOT.Length + 1)
    $parts = $relative.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)

    foreach ($dir in $EXCLUDE_DIRS) {
        if ($parts -contains $dir) { return $false }
    }

    foreach ($pattern in $EXCLUDE_FILES) {
        if ($File.Name -like $pattern) { return $false }
    }

    return $true
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $OUTPUT_PATH) { Remove-Item $OUTPUT_PATH -Force }

$files = Get-ChildItem -Path $AGENTE_ROOT -Recurse -File | Where-Object { Test-AgenteDeployFile $_ }

Write-Host "Arquivos coletados: $($files.Count)" -ForegroundColor Gray
Write-Host "Criando ZIP..." -ForegroundColor Yellow

$zip = [System.IO.Compression.ZipFile]::Open($OUTPUT_PATH, 'Create')
try {
    foreach ($file in $files) {
        $relative  = $file.FullName.Substring($AGENTE_ROOT.Length + 1)
        $entryName = "agente-local\$relative"
        $entry     = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream    = $entry.Open()
        $fs        = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $fs.CopyTo($stream)
        $fs.Dispose()
        $stream.Dispose()
    }
} finally {
    $zip.Dispose()
}

Copy-Item -LiteralPath $UPDATER_SRC -Destination $UPDATER_OUT -Force

$sizeMB = [Math]::Round((Get-Item $OUTPUT_PATH).Length / 1048576, 2)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Pacote do Agente Local criado!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "ZIP:    $OUTPUT_PATH ($sizeMB MB)" -ForegroundColor Cyan
Write-Host "Script: $UPDATER_OUT" -ForegroundColor Cyan
Write-Host ""
Write-Host "No servidor do Agente Local, copie os dois arquivos e execute como Administrador:" -ForegroundColor Yellow
Write-Host "  .\3-atualizar-agente-local.ps1 -Zip .\$PACKAGE_NAME" -ForegroundColor White
Write-Host ""

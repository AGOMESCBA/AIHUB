# ============================================================
# IAHub — Gerar Pacote de Deploy
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
Write-Host ""

# Pastas/arquivos excluidos do pacote (dados locais e secrets)
$EXCLUDE_DIRS = @("node_modules", ".git", ".wwebjs_auth", ".wwebjs_cache", "logs", ".claude")
$EXCLUDE_FILES = @(".env", "*.log", "data.json")

Write-Host "Coletando arquivos..." -ForegroundColor Yellow

$files = Get-ChildItem -Path $PROJECT_ROOT -Recurse -File | Where-Object {
    $relative = $_.FullName.Substring($PROJECT_ROOT.Length + 1)
    $parts = $relative.Split([IO.Path]::DirectorySeparatorChar)

    $skip = $false

    # Excluir por pasta
    foreach ($dir in $EXCLUDE_DIRS) {
        if ($parts -contains $dir) { $skip = $true; break }
    }

    # Excluir por nome/extensao de arquivo
    if (!$skip) {
        foreach ($pattern in $EXCLUDE_FILES) {
            if ($_.Name -like $pattern) { $skip = $true; break }
        }
    }

    !$skip
}

Write-Host "  $($files.Count) arquivos coletados." -ForegroundColor Gray

# Verificar se .env.example existe
if (!(Test-Path "$PROJECT_ROOT\.env.example")) {
    Write-Host "  AVISO: .env.example nao encontrado no projeto!" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Criando ZIP..." -ForegroundColor Yellow

Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $OUTPUT_PATH) { Remove-Item $OUTPUT_PATH -Force }

$zip = [System.IO.Compression.ZipFile]::Open($OUTPUT_PATH, 'Create')

foreach ($file in $files) {
    $relative = $file.FullName.Substring($PROJECT_ROOT.Length + 1)
    $entryName = "iahub\$relative"
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $file.FullName, $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
}

$zip.Dispose()

$sizeMB = [Math]::Round((Get-Item $OUTPUT_PATH).Length / 1MB, 1)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Pacote criado com sucesso!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Arquivo: $OUTPUT_PATH ($sizeMB MB)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Yellow
Write-Host "  1. Envie o ZIP para o servidor (RDP > copiar/colar, FTP, etc.)"
Write-Host "  2. No servidor, extraia o ZIP para C:\"
Write-Host "     (resultado: a pasta C:\iahub\ sera criada)"
Write-Host "  3. Copie .env.example para .env e preencha as chaves de API:"
Write-Host "     C:\iahub\.env"
Write-Host "  4. Abra PowerShell como Administrador no servidor e execute:"
Write-Host "     C:\iahub\deploy\1-instalar-dependencias.ps1"
Write-Host "  5. Depois execute:"
Write-Host "     C:\iahub\deploy\2-configurar-servico.ps1"
Write-Host ""
Write-Host "Consulte deploy\INSTRUCOES.md para o guia completo passo a passo." -ForegroundColor Cyan
Write-Host ""

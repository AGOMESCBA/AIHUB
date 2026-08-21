$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$PackageName = "iac-protheus-chat-multiempresa-$Timestamp"
$StageDir = Join-Path $PSScriptRoot $PackageName
$ZipPath = "$StageDir.zip"

$Files = @(
  "apps\IA Command\modules\database\index.js",
  "apps\IA Command\modules\database\migrations.js",
  "apps\IA Command\modules\protheus_whatsapp\token-service.js",
  "apps\IA Command\modules\protheus_whatsapp\routes.js",
  "apps\IA Command\modules\protheus_whatsapp\service.js",
  "apps\IA Command\modules\protheus_whatsapp\public\protheus-chat.html"
)

if (Test-Path -LiteralPath $StageDir) {
  Remove-Item -LiteralPath $StageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

foreach ($Relative in $Files) {
  $Source = Join-Path $ProjectRoot $Relative
  if (!(Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Arquivo nao encontrado: $Relative"
  }

  $Destination = Join-Path $StageDir $Relative
  $DestinationDir = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

$Readme = @"
Pacote parcial - IA Command Protheus Chat Multiempresa

Este pacote NAO inclui o fonte ADVPL IACCHAT.prw.

Instalacao:
1. Extraia este ZIP na raiz do projeto IAHub/IA Command do servidor, preservando os diretorios.
2. Os arquivos devem cair em apps/IA Command/modules/...
3. Reinicie o servico Node do IA Command para carregar as rotas, service e migracao.

Arquivos incluidos:
$($Files -join "`r`n")

Observacao:
A migracao adiciona a coluna protheus_chat_tokens.empresas_permitidas_json quando o sistema inicializar.
"@

Set-Content -LiteralPath (Join-Path $StageDir "LEIA-ME-INSTALACAO.txt") -Value $Readme -Encoding UTF8

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Compress-Archive -LiteralPath (Join-Path $StageDir "*") -DestinationPath $ZipPath -Force

Write-Host "Pacote criado:"
Write-Host $ZipPath

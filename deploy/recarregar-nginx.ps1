# Recarrega o Nginx depois que o win-acme renova o certificado (chamado
# automaticamente pela tarefa agendada do win-acme — ver deploy/HTTPS.md).
# Valida a configuração antes: se o nginx.conf estiver com erro, NÃO recarrega
# (o Nginx continua no ar com o certificado anterior).

$ErrorActionPreference = "Stop"
$nginx = (Get-Command nginx -ErrorAction SilentlyContinue).Source
if (-not $nginx) {
    foreach ($c in @("C:\tools\nginx\nginx.exe", "C:\ProgramData\chocolatey\lib\nginx\tools\nginx\nginx.exe", "C:\nginx\nginx.exe")) {
        if (Test-Path $c) { $nginx = $c; break }
    }
}
if (-not $nginx) { throw "nginx.exe nao encontrado." }

$pasta = Split-Path -Parent $nginx
Push-Location $pasta
try {
    & $nginx -t
    if ($LASTEXITCODE -ne 0) { throw "nginx.conf com erro - recarga cancelada." }
    & $nginx -s reload
    if ($LASTEXITCODE -ne 0 -and (Get-Service nginx -ErrorAction SilentlyContinue)) {
        # Nginx rodando como serviço do Windows: reiniciar o serviço é o caminho seguro.
        Restart-Service nginx
    }
    Write-Host "Nginx recarregado com o certificado novo." -ForegroundColor Green
} finally {
    Pop-Location
}

# Liga o HTTPS do IAHub com certificado gratuito do Let's Encrypt (win-acme),
# renovação automática e volta ao estado anterior se qualquer etapa falhar.
# Guia completo e pré-requisitos: deploy/HTTPS.md
#
# Uso (PowerShell como Administrador, no servidor):
#   C:\Web\iahub\deploy\5-configurar-https.ps1 -Endereco iahub.j2aconsultoria.com.br -Email voce@j2aconsultoria.com.br
#
# Parâmetros opcionais:
#   -ManterPorta3000   não fecha a porta 3000 (Node direto) no Firewall do Windows
#   -IgnorarDns        pula a conferência "o endereço aponta para este servidor"

param(
    [Parameter(Mandatory = $true)][string]$Endereco,
    [Parameter(Mandatory = $true)][string]$Email,
    [switch]$ManterPorta3000,
    [switch]$IgnorarDns
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$ACME_DIR   = "C:\nginx-acme"
$CERT_DIR   = "C:\certificados"
$WACS_DIR   = "C:\win-acme"
$UTF8       = New-Object System.Text.UTF8Encoding $false   # nginx.conf sem BOM

function Passo($n, $texto) { Write-Host ""; Write-Host "[$n] $texto" -ForegroundColor Cyan }
function Ok($texto)        { Write-Host "    OK  $texto" -ForegroundColor Green }
function Falha($texto)     { throw $texto }

# ── 0. Pré-condições ────────────────────────────────────────────────────
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falha "Abra o PowerShell como Administrador." }
$Endereco = $Endereco.Trim().ToLower()
if ($Endereco -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') { Falha "Endereço inválido: $Endereco" }

$nginx = (Get-Command nginx -ErrorAction SilentlyContinue).Source
if (-not $nginx) {
    foreach ($c in @("C:\tools\nginx\nginx.exe", "C:\ProgramData\chocolatey\lib\nginx\tools\nginx\nginx.exe", "C:\nginx\nginx.exe")) {
        if (Test-Path $c) { $nginx = $c; break }
    }
}
if (-not $nginx) { Falha "nginx.exe não encontrado." }
$NGINX_DIR  = Split-Path -Parent $nginx
$NGINX_CONF = Join-Path $NGINX_DIR "conf\nginx.conf"
$BACKUP     = "$NGINX_CONF.antes-https-$(Get-Date -Format yyyyMMdd_HHmmss)"
foreach ($f in @("nginx.conf", "nginx-https.conf", "recarregar-nginx.ps1")) {
    if (-not (Test-Path (Join-Path $SCRIPT_DIR $f))) { Falha "Arquivo $f não encontrado em $SCRIPT_DIR." }
}

function Recarregar {
    & (Join-Path $SCRIPT_DIR "recarregar-nginx.ps1")
}
function Restaurar {
    Write-Host ""
    Write-Host "Voltando o Nginx para a configuração anterior..." -ForegroundColor Yellow
    if (Test-Path $BACKUP) {
        Copy-Item $BACKUP $NGINX_CONF -Force
        try { Recarregar } catch { Write-Host "    Atenção: recarregue o Nginx manualmente (Restart-Service nginx)." -ForegroundColor Yellow }
        Write-Host "    Configuração anterior restaurada. O sistema segue no ar em HTTP." -ForegroundColor Yellow
    }
}
function GravarConf($texto) {
    [IO.File]::WriteAllText($NGINX_CONF, $texto, $UTF8)
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IAHub - configurar HTTPS para $Endereco" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

try {
    # ── 1. O endereço aponta para este servidor? ─────────────────────────
    Passo 1 "Conferindo o DNS de $Endereco"
    $ipPublico = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 15).ToString().Trim()
    if ($IgnorarDns) {
        Write-Host "    (conferência de DNS pulada a pedido)" -ForegroundColor Yellow
    } else {
        $ips = @(Resolve-DnsName $Endereco -Type A -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress })
        if (-not $ips.Count) { Falha "$Endereco ainda não existe no DNS. Crie o registro A no painel da Locaweb apontando para $ipPublico (ver HTTPS.md) e aguarde a propagação." }
        if ($ips -notcontains $ipPublico) { Falha "$Endereco aponta para $($ips -join ', '), mas o IP deste servidor é $ipPublico. Corrija o registro A na Locaweb." }
        Ok "$Endereco -> $ipPublico"
    }

    # ── 2. Firewall do Windows: porta 443 ────────────────────────────────
    Passo 2 "Liberando a porta 443 no Firewall do Windows"
    if (-not (Get-NetFirewallRule -DisplayName "IAHub HTTPS 443" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "IAHub HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow | Out-Null
    }
    Ok "porta 443 liberada (lembre-se da regra no painel da ADDIT)"

    # ── 3. Pastas e win-acme ─────────────────────────────────────────────
    Passo 3 "Preparando pastas e o win-acme"
    New-Item -ItemType Directory -Force $ACME_DIR, $CERT_DIR, $WACS_DIR | Out-Null
    $wacs = Join-Path $WACS_DIR "wacs.exe"
    if (-not (Test-Path $wacs)) {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/win-acme/win-acme/releases/latest" -Headers @{ "User-Agent" = "iahub-deploy" } -TimeoutSec 30
        $asset = $release.assets | Where-Object { $_.name -match 'x64\.pluggable\.zip$' } | Select-Object -First 1
        if (-not $asset) { Falha "Não encontrei o pacote x64 pluggable do win-acme. Baixe manualmente em https://www.win-acme.com e extraia em $WACS_DIR." }
        $zip = Join-Path $env:TEMP $asset.name
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $WACS_DIR -Force
        Remove-Item $zip -Force
    }
    if (-not (Test-Path $wacs)) { Falha "wacs.exe não encontrado em $WACS_DIR." }
    Ok "win-acme pronto em $WACS_DIR"

    # ── 4. Nginx em modo de validação (continua atendendo em HTTP) ───────
    Passo 4 "Preparando o Nginx para a validação do Let's Encrypt"
    Copy-Item $NGINX_CONF $BACKUP -Force
    Ok "backup: $BACKUP"
    $blocoAcme = @'
        location ^~ /.well-known/acme-challenge/ {
            root C:/nginx-acme;
            default_type text/plain;
        }

        location / {
'@
    $confHttp = [IO.File]::ReadAllText((Join-Path $SCRIPT_DIR "nginx.conf"))
    $pos = $confHttp.IndexOf("        location / {")
    if ($pos -lt 0) { Falha "Modelo nginx.conf inesperado (sem 'location / {')." }
    $confValidacao = $confHttp.Substring(0, $pos) + $blocoAcme + $confHttp.Substring($pos + "        location / {".Length)
    GravarConf $confValidacao
    Recarregar

    $teste = [guid]::NewGuid().ToString("N")
    $pastaDesafio = Join-Path $ACME_DIR ".well-known\acme-challenge"
    New-Item -ItemType Directory -Force $pastaDesafio | Out-Null
    Set-Content -Path (Join-Path $pastaDesafio $teste) -Value $teste -NoNewline
    try {
        $resp = Invoke-WebRequest -Uri "http://$Endereco/.well-known/acme-challenge/$teste" -UseBasicParsing -TimeoutSec 20
        if ($resp.Content.Trim() -ne $teste) { Falha "resposta inesperada" }
    } catch {
        Falha "O Let's Encrypt não conseguiria validar: http://$Endereco/.well-known/... não respondeu. Verifique a porta 80 no painel da ADDIT."
    } finally {
        Remove-Item (Join-Path $pastaDesafio $teste) -Force -ErrorAction SilentlyContinue
    }
    Ok "validação pela porta 80 funcionando"

    # ── 5. Emitir o certificado ──────────────────────────────────────────
    Passo 5 "Emitindo o certificado (Let's Encrypt)"
    & $wacs --source manual --host $Endereco `
        --validation filesystem --webroot $ACME_DIR `
        --store pemfiles --pemfilespath $CERT_DIR `
        --installation script --script (Join-Path $SCRIPT_DIR "recarregar-nginx.ps1") `
        --accepttos --emailaddress $Email --closeonfinish
    if ($LASTEXITCODE -ne 0) { Falha "O win-acme não conseguiu emitir o certificado (código $LASTEXITCODE). Veja a mensagem acima." }
    $chain = Get-ChildItem $CERT_DIR -Filter "*-chain.pem" | Where-Object { $_.Name -like "$Endereco*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $key   = Get-ChildItem $CERT_DIR -Filter "*-key.pem"   | Where-Object { $_.Name -like "$Endereco*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $chain -or -not $key) { Falha "Certificado emitido, mas os arquivos -chain.pem / -key.pem não apareceram em $CERT_DIR." }
    Ok "certificado: $($chain.Name)"

    # ── 6. Ligar o HTTPS ─────────────────────────────────────────────────
    Passo 6 "Ligando o HTTPS no Nginx"
    $confHttps = [IO.File]::ReadAllText((Join-Path $SCRIPT_DIR "nginx-https.conf"))
    $confHttps = $confHttps.Replace("C:/certificados/SEU_ENDERECO-chain.pem", ($chain.FullName -replace '\\', '/'))
    $confHttps = $confHttps.Replace("C:/certificados/SEU_ENDERECO-key.pem",   ($key.FullName   -replace '\\', '/'))
    $confHttps = $confHttps.Replace("SEU_ENDERECO", $Endereco)
    GravarConf $confHttps
    Recarregar
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "https://$Endereco/" -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0 -ErrorAction SilentlyContinue
    } catch {
        $r = $_.Exception.Response
    }
    if (-not $r) { Falha "https://$Endereco não respondeu depois de ligar o HTTPS. Verifique a porta 443 no painel da ADDIT." }
    Ok "https://$Endereco respondendo"

    # ── 7. Fechar a porta 3000 (Node direto, por fora do HTTPS) ──────────
    Passo 7 "Porta 3000"
    if ($ManterPorta3000) {
        Write-Host "    mantida aberta a pedido (-ManterPorta3000)" -ForegroundColor Yellow
    } else {
        $regras = Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | Where-Object {
            $_.Enabled -eq 'True' -and (($_ | Get-NetFirewallPortFilter).LocalPort -contains '3000')
        }
        $regras | Disable-NetFirewallRule
        Ok "$(@($regras).Count) regra(s) da porta 3000 desativada(s) no Firewall do Windows (remova também no painel da ADDIT, se houver)"
    }

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  HTTPS ativo: https://$Endereco" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  J2A:        https://$Endereco/iaservice/j2a"
    Write-Host "  Renovacao:  automatica (tarefa agendada do win-acme)"
    Write-Host "  Backup:     $BACKUP"
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Restaurar
    exit 1
}

# ============================================================
# IAHub - Instalar o servico de jobs (IAHub-Jobs)
# Execute como Administrador UMA vez por servidor (rodar de novo reinstala).
# Os agendadores (hoje: Jaade no Primeiro Atendimento) passam a rodar fora do
# site so depois de escolher "Servico IAHub-Jobs" na tela Jobs (IA Gestao > Jobs >
# Configuracao). Ate la o servico fica no ar so atendendo o Executar agora da tela.
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PROJECT_PATH      = "C:\Web\iahub"
$JOBS_SERVICE_NAME = "IAHub-Jobs"

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host "ERRO: Execute este script como Administrador!" -ForegroundColor Red
    exit 1
}

if (!(Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "ERRO: NSSM nao encontrado. Rode antes o 1-instalar-dependencias.ps1." -ForegroundColor Red
    exit 1
}

if (!(Test-Path (Join-Path $PROJECT_PATH "jobs-servico.js"))) {
    Write-Host "ERRO: $PROJECT_PATH\jobs-servico.js nao existe. Atualize os fontes (3-atualizar.ps1) antes." -ForegroundColor Red
    exit 1
}

$NODE_EXE = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path (Join-Path $PROJECT_PATH "logs") | Out-Null

$existente = Get-Service -Name $JOBS_SERVICE_NAME -ErrorAction SilentlyContinue
if ($existente) {
    Write-Host "Servico $JOBS_SERVICE_NAME existente: removendo para reconfigurar..." -ForegroundColor Gray
    if ($existente.Status -ne "Stopped") { nssm stop $JOBS_SERVICE_NAME | Out-Null }
    nssm remove $JOBS_SERVICE_NAME confirm | Out-Null
    Start-Sleep -Seconds 2
}

nssm install $JOBS_SERVICE_NAME $NODE_EXE
nssm set $JOBS_SERVICE_NAME AppParameters    "jobs-servico.js"
nssm set $JOBS_SERVICE_NAME AppDirectory     $PROJECT_PATH
nssm set $JOBS_SERVICE_NAME AppStdout        "$PROJECT_PATH\logs\jobs-output.log"
nssm set $JOBS_SERVICE_NAME AppStderr        "$PROJECT_PATH\logs\jobs-error.log"
nssm set $JOBS_SERVICE_NAME AppRotateFiles   1
nssm set $JOBS_SERVICE_NAME AppRotateOnline  1
nssm set $JOBS_SERVICE_NAME AppRotateBytes   10485760
nssm set $JOBS_SERVICE_NAME Start            SERVICE_AUTO_START
nssm set $JOBS_SERVICE_NAME DisplayName      "IAHub - Jobs"
nssm set $JOBS_SERVICE_NAME Description      "Agendadores do IAHub (Jaade no Primeiro Atendimento e futuros jobs), fora do site"
# Caiu: sobe de novo em 5 s; se cair logo ao subir, o NSSM espaca as tentativas.
nssm set $JOBS_SERVICE_NAME AppExit          Default Restart
nssm set $JOBS_SERVICE_NAME AppRestartDelay  5000
nssm set $JOBS_SERVICE_NAME AppThrottle      10000
# Parada: Ctrl+C e ate 60 s para o desligamento controlado (o supervisor espera
# as execucoes por 45 s e encerra o resto); depois fecha a arvore de processos.
nssm set $JOBS_SERVICE_NAME AppStopMethodConsole 60000
nssm set $JOBS_SERVICE_NAME AppStopMethodWindow  5000
nssm set $JOBS_SERVICE_NAME AppStopMethodThreads 5000
nssm set $JOBS_SERVICE_NAME AppKillProcessTree   1
nssm set $JOBS_SERVICE_NAME AppEnvironmentExtra NODE_OPTIONS=--use-system-ca

nssm start $JOBS_SERVICE_NAME
Start-Sleep -Seconds 3
$status = (Get-Service -Name $JOBS_SERVICE_NAME).Status
Write-Host ""
Write-Host "Servico $JOBS_SERVICE_NAME instalado. Status: $status" -ForegroundColor Green
Write-Host "Logs: $PROJECT_PATH\logs\jobs-output.log e jobs-error.log" -ForegroundColor Gray
Write-Host ""
Write-Host "Para os jobs rodarem neste servico (sem reiniciar nada):" -ForegroundColor Yellow
Write-Host "  IA Gestao > Jobs > Configuracao > Onde os jobs rodam: Servico IAHub-Jobs > Aplicar" -ForegroundColor Yellow
Write-Host "Se este servico parar, o site reassume os jobs sozinho." -ForegroundColor Yellow

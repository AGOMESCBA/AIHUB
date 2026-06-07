#Requires -Version 5.1
# ─────────────────────────────────────────────────────────────────────────────
#  IA Command — Instalador GUI do Agente Local
#  Execução: síncrona no thread principal + DoEvents para manter UI viva.
#
#  Parâmetros:
#   -SkipCopy        : pula a cópia de arquivos (Inno Setup já copiou)
#   -Destino <path>  : pré-preenche o diretório e inicia automaticamente
# ─────────────────────────────────────────────────────────────────────────────
param(
    [switch]$SkipCopy,
    [string]$Destino = ''
)

# ── Auto-elevação ─────────────────────────────────────────────────────────────
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $extra  = if ($SkipCopy) { ' -SkipCopy' } else { '' }
    $extra += if ($Destino)  { ' -Destino "{0}"' -f $Destino } else { '' }
    Start-Process powershell ('-ExecutionPolicy Bypass -NoProfile -File "{0}"{1}' -f $MyInvocation.MyCommand.Path, $extra) -Verb RunAs
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# ── Constantes ────────────────────────────────────────────────────────────────
$SERVICE_NAME = 'IA Hub - IACommand_AgenteLocal_API'
$PYTHON_URL   = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'
$NSSM_URL     = 'https://nssm.cc/release/nssm-2.24.zip'
$SRC          = $PSScriptRoot

# ── Cores ─────────────────────────────────────────────────────────────────────
$BgBase  = [Drawing.Color]::FromArgb(15,  23,  42)
$BgCard  = [Drawing.Color]::FromArgb(30,  41,  59)
$BgInput = [Drawing.Color]::FromArgb(51,  65,  85)
$ColPrim = [Drawing.Color]::FromArgb(59,  130, 246)
$ColSucc = [Drawing.Color]::FromArgb(34,  197, 94)
$ColWarn = [Drawing.Color]::FromArgb(245, 158, 11)
$ColErr  = [Drawing.Color]::FromArgb(239, 68,  68)
$ColText = [Drawing.Color]::FromArgb(226, 232, 240)
$ColDim  = [Drawing.Color]::FromArgb(148, 163, 184)
$ColBord = [Drawing.Color]::FromArgb(71,  85,  105)

# ── Form ──────────────────────────────────────────────────────────────────────
$form = New-Object Windows.Forms.Form
$form.Text            = 'IA Command — Instalador do Agente Local'
$form.Size            = New-Object Drawing.Size(680, 610)
$form.MinimumSize     = $form.Size
$form.MaximumSize     = $form.Size
$form.StartPosition   = 'CenterScreen'
$form.BackColor       = $BgBase
$form.ForeColor       = $ColText
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox     = $false

# Header
$pnlHead = New-Object Windows.Forms.Panel
$pnlHead.Size = New-Object Drawing.Size(680, 76); $pnlHead.Location = New-Object Drawing.Point(0, 0); $pnlHead.BackColor = $BgCard
$form.Controls.Add($pnlHead)

$lblTitle = New-Object Windows.Forms.Label
$lblTitle.Text = 'IA Command'; $lblTitle.Font = New-Object Drawing.Font('Segoe UI', 14, [Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $ColPrim; $lblTitle.Location = New-Object Drawing.Point(20, 12); $lblTitle.AutoSize = $true
$pnlHead.Controls.Add($lblTitle)

$lblSub = New-Object Windows.Forms.Label
$lblSub.Text = 'Instalador do Agente Local  ·  Serviço Windows'
$lblSub.Font = New-Object Drawing.Font('Segoe UI', 9); $lblSub.ForeColor = $ColDim
$lblSub.Location = New-Object Drawing.Point(22, 42); $lblSub.AutoSize = $true
$pnlHead.Controls.Add($lblSub)

$pnlAccent = New-Object Windows.Forms.Panel
$pnlAccent.Size = New-Object Drawing.Size(680, 3); $pnlAccent.Location = New-Object Drawing.Point(0, 76); $pnlAccent.BackColor = $ColPrim
$form.Controls.Add($pnlAccent)

# Diretório
$lblDirCap = New-Object Windows.Forms.Label
$lblDirCap.Text = 'DIRETÓRIO DE INSTALAÇÃO'; $lblDirCap.Font = New-Object Drawing.Font('Segoe UI', 7.5, [Drawing.FontStyle]::Bold)
$lblDirCap.ForeColor = $ColDim; $lblDirCap.Location = New-Object Drawing.Point(20, 96); $lblDirCap.AutoSize = $true
$form.Controls.Add($lblDirCap)

$txtDir = New-Object Windows.Forms.TextBox
$txtDir.Size = New-Object Drawing.Size(528, 28); $txtDir.Location = New-Object Drawing.Point(20, 116)
$txtDir.BackColor = $BgInput; $txtDir.ForeColor = $ColText
$txtDir.Font = New-Object Drawing.Font('Segoe UI', 10); $txtDir.BorderStyle = 'FixedSingle'
$txtDir.Text = 'C:\IACommand\agente-local'
$form.Controls.Add($txtDir)

$btnBrowse = New-Object Windows.Forms.Button
$btnBrowse.Size = New-Object Drawing.Size(108, 28); $btnBrowse.Location = New-Object Drawing.Point(548, 116)
$btnBrowse.Text = 'Procurar...'; $btnBrowse.FlatStyle = 'Flat'
$btnBrowse.BackColor = $BgCard; $btnBrowse.ForeColor = $ColText
$btnBrowse.Font = New-Object Drawing.Font('Segoe UI', 9); $btnBrowse.Cursor = 'Hand'
$btnBrowse.FlatAppearance.BorderColor = $ColBord
$form.Controls.Add($btnBrowse)
$btnBrowse.Add_Click({
    $dlg = New-Object Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Escolha o diretório de instalação do Agente Local'
    $dlg.ShowNewFolderButton = $true
    if (Test-Path $txtDir.Text -ErrorAction SilentlyContinue) { $dlg.SelectedPath = $txtDir.Text }
    if ($dlg.ShowDialog($form) -eq 'OK') { $txtDir.Text = $dlg.SelectedPath }
})

$lblDirNote = New-Object Windows.Forms.Label
$lblDirNote.Text = 'Os arquivos do Agente Local serão copiados para este diretório e o serviço Windows será registrado.'
$lblDirNote.Font = New-Object Drawing.Font('Segoe UI', 8, [Drawing.FontStyle]::Italic)
$lblDirNote.ForeColor = $ColDim; $lblDirNote.Location = New-Object Drawing.Point(20, 150); $lblDirNote.AutoSize = $true
$form.Controls.Add($lblDirNote)

# Progresso
$lblStep = New-Object Windows.Forms.Label
$lblStep.Text = 'Clique em Instalar para começar.'; $lblStep.Font = New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)
$lblStep.ForeColor = $ColText; $lblStep.Location = New-Object Drawing.Point(20, 178); $lblStep.Size = New-Object Drawing.Size(636, 20)
$form.Controls.Add($lblStep)

$pnlBarBg = New-Object Windows.Forms.Panel
$pnlBarBg.Size = New-Object Drawing.Size(636, 22); $pnlBarBg.Location = New-Object Drawing.Point(20, 202); $pnlBarBg.BackColor = $BgInput
$form.Controls.Add($pnlBarBg)

$pnlBar = New-Object Windows.Forms.Panel
$pnlBar.Size = New-Object Drawing.Size(0, 22); $pnlBar.Location = New-Object Drawing.Point(0, 0); $pnlBar.BackColor = $ColPrim
$pnlBarBg.Controls.Add($pnlBar)

$lblPct = New-Object Windows.Forms.Label
$lblPct.Text = '0%'; $lblPct.Font = New-Object Drawing.Font('Segoe UI', 8, [Drawing.FontStyle]::Bold)
$lblPct.ForeColor = $ColDim; $lblPct.Location = New-Object Drawing.Point(660, 204); $lblPct.AutoSize = $true
$form.Controls.Add($lblPct)

# Log
$lblLogCap = New-Object Windows.Forms.Label
$lblLogCap.Text = 'LOG DE INSTALAÇÃO'; $lblLogCap.Font = New-Object Drawing.Font('Segoe UI', 7.5, [Drawing.FontStyle]::Bold)
$lblLogCap.ForeColor = $ColDim; $lblLogCap.Location = New-Object Drawing.Point(20, 236); $lblLogCap.AutoSize = $true
$form.Controls.Add($lblLogCap)

$txtLog = New-Object Windows.Forms.RichTextBox
$txtLog.Size = New-Object Drawing.Size(636, 282); $txtLog.Location = New-Object Drawing.Point(20, 256)
$txtLog.BackColor = $BgCard; $txtLog.ForeColor = $ColText
$txtLog.Font = New-Object Drawing.Font('Consolas', 8.5); $txtLog.ReadOnly = $true
$txtLog.BorderStyle = 'None'; $txtLog.ScrollBars = 'Vertical'
$form.Controls.Add($txtLog)

# Botão
$btnInstall = New-Object Windows.Forms.Button
$btnInstall.Size = New-Object Drawing.Size(160, 40); $btnInstall.Location = New-Object Drawing.Point(496, 554)
$btnInstall.Text = 'Instalar'; $btnInstall.FlatStyle = 'Flat'
$btnInstall.BackColor = $ColPrim; $btnInstall.ForeColor = [Drawing.Color]::White
$btnInstall.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold); $btnInstall.Cursor = 'Hand'
$btnInstall.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnInstall)

# ═════════════════════════════════════════════════════════════════════════════
#  FUNÇÕES UI  — diretas no thread principal, sem Invoke
# ═════════════════════════════════════════════════════════════════════════════
function Tick { [System.Windows.Forms.Application]::DoEvents() }

function SetProgress([int]$pct, [string]$msg) {
    $safe = [Math]::Max(0, [Math]::Min(100, $pct))
    $pnlBar.Width     = [int](636 * $safe / 100)
    $lblPct.Text      = "$pct%"
    $lblPct.ForeColor = if ($pct -ge 100) { $ColSucc } elseif ($pct -lt 0) { $ColErr } else { $ColDim }
    $pnlBar.BackColor = if ($pct -ge 100) { $ColSucc } elseif ($pct -lt 0) { $ColErr } else { $ColPrim }
    if ($msg) { $lblStep.Text = $msg }
    Tick
}

function AppendLog([string]$line, [Drawing.Color]$col) {
    $txtLog.SelectionStart  = $txtLog.TextLength
    $txtLog.SelectionLength = 0
    $txtLog.SelectionColor  = $col
    $txtLog.AppendText("$line`r`n")
    $txtLog.ScrollToCaret()
    Tick
}

function LogOK   ([string]$m) { AppendLog "[OK]  $m" $ColSucc }
function LogWarn ([string]$m) { AppendLog "[!!]  $m" $ColWarn }
function LogErr  ([string]$m) { AppendLog "[ERR] $m" $ColErr  }
function LogInfo ([string]$m) { AppendLog "  »   $m" $ColDim  }
function LogStep ([string]$m) { AppendLog $m          $ColText }

# ═════════════════════════════════════════════════════════════════════════════
#  LÓGICA DE INSTALAÇÃO  — síncrona no thread da UI
# ═════════════════════════════════════════════════════════════════════════════
function RunInstall([string]$dest) {
    try {

        # ── 1/8  Copiar arquivos ──────────────────────────────────────────────
        LogStep '━━━ 1/8  Copiando arquivos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 6 '[1/8] Copiando arquivos...'

        $resolvedDest = Resolve-Path $dest -ErrorAction SilentlyContinue
        $sameDir = $resolvedDest -and ($resolvedDest.Path -ieq $SRC)

        if ($SkipCopy -or $sameDir) {
            LogOK 'Cópia ignorada (Inno Setup ou instalação in-place).'
        } else {
            $skipNames = @('venv','logs','audit.db','.env','__pycache__','dist')
            if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
            Get-ChildItem $SRC | Where-Object { $skipNames -notcontains $_.Name } | ForEach-Object {
                Copy-Item $_.FullName (Join-Path $dest $_.Name) -Recurse -Force
                LogInfo $_.Name; Tick
            }
            Get-ChildItem $dest -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            LogOK "Copiado para: $dest"
        }

        # ── 2/8  Python ───────────────────────────────────────────────────────
        LogStep '━━━ 2/8  Python ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 14 '[2/8] Verificando Python...'

        $pyExec = $null
        $cands  = @()
        $pyCmd  = Get-Command python -ErrorAction SilentlyContinue; if ($pyCmd) { $cands += $pyCmd.Source }
        $pyLaunch = Get-Command py -ErrorAction SilentlyContinue;   if ($pyLaunch) { $cands += $pyLaunch.Source }
        $cands += @(
            "${env:LOCALAPPDATA}\Programs\Python\Python311\python.exe"
            "${env:LOCALAPPDATA}\Programs\Python\Python312\python.exe"
            'C:\Python311\python.exe'; 'C:\Python312\python.exe'
            'C:\Program Files\Python311\python.exe'; 'C:\Program Files\Python312\python.exe'
        )
        foreach ($c in ($cands | Where-Object { $_ -and (Test-Path $_ -ErrorAction SilentlyContinue) })) {
            try { $v = & $c --version 2>&1; if ($LASTEXITCODE -eq 0) { $pyExec = $c; LogOK "Python: $v"; break } } catch {}
        }

        if (-not $pyExec) {
            LogWarn 'Python não encontrado. Baixando 3.11.9...'
            SetProgress 18 '[2/8] Baixando Python...'
            $pyInst = "$env:TEMP\python-3.11.9-amd64.exe"
            [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
            $wc = New-Object Net.WebClient
            $wc.DownloadFile($PYTHON_URL, $pyInst)
            SetProgress 26 '[2/8] Instalando Python...'
            $p = Start-Process $pyInst '/quiet InstallAllUsers=1 PrependPath=1 Include_test=0' -Wait -PassThru
            if ($p.ExitCode -ne 0) { throw 'Falha na instalação do Python.' }
            Remove-Item $pyInst -Force -ErrorAction SilentlyContinue
            $env:PATH = "C:\Program Files\Python311;C:\Program Files\Python311\Scripts;$env:PATH"
            $pyExec   = 'python'
            LogOK 'Python 3.11 instalado.'
        }

        # ── 3/8  NSSM ─────────────────────────────────────────────────────────
        LogStep '━━━ 3/8  NSSM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 34 '[3/8] Verificando NSSM...'

        $nssmExec   = $null
        $nssmLocal  = Join-Path $dest 'nssm.exe'
        $nssmGlobal = Get-Command nssm -ErrorAction SilentlyContinue
        if ($nssmGlobal)            { $nssmExec = $nssmGlobal.Source; LogOK "NSSM: $nssmExec" }
        elseif (Test-Path $nssmLocal) { $nssmExec = $nssmLocal;       LogOK 'nssm.exe na pasta.' }
        else {
            LogWarn 'NSSM não encontrado. Baixando...'
            $nssmZip = "$env:TEMP\nssm.zip"; $nssmTmp = "$env:TEMP\nssm_x"
            [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
            (New-Object Net.WebClient).DownloadFile($NSSM_URL, $nssmZip)
            Expand-Archive $nssmZip -DestinationPath $nssmTmp -Force
            Copy-Item "$nssmTmp\nssm-2.24\win64\nssm.exe" $nssmLocal -Force
            Remove-Item $nssmTmp -Recurse -Force -ErrorAction SilentlyContinue
            $nssmExec = $nssmLocal; LogOK 'NSSM baixado.'
        }

        # ── 4/8  venv ─────────────────────────────────────────────────────────
        LogStep '━━━ 4/8  Ambiente virtual ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 44 '[4/8] Criando ambiente virtual...'

        $venvDir = Join-Path $dest 'venv'
        $pip     = Join-Path $venvDir 'Scripts\pip.exe'
        $pyVenv  = Join-Path $venvDir 'Scripts\python.exe'

        if (Test-Path $venvDir) { LogOK 'Ambiente virtual já existe.' }
        else {
            & $pyExec -m venv $venvDir | Out-Null; Tick
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar ambiente virtual.' }
            LogOK 'Ambiente virtual criado.'
        }

        # ── 5/8  pip install ──────────────────────────────────────────────────
        LogStep '━━━ 5/8  Dependências Python ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 54 '[5/8] Instalando dependências... (1-2 min)'
        LogInfo 'FastAPI, Uvicorn, pyodbc, bcrypt — aguarde...'

        $reqFile  = Join-Path $dest 'requirements.txt'
        $pipOut   = "$env:TEMP\iac_pip_out.txt"
        $pipErr   = "$env:TEMP\iac_pip_err.txt"
        $pipProc  = Start-Process -FilePath $pip `
            -ArgumentList "install -r `"$reqFile`" --no-warn-script-location" `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $pipOut -RedirectStandardError $pipErr

        $secs = 0
        while (-not $pipProc.HasExited) {
            Start-Sleep -Milliseconds 400
            $secs++
            if ($secs % 10 -eq 0) { LogInfo "Aguardando pip... ($([int]($secs * 0.4))s)" }
            Tick
        }
        $pipProc.WaitForExit(5000) | Out-Null
        $pipExit = if ($null -ne $pipProc.ExitCode) { [int]$pipProc.ExitCode } else { 0 }
        if ($pipExit -ne 0) {
            $msg = Get-Content $pipErr -Raw -ErrorAction SilentlyContinue
            # Ignora linhas que são apenas [notice] — não são erros reais
            $linhasErro = ($msg -split "`n" | Where-Object { $_ -notmatch '^\[notice\]' }) -join "`n"
            throw "pip falhou (exit $pipExit): $linhasErro"
        }
        Remove-Item $pipOut,$pipErr -Force -ErrorAction SilentlyContinue
        LogOK 'Dependencias instaladas.'

        # ── 6/8  ODBC ─────────────────────────────────────────────────────────
        LogStep '━━━ 6/8  Driver ODBC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 70 '[6/8] Verificando driver ODBC...'
        $odbc = Get-OdbcDriver -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match 'ODBC Driver \d+ for SQL Server' }
        if ($odbc) { LogOK "Driver: $($odbc[0].Name)" }
        else { LogWarn 'Driver ODBC não encontrado. Baixe em: https://aka.ms/odbc17' }

        # ── 7/8  .env ─────────────────────────────────────────────────────────
        LogStep '━━━ 7/8  Arquivo .env ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 78 '[7/8] Configurando .env...'
        $envFile = Join-Path $dest '.env'; $envEx = Join-Path $dest '.env.example'
        if (Test-Path $envFile) { LogOK '.env já existe — mantido.' }
        else {
            if (Test-Path $envEx) { Copy-Item $envEx $envFile -Force }
            LogOK ".env criado. Configure: $envFile"
            LogWarn 'Preencha DB_HOST, DB_NAME, DB_USER, DB_PASS.'
        }

        # ── 8/8  Serviço ──────────────────────────────────────────────────────
        LogStep '━━━ 8/8  Serviço Windows ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        SetProgress 86 '[8/8] Registrando serviço Windows...'

        $logsDir = Join-Path $dest 'logs'
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

        @('IACommand-Agente','IA Hub - IaCommand_API','IA Command - Agente Local','IACommand') | ForEach-Object {
            & $nssmExec status $_ 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                LogInfo "Removendo serviço antigo: $_"
                & $nssmExec stop $_ 2>&1 | Out-Null; Tick
                & $nssmExec remove $_ confirm 2>&1 | Out-Null; Tick
            }
        }
        & $nssmExec status $SERVICE_NAME 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            LogInfo 'Removendo instalação anterior...'
            & $nssmExec stop   $SERVICE_NAME 2>&1 | Out-Null; Tick
            & $nssmExec remove $SERVICE_NAME confirm 2>&1 | Out-Null; Tick
            Start-Sleep -Milliseconds 800; Tick
        }

        $fso       = New-Object -ComObject Scripting.FileSystemObject
        $shortPy   = $fso.GetFile($pyVenv).ShortPath
        $shortMain = $fso.GetFile((Join-Path $dest 'main.py')).ShortPath
        $shortDir  = $fso.GetFolder($dest).ShortPath
        $shortLogs = $fso.GetFolder($logsDir).ShortPath

        LogInfo "Python: $shortPy"; LogInfo "Script: $shortMain"

        & $nssmExec install      $SERVICE_NAME $shortPy;           Tick
        & $nssmExec set $SERVICE_NAME AppParameters  $shortMain;   Tick
        & $nssmExec set $SERVICE_NAME AppDirectory   $shortDir;    Tick
        & $nssmExec set $SERVICE_NAME DisplayName    $SERVICE_NAME; Tick
        & $nssmExec set $SERVICE_NAME Description    'API local do IA Command para execucao de SQL no ERP.'; Tick
        & $nssmExec set $SERVICE_NAME Start          SERVICE_AUTO_START; Tick
        & $nssmExec set $SERVICE_NAME AppStdout      "$shortLogs\servico.log"; Tick
        & $nssmExec set $SERVICE_NAME AppStderr      "$shortLogs\servico-erros.log"; Tick
        & $nssmExec set $SERVICE_NAME AppRotateFiles    1; Tick
        & $nssmExec set $SERVICE_NAME AppRotateOnline   1; Tick
        & $nssmExec set $SERVICE_NAME AppRotateBytes    10485760; Tick

        & $nssmExec start $SERVICE_NAME 2>&1 | Out-Null; Tick
        if ($LASTEXITCODE -eq 0) { LogOK 'Serviço iniciado!' }
        else { LogWarn "Serviço instalado mas não iniciou. Veja: $logsDir\servico-erros.log" }

        # ── Conclusão ─────────────────────────────────────────────────────────
        SetProgress 100 '✓  Instalação concluída!'
        LogStep ''
        LogStep '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        LogOK  'INSTALAÇÃO CONCLUÍDA!'
        LogInfo "Painel admin  →  http://localhost:8765"
        LogInfo "Senha padrão  →  admin  (altere no primeiro acesso)"
        LogStep '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

        $btnInstall.Text      = 'Fechar'
        $btnInstall.BackColor = $ColSucc

    } catch {
        LogErr "Falha: $_"
        SetProgress -1 '✗  Erro na instalação.'
        $btnInstall.Enabled   = $true
        $btnInstall.Text      = 'Tentar novamente'
        $btnInstall.BackColor = $ColWarn
    }
}

# ── Handler do botão ──────────────────────────────────────────────────────────
$btnInstall.Add_Click({
    if ($btnInstall.Text -eq 'Fechar') { $form.Close(); return }

    $dest = $txtDir.Text.Trim()
    if (-not $dest) {
        [Windows.Forms.MessageBox]::Show('Escolha o diretório de instalação.', 'Atenção',
            [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        return
    }

    $btnInstall.Enabled = $false
    $txtDir.Enabled     = $false
    $btnBrowse.Enabled  = $false

    RunInstall $dest
})

# ── Modo Inno Setup: pré-preenche e inicia sozinho ────────────────────────────
if ($Destino) {
    $txtDir.Text       = $Destino
    $txtDir.Enabled    = $false
    $btnBrowse.Enabled = $false
    $lblDirNote.Text   = 'Diretório definido pelo instalador Inno Setup.'
    $form.Add_Shown({ $btnInstall.PerformClick() })
}

[Windows.Forms.Application]::Run($form)

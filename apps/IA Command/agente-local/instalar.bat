@echo off
setlocal EnableDelayedExpansion

set SERVICE_NAME=IA Hub - IACommand_AgenteLocal_API
set BASE_DIR=%~dp0
set VENV=%BASE_DIR%venv
set ENV_FILE=%BASE_DIR%.env
set ENV_EXAMPLE=%BASE_DIR%.env.example
set PYTHON_URL=https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
set PYTHON_INSTALLER=%TEMP%\python-installer.exe
set PYTHON_EXEC=python

echo.
echo  IA Command - Agente Local - Instalador
echo  =======================================
echo.

:: 1. Verificar Administrador
net session >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Execute como Administrador.
    echo Clique com botao direito no instalar.bat e escolha
    echo "Executar como administrador".
    echo.
    pause & exit /b 1
)
echo [OK] Executando como Administrador.

:: 2. Localizar Python (PATH, py launcher ou caminhos comuns)
echo.
echo [1/7] Verificando Python...

python --version >nul 2>&1
if not errorlevel 1 goto :python_ok

py --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_EXEC=py
    goto :python_ok
)

for %%P in (
    "C:\Python311\python.exe"
    "C:\Python312\python.exe"
    "C:\Python310\python.exe"
    "C:\Program Files\Python311\python.exe"
    "C:\Program Files\Python312\python.exe"
) do (
    if exist %%P (
        set PYTHON_EXEC=%%P
        goto :python_ok
    )
)

:: Python nao encontrado - instalar automaticamente
echo [!] Python nao encontrado. Baixando Python 3.11...
echo     Isso pode demorar alguns minutos dependendo da conexao.
echo.

powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%PYTHON_INSTALLER%' -UseBasicParsing }"
if errorlevel 1 (
    echo [ERRO] Falha ao baixar Python. Verifique a conexao com a internet.
    echo Baixe manualmente em: https://www.python.org/downloads/
    echo Marque "Add Python to PATH" durante a instalacao.
    pause & exit /b 1
)

echo     Instalando Python silenciosamente...
"%PYTHON_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
if errorlevel 1 (
    echo [ERRO] Falha na instalacao do Python.
    echo Instale manualmente e rode este script novamente.
    pause & exit /b 1
)

del "%PYTHON_INSTALLER%" >nul 2>&1

:: Recarregar PATH apos instalacao
call refreshenv >nul 2>&1
set "PATH=C:\Program Files\Python311;C:\Program Files\Python311\Scripts;%PATH%"
set "PATH=C:\Python311;C:\Python311\Scripts;%PATH%"

python --version >nul 2>&1
if not errorlevel 1 goto :python_ok

echo [ERRO] Python instalado mas nao reconhecido. Feche este CMD,
echo abra um novo como Administrador e rode o instalar.bat novamente.
pause & exit /b 1

:python_ok
for /f "tokens=*" %%v in ('"%PYTHON_EXEC%" --version 2^>^&1') do echo [OK] %%v

:: 3. Verificar NSSM
echo.
echo [2/7] Verificando NSSM...
where nssm >nul 2>&1
if errorlevel 1 (
    if exist "%BASE_DIR%nssm.exe" (
        set "PATH=%BASE_DIR%;%PATH%"
        echo [OK] nssm.exe encontrado na pasta do agente.
    ) else (
        echo [!] NSSM nao encontrado. Baixando automaticamente...
        powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%TEMP%\nssm.zip' -UseBasicParsing; Expand-Archive '%TEMP%\nssm.zip' -DestinationPath '%TEMP%\nssm' -Force; Copy-Item '%TEMP%\nssm\nssm-2.24\win64\nssm.exe' '%BASE_DIR%nssm.exe' }"
        if exist "%BASE_DIR%nssm.exe" (
            set "PATH=%BASE_DIR%;%PATH%"
            echo [OK] NSSM baixado e pronto.
        ) else (
            echo [ERRO] Nao foi possivel baixar o NSSM.
            echo Baixe manualmente em https://nssm.cc/download
            echo e copie nssm.exe para: %BASE_DIR%
            pause & exit /b 1
        )
    )
) else (
    echo [OK] NSSM disponivel.
)

:: 4. Criar ambiente virtual
echo.
echo [3/7] Criando ambiente virtual Python...
if exist "%VENV%" (
    echo [OK] Ambiente virtual ja existe - reutilizando.
) else (
    "%PYTHON_EXEC%" -m venv "%VENV%"
    if errorlevel 1 (
        echo [ERRO] Falha ao criar ambiente virtual.
        pause & exit /b 1
    )
    echo [OK] Ambiente virtual criado.
)

set PIP=%VENV%\Scripts\pip.exe
set PYTHON=%VENV%\Scripts\python.exe

:: 5. Instalar dependencias
echo.
echo [4/7] Instalando dependencias Python...
echo     (FastAPI, Uvicorn, pyodbc, bcrypt... pode demorar)
"%PIP%" install -r "%BASE_DIR%requirements.txt" --quiet
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    echo Tente manualmente: venv\Scripts\pip install -r requirements.txt
    pause & exit /b 1
)
echo [OK] Dependencias instaladas.

:: 6. Verificar driver ODBC
echo.
echo [5/7] Verificando driver ODBC para SQL Server...
powershell -Command "Get-OdbcDriver -Name 'ODBC Driver 17 for SQL Server' -ErrorAction SilentlyContinue" | find "ODBC" >nul 2>&1
if errorlevel 1 (
    powershell -Command "Get-OdbcDriver -Name 'ODBC Driver 18 for SQL Server' -ErrorAction SilentlyContinue" | find "ODBC" >nul 2>&1
    if errorlevel 1 (
        echo [AVISO] Driver ODBC para SQL Server nao encontrado.
        echo         A conexao com o ERP pode falhar.
        echo         Baixe em: https://aka.ms/odbc17
        echo         (Pode instalar depois e reiniciar o servico)
    ) else (
        echo [OK] ODBC Driver 18 for SQL Server encontrado.
    )
) else (
    echo [OK] ODBC Driver 17 for SQL Server encontrado.
)

:: 7. Criar .env
echo.
echo [6/7] Configurando .env...
if exist "%ENV_FILE%" (
    echo [OK] Arquivo .env ja existe - mantendo configuracoes atuais.
) else (
    copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
    echo.
    echo -------------------------------------------------------
    echo  ATENCAO: Configure os dados do banco ERP agora.
    echo.
    echo  O Bloco de Notas vai abrir. Preencha:
    echo    DB_HOST  = IP do servidor SQL Server
    echo    DB_PORT  = Porta (padrao 1433)
    echo    DB_NAME  = Nome do banco (ex: PROTHEUS)
    echo    DB_USER  = Usuario SQL
    echo    DB_PASS  = Senha SQL
    echo    FILIAL   = Codigo da filial (ex: 01)
    echo.
    echo  Salve e feche o Bloco de Notas para continuar.
    echo -------------------------------------------------------
    echo.
    pause
    notepad "%ENV_FILE%"
    echo [OK] .env configurado.
)

:: 8. Registrar servico Windows
echo.
echo [7/7] Registrando servico Windows...

:: Remover versoes antigas com nomes diferentes
for %%N in ("IACommand-Agente" "IA Hub - IaCommand_API" "IA Command - Agente Local" "IACommand") do (
    nssm status %%N >nul 2>&1
    if not errorlevel 1 (
        echo     Removendo servico antigo: %%N
        nssm stop   %%N >nul 2>&1
        nssm remove %%N confirm >nul 2>&1
    )
)

mkdir "%BASE_DIR%logs" 2>nul

:: Converter caminhos para formato curto 8.3 (sem espacos) — unico metodo confiavel com NSSM
for %%i in ("%PYTHON%")          do set SHORT_PY=%%~si
for %%i in ("%BASE_DIR%main.py") do set SHORT_MAIN=%%~si
for %%i in ("%BASE_DIR%.")       do set SHORT_DIR=%%~si
for %%i in ("%BASE_DIR%logs\.")  do set SHORT_LOGS=%%~si

echo     Python : %SHORT_PY%
echo     Script : %SHORT_MAIN%
echo     Pasta  : %SHORT_DIR%

nssm install "%SERVICE_NAME%" "%SHORT_PY%"
nssm set "%SERVICE_NAME%" AppParameters  "%SHORT_MAIN%"
nssm set "%SERVICE_NAME%" AppDirectory   "%SHORT_DIR%"
nssm set "%SERVICE_NAME%" DisplayName    "%SERVICE_NAME%"
nssm set "%SERVICE_NAME%" Description    "API local do IA Command para execucao de SQL no ERP."
nssm set "%SERVICE_NAME%" Start          SERVICE_AUTO_START
nssm set "%SERVICE_NAME%" AppStdout      "%SHORT_LOGS%servico.log"
nssm set "%SERVICE_NAME%" AppStderr      "%SHORT_LOGS%servico-erros.log"
nssm set "%SERVICE_NAME%" AppRotateFiles    1
nssm set "%SERVICE_NAME%" AppRotateOnline   1
nssm set "%SERVICE_NAME%" AppRotateBytes    10485760

nssm start "%SERVICE_NAME%"
if errorlevel 1 (
    echo [AVISO] Servico instalado mas nao iniciou.
    echo         Verifique: %BASE_DIR%logs\servico-erros.log
) else (
    echo [OK] Servico iniciado com sucesso.
)

:: Resumo final
echo.
echo -------------------------------------------------------
echo  INSTALACAO CONCLUIDA!
echo.
echo  Painel admin: http://localhost:8765
echo  Senha padrao: admin  (troque no primeiro acesso)
echo.
echo  Proximos passos:
echo  1. Acesse http://localhost:8765
echo  2. Va em Conexao ERP e teste a conexao com o banco
echo  3. Va em Seguranca e gere um novo token
echo  4. Copie o token e cole no painel nuvem do IA Command
echo     (Configurar IA > Agente Local > Bearer Token)
echo -------------------------------------------------------
echo.
pause

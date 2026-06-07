@echo off
setlocal

set SERVICE_NAME=IACommand
set BASE_DIR=%~dp0..
set PYTHON=%BASE_DIR%\venv\Scripts\python.exe

if not exist "%PYTHON%" (
  echo [ERRO] Python nao encontrado em %PYTHON%
  echo Execute primeiro: python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
  pause & exit /b 1
)

where nssm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] NSSM nao encontrado no PATH.
  echo Baixe em: https://nssm.cc/download e adicione ao PATH ou a pasta do agente.
  pause & exit /b 1
)

echo Instalando servico "%SERVICE_NAME%"...
nssm install "%SERVICE_NAME%" "%PYTHON%" "%BASE_DIR%\main.py"
nssm set "%SERVICE_NAME%" AppDirectory "%BASE_DIR%"
nssm set "%SERVICE_NAME%" DisplayName  "IA Command — Agente Local"
nssm set "%SERVICE_NAME%" Description  "API local do IA Command para execucao de SQL no ERP."
nssm set "%SERVICE_NAME%" Start        SERVICE_AUTO_START
nssm set "%SERVICE_NAME%" AppStdout    "%BASE_DIR%\logs\service.log"
nssm set "%SERVICE_NAME%" AppStderr    "%BASE_DIR%\logs\service-err.log"
nssm set "%SERVICE_NAME%" AppRotateFiles 1
nssm set "%SERVICE_NAME%" AppRotateOnline 1
nssm set "%SERVICE_NAME%" AppRotateBytes 10485760

mkdir "%BASE_DIR%\logs" 2>nul

echo.
echo Servico instalado. Iniciando...
nssm start "%SERVICE_NAME%"
echo.
echo Pronto! Acesse o painel em: http://localhost:8765
pause

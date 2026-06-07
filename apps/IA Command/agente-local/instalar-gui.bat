@echo off
:: Launcher do instalador GUI do IA Command - Agente Local
:: Abre a interface gráfica de instalação (requer Windows 10+)

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0instalar-gui.ps1"

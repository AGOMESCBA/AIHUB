@echo off
echo Parando e removendo o servico "IACommand"...
nssm stop   "IACommand"
nssm remove "IACommand" confirm
echo Servico removido.
pause

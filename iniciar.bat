@echo off
chcp 65001 >nul
title F.O.G.O. - Central de Operacoes de Marilia
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   O F.O.G.O. precisa do Node.js 18 ou mais novo.
  echo   Baixe em https://nodejs.org e execute este arquivo de novo.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)
node server\index.js %*
pause

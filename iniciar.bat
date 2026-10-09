@echo off
chcp 65001 > nul
set PYTHONUTF8=1
cd /d "%~dp0"
title Boto Faminto
where python >nul 2>nul && (python servidor.py) || (py servidor.py)
pause

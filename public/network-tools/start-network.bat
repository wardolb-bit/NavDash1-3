@echo off
cd /d "%~dp0"
py -3 --version >nul 2>&1
if errorlevel 1 goto trypython
py -3 wardlab-agent.py
goto done
:trypython
python --version >nul 2>&1
if errorlevel 1 goto missing
python wardlab-agent.py
goto done
:missing
echo Python 3.9 or newer is required. Install Python from python.org, then run this file again.
:done
pause

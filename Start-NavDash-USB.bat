@echo off
setlocal

set "APP_DIR=%~dp0"
set "NODE_DIR="

if exist "%APP_DIR%nodejs\node.exe" set "NODE_DIR=%APP_DIR%nodejs"
if not defined NODE_DIR if exist "%APP_DIR%node\node.exe" set "NODE_DIR=%APP_DIR%node"
if not defined NODE_DIR if exist "%APP_DIR%..\nodejs\node.exe" set "NODE_DIR=%APP_DIR%..\nodejs"
if not defined NODE_DIR if exist "%APP_DIR%..\node\node.exe" set "NODE_DIR=%APP_DIR%..\node"

if not defined NODE_DIR (
  echo.
  echo NavDash could not find portable Node.
  echo Put Node portable at either:
  echo   %APP_DIR%nodejs
  echo or beside this folder as:
  echo   %APP_DIR%..\nodejs
  echo.
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%APP_DIR%node_modules\.bin;%PATH%"
if not defined PORT set "PORT=3000"
if not defined AIS_WS_PORT set "AIS_WS_PORT=8081"
if not defined AIS_PORT set "AIS_PORT=COM4"
if not defined AIS_BAUD set "AIS_BAUD=38400"
if not defined FELCOM_EGC_DIR set "FELCOM_EGC_DIR=C:\Users\havennav\Documents\felcom19\egc"
set "NAVDASH_DATA_DIR=%APP_DIR%data"
set "NAV_ROUTE_STATE_PATH=%APP_DIR%data\loaded-route.json"

cd /d "%APP_DIR%"

if not exist "%APP_DIR%node_modules" (
  echo.
  echo NavDash node_modules folder is missing.
  echo Copy node_modules with NavDash, or run npm install once while online.
  echo.
  pause
  exit /b 1
)

if not exist "%APP_DIR%.next\BUILD_ID" (
  echo.
  echo NavDash production build is missing.
  echo Build NavDash on the laptop first with:
  echo   npm run build
  echo Then copy the complete NavDash folder to the USB again.
  echo.
  pause
  exit /b 1
)

if not exist "%APP_DIR%node_modules\next\dist\bin\next" (
  echo.
  echo Next runtime is missing from node_modules.
  echo Copy the complete node_modules folder from the laptop build.
  echo.
  pause
  exit /b 1
)

echo.
echo Starting NavDash from USB...
echo Main site:   http://localhost:3000
echo Ship access: http://THIS-COMPUTER-IP:3000
echo AIS socket:  ws://THIS-COMPUTER-IP:8081
echo AIS serial:  %AIS_PORT% at %AIS_BAUD% baud
echo EGC folder:  %FELCOM_EGC_DIR%
echo.
echo Close this window to stop NavDash.
echo.

start "NavDash AIS Server" /b "%NODE_DIR%\node.exe" "%APP_DIR%server\ais-server.js"
"%NODE_DIR%\node.exe" "%APP_DIR%node_modules\next\dist\bin\next" start -H 0.0.0.0 -p %PORT%

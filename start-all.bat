@echo off
setlocal
cd /d "%~dp0"

set "APP_ROOT=%~dp0"
set "SOVITS_ROOT=F:\You\GPT-SoVITS\GPT-SoVITS-v2pro-20250604"
set "SOVITS_PYTHON=%SOVITS_ROOT%\runtime\python.exe"
set "SOVITS_SCRIPT=api_v2.py"
set "SOVITS_CONFIG=GPT_SoVITS/configs/tts_infer_custom.yaml"

echo [1/4] Checking GPT-SoVITS files...
if not exist "%SOVITS_PYTHON%" (
  echo GPT-SoVITS runtime python not found:
  echo %SOVITS_PYTHON%
  pause
  exit /b 1
)
if not exist "%SOVITS_ROOT%\%SOVITS_SCRIPT%" (
  echo GPT-SoVITS api script not found:
  echo %SOVITS_ROOT%\%SOVITS_SCRIPT%
  pause
  exit /b 1
)
if not exist "%SOVITS_ROOT%\%SOVITS_CONFIG%" (
  echo GPT-SoVITS config not found:
  echo %SOVITS_ROOT%\%SOVITS_CONFIG%
  pause
  exit /b 1
)

echo [2/4] Checking npm dependencies...
if not exist "%APP_ROOT%node_modules\electron" (
  echo node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [3/4] Ensuring GPT-SoVITS API is running...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%scripts\ensure-sovits.ps1"
if errorlevel 1 (
  echo GPT-SoVITS failed to start or is not ready.
  pause
  exit /b 1
)

echo [4/4] Launching Desktop AI VTuber...
call npm start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo App exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%

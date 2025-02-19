@echo off
SET "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || exit /b
:: call .\venv\Scripts\activate.bat
@set "PATH=%~dp0embpy;%~dp0embpy\Scripts;%PATH%"
SETLOCAL ENABLEDELAYEDEXPANSION

set PACKAGE=open-webui
for /f "tokens=2" %%i in ('pip show %PACKAGE% ^| findstr "Version:"') do set LOCAL_VERSION=%%i
for /f "delims=" %%i in ('powershell -Command "(Invoke-WebRequest -Uri 'https://pypi.org/pypi/%PACKAGE%/json').Content | ConvertFrom-Json | Select-Object -ExpandProperty info | Select-Object -ExpandProperty version"') do set LATEST_VERSION=%%i

echo Local version: %LOCAL_VERSION%
echo PyPI version: %LATEST_VERSION%

if "%LOCAL_VERSION%" NEQ "%LATEST_VERSION%" (
    echo Update available. Updating %PACKAGE%...
    pip install --upgrade %PACKAGE%
) else (
    echo %PACKAGE% already updated.
)
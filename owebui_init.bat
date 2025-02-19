@echo off
SET "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || exit /b
:: @set "PATH=%~dp0embpy;%~dp0embpy\Scripts;%PATH%"
SETLOCAL ENABLEDELAYEDEXPANSION

echo deploy embedded python
call init.bat 3.11.9

echo build requirements
call start_build
call env.bat

for %%F in (*.whl) do pip install "%%F"
pip install open-webui

echo Checking for open-webui installation.
pip show open-webui >nul 2>&1
if %ERRORLEVEL%==0 (
    setlocal enabledelayedexpansion
    set "version="
    for /f "tokens=2 delims=:" %%a in ('pip show open-webui ^| findstr /I "Version:"') do (
        set "version=%%a"
    )
    if defined version (
        for /f "tokens=* delims= " %%v in ("!version!") do set "version=%%v"
    ) else (
        echo package open-webui not found.
        exit /b 1
    )
    echo open-webui installed.
    echo !version! > installed.txt
    endlocal
) else (
    echo open-webui not installed.
)

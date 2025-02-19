@echo off
setlocal enabledelayedexpansion

:: Global variables
set "TAG=DEBUG"
set "TEMP_DIR=%~dp0~TEMP"
set "EMBPY_DIR=%~dp0embpy"
set "ARCHIVE=%TEMP_DIR%\archive.tmp"

:: Version handling
if "%~1"=="" (
    set /p PYTHON_VERSION=?:version^=^>
) else (
    set "PYTHON_VERSION=%~1"
)

:: Function declarations
goto :main

:log [message]
    echo [%TAG%] %~1
    exit /b

:ensure_dir [dir]
    if exist "%~1" (
        call :log "?exist"
        rd /s /q "%~1" >nul 2>&1 || (
            call :log "-!failed"
            exit /b 1
        )
    )
    mkdir "%~1" || exit /b 1
    exit /b 0

:download_file [url] [output] [use_aria]
    if "%~3"=="true" (
        for %%F in ("%~2") do (
            set "dir=%%~dpF"
            aria2c -x4 --dir="!dir:\=/!" --out="%%~nxF" --auto-file-renaming=false --allow-overwrite=true --remove-control-file=true "%~1"
            set dir=
        ) || exit /b 1
    ) else (
        powershell -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing" || exit /b 1
    )
    exit /b 0

:extract_zip [source] [destination]
    powershell -Command "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%~1' -DestinationPath '%~2' -Force" || exit /b 1
    exit /b 0

:install_aria2
    set "TAG=ARIA2"
    call :log "+fetch-url"
    
    for /f "tokens=*" %%A in ('powershell -Command "$ProgressPreference = 'SilentlyContinue'; (Invoke-WebRequest -Uri 'https://api.github.com/repos/aria2/aria2/releases/latest' -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty assets | Where-Object { $_.name -match 'win-64bit.*\.zip' } | Select-Object -ExpandProperty browser_download_url"') do (
        set "DOWNLOAD_URL=%%A"
    )

    if not defined DOWNLOAD_URL (
        call :log "-!cannot_fetch_url"
        exit /b 1
    )

    call :log "+downloading"
    call :download_file "!DOWNLOAD_URL!" "%ARCHIVE%.zip" false || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-downloaded"

    mkdir "%TEMP_DIR%\ARIA2" || exit /b 1

    call :log "+extracting"
    call :extract_zip "%ARCHIVE%.zip" "%TEMP_DIR%\ARIA2" || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-extracted"

    del /f /s /q "%ARCHIVE%.zip" >nul 2>&1

    pushd "%TEMP_DIR%\ARIA2\aria2*" || exit /b 1
    move "aria2c.exe" "%TEMP_DIR%\aria2c.exe" >nul 2>&1 || exit /b 1
    popd

    call :log "+cleaning"
    rd /s /q "%TEMP_DIR%\ARIA2" >nul 2>&1 || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-cleaned"
    exit /b 0

:verify_aria2
    if not defined ARIA2_TRIED set /a "ARIA2_TRIED=0"
    
    where aria2c >nul 2>nul && (
        aria2c --version | findstr /i "aria2 version" >nul 2>nul && exit /b 0
    )
    
    if !ARIA2_TRIED!==1 (
        call :log "aria2c cannot be downloaded or invalid version"
        exit /b 1
    )
    
    set /a "ARIA2_TRIED=1"
    call :install_aria2 || exit /b 1
    goto :verify_aria2

:install_python
    set "TAG=EMBEDDED PYTHON"
    set "PY_BASE=https://www.python.org/ftp/python/%PYTHON_VERSION%/"
    
    call :log "+downloading"
    call :download_file "%PY_BASE%python-%PYTHON_VERSION%-embed-amd64.zip" "%ARCHIVE%.zip" true || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-downloaded"

    call :log "+path_creating"
    call :ensure_dir "%EMBPY_DIR%" || exit /b 1
    call :log "-path_created"

    call :log "+extracting"
    call :extract_zip "%ARCHIVE%.zip" "%EMBPY_DIR%" || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-extracted"

    call :log "+patching"
    powershell -Command "(Get-Content '%EMBPY_DIR%\python*._pth') -replace '#import site','import site' | Set-Content '%EMBPY_DIR%\python*._pth'" || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-patched"

    set "PATH=%EMBPY_DIR%;%EMBPY_DIR%\Scripts;%PATH%"

    :: Install pip
    call :log "+pip_downloading"
    call :download_file "https://bootstrap.pypa.io/get-pip.py" "%ARCHIVE%.py" true || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-pip_downloaded"

    call :log "+pip_installing"
    python %ARCHIVE%.py || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-pip_installed"

    :: Install Python libraries
    for %%L in (lib lib_d) do (
        call :log "+%%L_downloading"
        call :download_file "%PY_BASE%amd64/%%L.msi" "%ARCHIVE%.msi" true || (
            call :log "-!failed"
            exit /b 1
        )
        call :log "-%%L_downloaded"
        
        call :log "+%%L_extracting"
        start /wait msiexec /a "%ARCHIVE%.msi" /qn TARGETDIR="%TEMP_DIR%\PYTHON" || (
            call :log "-!failed"
            exit /b 1
        )
        call :log "-%%L_extracted"
    )
    timeout /t 2 >nul 2>&1

    call :log "+venv_patching"
    move "%TEMP_DIR%\PYTHON\Lib\venv" "%EMBPY_DIR%\Lib\site-packages" >nul 2>&1 || exit /b 1
    call :log "-venv_patched"

    call :log "+cleaning"
    rd /s /q "%TEMP_DIR%" >nul 2>&1 || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-cleaned"

    call :create_env_scripts
    exit /b 0

:create_env_scripts
    call :log "+env_script_creating"
    (
        echo @set "PATH=%%~dp0embpy;%%~dp0embpy\Scripts;%%PATH%%"
    ) > env.bat
    (
        echo @echo off
        echo call env
        echo cmd /k
    ) > start_env.bat
    call :log "-env_script_created"
    exit /b 0

:main
    call :log "+path_creating"
    call :ensure_dir "%TEMP_DIR%" || goto error
    set "PATH=%TEMP_DIR%;%PATH%"
    call :log "-path_created"

    call :verify_aria2 || goto error
    call :install_python || goto error
    goto success

:error
    set "TAG=ERROR"
    call :log "Error occurred during execution."
    pause
    exit /b 1

:success
    set "TAG=DEBUG"
    call :log "Operation completed successfully."
    exit /b 0
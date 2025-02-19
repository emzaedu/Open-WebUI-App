@echo off
:: Source handling
if "%~1"=="" (
    set /p SOURCE_URL=?:source url^(.zip^)^=^>
) else (
    set "SOURCE_URL=%~1"
)

goto main

:log [message]
    echo [%TAG%] %~1
    exit /b

:download_file [url] [output]
    powershell -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing" || exit /b 1
    exit /b 0

:extract_zip [source] [destination]
    powershell -Command "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%~1' -DestinationPath '%~2' -Force" || exit /b 1
    exit /b 0

:main
    call env
    set "TAG=BUILD COMPRESSED RTF"
    call :log "+downloading"
    call :download_file "%SOURCE_URL%" "source.zip" || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-downloaded"
    call :log "+extracting"
    call :extract_zip "source.zip" "%~dp0" || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-extracted"
    call :log "+requrements_installing"
    pip install build || (
        call :log "-!failed"
        exit /b 1
    )
    call :log "-requrements_installed"
    call :log "+building"
    pushd "%~dp0compressed_rtf*" || (
        call :log "-!failed(when_changing_dir)"
        exit /b 1
    )
    python -m build || (
        call :log "-!failed(when_building)"
        exit /b 1
    )
    popd
    call :log "-built"
    call :log "+cleaning"
    del /f /q *.zip >nul 2>&1 || (
        call :log "-!failed(when_removing_zip)"
        exit /b 1
    )
    del /f /q *.whl >nul 2>&1 || (
        call :log "-!failed(when_removing_whl)"
        exit /b 1
    )
    pushd "%~dp0compressed_rtf*\dist" || (
        call :log "-!failed(when_changing_dir)"
        exit /b 1
    )
    move "*.whl" "%~dp0" >nul 2>&1 || (
        call :log "-!failed(when_moving_whl)"
        exit /b 1
    )
    popd
    for /d %%i in ("compressed_rtf*") do rd /s /q "%%i" >nul 2>&1 || (
        call :log "-!failed(when_removing_build_dir)"
        exit /b 1
    )
    call :log "-cleaned"
    exit /b 0
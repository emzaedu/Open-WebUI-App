@echo off
if "%~1" neq "" (
    set "PYTHON_VERSION=%~1"
    goto install_python
) else (
    if exist "env.bat" (
        if exist "embpy\" (
            if exist "embpy\*" (
                goto build
            )
        )
    )
    set /p PYTHON_VERSION=?:python version^=^>
    goto install_python
)
goto :exit

:install_python
    call clean
    call init %PYTHON_VERSION%

:build
    call build.compressed_rtf "https://github.com/delimitry/compressed_rtf/archive/refs/tags/1.0.6.zip"

:exit
    exit /b